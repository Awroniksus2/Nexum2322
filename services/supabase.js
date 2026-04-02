// ══════════════════════════════════════════════════════════════
// services/supabase.js  —  повна заміна firebase.js
// ══════════════════════════════════════════════════════════════
//
// Render Environment Variables потрібні:
//   SUPABASE_URL          https://xxxxxxxxxxxx.supabase.co
//   SUPABASE_SERVICE_KEY  eyJhbGci...  (service_role key)
//   SUPABASE_BUCKET       patient-photos
//
// SQL для створення таблиць (запусти один раз у Supabase SQL Editor):
//   Дивись файл supabase_schema.sql
// ══════════════════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getDb() {
  if (!_client) {
  const url = (process.env.SUPABASE_URL || process.env.Project_URL || '').replace(/\/$/, '');
   const key = process.env.SUPABASE_SERVICE_KEY || process.env.Service_Role_Key || '';
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    _client = createClient(url, key, {
      auth: { persistSession: false }
    });
    console.log('✅ Supabase initialized:', url);
  }
  return _client;
}

// ── Утиліти ───────────────────────────────────────────────────
function generatePassword(n = 8) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

// ── Лікарі ────────────────────────────────────────────────────

async function isDoctorAllowedByPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const db = getDb();

  // Спочатку пошук по id (normalized phone)
  const { data: byId } = await db
    .from('allowed_doctors')
    .select('*')
    .eq('id', normalized)
    .maybeSingle();
  if (byId) return { docId: normalized, ...byId };

  // Повний скан (fallback)
  const { data: all } = await db.from('allowed_doctors').select('*');
  if (!all) return null;
  for (const row of all) {
    if (normalizePhone(row.phone) === normalized) return { docId: row.id, ...row };
  }
  return null;
}

async function isDoctorAllowed(telegramId) {
  const { data } = await getDb()
    .from('allowed_doctors')
    .select('id')
    .eq('id', String(telegramId))
    .maybeSingle();
  return !!data;
}

async function saveDoctor(telegramId, data) {
  const existing = await getDoctorByTelegramId(telegramId);
  const password = existing?.password || generatePassword();
  const dc = data.code ? data.code.toUpperCase() : null;
  const now = new Date().toISOString();
  const db = getDb();

  const doctorRow = {
    telegram_id: String(telegramId),
    name: data.name || '',
    city: data.city || '',
    hospital: data.hospital || '',
    specialty: data.specialty || '',
    email: data.email || '',
    code: dc,
    phone: data.phone || '',
    password,
    updated_at: now,
  };

  // Upsert у registered_doctors
  await db.from('registered_doctors').upsert(
    { ...doctorRow, created_at: existing ? existing.created_at : now },
    { onConflict: 'telegram_id' }
  );

  // Upsert у doctors (довідник по коду)
  if (dc) {
    await db.from('doctors').upsert(
      { code: dc, ...doctorRow, created_at: existing ? existing.created_at : now },
      { onConflict: 'code' }
    );
  }

  return password;
}

async function getDoctorByTelegramId(telegramId) {
  const { data } = await getDb()
    .from('registered_doctors')
    .select('*')
    .eq('telegram_id', String(telegramId))
    .maybeSingle();
  return data || null;
}

async function getDoctorByCode(code) {
  const { data } = await getDb()
    .from('registered_doctors')
    .select('*')
    .eq('code', code.toUpperCase())
    .maybeSingle();
  return data || null;
}

async function searchDoctors(query, code) {
  const db = getDb();
  if (code) {
    const { data } = await db
      .from('registered_doctors')
      .select('code, name, city, hospital, specialty')
      .eq('code', code.toUpperCase())
      .limit(1);
    return data || [];
  }
  const q = (query || '').toLowerCase().trim();
  if (!q) return [];

  // Supabase ilike пошук по кількох полях
  const { data } = await db
    .from('registered_doctors')
    .select('code, name, city, hospital, specialty')
    .or(`name.ilike.%${q}%,city.ilike.%${q}%,hospital.ilike.%${q}%,specialty.ilike.%${q}%`)
    .limit(5);
  return data || [];
}

async function generateUniqueCode() {
  const db = getDb();
  let code, exists = true;
  while (exists) {
    code = 'DOC-' + Math.floor(1000 + Math.random() * 9000);
    const { data } = await db
      .from('registered_doctors')
      .select('code')
      .eq('code', code)
      .maybeSingle();
    exists = !!data;
  }
  return code;
}

// ── Пацієнти ──────────────────────────────────────────────────

function resolveMessages(session) {
  if (Array.isArray(session.messages) && session.messages.length > 0) return session.messages;
  if (Array.isArray(session.chatHistory) && session.chatHistory.length > 0) return session.chatHistory;
  return [];
}

async function getPatientsByDoctorCode(doctorCode) {
  const { data, error } = await getDb()
    .from('patients')
    .select('*')
    .eq('doctor_code', doctorCode.toUpperCase())
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data || []).map(row => {
    const parsed = _parsePatientRow(row);
    if (Array.isArray(parsed.chatSessions)) {
      parsed.chatSessions = parsed.chatSessions.map(session => ({
        ...session,
        messages: resolveMessages(session),
      }));
    }
    return parsed;
  });
}

function _parsePatientRow(row) {
  return {
    id: 'sb_' + row.id,
    doctorCode: row.doctor_code,
    name: row.name || '',
    phone: row.phone || '',
    email: row.email || '',
    birthDate: row.birth_date || '',
    gender: row.gender || '',
    address: row.address || '',
    notes: row.notes || '',
    photos: row.photos || [],
    chatSessions: row.chat_sessions || [],
    surveyResults: row.survey_results || [],
    lastBotSession: row.last_bot_session || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function savePatientRecord(doctorCode, patientData) {
  const db = getDb();
  const now = new Date().toISOString();
  const dc = doctorCode.toUpperCase();

  const row = {
    doctor_code: dc,
    name: patientData.name || '',
    phone: patientData.phone || '',
    email: patientData.email || '',
    birth_date: patientData.birthDate || patientData.birth_date || null,
    gender: patientData.gender || null,
    address: patientData.address || null,
    notes: patientData.notes || null,
    photos: patientData.photos || [],
    chat_sessions: patientData.chatSessions || [],
    survey_results: patientData.surveyResults || [],
    last_bot_session: patientData.lastBotSession || null,
    updated_at: now,
  };

  if (patientData.id && String(patientData.id).startsWith('sb_')) {
    const docId = String(patientData.id).replace('sb_', '');
    const { error } = await db
      .from('patients')
      .update(row)
      .eq('id', docId);
    if (error) throw error;
    return patientData.id;
  } else {
    const { data, error } = await db
      .from('patients')
      .insert({ ...row, created_at: now })
      .select('id')
      .single();
    if (error) throw error;
    return 'sb_' + data.id;
  }
}

async function deletePatientRecord(patientId) {
  const parts = String(patientId).split('|');
  const docId = parts[0].replace('sb_', '');
  const { error } = await getDb()
    .from('patients')
    .delete()
    .eq('id', docId);
  if (error) throw error;
}

// ── Архів сесій ───────────────────────────────────────────────

async function savePatient(patientData, doctorCode, summary, chatHistory, dashboardDocId) {
  const dc = doctorCode.toUpperCase();
  const now = new Date().toISOString();
  const db = getDb();

  // Зберігаємо повну сесію в таблицю sessions
  const { data: sessionData, error: sessionError } = await db
    .from('sessions')
    .insert({
      doctor_code: dc,
      name: patientData.name || '',
      phone: patientData.phone || '',
      email: patientData.email || '',
      summary: summary || '',
      chat_history: chatHistory || [],
      created_at: now,
    })
    .select('id')
    .single();

  if (sessionError) throw sessionError;
  const sessionId = sessionData.id;

  // Знаходимо пацієнта у dashboard
  let targetId = dashboardDocId ? String(dashboardDocId).replace('sb_', '') : null;

  if (!targetId) {
    const normPhone = normalizePhone(patientData.phone);
    if (normPhone) {
      const { data: found } = await db
        .from('patients')
        .select('id, phone')
        .eq('doctor_code', dc);
      if (found) {
        const match = found.find(p => normalizePhone(p.phone) === normPhone);
        if (match) targetId = match.id;
      }
    }
  }

  if (!targetId) {
    console.log('[savePatient] no dashboard match — chatSessions not saved');
    return String(sessionId);
  }

  try {
    const { data: existing } = await db
      .from('patients')
      .select('chat_sessions')
      .eq('id', targetId)
      .single();

    const sessions = existing?.chat_sessions || [];
    const newSession = {
      id: String(sessionId),
      createdAt: now,
      summary: summary || '',
      messages: (chatHistory || []).filter(m =>
        m && m.role && m.content &&
        m.content !== 'Почни опитування' &&
        m.content !== 'Start the survey'
      ),
    };

    await db
      .from('patients')
      .update({
        chat_sessions: [...sessions, newSession],
        last_bot_session: now,
        updated_at: now,
      })
      .eq('id', targetId);

    console.log(`[savePatient] ✅ chatSessions → patients/${targetId}`);
  } catch (e) {
    console.error('[savePatient] chatSessions update error:', e.message);
  }

  return String(sessionId);
}

// ── Опитувальники ─────────────────────────────────────────────

async function getSurveysByDoctorCode(doctorCode) {
  const dc = doctorCode.toUpperCase();
  const { data } = await getDb()
    .from('surveys')
    .select('*')
    .eq('doctor_code', dc)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return { surveys: null, fsId: null };
  return { surveys: data.surveys_data || null, fsId: String(data.id) };
}

async function saveSurveys(doctorCode, surveysData, fsId) {
  const dc = doctorCode.toUpperCase();
  const now = new Date().toISOString();
  const db = getDb();

  if (fsId) {
    await db
      .from('surveys')
      .update({ surveys_data: surveysData, updated_at: now })
      .eq('id', fsId);
    return fsId;
  }

  // Перевіряємо чи є вже запис
  const { data: existing } = await db
    .from('surveys')
    .select('id')
    .eq('doctor_code', dc)
    .limit(1)
    .maybeSingle();

  if (existing) {
    await db
      .from('surveys')
      .update({ surveys_data: surveysData, updated_at: now })
      .eq('id', existing.id);
    return String(existing.id);
  }

  const { data: newDoc } = await db
    .from('surveys')
    .insert({ doctor_code: dc, surveys_data: surveysData, created_at: now, updated_at: now })
    .select('id')
    .single();
  return String(newDoc.id);
}

// ── Фото: Supabase Storage ────────────────────────────────────

function _supabaseStorage() {
  const url = (process.env.SUPABASE_URL || process.env.Project_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.Service_Role_Key || '';
  const bucket = process.env.SUPABASE_BUCKET || 'patient-photos';
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  return { url, key, bucket };
}

async function uploadPhoto(buffer, mimetype, doctorCode) {
  const { url, key, bucket } = _supabaseStorage();
  const ext = ((mimetype || 'image/jpeg').split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const filename = `${doctorCode.toUpperCase()}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const uploadUrl = `${url}/storage/v1/object/${bucket}/${filename}`;

  const resp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + key,
      'Content-Type': mimetype || 'image/jpeg',
      'x-upsert': 'true',
    },
    body: buffer,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Supabase Storage upload failed [${resp.status}]: ${errText}`);
  }

  const publicUrl = `${url}/storage/v1/object/public/${bucket}/${filename}`;
  console.log('[uploadPhoto] ✅ Supabase →', filename);
  return publicUrl;
}

async function addPatientPhoto(doctorCode, patientId, photoUrls) {
  const docId = String(patientId).replace('sb_', '');
  const urls = (Array.isArray(photoUrls) ? photoUrls : [photoUrls]).filter(Boolean);
  if (!urls.length) return;

  const db = getDb();
  const { data } = await db
    .from('patients')
    .select('photos')
    .eq('id', docId)
    .single();

  if (!data) { console.warn('[addPatientPhoto] not found:', docId); return; }

  const existing = data.photos || [];
  const newUrls = urls.filter(u => !existing.includes(u));
  if (!newUrls.length) return;

  await db
    .from('patients')
    .update({
      photos: [...existing, ...newUrls],
      updated_at: new Date().toISOString(),
    })
    .eq('id', docId);

  console.log(`[addPatientPhoto] ✅ +${newUrls.length} URLs → patients/${docId}`);
}

// ── Сумісність з patientConverter.js ─────────────────────────
// patientConverter використовує getDb() напряму (Firestore API).
// Після міграції він потребує оновлення — поки що залишаємо заглушку.
// Дивись patientConverter_supabase.js для оновленої версії.

// ── Exports ───────────────────────────────────────────────────
module.exports = {
  getDb,
  isDoctorAllowed,
  isDoctorAllowedByPhone,
  saveDoctor,
  getDoctorByTelegramId,
  getDoctorByCode,
  searchDoctors,
  generateUniqueCode,
  savePatient,
  getPatientsByDoctorCode,
  savePatientRecord,
  deletePatientRecord,
  getSurveysByDoctorCode,
  saveSurveys,
  uploadPhoto,
  addPatientPhoto,
  // Заглушки для зворотної сумісності з server.js/patientConverter
  patientsCol: () => { throw new Error('patientsCol() is Firestore-only. Use Supabase helpers instead.'); },
  surveysCol:  () => { throw new Error('surveysCol() is Firestore-only. Use Supabase helpers instead.'); },
  doctorRef:   () => { throw new Error('doctorRef() is Firestore-only. Use Supabase helpers instead.'); },
};

const admin = require('firebase-admin');
let db;

function getDb() {
  if (!db) {
    if (!admin.apps.length) {
      let sa;
      try {
        sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON.trim());
      } catch (e) {
        console.error('❌ Firebase JSON parse error:', e.message);
        throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is invalid: ' + e.message);
      }
      admin.initializeApp({ credential: admin.credential.cert(sa) });
      console.log('✅ Firebase initialized:', sa.project_id);
    }
    db = admin.firestore();
  }
  return db;
}

// ── Хелпери для підколекцій ───────────────────────────────────
// Нова структура:
//   doctors/{doctorCode}/patients/{patientId}
//   doctors/{doctorCode}/surveys/{surveyId}
//   doctors/{doctorCode}/sessions/{sessionId}   ← архів чатів
//
// Старі плоскі колекції більше не використовуються для запису.
// Читання залишено для зворотної сумісності під час перехідного періоду.

function doctorRef(doctorCode) {
  return getDb().collection('doctors').doc(doctorCode.toUpperCase());
}

function patientsCol(doctorCode) {
  return doctorRef(doctorCode).collection('patients');
}

function surveysCol(doctorCode) {
  return doctorRef(doctorCode).collection('surveys');
}

function sessionsCol(doctorCode) {
  return doctorRef(doctorCode).collection('sessions');
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
  const byId = await getDb().collection('allowed_doctors').doc(normalized).get();
  if (byId.exists) return { docId: normalized, ...byId.data() };
  const snap = await getDb().collection('allowed_doctors').get();
  for (const doc of snap.docs) {
    const data = doc.data();
    if (normalizePhone(data.phone) === normalized) return { docId: doc.id, ...data };
  }
  return null;
}

async function isDoctorAllowed(telegramId) {
  const doc = await getDb().collection('allowed_doctors').doc(String(telegramId)).get();
  return doc.exists;
}

async function saveDoctor(telegramId, data) {
  const existing = await getDoctorByTelegramId(telegramId);
  const password = existing?.password || generatePassword();
  const dc = data.code ? data.code.toUpperCase() : null;

  // Зберігаємо в registered_doctors (без змін — авторизація)
  await getDb().collection('registered_doctors').doc(String(telegramId)).set({
    ...data, password, telegramId: String(telegramId), updatedAt: new Date().toISOString()
  });

  // Також створюємо/оновлюємо профіль у doctors/{code}
  if (dc) {
    await doctorRef(dc).set({
      ...data, password, telegramId: String(telegramId), updatedAt: new Date().toISOString()
    }, { merge: true });
  }

  return password;
}

async function getDoctorByTelegramId(telegramId) {
  const doc = await getDb().collection('registered_doctors').doc(String(telegramId)).get();
  return doc.exists ? doc.data() : null;
}

async function getDoctorByCode(code) {
  const snap = await getDb().collection('registered_doctors')
    .where('code', '==', code.toUpperCase()).limit(1).get();
  return snap.empty ? null : snap.docs[0].data();
}

async function searchDoctors(query, code) {
  if (code) {
    const snap = await getDb().collection('registered_doctors')
      .where('code', '==', code.toUpperCase()).limit(1).get();
    return snap.empty ? [] : [snap.docs[0].data()];
  }
  const q = (query || '').toLowerCase().trim();
  if (!q) return [];
  const snap = await getDb().collection('registered_doctors').get();
  const results = [];
  snap.forEach(function (doc) {
    const d = doc.data();
    const name = (d.name || '').toLowerCase();
    const city = (d.city || '').toLowerCase();
    const hospital = (d.hospital || '').toLowerCase();
    const specialty = (d.specialty || '').toLowerCase();
    if (name.includes(q) || city.includes(q) || hospital.includes(q) || specialty.includes(q))
      results.push({ code: d.code, name: d.name, city: d.city, hospital: d.hospital, specialty: d.specialty });
  });
  return results.slice(0, 5);
}

async function generateUniqueCode() {
  let code, exists = true;
  while (exists) {
    code = 'DOC-' + Math.floor(1000 + Math.random() * 9000);
    const snap = await getDb().collection('registered_doctors').where('code', '==', code).limit(1).get();
    exists = !snap.empty;
  }
  return code;
}

// ── Пацієнти (нова структура) ─────────────────────────────────

function resolveMessages(session) {
  if (Array.isArray(session.messages) && session.messages.length > 0) return session.messages;
  if (Array.isArray(session.chatHistory) && session.chatHistory.length > 0) return session.chatHistory;
  return [];
}

async function getPatientsByDoctorCode(doctorCode) {
  try {
    const snap = await patientsCol(doctorCode)
      .orderBy('createdAt', 'desc').get();

    return snap.docs.map(doc => {
      const data = doc.data();
      if (Array.isArray(data.chatSessions)) {
        data.chatSessions = data.chatSessions.map(session => ({
          ...session,
          messages: resolveMessages(session)
        }));
      }
      return { id: 'fb_' + doc.id, ...data };
    });
  } catch (e) {
    // Fallback без orderBy (індекс ще не створено)
    if (e.code === 9 || e.message.includes('index')) {
      const snap = await patientsCol(doctorCode).get();
      const docs = snap.docs.map(doc => {
        const data = doc.data();
        if (Array.isArray(data.chatSessions)) {
          data.chatSessions = data.chatSessions.map(session => ({
            ...session,
            messages: resolveMessages(session)
          }));
        }
        return { id: 'fb_' + doc.id, ...data };
      });
      return docs.sort((a, b) => (b.createdAt || '') > (a.createdAt || '') ? 1 : -1);
    }
    throw e;
  }
}

async function savePatientRecord(doctorCode, patientData) {
  const col = patientsCol(doctorCode);
  const now = new Date().toISOString();

  if (patientData.id && String(patientData.id).startsWith('fb_')) {
    const docId = String(patientData.id).replace('fb_', '');
    const { id, ...data } = patientData;
    await col.doc(docId).set({
      ...data,
      doctorCode: doctorCode.toUpperCase(),
      updatedAt: now
    }, { merge: true });
    return patientData.id;
  } else {
    const { id, ...data } = patientData;
    const docRef = await col.add({
      ...data,
      doctorCode: doctorCode.toUpperCase(),
      createdAt: now,
      updatedAt: now
    });
    return 'fb_' + docRef.id;
  }
}

async function deletePatientRecord(patientId) {
  // patientId формату "fb_XXXX|doctorCode" або просто "fb_XXXX"
  // Якщо doctorCode не передано — шукаємо по всіх лікарях (сумісність)
  const parts = String(patientId).split('|');
  const docId = parts[0].replace('fb_', '');
  const dc = parts[1] ? parts[1].toUpperCase() : null;

  if (dc) {
    await patientsCol(dc).doc(docId).delete();
    return;
  }

  // Fallback: шукаємо в якого лікаря є цей документ
  const doctorsSnap = await getDb().collection('doctors').get();
  for (const dDoc of doctorsSnap.docs) {
    const ref = patientsCol(dDoc.id).doc(docId);
    const snap = await ref.get();
    if (snap.exists) {
      await ref.delete();
      return;
    }
  }
  throw new Error('Patient not found: ' + patientId);
}

// ── Архів сесій ───────────────────────────────────────────────

async function savePatient(patientData, doctorCode, summary, chatHistory, dashboardDocId) {
  const dc = doctorCode.toUpperCase();
  const now = new Date().toISOString();

  // 1. Зберігаємо архівну сесію в doctors/{dc}/sessions/
  const sessionRef = sessionsCol(dc).doc();
  await sessionRef.set({
    name: patientData.name || '',
    phone: patientData.phone || '',
    email: patientData.email || '',
    doctorCode: dc,
    summary: summary || '',
    chatHistory: chatHistory || [],
    createdAt: now
  });

  // 2. Додаємо chatSession до картки пацієнта
  let targetDocId = dashboardDocId ? dashboardDocId.replace('fb_', '') : null;

  if (!targetDocId) {
    const normPhone = normalizePhone(patientData.phone);
    if (normPhone) {
      const snap = await patientsCol(dc).get();
      for (const d of snap.docs) {
        if (normalizePhone(d.data().phone) === normPhone) {
          targetDocId = d.id;
          break;
        }
      }
    }
  }

  if (!targetDocId) {
    console.log(`[savePatient] no dashboard match — chatSessions not saved`);
    return sessionRef.id;
  }

  try {
    const targetSnap = await patientsCol(dc).doc(targetDocId).get();
    const existing = (targetSnap.data() || {}).chatSessions || [];
    const newSession = {
      id: sessionRef.id,
      createdAt: now,
      summary: summary || '',
      messages: (chatHistory || []).filter(m =>
        m && m.role && m.content &&
        m.content !== 'Почни опитування' &&
        m.content !== 'Start the survey'
      )
    };
    await patientsCol(dc).doc(targetDocId).update({
      chatSessions: [...existing, newSession],
      lastBotSession: now,
      updatedAt: now
    });
    console.log(`[savePatient] ✅ chatSessions → doctors/${dc}/patients/${targetDocId}`);
  } catch (e) {
    console.error('[savePatient] chatSessions update error:', e.message);
  }

  return sessionRef.id;
}

// ── Опитувальники ─────────────────────────────────────────────

async function getSurveysByDoctorCode(doctorCode) {
  const dc = doctorCode.toUpperCase();
  const snap = await surveysCol(dc).orderBy('updatedAt', 'desc').limit(1).get();
  if (snap.empty) return { surveys: null, fsId: null };
  const doc = snap.docs[0];
  return { surveys: doc.data().surveys || doc.data().data || null, fsId: doc.id };
}

async function saveSurveys(doctorCode, surveysData, fsId) {
  const dc = doctorCode.toUpperCase();
  const now = new Date().toISOString();

  if (fsId) {
    await surveysCol(dc).doc(fsId).set(
      { doctorCode: dc, surveys: surveysData, updatedAt: now },
      { merge: true }
    );
    return fsId;
  }

  const snap = await surveysCol(dc).limit(1).get();
  if (!snap.empty) {
    await snap.docs[0].ref.set({ surveys: surveysData, updatedAt: now }, { merge: true });
    return snap.docs[0].id;
  }

  const newDoc = await surveysCol(dc).add({
    doctorCode: dc,
    surveys: surveysData,
    createdAt: now,
    updatedAt: now
  });
  return newDoc.id;
}

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
  // Експортуємо хелпери для patientConverter
  patientsCol,
  surveysCol,
  doctorRef
};

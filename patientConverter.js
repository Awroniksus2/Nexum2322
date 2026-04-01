/**
 * patientConverter.js — NEXUM
 * Створює/оновлює картку пацієнта в doctors/{doctorCode}/patients/
 * chatSessions зберігає savePatient() у firebase.js — не дублюємо тут.
 */

const AVCOLORS = [
  '#c084fc','#34d399','#fb923c','#60a5fa',
  '#f472b6','#a78bfa','#4ade80','#facc15',
  '#f87171','#38bdf8'
];

function parseSummary(summary) {
  if (!summary) return {};
  const result = {
    complaint: '', onset: '', intensity: '', character: '', dynamics: '',
    symptoms: [], chronic: [], allergies: [], medications: [],
    surgeries: '', lifestyle: '', familyHistory: ''
  };
  const patterns = {
    complaint:     [/Скарга[:\s]+(.+)/i,               /Complaint[:\s]+(.+)/i],
    onset:         [/Початок[:\s]+(.+)/i,               /Onset[:\s]+(.+)/i],
    intensity:     [/Інтенсивність[:\s]+(.+)/i,         /Intensity[:\s]+(.+)/i],
    character:     [/Характер[:\s]+(.+)/i,              /Character[:\s]+(.+)/i],
    dynamics:      [/Динаміка[:\s]+(.+)/i,              /Dynamics[:\s]+(.+)/i],
    symptoms:      [/Симптоми[:\s]+(.+)/i,              /Symptoms[:\s]+(.+)/i],
    chronic:       [/Хронічні хвороби[:\s]+(.+)/i,      /Chronic conditions[:\s]+(.+)/i],
    allergies:     [/Алергії[:\s]+(.+)/i,               /Allergies[:\s]+(.+)/i],
    medications:   [/Медикаменти[:\s]+(.+)/i,           /Medications[:\s]+(.+)/i],
    surgeries:     [/Попередні операції[:\s]+(.+)/i,    /Previous surgeries[:\s]+(.+)/i],
    lifestyle:     [/Спосіб життя[:\s]+(.+)/i,          /Lifestyle[:\s]+(.+)/i],
    familyHistory: [/Сімейний анамнез[:\s]+(.+)/i,      /Family history[:\s]+(.+)/i],
  };
  for (const [field, rxList] of Object.entries(patterns)) {
    for (const rx of rxList) {
      const m = summary.match(rx);
      if (m) {
        const raw = m[1].trim();
        const isEmpty = /^(немає|не виявлено|невідомо|none|unknown|no|—|--)$/i.test(raw);
        if (['symptoms','chronic','allergies','medications'].includes(field)) {
          result[field] = isEmpty ? [] : raw.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
        } else {
          result[field] = isEmpty ? '' : raw;
        }
        break;
      }
    }
  }
  return result;
}

function normalizeName(str) {
  return (str || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function estimateScore(parsed) {
  let score = 70;
  const im = (parsed.intensity || '').match(/(\d+)/);
  if (im) {
    const i = parseInt(im[1]);
    if (i >= 8) score -= 20; else if (i >= 6) score -= 10; else if (i >= 4) score -= 5;
  }
  if (parsed.chronic.length)      score -= parsed.chronic.length * 5;
  if (parsed.allergies.length)    score -= 5;
  if (parsed.symptoms.length > 2) score -= 10;
  const d = (parsed.dynamics || '').toLowerCase();
  if (d.includes('погірш') || d.includes('worse'))  score -= 10;
  if (d.includes('покращ') || d.includes('better')) score += 5;
  if (parsed.surgeries && parsed.surgeries.length > 3) score -= 5;
  return Math.max(10, Math.min(100, score));
}

function buildAnswers(parsed) {
  const ans = [];
  if (parsed.complaint)          ans.push({ q: 'Скарга',             t: 'text',  a: parsed.complaint });
  if (parsed.onset)              ans.push({ q: 'Початок',            t: 'text',  a: parsed.onset });
  if (parsed.intensity)          ans.push({ q: 'Інтенсивність болю', t: 'scale', a: parsed.intensity.replace(/\/\d+/, '').trim() });
  if (parsed.character)          ans.push({ q: 'Характер',           t: 'text',  a: parsed.character });
  if (parsed.dynamics)           ans.push({ q: 'Динаміка',           t: 'text',  a: parsed.dynamics });
  if (parsed.symptoms.length)    ans.push({ q: 'Симптоми',           t: 'text',  a: parsed.symptoms.join(', ') });
  if (parsed.chronic.length)     ans.push({ q: 'Хронічні хвороби',   t: 'text',  a: parsed.chronic.join(', ') });
  if (parsed.surgeries)          ans.push({ q: 'Попередні операції', t: 'text',  a: parsed.surgeries });
  if (parsed.allergies.length)   ans.push({ q: 'Алергії',            t: 'text',  a: parsed.allergies.join(', ') });
  if (parsed.medications.length) ans.push({ q: 'Медикаменти',        t: 'text',  a: parsed.medications.join(', ') });
  if (parsed.lifestyle)          ans.push({ q: 'Спосіб життя',       t: 'text',  a: parsed.lifestyle });
  if (parsed.familyHistory)      ans.push({ q: 'Сімейний анамнез',   t: 'text',  a: parsed.familyHistory });
  return ans;
}

async function convertPatientToDashboard(patientData, doctorCode, summary, db) {
  const { name = '', phone = '', email = '' } = patientData;
  const dc = (doctorCode || '').toUpperCase();
  if (!dc) { console.warn('[converter] ⚠️  No doctorCode — skip'); return null; }

  // Використовуємо підколекцію doctors/{dc}/patients
  const col = db.collection('doctors').doc(dc).collection('patients');

  const parsed    = parseSummary(summary);
  const nameParts = name.trim().split(/\s+/);
  const now       = new Date().toISOString();
  const today     = new Date().toLocaleDateString('uk-UA');
  const incomingLastName = normalizeName(nameParts[0] || '');
  const incomingFullName = normalizeName(name);

  const surveyRecord = {
    name:  'Анамнез (міні-апп)',
    date:  today,
    dur:   '~5 хв',
    score: estimateScore(parsed),
    ans:   buildAnswers(parsed)
  };

  let existingDocId = null;
  const snap = await col.get();

  snap.forEach(doc => {
    if (existingDocId) return;
    const d = doc.data();
    const phoneMatch = phone && d.phone && d.phone === phone;
    const emailMatch = email && d.email && d.email === email;
    if (!phoneMatch && !emailMatch) return;
    const existingLastName = normalizeName(d.lastName || '');
    const existingFullName = normalizeName([d.lastName, d.firstName, d.middleName].filter(Boolean).join(' '));
    const nameMatch =
      (incomingLastName && existingLastName && incomingLastName === existingLastName) ||
      (incomingFullName && existingFullName && incomingFullName === existingFullName);
    if (nameMatch) {
      existingDocId = doc.id;
      console.log(`[converter] 🔍 Match: ${name} → doctors/${dc}/patients/${doc.id}`);
    } else {
      console.log(`[converter] ⚠️  Name mismatch: "${name}" vs "${d.lastName} ${d.firstName}" — creating new`);
    }
  });

  // ── ОНОВЛЕННЯ ────────────────────────────────────────────────
  if (existingDocId) {
    const existRef  = col.doc(existingDocId);
    const existSnap = await existRef.get();
    const existData = existSnap.data() || {};
    const surveys   = existData.surveys || [];
    const alreadyExists = surveys.some(s => s.date === surveyRecord.date && s.name === surveyRecord.name);
    if (!alreadyExists) {
      surveys.push(surveyRecord);
      const updateData = { surveys, updatedAt: now };
      if (parsed.chronic.length)     updateData.chronic = parsed.chronic;
      if (parsed.allergies.length)   updateData.allergy = parsed.allergies;
      if (parsed.medications.length) updateData.meds    = parsed.medications;
      await existRef.update(updateData);
      console.log(`[converter] ♻️  Updated patient: ${name} (${dc})`);
    } else {
      console.log(`[converter] ⏭  Survey already exists for: ${name}`);
    }
    return 'fb_' + existingDocId;
  }

  // ── СТВОРЕННЯ ────────────────────────────────────────────────
  const colorIdx = Math.floor(Math.random() * AVCOLORS.length);
  const notesParts = [];
  if (parsed.onset)         notesParts.push(`Початок: ${parsed.onset}`);
  if (parsed.character)     notesParts.push(`Характер: ${parsed.character}`);
  if (parsed.dynamics)      notesParts.push(`Динаміка: ${parsed.dynamics}`);
  if (parsed.surgeries)     notesParts.push(`Операції: ${parsed.surgeries}`);
  if (parsed.lifestyle)     notesParts.push(`Спосіб життя: ${parsed.lifestyle}`);
  if (parsed.familyHistory) notesParts.push(`Сімейний анамнез: ${parsed.familyHistory}`);

  const newPatient = {
    lastName:   nameParts[0] || '',
    firstName:  nameParts[1] || '',
    middleName: nameParts[2] || '',
    gender: '', birthDate: '', blood: '',
    phone, email, telegram: '',
    diag:    parsed.complaint || summary.slice(0, 100) || 'Анамнез отримано через міні-апп',
    chronic: parsed.chronic,
    allergy: parsed.allergies,
    meds:    parsed.medications,
    notes:   notesParts.join('. '),
    surveys:      [surveyRecord],
    chatSessions: [],
    reminders:    [],
    doctorCode:   dc,
    avColor:      AVCOLORS[colorIdx],
    source:       'mini-app',
    createdAt:    now,
    updatedAt:    now,
  };

  const docRef = await col.add(newPatient);
  console.log(`[converter] ✅ Created: doctors/${dc}/patients/${docRef.id}`);
  return 'fb_' + docRef.id;
}

module.exports = { convertPatientToDashboard };

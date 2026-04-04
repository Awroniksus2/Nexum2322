// migrate.js — запусти один раз: node migrate.js
// Переносить існуючих пацієнтів з колекції 'patients' в 'dashboard_patients'
require('dotenv').config();
const admin = require('firebase-admin');

let sa;
try {
  sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON.trim());
} catch(e) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT_JSON parse error:', e.message);
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const AVCOLORS = ['#c084fc','#34d399','#fb923c','#60a5fa','#f472b6','#a78bfa','#4ade80','#facc15','#f87171','#38bdf8'];

function parseSummary(summary) {
  if (!summary) return {};
  const result = { complaint:'', onset:'', intensity:'', dynamics:'', symptoms:[], chronic:[], allergies:[], medications:[] };
  const patterns = {
    complaint:   [/Скарга[:\s]+(.+)/i,              /Complaint[:\s]+(.+)/i],
    onset:       [/Початок[:\s]+(.+)/i,             /Onset[:\s]+(.+)/i],
    intensity:   [/Інтенсивність[:\s]+(.+)/i,       /Intensity[:\s]+(.+)/i],
    dynamics:    [/Динаміка[:\s]+(.+)/i,            /Dynamics[:\s]+(.+)/i],
    symptoms:    [/Симптоми[:\s]+(.+)/i,            /Symptoms[:\s]+(.+)/i],
    chronic:     [/Хронічні хвороби[:\s]+(.+)/i,   /Chronic conditions[:\s]+(.+)/i],
    allergies:   [/Алергії[:\s]+(.+)/i,             /Allergies[:\s]+(.+)/i],
    medications: [/Медикаменти[:\s]+(.+)/i,         /Medications[:\s]+(.+)/i],
  };
  for (const [field, rxList] of Object.entries(patterns)) {
    for (const rx of rxList) {
      const m = summary.match(rx);
      if (m) {
        const raw = m[1].trim();
        if (['symptoms','chronic','allergies','medications'].includes(field)) {
          const isEmpty = /^(немає|не виявлено|невідомо|none|unknown|no|—|--)$/i.test(raw);
          result[field] = isEmpty ? [] : raw.split(/[,;]+/).map(s=>s.trim()).filter(Boolean);
        } else {
          result[field] = raw;
        }
        break;
      }
    }
  }
  return result;
}

function estimateScore(parsed) {
  let score = 70;
  const im = (parsed.intensity||'').match(/(\d+)/);
  if (im) {
    const i = parseInt(im[1]);
    if (i >= 8) score -= 20; else if (i >= 6) score -= 10; else if (i >= 4) score -= 5;
  }
  if (parsed.chronic.length)     score -= parsed.chronic.length * 5;
  if (parsed.allergies.length)   score -= 5;
  if (parsed.symptoms.length > 2) score -= 10;
  const d = (parsed.dynamics||'').toLowerCase();
  if (d.includes('погірш')||d.includes('worse')) score -= 10;
  if (d.includes('покращ')||d.includes('better')) score += 5;
  return Math.max(10, Math.min(100, score));
}

function buildAnswers(parsed) {
  const ans = [];
  if (parsed.complaint)          ans.push({ q:'Скарга',             t:'text',  a:parsed.complaint });
  if (parsed.onset)              ans.push({ q:'Початок',            t:'text',  a:parsed.onset });
  if (parsed.intensity)          ans.push({ q:'Інтенсивність болю', t:'scale', a:parsed.intensity.replace(/\/\d+/,'').trim() });
  if (parsed.dynamics)           ans.push({ q:'Динаміка',           t:'text',  a:parsed.dynamics });
  if (parsed.symptoms.length)    ans.push({ q:'Симптоми',           t:'text',  a:parsed.symptoms.join(', ') });
  if (parsed.chronic.length)     ans.push({ q:'Хронічні хвороби',   t:'text',  a:parsed.chronic.join(', ') });
  if (parsed.allergies.length)   ans.push({ q:'Алергії',            t:'text',  a:parsed.allergies.join(', ') });
  if (parsed.medications.length) ans.push({ q:'Медикаменти',        t:'text',  a:parsed.medications.join(', ') });
  return ans;
}

async function migrate() {
  console.log('🚀 Starting migration...\n');

  const snap = await db.collection('patients').get();
  console.log(`Found ${snap.size} patients in 'patients' collection\n`);

  let created = 0, updated = 0, skipped = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const { name='', phone='', email='', doctorCode='', summary='', chatHistory=[], createdAt='' } = data;

    if (!doctorCode) { console.log(`⚠️  Skip (no doctorCode): ${name}`); skipped++; continue; }

    const upperCode = doctorCode.toUpperCase();
    const parsed    = parseSummary(summary);
    const nameParts = name.trim().split(/\s+/);

    const surveyRecord = {
      name:  'Анамнез (бот)',
      date:  createdAt ? new Date(createdAt).toLocaleDateString('uk-UA') : new Date().toLocaleDateString('uk-UA'),
      dur:   '~5 хв',
      score: estimateScore(parsed),
      ans:   buildAnswers(parsed)
    };

    // Перевіряємо чи є вже в dashboard_patients
    let existingId = null;
    if (phone || email) {
      const existing = await db.collection('dashboard_patients')
        .where('doctorCode','==', upperCode).get();
      existing.forEach(d => {
        const dd = d.data();
        if ((phone && dd.phone === phone) || (email && dd.email === email)) {
          existingId = d.id;
        }
      });
    }

    if (existingId) {
      // Додаємо опитування до існуючого
      const existDoc = await db.collection('dashboard_patients').doc(existingId).get();
      const existData = existDoc.data() || {};
      const surveys = existData.surveys || [];

      // Не дублюємо якщо вже є запис з тим самим createdAt
      const alreadyExists = surveys.some(s => s.date === surveyRecord.date && s.name === surveyRecord.name);
      if (!alreadyExists) {
        surveys.push(surveyRecord);
        await db.collection('dashboard_patients').doc(existingId).update({
          surveys, updatedAt: new Date().toISOString()
        });
        console.log(`♻️  Updated: ${name} (${upperCode})`);
        updated++;
      } else {
        console.log(`⏭  Already exists: ${name}`);
        skipped++;
      }
    } else {
      const colorIdx = Math.floor(Math.random() * AVCOLORS.length);
      await db.collection('dashboard_patients').add({
        lastName:   nameParts[0] || '',
        firstName:  nameParts[1] || '',
        middleName: nameParts[2] || '',
        gender: '', birthDate: '', blood: '',
        phone, email, telegram: '',
        diag:    parsed.complaint || summary.slice(0,100) || 'Анамнез отримано через бота',
        chronic: parsed.chronic,
        allergy: parsed.allergies,
        meds:    parsed.medications,
        notes:   [parsed.onset && `Початок: ${parsed.onset}`, parsed.dynamics && `Динаміка: ${parsed.dynamics}`].filter(Boolean).join('. '),
        surveys:   [surveyRecord],
        reminders: [],
        doctorCode: upperCode,
        avColor:    AVCOLORS[colorIdx],
        source:     'bot',
        createdAt:  createdAt || new Date().toISOString(),
        updatedAt:  new Date().toISOString()
      });
      console.log(`✅ Created: ${name} (${upperCode})`);
      created++;
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Created:  ${created}`);
  console.log(`♻️  Updated:  ${updated}`);
  console.log(`⏭  Skipped:  ${skipped}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log('\n🎉 Migration complete!');
  process.exit(0);
}

migrate().catch(e => { console.error('❌ Migration error:', e); process.exit(1); });

/**
 * ПАТЧ для services/server.js (Express проект)
 * ─────────────────────────────────────────────
 * Замін потрібно 2:
 *
 * 1. Імпорт — додати getSurveysByDoctorCode, saveSurveys
 * 2. Роут GET /api/surveys — замінити тіло
 * 3. Роут POST /api/surveys — замінити тіло
 *
 * Решта файлу — БЕЗ ЗМІН.
 */

// ════════════════════════════════════════════════════════════════
// ЗМІНА 1: рядок ~10 — оновити деструктуризацію імпорту
// ════════════════════════════════════════════════════════════════

// БУЛО:
const {
  getDb,
  isDoctorAllowed, isDoctorAllowedByPhone,
  saveDoctor, getDoctorByTelegramId, getDoctorByCode,
  searchDoctors, generateUniqueCode, savePatient,
  getPatientsByDoctorCode, savePatientRecord, deletePatientRecord
} = require('./services/firebase');

// СТАЛО:
const {
  getDb,
  isDoctorAllowed, isDoctorAllowedByPhone,
  saveDoctor, getDoctorByTelegramId, getDoctorByCode,
  searchDoctors, generateUniqueCode, savePatient,
  getPatientsByDoctorCode, savePatientRecord, deletePatientRecord,
  getSurveysByDoctorCode, saveSurveys          // ← НОВЕ
} = require('./services/firebase');


// ════════════════════════════════════════════════════════════════
// ЗМІНА 2: роут GET /api/surveys — замінити тіло функції
// ════════════════════════════════════════════════════════════════

// БУЛО:
app.get('/api/surveys', async function(req, res) {
  try {
    const { doctorCode } = req.query;
    if (!doctorCode) return res.status(400).json({ error: 'doctorCode required' });
    const snap = await getDb().collection('doctor_surveys')
      .where('doctorCode', '==', doctorCode.toUpperCase()).limit(1).get();
    if (snap.empty) return res.json({ surveys: null });
    const doc = snap.docs[0];
    const surveysData = doc.data().surveys || doc.data().data || null;
    res.json({ surveys: surveysData, fsId: doc.id });
  } catch (err) {
    console.error('GET surveys error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// СТАЛО:
app.get('/api/surveys', async function(req, res) {
  try {
    const { doctorCode } = req.query;
    if (!doctorCode) return res.status(400).json({ error: 'doctorCode required' });
    const result = await getSurveysByDoctorCode(doctorCode);
    res.json(result);
  } catch (err) {
    console.error('GET surveys error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ════════════════════════════════════════════════════════════════
// ЗМІНА 3: роут POST /api/surveys — замінити тіло функції
// ════════════════════════════════════════════════════════════════

// БУЛО:
app.post('/api/surveys', async function(req, res) {
  try {
    const { doctorCode, surveys, fsId } = req.body;
    if (!doctorCode || !surveys) return res.status(400).json({ error: 'doctorCode and surveys required' });
    const col = getDb().collection('doctor_surveys');
    if (fsId) {
      await col.doc(fsId).set({ doctorCode: doctorCode.toUpperCase(), surveys, updatedAt: new Date().toISOString() }, { merge: true });
      return res.json({ success: true, fsId });
    }
    const snap = await col.where('doctorCode', '==', doctorCode.toUpperCase()).limit(1).get();
    if (!snap.empty) {
      await snap.docs[0].ref.set({ surveys, updatedAt: new Date().toISOString() }, { merge: true });
      return res.json({ success: true, fsId: snap.docs[0].id });
    }
    const newDoc = await col.add({
      doctorCode: doctorCode.toUpperCase(),
      surveys,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    res.json({ success: true, fsId: newDoc.id });
  } catch (err) {
    console.error('POST surveys error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// СТАЛО:
app.post('/api/surveys', async function(req, res) {
  try {
    const { doctorCode, surveys, fsId } = req.body;
    if (!doctorCode || !surveys) return res.status(400).json({ error: 'doctorCode and surveys required' });
    const newFsId = await saveSurveys(doctorCode, surveys, fsId || null);
    res.json({ success: true, fsId: newFsId });
  } catch (err) {
    console.error('POST surveys error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

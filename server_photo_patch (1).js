// ═══════════════════════════════════════════════════════════════
// ПАТЧ ДЛЯ server.js — ДОДАВАННЯ ФОТО ЗАВАНТАЖЕННЯ
//
// 1. На самому початку файлу після require('dotenv').config()
//    додати:
//
//    const multer = require('multer');
//    const _upload = multer({
//      storage: multer.memoryStorage(),
//      limits: { fileSize: 10 * 1024 * 1024 } // 10MB
//    });
//
// 2. В рядку імпорту firebase додати uploadPhoto:
//    const { ..., uploadPhoto, addPatientPhoto } = require('./services/firebase');
//
// 3. Вставити новий endpoint ПЕРЕД рядком app.get('/', ...):
// ═══════════════════════════════════════════════════════════════

// ── POST /api/upload-photo ────────────────────────────────────
// Endpoint для завантаження фото пацієнта у Firebase Storage
// Вимагає: npm install multer
// Вимагає env: FIREBASE_STORAGE_BUCKET=your-project.appspot.com
app.post('/api/upload-photo', _upload.single('photo'), async function(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { doctorCode } = req.body;
    if (!doctorCode) return res.status(400).json({ error: 'doctorCode required' });

    if (!process.env.FIREBASE_STORAGE_BUCKET) {
      return res.status(500).json({ error: 'FIREBASE_STORAGE_BUCKET not configured in .env' });
    }

    const url = await uploadPhoto(req.file.buffer, req.file.mimetype, doctorCode);
    console.log('[upload-photo] ✅ Uploaded for', doctorCode, '→', url.slice(0, 60) + '...');
    res.json({ success: true, url });
  } catch (err) {
    console.error('[upload-photo] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// 4. У /api/submit після блоку де зберігаємо surveyResults
//    (після рядка з "surveyResults saved") додати:
//
//    // ── Зберігаємо URL фото до картки пацієнта ──
//    if (dashId && patientData.photos && patientData.photos.length) {
//      try {
//        await addPatientPhoto(doctorCode, dashId, patientData.photos);
//        console.log('[submit] ✅ photos saved:', patientData.photos.length);
//      } catch(e) {
//        console.error('[submit] photos save error:', e.message);
//      }
//    }
// ═══════════════════════════════════════════════════════════════

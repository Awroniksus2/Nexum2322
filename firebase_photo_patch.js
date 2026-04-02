// ═══════════════════════════════════════════════════════════════
// ПАТЧ ДЛЯ services/firebase.js — ФУНКЦІЇ ДЛЯ ФОТО
//
// Вставити ці дві функції ПЕРЕД рядком module.exports = { ... }
// і додати їх назви до exports
// ═══════════════════════════════════════════════════════════════

// ── Завантаження фото у Firebase Storage ─────────────────────
async function uploadPhoto(buffer, mimetype, doctorCode) {
  const bucket = admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET);
  const ext = (mimetype || 'image/jpeg').split('/')[1] || 'jpg';
  const filename = `patients/${doctorCode.toUpperCase()}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const file = bucket.file(filename);

  await file.save(buffer, {
    contentType: mimetype || 'image/jpeg',
    metadata: {
      cacheControl: 'public, max-age=31536000',
      doctorCode: doctorCode.toUpperCase()
    }
  });

  // Робимо файл публічним щоб лікар міг переглянути
  await file.makePublic();

  const url = `https://storage.googleapis.com/${bucket.name}/${filename}`;
  return url;
}

// ── Зберігаємо URL фото до картки пацієнта в Firestore ───────
async function addPatientPhoto(doctorCode, patientId, photoUrls) {
  const dc = doctorCode.toUpperCase();
  const docId = String(patientId).replace('fb_', '');

  const snap = await patientsCol(dc).doc(docId).get();
  if (!snap.exists) {
    console.warn('[addPatientPhoto] patient not found:', docId);
    return;
  }

  const existing = snap.data().photos || [];
  // Додаємо тільки нові URL (без дублів)
  const newUrls = Array.isArray(photoUrls) ? photoUrls : [photoUrls];
  const merged = [...existing, ...newUrls.filter(u => !existing.includes(u))];

  await patientsCol(dc).doc(docId).update({
    photos: merged,
    updatedAt: new Date().toISOString()
  });
}

// ═══════════════════════════════════════════════════════════════
// У module.exports додати:
//   uploadPhoto,
//   addPatientPhoto,
// ═══════════════════════════════════════════════════════════════

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
  patientsCol,
  surveysCol,
  doctorRef,
  // ── НОВІ ФУНКЦІЇ ──
  uploadPhoto,
  addPatientPhoto,
};

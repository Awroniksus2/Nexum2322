// services/patientConverter.js  —  оновлено для Supabase
// Замінює стару версію яка використовувала Firestore getDb() напряму

async function convertPatientToDashboard(patientData, doctorCode, summary, db, history) {
  // db тут — це Supabase client (з getDb())
  const dc = doctorCode.toUpperCase();
  const now = new Date().toISOString();

  const name = (patientData && patientData.name) || '';
  const phone = (patientData && patientData.phone) || '';
  const email = (patientData && patientData.email) || '';

  function normalizePhone(p) {
    return String(p || '').replace(/\D/g, '');
  }

  // Шукаємо існуючого пацієнта по телефону
  let existingId = null;
  if (phone) {
    const normPhone = normalizePhone(phone);
    const { data: found } = await db
      .from('patients')
      .select('id, phone')
      .eq('doctor_code', dc);
    if (found) {
      const match = found.find(p => normalizePhone(p.phone) === normPhone);
      if (match) existingId = match.id;
    }
  }

  if (existingId) {
    // Оновлюємо існуючого
    await db
      .from('patients')
      .update({ name, phone, email, updated_at: now })
      .eq('id', existingId);
    return 'sb_' + existingId;
  }

  // Створюємо нового
  const { data, error } = await db
    .from('patients')
    .insert({
      doctor_code: dc,
      name,
      phone,
      email,
      photos: [],
      chat_sessions: [],
      survey_results: [],
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();

  if (error) throw error;
  return 'sb_' + data.id;
}

module.exports = { convertPatientToDashboard };

/**
 * NEXUM — server_patch_moderator.js
 * ══════════════════════════════════════════════════════════════
 * Додати ці роути в server.js ПЕРЕД блоком "Static files"
 * (перед останнім блоком з fs.stat та serveStatic)
 *
 * Також додати в кінець об'єкту ROUTES:
 *   '/moderator': 'moderator.html',
 *   '/moderator.html': 'moderator.html',
 *   '/survey': 'survey_form.html',
 *   '/survey.html': 'survey_form.html',
 * ══════════════════════════════════════════════════════════════
 */

// ── POST /api/moderator/login ──────────────────────────────────
if (req.method === 'POST' && pn === '/api/moderator/login') {
  try {
    const { code, password } = await readBody(req);
    if (!code || !password) return jsonRes(res, 400, { ok: false, error: 'code and password required' });

    const c = code.trim().toUpperCase();
    const r = await supabaseFetch('GET',
      `moderators?code=eq.${encodeURIComponent(c)}&limit=1`);

    if (r.status !== 200 || !Array.isArray(r.body) || !r.body.length) {
      return jsonRes(res, 401, { ok: false });
    }
    const mod = r.body[0];
    if (mod.password !== password) return jsonRes(res, 401, { ok: false });

    jsonRes(res, 200, { ok: true, name: mod.name || '', clinic: mod.clinic || '', code: mod.code });
  } catch(e) { jsonRes(res, 500, { error: e.message }); }
  return;
}

// ── GET /api/moderator/doctors ─────────────────────────────────
// Повертає список лікарів для вибору в конструкторі
if (req.method === 'GET' && pn === '/api/moderator/doctors') {
  try {
    const r = await supabaseFetch('GET', 'registered_doctors?select=code,name,specialty&order=name.asc');
    if (r.status !== 200) return jsonRes(res, 500, { error: 'failed to load doctors' });
    jsonRes(res, 200, Array.isArray(r.body) ? r.body : []);
  } catch(e) { jsonRes(res, 500, { error: e.message }); }
  return;
}

// ── GET /api/moderator/surveys ────────────────────────────────
// Повертає опитування конкретного лікаря (щоб модер міг вибрати шаблон)
if (req.method === 'GET' && pn === '/api/moderator/surveys') {
  try {
    const { doctorCode } = qs;
    if (!doctorCode) return jsonRes(res, 400, { error: 'doctorCode required' });

    const r = await supabaseFetch('GET',
      `surveys?doctor_code=eq.${encodeURIComponent(doctorCode.toUpperCase())}&limit=1`);

    if (r.status !== 200 || !Array.isArray(r.body) || !r.body.length) {
      return jsonRes(res, 200, {});
    }
    jsonRes(res, 200, r.body[0].surveys_data || {});
  } catch(e) { jsonRes(res, 500, { error: e.message }); }
  return;
}

// ── POST /api/moderator/link/create ──────────────────────────
// Модер створює нове посилання для пацієнта
if (req.method === 'POST' && pn === '/api/moderator/link/create') {
  try {
    const body = await readBody(req);
    const { moderatorCode, doctorCode, surveyKey, surveyName, patientName, notes } = body;

    if (!moderatorCode || !doctorCode) {
      return jsonRes(res, 400, { error: 'moderatorCode and doctorCode required' });
    }

    const token = require('crypto').randomUUID();
    const record = {
      token,
      doctor_code:    doctorCode.toUpperCase(),
      moderator_code: moderatorCode.toUpperCase(),
      survey_key:     surveyKey  || '',
      survey_name:    surveyName || '',
      patient_name:   patientName || '',
      notes:          notes || '',
      status:         'pending',
      expires_at:     new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const r = await supabaseFetch('POST', 'survey_links', record);
    if (r.status !== 201 && r.status !== 200) {
      throw new Error('Create link failed: ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
    }

    jsonRes(res, 200, { success: true, token, link: token });
  } catch(e) { console.error('[link/create]', e.message); jsonRes(res, 500, { error: e.message }); }
  return;
}

// ── GET /api/moderator/links ──────────────────────────────────
// Список всіх посилань модератора
if (req.method === 'GET' && pn === '/api/moderator/links') {
  try {
    const { moderatorCode } = qs;
    if (!moderatorCode) return jsonRes(res, 400, { error: 'moderatorCode required' });

    const mc = moderatorCode.toUpperCase();
    const r = await supabaseFetch('GET',
      `survey_links?moderator_code=eq.${encodeURIComponent(mc)}&order=created_at.desc&limit=100`);

    if (r.status !== 200) throw new Error('Failed to load links: ' + r.status);
    jsonRes(res, 200, Array.isArray(r.body) ? r.body : []);
  } catch(e) { jsonRes(res, 500, { error: e.message }); }
  return;
}

// ── GET /api/survey/:token ────────────────────────────────────
// Пацієнт відкриває посилання — отримує дані опитування
if (req.method === 'GET' && pn.startsWith('/api/survey/') && !pn.endsWith('/submit')) {
  try {
    const token = decodeURIComponent(pn.replace('/api/survey/', ''));
    if (!token) return jsonRes(res, 400, { error: 'token required' });

    // Перевіряємо посилання
    const lr = await supabaseFetch('GET',
      `survey_links?token=eq.${encodeURIComponent(token)}&limit=1`);

    if (lr.status !== 200 || !Array.isArray(lr.body) || !lr.body.length) {
      return jsonRes(res, 404, { error: 'Посилання не знайдено або недійсне' });
    }

    const link = lr.body[0];

    if (link.status === 'completed') {
      return jsonRes(res, 200, { status: 'completed', message: 'Ви вже заповнили це опитування. Дякуємо!' });
    }

    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return jsonRes(res, 200, { status: 'expired', message: 'Термін дії посилання вийшов. Зверніться до клініки.' });
    }

    // Завантажуємо опитування лікаря
    let surveyQuestions = [];
    let surveyName = link.survey_name || 'Медичне опитування';

    if (link.doctor_code && link.survey_key) {
      const sr = await supabaseFetch('GET',
        `surveys?doctor_code=eq.${encodeURIComponent(link.doctor_code)}&limit=1`);
      if (sr.status === 200 && Array.isArray(sr.body) && sr.body.length) {
        const surveysData = sr.body[0].surveys_data || {};
        const surveyData  = surveysData[link.survey_key];
        if (surveyData && Array.isArray(surveyData.questions)) {
          surveyQuestions = surveyData.questions;
          surveyName = surveyData.name || surveyName;
        }
      }
    }

    // Завантажуємо ім'я лікаря
    let doctorName = '';
    const dr = await supabaseFetch('GET',
      `registered_doctors?code=eq.${encodeURIComponent(link.doctor_code)}&limit=1`);
    if (dr.status === 200 && Array.isArray(dr.body) && dr.body.length) {
      doctorName = dr.body[0].name || '';
    }

    jsonRes(res, 200, {
      status:      'active',
      token,
      surveyName,
      surveyKey:   link.survey_key,
      questions:   surveyQuestions,
      doctorCode:  link.doctor_code,
      doctorName,
      patientName: link.patient_name || '',
    });
  } catch(e) { console.error('[survey/get]', e.message); jsonRes(res, 500, { error: e.message }); }
  return;
}

// ── POST /api/survey/:token/submit ────────────────────────────
// Пацієнт відправляє анкету → створюється акаунт
if (req.method === 'POST' && pn.includes('/api/survey/') && pn.endsWith('/submit')) {
  try {
    const token = decodeURIComponent(pn.replace('/api/survey/', '').replace('/submit', ''));
    const body  = await readBody(req);

    // Перевіряємо посилання
    const lr = await supabaseFetch('GET',
      `survey_links?token=eq.${encodeURIComponent(token)}&limit=1`);

    if (lr.status !== 200 || !Array.isArray(lr.body) || !lr.body.length) {
      return jsonRes(res, 404, { error: 'Посилання не знайдено' });
    }

    const link = lr.body[0];
    if (link.status === 'completed') {
      return jsonRes(res, 200, { success: true, alreadyCompleted: true });
    }

    const now = new Date().toISOString();

    // Розбираємо відповіді
    const { firstName, lastName, phone, telegram, answers } = body;
    const dynamicAnswers = {};
    if (Array.isArray(answers)) {
      answers.forEach(a => { if (a.id) dynamicAnswers[a.id] = a.value; });
    }

    // Створюємо пацієнта
    const patientRecord = {
      doctor_code:     link.doctor_code,
      first_name:      firstName || '',
      last_name:       lastName  || '',
      phone:           phone     || '',
      telegram:        telegram  || '',
      diag:            '',
      dynamic_answers: dynamicAnswers,
      survey_key:      link.survey_key || '',
      created_at:      now,
      updated_at:      now,
    };

    const pr = await supabaseFetch('POST', 'patients', patientRecord);
    if (pr.status !== 201 && pr.status !== 200) {
      throw new Error('Patient create failed: ' + pr.status);
    }

    const createdPatient = Array.isArray(pr.body) ? pr.body[0] : pr.body;
    const patientId = createdPatient?.id || null;

    // Оновлюємо посилання — відмічаємо як completed
    await supabaseFetch('PATCH',
      `survey_links?token=eq.${encodeURIComponent(token)}`, {
        status:       'completed',
        patient_id:   patientId,
        completed_at: now,
      });

    jsonRes(res, 200, { success: true, patientId: patientId ? 'sb_' + patientId : null });
  } catch(e) { console.error('[survey/submit]', e.message); jsonRes(res, 500, { error: e.message }); }
  return;
}

// ── POST /api/moderator/assign ────────────────────────────────
// Модер призначає пацієнта лікарю (встановлює лікаря або переносить)
if (req.method === 'POST' && pn === '/api/moderator/assign') {
  try {
    const body = await readBody(req);
    const { moderatorCode, patientId, doctorCode, notes } = body;

    if (!moderatorCode || !patientId || !doctorCode) {
      return jsonRes(res, 400, { error: 'moderatorCode, patientId, doctorCode required' });
    }

    const rawId = String(patientId).replace('sb_', '');
    const r = await supabaseFetch('PATCH', `patients?id=eq.${rawId}`, {
      doctor_code: doctorCode.toUpperCase(),
      updated_at:  new Date().toISOString(),
    });

    if (r.status !== 200 && r.status !== 204) {
      throw new Error('Assign failed: ' + r.status);
    }

    jsonRes(res, 200, { success: true });
  } catch(e) { console.error('[assign]', e.message); jsonRes(res, 500, { error: e.message }); }
  return;
}

// ── DELETE /api/moderator/link/:token ─────────────────────────
if (req.method === 'DELETE' && pn.startsWith('/api/moderator/link/')) {
  try {
    const token = decodeURIComponent(pn.replace('/api/moderator/link/', ''));
    await supabaseFetch('DELETE', `survey_links?token=eq.${encodeURIComponent(token)}`);
    jsonRes(res, 200, { success: true });
  } catch(e) { jsonRes(res, 500, { error: e.message }); }
  return;
}

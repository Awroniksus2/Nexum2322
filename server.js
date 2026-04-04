const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
require('dotenv').config();

const { sendMessage } = require('./services/telegram');
const {
  getDb,
  saveDoctor, getDoctorByTelegramId, getDoctorByCode,
  searchDoctors, generateUniqueCode, savePatient,
  getPatientsByDoctorCode, savePatientRecord, deletePatientRecord,
  getSurveysByDoctorCode, saveSurveys,
  uploadPhoto, addPatientPhoto
} = require('./services/supabase');
const { convertPatientToDashboard } = require('./services/patientConverter');

const app = express();
const PORT = process.env.PORT || 3000;

const SITE_URL = (process.env.SITE_URL || 'https://nexum-site.onrender.com').replace(/\/$/, '');

// ── Multer: фото в пам'ять (макс 10MB) ───────────────────────
const _upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only images allowed'));
    }
    cb(null, true);
  }
});

app.use(cors());
app.use(express.json());

// ── Security headers ──────────────────────────────────────────
app.use(function(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', function(req, res) {
  res.json({ status: 'ok', project: 'Nexum' });
});

// ── GET /api/dashboard/patients ───────────────────────────────
app.get('/api/dashboard/patients', async function(req, res) {
  try {
    const { doctorCode } = req.query;
    if (!doctorCode) return res.status(400).json({ error: 'doctorCode required' });
    const patients = await getPatientsByDoctorCode(doctorCode);
    res.json(patients);
  } catch (err) {
    console.error('GET patients error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/dashboard/patients ──────────────────────────────
app.post('/api/dashboard/patients', async function(req, res) {
  try {
    const { doctorCode, patient } = req.body;
    if (!doctorCode || !patient) return res.status(400).json({ error: 'doctorCode and patient required' });
    const id = await savePatientRecord(doctorCode, patient);
    res.json({ success: true, id });
  } catch (err) {
    console.error('POST patient error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/dashboard/patients/:id ───────────────────────────
app.put('/api/dashboard/patients/:id', async function(req, res) {
  try {
    const { doctorCode, ...patientFields } = req.body;
    if (!doctorCode) return res.status(400).json({ error: 'doctorCode required' });
    const id = await savePatientRecord(doctorCode, { id: req.params.id, ...patientFields });
    res.json({ success: true, id });
  } catch (err) {
    console.error('PUT patient error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/dashboard/patients/:id ────────────────────────
app.delete('/api/dashboard/patients/:id', async function(req, res) {
  try {
    await deletePatientRecord(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE patient error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/surveys ──────────────────────────────────────────
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

// ── POST /api/surveys ─────────────────────────────────────────
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

// ── POST /api/upload-photo ────────────────────────────────────
app.post('/api/upload-photo', _upload.single('photo'), async function(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { doctorCode } = req.body;
    if (!doctorCode) return res.status(400).json({ error: 'doctorCode required' });

    const url = await uploadPhoto(req.file.buffer, req.file.mimetype, doctorCode);
    console.log('[upload-photo] ✅ doctorCode:', doctorCode, '| size:', req.file.size);
    res.json({ success: true, url });
  } catch (err) {
    console.error('[upload-photo] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// multer error handler
app.use(function(err, req, res, next) {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Max 10MB.' });
  }
  if (err) return res.status(400).json({ error: err.message });
  next();
});

// ── POST /api/ai/generate ─────────────────────────────────────
app.post('/api/ai/generate', async function(req, res) {
  try {
    const { model, max_tokens, system, messages } = req.body;
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.GROQ_API_KEY },
      body: JSON.stringify({
        model: model || 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: system }, ...messages],
        max_tokens: max_tokens || 1000,
        temperature: 0.7
      })
    });
    const data = await r.json();
    if (data.error) return res.status(500).json({ error: data.error });
    res.json({ content: [{ type: 'text', text: data.choices[0].message.content }] });
  } catch (err) {
    console.error('AI generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /bot/webhook ─────────────────────────────────────────
app.post('/bot/webhook', async function(req, res) {
  try {
    const { message, callback_query } = req.body;

    if (callback_query) {
      await fetch('https://api.telegram.org/bot' + (process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN) + '/answerCallbackQuery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callback_query.id })
      });
      return res.sendStatus(200);
    }

    if (!message) return res.sendStatus(200);

    const telegramId = message.from.id;
    const text = (message.text || '').trim();
    if (!app.locals.regState) app.locals.regState = {};
    const state = app.locals.regState;


    if (text === '/start') {
      const existing = await getDoctorByTelegramId(telegramId);
      if (existing) {
        await sendMessage(telegramId,
          '*' + existing.name + '*\n' + existing.specialty + '\n' + existing.hospital + ', ' + existing.city + '\n'
          + 'Email: ' + existing.email + '\n' + 'Код: `' + existing.code + '`\n\n'
          + '🔐 *Вхід у кабінет:*\n' + SITE_URL + '/login\n'
          + 'Код: `' + existing.code + '`\n' + 'Пароль: `' + (existing.password || 'зверніться до адміна') + '`\n\n'
          + '/update — оновити дані\n/mycode — показати дані входу');
      } else {
        await sendMessage(telegramId, 'Вітаю! Це система *Nexum*.\n\n/register — зареєструватися як лікар\n/mycode — мій код');
      }

   } else if (text === '/register') {
  const existing = await getDoctorByTelegramId(telegramId);
  if (existing) {
    await sendMessage(telegramId, 'Ви вже зареєстровані!\n\nКод: `' + existing.code + '`\nПароль: `' + (existing.password || 'зверніться до адміна') + '`\n\n🖥 Кабінет: ' + SITE_URL + '/login\n\n/update — оновити дані профілю');
    return res.sendStatus(200);
  }
  state[telegramId] = { step: 'name', phone: '' };
  await sendMessage(telegramId, '👋 Вітаємо в системі *Nexum*!\n\nВведіть ваше *повне ім\'я та прізвище*:');

    } else if (state[telegramId] && state[telegramId].step === 'name') {
      state[telegramId].name = text;
      state[telegramId].step = 'city';
      await sendMessage(telegramId, 'Ім\'я: *' + text + '*\n\nВведіть ваше *місто*:');

    } else if (state[telegramId] && state[telegramId].step === 'city') {
      state[telegramId].city = text;
      state[telegramId].step = 'hospital';
      await sendMessage(telegramId, 'Місто: *' + text + '*\n\nВведіть назву *лікарні або клініки*:');

    } else if (state[telegramId] && state[telegramId].step === 'hospital') {
      state[telegramId].hospital = text;
      state[telegramId].step = 'specialty';
      await sendMessage(telegramId, 'Лікарня: *' + text + '*\n\nВведіть вашу *спеціальність*:\n_(наприклад: Терапевт, Кардіолог, Хірург, Педіатр...)_');

    } else if (state[telegramId] && state[telegramId].step === 'specialty') {
      state[telegramId].specialty = text;
      state[telegramId].step = 'email';
      await sendMessage(telegramId, 'Спеціальність: *' + text + '*\n\nВведіть ваш *email* для отримання звітів:');

    } else if (state[telegramId] && state[telegramId].step === 'email') {
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
      if (!emailOk) { await sendMessage(telegramId, 'Невірний формат email. Спробуйте ще раз:'); return res.sendStatus(200); }
    const { name, city, hospital, specialty } = state[telegramId];
delete state[telegramId];
const code = await generateUniqueCode();
const password = await saveDoctor(telegramId, { name, city, hospital, specialty, email: text, code });
      await fetch('https://api.telegram.org/bot' + (process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN) + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegramId,
          text: '✅ Реєстрацію завершено!\n\n*' + name + '*\n' + specialty + ' · ' + hospital + '\n' + city + '\n\n━━━━━━━━━━━━━━━━\n🔑 Код: `' + code + '`\n🔒 Пароль: `' + password + '`\n━━━━━━━━━━━━━━━━\n\n🖥 Ваш кабінет:\n' + SITE_URL + '/login\n\n_Збережіть ці дані — вони потрібні для входу на сайті._',
          parse_mode: 'Markdown',
          reply_markup: { remove_keyboard: true }
        })
      });

    } else if (text === '/mycode') {
      const doctor = await getDoctorByTelegramId(telegramId);
      if (doctor) {
        await sendMessage(telegramId, '🔑 Код: `' + doctor.code + '`\n🔒 Пароль: `' + (doctor.password || 'зверніться до адміна') + '`\n\n🖥 Кабінет: ' + SITE_URL + '/login');
      } else {
        await sendMessage(telegramId, 'Ви не зареєстровані. Напишіть /register');
      }

    } else if (text === '/update') {
      const existing = await getDoctorByTelegramId(telegramId);
      if (!existing) { await sendMessage(telegramId, 'Ви не зареєстровані. Напишіть /register'); return res.sendStatus(200); }
      state[telegramId] = { step: 'name' };
      await sendMessage(telegramId, 'Введіть нове *ім\'я та прізвище*:');
    }

    res.sendStatus(200);
  } catch(err) {
    console.error('Webhook error:', err.message);
    res.sendStatus(200);
  }
});

app.get('/api/doctors/search', async function(req, res) {
  try {
    const results = await searchDoctors(req.query.q, req.query.code);
    res.json(results);
  } catch(err) { console.error('Search error:', err.message); res.json([]); }
});

// ── Groq helper ───────────────────────────────────────────────
async function callGroq(messages, maxTokens) {
  const maxRetries = 3;
  const delays = [6000, 12000, 20000];
  for (var attempt = 0; attempt < maxRetries; attempt++) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.GROQ_API_KEY },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages, max_tokens: maxTokens || 600, temperature: 0.7 })
    });
    const data = await r.json();
    if (data.error && data.error.code === 'rate_limit_exceeded') {
      if (attempt < maxRetries - 1) {
        console.warn('[Groq] Rate limit, retry ' + (attempt + 1) + ' after ' + delays[attempt] + 'ms');
        await new Promise(function(resolve) { setTimeout(resolve, delays[attempt]); });
        continue;
      }
    }
    return data;
  }
}

async function getDoctorSurvey(doctorCode, surveyKey) {
  try {
    if (!doctorCode) return null;
    const { surveys: raw, fsId } = await getSurveysByDoctorCode(doctorCode);
    if (!raw) { console.log('[getDoctorSurvey] no surveys for', doctorCode); return null; }

    let data = raw;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch(e) { return null; }
    }

    let depth = 0;
    while (data && data.surveys && typeof data.surveys === 'object' && depth < 5) {
      data = data.surveys; depth++;
    }

    if (Array.isArray(data) && data.length > 0) {
      return { questions: data, aiMode: false, surveyName: 'Survey', surveyKey: 'default' };
    }

    if (data && !Array.isArray(data) && Array.isArray(data.questions) && data.questions.length > 0) {
      return { questions: data.questions, aiMode: data.aiMode === true, surveyName: 'Survey', surveyKey: 'default' };
    }

    if (data && !Array.isArray(data) && typeof data === 'object' && !data.questions) {
      const defaultKey = data._defaultKey || null;
      const entries = Object.entries(data).filter(([k, s]) =>
        k !== '_defaultKey' && s && typeof s === 'object' &&
        typeof s.name === 'string' && Array.isArray(s.questions)
      );
      if (!entries.length) return null;

      let chosen = surveyKey ? entries.find(([k]) => k === surveyKey) : null;
      if (!chosen && defaultKey) chosen = entries.find(([k]) => k === defaultKey);
      if (!chosen) chosen = entries.find(([k, s]) => s.questions.length > 0 && !s.aiMode);
      if (!chosen) chosen = entries.find(([k, s]) => s.questions.length > 0);
      if (!chosen) return null;

      const [chosenKey, chosenSurvey] = chosen;
      const aiMode = chosenSurvey.aiMode === true;
      return { questions: chosenSurvey.questions, aiMode, surveyName: chosenSurvey.name, surveyKey: chosenKey };
    }
    return null;
  } catch(e) {
    console.error('[getDoctorSurvey] error:', e.message);
    return null;
  }
}

function extractQuestionText(q) {
  if (typeof q === 'string') return q;
  if (typeof q === 'object' && q !== null) {
    return q.question || q.text || q.label || q.title || String(q);
  }
  return String(q);
}

// ── POST /api/chat ────────────────────────────────────────────
app.post('/api/chat', async function(req, res) {
  try {
    const { history, patientName, lang, doctorCode } = req.body;
    if (!doctorCode) return res.status(400).json({ error: 'doctorCode required' });
    if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY not set' });

    const isEn = lang === 'en';
    const surveyKey = req.body.surveyKey || null;
    const surveyData = await getDoctorSurvey(doctorCode, surveyKey);
    const hasCustomQuestions = surveyData && Array.isArray(surveyData.questions) && surveyData.questions.length > 0;

    if (hasCustomQuestions) {
      const questions = surveyData.questions;
      const total = questions.length;
      const userAnswers = (history || []).filter(m =>
        m.role === 'user' && !m.content.startsWith('[ФОТО:') && !m.content.startsWith('[PHOTO:')
      );
      const answerCount = userAnswers.length;

      if (answerCount >= total && surveyData.aiMode === true) {
        const summaryLines = questions.map((q, i) => {
          const answer = userAnswers[i] ? userAnswers[i].content : '—';
          return extractQuestionText(q) + ': ' + answer;
        });
        const systemPrompt = isEn
          ? `Nexum. Patient ${patientName}. Answers:\n${summaryLines.join('\n')}\nAsk 1-2 short follow-ups. After answers write SURVEY_COMPLETE\n---SUMMARY---\n${summaryLines.join('\n')}\n---END---`
          : `Nexum. Пацієнт ${patientName}. Відповіді:\n${summaryLines.join('\n')}\nЗадай 1-2 уточнення одним реченням. Після відповідей пиши ОПИТУВАННЯ_ЗАВЕРШЕНО\n---ПІДСУМОК---\n${summaryLines.join('\n')}\n---КІНЕЦЬ---`;
        const messages = [{ role: 'system', content: systemPrompt }, ...history];
        const data = await callGroq(messages, 120);
        if (!data || data.error) return res.status(500).json({ error: 'Groq error' });
        const reply = data.choices[0].message.content;
        const isDone = reply.includes('ОПИТУВАННЯ_ЗАВЕРШЕНО') || reply.includes('SURVEY_COMPLETE');
        return res.json({ reply, isDone });
      }

      if (answerCount >= total && surveyData.aiMode !== true) {
        const summaryLines = questions.map((q, i) => {
          const answer = userAnswers[i] ? userAnswers[i].content : '—';
          return extractQuestionText(q) + ': ' + answer;
        });
        const doneMarker   = isEn ? 'SURVEY_COMPLETE'  : 'ОПИТУВАННЯ_ЗАВЕРШЕНО';
        const summaryStart = isEn ? '---SUMMARY---'    : '---ПІДСУМОК---';
        const summaryEnd   = isEn ? '---END---'        : '---КІНЕЦЬ---';
        const reply = doneMarker + '\n\n' + summaryStart + '\n' + summaryLines.join('\n') + '\n' + summaryEnd;
        return res.json({ reply, isDone: true });
      }

      function getQuestionMeta(q) {
        const type = (q && q.type) || 'text';
        const options = (type === 'choice' || type === 'multi') ? (q.options || []) : null;
        return { type, options };
      }

      const currentQ = questions[answerCount];
      const { type: qType, options: qOptions } = getQuestionMeta(currentQ);

      if (answerCount === 0) {
        const q0text = extractQuestionText(questions[0]);
        const greeting = isEn
          ? `Hello, ${patientName}! 👋 I am Nexum, your medical assistant.\n\n${q0text}`
          : `Вітаю, ${patientName}! 👋 Я — Nexum, ваш медичний асистент.\n\n${q0text}`;
        return res.json({ reply: greeting, isDone: false, options: qOptions, questionType: qType });
      }

      const nextQuestion = extractQuestionText(currentQ);
      return res.json({ reply: nextQuestion, isDone: false, options: qOptions, questionType: qType });
    }

    let systemPrompt;
    if (surveyData && surveyData.aiMode === true &&
        Array.isArray(surveyData.questions) && surveyData.questions.length > 0) {
      const questions = surveyData.questions;
      const total = questions.length;
      const questionsList   = questions.map((q, i) => `${i + 1}. ${extractQuestionText(q)}`).join('\n');
      const summaryTemplate = questions.map(q => `${extractQuestionText(q)}: [відповідь]`).join('\n');
      systemPrompt = isEn
        ? `You are Nexum, a medical assistant interviewing patient ${patientName}. The patient's name is already known — do NOT ask it.\nYOUR TASK: Ask exactly these ${total} questions, one by one, strictly in order:\n${questionsList}\nRULES: Ask ONLY these questions. One question per message. Max 2 sentences. When all ${total} questions answered, output exactly: SURVEY_COMPLETE\nThen:\n---SUMMARY---\n${questions.map(q => `${extractQuestionText(q)}: [patient answer]`).join('\n')}\n---END---`
        : `Ти — медичний асистент Nexum. Проводиш опитування пацієнта ${patientName}. Ім'я вже відоме — НЕ питай його.\nТВОЄ ЗАВДАННЯ: Задати рівно ${total} питань по черзі:\n${questionsList}\nПРАВИЛА: Тільки ці питання. Одне за раз. Макс 2 речення. Коли всі ${total} питань отримали відповідь: ОПИТУВАННЯ_ЗАВЕРШЕНО\nПотім:\n---ПІДСУМОК---\n${summaryTemplate}\n---КІНЕЦЬ---`;
    } else {
      systemPrompt = isEn
        ? `You are Nexum, a medical assistant collecting anamnesis from patient ${patientName} in English. Do NOT ask their name.\nEach reply = max 1 short acknowledgement (2-4 words) + 1 question. 2 sentences total MAX.\nFLOW: complaint → onset → intensity(1-10) → adapt per symptom.\nAfter 12+ exchanges write SURVEY_COMPLETE then:\n---SUMMARY---\nComplaint: ...\nOnset: ...\nIntensity: .../10\nCharacter: ...\nDynamics: ...\nSymptoms: ...\nChronic conditions: ...\nPrevious surgeries: ...\nMedications: ...\nAllergies: ...\nLifestyle: ...\nFamily history: ...\n---END---`
        : `Ти — медичний асистент Nexum. Збираєш анамнез пацієнта ${patientName} українською. НЕ питай ім'я.\nКожна відповідь = макс 1 коротке визнання (2-4 слова) + 1 питання. 2 речення МАКСИМУМ.\nПОСЛІДОВНІСТЬ: скарга → коли почалось → інтенсивність(1-10) → адаптуй по симптому.\nПісля 12+ обмінів напиши ОПИТУВАННЯ_ЗАВЕРШЕНО та:\n---ПІДСУМОК---\nСкарга: ...\nПочаток: ...\nІнтенсивність: .../10\nХарактер: ...\nДинаміка: ...\nСимптоми: ...\nХронічні хвороби: ...\nПопередні операції: ...\nМедикаменти: ...\nАлергії: ...\nСпосіб життя: ...\nСімейний анамнез: ...\n---КІНЕЦЬ---`;
    }

    const messages = [{ role: 'system', content: systemPrompt }];
    if (!history || history.length === 0) {
      messages.push({ role: 'user', content: isEn ? 'Start the survey' : 'Почни опитування' });
    } else {
      history.forEach(m => messages.push(m));
    }

    const data = await callGroq(messages, 150);
    if (!data || data.error) {
      const errMsg = (data && data.error && data.error.message) || 'Groq API error';
      if (errMsg.includes('rate_limit')) {
        return res.status(429).json({ error: isEn
          ? 'The service is temporarily busy. Please wait 10 seconds and try again.'
          : 'Сервіс тимчасово перевантажений. Зачекайте 10 секунд і спробуйте ще раз.' });
      }
      return res.status(500).json({ error: errMsg });
    }
    const reply = data.choices[0].message.content;
    const isDone = reply.includes('ОПИТУВАННЯ_ЗАВЕРШЕНО') || reply.includes('SURVEY_COMPLETE');
    res.json({ reply, isDone });

  } catch(err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/submit ──────────────────────────────────────────
app.post('/api/submit', async function(req, res) {
  try {
    const { history, summary, doctorCode, patientData, lang, surveyKey } = req.body;
    if (!doctorCode) return res.status(400).json({ error: 'Не вказано код лікаря' });
    const doctor = await getDoctorByCode(doctorCode.trim().toUpperCase());
    if (!doctor) return res.status(404).json({ error: 'Лікаря не знайдено' });

    const patientName = (patientData && patientData.name) || 'Пацієнт';

    // ── Збираємо результати опитування ──
    let surveyResults = null;
    try {
      const surveyData = await getDoctorSurvey(doctorCode, surveyKey || null);
      if (surveyData && Array.isArray(surveyData.questions) && surveyData.questions.length > 0) {
        const questions = surveyData.questions;
        const userAnswers = (history || []).filter(m =>
          m.role === 'user' && !m.content.startsWith('[ФОТО:') && !m.content.startsWith('[PHOTO:')
        );
        let answers;

        if (!surveyData.aiMode) {
          answers = questions.map((q, i) => ({
            question: extractQuestionText(q),
            answer: userAnswers[i] ? userAnswers[i].content : '—',
            type: q.type || 'text',
          }));
        } else {
          const parsed = {};
          (summary || '').replace(/---[^-\n]*---/g, '\n').split('\n').forEach(line => {
            const m = line.match(/^([^:]+):\s*(.+)$/);
            if (m) parsed[m[1].trim().toLowerCase()] = m[2].trim();
          });
          answers = questions.map(q => {
            const qText = extractQuestionText(q);
            const key = qText.replace(/[?:]/g, '').trim().toLowerCase();
            const found = parsed[key]
              || Object.entries(parsed).find(([k]) => k.includes(key.slice(0, 12)))?.[1]
              || '—';
            return { question: qText, answer: found, type: q.type || 'text' };
          });
        }

        surveyResults = {
          surveyKey: surveyData.surveyKey || surveyKey || 'default',
          surveyName: surveyData.surveyName || 'Опитування',
          completedAt: new Date().toISOString(),
          answers,
        };
      }
    } catch(e) {
      console.error('[submit] surveyResults error:', e.message);
    }

    // ── Конвертуємо в картку пацієнта ──
    let dashId = null;
    try {
      dashId = await convertPatientToDashboard(patientData, doctorCode, summary, getDb(), history);
      console.log('✅ Dashboard patient:', dashId);
    } catch(e) {
      console.error('⚠️ Dashboard convert failed:', e.message);
    }

    // ── Зберігаємо результати опитування у patient.survey_results ──
    if (dashId && surveyResults) {
      try {
        const db = getDb();
        const docId = dashId.replace('sb_', '');
        const { data: snap } = await db
          .from('patients')
          .select('survey_results')
          .eq('id', docId)
          .single();
        const existing = (snap && snap.survey_results) || [];
        const alreadyExists = existing.some(r => r.completedAt === surveyResults.completedAt);
        if (!alreadyExists) {
          await db
            .from('patients')
            .update({
              survey_results: [...existing, surveyResults],
              updated_at: new Date().toISOString(),
            })
            .eq('id', docId);
          console.log('[submit] ✅ surveyResults saved:', docId);
        }
      } catch(e) {
        console.error('[submit] surveyResults save error:', e.message);
      }
    }

    // ── Зберігаємо фото пацієнта ──
    const photos = patientData && Array.isArray(patientData.photos) ? patientData.photos : [];
    if (dashId && photos.length > 0) {
      try {
        await addPatientPhoto(doctorCode, dashId, photos);
        console.log('[submit] ✅ photos saved:', photos.length, 'for', dashId);
      } catch(e) {
        console.error('[submit] photos save error:', e.message);
      }
    }

    // ── Зберігаємо сесію ──
    try {
      await savePatient(patientData, doctorCode, summary, history, dashId);
      console.log('✅ Patient log saved:', patientName);
    } catch(e) {
      console.error('⚠️ savePatient failed:', e.message);
    }

    res.json({ success: true, doctorName: doctor.name });

  } catch(err) {
    console.error('Submit error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, function() {
  console.log('Nexum bot running on port ' + PORT);
  if ((process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN) && process.env.RENDER_EXTERNAL_URL) {
    const webhookUrl = process.env.RENDER_EXTERNAL_URL + '/bot/webhook';
    fetch('https://api.telegram.org/bot' + (process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN) + '/setWebhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl })
    })
      .then(r => r.json())
      .then(d => console.log('Webhook set:', d.ok ? '✅ ' + webhookUrl : '❌ ' + d.description))
      .catch(e => console.error('Webhook setup error:', e.message));
  }
});

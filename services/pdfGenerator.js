const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('fontkit');

async function loadFont(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Font load failed: ' + url);
  return Buffer.from(await res.arrayBuffer());
}

async function generateAnamnesisPDF(data) {
  const patientName    = data.patientName    || '';
  const summary        = data.summary        || '';
  const date           = data.date           || '';
  const doctorName     = data.doctorName     || '';
  const doctorCity     = data.doctorCity     || '';
  const doctorHospital = data.doctorHospital || '';
  const lang           = data.lang           || 'uk';
  const isEn           = lang === 'en';

  // ── Translations ─────────────────────────────────────────────
  const L = isEn ? {
    subtitle:         'Medical assistant',
    header_title:     'PATIENT ANAMNESIS',
    date_label:       'Date: ',
    doctor_label:     'DOCTOR',
    patient_label:    'PATIENT',
    date_short:       'Date: ',
    sec_complaint:    'MAIN COMPLAINT',
    row_complaint:    'Chief complaint',
    row_onset:        'Symptom onset',
    row_character:    'Pain character',
    row_dynamics:     'Dynamics',
    row_symptoms:     'Associated symptoms',
    pain_label:       'Pain intensity',
    no_pain:          'No pain',
    unbearable:       'Unbearable',
    sec_history:      'MEDICAL HISTORY',
    row_chronic:      'Chronic conditions',
    row_operations:   'Previous surgeries / traumas',
    row_meds:         'Current medications',
    row_allergies:    'Allergies & intolerances',
    row_lifestyle:    'Lifestyle (sleep, diet, stress)',
    row_family:       'Family anamnesis',
    sec_doctor:       'FOR DOCTOR  (filled by doctor)',
    row_diagnosis:    'Preliminary diagnosis',
    row_prescription: 'Prescriptions & recommendations',
    row_next:         'Next appointment',
    row_sick_leave:   'Sick leave',
    sig_patient:      'Patient signature:',
    sig_doctor:       'Doctor signature:',
    consent:          'CONSENT: By signing this document, the patient confirms the accuracy of the information provided and consents to its processing.',
    footer:           'This document was generated automatically by Nexum AI. The doctor may make corrections before signing.'
  } : {
    subtitle:         'Медичний асистент',
    header_title:     'АНАМНЕЗ ПАЦІЄНТА',
    date_label:       'Дата: ',
    doctor_label:     'ЛІКАР',
    patient_label:    'ПАЦІЄНТ',
    date_short:       'Дата: ',
    sec_complaint:    'ОСНОВНА СКАРГА',
    row_complaint:    'Головна скарга',
    row_onset:        'Початок симптомів',
    row_character:    'Характер болю',
    row_dynamics:     'Динаміка стану',
    row_symptoms:     'Супутні симптоми',
    pain_label:       'Інтенсивність болю',
    no_pain:          'Немає болю',
    unbearable:       'Нестерпно',
    sec_history:      'АНАМНЕЗ ЖИТТЯ',
    row_chronic:      'Хронічні захворювання',
    row_operations:   'Попередні операції / травми',
    row_meds:         'Поточні медикаменти',
    row_allergies:    'Алергії та непереносимість',
    row_lifestyle:    'Спосіб життя (сон, харчування, стрес)',
    row_family:       'Сімейний анамнез',
    sec_doctor:       'ДЛЯ ЛІКАРЯ  (заповнює лікар)',
    row_diagnosis:    'Попередній діагноз',
    row_prescription: 'Призначення та рекомендації',
    row_next:         'Наступний прийом',
    row_sick_leave:   'Лікарняний лист',
    sig_patient:      'Підпис пацієнта:',
    sig_doctor:       'Підпис лікаря:',
    consent:          'ЗГОДА: Підписуючи документ, пацієнт підтверджує достовірність наданої інформації та надає згоду на її обробку.',
    footer:           'Документ сформовано автоматично системою Nexum AI. Лікар може внести корективи перед підписанням.'
  };

  // ── Parse summary ─────────────────────────────────────────────
  const parsed = parseSummary(summary);

  // Підтримка кількох варіантів ключів що генерує бот
  function get(ukKeys, enKey) {
    const keys = Array.isArray(ukKeys) ? ukKeys : [ukKeys];
    if (isEn && enKey) {
      const v = parsed[enKey.toLowerCase()];
      if (v) return v;
    }
    for (const k of keys) {
      const v = parsed[k.toLowerCase()];
      if (v) return v;
    }
    return '';
  }

  const complaint  = get(['скарга', 'головна скарга'],                         'complaint');
  const onset      = get(['початок', 'початок симптомів'],                      'onset');
  const character  = get(['характер', 'характер болю'],                         'character');
  const dynamics   = get(['динаміка', 'динаміка стану'],                        'dynamics');
  const symptoms   = get(['симптоми', 'супутні симптоми', 'додаткові симптоми'],'symptoms');
  const chronic    = get(['хронічні хвороби', 'хронічні захворювання', 'хронічні'], 'chronic conditions');
  const operations = get(['попередні операції', 'операції', 'травми'],           'operations');
  const meds       = get(['медикаменти', 'ліки', 'препарати'],                  'medications');
  const allergies  = get(['алергії', 'алергія'],                                'allergies');
  const lifestyle  = get(['спосіб життя', 'стиль життя'],                       'lifestyle');
  const family     = get(['сімейний анамнез', 'сімейна історія'],               'family anamnesis');

  const ivRaw  = get(['інтенсивність', 'інтенсивність болю'], 'intensity');
  const ivMatch = ivRaw.match(/\d+/);
  const iv     = ivMatch ? ivMatch[0] : '0';
  const nv     = Math.min(parseInt(iv) || 0, 10);

  // ── Fonts ─────────────────────────────────────────────────────
  const regularBytes = await loadFont(
    'https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts/hinted/ttf/NotoSans/NotoSans-Regular.ttf'
  );
  const boldBytes = await loadFont(
    'https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts/hinted/ttf/NotoSans/NotoSans-Bold.ttf'
  );

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const fr = await pdfDoc.embedFont(regularBytes);
  const fb = await pdfDoc.embedFont(boldBytes);

  const page = pdfDoc.addPage([595, 842]);
  const W = 595, H = 842, M = 28, IW = W - M * 2;

  const dark   = rgb(0.05, 0.07, 0.10);
  const accent = rgb(0.15, 0.65, 0.95);
  const white  = rgb(1, 1, 1);
  const gray   = rgb(0.45, 0.45, 0.45);
  const lgray  = rgb(0.70, 0.70, 0.70);
  const border = rgb(0.88, 0.88, 0.88);
  const bgRow  = rgb(0.99, 0.99, 0.99);
  const labBg  = rgb(0.93, 0.94, 0.96);
  const labBg2 = rgb(0.90, 0.93, 0.97);

  // ── Safe drawText ─────────────────────────────────────────────
  function dt(text, x, yy, font, size, color) {
    try {
      page.drawText(String(text || ''), { x, y: yy, font, size, color });
    } catch(e) { /* skip unencodable chars */ }
  }

  // ── Word wrap ─────────────────────────────────────────────────
  function wrapText(text, font, size, maxW) {
    const words = String(text || '').split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      let tw = maxW + 1;
      try { tw = font.widthOfTextAtSize(test, size); } catch(e) {}
      if (tw > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  // ── HEADER ────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: H - 72, width: W, height: 72, color: dark });
  page.drawRectangle({ x: M, y: H - 60, width: 4, height: 36, color: accent });
  dt('NEXUM',            M + 12, H - 36, fb, 20, white);
  dt(L.subtitle,         M + 12, H - 52, fr,  8, lgray);
  dt(L.header_title,     W - M - 148, H - 28, fb,  9, accent);
  dt(L.date_label + date,W - M - 148, H - 42, fr,  8, lgray);
  dt('RPT-' + Date.now().toString().slice(-6), W - M - 148, H - 55, fr, 7, gray);

  let y = H - 86;

  // ── DOCTOR + PATIENT CARDS ────────────────────────────────────
  const cardW = (IW - 10) / 2;
  const cardH = 56;

  page.drawRectangle({ x: M, y: y - cardH, width: cardW, height: cardH, color: rgb(0.97, 0.97, 0.97) });
  page.drawRectangle({ x: M, y: y - 2,     width: cardW, height: 2,      color: accent });
  dt(L.doctor_label,             M + 10, y - 14, fb,  7, accent);
  dt(doctorName.substring(0,40), M + 10, y - 26, fb,  9, dark);
  dt(doctorHospital.substring(0,40), M + 10, y - 38, fr, 8, gray);
  dt(doctorCity.substring(0,40), M + 10, y - 50, fr,  8, gray);

  const px = M + cardW + 10;
  page.drawRectangle({ x: px, y: y - cardH, width: cardW, height: cardH, color: rgb(0.97, 0.97, 0.97) });
  page.drawRectangle({ x: px, y: y - 2,     width: cardW, height: 2,      color: accent });
  dt(L.patient_label,              px + 10, y - 14, fb,  7, accent);
  dt(patientName.substring(0, 40), px + 10, y - 26, fb,  9, dark);
  dt(L.date_short + date.split(',')[0], px + 10, y - 38, fr, 8, gray);

  y = y - cardH - 14;

  // ── HELPERS ───────────────────────────────────────────────────
  const LABEL_W = 148;

  function section(title) {
    y -= 6;
    page.drawRectangle({ x: M, y: y - 20, width: IW, height: 22, color: dark });
    page.drawRectangle({ x: M, y: y - 20, width: 3,  height: 22, color: accent });
    dt(title, M + 10, y - 13, fb, 8, accent);
    y -= 22;
  }

  function row(label, value, bg) {
    const lBg   = bg || labBg;
    const maxW  = IW - LABEL_W - 16;
    const lines = wrapText(value, fr, 9, maxW);
    const rowH  = Math.max(26, lines.length * 13 + 12);

    page.drawRectangle({ x: M, y: y - rowH, width: IW,     height: rowH, color: bgRow });
    page.drawLine({ start: { x: M, y }, end: { x: M + IW, y }, thickness: 0.4, color: border });
    page.drawRectangle({ x: M, y: y - rowH, width: LABEL_W, height: rowH, color: lBg });
    page.drawLine({ start: { x: M + LABEL_W, y }, end: { x: M + LABEL_W, y: y - rowH }, thickness: 0.4, color: border });
    dt(label, M + 8, y - rowH / 2 - 3, fb, 7.5, rgb(0.30, 0.30, 0.35));
    lines.forEach(function(line, i) {
      dt(line, M + LABEL_W + 8, y - 14 - i * 13, fr, 9, dark);
    });
    y -= rowH;
  }

  function emptyField(label, height) {
    page.drawRectangle({ x: M, y: y - height, width: IW,     height: height, color: bgRow });
    page.drawLine({ start: { x: M, y }, end: { x: M + IW, y }, thickness: 0.4, color: border });
    page.drawRectangle({ x: M, y: y - height, width: LABEL_W, height: height, color: labBg });
    page.drawLine({ start: { x: M + LABEL_W, y }, end: { x: M + LABEL_W, y: y - height }, thickness: 0.4, color: border });
    dt(label, M + 8, y - height / 2 - 3, fb, 7.5, rgb(0.30, 0.30, 0.35));
    y -= height;
  }

  // ════════════════════════════════════════════════════════════
  //  SECTION 1 — ОСНОВНА СКАРГА
  // ════════════════════════════════════════════════════════════
  section(L.sec_complaint);
  row(L.row_complaint, complaint);
  row(L.row_onset,     onset);
  row(L.row_character, character);   // ← характер болю
  row(L.row_dynamics,  dynamics);
  row(L.row_symptoms,  symptoms);

  // ── PAIN SCALE ────────────────────────────────────────────────
  y -= 6;
  const scH = 52;
  page.drawRectangle({ x: M, y: y - scH, width: IW, height: scH, color: bgRow });
  page.drawLine({ start: { x: M, y }, end: { x: M + IW, y }, thickness: 0.4, color: border });
  dt(L.pain_label, M + 8, y - 13, fb, 7.5, gray);

  const badgeColor = nv >= 7 ? rgb(0.85, 0.15, 0.15) : (nv >= 4 ? accent : rgb(0.25, 0.70, 0.35));
  page.drawRectangle({ x: M + 8, y: y - 33, width: 34, height: 16, color: badgeColor });
  dt(iv + '/10', M + 11, y - 27, fb, 8, white);

  const cellW = (IW - 54) / 10;
  for (var i = 1; i <= 10; i++) {
    const cx = M + 48 + (i - 1) * (cellW + 1.5);
    const active = i <= nv;
    const cellColor = active ? (nv >= 7 ? rgb(0.85, 0.15, 0.15) : accent) : rgb(0.91, 0.91, 0.91);
    page.drawRectangle({ x: cx, y: y - 35, width: cellW, height: 20, color: cellColor });
    dt(String(i), cx + cellW / 2 - (i < 10 ? 3 : 5), y - 29, fb, 7.5, active ? white : lgray);
  }
  dt(L.no_pain,    M + 48, y - 47, fr, 6, lgray);
  dt(L.unbearable, M + 48 + 9 * (cellW + 1.5) + 2, y - 47, fr, 6, lgray);
  y -= scH + 14;

  // ════════════════════════════════════════════════════════════
  //  SECTION 2 — АНАМНЕЗ ЖИТТЯ
  // ════════════════════════════════════════════════════════════
  section(L.sec_history);
  row(L.row_chronic,    chronic,    labBg2);
  row(L.row_operations, operations, labBg2);  // ← операції / травми
  row(L.row_meds,       meds,       labBg2);
  row(L.row_allergies,  allergies,  labBg2);
  row(L.row_lifestyle,  lifestyle,  labBg2);  // ← спосіб життя
  row(L.row_family,     family,     labBg2);  // ← сімейний анамнез

  y -= 6;

  // ════════════════════════════════════════════════════════════
  //  SECTION 3 — ДЛЯ ЛІКАРЯ
  // ════════════════════════════════════════════════════════════
  section(L.sec_doctor);
  emptyField(L.row_diagnosis,    38);
  emptyField(L.row_prescription, 48);

  const hw = IW / 2;
  page.drawRectangle({ x: M, y: y - 28, width: IW, height: 28, color: bgRow });
  page.drawLine({ start: { x: M, y }, end: { x: M + IW, y }, thickness: 0.4, color: border });
  dt(L.row_next, M + 8, y - 14, fb, 7.5, gray);
  page.drawLine({ start: { x: M + hw, y }, end: { x: M + hw, y: y - 28 }, thickness: 0.4, color: border });
  dt(L.row_sick_leave, M + hw + 8, y - 14, fb, 7.5, gray);
  y -= 32;

  // ── SIGNATURES ────────────────────────────────────────────────
  y -= 10;
  page.drawLine({ start: { x: M, y }, end: { x: M + IW, y }, thickness: 0.6, color: border });
  y -= 20;

  const sw = IW / 2 - 10;
  dt(L.sig_patient, M, y, fb, 8, gray);
  page.drawLine({ start: { x: M, y: y - 18 }, end: { x: M + sw, y: y - 18 }, thickness: 0.5, color: border });
  dt(patientName, M, y - 30, fr, 7.5, lgray);
  dt(L.date_short + date.split(',')[0], M, y - 41, fr, 7, lgray);

  const sx2 = M + IW / 2 + 10;
  dt(L.sig_doctor, sx2, y, fb, 8, gray);
  page.drawLine({ start: { x: sx2, y: y - 18 }, end: { x: M + IW, y: y - 18 }, thickness: 0.5, color: border });
  dt(doctorName, sx2, y - 30, fr, 7.5, lgray);
  y -= 50;

  // ── CONSENT ───────────────────────────────────────────────────
  if (y > 32) {
    page.drawRectangle({ x: M, y: y - 22, width: IW, height: 24, color: rgb(1.0, 0.97, 0.88) });
    page.drawRectangle({ x: M, y: y - 22, width: 3,  height: 24, color: rgb(0.85, 0.65, 0.10) });
    const consentLines = wrapText(L.consent, fr, 6.5, IW - 20);
    consentLines.forEach(function(l, i) {
      dt(l, M + 9, y - 13 - i * 9, fr, 6.5, rgb(0.45, 0.35, 0.05));
    });
  }

  // ── FOOTER ────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: 0, width: W, height: 26, color: dark });
  const footerLines = wrapText(L.footer, fr, 6.5, W - M * 2 - 64);
  footerLines.forEach(function(l, i) {
    dt(l, M, 16 - i * 8, fr, 6.5, rgb(0.5, 0.5, 0.5));
  });
  dt('nexum.app', W - M - 52, 9, fb, 7.5, accent);

  return await pdfDoc.save();
}

// ── parseSummary ──────────────────────────────────────────────
// Обробляє обидва формати що повертає AI:
//   1. Рядок з \n між полями  (стандарт)
//   2. Всі поля в один рядок через пробіл (буває при стислих відповідях)
function parseSummary(summary) {
  const r = {};
  if (!summary) return r;

  // Прибираємо службові маркери
  var text = summary
    .replace(/---[^-\n]*---/g, '\n')
    .replace(/ОПИТУВАННЯ_ЗАВЕРШЕНО|SURVEY_COMPLETE|AI SUMMARY/gi, '')
    .trim();

  // Список відомих ключів (uk + en) — дозволяє розбити рядок навіть без \n
  var knownKeys = [
    'Скарга', 'Головна скарга',
    'Початок симптомів', 'Початок',
    'Інтенсивність болю', 'Інтенсивність',
    'Характер болю', 'Характер',
    'Динаміка стану', 'Динаміка',
    'Супутні симптоми', 'Додаткові симптоми', 'Симптоми',
    'Хронічні захворювання', 'Хронічні хвороби', 'Хронічні',
    'Попередні операції', 'Операції', 'Травми',
    'Поточні медикаменти', 'Медикаменти', 'Препарати', 'Ліки',
    'Алергії та непереносимість', 'Алергії', 'Алергія',
    'Спосіб життя', 'Стиль життя',
    'Сімейний анамнез', 'Сімейна історія',
    // EN
    'Complaint', 'Chief complaint',
    'Symptom onset', 'Onset',
    'Pain intensity', 'Intensity',
    'Pain character', 'Character',
    'Dynamics',
    'Associated symptoms', 'Symptoms',
    'Chronic conditions',
    'Previous surgeries', 'Operations',
    'Current medications', 'Medications',
    'Allergies',
    'Lifestyle',
    'Family anamnesis', 'Family history',
  ];

  // Якщо в тексті нема \n — розбиваємо по відомих ключах
  if (text.indexOf('\n') === -1) {
    var keyPattern = knownKeys
      .map(function(k) { return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); })
      .sort(function(a, b) { return b.length - a.length; }) // довші першими
      .join('|');
    text = text.replace(new RegExp('(' + keyPattern + ')\\s*:', 'gi'), '\n$1:');
  }

  // Парсимо рядок за рядком
  text.split('\n').forEach(function(line) {
    line = line.trim();
    if (!line) return;
    var m = line.match(/^([^:]+):\s*(.+)$/);
    if (m) r[m[1].trim().toLowerCase()] = m[2].trim();
  });

  return r;
}

module.exports = { generateAnamnesisPDF };

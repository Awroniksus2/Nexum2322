/**
 * docxGenerator.js — NEXUM (розширена версія)
 * Два розділи анамнезу + думка асистента, відповідає новому формату server.js
 */

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign,
  Footer, PageNumber, PageBreak
} = require('docx');

// ── parseSummary ──────────────────────────────────────────
function parseSummary(summary) {
  const r = {};
  if (!summary) return r;

  var text = summary
    .replace(/---[^-\n]*---/g, '\n')
    .replace(/ОПИТУВАННЯ_ЗАВЕРШЕНО|SURVEY_COMPLETE/gi, '')
    .trim();

  // Якщо немає переносів рядків — розбиваємо по відомих ключах
  const knownKeys = [
    'Основна скарга','Локалізація','Характер болю/відчуття','Інтенсивність',
    'Іррадіація','Тривалість епізоду','Частота','Початок','Можливий тригер',
    'Динаміка','Що полегшує','Що посилює','Супутні симптоми',
    'Попередні схожі епізоди','Хронічні захворювання',
    'Перенесені операції/госпіталізації','Постійні медикаменти','Алергії',
    'Спадковість','Шкідливі звички','Фізична активність','Робота',
    'Попередня думка асистента',
    // EN
    'Complaint','Location','Pain character','Intensity','Radiation',
    'Episode duration','Frequency','Onset','Possible trigger','Dynamics',
    'Relieved by','Worsened by','Associated symptoms','Previous episodes',
    'Chronic conditions','Previous surgeries','Current medications','Allergies',
    'Family history','Smoking','Physical activity','Occupation','Clinical summary',
  ];

  if (text.indexOf('\n') === -1) {
    const pattern = knownKeys
      .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .sort((a, b) => b.length - a.length)
      .join('|');
    text = text.replace(new RegExp('(' + pattern + ')\\s*:', 'gi'), '\n$1:');
  }

  text.split('\n').forEach(line => {
    line = line.trim();
    if (!line) return;
    const m = line.match(/^([^:]+):\s*(.+)$/);
    if (m) r[m[1].trim().toLowerCase()] = m[2].trim();
  });

  return r;
}

function g(parsed, isEn, ukKeys, enKey) {
  const keys = Array.isArray(ukKeys) ? ukKeys : [ukKeys];
  if (isEn && enKey) {
    const v = parsed[enKey.toLowerCase()];
    if (v) return v;
  }
  for (const k of keys) {
    const v = parsed[k.toLowerCase()];
    if (v) return v;
  }
  return '—';
}

// ── Border helpers ────────────────────────────────────────
const bSingle = (color = 'DDDDDD', sz = 4) => ({ style: BorderStyle.SINGLE, size: sz, color });
const bNone   = () => ({ style: BorderStyle.NONE, size: 0, color: 'FFFFFF' });
const allBorders = (color, sz) => { const b = bSingle(color, sz); return { top: b, bottom: b, left: b, right: b }; };
const noBorders  = () => { const b = bNone(); return { top: b, bottom: b, left: b, right: b }; };

// ── Cell factory ──────────────────────────────────────────
function mkCell(children, { width, bg, borders: brd, vAlign, marginL, marginR, marginT, marginB } = {}) {
  return new TableCell({
    width: width !== undefined ? { size: width, type: WidthType.DXA } : undefined,
    shading: bg ? { fill: bg, type: ShadingType.CLEAR } : undefined,
    borders: brd || allBorders('DDDDDD'),
    verticalAlign: vAlign || VerticalAlign.CENTER,
    margins: { top: marginT || 80, bottom: marginB || 80, left: marginL || 120, right: marginR || 120 },
    children: Array.isArray(children) ? children : [children],
  });
}

// ── Text + Paragraph helpers ──────────────────────────────
function txt(text, opts = {}) {
  return new TextRun({ text: String(text || ''), font: 'Arial', ...opts });
}

function mkPara(runs, { align, spaceBefore, spaceAfter } = {}) {
  const runArr = Array.isArray(runs) ? runs : [runs];
  return new Paragraph({
    alignment: align || AlignmentType.LEFT,
    spacing: { before: spaceBefore || 0, after: spaceAfter || 0 },
    children: runArr.map(r => {
      if (r instanceof TextRun) return r;
      return new TextRun({ text: r.text !== undefined ? r.text : r, bold: r.bold || false,
        size: r.size || 20, color: r.color || '111111', font: 'Arial', italics: r.italics || false });
    }),
  });
}

const sp = (n = 1) => Array.from({ length: n }, () =>
  new Paragraph({ spacing: { before: 0, after: 0 }, children: [txt('')] })
);

// ── Section header ────────────────────────────────────────
function sectionHeader(title, totalW, bgColor) {
  const bg = bgColor || '0B0F14';
  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: [6, totalW - 6],
    rows: [new TableRow({ children: [
      mkCell(mkPara(''), { width: 6, bg: '1EA4D8', borders: noBorders(), marginL: 0, marginR: 0 }),
      mkCell(
        mkPara([txt(title, { bold: true, size: 18, color: '1EA4D8' })]),
        { width: totalW - 6, bg, borders: noBorders() }
      ),
    ]})],
  });
}

// ── Data row (label | value) ──────────────────────────────
function dataRow(label, value, labelW, valueW, labelBg) {
  return new TableRow({ children: [
    mkCell(
      mkPara([txt(label, { bold: true, size: 18, color: '303040' })]),
      { width: labelW, bg: labelBg || 'EEEEF2', borders: allBorders('DDDDDD') }
    ),
    mkCell(
      mkPara([txt(value || '—', { size: 19, color: '111111' })]),
      { width: valueW, bg: 'FAFAFA', borders: allBorders('DDDDDD') }
    ),
  ]});
}

// ── Empty row for doctor section ──────────────────────────
function emptyRows(label, labelW, valueW, count) {
  return Array.from({ length: count }, (_, i) =>
    new TableRow({
      height: { value: 400, rule: 'atLeast' },
      children: [
        mkCell(
          mkPara([txt(i === 0 ? label : '', { bold: true, size: 18, color: '303040' })]),
          { width: labelW, bg: 'EEEEF2', borders: allBorders('DDDDDD') }
        ),
        mkCell(mkPara(''), { width: valueW, bg: 'FAFAFA', borders: allBorders('DDDDDD') }),
      ],
    })
  );
}

// ── AI summary row (special bg) ───────────────────────────
function aiSummaryRow(label, value, totalW) {
  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: [totalW],
    rows: [
      new TableRow({ children: [
        mkCell(
          mkPara([txt(label, { bold: true, size: 18, color: '6644AA' })]),
          { width: totalW, bg: 'EDE8FA', borders: allBorders('C0B0EE'), marginT: 100, marginB: 60 }
        ),
      ]}),
      new TableRow({ children: [
        mkCell(
          mkPara([txt(value || '—', { size: 19, color: '222222', italics: false })]),
          { width: totalW, bg: 'F7F4FF', borders: allBorders('C0B0EE'), marginT: 120, marginB: 120, marginL: 160 }
        ),
      ]}),
    ],
  });
}

// ── Pain scale ────────────────────────────────────────────
function painScaleRow(rawValue, label, totalW) {
  const match = String(rawValue || '0').match(/\d+/);
  const nv = Math.min(parseInt(match ? match[0] : '0') || 0, 10);
  const cellW = Math.floor((totalW - 220) / 10);
  const painCells = [];
  const badgeColor = nv >= 7 ? 'CC2222' : (nv >= 4 ? '1EA4D8' : '28AA55');
  painCells.push(mkCell(
    mkPara([txt(nv + '/10', { bold: true, size: 17, color: 'FFFFFF' })], { align: AlignmentType.CENTER }),
    { width: 220, bg: badgeColor, borders: allBorders(badgeColor) }
  ));
  for (let i = 1; i <= 10; i++) {
    const active = i <= nv;
    const bg = active ? (nv >= 7 ? 'CC2222' : '1EA4D8') : 'E5E5E5';
    const textColor = active ? 'FFFFFF' : '999999';
    painCells.push(mkCell(
      mkPara([txt(String(i), { bold: true, size: 16, color: textColor })], { align: AlignmentType.CENTER }),
      { width: cellW, bg, borders: allBorders(bg) }
    ));
  }
  const scaleTable = new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: [220, ...Array(10).fill(cellW)],
    rows: [new TableRow({ children: painCells })],
  });
  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: [totalW],
    rows: [new TableRow({ children: [
      mkCell([
        mkPara([txt(label, { bold: true, size: 17, color: '555555' })], { spaceAfter: 80 }),
        scaleTable,
        mkPara([
          txt('Немає болю  ', { size: 14, color: 'AAAAAA', italics: true }),
          txt('                                                                 ', { size: 14 }),
          txt('  Нестерпно', { size: 14, color: 'AAAAAA', italics: true }),
        ], { spaceBefore: 60 }),
      ], { width: totalW, bg: 'FAFAFA', borders: allBorders('DDDDDD'), marginT: 120, marginB: 120 }),
    ]})],
  });
}

// ── MAIN ─────────────────────────────────────────────────
async function generateAnamnesisDocx(data) {
  const {
    patientName = '', summary = '', date = '',
    doctorName = '', doctorCity = '', doctorHospital = '',
    lang = 'uk'
  } = data;

  const isEn  = lang === 'en';
  const parsed = parseSummary(summary);
  const get    = (ukKeys, enKey) => g(parsed, isEn, ukKeys, enKey);

  const L = isEn ? {
    subtitle:    'Medical assistant',
    title:       'PATIENT ANAMNESIS',
    dateLabel:   'Date:',
    doctor:      'DOCTOR',
    patient:     'PATIENT',
    // Section 1
    sec1:        'MAIN COMPLAINT',
    fComplaint:  'Chief complaint',
    fLocation:   'Location',
    fCharacter:  'Pain character',
    fPain:       'Pain intensity',
    fRadiation:  'Radiation',
    fDuration:   'Episode duration',
    fFrequency:  'Frequency',
    // Section 2
    sec2:        'HISTORY OF PRESENT ILLNESS',
    fOnset:      'Onset',
    fTrigger:    'Possible trigger',
    fDynamics:   'Dynamics',
    fRelieved:   'Relieved by',
    fWorsened:   'Worsened by',
    fSymptoms:   'Associated symptoms',
    fPrevEp:     'Previous similar episodes',
    // Section 3
    sec3:        'PAST MEDICAL HISTORY',
    fChronic:    'Chronic conditions',
    fOps:        'Surgeries / hospitalizations',
    fMeds:       'Current medications',
    fAllergies:  'Allergies & intolerances',
    fFamily:     'Family history',
    fSmoking:    'Smoking / alcohol',
    fActivity:   'Physical activity',
    fWork:       'Occupation',
    // Section 4 AI
    sec4:        'ASSISTANT\'S PRELIMINARY ASSESSMENT',
    fAi:         'Clinical summary',
    // Section 5
    sec5:        'FOR DOCTOR  (filled by doctor)',
    fDiagnosis:  'Preliminary diagnosis',
    fPrescription:'Prescriptions & recommendations',
    fNext:       'Next appointment',
    fSickLeave:  'Sick leave',
    sigPat:      'Patient signature:',
    sigDoc:      'Doctor signature:',
    consent:     'CONSENT: By signing this document, the patient confirms accuracy of the information and consents to its processing.',
    footer:      'Document generated automatically by Nexum AI. The doctor may make corrections before signing.  |  nexum.app',
  } : {
    subtitle:    'Медичний асистент',
    title:       'АНАМНЕЗ ПАЦІЄНТА',
    dateLabel:   'Дата:',
    doctor:      'ЛІКАР',
    patient:     'ПАЦІЄНТ',
    // Section 1
    sec1:        'СКАРГИ',
    fComplaint:  'Основна скарга',
    fLocation:   'Локалізація',
    fCharacter:  'Характер болю/відчуття',
    fPain:       'Інтенсивність болю',
    fRadiation:  'Іррадіація',
    fDuration:   'Тривалість епізоду',
    fFrequency:  'Частота',
    // Section 2
    sec2:        'АНАМНЕЗ ЗАХВОРЮВАННЯ',
    fOnset:      'Початок',
    fTrigger:    'Можливий тригер',
    fDynamics:   'Динаміка',
    fRelieved:   'Що полегшує',
    fWorsened:   'Що посилює',
    fSymptoms:   'Супутні симптоми',
    fPrevEp:     'Попередні схожі епізоди',
    // Section 3
    sec3:        'АНАМНЕЗ ЖИТТЯ',
    fChronic:    'Хронічні захворювання',
    fOps:        'Операції / госпіталізації',
    fMeds:       'Постійні медикаменти',
    fAllergies:  'Алергії та непереносимість',
    fFamily:     'Спадковість',
    fSmoking:    'Куріння / алкоголь',
    fActivity:   'Фізична активність',
    fWork:       'Робота',
    // Section 4 AI
    sec4:        'ПОПЕРЕДНЯ ДУМКА АСИСТЕНТА',
    fAi:         'Клінічне резюме',
    // Section 5
    sec5:        'ДЛЯ ЛІКАРЯ  (заповнює лікар)',
    fDiagnosis:  'Попередній діагноз',
    fPrescription:'Призначення та рекомендації',
    fNext:       'Наступний прийом',
    fSickLeave:  'Лікарняний лист',
    sigPat:      'Підпис пацієнта:',
    sigDoc:      'Підпис лікаря:',
    consent:     'ЗГОДА: Підписуючи документ, пацієнт підтверджує достовірність наданої інформації та надає згоду на її обробку.',
    footer:      'Документ сформовано автоматично системою Nexum AI. Лікар може внести корективи перед підписанням.  |  nexum.app',
  };

  const TW  = 9360; // A4 content width DXA
  const LW  = 2800;
  const VW  = TW - LW;
  const HW  = TW / 2 - 60;
  const rptNum   = 'RPT-' + Date.now().toString().slice(-6);
  const dateShort = (date.split(',')[0] || date).trim();

  // ── Values ────────────────────────────────────────────────
  const complaint    = get(['основна скарга', 'скарга'],                        'complaint');
  const location     = get(['локалізація'],                                      'location');
  const character    = get(['характер болю/відчуття', 'характер болю', 'характер'], 'character');
  const radiation    = get(['іррадіація'],                                       'radiation');
  const duration     = get(['тривалість епізоду', 'тривалість'],                'duration');
  const frequency    = get(['частота'],                                          'frequency');
  const onset        = get(['початок'],                                          'onset');
  const trigger      = get(['можливий тригер', 'тригер'],                       'trigger');
  const dynamics     = get(['динаміка'],                                         'dynamics');
  const relieved     = get(['що полегшує'],                                      'relieved by');
  const worsened     = get(['що посилює'],                                       'worsened by');
  const symptoms     = get(['супутні симптоми', 'симптоми'],                    'associated symptoms');
  const prevEpisodes = get(['попередні схожі епізоди', 'попередні епізоди'],    'previous episodes');
  const chronic      = get(['хронічні захворювання', 'хронічні хвороби'],       'chronic conditions');
  const operations   = get(['перенесені операції/госпіталізації', 'операції/госпіталізації', 'операції'], 'previous surgeries');
  const meds         = get(['постійні медикаменти', 'медикаменти'],             'current medications');
  const allergies    = get(['алергії'],                                          'allergies');
  const family       = get(['спадковість', 'сімейний анамнез'],                 'family history');
  const smoking      = get(['шкідливі звички'],                                  'smoking');
  const activity     = get(['фізична активність'],                               'physical activity');
  const work         = get(['робота'],                                            'occupation');
  const aiSummary    = get(['попередня думка асистента', 'клінічне резюме'],     'clinical summary');

  const painRaw = get(['інтенсивність', 'інтенсивність болю'], 'intensity');

  // ── 1. HEADER ─────────────────────────────────────────────
  const headerTable = new Table({
    width: { size: TW, type: WidthType.DXA },
    columnWidths: [TW / 2, TW / 2],
    rows: [new TableRow({ children: [
      mkCell([
        mkPara([txt('NEXUM', { bold: true, size: 32, color: '1EA4D8' })], { spaceAfter: 40 }),
        mkPara([txt(L.subtitle, { size: 16, color: '888888' })]),
      ], { width: TW / 2, bg: '0B0F14', borders: noBorders(), marginT: 160, marginB: 160, marginL: 200 }),
      mkCell([
        mkPara([txt(L.title, { bold: true, size: 22, color: '1EA4D8' })], { align: AlignmentType.RIGHT, spaceAfter: 60 }),
        mkPara([txt(L.dateLabel + ' ' + date, { size: 16, color: 'AAAAAA' })], { align: AlignmentType.RIGHT, spaceAfter: 30 }),
        mkPara([txt(rptNum, { size: 14, color: '666666' })], { align: AlignmentType.RIGHT }),
      ], { width: TW / 2, bg: '0B0F14', borders: noBorders(), marginT: 160, marginB: 160, marginR: 200 }),
    ]})],
  });

  // ── 2. CARDS ──────────────────────────────────────────────
  const cardsTable = new Table({
    width: { size: TW, type: WidthType.DXA },
    columnWidths: [HW, HW],
    rows: [new TableRow({ children: [
      mkCell([
        mkPara([txt(L.doctor, { bold: true, size: 16, color: '1EA4D8' })], { spaceAfter: 60 }),
        mkPara([txt(doctorName, { bold: true, size: 20, color: '111111' })], { spaceAfter: 40 }),
        mkPara([txt(doctorHospital, { size: 18, color: '666666' })], { spaceAfter: 20 }),
        mkPara([txt(doctorCity, { size: 18, color: '666666' })]),
      ], { width: HW, bg: 'F6F6F6',
        borders: { top: bSingle('1EA4D8', 8), bottom: bSingle('DDDDDD'), left: bSingle('DDDDDD'), right: bSingle('DDDDDD') },
        marginT: 120, marginB: 120, marginL: 160,
      }),
      mkCell([
        mkPara([txt(L.patient, { bold: true, size: 16, color: '1EA4D8' })], { spaceAfter: 60 }),
        mkPara([txt(patientName, { bold: true, size: 20, color: '111111' })], { spaceAfter: 40 }),
        mkPara([txt(L.dateLabel + ' ' + dateShort, { size: 18, color: '666666' })]),
      ], { width: HW, bg: 'F6F6F6',
        borders: { top: bSingle('1EA4D8', 8), bottom: bSingle('DDDDDD'), left: bSingle('DDDDDD'), right: bSingle('DDDDDD') },
        marginT: 120, marginB: 120, marginL: 160,
      }),
    ]})],
  });

  // ── 3. SECTION 1 — СКАРГИ ─────────────────────────────────
  const complaintsTable = new Table({
    width: { size: TW, type: WidthType.DXA },
    columnWidths: [LW, VW],
    rows: [
      dataRow(L.fComplaint, complaint,  LW, VW),
      dataRow(L.fLocation,  location,   LW, VW),
      dataRow(L.fCharacter, character,  LW, VW),
      dataRow(L.fRadiation, radiation,  LW, VW),
      dataRow(L.fDuration,  duration,   LW, VW),
      dataRow(L.fFrequency, frequency,  LW, VW),
    ],
  });

  const painScale = painScaleRow(painRaw, L.fPain, TW);

  // ── 4. SECTION 2 — АНАМНЕЗ ЗАХВОРЮВАННЯ ───────────────────
  const anamnesisTable = new Table({
    width: { size: TW, type: WidthType.DXA },
    columnWidths: [LW, VW],
    rows: [
      dataRow(L.fOnset,    onset,        LW, VW, 'E8EDF5'),
      dataRow(L.fTrigger,  trigger,      LW, VW, 'E8EDF5'),
      dataRow(L.fDynamics, dynamics,     LW, VW, 'E8EDF5'),
      dataRow(L.fRelieved, relieved,     LW, VW, 'E8EDF5'),
      dataRow(L.fWorsened, worsened,     LW, VW, 'E8EDF5'),
      dataRow(L.fSymptoms, symptoms,     LW, VW, 'E8EDF5'),
      dataRow(L.fPrevEp,   prevEpisodes, LW, VW, 'E8EDF5'),
    ],
  });

  // ── 5. SECTION 3 — АНАМНЕЗ ЖИТТЯ ─────────────────────────
  const historyTable = new Table({
    width: { size: TW, type: WidthType.DXA },
    columnWidths: [LW, VW],
    rows: [
      dataRow(L.fChronic,   chronic,    LW, VW, 'E8F0E8'),
      dataRow(L.fOps,       operations, LW, VW, 'E8F0E8'),
      dataRow(L.fMeds,      meds,       LW, VW, 'E8F0E8'),
      dataRow(L.fAllergies, allergies,  LW, VW, 'E8F0E8'),
      dataRow(L.fFamily,    family,     LW, VW, 'E8F0E8'),
      dataRow(L.fSmoking,   smoking,    LW, VW, 'E8F0E8'),
      dataRow(L.fActivity,  activity,   LW, VW, 'E8F0E8'),
      dataRow(L.fWork,      work,       LW, VW, 'E8F0E8'),
    ],
  });

  // ── 6. SECTION 4 — ДУМКА АСИСТЕНТА ───────────────────────
  const aiBlock = aiSummaryRow(L.fAi, aiSummary, TW);

  // ── 7. SECTION 5 — ДЛЯ ЛІКАРЯ ────────────────────────────
  const doctorTable = new Table({
    width: { size: TW, type: WidthType.DXA },
    columnWidths: [LW, VW],
    rows: [
      ...emptyRows(L.fDiagnosis,    LW, VW, 3),
      ...emptyRows(L.fPrescription, LW, VW, 4),
    ],
  });

  const hw2 = TW / 2;
  const bottomDoctorTable = new Table({
    width: { size: TW, type: WidthType.DXA },
    columnWidths: [hw2, hw2],
    rows: [new TableRow({
      height: { value: 480, rule: 'atLeast' },
      children: [
        mkCell(mkPara([txt(L.fNext,      { bold: true, size: 18, color: '303040' })]),
          { width: hw2, bg: 'EEEEF2', borders: allBorders('DDDDDD') }),
        mkCell(mkPara([txt(L.fSickLeave, { bold: true, size: 18, color: '303040' })]),
          { width: hw2, bg: 'EEEEF2', borders: allBorders('DDDDDD') }),
      ],
    })],
  });

  // ── 8. SIGNATURES ─────────────────────────────────────────
  const sigsTable = new Table({
    width: { size: TW, type: WidthType.DXA },
    columnWidths: [TW / 2, TW / 2],
    rows: [new TableRow({ children: [
      mkCell([
        mkPara([txt(L.sigPat, { bold: true, size: 18, color: '888888' })], { spaceAfter: 200 }),
        mkPara([txt('_______________________________', { size: 18, color: 'CCCCCC' })], { spaceAfter: 80 }),
        mkPara([txt(patientName, { size: 16, color: 'AAAAAA' })], { spaceAfter: 40 }),
        mkPara([txt(L.dateLabel + ' ' + dateShort, { size: 14, color: 'AAAAAA' })]),
      ], { width: TW / 2, bg: 'FFFFFF', borders: noBorders(), marginT: 160 }),
      mkCell([
        mkPara([txt(L.sigDoc, { bold: true, size: 18, color: '888888' })], { spaceAfter: 200 }),
        mkPara([txt('_______________________________', { size: 18, color: 'CCCCCC' })], { spaceAfter: 80 }),
        mkPara([txt(doctorName, { size: 16, color: 'AAAAAA' })]),
      ], { width: TW / 2, bg: 'FFFFFF', borders: noBorders(), marginT: 160 }),
    ]})],
  });

  // ── 9. CONSENT ────────────────────────────────────────────
  const consentTable = new Table({
    width: { size: TW, type: WidthType.DXA },
    columnWidths: [12, TW - 12],
    rows: [new TableRow({ children: [
      mkCell(mkPara(''), { width: 12, bg: 'DDAA00', borders: noBorders(), marginL: 0, marginR: 0 }),
      mkCell(mkPara([txt(L.consent, { size: 16, color: '7A6200' })]), {
        width: TW - 12, bg: 'FFF8DC',
        borders: { top: bSingle('DDBB00'), bottom: bSingle('DDBB00'), left: bNone(), right: bSingle('DDBB00') },
      }),
    ]})],
  });

  // ── BUILD DOCUMENT ────────────────────────────────────────
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 640, right: 720, bottom: 720, left: 720 },
        },
      },
      footers: {
        default: new Footer({
          children: [mkPara([txt(L.footer, { size: 14, color: '888888' })], { align: AlignmentType.CENTER })],
        }),
      },
      children: [
        // Page 1
        headerTable,
        ...sp(1),
        cardsTable,
        ...sp(1),

        sectionHeader(L.sec1, TW),
        complaintsTable,
        painScale,
        ...sp(1),

        sectionHeader(L.sec2, TW, '0D1828'),
        anamnesisTable,
        ...sp(1),

        // Page 2
        new Paragraph({ children: [new PageBreak()] }),

        // Patient name reminder on page 2
        new Table({
          width: { size: TW, type: WidthType.DXA },
          columnWidths: [TW],
          rows: [new TableRow({ children: [
            mkCell(
              mkPara([txt(patientName + '   ·   ' + dateShort, { bold: true, size: 18, color: '666666' })]),
              { width: TW, bg: 'F0F0F5', borders: allBorders('DDDDDD'), marginT: 80, marginB: 80 }
            ),
          ]})],
        }),
        ...sp(1),

        sectionHeader(L.sec3, TW, '0A1A0A'),
        historyTable,
        ...sp(1),

        sectionHeader(L.sec4, TW, '150D2A'),
        aiBlock,
        ...sp(1),

        sectionHeader(L.sec5, TW),
        doctorTable,
        bottomDoctorTable,
        ...sp(2),

        sigsTable,
        ...sp(1),
        consentTable,
      ],
    }],
  });

  return await Packer.toBuffer(doc);
}

module.exports = { generateAnamnesisDocx };

const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

let selectedDoctor = null;
let patientData = {};
let chatHistory = [];
let isDone = false;
var _multiSelected = [];
var _optionsVisible = false;
let isWaiting = false;
let searchTimeout = null;

// ── Зчитуємо surveyKey з URL (?surveyKey=cardio) ──────────
// Лікар може надіслати пацієнту пряме посилання на конкретне опитування
const _urlParams = new URLSearchParams(window.location.search);
const _surveyKey = _urlParams.get('surveyKey') || null;
const _prefilledCode = (_urlParams.get('code') || '').toUpperCase() || null;

// ── i18n ──────────────────────────────────────
var currentLang = 'uk';

var i18n = {
  uk: {
    tagline: 'медичний асистент',
    tab_code: 'Код лікаря',
    tab_search: 'Пошук лікаря',
    code_placeholder: 'напр. DOC-4821',
    search_placeholder: "ім'я, місто або спеціальність...",
    btn_start: 'Розпочати',
    btn_continue: 'Продовжити',
    hint_code: 'Введіть код лікаря, щоб продовжити',
    hint_search: "Введіть ім'я або місто лікаря",
    doctor_confirm_title: 'Підтвердження лікаря',
    confirm_question: 'Це ваш лікар?',
    btn_no: 'Ні, змінити',
    btn_yes: 'Так, продовжити',
    patient_title: 'Ваші дані',
    patient_desc: 'Ці дані будуть включені в медичну картку для лікаря.',
    label_name: 'ПІБ',
    label_phone: 'Телефон',
    name_placeholder: 'Іваненко Іван Іванович',
    btn_to_survey: 'Перейти до опитування',
    status_online: 'Онлайн',
    status_typing: 'Друкує...',
    status_done: 'Завершено',
    status_wait: 'Зачекайте...',
    chat_placeholder: 'Введіть відповідь...',
    sending_title: 'Надсилаємо звіт',
    sending_sub: 'Формуємо медичну картку<br>та надсилаємо лікарю',
    step1: 'Обробка даних',
    step2: 'Формування PDF',
    step3: 'Відправка лікарю',
    done_title: 'Готово!',
    done_sub: 'Звіт надіслано лікарю',
    searching: 'Пошук...',
    no_doctors: 'Лікарів не знайдено',
    search_error: 'Помилка пошуку',
    alert_enter_code: 'Введіть код лікаря',
    alert_code_not_found: 'Лікаря з кодом {code} не знайдено',
    alert_select_doctor: 'Оберіть лікаря зі списку',
    alert_enter_name: 'Введіть ПІБ',
    alert_enter_phone: 'Введіть телефон',
    err_prefix: 'Помилка: ',
    err_connection: "Помилка з'єднання. Спробуйте ще раз.",
    err_send: 'Помилка відправки: ',
    err_send_report: 'Помилка відправки звіту',
    doctor_label: 'Лікар',
    rate_limit_retry: '⏳ Сервіс завантажений, повторюю через {sec} сек...'
  },
  en: {
    tagline: 'medical assistant',
    tab_code: 'Doctor code',
    tab_search: 'Search doctor',
    code_placeholder: 'e.g. DOC-4821',
    search_placeholder: 'name, city or specialty...',
    btn_start: 'Start',
    btn_continue: 'Continue',
    hint_code: 'Enter doctor code to continue',
    hint_search: 'Enter name or city of doctor',
    doctor_confirm_title: 'Confirm doctor',
    confirm_question: 'Is this your doctor?',
    btn_no: 'No, change',
    btn_yes: 'Yes, continue',
    patient_title: 'Your details',
    patient_desc: 'This data will be included in the medical record for the doctor.',
    label_name: 'Full name',
    label_phone: 'Phone',
    name_placeholder: 'John Smith',
    btn_to_survey: 'Start survey',
    status_online: 'Online',
    status_typing: 'Typing...',
    status_done: 'Done',
    status_wait: 'Please wait...',
    chat_placeholder: 'Type your answer...',
    sending_title: 'Sending report',
    sending_sub: 'Generating medical record<br>and sending to doctor',
    step1: 'Processing data',
    step2: 'Generating PDF',
    step3: 'Sending to doctor',
    done_title: 'Done!',
    done_sub: 'Report sent to doctor',
    searching: 'Searching...',
    no_doctors: 'No doctors found',
    search_error: 'Search error',
    alert_enter_code: 'Please enter doctor code',
    alert_code_not_found: 'Doctor with code {code} not found',
    alert_select_doctor: 'Please select a doctor from the list',
    alert_enter_name: 'Please enter your full name',
    alert_enter_phone: 'Please enter your phone number',
    err_prefix: 'Error: ',
    err_connection: 'Connection error. Please try again.',
    err_send: 'Send error: ',
    err_send_report: 'Failed to send report',
    doctor_label: 'Doctor',
    rate_limit_retry: '⏳ Service is busy, retrying in {sec} sec...'
  }
};

function t(key, vars) {
  var str = (i18n[currentLang] && i18n[currentLang][key]) || key;
  if (vars) {
    Object.keys(vars).forEach(function(k) {
      str = str.replace('{' + k + '}', vars[k]);
    });
  }
  return str;
}

function setLang(lang) {
  currentLang = lang;
  document.getElementById('btn-uk').classList.toggle('active', lang === 'uk');
  document.getElementById('btn-en').classList.toggle('active', lang === 'en');

  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    var key = el.getAttribute('data-i18n');
    var val = t(key);
    if (key === 'sending_sub') {
      el.innerHTML = val;
    } else if (key === 'done_sub') {
      var doctorEl = document.getElementById('done-doctor');
      var dName = doctorEl ? doctorEl.textContent : '';
      el.innerHTML = val + '<br><strong id="done-doctor">' + dName + '</strong>';
    } else if (el.tagName === 'LABEL') {
      var req = el.querySelector('.req');
      el.textContent = val;
      if (req) { el.appendChild(document.createTextNode(' ')); el.appendChild(req); }
    } else {
      var children = Array.from(el.childNodes).filter(function(n) {
        return n.nodeType === 1 && (n.tagName === 'SVG' || n.tagName === 'svg' || n.tagName === 'SPAN');
      });
      if (children.length > 0) {
        Array.from(el.childNodes).forEach(function(n) { if (n.nodeType === 3) el.removeChild(n); });
        el.insertBefore(document.createTextNode(val), el.firstChild);
      } else {
        el.textContent = val;
      }
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });

  var activePane = document.querySelector('.tab-pane.active');
  if (activePane && activePane.id === 'pane-code') {
    document.getElementById('welcome-hint').textContent = t('hint_code');
  } else {
    document.getElementById('welcome-hint').textContent = t('hint_search');
  }

  var chatScreen = document.getElementById('screen-chat');
  if (chatScreen && chatScreen.classList.contains('active') && !isDone && !isWaiting) {
    chatHistory = [];
    isWaiting = false;
    document.getElementById('messages').innerHTML = '';
    document.getElementById('input-area').style.display = 'flex';
    document.getElementById('chat-status').textContent = t('status_online');
    document.getElementById('send-btn').disabled = false;
    getBotReply();
  }
}

// ── Навігація ─────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

// ── Вкладки ───────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.tab-pane').forEach(function(p) { p.classList.remove('active'); });
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('pane-' + tab).classList.add('active');
  selectedDoctor = null;
  document.getElementById('welcome-hint').textContent =
    tab === 'code' ? t('hint_code') : t('hint_search');
}

// ── Пошук по імені ────────────────────────────
function onSearchInput() {
  clearTimeout(searchTimeout);
  selectedDoctor = null;
  document.getElementById('btn-search-go').style.display = 'none';
  var q = document.getElementById('search-input').value.trim();
  if (q.length < 2) { document.getElementById('search-results').innerHTML = ''; return; }
  searchTimeout = setTimeout(function() { doSearch(q); }, 350);
}

async function doSearch(q) {
  var res = document.getElementById('search-results');
  res.innerHTML = '<div class="search-empty">' + t('searching') + '</div>';
  try {
    var r = await fetch('/api/doctors/search?q=' + encodeURIComponent(q));
    var doctors = await r.json();
    if (!doctors.length) { res.innerHTML = '<div class="search-empty">' + t('no_doctors') + '</div>'; return; }
    res.innerHTML = '';
    doctors.forEach(function(doc) {
      var el = document.createElement('div');
      el.className = 'doctor-result';
      el.innerHTML = '<div class="dr-name">' + doc.name + '</div>'
        + '<div class="dr-spec">' + (doc.specialty || '') + '</div>'
        + '<div class="dr-meta">' + (doc.hospital || '') + ' · ' + (doc.city || '') + '</div>';
      el.onclick = function() {
        document.querySelectorAll('.doctor-result').forEach(function(e) { e.classList.remove('selected'); });
        el.classList.add('selected');
        selectedDoctor = doc;
        document.getElementById('btn-search-go').style.display = 'flex';
      };
      res.appendChild(el);
    });
  } catch(e) {
    res.innerHTML = '<div class="search-empty">' + t('search_error') + '</div>';
  }
}

async function findByCode() {
  var raw = document.getElementById('code-input').value.trim().toUpperCase();
  if (!raw) return alert(t('alert_enter_code'));
  var code = raw.startsWith('DOC-') ? raw : 'DOC-' + raw;
  try {
    var r = await fetch('/api/doctors/search?code=' + encodeURIComponent(code));
    var docs = await r.json();
    if (!docs.length) return alert(t('alert_code_not_found', { code: code }));
    selectedDoctor = docs[0];
    showDoctorProfile();
  } catch(e) { alert(t('err_prefix') + e.message); }
}

function findBySearch() {
  if (!selectedDoctor) return alert(t('alert_select_doctor'));
  showDoctorProfile();
}

function showDoctorProfile() {
  var d = selectedDoctor;
  var initials = d.name.split(' ').slice(0,2).map(function(w) { return w[0]; }).join('');
  document.getElementById('doc-avatar').textContent = initials;
  document.getElementById('doc-name').textContent = d.name;
  document.getElementById('doc-spec').textContent = d.specialty || t('doctor_label');
  document.getElementById('doc-hospital').textContent = d.hospital || '';
  document.getElementById('doc-city').textContent = d.city || '';
  showScreen('screen-doctor');
}

function confirmDoctor() { showScreen('screen-patient'); }

// ── Дані пацієнта ─────────────────────────────
function submitPatientData() {
  var name = document.getElementById('patient-name').value.trim();
  var phone = document.getElementById('patient-phone').value.trim();
  var email = document.getElementById('patient-email').value.trim();
  if (!name) return alert(t('alert_enter_name'));
  if (!phone) return alert(t('alert_enter_phone'));
  patientData = { name: name, phone: phone, email: email };
  chatHistory = [];
  isDone = false;
  isWaiting = false;
  document.getElementById('messages').innerHTML = '';
  document.getElementById('input-area').style.display = 'flex';
  showScreen('screen-chat');
  startChat();
}

// ── Чат ──────────────────────────────────────
function startChat() {
  var textarea = document.getElementById('user-input');
  textarea.onkeydown = function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };
  textarea.oninput = function() {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  };
  getBotReply();
}

async function sendMessage() {
  if (isDone || isWaiting) return;
  var input = document.getElementById('user-input');
  var text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  addMessage(text, 'user');
  chatHistory.push({ role: 'user', content: text });
  getBotReply();
}

// ── Retry-логіка для rate limit ───────────────
async function fetchChatWithRetry(body, maxRetries) {
  maxRetries = maxRetries || 3;
  var retryDelays = [8000, 15000, 25000];

  for (var attempt = 0; attempt < maxRetries; attempt++) {
    var r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (r.status === 429) {
      if (attempt < maxRetries - 1) {
        var waitSec = Math.ceil(retryDelays[attempt] / 1000);
        var statusEl = document.getElementById('chat-status');
        var remaining = waitSec;
        var countdown = setInterval(function() {
          if (statusEl) statusEl.textContent = t('rate_limit_retry', { sec: remaining });
          remaining--;
          if (remaining < 0) clearInterval(countdown);
        }, 1000);
        await new Promise(function(resolve) { setTimeout(resolve, retryDelays[attempt]); });
        clearInterval(countdown);
        if (statusEl) statusEl.textContent = t('status_typing');
        continue;
      }
    }

    var data = await r.json();
    return data;
  }

  return { error: currentLang === 'uk'
    ? 'Сервіс тимчасово недоступний. Спробуйте через хвилину.'
    : 'Service temporarily unavailable. Please try again in a minute.' };
}

async function getBotReply() {
  if (isWaiting) return;
  isWaiting = true;
  document.getElementById('send-btn').disabled = true;
  document.getElementById('chat-status').textContent = t('status_typing');

  var typing = document.createElement('div');
  typing.className = 'msg msg-bot';
  typing.id = 'typing-ind';
  typing.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
  document.getElementById('messages').appendChild(typing);
  scrollBottom();

  try {
    // ── Передаємо doctorCode + surveyKey (з URL або null) ──────────────────
    var data = await fetchChatWithRetry({
      history: chatHistory,
      patientName: patientData.name,
      lang: currentLang,
      doctorCode: selectedDoctor ? selectedDoctor.code : '',
      surveyKey: _surveyKey   // null якщо не передано в URL
    });

    var ti = document.getElementById('typing-ind');
    if (ti) ti.remove();

    if (data.error) {
      addMessage(t('err_prefix') + data.error, 'bot');
      isWaiting = false;
      document.getElementById('send-btn').disabled = false;
      document.getElementById('chat-status').textContent = t('status_online');
      return;
    }

    addMessage(data.reply, 'bot');
    chatHistory.push({ role: 'assistant', content: data.reply });
// ── Показуємо кнопки для choice/multi питань ──
if (!data.isDone && data.options && data.options.length) {
  showOptions(data.options, data.questionType === 'multi');
} else {
  hideOptions();
}
    if (data.isDone) {
      isDone = true;
      document.getElementById('input-area').style.display = 'none';
      document.getElementById('chat-status').textContent = t('status_done');
      setTimeout(function() {
        showScreen('screen-sending');
        animateSendingSteps();
        submitReport(data.reply);
      }, 800);
    }

  } catch(e) {
    var t2 = document.getElementById('typing-ind');
    if (t2) t2.remove();
    addMessage(t('err_connection'), 'bot');
  }

  isWaiting = false;
  document.getElementById('send-btn').disabled = false;
  if (!isDone) document.getElementById('chat-status').textContent = t('status_online');
}

function addMessage(text, role) {
  var div = document.createElement('div');
  div.className = 'msg msg-' + (role === 'user' ? 'user' : 'bot');
  var span = document.createElement('span');
  span.textContent = text;
  div.appendChild(span);
  document.getElementById('messages').appendChild(div);
  scrollBottom();
}

function scrollBottom() {
  var m = document.getElementById('messages');
  m.scrollTop = m.scrollHeight;
}

// ── Відправка звіту ──────────────────────────
async function submitReport(lastReply) {
  var summaryMatch = lastReply.match(/---SUMMARY---([\s\S]*?)---END---/)
    || lastReply.match(/---ПІДСУМОК---([\s\S]*?)---КІНЕЦЬ---/);
  var summary = summaryMatch ? summaryMatch[1].trim() : lastReply;

  summary = 'ПІБ: ' + patientData.name + '\n'
    + 'Телефон: ' + patientData.phone + '\n'
    + (patientData.email ? 'Email: ' + patientData.email + '\n' : '')
    + summary;

  try {
    var r = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        history: chatHistory,
        summary: summary,
        doctorCode: selectedDoctor.code,
        patientData: patientData,
        lang: currentLang,
        surveyKey: _surveyKey
      })
    });
    var data = await r.json();
    if (data.success) {
      document.getElementById('done-doctor').textContent = selectedDoctor.name;
      document.getElementById('summary-box').textContent = summary;
      showScreen('screen-done');
    } else {
      showScreen('screen-chat');
      addMessage(t('err_send') + (data.error || ''), 'bot');
    }
  } catch(e) {
    showScreen('screen-chat');
    addMessage(t('err_send_report'), 'bot');
  }
}

// ── Анімація кроків ───────────────────────────
function animateSendingSteps() {
  var steps = ['step-1', 'step-2', 'step-3'];
  var i = 0;
  function next() {
    if (i > 0) {
      var prev = document.getElementById(steps[i-1]);
      if (prev) prev.className = 'step done';
    }
    if (i < steps.length) {
      var cur = document.getElementById(steps[i]);
      if (cur) cur.className = 'step active';
      i++;
      setTimeout(next, 1200);
    }
  }
  next();
}

// ── Автозаповнення коду лікаря з URL ─────────
// Якщо в URL є ?code=DOC-1234, одразу завантажуємо профіль лікаря
(async function autoFillFromUrl() {
  if (!_prefilledCode) return;
  try {
    var r = await fetch('/api/doctors/search?code=' + encodeURIComponent(_prefilledCode));
    var docs = await r.json();
    if (docs.length) {
      selectedDoctor = docs[0];
      showDoctorProfile();
    }
  } catch(e) {
    console.warn('Auto-fill failed:', e.message);
 }   
})();
    
function showOptions(options, isMulti) {
  _multiSelected = [];
  _optionsVisible = true;

  var old = document.getElementById('nexum-options');
  if (old) old.remove();

  var wrap = document.createElement('div');
  wrap.id = 'nexum-options';
  wrap.style.cssText = [
    'display:flex', 'flex-wrap:wrap', 'gap:8px',
    'justify-content:center',
    'padding:10px 14px 8px',
    'background:rgba(11,15,28,0.95)',
    'border-top:1px solid rgba(255,255,255,0.08)',
  ].join(';');
  options.forEach(function(opt) {
    var btn = document.createElement('button');
    btn.textContent = opt;
    btn.dataset.opt = opt;
    btn.style.cssText = [
      'background:rgba(59,130,246,0.12)',
      'color:#dde4f0',
      'border:1.5px solid rgba(59,130,246,0.3)',
      'border-radius:20px',
      'padding:11px 22px',
    'font-size:15px',
      'font-family:inherit',
      'cursor:pointer',
      'transition:background .15s,border-color .15s,color .15s',
    ].join(';');

    btn.onclick = function() {
      if (isWaiting || isDone) return;

      if (!isMulti) {
        // choice — одразу надсилаємо
        hideOptions();
        _injectAndSend(opt);
      } else {
        // multi — toggle
        var idx = _multiSelected.indexOf(opt);
        if (idx === -1) {
          _multiSelected.push(opt);
          btn.style.background    = 'rgba(59,130,246,0.45)';
          btn.style.borderColor   = 'rgba(59,130,246,0.9)';
          btn.style.color         = '#ffffff';
        } else {
          _multiSelected.splice(idx, 1);
          btn.style.background    = 'rgba(59,130,246,0.12)';
          btn.style.borderColor   = 'rgba(59,130,246,0.3)';
          btn.style.color         = '#dde4f0';
        }
      }
    };
    wrap.appendChild(btn);
  });

  if (isMulti) {
    var confirmBtn = document.createElement('button');
    confirmBtn.textContent = currentLang === 'en' ? '✓ Confirm' : '✓ Підтвердити';
    confirmBtn.style.cssText = [
      'background:#3b82f6',
      'color:#fff',
      'border:none',
      'border-radius:20px',
      'padding:11px 22px',
      'font-size:15px',
      'font-weight:600',
      'font-family:inherit',
      'cursor:pointer',
      'margin-left:6px',
      'transition:opacity .15s',
    ].join(';');
    confirmBtn.onmouseenter = function() { this.style.opacity = '0.85'; };
    confirmBtn.onmouseleave = function() { this.style.opacity = '1'; };
    confirmBtn.onclick = function() {
      if (isWaiting || isDone) return;
      if (!_multiSelected.length) return;
      var answer = _multiSelected.join(', ');
      hideOptions();
      _injectAndSend(answer);
    };
    wrap.appendChild(confirmBtn);
  }

  var inputArea = document.getElementById('input-area');
  if (inputArea && inputArea.parentNode) {
    inputArea.parentNode.insertBefore(wrap, inputArea);
  }
  // Для choice/multi ховаємо текстовий input
  if (inputArea) inputArea.style.display = 'none';
}

function hideOptions() {
  var old = document.getElementById('nexum-options');
  if (old) old.remove();
  _optionsVisible = false;
  _multiSelected = [];
  var inputArea = document.getElementById('input-area');
  if (inputArea) inputArea.style.display = 'flex';
}

// Допоміжна: вставляє текст у поле і викликає sendMessage
function _injectAndSend(text) {
  var input = document.getElementById('user-input');
  if (input) {
    input.value = text;
    input.style.height = 'auto';
  }
  sendMessage();
}

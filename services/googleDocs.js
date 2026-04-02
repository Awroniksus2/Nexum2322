const { google } = require('googleapis');

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set');
  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/documents'
    ]
  });
}

async function createDoc(title, content) {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const docs = google.docs({ version: 'v1', auth });
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  // Створюємо файл одразу в папці
  const file = await drive.files.create({
    requestBody: {
      name: title,
      mimeType: 'application/vnd.google-apps.document',
      parents: folderId ? [folderId] : []
    },
    fields: 'id',
    // Важливо для Shared Drive
    supportsAllDrives: true
  });

  const docId = file.data.id;

  // Наповнюємо текстом
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [{ insertText: { location: { index: 1 }, text: content } }]
    }
  });

  // Відкриваємо доступ
  await drive.permissions.create({
    fileId: docId,
    requestBody: { role: 'reader', type: 'anyone' },
    supportsAllDrives: true
  });

  return `https://docs.google.com/document/d/${docId}/edit`;
}

async function createMedicalCard(summary, patientName, timestamp) {
  const date = new Date(timestamp).toLocaleString('uk-UA');
  const content =
`МЕДИЧНА КАРТКА ПАЦІЄНТА
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Дата: ${date}
Пацієнт: ${patientName}
Сформовано: Nexum Medical Assistant
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${summary}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ Документ сформовано автоматично.
Лікар може внести корективи за потреби.`;

  return createDoc(`Медкартка — ${patientName} — ${date}`, content);
}

async function createChatLog(history, patientName, timestamp) {
  const date = new Date(timestamp).toLocaleString('uk-UA');

  let log = `ЛОГ РОЗМОВИ З ПАЦІЄНТОМ\n`;
  log += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  log += `Дата: ${date}\nПацієнт: ${patientName}\n`;
  log += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  history.forEach(msg => {
    if (msg.content === 'Почни опитування') return;
    if (msg.role === 'assistant') {
      log += `[Nexum]: ${msg.content}\n\n`;
    } else if (msg.role === 'user') {
      log += `[Пацієнт]: ${msg.content}\n\n`;
    }
  });

  log += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nКінець розмови`;

  return createDoc(`Лог — ${patientName} — ${date}`, log);
}

module.exports = { createMedicalCard, createChatLog };

const { generateAnamnesisPDF } = require('./pdfGenerator');

async function sendMedicalReport(doctorEmail, doctorName, doctorCity, doctorHospital, patientName, summary, date, lang) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.EMAIL_FROM;
  const isEn = lang === 'en';

  if (!apiKey) throw new Error('SENDGRID_API_KEY not set');
  if (!fromEmail) throw new Error('EMAIL_FROM not set');

  const pdfBytes = await generateAnamnesisPDF({
    patientName, summary, date,
    doctorName, doctorCity, doctorHospital,
    lang: lang || 'uk'
  });

  const pdfBase64 = Buffer.from(pdfBytes).toString('base64');
  const safeName = patientName.replace(/\s+/g, '_');
  const safeDate = date.replace(/[^\d]/g, '-');
  const filename = 'Nexum_' + safeName + '_' + safeDate + '.pdf';

  const html = isEn
    ? '<html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;color:#333;max-width:520px;margin:0 auto;background:#f5f5f5;padding:20px">'
      + '<div style="background:#0b0f14;border-radius:12px 12px 0 0;padding:24px">'
      + '<div style="color:#3db8f5;font-size:20px;font-weight:bold;margin-bottom:6px">NEXUM</div>'
      + '<h2 style="color:white;margin:0;font-size:18px">New Patient</h2>'
      + '<p style="color:#888;margin:4px 0 0;font-size:13px">Medical assistant</p>'
      + '</div>'
      + '<div style="background:white;padding:24px;border-radius:0 0 12px 12px">'
      + '<p style="font-size:15px">Hello, <strong>' + doctorName + '</strong>!</p>'
      + '<p>A new patient has contacted you through the Nexum system.</p>'
      + '<table style="width:100%;border-collapse:collapse;margin:16px 0">'
      + '<tr><td style="padding:8px;background:#f9f9f9;font-weight:bold;width:140px">Patient</td><td style="padding:8px;background:#f9f9f9">' + patientName + '</td></tr>'
      + '<tr><td style="padding:8px;font-weight:bold">Date</td><td style="padding:8px">' + date + '</td></tr>'
      + '<tr><td style="padding:8px;background:#f9f9f9;font-weight:bold">Doctor</td><td style="padding:8px;background:#f9f9f9">' + doctorName + '</td></tr>'
      + '<tr><td style="padding:8px;font-weight:bold">Facility</td><td style="padding:8px">' + doctorHospital + ', ' + doctorCity + '</td></tr>'
      + '</table>'
      + '<p style="background:#f0f9ff;border-left:3px solid #3db8f5;padding:12px;border-radius:4px;font-size:13px">'
      + '📄 The patient anamnesis is attached as a <strong>PDF document</strong> — ready to print or save.'
      + '</p>'
      + '<p style="color:#888;font-size:11px;margin-top:20px">Document generated automatically by Nexum AI.</p>'
      + '</div></body></html>'
    : '<html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;color:#333;max-width:520px;margin:0 auto;background:#f5f5f5;padding:20px">'
      + '<div style="background:#0b0f14;border-radius:12px 12px 0 0;padding:24px">'
      + '<div style="color:#3db8f5;font-size:20px;font-weight:bold;margin-bottom:6px">NEXUM</div>'
      + '<h2 style="color:white;margin:0;font-size:18px">Новий пацієнт</h2>'
      + '<p style="color:#888;margin:4px 0 0;font-size:13px">Медичний асистент</p>'
      + '</div>'
      + '<div style="background:white;padding:24px;border-radius:0 0 12px 12px">'
      + '<p style="font-size:15px">Вітаємо, <strong>' + doctorName + '</strong>!</p>'
      + '<p>До вас звернувся новий пацієнт через систему Nexum.</p>'
      + '<table style="width:100%;border-collapse:collapse;margin:16px 0">'
      + '<tr><td style="padding:8px;background:#f9f9f9;font-weight:bold;width:140px">Пацієнт</td><td style="padding:8px;background:#f9f9f9">' + patientName + '</td></tr>'
      + '<tr><td style="padding:8px;font-weight:bold">Дата</td><td style="padding:8px">' + date + '</td></tr>'
      + '<tr><td style="padding:8px;background:#f9f9f9;font-weight:bold">Лікар</td><td style="padding:8px;background:#f9f9f9">' + doctorName + '</td></tr>'
      + '<tr><td style="padding:8px;font-weight:bold">Заклад</td><td style="padding:8px">' + doctorHospital + ', ' + doctorCity + '</td></tr>'
      + '</table>'
      + '<p style="background:#f0f9ff;border-left:3px solid #3db8f5;padding:12px;border-radius:4px;font-size:13px">'
      + '📄 До листа прикріплено анамнез як <strong>PDF документ</strong> — готовий до друку або збереження.'
      + '</p>'
      + '<p style="color:#888;font-size:11px;margin-top:20px">Документ сформовано автоматично системою Nexum AI.</p>'
      + '</div></body></html>';

  const subject = isEn
    ? 'Nexum - New patient: ' + patientName + ' (' + date + ')'
    : 'Nexum - Новий пацієнт: ' + patientName + ' (' + date + ')';

  const body = {
    personalizations: [{ to: [{ email: doctorEmail }] }],
    from: { email: fromEmail, name: 'Nexum Medical' },
    subject: subject,
    content: [{ type: 'text/html', value: html }],
    attachments: [{
      content: pdfBase64,
      filename: filename,
      type: 'application/pdf',
      disposition: 'attachment'
    }]
  };

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error('SendGrid error: ' + error);
  }

  console.log('Email + PDF sent to ' + doctorEmail);
}

module.exports = { sendMedicalReport };

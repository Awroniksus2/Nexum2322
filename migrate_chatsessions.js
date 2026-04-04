/**
 * migrate_chatsessions.js — NEXUM (ВИПРАВЛЕНА ВЕРСІЯ)
 * ─────────────────────────────────────────────────────
 * Запускається ОДИН РАЗ з кореня бот-сервера:
 *   node migrate_chatsessions.js
 *
 * Що виправлено порівняно зі старою версією:
 * - Зберігає поле `messages` (не `chatHistory`)
 *   бо dashboard читає session.messages
 * - Видаляє порожні сесії (без messages і без chatHistory)
 * - Не дублює вже правильно мігровані сесії
 * ─────────────────────────────────────────────────────
 */
require('dotenv').config();
const admin = require('firebase-admin');

let sa;
try {
  sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON.trim());
} catch(e) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT_JSON parse error:', e.message);
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

function normalizePhone(p) {
  return String(p || '').replace(/\D/g, '');
}

async function migrate() {
  console.log('🔄 Starting migration...\n');

  // ── КРОК 1: Міграція з колекції `patients` ────────────────
  console.log('── КРОК 1: patients → dashboard_patients ──');
  const patientsSnap = await db.collection('patients').get();
  console.log(`Found ${patientsSnap.size} records in 'patients'\n`);

  let matched = 0, skipped = 0, notFound = 0;

  for (const patDoc of patientsSnap.docs) {
    const p = patDoc.data();
    const normPhone = normalizePhone(p.phone);
    const dc = (p.doctorCode || '').toUpperCase();

    if (!normPhone || !dc) {
      console.log(`⏭  Skip ${patDoc.id} — no phone or doctorCode`);
      skipped++;
      continue;
    }

    const snap = await db.collection('dashboard_patients')
      .where('doctorCode', '==', dc).get();

    let targetDoc = null;
    for (const d of snap.docs) {
      if (normalizePhone(d.data().phone) === normPhone) {
        targetDoc = d;
        break;
      }
    }

    if (!targetDoc) {
      console.log(`❓ Not found: phone=${p.phone} dc=${dc} name=${p.name}`);
      notFound++;
      continue;
    }

    const existing = targetDoc.data().chatSessions || [];

    // Перевіряємо чи ця сесія вже є по id
    const alreadyById = existing.some(s => s.id === patDoc.id);
    if (alreadyById) {
      // Перевіряємо чи у неї вже є messages (можливо вже правильно мігрована)
      const existingSession = existing.find(s => s.id === patDoc.id);
      if (Array.isArray(existingSession.messages) && existingSession.messages.length > 0) {
        console.log(`⏭  Already migrated with messages: ${patDoc.id}`);
        skipped++;
        continue;
      }
      // Є по id але без messages — оновлюємо поле
      console.log(`🔧 Fix existing session (add messages): ${patDoc.id}`);
      const msgs = (p.chatHistory || []).filter(m =>
        m && m.role && m.content &&
        m.content !== 'Почни опитування' &&
        m.content !== 'Start the survey'
      );
      const updated = existing.map(s =>
        s.id === patDoc.id ? { ...s, messages: msgs } : s
      );
      await db.collection('dashboard_patients').doc(targetDoc.id).update({
        chatSessions: updated,
        updatedAt: new Date().toISOString()
      });
      console.log(`✅ Fixed: ${p.name} — ${msgs.length} msgs`);
      matched++;
      continue;
    }

    // Нова сесія — зберігаємо з полем `messages` (не chatHistory!)
    const msgs = (p.chatHistory || []).filter(m =>
      m && m.role && m.content &&
      m.content !== 'Почни опитування' &&
      m.content !== 'Start the survey'
    );

    const newSession = {
      id:        patDoc.id,
      createdAt: p.createdAt || new Date().toISOString(),
      summary:   p.summary || '',
      messages:  msgs,   // ✅ ВИПРАВЛЕНО: messages (не chatHistory)
    };

    await db.collection('dashboard_patients').doc(targetDoc.id).update({
      chatSessions: [...existing, newSession],
      lastBotSession: p.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    console.log(`✅ Migrated: ${p.name} (${normPhone}) → ${targetDoc.id} [${msgs.length} msgs]`);
    matched++;
  }

  console.log(`\nКРОК 1 результат:`);
  console.log(`  ✅ Migrated/fixed: ${matched}`);
  console.log(`  ⏭  Skipped:       ${skipped}`);
  console.log(`  ❓ Not found:      ${notFound}`);

  // ── КРОК 2: Виправити сесії що вже в dashboard але мають chatHistory замість messages ──
  console.log('\n── КРОК 2: Виправити chatHistory→messages в dashboard_patients ──');
  const dashSnap = await db.collection('dashboard_patients').get();
  let fixed2 = 0;

  for (const doc of dashSnap.docs) {
    const data = doc.data();
    const sessions = data.chatSessions || [];
    let needsUpdate = false;

    const updatedSessions = sessions.map(s => {
      // Якщо є chatHistory але немає messages — конвертуємо
      if (Array.isArray(s.chatHistory) && s.chatHistory.length > 0 && !Array.isArray(s.messages)) {
        needsUpdate = true;
        return { ...s, messages: s.chatHistory };
      }
      // Якщо є chatHistory і messages порожній — беремо chatHistory
      if (Array.isArray(s.chatHistory) && s.chatHistory.length > 0 &&
          Array.isArray(s.messages) && s.messages.length === 0) {
        needsUpdate = true;
        return { ...s, messages: s.chatHistory };
      }
      return s;
    });

    if (needsUpdate) {
      await db.collection('dashboard_patients').doc(doc.id).update({
        chatSessions: updatedSessions,
        updatedAt: new Date().toISOString()
      });
      console.log(`✅ Fixed chatHistory→messages: dashboard_patients/${doc.id}`);
      fixed2++;
    }
  }

  console.log(`\nКРОК 2 результат: виправлено ${fixed2} документів`);

  console.log('\n─────────────────────────────────────────');
  console.log('✅ Міграцію завершено! Оновіть дашборд.');
  console.log('─────────────────────────────────────────');
  process.exit(0);
}

migrate().catch(e => {
  console.error('❌ Migration error:', e.message);
  process.exit(1);
});

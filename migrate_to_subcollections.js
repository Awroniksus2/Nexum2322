/**
 * migrate_to_subcollections.js — NEXUM
 *
 * Мігрує дані зі старої плоскої структури в підколекції:
 *   dashboard_patients  →  doctors/{doctorCode}/patients
 *   doctor_surveys      →  doctors/{doctorCode}/surveys
 *   patients (архів)    →  doctors/{doctorCode}/sessions
 *
 * Запуск:
 *   node migrate_to_subcollections.js
 *
 * Безпечно: старі колекції НЕ видаляються автоматично.
 * Після перевірки запусти з --delete щоб очистити старі дані:
 *   node migrate_to_subcollections.js --delete
 */

require('dotenv').config();
const admin = require('firebase-admin');

// ── Ініціалізація ─────────────────────────────────────────────
let sa;
try {
  sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON.trim());
} catch (e) {
  console.error('❌ Cannot parse FIREBASE_SERVICE_ACCOUNT_JSON:', e.message);
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const DELETE_OLD = process.argv.includes('--delete');

// ── Статистика ────────────────────────────────────────────────
const stats = {
  patients: { migrated: 0, skipped: 0, errors: 0 },
  surveys:  { migrated: 0, skipped: 0, errors: 0 },
  sessions: { migrated: 0, skipped: 0, errors: 0 },
  deleted:  { patients: 0, surveys: 0, sessions: 0 }
};

// ── Хелпери ───────────────────────────────────────────────────
function doctorRef(code) {
  return db.collection('doctors').doc(code.toUpperCase());
}

async function docExists(ref) {
  const snap = await ref.get();
  return snap.exists;
}

// ── 1. Міграція dashboard_patients ───────────────────────────
async function migratePatients() {
  console.log('\n📦 Мігруємо dashboard_patients → doctors/{code}/patients ...');
  const snap = await db.collection('dashboard_patients').get();
  console.log(`   Знайдено ${snap.size} документів`);

  for (const doc of snap.docs) {
    const data = doc.data();
    const dc = (data.doctorCode || '').toUpperCase();
    if (!dc) {
      console.warn(`   ⚠️  Пропускаємо ${doc.id} — немає doctorCode`);
      stats.patients.skipped++;
      continue;
    }

    try {
      const newRef = doctorRef(dc).collection('patients').doc(doc.id);

      // Не перезаписуємо якщо вже мігровано
      if (await docExists(newRef)) {
        console.log(`   ⏭  Вже існує: doctors/${dc}/patients/${doc.id}`);
        stats.patients.skipped++;
        continue;
      }

      await newRef.set({ ...data, migratedAt: new Date().toISOString() });

      // Оновлюємо профіль лікаря (якщо ще не існує)
      const dRef = doctorRef(dc);
      if (!(await docExists(dRef))) {
        await dRef.set({ code: dc, createdAt: new Date().toISOString() });
      }

      console.log(`   ✅ doctors/${dc}/patients/${doc.id}`);
      stats.patients.migrated++;

      if (DELETE_OLD) {
        await db.collection('dashboard_patients').doc(doc.id).delete();
        stats.deleted.patients++;
      }
    } catch (e) {
      console.error(`   ❌ Помилка для ${doc.id}:`, e.message);
      stats.patients.errors++;
    }
  }
}

// ── 2. Міграція doctor_surveys ────────────────────────────────
async function migrateSurveys() {
  console.log('\n📋 Мігруємо doctor_surveys → doctors/{code}/surveys ...');
  const snap = await db.collection('doctor_surveys').get();
  console.log(`   Знайдено ${snap.size} документів`);

  for (const doc of snap.docs) {
    const data = doc.data();
    const dc = (data.doctorCode || '').toUpperCase();
    if (!dc) {
      console.warn(`   ⚠️  Пропускаємо ${doc.id} — немає doctorCode`);
      stats.surveys.skipped++;
      continue;
    }

    try {
      const newRef = doctorRef(dc).collection('surveys').doc(doc.id);

      if (await docExists(newRef)) {
        console.log(`   ⏭  Вже існує: doctors/${dc}/surveys/${doc.id}`);
        stats.surveys.skipped++;
        continue;
      }

      // Нормалізуємо поле: завжди зберігаємо як `surveys`
      let surveysData = data.surveys || data.data || null;
      if (typeof surveysData === 'string') {
        try { surveysData = JSON.parse(surveysData); } catch (_) {}
      }

      await newRef.set({
        doctorCode: dc,
        surveys: surveysData,
        updatedAt: data.updatedAt || new Date().toISOString(),
        migratedAt: new Date().toISOString()
      });

      console.log(`   ✅ doctors/${dc}/surveys/${doc.id}`);
      stats.surveys.migrated++;

      if (DELETE_OLD) {
        await db.collection('doctor_surveys').doc(doc.id).delete();
        stats.deleted.surveys++;
      }
    } catch (e) {
      console.error(`   ❌ Помилка для ${doc.id}:`, e.message);
      stats.surveys.errors++;
    }
  }
}

// ── 3. Міграція patients (архів сесій) ────────────────────────
async function migrateSessions() {
  console.log('\n💬 Мігруємо patients (архів) → doctors/{code}/sessions ...');
  const snap = await db.collection('patients').get();
  console.log(`   Знайдено ${snap.size} документів`);

  for (const doc of snap.docs) {
    const data = doc.data();
    const dc = (data.doctorCode || '').toUpperCase();
    if (!dc) {
      console.warn(`   ⚠️  Пропускаємо ${doc.id} — немає doctorCode`);
      stats.sessions.skipped++;
      continue;
    }

    try {
      const newRef = doctorRef(dc).collection('sessions').doc(doc.id);

      if (await docExists(newRef)) {
        console.log(`   ⏭  Вже існує: doctors/${dc}/sessions/${doc.id}`);
        stats.sessions.skipped++;
        continue;
      }

      await newRef.set({ ...data, migratedAt: new Date().toISOString() });

      console.log(`   ✅ doctors/${dc}/sessions/${doc.id}`);
      stats.sessions.migrated++;

      if (DELETE_OLD) {
        await db.collection('patients').doc(doc.id).delete();
        stats.deleted.sessions++;
      }
    } catch (e) {
      console.error(`   ❌ Помилка для ${doc.id}:`, e.message);
      stats.sessions.errors++;
    }
  }
}

// ── Звіт ──────────────────────────────────────────────────────
function printReport() {
  console.log('\n' + '═'.repeat(50));
  console.log('📊 ЗВІТ МІГРАЦІЇ');
  console.log('═'.repeat(50));
  console.log(`Пацієнти:    ✅ ${stats.patients.migrated}  ⏭ ${stats.patients.skipped}  ❌ ${stats.patients.errors}`);
  console.log(`Опитування:  ✅ ${stats.surveys.migrated}  ⏭ ${stats.surveys.skipped}  ❌ ${stats.surveys.errors}`);
  console.log(`Сесії:       ✅ ${stats.sessions.migrated}  ⏭ ${stats.sessions.skipped}  ❌ ${stats.sessions.errors}`);
  if (DELETE_OLD) {
    console.log('');
    console.log(`Видалено старих записів:`);
    console.log(`  dashboard_patients: ${stats.deleted.patients}`);
    console.log(`  doctor_surveys:     ${stats.deleted.surveys}`);
    console.log(`  patients:           ${stats.deleted.sessions}`);
  } else {
    console.log('\n⚠️  Старі колекції збережено. Запусти з --delete щоб їх очистити.');
  }
  console.log('═'.repeat(50));
}

// ── Головна функція ───────────────────────────────────────────
async function main() {
  console.log('🚀 Nexum — міграція до підколекцій');
  console.log(`   Проект: ${sa.project_id}`);
  console.log(`   Режим:  ${DELETE_OLD ? '⚠️  DELETE (старі дані будуть видалені)' : 'SAFE (старі дані збережено)'}`);
  console.log('');

  await migratePatients();
  await migrateSurveys();
  await migrateSessions();

  printReport();
  process.exit(0);
}

main().catch(e => {
  console.error('❌ Критична помилка:', e.message);
  process.exit(1);
});

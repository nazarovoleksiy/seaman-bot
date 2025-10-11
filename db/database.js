// db/database.js
import Database from 'better-sqlite3';
import fs from 'fs';

const DB_PATH = process.env.DATABASE_URL || './data.db';
console.log('DB PATH:', DB_PATH);

// ---- one-time backup on start ----
try {
    const backupPath = DB_PATH.replace(/\.db$/, '.db.bak');
    if (fs.existsSync(DB_PATH) && !fs.existsSync(backupPath)) {
        fs.copyFileSync(DB_PATH, backupPath);
        console.log('💾 Backup created at', backupPath);
    } else if (fs.existsSync(backupPath)) {
        console.log('✅ Backup already exists at', backupPath);
    } else {
        console.log('⚠️ Database file not found, no backup created.');
    }
} catch (e) {
    console.error('Backup creation error:', e);
}

// (опц.) миграция локальной БД -> /data (Render)
try {
    if (DB_PATH === '/data/data.db' && fs.existsSync('./data.db') && !fs.existsSync('/data/data.db')) {
        fs.copyFileSync('./data.db', '/data/data.db');
        console.log('Migrated ./data.db -> /data/data.db');
    }
} catch (e) {
    console.error('DB migrate copy error:', e);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// ------------ helpers -------------
function tableExists(name) {
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
}
function columnExists(table, col) {
    try {
        const rows = db.prepare(`PRAGMA table_info(${table})`).all();
        return rows.some(r => r.name === col);
    } catch { return false; }
}
function indexExists(name) {
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`).get(name);
}

// ------------ MIGRATIONS -------------
try {
    // users: ensure columns
    if (tableExists('users')) {
        if (!columnExists('users', 'username'))   db.exec(`ALTER TABLE users ADD COLUMN username TEXT;`);
        if (!columnExists('users', 'first_seen')) db.exec(`ALTER TABLE users ADD COLUMN first_seen TEXT;`);
        if (!columnExists('users', 'last_active'))db.exec(`ALTER TABLE users ADD COLUMN last_active TEXT;`);
    }

    // usage_log: daily -> lifetime
    if (tableExists('usage_log') && columnExists('usage_log', 'day')) {
        console.log('Migrating usage_log (daily -> lifetime)…');
        db.exec(`
      CREATE TABLE IF NOT EXISTS usage_log_new (
        id INTEGER PRIMARY KEY,
        tg_id TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO usage_log_new (tg_id, count)
      SELECT tg_id, COALESCE(SUM(count),0) AS total
      FROM usage_log
      GROUP BY tg_id;

      DROP TABLE usage_log;
      ALTER TABLE usage_log_new RENAME TO usage_log;
    `);
    }

    // usage_log: unique index & dedup
    if (tableExists('usage_log') && !indexExists('uq_usage_tg')) {
        db.exec(`
      CREATE TEMP TABLE _usage_dedup AS
      SELECT tg_id, MAX(count) AS count FROM usage_log GROUP BY tg_id;
      DELETE FROM usage_log;
      INSERT INTO usage_log (tg_id, count) SELECT tg_id, count FROM _usage_dedup;
      DROP TABLE _usage_dedup;

      CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_tg ON usage_log(tg_id);
    `);
        console.log('usage_log: UNIQUE index created');
    }
} catch (e) {
    console.error('DB migration error:', e);
}

// ------------ SCHEMA -------------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  tg_id TEXT PRIMARY KEY,
  language TEXT DEFAULT 'en',
  username TEXT,
  first_seen TEXT,
  last_active TEXT
);

CREATE TABLE IF NOT EXISTS usage_log (
  id INTEGER PRIMARY KEY,
  tg_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_tg ON usage_log(tg_id);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL,
  username TEXT,
  text TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS entitlements (
  tg_id TEXT NOT NULL,
  kind TEXT NOT NULL,              -- 'time' | 'credits'
  credits_left INTEGER,
  expires_at TEXT,                 -- 'YYYY-MM-DD HH:MM:SS' UTC for 'time'
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ent_tg ON entitlements(tg_id);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  amount_stars INTEGER,
  amount_cents INTEGER,
  currency TEXT,
  provider_charge_id TEXT,
  telegram_charge_id TEXT,
  status TEXT DEFAULT 'paid',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// ------------ USERS -------------
export function trackUser(tgId, username) {
    db.prepare(`
    INSERT INTO users (tg_id, username, first_seen, last_active)
    VALUES (?,?, datetime('now'), datetime('now'))
    ON CONFLICT(tg_id) DO UPDATE SET last_active=datetime('now'), username=excluded.username
  `).run(String(tgId), username || null);
}
export function setLang(tgId, lang){
    db.prepare(`
    INSERT INTO users (tg_id, language) VALUES (?,?)
    ON CONFLICT(tg_id) DO UPDATE SET language=excluded.language
  `).run(String(tgId), lang);
}
export function getLang(tgId){
    const row = db.prepare(`SELECT language FROM users WHERE tg_id=?`).get(String(tgId));
    return row?.language || 'en';
}

// ------------ FREE LIFETIME LIMIT -------------
export const FREE_TOTAL_LIMIT = Number(process.env.FREE_TOTAL_LIMIT || 50);

export function totalUsage(tgId){
    return db.prepare(`SELECT count FROM usage_log WHERE tg_id=?`).get(String(tgId))?.count || 0;
}

const qUpdUsage = db.prepare('UPDATE usage_log SET count = count + 1 WHERE tg_id = ?');
const qInsUsage = db.prepare('INSERT INTO usage_log (tg_id, count) VALUES (?, 1)');
export function incUsage(tgId) {
    const r = qUpdUsage.run(String(tgId));
    if (r.changes === 0) qInsUsage.run(String(tgId));
}

// (если надо где-то) проверка на возможность
export function canUseLifetime(tgId){
    const used = totalUsage(tgId);
    const limit = FREE_TOTAL_LIMIT;
    return { ok: used < limit, used, limit, left: Math.max(limit - used, 0) };
}

// ------------ FEEDBACK -------------
export function saveFeedback(tgId, username, text){
    db.prepare(`INSERT INTO feedback (tg_id, username, text) VALUES (?,?,?)`)
        .run(String(tgId), username || null, text);
}
export function listFeedback(limit=20){
    return db.prepare(`SELECT * FROM feedback ORDER BY id DESC LIMIT ?`).all(limit);
}

// ------------ ENTITLEMENTS (PAID ACCESS) -------------
export function hasTimePass(tgId){
    return !!db.prepare(`
    SELECT 1 FROM entitlements
    WHERE tg_id=? AND kind='time' AND expires_at > datetime('now') LIMIT 1
  `).get(String(tgId));
}
export function timePassUntil(tgId){
    return db.prepare(`
    SELECT expires_at FROM entitlements
    WHERE tg_id=? AND kind='time'
    ORDER BY expires_at DESC LIMIT 1
  `).get(String(tgId))?.expires_at || null;
}
export const myTimePassUntil = timePassUntil;

export function creditsLeft(tgId){
    return db.prepare(`
    SELECT COALESCE(SUM(credits_left),0) AS left
    FROM entitlements
    WHERE tg_id=? AND kind='credits' AND credits_left > 0
  `).get(String(tgId)).left || 0;
}
export const myCreditsLeft = creditsLeft;

export function consumeOneCredit(tgId){
    const row = db.prepare(`
    SELECT rowid, credits_left FROM entitlements
    WHERE tg_id=? AND kind='credits' AND credits_left > 0
    ORDER BY created_at ASC LIMIT 1
  `).get(String(tgId));
    if (!row) return false;
    db.prepare(`UPDATE entitlements SET credits_left=credits_left-1 WHERE rowid=?`).run(row.rowid);
    return true;
}

// ✅ ВАЖНО: суммируем время к текущему активному (rollover), иначе — от текущего момента
export function grantTimePass(tgId, hours) {
    const id = String(tgId);
    const h  = Number(hours);

    const row = db.prepare(`
    SELECT rowid, expires_at
    FROM entitlements
    WHERE tg_id=? AND kind='time'
    ORDER BY expires_at DESC
    LIMIT 1
  `).get(id);

    const now = new Date();

    let base = now;
    let baseRowId = null;

    if (row?.expires_at) {
        const currentExp = new Date(row.expires_at.replace(' ', 'T') + 'Z');
        if (currentExp > now) {
            base = currentExp;     // активный — продлеваем от него
            baseRowId = row.rowid; // обновим эту запись
        }
    }

    const newExp = new Date(base.getTime() + h * 3600_000);
    const sqlExp = newExp.toISOString().replace('T', ' ').slice(0, 19); // 'YYYY-MM-DD HH:MM:SS'

    if (baseRowId) {
        db.prepare(`UPDATE entitlements SET expires_at=? WHERE rowid=?`).run(sqlExp, baseRowId);
    } else {
        db.prepare(`INSERT INTO entitlements (tg_id, kind, expires_at) VALUES (?,?,?)`)
            .run(id, 'time', sqlExp);
    }
}

export function grantCredits(tgId, credits){
    db.prepare(`INSERT INTO entitlements (tg_id, kind, credits_left) VALUES (?,?,?)`)
        .run(String(tgId), 'credits', Number(credits));
}

// payments log (сумма в валюте — число; для Stars можно писать в amount_stars)
export function logPayment(tgId, amountInCurrency, currency, plan, providerChargeId=null, telegramChargeId=null){
    db.prepare(`
    INSERT INTO payments (tg_id, plan, amount_cents, currency, provider_charge_id, telegram_charge_id, status)
    VALUES (?,?,?,?,?,?, 'paid')
  `).run(String(tgId), String(plan), Math.round(Number(amountInCurrency)*100), currency || 'USD', providerChargeId, telegramChargeId);
}

// ------------ STATS -------------
export function countUsers(){
    return db.prepare(`SELECT COUNT(*) AS c FROM users`).get().c || 0;
}
export function countActiveTimePasses(){
    return db.prepare(`
    SELECT COUNT(*) AS c FROM (
      SELECT tg_id FROM entitlements
      WHERE kind='time' AND expires_at > datetime('now')
      GROUP BY tg_id
    )
  `).get().c || 0;
}
export function sumCreditsLeftAll(){
    return db.prepare(`
    SELECT COALESCE(SUM(credits_left),0) AS s
    FROM entitlements
    WHERE kind='credits' AND credits_left > 0
  `).get().s || 0;
}
export function myCreditsLeftSummary(tgId){
    return creditsLeft(tgId);
}
export function myTimePassUntilSummary(tgId){
    return timePassUntil(tgId);
}
export function paymentsSummary(){
    return db.prepare(`
    SELECT currency, COUNT(*) AS cnt, COALESCE(SUM(amount_cents),0) AS sum_cents
    FROM payments
    GROUP BY currency
  `).all();
}
// db/database.js — Stripe совместимые функции

export function grantCredits(tgId, credits) {
    db.prepare(`INSERT INTO entitlements (tg_id, kind, credits_left) VALUES (?,?,?)`)
        .run(String(tgId), 'credits', Number(credits));
}

export function grantTimePass(tgId, hours) {
    const id = String(tgId);
    const h  = Number(hours);

    const row = db.prepare(`
    SELECT rowid, expires_at
    FROM entitlements
    WHERE tg_id=? AND kind='time'
    ORDER BY expires_at DESC
    LIMIT 1
  `).get(id);

    const now = new Date();
    let base = now;
    let baseRowId = null;

    if (row?.expires_at) {
        const currentExp = new Date(row.expires_at.replace(' ', 'T') + 'Z');
        if (currentExp > now) {
            base = currentExp;
            baseRowId = row.rowid;
        }
    }

    const newExp = new Date(base.getTime() + h * 3600_000);
    const sqlExp = newExp.toISOString().replace('T', ' ').slice(0, 19);

    if (baseRowId) {
        db.prepare(`UPDATE entitlements SET expires_at=? WHERE rowid=?`).run(sqlExp, baseRowId);
    } else {
        db.prepare(`INSERT INTO entitlements (tg_id, kind, expires_at) VALUES (?,?,?)`)
            .run(id, 'time', sqlExp);
    }
}

export function logPayment(tgId, amountInCurrency, currency, plan, providerChargeId=null, telegramChargeId=null) {
    db.prepare(`
    INSERT INTO payments (tg_id, plan, amount_cents, currency, provider_charge_id, telegram_charge_id, status)
    VALUES (?,?,?,?,?,?, 'paid')
  `).run(String(tgId), String(plan), Math.round(Number(amountInCurrency) * 100), currency || 'USD', providerChargeId, telegramChargeId);
}



export default db;

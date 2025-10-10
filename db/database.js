import Database from 'better-sqlite3';
import fs from 'fs';

const DB_PATH = process.env.DATABASE_URL || './data.db';
console.log('DB PATH:', DB_PATH);

// миграция, если нужно
try {
    if (DB_PATH === '/data/data.db' && fs.existsSync('./data.db') && !fs.existsSync('/data/data.db')) {
        fs.copyFileSync('./data.db', '/data/data.db');
        console.log('Migrated ./data.db -> /data/data.db');
    }
} catch (e) { console.error('DB migrate copy error:', e); }

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

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
  count INTEGER NOT NULL DEFAULT 0 -- lifetime usage
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL,
  username TEXT,
  text TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- платные права
CREATE TABLE IF NOT EXISTS entitlements (
  tg_id TEXT NOT NULL,
  kind TEXT NOT NULL,              -- 'time' | 'credits'
  credits_left INTEGER,
  expires_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ent_tg ON entitlements(tg_id);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  amount_stars INTEGER,            -- если будешь хранить Stars
  amount_cents INTEGER,            -- если провайдер в валютах
  currency TEXT,
  status TEXT DEFAULT 'paid',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

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

// lifetime usage
export const FREE_TOTAL_LIMIT = Number(process.env.FREE_TOTAL_LIMIT || 50);
export function totalUsage(tgId){
    return db.prepare(`SELECT count FROM usage_log WHERE tg_id=?`).get(String(tgId))?.count || 0;
}
export function incUsage(tgId){
    db.prepare(`
    INSERT INTO usage_log (tg_id, count) VALUES (?,1)
    ON CONFLICT(tg_id) DO UPDATE SET count = count + 1
  `).run(String(tgId));
}
export function canUseLifetime(tgId){
    const used = totalUsage(tgId);
    const limit = FREE_TOTAL_LIMIT;
    return { ok: used < limit, used, limit, left: Math.max(limit - used, 0) };
}

// feedback
export function saveFeedback(tgId, username, text){
    db.prepare(`INSERT INTO feedback (tg_id, username, text) VALUES (?,?,?)`)
        .run(String(tgId), username || null, text);
}
export function listFeedback(limit=20){
    return db.prepare(`SELECT * FROM feedback ORDER BY id DESC LIMIT ?`).all(limit);
}

// entitlements
export function hasTimePass(tgId){
    return !!db.prepare(`
    SELECT 1 FROM entitlements
    WHERE tg_id=? AND kind='time' AND expires_at > datetime('now') LIMIT 1
  `).get(String(tgId));
}
export function timePassUntil(tgId){
    return db.prepare(`
    SELECT expires_at FROM entitlements
    WHERE tg_id=? AND kind='time' AND expires_at > datetime('now')
    ORDER BY expires_at DESC LIMIT 1
  `).get(String(tgId))?.expires_at || null;
}
export function creditsLeft(tgId){
    return db.prepare(`
    SELECT COALESCE(SUM(credits_left),0) AS left
    FROM entitlements
    WHERE tg_id=? AND kind='credits' AND credits_left > 0
  `).get(String(tgId)).left || 0;
}
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
export function grantTimePass(tgId, hours){
    db.prepare(`INSERT INTO entitlements (tg_id, kind, expires_at) VALUES (?,?, datetime('now', ?))`)
        .run(String(tgId), 'time', `+${Number(hours)} hours`);
}
export function grantCredits(tgId, credits){
    db.prepare(`INSERT INTO entitlements (tg_id, kind, credits_left) VALUES (?,?,?)`)
        .run(String(tgId), 'credits', Number(credits));
}
export function logPayment({ tgId, plan, amountStars=null, amountCents=null, currency='USD' }){
    db.prepare(`INSERT INTO payments (tg_id, plan, amount_stars, amount_cents, currency) VALUES (?,?,?,?,?)`)
        .run(String(tgId), plan, amountStars, amountCents, currency);
}

// stats
export function countUsers(){
    return db.prepare(`SELECT COUNT(*) AS c FROM users`).get().c || 0;
}

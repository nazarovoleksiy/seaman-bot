import Database from 'better-sqlite3';
import fs from 'fs';

const DB_PATH = process.env.DATABASE_URL || './data.db';
console.log('DB PATH:', DB_PATH);

// (опц.) разовая миграция локальной БД -> на диск /data
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
  first_seen TEXT,
  last_active TEXT
);

CREATE TABLE IF NOT EXISTS usage_log (
  id INTEGER PRIMARY KEY,
  tg_id TEXT NOT NULL,
  day TEXT NOT NULL,       -- YYYY-MM-DD (UTC)
  count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(tg_id, day)
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT NOT NULL,
  username TEXT,
  text TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

export function todayUTC() {
    const d = new Date();
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth()+1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// users
const qGetUser   = db.prepare('SELECT * FROM users WHERE tg_id=?');
const qUpsertAct = db.prepare(`
  INSERT INTO users (tg_id, first_seen, last_active)
  VALUES (?, datetime('now'), datetime('now'))
  ON CONFLICT(tg_id) DO UPDATE SET last_active=datetime('now')
`);
const qSetLang   = db.prepare(`
  INSERT INTO users (tg_id, language)
  VALUES (?, ?)
  ON CONFLICT(tg_id) DO UPDATE SET language=excluded.language
`);
const qGetLang   = db.prepare('SELECT language FROM users WHERE tg_id=?');

export function trackUser(tgId) { qUpsertAct.run(String(tgId)); }
export function setLang(tgId, lang){ qSetLang.run(String(tgId), lang); }
export function getLang(tgId){ return (qGetLang.get(String(tgId))?.language) || 'en'; }

// usage / daily limit
const qGetCount = db.prepare('SELECT count FROM usage_log WHERE tg_id=? AND day=?');
const qUpsertInc = db.prepare(`
  INSERT INTO usage_log (tg_id, day, count) VALUES(?,?,1)
  ON CONFLICT(tg_id, day) DO UPDATE SET count = count + 1
`);
export const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 60);

export function usageForToday(tgId){
    return qGetCount.get(String(tgId), todayUTC())?.count || 0;
}
export function canUseToday(tgId){
    const used = usageForToday(tgId);
    return { ok: used < DAILY_LIMIT, used, limit: DAILY_LIMIT, left: Math.max(DAILY_LIMIT - used, 0) };
}
export function incUsage(tgId){
    qUpsertInc.run(String(tgId), todayUTC());
}

// feedback text
const qSaveFeedback = db.prepare(`
  INSERT INTO feedback (tg_id, username, text) VALUES(?,?,?)
`);
export function saveFeedback(tgId, username, text){
    qSaveFeedback.run(String(tgId), username || null, text);
}

export default db;

// db/answerCache.js
import db from './database.js';

db.exec(`
CREATE TABLE IF NOT EXISTS answer_cache (
  file_uid   TEXT PRIMARY KEY,
  ver        TEXT NOT NULL,
  answer_json TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

export function getCachedAnswer(fileUid, ver) {
    const row = db.prepare('SELECT answer_json FROM answer_cache WHERE file_uid=? AND ver=?')
        .get(String(fileUid), String(ver));
    return row ? row.answer_json : null;
}

export function saveCachedAnswer(fileUid, ver, answerObj) {
    const json = JSON.stringify(answerObj);
    db.prepare(`
    INSERT INTO answer_cache (file_uid, ver, answer_json)
    VALUES(?,?,?)
    ON CONFLICT(file_uid) DO UPDATE SET ver=excluded.ver, answer_json=excluded.answer_json
  `).run(String(fileUid), String(ver), json);
}

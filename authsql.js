'use strict';
/*
 * WhatsApp oturum anahtarlarını binlerce küçük dosya yerine TEK bir SQLite dosyasına (auth.db) yazar.
 * Neden: 1300 grupta useMultiFileAuthState yüz binlerce dosya üretiyor (disk beklemesi, kopmalar, RAM).
 * Node >= 22.5 gerekir (yerleşik node:sqlite, ek paket yok).
 * İlk açılışta dizindeki eski *.json dosyaları otomatik içeri alınır (eşleştirme korunur, dosyalar silinmez).
 */
const fs = require('fs');
const path = require('path');

const fix = (s) => String(s).replace(/\//g, '__').replace(/:/g, '-');   // useMultiFileAuthState ile aynı dosya adı kuralı
const veritabani = new Map();                                            // süreç başına tek bağlantı (yeniden bağlanmada sızıntı olmasın)

function ac(dir, log) {
  if (veritabani.has(dir)) return veritabani.get(dir);
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'auth.db'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID;');
  if (db.prepare('SELECT COUNT(*) AS n FROM kv').get().n === 0) {
    const ekle = db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)');
    let n = 0;
    db.exec('BEGIN');
    try {
      for (const ad of fs.readdirSync(dir)) {
        if (!ad.endsWith('.json')) continue;
        try { ekle.run(ad === 'creds.json' ? 'creds' : ad.slice(0, -5), fs.readFileSync(path.join(dir, ad), 'utf8')); n++; } catch { /* bozuk dosya atlanır */ }
      }
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch { /* yok say */ } throw e; }
    if (n) log(`📦 ${n} eski oturum dosyası SQLite'a aktarıldı (dosyalar silinmedi).`);
  }
  veritabani.set(dir, db);
  return db;
}

function useSqliteAuthState(dir, { BufferJSON, proto, initAuthCreds }, log = () => {}) {
  const db = ac(dir, log);
  const getir = db.prepare('SELECT v FROM kv WHERE k = ?');
  const yaz = db.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)');
  const sil = db.prepare('DELETE FROM kv WHERE k = ?');
  const oku = (k) => { const r = getir.get(k); return r ? JSON.parse(r.v, BufferJSON.reviver) : null; };
  const kaydet = (k, v) => yaz.run(k, JSON.stringify(v, BufferJSON.replacer));

  const creds = oku('creds') || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            let v = oku(`${type}-${fix(id)}`);
            if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
            data[id] = v;
          }
          return data;
        },
        set: async (data) => {
          db.exec('BEGIN');
          try {
            for (const kat in data) for (const id in data[kat]) {
              const v = data[kat][id], k = `${kat}-${fix(id)}`;
              if (v) kaydet(k, v); else sil.run(k);
            }
            db.exec('COMMIT');
          } catch (e) { try { db.exec('ROLLBACK'); } catch { /* yok say */ } throw e; }
        }
      }
    },
    saveCreds: async () => { kaydet('creds', creds); }
  };
}

module.exports = { useSqliteAuthState };

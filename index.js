const { 
  default: makeWASocket, 
  DisconnectReason, 
  fetchLatestBaileysVersion,
  proto,
  initAuthCreds,
  BufferJSON,
  Browsers
} = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');
const QRCode = require('qrcode');
const http = require('http');

// --- QR KOD WEB SUNUCUSU ---
let qrDataURL = null;

const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
  if (req.url === '/qr' && qrDataURL) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>WhatsApp QR Kod</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="refresh" content="8">
          <style>
            body { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f0f2f5; font-family: sans-serif; }
            .card { background: white; padding: 30px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; }
            img { width: 300px; height: 300px; }
            h2 { color: #075e54; margin-bottom: 10px; }
            p { color: #666; font-size: 14px; }
            .badge { background: #e7fce8; color: #0f5132; padding: 6px 12px; border-radius: 20px; font-weight: bold; font-size: 12px; display: inline-block; margin-bottom: 15px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Nakliye Cepte Bot</h2>
            <div class="badge">⚡ Hızlı Eşleşme Modu Aktif</div><br>
            <img src="${qrDataURL}" alt="WhatsApp QR Code" />
            <p><b>WhatsApp -> Bağlı Cihazlar -> Cihaz Bağla</b> diyerek tara.</p>
          </div>
        </body>
      </html>
    `);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nakliye Cepte WhatsApp Botu 7/24 Aktif!');
  }
}).listen(PORT, () => {
  console.log(`🌐 Health-check sunucusu ${PORT} portunda çalışıyor.`);
});

// --- 1. AYARLAR & ORTAM DEĞİŞKENLERİ ---
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fkcmlkbpwpjgdamhtegn.supabase.co'; 
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; 
const TELEGRAM_KANAL_ID = process.env.TELEGRAM_KANAL_ID || '-1003776147836'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- 1.5 SUPABASE JET HIZINDA OTURUM YÖNETİCİSİ (RAM CACHED) ---
async function useSupabaseAuthState(supabase, sessionId = 'default_session') {
  const memoryCache = new Map();

  // İlk açılışta veritabanındaki tüm session verilerini RAM'e yükle
  try {
    const { data: rows } = await supabase
      .from('session')
      .select('id, data')
      .like('id', `%_${sessionId}`);
    
    if (rows) {
      for (const row of rows) {
        try {
          memoryCache.set(row.id, JSON.parse(row.data, BufferJSON.reviver));
        } catch {}
      }
    }
  } catch (err) {
    console.error('Session ilk yükleme hatası:', err.message);
  }

  const writeData = async (id, data) => {
    if (data) {
      memoryCache.set(id, data);
      const value = JSON.stringify(data, BufferJSON.replacer);
      await supabase.from('session').upsert({ id, data: value });
    } else {
      memoryCache.delete(id);
      await supabase.from('session').delete().eq('id', id);
    }
  };

  const readData = async (id) => {
    if (memoryCache.has(id)) return memoryCache.get(id);
    try {
      const { data } = await supabase.from('session').select('data').eq('id', id).single();
      if (!data) return null;
      const parsed = JSON.parse(data.data, BufferJSON.reviver);
      memoryCache.set(id, parsed);
      return parsed;
    } catch {
      return null;
    }
  };

  const creds = (await readData(`creds_${sessionId}`)) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}_${id}_${sessionId}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}_${id}_${sessionId}`;
              tasks.push(writeData(key, value));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: async () => {
      await writeData(`creds_${sessionId}`, creds);
    }
  };
}

// --- 2. HTML METİN TEMİZLEYİCİ ---
function htmlTemizle(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// --- 3. TELEGRAM MESAJ GÖNDERME FONKSİYONU ---
async function telegramaGonder(metin) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_KANAL_ID,
        text: metin,
        parse_mode: 'HTML'
      })
    });
    console.log('🚀 Telegram kanalına yayınlandı!');
  } catch (err) {
    console.error('⚠️ Telegram Gönderim Hatası:', err.message);
  }
}

// --- 4. MÜKERRER MESAJ ENGELLEME ---
const mesajHafizasi = new Map();
const ZAMAN_ASIMI_MS = 15 * 60 * 1000;

function mukerrerMesajMi(mesajMetni) {
  const temizMetin = mesajMetni.trim().toLowerCase();
  const simdi = Date.now();
  for (const [key, timestamp] of mesajHafizasi.entries()) {
    if (simdi - timestamp > ZAMAN_ASIMI_MS) mesajHafizasi.delete(key);
  }
  if (mesajHafizasi.has(temizMetin) && (simdi - mesajHafizasi.get(temizMetin) < ZAMAN_ASIMI_MS)) return true;
  mesajHafizasi.set(temizMetin, simdi);
  return false;
}

// --- 5. AKILLI MESAJ AYRIŞTIRICI ---
function mesajAyristir(mesajMetni) {
  const telRegex = /(?:(?:\+?90)|0)?\s*[5][0-9]{2}\s*[0-9]{3}\s*[0-9]{2}\s*[0-9]{2}/g;
  const telEsllesme = mesajMetni.match(telRegex);
  let telefon = telEsllesme ? telEsllesme[0].replace(/\s+/g, '').replace(/\+90/, '0') : null;

  let aracTipi = 'Belirtilmedi';
  const alt = mesajMetni.toLowerCase();
  if (alt.includes('tır') || alt.includes('tir')) aracTipi = '🚛 TIR';
  else if (alt.includes('kamyonet')) aracTipi = '🛻 Kamyonet';
  else if (alt.includes('kamyon')) aracTipi = '🚚 Kamyon';
  
  return { ham_mesaj: mesajMetni, arac_tipi: aracTipi, telefon: telefon };
}

// --- 6. WHATSAPP BOTU VE DÖNGÜ ---
async function botuBaslat() {
  const { state, saveCreds } = await useSupabaseAuthState(supabase);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.macOS('Desktop'), // Masaüstü tarayıcı kimliği
    syncFullHistory: false,             // KİLİTLENMEYİ ÖNLEYEN EN ÖNEMLİ AYAR (Eski geçmişi indirmeyi engeller)
    markOnlineOnConnect: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr, lastDisconnect } = update;
    
    if (qr) {
      qrDataURL = await QRCode.toDataURL(qr);
      console.log('👉 QR Kod güncellendi: /qr sayfasını kontrol edin.');
    }
    
    if (connection === 'open') {
      qrDataURL = null;
      console.log('✅ WhatsApp Botu Canlı İlanları Dinliyor!');
    }
    
    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        setTimeout(botuBaslat, 3000);
      } else {
        console.log('❌ WhatsApp Oturumu Kapatıldı. Supabase session tablosunu temizleyip tekrar başlatın.');
      }
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe || !msg.key.remoteJid.endsWith('@g.us')) return;

    const mesajMetni = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    if (mesajMetni.length < 10 || mukerrerMesajMi(mesajMetni)) return;

    console.log('\n📩 Yeni İlan Yakalandı: ' + mesajMetni.substring(0, 50) + '...');
    const veriler = mesajAyristir(mesajMetni);

    try {
      const { error } = await supabase.from('ilanlar').insert([{
        ham_mesaj: veriler.ham_mesaj,
        arac_tipi: veriler.arac_tipi !== 'Belirtilmedi' ? veriler.arac_tipi : null,
        telefon: veriler.telefon
      }]);

      if (error) console.error('❌ Supabase Hatası:', error.message);
      else console.log('⚡ Supabase veritabanına eklendi.');
    } catch (e) {
      console.error('Supabase İşlem Hatası:', e.message);
    }

    const telegramMesaj = 
`📦 <b>YENİ NAKLİYE İLANI</b>

📝 <b>İlan Detayı:</b>
${htmlTemizle(veriler.ham_mesaj)}

🚛 <b>Araç Tipi:</b> ${veriler.arac_tipi}
📞 <b>İletişim:</b> ${veriler.telefon || 'İlan metnini inceleyin'}

───────────────
📲 <i>Nakliye Cepte canlı yük akışı</i>`;

    await telegramaGonder(telegramMesaj);
  });
}

botuBaslat();
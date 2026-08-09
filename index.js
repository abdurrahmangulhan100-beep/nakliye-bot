const { 
  default: makeWASocket, 
  DisconnectReason, 
  fetchLatestBaileysVersion,
  initAuthCreds,
  BufferJSON,
  Browsers
} = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');
const QRCode = require('qrcode');
const http = require('http');

// --- 1. QR KOD WEB SUNUCUSU ---
let qrDataURL = null;

const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (req.url === '/qr' && qrDataURL) {
    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>WhatsApp QR Kod</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f0f2f5; font-family: sans-serif; }
            .card { background: white; padding: 30px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; }
            img { width: 280px; height: 280px; border: 4px solid #25d366; border-radius: 12px; padding: 10px; background: #fff; }
            h2 { color: #075e54; margin-bottom: 8px; }
            p { color: #666; font-size: 14px; margin-top: 15px; }
            .badge { background: #e7fce8; color: #0f5132; padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 13px; display: inline-block; margin-bottom: 15px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Nakliye Cepte Bot</h2>
            <div class="badge">⚡ Hızlı Oturum Modu Aktif</div><br>
            <img src="${qrDataURL}" alt="WhatsApp QR Code" />
            <p><b>WhatsApp -> Bağlı Cihazlar -> Cihaz Bağla</b> diyerek okutun.</p>
          </div>
        </body>
      </html>
    `);
  } else {
    res.end('Nakliye Cepte WhatsApp Botu 7/24 Aktif!');
  }
}).listen(PORT, () => {
  console.log(`🌐 Sunucu ${PORT} portunda çalışıyor.`);
});

// --- 2. ORTAM DEĞİŞKENLERİ & SUPABASE ---
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fkcmlkbpwpjgdamhtegn.supabase.co'; 
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZrY21sa2Jwd3BqZ2RhbWh0ZWduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMDkzODgsImV4cCI6MjEwMTc4NTM4OH0.2IQYeMZsICHPGQKBT3M8NCDdQXaqsTMsVxOFcTOrTTw';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8624611315:AAHnYXg9RaaWjumP6jeCBzogVNYe_XQ13xc'; 
const TELEGRAM_KANAL_ID = process.env.TELEGRAM_KANAL_ID || '-1003776147836'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- 3. TEK PARÇA (SINGLE-BLOB) SUPABASE SESSION ADAPTER ---
async function useFastSupabaseAuthState(supabase, sessionId = 'main_session') {
  let sessionData = {};

  try {
    const { data } = await supabase.from('session').select('data').eq('id', sessionId).single();
    if (data && data.data) {
      sessionData = JSON.parse(data.data, BufferJSON.reviver);
    }
  } catch (err) {
    console.log('Yeni oturum oluşturuluyor...');
  }

  const creds = sessionData.creds || initAuthCreds();
  const keys = sessionData.keys || {};

  const saveState = async () => {
    const payload = JSON.stringify({ creds, keys }, BufferJSON.replacer);
    await supabase.from('session').upsert({ id: sessionId, data: payload });
  };

  return {
    state: {
      creds,
      keys: {
        get: (type, ids) => {
          const res = {};
          for (const id of ids) {
            let value = keys[`${type}-${id}`];
            if (type === 'app-state-sync-key' && value) {
              value = require('@whiskeysockets/baileys').proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            res[id] = value;
          }
          return res;
        },
        set: (data) => {
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) {
                keys[key] = value;
              } else {
                delete keys[key];
              }
            }
          }
          saveState(); // Tek seferde veritabanına yaz
        }
      }
    },
    saveCreds: () => {
      saveState();
    }
  };
}

// --- 4. YARDIMCI FONKSİYONLAR ---
function htmlTemizle(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function telegramaGonder(metin) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_KANAL_ID, text: metin, parse_mode: 'HTML' })
    });
    console.log('🚀 Telegram kanalına yayınlandı!');
  } catch (err) {
    console.error('⚠️ Telegram Hatası:', err.message);
  }
}

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

// --- 5. BOTU BAŞLAT ---
async function botuBaslat() {
  const { state, saveCreds } = await useFastSupabaseAuthState(supabase);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: false,
    shouldSyncHistory: () => false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr, lastDisconnect } = update;
    
    if (qr) {
      qrDataURL = await QRCode.toDataURL(qr);
      console.log('👉 Taze QR Kod üretildi: https://nakliyecepte.online/qr');
    }
    
    if (connection === 'open') {
      qrDataURL = null;
      console.log('\n==================================================');
      console.log('✅ NAKLİYE CEPTE WHATSAPP BOTU CANLI İLANLARI DİNLİYOR!');
      console.log('==================================================\n');
    }
    
    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        setTimeout(botuBaslat, 3000);
      } else {
        console.log('❌ Oturum kapatıldı.');
      }
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe || !msg.key.remoteJid.endsWith('@g.us')) return;

    const mesajMetni = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    if (mesajMetni.length < 10) return;

    console.log('📩 Yeni İlan Yakalandı: ' + mesajMetni.substring(0, 50) + '...');
    const veriler = mesajAyristir(mesajMetni);

    try {
      await supabase.from('ilanlar').insert([{
        ham_mesaj: veriler.ham_mesaj,
        arac_tipi: veriler.arac_tipi !== 'Belirtilmedi' ? veriler.arac_tipi : null,
        telefon: veriler.telefon
      }]);
      console.log('⚡ Supabase veritabanına eklendi.');
    } catch (e) {
      console.error('Supabase Hatası:', e.message);
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
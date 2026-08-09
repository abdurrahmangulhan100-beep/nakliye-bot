const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason,
  fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');
const qrcode = require('qrcode-terminal');
const http = require('http'); // 7/24 Sunucu için eklendi

// --- 0. 7/24 BULUT SUNUCU KEEPALIVE (HEALTH CHECK) ---
// Sunucunun botu "çalışmıyor" sanıp kapatmaması için küçük HTTP servisi
const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Nakliye Cepte WhatsApp Botu 7/24 Aktif!');
}).listen(PORT, () => {
  console.log(`🌐 Health-check sunucusu ${PORT} portunda çalışıyor.`);
});

// --- 1. AYARLAR & ORTAM DEĞİŞKENLERİ ---
// Hassas verileri bulut panelinden (Environment Variables) okuyacağız
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fkcmlkbpwpjgdamhtegn.supabase.co'; 
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; 
const TELEGRAM_KANAL_ID = process.env.TELEGRAM_KANAL_ID || '-1003776147836'; 

// Supabase Bağlantısı
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_KANAL_ID,
        text: metin,
        parse_mode: 'HTML'
      })
    });

    const data = await response.json();
    if (data.ok) {
      console.log('🚀 Telegram kanalına başarıyla yayınlandı!');
    } else {
      console.error('❌ Telegram API Hatası:', data.description);
    }
  } catch (err) {
    console.error('⚠️ Telegram Gönderim Hatası:', err.message);
  }
}

// --- 4. MÜKERRER MESAJ ENGELLEME (15 DK) ---
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
  const { state, saveCreds } = await useMultiFileAuthState('whatsapp_oturum');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    browser: ["NakliyeBot", "Chrome", "1.0.0"]
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, qr } = update;
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === 'open') console.log('✅ WhatsApp Botu Canlı İlanları Dinliyor!');
    if (connection === 'close') setTimeout(botuBaslat, 3000);
  });

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe || !msg.key.remoteJid.endsWith('@g.us')) return;

    const mesajMetni = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    if (mesajMetni.length < 10 || mukerrerMesajMi(mesajMetni)) return;

    console.log('\n📩 Yeni İlan Yakalandı: ' + mesajMetni.substring(0, 50) + '...');
    const veriler = mesajAyristir(mesajMetni);

    // 1. Supabase Kayıt (Tablo adının 'ilanlar' olduğundan emin ol)
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

    // 2. Telegram Gönderim
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
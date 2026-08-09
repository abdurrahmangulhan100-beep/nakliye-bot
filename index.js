const { 
  default: makeWASocket, 
  DisconnectReason, 
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  Browsers
} = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');
const QRCode = require('qrcode');
const http = require('http');
const fs = require('fs');
const path = require('path');

const AUTH_DIR = path.join(__dirname, 'auth_info');

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
            <div class="badge">⚡ Hibrit Dosya Modu Aktif</div><br>
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

// --- 2. SUPABASE & TELEGRAM AYARLARI ---
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fkcmlkbpwpjgdamhtegn.supabase.co'; 
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZrY21sa2Jwd3BqZ2RhbWh0egnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMDkzODgsImV4cCI6MjEwMTc4NTM4OH0.2IQYeMZsICHPGQKBT3M8NCDdQXaqsTMsVxOFcTOrTTw';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8624611315:AAHnYXg9RaaWjumP6jeCBzogVNYe_XQ13xc'; 
const TELEGRAM_KANAL_ID = process.env.TELEGRAM_KANAL_ID || '-1003776147836'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- 3. SUPABASE DOSYA YEDEKLEME & YÜKLEME FONKSİYONLARI ---
async function oturumuSupabasedenYukle() {
  try {
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
    
    const { data } = await supabase.from('session').select('data').eq('id', 'auth_files').single();
    if (data && data.data) {
      const files = JSON.parse(data.data);
      for (const [filename, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(AUTH_DIR, filename), content, 'utf8');
      }
      console.log('📁 Eski oturum dosyaları Supabase bulutundan yüklendi.');
    }
  } catch (e) {
    console.log('ℹ️ Bulutta kayıtlı oturum bulunamadı, taze QR oluşturulacak.');
  }
}

async function oturumuSupabaseaYedekle() {
  try {
    if (!fs.existsSync(AUTH_DIR)) return;
    const fileNames = fs.readdirSync(AUTH_DIR);
    const filesData = {};

    for (const fileName of fileNames) {
      const filePath = path.join(AUTH_DIR, fileName);
      if (fs.statSync(filePath).isFile()) {
        filesData[fileName] = fs.readFileSync(filePath, 'utf8');
      }
    }

    await supabase.from('session').upsert({
      id: 'auth_files',
      data: JSON.stringify(filesData)
    });
    console.log('☁️ Oturum dosyaları güvenle Supabase veritabanına yedeklendi.');
  } catch (e) {
    console.error('⚠️ Supabase Yedekleme Hatası:', e.message);
  }
}

// --- 4. SPAM VE İLGİSİZ MESAJ FİLTRESİ ---
const KARA_KELIMELER = [
  'asansör',
  'mobilya',
  'evden eve',
  'kanalını takip edin',
  'whatsapp.com/channel',
  'taşıma görevi',
  'planlanan taşıma',
  'parana sahip çık',
  'şarkışla',
  'lütfen whatsapp üzerinden',
  'mesaj bırakın',
  'satılık',
  'kiralık',
  'devren',
  'eleman',
  'dükkan',
  'şoför aranıyor'
];

function spamMi(mesaj) {
  if (!mesaj || mesaj.length < 15) return true; // Çok kısa mesajlar engellenir
  
  const kucukMesaj = mesaj.toLowerCase();
  
  // Kara kelimelerden biri geçiyorsa engelle
  const karaKelimeVar = KARA_KELIMELER.some(kelime => kucukMesaj.includes(kelime));
  if (karaKelimeVar) return true;

  // Web adresi veya WhatsApp kanal linki içeriyorsa engelle
  if (kucukMesaj.includes('http://') || kucukMesaj.includes('https://') || kucukMesaj.includes('channel')) return true;

  return false;
}

// --- 5. YARDIMCI FONKSİYONLAR ---
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

// --- 6. BOTU BAŞLAT ---
async function botuBaslat() {
  // Önce Supabase'de yedek varsa yerele çek
  await oturumuSupabasedenYukle();

  // Baileys en stabil yerel dosya sistemini kullanır
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: false,
    shouldSyncHistory: () => false
  });

  sock.ev.on('creds.update', async () => {
    await saveCreds();
    await oturumuSupabaseaYedekle(); // Her anahtar değişiminde Supabase'e sync et
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr, lastDisconnect } = update;
    
    if (qr) {
      qrDataURL = await QRCode.toDataURL(qr);
      console.log('👉 QR Kod hazır! /qr sayfasından okutun.');
    }
    
    if (connection === 'open') {
      qrDataURL = null;
      console.log('\n==================================================');
      console.log('✅ WHATSAPP BOTU ANINDA BAĞLANDI VE CANLI DİNLİYOR!');
      console.log('==================================================\n');
      await oturumuSupabaseaYedekle();
    }
    
    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        setTimeout(botuBaslat, 3000);
      } else {
        console.log('❌ Oturum kapatıldı.');
        if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        await supabase.from('session').delete().eq('id', 'auth_files');
      }
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe || !msg.key.remoteJid.endsWith('@g.us')) return;

    const mesajMetni = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

    // 1. SPAM VE ÇÖP MESAJ FİLTRESİ
    if (spamMi(mesajMetni)) {
      console.log('🚫 Çöp/Spam ilan engellendi:', mesajMetni.substring(0, 35) + '...');
      return;
    }

    const veriler = mesajAyristir(mesajMetni);

    // 2. KESİN 1 SAAT (60 DAKİKA) MÜKERRER KONTROLÜ
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      let query = supabase
        .from('ilanlar')
        .select('id')
        .gte('created_at', oneHourAgo);

      if (veriler.telefon) {
        query = query.eq('telefon', veriler.telefon);
      } else {
        query = query.eq('ham_mesaj', veriler.ham_mesaj);
      }

      const { data: mevcutIlanlar } = await query;

      if (mevcutIlanlar && mevcutIlanlar.length > 0) {
        console.log('⏳ Mükerrer İlan: Son 1 saat içinde eklendiği için atlandı.');
        return;
      }
    } catch (err) {
      console.error('⚠️ Mükerrer kontrol hatası:', err.message);
    }

    console.log('📩 Yeni Temiz İlan Yakalandı: ' + mesajMetni.substring(0, 50) + '...');

    // 3. SUPABASE VERİTABANINA EKLE
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

    // 4. TELEGRAM KANALINA GÖNDER
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

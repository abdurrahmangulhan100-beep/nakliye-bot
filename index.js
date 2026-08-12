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

// --- 1. QR KOD VE EŞLEŞTİRME KODU WEB SUNUCUSU ---
let qrDataURL = null;
let currentPairingCode = null;

const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (req.url === '/qr') {
    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>WhatsApp Bağlantı Paneli</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background-color: #f0f2f5; font-family: sans-serif; }
            .card { background: white; padding: 30px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 90%; width: 340px; }
            img { width: 250px; height: 250px; border: 4px solid #25d366; border-radius: 12px; padding: 10px; background: #fff; }
            h2 { color: #075e54; margin-bottom: 8px; }
            p { color: #666; font-size: 14px; margin-top: 15px; }
            .badge { background: #e7fce8; color: #0f5132; padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 13px; display: inline-block; margin-bottom: 15px; }
            .code-box { background: #111b21; color: #00a884; font-size: 28px; font-weight: bold; letter-spacing: 4px; padding: 15px; border-radius: 10px; margin: 15px 0; font-family: monospace; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Nakliye Cepte Bot</h2>
            <div class="badge">⚡ Bağlantı Paneli</div><br>
            
            ${currentPairingCode ? `
              <p><b>📱 EŞLEŞTİRME KODUNUZ:</b></p>
              <div class="code-box">${currentPairingCode}</div>
              <p>WhatsApp -> <b>Bağlı Cihazlar</b> -> <b>Cihaz Bağla</b> -> <b>Telefon Numarası İle Bağla</b> adımlarını izleyip bu kodu girin.</p>
            ` : ''}

            ${qrDataURL ? `
              <img src="${qrDataURL}" alt="WhatsApp QR Code" />
              <p>VEYA kamera ile QR kodu okutun.</p>
            ` : ''}

            ${!currentPairingCode && !qrDataURL ? `
              <p>🟢 Bot bağlı veya QR/Kod oluşturuluyor... Sayfayı yenileyin.</p>
            ` : ''}
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

// --- 2. SUPABASE, TELEGRAM VE TELEFON AYARLARI ---
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fkcmlkbpwpjgdamhtegn.supabase.co'; 
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZrY21sa2Jwd3BqZ2RhbWh0egnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMDkzODgsImV4cCI6MjEwMTc4NTM4OH0.2IQYeMZsICHPGQKBT3M8NCDdQXaqsTMsVxOFcTOrTTw';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8624611315:AAHnYXg9RaaWjumP6jeCBzogVNYe_XQ13xc'; 
const TELEGRAM_KANAL_ID = process.env.TELEGRAM_KANAL_ID || '-1003776147836'; 

const PHONE_NUMBER = process.env.PHONE_NUMBER || '905XXXXXXXXX'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- 3. SUPABASE DOSYA YEDEKLEME & YÜKLEME FONKSİYONLARI ---
async function oturumuSupabasedenYukle() {
  try {
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
    
    const { data, error } = await supabase.from('session').select('data').eq('id', 'auth_files').maybeSingle();
    
    if (error) {
      console.error('⚠️ Supabase Okuma Hatası:', error.message);
      return false;
    }

    if (data && data.data) {
      const files = JSON.parse(data.data);
      let dosyaSayisi = 0;
      for (const [filename, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(AUTH_DIR, filename), content, 'utf8');
        dosyaSayisi++;
      }
      console.log(`📁 Eski oturum dosyaları (${dosyaSayisi} adet) Supabase bulutundan başarıyla yüklendi.`);
      return true;
    } else {
      console.log('ℹ️ Bulutta henüz kayıtlı oturum yok. İlk bağlantı bekleniyor...');
      return false;
    }
  } catch (e) {
    console.error('⚠️ Oturum yükleme sırasında beklenmeyen hata:', e.message);
    return false;
  }
}

async function oturumuSupabaseaYedekle() {
  try {
    if (!fs.existsSync(AUTH_DIR)) return;
    const fileNames = fs.readdirSync(AUTH_DIR);
    if (fileNames.length === 0) return;

    const filesData = {};
    for (const fileName of fileNames) {
      const filePath = path.join(AUTH_DIR, fileName);
      if (fs.statSync(filePath).isFile()) {
        filesData[fileName] = fs.readFileSync(filePath, 'utf8');
      }
    }

    const { error } = await supabase.from('session').upsert({
      id: 'auth_files',
      data: JSON.stringify(filesData)
    });

    if (error) {
      console.error('⚠️ Supabase Yedekleme Hatası:', error.message);
    } else {
      console.log('☁️ Oturum dosyaları güvenle Supabase veritabanına yedeklendi.');
    }
  } catch (e) {
    console.error('⚠️ Supabase İstisna Hatası:', e.message);
  }
}

// --- 4. SPAM VE İLGİSİZ MESAJ FİLTRESİ ---
const KARA_KELIMELER = [
  'asansör', 'mobilya', 'evden eve', 'kanalını takip edin', 'whatsapp.com/channel',
  'taşıma görevi', 'planlanan taşıma', 'parana sahip çık', 'şarkışla', 'lütfen whatsapp üzerinden',
  'mesaj bırakın', 'satılık', 'kiralık', 'devren', 'eleman', 'dükkan', 'şoför aranıyor',
  'sohbet', 'grup kuralları', 'admin'
];

function spamMi(mesaj) {
  if (!mesaj) return true;
  if (mesaj.length < 15 || mesaj.length > 2500) return true;
  
  const kucukMesaj = mesaj.toLowerCase('tr-TR');
  const karaKelimeVar = KARA_KELIMELER.some(kelime => kucukMesaj.includes(kelime.toLowerCase('tr-TR')));
  if (karaKelimeVar) return true;

  if (kucukMesaj.includes('http://') || kucukMesaj.includes('https://') || kucukMesaj.includes('channel')) return true;

  return false;
}

// --- 5. ULTRA HIZLI İKİNCİL (MÜKERRER) İLAN BLOKLAYICI (RAM CACHE) ---
const ilaniSuresiDolanaKadarEngelle = new Map();
const BIR_SAAT_MS = 60 * 60 * 1000;

function mukerrerIlanMi(telefon, mesajMetni) {
  const simdi = Date.now();
  const anahtar = telefon ? `tel_${telefon}` : `txt_${mesajMetni.trim().substring(0, 60)}`;

  if (ilaniSuresiDolanaKadarEngelle.has(anahtar)) {
    const kayitZamani = ilaniSuresiDolanaKadarEngelle.get(anahtar);
    if (simdi - kayitZamani < BIR_SAAT_MS) {
      return true;
    }
  }

  ilaniSuresiDolanaKadarEngelle.set(anahtar, simdi);

  if (ilaniSuresiDolanaKadarEngelle.size > 2000) {
    for (const [k, v] of ilaniSuresiDolanaKadarEngelle.entries()) {
      if (simdi - v >= BIR_SAAT_MS) {
        ilaniSuresiDolanaKadarEngelle.delete(k);
      }
    }
  }

  return false;
}

// --- 6. YARDIMCI FONKSİYONLAR & ŞEHİR PARSER ---
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

const SEHIRLER = [
  "Adana", "Adıyaman", "Afyonkarahisar", "Ağrı", "Amasya", "Ankara", "Antalya", "Artvin", "Aydın", "Balıkesir",
  "Bilecik", "Bingöl", "Bitlis", "Bolu", "Burdur", "Bursa", "Çanakkale", "Çankırı", "Çorum", "Denizli",
  "Diyarbakır", "Edirne", "Elazığ", "Erzincan", "Erzurum", "Eskişehir", "Gaziantep", "Giresun", "Gümüşhane", "Hakkari",
  "Hatay", "Isparta", "Mersin", "İstanbul", "İzmir", "Kars", "Kastamonu", "Kayseri", "Kırklareli", "Kırşehir",
  "Kocaeli", "Konya", "Kütahya", "Malatya", "Manisa", "Kahramanmaraş", "Mardin", "Muğla", "Muş", "Nevşehir",
  "Niğde", "Ordu", "Rize", "Sakarya", "Samsun", "Siirt", "Sinop", "Sivas", "Tekirdağ", "Tokat",
  "Trabzon", "Tunceli", "Şanlıurfa", "Uşak", "Van", "Yozgat", "Zonguldak", "Aksaray", "Bayburt", "Karaman",
  "Kırıkkale", "Batman", "Şırnak", "Bartın", "Ardahan", "Iğdır", "Yalova", "Karabük", "Kilis", "Osmaniye", "Düzce"
];

function mesajAyristir(mesajMetni) {
  const telRegex = /(?:(?:\+?90)|0)?\s*[5][0-9]{2}\s*[0-9]{3}\s*[0-9]{2}\s*[0-9]{2}/g;
  const telEsllesme = mesajMetni.match(telRegex);
  let telefon = telEsllesme ? telEsllesme[0].replace(/\s+/g, '').replace(/\+90/, '0') : null;

  let aracTipi = 'Belirtilmedi';
  const alt = mesajMetni.toLowerCase('tr-TR');
  
  if (alt.includes('tır') || alt.includes('tir')) aracTipi = 'TIR';
  else if (alt.includes('kamyonet')) aracTipi = 'Kamyonet';
  else if (alt.includes('kamyon')) aracTipi = 'Kamyon';
  else if (alt.includes('kırkayak') || alt.includes('kirkayak')) aracTipi = 'Kırkayak';
  else if (alt.includes('damper')) aracTipi = 'Damperli';
  else if (alt.includes('dorse')) aracTipi = 'Dorse';
  else if (alt.includes('panelvan')) aracTipi = 'Panelvan';

  let nereden = null;
  let nereye = null;

  const bulunanSehirler = [];
  SEHIRLER.forEach(sehir => {
    const regex = new RegExp(`\\b${sehir}\\b`, 'i');
    const match = mesajMetni.match(regex);
    if (match) {
      bulunanSehirler.push({ sehir, index: match.index });
    }
  });

  bulunanSehirler.sort((a, b) => a.index - b.index);

  if (bulunanSehirler.length >= 2) {
    nereden = bulunanSehirler[0].sehir;
    nereye = bulunanSehirler[1].sehir;
  } else if (bulunanSehirler.length === 1) {
    nereden = bulunanSehirler[0].sehir;
  }

  return { 
    ham_mesaj: mesajMetni, 
    arac_tipi: aracTipi, 
    telefon: telefon,
    nereden: nereden,
    nereye: nereye
  };
}

// --- 7. BOTU BAŞLAT ---
async function botuBaslat() {
  console.log('🔄 Oturum dosyaları kontrol ediliyor...');
  await oturumuSupabasedenYukle();

  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false,
    shouldSyncHistory: () => false
  });

  if (!sock.authState.creds.registered && PHONE_NUMBER && PHONE_NUMBER !== '905XXXXXXXXX') {
    setTimeout(async () => {
      try {
        const temizTel = PHONE_NUMBER.replace(/[^0-9]/g, '');
        const code = await sock.requestPairingCode(temizTel);
        currentPairingCode = code?.match(/.{1,4}/g)?.join("-") || code;
        
        console.log('\n==================================================');
        console.log(`👉 EŞLEŞTİRME KODUNUZ: ${currentPairingCode}`);
        console.log('==================================================\n');
      } catch (err) {
        console.error('⚠️ Pairing Code üretilemedi:', err.message);
      }
    }, 3000);
  }

  sock.ev.on('creds.update', async () => {
    await saveCreds();
    await oturumuSupabaseaYedekle();
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr, lastDisconnect } = update;
    if (qr) qrDataURL = await QRCode.toDataURL(qr);
    
    if (connection === 'open') {
      qrDataURL = null;
      currentPairingCode = null;
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

    if (spamMi(mesajMetni)) return;

    const veriler = mesajAyristir(mesajMetni);

    if (mukerrerIlanMi(veriler.telefon, veriler.ham_mesaj)) {
      console.log('⏳ Mükerrer İlan atlandı.');
      return;
    }

    console.log('📩 Yeni Temiz İlan Yakalandı: ' + mesajMetni.substring(0, 40) + '...');

    // --- DÜZELTİLEN SUPABASE EKLEME BLOĞU ---
    const { data, error } = await supabase.from('ilanlar').insert([{
      ham_mesaj: veriler.ham_mesaj,
      nereden: veriler.nereden,
      nereye: veriler.nereye,
      arac_tipi: veriler.arac_tipi !== 'Belirtilmedi' ? veriler.arac_tipi : null,
      telefon: veriler.telefon
    }]);

    if (error) {
      console.error('❌ SUPABASE GERÇEK HATA METNİ:', error.message, error.details, error.hint);
    } else {
      console.log('⚡ Supabase veritabanına BAŞARIYLA eklendi!');
    }

    // Telegram Bildirimi
    const telegramMesaj = 
`📦 <b>YENİ NAKLİYE İLANI</b>

📍 <b>Rota:</b> ${veriler.nereden || 'Belirtilmedi'} ➡️ ${veriler.nereye || 'Belirtilmedi'}
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

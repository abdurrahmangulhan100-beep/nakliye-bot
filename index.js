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
const crypto = require('crypto');

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
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tlnkimstwtqkbhsgdoql.supabase.co'; 
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRsbmtpbXN0d3Rxa2Joc2dkb3FsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4ODI2OTYsImV4cCI6MjEwMjQ1ODY5Nn0.s5RYB22tlCxkUKuI3-cg7NETISlyL7zdEqjUAYyHq0s';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8624611315:AAHnYXg9RaaWjumP6jeCBzogVNYe_XQ13xc'; 
const TELEGRAM_KANAL_ID = process.env.TELEGRAM_KANAL_ID || '-1003776147836'; 

const PHONE_NUMBER = process.env.PHONE_NUMBER || '905XXXXXXXXX'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- 3. BATCHING & KUYRUK MİMARİSİ (SUPABASE PERFORMANS ÇÖZÜMÜ) ---
let insertQueue = [];

async function flushInsertQueue() {
  if (insertQueue.length === 0) return;

  const toInsert = [...insertQueue];
  insertQueue = []; // Kuyruğu hemen boşalt

  try {
    const { error } = await supabase.from('ilanlar').insert(toInsert);
    if (error) {
      console.error('❌ SUPABASE BATCH EKLEME HATASI:', error.message);
    } else {
      console.log(`⚡ Supabase'e Toplu Eklendi! (${toInsert.length} Adet İlan)`);
    }
  } catch (e) {
    console.error('⚠️ Supabase Toplu İstisna Hatası:', e.message);
  }
}

// 10 saniyede bir biriken verileri veritabanına tek sorguyla at
setInterval(flushInsertQueue, 10000);

// --- 4. SUPABASE DOSYA YEDEKLEME (LİMİTLENMİŞ YENİ VERSİYON) ---
let lastAuthBackupTime = 0;

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
      console.log(`📁 Eski oturum dosyaları (${dosyaSayisi} adet) Supabase bulutundan yüklendi.`);
      return true;
    } else {
      console.log('ℹ️ Bulutta henüz kayıtlı oturum yok. İlk bağlantı bekleniyor...');
      return false;
    }
  } catch (e) {
    console.error('⚠️ Oturum yükleme hatası:', e.message);
    return false;
  }
}

async function oturumuSupabaseaYedekle(force = false) {
  const simdi = Date.now();
  // Sadece zorunlu durumlarda veya en az 5 dakikada bir veritabanına yaz (Disk IO koruması)
  if (!force && simdi - lastAuthBackupTime < 5 * 60 * 1000) return;

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
      lastAuthBackupTime = simdi;
      console.log('☁️ Oturum dosyaları Supabase veritabanına yedeklendi.');
    }
  } catch (e) {
    console.error('⚠️ Supabase İstisna Hatası:', e.message);
  }
}

// --- 5. DERİN MESAJ AYRIŞTIRICI ---
function mesajMetniniCikar(messageObj) {
  if (!messageObj) return '';
  let msg = messageObj;

  if (msg.ephemeralMessage?.message) msg = msg.ephemeralMessage.message;
  if (msg.viewOnceMessage?.message) msg = msg.viewOnceMessage.message;
  if (msg.viewOnceMessageV2?.message) msg = msg.viewOnceMessageV2.message;
  if (msg.documentWithCaptionMessage?.message) msg = msg.documentWithCaptionMessage.message;

  return (
    msg?.conversation ||
    msg?.extendedTextMessage?.text ||
    msg?.imageMessage?.caption ||
    msg?.videoMessage?.caption ||
    msg?.documentMessage?.caption ||
    msg?.protocolMessage?.editedMessage?.conversation ||
    msg?.protocolMessage?.editedMessage?.extendedTextMessage?.text ||
    ''
  );
}

// --- 6. GELİŞMİŞ SPAM FİLTRESİ ---
const KARA_KELIMELER = [
  // 1. Kullanıcı Tarafından İstenen İlçe/Konum Filtresi
  'kızıltepe', 'kiziltepe',

  // 2. Evden Eve, Asansör & Mobilya (Şehirler Arası Ticari Yük Dışı)
  'asansör', 'asansor', 'mobilya', 'evden eve', 'ev taşıma', 'ev tasima', 'parça eşya', 'parca esya',
  'nakliyat', 'şehir içi nakliye', 'sehir ici nakliye', 'çeyiz', 'ceyiz', 'ofis taşıma', 'ofis tasima',

  // 3. Grup / Kanal Takip & Link Davet Reklamları
  'kanalını takip edin', 'kanalini takip edin', 'whatsapp.com/channel', 'chat.whatsapp.com',
  't.me/', 'telegram.me/', 'gruba katıl', 'gruba katil', 'grup daveti', 'takip edin',
  'tıkla katıl', 'tikla katil', 'linke tıkla', 'linke tikla',

  // 4. Otomatik Bot Mesajları, Şablon İfadeler & Scam Kelimeler
  'taşıma görevi', 'tasima gorevi', 'planlanan taşıma', 'planlanan tasima',
  'parana sahip çık', 'parana sahip cik', 'lütfen whatsapp üzerinden', 'lutfen whatsapp uzerinden',
  'mesaj bırakın', 'mesaj birakin', 'güvenli ödeme', 'guvenli odeme', 'ödeme garantisi', 'odeme garantisi',
  'kapora', 'sadece whatsapp', 'dm atın', 'dm atin', 'özelden yazın', 'ozelden yazin',

  // 5. Araç & Dükkan Satış/Kiralama / Otomotiv Reklamları
  'satılık', 'satilik', 'kiralık', 'kiralik', 'devren', 'dükkan', 'dukkan',
  'araba', 'otomobil', 'sahibinden', 'ekspertiz', 'hasar kayıtsız', 'hasar kayitsiz',
  'boyasız', 'boyasiz', 'tramersiz', 'takaslı', 'takasli', 'temiz araç', 'temiz arac',

  // 6. Personel & İş İlanları (Sürücü, Şoför, Eleman Arayanlar)
  'eleman', 'şoför aranıyor', 'sofor araniyor', 'şoför alımı', 'sofor alimi',
  'kaptan aranıyor', 'kaptan araniyor', 'maaşlı', 'maasli', 'personel', 'iş aranıyor', 'is araniyor',
  'iş ilanı', 'is ilani', 'çalışma arkadaşı', 'calisma arkadasi', 'usta aranıyor', 'usta araniyor',

  // 7. Grup İçi Sohbet, Selamlaşma & Yönetim İfadeleri
  'sohbet', 'grup kuralları', 'grup kurallari', 'admin', 'yönetici', 'yonetici',
  'hayırlı cumalar', 'hayirli cumalar', 'günaydın', 'gunaydin', 'iyi akşamlar', 'iyi aksamlar',
  'hayırlı işler', 'hayirli isler', 'bereketli olsun', 'selamun aleyküm', 'selamun aleykum',
  'sa', 'as', 'merhaba', 'arkadaşlar', 'arkadaslar', 'hoşgeldin', 'hosgeldin',

  // 8. İkinci El Eşya & Ticari Ürün Satışları
  'yedek parça', 'yedek parca', 'çıkma', 'cikma', 'lastik', 'jant', 'akü', 'aku',
  'palet satılık', 'palet satilik', 'hurda', 'mazot', 'dizel', 'fatura kesilir', 'fatura mevcuttur'
];

function spamMi(mesaj) {
  if (!mesaj) return true;
  if (mesaj.length < 10 || mesaj.length > 3000) return true;
  
  const kucukMesaj = mesaj.toLowerCase('tr-TR');
  const karaKelimeVar = KARA_KELIMELER.some(kelime => kucukMesaj.includes(kelime.toLowerCase('tr-TR')));
  if (karaKelimeVar) return true;

  if (kucukMesaj.includes('http://') || kucukMesaj.includes('https://') || kucukMesaj.includes('channel')) return true;

  return false;
}

// --- 7. MÜKERRER İLAN BLOKLAYICI ---
const ilaniSuresiDolanaKadarEngelle = new Map();
const MESAJ_ENGEL_SURESI_MS = 20 * 60 * 1000;

function mukerrerIlanMi(mesajMetni) {
  if (!mesajMetni) return true;
  const simdi = Date.now();
  
  const temizMetin = mesajMetni
    .toLowerCase('tr-TR')
    .replace(/[^a-z0-9ğüşıöç]/g, '');
    
  if (temizMetin.length < 8) return true;

  const mesajHash = crypto.createHash('md5').update(temizMetin).digest('hex');
  const anahtar = `msg_${mesajHash}`;

  if (ilaniSuresiDolanaKadarEngelle.has(anahtar)) {
    const kayitZamani = ilaniSuresiDolanaKadarEngelle.get(anahtar);
    if (simdi - kayitZamani < MESAJ_ENGEL_SURESI_MS) {
      return true;
    }
  }

  ilaniSuresiDolanaKadarEngelle.set(anahtar, simdi);

  if (ilaniSuresiDolanaKadarEngelle.size > 4000) {
    for (const [k, v] of ilaniSuresiDolanaKadarEngelle.entries()) {
      if (simdi - v >= MESAJ_ENGEL_SURESI_MS) {
        ilaniSuresiDolanaKadarEngelle.delete(k);
      }
    }
  }

  return false;
}

// --- 8. GELİŞMİŞ ŞEHİR / İLÇE / KISALTMA VERİSİ VE PARSER ---

const KISALTMALAR = {
  'kny': { il: 'Konya' },
  'ist': { il: 'İstanbul' },
  'izmir': { il: 'İzmir' },
  'ank': { il: 'Ankara' },
  'adana': { il: 'Adana' },
  'antep': { il: 'Gaziantep' },
  'g.antep': { il: 'Gaziantep' },
  'maras': { il: 'Kahramanmaraş' },
  'k.maras': { il: 'Kahramanmaraş' },
  'urfa': { il: 'Şanlıurfa' },
  's.urfa': { il: 'Şanlıurfa' },
  'egl': { il: 'Konya', ilce: 'Ereğli' },
  'gebze': { il: 'Kocaeli', ilce: 'Gebze' },
  'corlu': { il: 'Tekirdağ', ilce: 'Çorlu' },
  'iskenderun': { il: 'Hatay', ilce: 'İskenderun' },
  'inegol': { il: 'Bursa', ilce: 'İnegöl' }
};

const ILCE_IL_HARITASI = {
  'ereğli': 'Konya', 'eregli': 'Konya', 'ilgın': 'Konya', 'ilgin': 'Konya',
  'akşehir': 'Konya', 'aksehir': 'Konya', 'karapınar': 'Konya', 'karapinar': 'Konya',
  'seydişehir': 'Konya', 'seydisehir': 'Konya', 'beyşehir': 'Konya', 'beysehir': 'Konya',
  'kulu': 'Konya', 'cihanbeyli': 'Konya', 'çumra': 'Konya', 'cumra': 'Konya', 'doğanhisar': 'Konya',
  'gebze': 'Kocaeli', 'dilovası': 'Kocaeli', 'körfez': 'Kocaeli',
  'çorlu': 'Tekirdağ', 'çerkezköy': 'Tekirdağ', 'iskenderun': 'Hatay',
  'ceyhan': 'Adana', 'bandırma': 'Balıkesir', 'inegöl': 'Bursa', 'nazilli': 'Aydın',
  'söke': 'Aydın', 'aliağa': 'İzmir', 'torbalı': 'İzmir', 'menemen': 'İzmir',
  'polatlı': 'Ankara', 'kazan': 'Ankara', 'çubuk': 'Ankara', 'tarsus': 'Mersin',
  'turgutlu': 'Manisa', 'salihli': 'Manisa', 'akhisar': 'Manisa', 'kızıltepe': 'Mardin'
};

const ILLER = [
  "Adana", "Adıyaman", "Afyonkarahisar", "Ağrı", "Amasya", "Ankara", "Antalya", "Artvin", "Aydın", "Balıkesir",
  "Bilecik", "Bingöl", "Bitlis", "Bolu", "Burdur", "Bursa", "Çanakkale", "Çankırı", "Çorum", "Denizli",
  "Diyarbakır", "Edirne", "Elazığ", "Erzincan", "Erzurum", "Eskişehir", "Gaziantep", "Giresun", "Gümüşhane", "Hakkari",
  "Hatay", "Isparta", "Mersin", "İstanbul", "İzmir", "Kars", "Kastamonu", "Kayseri", "Kırklareli", "Kırşehir",
  "Kocaeli", "Konya", "Kütahya", "Malatya", "Manisa", "Kahramanmaraş", "Mardin", "Muğla", "Muş", "Nevşehir",
  "Niğde", "Ordu", "Rize", "Sakarya", "Samsun", "Siirt", "Sinop", "Sivas", "Tekirdağ", "Tokat",
  "Trabzon", "Tunceli", "Şanlıurfa", "Uşak", "Van", "Yozgat", "Zonguldak", "Aksaray", "Bayburt", "Karaman",
  "Kırıkkale", "Batman", "Şırnak", "Bartın", "Ardahan", "Iğdır", "Yalova", "Karabük", "Kilis", "Osmaniye", "Düzce"
];

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

function gelismisMesajAyristir(mesajMetni) {
  const telRegex = /(?:(?:\+?90)|0)?\s*[5][0-9]{2}\s*[0-9]{3}\s*[0-9]{2}\s*[0-9]{2}/g;
  const telEsllesmeler = mesajMetni.match(telRegex);
  let telefon = null;
  if (telEsllesmeler && telEsllesmeler.length > 0) {
    telefon = telEsllesmeler.map(t => t.replace(/\s+/g, '').replace(/\+90/, '0')).join(' / ');
  }

  let aracTipi = 'Belirtilmedi';
  const alt = mesajMetni.toLowerCase('tr-TR');
  if (alt.includes('tır') || alt.includes('tir')) aracTipi = 'TIR';
  else if (alt.includes('kamyonet')) aracTipi = 'Kamyonet';
  else if (alt.includes('kamyon')) aracTipi = 'Kamyon';
  else if (alt.includes('kırkayak') || alt.includes('kirkayak')) aracTipi = 'Kırkayak';
  else if (alt.includes('damper')) aracTipi = 'Damperli';
  else if (alt.includes('dorse')) aracTipi = 'Dorse';
  else if (alt.includes('panelvan')) aracTipi = 'Panelvan';

  const tespitEdilenler = [];

  for (const [kisaltma, bilgi] of Object.entries(KISALTMALAR)) {
    const reg = new RegExp(`\\b${kisaltma}\\b`, 'i');
    const m = mesajMetni.match(reg);
    if (m) {
      tespitEdilenler.push({ il: bilgi.il, ilce: bilgi.ilce || null, index: m.index });
    }
  }

  for (const [ilce, bagliIl] of Object.entries(ILCE_IL_HARITASI)) {
    const reg = new RegExp(`\\b${ilce}\\b`, 'i');
    const m = mesajMetni.match(reg);
    if (m) {
      tespitEdilenler.push({ il: bagliIl, ilce: ilce.charAt(0).toUpperCase() + ilce.slice(1), index: m.index });
    }
  }

  ILLER.forEach(il => {
    const reg = new RegExp(`\\b${il}\\b`, 'i');
    const m = mesajMetni.match(reg);
    if (m) {
      tespitEdilenler.push({ il: il, ilce: null, index: m.index });
    }
  });

  tespitEdilenler.sort((a, b) => a.index - b.index);

  const benzersiz = [];
  tespitEdilenler.forEach(item => {
    if (!benzersiz.some(b => b.il === item.il && b.ilce === item.ilce)) {
      benzersiz.push(item);
    }
  });

  let kalkis_ili = null, kalkis_ilcesi = null;
  let varis_ili = null, varis_ilcesi = null;

  if (benzersiz.length >= 2) {
    kalkis_ili = benzersiz[0].il;
    kalkis_ilcesi = benzersiz[0].ilce;
    varis_ili = benzersiz[1].il;
    varis_ilcesi = benzersiz[1].ilce;
  } else if (benzersiz.length === 1) {
    kalkis_ili = benzersiz[0].il;
    kalkis_ilcesi = benzersiz[0].ilce;
  }

  return {
    ham_mesaj: mesajMetni,
    arac_tipi: aracTipi,
    telefon: telefon,
    kalkis_ili,
    kalkis_ilcesi,
    varis_ili,
    varis_ilcesi,
    nereden: kalkis_ilcesi ? `${kalkis_ili} / ${kalkis_ilcesi}` : kalkis_ili,
    nereye: varis_ilcesi ? `${varis_ili} / ${varis_ilcesi}` : varis_ili
  };
}

// --- 9. BOTU BAŞLAT ---
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
    await oturumuSupabaseaYedekle(false); // Sadece 5 dakikada bir veritabanına yazar
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
      await oturumuSupabaseaYedekle(true); // Bağlantı kurulunca bir kere zorunlu yedekle
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
    if (!msg || !msg.message || msg.key.fromMe || !msg.key.remoteJid?.endsWith('@g.us')) return;

    const mesajMetni = mesajMetniniCikar(msg.message);

    if (spamMi(mesajMetni)) return;

    if (mukerrerIlanMi(mesajMetni)) {
      console.log('⏳ Mükerrer/Tekrarlayan İlan atlandı.');
      return;
    }

    const veriler = gelismisMesajAyristir(mesajMetni);

    console.log('📩 Yeni İlan Parse Edildi: ' + mesajMetni.substring(0, 40).replace(/\n/g, ' ') + '...');

    // SUPABASE İÇİN NESNEYİ KUYRUĞA EKLE (DOĞRUDAN INSERT YAPMAZ)
    insertQueue.push({
      ham_mesaj: veriler.ham_mesaj,
      nereden: veriler.nereden,
      nereye: veriler.nereye,
      kalkis_ili: veriler.kalkis_ili,
      kalkis_ilcesi: veriler.kalkis_ilcesi,
      varis_ili: veriler.varis_ili,
      varis_ilcesi: veriler.varis_ilcesi,
      arac_tipi: veriler.arac_tipi !== 'Belirtilmedi' ? veriler.arac_tipi : null,
      telefon: veriler.telefon
    });

    // Kuyruk 15 elemana ulaştıysa hemen yaz (10 saniye beklemeden)
    if (insertQueue.length >= 15) {
      flushInsertQueue();
    }

    // TELEGRAM BİLDİRİMİ ( Telegram API'si sınırlamalardan etkilenmez )
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

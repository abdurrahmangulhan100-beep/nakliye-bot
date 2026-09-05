// --- 0. NODE.JS ÇÖKME KORUMASI (ANTI-CRASH) ---
process.on('uncaughtException', (err) => {
  console.error('🔥 Beklenmeyen Kritik Hata (Uygulama çökmekten kurtarıldı):', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 Yakalanamayan Promise Hatası:', reason);
});

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
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8624611315:AAHnYXg9RaaWjumP6jeCBzogVNYe_XQ13xc'; 
const TELEGRAM_KANAL_ID = process.env.TELEGRAM_KANAL_ID || '-1003776147836'; 
const PHONE_NUMBER = process.env.PHONE_NUMBER || '905XXXXXXXXX'; 

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hqeaakpyqesxewvkxptf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhxZWFha3B5cWVzeGV3dmt4cHRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxNDMwMzMsImV4cCI6MjEwMjcxOTAzM30.QUi3fYgcJUVzMyldFUtjXLRTa6v2XshO-756aMfruxI';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- 3. DERİN MESAJ AYRIŞTIRICI ---
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

// --- 4. ULTRASONİK TÜRKÇE VE UNICODE NORMALİZATÖRÜ ---
function metniNormalizeEt(text) {
  if (!text) return '';
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .toLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/i̇/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- 5. LOKASYON KÜTÜPHANESİ VE PRE-COMPILED REGEX'LER ---
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
  'turgutlu': 'Manisa', 'salihli': 'Manisa', 'akhisar': 'Manisa', 'kızıltepe': 'Mardin',
  'silivri': 'İstanbul', 'esenyurt': 'İstanbul', 'nilüfer': 'Bursa', 'nilufer': 'Bursa'
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

const PRECOMPILED_KISALTMALAR = Object.entries(KISALTMALAR).map(([kisaltma, bilgi]) => ({
  regex: new RegExp(`\\b${kisaltma}\\b`, 'i'),
  il: bilgi.il,
  ilce: bilgi.ilce || null
}));

const PRECOMPILED_ILCE_IL = Object.entries(ILCE_IL_HARITASI).map(([ilce, bagliIl]) => ({
  regex: new RegExp(`\\b${ilce}\\b`, 'i'),
  ilce: ilce.charAt(0).toUpperCase() + ilce.slice(1),
  il: bagliIl
}));

const PRECOMPILED_ILLER = ILLER.map(il => ({
  regex: new RegExp(`\\b${il}\\b`, 'i'),
  il: il
}));

const TEL_REGEX = /(?:(?:\+?90)|0)?\s*[5][0-9]{2}\s*[0-9]{3}\s*[0-9]{2}\s*[0-9]{2}/g;

// --- 6. GELİŞMİŞ SPAM VE BOT FİLTRESİ (GÜNCELLENDİ) ---
const KARA_KELIMELER_HAM = [
  // Evden Eve / Mobilya
  'evden eve', 'ev tasima', 'parca esya', 'ceyiz tasima', 'ofis tasima', 'asansorlu nakliyat',

  // Grup / Kanal Reklamları & Linkler
  'whatsapp com', 'chat whatsapp', 't me', 'telegram me', 'gruba katil',
  'grup daveti', 'kanalini takip', 'tikla katil', 'linke tikla', 'wa me', 'joinchat',

  // Dolandırıcılık / Kapora Uyarıları
  'parana sahip cik', 'guvenli odeme', 'odeme garantisi', 'kapora',

  // Araç / Gayrimenkul Satışı
  'satilik dukkan', 'devren dukkan', 'satilik araba',
  'hasar kayitsiz', 'tramersiz', 'takasli', 'ekspertiz',

  // Personel / İş Arayanlar
  'sofor araniyor', 'sofor alimi', 'kaptan araniyor',
  'maasli personel', 'usta araniyor', 'calisma arkadasi',
  
  // KESİN YASAKLANAN OTOMATİK BOT VE YÜK TAŞIMA KALIPLARI
  'bugunku yuk', 'bugunku lojistik gorevi', 'bugunku yuk tasima isi', 'bugunku yuk tasima',
  'bugun lojistik gorevi', 'bugun yuk tasima isi', 'bugun yuk tasima', 'bugun yuk',
  'lojistik gorevi', 'yuk tasima isi', 'tasima gorevi', 'tasima isi',
  'nakliye yuku', 'qmove', 'kaliteli yuk', 'tasima programi', 'bugunun kaliteli',
  'yapilacak sevkiyat', 'planlanan tasima', 'yuk havuzu',
  'canli yuk', 'sevkiyat listesi', 'otomatik paylasim', 
  'bugun yukler', 'bugun ku yuk', 'odemeler pesin',

  // Grup İçi Genel Sohbet
  'grup kurallari', 'hayirli cumalar', 'bereketli olsun', 'selamun aleykum', 'hayirli isler'
];

const KARA_KELIMELER = KARA_KELIMELER_HAM.map(k => metniNormalizeEt(k));

// Kesin Engelleyici Regex Kalıpları
const KARA_REGEX = [
  /bugun.*(nakliye|yuk|lojistik|sevkiyat|gorev|gorevi)/i,
  /bugunku.*(nakliye|yuk|lojistik|sevkiyat|gorev|gorevi)/i,
  /(bugunku|bugun\s*icin)\s*(yuk|nakliye|lojistik|tasima)/i,
  /yuk\s*tasima\s*isi/i,
  /(tasima|lojistik)\s*gorevi/i,
  /yuk.*havuzu/i, 
  /canli.*yuk/i,
  /sevkiyat.*listesi/i, 
  /otomatik.*paylasim/i, 
  /evden.*eve/i,
  /parca.*esya/i, 
  /sofor.*aran/i, 
  /kapora/i, 
  /guvenli.*odeme/i
];

function spamMi(mesaj) {
  if (!mesaj) return true;
  if (mesaj.length < 10 || mesaj.length > 2500) return true;
  
  const harfSayisi = (mesaj.match(/[a-zA-ZğüşıöçĞÜŞİÖÇ]/g) || []).length;
  if (harfSayisi < 5) return true; 

  const temizMesaj = metniNormalizeEt(mesaj);
  
  // 1. Kara Regex Taraması
  if (KARA_REGEX.some(regex => regex.test(temizMesaj))) {
    console.log('🚮 Spam Engellendi (Bot Kalıbı/Kara Regex):', mesaj.substring(0, 45).replace(/\n/g, ' '));
    return true;
  }

  // 2. Kara Kelimeler Taraması
  const yakalanan = KARA_KELIMELER.find(kelime => temizMesaj.includes(kelime));
  if (yakalanan) {
    console.log(`🚮 Spam Engellendi [Yasaklı İfade: "${yakalanan}"]:`, mesaj.substring(0, 45).replace(/\n/g, ' '));
    return true;
  }

  // 3. Reklam / Link Taraması
  if (temizMesaj.includes('http') || temizMesaj.includes('https') || temizMesaj.includes('channel') || temizMesaj.includes('t me') || temizMesaj.includes('wa me')) {
    console.log('🚮 Spam Engellendi (Link İÇeriyor):', mesaj.substring(0, 30));
    return true;
  }

  // 4. Parsiyel Yığılması Kontrolü
  const parsiyelSayisi = (temizMesaj.match(/parsiyel/g) || []).length;
  if (parsiyelSayisi >= 2) {
    console.log('🚮 Spam Engellendi (Çoklu Parsiyel):', mesaj.substring(0, 35).replace(/\n/g, ' '));
    return true;
  }

  // 5. Lokasyon Yığılması Kontrolü (Toplu İlan Botlarını Süzme)
  const ayristirilan = gelismisMesajAyristir(mesaj);
  if (ayristirilan.toplam_lokasyon_sayisi >= 3) {
    console.log(`🚮 Spam Engellendi (Toplu Bot Liste - ${ayristirilan.toplam_lokasyon_sayisi} Lokasyon):`, mesaj.substring(0, 35).replace(/\n/g, ' '));
    return true;
  }

  // 6. Çoklu Tonaj Kontrolü
  const tonajMatches = temizMesaj.match(/[0-9]+(?:[\.,][0-9]+)?\s*(?:ton|kg|tonluk)/g) || [];
  if (tonajMatches.length >= 2) {
    console.log(`🚮 Spam Engellendi (Çoklu Tonaj Listesi - ${tonajMatches.length} adet):`, mesaj.substring(0, 35).replace(/\n/g, ' '));
    return true;
  }

  return false;
}

// --- 7. PARMAK İZİ BAZLI MÜKERRER İLAN ENGELLEME ---
const mesajEngelleri = new Map();
const MESAJ_ENGEL_SURESI_MS = 2 * 60 * 60 * 1000; // 2 Saat

function mukerrerIlanMi(mesajMetni) {
  if (!mesajMetni) return true;
  const simdi = Date.now();
  
  const parmakIzi = metniNormalizeEt(mesajMetni).replace(/[^a-z]/g, '');
  if (parmakIzi.length < 8) return true;

  const mesajHash = crypto.createHash('md5').update(parmakIzi).digest('hex');

  if (mesajEngelleri.has(mesajHash)) {
    const kayitZamani = mesajEngelleri.get(mesajHash);
    if (simdi - kayitZamani < MESAJ_ENGEL_SURESI_MS) {
      return true;
    }
  }

  mesajEngelleri.set(mesajHash, simdi);
  return false;
}

// --- 8. ŞEHİR / İLÇE PARSER KÜTÜPHANESİ ---
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
  const telEsllesmeler = mesajMetni.match(TEL_REGEX);
  let telefon = null;
  if (telEsllesmeler && telEsllesmeler.length > 0) {
    telefon = telEsllesmeler.map(t => t.replace(/\s+/g, '').replace(/\+90/, '0')).join(' / ');
  }

  let aracTipi = 'Belirtilmedi';
  const alt = metniNormalizeEt(mesajMetni);
  if (alt.includes('tir')) aracTipi = 'TIR';
  else if (alt.includes('kamyonet')) aracTipi = 'Kamyonet';
  else if (alt.includes('kamyon')) aracTipi = 'Kamyon';
  else if (alt.includes('kirkayak')) aracTipi = 'Kırkayak';
  else if (alt.includes('damper')) aracTipi = 'Damperli';
  else if (alt.includes('dorse')) aracTipi = 'Dorse';
  else if (alt.includes('panelvan')) aracTipi = 'Panelvan';

  const tespitEdilenler = [];

  PRECOMPILED_KISALTMALAR.forEach(item => {
    const m = mesajMetni.match(item.regex);
    if (m) tespitEdilenler.push({ il: item.il, ilce: item.ilce, index: m.index, ham: m[0] });
  });

  PRECOMPILED_ILCE_IL.forEach(item => {
    const m = mesajMetni.match(item.regex);
    if (m) tespitEdilenler.push({ il: item.il, ilce: item.ilce, index: m.index, ham: m[0] });
  });

  PRECOMPILED_ILLER.forEach(item => {
    const m = mesajMetni.match(item.regex);
    if (m) tespitEdilenler.push({ il: item.il, ilce: null, index: m.index, ham: m[0] });
  });

  // Metin içindeki sırasına göre diz
  tespitEdilenler.sort((a, b) => a.index - b.index);

  // Çakışan/Aynı indexli aramaları temizle
  const cakisilmayanlar = [];
  tespitEdilenler.forEach(item => {
    if (!cakisilmayanlar.some(c => Math.abs(c.index - item.index) < 3)) {
      cakisilmayanlar.push(item);
    }
  });

  let kalkis_ili = null, kalkis_ilcesi = null;
  let varis_ili = null, varis_ilcesi = null;

  if (cakisilmayanlar.length >= 2) {
    kalkis_ili = cakisilmayanlar[0].il;
    kalkis_ilcesi = cakisilmayanlar[0].ilce;
    varis_ili = cakisilmayanlar[1].il;
    varis_ilcesi = cakisilmayanlar[1].ilce;
  } else if (cakisilmayanlar.length === 1) {
    kalkis_ili = cakisilmayanlar[0].il;
    kalkis_ilcesi = cakisilmayanlar[0].ilce;
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
    nereye: varis_ilcesi ? `${varis_ili} / ${varis_ilcesi}` : varis_ili,
    toplam_lokasyon_sayisi: cakisilmayanlar.length
  };
}

// --- 9. OTOMATİK VERİTABANI VE RAM TEMİZLEYİCİ ---
async function eskiIlanlariTemizle() {
  try {
    const onSaatOnce = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
    const { error, count } = await supabase
      .from('ilanlar')
      .delete({ count: 'exact' })
      .lt('created_at', onSaatOnce);

    if (error) console.error('⚠️ Otomatik silme hatası:', error.message);
    else console.log(`🧹 Otomatik Temizlik: 10 saatten eski ilanlar silindi. (${count || 0} kayıt temizlendi)`);
  } catch (err) {
    console.error('⚠️ Temizlik sırasında beklenmeyen hata:', err.message);
  }
}

// --- 10. BOTU BAŞLAT ---
async function botuBaslat() {
  eskiIlanlariTemizle();
  setInterval(eskiIlanlariTemizle, 60 * 60 * 1000);

  setInterval(() => {
    const simdi = Date.now();
    for (const [hash, zam] of mesajEngelleri.entries()) {
      if (simdi - zam >= MESAJ_ENGEL_SURESI_MS) {
        mesajEngelleri.delete(hash);
      }
    }
  }, 60 * 60 * 1000);

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

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr, lastDisconnect } = update;
    if (qr) qrDataURL = await QRCode.toDataURL(qr);
    
    if (connection === 'open') {
      qrDataURL = null;
      currentPairingCode = null;
      console.log('\n==================================================');
      console.log('✅ WHATSAPP BOTU ANINDA BAĞLANDI VE CANLI DİNLİYOR!');
      console.log('==================================================\n');
    }
    
    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        setTimeout(botuBaslat, 3000);
      } else {
        console.log('❌ Oturum kapatıldı.');
        if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      }
    }
  });

  // BATCH MESAJ İŞLEME VE PARALEL I/O
  sock.ev.on('messages.upsert', async (m) => {
    if (!m.messages || m.messages.length === 0) return;

    for (const msg of m.messages) {
      if (!msg || !msg.message || msg.key.fromMe || !msg.key.remoteJid?.endsWith('@g.us')) continue;

      const mesajMetni = mesajMetniniCikar(msg.message);

      if (spamMi(mesajMetni)) continue;

      if (mukerrerIlanMi(mesajMetni)) {
        console.log('⏳ Mükerrer/Tekrarlayan İlan atlandı (RAM Seviyesinde Engellendi).');
        continue;
      }

      const veriler = gelismisMesajAyristir(mesajMetni);

      console.log('📩 Yeni İlan Parse Edildi: ' + mesajMetni.substring(0, 40).replace(/\n/g, ' ') + '...');

      const telegramMesaj = 
`📦 <b>YENİ NAKLİYE İLANI</b>

📍 <b>Rota:</b> ${veriler.nereden || 'Belirtilmedi'} ➡️ ${veriler.nereye || 'Belirtilmedi'}
📝 <b>İlan Detayı:</b>
${htmlTemizle(veriler.ham_mesaj)}

🚛 <b>Araç Tipi:</b> ${veriler.arac_tipi}
📞 <b>İletişim:</b> ${veriler.telefon || 'İlan metnini inceleyin'}

───────────────
📲 <i>Nakliye Cepte canlı yük akışı</i>`;

      // SUPABASE VE TELEGRAM İŞLEMLERİNİ PARALEL BAŞLAT
      const supabaseKayit = supabase
        .from('ilanlar')
        .insert([
          {
            title: veriler.arac_tipi !== 'Belirtilmedi' ? veriler.arac_tipi : 'Nakliye İlanı',
            content: veriler.ham_mesaj,
            phone: veriler.telefon,
            city_from: veriler.nereden,
            city_to: veriler.nereye
          }
        ])
        .then(({ error }) => {
          if (error) console.error('❌ Supabase Kayıt Hatası:', error.message);
          else console.log('⚡ İlan Supabase veritabanına kaydedildi!');
        })
        .catch(err => console.error('❌ Beklenmeyen Supabase Hatası:', err.message));

      const telegramGonderim = telegramaGonder(telegramMesaj);

      await Promise.allSettled([supabaseKayit, telegramGonderim]);
    }
  });
}

botuBaslat();

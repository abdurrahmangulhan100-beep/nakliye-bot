// --- 0. NODE.JS ÇÖKME KORUMASI & IPV4 ÖNCELİĞİ ---
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

process.on('uncaughtException', (err) => {
  console.error('🔥 Beklenmeyen Kritik Hata:', err);
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
          <title>Nakliye Cepte - WhatsApp Panel</title>
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
            <div class="badge">⚡ Canlı Yük Toplama Servisi</div><br>
            
            ${currentPairingCode ? `
              <p><b>📱 EŞLEŞTİRME KODUNUZ:</b></p>
              <div class="code-box">${currentPairingCode}</div>
              <p>WhatsApp -> <b>Bağlı Cihazlar</b> -> <b>Cihaz Bağla</b> -> <b>Telefon Numarası İle Bağla</b></p>
            ` : ''}

            ${qrDataURL ? `
              <img src="${qrDataURL}" alt="WhatsApp QR Code" />
              <p>VEYA kamera ile QR kodu okutun.</p>
            ` : ''}

            ${!currentPairingCode && !qrDataURL ? `
              <p>🟢 Bot bağlı ve grupları dinliyor...</p>
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

// --- 2. SUPABASE VEYA AYARLAR ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8624611315:AAHnYXg9RaaWjumP6jeCBzogVNYe_XQ13xc'; 
const TELEGRAM_KANAL_ID = process.env.TELEGRAM_KANAL_ID || '-1003776147836'; 
const PHONE_NUMBER = process.env.PHONE_NUMBER || '905XXXXXXXXX'; 

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tlnkimstwtqkbhsgdoql.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRsbmtpbXN0d3Rxa2Joc2dkb3FsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4ODI2OTYsImV4cCI6MjEwMjQ1ODY5Nn0.s5RYB22tlCxkUKuI3-cg7NETISlyL7zdEqjUAYyHq0s';

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

// --- 4. TÜRKÇE NORMALİZASYON ---
function metniNormalizeEt(text) {
  if (!text) return '';
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/['’`′"\-_~*]/g, ' ')
    .replace(/İ/g, 'i').replace(/I/g, 'i')
    .toLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/i̇/g, 'i')
    .replace(/ğ/g, 'g').replace(/ü/g, 'u')
    .replace(/ş/g, 's').replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- 5. LOKASYON KÜTÜPHANESİ ---
const KISALTMALAR = {
  'kny': { il: 'Konya' }, 'ist': { il: 'İstanbul' }, 'izmir': { il: 'İzmir' },
  'ank': { il: 'Ankara' }, 'adana': { il: 'Adana' }, 'antep': { il: 'Gaziantep' },
  'g.antep': { il: 'Gaziantep' }, 'maras': { il: 'Kahramanmaraş' }, 'k.maras': { il: 'Kahramanmaraş' },
  'urfa': { il: 'Şanlıurfa' }, 's.urfa': { il: 'Şanlıurfa' }, 'egl': { il: 'Konya', ilce: 'Ereğli' },
  'gebze': { il: 'Kocaeli', ilce: 'Gebze' }, 'corlu': { il: 'Tekirdağ', ilce: 'Çorlu' },
  'iskenderun': { il: 'Hatay', ilce: 'İskenderun' }, 'inegol': { il: 'Bursa', ilce: 'İnegöl' },
  'fetiye': { il: 'Muğla', ilce: 'Fethiye' }, 'fethiye': { il: 'Muğla', ilce: 'Fethiye' }
};

const ILCE_IL_HARITASI = {
  'ereğli': 'Konya', 'eregli': 'Konya', 'ilgın': 'Konya', 'ilgin': 'Konya',
  'akşehir': 'Konya', 'aksehir': 'Konya', 'karapınar': 'Konya', 'karapinar': 'Konya',
  'seydişehir': 'Konya', 'seydisehir': 'Konya', 'beyşehir': 'Konya', 'beysehir': 'Konya',
  'kulu': 'Konya', 'cihanbeyli': 'Konya', 'çumra': 'Konya', 'cumra': 'Konya',
  'gebze': 'Kocaeli', 'dilovası': 'Kocaeli', 'körfez': 'Kocaeli',
  'çorlu': 'Tekirdağ', 'çerkezköy': 'Tekirdağ', 'iskenderun': 'Hatay',
  'ceyhan': 'Adana', 'bandırma': 'Balıkesir', 'inegöl': 'Bursa', 'nazilli': 'Aydın',
  'söke': 'Aydın', 'aliağa': 'İzmir', 'torbalı': 'İzmir', 'menemen': 'İzmir',
  'polatlı': 'Ankara', 'polatli': 'Ankara', 'kazan': 'Ankara', 'çubuk': 'Ankara', 'tarsus': 'Mersin',
  'turgutlu': 'Manisa', 'salihli': 'Manisa', 'akhisar': 'Manisa', 'kızıltepe': 'Mardin',
  'silivri': 'İstanbul', 'esenyurt': 'İstanbul', 'nilüfer': 'Bursa', 'nilufer': 'Bursa',
  'ayvalık': 'Balıkesir', 'ayvalik': 'Balıkesir', 'edremit': 'Balıkesir', 'akçay': 'Balıkesir',
  'fethiye': 'Muğla', 'fetiye': 'Muğla', 'marmaris': 'Muğla', 'bodrum': 'Muğla',
  'kuşadası': 'Aydın', 'kusadasi': 'Aydın', 'elbistan': 'Kahramanmaraş', 'bergama': 'İzmir',
  'sarayköy': 'Denizli', 'saraykoy': 'Denizli', 'demirtaş': 'Bursa', 'demirtas': 'Bursa'
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

// --- 6. KESİNTİSİZ SPAM VE SAÇMA İLAN ENGELLEYİCİ ---
const KARA_REGEX = [
  /sofor.*aran/i, /kaptan.*aran/i, /eleman.*aran/i, /calisma.*arkadasi/i,
  /satilik.*tir/i, /satilik.*kamyon/i, /satilik.*dorse/i, /satilik.*araba/i,
  /devren.*dukkan/i, /hasar.*kayitsiz/i, /ekspertiz/i, /satilik.*lastik/i,
  /evden.*eve/i, /ev.*tasima/i, /ofis.*tasima/i, /ceyiz.*tasima/i,
  /hayirli.*isler/i, /iyi.*calismalar/i, /gunaydin/i, /iyi.*aksamlar/i,
  /hayirli.*cumalar/i, /selamun.*aleykum/i, /saat.*kac/i, /kantar.*acik/i,
  /radar/i, /ceza.*yedik/i, /mazot.*fiyat/i, /grup.*kurallar/i,
  /http/i, /https/i, /t\.me/i, /wa\.me/i, /chat\.whatsapp/i, /gruba.*katil/i,
  /parana.*sahip.*cik/i, /kapora/i, /guvenli.*odeme/i
];

function genelSpamMi(mesaj) {
  if (!mesaj || mesaj.length < 8) return true;
  const temiz = metniNormalizeEt(mesaj);
  return KARA_REGEX.some(r => r.test(temiz));
}

// --- 7. ÇOKLU İLAN AYRIŞTIRMA VE LOKASYON MİRASI MOTORU ---
function aracTipiTespit(metin) {
  const alt = metniNormalizeEt(metin);
  if (alt.includes('13 60') || alt.includes('1360') || alt.includes('tir')) return 'TIR';
  if (alt.includes('frigo') || alt.includes('frigofirik')) return 'Frigo TIR';
  if (alt.includes('kirmizi kapak') || alt.includes('tenteli')) return 'Tenteli TIR';
  if (alt.includes('kamyonet')) return 'Kamyonet';
  if (alt.includes('kirkayak')) return 'Kırkayak';
  if (alt.includes('kamyon')) return 'Kamyon';
  if (alt.includes('damper')) return 'Damperli';
  if (alt.includes('dorse')) return 'Dorse';
  if (alt.includes('40 ayak') || alt.includes('40ayak')) return 'Kırkayak (40 Ayak)';
  return 'Belirtilmedi';
}

function satirdanLokasyonlariBul(satir) {
  const tespitEdilenler = [];

  PRECOMPILED_KISALTMALAR.forEach(item => {
    const m = satir.match(item.regex);
    if (m) tespitEdilenler.push({ il: item.il, ilce: item.ilce, index: m.index });
  });

  PRECOMPILED_ILCE_IL.forEach(item => {
    const m = satir.match(item.regex);
    if (m) tespitEdilenler.push({ il: item.il, ilce: item.ilce, index: m.index });
  });

  PRECOMPILED_ILLER.forEach(item => {
    const m = satir.match(item.regex);
    if (m) tespitEdilenler.push({ il: item.il, ilce: null, index: m.index });
  });

  tespitEdilenler.sort((a, b) => a.index - b.index);

  // Çakışan lokasyonları temizle
  const cakisilmayanlar = [];
  tespitEdilenler.forEach(item => {
    if (!cakisilmayanlar.some(c => Math.abs(c.index - item.index) < 3)) {
      cakisilmayanlar.push(item);
    }
  });

  return cakisilmayanlar;
}

function cokluIlanlariAyristir(hamMesaj) {
  if (genelSpamMi(hamMesaj)) return [];

  // Genel Telefon Numarası
  const geneltelEsllesmeler = hamMesaj.match(TEL_REGEX);
  let genelTelefon = null;
  if (geneltelEsllesmeler && geneltelEsllesmeler.length > 0) {
    genelTelefon = geneltelEsllesmeler[0].replace(/\s+/g, '').replace(/\+90/, '0');
  }

  const satirlar = hamMesaj.split('\n').map(s => s.trim()).filter(s => s.length > 0);
  const bulunanIlanlar = [];

  let ortakKalkisIl = null;
  let ortakKalkisIlce = null;

  // Başlıkta "AYVALIK YÜKLEMELİ" veya "POLATLI YÜKLEME" var mı?
  for (const satir of satirlar.slice(0, 3)) {
    if (/yukleme|yuklemeli|cikisli|kalkis/i.test(satir)) {
      const loks = satirdanLokasyonlariBul(satir);
      if (loks.length > 0) {
        ortakKalkisIl = loks[0].il;
        ortakKalkisIlce = loks[0].ilce;
        break;
      }
    }
  }

  for (const satir of satirlar) {
    // Telefon numarası veya başlık satırlarını atla
    if (/^\d+$/.test(satir.replace(/\s+/g, '')) || /lojistik|nakliye|tel|iletisim/i.test(satir) && satir.length < 35) {
      continue;
    }

    const lokasyonlar = satirdanLokasyonlariBul(satir);
    const satirTel = (satir.match(TEL_REGEX) || [])[0];
    const telefon = satirTel ? satirTel.replace(/\s+/g, '').replace(/\+90/, '0') : genelTelefon;
    const aracTipi = aracTipiTespit(satir);

    let kalkis_ili = null, kalkis_ilcesi = null;
    let varis_ili = null, varis_ilcesi = null;

    if (lokasyonlar.length >= 2) {
      // Satırda hem kalkış hem varış var (Örn: "NAZİLLİ ADANA 1.TON PARÇA")
      kalkis_ili = lokasyonlar[0].il;
      kalkis_ilcesi = lokasyonlar[0].ilce;
      varis_ili = lokasyonlar[1].il;
      varis_ilcesi = lokasyonlar[1].ilce;
    } else if (lokasyonlar.length === 1 && ortakKalkisIl) {
      // Satırda tek şehir var ve başlıkta ortak kalkış var (Örn: "İSTANBUL 13.60 TIR")
      kalkis_ili = ortakKalkisIl;
      kalkis_ilcesi = ortakKalkisIlce;
      varis_ili = lokasyonlar[0].il;
      varis_ilcesi = lokasyonlar[0].ilce;
    }

    if (kalkis_ili) {
      const nereden = kalkis_ilcesi ? `${kalkis_ili} / ${kalkis_ilcesi}` : kalkis_ili;
      const nereye = varis_ilcesi ? `${varis_ili} / ${varis_ilcesi}` : (varis_ili || 'Belirtilmedi');

      bulunanIlanlar.push({
        kalkis_ili,
        varis_ili,
        nereden,
        nereye,
        arac_tipi: aracTipi,
        telefon: telefon || 'İlan metnini inceleyin',
        detay: satir
      });
    }
  }

  return bulunanIlanlar;
}

// --- 8. MÜKERRER İLAN ENGELLEME (6 SAAT HASH KONTROLÜ) ---
const mesajEngelleri = new Map();
const MESAJ_ENGEL_SURESI_MS = 6 * 60 * 60 * 1000;

function mukerrerIlanMi(kalkis, varis, detay, telefon) {
  const simdi = Date.now();
  const ozMetin = metniNormalizeEt(`${kalkis}_${varis}_${detay}_${telefon}`);
  const hash = crypto.createHash('md5').update(ozMetin).digest('hex');

  if (mesajEngelleri.has(hash)) {
    const kayitZamani = mesajEngelleri.get(hash);
    if (simdi - kayitZamani < MESAJ_ENGEL_SURESI_MS) return true;
  }

  mesajEngelleri.set(hash, simdi);
  return false;
}

// --- 9. YARDIMCI BİLDİRİMLER VE OTOMATİK TEMİZLİK ---
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
  } catch (err) {
    console.error('⚠️ Telegram Hatası:', err.message);
  }
}

async function eskiIlanlariTemizle() {
  try {
    const onSaatOnce = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('bot_listings')
      .delete({ count: 'exact' })
      .lt('created_at', onSaatOnce);

    if (count) console.log(`🧹 Otomatik Temizlik: ${count} eski ilan silindi.`);
  } catch (err) {
    console.error('⚠️ Temizlik hatası:', err.message);
  }
}

// --- 10. BOTU BAŞLAT ---
async function botuBaslat() {
  eskiIlanlariTemizle();
  setInterval(eskiIlanlariTemizle, 60 * 60 * 1000);

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
        console.log(`\n👉 EŞLEŞTİRME KODUNUZ: ${currentPairingCode}\n`);
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
      console.log('✅ NAKLİYE CEPTE BOTU BAĞLANDI! İLANLAR SIFIR KAYIP İLE DİNLENİYOR.');
    }
    
    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        setTimeout(botuBaslat, 3000);
      } else {
        if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      }
    }
  });

  // CANLI MESAJ DİNLENMESİ
  sock.ev.on('messages.upsert', async (m) => {
    if (!m.messages || m.messages.length === 0) return;

    for (const msg of m.messages) {
      if (!msg || !msg.message || msg.key.fromMe || !msg.key.remoteJid?.endsWith('@g.us')) continue;

      const hamMesaj = mesajMetniniCikar(msg.message);
      const ilanlar = cokluIlanlariAyristir(hamMesaj);

      if (ilanlar.length === 0) continue;

      const supabaseEklenecekler = [];

      for (const ilan of ilanlar) {
        if (mukerrerIlanMi(ilan.nereden, ilan.nereye, ilan.detay, ilan.telefon)) {
          continue;
        }

        console.log(`⚡ [YENİ İLAN] ${ilan.nereden} ➡️ ${ilan.nereye} | ${ilan.arac_tipi}`);

        supabaseEklenecekler.push({
          from_city: ilan.nereden,
          to_city: ilan.nereye,
          cargo_detail: ilan.detay,
          vehicle_type: ilan.arac_tipi,
          company_name: 'WhatsApp Lojistik Akışı'
        });

        const telegramMesaj = 
`📦 <b>YENİ NAKLİYE İLANI</b>

📍 <b>Rota:</b> ${ilan.nereden} ➡️ ${ilan.nereye}
📝 <b>Yük / Detay:</b> ${htmlTemizle(ilan.detay)}
🚛 <b>Araç Tipi:</b> ${ilan.arac_tipi}
📞 <b>İletişim:</b> ${ilan.telefon}

───────────────
📲 <i>Nakliye Cepte canlı yük akışı</i>`;

        telegramaGonder(telegramMesaj);
      }

      // Supabase'e Toplu Kayıt (Batch Insert)
      if (supabaseEklenecekler.length > 0) {
        const { error } = await supabase.from('bot_listings').insert(supabaseEklenecekler);
        if (error) console.error('❌ Supabase Kayıt Hatası:', error.message);
        else console.log(`🚀 ${supabaseEklenecekler.length} adet ilan Supabase'e kaydedildi!`);
      }
    }
  });
}

botuBaslat();

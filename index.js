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
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Görünmez karakterleri temizler
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

// --- 5. GELİŞMİŞ VE KAPSAMLI SPAM FİLTRESİ ---
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
  
  // Qmove & Otomatik Bot Kalıpları
  'qmove', 'kaliteli yuk', 'tasima programi', 'bugunun kaliteli',
  'yapilacak sevkiyat', 'tasima gorevi', 'planlanan tasima',
  'bugunku yuk', 'tasima isi', 'nakliye yuku', 'yuk havuzu',
  'canli yuk', 'sevkiyat listesi', 'otomatik paylasim',

  // Grup İçi Genel Sohbet
  'grup kurallari', 'hayirli cumalar', 'bereketli olsun', 'selamun aleykum', 'hayirli isler'
];

// Uygulama başlarken kara kelimeleri önceden normalize ederek RAM hızını artırıyoruz
const KARA_KELIMELER = KARA_KELIMELER_HAM.map(k => metniNormalizeEt(k));

function spamMi(mesaj) {
  if (!mesaj) return true;
  
  // 1. Çok kısa veya aşırı uzun mesajlar
  if (mesaj.length < 10 || mesaj.length > 3000) return true;
  
  // 2. Yetersiz harf sayısı
  const harfSayisi = (mesaj.match(/[a-zA-ZğüşıöçĞÜŞİÖÇ]/g) || []).length;
  if (harfSayisi < 5) return true; 

  // 3. Metni normalize et
  const temizMesaj = metniNormalizeEt(mesaj);
  
  // 4. Kara kelime kontrolü
  const yakalanan = KARA_KELIMELER.find(kelime => temizMesaj.includes(kelime));
  if (yakalanan) {
    console.log(`🚮 Spam Engellendi [Kelime: "${yakalanan}"]:`, mesaj.substring(0, 35).replace(/\n/g, ' '));
    return true;
  }

  // 5. Link Kontrolü
  if (temizMesaj.includes('http') || temizMesaj.includes('https') || temizMesaj.includes('channel')) {
    console.log('🚮 Spam Engellendi (Link Var):', mesaj.substring(0, 30));
    return true;
  }

  // 6. Çoklu Şehir İlanı (Bot Listeleri)
  const gecenIlSayisi = ILLER.filter(il => temizMesaj.includes(metniNormalizeEt(il))).length;
  if (gecenIlSayisi > 4) {
    console.log('🚮 Spam Engellendi (Toplu Bot Liste):', mesaj.substring(0, 30));
    return true;
  }

  return false;
}

// --- 6. GÜÇLENDİRİLMİŞ PARMAK İZİ BAZLI MÜKERRER İLAN ENGELLEMEYİ ---
const mesajEngelleri = new Map();
const MESAJ_ENGEL_SURESI_MS = 2 * 60 * 60 * 1000; // 2 Saat boyunca aynı içerik bloklanır

function mukerrerIlanMi(mesajMetni) {
  if (!mesajMetni) return true;
  const simdi = Date.now();
  
  // Saat, tarih, telefon ve özel karakterler temizlenir.
  // Sadece mesajın öz kütlesi (harfler) alınır. Qmove dynamic ID eklese dahi yakalanır.
  const parmakIzi = metniNormalizeEt(mesajMetni).replace(/[^a-z]/g, '');
  if (parmakIzi.length < 8) return true;

  const mesajHash = crypto.createHash('md5').update(parmakIzi).digest('hex');

  if (mesajEngelleri.has(mesajHash)) {
    const kayitZamani = mesajEngelleri.get(mesajHash);
    if (simdi - kayitZamani < MESAJ_ENGEL_SURESI_MS) {
      return true;
    }
  }

  // Bellek temizliği (2 saatten eski kayıtlar silinir)
  if (mesajEngelleri.size > 5000) {
    for (const [hash, zam] of mesajEngelleri.entries()) {
      if (simdi - zam >= MESAJ_ENGEL_SURESI_MS) {
        mesajEngelleri.delete(hash);
      }
    }
  }

  mesajEngelleri.set(mesajHash, simdi);
  return false;
}

// --- 7. ŞEHİR / İLÇE PARSER KÜTÜPHANESİ ---
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
  const alt = metniNormalizeEt(mesajMetni);
  if (alt.includes('tir')) aracTipi = 'TIR';
  else if (alt.includes('kamyonet')) aracTipi = 'Kamyonet';
  else if (alt.includes('kamyon')) aracTipi = 'Kamyon';
  else if (alt.includes('kirkayak')) aracTipi = 'Kırkayak';
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

// --- 8. BOTU BAŞLAT ---
async function botuBaslat() {
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

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg || !msg.message || msg.key.fromMe || !msg.key.remoteJid?.endsWith('@g.us')) return;

    const mesajMetni = mesajMetniniCikar(msg.message);

    // ERKEN ÇIKIŞ (EARLY EXIT): Spam veya Mükerrer ise Supabase ve Telegram adımlarına HİÇ girmeden durdurulur
    if (spamMi(mesajMetni)) return;

    if (mukerrerIlanMi(mesajMetni)) {
      console.log('⏳ Mükerrer/Tekrarlayan İlan atlandı (RAM Seviyesinde Engellendi).');
      return;
    }

    const veriler = gelismisMesajAyristir(mesajMetni);

    console.log('📩 Yeni İlan Parse Edildi: ' + mesajMetni.substring(0, 40).replace(/\n/g, ' ') + '...');

    // SUPABASE VERİTABANINA EKLEME
    try {
      const { error } = await supabase
        .from('ilanlar')
        .insert([
          {
            title: veriler.arac_tipi !== 'Belirtilmedi' ? veriler.arac_tipi : 'Nakliye İlanı',
            content: veriler.ham_mesaj,
            phone: veriler.telefon,
            city_from: veriler.nereden,
            city_to: veriler.nereye
          }
        ]);

      if (error) {
        console.error('❌ Supabase Kayıt Hatası:', error.message);
      } else {
        console.log('⚡ İlan Supabase veritabanına kaydedildi!');
      }
    } catch (err) {
      console.error('❌ Beklenmeyen Supabase Hatası:', err.message);
    }

    // TELEGRAM BİLDİRİMİ
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

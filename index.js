'use strict';

/*
 * NAKLİYE CEPTE — WhatsApp grup dinleyici botu (v2)
 * WhatsApp gruplarındaki yük / boş araç ilanlarını ayrıştırır;
 * Telegram kanalına ve Supabase'e (bot_listings) yazar.
 *
 * ORTAM DEĞİŞKENLERİ (host panelinden gir — şifreleri koda YAZMA):
 *   TELEGRAM_BOT_TOKEN   Telegram bot token'ı
 *   TELEGRAM_KANAL_ID    Telegram kanal/grup id'si (-100...)
 *   SUPABASE_URL         Supabase proje adresi
 *   SUPABASE_SERVICE_ROLE_KEY   Supabase service_role anahtarı (SUPABASE_KEY de kabul edilir). Anon anahtar KULLANMAYIN
 *   PHONE_NUMBER         905xxxxxxxxx  (eşleştirme kodu için; boşsa QR kullanılır)
 *   PANEL_KEY            /qr?key=... sayfasının şifresi (boşsa her açılışta rastgele üretilip loga yazılır)
 *
 * OPSİYONEL:
 *   SUPABASE_TABLO=bot_listings            SUPABASE_TELEFON_KOLONU=  (tabloda telefon kolonu varsa adı)
 *   ILAN_OMRU_SAAT=10                      MUKERRER_SAAT=6
 *   MAX_MESAJ_YASI_DK=30                   TELEGRAM_ARALIK_MS=3100
 *   ENGELLI_GRUPLAR=grup adı parçası,...   BOS_ARAC_ILANLARINI_ATLA=false
 *   TEK_SEHIRLI_ILAN_KABUL=true            GONDERICI_NUMARASINI_KULLAN=false
 *   AUTH_DIR=/data/auth_info               (kalıcı disk bağladıysan oraya yönlendir)
 *
 * Not: Ağır kütüphaneler (baileys, supabase, qrcode) bilerek fonksiyon içinde
 * require ediliyor; böylece ayrıştırıcı fonksiyonlar tek başına test edilebiliyor.
 */

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ════════════════════════════════════════════════════════════════
// 1. AYARLAR
// ════════════════════════════════════════════════════════════════
const env = process.env;
const boolEnv = (v, varsayilan) => (v === undefined || v === '' ? varsayilan : /^(1|true|evet|yes|on)$/i.test(v));
const sayiEnv = (v, varsayilan) => {
  if (v === undefined || v === '') return varsayilan;
  const n = Number(v);
  return Number.isFinite(n) ? n : varsayilan;
};

const CONFIG = {
  PORT: sayiEnv(env.PORT, 8080),
  AUTH_DIR: env.AUTH_DIR || path.join(__dirname, 'auth_info'),
  PHONE_NUMBER: (env.PHONE_NUMBER || '').replace(/\D/g, ''),
  PANEL_KEY: env.PANEL_KEY || crypto.randomBytes(8).toString('hex'),
  PANEL_KEY_RASTGELE: !env.PANEL_KEY,

  TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_KANAL_ID: env.TELEGRAM_KANAL_ID || '',
  TELEGRAM_ARALIK_MS: sayiEnv(env.TELEGRAM_ARALIK_MS, 3100), // kanal limiti ≈ 20 mesaj/dk
  TELEGRAM_KUYRUK_MAX: 2000,

  SUPABASE_URL: env.SUPABASE_URL || '',
  SUPABASE_KEY: env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY || '', // sunucuda service_role kullanın (anon anahtar herkese açıktır)
  SUPABASE_TABLO: env.SUPABASE_TABLO || 'bot_listings',
  SUPABASE_TELEFON_KOLONU: env.SUPABASE_TELEFON_KOLONU || '',

  ILAN_OMRU_SAAT: sayiEnv(env.ILAN_OMRU_SAAT, 10),
  MUKERRER_SAAT: sayiEnv(env.MUKERRER_SAAT, 6),
  MAX_MESAJ_YASI_DK: sayiEnv(env.MAX_MESAJ_YASI_DK, 120), // bot yeniden başlayınca kaçan mesajlar için geniş tutuldu
  MAX_ILAN_PER_MESAJ: 30,

  BOS_ARAC_ILANLARINI_ATLA: boolEnv(env.BOS_ARAC_ILANLARINI_ATLA, false),
  TEK_SEHIRLI_ILAN_KABUL: boolEnv(env.TEK_SEHIRLI_ILAN_KABUL, true),
  GONDERICI_NUMARASINI_KULLAN: boolEnv(env.GONDERICI_NUMARASINI_KULLAN, false),
  ROTASIZ_ILAN_KABUL: boolEnv(env.ROTASIZ_ILAN_KABUL, true), // şehir tanınmasa da telefon + ilan sinyali varsa yayınla
  RET_LOG: boolEnv(env.RET_LOG, true),                       // telefon içeren ama ilan sayılmayan mesajları logla
  KANAL_JIDLERI: (env.KANAL_JIDLERI || '').split(',').map(x => x.trim()).filter(Boolean), // 120363...@newsletter
  // Varsayılan engelli gruplar (adın bir parçası yeterli; harf/noktalama farkı önemli değil).
  // Ek grup engellemek için host panelindeki ENGELLI_GRUPLAR değişkenine virgülle ekleyebilirsin.
  ENGELLI_GRUPLAR: ['ilgin mot tas kopp', ...(env.ENGELLI_GRUPLAR || '').split(',')].map(s => metniNormalizeEt(s)).filter(Boolean)
};

// Supabase anahtarının rolünü (anon / service_role) JWT içinden okur; gizli bir şey çözmez, yalnızca uyarı içindir.
function anahtarRolu(anahtar) {
  try { return JSON.parse(Buffer.from(String(anahtar).split('.')[1], 'base64url').toString('utf8')).role || null; } catch { return null; }
}

const durum = {
  baglanti: 'baslatiliyor',
  qrDataURL: null,
  eslestirmeKodu: null,
  sonMesajZamani: 0,
  baslangic: Date.now()
};

const istatistik = {
  mesaj: 0, eskiMesaj: 0, ilanBulunan: 0, mukerrer: 0,
  telegramGonderilen: 0, telegramHata: 0, telegramDusen: 0,
  supabaseKaydedilen: 0, supabaseHata: 0
};

const bekle = (ms) => new Promise(r => setTimeout(r, ms));

const retSayac = {};
const grupIstatistik = new Map(); // jid → { mesaj, ilan }

// ════════════════════════════════════════════════════════════════
// 2. METİN YARDIMCILARI
// ════════════════════════════════════════════════════════════════

// WhatsApp mesaj zarflarını (geçici, tek seferlik, belge+açıklama, düzenlenmiş) açıp metni çıkarır.
function mesajMetniniCikar(messageObj) {
  if (!messageObj) return '';
  let msg = messageObj;

  for (let i = 0; i < 5; i++) {
    const ic =
      msg.ephemeralMessage?.message ||
      msg.viewOnceMessage?.message ||
      msg.viewOnceMessageV2?.message ||
      msg.viewOnceMessageV2Extension?.message ||
      msg.documentWithCaptionMessage?.message ||
      msg.editedMessage?.message;
    if (!ic) break;
    msg = ic;
  }

  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    msg.protocolMessage?.editedMessage?.conversation ||
    msg.protocolMessage?.editedMessage?.extendedTextMessage?.text ||
    ''
  );
}

// Türkçe karakterleri sadeleştirir. Apostrof SİLİNİR (Konya'dan → konyadan), diğer işaretler boşluk olur.
function metniNormalizeEt(text) {
  if (!text) return '';
  return String(text)
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/['’‘`´′ʼ]/g, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // ş→s ğ→g ü→u ö→o ç→c İ→I â→a
    .replace(/ı/g, 'i')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function kisalt(metin, n) {
  if (!metin) return '';
  return metin.length > n ? metin.slice(0, n - 1).trimEnd() + '…' : metin;
}

function htmlTemizle(text) {
  if (!text) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ════════════════════════════════════════════════════════════════
// 3. TELEFON
// ════════════════════════════════════════════════════════════════
const AYR = '[\\s.\\-()]*';
const TEL_MOBIL_REGEX = new RegExp(`(?<!\\d)(?:(?:\\+|00)?90${AYR})?0?${AYR}5\\d{2}${AYR}\\d{3}${AYR}\\d{2}${AYR}\\d{2}(?!\\d)`, 'g');
const TEL_SABIT_REGEX = new RegExp(`(?<!\\d)0${AYR}[234]\\d{2}${AYR}\\d{3}${AYR}\\d{2}${AYR}\\d{2}(?!\\d)`, 'g');

// Her formatı (+90 532..., 0532-..., 532...) tek biçime çevirir: 05321234567
function telefonNormalizeEt(ham) {
  let d = String(ham || '').replace(/\D/g, '');
  if (d.startsWith('0090')) d = '0' + d.slice(4);
  else if (d.startsWith('90') && d.length === 12) d = '0' + d.slice(2);
  else if (d.length === 10) d = '0' + d;
  return /^0\d{10}$/.test(d) ? d : null;
}

function telefonlariBul(metin) {
  if (!metin) return [];
  const bulunan = [];
  for (const re of [TEL_MOBIL_REGEX, TEL_SABIT_REGEX]) {
    for (const m of String(metin).matchAll(re)) {
      const tel = telefonNormalizeEt(m[0]);
      if (tel) bulunan.push({ index: m.index, tel });
    }
  }
  bulunan.sort((a, b) => a.index - b.index);
  return [...new Set(bulunan.map(b => b.tel))];
}

function telefonuBicimle(tel) {
  return tel ? tel.replace(/^(\d{4})(\d{3})(\d{2})(\d{2})$/, '$1 $2 $3 $4') : tel;
}

function telefonlariTemizle(metin) {
  return String(metin || '')
    .replace(TEL_MOBIL_REGEX, ' ')
    .replace(TEL_SABIT_REGEX, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—:|,.]+|[\s\-–—:|,]+$/g, '')
    .trim();
}

// ════════════════════════════════════════════════════════════════
// 4. LOKASYON VERİSİ
// ════════════════════════════════════════════════════════════════
const ILLER = [
  'Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Amasya', 'Ankara', 'Antalya', 'Artvin', 'Aydın', 'Balıkesir',
  'Bilecik', 'Bingöl', 'Bitlis', 'Bolu', 'Burdur', 'Bursa', 'Çanakkale', 'Çankırı', 'Çorum', 'Denizli',
  'Diyarbakır', 'Edirne', 'Elazığ', 'Erzincan', 'Erzurum', 'Eskişehir', 'Gaziantep', 'Giresun', 'Gümüşhane', 'Hakkari',
  'Hatay', 'Isparta', 'Mersin', 'İstanbul', 'İzmir', 'Kars', 'Kastamonu', 'Kayseri', 'Kırklareli', 'Kırşehir',
  'Kocaeli', 'Konya', 'Kütahya', 'Malatya', 'Manisa', 'Kahramanmaraş', 'Mardin', 'Muğla', 'Muş', 'Nevşehir',
  'Niğde', 'Ordu', 'Rize', 'Sakarya', 'Samsun', 'Siirt', 'Sinop', 'Sivas', 'Tekirdağ', 'Tokat',
  'Trabzon', 'Tunceli', 'Şanlıurfa', 'Uşak', 'Van', 'Yozgat', 'Zonguldak', 'Aksaray', 'Bayburt', 'Karaman',
  'Kırıkkale', 'Batman', 'Şırnak', 'Bartın', 'Ardahan', 'Iğdır', 'Yalova', 'Karabük', 'Kilis', 'Osmaniye', 'Düzce'
];

// Günlük dilde kullanılan il takma adları: [yazılış, resmi il]
const IL_TAKMA_ADLARI = [
  ['Afyon', 'Afyonkarahisar'], ['İçel', 'Mersin'], ['Antep', 'Gaziantep'], ['G Antep', 'Gaziantep'], ['Gantep', 'Gaziantep'],
  ['Maraş', 'Kahramanmaraş'], ['K Maraş', 'Kahramanmaraş'], ['Kmaraş', 'Kahramanmaraş'],
  ['Urfa', 'Şanlıurfa'], ['S Urfa', 'Şanlıurfa'], ['Surfa', 'Şanlıurfa'],
  ['D Bakır', 'Diyarbakır'], ['Dbakır', 'Diyarbakır'], ['Diyarbekir', 'Diyarbakır']
];

// Gerçek kısaltmalar (iste→ist gibi yanlış eşleşmeyi önlemek için ekleri kısıtlı)
const KISALTMALAR = [
  ['kny', 'Konya', null], ['ist', 'İstanbul', null], ['ank', 'Ankara', null], ['egl', 'Konya', 'Ereğli']
];

// İlçe → il (sık kullanılan sanayi / lojistik ilçeleri). Anahtar normalize edilerek eşleşir.
const ILCELER = {
  'Konya': ['Ereğli', 'Ilgın', 'Akşehir', 'Karapınar', 'Seydişehir', 'Beyşehir', 'Kulu', 'Cihanbeyli', 'Çumra', 'Selçuklu', 'Meram', 'Karatay', 'Sarayönü', 'Kadınhanı', 'Yunak', 'Bozkır'],
  'Kocaeli': ['Gebze', 'Dilovası', 'Körfez', 'İzmit', 'Gölcük', 'Derince', 'Darıca', 'Çayırova', 'Kartepe', 'Başiskele', 'Kandıra', 'Karamürsel'],
  'Tekirdağ': ['Çorlu', 'Çerkezköy', 'Kapaklı', 'Ergene', 'Süleymanpaşa', 'Malkara', 'Hayrabolu', 'Muratlı'],
  'Hatay': ['İskenderun', 'Dörtyol', 'Antakya', 'Payas', 'Kırıkhan', 'Reyhanlı', 'Arsuz', 'Samandağ'],
  'Adana': ['Ceyhan', 'Kozan', 'Yumurtalık', 'Seyhan', 'Çukurova', 'Sarıçam', 'Yüreğir', 'İmamoğlu', 'Karaisalı'],
  'Balıkesir': ['Bandırma', 'Ayvalık', 'Edremit', 'Akçay', 'Gönen', 'Burhaniye', 'Susurluk', 'Bigadiç', 'Erdek'],
  'Bursa': ['İnegöl', 'Nilüfer', 'Demirtaş', 'Osmangazi', 'Yıldırım', 'Gemlik', 'Mustafakemalpaşa', 'Orhangazi', 'Karacabey', 'Gürsu', 'Kestel', 'Mudanya', 'İznik'],
  'Aydın': ['Nazilli', 'Söke', 'Kuşadası', 'Didim', 'Çine', 'Efeler', 'Germencik'],
  'İzmir': ['Aliağa', 'Torbalı', 'Menemen', 'Bergama', 'Çiğli', 'Bornova', 'Buca', 'Karşıyaka', 'Kemalpaşa', 'Ödemiş', 'Çeşme', 'Foça', 'Dikili', 'Urla', 'Bayındır', 'Gaziemir', 'Bayraklı'],
  'Ankara': ['Polatlı', 'Kazan', 'Kahramankazan', 'Çubuk', 'Sincan', 'Etimesgut', 'Yenimahalle', 'Keçiören', 'Mamak', 'Altındağ', 'Çankaya', 'Beypazarı', 'Haymana', 'Elmadağ', 'Temelli'],
  'Mersin': ['Tarsus', 'Erdemli', 'Silifke', 'Anamur', 'Mezitli', 'Toroslar'],
  'Manisa': ['Turgutlu', 'Salihli', 'Akhisar', 'Soma', 'Alaşehir', 'Saruhanlı', 'Yunusemre', 'Şehzadeler', 'Kırkağaç'],
  'Mardin': ['Kızıltepe', 'Nusaybin', 'Midyat', 'Artuklu', 'Derik'],
  'İstanbul': ['Silivri', 'Esenyurt', 'Tuzla', 'Pendik', 'Kartal', 'Maltepe', 'Ümraniye', 'Ataşehir', 'Sultanbeyli', 'Sancaktepe', 'Çekmeköy', 'Beykoz', 'Şile', 'Başakşehir', 'Avcılar', 'Büyükçekmece', 'Çatalca', 'Arnavutköy', 'Beylikdüzü', 'Bağcılar', 'Bahçelievler', 'Esenler', 'Gaziosmanpaşa', 'Kağıthane', 'Sarıyer', 'Zeytinburnu', 'Bayrampaşa', 'Küçükçekmece', 'Güngören', 'Sultangazi'],
  'Muğla': ['Fethiye', 'Marmaris', 'Bodrum', 'Milas', 'Ortaca', 'Dalaman', 'Datça', 'Köyceğiz', 'Menteşe'],
  'Denizli': ['Sarayköy', 'Merkezefendi', 'Pamukkale', 'Çivril', 'Acıpayam', 'Honaz', 'Buldan'],
  'Kahramanmaraş': ['Elbistan', 'Pazarcık', 'Afşin', 'Türkoğlu', 'Göksun'],
  'Gaziantep': ['Nizip', 'İslahiye', 'Şahinbey', 'Şehitkamil', 'Oğuzeli', 'Araban'],
  'Şanlıurfa': ['Viranşehir', 'Siverek', 'Ceylanpınar', 'Birecik', 'Harran', 'Suruç', 'Akçakale', 'Bozova'],
  'Diyarbakır': ['Bismil', 'Silvan', 'Ergani', 'Kayapınar', 'Bağlar'],
  'Samsun': ['Bafra', 'Terme', 'Tekkeköy', 'Vezirköprü', 'Havza', 'Alaçam', 'Atakum', 'İlkadım', 'Canik'],
  'Sakarya': ['Adapazarı', 'Akyazı', 'Hendek', 'Karasu', 'Sapanca', 'Arifiye', 'Erenler', 'Serdivan', 'Geyve', 'Pamukova', 'Ferizli'],
  'Kayseri': ['Develi', 'Yahyalı', 'Talas', 'Melikgazi', 'Kocasinan', 'Bünyan', 'Tomarza', 'İncesu'],
  'Eskişehir': ['Sivrihisar', 'Odunpazarı', 'Tepebaşı', 'Çifteler', 'Seyitgazi', 'Alpu'],
  'Antalya': ['Alanya', 'Manavgat', 'Serik', 'Kumluca', 'Finike', 'Elmalı', 'Kepez', 'Muratpaşa', 'Gazipaşa', 'Korkuteli', 'Döşemealtı'],
  'Afyonkarahisar': ['Sandıklı', 'Dinar', 'Bolvadin', 'Sultandağı', 'Emirdağ', 'İscehisar'],
  'Zonguldak': ['Çaycuma', 'Devrek', 'Alaplı'],
  'Çanakkale': ['Biga', 'Gelibolu', 'Lapseki', 'Ayvacık', 'Ezine', 'Bayramiç', 'Eceabat'],
  'Edirne': ['Keşan', 'Uzunköprü', 'Havsa', 'Lalapaşa'],
  'Kırklareli': ['Lüleburgaz', 'Babaeski', 'Pınarhisar', 'Demirköy'],
  'Bolu': ['Gerede', 'Mudurnu'],
  'Düzce': ['Akçakoca', 'Gümüşova', 'Kaynaşlı'],
  'Sivas': ['Şarkışla', 'Suşehri'],
  'Tokat': ['Erbaa', 'Niksar', 'Turhal', 'Zile'],
  'Çorum': ['Sungurlu', 'Osmancık', 'Alaca'],
  'Amasya': ['Merzifon', 'Suluova'],
  'Yozgat': ['Sorgun', 'Yerköy', 'Akdağmadeni'],
  'Nevşehir': ['Ürgüp', 'Avanos', 'Kozaklı'],
  'Aksaray': ['Eskil'],
  'Niğde': ['Ulukışla'],
  'Isparta': ['Eğirdir', 'Yalvaç', 'Şarkikaraağaç'],
  'Burdur': ['Bucak', 'Gölhisar'],
  'Uşak': ['Banaz', 'Eşme'],
  'Kütahya': ['Tavşanlı', 'Simav', 'Gediz'],
  'Bilecik': ['Bozüyük', 'Osmaneli', 'Söğüt'],
  'Ordu': ['Ünye', 'Fatsa'],
  'Giresun': ['Bulancak', 'Tirebolu'],
  'Trabzon': ['Akçaabat', 'Vakfıkebir'],
  'Artvin': ['Hopa', 'Arhavi', 'Borçka'],
  'Erzurum': ['Horasan', 'Pasinler', 'Oltu'],
  'Malatya': ['Doğanşehir', 'Battalgazi', 'Darende'],
  'Elazığ': ['Karakoçan'],
  'Adıyaman': ['Kahta', 'Besni'],
  'Batman': ['Kozluk'],
  'Siirt': ['Kurtalan'],
  'Van': ['Erciş'],
  'Hakkari': ['Yüksekova'],
  'Şırnak': ['Cizre', 'Silopi', 'İdil'],
  'Osmaniye': ['Kadirli', 'Düziçi'],
  'Yalova': ['Çiftlikköy', 'Altınova'],
  'Karabük': ['Safranbolu', 'Eskipazar'],
  'Bartın': ['Amasra'],
  'Kastamonu': ['Tosya', 'Taşköprü'],
  'Çankırı': ['Ilgaz'],
  'Sinop': ['Boyabat'],
  'Kırıkkale': ['Yahşihan']
};

// Sık anılan özel noktalar: [yazılış, il, görünen ad]. En uzun anahtar önce eşleştiği için "Kdz Ereğli", "Ereğli"den önce gelir.
const OZEL_YERLER = [
  ['Kdz Ereğli', 'Zonguldak', 'Ereğli'], ['Karadeniz Ereğli', 'Zonguldak', 'Ereğli'],
  ['Fetiye', 'Muğla', 'Fethiye'],
  ['Kapıkule', 'Edirne', 'Kapıkule'], ['İpsala', 'Edirne', 'İpsala'], ['Hamzabeyli', 'Kırklareli', 'Hamzabeyli'],
  ['Gürbulak', 'Ağrı', 'Gürbulak'], ['Habur', 'Şırnak', 'Habur'], ['Cilvegözü', 'Hatay', 'Cilvegözü'],
  ['Hadımköy', 'İstanbul', 'Hadımköy'], ['İkitelli', 'İstanbul', 'İkitelli'], ['Ambarlı', 'İstanbul', 'Ambarlı'], ['Dudullu', 'İstanbul', 'Dudullu']
];

const EK_TAM = ['dayim', 'dayiz', 'deyim', 'deyiz', 'tayim', 'tayiz', 'teyim', 'teyiz', 'dan', 'den', 'tan', 'ten', 'da', 'de', 'ta', 'te', 'ya', 'ye', 'a', 'e'];
const EK_KISALTMA = new Set(['dan', 'den', 'tan', 'ten', 'da', 'de', 'ta', 'te', 'ya', 'ye', 'a']); // "iste" ≠ "ist"+"e"
const EK_ROL = {
  dan: 'cikis', den: 'cikis', tan: 'cikis', ten: 'cikis',
  da: 'konum', de: 'konum', ta: 'konum', te: 'konum',
  dayim: 'konum', dayiz: 'konum', deyim: 'konum', deyiz: 'konum', tayim: 'konum', tayiz: 'konum', teyim: 'konum', teyiz: 'konum', // "Konya'dayım"
  ya: 'varis', ye: 'varis', a: 'varis', e: 'varis'
};

const YER_HARITASI = new Map();
function yerEkle(anahtarHam, il, ilce, ekTipi) {
  const anahtar = metniNormalizeEt(anahtarHam);
  if (!anahtar || YER_HARITASI.has(anahtar)) return; // ilk kayıt kazanır
  YER_HARITASI.set(anahtar, { il, ilce: ilce || null, ekTipi });
}
OZEL_YERLER.forEach(([ad, il, ilce]) => yerEkle(ad, il, ilce, 'tam'));
KISALTMALAR.forEach(([ad, il, ilce]) => yerEkle(ad, il, ilce, 'kisaltma'));
ILLER.forEach(il => yerEkle(il, il, null, 'tam'));
IL_TAKMA_ADLARI.forEach(([ad, il]) => yerEkle(ad, il, null, 'tam'));
Object.entries(ILCELER).forEach(([il, liste]) => liste.forEach(ilce => yerEkle(ilce, il, ilce, 'tam')));

// Tüm Türkiye ilçeleri (web uygulamasıyla ortak liste). Yukarıdaki elle seçilmiş kayıtlar önceliklidir.
// Sıradan kelimelerle karışan adlar ("Tire", "Bor", "Of"...) 'zayif' işaretlenir: yalnızca açık yön ekiyle kabul edilir.
const { ILCELER_TAM, ZAYIF_YERLER } = require('./yerler');
const ZAYIF_SET = new Set(ZAYIF_YERLER);
Object.entries(ILCELER_TAM).forEach(([il, liste]) => liste.forEach(ilce => {
  yerEkle(ilce, il, ilce, ZAYIF_SET.has(metniNormalizeEt(ilce)) ? 'zayif' : 'tam');
}));
const ZAYIF_EK = new Set(['dan', 'den', 'tan', 'ten', 'ya', 'ye']);

// Tek bir derlenmiş regex: en uzun anahtar önce denenir.
const YER_REGEX = (() => {
  const anahtarlar = [...YER_HARITASI.keys()].sort((a, b) => b.length - a.length);
  const kaynak = anahtarlar.map(a => a.replace(/ /g, '\\s')).join('|');
  return new RegExp(`\\b(${kaynak})(?:(${EK_TAM.join('|')})|\\s(dan|den|tan|ten))?\\b`, 'g');
})();

const yerMetni = (l) => (l.ilce ? `${l.il} / ${l.ilce}` : l.il);

// Bir satırdaki lokasyonları sırasıyla döndürür: { il, ilce, rol }
// rol: 'cikis' (-dan/-den) | 'konum' (-da/-de) | 'varis' (-a/-e/-ya/-ye) | null
function satirdanLokasyonlariBul(satir) {
  const temiz = metniNormalizeEt(satir);
  if (!temiz) return [];

  const ham = [];
  for (const m of temiz.matchAll(YER_REGEX)) {
    const kayit = YER_HARITASI.get(m[1]);
    if (!kayit) continue;
    const ek = m[2] || m[3] || '';
    if (ek && kayit.ekTipi === 'kisaltma' && !EK_KISALTMA.has(ek)) continue;
    if (kayit.ekTipi === 'zayif') {
      // "Tire'ye", "Tireden" ya da "Sarayönü den Tire" biçimi dışında çıplak "tire" sıradan kelime sayılır
      const onceki = ham[ham.length - 1];
      const bitisik = onceki && onceki.rol === 'cikis' && m.index - onceki.end <= 1;
      if (!ZAYIF_EK.has(ek) && !bitisik) continue;
    }
    ham.push({ il: kayit.il, ilce: kayit.ilce, rol: EK_ROL[ek] || null, start: m.index, end: m.index + m[0].length });
  }

  // "Konya Ereğli", "Ereğli Konya", "Kocaeli Gebze" gibi yan yana il+ilçe → tek lokasyon
  const birlesik = [];
  for (const yer of ham) {
    const onceki = birlesik[birlesik.length - 1];
    if (onceki && onceki.il === yer.il && yer.start - onceki.end <= 1 && (!onceki.ilce || !yer.ilce)) {
      onceki.ilce = onceki.ilce || yer.ilce;
      onceki.end = yer.end;
      onceki.rol = yer.rol || onceki.rol; // ek, kelimenin sonunda gelir
    } else {
      birlesik.push({ ...yer });
    }
  }

  const gorulen = new Set();
  return birlesik.filter(y => {
    const k = `${y.il}|${y.ilce || ''}`;
    if (gorulen.has(k)) return false;
    gorulen.add(k);
    return true;
  }).map(({ il, ilce, rol }) => ({ il, ilce, rol }));
}

// ════════════════════════════════════════════════════════════════
// 5. SPAM / İLAN SİNYALİ
// ════════════════════════════════════════════════════════════════
const URL_SILME_REGEX = /(?:https?:\/\/|www\.)\S+|chat\.whatsapp\.com\/\S*|\bt\.me\/\S*|\bbit\.ly\/\S*/gi;
const LINK_REGEX = /https?:\/\/|www\.|chat\.whatsapp\.com|\bt\.me\/|\bbit\.ly\//i;

// Normalize edilmiş metinde çalışır. Hepsi kelime sınırlı ve dar aralıklı: "evrak … taşımacılık" gibi
// meşru ilanlar yanlışlıkla elenmesin diye eski ".*" kalıpları kaldırıldı.
const SPAM_REGEX = [
  /\b(?:sofor|kaptan|eleman|personel)\b.{0,30}\b(?:aran\w*|ariyor\w*|lazim|gerek\w*|alinacak|alinir)\b/,
  /\bcalisma arkadasi\b/,
  /\bsatilik\b|\bsatiyorum\b|\bdevren\b/,
  /\bhasar\s?kayitsiz\b|\bekspertiz\b/,
  /\bevden eve\b|\bev tasima\b|\bev esya\w*|\bofis tasima\b|\bceyiz\b/,
  /\bradar\b|\bceza yedik\b|\bmazot fiyat\w*|\bkantar acik\b|\bgrup kural\w*|\bgruba katil\w*|\bsaat kac\b/,
  /\bkapora\b|\bguvenli odeme\b|\bparana sahip\b/
];

// wa.me/905... bağlantısı bir iletişim numarasıdır; spam sayılmasın diye numaraya çevrilir.
function waLinkleriniNumarayaCevir(metin) {
  return String(metin || '').replace(/(?:https?:\/\/)?wa\.me\/\+?(\d{10,13})\S*/gi, ' $1 ');
}

function genelSpamMi(mesaj) {
  if (!mesaj || mesaj.length < 8 || mesaj.length > 5000) return true;
  if (LINK_REGEX.test(mesaj)) return true;
  const temiz = metniNormalizeEt(mesaj);
  return SPAM_REGEX.some(r => r.test(temiz));
}

// İlan gibi görünmesi için en az bir sinyal: telefon, araç tipi ya da yük/lojistik kelimesi
const ILAN_SINYAL_REGEX = /\b(?:yuk(?:u|ler|leri|lu|leme\w*|lenecek)?|arac\w*|lazim|aranir|araniyor|ariyoruz|ariyorum|musait\w*|bos|ton\w*|palet\w*|parsiyel|komple|koli|sefer\w*|nakliye\w*|navlun|cekici\w*|dorse\w*|konteyner\w*|sevkiyat\w*|hammadde|mevcut)\b/;

// ════════════════════════════════════════════════════════════════
// 6. ARAÇ TİPİ VE İLAN TÜRÜ
// ════════════════════════════════════════════════════════════════
// Sıra önemli: özelden genele. ("tir" alt metni "satir", "getir" gibi kelimelerde de geçtiği için kelime sınırı şart.)
const ARAC_TIPLERI = [
  ['Frigo TIR', /\bfrigo\w*|\bfrigorifik\w*/],
  ['Tenteli TIR', /\btenteli\b|\bkirmizi kapak\b|\bkirmizikapak\b|\bmega\b|\bjumbo\b/],
  ['Konteyner', /\bkonteyner\w*|\b(?:20|40)\s?(?:ayak|lik|luk)\b/],
  ['Lowbed', /\blowbed\b|\bloabed\b/],
  ['Tanker', /\btanker\w*|\bsilobas\b/],
  ['Damperli', /\bdamper\w*|\bhafriyat\b/],
  ['Kırkayak', /\bkirkayak\w*/],
  ['Kamyonet', /\bkamyonet\w*|\bpanelvan\b|\bpick ?up\b/],
  ['Kamyon', /\bkamyon\w*|\b(?:6|8|10|12|14)\s?teker\w*/],
  ['Dorse', /\bdorse\w*/],
  ['TIR', /\b13\s?60\b|\b1360\b|\btir(?:lar|la|a|i|in|dan|im|imiz)?\b|\bcekici\b/]
];

function aracTipiTespit(metin) {
  const alt = metniNormalizeEt(metin);
  for (const [ad, re] of ARAC_TIPLERI) if (re.test(alt)) return ad;
  return 'Belirtilmedi';
}

// Boş araç / "yük arıyorum" gibi araç tarafı ilanları ile "yük var / araç lazım" yük tarafı ilanlarını ayırır.
const BOS_ARAC_REGEX = /\bbosum\b|\bbosuz\b|\bbosta\b|\bmusait\w*|\byuk (?:ariyor\w*|lazim|bak\w*|araniyor|bulal\w*|istiyor\w*)\b|\bdonus(?:luk)? yuk\w*|\baraci?m(?:iz)? (?:bos|var|musait)\b|\bsefere hazir\b/;
const GUCLU_YUK_REGEX = /\byuk (?:var|cikti|mevcut)\b|\byuku var\b|\byuklemeli\b|\byuklenecek\b/;

function ilanTuruTespit(norm) {
  if (BOS_ARAC_REGEX.test(norm) && !GUCLU_YUK_REGEX.test(norm)) return 'ARAC';
  if (GUCLU_YUK_REGEX.test(norm)) return 'YUK';
  return null; // belirsiz
}

// ════════════════════════════════════════════════════════════════
// 7. ÇOKLU İLAN AYRIŞTIRMA
// ════════════════════════════════════════════════════════════════
const BASLIK_REGEX = /yukleme|cikis|kalkis|aranir|araniyor|lazim|yuklu|yukler/;

function rotaCoz(loks, ortak) {
  if (loks.length >= 2) {
    let kalkis = loks[0];
    let hedefler = loks.slice(1);

    // Ek bilgisi (-dan / -a) varsa yönü ondan oku: "Ankara'ya Konya'dan" → Konya ➡️ Ankara
    const cikislar = loks.filter(l => l.rol === 'cikis' || l.rol === 'konum');
    const varislar = loks.filter(l => l.rol === 'varis');
    if (cikislar.length && varislar.length) {
      const aday = cikislar[0];
      const adayHedefler = loks.filter(l => l !== aday && (l.rol === 'varis' || l.rol === null));
      if (adayHedefler.length) { kalkis = aday; hedefler = adayHedefler; }
    }
    return { kalkis, hedefler };
  }

  const tek = loks[0];
  if (ortak && ortak.il !== tek.il) return { kalkis: ortak, hedefler: [tek] };
  return null;
}

function enYakinTelefon(satirTelefonlari, idx) {
  let enIyi = null;
  let enIyiMesafe = Infinity;
  satirTelefonlari.forEach((liste, i) => {
    if (!liste.length) return;
    const mesafe = Math.abs(i - idx);
    // eşitlikte alttaki numara tercih edilir (numara genelde en altta yazılır)
    if (mesafe < enIyiMesafe || (mesafe === enIyiMesafe && i > idx)) { enIyi = liste[0]; enIyiMesafe = mesafe; }
  });
  return enIyi;
}

function detayOlustur(satir, baslikSatiri) {
  let d = telefonlariTemizle(satir);
  if (d.length < 15 && baslikSatiri) {
    const b = telefonlariTemizle(baslikSatiri);
    if (b && b !== d) d = `${b} • ${d}`.trim();
  }
  return kisalt(d, 300);
}

function ilanNesnesi({ tur, kalkis, hedefler, arac, telefon, telefonKaynagi, detay }) {
  const nereden = kalkis ? yerMetni(kalkis) : 'Belirtilmedi';
  const nereye = hedefler.length ? hedefler.map(yerMetni).join(', ') : 'Belirtilmedi';
  return {
    tur,
    nereden,
    nereye,
    kalkis_il: kalkis ? kalkis.il : null,
    varis_iller: [...new Set(hedefler.map(h => h.il))],
    arac_tipi: arac,
    telefon_ham: telefon || null,
    telefon: telefon ? telefonuBicimle(telefon) : 'İlan metnini inceleyin',
    telefon_kaynagi: telefon ? telefonKaynagi : null,
    detay
  };
}

function cokluIlanlariAyristir(hamMesaj, secenekler = {}) {
  const ret = (neden) => { if (secenekler.retKaydi) secenekler.retKaydi(neden); return []; };

  const cevrilmis = waLinkleriniNumarayaCevir(hamMesaj);
  if (!cevrilmis || cevrilmis.length < 8) return ret('cok_kisa');
  if (cevrilmis.length > 5000) return ret('cok_uzun');

  // Linkler artık mesajı çöpe atmaz; sadece metinden silinir.
  const linksiz = cevrilmis.replace(URL_SILME_REGEX, ' ');
  const tumSatirlar = linksiz.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  // Spam kalıpları SATIR bazında uygulanır: spam satırı atılır, kalan ilan satırları korunur.
  // Mesajda spam izi varsa, en az 2 net ilan çıkmadıkça mesaj kabul edilmez (tek satırlık iş ilanı vb. sızmasın).
  const spamSatir = (s) => { const n = metniNormalizeEt(s); return SPAM_REGEX.some(r => r.test(n)); };
  const tamNorm = metniNormalizeEt(linksiz);
  const spamVar = SPAM_REGEX.some(r => r.test(tamNorm)) || tumSatirlar.some(spamSatir);
  const satirlar = spamVar ? tumSatirlar.filter(s => !spamSatir(s)) : tumSatirlar;
  if (!satirlar.length) return ret('spam');
  const metin = satirlar.join('\n');
  const mesajNorm = metniNormalizeEt(metin);
  const satirTelefonlari = satirlar.map(telefonlariBul);
  const tumTelefonlar = satirTelefonlari.flat();
  const satirAraclari = satirlar.map(aracTipiTespit);
  const farkliAraclar = [...new Set(satirAraclari.filter(a => a !== 'Belirtilmedi'))];

  const gondericiTel = secenekler.gondericiTelefon || null;
  const sinyalVar = tumTelefonlar.length > 0 || farkliAraclar.length > 0 || ILAN_SINYAL_REGEX.test(mesajNorm);
  if (!sinyalVar) return ret('sinyal_yok');

  const mesajTuru = ilanTuruTespit(mesajNorm);

  // Başlıkta ortak kalkış noktası ("KONYA ÇIKIŞLI ...") — ilk 3 satır
  let ortak = null;
  let baslikSatiri = null;
  for (const satir of satirlar.slice(0, 3)) {
    const loks = satirdanLokasyonlariBul(satir);
    if (!loks.length) continue;
    if (loks.length === 1 || BASLIK_REGEX.test(metniNormalizeEt(satir))) {
      ortak = loks[0];
      baslikSatiri = satir;
      break;
    }
  }

  // Aracı olmayan satırlar için varsayılan araç: başlıktaki araç, yoksa mesajda TEK bir araç tipi geçiyorsa o.
  // Mesajda birden fazla farklı araç varsa tahmin yürütmeyiz ("Belirtilmedi").
  const baslikArac = baslikSatiri ? aracTipiTespit(baslikSatiri) : 'Belirtilmedi';
  const mesajArac = baslikArac !== 'Belirtilmedi' ? baslikArac : (farkliAraclar.length === 1 ? farkliAraclar[0] : 'Belirtilmedi');

  const bulunanlar = [];

  satirlar.forEach((satir, idx) => {
    if (bulunanlar.length >= CONFIG.MAX_ILAN_PER_MESAJ) return;
    if (/^[\d\s+()\-.]+$/.test(satir)) return; // sadece telefon/rakam satırı

    const loks = satirdanLokasyonlariBul(satir);
    if (!loks.length) return;

    const rota = rotaCoz(loks, ortak);
    if (!rota) return;

    const satirNorm = metniNormalizeEt(satir);
    const satirTel = satirTelefonlari[idx][0] || null;
    const telefon = satirTel || enYakinTelefon(satirTelefonlari, idx) || gondericiTel;
    const telefonKaynagi = (satirTel || tumTelefonlar.length) ? 'ilan' : 'gonderici';
    const satirArac = satirAraclari[idx];
    const tur = ilanTuruTespit(satirNorm) || mesajTuru || 'YUK';

    bulunanlar.push(ilanNesnesi({
      tur,
      kalkis: rota.kalkis,
      hedefler: rota.hedefler,
      arac: satirArac !== 'Belirtilmedi' ? satirArac : mesajArac,
      telefon,
      telefonKaynagi,
      detay: detayOlustur(satir, ortak && satir !== baslikSatiri ? baslikSatiri : null)
    }));
  });

  // "Konya'da tır lazım 0532..." gibi tek şehirli ama net ilanlar
  if (!bulunanlar.length && ortak && ortak.rol !== 'varis' && CONFIG.TEK_SEHIRLI_ILAN_KABUL) {
    const telefon = tumTelefonlar[0] || null;
    const net = telefon && (farkliAraclar.length > 0 || ILAN_SINYAL_REGEX.test(mesajNorm));
    if (net) {
      bulunanlar.push(ilanNesnesi({
        tur: mesajTuru || 'YUK',
        kalkis: ortak,
        hedefler: [],
        arac: mesajArac,
        telefon,
        telefonKaynagi: 'ilan',
        detay: detayOlustur(satirlar.join(' '), null)
      }));
    }
  }

  // Rotası çözülemeyen ama telefon + ilan sinyali taşıyan mesajlar da kaçmasın
  if (!bulunanlar.length && CONFIG.ROTASIZ_ILAN_KABUL) {
    const telefon = tumTelefonlar[0] || gondericiTel;
    const sinyal = farkliAraclar.length > 0 || ILAN_SINYAL_REGEX.test(mesajNorm);
    if (telefon && sinyal) {
      const loks = satirlar.flatMap(satirdanLokasyonlariBul);
      bulunanlar.push(ilanNesnesi({
        tur: mesajTuru || 'YUK',
        kalkis: ortak || loks[0] || null,
        hedefler: [],
        arac: mesajArac,
        telefon,
        telefonKaynagi: tumTelefonlar.length ? 'ilan' : 'gonderici',
        detay: detayOlustur(satirlar.join(' '), null)
      }));
    }
  }

  if (spamVar && bulunanlar.length < 2) return ret('spam_is_ilani');
  if (!bulunanlar.length) return ret(tumTelefonlar.length ? 'rota_yok' : 'telefon_yok');
  return bulunanlar;
}

// ════════════════════════════════════════════════════════════════
// 8. MÜKERRER İLAN ENGELLEME
// ════════════════════════════════════════════════════════════════
const mesajEngelleri = new Map(); // hash → zaman
const islenenMesajlar = new Map(); // mesaj id → zaman

function mukerrerIlanMi(ilan) {
  const simdi = Date.now();
  // Telefon biliniyorsa rota+araç+telefon; bilinmiyorsa rota+detay. Aynı ilan farklı gruplarda biraz değişik
  // yazılsa bile telefon aynı olduğu için yakalanır.
  const anahtar = ilan.telefon_ham
    ? `${ilan.tur}|${ilan.nereden}|${ilan.nereye}|${ilan.arac_tipi}|${ilan.telefon_ham}${ilan.nereden === 'Belirtilmedi' ? '|' + ilan.detay : ''}`
    : `${ilan.tur}|${ilan.nereden}|${ilan.nereye}|${ilan.detay}`;
  const hash = crypto.createHash('md5').update(metniNormalizeEt(anahtar)).digest('hex');

  const onceki = mesajEngelleri.get(hash);
  if (onceki && simdi - onceki < CONFIG.MUKERRER_SAAT * 3600 * 1000) return true;

  mesajEngelleri.set(hash, simdi);
  return false;
}

function bellekTemizle() {
  const simdi = Date.now();
  for (const [k, t] of mesajEngelleri) if (simdi - t > CONFIG.MUKERRER_SAAT * 3600 * 1000) mesajEngelleri.delete(k);
  for (const [k, t] of islenenMesajlar) if (simdi - t > 3600 * 1000) islenenMesajlar.delete(k);
  for (const [k, v] of grupAdlari) if (simdi - v.zaman > 24 * 3600 * 1000) grupAdlari.delete(k);
}

// ════════════════════════════════════════════════════════════════
// 9. TELEGRAM (kuyruklu, hız limitine uyumlu)
// ════════════════════════════════════════════════════════════════
const telegramKuyrugu = [];
let telegramCalisiyor = false;
let telegramYapilandirmaUyarildi = false;

function hashtagUret(ilan) {
  const iller = [ilan.kalkis_il, ...ilan.varis_iller].filter(Boolean);
  const etiketler = [...new Set(iller)]
    .map(il => il.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .map(e => `#${e}`);
  return etiketler.join(' ');
}

function telegramMetniOlustur(ilan) {
  const bosArac = ilan.tur === 'ARAC';
  const baslik = bosArac ? '🚛 <b>BOŞ ARAÇ İLANI</b>' : '📦 <b>YENİ NAKLİYE İLANI</b>';

  const satirlar = [
    baslik,
    '',
    `📍 <b>Rota:</b> ${ilan.nereden === 'Belirtilmedi' && ilan.nereye === 'Belirtilmedi' ? 'İlan metnine bakın' : `${htmlTemizle(ilan.nereden)} ➡️ ${htmlTemizle(ilan.nereye)}`}`,
    `📝 <b>${bosArac ? 'Detay' : 'Yük / Detay'}:</b> ${htmlTemizle(ilan.detay)}`,
    `🚛 <b>Araç Tipi:</b> ${htmlTemizle(ilan.arac_tipi)}`,
    `📞 <b>İletişim:</b> ${htmlTemizle(ilan.telefon)}`
  ];

  // Cep telefonuysa tek dokunuşla WhatsApp bağlantısı
  if (ilan.telefon_ham && /^05\d{9}$/.test(ilan.telefon_ham)) {
    satirlar.push(`💬 <a href="https://wa.me/90${ilan.telefon_ham.slice(1)}">WhatsApp'tan yaz</a>`);
  }

  const etiketler = hashtagUret(ilan);
  if (etiketler) satirlar.push('', etiketler);
  satirlar.push('', '───────────────', '📲 <i>Nakliye Cepte canlı yük akışı</i>');
  return satirlar.join('\n');
}

async function telegramGonderTek(metin) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.TELEGRAM_KANAL_ID,
        text: metin,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true }
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (res.ok) return { ok: true };

    const veri = await res.json().catch(() => ({}));
    if (res.status === 429) {
      const sn = veri?.parameters?.retry_after || 5;
      return { ok: false, beklemeMs: (sn + 1) * 1000 };
    }
    console.error(`⚠️ Telegram ${res.status}: ${veri?.description || 'bilinmeyen hata'}`);
    // 400/401/403/404 → tekrar denemek işe yaramaz (yanlış token, kanal, biçim hatası)
    return { ok: false, vazgec: res.status >= 400 && res.status < 500 };
  } catch (err) {
    console.error('⚠️ Telegram bağlantı hatası:', err.message);
    return { ok: false };
  }
}

async function telegramKuyrugunuIsle() {
  if (telegramCalisiyor) return;
  telegramCalisiyor = true;
  try {
    while (telegramKuyrugu.length) {
      const oge = telegramKuyrugu[0];
      const sonuc = await telegramGonderTek(oge.metin);

      if (sonuc.ok) {
        telegramKuyrugu.shift();
        istatistik.telegramGonderilen++;
      } else if (sonuc.beklemeMs) {
        console.warn(`⏳ Telegram hız sınırı, ${Math.round(sonuc.beklemeMs / 1000)} sn bekleniyor...`);
        await bekle(sonuc.beklemeMs);
        continue;
      } else {
        oge.deneme = (oge.deneme || 0) + 1;
        if (sonuc.vazgec || oge.deneme >= 3) {
          telegramKuyrugu.shift();
          istatistik.telegramHata++;
        } else {
          await bekle(2000 * oge.deneme);
          continue;
        }
      }
      await bekle(CONFIG.TELEGRAM_ARALIK_MS);
    }
  } finally {
    telegramCalisiyor = false;
  }
}

function telegramaGonder(metin) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_KANAL_ID) {
    if (!telegramYapilandirmaUyarildi) {
      console.warn('⚠️ TELEGRAM_BOT_TOKEN / TELEGRAM_KANAL_ID tanımlı değil, Telegram gönderimi kapalı.');
      telegramYapilandirmaUyarildi = true;
    }
    return;
  }
  if (telegramKuyrugu.length >= CONFIG.TELEGRAM_KUYRUK_MAX) {
    telegramKuyrugu.shift(); // en eskiyi düşür; yeni ilan daha değerli
    istatistik.telegramDusen++;
  }
  telegramKuyrugu.push({ metin, deneme: 0 });
  telegramKuyrugunuIsle().catch(err => console.error('⚠️ Telegram kuyruk hatası:', err.message));
}

// ════════════════════════════════════════════════════════════════
// 10. SUPABASE
// ════════════════════════════════════════════════════════════════
let supabase = null;
let supabaseUyarildi = false;

function supabaseIstemcisi() {
  if (supabase) return supabase;
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY) {
    if (!supabaseUyarildi) {
      console.warn('⚠️ SUPABASE_URL / SUPABASE_KEY tanımlı değil, veritabanı kaydı kapalı.');
      supabaseUyarildi = true;
    }
    return null;
  }
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return supabase;
}

function supabaseSatiri(ilan) {
  let detay = ilan.detay;
  if (ilan.tur === 'ARAC') detay = `[BOŞ ARAÇ] ${detay}`;

  const satir = {
    from_city: ilan.nereden,
    to_city: ilan.nereye,
    cargo_detail: detay,
    vehicle_type: ilan.arac_tipi,
    company_name: 'WhatsApp Lojistik Akışı'
  };

  if (ilan.telefon_ham) {
    if (CONFIG.SUPABASE_TELEFON_KOLONU) satir[CONFIG.SUPABASE_TELEFON_KOLONU] = ilan.telefon_ham;
    else satir.cargo_detail = `${satir.cargo_detail} — Tel: ${ilan.telefon}`; // ayrı kolon yoksa telefon kaybolmasın
  }
  return satir;
}

async function supabaseKaydet(satirlar) {
  const db = supabaseIstemcisi();
  if (!db || !satirlar.length) return;

  for (let deneme = 1; deneme <= 3; deneme++) {
    try {
      const { error } = await db.from(CONFIG.SUPABASE_TABLO).insert(satirlar);
      if (!error) {
        istatistik.supabaseKaydedilen += satirlar.length;
        console.log(`🚀 ${satirlar.length} adet ilan Supabase'e kaydedildi!`);
        return;
      }
      console.error(`❌ Supabase kayıt hatası (deneme ${deneme}/3): ${error.message}`);
      // Yetki (RLS), kolon yok, kısıt ihlali gibi kalıcı hatalarda tekrar denemeye gerek yok
      if (error.code && /^(42|23|PGRST)/.test(error.code)) break;
    } catch (err) {
      console.error(`❌ Supabase bağlantı hatası (deneme ${deneme}/3): ${err.message}`);
    }
    await bekle(1500 * deneme);
  }
  istatistik.supabaseHata += satirlar.length;
}

async function eskiIlanlariTemizle() {
  const db = supabaseIstemcisi();
  if (!db) return;
  try {
    const sinir = new Date(Date.now() - CONFIG.ILAN_OMRU_SAAT * 3600 * 1000).toISOString();
    const { count, error } = await db.from(CONFIG.SUPABASE_TABLO).delete({ count: 'exact' }).lt('created_at', sinir);
    if (error) console.error('⚠️ Temizlik hatası:', error.message);
    else if (count) console.log(`🧹 Otomatik Temizlik: ${count} eski ilan silindi.`);
  } catch (err) {
    console.error('⚠️ Temizlik hatası:', err.message);
  }
}

// ════════════════════════════════════════════════════════════════
// 11. WEB PANEL (QR / eşleştirme kodu / sağlık)
// ════════════════════════════════════════════════════════════════
function anahtarDogruMu(girilen, gercek) {
  const a = crypto.createHash('sha256').update(String(girilen)).digest();
  const b = crypto.createHash('sha256').update(String(gercek)).digest();
  return crypto.timingSafeEqual(a, b);
}

function sureMetni(ms) {
  const dk = Math.floor(ms / 60000);
  if (dk < 60) return `${dk} dk`;
  const sa = Math.floor(dk / 60);
  return sa < 48 ? `${sa} sa ${dk % 60} dk` : `${Math.floor(sa / 24)} gün`;
}

function panelHtml() {
  const bagli = durum.baglanti === 'acik';
  const rozet = bagli ? '🟢 Bağlı' : durum.baglanti === 'baslatiliyor' ? '🟡 Başlatılıyor' : '🔴 Bağlantı yok';
  const sonMesaj = durum.sonMesajZamani ? `${sureMetni(Date.now() - durum.sonMesajZamani)} önce` : 'henüz yok';

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <title>Nakliye Cepte - WhatsApp Panel</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="5">
  <meta name="robots" content="noindex">
  <style>
    body { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background-color: #f0f2f5; font-family: sans-serif; }
    .card { background: white; padding: 30px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 90%; width: 340px; }
    img { width: 250px; height: 250px; border: 4px solid #25d366; border-radius: 12px; padding: 10px; background: #fff; }
    h2 { color: #075e54; margin-bottom: 8px; }
    p { color: #666; font-size: 14px; margin-top: 15px; }
    .badge { background: #e7fce8; color: #0f5132; padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 13px; display: inline-block; margin-bottom: 15px; }
    .code-box { background: #111b21; color: #00a884; font-size: 28px; font-weight: bold; letter-spacing: 4px; padding: 15px; border-radius: 10px; margin: 15px 0; font-family: monospace; }
    .stat { font-size: 12px; color: #888; line-height: 1.7; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Nakliye Cepte Bot</h2>
    <div class="badge">${rozet}</div><br>
    ${durum.eslestirmeKodu ? `
      <p><b>📱 EŞLEŞTİRME KODUNUZ:</b></p>
      <div class="code-box">${htmlTemizle(durum.eslestirmeKodu)}</div>
      <p>WhatsApp → <b>Bağlı Cihazlar</b> → <b>Cihaz Bağla</b> → <b>Telefon Numarası İle Bağla</b></p>` : ''}
    ${durum.qrDataURL ? `
      <img src="${durum.qrDataURL}" alt="WhatsApp QR Code" />
      <p>VEYA kamera ile QR kodu okutun.</p>` : ''}
    ${bagli ? '<p>Bot bağlı ve grupları dinliyor...</p>' : ''}
    <p class="stat">
      Açık kalma: ${sureMetni(Date.now() - durum.baslangic)} · Son mesaj: ${sonMesaj}<br>
      Mesaj: ${istatistik.mesaj} · İlan: ${istatistik.ilanBulunan} · Mükerrer: ${istatistik.mukerrer}<br>
      Telegram: ${istatistik.telegramGonderilen} gönderildi / ${telegramKuyrugu.length} sırada<br>
      Supabase: ${istatistik.supabaseKaydedilen} kayıt
    </p>
  </div>
</body>
</html>`;
}

function sunucuyuBaslat() {
  const sunucu = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end(); }

    if (url.pathname === '/qr') {
      // QR/eşleştirme kodunu bilen WhatsApp hesabını ele geçirir; bu yüzden şifreli.
      if (!anahtarDogruMu(url.searchParams.get('key') || '', CONFIG.PANEL_KEY)) {
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Yetkisiz. Adres: /qr?key=PANEL_KEY');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
      return res.end(panelHtml());
    }

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({
        durum: durum.baglanti,
        acikKalmaDk: Math.floor((Date.now() - durum.baslangic) / 60000),
        sonMesajDkOnce: durum.sonMesajZamani ? Math.floor((Date.now() - durum.sonMesajZamani) / 60000) : null,
        telegramKuyruk: telegramKuyrugu.length,
        ...istatistik
      }));
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nakliye Cepte WhatsApp Botu 7/24 Aktif!');
  });

  sunucu.listen(CONFIG.PORT, () => {
    console.log(`🌐 Sunucu ${CONFIG.PORT} portunda çalışıyor.`);
    if (CONFIG.PANEL_KEY_RASTGELE) {
      console.log(`🔑 PANEL_KEY tanımlı değil. Bu açılış için panel adresi: /qr?key=${CONFIG.PANEL_KEY}`);
    }
  });
}

// ════════════════════════════════════════════════════════════════
// 12. WHATSAPP BAĞLANTISI
// ════════════════════════════════════════════════════════════════
const grupAdlari = new Map(); // jid → { ad, zaman }

const engelliJidler = new Set();
let grupYenilemeZamanlayici = null;

function engelliAdMi(ad) {
  const n = metniNormalizeEt(ad);
  return !!n && CONFIG.ENGELLI_GRUPLAR.some(e => n.includes(e));
}

// Tüm grupları TEK çağrıda çeker (1245 ayrı groupMetadata sorgusu yerine) ve engelli grupların JID'ini bulur.
let sonGrupCekimi = 0;
async function gruplariOnbellegeAl(sock) {
  if (Date.now() - sonGrupCekimi < 6 * 3600 * 1000) return; // yeniden bağlanma döngüsünde tekrar çekme
  sonGrupCekimi = Date.now();
  try {
    let tum = await sock.groupFetchAllParticipating(); // DİKKAT: tüm grupların TÜM katılımcılarını getirir → geçici büyük bellek yükü
    let n = 0;
    for (const [jid, meta] of Object.entries(tum || {})) {
      const ad = meta?.subject || jid;
      grupAdlari.set(jid, { ad, zaman: Date.now() });
      if (engelliAdMi(ad)) engelliJidler.add(jid); else engelliJidler.delete(jid);
      n++;
    }
    tum = null; // katılımcı listeleri hemen GC'ye bırakılsın
    console.log(`👥 ${n} grup önbelleğe alındı | engelli grup: ${engelliJidler.size}`);
  } catch (err) {
    console.error('⚠️ Grup listesi alınamadı:', err.message);
  }
}

async function kanallaraAboneOl(sock) {
  for (const jid of CONFIG.KANAL_JIDLERI) {
    try {
      if (typeof sock.subscribeNewsletterUpdates !== 'function') {
        console.warn('⚠️ Bu Baileys sürümünde kanal aboneliği fonksiyonu yok.');
        return;
      }
      await sock.subscribeNewsletterUpdates(jid);
      console.log(`📢 Kanala abone olundu: ${jid}`);
    } catch (err) {
      console.error(`⚠️ Kanal aboneliği başarısız (${jid}): ${err.message}`);
    }
  }
}

function retKaydet(neden, hamMesaj, jid) {
  retSayac[neden] = (retSayac[neden] || 0) + 1;
  if (!CONFIG.RET_LOG || !telefonlariBul(hamMesaj).length) return; // yalnızca telefon içerip ilan sayılmayanlar
  const ad = grupAdlari.get(jid)?.ad || jid;
  const metin = String(hamMesaj).replace(TEL_MOBIL_REGEX, '☎').replace(TEL_SABIT_REGEX, '☎').replace(/\s+/g, ' ');
  console.log(`🚫 [RET:${neden}] 👥 ${kisalt(ad, 30)} | ${kisalt(metin, 160)}`);
}

async function grupAdiGetir(sock, jid) {
  if (jid.endsWith('@newsletter')) return `Kanal ${jid}`;
  const kayit = grupAdlari.get(jid);
  if (kayit && Date.now() - kayit.zaman < 12 * 3600 * 1000) return kayit.ad;
  try {
    const meta = await sock.groupMetadata(jid);
    const ad = meta?.subject || jid;
    grupAdlari.set(jid, { ad, zaman: Date.now() });
    if (engelliAdMi(ad)) engelliJidler.add(jid);
    return ad;
  } catch {
    // başarısız olursa ~1 saat sonra tekrar dene (sürekli sorgu atma)
    grupAdlari.set(jid, { ad: jid, zaman: Date.now() - 11 * 3600 * 1000 });
    return jid;
  }
}

function saniyeyeCevir(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts.toNumber === 'function') return ts.toNumber(); // Long
  return Number(ts) || 0;
}

function gondericiTelefonu(msg) {
  const jid = msg.key?.participant || '';
  if (!jid.endsWith('@s.whatsapp.net')) return null; // @lid ise numara bilinmez
  return telefonNormalizeEt(jid.split('@')[0].split(':')[0]);
}

async function mesajiIsle(sock, msg) {
  const jid = msg?.key?.remoteJid || '';
  if (!msg?.message || msg.key?.fromMe || !(jid.endsWith('@g.us') || jid.endsWith('@newsletter'))) return;
  if (engelliJidler.has(jid)) return;

  // Aynı mesajın iki kez gelmesine karşı
  const mesajKimligi = `${msg.key.remoteJid}:${msg.key.id}`;
  if (islenenMesajlar.has(mesajKimligi)) return;
  islenenMesajlar.set(mesajKimligi, Date.now());

  // Bot uzun süre kapalı kaldıysa eski mesajları "canlı ilan" diye basma
  const ts = saniyeyeCevir(msg.messageTimestamp);
  if (ts && Date.now() / 1000 - ts > CONFIG.MAX_MESAJ_YASI_DK * 60) {
    istatistik.eskiMesaj++;
    return;
  }

  const hamMesaj = mesajMetniniCikar(msg.message);
  if (!hamMesaj) return;

  if (CONFIG.ENGELLI_GRUPLAR.length && !jid.endsWith('@newsletter')) {
    const ad = await grupAdiGetir(sock, jid);
    if (engelliAdMi(ad)) { engelliJidler.add(jid); return; }
  }

  istatistik.mesaj++;
  durum.sonMesajZamani = Date.now();
  const gi = grupIstatistik.get(jid) || { mesaj: 0, ilan: 0 };
  gi.mesaj++;
  grupIstatistik.set(jid, gi);

  const ilanlar = cokluIlanlariAyristir(hamMesaj, {
    gondericiTelefon: CONFIG.GONDERICI_NUMARASINI_KULLAN ? gondericiTelefonu(msg) : null,
    retKaydi: (neden) => retKaydet(neden, hamMesaj, jid)
  });
  if (!ilanlar.length) return;

  const kaydedilecekler = [];
  let grupAdi = null;

  for (const ilan of ilanlar) {
    if (ilan.tur === 'ARAC' && CONFIG.BOS_ARAC_ILANLARINI_ATLA) continue;

    if (mukerrerIlanMi(ilan)) {
      istatistik.mukerrer++;
      continue;
    }

    istatistik.ilanBulunan++;
    gi.ilan++;
    grupAdi = grupAdi || (await grupAdiGetir(sock, msg.key.remoteJid));
    console.log(`⚡ [${ilan.tur === 'ARAC' ? 'BOŞ ARAÇ' : 'YENİ İLAN'}] ${ilan.nereden} ➡️ ${ilan.nereye} | ${ilan.arac_tipi} | ${ilan.telefon} | 👥 ${grupAdi}`);

    kaydedilecekler.push(supabaseSatiri(ilan));
    telegramaGonder(telegramMetniOlustur(ilan));
  }

  if (kaydedilecekler.length) await supabaseKaydet(kaydedilecekler);
}

let yenidenDeneme = 0;
let yenidenZamanlayici = null;

function yenidenBaglanPlanla(gecikmeMs) {
  if (yenidenZamanlayici) return;
  yenidenZamanlayici = setTimeout(() => {
    yenidenZamanlayici = null;
    baglan();
  }, gecikmeMs);
}

async function baglan() {
  try {
    const {
      default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState, Browsers
    } = require('@whiskeysockets/baileys');
    const QRCode = require('qrcode');

    // pino varsa sadece uyarı/hata göster (varsayılan seviye çok gürültülü); yoksa sessiz logger
    let logger;
    try { logger = require('pino')({ level: 'warn' }); } catch {
      const sessiz = { level: 'silent', child() { return sessiz; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };
      logger = sessiz;
    }

    const { state, saveCreds } = await useMultiFileAuthState(CONFIG.AUTH_DIR); // artık AUTH_DIR ile aynı yol
    const { version } = await fetchLatestBaileysVersion();

    durum.baglanti = 'baslatiliyor';

    const sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,        // telefonda bildirimleri susturmasın
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false
    });

    let eslestirmeIstendi = false;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        try { durum.qrDataURL = await QRCode.toDataURL(qr); } catch (err) { console.error('⚠️ QR üretilemedi:', err.message); }

        // Eşleştirme kodu: QR olayı bağlantının hazır olduğunu gösterir
        if (!eslestirmeIstendi && !sock.authState.creds.registered && CONFIG.PHONE_NUMBER && CONFIG.PHONE_NUMBER !== '905XXXXXXXXX') {
          eslestirmeIstendi = true;
          try {
            const kod = await sock.requestPairingCode(CONFIG.PHONE_NUMBER);
            durum.eslestirmeKodu = kod?.match(/.{1,4}/g)?.join('-') || kod;
            console.log(`\n👉 EŞLEŞTİRME KODUNUZ: ${durum.eslestirmeKodu}\n`);
          } catch (err) {
            console.error('⚠️ Pairing Code üretilemedi:', err.message);
          }
        }
      }

      if (connection === 'open') {
        durum.baglanti = 'acik';
        durum.qrDataURL = null;
        durum.eslestirmeKodu = null;
        yenidenDeneme = 0;
        console.log('✅ NAKLİYE CEPTE BOTU BAĞLANDI! İLANLAR DİNLENİYOR.');
        gruplariOnbellegeAl(sock);
        clearInterval(grupYenilemeZamanlayici);
        grupYenilemeZamanlayici = setInterval(() => gruplariOnbellegeAl(sock), 6 * 3600 * 1000);
        kanallaraAboneOl(sock);
      }

      if (connection === 'close') {
        durum.baglanti = 'kapali';
        clearInterval(grupYenilemeZamanlayici);
        try {
          sock.ev.removeAllListeners('messages.upsert');
          sock.ev.removeAllListeners('creds.update');
          sock.end(undefined);
        } catch { /* zaten kapalı */ }
        const kod = lastDisconnect?.error?.output?.statusCode;
        console.warn(`🔌 Bağlantı kapandı (kod: ${kod ?? 'bilinmiyor'}).`);

        if (kod === DisconnectReason.loggedOut) {
          // Oturum WhatsApp tarafında kapatıldı: eski kimliği sil ve yeniden eşleştirme başlat
          console.warn('🚪 Oturum kapatılmış; kayıtlı kimlik siliniyor, yeni eşleştirme bekleniyor.');
          try { fs.rmSync(CONFIG.AUTH_DIR, { recursive: true, force: true }); } catch (err) { console.error('⚠️ Auth silinemedi:', err.message); }
          durum.eslestirmeKodu = null;
          yenidenBaglanPlanla(2000);
        } else if (kod === DisconnectReason.connectionReplaced) {
          // Aynı oturum başka yerde açıldı (ör. deploy sırasında iki kopya). Hemen dönersek kavga ederler.
          console.error('⚠️ Oturum başka bir yerde açıldı (connectionReplaced). 60 sn sonra tekrar denenecek.');
          yenidenBaglanPlanla(60000);
        } else if (kod === DisconnectReason.restartRequired) {
          yenidenBaglanPlanla(1000); // eşleştirme sonrası normal yeniden başlatma
        } else {
          yenidenDeneme++;
          const gecikme = Math.min(3000 * 2 ** Math.min(yenidenDeneme - 1, 5), 60000); // 3sn → 60sn
          console.log(`🔁 ${Math.round(gecikme / 1000)} sn sonra yeniden bağlanılacak (deneme ${yenidenDeneme}).`);
          yenidenBaglanPlanla(gecikme);
        }
      }
    });

    // Sadece canlı gelen mesajlar ('notify'); geçmişten yüklenenler ('append') işlenmez
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' || !messages?.length) return;
      for (const msg of messages) {
        try {
          await mesajiIsle(sock, msg);
        } catch (err) {
          console.error('⚠️ Mesaj işleme hatası:', err);
        }
      }
    });
  } catch (err) {
    console.error('❌ Bağlantı başlatılamadı:', err.message);
    yenidenDeneme++;
    yenidenBaglanPlanla(Math.min(5000 * yenidenDeneme, 60000));
  }
}

// ════════════════════════════════════════════════════════════════
// 13. BAŞLAT
// ════════════════════════════════════════════════════════════════
function main() {
  process.on('uncaughtException', (err) => console.error('🔥 Beklenmeyen Kritik Hata:', err));
  process.on('unhandledRejection', (reason) => console.error('🔥 Yakalanamayan Promise Hatası:', reason));

  for (const sinyal of ['SIGTERM', 'SIGINT']) {
    process.on(sinyal, async () => {
      console.log(`🛑 ${sinyal} alındı, kapanıyor...`);
      const t0 = Date.now();
      while (telegramKuyrugu.length && Date.now() - t0 < 5000) await bekle(200);
      process.exit(0);
    });
  }

  sunucuyuBaslat();

  // Yapılandırma denetimi: eksik/yanlış ayar sessizce çalışmayıp loga yazılsın
  const eksik = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_KANAL_ID', 'SUPABASE_URL', 'SUPABASE_KEY'].filter(k => !CONFIG[k]);
  if (eksik.length) console.warn(`⚠️ Tanımsız ayarlar: ${eksik.join(', ')} (ilgili özellikler kapalı kalır)`);
  if (CONFIG.SUPABASE_KEY && anahtarRolu(CONFIG.SUPABASE_KEY) === 'anon') {
    console.warn('⚠️ SUPABASE anahtarı "anon" rolünde. Güvenlik kilidi (006 SQL) açıldığında kayıt ve temizlik başarısız olur; service_role anahtarını SUPABASE_SERVICE_ROLE_KEY olarak girin.');
  }

  // Zamanlayıcılar BİR KEZ kurulur (eski sürümde her yeniden bağlanmada çoğalıyordu)
  eskiIlanlariTemizle();
  setInterval(eskiIlanlariTemizle, 60 * 60 * 1000);
  setInterval(bellekTemizle, 30 * 60 * 1000);
  setInterval(() => {
    const m = process.memoryUsage();
    const mb = (b) => Math.round(b / 1048576);
    console.log(`🧠 Bellek → rss: ${mb(m.rss)} MB, heap: ${mb(m.heapUsed)}/${mb(m.heapTotal)} MB | ` +
      `islenenMesajlar: ${islenenMesajlar.size}, mesajEngelleri: ${mesajEngelleri.size}, grupAdlari: ${grupAdlari.size}, ` +
      `grupIstatistik: ${grupIstatistik.size}, tgKuyruk: ${telegramKuyrugu.length}`);
  }, 10 * 60 * 1000);
  setInterval(() => {
    console.log(`📊 Saatlik özet → mesaj: ${istatistik.mesaj}, ilan: ${istatistik.ilanBulunan}, mükerrer: ${istatistik.mukerrer}, ` +
      `telegram: ${istatistik.telegramGonderilen} (hata ${istatistik.telegramHata}), supabase: ${istatistik.supabaseKaydedilen} (hata ${istatistik.supabaseHata})`);
    const top = [...grupIstatistik.entries()]
      .sort((a, b) => b[1].ilan - a[1].ilan || b[1].mesaj - a[1].mesaj).slice(0, 10)
      .map(([j, g]) => `${kisalt(grupAdlari.get(j)?.ad || j, 28)}: ${g.ilan}/${g.mesaj}`).join(' | ');
    console.log(`📈 Mesaj atan grup: ${grupIstatistik.size}/${grupAdlari.size} | telegram düşen: ${istatistik.telegramDusen} | ret: ${JSON.stringify(retSayac)}`);
    console.log(`🏆 En çok ilan (ilan/mesaj): ${top}`);
  }, 60 * 60 * 1000);

  baglan();
}

if (require.main === module) main();

module.exports = {
  metniNormalizeEt, mesajMetniniCikar, cokluIlanlariAyristir, satirdanLokasyonlariBul,
  aracTipiTespit, telefonlariBul, telefonNormalizeEt, genelSpamMi, mukerrerIlanMi,
  telegramMetniOlustur, supabaseSatiri, YER_HARITASI, CONFIG
};

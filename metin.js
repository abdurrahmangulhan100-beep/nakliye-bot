'use strict';
// Metin yardımcıları: sadeleştirme, link temizleme, telefon / şehir / araç tipi bulma.

const TR = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u' };
// Süslü yazı tipleri (ᴋᴜᴄᴜᴋ ʙᴀꜱ, 𝗞𝗮𝗹𝗶𝗻, tam genişlik) düz harfe çevrilir; yoksa filtreler atlanır / ilan "çok kısa" sayılır.
const KB = { '\u1D00': 'a', '\u0299': 'b', '\u1D04': 'c', '\u1D05': 'd', '\u1D07': 'e', '\uA730': 'f', '\u0262': 'g', '\u029C': 'h', '\u026A': 'i', '\u1D0A': 'j', '\u1D0B': 'k', '\u029F': 'l', '\u1D0D': 'm', '\u0274': 'n', '\u1D0F': 'o', '\u1D18': 'p', '\u0280': 'r', '\uA731': 's', '\u1D1B': 't', '\u1D1C': 'u', '\u1D20': 'v', '\u1D21': 'w', '\u028F': 'y', '\u1D22': 'z' };
const KB_RE = new RegExp('[' + Object.keys(KB).join('') + ']', 'g');
function normalize(t) {
  return String(t ?? '').normalize('NFKC').replace(KB_RE, c => KB[c]).toLocaleLowerCase('tr').replace(/\u0307/g, '')
    .replace(/[çğıöşüâîû]/g, c => TR[c])
    .replace(/['’‘`´ʼ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

// ── Link temizleme ──
const WA_ME = /(?:https?:\/\/)?(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=)\+?(\d{10,15})\S*/gi;
const LINK = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|info|biz|app|io|me|tr|xyz|online|site|shop|link|co)\b(?:\/\S*)?/gi;
// wa.me linki = iletişim numarası → numaraya çevrilir; diğer tüm linkler silinir.
function linkTemizle(ham) {
  let s = String(ham ?? '').replace(WA_ME, (_, n) => ' ' + (n.startsWith('90') && n.length === 12 ? '0' + n.slice(2) : n) + ' ');
  const linkSayisi = (s.match(LINK) || []).length;
  s = s.replace(LINK, ' ');
  s = s.split(/\r?\n/).map(l => l.replace(/[ \t]{2,}/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { metin: s, linkSayisi };
}

// ── Telefon ──
const MOBIL = /(?<!\d)(?:\+?90[\s.-]?|0[\s.-]?)?\(?(5\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{2})[\s.-]?(\d{2})(?!\d)/g;
const SABIT = /(?<!\d)0[\s.-]?\(?([234]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{2})[\s.-]?(\d{2})(?!\d)/g;
function telefonlariBul(t) {
  const set = new Set();
  for (const re of [MOBIL, SABIT]) for (const m of String(t).normalize('NFKC').matchAll(re)) set.add('0' + m[1] + m[2] + m[3] + m[4]);
  return [...set];
}

// ── Şehirler ──
const ILLER = ['Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Aksaray', 'Amasya', 'Ankara', 'Antalya', 'Ardahan', 'Artvin', 'Aydın', 'Balıkesir', 'Bartın', 'Batman', 'Bayburt', 'Bilecik', 'Bingöl', 'Bitlis', 'Bolu', 'Burdur', 'Bursa', 'Çanakkale', 'Çankırı', 'Çorum', 'Denizli', 'Diyarbakır', 'Düzce', 'Edirne', 'Elazığ', 'Erzincan', 'Erzurum', 'Eskişehir', 'Gaziantep', 'Giresun', 'Gümüşhane', 'Hakkari', 'Hatay', 'Iğdır', 'Isparta', 'İstanbul', 'İzmir', 'Kahramanmaraş', 'Karabük', 'Karaman', 'Kars', 'Kastamonu', 'Kayseri', 'Kilis', 'Kırıkkale', 'Kırklareli', 'Kırşehir', 'Kocaeli', 'Konya', 'Kütahya', 'Malatya', 'Manisa', 'Mardin', 'Mersin', 'Muğla', 'Muş', 'Nevşehir', 'Niğde', 'Ordu', 'Osmaniye', 'Rize', 'Sakarya', 'Samsun', 'Şanlıurfa', 'Siirt', 'Sinop', 'Sivas', 'Şırnak', 'Tekirdağ', 'Tokat', 'Trabzon', 'Tunceli', 'Uşak', 'Van', 'Yalova', 'Yozgat', 'Zonguldak'];
// Sık yazılan kısa ad / ilçe → il. Yeni eklemek için bir satır yeter.
const TAKMA = {
  antep: 'Gaziantep', maras: 'Kahramanmaraş', urfa: 'Şanlıurfa', afyon: 'Afyonkarahisar',
  izmit: 'Kocaeli', gebze: 'Kocaeli', iskenderun: 'Hatay', antakya: 'Hatay',
  ikitelli: 'İstanbul', hadimkoy: 'İstanbul', pendik: 'İstanbul', tuzla: 'İstanbul', esenyurt: 'İstanbul', silivri: 'İstanbul', beylikduzu: 'İstanbul'
};
const SEHIRLER = new Map(); // sadeleşmiş ad → gösterilecek il adı
for (const il of ILLER) SEHIRLER.set(normalize(il), il);
for (const [k, v] of Object.entries(TAKMA)) SEHIRLER.set(k, v);
const ANAHTARLAR = [...SEHIRLER.keys()].sort((a, b) => b.length - a.length);
const ABL = new Set(['dan', 'den', 'tan', 'ten']);                       // -den  → nereden
const DAT = new Set(['a', 'e', 'ya', 'ye', 'na', 'ne']);                 // -e    → nereye
const EKLER = new Set([...ABL, ...DAT, 'da', 'de', 'ta', 'te', 'in', 'un', 'nin', 'li', 'lu', 'ici', 'disi', 'merkez', 'cikisli', 'yolu', 'hatti', 'yonu']);
const YANLIS = new Set(['musa']); // isim: Muş + a değil

function sehirBul(norm) {
  const sonuc = [];
  for (const kelime of norm.split(' ')) {
    if (YANLIS.has(kelime)) continue;
    for (const k of ANAHTARLAR) {
      if (!kelime.startsWith(k)) continue;
      const ek = kelime.slice(k.length);
      if (ek === '' || EKLER.has(ek)) {
        sonuc.push({ sehir: SEHIRLER.get(k), rol: ABL.has(ek) ? 'from' : DAT.has(ek) ? 'to' : null });
        break;
      }
    }
  }
  return sonuc;
}

function rota(m) {
  if (!m.length) return { nereden: 'Belirtilmedi', nereye: 'Belirtilmedi' };
  let from = m.find(x => x.rol === 'from');
  let to = m.find(x => x.rol === 'to' && (!from || x.sehir !== from.sehir));
  if (!from) from = m.find(x => x !== to && (!to || x.sehir !== to.sehir));
  if (!to) to = m.find(x => x !== from && x.sehir !== from?.sehir);
  return { nereden: from?.sehir || 'Belirtilmedi', nereye: to?.sehir || 'Belirtilmedi' };
}

// ── Araç tipi (özelden genele) ──
const ARACLAR = [
  ['Frigo', /\bfrigo\w*/], ['Damperli', /\bdamper\w*/], ['Lowbed', /\blowbed\w*|\blobed\w*/],
  ['10 Teker', /\b10 ?teker\w*/], ['6 Teker', /\b6 ?teker\w*/], ['8 Teker', /\b8 ?teker\w*/],
  ['Kırkayak', /\bkirkayak\w*/], ['Kamyonet', /\bkamyonet\w*/], ['Panelvan', /\bpanel ?van\w*/],
  ['Kamyon', /\bkamyon\w*/], ['Tır', /\btir(?:lar|la|a|i|dan)?\b/], ['Dorse', /\bdorse\w*/]
];
function aracTipi(norm) {
  for (const [ad, re] of ARACLAR) if (re.test(norm)) return ad;
  return 'Belirtilmedi';
}

module.exports = { normalize, linkTemizle, telefonlariBul, sehirBul, rota, aracTipi };

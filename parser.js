'use strict';
/*
 * NAKLİYE CEPTE — İLAN AYRIŞTIRICI (saf fonksiyonlar, ağ/WhatsApp gerekmez)
 *
 * Mantık (satır satır):
 *   1) Mesaj temizlenir; spam satırları atılır; telefon yoksa mesaj reddedilir.
 *   2) Her satırdaki yerler (il/ilçe) bulunur.
 *   3) "KONYA ÇIKIŞLI / Hilvan'dan yükler" gibi tek yerli başlık satırı çıkış noktası olur;
 *      altındaki tek yerli satırlar o çıkışın varışlarıdır. Ayraç satırı (-----) bölümü kapatır.
 *   4) İki+ yerli satır kendi başına rotadır (ilk yer çıkış, kalanlar varış).
 *   5) Her rota AYRI ilan olur (çıkış → varış), kendi satırından detay ve en yakın telefon alır.
 *   6) Yurt dışı (ülke/şehir) geçen mesajlar reddedilir (ret: 'yabanci'); imza/"Firma:" satırından firma adı çıkarılır.
 */
const { ILCELER_TAM, ZAYIF_YERLER } = require('./yerler');
const { yabanciTerim } = require('./yabanci');

// ───────────────────────── Metin yardımcıları ─────────────────────────
function normalize(text) {
  if (!text) return '';
  return String(text)
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/['’‘`´′ʼ]/g, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ───────────────────────── Telefon ─────────────────────────
const AYR = '[\\s.\\-()]*';
const TEL_MOBIL = new RegExp(`(?<!\\d)(?:(?:\\+|00)?90${AYR})?0?${AYR}5\\d{2}${AYR}\\d{3}${AYR}\\d{2}${AYR}\\d{2}(?!\\d)`, 'g');
const TEL_SABIT = new RegExp(`(?<!\\d)0${AYR}[234]\\d{2}${AYR}\\d{3}${AYR}\\d{2}${AYR}\\d{2}(?!\\d)`, 'g');

function telefonNormalize(ham) {
  let d = String(ham || '').replace(/\D/g, '');
  if (d.startsWith('0090')) d = '0' + d.slice(4);
  else if (d.startsWith('90') && d.length === 12) d = '0' + d.slice(2);
  else if (d.length === 10) d = '0' + d;
  return /^0\d{10}$/.test(d) ? d : null;
}
function telefonlariBul(metin) {
  const bulunan = [];
  for (const re of [TEL_MOBIL, TEL_SABIT]) {
    for (const m of String(metin || '').matchAll(re)) {
      const t = telefonNormalize(m[0]);
      if (t) bulunan.push({ i: m.index, t });
    }
  }
  bulunan.sort((a, b) => a.i - b.i);
  return [...new Set(bulunan.map(b => b.t))];
}
const telefonSil = (m) => String(m || '').replace(TEL_MOBIL, ' ').replace(TEL_SABIT, ' ');
const telefonBicimle = (t) => (t ? t.replace(/^(\d{4})(\d{3})(\d{2})(\d{2})$/, '$1 $2 $3 $4') : t);

// ───────────────────────── Yer sözlüğü ─────────────────────────
const ILLER = Object.keys(ILCELER_TAM);

// [yazılış, il, ilçe] — ortak adlı / günlük dilde geçen yerler (ilk kayıt kazanır)
const OZEL = [
  ['Kdz Ereğli', 'Zonguldak', 'Ereğli'], ['Karadeniz Ereğli', 'Zonguldak', 'Ereğli'], ['Ereğli', 'Konya', 'Ereğli'],
  ['Fetiye', 'Muğla', 'Fethiye'], ['Demirtaş', 'Bursa', 'Demirtaş'], ['Akçay', 'Balıkesir', 'Akçay'],
  ['Temelli', 'Ankara', 'Temelli'], ['Ferizli', 'Sakarya', 'Ferizli'],
  ['Kapıkule', 'Edirne', 'Kapıkule'], ['İpsala', 'Edirne', 'İpsala'], ['Hamzabeyli', 'Kırklareli', 'Hamzabeyli'],
  ['Gürbulak', 'Ağrı', 'Gürbulak'], ['Habur', 'Şırnak', 'Habur'], ['Cilvegözü', 'Hatay', 'Cilvegözü'],
  ['Hadımköy', 'İstanbul', 'Hadımköy'], ['İkitelli', 'İstanbul', 'İkitelli'], ['Ambarlı', 'İstanbul', 'Ambarlı'], ['Dudullu', 'İstanbul', 'Dudullu']
];
const TAKMA = [
  ['Afyon', 'Afyonkarahisar'], ['İçel', 'Mersin'], ['Antep', 'Gaziantep'], ['G Antep', 'Gaziantep'], ['Gantep', 'Gaziantep'],
  ['Maraş', 'Kahramanmaraş'], ['K Maraş', 'Kahramanmaraş'], ['Kmaraş', 'Kahramanmaraş'],
  ['Ç Kale', 'Çanakkale'], ['Çkale', 'Çanakkale'], ['Urfa', 'Şanlıurfa'], ['S Urfa', 'Şanlıurfa'], ['Surfa', 'Şanlıurfa'],
  ['D Bakır', 'Diyarbakır'], ['Dbakır', 'Diyarbakır'], ['Diyarbekir', 'Diyarbakır'], ['Adapazarı', 'Sakarya']
];
const KISALTMA = [['kny', 'Konya'], ['ist', 'İstanbul'], ['ank', 'Ankara']];

// Sıradan kelimelerle karışanlar: yalnızca açık yön ekiyle ("Tire'ye", "Baladan") kabul edilir
const ZAYIF = new Set([...ZAYIF_YERLER, 'balya', 'van', 'arac'].map(normalize));

const YERLER = new Map(); // normalize anahtar → { il, ilce, tip }
function ekle(ad, il, ilce, tip) {
  const k = normalize(ad);
  if (k && !YERLER.has(k)) YERLER.set(k, { il, ilce: ilce || null, tip });
}
OZEL.forEach(([a, il, ilce]) => ekle(a, il, ilce, 'tam'));
KISALTMA.forEach(([a, il]) => ekle(a, il, null, 'kisaltma'));
ILLER.forEach(il => ekle(il, il, null, ZAYIF.has(normalize(il)) ? 'zayif' : 'tam'));
TAKMA.forEach(([a, il]) => ekle(a, il, null, 'tam'));
Object.entries(ILCELER_TAM).forEach(([il, liste]) => liste.forEach(i => ekle(i, il, i, ZAYIF.has(normalize(i)) ? 'zayif' : 'tam')));
YERLER.delete('arac'); // "4 araç" Kastamonu/Araç sanılmasın

const EK = ['dayim', 'dayiz', 'deyim', 'deyiz', 'tayim', 'tayiz', 'teyim', 'teyiz', 'dan', 'den', 'tan', 'ten', 'da', 'de', 'ta', 'te', 'ya', 'ye', 'a', 'e'];
const EK_ROL = { dan: 'cikis', den: 'cikis', tan: 'cikis', ten: 'cikis', ya: 'varis', ye: 'varis', a: 'varis', e: 'varis' };
['da', 'de', 'ta', 'te', 'dayim', 'dayiz', 'deyim', 'deyiz', 'tayim', 'tayiz', 'teyim', 'teyiz'].forEach(e => { EK_ROL[e] = 'konum'; });
const KISALTMA_EK = new Set(['dan', 'den', 'tan', 'ten', 'da', 'de', 'ta', 'te', 'ya', 'ye', 'a']);
const ZAYIF_EK = new Set(['dan', 'den', 'tan', 'ten', 'ya', 'ye']);

const YER_REGEX = (() => {
  const kaynak = [...YERLER.keys()].sort((a, b) => b.length - a.length).map(k => k.replace(/ /g, '\\s')).join('|');
  return new RegExp(`\\b(${kaynak})(?:(${EK.join('|')})|\\s(dan|den|tan|ten))?\\b`, 'g');
})();

const yerMetni = (y) => (y.ilce ? `${y.il} / ${y.ilce}` : y.il);

// Bir satırdaki yerler, geliş sırasıyla: { il, ilce, rol }  (rol: cikis | konum | varis | null)
function yerleriBul(satir) {
  const n = normalize(satir).replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2');
  if (!n) return [];
  const ham = [];
  for (const m of n.matchAll(YER_REGEX)) {
    const k = YERLER.get(m[1]);
    if (!k) continue;
    const ek = m[2] || m[3] || '';
    if (ek && k.tip === 'kisaltma' && !KISALTMA_EK.has(ek)) continue; // "iste" ≠ "ist"+"e"
    if (k.tip === 'zayif') {
      const onceki = ham[ham.length - 1];
      const bitisik = onceki && onceki.rol === 'cikis' && m.index - onceki.end <= 1; // "Sarayönü den Tire"
      if (!ZAYIF_EK.has(ek) && !bitisik) continue;
    }
    ham.push({ il: k.il, ilce: k.ilce, rol: EK_ROL[ek] || null, start: m.index, end: m.index + m[0].length });
  }
  // "Konya Ereğli", "Ereğli Konya" → tek yer
  const birlesik = [];
  for (const y of ham) {
    const o = birlesik[birlesik.length - 1];
    if (o && o.il === y.il && y.start - o.end <= 1 && (!o.ilce || !y.ilce)) {
      o.ilce = o.ilce || y.ilce; o.end = y.end; o.rol = y.rol || o.rol;
    } else birlesik.push({ ...y });
  }
  const gorulen = new Set();
  return birlesik.filter(y => {
    const k = `${y.il}|${y.ilce || ''}`;
    if (gorulen.has(k)) return false;
    gorulen.add(k); return true;
  }).map(({ il, ilce, rol }) => ({ il, ilce, rol }));
}

// ───────────────────────── Spam ─────────────────────────
const URL_RE = /(?:https?:\/\/|www\.)\S+|chat\.whatsapp\.com\/\S*|\bt\.me\/\S*|\bbit\.ly\/\S*/gi;
const SPAM = [
  /\b(?:sofor|kaptan|eleman|personel)\b.{0,30}\b(?:aran\w*|ariyor\w*|lazim|gerek\w*|alinacak|alinir)\b/,
  /\bcalisma arkadasi\b/,
  /\b(?:eleman|asansor|hamal|isci)\b.{0,40}\b(?:temin|saglan\w*|veririz|verilir)\b/,
  /\bsatilik\b|\bsatiyorum\b|\bdevren\b|\bkiralik\b/,
  /\bhasar\s?kayitsiz\b|\bekspertiz\b|\bmuayene\b|\bsigorta\b|\bkredi\b/,
  /\bevden eve\b|\bev tasima\b|\bev esya\w*|\bofis tasima\b|\bceyiz\b|\basansor\b/,
  /\bradar\b|\bceza yedik\b|\bmazot fiyat\w*|\bkantar acik\b|\bgrup kural\w*|\bgruba katil\w*|\bsaat kac\b/,
  /\bkapora\b|\bguvenli odeme\b|\bparana sahip\b/,
  /\b(?:bahis|iddaa|casino|forex|kumar|yatirim)\b/,
  /\b(?:hayirli|gecmis|basin sagligi|allah rahmet|mevlid|cuma mesaj\w*|bayraminiz|kutlu olsun)\b/
];
const SINYAL = /\b(?:yuk\w*|arac\w*|tir\w*|kamyon\w*|dorse\w*|ton\w*|palet\w*|parsiyel|komple|koli|sefer\w*|nakliye\w*|navlun|cekici\w*|konteyner\w*|sevkiyat\w*|lazim|aranir|araniyor|ariyoruz|ariyorum|musait\w*|bos\w*|frigo\w*|damper\w*|kirkayak|lowbed|teker\w*|tenteli|kapali|acik|fiyat|kdv|odeme|cikis\w*|donus\w*|13 60)\b/;

// ───────────────────────── Araç tipi / ilan türü ─────────────────────────
const olculeriDuzelt = (m) => String(m || '').replace(/(?<!\d)13\s?[:\/\\,.\-]\s?60(?!\d)|(?<!\d)1360(?!\d)/g, '13.60');
const ACIK_DORSE = /^(?![\s\S]*\b(?:kapali|tenteli|perdeli)\b)(?=[\s\S]*(?:\bacik\s+(?:tir|dorse)\b|\bacik\b\W+(?:\w+\W+){0,2}13[\s.,]?60\b|\b13[\s.,]?60\W+(?:\w+\W+){0,2}acik\b))/;

function aracTipiTespit(metin) {
  const f = normalize(olculeriDuzelt(metin));
  if (!f) return 'Belirtilmedi';
  if (/\bkirkayak\w*/.test(f)) return 'Kırkayak';
  if (/\bfrigo\w*|\bfrigorifik\w*|\bsoguk zincir\b|\btermokin\b/.test(f)) return 'Frigo';
  if (/\bkisa dorse\b|\bdam[pm]er\w*|\bhafriyat\b/.test(f)) return 'Damperli';
  if (/\b(?:kapali|tenteli|perdeli)\s+(?:tir|dorse)\b/.test(f)) return 'Kapalı Dorse';
  if (ACIK_DORSE.test(f)) return /\b13\s?60\b/.test(f) ? '13.60 Açık Dorse' : 'Açık Dorse';
  if (/\blow ?be[dt]\b|\bloabed\b/.test(f)) return 'Lowbed';
  if (/\bkonteyner\w*|\b(?:20|40)\s?(?:ayak|lik|luk)\b/.test(f)) return 'Konteyner';
  if (/\btanker\w*|\bsilobas\b/.test(f)) return 'Tanker';
  if (/\b(?:10|on)\s?teker\w*/.test(f)) return '10 Teker';
  if (/\b(?:8|sekiz)\s?teker\w*/.test(f)) return '8 Teker';
  if (/\b(?:6|alti)\s?teker\w*/.test(f)) return '6 Teker';
  if (/\bdorse\w*|\btir(?:lar|la|a|i|in|dan|im|imiz)?\b|\b13\s?60\b|\bcekici\w*|\bmega\b|\bjumbo\b|\btenteli\b|\bkapali\b|\bperdeli\b/.test(f)) return 'Kapalı Dorse';
  if (/\bkamyonet\w*/.test(f)) return 'Kamyonet';
  if (/\bpanel ?van\b/.test(f)) return 'Panelvan';
  if (/\bpick ?up\b|\bpikap\b/.test(f)) return 'Pikap';
  if (/\bkamyon\w*|\b(?:12|14)\s?teker\w*/.test(f)) return 'Kamyon';
  return 'Belirtilmedi';
}

const BOS_ARAC = /\bbosum\b|\bbosuz\b|\bbosta\b|\bmusait\w*|\byuk (?:ariyor\w*|lazim|bak\w*|araniyor|bulal\w*|istiyor\w*)\b|\bdonus(?:luk)? yuk\w*|\baraci?m(?:iz)? (?:bos|var|musait)\b|\bsefere hazir\b/;
const GUCLU_YUK = /\byuk (?:var|cikti|mevcut)\b|\byuku var\b|\byuklemeli\b|\byuklenecek\b/;
function turTespit(n) {
  if (BOS_ARAC.test(n) && !GUCLU_YUK.test(n)) return 'ARAC';
  if (GUCLU_YUK.test(n)) return 'YUK';
  return null;
}

// ───────────────────────── Detay temizliği ─────────────────────────
const EMOJI = /[\p{Extended_Pictographic}\u20E3\uFE0E\uFE0F\u200D\u200B\u200E\u200F\u2060\uFEFF]/gu;
const DANGLING = /^(?:irtibat|iletisim|tel|telefon|bilgi icin|bilgi|whatsapp|wp|ara|arayin|arayiniz|numara)(?:\s\w+){0,2}$/;
const REKLAM = /^(?:hemen yukler|iyi calismalar|hayirli isler|kolay gelsin|bol kazanclar|yuk takip\w*|duyuru)$|\b(?:kanal\w*|takip\w*|abone\w*|reklam\w*|sponsor\w*|katilin|katil)\b/;
const IMZA = /\b(?:nakliyat|nakliye|nakliyecilik|lojistik|tasimacilik|transport|ticaret|ltd|sti)\b/;

function satirTemizle(satir) {
  const t = String(satir || '')
    .replace(/[➡→⇒➜➔►▶]+/g, ' → ')
    .replace(EMOJI, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—:|,.>»→]+|[\s\-–—:|,>»→]+$/g, '')
    .trim();
  return t;
}

// ───────────────────────── Firma adı ─────────────────────────
const FIRMA_KELIME = /\b(?:nakliyat|nakliye|nakliyecilik|lojistik|tasimacilik|transport|ticaret|ltd|sti|holding|otomotiv|insaat|gida|sanayi|logistics|cargo|kargo)\b/;
const FIRMA_YUK_DILI = /\b(?:lazim|aranir|araniyor|ariyoruz|ariyorum|var|ton\w*|palet\w*|komple|parsiyel|musait\w*|bos\w*|yukle\w*|cikis\w*|iner|teslim\w*)\b/;
const FIRMA_ETIKET = /^([^:\-–]{3,15})[:\-–]\s*(.{3,60})$/;
const KUCUK_KELIME = new Set(['ve']);

// Tamamı BÜYÜK yazılmış adı "Emircan Lojistik" biçimine çevirir (kısa kısaltmalar ABC gibi kalır)
function basHarfBuyut(s) {
  if (/\p{Ll}/u.test(s)) return s; // zaten karışık/küçük harfli: yazarın biçimi korunur
  return s.split(' ').map(w => {
    const l = w.toLocaleLowerCase('tr');
    if (KUCUK_KELIME.has(l)) return l;
    const harf = (w.match(/\p{L}/gu) || []).length;
    if (harf <= 3 && !/^(?:ltd|sti|şti)\.?$/.test(l)) return w;
    return l.charAt(0).toLocaleUpperCase('tr') + l.slice(1);
  }).join(' ');
}
function firmaTemizle(s) {
  let t = String(s || '').replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '').replace(EMOJI, '').replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—:|,.>»*_~]+|[\s\-–—:|,>»*_~]+$/g, '').trim();
  if (t.length > 60) t = t.slice(0, 60).trim();
  if ((t.match(/\p{L}/gu) || []).length < 3) return '';
  return basHarfBuyut(t);
}
// "Firma: X" etiketi öncelikli; yoksa en alttaki kısa "… Nakliyat/Lojistik/Ltd" imza satırı
function firmaBul(satirlar) {
  let imza = '';
  for (const s of satirlar) {
    if (s.ayrac || s.sadeceTel) continue;
    const t = satirTemizle(telefonSil(s.raw));
    if (!t) continue;
    const e = t.match(FIRMA_ETIKET);
    if (e && /^(?:firma|sirket|unvan)(?: adi)?$/.test(normalize(e[1]))) { const f = firmaTemizle(e[2]); if (f) return f; }
    const n = normalize(t);
    const kelime = n ? n.split(' ').length : 0;
    if (kelime < 2 || kelime > 6 || !FIRMA_KELIME.test(n)) continue;
    if (s.yer.length >= 2 || BASLIK.test(n) || HEDEF.test(n) || FIRMA_YUK_DILI.test(n) || /\d{3,}/.test(n)) continue;
    const f = firmaTemizle(t);
    if (f) imza = f;
  }
  return imza;
}
// Detaya uygun mu? (imza, "irtibat" artığı, sadece isim+numara satırlarını eler)
function detayaUygunMu(temiz, satirdaTelefonVar, yerVar) {
  const n = normalize(temiz);
  if (!n) return false;
  if (!yerVar && REKLAM.test(n)) return false;
  if (yerVar) return true;
  if (DANGLING.test(n)) return false;
  const kelime = n.split(' ').length;
  if (kelime <= 4 && IMZA.test(n)) return false;
  if (kelime <= 3 && satirdaTelefonVar && !SINYAL.test(n)) return false;
  return true;
}

// ───────────────────────── Ana ayrıştırıcı ─────────────────────────
const AYRAC = /^[\s\-_=─━*~.+#|]{5,}$/;
const BASLIK = /\b(?:yukleme\w*|cikis\w*|kalkis\w*|yukler\w*|yuklu|yuku|yuklenecek|yuklenir)\b/;
const HEDEF = /\b(?:iner|bosalt\w*|teslim\w*|varis\w*|inecek|indirme\w*|tahliye\w*|gidecek)\b/;
const MAX_VARIS_SATIR = 8;

function waLinkiniNumarayaCevir(m) {
  return String(m || '').replace(/(?:https?:\/\/)?wa\.me\/\+?(\d{10,13})\S*/gi, ' $1 ');
}

/**
 * @returns {{ ilanlar: Array, ret: string|null }}
 * ilan: { tur:'YUK'|'ARAC', nereden, nereye, arac_tipi, detay, telefon, telefon_ham }
 */
function ilanlariAyristir(hamMesaj, secenek = {}) {
  const tekSehir = secenek.tekSehirKabul !== false;
  const gondericiTel = secenek.gondericiTelefon || null;
  const RET = (neden) => ({ ilanlar: [], ret: neden });

  const cevrilmis = waLinkiniNumarayaCevir(hamMesaj);
  if (cevrilmis.length < 8) return RET('cok_kisa');
  if (cevrilmis.length > 4000) return RET('cok_uzun');

  // Yurt dışı yükleri (Irak, Almanya, Erbil, KKTC...) baştan ele: mesajın herhangi bir yerinde geçmesi yeterli
  if (secenek.yabanciEngelle !== false) {
    const terim = yabanciTerim(normalize(cevrilmis.replace(URL_RE, ' ')));
    if (terim) return { ilanlar: [], ret: 'yabanci', terim };
  }

  // Satırlara böl (satır sonu + madde işaretleri); spam satırlarını at
  const parcalar = cevrilmis.replace(URL_RE, ' ')
    .split(/\r?\n|[•·●▪■✅☑✔🔻🔺🔸🔹🛑⚠]/u).map(s => s.trim()).filter(Boolean);

  let spamVar = false;
  const satirlar = [];
  for (const raw of parcalar) {
    const n = normalize(raw);
    if (!n && !AYRAC.test(raw)) continue;
    if (SPAM.some(r => r.test(n))) { spamVar = true; continue; }
    const tel = telefonlariBul(raw);
    const govde = telefonSil(raw);
    const sadeceTel = tel.length && !normalize(govde).replace(/\d/g, '').trim();
    satirlar.push({
      raw, n: normalize(govde), tel,
      ayrac: AYRAC.test(raw), sadeceTel,
      yer: (AYRAC.test(raw) || sadeceTel) ? [] : yerleriBul(govde),
      bolum: 0
    });
  }
  const tumTel = [...new Set(satirlar.flatMap(s => s.tel))];
  if (!tumTel.length && !gondericiTel) return RET(spamVar ? 'spam' : 'telefon_yok');

  // Bölüm numaraları (ayraç satırı yeni bölüm başlatır)
  let b = 0;
  satirlar.forEach(s => { if (s.ayrac) b++; s.bolum = b; });

  // ── Rota çıkarımı ──
  const rotalar = [];            // { kalkis, varis, idx, ctxIdx }
  const tekler = [];             // çıkış/varıştan yalnızca biri bilinen satırlar
  let ctx = null;                // { yer, idx, dest }
  const ctxKapat = () => { if (ctx && !ctx.dest) tekler.push({ yer: ctx.yer, idx: ctx.idx, cikis: true }); ctx = null; };

  let grup = 0;
  satirlar.forEach((s, i) => {
    if (s.ayrac) { ctxKapat(); grup++; s.grup = grup; return; }
    s.grup = grup;
    let y = s.yer;
    if (!y.length) return;
    const hedefKelime = HEDEF.test(s.n);
    if (y.length > 1 && /\byolu\b/.test(s.n) && !y.some(p => p.rol)) y = [y[0]]; // "Antep Kilis yolu"

    // Tek yerli başlık satırı → çıkış noktası
    if (y.length === 1 && !hedefKelime && (BASLIK.test(s.n) || y[0].rol === 'cikis' || y[0].rol === 'konum')) {
      ctxKapat();
      grup++; s.grup = grup;
      ctx = { yer: y[0], idx: i, dest: 0 };
      return;
    }

    const ekle2 = (kalkis, varis) => {
      if (kalkis && varis && kalkis.il === varis.il && (kalkis.ilce || '') === (varis.ilce || '')) return;
      rotalar.push({ kalkis, varis, idx: i, ctxIdx: ctx ? ctx.idx : -1 });
      if (ctx) ctx.dest++;
    };

    if (y.length === 1) {
      const son = tekler[tekler.length - 1];
      if (ctx) ekle2(ctx.yer, y[0]);
      else if (son && son.idx === i - 1 && !hedefKelime && son.yer.rol !== 'varis' && y[0].rol !== 'cikis') { tekler.pop(); ekle2(son.yer, y[0]); } // "Bayburt\nKayseri"
      else tekler.push({ yer: y[0], idx: i, cikis: y[0].rol === 'cikis' || y[0].rol === 'konum' });
      return;
    }

    // 2+ yer
    let kalkis; let varislar;
    if (hedefKelime) {                       // "Aksaray Ağaçören Eskil BOŞALTIR": hepsi varış
      kalkis = ctx ? ctx.yer : null; varislar = y;
    } else {
      const cik = y.find(p => p.rol === 'cikis' || p.rol === 'konum');
      if (cik) { kalkis = cik; varislar = y.filter(p => p !== cik && p.rol !== 'cikis'); }
      else if (ctx && y[0].il !== ctx.yer.il && !y.some(p => p.rol)) { kalkis = ctx.yer; varislar = y; } // başlık altında varış listesi
      else { kalkis = y[0]; varislar = y.slice(1); }
    }
    varislar.slice(0, MAX_VARIS_SATIR).forEach(v => ekle2(kalkis, v));
  });
  ctxKapat();

  // Varışı bulunamayan açık çıkışlar ("Hilvan dan yükler"); hiç rota yoksa ilk tek yerli aday
  if (tekSehir) {
    tekler.filter(t => t.cikis).forEach(t => rotalar.push({ kalkis: t.yer, varis: null, idx: t.idx, ctxIdx: -1 }));
    if (!rotalar.length && tekler.length) {
      const t = tekler[0];
      rotalar.push({ kalkis: null, varis: t.yer, idx: t.idx, ctxIdx: -1 });
    }
  }
  if (!rotalar.length) return RET(spamVar ? 'spam' : 'rota_yok');

  // ── İlan sinyali (telefon + rota yetmez; yük/araç dili de olmalı) ──
  const mesajNorm = satirlar.map(s => s.n).join(' ');
  if (!SINYAL.test(mesajNorm)) return RET('sinyal_yok');

  // ── TEK İLAN: mesajın temizlenmiş hali ──
  const temizSatir = (x) => satirTemizle(olculeriDuzelt(telefonSil(x.raw)));
  const parcalarD = satirlar.filter(x => !x.ayrac && !x.sadeceTel)
    .map(x => temizSatir(x))
    .filter((t, k) => { const x = satirlar.filter(y => !y.ayrac && !y.sadeceTel)[k]; return detayaUygunMu(t, x.tel.length > 0, x.yer.length > 0); });
  let detay = [...new Set(parcalarD)].join('\n');
  if (detay.length > 1500) detay = detay.slice(0, 1499).trimEnd() + '…';
  if (detay.length < 8) return RET('detay_bos');

  // Rota özeti (kart başlığı için): tek rota varsa çıkış→varış; birden çok rota varsa ilk çıkış noktası
  const gorulenR = new Set(); const rr = [];
  for (const r of rotalar) {
    const k = `${r.kalkis ? yerMetni(r.kalkis) : ''}|${r.varis ? yerMetni(r.varis) : ''}`;
    if (!gorulenR.has(k)) { gorulenR.add(k); rr.push(r); }
  }
  let kalkis = null; let varis = null;
  if (rr.length === 1) { kalkis = rr[0].kalkis; varis = rr[0].varis; }
  else { const ilk = rr.find(r => r.kalkis); if (ilk) kalkis = ilk.kalkis; else varis = rr[0].varis; }

  // Araç tipi: mesajda en çok geçen tip
  const sayac = {};
  satirlar.forEach(x => { const a = aracTipiTespit(x.raw); if (a !== 'Belirtilmedi') sayac[a] = (sayac[a] || 0) + 1; });
  const arac = Object.entries(sayac).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Belirtilmedi';

  const tel = tumTel[0] || gondericiTel;
  if (!tel) return RET('telefon_yok');
  if (tumTel.length > 1) detay += `\nDiğer tel: ${tumTel.slice(1, 3).map(telefonBicimle).join(', ')}`;

  return {
    ilanlar: [{
      tur: turTespit(mesajNorm) || 'YUK',
      nereden: kalkis ? yerMetni(kalkis) : 'Belirtilmedi',
      nereye: varis ? yerMetni(varis) : 'Belirtilmedi',
      arac_tipi: arac,
      detay,
      firma: firmaBul(satirlar),
      telefon_ham: tel,
      telefon: telefonBicimle(tel),
      anahtar: ilanAnahtari(detay, tel)
    }],
    ret: null
  };
}

// Mükerrer anahtarı: aynı metin + aynı telefon (aynı mesaj yüzlerce gruba atılsa tek ilan olur)
function ilanAnahtari(detay, tel) {
  return `${normalize(String(detay).replace(/^\[BOŞ ARAÇ\]\s*/, '')).slice(0, 240)}|${String(tel).replace(/\D/g, '')}`;
}

module.exports = { firmaTemizle, ilanlariAyristir, ilanAnahtari, yerleriBul, aracTipiTespit, telefonlariBul, telefonNormalize, telefonBicimle, normalize, yerMetni };

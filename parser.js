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
 */
const { ILCELER_TAM, ZAYIF_YERLER } = require('./yerler');

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
  const n = normalize(satir);
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
// Detaya uygun mu? (imza, "irtibat" artığı, sadece isim+numara satırlarını eler)
function detayaUygunMu(temiz, satirdaTelefonVar, yerVar) {
  const n = normalize(temiz);
  if (!n) return false;
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
const HEDEF = /\b(?:bosalt\w*|teslim\w*|varis\w*|inecek|indirme\w*|tahliye\w*|gidecek)\b/;
const MAX_ILAN = 40;
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

  // ── İlanları kur ──
  const mesajArac = (() => {
    const set = new Set(satirlar.map(s => aracTipiTespit(s.raw)).filter(a => a !== 'Belirtilmedi'));
    return set.size === 1 ? [...set][0] : 'Belirtilmedi';
  })();
  const mesajTur = turTespit(mesajNorm);

  const enYakinTel = (idx, bolum) => {
    let iyi = null; let mes = Infinity;
    satirlar.forEach((s, j) => {
      if (!s.tel.length) return;
      const m = Math.abs(j - idx) + (bolum !== undefined && s.bolum !== bolum ? 1000 : 0);
      if (m < mes || (m === mes && j > idx)) { iyi = s.tel[0]; mes = m; }
    });
    return iyi;
  };
  const bolumNotlari = new Map();  // grup → ilk 2 ortak not
  satirlar.forEach((s) => {
    if (s.ayrac || s.sadeceTel || s.yer.length) return;
    const t = satirTemizle(olculeriDuzelt(telefonSil(s.raw)));
    if (!detayaUygunMu(t, s.tel.length > 0, false)) return;
    const l = bolumNotlari.get(s.grup) || [];
    if (l.length < 2 && t.length <= 90) l.push(t);
    bolumNotlari.set(s.grup, l);
  });
  const temizSatir = (s) => satirTemizle(olculeriDuzelt(telefonSil(s.raw)));

  const tekIlan = rotalar.length === 1;
  const gorulen = new Set();
  const ilanlar = [];

  for (const r of rotalar) {
    if (ilanlar.length >= MAX_ILAN) break;
    const s = satirlar[r.idx];
    const baslik = r.ctxIdx >= 0 ? satirlar[r.ctxIdx] : null;
    const notlar = bolumNotlari.get(s.grup) || [];

    // detay
    let parcalarD;
    if (tekIlan) {
      parcalarD = satirlar.filter(x => !x.ayrac && !x.sadeceTel)
        .map(x => ({ t: temizSatir(x), x }))
        .filter(({ t, x }) => detayaUygunMu(t, x.tel.length > 0, x.yer.length > 0)).map(({ t }) => t);
    } else {
      parcalarD = [baslik && baslik !== s ? temizSatir(baslik) : '', temizSatir(s), ...notlar].filter(Boolean);
    }
    let detay = [...new Set(parcalarD)].join(' • ');
    if (detay.length > 300) detay = detay.slice(0, 299).trimEnd() + '…';
    if (!detay) detay = `${r.kalkis ? yerMetni(r.kalkis) : ''} ${r.varis ? yerMetni(r.varis) : ''}`.trim();

    const arac = [s.raw, baslik && baslik.raw, notlar.join(' ')]
      .map(m => (m ? aracTipiTespit(m) : 'Belirtilmedi')).find(a => a !== 'Belirtilmedi') || mesajArac;
    const tur = turTespit(s.n) || (baslik && turTespit(baslik.n)) || turTespit(notlar.join(' ')) || mesajTur || 'YUK';
    const tel = s.tel[0] || enYakinTel(r.idx, s.bolum) || gondericiTel;
    if (!tel) continue;

    const ilan = {
      tur,
      nereden: r.kalkis ? yerMetni(r.kalkis) : 'Belirtilmedi',
      nereye: r.varis ? yerMetni(r.varis) : 'Belirtilmedi',
      arac_tipi: arac,
      detay,
      telefon_ham: tel,
      telefon: telefonBicimle(tel)
    };
    const anahtar = `${ilan.nereden}|${ilan.nereye}|${ilan.arac_tipi}|${tel}`;
    if (gorulen.has(anahtar)) continue;
    gorulen.add(anahtar);
    ilanlar.push(ilan);
  }
  return ilanlar.length ? { ilanlar, ret: null } : RET('ilan_yok');
}

module.exports = { ilanlariAyristir, yerleriBul, aracTipiTespit, telefonlariBul, telefonNormalize, telefonBicimle, normalize, yerMetni };

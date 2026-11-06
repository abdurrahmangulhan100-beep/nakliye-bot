'use strict';
/*
 * REKLAM / MARKA / LİNK FİLTRESİ (saf fonksiyon, ağ gerekmez)
 * Parser'dan ÖNCE çalışır. Eşleşirse mesajın tamamı atılır ve neden döner: { ret, terim }.
 *   reklam_marka   → Qmove, Bugünkü Nakliye, Getir Nakliye ve ENGELLI_KELIMELER
 *   reklam_telefon → ENGELLI_TELEFONLAR listesindeki numara
 *   reklam_link    → sosyal medya / uygulama mağazası / kanal-grup daveti / reklam dilli link
 * LINK_MODU: ayikla (varsayılan) = sıradan bir ilandaki masum link silinir, ilan kalır
 *            engelle = hangi tür olursa olsun linkli mesaj atılır   |   izin = link kontrolü kapalı
 * wa.me / api.whatsapp.com/send linkleri "iletişim" sayılır, engellenmez (parser numaraya çevirir).
 */
const { normalize, telefonlariBul, telefonNormalize, ilanlariAyristir } = require('./parser');

const MARKALAR = [
  { ad: 'qmove', re: /\bq ?move\w*/ },
  { ad: 'bugunku nakliye', re: /\bbugunku ?nakliye\w*|\bbugunun nakliye ?ilan\w*/ },
  { ad: 'getir nakliye', re: /\bgetir ?nakliye\w*/ }
];

const WA_ILETISIM = /(?:https?:\/\/)?(?:wa\.me\/|api\.whatsapp\.com\/send)\S*/gi;
const LINK = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9][a-z0-9-]{1,40}\.(?:com|net|org|app|io|info|online|site|xyz|biz|shop|link)(?:\.tr)?(?:\/\S*)?(?![a-z0-9])/gi;
const SOSYAL = /(?:instagram\.com|facebook\.com|fb\.com|fb\.me|youtube\.com|youtu\.be|tiktok\.com|play\.google\.com|apps\.apple\.com|itunes\.apple\.com|bit\.ly|tinyurl\.com|t\.me|telegram\.me|chat\.whatsapp\.com|whatsapp\.com\/channel|linktr\.ee|forms\.gle|wa\.link|shorturl\.at|cutt\.ly|is\.gd)/i;
const PROMO = /\b(?:indir(?:in|iniz|ebilirsiniz)?|uygulama\w*|uye ol\w*|uyelik\w*|kayit ol\w*|tikla\w*|giris yap\w*|sitemiz\w*|web ?sitemiz\w*|siteye|detayli bilgi|tum ilanlar\w*|diger ilanlar\w*|ilanlar icin|ucretsiz)\b/;

// ayar: { ekKelimeler: ['yukbul'...] (normalize edilmiş, ≥4 harf), engelliTel: Set('05xxxxxxxxx'), linkModu }
function reklamKontrol(ham, ayar = {}) {
  const metin = String(ham || '');
  const n = normalize(metin);
  for (const m of MARKALAR) if (m.re.test(n)) return { ret: 'reklam_marka', terim: m.ad };
  const nb = n.replace(/ /g, '');
  for (const k of ayar.ekKelimeler || []) if (k && (n.includes(k) || nb.includes(k.replace(/ /g, '')))) return { ret: 'reklam_marka', terim: k };

  if (ayar.engelliTel && ayar.engelliTel.size) {
    for (const t of telefonlariBul(metin)) if (ayar.engelliTel.has(t)) return { ret: 'reklam_telefon', terim: t };
  }

  if (ayar.linkModu === 'izin') return null;
  const temiz = metin.replace(WA_ILETISIM, ' ');
  const sosyal = temiz.match(SOSYAL);
  const linkler = temiz.match(LINK);
  if (!sosyal && !linkler) return null;

  const terim = (sosyal ? sosyal[0] : linkler[0]).slice(0, 40);
  if (ayar.linkModu === 'engelle') return { ret: 'reklam_link', terim };

  // Kanal/grup bağlantısı tek başına gerçek ilanı geçersiz kılmaz.
  // Bağlantı dışındaki metin parser tarafından geçerli yük/araç ilanı sayılıyorsa
  // mesajı koru; yalnız davet/reklam metinleri parser'dan ilan çıkaramaz.
  const sonuc = ilanlariAyristir(metin, { telefonZorunlu: false });
  if (sonuc.ilanlar && sonuc.ilanlar.length) return null;

  if (sosyal || PROMO.test(normalize(temiz.replace(LINK, ' ')))) {
    return { ret: 'reklam_link', terim };
  }
  return null;
}

// "kelime1, kelime2" → normalize edilmiş dizi (3 harften kısalar yanlış eşleşmesin diye atılır)
const kelimeListesi = (s) => String(s || '').split(',').map(normalize).filter(k => k.replace(/ /g, '').length >= 4);
const telefonListesi = (s) => new Set(String(s || '').split(/[,;\n]+/).map(telefonNormalize).filter(Boolean));

module.exports = { reklamKontrol, kelimeListesi, telefonListesi };

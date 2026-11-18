'use strict';
// Karar verici: bir WhatsApp mesajı ilan mı, değil mi? Yan etkisi yok, ağ yok → kolay test edilir.
const { MARKALAR, KURALLAR, YUK_SINYALI, LISTE_MIN_SATIR, LISTE_MIN_SATIR_TELLI } = require('./kurallar');
const { normalize, linkTemizle, telefonlariBul, sehirBul, rota, aracTipi } = require('./metin');

const MAX_UZUNLUK = 6000; // yalnız bundan uzunsa ret (gerçek uzun ilanlar geçer); DB için 3000 karaktere kısaltılır
const MAX_TELEFON = 10;   // bundan fazla numara = toplu liste
const TONAJ = /\b\d+(?: \d{3})?\s?(?:ton|kg|palet|m3)\b/;
// Satır satır "Şehir Şehir Araç Tonaj" yazan toplu liste mi? (tek mesaja dizilmiş onlarca ilan)
function rotaSatiri(metin) {
  let say = 0;
  for (const satir of metin.split(/\r?\n/)) {
    const n = normalize(satir);
    if (sehirBul(n).length && (aracTipi(n) !== 'Belirtilmedi' || TONAJ.test(n))) say++;
  }
  return say;
}
const ret = (neden, terim = '', ekstra = {}) => ({ ok: false, neden, terim, ...ekstra });

/**
 * karar(ham, { yanit, etiket })
 *  yanit: mesaj başka bir mesaja cevap mı (→ sohbet)   etiket: biri @ ile etiketlenmiş mi (→ sohbet)
 * Dönüş: { ok:false, neden, terim, aday?, sadeceTel? }  veya  { ok:true, metin, telefonlar, nereden, nereye, arac, linkSayisi }
 */
function karar(ham, { yanit = false, etiket = false } = {}) {
  for (const re of MARKALAR) {
    const m = normalize(ham).match(re);
    if (m) return ret('marka', m[0]);
  }

  const { metin, linkSayisi } = linkTemizle(ham); // linkler çıkar, kalan metin değerlendirilir
  const n = normalize(metin);

  if (n.length < 12) return ret('cok_kisa', '', { sadeceTel: telefonlariBul(metin).length > 0 }); // sadece numara = ilanın telefon parçası olabilir
  if (metin.length > MAX_UZUNLUK) return ret('cok_uzun');
  if (yanit) return ret('sohbet', 'yanit');
  if (etiket) return ret('sohbet', 'etiket');

  for (const kural of KURALLAR) {
    if (kural.haric && kural.haric.some(re => re.test(n))) continue;
    for (const re of kural.desen) {
      const m = n.match(re);
      if (m) return ret(kural.neden, m[0]);
    }
  }

  const telefonlar = telefonlariBul(metin);
  if (rotaSatiri(metin) >= (telefonlar.length ? LISTE_MIN_SATIR_TELLI : LISTE_MIN_SATIR)) return ret('liste');
  const sehirler = sehirBul(n);
  const sinyal = sehirler.length > 0 || YUK_SINYALI.test(n);
  if (!telefonlar.length) return ret('telefon_yok', '', { aday: sinyal }); // aday: ilan metni olabilir, numarası ayrı mesajda gelmiş olabilir
  if (telefonlar.length > MAX_TELEFON) return ret('cok_telefon');
  if (!sinyal) return ret('sinyal_yok', '', { sadeceTel: true });

  return { ok: true, metin: metin.length > 3000 ? metin.slice(0, 3000) : metin, telefonlar, ...rota(sehirler), arac: aracTipi(n), linkSayisi };
}

module.exports = { karar };

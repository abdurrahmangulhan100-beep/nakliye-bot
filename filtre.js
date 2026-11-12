'use strict';
// Karar verici: bir WhatsApp mesajı ilan mı, değil mi? Yan etkisi yok, ağ yok → kolay test edilir.
const { MARKALAR, KURALLAR, YUK_SINYALI } = require('./kurallar');
const { normalize, linkTemizle, telefonlariBul, sehirBul, rota, aracTipi } = require('./metin');

const MAX_UZUNLUK = 1500; // bundan uzun = liste / reklam metni
const ret = (neden, terim = '') => ({ ok: false, neden, terim });

/**
 * karar(ham, { yanit, etiket })
 *  yanit: mesaj başka bir mesaja cevap mı (→ sohbet)   etiket: biri @ ile etiketlenmiş mi (→ sohbet)
 * Dönüş: { ok:false, neden, terim }  veya  { ok:true, metin, telefonlar, nereden, nereye, arac, linkSayisi }
 */
function karar(ham, { yanit = false, etiket = false } = {}) {
  for (const re of MARKALAR) {
    const m = normalize(ham).match(re);
    if (m) return ret('marka', m[0]);
  }

  const { metin, linkSayisi } = linkTemizle(ham); // linkler çıkar, kalan metin değerlendirilir
  const n = normalize(metin);

  if (n.length < 20) return ret('cok_kisa');
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
  if (!telefonlar.length) return ret('telefon_yok');
  if (telefonlar.length >= 4) return ret('cok_telefon');

  const sehirler = sehirBul(n);
  if (!sehirler.length && !YUK_SINYALI.test(n)) return ret('sinyal_yok');

  return { ok: true, metin, telefonlar, ...rota(sehirler), arac: aracTipi(n), linkSayisi };
}

module.exports = { karar };

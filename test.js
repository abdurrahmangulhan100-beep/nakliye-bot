'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { karar } = require('./filtre');

const TEL = '0532 123 45 67';
const red = (metin, neden, opt) => test(`RED ${neden}: ${metin.slice(0, 45)}`, () => {
  const k = karar(metin, opt);
  assert.strictEqual(k.ok, false, 'ilan sayıldı');
  assert.strictEqual(k.neden, neden, `neden=${k.neden} terim=${k.terim}`);
});
const kabul = (metin, kontrol) => test(`KABUL: ${metin.slice(0, 45)}`, () => {
  const k = karar(metin);
  assert.strictEqual(k.ok, true, `reddedildi: ${k.neden} (${k.terim})`);
  if (kontrol) kontrol(k);
});

// Kullanıcının verdiği şablonlar ve türevleri
red(`Bugünkü taşıma görevi: İstanbul - Ankara ${TEL}`, 'gunluk_sablon');
red(`BUGÜNKÜ YÜK listesi İstanbul Ankara 24 ton ${TEL}`, 'gunluk_sablon');
red(`Bugünkü lojistik görevi İzmir Bursa ${TEL}`, 'gunluk_sablon');
red(`Bugünkü yük taşıma programı İzmir Bursa ${TEL}`, 'gunluk_sablon');
red(`Lütfen WhatsApp üzerinden bana mesaj bırakın İstanbul Ankara ${TEL}`, 'gunluk_sablon');
red(`Bugünün yükleri: Konya Antalya 10 palet ${TEL}`, 'gunluk_sablon');

red(`*BUGÜN YÜKLER* *MANAVGAT YÜKLEMELİ* İstanbul ${TEL}`, 'gunluk_sablon');
red(`PERŞEMBE GÜNÜ SEVKİYAT LİSTESİ Çorum Samsun ${TEL}`, 'gunluk_sablon');

// Boş araç paylaşanlar
red(`Boş araç var İstanbul çıkışlı Ankara ${TEL}`, 'bos_arac');
red(`Aracım boş, yük arıyorum İstanbul Ankara hattı ${TEL}`, 'bos_arac');
red(`Müsait tır Bursa'dan İzmir'e ${TEL}`, 'bos_arac');
red(`Dönüş boş Ankara'dan İstanbul'a tır ${TEL}`, 'bos_arac');

// Asansör / fatura / reklam
red(`Asansörlü ev taşıma İstanbul Ankara ${TEL}`, 'asansor');
red(`Kiralık lift İstanbul ${TEL} uygun fiyat`, 'asansor');
red(`Faturalı taşıma Bursa İzmir 20 ton ${TEL}`, 'fatura');
red(`E-arşiv fatura kesilir İstanbul Ankara 20 ton ${TEL}`, 'fatura');
red(`Kampanya! İstanbul Ankara nakliye ${TEL}`, 'reklam');
red(`Nakliye uygulamamızı indirin İstanbul ${TEL}`, 'reklam');
red(`Qmove ile İstanbul Ankara yük ${TEL}`, 'marka');
red(`Yük işi için qmove.com adresine bakın İstanbul Ankara ${TEL}`, 'marka');

// Sohbet
red(`Abi İstanbul'dan Ankara'ya yük var mı bugün acaba`, 'telefon_yok');
red(`Ben alırım İstanbul Ankara yükü ${TEL}`, 'sohbet', { yanit: true });
red(`@905551112233 senin yük İstanbul Ankara ${TEL}`, 'sohbet', { etiket: true });
red(`tamam`, 'cok_kisa');

// Gerçek ilanlar
kabul(`İstanbul'dan Ankara'ya 24 ton palet yük var. Tır lazım. ${TEL}`, k => {
  assert.strictEqual(k.nereden, 'İstanbul');
  assert.strictEqual(k.nereye, 'Ankara');
  assert.strictEqual(k.arac, 'Tır');
  assert.deepStrictEqual(k.telefonlar, ['05321234567']);
});
kabul(`Ankara'ya İstanbul'dan 20 ton yük ${TEL}`, k => {
  assert.strictEqual(k.nereden, 'İstanbul');
  assert.strictEqual(k.nereye, 'Ankara');
});
kabul(`Bursa İzmir 10 palet yük kamyonet ${TEL}`, k => {
  assert.strictEqual(k.nereden, 'Bursa');
  assert.strictEqual(k.nereye, 'İzmir');
  assert.strictEqual(k.arac, 'Kamyonet');
});
kabul(`Bursa'dan İzmir'e 10 palet yük ${TEL} detaylar https://ornek.com/abc`, k => {
  assert.ok(!/ornek\.com|https/.test(k.metin), 'link kalmış');
  assert.strictEqual(k.linkSayisi, 1);
});
kabul(`Konya Antalya 5 ton yük wa.me/905321234567`, k => {
  assert.deepStrictEqual(k.telefonlar, ['05321234567']);
  assert.ok(!/wa\.me/.test(k.metin));
});
kabul(`Boş araç lazım Ankara'dan İzmir'e 12 palet ${TEL}`);   // yük sahibi: boş araç ARIYOR
kabul(`Mersin'den Adana'ya 22 ton yük var. Hayırlı işler, teşekkürler ${TEL}`);
kabul(`Gebze'den Antep'e 15 ton yük ${TEL}`, k => {
  assert.strictEqual(k.nereden, 'Kocaeli');
  assert.strictEqual(k.nereye, 'Gaziantep');
});
kabul(`Yük indirme Ankara ${TEL} 3 palet`); // "indir" kelimesi yüzünden reklam sayılmamalı
kabul(`Kartepe Güçlükonak 1 ATV 05326574355 Murathan Lojistik`);
kabul(`Bugün yük var İstanbul'dan Ankara'ya 10 palet ${TEL}`);

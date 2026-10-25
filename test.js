'use strict';
// Çalıştırma:  npm test      (ağ/WhatsApp gerekmez; yalnızca ayrıştırıcıyı sınar)
const test = require('node:test');
const assert = require('node:assert/strict');
const { cokluIlanlariAyristir } = require('./index.js');

const rota = (mesaj) => cokluIlanlariAyristir(mesaj).map(i => `${i.nereden} -> ${i.nereye}`);
const TEL = ' 0532 111 22 33';

test('Ereğli → Kırıkhan (ekran görüntüsü)', () => {
  assert.deepEqual(rota("Ereğli'den hatay Kırıkhan'a 9 metre 10 ton açık tır" + TEL), ['Konya / Ereğli -> Hatay / Kırıkhan']);
});
test('Sarayönü den Tire (ekran görüntüsü, boşluklu ek + Tire ilçesi)', () => {
  assert.deepEqual(rota('SARAYÖNÜ DEN TİRE TIR KISA ARPA 1000' + TEL), ['Konya / Sarayönü -> İzmir / Tire']);
});
test('Kdz Ereğli Zonguldak sayılır', () => {
  assert.deepEqual(rota('Kdz Ereğli den Konya ya tır lazım' + TEL), ['Zonguldak / Ereğli -> Konya']);
});
test('"tire" (lastik) ve "bor" (madde) ilçe sanılmaz', () => {
  assert.deepEqual(rota("Konya'dan Ankara'ya lastik tire yükü var" + TEL), ['Konya -> Ankara']);
  assert.deepEqual(rota("Bor madeni yükü var Eskişehir'den Konya'ya" + TEL), ['Eskişehir -> Konya']);
});
test('Çoklu satır: aynı çıkış + araç + telefon tek ilanda birleşir', () => {
  const r = cokluIlanlariAyristir("KONYA ÇIKIŞLI\nKonya Ankara tır\nKonya İzmir tır\n" + TEL);
  assert.equal(r.length, 1);
  assert.equal(r[0].nereden, 'Konya');
  assert.equal(r[0].nereye, 'Ankara, İzmir');
  assert.ok(r[0].detay.includes('Ankara') && r[0].detay.includes('İzmir'));
});
test('Çıkışı farklı satırlar ayrı ilan kalır', () => {
  assert.equal(rota("Konya Ankara tır\nBursa İzmir tır\n" + TEL).length, 2);
});
test('Aynı çıkışta araç tipi farklıysa ayrı ilan olur (araç filtresi bozulmasın)', () => {
  const r = cokluIlanlariAyristir('Konya Ankara tır\nKonya Bursa tır\nKonya İzmir frigo\n0532 111 22 33');
  assert.equal(r.length, 2);
  assert.deepEqual(r.map(i => i.nereye).sort(), ['Ankara, Bursa', 'İzmir']);
});
test('COKLU_ROTAYI_BIRLESTIR=false eski davranışı geri getirir', () => {
  const { CONFIG } = require('./index.js');
  CONFIG.COKLU_ROTAYI_BIRLESTIR = false;
  try { assert.equal(cokluIlanlariAyristir("Konya Ankara tır\nKonya İzmir tır\n" + TEL).length, 2); }
  finally { CONFIG.COKLU_ROTAYI_BIRLESTIR = true; }
});
test('Spam / iş ilanı elenir', () => {
  assert.deepEqual(rota('Şoför aranıyor Konya' + TEL), []);
});
test('Aynı mesajda telefonsuz satır telefonu en yakın satırdan alır', () => {
  const r = cokluIlanlariAyristir('Konya Ankara tır\nBursa İzmir tır\n0532 111 22 33');
  assert.equal(r.length, 2);
  assert.ok(r.every(i => i.telefon_ham === '05321112233'));
});

// ── Ekran görüntülerindeki gerçek mesajlardan regresyon testleri ──────────────────────
const { aracTipiTespit } = require('./index.js');
const tek = (m) => cokluIlanlariAyristir(m);

test('Detay kaybolmaz: Bayburt→Kayseri (fiyat, araç sayısı, yük, tonaj) ve "araç" hayalet ilan üretmez', () => {
  const r = tek('Bayburt arpalı dan\nKayseri merkez\nDamperli tır\n4 araç\n2.500 tl\nDökme çekirdek\n0"12 ton\n\n0533 414 3553');
  assert.equal(r.length, 1);
  assert.equal(`${r[0].nereden} -> ${r[0].nereye}`, 'Bayburt -> Kayseri');
  for (const k of ['2.500 tl', 'Dökme çekirdek', '12 ton', '4 araç']) assert.ok(r[0].detay.includes(k), k);
});
test('Detay kaybolmaz: Niğde-Batman patates + Yarın; 13/60 → 13.60', () => {
  const r = tek('Yarın yükler ;\nNiğde - Batman\n13/60 patates 🥔\n\nİrtibat :05052162168');
  assert.equal(r.length, 1);
  assert.ok(r[0].detay.includes('patates') && r[0].detay.includes('Yarın') && r[0].detay.includes('13.60'));
  assert.ok(!/irtibat/i.test(r[0].detay));
});
test('Bölümlü liste: her bölümün kendi çıkışı ve "Ç.KALE" → Çanakkale', () => {
  const m = '🛑BURDUR YÜKLER\n🔻KONYA EREĞLİ BOŞALTIR\n⚠️DAMPER 13.60 AÇIK TENTE ARAÇLAR\n-----------------------\n🛑Ç.KALE ÇAN TORBA KÖMÜR YÜKLER\n🔻AKSARAY AĞAÇÖREN BOŞALTIR\n🔻AKSARAY ESKİL BOŞALTIR\n⚠️DAMPER 13.60 AÇIK TENTE ARAÇLAR\n-----------------------\n0532 111 22 33';
  assert.deepEqual(rota(m), ['Burdur -> Konya / Ereğli', 'Çanakkale -> Aksaray / Ağaçören, Aksaray / Eskil']);
  assert.ok(tek(m)[1].detay.includes('TORBA KÖMÜR'));
  assert.equal(tek(m)[1].arac_tipi, 'Damperli');
});
test('Kısaltma yüzünden varış kaybolmaz: Lüleburgaz → İst.Avrupa', () => {
  const r = tek('HEMEN YÜKLEME\n\nLüleburgaz ➡️ İst.Avrupa Frigo Tır\n\n0 506 156 32 10');
  assert.equal(`${r[0].nereden} -> ${r[0].nereye}`, 'Kırklareli / Lüleburgaz -> İstanbul');
  assert.ok(r[0].detay.includes('İstanbul'));
});
test('"13:60 açık" / "13/60" doğru araç tipine gider (site kategorileriyle aynı)', () => {
  assert.equal(aracTipiTespit('Maraş merkez 13:60 açık'), '13.60 Açık Dorse');
  assert.equal(aracTipiTespit('13/60 patates'), 'Kapalı Dorse');
  assert.equal(aracTipiTespit('KISA DORSE bir araç'), 'Damperli');
  assert.equal(aracTipiTespit('Damper 13.60 açık tente araçlar'), 'Damperli');
});
test('Eleman/asansör reklamı ilan sayılmaz', () => {
  assert.deepEqual(rota('izmir ve çevresine Gelen nakliyeci arkadaşlara eleman Asansör temin edilir İlyas' + TEL), []);
});
test('Başlıksız "boşaltır" listesi çıkış sanılmaz', () => {
  const r = tek('🔻BURDUR ALTINYAYLA BOŞALTIR\n🔻BURDUR BUCAK BOŞALTIR\n⚠️DAMPER 13.60 AÇIK TENTE ARAÇLAR\n' + TEL);
  assert.equal(r.length, 1);
  assert.equal(r[0].nereden, 'Belirtilmedi');
  assert.equal(r[0].nereye, 'Burdur');
});

'use strict';
// Çalıştırma: npm test   (ağ/WhatsApp gerekmez; yalnızca ayrıştırıcıyı sınar)
const test = require('node:test');
const assert = require('node:assert/strict');
const { ilanlariAyristir, aracTipiTespit } = require('./parser.js');

const TEL = ' 0532 111 22 33';
const al = (m) => ilanlariAyristir(m).ilanlar;
const rota = (m) => al(m).map(i => `${i.nereden} -> ${i.nereye}`);

test('Ereğli → Kırıkhan', () => {
  assert.deepEqual(rota("Ereğli'den hatay Kırıkhan'a 9 metre 10 ton açık tır" + TEL), ['Konya / Ereğli -> Hatay / Kırıkhan']);
});
test('Sarayönü den Tire (boşluklu ek + zayıf ilçe)', () => {
  assert.deepEqual(rota('SARAYÖNÜ DEN TİRE TIR KISA ARPA 1000' + TEL), ['Konya / Sarayönü -> İzmir / Tire']);
});
test('Kdz Ereğli Zonguldak sayılır', () => {
  assert.deepEqual(rota('Kdz Ereğli den Konya ya tır lazım' + TEL), ['Zonguldak / Ereğli -> Konya']);
});
test('"tire" (lastik) ve "bor" ilçe sanılmaz', () => {
  assert.deepEqual(rota("Konya'dan Ankara'ya lastik tire yükü var" + TEL), ['Konya -> Ankara']);
  assert.deepEqual(rota("Bor madeni yükü var Eskişehir'den Konya'ya" + TEL), ['Eskişehir -> Konya']);
});
test('Çıkış başlığı altında varış listesi: her rota ayrı ilan', () => {
  assert.deepEqual(rota('KONYA ÇIKIŞLI\nKonya Ankara tır\nKonya İzmir tır\n' + TEL), ['Konya -> Ankara', 'Konya -> İzmir']);
});
test('Farklı çıkışlar ayrı ilan', () => {
  assert.equal(al('Konya Ankara tır\nAdana İzmir tır\n' + TEL).length, 2);
});
test('Telefonsuz satır en yakın telefonu alır', () => {
  const r = al('Konya Ankara tır\nKonya Bursa tır\n0532 111 22 33');
  assert.equal(r.length, 2);
  assert.ok(r.every(i => i.telefon_ham === '05321112233'));
});
test('Emoji detaya girmez', () => {
  const r = al('📍Germencik → ORDU 4️⃣ damperli' + TEL);
  assert.ok(!/[\u20E3\uFE0F]|\p{Extended_Pictographic}/u.test(r[0].detay));
});
test('İş ilanı / spam elenir; telefonsuz mesaj elenir', () => {
  assert.deepEqual(rota('Şoför aranıyor Konya' + TEL), []);
  assert.deepEqual(rota('izmir ve çevresine Gelen nakliyeci arkadaşlara eleman Asansör temin edilir İlyas' + TEL), []);
  assert.deepEqual(rota('Konya Ankara tır lazım'), []);
  assert.deepEqual(rota('Günaydın arkadaşlar hayırlı cumalar' + TEL), []);
});
test('Ekran görüntüsü: Çorlu/Muratlı çok başlıklı liste ayrı ilanlara bölünür', () => {
  const m = 'SABAH ÇORLU ASB YÜKLEMELİ\nADANA KAPALI 10TEKER 9 PALET 11.5 TON\nSABAH MURATLI YÜKLEMELİ (AÇIK-KAPALI UYAR)\nESENYURT TIR\nANTALYA TIR\n0555 111 22 33';
  assert.deepEqual(rota(m), ['Tekirdağ / Çorlu -> Adana', 'Tekirdağ / Muratlı -> İstanbul / Esenyurt', 'Tekirdağ / Muratlı -> Antalya']);
  assert.equal(al(m)[0].arac_tipi, '10 Teker');
});
test('Ekran görüntüsü: Karaman Kılbasan → Susurluk, "Pancar" yer sanılmaz', () => {
  const m = 'KARAMAN KILBASAN SUSURLUK • Pancar Yüklemesi • Sınırsız Damper • 1500+KDV • SALI&CUMA Ödeme • Serbest Tonaj • KARAMAN DEMİRYURT SUSURLUK' + TEL;
  const r = al(m);
  assert.equal(r[0].nereden, 'Karaman');
  assert.equal(r[0].nereye, 'Balıkesir / Susurluk');
  assert.equal(r[0].arac_tipi, 'Damperli');
});
test('Basit tir ilanları', () => {
  assert.deepEqual(rota('BALIKESİR+MANİSA TIR' + TEL), ['Balıkesir -> Manisa']);
  assert.deepEqual(rota('İZMİR+AYDIN TIR' + TEL), ['İzmir -> Aydın']);
  assert.deepEqual(rota('SANCAKTEPE+GEBZE TIR' + TEL), ['İstanbul / Sancaktepe -> Kocaeli / Gebze']);
  assert.deepEqual(rota('MERSİN+HATAY TIR' + TEL), ['Mersin -> Hatay']);
});
test('Tek satırlı detay korunur: Bayburt→Kayseri', () => {
  const r = al('Bayburt arpalı dan\nKayseri merkez\nDamperli tır\n4 araç\n2.500 tl\nDökme çekirdek\n0"12 ton\n\n0533 414 3553');
  assert.equal(r.length, 1);
  assert.equal(`${r[0].nereden} -> ${r[0].nereye}`, 'Bayburt -> Kayseri');
  for (const k of ['2.500 tl', 'Dökme çekirdek', '12 ton', '4 araç']) assert.ok(r[0].detay.includes(k), k);
});
test('13/60 → 13.60, irtibat artığı detaya girmez', () => {
  const r = al('Yarın yükler ;\nNiğde - Batman\n13/60 patates 🥔\n\nİrtibat :05052162168');
  assert.equal(r.length, 1);
  assert.ok(r[0].detay.includes('patates') && r[0].detay.includes('Yarın') && r[0].detay.includes('13.60'));
  assert.ok(!/irtibat/i.test(r[0].detay));
});
test('Bölümlü liste: her bölümün kendi çıkışı', () => {
  const m = '🛑BURDUR YÜKLER\n🔻KONYA EREĞLİ BOŞALTIR\n⚠️DAMPER 13.60 AÇIK TENTE ARAÇLAR\n-----------------------\n🛑Ç.KALE ÇAN TORBA KÖMÜR YÜKLER\n🔻AKSARAY AĞAÇÖREN BOŞALTIR\n🔻AKSARAY ESKİL BOŞALTIR\n⚠️DAMPER 13.60 AÇIK\n' + TEL;
  assert.deepEqual(rota(m), ['Burdur -> Konya / Ereğli', 'Çanakkale -> Aksaray / Ağaçören', 'Çanakkale -> Aksaray / Eskil']);
  assert.equal(al(m)[1].arac_tipi, 'Damperli');
});
test('Kısaltma: Lüleburgaz → İst.Avrupa', () => {
  const r = al('HEMEN YÜKLEME\n\nLüleburgaz ➡️ İst.Avrupa Frigo Tır\n\n0 506 156 32 10');
  assert.equal(`${r[0].nereden} -> ${r[0].nereye}`, 'Kırklareli / Lüleburgaz -> İstanbul');
  assert.equal(r[0].arac_tipi, 'Frigo');
});
test('Araç tipi sözlüğü', () => {
  assert.equal(aracTipiTespit('Maraş merkez 13:60 açık'), '13.60 Açık Dorse');
  assert.equal(aracTipiTespit('13/60 patates'), 'Kapalı Dorse');
  assert.equal(aracTipiTespit('KISA DORSE bir araç'), 'Damperli');
});
test('Başlıksız "boşaltır" → çıkış sanılmaz', () => {
  const r = al('🔻BURDUR BUCAK BOŞALTIR\n⚠️DAMPER 13.60 AÇIK TENTE ARAÇLAR\n' + TEL);
  assert.equal(r.length, 1);
  assert.equal(r[0].nereden, 'Belirtilmedi');
  assert.equal(r[0].nereye, 'Burdur / Bucak');
});
test('Alt başlıklı liste: "büyük balya" ilçe sayılmaz', () => {
  const m = '👉KIZILTEPE DEN BÜYÜK BALYA YÜKLENECEK 13.60 AÇIK İHTİYAÇ\n✅Tarsus 1araç\n✅Antep Kilis yolu 1araç\n✅Elbistan 1araç\n\n👉Hilvan dan yükler\nÇuvallı silaç\n✅Van er 1 araç\n0532 111 22 33';
  assert.deepEqual(rota(m), [
    'Mardin / Kızıltepe -> Mersin / Tarsus', 'Mardin / Kızıltepe -> Gaziantep',
    'Mardin / Kızıltepe -> Kahramanmaraş / Elbistan', 'Şanlıurfa / Hilvan -> Belirtilmedi'
  ]);
});
test('Tek şehirli ilan: Konya\'dan yük var', () => {
  const r = al("Konya'dan yük var tır lazım" + TEL);
  assert.equal(r[0].nereden, 'Konya');
  assert.equal(r[0].nereye, 'Belirtilmedi');
});

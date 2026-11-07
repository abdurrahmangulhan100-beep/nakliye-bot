'use strict';
// Çalıştırma: npm test   (ağ/WhatsApp gerekmez; yalnızca ayrıştırıcıyı sınar)
// Kural: 1 WhatsApp mesajı = en fazla 1 ilan (mesajın temiz hali).
const test = require('node:test');
const assert = require('node:assert/strict');
const { ilanlariAyristir, aracTipiTespit } = require('./parser.js');
const { reklamKontrol } = require('./reklam.js');

const TEL = ' 0532 111 22 33';
const al = (m) => ilanlariAyristir(m).ilanlar;
const tek = (m) => { const r = al(m); assert.equal(r.length, 1, 'tek ilan beklenirdi'); return r[0]; };
const rota = (m) => { const i = tek(m); return `${i.nereden} -> ${i.nereye}`; };

test('Ereğli → Kırıkhan', () => {
  assert.equal(rota("Ereğli'den hatay Kırıkhan'a 9 metre 10 ton açık tır" + TEL), 'Konya / Ereğli -> Hatay / Kırıkhan');
});
test('Sarayönü den Tire (boşluklu ek + zayıf ilçe)', () => {
  assert.equal(rota('SARAYÖNÜ DEN TİRE TIR KISA ARPA 1000' + TEL), 'Konya / Sarayönü -> İzmir / Tire');
});
test('Kdz Ereğli Zonguldak sayılır', () => {
  assert.equal(rota('Kdz Ereğli den Konya ya tır lazım' + TEL), 'Zonguldak / Ereğli -> Konya');
});
test('"tire" (lastik) ve "bor" ilçe sanılmaz', () => {
  assert.equal(rota("Konya'dan Ankara'ya lastik tire yükü var" + TEL), 'Konya -> Ankara');
  assert.equal(rota("Bor madeni yükü var Eskişehir'den Konya'ya" + TEL), 'Eskişehir -> Konya');
});
test('Çok rotalı mesaj TEK ilan olur, tüm satırlar detayda kalır', () => {
  const i = tek('KONYA ÇIKIŞLI\nKonya Ankara tır\nKonya İzmir tır\n' + TEL);
  assert.equal(i.nereden, 'Konya');
  assert.ok(i.detay.includes('Ankara') && i.detay.includes('İzmir'));
});
test('Telefon ilanın telefonu olur, detayda numara kalmaz', () => {
  const i = tek('Konya Ankara tır\n0532 111 22 33');
  assert.equal(i.telefon_ham, '05321112233');
  assert.ok(!/0532/.test(i.detay));
});
test('Emoji detaya girmez', () => {
  assert.ok(!/[\u20E3\uFE0F]|\p{Extended_Pictographic}/u.test(tek('📍Germencik → ORDU 4️⃣ damperli' + TEL).detay));
});
test('Spam / iş ilanı / telefonsuz / sohbet elenir', () => {
  assert.deepEqual(al('Şoför aranıyor Konya' + TEL), []);
  assert.deepEqual(al('izmir ve çevresine Gelen nakliyeci arkadaşlara eleman Asansör temin edilir İlyas' + TEL), []);
  assert.deepEqual(al('Konya Ankara tır lazım'), []);
  assert.deepEqual(al('Günaydın arkadaşlar hayırlı cumalar' + TEL), []);
  assert.deepEqual(al('Konya Ankara maçı kaç kaç' + TEL), []);
});
test('Çok başlıklı liste (Çorlu/Muratlı) TEK ilan, hiçbir satır kaybolmaz', () => {
  const i = tek('SABAH ÇORLU ASB YÜKLEMELİ\nADANA KAPALI 10TEKER 9 PALET 11.5 TON\nSABAH MURATLI YÜKLEMELİ (AÇIK-KAPALI UYAR)\nESENYURT TIR\nANTALYA TIR\n0555 111 22 33');
  assert.equal(i.nereden, 'Tekirdağ / Çorlu');
  for (const k of ['ADANA', 'MURATLI', 'ESENYURT', 'ANTALYA', '11.5 TON']) assert.ok(i.detay.includes(k), k);
});
test('Karaman Kılbasan → Susurluk; "Pancar" yer sanılmaz', () => {
  const i = tek('KARAMAN KILBASAN SUSURLUK • Pancar Yüklemesi • Sınırsız Damper • 1500+KDV • SALI&CUMA Ödeme • Serbest Tonaj • KARAMAN DEMİRYURT SUSURLUK' + TEL);
  assert.equal(`${i.nereden} -> ${i.nereye}`, 'Karaman -> Balıkesir / Susurluk');
  assert.equal(i.arac_tipi, 'Damperli');
});
test('Emircan mesajı: 1 ilan; link, firma imzası, slogan ve numara temizlenir', () => {
  const m = '📍Konya Ilgın yükleme\n🛑 tonluk paket küspe\n✋Antalya Döşemealtı iner ✋tonu 750 TL 35 tona kadar yükleme olur\n\n📍Afyon merkez yükleme 🛑tonluk paket mısır\nr🌽 silajı İzmir buca iner\n🚛 1 araç lazım tonu 900 TL\n\n✋HEMEN YÜKLER\n🇹🇷EMİRCAN LOJİSTİK\n📲 0 552 947 88 83\nhttps://whatsapp.com/channel/0029Vb9akxDFy7297Clh6t1x';
  const i = tek(m);
  assert.equal(i.nereden, 'Konya / Ilgın');
  assert.equal(i.telefon_ham, '05529478883');
  for (const k of ['Döşemealtı', 'İzmir buca', '750 TL', '900 TL']) assert.ok(i.detay.includes(k), k);
  for (const k of ['LOJİSTİK', 'HEMEN YÜKLER', 'http', '0552']) assert.ok(!i.detay.includes(k), k);
});
test('Aksaray listesi (19 satır): TEK ilan, plaka öneki "68AKSARAY" tanınır', () => {
  const i = tek('📍 68AKSARAY ORGANİZE DOKME POMZA YÜKLER\n🔷 Adana → 1 Dorse\n🔷 Afyon / İscehisar → 4 Dorse\n🔷 Ankara → 5 Dorse\n🔷 KIRKLARELİ → 1 Dorse\n0552 947 88 83');
  assert.equal(i.nereden, 'Aksaray');
  assert.ok(i.detay.includes('KIRKLARELİ') && i.detay.includes('Ankara'));
});
test('Aynı mesaj + aynı telefon = aynı mükerrer anahtarı', () => {
  const m = 'Konya Ankara 13.60 açık tır lazım' + TEL;
  assert.equal(tek(m).anahtar, tek(m).anahtar);
  assert.notEqual(tek(m).anahtar, tek('Konya Bursa 13.60 açık tır lazım' + TEL).anahtar);
});
test('Detay kaybolmaz: Bayburt→Kayseri', () => {
  const i = tek('Bayburt arpalı dan\nKayseri merkez\nDamperli tır\n4 araç\n2.500 tl\nDökme çekirdek\n0"12 ton\n\n0533 414 3553');
  assert.equal(`${i.nereden} -> ${i.nereye}`, 'Bayburt -> Kayseri');
  for (const k of ['2.500 tl', 'Dökme çekirdek', '12 ton', '4 araç']) assert.ok(i.detay.includes(k), k);
});
test('13/60 → 13.60, irtibat artığı detaya girmez', () => {
  const i = tek('Yarın yükler ;\nNiğde - Batman\n13/60 patates 🥔\n\nİrtibat :05052162168');
  assert.ok(i.detay.includes('patates') && i.detay.includes('Yarın') && i.detay.includes('13.60'));
  assert.ok(!/irtibat/i.test(i.detay));
});
test('Kısaltma: Lüleburgaz → İst.Avrupa, Frigo', () => {
  const i = tek('HEMEN YÜKLEME\n\nLüleburgaz ➡️ İst.Avrupa Frigo Tır\n\n0 506 156 32 10');
  assert.equal(`${i.nereden} -> ${i.nereye}`, 'Kırklareli / Lüleburgaz -> İstanbul');
  assert.equal(i.arac_tipi, 'Frigo');
});
test('Araç tipi sözlüğü', () => {
  assert.equal(aracTipiTespit('Maraş merkez 13:60 açık'), '13.60 Açık Dorse');
  assert.equal(aracTipiTespit('13/60 patates'), 'Kapalı Dorse');
  assert.equal(aracTipiTespit('KISA DORSE bir araç'), 'Damperli');
  assert.equal(aracTipiTespit('ADANA KAPALI 10TEKER'), '10 Teker');
});
test('Tek şehirli ilan: Konya\'dan yük var', () => {
  const i = tek("Konya'dan yük var tır lazım" + TEL);
  assert.equal(`${i.nereden} -> ${i.nereye}`, 'Konya -> Belirtilmedi');
});
test('Boş araç ilanı ARAC türünde', () => {
  assert.equal(tek("Konya'dayım boşum yük arıyorum" + TEL).tur, 'ARAC');
});

// ───────── v3.1: yabancı ülke engeli, firma adı, Telegram biçimi ─────────
test('Yabancı ülke/şehir yükleri engellenir', () => {
  for (const m of [
    "Konya'dan Irak'a tır lazım", "Mersin Erbil 13.60 açık tır", 'Almanya yükü var tır lazım',
    "Duhok'a komple tır", 'Gürcistan Tiflis frigo tır', 'KKTC yükü gemi ile palet', 'Suudi Arabistan sefer tır var',
    'ABD\'ye konteyner yükü var', 'Bursa Bulgaristan tır lazım'
  ]) {
    const r = ilanlariAyristir(m + TEL);
    assert.equal(r.ret, 'yabanci', m);
    assert.deepEqual(r.ilanlar, []);
  }
});
test('Yurt içi yükler yanlışlıkla engellenmez (Habur, mısır, Bağdat Cad., İst.Avrupa, tire)', () => {
  assert.equal(rota("Konya'dan Habur'a 13.60 açık tır lazım" + TEL), 'Konya -> Şırnak / Habur');
  assert.equal(rota("Konya'dan Ankara'ya mısır yükü tır lazım" + TEL), 'Konya -> Ankara');
  assert.equal(tek("Konya'dan İstanbul Bağdat Caddesi'ne palet tır lazım" + TEL).nereye, 'İstanbul');
  assert.equal(rota("Konya'dan Ankara'ya lastik tire yükü var" + TEL), 'Konya -> Ankara');
});
test('Yabancı engeli kapatılabilir', () => {
  assert.equal(ilanlariAyristir("Konya'dan Irak'a tır lazım" + TEL, { yabanciEngelle: false }).ret, null);
});
test('Firma adı: imza satırı, "Firma:" etiketi, yoksa boş', () => {
  const emir = tek('📍Konya Ilgın yükleme\n🚛 1 araç lazım tonu 900 TL\n✋HEMEN YÜKLER\n🇹🇷EMİRCAN LOJİSTİK\n📲 0 552 947 88 83');
  assert.equal(emir.firma, 'Emircan Lojistik');
  assert.equal(tek('Firma: Öz Konya Nakliyat\nKonya Ankara tır lazım' + TEL).firma, 'Öz Konya Nakliyat');
  assert.equal(tek('Konya Ankara tır lazım' + TEL).firma, '');
  assert.equal(tek('Konya Ankara 13.60 tır lazım ton 24 nakliye' + TEL).firma, ''); // yük satırı firma sanılmaz
});
test('Telegram mesajı: firma, rota, WhatsApp bağlantısı, etiketler; kullanıcı metni HTML-kaçışlı', () => {
  const { telegramMetni } = require('./index.js');
  const m = telegramMetni(tek('Firma: A&B Lojistik\nKonya Ankara 13.60 açık tır lazım' + TEL));
  assert.ok(m.includes('📦 <b>YÜK İLANI</b>'));
  assert.ok(m.includes('<b>Konya</b> ➡️ <b>Ankara</b>') && m.includes('https://wa.me/905321112233'));
  assert.ok(m.includes('#Konya #Ankara'));
});

// ───────── v3.2: temizlik kuralları ─────────
test('Bugünkü yükleme duyuruları spam sayılır', () => {
  assert.deepEqual(al('Bugünkü yüklemeler Konya Ankara tır' + TEL), []);
});
test('Nakliye hizmeti / depolama / kampanya reklamları atılır', () => {
  for (const m of ['Türkiye geneli nakliyat hizmeti veriyoruz Konya Ankara', 'Eşya depolama ambalaj Konya Ankara tır', 'Konya Ankara tır kampanya indirim'])
    assert.deepEqual(al(m + TEL), [], m);
});

test('Otomatik görev metinleri, iş arama ve WhatsApp yönlendirmeleri elenir', () => {
  const gereksiz = [
    'Bugünkü taşıma görevi',
    'Bugünkü yük',
    'Bugünkü yük taşıma işi',
    'Bugünkü yük taşıma programı',
    'Günün taşıma görevi',
    'Lütfen bana WhatsApp dan mesaj bırakın',
    'İş arıyorum',
    'Şoför aranıyor',
    'Telefonsuz ilanlar'
  ];
  for (const m of gereksiz) {
    const r = ilanlariAyristir(m);
    assert.equal(r.ilanlar.length, 0, m);
    if (/bugunku|gunun/.test(require('./parser.js').normalize(m))) {
      assert.equal(r.ret, 'liste_spam', m);
    }
  }
});

test('"Bugünkü yük/taşıma işi" başlıklı mesajlar tonaj olsa da atılır (kullanıcı kararı)', () => {
  const r = ilanlariAyristir('Bugünkü yük taşıma işi: Konya Ankara 24 ton patates, kapalı dorse lazım' + TEL);
  assert.equal(r.ilanlar.length, 0);
});
test('Telefonsuz ama uzun gerçek ilan (Trakya Çelik tarzı) atılmaz', () => {
  const satirlar = ['TRAKYA ÇELİK LOJİSTİK', ...Array.from({ length: 12 }, (_, k) => `Malkara - ${['Adana Seyhan', 'Mersin Mezitli', 'Manisa Soma', 'Kütahya Simav'][k % 4]} → Damper ${1000 + k * 50}+`)];
  assert.equal(ilanlariAyristir(satirlar.join('\n'), { telefonZorunlu: false }).ilanlar.length, 1);
});
test('Şoför aranıyor / iş arıyorum / asansör mesajları atılır', () => {
  for (const m of ['Konya Ankara tır şoför aranıyor' + TEL, 'İş arıyorum tır şoförüyüm Konya Ankara' + TEL, 'Konya Ankara yük asansör temini' + TEL]) {
    assert.equal(ilanlariAyristir(m).ret, 'is_hizmet', m);
  }
});

test('İş arama içeren mesaj, yanında yük olsa da atılır (kullanıcı kararı)', () => {
  assert.equal(ilanlariAyristir('İş arıyorum\nKonya Ankara 24 ton patates kapalı dorse' + TEL).ret, 'is_hizmet');
});

test('Telefonsuz mesaj atılır', () => {
  assert.equal(ilanlariAyristir('Konya Ankara 13.60 açık tır lazım').ret, 'telefon_yok');
});

test('"Bugün planlanan taşıma" toplu listesi engellenir', () => {
  const r = ilanlariAyristir('Bugün planlanan taşıma\nAnkara Polatlı Afyonkarahisar Sandıklı 27ton\nAnkara Akyurt İzmir Kapalı/Frigo TIR\nKütahya Domaniç Çorum TIR\n0532 111 22 33');
  assert.equal(r.ilanlar.length, 0);
  assert.equal(r.ret, 'liste_spam');
});
test('Aynı telefon+yer+tonaj, isim değişse de aynı gevşek anahtar', () => {
  const a = tek('KONYA İLGİN +SARAYÖNÜNDEN\nANKARA YAKUP HASAN\n14TON\nAÇIK 10TK 40AYAK TR OLUR\n0532 111 22 33');
  const b = tek('KONYA İLGİN +SARAYÖNÜNDEN\nANKARA YAKUPOĞLAN\n14TON\nAÇIK 10TK 40AYAK TR OLUR\n0532 111 22 33');
  assert.notEqual(a.anahtar, b.anahtar);
  assert.equal(a.anahtar2, b.anahtar2);
  const c = tek('KONYA İLGİN +SARAYÖNÜNDEN\nANKARA\n20TON\nAÇIK 10TK 40AYAK TR OLUR\n0532 111 22 33');
  assert.notEqual(a.anahtar2, c.anahtar2);
});



test('Qmove marka reklamı yakalanır', () => {
  const { reklamKontrol } = require('./reklam.js');
  assert.equal(reklamKontrol('Qmove uygulamasını indirin').ret, 'reklam_marka');
});

test('Çok uzun ama gerçek yük ilanı yalnız uzun olduğu için reddedilmez', () => {
  const govde = 'Konya Ankara 24 ton patates kapalı dorse yük var\\n' + 'Yükleme ve teslimat açıklaması\\n'.repeat(500);
  const r = ilanlariAyristir(govde + TEL);
  assert.equal(r.ilanlar.length, 1);
});

test('Uzun çok satırlı mesaj 4.000 karakteri geçti diye otomatik reddedilmez', () => {
  const govde = 'Konya Ankara 13.60 kapalı dorse yük var\n' + 'Açıklama ve yükleme ayrıntısı\n'.repeat(180);
  const r = ilanlariAyristir(govde + TEL);
  assert.notEqual(r.ret, 'cok_uzun');
});

test('Supabase satırı ham WhatsApp mesajını aynen cargo_detail alanına koyar', () => {
  const { sbSatiri } = require('./index.js');
  const ham = '📍 KONYA → ANKARA\n25 TON PATATES\n0532 111 22 33';
  const row = sbSatiri({
    nereden: 'Konya', nereye: 'Ankara', arac_tipi: 'Kapalı Dorse',
    firma: 'Deneme Nakliyat', telefon: '0532 111 22 33', telefon_ham: '05321112233',
    detay: 'ayrıştırılmış özet', ham_mesaj: ham
  });
  assert.equal(row.cargo_detail, ham);
  assert.equal(row.from_city, 'Konya');
  assert.equal(row.to_city, 'Ankara');
});


test('Telefonu olmayan ama rota ve nakliye bilgisi içeren ilan ham modda kabul edilir', () => {
  const r = ilanlariAyristir('Konya Ankara 13.60 kapalı dorse 24 ton yük var', { telefonZorunlu: false });
  assert.equal(r.ilanlar.length, 1);
  assert.equal(r.ilanlar[0].telefon_ham, null);
});


test('Gerçek yük ilanındaki WhatsApp grup/kanal bağlantısı ilanı düşürmez', () => {
  const grup = "Konya'dan Ankara'ya 20 ton yük var açık dorse " + TEL +
    "\\nhttps://chat.whatsapp.com/AbCdEf";
  const kanal = "Konya'dan Ankara'ya 20 ton yük var açık dorse " + TEL +
    "\\nhttps://whatsapp.com/channel/AbCdEf";
  assert.equal(reklamKontrol(grup)?.ret, undefined);
  assert.equal(reklamKontrol(kanal)?.ret, undefined);
});

test('Yalnız WhatsApp grup/kanal daveti reklam olarak reddedilir', () => {
  const grup = "Bu bağlantıyı takip ederek WhatsApp grubuma katılabilirsin: https://chat.whatsapp.com/AbCdEf";
  const kanal = "Nakliye ilanları için kanalımıza katılın: https://whatsapp.com/channel/AbCdEf";
  assert.equal(reklamKontrol(grup)?.ret, 'reklam_link');
  assert.equal(reklamKontrol(kanal)?.ret, 'reklam_link');
});

test('LINK_MODU engelle ayarında gerçek ilan da bağlantı nedeniyle reddedilir', () => {
  const mesaj = "Konya'dan Ankara'ya 20 ton yük var açık dorse " + TEL +
    "\\nhttps://chat.whatsapp.com/AbCdEf";
  assert.equal(reklamKontrol(mesaj, { linkModu: 'engelle' })?.ret, 'reklam_link');
});

// ───────── Toplu / otomatik liste, hizmet reklamı, link temizliği ─────────
const { linkTemizle } = require('./reklam.js');

test('"Bugün için nakliye görevi" toplu listesi somut yük olsa da atılır', () => {
  const m = 'Bugün için nakliye görevi\nMersin Antalya 1Palet\nİstanbul Sancaktepe İstanbul Fatih 2,5ton 1Palet';
  assert.equal(ilanlariAyristir(m).ret, 'liste_spam');
});
test('Tüm araç tiplerini art arda sayan şablon atılır', () => {
  const m = 'Muğla Menteşe Kapalı/Tenteli/Yüksek Yan/Açık/Frigo/Damperli Kamyonet 1ton' + TEL;
  assert.equal(ilanlariAyristir(m).ret, 'liste_spam');
});
test('"sevkiyatyonetimi.com ... toplu paylaşılmıştır" atılır', () => {
  const m = 'Malatya → Tokat / Erbaa\nTokat → Sivas / Merkez\nBu mesaj, sevkiyatyonetimi.com üzerinden aynı anda birçok WhatsApp grubunda toplu olarak paylaşılmıştır' + TEL;
  assert.equal(ilanlariAyristir(m).ret, 'liste_spam');
});
test('Ev/ofis taşıma hizmet reklamı atılır', () => {
  const m = 'Balıkesir merkez edremit akçay Cevresine\nGelen Nakliyeci Arkadaşların\nEşya İndirmesi\nEşya Yüklemesi\nSökülüp Montajı\nAsansör temini\nİtina ile hizmet verilmektedir' + TEL;
  assert.equal(ilanlariAyristir(m).ret, 'is_hizmet');
});
test('Telefonlu tek rotalı gerçek ilan etkilenmez', () => {
  assert.equal(rota('Konya Ereğli den Ankara ya 24 ton kapalı tır lazım' + TEL), 'Konya / Ereğli -> Ankara');
});
test('Başlık + altında varış listesi (telefonlu) etkilenmez', () => {
  const r = ilanlariAyristir('KONYA ÇIKIŞLI\nAnkara\nİzmir\nBursa\nKapalı tır' + TEL);
  assert.equal(r.ret, null);
});
test('WhatsApp kanal linki silinir, ilan kalır', () => {
  const ham = 'https://whatsapp.com/channel/0029Vb0LfaQFy727MbnJfl0Z\nTRAKYA ÇELİK LOJİSTİK\nMalkara - İstanbul Ümraniye → Damper 900TL';
  const t = linkTemizle(ham);
  assert.ok(!/whatsapp\.com|http/i.test(t));
  assert.ok(/Malkara/.test(t));
  assert.equal(ilanlariAyristir(ham, { telefonZorunlu: false }).ilanlar.length, 1);
});
test('wa.me iletişim linki linkTemizle ile korunur', () => {
  assert.ok(linkTemizle('Konya Ankara tır https://wa.me/905321112233').includes('wa.me/905321112233'));
});

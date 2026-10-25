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
test('Çoklu satır: her satır ayrı ilan', () => {
  const r = rota("KONYA ÇIKIŞLI\nKonya Ankara tır\nKonya İzmir tır\n" + TEL);
  assert.equal(r.length, 2);
});
test('Spam / iş ilanı elenir', () => {
  assert.deepEqual(rota('Şoför aranıyor Konya' + TEL), []);
});
test('Aynı mesajda telefonsuz satır telefonu en yakın satırdan alır', () => {
  const r = cokluIlanlariAyristir('Konya Ankara tır\nKonya Bursa tır\n0532 111 22 33');
  assert.equal(r.length, 2);
  assert.ok(r.every(i => i.telefon_ham === '05321112233'));
});

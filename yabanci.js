'use strict';
/*
 * YABANCI ÜLKE FİLTRESİ — normalize edilmiş metinde (parser.normalize çıktısı) yurt dışı yük ipuçlarını arar.
 * Bilinçli olarak EKLENMEYENLER (Türkçede başka anlamı olanlar): mısır, sudan, katar, şam, çin, fas, süleymaniye,
 * transit (Ford Transit), "Avrupa" tek başına (İst. Avrupa yakası). Sınır kapıları (Habur, Kapıkule...) yurt içi sayılır.
 * Listeyi değiştirmek için aşağıdaki dizilere ekleme/çıkarma yapmanız yeterli.
 */

// Ek alabilen (ör. "Erbil'e", "Almanyadan") — sonu serbest eşleşir
const SERBEST = [
  // ülkeler
  'irak', 'iran', 'suriye', 'urdun', 'lubnan', 'israil', 'filistin', 'gazze', 'yemen', 'umman', 'kuveyt', 'bahreyn',
  'suudi', 'libya', 'tunus', 'cezayir', 'azerbaycan', 'nahcivan', 'rusya', 'ukrayna', 'belarus', 'beyaz rusya', 'moldova',
  'romanya', 'arnavutluk', 'kosova', 'bosna hersek', 'saraybosna', 'makedonya', 'slovenya', 'slovakya', 'cekya',
  'cek cumhuriyeti', 'polonya', 'almanya', 'fransa', 'italya', 'ispanya', 'portekiz', 'hollanda', 'belcika', 'luksemburg',
  'isvicre', 'avusturya', 'ingiltere', 'birlesik krallik', 'birlesik arap', 'irlanda', 'isvec', 'norvec', 'danimarka',
  'finlandiya', 'litvanya', 'letonya', 'estonya', 'japonya', 'tayland', 'vietnam', 'endonezya', 'malezya', 'amerika',
  'kanada', 'brezilya', 'meksika', 'etiyopya', 'nijerya', 'somali', 'kibris', 'kktc', 'gazimagusa', 'magusa', 'girne', 'lefkosa',
  // Irak / Suriye / İran
  'erbil', 'bagdat', 'basra', 'musul', 'kerkuk', 'duhok', 'dohuk', 'zaho', 'zakho', 'silemani', 'sulaymaniyah',
  'tahran', 'tebriz', 'isfahan', 'urmiye', 'bazargan', 'halep', 'idlib', 'lazkiye', 'cerablus', 'resulayn', 'tel abyad',
  'el bab', 'kamisli', 'kobani', 'kobane',
  // Kafkasya / Orta Asya
  'tiflis', 'batum', 'erivan', 'tasken', 'almati', 'astana', 'bisbek', 'asgabat',
  // Avrupa
  'sofya', 'filibe', 'burgas', 'bukres', 'kostence', 'budapeste', 'belgrad', 'uskup', 'selanik', 'atina', 'viyana',
  'berlin', 'munih', 'hamburg', 'frankfurt', 'stuttgart', 'londra', 'milano', 'madrid', 'barselona', 'amsterdam',
  'rotterdam', 'bruksel', 'varsova', 'moskova', 'odessa', 'kisinev',
  // Körfez / Orta Doğu
  'dubai', 'abu dabi', 'riyad', 'cidde', 'beyrut', 'tel aviv', 'kudus'
];

// Kısa / karışma riski olanlar: yalnızca tam kelime + yön eki ("Paris'e", "ABD'ye")
const TAM = ['abd', 'bae', 'kore', 'prag', 'baku', 'doha', 'azez', 'afrin', 'paris', 'amman', 'kiev', 'kyiv', 'koln', 'varna', 'minsk', 'azez'];

// İfadeler: yurt dışı sefer işareti
const IFADE = ['uluslararasi', 'yurt disi', 'yurtdisi', 'cmr', 'carnet', 'tir karnesi'];

const kaynak = (l) => [...new Set(l)].map(t => t.replace(/ /g, '\\s+')).join('|');
const EK = '(?:a|e|ya|ye|da|de|ta|te|dan|den|tan|ten|li|lu|nin|nun)';

const KURALLAR = [
  new RegExp(`\\b(?:${kaynak(SERBEST)})\\w*`),
  new RegExp(`\\b(?:${kaynak(TAM)})${EK}?\\b`),
  new RegExp(`\\b(?:${kaynak(IFADE)})\\b`),
  /\b[a-z]{3,}istan\w*/ // Gürcistan, Bulgaristan, Pakistan, Kazakistan, Suudi Arabistan...
];

/** @param {string} normMetin parser.normalize() çıktısı. @returns {string|null} eşleşen terim */
function yabanciTerim(normMetin) {
  // "Bağdat Caddesi" gibi yurt içi adresler yanlış engellenmesin
  const n = String(normMetin || '').replace(/\bbagdat\s+cad\w*/g, ' ');
  for (const re of KURALLAR) {
    const m = n.match(re);
    if (m) return m[0].trim();
  }
  return null;
}

module.exports = { yabanciTerim };

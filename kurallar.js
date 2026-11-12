'use strict';
/*
 * TÜM YASAKLAR BU DOSYADA. Yeni yasak = ilgili listeye 1 satır.
 *
 * Kontrolden önce metin "sadeleştirilir": küçük harf, Türkçe harfler ASCII olur
 * (ç→c ş→s ğ→g ı→i ö→o ü→u), noktalama boşluk olur, kesme işareti silinir.
 * Bu yüzden buraya "bugünkü" değil "bugunku", "asansör" değil "asansor" yaz.
 *
 * Türevler için kelimenin sonuna  \w  ve  yıldız  koy: asansor + \w + yıldız  →  asansör, asansörlü, asansörler...
 * \b = kelime başı. [ ] arası boşluk için \s+ kullan.
 */

// Mesajın HAM halinde (link içinde bile) geçerse atılır
const MARKALAR = [
  /\bq ?move\w*/,
  /\bgetir ?nakliye\w*/,
  /\bbugunku ?nakliye\w*/
];

// Sırayla denenir; ilk eşleşen mesajı atar. haric: bunlardan biri varsa kural atlanır.
const KURALLAR = [
  {
    neden: 'gunluk_sablon', // "Bugünkü yük", "Bugünkü taşıma görevi", "WhatsApp'tan bana mesaj bırakın" ve türevleri
    desen: [
      /\bbugunku\s+(?:\w+\s+){0,2}?(?:gorev|yuk|tasima|lojistik|nakliye|program|ilan)\w*/,
      /\bbugunun\s+(?:\w+\s+){0,2}?(?:gorev|yuk|tasima|lojistik|nakliye|program|ilan)\w*/,
      /\b(?:gunluk|guncel)\s+(?:yuk|tasima|lojistik|nakliye)\s+(?:listesi|program|gorev|ilan)\w*/,
      /\b(?:yuk|tasima|lojistik|nakliye|sevkiyat)\s+(?:tasima\s+)?(?:gorev|program)\w*/,
      /\bbugun\s+yukler\b/,
      /\b(?:yuk|sevkiyat)\s+listesi\w*/,
      /\bmesaj\s+birak\w*/,
      /\bwhatsapp\s+uzerinden\s+(?:\w+\s+){0,2}?mesaj/
    ]
  },
  {
    neden: 'bos_arac', // boş araç / "yük arıyorum" paylaşanlar
    desen: [
      /\bbos\s+(?:arac|kamyon|tir|kamyonet|panelvan|dorse|kirkayak)\w*/,
      /\b(?:aracim|araclarim|aracimiz|araclarimiz|tirim|tirimiz|kamyonum|kamyonumuz|kamyonetim)\s+(?:\w+\s+){0,2}?(?:bos|musait|hazir|mevcut|var)\b/,
      /\barac\s+(?:var(?!\s+m[iu])|mevcut|musait|hazir)\b/,
      /\b(?:bosum|bosuz|bosta)\b/,
      /\bbos\s+(?:cikiyorum|cikiyoruz|donuyorum|donus\w*|geliyorum|gidiyorum)/,
      /\bdonus\w*\s+bos\b/,
      /\bmusait\w*/,
      /\byuk\s+(?:ariyorum|ariyoruz|bekliyorum|bekliyoruz|istiyorum|alirim|alabilirim|alinir)\b/,
      /\b(?:tasirim|tasiriz|tasiyorum|tasiyoruz)\b/
    ],
    // "Boş araç lazım / araç aranıyor" = yük sahibi, ilan olarak kalır
    haric: [
      /\b(?:arac|kamyon|tir|kamyonet|panelvan|sofor|nakliyeci|dorse)\w*\s+(?:\w+\s+){0,1}?(?:lazim|gerek\w*|araniyor|aranmakta\w*|aranir|ihtiyac\w*|ariyoruz|ariyorum|istiyoruz|istiyorum|temin)/
    ]
  },
  {
    neden: 'asansor',
    desen: [/\basansor\w*/, /\blift(?:li|ler|i|ci|imiz)?\b/, /\bsepetli\b/]
  },
  {
    neden: 'fatura', // fatura, faturalı, e-fatura, e-arşiv ve türevleri
    desen: [/\b(?:e\s?)?fatura\w*/, /\be\s?arsiv\w*/]
  },
  {
    neden: 'reklam',
    desen: [
      /\breklam\w*/, /\bkampanya\w*/, /\bindirim\w*/, /\bsponsor\w*/, /\btanitim\w*/,
      /\bbayilik\w*/, /\bfranchise\b/, /\bilan\s+ver\w*/,
      /\buygulamamiz\w*/, /\buygulama\w*\s+indir\w*/, /\b(?:web\s?)?sitemiz\w*/,
      /\bkanalimiz\w*/, /\bgrubumuz\w*/, /\bgruba\s+katil\w*/,
      /\buye\s+ol\w*/, /\bkayit\s+ol\w*/, /\babone\s+ol\w*/, /\btakip\s+et\w*/,
      /\bucretsiz\s+(?:ilan|uye|kayit|uygulama|yuk|arac|nakliye)\w*/,
      /\bhizmet\w*\s+(?:veriyoruz|vermekteyiz|vermekteyim|veriyorum)/,
      /\bprofesyonel\s+(?:ekip|hizmet|tasima|nakliye)\w*/
    ]
  },
  {
    neden: 'sohbet', // net sohbet kalıpları (telefonsuz mesajlar zaten 'telefon_yok' ile elenir)
    desen: [/\b(?:nasilsin|nasilsiniz|naber|ne haber|gecmis olsun|allah razi|rabbim|amin|mubarek)\b/]
  }
];

// İlan sayılması için yük/araç dili (şehir adı da yeterli sayılır)
const YUK_SINYALI = /\b(?:yuk\w*|ton\w*|palet\w*|tir\w*|kamyon\w*|dorse\w*|nakliye\w*|tasima\w*|sevkiyat\w*|koli\w*|parca\w*|paket\w*|esya\w*|atv\b|makara\w*|yukleme\w*|\d+\s?(?:kg|m3|desi))\b/;

module.exports = { MARKALAR, KURALLAR, YUK_SINYALI };

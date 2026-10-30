'use strict';
/*
 * NAKLİYE CEPTE — WhatsApp grup dinleyici botu (v3.1)
 * WhatsApp gruplarındaki yük / boş araç ilanlarını ayrıştırır (parser.js) ve Supabase'e (bot_listings) yazar.
 * İsteğe bağlı: Telegram kanalına da gönderir.
 *
 * ORTAM DEĞİŞKENLERİ (host panelinden gir — şifreleri koda YAZMA):
 *   SUPABASE_URL                 Supabase proje adresi
 *   SUPABASE_SERVICE_ROLE_KEY    service_role anahtarı (anon KULLANMA)
 *   PHONE_NUMBER                 905xxxxxxxxx (eşleştirme kodu için; boşsa QR)
 *   PANEL_KEY                    /qr?key=... sayfasının şifresi
 *   AUTH_DIR                     kalıcı disk yolu (ör. /data/auth_info)
 *
 * OPSİYONEL:
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_KANAL_ID    (boşsa Telegram kapalı)
 *   SUPABASE_TABLO=bot_listings   SUPABASE_TELEFON_KOLONU=   (tabloda telefon kolonu varsa adı)
 *   ILAN_OMRU_SAAT=10   MUKERRER_SAAT=6   MAX_MESAJ_YASI_DK=45
 *   AYLIK_LIMIT_MB=900   TELEGRAM_KAPAT_YUZDE=90   TELEFON_LIMIT=0   TRAFIK_BASLANGIC_MB=0   (aylık trafik koruması)
 *   ENGELLI_GRUPLAR=grup adı parçası,...   BOS_ARAC_ILANLARINI_ATLA=false
 *   TEK_SEHIRLI_ILAN_KABUL=true   GONDERICI_NUMARASINI_KULLAN=false
 *   YABANCI_ILANLARI_ENGELLE=true   (Irak, Almanya, Erbil, KKTC... geçen ilanlar atılır)
 *   GONDERICI_ADINI_FIRMA_KULLAN=true   (mesajda firma adı yoksa WhatsApp profil adı kullanılır)
 *   VARSAYILAN_FIRMA=WhatsApp Lojistik Akışı   (hiçbir ad bulunamazsa)
 */
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ilanlariAyristir, ilanAnahtari, normalize, firmaTemizle } = require('./parser');

// ═══════════════ 1. AYARLAR ═══════════════
const env = process.env;
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|evet|yes|on)$/i.test(v));
const sayi = (v, d) => { const n = Number(v); return v === undefined || v === '' || !Number.isFinite(n) ? d : n; };

const CONFIG = {
  PORT: sayi(env.PORT, 8080),
  AUTH_DIR: env.AUTH_DIR || path.join(__dirname, 'auth_info'),
  PHONE_NUMBER: (env.PHONE_NUMBER || '').replace(/\D/g, ''),
  PANEL_KEY: env.PANEL_KEY || crypto.randomBytes(8).toString('hex'),
  PANEL_KEY_RASTGELE: !env.PANEL_KEY,

  SUPABASE_URL: env.SUPABASE_URL || '',
  SUPABASE_KEY: env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY || '',
  SUPABASE_TABLO: env.SUPABASE_TABLO || 'bot_listings',
  SUPABASE_TELEFON_KOLONU: env.SUPABASE_TELEFON_KOLONU || '',

  TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_KANAL_ID: env.TELEGRAM_KANAL_ID || '',

  ILAN_OMRU_SAAT: sayi(env.ILAN_OMRU_SAAT, 10),
  MUKERRER_SAAT: sayi(env.MUKERRER_SAAT, 6),
  MAX_MESAJ_YASI_DK: sayi(env.MAX_MESAJ_YASI_DK, 45),

  BOS_ARAC_ATLA: bool(env.BOS_ARAC_ILANLARINI_ATLA, false),
  TEK_SEHIRLI_KABUL: bool(env.TEK_SEHIRLI_ILAN_KABUL, true),
  GONDERICI_NO: bool(env.GONDERICI_NUMARASINI_KULLAN, false),
  RET_LOG: bool(env.RET_LOG, true),
  YABANCI_ENGELLE: bool(env.YABANCI_ILANLARI_ENGELLE, true),
  GONDERICI_ADI_FIRMA: bool(env.GONDERICI_ADINI_FIRMA_KULLAN, true),
  VARSAYILAN_FIRMA: env.VARSAYILAN_FIRMA || 'WhatsApp Lojistik Akışı',
  // Google Cloud ücretsiz dilim: aylık 1 GB giden trafik. Varsayılan bütçe 900 MB (pay bırakır)
  AYLIK_LIMIT_MB: sayi(env.AYLIK_LIMIT_MB, 900),
  TELEGRAM_KAPAT_YUZDE: sayi(env.TELEGRAM_KAPAT_YUZDE, 90),   // bütçenin %90'ında Telegram susar
  TELEFON_LIMIT: sayi(env.TELEFON_LIMIT, 0),                  // 0 = sınırsız (aynı telefondan MUKERRER_SAAT içinde en çok kaç ilan)
  TRAFIK_BASLANGIC_MB: sayi(env.TRAFIK_BASLANGIC_MB, 0),      // ilk kurulumda bu ay zaten harcanan (GCP konsolundan)
  TRAFIK_DOSYA: env.TRAFIK_DOSYA || path.join(env.AUTH_DIR ? path.dirname(env.AUTH_DIR) : __dirname, 'trafik.json'),
  ENGELLI_GRUPLAR: ['ilgin mot tas kopp', ...(env.ENGELLI_GRUPLAR || '').split(',')].map(normalize).filter(Boolean)
};

const durum = { baglanti: 'baslatiliyor', qr: null, kod: null, sonMesaj: 0, baslangic: Date.now() };
const ist = { mesaj: 0, eski: 0, ilan: 0, mukerrer: 0, sbKayit: 0, sbHata: 0, tgGonderilen: 0, tgHata: 0 };
const retSayac = {};
const bekle = (ms) => new Promise(r => setTimeout(r, ms));
const kisalt = (m, n) => (m && m.length > n ? m.slice(0, n - 1).trimEnd() + '…' : m || '');
const htmlKacis = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ═══════════════ 1b. AYLIK TRAFİK KORUMASI (Google Cloud 1 GB giden) ═══════════════
// VM'nin gerçek giden trafiği /proc/net/dev'den okunur (Google'ın saydığına en yakın değer), ay bazında dosyada tutulur.
const ayAnahtari = () => new Date().toISOString().slice(0, 7);
const trafik = { ay: ayAnahtari(), toplam: CONFIG.TRAFIK_BASLANGIC_MB * 1048576, son: null };
const butce = { telegramKapali: false, durdu: false };
function agTxBayt() {
  try {
    let top = 0;
    for (const s of fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2)) {
      const [ad, geri] = s.split(':'); if (!geri) continue;
      if (/^(lo|docker|veth|br-|virbr)/.test(ad.trim())) continue;
      top += Number(geri.trim().split(/\s+/)[8]) || 0;
    }
    return top;
  } catch { return null; }
}
try { Object.assign(trafik, JSON.parse(fs.readFileSync(CONFIG.TRAFIK_DOSYA, 'utf8'))); } catch { /* ilk çalışma */ }
const trafikMB = () => trafik.toplam / 1048576;
const trafikYuzde = () => Math.round(trafikMB() / CONFIG.AYLIK_LIMIT_MB * 100);
function trafikGuncelle() {
  const simdi = agTxBayt();
  if (simdi !== null) {
    if (trafik.son !== null) trafik.toplam += simdi >= trafik.son ? simdi - trafik.son : simdi; // sayaç düştüyse VM yeniden başlamıştır
    trafik.son = simdi;
  }
  if (trafik.ay !== ayAnahtari()) { trafik.ay = ayAnahtari(); trafik.toplam = 0; console.log('📅 Yeni ay: trafik sayacı sıfırlandı.'); }
  try { fs.writeFileSync(CONFIG.TRAFIK_DOSYA, JSON.stringify(trafik)); } catch { /* yazılamazsa sayaç bellekte devam eder */ }

  const y = trafikYuzde();
  const tgKapali = y >= CONFIG.TELEGRAM_KAPAT_YUZDE;
  if (tgKapali !== butce.telegramKapali) { butce.telegramKapali = tgKapali; console.log(tgKapali ? `🔕 Trafik %${y}: Telegram gönderimi durduruldu.` : '🔔 Telegram gönderimi yeniden açıldı.'); tgKuyruk.length = 0; }
  if (y >= 100 && !butce.durdu) {
    butce.durdu = true; durum.baglanti = 'durduruldu';
    console.warn(`⛔ Aylık trafik bütçesi doldu (${Math.round(trafikMB())} MB). WhatsApp dinleme ay başına kadar durduruldu.`);
    try { aktifSock?.ev.removeAllListeners('messages.upsert'); aktifSock?.end(undefined); } catch { /* zaten kapalı */ }
  } else if (y < 100 && butce.durdu) {
    butce.durdu = false; console.log('▶️ Yeni ay: WhatsApp dinleme yeniden başlıyor.'); yenidenPlanla(1000);
  }
}

// ═══════════════ 2. MÜKERRER KONTROLÜ ═══════════════
const gorulenIlanlar = new Map(); // anahtar → zaman

function mukerrerMi(i) {
  const simdi = Date.now();
  const sure = CONFIG.MUKERRER_SAAT * 3600 * 1000;
  const anahtarlar = [i.anahtar, i.anahtar2 ? 'g|' + i.anahtar2 : null].filter(Boolean);
  if (anahtarlar.some(k => { const t = gorulenIlanlar.get(k); return t && simdi - t < sure; })) return true;
  anahtarlar.forEach(k => gorulenIlanlar.set(k, simdi));
  return false;
}
// Aynı telefondan kısa sürede yağan ilanlar (spam / aynı yükü her gruba farklı yazma) kısıtlanır
const telefonSayac = new Map(); // telefon → [zaman, ...]
function telefonLimitAsildi(tel) {
  if (!CONFIG.TELEFON_LIMIT) return false;
  const simdi = Date.now(); const pencere = CONFIG.MUKERRER_SAAT * 3600 * 1000;
  const liste = (telefonSayac.get(tel) || []).filter(t => simdi - t < pencere);
  if (liste.length >= CONFIG.TELEFON_LIMIT) { telefonSayac.set(tel, liste); return true; }
  liste.push(simdi); telefonSayac.set(tel, liste); return false;
}

// ═══════════════ 3. SUPABASE (toplu kayıt kuyruğu) ═══════════════
let supabase = null;
function sb() {
  if (supabase) return supabase;
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY) return null;
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return supabase;
}

function sbSatiri(i) {
  const satir = {
    from_city: i.nereden,
    to_city: i.nereye,
    cargo_detail: i.tur === 'ARAC' ? `[BOŞ ARAÇ] ${i.detay}` : i.detay,
    vehicle_type: i.arac_tipi,
    company_name: i.firma || CONFIG.VARSAYILAN_FIRMA
  };
  if (CONFIG.SUPABASE_TELEFON_KOLONU) satir[CONFIG.SUPABASE_TELEFON_KOLONU] = i.telefon_ham;
  else satir.cargo_detail += ` — Tel: ${i.telefon}`; // ayrı kolon yoksa telefon detayda taşınır
  return satir;
}

const sbKuyruk = [];
let sbYaziyor = false;

async function sbBosalt() {
  if (sbYaziyor) return;
  const db = sb();
  if (!db) { sbKuyruk.length = 0; return; }
  sbYaziyor = true;
  try {
    while (sbKuyruk.length) {
      const grup = sbKuyruk.splice(0, 50);
      let basarili = false;
      for (let deneme = 1; deneme <= 3 && !basarili; deneme++) {
        try {
          const { error } = await db.from(CONFIG.SUPABASE_TABLO).insert(grup);
          if (!error) { basarili = true; ist.sbKayit += grup.length; console.log(`🚀 ${grup.length} ilan Supabase'e kaydedildi.`); break; }
          console.error(`❌ Supabase hatası (${deneme}/3): ${error.message}`);
          if (error.code && /^(42|23|PGRST)/.test(error.code)) break; // kalıcı hata (kolon yok, yetki...) → tekrar deneme
        } catch (err) {
          console.error(`❌ Supabase bağlantı hatası (${deneme}/3): ${err.message}`);
        }
        await bekle(1500 * deneme);
      }
      if (!basarili) ist.sbHata += grup.length;
    }
  } finally { sbYaziyor = false; }
}
function sbKuyrugaEkle(satir) {
  if (sbKuyruk.length > 1000) sbKuyruk.shift(); // bellek koruması
  sbKuyruk.push(satir);
  if (sbKuyruk.length >= 20) sbBosalt();
}

async function eskiIlanlariTemizle() {
  const db = sb();
  if (!db) return;
  try {
    const sinir = new Date(Date.now() - CONFIG.ILAN_OMRU_SAAT * 3600 * 1000).toISOString();
    const { count, error } = await db.from(CONFIG.SUPABASE_TABLO).delete({ count: 'exact' }).lt('created_at', sinir);
    if (error) console.error('⚠️ Temizlik hatası:', error.message);
    else if (count) console.log(`🧹 ${count} eski ilan silindi.`);
  } catch (err) { console.error('⚠️ Temizlik hatası:', err.message); }
}

// Yeniden başlatmada aynı ilanlar tekrar yazılmasın: son MUKERRER_SAAT saatteki kayıtları belleğe al
async function mukerrerOnbellekYukle() {
  const db = sb();
  if (!db) return;
  try {
    const sinir = new Date(Date.now() - CONFIG.MUKERRER_SAAT * 3600 * 1000).toISOString();
    const kolonlar = ['from_city', 'to_city', 'cargo_detail', 'vehicle_type', CONFIG.SUPABASE_TELEFON_KOLONU].filter(Boolean).join(',');
    const { data, error } = await db.from(CONFIG.SUPABASE_TABLO).select(kolonlar).gte('created_at', sinir).limit(5000);
    if (error) return console.warn('⚠️ Mükerrer önbelleği yüklenemedi:', error.message);
    let n = 0;
    for (const r of data || []) {
      let detay = r.cargo_detail || '';
      let ham = CONFIG.SUPABASE_TELEFON_KOLONU ? r[CONFIG.SUPABASE_TELEFON_KOLONU] : null;
      const m = detay.match(/ — Tel: ([\d ]{11,14})\s*$/);
      if (m) { ham = ham || m[1]; detay = detay.slice(0, m.index); }
      const tel = String(ham || '').replace(/\D/g, '');
      if (tel.length !== 11) continue;
      gorulenIlanlar.set(ilanAnahtari(detay, tel), Date.now()); n++;
    }
    console.log(`🗂️ Mükerrer önbelleği: ${n} kayıt yüklendi.`);
  } catch (err) { console.warn('⚠️ Mükerrer önbelleği hatası:', err.message); }
}

// ═══════════════ 4. TELEGRAM (isteğe bağlı) ═══════════════
const tgKuyruk = [];
let tgCalisiyor = false;
const hashtag = (yer) => {
  const il = String(yer || '').split(' / ')[0].replace(/[^\p{L}\p{N}]/gu, '');
  return il && il !== 'Belirtilmedi' ? `#${il}` : '';
};
// Kanal mesajı: başlık, firma, güzergâh, araç, detay, iletişim (telefon + WhatsApp bağlantısı), şehir etiketleri
function telegramMetni(i) {
  const e = htmlKacis;
  const bilinen = (y) => y && y !== 'Belirtilmedi';
  const rota = bilinen(i.nereden) && bilinen(i.nereye) ? `<b>${e(i.nereden)}</b> ➡️ <b>${e(i.nereye)}</b>`
    : bilinen(i.nereden) ? `<b>${e(i.nereden)}</b> çıkışlı`
    : bilinen(i.nereye) ? `<b>${e(i.nereye)}</b> varışlı`
    : 'Güzergâh ilan metninde';
  const wa = /^05\d{9}$/.test(i.telefon_ham || '') ? `https://wa.me/90${i.telefon_ham.slice(1)}` : '';
  const etiketler = [...new Set([hashtag(i.nereden), hashtag(i.nereye)].filter(Boolean))].join(' ');
  return [
    i.tur === 'ARAC' ? '🚛 <b>BOŞ ARAÇ</b>' : '📦 <b>YÜK İLANI</b>',
    i.firma ? `🏢 ${e(i.firma)}` : null,
    '',
    `📍 ${rota}`,
    i.arac_tipi && i.arac_tipi !== 'Belirtilmedi' ? `🚚 ${e(i.arac_tipi)}` : null,
    `📝 ${e(kisalt(i.detay, 300))}`,
    '',
    `📞 <b>${e(i.telefon)}</b>`,
    wa ? `💬 <a href="${wa}">WhatsApp ile yaz</a>` : null,
    etiketler || null
  ].filter(x => x !== null).join('\n');
}
function telegramaGonder(i) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_KANAL_ID || butce.telegramKapali) return;
  const metin = telegramMetni(i);
  if (tgKuyruk.length > 500) tgKuyruk.shift();
  tgKuyruk.push(metin);
  if (!tgCalisiyor) tgIsle();
}
async function tgIsle() {
  tgCalisiyor = true;
  while (tgKuyruk.length && !butce.telegramKapali) {
    const metin = tgKuyruk[0];
    try {
      const r = await fetch(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: CONFIG.TELEGRAM_KANAL_ID, text: metin, parse_mode: 'HTML', disable_web_page_preview: true })
      });
      if (r.status === 429) { const j = await r.json().catch(() => ({})); await bekle(((j.parameters && j.parameters.retry_after) || 5) * 1000 + 500); continue; }
      tgKuyruk.shift();
      if (r.ok) ist.tgGonderilen++; else { ist.tgHata++; console.error(`⚠️ Telegram ${r.status}`); }
    } catch (err) { tgKuyruk.shift(); ist.tgHata++; console.error('⚠️ Telegram hatası:', err.message); }
    await bekle(3100); // kanal limiti ≈ 20 mesaj/dk
  }
  tgCalisiyor = false;
}

// ═══════════════ 5. MESAJ İŞLEME ═══════════════
function mesajMetni(m) {
  let msg = m;
  for (let i = 0; i < 5 && msg; i++) {
    const ic = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg.viewOnceMessageV2?.message
      || msg.viewOnceMessageV2Extension?.message || msg.documentWithCaptionMessage?.message || msg.editedMessage?.message;
    if (!ic) break;
    msg = ic;
  }
  if (!msg) return '';
  return msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.videoMessage?.caption
    || msg.documentMessage?.caption || msg.protocolMessage?.editedMessage?.conversation
    || msg.protocolMessage?.editedMessage?.extendedTextMessage?.text || '';
}
const saniye = (ts) => (!ts ? 0 : typeof ts === 'number' ? ts : typeof ts.toNumber === 'function' ? ts.toNumber() : Number(ts) || 0);

// Engelli grup kontrolü: grup adı yalnızca ENGELLI_GRUPLAR doluysa ve ilk mesajda bir kez sorulur
const grupAdlari = new Map(); // jid → { ad, zaman }
const engelliJidler = new Set();
async function grupEngelliMi(sock, jid) {
  if (!CONFIG.ENGELLI_GRUPLAR.length || !jid.endsWith('@g.us')) return false;
  if (engelliJidler.has(jid)) return true;
  const k = grupAdlari.get(jid);
  if (k && Date.now() - k.zaman < 12 * 3600 * 1000) return false;
  try {
    const ad = normalize((await sock.groupMetadata(jid))?.subject);
    grupAdlari.set(jid, { zaman: Date.now() });
    if (ad && CONFIG.ENGELLI_GRUPLAR.some(e => ad.includes(e))) { engelliJidler.add(jid); return true; }
  } catch { grupAdlari.set(jid, { zaman: Date.now() - 11 * 3600 * 1000 }); } // ~1 saat sonra tekrar dene
  return false;
}

const islenenMesajlar = new Map();
async function mesajiIsle(sock, msg) {
  const jid = msg?.key?.remoteJid || '';
  if (!msg?.message || msg.key.fromMe || !(jid.endsWith('@g.us') || jid.endsWith('@newsletter'))) return;

  const kimlik = `${jid}:${msg.key.id}`;
  if (islenenMesajlar.has(kimlik)) return;
  islenenMesajlar.set(kimlik, Date.now());

  const ts = saniye(msg.messageTimestamp);
  if (ts && Date.now() / 1000 - ts > CONFIG.MAX_MESAJ_YASI_DK * 60) { ist.eski++; return; }

  const ham = mesajMetni(msg.message);
  if (!ham) return;
  if (await grupEngelliMi(sock, jid)) return;

  ist.mesaj++;
  durum.sonMesaj = Date.now();

  let gondericiTel = null;
  if (CONFIG.GONDERICI_NO && (msg.key.participant || '').endsWith('@s.whatsapp.net')) {
    const d = msg.key.participant.split('@')[0].split(':')[0];
    gondericiTel = /^90\d{10}$/.test(d) ? '0' + d.slice(2) : null;
  }

  const { ilanlar, ret, terim } = ilanlariAyristir(ham, { tekSehirKabul: CONFIG.TEK_SEHIRLI_KABUL, gondericiTelefon: gondericiTel, yabanciEngelle: CONFIG.YABANCI_ENGELLE });
  if (!ilanlar.length) {
    retSayac[ret] = (retSayac[ret] || 0) + 1;
    if (ret === 'yabanci' && CONFIG.RET_LOG) console.log(`🌍 [YABANCI:${terim}] ${kisalt(ham.replace(/\s+/g, ' '), 100)}`);
    if (CONFIG.RET_LOG && ret !== 'cok_kisa' && ret !== 'telefon_yok' && /\d{10}/.test(ham.replace(/\D+/g, ''))) {
      console.log(`🚫 [RET:${ret}] ${kisalt(ham.replace(/\s+/g, ' '), 140)}`);
    }
    return;
  }

  // Mesajda firma adı yoksa gönderenin WhatsApp profil adı (varsa) kullanılır
  const profilAdi = CONFIG.GONDERICI_ADI_FIRMA ? firmaTemizle(msg.pushName) : '';
  for (const i of ilanlar) {
    if (!i.firma && profilAdi) i.firma = profilAdi;
    if (i.tur === 'ARAC' && CONFIG.BOS_ARAC_ATLA) continue;
    if (mukerrerMi(i)) { ist.mukerrer++; continue; }
    if (telefonLimitAsildi(i.telefon_ham)) { retSayac.telefon_limit = (retSayac.telefon_limit || 0) + 1; continue; }
    ist.ilan++;
    console.log(`⚡ [${i.tur === 'ARAC' ? 'BOŞ ARAÇ' : 'İLAN'}] ${i.firma ? i.firma + ' | ' : ''}${i.nereden} ➡️ ${i.nereye} | ${i.arac_tipi} | ${i.telefon}`);
    sbKuyrugaEkle(sbSatiri(i));
    telegramaGonder(i);
  }
  setTimeout(sbBosalt, 2000); // küçük partiler en geç 2 sn sonra yazılır
}

// ═══════════════ 6. PANEL (QR / eşleştirme / sağlık) ═══════════════
const sureMetni = (ms) => { const dk = Math.floor(ms / 60000); return dk < 60 ? `${dk} dk` : `${Math.floor(dk / 60)} sa ${dk % 60} dk`; };
const anahtarDogru = (a, b) => {
  const h = (x) => crypto.createHash('sha256').update(String(x)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
};

function panelHtml() {
  const bagli = durum.baglanti === 'acik';
  const rozet = bagli ? '🟢 Bağlı' : durum.baglanti === 'baslatiliyor' ? '🟡 Başlatılıyor' : '🔴 Bağlantı yok';
  return `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>Nakliye Cepte Bot</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="5"><meta name="robots" content="noindex">
<style>body{display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f0f2f5;font-family:sans-serif}
.c{background:#fff;padding:28px;border-radius:16px;box-shadow:0 4px 12px rgba(0,0,0,.1);text-align:center;width:340px;max-width:90%}
img{width:250px;height:250px;border:4px solid #25d366;border-radius:12px;padding:10px}
.k{background:#111b21;color:#00a884;font:bold 28px monospace;letter-spacing:4px;padding:15px;border-radius:10px;margin:15px 0}
.s{font-size:12px;color:#888;line-height:1.8}</style></head><body><div class="c">
<h2>Nakliye Cepte Bot</h2><div>${rozet}</div>
${durum.kod ? `<p><b>📱 EŞLEŞTİRME KODU</b></p><div class="k">${htmlKacis(durum.kod)}</div><p>WhatsApp → Bağlı Cihazlar → Cihaz Bağla → Telefon Numarası İle Bağla</p>` : ''}
${durum.qr ? `<img src="${durum.qr}" alt="QR"><p>Kamera ile QR kodu okutun.</p>` : ''}
${bagli ? '<p>Bot bağlı, grupları dinliyor…</p>' : ''}
<p class="s">Açık kalma: ${sureMetni(Date.now() - durum.baslangic)} · Son mesaj: ${durum.sonMesaj ? sureMetni(Date.now() - durum.sonMesaj) + ' önce' : 'yok'}<br>
Mesaj: ${ist.mesaj} · İlan: ${ist.ilan} · Mükerrer: ${ist.mukerrer} · Yabancı engel: ${retSayac.yabanci || 0}<br>Supabase: ${ist.sbKayit} kayıt (${sbKuyruk.length} sırada, ${ist.sbHata} hata)<br>Bu ay giden trafik: ${Math.round(trafikMB())} / ${CONFIG.AYLIK_LIMIT_MB} MB (%${trafikYuzde()})${butce.telegramKapali ? ' · Telegram kapalı' : ''}${butce.durdu ? ' · DURDURULDU' : ''}</p>
</div></body></html>`;
}

function sunucuyuBaslat() {
  http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end(); }
    if (url.pathname === '/qr') {
      if (!anahtarDogru(url.searchParams.get('key') || '', CONFIG.PANEL_KEY)) {
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Yetkisiz. Adres: /qr?key=PANEL_KEY');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
      return res.end(panelHtml());
    }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ durum: durum.baglanti, sonMesajDkOnce: durum.sonMesaj ? Math.floor((Date.now() - durum.sonMesaj) / 60000) : null, sbKuyruk: sbKuyruk.length, trafikMB: Math.round(trafikMB()), trafikYuzde: trafikYuzde(), ...ist, ret: retSayac }));
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nakliye Cepte WhatsApp Botu aktif');
  }).listen(CONFIG.PORT, () => {
    console.log(`🌐 Sunucu ${CONFIG.PORT} portunda.`);
    if (CONFIG.PANEL_KEY_RASTGELE) console.log(`🔑 PANEL_KEY tanımsız; bu açılış için adres: /qr?key=${CONFIG.PANEL_KEY}`);
  });
}

// ═══════════════ 7. WHATSAPP BAĞLANTISI ═══════════════
let yenidenDeneme = 0;
let yenidenZamanlayici = null;
let aktifSock = null;
function yenidenPlanla(ms) {
  if (yenidenZamanlayici || butce.durdu) return;
  yenidenZamanlayici = setTimeout(() => { yenidenZamanlayici = null; baglan(); }, ms);
}

async function baglan() {
  if (butce.durdu) return;
  try {
    const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys');
    const QRCode = require('qrcode');
    let logger;
    try { logger = require('pino')({ level: 'warn' }); } catch {
      const s = { level: 'silent', child() { return s; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };
      logger = s;
    }

    const { state, saveCreds } = await useMultiFileAuthState(CONFIG.AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();
    durum.baglanti = 'baslatiliyor';

    const sock = makeWASocket({
      version, auth: state, logger,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,          // telefonda bildirimleri susturmasın
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      generateHighQualityLinkPreview: false,
      // Durum (status) ve özel sohbetler işlenmez: gereksiz çözme / yeniden deneme trafiği oluşmasın
      shouldIgnoreJid: (j) => j === 'status@broadcast' || /@(s\.whatsapp\.net|lid)$/.test(j)
    });
    aktifSock = sock;

    let eslestirmeIstendi = false;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
      if (qr) {
        try { durum.qr = await QRCode.toDataURL(qr); } catch (e) { console.error('⚠️ QR üretilemedi:', e.message); }
        if (!eslestirmeIstendi && !sock.authState.creds.registered && CONFIG.PHONE_NUMBER && CONFIG.PHONE_NUMBER !== '905XXXXXXXXX') {
          eslestirmeIstendi = true;
          try {
            const kod = await sock.requestPairingCode(CONFIG.PHONE_NUMBER);
            durum.kod = kod?.match(/.{1,4}/g)?.join('-') || kod;
            console.log(`\n👉 EŞLEŞTİRME KODUNUZ: ${durum.kod}\n`);
          } catch (e) { console.error('⚠️ Eşleştirme kodu üretilemedi:', e.message); }
        }
      }

      if (connection === 'open') {
        durum.baglanti = 'acik'; durum.qr = null; durum.kod = null; yenidenDeneme = 0;
        console.log('✅ BOT BAĞLANDI — ilanlar dinleniyor.');
      }

      if (connection === 'close') {
        durum.baglanti = 'kapali';
        try { sock.ev.removeAllListeners('messages.upsert'); sock.ev.removeAllListeners('creds.update'); sock.end(undefined); } catch { /* zaten kapalı */ }
        const kod = lastDisconnect?.error?.output?.statusCode;
        console.warn(`🔌 Bağlantı kapandı (kod: ${kod ?? 'bilinmiyor'}).`);
        if (kod === DisconnectReason.loggedOut) {
          console.warn('🚪 Oturum kapatılmış; kimlik siliniyor, yeni eşleştirme bekleniyor.');
          try { fs.rmSync(CONFIG.AUTH_DIR, { recursive: true, force: true }); } catch (e) { console.error('⚠️ Auth silinemedi:', e.message); }
          yenidenPlanla(2000);
        } else if (kod === DisconnectReason.connectionReplaced) {
          console.error('⚠️ Oturum başka yerde açıldı (iki kopya çalışıyor olabilir). 60 sn sonra tekrar denenecek.');
          yenidenPlanla(60000);
        } else if (kod === DisconnectReason.restartRequired) {
          yenidenPlanla(1000);
        } else {
          yenidenDeneme++;
          const g = Math.min(3000 * 2 ** Math.min(yenidenDeneme - 1, 5), 60000);
          console.log(`🔁 ${Math.round(g / 1000)} sn sonra yeniden bağlanılacak (deneme ${yenidenDeneme}).`);
          yenidenPlanla(g);
        }
      }
    });

    // Yalnızca canlı mesajlar ('notify'); geçmişten yüklenenler işlenmez
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' || !messages?.length) return;
      for (const m of messages) {
        try { await mesajiIsle(sock, m); } catch (e) { console.error('⚠️ Mesaj işleme hatası:', e); }
      }
    });
  } catch (err) {
    console.error('❌ Bağlantı başlatılamadı:', err.message);
    yenidenDeneme++;
    yenidenPlanla(Math.min(5000 * yenidenDeneme, 60000));
  }
}

// ═══════════════ 8. BAŞLAT ═══════════════
function bellekTemizle() {
  const simdi = Date.now();
  for (const [k, t] of islenenMesajlar) if (simdi - t > 30 * 60 * 1000) islenenMesajlar.delete(k);
  for (const [k, t] of gorulenIlanlar) if (simdi - t > CONFIG.MUKERRER_SAAT * 3600 * 1000) gorulenIlanlar.delete(k);
  for (const [k, l] of telefonSayac) if (!l.length || simdi - l[l.length - 1] > CONFIG.MUKERRER_SAAT * 3600 * 1000) telefonSayac.delete(k);
  for (const [k, v] of grupAdlari) if (simdi - v.zaman > 24 * 3600 * 1000) grupAdlari.delete(k);
}

function main() {
  process.on('uncaughtException', (e) => console.error('🔥 Beklenmeyen hata:', e));
  process.on('unhandledRejection', (e) => console.error('🔥 Yakalanamayan Promise hatası:', e));
  for (const s of ['SIGTERM', 'SIGINT']) {
    process.on(s, async () => {
      console.log(`🛑 ${s} alındı, kuyruk boşaltılıyor...`);
      await Promise.race([sbBosalt(), bekle(5000)]);
      process.exit(0);
    });
  }

  sunucuyuBaslat();
  const eksik = ['SUPABASE_URL', 'SUPABASE_KEY'].filter(k => !CONFIG[k]);
  if (eksik.length) console.warn(`⚠️ Tanımsız ayarlar: ${eksik.join(', ')} → veritabanı kaydı kapalı.`);
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_KANAL_ID) console.log('ℹ️ Telegram ayarı yok, Telegram gönderimi kapalı.');

  mukerrerOnbellekYukle();
  eskiIlanlariTemizle();
  setInterval(eskiIlanlariTemizle, 30 * 60 * 1000);
  setInterval(bellekTemizle, 10 * 60 * 1000);
  setInterval(() => sbBosalt(), 5000);
  trafikGuncelle();
  setInterval(trafikGuncelle, 60 * 1000);
  setInterval(() => {
    const mb = Math.round(process.memoryUsage().rss / 1048576);
    console.log(`📊 Saatlik özet → trafik: ${Math.round(trafikMB())}/${CONFIG.AYLIK_LIMIT_MB} MB, mesaj: ${ist.mesaj}, ilan: ${ist.ilan}, mükerrer: ${ist.mukerrer}, yabancı: ${retSayac.yabanci || 0}, supabase: ${ist.sbKayit} (hata ${ist.sbHata}), bellek: ${mb} MB | ret: ${JSON.stringify(retSayac)}`);
  }, 60 * 60 * 1000);

  baglan();
}

if (require.main === module) main();
module.exports = { CONFIG, sbSatiri, mukerrerMi, telegramMetni };

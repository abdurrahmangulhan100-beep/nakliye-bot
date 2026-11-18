'use strict';
/*
 * NAKLİYE BOT v4 — WhatsApp gruplarını dinler, ilanları süzer (filtre.js + kurallar.js), Supabase'e yazar.
 * Yasak eklemek için SADECE kurallar.js'yi düzenle. Ayarlar için .env.example'a bak.
 *
 * Log okuma (pm2 logs nakliye-bot):
 *   ✅ KABUL  → Supabase'e yazıldı          ⛔ RET [neden] → atıldı (neden + eşleşen terim + mesajın başı)
 *   📊 her 10 dk özet: kaç mesaj geldi, kaç ilan yazıldı, hangi nedenle kaç ret
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const { createClient } = require('@supabase/supabase-js');
const QRCode = require('qrcode');
const { karar } = require('./filtre');
const { normalize, telefonlariBul } = require('./metin');

// libsignal'in her oturum değişiminde bastığı dev "Closing session" bloklarını sustur
for (const f of ['info', 'warn']) {
  const orj = console[f].bind(console);
  console[f] = (...a) => { if (typeof a[0] === 'string' && /^(Closing|Removing|Opening|Migrating) .*session|^Session already/i.test(a[0])) return; orj(...a); };
}

const env = process.env;
const AYAR = {
  SB_URL: env.SUPABASE_URL || '',
  SB_KEY: env.SUPABASE_SERVICE_ROLE_KEY || '',
  TABLO: env.SUPABASE_TABLO || 'bot_listings',
  TEL_KOLON: env.SUPABASE_TELEFON_KOLONU || '',
  TELEFON: (env.PHONE_NUMBER || '').replace(/\D/g, ''),
  AUTH_DIR: env.AUTH_DIR || path.join(__dirname, 'auth_info'),
  OMUR_SAAT: Number(env.ILAN_OMRU_SAAT) || 24,
  MUKERRER_SAAT: Number(env.MUKERRER_SAAT) || 24,   // aynı ilan bu süre içinde tekrar gelirse Supabase'e gönderilmez
  MAX_YAS_DK: Number(env.MAX_MESAJ_YASI_DK) || 60,
  FIRMA: env.VARSAYILAN_FIRMA || 'WhatsApp Lojistik Akışı',
  ENGELLI_GRUPLAR: (env.ENGELLI_GRUPLAR || '').split(',').map(normalize).filter(Boolean)
};

const zaman = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(zaman(), ...a);
const bekle = (ms) => new Promise(r => setTimeout(r, ms));
const kisalt = (t, n) => { t = String(t).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

if (!AYAR.SB_URL || !AYAR.SB_KEY) { console.error('❌ SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY girilmeli.'); process.exit(1); }
const db = createClient(AYAR.SB_URL, AYAR.SB_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// ═══════════ İstatistik ═══════════
const ist = { mesaj: 0, eski: 0, kabul: 0, mukerrer: 0, yazilamadi: 0, profilTel: 0, telCozulemedi: 0 };
const retler = {};
function retKaydet(neden, terim, metin) {
  retler[neden] = (retler[neden] || 0) + 1;
  log(`⛔ RET [${neden}${terim ? ': ' + kisalt(terim, 30) : ''}] ${kisalt(metin, 90)}`);
}

// ═══════════ Mükerrer (aynı ilan MUKERRER_SAAT içinde tekrar gelirse atılır) ═══════════
// İki imza: (1) metnin özeti, (2) telefon+nereden+nereye+araç+tonaj. Biri eşleşirse ilan aynıdır (metin biraz değişse bile).
const gorulen = new Map();   // imza → zaman
const gorulenId = new Map(); // WhatsApp mesaj kimliği → zaman (aynı mesajın çift gelmesine karşı)
const PARCA_MS = (Number(env.PARCA_SANIYE) || 120) * 1000;
const parcalar = new Map();  // grup|gönderici → { metin, tur: 'ilan' | 'tel', z }  (ilan ve numarası ayrı mesaj atanlar için)
const ozet = (t) => crypto.createHash('sha1').update(normalize(t)).digest('hex');
const TONAJ = /(\d+(?: \d{3})?)\s?(ton|kg|palet|m3|desi)\w*/;
function anahtarlar(k) {
  const a = ['m:' + ozet(k.metin)];
  if (k.nereden !== 'Belirtilmedi' || k.nereye !== 'Belirtilmedi') {
    const t = normalize(k.metin).match(TONAJ);
    a.push(['r', (k.telefonlar || [])[0], k.nereden, k.nereye, k.arac, t ? t[1] + t[2] : ''].join('|'));
  }
  return a;
}
function mukerrerMi(k) {
  const simdi = Date.now(), pencere = AYAR.MUKERRER_SAAT * 3600e3, a = anahtarlar(k);
  if (a.some(x => simdi - (gorulen.get(x) || 0) < pencere)) return true;
  for (const x of a) gorulen.set(x, simdi);
  return false;
}
const unut = (k) => anahtarlar(k).forEach(x => gorulen.delete(x));

// Bot yeniden başlayınca bellek boşalır; son MUKERRER_SAAT içindeki ilanların imzaları Supabase'den bir kez yüklenir.
async function gecmisiYukle() {
  const sinir = new Date(Date.now() - AYAR.MUKERRER_SAAT * 3600e3).toISOString();
  let n = 0;
  for (let bas = 0; bas < 50000; bas += 1000) {
    const { data, error } = await db.from(AYAR.TABLO).select('from_city,to_city,vehicle_type,cargo_detail,created_at')
      .gte('created_at', sinir).order('created_at', { ascending: false }).range(bas, bas + 999);
    if (error) { log(`⚠️ Geçmiş imzalar yüklenemedi: ${error.message}`); return; }
    for (const r of data || []) {
      const metin = r.cargo_detail || '', z = Date.parse(r.created_at) || Date.now();
      for (const x of anahtarlar({ metin, telefonlar: telefonlariBul(metin), nereden: r.from_city, nereye: r.to_city, arac: r.vehicle_type })) gorulen.set(x, z);
      n++;
    }
    if (!data || data.length < 1000) break;
  }
  log(`🧠 Son ${AYAR.MUKERRER_SAAT} saatteki ${n} ilanın imzası yüklendi (yeniden başlatmada tekrar yazılmaz).`);
}

// ═══════════ Supabase ═══════════
function satir(k, firma) {
  const s = {
    from_city: k.nereden,
    to_city: k.nereye,
    cargo_detail: k.metin,               // link çıkarılmış, telefonu içeren temiz metin
    vehicle_type: k.arac,
    company_name: firma || AYAR.FIRMA
  };
  if (AYAR.TEL_KOLON) s[AYAR.TEL_KOLON] = k.telefonlar[0];
  return s;
}
async function kaydet(s) {
  for (let d = 1; d <= 3; d++) {
    const { error } = await db.from(AYAR.TABLO).insert(s);
    if (!error) return true;
    log(`❌ Supabase yazma hatası (${d}/3): ${error.message}`);
    await bekle(2000 * d);
  }
  return false;
}
async function eskileriSil() {
  const sinir = new Date(Date.now() - AYAR.OMUR_SAAT * 3600e3).toISOString();
  const { count, error } = await db.from(AYAR.TABLO).delete({ count: 'exact' }).lt('created_at', sinir);
  if (error) log(`❌ Eski ilan silme hatası: ${error.message}`);
  else if (count) log(`🧹 ${count} eski ilan silindi (>${AYAR.OMUR_SAAT} saat).`);
}

// ═══════════ Mesaj işleme ═══════════
const tsSaniye = (ts) => (ts && typeof ts === 'object' ? (ts.toNumber ? ts.toNumber() : Number(ts.low)) : Number(ts)) || 0;

function icerik(msg) {
  let c = msg;
  for (let i = 0; i < 3; i++) c = c.ephemeralMessage?.message || c.viewOnceMessage?.message || c.documentWithCaptionMessage?.message || c;
  const ext = c.extendedTextMessage;
  const medya = c.imageMessage || c.videoMessage || c.documentMessage;
  const ctx = ext?.contextInfo || medya?.contextInfo || {};
  return {
    metin: String(c.conversation || ext?.text || medya?.caption || '').trim(),
    yanit: !!ctx.quotedMessage,                       // başka mesaja cevap = sohbet
    etiket: (ctx.mentionedJid || []).length > 0       // birini etiketliyor = sohbet
  };
}

// İlan metninde numara yoksa mesajı yazanın WhatsApp numarası kullanılır (yalnız Türkiye cep numarası).
async function gondericiTel(sock, m) {
  const k = m.key || {};
  let j = [k.participantPn, k.participantAlt, k.participant].find(x => typeof x === 'string' && x.endsWith('@s.whatsapp.net'));
  if (!j && String(k.participant || '').endsWith('@lid')) {          // yeni WhatsApp: gönderici LID ile gelir, numaraya çevrilmeli
    try { j = await sock.signalRepository?.lidMapping?.getPNForLID?.(k.participant); } catch { /* çözülemedi */ }
  }
  const d = String(j || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  return /^905\d{9}$/.test(d) ? `0${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}` : null;
}

const grupAdlari = new Map();
async function grupEngelliMi(sock, jid) {
  if (!AYAR.ENGELLI_GRUPLAR.length) return false;
  let g = grupAdlari.get(jid);
  if (!g || Date.now() - g.z > 24 * 3600e3) {
    try { g = { ad: normalize((await sock.groupMetadata(jid)).subject), z: Date.now() }; }
    catch { g = { ad: '', z: Date.now() - 23 * 3600e3 }; } // hata olursa 1 saat sonra tekrar dene
    grupAdlari.set(jid, g);
  }
  return AYAR.ENGELLI_GRUPLAR.some(x => g.ad.includes(x));
}

async function mesajIsle(sock, m) {
  const jid = m.key?.remoteJid;
  if (!jid?.endsWith('@g.us') || m.key.fromMe || !m.message) return;       // yalnız grup mesajları
  if (m.key.id) { if (gorulenId.has(m.key.id)) return; gorulenId.set(m.key.id, Date.now()); }
  ist.mesaj++;

  const yasDk = (Date.now() / 1000 - tsSaniye(m.messageTimestamp)) / 60;
  if (yasDk > AYAR.MAX_YAS_DK) { ist.eski++; return; }

  const { metin, yanit, etiket } = icerik(m.message);
  if (!metin) return;                                                      // yazısız medya

  if (await grupEngelliMi(sock, jid)) return retKaydet('engelli_grup', '', metin);

  let k = karar(metin, { yanit, etiket });
  if (!k.ok && k.neden === 'telefon_yok' && k.aday) {   // numara yazılmamış ama ilana benziyor → göndericinin numarası
    const tel = await gondericiTel(sock, m);
    if (tel) {
      const k2 = karar(metin + '\n📞 ' + tel, { yanit, etiket });
      if (k2.ok) { k = k2; ist.profilTel++; }
    } else ist.telCozulemedi++;
  }
  if (!k.ok) {
    // İlan metni ile numarası AYRI mesajlarda geldiyse (aynı kişiden, kısa sürede) birleştirilir
    const tur = k.aday ? 'ilan' : k.sadeceTel ? 'tel' : null;
    if (tur) {
      const pk = jid + '|' + (m.key.participant || ''), p = parcalar.get(pk);
      if (p && p.tur !== tur && Date.now() - p.z < PARCA_MS) {
        parcalar.delete(pk);
        const birlesik = tur === 'tel' ? p.metin + '\n' + metin : metin + '\n' + p.metin;
        const k2 = karar(birlesik, { yanit, etiket });
        if (k2.ok) { k = k2; log('🔗 ilan + numara ayrı mesajdı, birleştirildi'); }
      } else parcalar.set(pk, { metin, tur, z: Date.now() });
    }
    if (!k.ok) return retKaydet(k.neden, k.terim, metin);
  }
  if (mukerrerMi(k)) { ist.mukerrer++; return; }   // sessiz: sayı 📊 özetinde

  if (await kaydet(satir(k, m.pushName))) {
    ist.kabul++;
    log(`✅ KABUL ${k.nereden} → ${k.nereye} | ${k.arac} | ${k.telefonlar[0]}${k.linkSayisi ? ' | link silindi' : ''}`);
  } else {
    ist.yazilamadi++;
    unut(k);   // yazılamadıysa tekrar gelirse yeniden denensin
    log(`❌ İLAN KAYBEDİLDİ (Supabase 3 denemede yazamadı): ${kisalt(k.metin, 90)}`);
  }
}

// ═══════════ WhatsApp bağlantısı ═══════════
let yenidenDeneme = 0, zamanlayici = null;
function yenidenPlanla(ms) {
  clearTimeout(zamanlayici);
  zamanlayici = setTimeout(() => baslat().catch(hataYakala), ms);
}
function hataYakala(e) { log('❌ Başlatma hatası:', e?.message || e); yenidenDeneme++; yenidenPlanla(Math.min(5000 * yenidenDeneme, 60000)); }

async function baslat() {
  const B = await import('@whiskeysockets/baileys');
  const K = B.makeWASocket ? B : (B.default && B.default.makeWASocket ? B.default : B);
  const make = K.makeWASocket || (typeof B.default === 'function' ? B.default : K.default);
  const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, Browsers } = K;

  let logger;
  try { logger = require('pino')({ level: 'fatal' }); } catch {
    const s = { level: 'silent', child() { return s; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };
    logger = s;
  }

  const { state, saveCreds } = await useMultiFileAuthState(AYAR.AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  const sock = make({
    version, auth: state, logger,
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    generateHighQualityLinkPreview: false,
    shouldIgnoreJid: (j) => !String(j).endsWith('@g.us')   // özel mesaj / durum (status) işlenmesin
  });

  let kodIstendi = false;
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
    if (qr && !sock.authState.creds.registered) {
      if (AYAR.TELEFON && !kodIstendi) {
        kodIstendi = true;
        try {
          const kod = await sock.requestPairingCode(AYAR.TELEFON);
          log(`👉 EŞLEŞTİRME KODU: ${kod?.match(/.{1,4}/g)?.join('-') || kod}  (WhatsApp > Bağlı cihazlar > Telefon numarasıyla bağla)`);
        } catch (e) { log('⚠️ Eşleştirme kodu alınamadı:', e.message); }
      } else if (!AYAR.TELEFON) {
        console.log(await QRCode.toString(qr, { type: 'terminal', small: true }));
      }
    }
    if (connection === 'open') { yenidenDeneme = 0; log('✅ WhatsApp bağlandı, ilanlar dinleniyor.'); }
    if (connection === 'close') {
      try { sock.ev.removeAllListeners('messages.upsert'); sock.end(undefined); } catch { /* zaten kapalı */ }
      const kod = lastDisconnect?.error?.output?.statusCode;
      log(`🔌 Bağlantı kapandı (kod: ${kod ?? '?'})`);
      if (kod === DisconnectReason.loggedOut) {
        log('🚪 Oturum kapatılmış; kimlik silinip yeni eşleştirme beklenecek.');
        try { fs.rmSync(AYAR.AUTH_DIR, { recursive: true, force: true }); } catch { /* yok say */ }
        yenidenPlanla(2000);
      } else if (kod === DisconnectReason.connectionReplaced) {
        log('⚠️ Oturum başka yerde açıldı (iki kopya çalışıyor olabilir). 60 sn sonra tekrar.');
        yenidenPlanla(60000);
      } else {
        yenidenDeneme++;
        yenidenPlanla(kod === DisconnectReason.restartRequired ? 1000 : Math.min(3000 * 2 ** Math.min(yenidenDeneme - 1, 5), 60000));
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;                  // geçmişten yüklenenler işlenmez
    for (const m of messages || []) {
      try { await mesajIsle(sock, m); } catch (e) { log('⚠️ Mesaj işleme hatası:', e.message); }
    }
  });
}

// ═══════════ Başlat ═══════════
setInterval(() => {   // 10 dk'da bir özet + bellek temizliği
  const simdi = Date.now();
  for (const [k, t] of gorulen) if (simdi - t > AYAR.MUKERRER_SAAT * 3600e3) gorulen.delete(k);
  for (const [k, t] of gorulenId) if (simdi - t > 3600e3) gorulenId.delete(k);
  for (const [k, p] of parcalar) if (simdi - p.z > PARCA_MS) parcalar.delete(k);
  log(`📊 mesaj:${ist.mesaj} eski:${ist.eski} kabul:${ist.kabul} mükerrer:${ist.mukerrer} yazılamadı:${ist.yazilamadi} profilNo:${ist.profilTel} noÇözülemedi:${ist.telCozulemedi} | ret: ${JSON.stringify(retler)}`);
}, 10 * 60e3).unref();
setInterval(() => eskileriSil().catch(() => {}), 30 * 60e3).unref();
process.on('unhandledRejection', (e) => log('⚠️ unhandledRejection:', e?.message || e));
process.on('uncaughtException', (e) => log('⚠️ uncaughtException:', e?.message || e));

log('🚀 Nakliye Bot v4 başlıyor…');
eskileriSil().catch(() => {});
gecmisiYukle().catch(e => log('⚠️ gecmisiYukle:', e.message)).then(() => baslat().catch(hataYakala));

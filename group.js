/* הבנות: קבוצה עם קוד משותף – צ׳אט, מיקום חי ומקומות משותפים.
   ההודעות עוברות דרך ntfy.sh כשהן מוצפנות בטלפון (AES-GCM) עם מפתח שנגזר מהקוד, כך שהשרת רואה רק ג׳יבריש. */
(() => {
  const A = window.APP, $ = s => document.querySelector(s), esc = A.esc;
  const BASE = 'https://ntfy.sh/', GK = 'lisboa.group';
  const te = new TextEncoder(), td = new TextDecoder();
  const blank = () => ({ code: '', name: '', id: Math.random().toString(36).slice(2, 10), share: false, msgs: [], members: {}, favs: {}, last: '' });
  let G = blank();
  try { G = { ...G, ...JSON.parse(localStorage.getItem(GK) || '{}') }; } catch {}
  if (!Array.isArray(G.msgs)) G.msgs = [];
  for (const m of G.msgs) if (m && m.pending) { delete m.pending; m.fail = 1; }   // האפליקציה נסגרה באמצע שליחה: ההודעה מחכה לניסיון חוזר
  const CAP = 800;   // כמה הודעות נשמרות בטלפון
  // אם האחסון מלא, מוותרים על ההודעות הישנות ביותר ומנסים שוב
  const save = () => { if (window.__tripSwitch) return; if (G.msgs.length > CAP) G.msgs.splice(0, G.msgs.length - CAP);
    for (let i = 0; i < 8; i++) try { localStorage.setItem(GK, JSON.stringify(G)); return; }
      catch (e) { if (!e || !(e.code === 22 || e.code === 1014 || /quota/i.test(e.name + ' ' + e.message)) || G.msgs.length < 10) return; G.msgs.splice(0, Math.ceil(G.msgs.length / 4)); } };
  let key = null, topic = '', ntopic = '', es = null, retry = null, unread = 0, online = false;

  // ───── הצפנה ─────
  const norm = c => c.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const b64 = u8 => { let s = ''; u8.forEach(b => s += String.fromCharCode(b)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function derive(code) {
    const c = norm(code);
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode('lisboa-topic:' + c)));
    topic = 'ath' + [...h.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
    const h2 = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode('lisboa-notify:' + c)));
    ntopic = 'athn' + [...h2.slice(0, 10)].map(b => b.toString(16).padStart(2, '0')).join('');
    const km = await crypto.subtle.importKey('raw', te.encode(c), 'PBKDF2', false, ['deriveKey']);
    key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: te.encode('lisboa-group-v1'), iterations: 100000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function enc(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj))));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return b64(out);
  }
  async function dec(s) { const raw = unb64(s); return JSON.parse(td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12)))); }

  // ───── רשת ─────
  // ההודעות עוברות דרך השרת שלנו (חדר לכל קבוצה). בינתיים הן נשלחות גם לשרת הציבורי, כדי שטלפונים עם גרסה ישנה ימשיכו לקבל,
  // וכגיבוי אם אחד מהם לא זמין. לכל הודעה יש מזהה u, כך שמי שמקבל אותה משני המקורות מציג אותה פעם אחת.
  const OWN = PUSH_URL ? PUSH_URL + '/r/' : '';
  const uid = () => Math.random().toString(36).slice(2, 10);
  async function post(body, own) {
    const one = url => fetch(url, { method: 'POST', body }).then(r => r.ok, () => false);
    if (own) return OWN ? one(OWN + topic) : false;   // הודעה חולפת: רק לשרת שלנו
    const res = await Promise.all([OWN ? one(OWN + topic) : false, one(BASE + topic)]);
    return res[0] || res[1];
  }
  async function send(obj, o = {}) {   // o.own: רק לשרת שלנו ובלי מזהה (לא נשמרת אצל אף אחד) · o.quiet: בלי הודעת שגיאה
    if (!key || (o.own && !OWN)) return false;
    let ok = false; try { ok = await post(await enc({ ...obj, ...(o.own ? {} : { u: uid() }), n: G.name, d: G.id, ts: Date.now() }), o.own); } catch {}
    if (!ok && obj.t === 'chat' && !o.quiet) A.toast('אין חיבור – ההודעה לא נשלחה');
    return ok;
  }
  // חיבור חי: WebSocket (מיידי), ואם הוא לא נפתח – SSE
  let ws = null, wsFails = 0;
  function onRaw(data, own) {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.event !== 'message' || !m.message) return;
    if (own) G.last2 = m.id; else G.last = m.id;
    dec(m.message).then(p => {
      if (p && p.t === 'typ') return typIn(p);   // "מקלידה…": לא נשמר ולא נספר
      if (p && p.u) { const seen = G.seen ||= []; if (seen.includes(p.u)) return; seen.push(p.u); if (seen.length > 600) seen.splice(0, 200); }
      handle(p, m.id, m.attachment && m.attachment.url);
    }).catch(() => {});   // הודעה שלא נפתחת עם המפתח שלנו – מתעלמים
  }
  const live1 = () => (ws && ws.readyState === 1) || (es && es.readyState === 1), live2 = () => !!ws2 && ws2.readyState === 1;
  const live = () => live1() || live2();
  const upd = () => { const was = online; online = live(); status(); if (online && !was) setTimeout(retryAll, 2500); };
  // החיבור לשרת שלנו
  let ws2 = null, retry2 = null, fails2 = 0, ping2 = null;
  function connectOwn() {
    clearTimeout(retry2); clearInterval(ping2); if (ws2) { ws2.onclose = null; try { ws2.close(); } catch {} ws2 = null; }
    if (!key || !OWN || !('WebSocket' in window)) return;
    try { ws2 = new WebSocket(OWN.replace(/^http/, 'ws') + topic + '/ws?since=' + encodeURIComponent(G.last2 || 0)); } catch { return; }
    ws2.onopen = () => { fails2 = 0; upd(); ping2 = setInterval(() => { try { ws2.send('ping'); } catch {} }, 25000); };
    ws2.onmessage = ev => { if (ev.data !== 'pong') onRaw(ev.data, true); };
    ws2.onclose = () => { clearInterval(ping2); upd(); retry2 = setTimeout(connectOwn, Math.min(15000, 1500 * ++fails2)); };
  }
  function connect() {
    clearTimeout(retry); if (es) { es.close(); es = null; } if (ws) { ws.onclose = null; try { ws.close(); } catch {} ws = null; }
    connectOwn();
    if (!key) return;
    const since = encodeURIComponent(G.last || '12h');
    if (wsFails < 2 && 'WebSocket' in window) {
      let opened = false;
      try { ws = new WebSocket('wss://ntfy.sh/' + topic + '/ws?since=' + since); } catch { wsFails = 2; return connect(); }
      ws.onopen = () => { opened = true; wsFails = 0; upd(); };
      ws.onmessage = ev => onRaw(ev.data);
      ws.onclose = () => { upd(); if (!opened) wsFails++; retry = setTimeout(connect, opened ? 1500 : 400); };
      return;
    }
    es = new EventSource(BASE + topic + '/sse?since=' + since);
    es.onopen = upd;
    es.onmessage = ev => onRaw(ev.data);
    es.onerror = () => { es.close(); upd(); retry = setTimeout(connect, 4000); };
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && key && !(live1() && (live2() || !OWN))) connect(); });
  addEventListener('online', () => { if (key) { connect(); setTimeout(retryAll, 3000); } });

  // צליל קצר להודעה נכנסת
  let actx = null;
  function beep() { try { actx ||= new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), v = actx.createGain();
    o.frequency.value = 880; v.gain.setValueAtTime(.12, actx.currentTime); v.gain.exponentialRampToValueAtTime(.001, actx.currentTime + .25);
    o.connect(v).connect(actx.destination); o.start(); o.stop(actx.currentTime + .25); navigator.vibrate?.(80); } catch {} }

  // ───── יומן משותף: התמונה מוצפנת בטלפון ועולה כקובץ מצורף ─────
  async function encBytes(buf) { const iv = crypto.getRandomValues(new Uint8Array(12)), ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buf));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out; }
  async function decBytes(buf) { const raw = new Uint8Array(buf); return crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12)); }
  const served = {}, asked = {};
  // קבצים גדולים (מעל 14 מ״ב ועד 95 מ״ב) עולים מוצפנים לאחסון שלנו ונשמרים שם 30 יום, במקום לשרת ההודעות שמקבל רק קבצים קטנים
  const SMALL = 14e6, BIG = PUSH_URL ? 95e6 : SMALL;   // SMALL: מה שהשרת הציבורי מסוגל לקבל, כגיבוי
  const bigUrl = id => PUSH_URL + '/f/' + ntopic + '/' + String(id).toLowerCase().replace(/[^a-z0-9]/g, '');
  async function bigUp(id, blob) { try { return (await fetch(bigUrl(id), { method: 'PUT', body: await encBytes(await blob.arrayBuffer()) })).ok; } catch { return false; } }
  A.hooks.shareMax = () => (key ? BIG : 0);
  async function shareEntry(e, withImage) {
    if (!key) return false;
    try {
      const meta = { id: e.id, ts: e.ts, type: e.type, text: e.text, place: e.place, tags: e.tags, w: e.w, h: e.h, ...(e.place === '@' ? { lat: e.lat, lng: e.lng } : {}), ...(e.type === 'video' ? { mime: e.mime, size: e.size, dur: e.dur } : {}) };
      const media = (e.type === 'photo' || e.type === 'video') && e.blob;
      const small = !media ? null : e.type === 'video' ? e.blob : await A.journal.shrink(e.blob, 1280);   // סרטון נשלח כמו שהוא
      const heavy = media && small.size > SMALL;
      if (heavy && small.size > BIG) return false;
      if (media && withImage && OWN) {   // קודם לאחסון שלנו
        if (heavy) A.toast('מעלה את הסרטון לקבוצה… לא לסגור את האפליקציה', 60000);
        if (await bigUp(e.id, small)) { e.r = 1; A.journal.put(e).catch(() => {}); if (heavy) A.toast('הסרטון עלה לקבוצה'); }
        else if (heavy) { A.toast('העלאת הסרטון נכשלה. לנסות שוב כשיש קליטה טובה', 5000); return false; }
      }
      if (e.r) meta.r = 1;
      const payload = await enc({ t: 'j', e: meta, u: uid(), n: G.name, d: G.id, ts: Date.now() });
      let ok;
      if (media && withImage && !e.r) ok = (await fetch(BASE + topic + '?filename=p.bin&message=' + encodeURIComponent(payload), { method: 'POST', body: await encBytes(await small.arrayBuffer()) })).ok;   // גיבוי: השרת הציבורי
      else ok = await post(payload);
      if (ok) served[e.id] = Date.now();
      return ok;
    } catch { return false; }
  }
  A.hooks.inGroup = () => !!key;
  A.hooks.shareEntry = shareEntry;
  A.hooks.unshareEntry = id => send({ t: 'jdel', id });
  async function journalIn(p, url) {
    const J = A.journal; if (!J || p.d === G.id || !p.e || !p.e.id) return;
    let e = await J.get(p.e.id).catch(() => null); const isNew = !e;
    if (e && !e.byId) return;                                    // רשומה שלי – לא דורסים
    e = e ? { ...e, text: p.e.text, place: p.e.place, tags: p.e.tags || [], ...(p.e.place === '@' ? { lat: p.e.lat, lng: p.e.lng } : {}) } : { ...p.e, tags: p.e.tags || [], shared: true, by: p.n, byId: p.d };
    const isMedia = e.type === 'photo' || e.type === 'video';
    if (isMedia && !e.blob && !url && e.r && PUSH_URL) url = bigUrl(e.id);
    if (isMedia && !e.blob && url) try { e.blob = new Blob([await decBytes(await (await fetch(url)).arrayBuffer())], { type: e.type === 'video' ? e.mime || 'video/mp4' : 'image/jpeg' }); served[e.id] = Date.now();
      if (e.type === 'video') { const p = await J.poster(e.blob); if (p) { e.poster = p.blob; e.w = p.w; e.h = p.h; e.dur = e.dur || p.dur; } } } catch {}
    await J.put(e).catch(() => {}); J.render();
    if (isMedia && !e.blob && !(Date.now() - (asked[e.id] || 0) < 10 * 60e3)) { asked[e.id] = Date.now(); send({ t: 'jreq', id: e.id }); }  // הקובץ פג תוקף – מבקשים ממי שיש לה
    if (isNew && Date.now() - p.ts < 10 * 60e3 && $('#v-journal').hidden) A.toast(`${e.type === 'photo' ? 'תמונה חדשה' : e.type === 'video' ? 'סרטון חדש' : 'רשומה חדשה'} ביומן מאת ${p.n}`, 4000);
  }
  async function journalReq(p) {   // מישהי חסרה תמונה: מי שמחזיקה אותה מעלה שוב, אחרי השהיה אקראית כדי שרק אחת תענה
    const J = A.journal; if (!J || p.d === G.id) return;
    const e = await J.get(p.id).catch(() => null); if (!e || !e.blob || !e.shared) return;
    const t0 = Date.now(); await new Promise(r => setTimeout(r, (e.byId ? 2500 : 300) + Math.random() * 3000));
    if ((served[e.id] || 0) >= t0) return;
    served[e.id] = Date.now();
    const small0 = e.type === 'video' ? e.blob : await J.shrink(e.blob, 1280);
    const r2 = !!OWN && small0.size <= BIG && await bigUp(e.id, small0);   // מעלים שוב לאחסון שלנו (נשמר 30 יום)
    const payload = await enc({ t: 'j', e: { id: e.id, ts: e.ts, type: e.type, text: e.text, place: e.place, tags: e.tags, w: e.w, h: e.h, ...(e.type === 'video' ? { mime: e.mime, size: e.size, dur: e.dur } : {}), ...(r2 ? { r: 1 } : {}) }, u: uid(), n: e.by || G.name, d: e.byId || G.id, ts: Date.now() });
    if (r2) { post(payload); return; }
    if (small0.size > SMALL) return;
    try { const small = e.type === 'video' ? e.blob : await J.shrink(e.blob, 1280); await fetch(BASE + topic + '?filename=p.bin&message=' + encodeURIComponent(payload), { method: 'POST', body: await encBytes(await small.arrayBuffer()) }); } catch {}
  }

  // ───── קבצים בצ׳אט: תמונות ומסמכים עוברים מוצפנים כקובץ מצורף ונשמרים בטלפון ─────
  const fdb = new Promise((res, rej) => { const q = indexedDB.open('lisboa-chat', 1); q.onupgradeneeded = () => q.result.createObjectStore('files'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  const fOp = async (mode, fn) => { const db = await fdb; return new Promise((res, rej) => { const t = db.transaction('files', mode), rq = fn(t.objectStore('files')); t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error); }); };
  const fGet = id => fOp('readonly', s => s.get(id)).catch(() => null), fPut = (id, v) => fOp('readwrite', s => s.put(v, id));
  const fUrl = {}, fState = {};   // fState: loading | missing
  const kb = n => n > 1e6 ? (n / 1e6).toFixed(1) + ' מ״ב' : Math.max(1, Math.round(n / 1e3)) + ' ק״ב';
  const okF = f => f && typeof f.id === 'string' && /^[a-z0-9]{6,12}$/.test(f.id) ? { id: f.id, name: String(f.name || 'קובץ').slice(0, 80), type: String(f.type || '').slice(0, 60), size: +f.size || 0, img: !!f.img, vid: !!f.vid, ...(f.r ? { r: 1 } : {}), ...(f.aud ? { aud: 1, dur: Math.min(3600, Math.max(0, Math.round(+f.dur || 0))) } : {}) } : null;
  async function postFile(obj, bytes) { try { return (await fetch(BASE + topic + '?filename=p.bin&message=' + encodeURIComponent(await enc({ ...obj, n: G.name, d: G.id, ts: Date.now() })), { method: 'POST', body: await encBytes(bytes) })).ok; } catch { return false; } }
  async function fetchFile(f, url) {   // מורידה, מפענחת ושומרת. אם הקובץ כבר נמחק מהשרת – מסמנת שחסר
    fState[f.id] = 'loading';
    try { const blob = new Blob([await decBytes(await (await fetch(url)).arrayBuffer())], { type: f.img ? 'image/jpeg' : f.type || 'application/octet-stream' });
      await fPut(f.id, { blob, name: f.name, type: blob.type }); fUrl[f.id] = URL.createObjectURL(blob); delete fState[f.id]; }
    catch { fState[f.id] = 'missing'; }
    render();
  }
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  // כל קובץ עטוף בצומת עם data-h (הקובץ ומצבו): כל עוד הוא לא משתנה, התמונה או הנגן לא נוצרים מחדש
  function fileView(m) {
    const f = m.f; if (!f) return ''; const u = fUrl[f.id], ic = f.img ? '🖼️' : f.vid ? '🎬' : f.aud ? '🎤' : '📄';
    const wrap = (h, st) => `<div class="mmedia" data-k="f" data-h="${f.id}:${st}">${h}</div>`;
    if (u && f.aud) return wrap(`<div class="caud"><button type="button" class="au-b" data-au aria-label="השמעה">${SV.play}</button><span class="au-bar" data-seek><i></i></span><small class="au-t" translate="no">${mmss(f.dur || 0)}</small><audio src="${u}" preload="metadata" data-dur="${f.dur || 0}"></audio></div>`, 'u');
    if (u && f.vid) return wrap(`<video class="cvid" src="${u}" controls playsinline preload="metadata"></video><button type="button" class="clink" data-file="${f.id}">שמירה או שיתוף · ${kb(f.size)}</button>`, 'u');
    if (u) return wrap(f.img ? `<img class="cimg" src="${u}" alt="" data-file="${f.id}">` : `<button type="button" class="cdoc" data-file="${f.id}">${ic} <span translate="no">${esc(f.name)}</span><small>${kb(f.size)}</small></button>`, 'u');
    if (fState[f.id] === 'missing') return wrap(`<button type="button" class="cdoc" data-freq="${f.id}">${ic} <span translate="no">${esc(f.name)}</span><small>כבר לא בשרת · ללחוץ כדי לבקש שוב</small></button>`, 'x');
    if (!fState[f.id]) { fState[f.id] = 'loading'; fGet(f.id).then(v => { if (v) { fUrl[f.id] = URL.createObjectURL(v.blob); delete fState[f.id]; } else fState[f.id] = 'missing'; render(); }); }
    return wrap(`<span class="cdoc wait">${ic} טוען…</span>`, 'w');
  }
  const findF = id => { const m = G.msgs.find(x => x.f && x.f.id === id); return m && m.f; };

  // ───── אישורי מסירה וקריאה: וי אחד = נשלחה, שני וי = הגיעה לכולן, שני וי כחולים = כולן קראו ─────
  // כל טלפון שמקבל הודעה שולח אישור קצר (מקובץ, כדי לא להציף את השרת)
  const ackQ = { dl: new Set(), rd: new Set() }; let ackT = null;
  const chatOpen = () => !$('#v-chat').hidden && !document.hidden;
  function queueAck(c, read) { if (!c) return; ackQ.dl.add(c); if (read) ackQ.rd.add(c); clearTimeout(ackT); ackT = setTimeout(flushAck, read ? 1500 : 6000); }
  function flushAck() { if (!key || !ackQ.dl.size) return; const dl = [...ackQ.dl].slice(-60), rd = [...ackQ.rd].slice(-60); ackQ.dl.clear(); ackQ.rd.clear(); send({ t: 'ack', dl, rd }); }
  function ackRead() { let any = false; for (const m of G.msgs) if (m.ur) { delete m.ur; queueAck(m.c, true); any = true; } if (any) save(); }
  document.addEventListener('visibilitychange', () => { if (chatOpen()) ackRead(); });
  const audience = () => Object.keys(G.members).filter(id => id !== G.id && Date.now() - (G.members[id].seen || 0) < 48 * 3600e3);   // מי שפעילה ביומיים האחרונים
  const SVA = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const SV = { t1: `<svg class="tk" viewBox="0 0 18 12" width="16" height="11" ${SVA}><path d="M4 6.500l3.500 3.500 7-8"/></svg>`,
    t2: c => `<svg class="tk ${c}" viewBox="0 0 18 12" width="16" height="11" ${SVA}><path d="M1 6.500l3.500 3.500 7-8M8.500 9l1 1 7-8"/></svg>`,
    wait: `<svg class="tk" viewBox="0 0 24 24" width="12" height="12" ${SVA}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
    play: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M8 5.500v13a1 1 0 0 0 1.500.850l10.500-6.500a1 1 0 0 0 0-1.700L9.500 4.650A1 1 0 0 0 8 5.500z"/></svg>`,
    pause: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><rect x="6.500" y="5" width="4" height="14" rx="1"/><rect x="13.500" y="5" width="4" height="14" rx="1"/></svg>` };
  function ticks(m) {
    if (m.pending) return SV.wait;
    const who = audience(), all = k => who.length > 0 && who.every(id => m[k] && m[k][id]);
    return all('rd') ? SV.t2('rd') : all('dv') ? SV.t2('') : SV.t1;
  }

  // ───── תגובות (אימוג׳י), עריכה, ציטוט ─────
  const RX = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
  const okRp = r => r && typeof r.c === 'string' && /^[a-z0-9]{6,12}$/.test(r.c) ? { c: r.c, n: String(r.n || '').slice(0, 40), x: String(r.x || '').slice(0, 120) } : null;
  const flbl = f => f.aud ? T('🎤 הודעה קולית') : f.img ? T('📷 תמונה') : f.vid ? T('🎬 סרטון') : '📎 ' + f.name;
  const prev = m => m.del ? T('🚫 ההודעה נמחקה') : (m.f ? flbl(m.f) + (m.x ? ' ' : '') : '') + (m.x || '');
  const gone = m => { m.del = 1; m.x = ''; for (const k of ['f', 'rp', 're', 'lat', 'lng', 'ed', 'fail', 'pending', 'ur']) delete m[k]; };
  const late = {};   // תגובה או עריכה שהגיעה לפני ההודעה עצמה: מחכה לה
  function meta(p) {
    const m = G.msgs.find(x => x.c === p.c), ts = +p.ts || 0;
    if (!m) { const ks = Object.keys(late); if (ks.length > 60) delete late[ks[0]]; const l = late[p.c] ||= []; l.push(p); if (l.length > 20) l.shift(); return; }
    if (m.del || m.x === null) return;
    if (p.t === 'react') {   // תגובה אחת לכל משתתף; e ריק = הסרה. רק אימוג׳י מהרשימה
      const e = p.e === '' ? '' : RX.includes(p.e) ? p.e : null, re = m.re ||= {}; if (e === null || (re[p.d] && re[p.d][1] > ts) || (!re[p.d] && Object.keys(re).length >= 80)) return;
      re[p.d] = [e, ts];
    } else if (m.d === p.d && typeof p.x === 'string' && p.x.trim() && ts - m.ts < 16 * 60e3 && ts > (m.ed || 0)) { m.x = p.x.trim().slice(0, 1200); m.ed = ts; }   // עריכה: רק של מי שכתב, ורק ברבע השעה הראשונה
  }
  // "מקלידה…": מגיע רק מהשרת שלנו, תקף לכמה שניות ולא נשמר
  const typers = {};
  function typIn(p) {
    const age = Date.now() - p.ts; if (!p.d || typeof p.d !== 'string' || p.d === G.id || G.out?.[p.d] || !(age <= 6000 && age > -60000)) return;
    typers[p.d] = { n: String(G.members[p.d]?.n || p.n || '').slice(0, 30), t: Date.now() + 6000 }; head(); setTimeout(head, 6100);
  }

  function handle(p, mid, att) {
    if (!p || !p.d) return;
    if (G.out?.[p.d]) return;   // מי שהוסר מהקבוצה: מתעלמים מההודעות שלו
    if (p.t === 'kick') {       // רק מי שהקים את הקבוצה יכול להסיר משתתף
      if (!TRIP.cfg.by || p.d !== TRIP.cfg.by || !p.k || p.k === p.d) return;
      if (p.k === G.id && G.at && p.ts < G.at) {   // הסרה ישנה שמגיעה מההיסטוריה אחרי הצטרפות מחדש: ממשיכים בזהות חדשה, כי שאר הקבוצה מתעלמת מהישנה
        delete G.members[G.id]; (G.out ||= {})[G.id] = 1; G.id = blank().id; save(); setTimeout(() => send({ t: 'hi' }).then(() => { if (G.av) send({ t: 'av', av: G.av }); }), 600); return; }
      if (p.k === G.id) { key = null; connect(); online = false; G = { ...blank(), name: G.name, av: G.av }; save(); drawFriends(); render(); A.toast('הוסרת מהקבוצה על ידי מנהל הקבוצה', 6000); return; }
      delete G.members[p.k]; (G.out ||= {})[p.k] = 1; save(); drawFriends(); render(); return;
    }
    const mine = p.d === G.id, mem = G.members[p.d] ||= {};
    mem.n = p.n; mem.seen = Math.max(mem.seen || 0, p.ts);
    if (p.t === 'av') { if (okAv(p.av)) mem.av = p.av; else delete mem.av; }
    if (p.t === 'hi' && !mine && G.av && Date.now() - p.ts < 5 * 60e3) setTimeout(() => send({ t: 'av', av: G.av }), 1000 + Math.random() * 3000);   // חברה חדשה: שולחות לה את התמונה שלנו
    if (p.t === 'del' && p.c) {
      const m = G.msgs.find(x => x.c === p.c); (G.dels ||= []).push(p.c); if (G.dels.length > 300) G.dels.splice(0, 100);
      if (m && (m.d === p.d || (TRIP.cfg.by && p.d === TRIP.cfg.by))) { gone(m); save(); render(); }   // נשארת שורת "ההודעה נמחקה"
      return;
    }
    if (p.t === 'chat' && p.c && G.dels && G.dels.includes(p.c)) return;   // הודעה שכבר נמחקה (הגיעה שוב מהשרת השני או מההיסטוריה)
    if (p.t === 'chat' || p.t === 'hi') {
      if (G.msgs.some(x => x.id === mid)) return;
      const pend = p.c && G.msgs.find(x => x.id === 'c' + p.c);
      if (pend) { pend.id = mid; delete pend.pending; delete pend.fail; save(); render(); return; }
      if (p.c && G.msgs.some(x => x.c === p.c)) return;   // אותה הודעה שנשלחה שוב (ניסיון חוזר)
      const f = okF(p.f), rp = p.t === 'chat' ? okRp(p.rp) : null;
      G.msgs.push({ id: mid, d: p.d, n: p.n, x: p.t === 'hi' ? null : String(p.x || '').slice(0, 1200), ts: p.ts, lat: p.lat, lng: p.lng, ...(f ? { f } : {}), ...(rp ? { rp } : {}), ...(p.c ? { c: p.c } : {}), ...(!mine && p.c && p.t === 'chat' && !chatOpen() ? { ur: 1 } : {}) });
      if (p.c && late[p.c]) { const l = late[p.c]; delete late[p.c]; l.forEach(meta); }
      delete typers[p.d];
      if (!mine && p.t === 'chat' && chatOpen() && !stick) below++;
      if (!mine && p.c && p.t === 'chat' && Date.now() - p.ts < 12 * 3600e3) queueAck(p.c, chatOpen());
      if (f && !mine) { if (att) fetchFile(f, att); else if (f.r && PUSH_URL) fetchFile(f, bigUrl('c' + f.id)); else fState[f.id] = 'missing'; }
      G.msgs.sort((a, b) => a.ts - b.ts); if (G.msgs.length > CAP) G.msgs.splice(0, G.msgs.length - CAP);
      if (!mine && Date.now() - p.ts < 5 * 60e3) { if (p.t === 'chat') beep(); if ($('#v-chat').hidden) { unread++; if (p.t === 'chat') A.toast(`${p.n}: ${f ? flbl(f) + ' ' : ''}${String(p.x || '').slice(0, 60)}`, 4000); } }
      else if (!mine && $('#v-chat').hidden) unread++;
    }
    if ((p.t === 'react' || p.t === 'edit') && typeof p.c === 'string' && p.c.length <= 16) meta(p);
    if (p.lat && p.lng) { mem.lat = p.lat; mem.lng = p.lng; mem.lt = p.ts; }
    if (p.t === 'fav' && p.pid) { const f = G.favs[p.pid] ||= {}; p.on ? f[p.d] = p.n : delete f[p.d]; if (!Object.keys(f).length) delete G.favs[p.pid]; }
    if (p.t === 'bye') delete G.members[p.d];
    // הגדרת הנסיעה: נשלחת על ידי מי שהקים את הקבוצה, ומי שכבר מחזיק בה מעביר אותה למצטרפים חדשים
    if (p.t === 'trip' && p.cfg && !mine) { const n = TRIP.norm(p.cfg), okBy = !TRIP.cfg.by || (p.d === TRIP.cfg.by && n.by === TRIP.cfg.by);   // אחרי שיש מנהל, רק הוא משנה את ההגדרות
      if (n.set && okBy && (!G.trip || n.u > (G.trip.u || 0))) { G.trip = p.cfg; save(); if (TRIP.apply(p.cfg)) TRIP.refresh('הגדרות הנסיעה התקבלו מהקבוצה'); } }
    if (p.t === 'hi' && !mine && Date.now() - p.ts < 5 * 60e3 && TRIP.cfg.set) setTimeout(() => { if (!tripSent[p.d]) sendTrip(); }, (TRIP.cfg.by === G.id ? 400 : 1500) + Math.random() * 2500);
    if (p.t === 'trip') tripSent[p.d === G.id ? '*' : p.d] = Date.now();
    if (p.t === 'ack' && !mine) { const mark = (list, k) => { for (const c of Array.isArray(list) ? list.slice(0, 80) : []) { const m = G.msgs.find(x => x.c === c && x.d === G.id); if (m && !(m[k] ||= {})[p.d]) m[k][p.d] = p.ts || 1; } };
      mark(p.dl, 'dv'); mark(p.rd, 'dv'); mark(p.rd, 'rd'); }
    if (p.t === 'freq' && !mine && p.fid) fGet(p.fid).then(async v => {   // מישהי מבקשת קובץ שפג תוקפו: מי שמחזיקה אותו מעלה שוב (השולחת קודם)
      const f = findF(p.fid); if (!v || !f || f.r) return; const own = G.msgs.some(x => x.f && x.f.id === p.fid && x.d === G.id), t0 = Date.now();
      await new Promise(q => setTimeout(q, own ? 300 + Math.random() * 1200 : 2500 + Math.random() * 3000));
      if ((served['f' + p.fid] || 0) >= t0) return; served['f' + p.fid] = Date.now();
      postFile({ t: 'fdata', fid: p.fid }, await v.blob.arrayBuffer());
    });
    if (p.t === 'fdata' && p.fid) { served['f' + p.fid] = Date.now(); const f = findF(p.fid); if (!mine && f && att && !fUrl[p.fid]) fetchFile(f, att); }
    if (p.t === 'j') { if (att && p.e) served[p.e.id] = Date.now(); journalIn(p, att); }
    if (p.t === 'jreq') journalReq(p);
    if (p.t === 'jdel' && p.d !== G.id) A.journal?.get(p.id).then(e => { if (e && e.byId === p.d) A.journal.del(p.id).then(() => A.journal.render()); }).catch(() => {});
    save(); render(); drawFriends();
  }

  // ───── מיקום חי ─────
  let lastLoc = null;
  setInterval(() => {
    const me = A.me; if (!key || !G.share || !me || document.hidden) return;
    const moved = lastLoc ? A.km(lastLoc, me) : 9, age = lastLoc ? Date.now() - lastLoc.t : 9e9;
    if ((moved > .06 && age > 90e3) || age > 6 * 60e3) { lastLoc = { ...me, t: Date.now() }; send({ t: 'loc', lat: +me.lat.toFixed(5), lng: +me.lng.toFixed(5) }); }
  }, 15000);

  // תמונת פרופיל: קטנה מאוד (72 פיקסלים), כדי שתיכנס בהודעה אחת מוצפנת
  const okAv = s => typeof s === 'string' && s.length < 4000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(s);
  const face = (id, m, cls = 'friend') => { const av = id === G.id ? G.av : m && m.av;
    return `<span class="${cls}" translate="no" style="--c:${color(id)}">${okAv(av) ? `<img src="${av}" alt="">` : esc(((id === G.id ? G.name : m && m.n) || '?').slice(0, 2))}</span>`; };
  async function makeAvatar(file) {
    let src; try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }
    const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight, s = Math.min(w, h), c = document.createElement('canvas'); c.width = c.height = 72;
    c.getContext('2d').drawImage(src, (w - s) / 2, (h - s) / 2, s, s, 0, 0, 72, 72);
    for (const q of [.72, .6, .5, .4, .3]) { const d = c.toDataURL('image/jpeg', q); if (d.length <= 2700) return d; }
    return c.toDataURL('image/jpeg', .2);
  }
  const COLORS = ['#e03177', '#0d5eaf', '#0ca678', '#f08c00', '#7048e8', '#1098ad', '#e8590c', '#c2255c'];
  const color = id => COLORS[[...id].reduce((s, c) => s + c.charCodeAt(0), 0) % COLORS.length];
  const ago = ts => { const m = Math.round((Date.now() - ts) / 6e4); return m < 1 ? 'עכשיו' : m < 60 ? `לפני ${m} דק׳` : m < 1440 ? `לפני ${Math.round(m / 60)} שע׳` : `לפני ${Math.round(m / 1440)} ימים`; };
  let friendLayer = null;
  function drawFriends() {
    const map = A.map; if (!map || !window.L) return;
    if (!friendLayer) friendLayer = L.layerGroup().addTo(map);
    friendLayer.clearLayers(); if (!key) return;
    Object.entries(G.members).forEach(([id, m]) => {
      if (id === G.id || !m.lat || Date.now() - m.lt > 3 * 36e5) return;
      const icon = L.divIcon({ className: '', html: face(id, m, 'friend pinf'), iconSize: [44, 44], iconAnchor: [22, 22] });
      L.marker([m.lat, m.lng], { icon, zIndexOffset: 900 }).addTo(friendLayer).bindPopup(`<b translate="no">${esc(m.n)}</b><br>${ago(m.lt)}`);
    });
  }
  A.hooks.map = drawFriends;
  A.hooks.fav = (pid, on) => { if (key) send({ t: 'fav', pid, on }); };
  A.hooks.favNames = pid => { const f = G.favs[pid]; return f ? Object.entries(f).filter(e => e[0] !== G.id).map(e => e[1]).join(', ') : ''; };

  // ───── ממשק ─────
  function status() { $('#grpStatus').textContent = !G.code ? 'צ׳אט, מיקום חי ומקומות משותפים, רק למי שיש את הקוד.' : online ? 'מחוברים · ההודעות מוצפנות' : 'מתחברים…'; head(); }
  const setH = (el, h) => { if (el._h !== h) { el.innerHTML = h; el._h = h; } };   // כותבת רק כשיש שינוי
  // כותרת הצ׳אט: שם הקבוצה, כמה משתתפים, ומי מקלידה עכשיו
  function head() {
    const joined = !!G.code, now = Date.now(); for (const id in typers) if (!joined || typers[id].t < now) delete typers[id];
    const ids = joined ? [G.id, ...Object.keys(G.members).filter(i => i !== G.id)] : [], ty = Object.values(typers).map(t => `<span translate="no">${esc(t.n)}</span>`);
    setH($('#chatTitle'), !joined ? 'הצ׳אט שלנו' : TRIP.cfg.name ? `<span translate="no">${esc(TRIP.cfg.name)}</span>` : esc(TRIP.title));
    setH($('#chatFaces'), ids.slice(0, 3).map(i => face(i, G.members[i], 'friend sm')).join(''));
    const st = $('#chatStatus'); st.classList.toggle('typing', ty.length > 0);
    setH(st, !joined ? '' : ty.length === 1 ? `${ty[0]} מקלידה…` : ty.length === 2 ? `${ty[0]} ו־${ty[1]} מקלידות…` : ty.length ? `${ty.length} מקלידות…` : `${ids.length} בקבוצה · ${online ? 'מחוברים' : 'מתחברים…'}`);
  }
  let kickSure = '';
  function render(force) {
    const joined = !!G.code;
    $('#grpJoin').hidden = joined; $('#grpMain').hidden = !joined; status();
    const badge = $('#grpBadge'); if (!$('#v-chat').hidden) unread = 0;
    const tb = $('#chatBadge'); tb.hidden = !unread; tb.textContent = unread;
    $('#chatEmpty').hidden = joined; $('#chatBody').hidden = !joined;
    badge.hidden = !unread; badge.textContent = unread;
    const ids = joined ? [G.id, ...Object.keys(G.members).filter(i => i !== G.id)] : [];
    $('#grpHint').textContent = joined ? `${ids.length} בקבוצה` : 'צ׳אט ומיקום חי';
    $('#grpFaces').innerHTML = ids.slice(0, 6).map(i => face(i, G.members[i])).join('') + (ids.length > 6 ? `<span class="friend more">+${ids.length - 6}</span>` : '');
    $('#myFace').innerHTML = joined ? face(G.id) : ''; $('#avClear').hidden = !G.av;
    if (!joined) return;
    $('#grpCode').textContent = G.code; $('#grpShare').checked = !!G.share;
    const me = A.me;
    $('#grpMembers').innerHTML = Object.entries({ [G.id]: { n: G.name, seen: Date.now() }, ...G.members }).filter((e, i, a) => a.findIndex(x => x[0] === e[0]) === i).map(([id, m]) => {
      const mine = id === G.id, fresh = m.lat && Date.now() - m.lt < 3 * 36e5;
      const boss = TRIP.cfg.by && id === TRIP.cfg.by, admin = TRIP.cfg.by === G.id;
      return `<div class="mem">${face(id, m)}<span><b>${esc(m.n || '')}${mine ? ' (אני)' : ''}${boss ? ' <em class="boss">ניהול</em>' : ''}</b>
        <small>${mine ? (G.share ? 'משתפת מיקום' : 'לא משתפת מיקום') : fresh ? `${ago(m.lt)}${me ? ' · ' + A.distTxt(A.km(me, m)) + ' ממך' : ''}` : m.seen ? 'נראתה ' + ago(m.seen) : ''}</small></span>
        ${!mine && fresh ? `<button class="btn ghost sm" data-see="${id}">במפה</button>` : ''}${admin && !mine ? `<button class="link kick" data-kick="${id}" type="button">${kickSure === id ? 'להסיר? ללחוץ שוב' : 'הסרה'}</button>` : ''}</div>`;
    }).join('');
    renderChat(force);
    const favs = Object.entries(G.favs).filter(e => A.byId[e[0]]);
    $('#grpFavs').innerHTML = favs.length ? favs.map(([pid, f]) => `<button class="tag" data-open="${pid}">${esc(A.byId[pid].he)} · ♥ ${esc(Object.values(f).join(', '))}</button>`).join('') : '<p class="muted small">מקום שמישהו בקבוצה מסמן ב־♥ מופיע כאן אצל כולם.</p>';
  }

  // ───── רשימת ההודעות ─────
  // לכל הודעה צומת משלה עם מפתח. בכל ציור משווים את ה-HTML שלה לקודם, ורק מה שהשתנה מתעדכן – תמונות, סרטונים והקלטות לא נוצרים מחדש.
  const box = $('#grpChat'), els = new Map(), UI = document.documentElement.dir === 'ltr' ? 'ltr' : 'rtl';
  let limit = 150, stick = true, below = 0, unreadAt = null, fresh = false;
  const mkey = m => m.c ? 'c' + m.c : 'i' + m.id;
  const hmF = new Intl.DateTimeFormat(LOC, { hour: '2-digit', minute: '2-digit' }), hm = ts => { try { return hmF.format(ts); } catch { return ''; } };
  const dayK = ts => { const d = new Date(ts); return d.getFullYear() * 1e4 + d.getMonth() * 100 + d.getDate(); };
  const dayLbl = ts => { const d = new Date(ts), k = dayK(ts), n = new Date(); return k === dayK(n) ? 'היום' : k === dayK(n - 864e5) ? 'אתמול' : d.toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== n.getFullYear() ? { year: 'numeric' } : {}) }); };
  let EMO = null; try { EMO = new RegExp('^(?:(?:\\p{Extended_Pictographic}|[\\u{1F1E6}-\\u{1F1FF}]{2})(?:\\uFE0F|\\u200D\\p{Extended_Pictographic}|[\\u{1F3FB}-\\u{1F3FF}])*){1,3}$', 'u'); } catch {}
  const bigEmoji = x => !!EMO && x.length <= 40 && EMO.test(x.replace(/\s+/g, ''));
  const STRONG = new RegExp('[A-Za-z\\u00C0-\\u024F\\u0370-\\u03FF\\u0400-\\u04FF\\u0590-\\u08FF]'), dirOf = x => { const c = STRONG.exec(x); return !c ? UI : c[0].charCodeAt(0) >= 0x590 ? 'rtl' : 'ltr'; };   // כיוון הטקסט לפי האות הראשונה
  // קישורים: קודם הכול עובר esc, ורק אז כתובות http/https/www הופכות לקישור
  const linkify = x => esc(x).replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<]+?)(?=[.,!?:)]*(?:\s|$|&quot;|&#39;|&lt;|&gt;))/gi, (m, pre, u) => `${pre}<a href="${/^www\./i.test(u) ? 'https://' + u : u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  function quote(rp) {
    const o = G.msgs.find(x => x.c === rp.c), x = o ? prev(o) : rp.x;
    return `<button type="button" class="mq" data-k="q" data-quote="${esc(rp.c)}" style="--q:${o ? color(o.d) : 'var(--sea)'}" translate="no"><b>${esc(o ? o.n : rp.n)}</b><span dir="${dirOf(x)}">${esc(x.slice(0, 120))}</span></button>`;
  }
  function chips(m, k) {
    if (!m.re) return ''; const cnt = {}; let me = '', n = 0;
    for (const id in m.re) { const e = Array.isArray(m.re[id]) && m.re[id][0]; if (!e || !RX.includes(e)) continue; cnt[e] = (cnt[e] || 0) + 1; n++; if (id === G.id) me = e; }
    return n ? `<button type="button" class="rxs ${me ? 'rme' : ''}" data-k="r" data-rx="${k}" aria-label="תגובות">${RX.filter(e => cnt[e]).join('')}${n > 1 ? `<b>${n}</b>` : ''}</button>` : '';
  }
  function msgHtml(m, first, last) {
    if (m.x === null) return `<p class="sys"><span>${esc(m.n)} הצטרף/ה לקבוצה</span></p>`;
    const mine = m.d === G.id, k = esc(mkey(m)), x = m.x || '', big = !m.f && !m.rp && !m.lat && !m.del && bigEmoji(x), td = dirOf(x);
    const cls = `${mine ? 'mine' : ''} ${first ? 'gf' : ''} ${last ? 'gl' : ''}`;
    const bcls = `${mine ? 'mine' : ''} ${m.pending ? 'pending' : ''} ${m.fail ? 'fail' : ''} ${m.del ? 'dl' : ''} ${big ? 'big' : ''} ${m.ed ? 'ed' : ''} ${!x && !m.del ? 'nt' : ''} ${big || m.lat || td !== UI ? 'stk' : ''}`;
    const mt = `<span class="mmeta" data-k="m">${m.ed ? '<em>נערכה</em>' : ''}<time>${hm(m.ts)}</time>${mine && !m.fail && !m.del ? `<button type="button" class="tkbtn" data-info="${k}" aria-label="מי קרא">${ticks(m)}</button>` : ''}</span>`;
    return `<div class="mrow ${cls}" data-key="${k}">${mine ? '' : first ? face(m.d, G.members[m.d], 'friend sm') : '<span class="friend sm none"></span>'}<div class="mcol" data-k="c"><div class="msg ${bcls}" data-k="b" data-mid="${k}" style="--c:${color(m.d)}">${!mine && first ? `<b class="mname" data-k="n" translate="no">${esc(m.n)}</b>` : ''}${m.rp ? quote(m.rp) : ''}${fileView(m)}${m.del ? '<span class="mtxt mdel" data-k="t">🚫 ההודעה נמחקה</span>' : x ? `<span class="mtxt" data-k="t" translate="no" dir="${td}">${linkify(x)}</span>` : ''}${m.lat ? `<button type="button" class="cloc" data-k="l" data-loc="${k}">📍 הצגה במפה</button>` : ''}${mt}</div>${chips(m, k)}${m.fail ? `<button type="button" class="mfail" data-k="x" data-retry="${k}">לא נשלחה · לנסות שוב</button>` : ''}</div></div>`;
  }
  const byKey = k => G.msgs.find(m => mkey(m) === k);
  const make = h => { const t = document.createElement('template'); t.innerHTML = h; return t.content.firstElementChild; };
  function morph(o, n) {   // מעדכנת צומת קיים לפי החדש. ילד עם data-h זהה נשאר כמו שהוא (תמונה, סרטון, נגן)
    for (const a of [...o.attributes]) if (!n.hasAttribute(a.name)) o.removeAttribute(a.name);
    for (const a of [...n.attributes]) if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value);
    const old = {}, kOf = c => c.dataset.k || '_' + c.tagName; for (const c of [...o.children]) old[kOf(c)] ||= c;
    const fin = [...n.children].map(c => { const p = old[kOf(c)];
      if (!p || p.tagName !== c.tagName) return c;
      if (c.dataset.h != null) return p.dataset.h === c.dataset.h ? p : c;
      if (c.querySelector(':scope > [data-k]')) { morph(p, c); return p; }
      return p.outerHTML === c.outerHTML ? p : c; });
    let cur = o.firstElementChild; for (const el of fin) { if (el === cur) cur = cur.nextElementSibling; else o.insertBefore(el, cur); }
    while (cur) { const nx = cur.nextElementSibling; cur.remove(); cur = nx; }
    if (fresh && !calm()) for (const el of fin) if (el.dataset.k === 'r' && old.r !== el) el.animate?.([{ transform: 'scale(.4)' }, { transform: 'scale(1.2)', offset: .7 }, { transform: 'scale(1)' }], 260);   // תגובה חדשה קופצת
  }
  function renderChat(force, keep) {
    const all = G.msgs, from = Math.max(0, all.length - limit), items = [], used = new Set(), dist = box.scrollHeight - box.scrollTop;
    const grp = (a, b) => !!a && !!b && a.x !== null && b.x !== null && a.d === b.d && dayK(a.ts) === dayK(b.ts) && Math.abs(b.ts - a.ts) < 5 * 60e3 && mkey(b) !== unreadAt;   // אותה כותבת, בתוך 5 דקות: גוש אחד
    const add = (k, h, m) => { while (used.has(k)) k += '+'; used.add(k); items.push([k, h, m]); };
    if (!all.length) add('empty', '<p class="sys"><span>עוד אין הודעות. אפשר לכתוב משהו לקבוצה.</span></p>');
    if (from > 0) add('older', '<p class="sys"><button type="button" class="older" data-older>הודעות קודמות</button></p>');
    let day = 0;
    for (let i = from; i < all.length; i++) { const m = all[i], dk = dayK(m.ts);
      if (dk !== day) { day = dk; add('d' + dk, `<p class="sys day"><span>${dayLbl(m.ts)}</span></p>`); }
      if (unreadAt && mkey(m) === unreadAt) add('unread', '<p class="sys unread"><span>הודעות שלא נקראו</span></p>');
      add(mkey(m), msgHtml(m, !(i > from && grp(all[i - 1], m)), !grp(m, all[i + 1])), m); }
    for (const [k, el] of els) if (!used.has(k)) { el.remove(); els.delete(k); }
    let cur = box.firstElementChild;
    for (const [k, h, m] of items) { let el = els.get(k);
      if (!el) { el = make(h); el._h = h; els.set(k, el); if (fresh && m && Date.now() - m.ts < 15000) el.classList.add('pop'); }
      else if (el._h !== h) { morph(el, make(h)); el._h = h; }
      if (el === cur) cur = cur.nextElementSibling; else box.insertBefore(el, cur); }
    if (force || stick) toEnd(); else { if (keep) box.scrollTop = box.scrollHeight - dist; down(); }
  }
  // גלילה: נשארים בסוף רק אם כבר היינו שם. מי שקוראת הודעות ישנות לא נזרקת למטה, ומקבלת כפתור ↓ עם מספר ההודעות החדשות
  const gap = () => box.scrollHeight - box.scrollTop - box.clientHeight;
  function down() { const far = gap() > 220; $('#chatDown').hidden = !far && !below; $('#chatDownN').hidden = !below; $('#chatDownN').textContent = below; }
  function toEnd() { box.scrollTop = box.scrollHeight; stick = true; below = 0; down(); }
  box.addEventListener('scroll', () => { if (!box.clientHeight) return; stick = gap() < 60; if (stick) below = 0; down(); }, { passive: true });
  box.addEventListener('load', () => { if (stick) box.scrollTop = box.scrollHeight; }, true);   // תמונה שנטענה משנה את הגובה
  if (window.ResizeObserver) new ResizeObserver(() => { if (stick && box.clientHeight) box.scrollTop = box.scrollHeight; }).observe(box);   // המקלדת נפתחה או נסגרה
  $('#chatDown').onclick = () => { if (calm() || gap() > 1500) toEnd(); else { box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }); below = 0; down(); } };   // מרחוק קופצים מיד
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function jump(c) {   // קפיצה להודעה המצוטטת, עם הבהוב קצר
    const i = G.msgs.findIndex(x => x.c === c); if (i < 0) return A.toast('ההודעה המקורית כבר לא שמורה כאן');
    if (G.msgs.length - i > limit) { limit = G.msgs.length - i + 20; renderChat(false, true); }
    const el = els.get('c' + c); if (!el) return;
    box.scrollTo({ top: Math.max(0, el.offsetTop - (box.clientHeight - el.offsetHeight) / 2), behavior: calm() ? 'auto' : 'smooth' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1800);
  }

  const tripSent = {};
  const tripOut = () => { const c = TRIP.cfg; return { type: c.type, name: c.name, occ: c.occ, start: A.S.start, hotel: A.S.hotel, by: c.by, u: c.u || 1, legacy: c.legacy }; };
  function sendTrip() { if (!key || !TRIP.cfg.set) return; for (const k in tripSent) delete tripSent[k]; G.trip = tripOut(); save(); return send({ t: 'trip', cfg: G.trip }); }
  const canEditTrip = () => !G.code || !TRIP.cfg.by || TRIP.cfg.by === G.id;
  function renderTripCard() {
    const c = TRIP.cfg, t = TRIP.TYPES[c.type];
    $('#tripCard').innerHTML = `<div class="card-head"><h2>${t.ico} ${esc(TRIP.title)}</h2><button class="link" id="tripEdit">${canEditTrip() ? 'עריכה' : 'פרטים'}</button></div>
      <p class="muted small">${t.he}${c.occ !== 'none' ? ' · ' + TRIP.OCCS[c.occ] : ''}${A.S.hotel ? ' · ' + esc(A.S.hotel.name) : ''}</p>
      <p class="muted small">${canEditTrip() ? 'ההגדרות האלה עוברות לכל מי שמצטרף לקבוצה.' : 'את הנסיעה מגדיר מי שהקים את הקבוצה.'}</p>`;
    $('#tripEdit').onclick = A.hooks.editTrip;
  }
  // עריכת הנסיעה: בקבוצה היא נשלחת לכולם; רק מי שהקים את הקבוצה יכול לשנות
  A.hooks.editTrip = () => A.openTrip({ canEdit: canEditTrip(), note: G.code ? (canEditTrip() ? 'השינוי יעבור לכל הקבוצה.' : 'את הנסיעה מגדיר מי שהקים את הקבוצה.') : '',
    onSave: cfg => { if (G.code) cfg.by = TRIP.cfg.by || G.id; const ch = TRIP.apply(cfg); if (G.code) sendTrip(); if (ch) TRIP.refresh(G.code ? 'הנסיעה עודכנה ונשלחה לקבוצה' : 'הנסיעה עודכנה'); else A.toast('נשמר'); } });
  A.hooks.hotel = () => { if (G.code && TRIP.cfg.set && canEditTrip()) { TRIP.apply({ ...tripOut(), u: Date.now() }); sendTrip(); A.toast('המלון נשלח לקבוצה'); } };

  async function join(code, name, isNew) {
    if (!window.crypto?.subtle) return A.toast('הדפדפן הזה לא תומך בהצפנה הדרושה');
    code = norm(code); if (code.length < 6) return A.toast('הקוד קצר מדי');
    if (!name) return A.toast('איך קוראים לך?');
    G = { ...blank(), id: G.id, av: G.av, name, code: code.replace(/(.{4})(?=.)/g, '$1-'), at: Date.now() }; save();
    try { const u = (localStorage.getItem('lisboa.jused') || '').split(',').filter(Boolean); if (!u.includes(code)) localStorage.setItem('lisboa.jused', [...u, code].slice(-20).join(',')); } catch {}
    await derive(code); connect(); render();
    setTimeout(() => send({ t: 'hi' }).then(() => { if (G.av) send({ t: 'av', av: G.av }); if (isNew) sendTrip(); }), 800);
    A.toast(isNew ? 'הקבוצה נוצרה. עכשיו שולחים הזמנה לשאר' : 'הצטרפת לקבוצה');
    setTimeout(() => A.lic?.sync(), 1500);   // מעדכן בשרת מי הטלפון הזה בקבוצה
  }
  $('#grpJoinForm').onsubmit = e => { e.preventDefault(); join($('#grpCodeIn').value, $('#grpName').value.trim(), false); };
  // פתיחת קבוצה: קודם מגדירים את הנסיעה, ואז נוצר הקוד
  $('#grpNew').onclick = () => {
    const name = $('#grpName').value.trim(); if (!name) return A.toast('קודם לכתוב שם');
    if (A.lic && !A.lic.canCreate()) return A.toast('כדי לפתוח קבוצה צריך רישיון עם מקומות לקבוצה', 5000);
    A.openTrip({ title: 'הנסיעה של הקבוצה', note: 'מה שמוגדר כאן יעבור לכל מי שמצטרף עם הקוד.', onSave: async cfg => {
      cfg.by = G.id; TRIP.apply(cfg);
      const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', r = crypto.getRandomValues(new Uint8Array(8));
      await join([...r].map(b => abc[b % abc.length]).join(''), name, true);
      G.trip = tripOut(); save(); TRIP.refresh();
    } });
  };
  $('#grpInvite').onclick = () => {
    if (A.lic && !A.lic.canInvite()) return A.toast('רק מנהל הקבוצה שולח הזמנות');
    const seat = A.lic ? A.lic.invite() : '';   // מקום מתוך הרישיון של המנהל: מי שמצטרף מהקישור לא צריך קוד משלו
    const url = location.origin + location.pathname + '?j=' + G.code + (seat ? '&k=' + encodeURIComponent(seat) : '');
    const text = `הוזמנת לקבוצה "${TRIP.title}" באפליקציית ליסבון 🇵🇹\nלוחצים על הקישור, כותבים שם, וזהו:\n${url}\n\nכבר יש לך את האפליקציה? בלשונית הקבוצה מזינים את הקוד: ${G.code}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else navigator.clipboard?.writeText(text).then(() => A.toast('ההזמנה הועתקה'), () => A.toast('הקוד: ' + G.code));
  };
  $('#grpShare').onchange = e => { G.share = e.target.checked; save(); lastLoc = null; if (G.share) A.startGPS(true); render(); A.toast(G.share ? 'הקבוצה רואה אותך על המפה' : 'שיתוף המיקום הופסק'); };
  // הודעה מופיעה מיד אצל השולחת, ומסומנת כנשלחה כשהשרת מאשר
  // נכשלה? הבועה נשארת עם "לא נשלחה · לנסות שוב", והודעות טקסט נשלחות שוב לבד כשהחיבור חוזר. אותו מזהה c, כך שמי שכבר קיבלה לא תראה פעמיים
  const pushOut = body => { if (PUSH_URL) fetch(PUSH_URL + '/push', { method: 'POST', body: JSON.stringify({ g: ntopic, d: G.id, title: 'ליסבון שלנו', body: `${G.name}: ${body}`, site: location.origin + location.pathname }) }).catch(() => {}); };
  async function deliver(m, again, blob) {
    m.pending = true; delete m.fail; if (again) { m.ts = Date.now(); G.msgs.sort((a, b) => a.ts - b.ts); } save(); render();
    const body = { t: 'chat', x: m.x, c: m.c, ...(m.lat ? { lat: m.lat, lng: m.lng } : {}), ...(m.rp ? { rp: m.rp } : {}) }, f = m.f; let ok = false;
    if (f) { blob ||= (await fGet(f.id))?.blob;
      if (blob && OWN && await bigUp('c' + f.id, blob)) { f.r = 1; ok = await send({ ...body, f }, { quiet: 1 }); }           // קודם לאחסון שלנו
      else if (blob && blob.size <= SMALL) ok = await postFile({ ...body, f }, await blob.arrayBuffer());                    // גיבוי: השרת הציבורי, לקבצים קטנים
      if (!ok && !again) A.toast('אין חיבור – הקובץ לא נשלח'); }
    else ok = await send(body, { quiet: again });
    if (!G.msgs.includes(m) || m.del) return ok;   // נמחקה בינתיים
    delete m.pending; if (!ok) m.fail = 1; save(); render();
    if (ok) pushOut(f ? `${flbl(f)} ${m.x.slice(0, 100)}` : m.x.slice(0, 140));
    return ok;
  }
  let retrying = false;
  async function retryAll() { if (retrying || !key) return; retrying = true;
    try { for (const m of G.msgs.filter(x => x.fail && !x.f && x.d === G.id && x.c)) if (!(await deliver(m, true))) break; } finally { retrying = false; } }
  function say(x, extra) {
    const c = uid(), m = { id: 'c' + c, c, d: G.id, n: G.name, x, ts: Date.now(), pending: true, ...extra };
    G.msgs.push(m); unreadAt = null; stick = true; return deliver(m);
  }
  // שליחת תמונה או מסמך. תמונות מוקטנות לפני השליחה
  async function sayFile(file, o = {}) {
    const img = /^image\//.test(file.type) || /\.(heic|heif|jpe?g|png|webp)$/i.test(file.name || '');
    let blob = file, name = file.name || (img ? 'photo.jpg' : 'file'), type = file.type || 'application/octet-stream';
    if (img) try { blob = await A.journal.shrink(file, 1280); type = 'image/jpeg'; name = name.replace(/\.\w+$/, '') + '.jpg'; } catch { return A.toast('לא הצלחנו לקרוא את התמונה'); }
    const vid = !img && !o.aud && (/^video\//.test(file.type) || /\.(mp4|mov|m4v|webm)$/i.test(name));
    if (vid && !/^video\//.test(type)) type = /\.mov$/i.test(name) ? 'video/quicktime' : 'video/mp4';
    const heavy = blob.size > SMALL;
    if (blob.size > BIG) return A.toast(vid ? 'הסרטון גדול מדי. אפשר לשלוח עד 95 מ״ב, בערך דקה' : 'הקובץ גדול מדי. אפשר לשלוח עד 95 מ״ב');
    if (blob.size > 3e6) A.toast(heavy ? 'מעלה… זה יכול לקחת דקה. לא לסגור את האפליקציה' : 'מעלה… זה יכול לקחת כמה שניות', heavy ? 60000 : 8000);
    const fid = uid(), c = uid(), f = { id: fid, name: name.slice(0, 80), type, size: blob.size, img, vid, ...(o.aud ? { aud: 1, dur: o.dur || 0 } : {}) };
    await fPut(fid, { blob, name, type }).catch(() => {}); fUrl[fid] = URL.createObjectURL(blob);
    const x = o.aud || editing ? '' : inp.value.trim(), rp = takeReply(); if (x) { inp.value = ''; sync(); }
    const m = { id: 'c' + c, c, d: G.id, n: G.name, x, ts: Date.now(), pending: true, f, ...(rp ? { rp } : {}) };
    G.msgs.push(m); unreadAt = null; stick = true; return deliver(m, false, blob);
  }
  $('#chatFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) sayFile(f); };
  let openF = null;
  async function shareF(fid) {
    const v = await fGet(fid), f = findF(fid); if (!v || !f) return;
    const file = new File([v.blob], f.name, { type: v.blob.type });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (err) { if (err?.name === 'AbortError') return; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(v.blob); a.download = f.name; document.body.append(a); a.click(); a.remove();
  }
  box.addEventListener('click', e => {
    const q = e.target.closest('[data-freq]'); if (q) { const fid = q.dataset.freq, bf = findF(fid); if (bf && bf.r) return fetchFile(bf, bigUrl('c' + fid));   // קובץ גדול נמצא באחסון: מנסים להוריד שוב
      fState[fid] = 'loading'; render(); send({ t: 'freq', fid });
      setTimeout(() => { if (fState[fid] === 'loading') { fState[fid] = 'missing'; render(); A.toast('אין כרגע מישהו מחובר שהקובץ שמור אצלו'); } }, 25000); return; }
    const el = e.target.closest('[data-file]'); if (!el) return; const fid = el.dataset.file, f = findF(fid);
    if (f && f.img) { openF = fid; $('#fileImg').src = fUrl[fid]; $('#fileDlg').showModal(); } else shareF(fid);   // תמונה נפתחת על כל המסך
  });
  $('#fileDlg').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  box.addEventListener('click', e => {
    const t = e.target, o = t.closest('[data-older]'), j = t.closest('[data-quote]'), r = t.closest('[data-rx]'), rt = t.closest('[data-retry]'), au = t.closest('[data-au]'), sk = t.closest('[data-seek]');
    if (o) { limit += 150; renderChat(false, true); }
    else if (j) jump(j.dataset.quote);
    else if (r) { const m = byKey(r.dataset.rx); if (m) showRx(m); }
    else if (rt) { const m = byKey(rt.dataset.retry); if (m && m.fail) deliver(m, true).then(ok => { if (!ok) A.toast('אין חיבור – ההודעה לא נשלחה'); }); }
    else if (au) { const a = au.parentNode.querySelector('audio'); if (a.paused) { box.querySelectorAll('audio, video').forEach(v => v !== a && v.pause()); a.play().catch(() => A.toast('לא הצלחנו להשמיע את ההקלטה')); } else a.pause(); }
    else if (sk) { const a = sk.parentNode.querySelector('audio'), d = isFinite(a.duration) && a.duration ? a.duration : +a.dataset.dur, b = sk.getBoundingClientRect(), fr = (e.clientX - b.left) / b.width; if (d) try { a.currentTime = d * (getComputedStyle(sk).direction === 'rtl' ? 1 - fr : fr); } catch {} }
  });
  // נגן ההקלטות: כפתור, פס התקדמות וזמן
  for (const ev of ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata']) box.addEventListener(ev, e => {
    const a = e.target, w = a.tagName === 'AUDIO' && a.closest('.caud'); if (!w) return;
    const d = isFinite(a.duration) && a.duration ? a.duration : +a.dataset.dur || 0, on = !a.paused && !a.ended;
    if (ev !== 'timeupdate') { w.querySelector('.au-b').innerHTML = on ? SV.pause : SV.play; w.classList.toggle('on', on); }
    if (ev === 'ended') a.currentTime = 0;
    w.querySelector('i').style.width = (d ? Math.min(100, a.currentTime / d * 100) : 0) + '%';
    w.querySelector('.au-t').textContent = mmss(on || a.currentTime ? a.currentTime : d);
  }, true);
  // מי קראה: לחיצה על הווי (או "מי קרא" בתפריט) פותחת פירוט לפי חברה
  function showInfo(m) {
    const ids = Object.keys(G.members).filter(id => id !== G.id), row = (id, t) => `<div class="mem">${face(id, G.members[id])}<span><b>${esc(G.members[id].n || '')}</b></span><small class="muted">${t > 1 ? hm(t) : ''}</small></div>`;
    const read = ids.filter(id => m.rd && m.rd[id]), got = ids.filter(id => !(m.rd && m.rd[id]) && m.dv && m.dv[id]), none = ids.filter(id => !(m.dv && m.dv[id]));
    const sec = (title, list, k) => list.length ? `<h3 class="sub-h">${title}</h3>${list.map(id => row(id, k && m[k][id])).join('')}` : '';
    $('#infoTitle').textContent = 'מי קרא';
    $('#infoBody').innerHTML = m.pending ? '<p class="muted">ההודעה עוד בדרך לשרת.</p>' : !ids.length ? '<p class="muted">עוד אין משתתפים נוספים בקבוצה.</p>'
      : sec('<span class="tk rd">✓✓</span> קראו', read, 'rd') + sec('<span class="tk">✓✓</span> הגיעה, עוד לא נקראה', got, 'dv') + sec('<span class="tk">✓</span> עוד לא הגיעה', none, '');
    $('#infoQuote').textContent = prev(m);
    $('#infoDlg').showModal();
  }
  function showRx(m) {   // מי הגיבה במה. על התגובה שלי אפשר ללחוץ כדי להסיר
    const list = Object.entries(m.re || {}).filter(e => Array.isArray(e[1]) && RX.includes(e[1][0]));
    $('#infoTitle').textContent = 'תגובות'; $('#infoQuote').textContent = prev(m);
    $('#infoBody').innerHTML = list.map(([id, r]) => `<${id === G.id ? `button type="button" data-unrx="${esc(mkey(m))}"` : 'div'} class="mem rxrow">${face(id, G.members[id])}<span><b translate="no">${esc((id === G.id ? G.name : G.members[id]?.n) || '')}</b>${id === G.id ? '<small class="muted">ללחוץ כדי להסיר</small>' : ''}</span><span class="rx-e">${r[0]}</span></${id === G.id ? 'button' : 'div'}>`).join('');
    $('#infoDlg').showModal();
  }
  $('#infoBody').addEventListener('click', e => { const b = e.target.closest('[data-unrx]'), m = b && byKey(b.dataset.unrx); if (m) { $('#infoDlg').close(); react(m, ''); } });
  box.addEventListener('click', e => { const b = e.target.closest('[data-info]'), m = b && byKey(b.dataset.info); if (m) showInfo(m); });
  $('#infoClose').onclick = () => $('#infoDlg').close();
  // מיקום שנשלח בהודעה: נפתח במפה של האפליקציה, עם סיכה בדיוק בנקודה וכפתור ניווט
  let locPin = null;
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-loc]'); if (!b) return; const m = byKey(b.dataset.loc); if (!m || !m.lat) return;
    A.go('map');
    setTimeout(() => { const map = A.map; if (!map || !window.L) return;
      if (locPin) locPin.remove();
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent), nav = ios ? `https://maps.apple.com/?daddr=${m.lat},${m.lng}&dirflg=w` : `https://www.google.com/maps/dir/?api=1&destination=${m.lat},${m.lng}&travelmode=walking`;
      const me = A.me, dist = me ? ' · ' + A.distTxt(A.km(me, m)) + ' ממך' : '';
      locPin = L.marker([m.lat, m.lng], { icon: L.divIcon({ className: '', html: '<span class="locpin">📍</span>', iconSize: [44, 44], iconAnchor: [22, 42] }), zIndexOffset: 1000 }).addTo(map)
        .bindPopup(`<div class="locpop"><b translate="no">${esc(m.n)}</b><small>${hm(m.ts)}${dist}</small><a class="btn sm" target="_blank" rel="noopener" href="${nav}">ניווט לשם</a></div>`, { offset: [0, -34] });
      map.invalidateSize(); map.setView([m.lat, m.lng], 17); locPin.openPopup();
    }, 200);
  });
  // לחיצה ארוכה על הודעה: תגובה באימוג׳י, השבה, העתקה, עריכה, מי קרא, מחיקה. את ההודעות שלי (ומנהל הקבוצה – כל הודעה) אפשר למחוק אצל כולם
  let actMsg = null, holdT = null, sw = null, eat = 0, menuAt = 0, replyTo = null, editing = null;
  const usable = m => !!m && !!m.c && !m.pending && !m.fail && !m.del && m.x !== null;   // הודעה שכבר אצל כולם
  const canEdit = m => usable(m) && m.d === G.id && !!m.x && !m.f && !m.lat && Date.now() - m.ts < 15 * 60e3;
  function msgMenu(el) {
    const m = byKey(el.dataset.mid); if (!m || m.x === null) return; actMsg = m;
    const mine = m.d === G.id, admin = TRIP.cfg.by && TRIP.cfg.by === G.id, ok = usable(m), my = ok && m.re?.[G.id]?.[0];
    $('#msgPrev').textContent = prev(m).slice(0, 160);
    $('#msgRx').hidden = !ok; $('#msgRx').innerHTML = RX.map(e => `<button type="button" class="${e === my ? 'on' : ''}" data-e="${e}">${e}</button>`).join('');
    $('#msgReply').hidden = !ok; $('#msgCopy').hidden = !m.x; $('#msgEdit').hidden = !canEdit(m); $('#msgInfo').hidden = !(ok && mine); $('#msgRetry').hidden = !m.fail;
    $('#msgDelAll').hidden = !(ok && (mine || admin));
    $('#msgDlg').showModal();
  }
  // לחיצה ארוכה פותחת את התפריט; גרירה של הבועה הצידה – השבה
  box.addEventListener('pointerdown', e => { const el = e.target.closest('.msg'); clearTimeout(holdT); sw = null; if (!el || e.target.closest('a, button, video, .caud') || (e.pointerType === 'mouse' && e.button)) return;
    sw = { el, row: el.closest('.mrow'), x: e.clientX, y: e.clientY, dx: 0, on: false };
    holdT = setTimeout(() => { sw = null; eat = menuAt = Date.now(); navigator.vibrate?.(15); msgMenu(el); }, 500); });
  box.addEventListener('pointermove', e => { if (!sw) return; const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (!sw.on) { if (Math.hypot(dx, dy) < 10) return; clearTimeout(holdT); if (Math.abs(dx) < Math.abs(dy) * 1.500 || !usable(byKey(sw.el.dataset.mid))) { sw = null; return; } sw.on = true; sw.row.classList.add('swipe'); }
    const was = Math.abs(sw.dx) > 52; sw.dx = Math.max(-76, Math.min(76, dx)); sw.row.style.transform = `translateX(${sw.dx}px)`; sw.row.classList.toggle('go', Math.abs(sw.dx) > 52); if (!was && Math.abs(sw.dx) > 52) navigator.vibrate?.(10); });
  const swEnd = e => { clearTimeout(holdT); const q = sw; sw = null; if (!q || !q.on) return; q.row.classList.remove('swipe', 'go'); q.row.style.transform = ''; eat = Date.now();
    if (e.type === 'pointerup' && Math.abs(q.dx) > 52) { const m = byKey(q.el.dataset.mid); if (usable(m)) setReply(m); } };
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) box.addEventListener(t, swEnd);
  box.addEventListener('click', e => { if (Date.now() - eat < 450) { eat = 0; e.stopPropagation(); e.preventDefault(); } }, true);   // השחרור אחרי לחיצה ארוכה או גרירה אינו לחיצה
  box.addEventListener('contextmenu', e => { const el = e.target.closest('.msg'); if (el && !e.target.closest('a, video')) { e.preventDefault(); clearTimeout(holdT); sw = null; msgMenu(el); } });
  const dropMsg = m => { G.msgs = G.msgs.filter(x => x !== m); if (replyTo === m) replyTo = null; if (editing === m) { editing = null; inp.value = ''; } bar(); save(); render(); };
  async function react(m, e) {   // מופיעה מיד אצלי, ומתבטלת אם השליחה נכשלה
    const old = m.re?.[G.id]; (m.re ||= {})[G.id] = [e, Date.now()]; save(); render();
    if (!(await send({ t: 'react', c: m.c, e }))) { if (old) m.re[G.id] = old; else delete m.re[G.id]; save(); render(); A.toast('אין חיבור כרגע. לנסות שוב'); }
  }
  $('#msgDlg').addEventListener('click', e => { if (Date.now() - menuAt < 450) { menuAt = 0; e.stopImmediatePropagation(); e.preventDefault(); } }, true);   // שחרור האצבע מהלחיצה הארוכה לא בוחר כלום
  $('#msgDlg').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });   // לחיצה מחוץ לתפריט סוגרת
  $('#msgRx').onclick = e => { const b = e.target.closest('[data-e]'); if (!b) return; $('#msgDlg').close(); if (usable(actMsg)) react(actMsg, b.classList.contains('on') ? '' : b.dataset.e); };
  $('#msgReply').onclick = () => { $('#msgDlg').close(); setReply(actMsg); };
  $('#msgEdit').onclick = () => { $('#msgDlg').close(); if (canEdit(actMsg)) setEdit(actMsg); };
  $('#msgInfo').onclick = () => { $('#msgDlg').close(); showInfo(actMsg); };
  $('#msgRetry').onclick = () => { $('#msgDlg').close(); if (actMsg.fail) deliver(actMsg, true).then(ok => { if (!ok) A.toast('אין חיבור – ההודעה לא נשלחה'); }); };
  $('#msgCopy').onclick = () => { navigator.clipboard?.writeText(actMsg.x).then(() => A.toast('הועתק'), () => {}); $('#msgDlg').close(); };
  $('#msgDelMe').onclick = () => { dropMsg(actMsg); $('#msgDlg').close(); A.toast('ההודעה נמחקה אצלך'); };
  $('#msgDelAll').onclick = async () => { const m = actMsg; $('#msgDlg').close();
    if (!(await send({ t: 'del', c: m.c }))) return A.toast('אין חיבור כרגע. ההודעה לא נמחקה');
    (G.dels ||= []).push(m.c); gone(m); if (replyTo === m) replyTo = null; if (editing === m) { editing = null; inp.value = ''; } bar(); save(); render(); A.toast('ההודעה נמחקה אצל כולם'); };
  $('#msgCancel').onclick = () => $('#msgDlg').close();
  $('#fileShare').onclick = () => openF && shareF(openF);
  $('#fileClose').onclick = () => $('#fileDlg').close();

  // ───── שורת הכתיבה: השבה, עריכה, הקלטה ─────
  const inp = $('#grpText'), coarse = matchMedia('(pointer: coarse)').matches;
  const canRec = !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const grow = () => { inp.style.height = ''; if (inp.value && inp.scrollHeight > inp.clientHeight) inp.style.height = Math.min(inp.scrollHeight, 122) + 'px'; };   // עד 5 שורות
  const sync = () => { const has = !!inp.value.trim() || !!editing || !canRec; $('#sendBtn').hidden = !has; $('#micBtn').hidden = has; grow(); };
  function bar() {
    const m = editing || replyTo; $('#replyBar').hidden = !m; $('#replyBar').classList.toggle('edit', !!editing); if (!m) return sync();
    $('#replyBar').style.setProperty('--q', editing ? 'var(--sea)' : color(m.d));
    $('#replyWho').innerHTML = editing ? 'עריכת הודעה' : `<span translate="no">${esc(m.n)}</span>`; $('#replyTxt').textContent = prev(m).slice(0, 120); sync();
  }
  const setReply = m => { if (editing) inp.value = ''; editing = null; replyTo = m; bar(); inp.focus(); };
  const setEdit = m => { replyTo = null; editing = m; inp.value = m.x; bar(); inp.focus(); try { inp.setSelectionRange(m.x.length, m.x.length); } catch {} };
  const takeReply = () => { const m = replyTo; replyTo = null; bar(); return usable(m) ? { c: m.c, n: String(m.n || '').slice(0, 40), x: prev(m).slice(0, 120) } : null; };
  $('#replyX').onclick = () => { if (editing) inp.value = ''; editing = replyTo = null; bar(); };
  let lastTyp = 0;
  inp.addEventListener('input', () => { sync();
    if (key && OWN && !editing && inp.value.trim() && Date.now() - lastTyp > 4000) { lastTyp = Date.now(); send({ t: 'typ' }, { own: 1, quiet: 1 }); } });   // "מקלידה…", לכל היותר פעם ב־4 שניות
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !coarse) { e.preventDefault(); submit(); } });   // במחשב Enter שולח; בטלפון הוא שורה חדשה
  for (const id of ['#sendBtn', '#micBtn', '#emojiBtn']) $(id).addEventListener('pointerdown', e => { if (document.activeElement === inp) e.preventDefault(); });   // המקלדת נשארת פתוחה
  async function submit() {
    const x = inp.value.trim(); if (!x || !G.code) return; $('#emojiPanel').hidden = true;
    if (editing) { const m = editing; editing = null; inp.value = ''; bar();
      if (x === m.x) return; if (!canEdit(m)) return A.toast('אפשר לערוך הודעה רק ברבע השעה הראשונה');
      if (!(await send({ t: 'edit', c: m.c, x }))) { if (!editing && !inp.value) { editing = m; inp.value = x; bar(); } return A.toast('אין חיבור – השינוי לא נשמר'); }
      m.x = x.slice(0, 1200); m.ed = Date.now(); save(); render(); return; }
    const rp = takeReply(); inp.value = ''; sync();
    say(x, rp ? { rp } : undefined);
  }
  // הודעה קולית: לחיצה מתחילה להקליט, ואז שליחה או ביטול
  let rec = null;
  const recUI = () => { $('#recBar').hidden = !rec; $('#grpForm').hidden = !!rec; if (rec) $('#recTime').textContent = '0:00'; };
  const recStop = ok => { if (!rec) return; rec.ok = ok; try { rec.mr.stop(); } catch { rec.stream.getTracks().forEach(t => t.stop()); clearInterval(rec.tick); rec = null; recUI(); } };
  async function recStart() {
    if (rec || !key) return; let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return A.toast('אין גישה למיקרופון. צריך לאשר אותה בהגדרות ולנסות שוב', 5000); }
    const mime = ['audio/mp4', 'audio/webm'].find(t => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }); let mr;
    try { mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); } catch { stream.getTracks().forEach(t => t.stop()); return A.toast('הדפדפן הזה לא תומך בהקלטה'); }
    const chunks = [], t0 = Date.now(), r = rec = { mr, stream, ok: false };
    mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onerror = () => recStop(false);
    mr.onstop = () => { clearInterval(r.tick); stream.getTracks().forEach(t => t.stop()); if (rec === r) rec = null; recUI();
      const type = (mr.mimeType || mime || 'audio/mp4').split(';')[0], dur = Math.round((Date.now() - t0) / 1000), blob = new Blob(chunks, { type });
      if (!r.ok) return; if (!blob.size || dur < 1) return A.toast('ההקלטה קצרה מדי');
      sayFile(new File([blob], 'voice.' + (/mp4/.test(type) ? 'm4a' : 'webm'), { type }), { aud: 1, dur }); };
    try { mr.start(); } catch { rec = null; stream.getTracks().forEach(t => t.stop()); return A.toast('הדפדפן הזה לא תומך בהקלטה'); }
    r.tick = setInterval(() => { const sec = (Date.now() - t0) / 1000; $('#recTime').textContent = mmss(sec); if (sec >= 300) recStop(true); }, 250); recUI();   // עד 5 דקות
  }
  $('#micBtn').onclick = recStart; $('#recCancel').onclick = () => recStop(false); $('#recSend').onclick = () => recStop(true);

  // סמיילים
  const EMOJI = ['😀', '😂', '🤣', '🥰', '😍', '😘', '😎', '🤩', '🥳', '😅', '😉', '😇', '🙈', '😴', '🤤', '😭', '😡', '🤯', '👍', '👏', '🙏', '💪', '🙌', '👌', '❤️', '💕', '🔥', '✨', '🎉', '🎂', '🥂', '🍸', '🍷', '☕', '🍕', '🥙', '🛍️', '👗', '👠', '💄', '📸', '🏛️', '☀️', '🌙', '✈️', '🚕', '📍', '⏰'];
  $('#emojiPanel').innerHTML = EMOJI.map(x => `<button type="button">${x}</button>`).join('');
  $('#emojiBtn').onclick = () => { const p = $('#emojiPanel'); p.hidden = !p.hidden; };
  $('#emojiPanel').onclick = e => { const b = e.target.closest('button'); if (!b) return; const i = inp, at = i.selectionStart ?? i.value.length; i.value = i.value.slice(0, at) + b.textContent + i.value.slice(i.selectionEnd ?? at); const pos = at + b.textContent.length; try { i.setSelectionRange(pos, pos); } catch {} sync(); };

  // כשהמקלדת פתוחה הסרגל התחתון מוסתר, כדי שלא יעלה מעליה ויתפוס מקום
  const typing = el => el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(checkbox|radio|file|button|submit|range)$/.test(el.type)));
  document.addEventListener('focusin', e => { if (typing(e.target)) document.body.classList.add('kb'); });
  document.addEventListener('focusout', () => setTimeout(() => { if (!typing(document.activeElement)) document.body.classList.remove('kb'); }, 120));

  $('#grpForm').onsubmit = e => { e.preventDefault(); submit(); if (document.activeElement === $('#sendBtn')) inp.focus(); };
  $('#grpQuick').onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.here != null) { const me = A.me; if (!me) { A.startGPS(true); return A.toast('מאתרת מיקום… ללחוץ שוב בעוד רגע'); }
      return say('אני כאן, בואו 📍', { lat: +me.lat.toFixed(5), lng: +me.lng.toFixed(5) }); }
    say(b.textContent);
  };
  $('#grpMembers').onclick = async e => {
    const k = e.target.closest('[data-kick]');
    if (k) { const id = k.dataset.kick, n = G.members[id]?.n || '';
      if (kickSure !== id) { kickSure = id; k.textContent = 'להסיר? ללחוץ שוב'; return; }   // הרשימה מצוירת מחדש כל כמה שניות, לכן האישור נשמר במשתנה
      kickSure = ''; if (!(await send({ t: 'kick', k: id }))) return A.toast('אין חיבור כרגע. לנסות שוב');
      A.lic?.unseat(id);   // המקום של מי שהוסר מתפנה ברישיון
      delete G.members[id]; (G.out ||= {})[id] = 1; save(); drawFriends(); render(); return A.toast(`${n} הוסר/ה מהקבוצה`); }
    const b = e.target.closest('[data-see]'); if (!b) return; const m = G.members[b.dataset.see]; A.go('map'); setTimeout(() => { A.map?.setView([m.lat, m.lng], 16); drawFriends(); }, 150); };
  $('#grpLeave').onclick = async e => {
    const b = e.currentTarget; if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'לצאת? ללחוץ שוב לאישור'; return; }
    await send({ t: 'bye' }); key = null; connect(); online = false; G = { ...blank(), id: G.id, name: G.name, av: G.av }; save();
    b.dataset.sure = ''; b.textContent = 'יציאה מהקבוצה'; drawFriends(); render();
  };
  A.hooks.licChanged = () => { const b = $('#grpInvite'); if (b) b.hidden = !!A.lic && !A.lic.canInvite(); };
  A.hooks.group = () => { A.hooks.licChanged(); render(); renderTripCard(); pushUI(); if (G.share) A.startGPS(false); };
  // פתיחת הצ׳אט: אם יש הודעות שלא נקראו, נעצרים בקו "הודעות שלא נקראו"; אחרת בסוף
  A.hooks.chat = () => { unread = 0; fresh = false; const i = G.msgs.findIndex(m => m.ur); unreadAt = i < 0 ? null : mkey(G.msgs[i]); limit = Math.max(150, Math.min(600, i < 0 ? 0 : G.msgs.length - i + 10));
    ackRead(); stick = true; render(true); sync(); const d = unreadAt && els.get('unread');
    if (d && d.offsetTop > box.clientHeight / 2) { box.scrollTop = d.offsetTop - 10; stick = gap() < 60; down(); }
    setTimeout(() => fresh = true, 300); };

  // ───── התראות מובנות (Web Push דרך השרת שלנו) ─────
  const b64uToU8 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  async function pushUI() {
    const card = $('#pushNative'); card.hidden = !PUSH_URL; if (!PUSH_URL) return;
    let on = false; try { on = pushSupported() && Notification.permission === 'granted' && !!(await (await navigator.serviceWorker.ready).pushManager.getSubscription()); } catch {}
    $('#pushState').textContent = on ? 'פעילות' : 'כבויות'; $('#pushOn').hidden = on; $('#pushTest').hidden = !on;
    if (!pushSupported()) $('#pushTxt').textContent = 'כדי לקבל התראות באייפון צריך לפתוח את האפליקציה מהאייקון שבמסך הבית (לא מהדפדפן), ו־iOS 16.4 ומעלה.';
    else if (Notification.permission === 'denied') $('#pushTxt').textContent = 'ההתראות חסומות. לאשר בהגדרות הטלפון ← התראות ← ליסבון, ואז לחזור לכאן.';
  }
  async function pushEnable() {
    if (!pushSupported()) return A.toast('צריך לפתוח את האפליקציה מהאייקון שבמסך הבית');
    try {
      if (await Notification.requestPermission() !== 'granted') { pushUI(); return A.toast('לא אושרו התראות'); }
      const reg = await navigator.serviceWorker.ready, key = (await (await fetch(PUSH_URL + '/key')).json()).key;
      const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToU8(key) });
      const r = await fetch(PUSH_URL + '/sub', { method: 'POST', body: JSON.stringify({ g: ntopic, d: G.id, sub: sub.toJSON() }) });
      if (!r.ok) throw 0;
      G.push = true; save(); A.toast('ההתראות פעילות'); pushUI();
    } catch { A.toast('הפעלת ההתראות נכשלה. אפשר לנסות שוב'); }
  }
  $('#pushOn').onclick = pushEnable;
  $('#pushTest').onclick = async () => { try { const r = await (await fetch(PUSH_URL + '/push', { method: 'POST', body: JSON.stringify({ g: ntopic, d: G.id, self: true, title: 'ליסבון שלנו', body: 'התראת ניסיון 🎉', site: location.origin + location.pathname }) })).json(); A.toast(r.sent ? 'נשלחה. היא אמורה לקפוץ תוך שניות' : 'השליחה נכשלה'); } catch { A.toast('השליחה נכשלה'); } };
  // מחדשים את הרישום בשקט בכל פתיחה, למקרה שהמנוי התחלף
  A.hooks.pushOff = async () => { if (PUSH_URL && G.push && ntopic) try { await fetch(PUSH_URL + '/unsub', { method: 'POST', body: JSON.stringify({ g: ntopic, d: G.id }) }); } catch {} };   // כשעוברים לנסיעה אחרת: בלי התראות מהקבוצה הקודמת
  async function pushRefresh() { if (!PUSH_URL || !G.push || !key || !pushSupported() || Notification.permission !== 'granted') return;
    try { const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription(); if (sub) fetch(PUSH_URL + '/sub', { method: 'POST', body: JSON.stringify({ g: ntopic, d: G.id, sub: sub.toJSON() }) }).catch(() => {}); } catch {} }

  $('#avIn').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { G.av = await makeAvatar(f); save(); render(); drawFriends(); A.toast((await send({ t: 'av', av: G.av })) ? 'התמונה נשלחה לקבוצה' : 'התמונה נשמרה, ותישלח כשיהיה חיבור'); } catch { A.toast('לא הצלחנו לקרוא את התמונה'); } };
  $('#avClear').onclick = () => { delete G.av; save(); render(); drawFriends(); send({ t: 'av', av: '' }); };

  renderTripCard();

  // ───── התחלה ─────
  $('#grpName').value = G.name || '';
  // קישור הזמנה (?j=קוד): מי שכבר כתב שם מצטרף מיד, ומי שלא – כותב רק שם
  const alone = matchMedia('(display-mode: standalone)').matches || !!navigator.standalone, iosDev = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const FP = [screen.width, screen.height, window.devicePixelRatio, navigator.language, Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.hardwareConcurrency || 0, navigator.maxTouchPoints || 0].join('|');
  const usedList = () => { try { return (localStorage.getItem('lisboa.jused') || '').split(','); } catch { return []; } };
  function invited(j) {
    if (!/^[A-Za-z0-9-]{6,20}$/.test(j || '')) return;
    if (G.code) { if (norm(G.code) !== norm(j)) setTimeout(() => A.toast('הקישור הוא לקבוצה אחרת. כדי להצטרף אליה צריך קודם לצאת מהקבוצה הנוכחית', 7000), 1500); return; }
    $('#grpCodeIn').value = j;
    if (usedList().includes(norm(j))) return;   // קישור הזמנה מצרף פעם אחת בלבד: מי שיצא או הוסר לא יצורף שוב לבד
    A.go('group');
    if (G.name && alone) return void join(j, G.name, false);   // האפליקציה כבר במסך הבית והשם ידוע: מצטרפים מיד
    if (iosDev && !alone) {
      // באייפון אי אפשר להתקין מתוך האתר: מראים את הצעדים, וההצטרפות נעשית באפליקציה שבמסך הבית.
      // האפליקציה שבמסך הבית לא תמיד נפתחת עם הקוד שבקישור, לכן ההזמנה מחכה לה גם בשרת שלנו, לרבע שעה.
      if (PUSH_URL) fetch(PUSH_URL + '/h/put', { method: 'POST', body: JSON.stringify({ app: APP_ID, fp: FP, j, k: new URLSearchParams(location.search).get('k') || '' }) }).catch(() => {});
      // אם כבר ראו כאן את הצעדים וחזרו לאותו מקום (האייקון פתח שוב את הדפדפן ולא אפליקציה נפרדת), מצטרפים כאן ולא נתקעים
      let seen = ''; try { seen = localStorage.getItem('lisboa.steps') || ''; } catch {}
      if (seen !== norm(j)) { try { localStorage.setItem('lisboa.steps', norm(j)); } catch {} return void setTimeout(() => A.installSteps(true, j), 500); }
    }
    // חלון אחד: שם, ולחיצה אחת שמצרפת לקבוצה (ובאנדרואיד גם מתקינה למסך הבית)
    const dlg = $('#inviteDlg');
    $('#invName').value = G.name || ''; $('#invGo').textContent = alone ? 'הצטרפות לקבוצה' : 'להצטרף ולהתקין'; $('#invQ').hidden = alone;
    $('#invForm').onsubmit = async e => { e.preventDefault(); const name = $('#invName').value.trim(); if (!name) { A.toast('איך קוראים לך?'); return $('#invName').focus(); }
      if (!alone) { const r = await A.installNow(); if (r === 'no') return A.toast('כדי להצטרף צריך להתקין את האפליקציה במסך הבית', 5000); }
      dlg.close(); $('#grpName').value = name; join(j, name, false); };
    setTimeout(() => { if (!dlg.open) dlg.showModal(); }, 500);
  }
  const jLink = new URLSearchParams(location.search).get('j') || location.hash.match(/^#join-([A-Za-z0-9-]+)/)?.[1];
  let stepsFor = ''; try { stepsFor = localStorage.getItem('lisboa.steps') || ''; } catch {}
  if (jLink) invited(jLink);
  else if (!G.code && stepsFor && !usedList().includes(stepsFor)) invited(stepsFor.replace(/(.{4})(?=.)/g, '$1-'));   // האייקון נפתח בלי הקוד, באותו אחסון: ממשיכים מאיפה שעצרו
  else if (alone && iosDev && !G.code && PUSH_URL) {   // האפליקציה שבמסך הבית נפתחה בלי קוד: בודקים אם מחכה לה הזמנה מהדפדפן
    let asked = 0; try { asked = +localStorage.getItem('lisboa.hand') || 0; } catch {}
    if (asked < 6) { try { localStorage.setItem('lisboa.hand', String(asked + 1)); } catch {}
      const ask = n => fetch(PUSH_URL + '/h/get', { method: 'POST', body: JSON.stringify({ app: APP_ID, fp: FP }) }).then(r => r.json()).then(async r => {
        if (G.code) return;
        if (!r || !r.j) { if (n < 2) setTimeout(() => ask(n + 1), 4000); return; }   // ההזמנה עוד לא הגיעה לשרת: מנסים שוב
        try { localStorage.setItem('lisboa.hand', '9'); } catch {}
        if (r.k && A.lic) await A.lic.use(r.k);
        invited(r.j); }).catch(() => {});
      ask(0); }
  }
  render(); sync(); if (!$('#v-chat').hidden) A.hooks.chat();
  if (G.code) derive(G.code).then(() => { connect(); if (G.share) A.startGPS(false); pushRefresh(); render(); });
  pushUI();
  setInterval(() => { if ((!$('#v-group').hidden || !$('#v-chat').hidden) && G.code) render(); }, 60000);
})();

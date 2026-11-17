/* יומן תמונות + מפה לאוף־ליין */
(() => {
  const A = window.APP, $ = s => document.querySelector(s), esc = A.esc;
  const QUICK_TAGS = TRIP.tags;   // לפי סוג הקבוצה ושם הנסיעה

  // ───── אחסון: IndexedDB (התמונות נשמרות בטלפון) ─────
  const dbp = new Promise((res, rej) => {
    const r = indexedDB.open('lisboa-journal', 2);
    r.onupgradeneeded = () => ['entries', 'docs'].forEach(n => r.result.objectStoreNames.contains(n) || r.result.createObjectStore(n, { keyPath: 'id' }));
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn, store = 'entries') => { const db = await dbp; return new Promise((res, rej) => {
    const t = db.transaction(store, mode), rq = fn(t.objectStore(store));
    t.oncomplete = () => res(rq && rq.result); t.onerror = t.onabort = () => rej(t.error); }); };
  // כל רשומה שייכת לנסיעה אחת. רשומות ישנות, מלפני שהיו כמה נסיעות, שייכות לנסיעה הראשונה
  let CUR = 't1'; try { CUR = JSON.parse(localStorage.getItem('lisboa.trips') || '{}').cur || 't1'; } catch {}
  const raw = () => tx('readonly', s => s.getAll());
  const all = () => raw().then(l => l.filter(e => (e.trip || 't1') === CUR));
  const put = e => { e.trip ||= CUR; return tx('readwrite', s => s.put(e)); };
  const del = id => tx('readwrite', s => s.delete(id));
  const get = id => tx('readonly', s => s.get(id));
  // שני יומנים: האישי ('me') והמשותף ('us'). רשומה יכולה להיות באחד מהם או בשניהם
  let jtab = 'me'; try { jtab = localStorage.getItem('lisboa.jtab') === 'us' ? 'us' : 'me'; } catch {}
  const inGroup = () => !!A.hooks.inGroup?.();
  const inMe = e => e.byId ? e.personal === true : e.personal !== false;
  const inUs = e => !!e.byId || !!e.shared;
  navigator.storage?.persist?.().catch(() => {});

  async function shrink(file, max = 1600) {
    let src, w, h;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); w = src.width; h = src.height; }
    catch { src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); w = src.naturalWidth; h = src.naturalHeight; }
    const k = Math.min(1, max / Math.max(w, h)), c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return new Promise(res => c.toBlob(b => res(b || file), 'image/jpeg', .85));
  }

  // סרטונים: נשמרים בטלפון כמו שצולמו. ליומן המשותף עוברים רק קצרים, כי השרת מקבל קובץ עד 15 מ״ב
  const V_SHARE = 14e6, V_LOCAL = 300e6;
  const media = x => x.type === 'photo' || x.type === 'video';
  const mmss = s => isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '';
  function poster(blob) {   // תמונת פתיחה מהסרטון. מחזירה null אם הדפדפן לא יודע לפענח אותו
    return new Promise(res => { const v = document.createElement('video'), u = URL.createObjectURL(blob); let done = false;
      const fin = x => { if (done) return; done = true; URL.revokeObjectURL(u); res(x); };
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = u;
      v.onloadeddata = () => { try { v.currentTime = Math.min(0.6, (v.duration || 1) / 2); } catch { fin(null); } };
      v.onloadedmetadata = () => { const pl = v.play(); if (pl && pl.then) pl.then(() => v.pause(), () => {}); };   // באייפון הסרטון לא מפענח תמונה עד שמנגנים אותו לרגע
      v.onseeked = () => { try { const k = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight)), c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); c.toBlob(b => fin(b ? { blob: b, w: c.width, h: c.height, dur: v.duration } : null), 'image/jpeg', .8); } catch { fin(null); } };
      v.onerror = () => fin(null); setTimeout(() => fin(null), 9000); v.load(); });
  }
  async function addVideo(f, ts) {
    if (f.size > V_LOCAL) { A.toast('הסרטון גדול מדי לשמירה באפליקציה (עד 300 מ״ב). עדיף להשאיר אותו בגלריה', 5000); return null; }
    const p = await poster(f);
    const e = newEntry('video', { blob: f, mime: f.type || 'video/mp4', size: f.size, poster: p?.blob, w: p?.w, h: p?.h, dur: p?.dur, ...(ts ? { ts, place: '', lat: undefined, lng: undefined } : {}) });
    await put(e); return e;
  }

  // תיוג מיידי: המקום הקרוב ביותר למיקום הנוכחי
  function nearest() {
    const me = A.me; if (!me) return '';
    if (A.S.hotel && A.km(me, A.S.hotel) < .12) return 'hotel';
    const best = PLACES.map(p => [A.km(me, p), p.id]).sort((a, b) => a[0] - b[0])[0];
    return best && best[0] < .3 ? best[1] : '';
  }
  const placeName = id => id === '@' ? 'מיקום במפה' : id === 'hotel' ? (A.S.hotel?.name || 'המלון') : A.byId[id]?.he || '';
  const time = ts => new Date(ts).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' });
  const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

  let urls = [], entries = [], cur = null;
  async function render() {
    let everything; try { everything = await all(); } catch { everything = []; }
    urls.forEach(URL.revokeObjectURL); urls = [];
    const body = $('#jrBody'), us = jtab === 'us';
    $('#jrTabMe').classList.toggle('on', !us); $('#jrTabUs').classList.toggle('on', us);
    $('#jrNMe').textContent = everything.filter(inMe).length || ''; $('#jrNUs').textContent = everything.filter(inUs).length || '';
    $('#jrTitle').textContent = us ? 'היומן שלנו' : 'היומן שלי';
    $('#jrKicker').textContent = us ? 'משותף לכל הקבוצה' : 'אישי · רק בטלפון שלך';
    $('#jrShowTxt').textContent = us ? 'מצגת משותפת' : 'מצגת הטיול';
    document.querySelector('#v-journal').classList.toggle('us', us);
    entries = everything.filter(us ? inUs : inMe);
    if (us && !inGroup()) { body.innerHTML = `<div class="jr-empty"><p>היומן המשותף נפתח כשמצטרפים לקבוצה.<br>כל תמונה שנוספת כאן מופיעה אצל כל הקבוצה.</p><button class="btn" data-go="group" type="button">לקבוצה</button></div>`; return; }
    if (!entries.length) {
      body.innerHTML = `<div class="jr-empty"><div class="pol"><span class="tape"></span><div class="ph-img">🏛️</div><span class="cap">${us ? 'התמונה הראשונה של הקבוצה' : 'התמונה הראשונה שלך'}</span></div>
        <p>${us ? 'כאן נאסף הטיול של כל הקבוצה.<br>מה שמצלמים כאן מופיע אצל כולם.' : 'כאן נכתב הטיול שלך.<br>מה שמצלמים כאן נשאר רק אצלך, אלא אם מסמנים אחרת.'}</p></div>`;
      return;
    }
    const groups = {};
    entries.sort((a, b) => a.ts - b.ts).forEach(e => (groups[dayKey(e.ts)] ||= []).push(e));
    const t0 = A.dayDate(0); t0.setHours(0, 0, 0, 0);
    body.innerHTML = Object.values(groups).reverse().map(g => {
      const d = new Date(g[0].ts), n = Math.floor((d - t0) / 864e5) + 1;
      const title = n >= 1 && n <= A.S.days ? `יום ${n}` : d.toLocaleDateString(LOC, { day: 'numeric', month: 'long' });
      return `<h2 class="jr-day">${title}<small>${A.fmtDay(d)} ${A.fmtDate(d)} · ${g.length} רגעים</small></h2><div class="jr-grid">` + g.map(e => {
        const meta = `<span class="loc">${e.place ? '📍 ' + esc(placeName(e.place)) + ' · ' : ''}${time(e.ts)}${e.by ? ' · ' + esc(e.by) : ''}${!us && inUs(e) ? ' · גם במשותף' : us && inMe(e) ? ' · גם באישי' : ''}</span>${e.tags?.length ? `<span class="hash">${e.tags.map(t => '#' + esc(t)).join(' ')}</span>` : ''}`;
        if (e.type === 'note') return `<button class="note" data-id="${e.id}"><span translate="no">${esc(e.text)}</span>${meta}</button>`;
        if (!e.blob) return `<button class="pol" data-id="${e.id}"><span class="tape"></span><span class="ph-wait">${e.type === 'video' ? 'הסרטון' : 'התמונה'} של ${esc(e.by || '')} בדרך…</span>${meta}</button>`;
        if (e.type === 'video') { const pu = e.poster ? URL.createObjectURL(e.poster) : ''; if (pu) urls.push(pu);
          return `<button class="pol vid" data-id="${e.id}"><span class="tape"></span><span class="vwrap">${pu ? `<img src="${pu}" alt="" loading="lazy" width="${e.w || 4}" height="${e.h || 3}">` : '<span class="vblank">🎬</span>'}<span class="vplay">▶ ${mmss(e.dur)}</span></span>${e.text ? `<span class="cap" translate="no">${esc(e.text)}</span>` : ''}${meta}</button>`; }
        const u = URL.createObjectURL(e.blob); urls.push(u);
        return `<button class="pol" data-id="${e.id}"><span class="tape"></span><img src="${u}" alt="" loading="lazy" width="${e.w || 4}" height="${e.h || 3}">${e.text ? `<span class="cap" translate="no">${esc(e.text)}</span>` : ''}${meta}</button>`;
      }).join('') + '</div>';
    }).join('');
  }
  A.hooks.journal = render;
  A.journal = { get, put, del, all, raw, render, shrink, poster: b => poster(b) };

  // ───── עורך ─────
  let editUrl = null;
  let posterUrl = '';
  function openEditor(e) {
    cur = e;
    const me = A.me, wrap = $('#entryImgWrap');
    if (editUrl) URL.revokeObjectURL(editUrl);
    wrap.hidden = !media(e) || !e.blob;
    const vid = $('#entryVid'), isV = e.type === 'video'; vid.pause(); vid.hidden = !isV; $('#entryImg').hidden = isV;
    if (media(e) && e.blob) { editUrl = URL.createObjectURL(e.blob);
      if (isV) { if (posterUrl) URL.revokeObjectURL(posterUrl); posterUrl = e.poster ? URL.createObjectURL(e.poster) : ''; vid.poster = posterUrl; vid.style.aspectRatio = e.w && e.h ? `${e.w} / ${e.h}` : '16 / 9'; vid.src = editUrl + '#t=0.1'; }   // #t: באייפון מציג את התמונה הראשונה גם לפני ניגון
      else $('#entryImg').src = editUrl; }
    const vMax = Math.max(V_SHARE, A.hooks.shareMax?.() || 0), tooBig = isV && (e.size || e.blob?.size || 0) > vMax;
    $('#entryVidNote').hidden = !tooBig; $('#entryVidNote').textContent = tooBig ? `סרטון ארוך מאוד נשמר רק ביומן האישי. לקבוצה אפשר לשתף סרטון של עד ${Math.round(vMax / 1e6)} מ״ב, בערך דקה.` : '';
    $('#entryText').value = e.text || '';
    const ref = e.lat ? e : me;
    const list = [...PLACES].sort((a, b) => ref ? A.km(ref, a) - A.km(ref, b) : a.he.localeCompare(b.he, 'he'));
    $('#entryPlace').innerHTML = '<option value="">בלי מיקום</option><option value="@">📍 המיקום הנוכחי</option>' + (A.S.hotel ? `<option value="hotel">🏨 ${esc(A.S.hotel.name)}</option>` : '') +
      list.map(p => `<option value="${p.id}">${CATS[p.cat].emoji} ${esc(p.he)}${ref ? ' · ' + A.distTxt(A.km(ref, p)) : ''}</option>`).join('');
    $('#entryPlace').value = e.place || '';
    const mapLink = () => { const a = $('#entryMapLink'), on = $('#entryPlace').value === '@' && cur.place === '@' && cur.lat; a.hidden = !on; if (on) a.href = `https://www.google.com/maps/search/?api=1&query=${cur.lat},${cur.lng}`; };
    mapLink();
    $('#entryPlace').onchange = () => {   // "המיקום הנוכחי": שומרים את הנקודה שבה הטלפון נמצא עכשיו
      if ($('#entryPlace').value === '@') { const me = A.me;
        if (!me) { $('#entryPlace').value = cur.place === '@' ? '@' : cur.place || ''; A.startGPS(true); A.toast('אין עדיין מיקום. לאשר שירותי מיקום ולנסות שוב', 5000); }
        else { cur.lat = me.lat; cur.lng = me.lng; cur.place = '@'; A.toast('המיקום הנוכחי נשמר'); } }
      mapLink();
    };
    drawTags();
    const canShare = !!A.hooks.inGroup?.() && !e.byId;
    const fresh = e.personal === undefined && e.shared === undefined;   // רשומה חדשה: ברירת המחדל לפי היומן שפתוח עכשיו
    $('#entryShareRow').hidden = !canShare || tooBig; $('#entryShared').checked = canShare && (fresh ? jtab === 'us' : !!e.shared);
    $('#entryPersonal').checked = fresh ? !(jtab === 'us' && canShare) : inMe(e);
    $('#entryPersonalTxt').textContent = e.byId ? 'לשמור גם ביומן האישי שלי' : 'ביומן האישי שלי';
    $('#entryDel').textContent = 'מחיקה'; $('#entryDel').dataset.sure = '';
    $('#entryShare').hidden = !media(e) || !e.blob || !navigator.share;
    $('#entryDlg').showModal(); $('#entryText').blur();   // בלי מקלדת עד שנוגעים בשדה הכתיבה
  }
  function drawTags() { $('#entryTags').innerHTML = QUICK_TAGS.map(t => `<button type="button" class="tag ${cur.tags.includes(t) ? 'on' : ''}" data-t="${t}">#${t}</button>`).join(''); }
  $('#entryTags').onclick = ev => { const t = ev.target.dataset.t; if (!t) return; const i = cur.tags.indexOf(t); i < 0 ? cur.tags.push(t) : cur.tags.splice(i, 1); drawTags(); };
  $('#entryForm').onsubmit = async () => {
    cur.text = $('#entryText').value.trim(); cur.place = $('#entryPlace').value;
    if (cur.type === 'note' && !cur.text) return;
    const own = !cur.byId, was = !!cur.shared; let per = $('#entryPersonal').checked, share = own && inGroup() && $('#entryShared').checked && !$('#entryShareRow').hidden;
    if (own && !per && !share) { if (jtab === 'us' && inGroup()) share = true; else per = true; }   // רשומה חייבת להיות לפחות ביומן אחד
    cur.personal = per; if (own) cur.shared = share;
    try { await put(cur); A.toast(share ? 'נשמר ונשלח לקבוצה…' : own ? 'נשמר ביומן האישי' : 'נשמר'); } catch { A.toast('השמירה נכשלה – ייתכן שאין מקום פנוי בטלפון'); }
    if (share) A.hooks.shareEntry?.(cur, !was).then(ok => A.toast(ok ? (per ? 'מופיע בשני היומנים' : 'מופיע ביומן המשותף') : 'נשמר אצלך, אבל השיתוף נכשל. כדאי לשמור שוב כשיש קליטה'));
    else if (own && was) A.hooks.unshareEntry?.(cur.id);
    render();
  };
  $('#entryDel').onclick = async ev => {
    const b = ev.currentTarget;
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'למחוק? ללחוץ שוב לאישור'; return; }
    await del(cur.id).catch(() => {}); if (cur.shared && !cur.byId) A.hooks.unshareEntry?.(cur.id); $('#entryDlg').close(); render();
  };
  $('#entryShare').onclick = () => {
    const isV = cur.type === 'video', mime = isV ? cur.mime || cur.blob.type || 'video/mp4' : 'image/jpeg', ext = isV ? (/quicktime/.test(mime) ? 'mov' : /webm/.test(mime) ? 'webm' : 'mp4') : 'jpg';
    const f = new File([cur.blob], `lisbon-${cur.id}.${ext}`, { type: mime }), text = $('#entryText').value.trim();
    const data = navigator.canShare?.({ files: [f] }) ? { files: [f], text } : { text };
    navigator.share(data).catch(() => {});
  };
  $('#jrBody').onclick = ev => { const b = ev.target.closest('[data-id]'); if (!b) return; const e = entries.find(x => x.id === b.dataset.id); if (e) openEditor(e); };

  const newEntry = (type, extra) => { const me = A.me; return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: Date.now(), type, text: '', tags: [], place: nearest(), lat: me?.lat, lng: me?.lng, ...extra }; };

  // צילום: נשמר מיד עם שעה ומקום, ואז נפתח להוספת מילים
  $('#camIn').onchange = async ev => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    try {
      const blob = await shrink(f), bmp = await createImageBitmap(blob).catch(() => null);
      const e = newEntry('photo', { blob, w: bmp?.width, h: bmp?.height });
      await put(e); await render(); openEditor(e);
    } catch { A.toast('לא הצלחנו לשמור את התמונה'); }
  };
  // צילום סרטון: נשמר ביומן האישי, ואפשר לשתף אותו אם הוא קצר
  $('#vidIn').onchange = async ev => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    A.toast('שומרת את הסרטון…', 20000);
    try { const e = await addVideo(f); if (!e) return; await render(); A.toast('הסרטון נשמר'); openEditor(e); } catch { A.toast('לא הצלחנו לשמור את הסרטון. ייתכן שאין מקום פנוי בטלפון'); }
  };
  $('#entryDlg').addEventListener('close', () => $('#entryVid').pause());
  // העלאה מהגלריה: כמה תמונות בבת אחת, לפי תאריך הצילום
  $('#upIn').onchange = async ev => {
    const files = [...ev.target.files]; ev.target.value = ''; if (!files.length) return;
    A.toast(`מוסיפה ${files.length} קבצים…`, 60000); let ok = 0, last;
    for (const f of files) try {
      if (/^video\//.test(f.type) || /\.(mp4|mov|m4v|webm)$/i.test(f.name || '')) {
        last = await addVideo(f, f.lastModified || Date.now()); if (!last) continue;
        if (jtab === 'us' && inGroup() && f.size <= Math.max(V_SHARE, A.hooks.shareMax?.() || 0)) { last.shared = true; last.personal = false; } else { last.shared = false; last.personal = true; }
        await put(last); ok++; if (last.shared) await A.hooks.shareEntry?.(last, true); continue;
      }
      const blob = await shrink(f), bmp = await createImageBitmap(blob).catch(() => null);
      last = newEntry('photo', { blob, w: bmp?.width, h: bmp?.height, ts: f.lastModified || Date.now(), place: '', lat: undefined, lng: undefined });
      if (jtab === 'us' && inGroup()) { last.shared = true; last.personal = false; } else { last.shared = false; last.personal = true; }
      await put(last); ok++; if (last.shared) await A.hooks.shareEntry?.(last, true);
    } catch {}
    await render();
    A.toast(ok ? `נוספו ${ok} קבצים. לחיצה על תמונה או סרטון מוסיפה מילים ומיקום` : 'לא הצלחנו להוסיף את הקבצים');
    if (ok === 1) openEditor(last);
  };
  const setTab = t => { jtab = t; try { localStorage.setItem('lisboa.jtab', t); } catch {} render(); };
  $('#jrTabMe').onclick = () => setTab('me'); $('#jrTabUs').onclick = () => setTab('us');
  A.journal.tab = () => jtab; A.journal.inMe = inMe; A.journal.inUs = inUs;
  $('#jrNote').onclick = () => openEditor(newEntry('note'));

  // ───── מפה לאוף־ליין ─────
  const OFF_KEY = 'lisboa.offline2';
  const AREAS = [ // [דרום, מערב, צפון, מזרח, זום מינימלי, זום מקסימלי]
    [38.62, -9.50, 38.84, -9.05, 11, 14],     // כל האזור: בלם, קשקאיש, סינטרה, שדה התעופה, פארק האומות
    [38.690, -9.230, 38.745, -9.105, 15, 16], // העיר: מבלם עד אלפמה ועד שדרות ליברדאדה
    [38.705, -9.155, 38.722, -9.125, 17, 17], // הליבה ההליכתית ברמת רחוב: באישה, שיאדו, באירו אלטו, אלפמה
  ];
  const tx2 = (lng, z) => Math.floor((lng + 180) / 360 * 2 ** z);
  const ty2 = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
  function tileList() {
    const out = new Set();
    for (const [s, w, n, e, z0, z1] of AREAS) for (let z = z0; z <= z1; z++)
      for (let x = tx2(w, z); x <= tx2(e, z); x++) for (let y = ty2(n, z); y <= ty2(s, z); y++) out.add(A.tileUrl(z, x, y));
    return [...out];
  }
  function offUI(msg) {
    let st = null; try { st = JSON.parse(localStorage.getItem(OFF_KEY)); } catch {}
    $('#offState').textContent = st ? 'שמורה בטלפון' : 'עוד לא הורדה';
    $('#offBtn').textContent = st ? 'הורדה מחדש' : 'הורדת המפה';
    $('#offMsg').textContent = msg ?? (st ? `${st.n} קבצים · ${new Date(st.t).toLocaleDateString(LOC)}` : '');
  }
  let busy = false;
  $('#offBtn').onclick = async () => {
    if (busy) return;
    if (!('caches' in window)) return offUI('הדפדפן הזה לא תומך בשמירה לאוף־ליין');
    if (!navigator.onLine) return offUI('צריך חיבור לאינטרנט כדי להוריד');
    busy = true; const bar = $('#offBar'); bar.hidden = false; bar.value = 0;
    const list = [...tileList(), ...A.imgs], cache = await caches.open('lisboa-tiles2'); let done = 0, ok = 0;
    const work = async () => { while (list.length) { const u = list.pop();
      try { if (await cache.match(u)) ok++; else { const r = await fetch(u, { mode: 'cors' }); if (r.ok) { await cache.put(u, r); ok++; } } } catch {}
      done++; if (done % 8 === 0) { bar.value = done / total * 100; $('#offMsg').textContent = `${Math.round(done / total * 100)}%`; } } };
    const total = list.length;
    await Promise.all(Array.from({ length: 6 }, work));
    bar.hidden = true; busy = false;
    if (ok > total * .9) { try { localStorage.setItem(OFF_KEY, JSON.stringify({ n: ok, t: Date.now() })); } catch {} offUI(); A.toast('המפה שמורה בטלפון ותעבוד גם בלי אינטרנט'); }
    else offUI(`ירדו רק ${ok} מתוך ${total}. אפשר לנסות שוב בחיבור יציב`);
  };
  offUI();

  // ───── פרטים אישיים ומסמכים ─────
  const M = A.S.me ||= {};
  document.querySelectorAll('#meForm [data-k]').forEach(i => { i.value = M[i.dataset.k] || ''; i.oninput = () => { M[i.dataset.k] = i.value.trim(); A.save(); meNote(); }; });
  function meNote() {
    const out = [], tel = (n, l) => n ? `<a class="btn ghost sm" href="tel:${esc(n.replace(/[^+\d]/g, ''))}">${l}</a>` : '';
    if (M.passExp) {
      const end = A.dayDate(A.S.days - 1), exp = new Date(M.passExp + 'T12:00'), months = (exp - end) / (864e5 * 30.4);
      if (months < 3) out.push(`<div class="alert"><b>תוקף הדרכון קצר מדי</b>לכניסה ליוון הדרכון צריך להיות בתוקף לפחות שלושה חודשים אחרי מועד היציאה. כדאי לברר מיד.</div>`);
      else if (months < 6) out.push(`<div class="alert"><b>לתשומת לב: תוקף הדרכון</b>נשארו פחות משישה חודשים. ליוון זה מספיק, אבל חברת התעופה עשויה לשאול.</div>`);
    }
    const calls = tel(M.insTel, 'חיוג למוקד הביטוח') + tel(M.iceTel, `חיוג ל${esc(M.ice || 'איש הקשר')}`);
    if (calls) out.push(`<div class="row">${calls}</div>`);
    $('#meNote').innerHTML = out.join('');
  }
  meNote();

  const dAll = () => tx('readonly', s => s.getAll(), 'docs'), dPut = d => tx('readwrite', s => s.put(d), 'docs'), dDel = id => tx('readwrite', s => s.delete(id), 'docs');
  let docs = [], docUrls = [], curDoc = null, docUrl = null;
  async function renderDocs() {
    try { docs = await dAll(); } catch { docs = []; }
    docUrls.forEach(URL.revokeObjectURL); docUrls = [];
    $('#docGrid').innerHTML = docs.sort((a, b) => a.ts - b.ts).map(d => { const u = URL.createObjectURL(d.blob); docUrls.push(u);
      return `<button class="doc" data-doc="${d.id}"><img src="${u}" alt=""><span>${esc(d.label)}</span></button>`; }).join('');
  }
  async function addDoc(ev) {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    try { await dPut({ id: Date.now().toString(36), ts: Date.now(), label: $('#docType').value, blob: await shrink(f, 2200) }); await renderDocs(); A.toast('המסמך נשמר בטלפון'); }
    catch { A.toast('לא הצלחנו לשמור את המסמך'); }
  }
  $('#docCam').onchange = addDoc; $('#docUp').onchange = addDoc;
  $('#docGrid').onclick = ev => { const b = ev.target.closest('[data-doc]'); if (!b) return; curDoc = docs.find(d => d.id === b.dataset.doc); if (!curDoc) return;
    if (docUrl) URL.revokeObjectURL(docUrl); $('#docImg').src = docUrl = URL.createObjectURL(curDoc.blob); $('#docTitle').textContent = curDoc.label;
    $('#docDel').textContent = 'מחיקה'; $('#docDel').dataset.sure = ''; $('#docShare').hidden = !navigator.share; $('#docDlg').showModal(); };
  $('#docClose').onclick = () => $('#docDlg').close();
  $('#docDel').onclick = async ev => { const b = ev.currentTarget; if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'למחוק? ללחוץ שוב לאישור'; return; }
    await dDel(curDoc.id).catch(() => {}); $('#docDlg').close(); renderDocs(); };
  $('#docShare').onclick = () => { const f = new File([curDoc.blob], 'document.jpg', { type: 'image/jpeg' }); if (navigator.canShare?.({ files: [f] })) navigator.share({ files: [f] }).catch(() => {}); };
  renderDocs();

  document.addEventListener('click', ev => { const j = ev.target.closest('[data-jump]'); if (!j) return; A.go('more');
    const el = document.getElementById(j.dataset.jump); if (el.tagName === 'DETAILS') el.open = true; el.scrollIntoView({ block: 'start' }); });
  if (location.hash === '#journal') render();
})();

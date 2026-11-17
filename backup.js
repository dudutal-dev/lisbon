/* גיבוי תמונות היומן: שמירה לגלריה / לקבצים, הורדת הכול כ־ZIP, וגיבוי (או תזכורת) כל 3 שעות */
(() => {
  const A = window.APP, $ = s => document.querySelector(s);
  const EVERY = 3 * 3600e3, LS = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const autoOn = () => LS.get('lisboa.bkAuto') !== '0';
  const placeName = id => id === '@' ? 'מיקום במפה' : id === 'hotel' ? (A.S.hotel?.name || 'המלון') : A.byId[id]?.he || '';
  const pad = n => String(n).padStart(2, '0');
  const stamp = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`; };
  const photos = async () => (await A.journal.all().catch(() => [])).filter(e => e.type === 'photo' && e.blob).sort((a, b) => a.ts - b.ts);

  // ───── ZIP בלי דחיסה (התמונות כבר דחוסות) ─────
  const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = u => { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = crcT[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), d = f.date || new Date();
      const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
      const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, f.data.length, true); lh.setUint32(22, f.data.length, true); lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, f.data);
      const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, f.data.length, true); ch.setUint32(24, f.data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
      central.push(new Uint8Array(ch.buffer), name); off += 30 + name.length + f.data.length;
    }
    const csize = central.reduce((n, x) => n + x.length, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }
  const fileName = (e, i) => `athens_${stamp(e.ts)}_${pad(i + 1)}.jpg`;
  async function makeZips(list, label) {   // עד 60 תמונות בקובץ, כדי לא להעמיס על זיכרון הטלפון
    const out = [];
    for (let i = 0; i < list.length; i += 60) {
      const chunk = list.slice(i, i + 60), files = [];
      for (const [k, e] of chunk.entries()) files.push({ name: fileName(e, i + k), data: new Uint8Array(await e.blob.arrayBuffer()), date: new Date(e.ts) });
      const txt = chunk.map((e, k) => `${fileName(e, i + k)}\n${new Date(e.ts).toLocaleString(LOC)}${e.place ? ' · ' + placeName(e.place) : ''}${e.by ? ' · צילמה ' + e.by : ''}\n${e.text || ''}\n${(e.tags || []).map(t => '#' + t).join(' ')}\n`).join('\n');
      files.push({ name: 'יומן.txt', data: new TextEncoder().encode('﻿' + txt), date: new Date() });
      const part = list.length > 60 ? `_${i / 60 + 1}` : '';
      out.push(new File([zip(files)], `lisbon-${label}-${stamp(Date.now()).slice(0, 10)}${part}.zip`, { type: 'application/zip' }));
    }
    return out;
  }
  function download(file) { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); }
  // מחזיר true אם הקבצים נמסרו (שיתוף שהושלם או הורדה)
  async function deliver(files) {
    if (navigator.canShare?.({ files })) { try { await navigator.share({ files }); return true; }
      catch (e) { if (e?.name === 'AbortError') return false;
        if (e?.name === 'NotAllowedError') { ready = files; A.toast('הגיבוי מוכן. ללחוץ שוב כדי לשמור'); return false; }   // עבר זמן מהלחיצה: שומרים את הקבצים, והלחיצה הבאה משתפת מיד
        files.forEach(download); return true; } }
    files.forEach(download); return true;
  }
  async function mark(list) { const t = Date.now(); for (const e of list) { e.bk = t; await A.journal.put(e).catch(() => {}); } LS.set('lisboa.bkLast', String(t)); refresh(); }

  // ───── פעולות ─────
  let busy = false, ready = null, readyList = null;
  async function backupNew(viaGesture) {
    if (busy) return;
    if (viaGesture && ready) { const f = ready, l = readyList; ready = null; try { await navigator.share({ files: f }); await mark(l); A.toast(`גובו ${l.length} תמונות`); } catch {} return; }
    busy = true;
    try {
      const todo = (await photos()).filter(e => !e.bk);
      if (!todo.length) { if (viaGesture) A.toast('הכול כבר מגובה'); LS.set('lisboa.bkLast', String(Date.now())); return refresh(); }
      if (viaGesture) say('מכינה את הגיבוי…');
      // עד 20 תמונות: כקובצי תמונה, כדי שאפשר יהיה לשמור ישר לגלריה. יותר מזה: ZIP אחד
      const asImages = viaGesture && todo.length <= 20 && navigator.canShare?.({ files: [new File([todo[0].blob], 'a.jpg', { type: 'image/jpeg' })] });
      const files = asImages ? todo.map((e, i) => new File([e.blob], fileName(e, i), { type: 'image/jpeg' })) : await makeZips(todo, 'backup');
      say('');
      if (viaGesture) { readyList = todo; if (await deliver(files)) { await mark(todo); A.toast(`גובו ${todo.length} תמונות`); } }
      else { files.forEach(download); await mark(todo); A.toast(`גיבוי אוטומטי: ${todo.length} תמונות נשמרו בתיקיית ההורדות`, 5000); }
    } catch { say(''); A.toast('הגיבוי נכשל. אפשר לנסות שוב'); } finally { busy = false; }
  }
  async function downloadAll() {
    if (busy) return; busy = true;
    try { const all = await photos(); if (!all.length) return A.toast('אין עדיין תמונות ביומן');
      say(`מכינה ${all.length} תמונות…`); const files = await makeZips(all, 'all'); say('');
      if (await deliver(files)) { await mark(all); A.toast(`${all.length} תמונות בקובץ אחד`); }
    } catch { say(''); A.toast('ההורדה נכשלה. אפשר לנסות שוב'); } finally { busy = false; }
  }
  const say = t => { const el = $('#bkMsg'); el.textContent = t; el.hidden = !t; };

  // ───── מצב, תזכורת וגיבוי אוטומטי ─────
  async function refresh() {
    const all = await photos(), todo = all.filter(e => !e.bk).length, last = +LS.get('lisboa.bkLast') || 0;
    $('#bkCount').textContent = todo || ''; $('#bkCount').hidden = !todo;
    $('#bkState').innerHTML = all.length ? `<b>${all.length}</b> תמונות ביומן · ${todo ? `<b>${todo}</b> עוד לא גובו` : 'הכול מגובה'}${last ? ` · גיבוי אחרון ${new Date(last).toLocaleString(LOC, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}` : 'אין עדיין תמונות ביומן.';
    $('#bkNew').textContent = todo ? `גיבוי ${todo} התמונות החדשות` : 'אין תמונות חדשות לגיבוי'; $('#bkNew').disabled = !todo;
    $('#bkAuto').checked = autoOn();
    $('#bkAutoTxt').textContent = IOS ? 'תזכורת לגיבוי כל 3 שעות' : 'גיבוי אוטומטי לתיקיית ההורדות כל 3 שעות';
    $('#bkNote').textContent = IOS ? 'באייפון אפליקציה לא יכולה לשמור קבצים לבד, בלי לחיצה. לכן כל 3 שעות תופיע תזכורת, ולחיצה אחת שומרת את התמונות החדשות לגלריה או ל"קבצים".' : 'כשהאפליקציה פתוחה, התמונות החדשות נשמרות לבד לתיקיית ההורדות כל 3 שעות.';
    return { todo, last };
  }
  async function tick() {
    if (!autoOn() || busy || document.hidden) return;
    const { todo, last } = await refresh();
    if (todo && !last && !LS.get('lisboa.bkFirst')) LS.set('lisboa.bkFirst', String(Date.now()));   // השעון מתחיל מהתמונה הראשונה שלא גובתה
    const due = todo && Date.now() - (last || +LS.get('lisboa.bkFirst')) >= EVERY;
    const bar = $('#bkBanner');
    if (!due) { bar.hidden = true; return; }
    if (IOS) { $('#bkBannerTxt').textContent = `${todo} תמונות עוד לא גובו`; bar.hidden = false; }
    else backupNew(false);
  }
  $('#bkOpen').onclick = async () => { await refresh(); $('#bkDlg').showModal(); };
  $('#bkNew').onclick = () => backupNew(true);
  $('#bkAll').onclick = downloadAll;
  $('#bkBannerBtn').onclick = async () => { await backupNew(true); $('#bkBanner').hidden = true; };
  $('#bkBannerX').onclick = () => { $('#bkBanner').hidden = true; LS.set('lisboa.bkLast', String(Date.now())); };   // "אחר כך": תזכורת שוב בעוד 3 שעות
  $('#bkAuto').onchange = e => { LS.set('lisboa.bkAuto', e.target.checked ? '1' : '0'); tick(); };
  $('#bkClose').onclick = () => $('#bkDlg').close();
  const jr = A.hooks.journal; A.hooks.journal = () => { jr?.(); refresh(); tick(); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  setInterval(tick, 5 * 60e3); setTimeout(tick, 4000);
  A.backup = { zip, refresh, tick };
})();

/* מצגת הטיול: נבנית מהיומן לפי סדר הצילום, מוצגת במסך מלא, ונשמרת כ־PDF או כתמונות לשיתוף.
   שלושה מקורות: היומן האישי, היומן המשותף, או הכול. */
(() => {
  const A = window.APP, $ = s => document.querySelector(s);
  const FONT = { d: '"Frank Ruhl Libre", serif', h: LANG === 'he' ? '"Gveret Levin", "Assistant", cursive' : 'Caveat, "Gveret Levin", cursive', b: 'Assistant, system-ui, sans-serif' };
  const BLUE1 = '#06492b', BLUE2 = '#12915a', PINK = '#ff8a7a', GOLD = '#f7c531';
  const placeName = id => id === '@' ? 'מיקום במפה' : id === 'hotel' ? (A.S.hotel?.name || 'המלון') : A.byId[id]?.he || '';
  const hm = ts => new Date(ts).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' });
  const longDate = d => d.toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long' });

  // ───── כלי ציור ─────
  const loadImg = blob => new Promise((res, rej) => { const i = new Image(), u = URL.createObjectURL(blob); i.onload = () => { res(i); setTimeout(() => URL.revokeObjectURL(u), 5000); }; i.onerror = rej; i.src = u; });
  function cover(c, img, x, y, w, h) { const k = Math.max(w / img.width, h / img.height), sw = w / k, sh = h / k; c.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h); }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function wrap(c, text, maxW, maxLines) {
    const out = []; for (const para of String(text).split('\n')) { let line = '';
      for (const w of para.split(/\s+/)) { const t = line ? line + ' ' + w : w; if (c.rawMeasure(t).width > maxW && line) { out.push(line); line = w; } else line = t; }
      if (line) out.push(line); }
    if (out.length > maxLines) { out.length = maxLines; out[maxLines - 1] = out[maxLines - 1].replace(/\s*\S*$/, '') + '…'; }
    return out;
  }
  function lines(c, arr, x, y, lh) { arr.forEach((l, i) => c.rawFill(l, x, y + i * lh)); return y + arr.length * lh; }
  function meander(c, x, y, w, color, s = 2) {   // פס מעוינים בסגנון אריחי אזולז׳ו
    c.save(); c.strokeStyle = color; c.lineWidth = 1.7 * s; c.lineJoin = 'round'; c.beginPath();
    for (let px = x; px < x + w - 12 * s + 1; px += 12 * s) { c.moveTo(px + 6 * s, y + 1 * s); c.lineTo(px + 11 * s, y + 6 * s); c.lineTo(px + 6 * s, y + 11 * s); c.lineTo(px + 1 * s, y + 6 * s); c.closePath(); }
    c.stroke(); c.restore();
  }
  function temple(c, cx, by, s, color) {
    c.save(); c.fillStyle = color; c.beginPath(); c.moveTo(cx - 144 * s, by - 184 * s); c.lineTo(cx, by - 252 * s); c.lineTo(cx + 144 * s, by - 184 * s); c.lineTo(cx + 144 * s, by - 168 * s); c.lineTo(cx - 144 * s, by - 168 * s); c.fill();
    c.fillRect(cx - 132 * s, by - 158 * s, 264 * s, 13 * s);
    for (let i = 0; i < 5; i++) c.fillRect(cx - 118 * s + i * 52.5 * s, by - 136 * s, 26 * s, 92 * s);
    c.fillRect(cx - 140 * s, by - 36 * s, 280 * s, 14 * s); c.fillRect(cx - 156 * s, by - 16 * s, 312 * s, 16 * s); c.restore();
  }
  function blurBg(c, img, W, H, dark = .5) {   // רקע מטושטש בלי filter (לא נתמך בספארי): מקטינים מאוד ומגדילים חזרה
    const t = document.createElement('canvas'); t.width = 36; t.height = Math.max(8, Math.round(36 * H / W)); cover(t.getContext('2d'), img, 0, 0, t.width, t.height);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.drawImage(t, 0, 0, W, H);
    c.fillStyle = `rgba(8, 20, 45, ${dark})`; c.fillRect(0, 0, W, H);
  }
  function sea(c, W, H) { const g = c.createLinearGradient(0, 0, W * .6, H); g.addColorStop(0, BLUE2); g.addColorStop(1, BLUE1); c.fillStyle = g; c.fillRect(0, 0, W, H); }
  function sun(c, x, y, r) { const g = c.createRadialGradient(x - r * .3, y - r * .3, r * .1, x, y, r); g.addColorStop(0, '#ffe9a3'); g.addColorStop(1, '#f59f00'); c.save(); c.shadowColor = 'rgba(255,196,77,.5)'; c.shadowBlur = r; c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.restore(); }
  function scrim(c, W, y0, y1, a) { const g = c.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, 'rgba(5,12,30,0)'); g.addColorStop(1, `rgba(5,12,30,${a})`); c.fillStyle = g; c.fillRect(0, Math.min(y0, y1), W, Math.abs(y1 - y0)); }
  // תמונת פולארויד: מסגרת לבנה, צל והטיה קלה. מחזירה את גובה הכרטיס
  function polaroid(c, img, cx, cy, w, rot, maxH) {
    const pad = w * .045, ar = Math.min(Math.max(img.width / img.height, .7), 1.6); let iw = w - 2 * pad, ih = iw / ar;
    if (maxH && ih + pad * 3.4 > maxH) { ih = maxH - pad * 3.4; iw = ih * ar; w = iw + 2 * pad; }
    const h = ih + pad * 3.4;
    c.save(); c.translate(cx, cy); c.rotate(rot * Math.PI / 180);
    c.shadowColor = 'rgba(0,0,0,.42)'; c.shadowBlur = w * .07; c.shadowOffsetY = w * .025; c.fillStyle = '#fff'; rr(c, -w / 2, -h / 2, w, h, w * .012); c.fill();
    c.shadowColor = 'transparent'; cover(c, img, -w / 2 + pad, -h / 2 + pad, iw, ih); c.restore();
    return { w, h };
  }
  function fan(c, imgs, cx, cy, w, u) {   // עד שלוש תמונות פרושות כמו על שולחן
    const set = imgs.slice(0, 3), n = set.length; if (!n) return;
    const pos = n === 1 ? [[0, 0, -3]] : n === 2 ? [[.3, 0, 5], [-.3, .04, -5]] : [[.56, .06, 9], [-.56, .06, -8], [0, -.04, 1.5]];
    set.forEach((im, i) => polaroid(c, im, cx + pos[i][0] * w, cy + pos[i][1] * w, w * (n === 1 ? 1.15 : .92), pos[i][2]));
  }
  // תוויות מעוגלות (מקום, שעה, מי צילמה)
  function chips(c, items, x, y, u, align, maxW) {
    c.save(); c.font = `600 ${Math.round(30 * u)}px ${FONT.b}`; const padX = 20 * u, h = 52 * u, gap = 12 * u;
    const rows = [[]]; let rw = 0;
    for (const t of items.filter(Boolean)) { const w = c.measureText(t).width + padX * 2; if (rw + w > maxW && rows[rows.length - 1].length) { rows.push([]); rw = 0; } rows[rows.length - 1].push([t, w]); rw += w + gap; }
    rows.forEach((row, ri) => { const total = row.reduce((s, r) => s + r[1], 0) + gap * (row.length - 1); let px = align === 'center' ? x + total / 2 : x;   // px = הקצה הימני של התווית הבאה
      for (const [t, w] of row) { c.fillStyle = 'rgba(255,255,255,.18)'; rr(c, px - w, y + ri * (h + gap), w, h, h / 2); c.fill(); c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText(t, px - w / 2, y + ri * (h + gap) + h * .68); px -= w + gap; } });
    c.restore(); return y + rows.length * (h + gap);
  }
  const meta = e => [e.type === 'video' ? '🎬 סרטון' : '', e.place ? '📍 ' + placeName(e.place) : '', hm(e.ts), e.by ? 'מאת ' + e.by : ''];
  const shadow = (c, on, u) => { c.shadowColor = on ? 'rgba(0,0,0,.55)' : 'transparent'; c.shadowBlur = on ? 14 * u : 0; c.shadowOffsetY = on ? 2 * u : 0; };
  const mk = (W, H) => { const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d'); c.direction = LANG === 'he' ? 'rtl' : 'ltr'; c.textBaseline = 'alphabetic'; return [cv, c]; };
  const dims = (W, H) => { const P = H > W; return [P, P ? W / 1080 : H / 900]; };
  function brand(c, W, H, u, light) { c.save(); c.font = `600 ${Math.round(24 * u)}px ${FONT.b}`; c.fillStyle = light ? 'rgba(255,255,255,.6)' : 'rgba(6,73,43,.55)'; c.textAlign = 'center'; c.fillText('ליסבון · ' + TRIP.title, W / 2, H - 30 * u); c.restore(); }
  function dayTag(c, W, u, label) { c.save(); c.font = `700 ${Math.round(28 * u)}px ${FONT.b}`; const w = c.measureText(label).width + 44 * u; c.fillStyle = 'rgba(5,12,30,.45)'; rr(c, W / 2 - w / 2, 40 * u, w, 54 * u, 27 * u); c.fill(); c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText(label, W / 2, 78 * u); c.restore(); }

  // ───── שקפים ─────
  function sCover(W, H, st) {
    const [cv, c] = mk(W, H), [P, u] = dims(W, H);
    sea(c, W, H); sun(c, P ? W * .2 : W * .1, P ? H * .1 : H * .17, 66 * u);
    temple(c, P ? W / 2 : W * .7, P ? H * .3 : H * .52, (P ? 1.6 : 1.3) * u, 'rgba(255,255,255,.13)');
    const tx = P ? W / 2 : W * .7; c.textAlign = 'center'; c.fillStyle = '#fff'; shadow(c, true, u);
    c.font = `900 ${Math.round((P ? 230 : 180) * u)}px ${FONT.d}`; c.fillText('ליסבון', tx, P ? H * .36 : H * .5);
    c.font = `400 ${Math.round((P ? 92 : 72) * u)}px ${FONT.h}`; c.fillStyle = '#ffe27a'; c.fillText(TRIP.title, tx, P ? H * .425 : H * .63);
    shadow(c, false, u); c.font = `600 ${Math.round(36 * u)}px ${FONT.b}`; c.fillStyle = 'rgba(255,255,255,.92)';
    c.fillText(`${st.from.toLocaleDateString(LOC, { day: 'numeric', month: 'long' })} – ${st.to.toLocaleDateString(LOC, { day: 'numeric', month: 'long', year: 'numeric' })}`, tx, P ? H * .47 : H * .72);
    c.font = `700 ${Math.round(30 * u)}px ${FONT.b}`; c.fillStyle = GOLD; c.fillText(st.kind, tx, P ? H * .505 : H * .79);
    if (st.names.length) { c.font = `500 ${Math.round(28 * u)}px ${FONT.b}`; c.fillStyle = 'rgba(255,255,255,.75)'; lines(c, wrap(c, st.names.join(' · '), P ? W * .8 : W * .5, 2), tx, P ? H * .54 : H * .85, 38 * u); }
    if (P) fan(c, st.pick, W / 2, H * .74, W * .4, u); else fan(c, st.pick, W * .27, H * .52, W * .2, u);
    meander(c, W * .1, H - (P ? 96 : 66) * u, W * .8, 'rgba(255,255,255,.5)', 2 * u);
    return cv;
  }
  function sDay(W, H, d) {
    const [cv, c] = mk(W, H), [P, u] = dims(W, H);
    if (d.imgs[0]) { cover(c, d.imgs[0], 0, 0, W, H); c.fillStyle = 'rgba(10,50,105,.84)'; c.fillRect(0, 0, W, H); } else sea(c, W, H);
    const tx = P ? W / 2 : W * .7; c.textAlign = 'center';
    c.font = `700 ${Math.round(38 * u)}px ${FONT.b}`; c.fillStyle = '#ffe27a'; c.fillText(longDate(d.date), tx, P ? H * .15 : H * .26);
    c.font = `900 ${Math.round((P ? 240 : 190) * u)}px ${FONT.d}`; c.fillStyle = '#fff'; c.fillText(d.label, tx, P ? H * .285 : H * .5);
    meander(c, tx - 150 * u, P ? H * .31 : H * .545, 300 * u, GOLD, 2 * u);
    if (d.title) { c.font = `400 ${Math.round((P ? 76 : 62) * u)}px ${FONT.h}`; c.fillStyle = '#fff'; lines(c, wrap(c, d.title, P ? W * .82 : W * .5, 2), tx, P ? H * .385 : H * .68, 84 * u); }
    c.font = `600 ${Math.round(32 * u)}px ${FONT.b}`; c.fillStyle = 'rgba(255,255,255,.8)'; c.fillText(`${d.count} רגעים`, tx, P ? H * .47 : H * .86);
    if (P) fan(c, d.imgs, W / 2, H * .72, W * .4, u); else fan(c, d.imgs, W * .27, H * .52, W * .2, u);
    brand(c, W, H, u, true);
    return cv;
  }
  function sPhoto(W, H, e, img, label, n) {
    const [cv, c] = mk(W, H), [P, u] = dims(W, H), sAR = W / H, iAR = img.width / img.height, fit = Math.min(sAR / iAR, iAR / sAR);
    const tags = (e.tags || []).map(t => '#' + t).join('  ');
    if (fit > .68) {   // התמונה בפרופורציה של השקף: ממלאת את כולו, והכיתוב מעליה
      cover(c, img, 0, 0, W, H); scrim(c, W, 220 * u, 0, .55);
      c.font = `400 ${Math.round((P ? 78 : 66) * u)}px ${FONT.h}`; const cap = e.text ? wrap(c, e.text, W * .86, P ? 4 : 2) : [], lh = (P ? 90 : 78) * u;
      const blockH = cap.length * lh + 150 * u + (tags ? 50 * u : 0), top = H - blockH - 70 * u;
      scrim(c, W, top - 170 * u, H, .88);
      let y = top + lh * .8; c.textAlign = 'center'; c.fillStyle = '#fff'; shadow(c, true, u);
      if (cap.length) { y = lines(c, cap, W / 2, y, lh); } shadow(c, false, u);
      y = chips(c, meta(e), W / 2, y - lh * .45 + 16 * u, u, 'center', W * .9);
      if (tags) { c.font = `700 ${Math.round(30 * u)}px ${FONT.b}`; c.fillStyle = PINK; c.textAlign = 'center'; c.fillText(tags, W / 2, y + 26 * u); }
    } else if (P) {     // תמונה לרוחב בשקף לאורך: פולארויד על רקע מטושטש
      blurBg(c, img, W, H, .5);
      c.font = `400 ${Math.round(78 * u)}px ${FONT.h}`; const cap = e.text ? wrap(c, e.text, W * .86, 4) : [];
      const card = polaroid(c, img, W / 2, H * (cap.length ? .4 : .45), W * .88, n % 2 ? 1.4 : -1.4, H * .5);
      let y = H * (cap.length ? .4 : .45) + card.h / 2 + 120 * u; c.textAlign = 'center'; c.fillStyle = '#fff'; shadow(c, true, u);
      if (cap.length) y = lines(c, cap, W / 2, y, 90 * u); shadow(c, false, u);
      y = chips(c, meta(e), W / 2, y - 30 * u, u, 'center', W * .9);
      if (tags) { c.font = `700 ${Math.round(30 * u)}px ${FONT.b}`; c.fillStyle = PINK; c.textAlign = 'center'; c.fillText(tags, W / 2, y + 26 * u); }
    } else {            // תמונה לאורך בשקף לרוחב: פולארויד משמאל, טקסט מימין
      blurBg(c, img, W, H, .5);
      polaroid(c, img, W * .3, H * .52, W * .36, n % 2 ? 2 : -2, H * .76);
      const tx = W - 80 * u, tw = W * .4; let y = H * (e.text ? .32 : .46); c.textAlign = 'right'; c.fillStyle = '#fff';
      if (e.text) { c.font = `400 ${Math.round(68 * u)}px ${FONT.h}`; shadow(c, true, u); y = lines(c, wrap(c, e.text, tw, 5), tx, y, 80 * u); shadow(c, false, u); meander(c, tx - 190 * u, y - 36 * u, 190 * u, GOLD, 1.6 * u); y += 20 * u; }
      y = chips(c, meta(e), tx, y, u, 'right', tw);
      if (tags) { c.font = `700 ${Math.round(28 * u)}px ${FONT.b}`; c.fillStyle = PINK; c.textAlign = 'right'; c.fillText(tags, tx, y + 26 * u); }
    }
    dayTag(c, W, u, label); brand(c, W, H, u, true);
    return cv;
  }
  function sCollage(W, H, items, label) {   // כמה תמונות בלי כיתוב באותו שקף
    const [cv, c] = mk(W, H), [P, u] = dims(W, H), n = items.length, g = 16 * u;
    blurBg(c, items[0]._img, W, H, .6);
    const bx = P ? W * .06 : W * .05, by = 130 * u, bw = W - 2 * bx, bh = H - by - (P ? 300 : 200) * u; let R;
    if (n === 2) R = P ? [[0, 0, 1, .5], [0, .5, 1, .5]] : [[.5, 0, .5, 1], [0, 0, .5, 1]];
    else if (n === 3) R = P ? [[0, 0, 1, .56], [.5, .56, .5, .44], [0, .56, .5, .44]] : [[.42, 0, .58, 1], [0, 0, .42, .5], [0, .5, .42, .5]];
    else R = [[.5, 0, .5, .5], [0, 0, .5, .5], [.5, .5, .5, .5], [0, .5, .5, .5]];
    items.slice(0, R.length).forEach((e, i) => { const [rx, ry, rw, rh] = R[i], x = bx + rx * bw + g / 2, y = by + ry * bh + g / 2, w = rw * bw - g, h = rh * bh - g;
      c.save(); c.shadowColor = 'rgba(0,0,0,.4)'; c.shadowBlur = 30 * u; c.shadowOffsetY = 10 * u; c.fillStyle = '#fff'; rr(c, x - 7 * u, y - 7 * u, w + 14 * u, h + 14 * u, 16 * u); c.fill(); c.restore();
      c.save(); rr(c, x, y, w, h, 10 * u); c.clip(); cover(c, e._img, x, y, w, h); c.restore(); });
    const places = [...new Set(items.map(e => e.place).filter(Boolean))], by2 = [...new Set(items.map(e => e.by).filter(Boolean))];
    chips(c, [places.length === 1 ? '📍 ' + placeName(places[0]) : '', `${hm(items[0].ts)}–${hm(items[n - 1].ts)}`, by2.length ? 'צילמו ' + by2.join(', ') : ''], W / 2, by + bh + 40 * u, u, 'center', W * .9);
    dayTag(c, W, u, label); brand(c, W, H, u, true);
    return cv;
  }
  function sNote(W, H, e, label) {
    const [cv, c] = mk(W, H), [P, u] = dims(W, H);
    c.fillStyle = '#fbf6ec'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#e9dfcb'; c.lineWidth = 2 * u; for (let y = 120 * u; y < H; y += 64 * u) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.fillStyle = 'rgba(214,51,108,.35)'; c.fillRect(W - 90 * u, 0, 3 * u, H);
    c.textAlign = 'center'; c.font = `900 ${Math.round(300 * u)}px ${FONT.d}`; c.fillStyle = 'rgba(214,51,108,.2)'; c.fillText('”', W / 2, H * (P ? .3 : .38));
    c.font = `400 ${Math.round((P ? 88 : 74) * u)}px ${FONT.h}`; c.fillStyle = '#14213d';
    const ls = wrap(c, e.text || '', W * .78, P ? 9 : 6), lh = (P ? 104 : 88) * u; let ty = H / 2 - (ls.length * lh) / 2 + lh * .7; ty = lines(c, ls, W / 2, ty, lh);
    meander(c, W / 2 - 130 * u, ty - 10 * u, 260 * u, '#d6336c', 2 * u);
    c.font = `600 ${Math.round(32 * u)}px ${FONT.b}`; c.fillStyle = '#5c6884'; c.fillText([label, ...meta(e)].filter(Boolean).join('  ·  '), W / 2, ty + 84 * u);
    brand(c, W, H, u, false);
    return cv;
  }
  function sEnd(W, H, st) {
    const [cv, c] = mk(W, H), [P, u] = dims(W, H);
    sea(c, W, H); sun(c, W * .84, H * (P ? .1 : .18), 60 * u);
    const tx = P ? W / 2 : W * .7; c.textAlign = 'center'; shadow(c, true, u);
    c.fillStyle = '#ffe27a'; c.font = `400 ${Math.round((P ? 116 : 92) * u)}px ${FONT.h}`; c.fillText(TRIP.cfg.occ === 'birthday' ? 'פָּרָבֵּנְס!' : 'אוֹלָה, ליסבון', tx, H * (P ? .2 : .36));
    shadow(c, false, u); c.fillStyle = '#fff'; c.font = `600 ${Math.round(38 * u)}px ${FONT.b}`; c.fillText(TRIP.cfg.occ === 'birthday' ? 'Parabéns · עד 120' : TRIP.title, tx, H * (P ? .25 : .47));
    meander(c, tx - 160 * u, H * (P ? .275 : .52), 320 * u, GOLD, 2 * u);
    c.font = `700 ${Math.round(42 * u)}px ${FONT.b}`; c.fillText([`${st.photos} תמונות`, st.places ? `${st.places} מקומות` : '', `${st.days} ימים`].filter(Boolean).join('  ·  '), tx, H * (P ? .345 : .66));
    c.font = `900 ${Math.round(74 * u)}px ${FONT.d}`; c.fillText('ליסבון 2026', tx, H * (P ? .42 : .82));
    if (P) fan(c, st.pick.slice().reverse(), W / 2, H * .7, W * .4, u); else fan(c, st.pick.slice().reverse(), W * .27, H * .52, W * .2, u);
    meander(c, W * .1, H - (P ? 96 : 66) * u, W * .8, 'rgba(255,255,255,.5)', 2 * u);
    return cv;
  }

  // ───── בניית המצגת ─────
  let slides = [], idx = 0, timer = null, fmt = 'p', scope = 'me', building = false, pdfFile = null, runId = 0;
  const SCOPES = { me: 'היומן שלי', us: 'היומן המשותף', all: 'כל הטיול' };
  async function build() {
    if (building) return; building = true; const my = ++runId; pdfFile = null; play(false);
    const J = A.journal, pick = scope === 'me' ? J.inMe : scope === 'us' ? J.inUs : () => true;
    const all = (await J.all().catch(() => [])).filter(e => pick(e) && ((e.type === 'photo' && e.blob) || (e.type === 'video' && e.poster) || (e.type === 'note' && e.text))).sort((a, b) => a.ts - b.ts);
    open(); scopeUI();
    if (!all.length) { building = false; slides.forEach(s => URL.revokeObjectURL(s.url)); slides = []; bars(); layers.forEach(l => l.removeAttribute('src')); return status(scope === 'us' ? 'היומן המשותף עוד ריק' : 'היומן עוד ריק. אחרי כמה תמונות תהיה כאן מצגת'); }
    const [W, H] = fmt === 'p' ? [1080, 1920] : [1600, 900];
    status(`מכינה את המצגת… 0%`);
    await Promise.all([`900 80px ${FONT.d}`, `400 60px ${FONT.h}`, `600 30px ${FONT.b}`, `700 30px ${FONT.b}`].map(f => document.fonts.load(f, 'אב').catch(() => {})));
    const t0 = A.dayDate(0); t0.setHours(0, 0, 0, 0);
    const dayOf = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d; };
    const groups = []; for (const e of all) { const d = dayOf(e.ts), g = groups[groups.length - 1]; if (g && +g.date === +d) g.items.push(e); else groups.push({ date: d, items: [e] }); }
    for (const e of all) if (e.type !== 'note') try { e._img = await loadImg(e.type === 'video' ? e.poster : e.blob); } catch {}   // סרטון מיוצג בתמונת הפתיחה שלו
    const ph = all.filter(e => e._img), names = (() => { try { const G = JSON.parse(localStorage.getItem('lisboa.group') || '{}'); return [...new Set([G.name, ...Object.values(G.members || {}).map(m => m.n)].filter(Boolean))]; } catch { return []; } })();
    const st = { from: groups[0].date, to: groups[groups.length - 1].date, names: scope === 'me' ? [] : names, kind: SCOPES[scope], photos: ph.length, places: new Set(all.map(e => e.place).filter(Boolean)).size, days: groups.length,
      pick: ph.length ? [ph[0], ph[Math.floor(ph.length / 2)], ph[ph.length - 1]].filter((x, i, a) => a.indexOf(x) === i).map(e => e._img) : [] };
    const out = [], push = async cv => { out.push(await new Promise(r => cv.toBlob(r, 'image/jpeg', .9))); cv.width = cv.height = 0; };
    await push(sCover(W, H, st)); let done = 0, n = 0;
    for (const g of groups) {
      if (my !== runId) return;
      const dn = Math.round((g.date - t0) / 864e5) + 1, inTrip = dn >= 1 && dn <= A.S.days;
      const label = inTrip ? `יום ${dn}` : g.date.toLocaleDateString(LOC, { day: 'numeric', month: 'numeric' });
      await push(sDay(W, H, { date: g.date, label, title: inTrip ? TRIP.plan[dn - 1]?.title : '', imgs: g.items.filter(e => e._img).map(e => e._img), count: g.items.length }));
      let run = [];   // רצף תמונות בלי כיתוב הופך לשקף קולאז׳
      const flush = async () => { while (run.length) { const take = run.length === 5 ? 3 : Math.min(4, run.length), part = run.splice(0, take);
        await push(part.length === 1 ? sPhoto(W, H, part[0], part[0]._img, label, n++) : sCollage(W, H, part, label)); } };
      for (const e of g.items) {
        if (e.type === 'photo' && e._img && !e.text) run.push(e);
        else { await flush(); if (e.type === 'note') await push(sNote(W, H, e, label)); else if (e._img) await push(sPhoto(W, H, e, e._img, label, n++)); }
        status(`מכינה את המצגת… ${Math.round(++done / all.length * 100)}%`); await new Promise(r => setTimeout(r));
      }
      await flush();
    }
    await push(sEnd(W, H, st)); all.forEach(e => delete e._img);
    if (my !== runId) return;
    slides.forEach(s => URL.revokeObjectURL(s.url)); slides = out.filter(Boolean).map(b => ({ blob: b, url: URL.createObjectURL(b), W, H }));
    building = false; status(''); idx = 0; bars(); show(0, true); play(true);
    makePdf().then(f => { if (my === runId) { pdfFile = f; $('#showPdf').classList.remove('wait'); } });   // מכינים מראש, כדי שהשיתוף ייפתח מיד בלחיצה
    $('#showPdf').classList.add('wait');
  }

  // ───── נגן ─────
  const el = $('#show'), layers = [$('#showA'), $('#showB')]; let front = 0;
  function open() { el.hidden = false; }
  function close() { el.hidden = true; play(false); runId++; building = false; }
  function status(t) { $('#showStatus').textContent = t; $('#showStatus').hidden = !t; }
  function bars() { $('#showBars').innerHTML = slides.map(() => '<i></i>').join(''); }
  function scopeUI() { [...$('#showScope').children].forEach(b => { b.classList.toggle('on', b.dataset.s === scope); if (b.dataset.s === 'us') b.hidden = !A.hooks.inGroup?.(); }); $('#showFmt').textContent = fmt === 'p' ? 'לרוחב' : 'לאורך'; }
  async function show(i, instant) {
    if (!slides.length) return; idx = Math.max(0, Math.min(slides.length - 1, i));
    const next = layers[1 - front], prev = layers[front]; next.src = slides[idx].url;
    try { await next.decode(); } catch {}
    next.classList.remove('kb'); void next.offsetWidth; next.classList.add('on', 'kb'); prev.classList.remove('on'); front = 1 - front;
    if (instant) prev.removeAttribute('src');
    [...$('#showBars').children].forEach((b, k) => b.className = k < idx ? 'done' : k === idx ? 'cur' : '');
    $('#showN').textContent = `${idx + 1} / ${slides.length}`;
    if (timer) arm();
  }
  function arm() { clearTimeout(timer); timer = setTimeout(() => idx < slides.length - 1 ? show(idx + 1) : play(false), 5200); }
  function play(on) { clearTimeout(timer); timer = null; if (on && slides.length) arm(); $('#showPlay').textContent = timer ? '❚❚' : '▶'; $('#showPlay').setAttribute('aria-label', timer ? 'השהיה' : 'הפעלה'); el.classList.toggle('playing', !!timer); }
  $('#showClose').onclick = close;
  $('#showPlay').onclick = () => { if (!timer && idx === slides.length - 1) show(0); play(!timer); };
  $('#showFmt').onclick = () => { fmt = fmt === 'p' ? 'l' : 'p'; runId++; building = false; build(); };
  $('#showScope').onclick = e => { const b = e.target.closest('[data-s]'); if (!b || b.dataset.s === scope) return; scope = b.dataset.s; runId++; building = false; build(); };
  $('#showNext').onclick = () => show(idx + 1); $('#showPrev').onclick = () => show(idx - 1);
  let sx = null;
  $('#showStage').addEventListener('pointerdown', e => sx = e.clientX);
  $('#showStage').addEventListener('pointerup', e => { if (sx == null || !slides.length || e.target.closest('button')) return; const dx = e.clientX - sx; sx = null;
    if (Math.abs(dx) > 40) show(idx + (dx > 0 ? 1 : -1));                         // החלקה ימינה = הבא, כמו דפדוף בעברית
    else show(idx + (e.clientX < el.clientWidth / 2 ? 1 : -1)); });               // הקשה בצד שמאל = הבא
  document.addEventListener('keydown', e => { if (el.hidden) return; if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') show(idx + 1); if (e.key === 'ArrowRight') show(idx - 1); if (e.key === ' ') $('#showPlay').click(); });

  // ───── שיתוף ─────
  async function makePdf() {   // PDF פשוט: כל עמוד הוא תמונת JPEG אחת
    const enc = new TextEncoder(), parts = [], offs = []; let len = 0; const list = slides.slice();
    const add = x => { const u = typeof x === 'string' ? enc.encode(x) : x; parts.push(u); len += u.length; };
    const obj = (n, body) => { offs[n] = len; add(`${n} 0 obj\n`); body(); add('\nendobj\n'); };
    add('%PDF-1.4\n');
    const N = list.length, kids = list.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
    obj(1, () => add('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => add(`<< /Type /Pages /Count ${N} /Kids [${kids}] >>`));
    for (let i = 0; i < N; i++) {
      const s = list[i], jpg = new Uint8Array(await s.blob.arrayBuffer()), pw = s.W / 2, ph = s.H / 2, p = 3 + i * 3, content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
      obj(p, () => add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`));
      obj(p + 1, () => add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
      obj(p + 2, () => { add(`<< /Type /XObject /Subtype /Image /Width ${s.W} /Height ${s.H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`); add(jpg); add('\nendstream'); });
    }
    const xref = len, total = 3 + N * 3;
    add(`xref\n0 ${total}\n0000000000 65535 f \n` + Array.from({ length: total - 1 }, (_, k) => String(offs[k + 1]).padStart(10, '0') + ' 00000 n \n').join(''));
    add(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new File(parts, `ליסבון-${TRIP.title.replace(/[^\u0590-\u05FFA-Za-z0-9]+/g, '-')}-${scope === 'me' ? 'אישי' : scope === 'us' ? 'משותף' : 'הכול'}.pdf`, { type: 'application/pdf' });
  }
  // חלון השיתוף של הטלפון נפתח רק מיד אחרי לחיצה, ולכן הקבצים מוכנים מראש
  async function shareFiles(files, title) {
    if (navigator.canShare?.({ files })) {
      try { await navigator.share({ files, title }); return; }
      catch (e) { if (e?.name === 'AbortError') return; if (e?.name === 'NotAllowedError') return A.toast('הקובץ מוכן. ללחוץ שוב על השיתוף'); }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(files[0]); a.download = files[0].name; document.body.append(a); a.click(); a.remove();
    A.toast(files.length > 1 ? 'הדפדפן הזה לא משתף כמה קבצים. אפשר לנסות את ה־PDF' : 'הקובץ ירד למכשיר');
  }
  $('#showPdf').onclick = async () => { if (!slides.length) return; play(false); if (!pdfFile) return A.toast('ה־PDF עוד בהכנה, עוד רגע'); shareFiles([pdfFile], 'ליסבון · ' + TRIP.title); };
  $('#showImgs').onclick = () => { if (!slides.length) return; play(false); shareFiles(slides.slice(0, 30).map((s, i) => new File([s.blob], `lisbon-${String(i + 1).padStart(2, '0')}.jpg`, { type: 'image/jpeg' })), 'ליסבון · ' + TRIP.title); if (slides.length > 30) A.toast('משתפת את 30 השקפים הראשונים. למצגת המלאה עדיף PDF', 5000); };

  $('#jrShow').onclick = () => { scope = A.journal.tab() === 'us' ? 'us' : 'me'; runId++; building = false; build(); };
  A.show = { build, get n() { return slides.length; }, get ready() { return !building && !!pdfFile; }, get scope() { return scope; } };
})();

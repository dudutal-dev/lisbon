/* רישיון: קישור כניסה אישי (?k=…) שמופעל על טלפון אחד, או מקום בקבוצה מתוך הרישיון של מנהל הקבוצה.
   השרת (PUSH_URL/lic/…) מחליט אם האפליקציה דורשת רישיון בכלל ("אכיפה"). כשהאכיפה כבויה – שום דבר כאן לא חוסם.
   בלי אינטרנט: רישיון שאושר ב-21 הימים האחרונים ממשיך לעבוד, כדי שהאפליקציה תפעל גם בטיול בלי קליטה. */
(() => {
  const A = window.APP, $ = s => document.querySelector(s);
  const K = APP_NS + '.lic', KC = APP_NS + '.licCfg', KD = APP_NS + '.dev', GRACE = 21 * 86400e3;
  const get = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  let dev = get(KD); if (!dev) { dev = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); set(KD, dev); }
  let L = get(K), cfg = get(KC) || { enforce: false }, why = '';
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent), alone = matchMedia('(display-mode: standalone)').matches || !!navigator.standalone;
  const kParam = (new URLSearchParams(location.search).get('k') || '').trim();
  const valid = () => !!L && L.exp > Date.now() && Date.now() - (L.t || 0) < GRACE;
  const grp = () => get(APP_NS + '.group') || {};
  const api = async (path, body) => { const r = await fetch(PUSH_URL + '/lic/' + path, body ? { method: 'POST', body: JSON.stringify(body) } : undefined); return r.json(); };
  const WHY = { used: 'הקישור הזה כבר הופעל בטלפון אחר.', full: 'כל המקומות בקבוצה הזו תפוסים. לפנות למנהל הקבוצה.', revoked: 'הרישיון בוטל.', expired: 'תוקף הרישיון הסתיים.', gone: 'הרישיון הועבר לטלפון אחר.', bad: 'הקישור לא תקין.', net: 'אין חיבור לאינטרנט. צריך חיבור בהפעלה הראשונה.' };

  function gate() {   // מסך הנעילה: מופיע רק כשהאכיפה פועלת ואין רישיון בתוקף
    const lock = cfg.enforce && !valid();
    document.documentElement.classList.toggle('locked', lock);
    const d = $('#licDlg');
    if (!lock) { if (d.open) d.close(); return paint(); }
    const wait = ios && !alone && kParam;   // באייפון ההפעלה נעשית מהאפליקציה שבמסך הבית
    $('#licSteps').hidden = !wait; $('#licForm').hidden = !!wait;
    $('#licMsg').textContent = wait ? 'כדי להפעיל: מוסיפים את האפליקציה למסך הבית ופותחים אותה משם.' : why ? WHY[why] || WHY.bad : 'כדי להשתמש באפליקציה צריך קישור הפעלה אישי.';
    if (!d.open) d.showModal();
    paint();
  }
  function paint() {  // מה שמוצג על הרישיון: באודות ובעמוד הקבוצה
    const el = $('#licInfo'); if (!el) return;
    const ok = valid(), until = ok ? new Date(L.exp).toLocaleDateString(LOC, { day: 'numeric', month: 'numeric', year: 'numeric' }) : '';
    el.hidden = !ok;
    if (ok) el.textContent = L.kind === 'pass' ? `רישיון עבור ${L.name || 'משתמש'} · בתוקף עד ${until}${L.seats ? ` · ${L.used || 0} מתוך ${L.seats} מקומות בשימוש` : ''}` : `מקום בקבוצה · בתוקף עד ${until}`;
    A.hooks.licChanged?.();
  }
  async function activate(tok) {
    why = '';
    try { const r = await api('activate', { token: tok, dev, app: APP_ID, gid: grp().id, n: grp().name });
      if (r.ok) { L = { ...r, token: tok, t: Date.now() }; set(K, L); }
      else { why = r.why || 'bad'; if (L && L.token === tok) { L = null; set(K, null); } }
    } catch { why = 'net'; }
    gate(); return !why;
  }
  async function check() {
    if (!L) return;
    try { const r = await api('check', { id: L.id, dev, gid: grp().id, n: grp().name });
      if (r.ok) { L = { ...L, ...r, t: Date.now() }; set(K, L); }
      else if (['revoked', 'expired', 'gone'].includes(r.why)) { why = r.why; L = null; set(K, null); }
    } catch {}
    gate();
  }
  async function boot() {
    gate();
    try { const c = await api('cfg?app=' + APP_ID); if (typeof c.enforce === 'boolean') { cfg = { enforce: c.enforce }; set(KC, cfg); } } catch {}
    // קישור עם רישיון: באייפון מפעילים רק מהאפליקציה שבמסך הבית, כדי שההפעלה האחת לא תתבזבז על הדפדפן
    if (kParam && (!L || L.token !== kParam) && !(ios && !alone)) {
      const mine = L && L.kind === 'pass' && /^I\./.test(kParam);     // בעל רישיון שפתח קישור הזמנה: נשאר עם הרישיון שלו
      if (!mine) return void (await activate(kParam));
    }
    if (L && Date.now() - (L.t || 0) > 6 * 3600e3) return void (await check());
    gate();
  }
  $('#licForm').onsubmit = async e => { e.preventDefault(); const v = $('#licIn').value.trim(), m = /[?&]k=([^&#\s]+)/.exec(v), tok = m ? decodeURIComponent(m[1]) : v;
    if (!tok) return; $('#licGo').disabled = true; await activate(tok); $('#licGo').disabled = false; };
  $('#licDlg').addEventListener('cancel', e => e.preventDefault());   // אי אפשר לסגור את מסך הנעילה
  document.addEventListener('visibilitychange', () => { if (!document.hidden && L && Date.now() - (L.t || 0) > 6 * 3600e3) check(); });

  A.lic = {
    get on() { return !!cfg.enforce; },
    get st() { return valid() ? L : null; },
    // כשהאכיפה פועלת: רק בעל רישיון עם מקומות פותח קבוצה ומזמין אליה
    canCreate: () => !cfg.enforce || (valid() && L.kind === 'pass' && L.seats > 0),
    canInvite: () => !cfg.enforce || (valid() && L.kind === 'pass' && L.seats > 0),
    invite: () => (valid() && L.kind === 'pass' && L.invite) || '',
    unseat: gid => { if (valid() && L.kind === 'pass') api('unseat', { id: L.id, dev, gid }).then(() => check()).catch(() => {}); },
    sync: () => check(),
  };
  boot();
})();

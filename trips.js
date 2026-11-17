/* הנסיעות שלי: שמירת נסיעה שהסתיימה, התחלת נסיעה חדשה ומעבר בין נסיעות.
   לכל נסיעה: ההגדרות, המלון, הטיסות, המסלול, הקופה, הקבוצה והצ'אט (ב-localStorage) והיומן (רשומות עם שדה trip).
   פרטים אישיים, מסמכים והמפה השמורה משותפים לכל הנסיעות. */
(() => {
  const A = window.APP, $ = s => document.querySelector(s), esc = A.esc;
  const KEYS = ['lisboa.v1', 'lisboa.trip', 'lisboa.group'];
  const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const parse = s => { try { return JSON.parse(s || 'null'); } catch { return null; } };
  let T = parse(get('lisboa.trips')) || {}; T.cur ||= 't1'; T.list ||= [];
  const fmt = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString(LOC, { day: 'numeric', month: 'numeric', year: 'numeric' }) : '';
  const info = keys => { const c = parse(keys['lisboa.trip']) || {}, s = parse(keys['lisboa.v1']) || {}; return { name: c.name || 'טיול לליסבון', start: s.start || c.start || '' }; };
  const live = () => Object.fromEntries(KEYS.map(k => [k, get(k)]));
  // כותבת קודם את רשימת הנסיעות (הגדולה). אם אין מקום בטלפון, לא נוגעים בשום דבר
  function commit(next, keys, note) {
    try { localStorage.setItem('lisboa.trips', JSON.stringify(next)); } catch { A.toast('אין מספיק מקום בטלפון לשמור את הנסיעה', 5000); return false; }
    window.__tripSwitch = true;   // מכאן שום קוד לא כותב את הנסיעה הישנה בחזרה
    for (const k of KEYS) try { keys[k] == null ? localStorage.removeItem(k) : localStorage.setItem(k, keys[k]); } catch {}
    try { if (note) sessionStorage.setItem('lisboa.tripMsg', note); } catch {}
    location.hash = '#home'; location.reload(); return true;
  }
  async function stamp() { for (const e of await A.journal.raw()) if (!e.trip) { e.trip = 't1'; await A.journal.put(e); } }
  async function startNew() {
    await stamp().catch(() => {}); await A.hooks.pushOff?.();
    const S = parse(get('lisboa.v1')) || {}, G = parse(get('lisboa.group')) || {}, me = { ...(S.me || {}) }; delete me.hotelRef;
    const next = { cur: 't' + Date.now().toString(36), list: [...T.list, { id: T.cur, t: Date.now(), keys: live() }] };
    commit(next, { 'lisboa.v1': JSON.stringify({ me, rate: S.rate }), 'lisboa.trip': null, 'lisboa.group': JSON.stringify({ id: G.id, name: G.name, av: G.av }) });
  }
  async function switchTo(id) {
    const to = T.list.find(x => x.id === id); if (!to) return;
    await stamp().catch(() => {}); await A.hooks.pushOff?.();
    // הפרטים האישיים משותפים לכל הנסיעות: לוקחים את העדכניים
    const now = (parse(get('lisboa.v1')) || {}).me, old = parse(to.keys['lisboa.v1']) || {};
    if (now) { old.me = { ...now, hotelRef: old.me?.hotelRef }; to.keys['lisboa.v1'] = JSON.stringify(old); }
    commit({ cur: id, list: [...T.list.filter(x => x.id !== id), { id: T.cur, t: Date.now(), keys: live() }] }, to.keys);
  }
  let sure = '';
  async function remove(id) {
    for (const e of await A.journal.raw()) if ((e.trip || 't1') === id) await A.journal.del(e.id);
    if (id === T.cur) {   // מחיקת הנסיעה הנוכחית: עוברים לנסיעה השמורה האחרונה, ואם אין – מתחילים נסיעה נקייה
      await A.hooks.pushOff?.();
      const to = [...T.list].sort((a, b) => b.t - a.t)[0], S = parse(get('lisboa.v1')) || {}, G = parse(get('lisboa.group')) || {}, me = { ...(S.me || {}) }; delete me.hotelRef;
      if (to) { const old = parse(to.keys['lisboa.v1']) || {}; old.me = { ...me, hotelRef: old.me?.hotelRef }; to.keys['lisboa.v1'] = JSON.stringify(old); return commit({ cur: to.id, list: T.list.filter(x => x.id !== to.id) }, to.keys, 'הנסיעה נמחקה. עברנו לנסיעה השמורה האחרונה'); }
      return commit({ cur: 't' + Date.now().toString(36), list: [] }, { 'lisboa.v1': JSON.stringify({ me, rate: S.rate }), 'lisboa.trip': null, 'lisboa.group': JSON.stringify({ id: G.id, name: G.name, av: G.av }) }, 'הנסיעה נמחקה. נפתחה נסיעה חדשה ונקייה');
    }
    T.list = T.list.filter(x => x.id !== id); try { localStorage.setItem('lisboa.trips', JSON.stringify(T)); } catch {} render(); A.toast('הנסיעה נמחקה');
  }
  async function render() {
    const n = {}; for (const e of await A.journal.raw().catch(() => [])) { const k = e.trip || 't1'; n[k] = (n[k] || 0) + 1; }
    const row = (id, i, cur) => `<div class="trip-row${cur ? ' cur' : ''}"><div><b>${esc(i.name)}</b><small>${[fmt(i.start), n[id] ? n[id] + ' רשומות ביומן' : 'יומן ריק'].filter(Boolean).join(' · ')}</small></div><div class="row">${cur ? '<span class="trip-now">הנסיעה הנוכחית</span>' : `<button class="btn sm" data-open="${id}" type="button">מעבר לנסיעה</button>`}<button class="link trip-del" data-del="${id}" type="button">${sure === id ? 'למחוק עם היומן? ללחוץ שוב' : cur && !T.list.length ? 'מחיקה והתחלה מחדש' : 'מחיקה'}</button></div></div>`;
    $('#tripsList').innerHTML = row(T.cur, info(live()), true) + [...T.list].sort((a, b) => b.t - a.t).map(x => row(x.id, info(x.keys), false)).join('');
  }
  $('#tripsList').onclick = e => {
    const o = e.target.closest('[data-open]'), d = e.target.closest('[data-del]');
    if (o) switchTo(o.dataset.open);
    if (d) { if (sure !== d.dataset.del) { sure = d.dataset.del; return render(); } sure = ''; remove(d.dataset.del); }
  };
  $('#tripNew').onclick = () => $('#tripNewDlg').showModal();
  $('#tripNewNo').onclick = () => $('#tripNewDlg').close();
  $('#tripNewYes').onclick = () => { $('#tripNewDlg').close(); startNew(); };
  $('#tripsCard').addEventListener('toggle', render); render();
  try { const m = sessionStorage.getItem('lisboa.tripMsg'); if (m) { sessionStorage.removeItem('lisboa.tripMsg'); setTimeout(() => A.toast(m, 6000), 900); } } catch {}
  A.trips = { render, get cur() { return T.cur; } };
})();

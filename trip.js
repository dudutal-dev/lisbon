/* הגדרת הנסיעה: סוג הקבוצה, שם ואירוע. לפיהם מותאמים הכותרות, ההמלצות, המסלול והיומן.
   מי שמקים קבוצה מגדיר את הנסיעה, וההגדרה עוברת לכל המצטרפים. בלי קבוצה היא נשמרת בטלפון. */
const TRIP = (() => {
  const rd = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
  const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const TYPES = {
    girls:  { he: 'נסיעת בנות',      grp: 'הבנות',   ico: '👯‍♀️', eg: 'למשל: דפנה חוגגת 50' },
    guys:   { he: 'נסיעת בנים',      grp: 'החבר׳ה',  ico: '🍻',   eg: 'למשל: החבר׳ה בליסבון' },
    family: { he: 'חופשה משפחתית',   grp: 'המשפחה',  ico: '👨‍👩‍👧‍👦', eg: 'למשל: משפחת כהן בליסבון' },
    mixed:  { he: 'טיול חברים',      grp: 'החברים',  ico: '🧳',   eg: 'למשל: סופ״ש בליסבון' },
  };
  const OCCS = { none: 'בלי אירוע מיוחד', birthday: 'יום הולדת', bach: 'רווקות או רווקים', anniv: 'יום נישואין' };
  const okHotel = h => h && typeof h === 'object' && isFinite(+h.lat) && isFinite(+h.lng) && h.name ? { name: String(h.name).slice(0, 80), addr: String(h.addr || '').slice(0, 120), el: String(h.el || '').slice(0, 120), lat: +h.lat, lng: +h.lng, q: String(h.q || '').slice(0, 120) } : null;
  const norm = c => { c = c || {}; return { type: TYPES[c.type] ? c.type : 'mixed', name: String(c.name || '').slice(0, 40), occ: OCCS[c.occ] ? c.occ : 'none',
    start: /^\d{4}-\d\d-\d\d$/.test(c.start || '') ? c.start : '', hotel: okHotel(c.hotel), by: String(c.by || '').slice(0, 12), u: +c.u || 0, legacy: !!c.legacy, set: !!TYPES[c.type] }; };

  // טלפון שהאפליקציה כבר הייתה מותקנת בו לפני הגרסה הגנרית ממשיך עם הנסיעה שהוגדרה בו אז
  let local = rd('lisboa.trip');
  let fresh = false; try { fresh = !localStorage.getItem('lisboa.generic'); if (fresh && !local && localStorage.getItem('lisboa.v1')) { local = { type: 'girls', name: 'דפנה חוגגת 50', occ: 'birthday', start: '2026-11-18', legacy: true }; wr('lisboa.trip', local); }
    localStorage.setItem('lisboa.generic', '1'); } catch {}
  const grp = rd('lisboa.group');
  let cfg = norm((grp && grp.code && grp.trip) || local);

  const self = {
    TYPES, OCCS, norm,
    get cfg() { return cfg; },
    get type() { return cfg.type; },
    get grp() { return TYPES[cfg.type].grp; },
    get title() { return cfg.name || TYPES[cfg.type].he; },
    get plan() { return PLANS[cfg.type] || PLAN; },
    get tags() { const t = TAGS_BY[cfg.type] || TAGS_BY.mixed, w = cfg.name.split(/\s+/).filter(Boolean), last = w[w.length - 1] || '', n = ((w[0] || '') + (w.length > 1 && /^\d+$/.test(last) ? last : '')).replace(/[^\u0590-\u05FFA-Za-z0-9]/g, ''); return n ? [n, ...t] : t; },   // למשל "דפנה חוגגת 50" ← #דפנה50
    get ideas() { return cfg.occ !== 'none' ? OCC_IDEAS[cfg.occ] : null; },
    score: p => (p.top ? 2 : 0) + ((CAT_W[cfg.type] || CAT_W.mixed)[p.cat] || 0) + (p.for && p.for.includes(cfg.type) ? 3 : 0),
    star: p => (p.top && ((CAT_W[cfg.type] || CAT_W.mixed)[p.cat] || 0) >= 2) || (p.for && p.for.includes(cfg.type)),
    cats: () => Object.keys(CATS).sort((a, b) => ((CAT_W[cfg.type] || {})[b] || 0) - ((CAT_W[cfg.type] || {})[a] || 0)),
    /** שומרת הגדרה חדשה (מקומית). מחזירה true אם משהו שנראה על המסך השתנה */
    apply(c) {
      const n = norm(c), sig = x => JSON.stringify([x.type, x.name, x.occ, x.start, x.hotel && [x.hotel.name, x.hotel.lat, x.hotel.lng]]), changed = sig(n) !== sig(cfg);
      cfg = n; wr('lisboa.trip', { type: n.type, name: n.name, occ: n.occ, start: n.start, hotel: n.hotel, by: n.by, u: n.u, legacy: n.legacy });
      if (window.APP) { if (n.hotel) APP.S.hotel = n.hotel; if (n.start && !(APP.S.flights || []).some(f => f.dir === 'out')) APP.S.start = n.start; }   // גם בזיכרון, כדי ששמירה מאוחרת לא תדרוס
      if (n.hotel || n.start) { const s = rd('lisboa.v1') || {}; if (n.hotel) s.hotel = n.hotel; if (n.start && !(s.flights || []).some(f => f.dir === 'out')) s.start = n.start; wr('lisboa.v1', s); }
      return changed;
    },
    /** טוענת מחדש כדי שכל המסכים יתעדכנו, בלי לקטוע הקלדה או חלון פתוח */
    refresh(msg) {
      const go = () => { const typing = document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.value;
        if (document.querySelector('dialog[open]') || typing) return setTimeout(go, 4000);
        location.reload(); };
      if (msg && window.APP) APP.toast(msg); setTimeout(go, 900);
    },
  };
  return self;
})();

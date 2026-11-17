/* שפות: עברית (מקור), אנגלית וספרדית.
   הקוד נשאר בעברית. המסך מתורגם בזמן אמת: כל טקסט שנכנס לדף עובר דרך T(), שמחפש אותו במילון (i18n/en.js, i18n/es.js).
   מפתח במילון הוא מה שמופיע בצומת טקסט אחד. {} במפתח הוא ערך משתנה (מספר, שם), ובתרגום הוא {0}, {1}…
   את המפתחות אוסף tools/i18n-extract.mjs. תוכן שמשתמשים כותבים (צ׳אט, כיתובים, שמות) מסומן translate="no" ולא מתורגם. */
(() => {
  const HEB = /[֐-׿]/, LANGS = { he: 'he-IL', en: 'en-GB', es: 'es-ES' };
  let lang = null; try { lang = localStorage.getItem('lisboa.lang'); } catch {}
  if (!LANGS[lang]) {   // בפעם הראשונה: לפי שפת הטלפון. מי שכבר משתמש באפליקציה נשאר בעברית
    const n = (navigator.language || 'he').slice(0, 2).toLowerCase(); let old = false; try { old = !!localStorage.getItem('lisboa.v1'); } catch {}
    lang = old || n === 'he' || n === 'iw' ? 'he' : n === 'es' ? 'es' : 'en';
  }
  window.LANG = lang; window.LOC = LANGS[lang]; window.I18N = {};
  // מצגת: טקסט קבוע שמצויר על הקנבס מתורגם; טקסט של המשתמש (כיתובים) מצויר דרך rawFill/rawMeasure ולא נוגעים בו
  const CP = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  if (CP) { CP.rawFill = CP.fillText; CP.rawMeasure = CP.measureText; }
  window.setLang = l => { try { localStorage.setItem('lisboa.lang', l); } catch {} location.reload(); };
  if (lang === 'he') { window.T = s => s; return; }
  document.documentElement.lang = lang; document.documentElement.dir = 'ltr';
  document.write('<script src="i18n/' + lang + '.js"><\/script>');

  const cache = new Map(), miss = window.__i18nMiss = new Set();
  let pats = null, subs = null, parts = null;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fill = (tr, vals) => tr.replace(/\{(\d+)\}/g, (m, i) => { const v = vals[+i]; return v == null ? '' : HEB.test(v) ? T(v) : v; });
  function build() {
    pats = []; subs = []; parts = {};
    for (const k in I18N) {
      if (k.includes(' – ')) { const a = k.split(' – '), b = I18N[k].split(' – '); if (a.length === b.length) a.forEach((x, i) => { if (!(x in parts)) parts[x] = b[i]; }); }   // "שם – תיאור": גם כל חלק לחוד
      if (k.includes('{}')) pats.push({ re: new RegExp('^' + k.split('{}').map(esc).join('([\\s\\S]+?)') + '$'), tr: I18N[k], w: k.replace(/\{\}/g, '').length });
      else if (k.length >= 3 && k.length <= 40) subs.push(k);
    }
    pats.sort((a, b) => b.w - a.w); subs.sort((a, b) => b.length - a.length);
  }
  function core(s) {            // s: מנורמל (רווח יחיד, בלי רווחים בקצוות)
    if (s in I18N) return I18N[s];
    if (!pats) build();
    if (s in parts) return parts[s];
    const pre = /^([^\u0590-\u05FFA-Za-z0-9]+)([\s\S]+)$/.exec(s);   // אימוג׳י או סימן לפני הטקסט
    if (pre && (pre[2] in I18N || pre[2] in parts)) return pre[1] + (I18N[pre[2]] || parts[pre[2]]);
    for (const p of pats) { const m = p.re.exec(s); if (m) return fill(p.tr, m.slice(1)); }
    for (const sep of [' · ', ' | ', ' – ', ': ', ', ']) if (s.includes(sep)) {   // כמה ערכים שחוברו יחד
      const parts = s.split(sep), tr = parts.map(x => HEB.test(x) ? T(x) : x);
      if (tr.some((x, i) => x !== parts[i])) return tr.join(sep);
    }
    let out = s, hit = false;   // מוצא אחרון: ביטויים מהמילון שמופיעים בתוך הטקסט
    for (const k of subs) { if (!out.includes(k)) continue; const re = new RegExp('(^|[^\\u0590-\\u05FF])' + esc(k) + '(?![\\u0590-\\u05FF])', 'g'); const n = out.replace(re, (m, a) => a + I18N[k]); if (n !== out) { out = n; hit = true; if (!HEB.test(out)) break; } }
    return hit ? out : null;
  }
  function T(s) {
    if (typeof s !== 'string' || !HEB.test(s)) return s;
    if (cache.has(s)) return cache.get(s);
    let out;
    if (s.includes('\n') && !(s.replace(/\s+/g, ' ').trim() in I18N)) out = s.split('\n').map(T).join('\n');   // טקסט לשיתוף: שורה שורה
    else { const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s), n = m[2].replace(/\s+/g, ' '), tr = core(n); out = tr == null ? s : m[1] + tr + m[3]; if (tr == null || HEB.test(tr)) miss.add(n); }
    if (cache.size < 6000) cache.set(s, out);
    return out;
  }
  window.T = T;
  if (CP) { CP.fillText = function (t, ...a) { return CP.rawFill.call(this, T(String(t)), ...a); }; CP.measureText = function (t) { return CP.rawMeasure.call(this, T(String(t))); }; }

  // ───── תרגום הדף עצמו ─────
  const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  const skip = n => { const el = n.nodeType === 1 ? n : n.parentElement; return !el || !!el.closest('[translate=no], script, style, textarea'); };
  function text(n) { const v = n.nodeValue; if (v && HEB.test(v) && !skip(n)) { const t = T(v); if (t !== v) n.nodeValue = t; } }
  function attrs(el) { for (const a of ATTRS) { const v = el.getAttribute(a); if (v && HEB.test(v) && !el.closest('[translate=no]')) { const t = T(v); if (t !== v) el.setAttribute(a, t); } } }
  function tree(root) {
    if (root.nodeType === 3) return text(root);
    if (root.nodeType !== 1) return;
    attrs(root); root.querySelectorAll('[placeholder], [aria-label], [title], [alt]').forEach(attrs);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) text(n);
  }
  new MutationObserver(list => { for (const m of list) {
    if (m.type === 'characterData') text(m.target);
    else if (m.type === 'attributes') attrs(m.target);
    else m.addedNodes.forEach(tree);
  } }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  // שיתוף (וואטסאפ וכו׳) והעתקה: גם הטקסט שיוצא מהאפליקציה מתורגם
  const sh = navigator.share && navigator.share.bind(navigator);
  if (sh) navigator.share = d => sh(d && typeof d === 'object' ? { ...d, ...(d.text ? { text: T(d.text) } : {}), ...(d.title ? { title: T(d.title) } : {}) } : d);
  const cw = navigator.clipboard && navigator.clipboard.writeText && navigator.clipboard.writeText.bind(navigator.clipboard);
  if (cw) navigator.clipboard.writeText = s => cw(T(s));
})();

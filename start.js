/* איך מתחילים: צעדים עם צילומי מסך. הכרטיס בעמוד הבית נעלם כשהכול הושלם או כשמסתירים אותו */
(() => {
  const A = window.APP, $ = s => document.querySelector(s);
  const ls = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const grp = () => { try { return JSON.parse(ls('lisboa.group') || '{}'); } catch { return {}; } };
  const alone = matchMedia('(display-mode: standalone)').matches || !!navigator.standalone;
  const STEPS = [
    ...(alone ? [] : [{ id: 'install', h: 'להתקין במסך הבית', btn: 'התקנה', act: () => A.install?.(),
      p: 'כדי שהאפליקציה תעבוד במסך מלא, עם התראות וגם בלי קליטה, מתקינים אותה במסך הבית ופותחים אותה רק מהאייקון. מי שמקבל קישור הזמנה לקבוצה מתקין ישר ממנו.',
      done: () => false }]),
    { id: 'map', h: 'להוריד את המפה', img: 'help/map.jpg', btn: 'למפה בלי אינטרנט', jump: 'offlineCard',
      p: 'עושים את זה ב־Wi‑Fi, עוד לפני הטיסה. אחרי ההורדה המפה של ליסבון עובדת גם בלי חבילת גלישה, והנקודה הכחולה ממשיכה להראות את המיקום.',
      done: () => !!ls('lisboa.offline2') },
    { id: 'hotel', h: 'לקבוע את המלון', img: 'help/hotel.jpg', btn: 'לכרטיס המלון', home: 'hotelCard',
      p: 'בעמוד הבית, בכרטיס "המלון שלנו", כותבים את שם המלון ובוחרים אותו מהתוצאות. המלון מסומן במפה, המרחקים מחושבים ממנו, ויש כפתור ניווט חזרה.',
      done: () => !!A.S.hotel },
    { id: 'trip', h: 'להגדיר את הנסיעה', img: 'help/trip.jpg', btn: 'להגדרת הנסיעה', act: () => A.hooks.editTrip(),
      p: 'בוחרים סוג נסיעה (בנות, בנים, משפחה או חברים), שם ואירוע אם יש. לפי זה האפליקציה מסדרת את ההמלצות, המסלול והיומן.',
      done: () => TRIP.cfg.set },
    { id: 'group', h: 'להקים קבוצה', img: 'help/group.jpg', btn: 'לקבוצה', go: 'group',
      p: 'מי שמארגן לוחץ "פתיחת קבוצה חדשה" והופך למנהל הקבוצה. "הזמנה לקבוצה" שולח בוואטסאפ קישור: מי שלוחץ עליו מתקין את האפליקציה במסך הבית ומצטרף, בלי להזין קוד. הנסיעה והמלון עוברים לכולם לבד.',
      done: () => !!grp().code },
    { id: 'chat', h: 'לכתוב בצ׳אט', img: 'help/chat.jpg', btn: 'לצ׳אט', go: 'chat',
      p: 'הלשונית "צ׳אט" היא שיחה של הקבוצה בלבד: הודעות, סמיילים, תמונות, סרטונים קצרים ומיקום. ✓✓ כחול אומר שכולם קראו. כדאי להפעיל התראות בעמוד הקבוצה.',
      done: () => { const g = grp(); return (g.msgs || []).some(m => m.d === g.id && m.x !== null); } },
    { id: 'journal', h: 'לצלם ליומן', img: 'help/journal.jpg', btn: 'ליומן', go: 'journal',
      p: 'בלשונית "יומן" יש יומן אישי ויומן משותף. מצלמים תמונה או סרטון, מוסיפים כמה מילים ושומרים. בסוף הטיול הכפתור "מצגת הטיול" הופך את הכול למצגת.',
      done: async () => (await A.journal.all().catch(() => [])).length > 0 },
  ];
  async function render() {
    const done = await Promise.all(STEPS.map(s => s.done())), n = done.filter(Boolean).length;
    $('#startSteps').innerHTML = STEPS.map((s, i) => `<div class="step ${done[i] ? 'done' : ''}">
      <div class="step-n">${done[i] ? '✓' : i + 1}</div>
      <div class="step-b"><h3>${s.h}</h3><p>${s.p}</p>
        ${s.img ? `<button type="button" class="step-shot" data-shot="${s.img}" aria-label="הגדלת צילום המסך"><img src="${s.img}" alt="צילום מסך: ${s.h}" loading="lazy"></button>` : ''}
        <button type="button" class="btn sm ${done[i] ? 'ghost' : ''}" data-step="${i}">${s.btn}</button></div></div>`).join('');
    $('#startCount').textContent = `${n} מתוך ${STEPS.length}`;
    $('#startDots').innerHTML = STEPS.map((s, i) => `<span class="${done[i] ? 'on' : ''}">${done[i] ? '✓' : i + 1}</span><small>${s.h}</small>`).join('');
    const show = n < STEPS.length && !ls('lisboa.startHide');
    $('#startHome').hidden = !show; if (show) $('#setupCard').hidden = true;   // הכרטיס הזה כבר כולל את הגדרת הנסיעה
  }
  $('#startSteps').onclick = e => {
    const shot = e.target.closest('[data-shot]'); if (shot) { $('#shotImg').src = shot.dataset.shot; return $('#shotDlg').showModal(); }
    const b = e.target.closest('[data-step]'); if (!b) return; const s = STEPS[+b.dataset.step];
    if (s.act) return s.act();
    if (s.go) return A.go(s.go);
    if (s.home) { A.go('home'); return setTimeout(() => document.getElementById(s.home).scrollIntoView({ block: 'start', behavior: 'smooth' }), 80); }
    if (s.jump) { A.go('more'); const el = document.getElementById(s.jump); if (el.tagName === 'DETAILS') el.open = true; setTimeout(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80); }
  };
  $('#shotClose').onclick = () => $('#shotDlg').close();
  $('#shotDlg').addEventListener('click', e => { if (e.target.id !== 'shotClose') $('#shotDlg').close(); });
  $('#startHide').onclick = () => { try { localStorage.setItem('lisboa.startHide', '1'); } catch {} $('#startHome').hidden = true; if (!TRIP.cfg.set) $('#setupCard').hidden = false; };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  document.addEventListener('click', e => { if (e.target.closest('[data-go], [data-jump], [data-step], dialog button')) setTimeout(render, 400); });   // מתעדכן כשעוברים בין מסכים או סוגרים חלון
  render();
  A.start = { render };
})();

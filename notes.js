/* פנקס ותזכורות: רשימה אישית לכל נסיעה (נשמרת ב-S.notes, יחד עם שאר נתוני הנסיעה).
   תזכורת עם שעה מופיעה במסך הבית ביום שלה, וקופצת כהודעה כשהאפליקציה פתוחה (וגם כהתראה, אם אושרו התראות). */
(() => {
  const A = window.APP, $ = s => document.querySelector(s), esc = A.esc;
  const S = A.S; S.notes ||= [];
  const save = () => { A.save(); render(); };
  const pad = n => String(n).padStart(2, '0');
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const when = iso => { const d = new Date(iso), now = new Date(), tm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const tom = new Date(now); tom.setDate(now.getDate() + 1);
    return sameDay(d, now) ? `היום ${tm}` : sameDay(d, tom) ? `מחר ${tm}` : `${d.toLocaleDateString(LOC, { day: 'numeric', month: 'numeric' })} ${tm}`; };
  const order = (a, b) => (a.done - b.done) || ((a.at ? Date.parse(a.at) : Infinity) - (b.at ? Date.parse(b.at) : Infinity)) || (b.id > a.id ? 1 : -1);

  function render() {
    const list = [...S.notes].sort(order), open = list.filter(n => !n.done), now = Date.now();
    $('#notesCount').textContent = open.length || ''; $('#notesCount').hidden = !open.length;
    $('#notesList').innerHTML = list.length ? list.map(n => { const late = n.at && !n.done && Date.parse(n.at) <= now;
      return `<div class="note-row${n.done ? ' done' : ''}"><button type="button" class="note-check" data-done="${n.id}" aria-label="${n.done ? 'סימון כלא בוצע' : 'סימון כבוצע'}">${n.done ? '✓' : ''}</button>
        <span><b translate="no">${esc(n.t)}</b>${n.at ? `<small class="${late ? 'late' : ''}">⏰ ${when(n.at)}</small>` : ''}</span>
        <button type="button" class="note-x" data-del="${n.id}" aria-label="מחיקה">✕</button></div>`; }).join('')
      : '<p class="muted small">עוד אין רשומות. דברים לזכור, מה לקנות, מה להזמין.</p>';
    // במסך הבית: תזכורות של היום ותזכורות שעבר זמנן
    const today = open.filter(n => n.at && (Date.parse(n.at) <= now || sameDay(new Date(n.at), new Date()))).slice(0, 3);
    const box = $('#noteHome'); box.hidden = !today.length;
    box.innerHTML = today.length ? `<div class="card-head"><h2>תזכורות להיום</h2><button class="link" data-jump="notesCard" type="button">לפנקס</button></div>` +
      today.map(n => `<div class="nh-row${Date.parse(n.at) <= now ? ' late' : ''}"><button type="button" class="note-check" data-done="${n.id}" aria-label="סימון כבוצע"></button><span><small>⏰ ${when(n.at)}</small><b translate="no">${esc(n.t)}</b></span></div>`).join('') : '';
    const dot = $('#moreDot'); if (dot) dot.hidden = !open.some(n => n.at && Date.parse(n.at) <= now);
  }
  const toggle = id => { const n = S.notes.find(x => x.id === id); if (n) { n.done = n.done ? 0 : 1; save(); } };
  $('#notesList').onclick = e => { const d = e.target.closest('[data-done]'), x = e.target.closest('[data-del]');
    if (d) toggle(d.dataset.done);
    if (x) { S.notes = S.notes.filter(n => n.id !== x.dataset.del); save(); } };
  $('#noteHome').addEventListener('click', e => { const d = e.target.closest('[data-done]'); if (d) toggle(d.dataset.done); });
  $('#noteForm').onsubmit = e => { e.preventDefault(); const t = $('#noteText').value.trim(); if (!t) return $('#noteText').focus();
    const at = $('#noteAt').value;
    S.notes.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t: t.slice(0, 200), at: at || '', done: 0, fired: at && Date.parse(at) <= Date.now() ? 1 : 0 });
    $('#noteText').value = ''; $('#noteAt').value = ''; $('#noteWhen').hidden = true; $('#noteBell').classList.remove('on'); save();
    if (at && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); };
  $('#noteBell').onclick = () => { const w = $('#noteWhen'); w.hidden = !w.hidden; $('#noteBell').classList.toggle('on', !w.hidden);
    if (!w.hidden && !$('#noteAt').value) { const d = new Date(Date.now() + 3600e3); d.setMinutes(0, 0, 0); $('#noteAt').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
    if (w.hidden) $('#noteAt').value = ''; };

  // כשמגיע הזמן: הודעה באפליקציה, והתראה של הטלפון אם אושרו התראות
  async function tick() {
    const now = Date.now(), due = S.notes.filter(n => n.at && !n.done && !n.fired && Date.parse(n.at) <= now);
    if (!due.length) return render();
    for (const n of due) { n.fired = 1; A.toast('⏰ ' + n.t, 8000);
      try { if ('Notification' in window && Notification.permission === 'granted') { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) reg.showNotification(document.title, { body: '⏰ ' + n.t, icon: 'icon-192.png', tag: 'note-' + n.id }); } } catch {} }
    save();
  }
  setInterval(tick, 20000); document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  tick();
  A.notes = { render };
})();

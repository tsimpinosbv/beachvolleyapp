/* BV Supervisor Tools — ανάγνωση του Calendar.xlsx (κοινή για Ημερολόγιο και Τουρνουά).
 *   BVCal.parse(wb) → {events, errors, title}   (wb από XLSX.read)
 *   BVCal.load()    → Promise<events>  (κατεβάζει, διαβάζει και κρατά αντίγραφο)
 *   BVCal.cached()  → events από το τελευταίο αντίγραφο (χωρίς SheetJS) */
(function(){
  function norm(v){ return String(v == null ? '' : v).toLocaleUpperCase('el-GR').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim(); }
  function toDate(v){
  if(v instanceof Date && !isNaN(v)) { const d = new Date(v.getFullYear(), v.getMonth(), v.getDate()); return d; }
  if(typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return d ? new Date(d.y, d.m - 1, d.d) : null; }
  const m = String(v || '').trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if(m){ const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return new Date(y, +m[2] - 1, +m[1]); }
  return null;
}
  function parse(wb){
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'', raw:true });
  const hi = rows.findIndex(r => r.some(c => norm(c) === 'ΤΟΥΡΝΟΥΑ'));
  if(hi === -1) return { events:[], errors:['Δεν βρέθηκε η γραμμή επικεφαλίδων (ΤΟΥΡΝΟΥΑ, ΑΠΟ, …).'], title:'' };
  const h = rows[hi].map(norm);
  const col = (...names) => h.findIndex(x => names.some(n => x.startsWith(n)));
  const c = { name: col('ΤΟΥΡΝΟΥΑ'), place: col('ΤΟΠΟΣ'), from: col('ΑΠΟ'), to: col('ΕΩΣ'), coef: col('ΣΥΝΤΕΛΕΣΤ'),
              cats: col('ΚΑΤΗΓΟΡΙ'), dl: col('ΠΡΟΘΕΣΜΙΑ'), fee: col('ΠΑΡΑΒΟΛ'), prize: col('ΕΠΑΘΛ'), notes: col('ΣΗΜΕΙΩΣ') };
  const events = [], errors = [];
  rows.slice(hi + 1).forEach((r, i) => {
    const name = String(r[c.name] || '').trim(); if(!name) return;
    const from = toDate(r[c.from]), to = c.to >= 0 ? toDate(r[c.to]) : null;
    if(!from){ errors.push(`Γραμμή ${hi + 2 + i} (${name}): λείπει ή δεν διαβάζεται η ημερομηνία ΑΠΟ.`); return; }
    const coefRaw = c.coef >= 0 ? r[c.coef] : '';
    const coef = coefRaw === '' ? null : (typeof coefRaw === 'number' ? coefRaw : parseFloat(String(coefRaw).replace(',', '.')));
    events.push({ name, place: c.place >= 0 ? String(r[c.place] || '').trim() : '', from, to: to || from,
      coef: isNaN(coef) ? null : coef, cats: c.cats >= 0 ? String(r[c.cats] || '').trim() : '',
      dl: c.dl >= 0 ? toDate(r[c.dl]) : null, fee: c.fee >= 0 ? r[c.fee] : '', prize: c.prize >= 0 ? r[c.prize] : '',
      notes: c.notes >= 0 ? String(r[c.notes] || '').trim() : '' });
  });
  events.sort((a, b) => a.from - b.from);
  const title = String((rows[0] || [])[0] || '').trim();
  if(!events.length && !errors.length) errors.push('Δεν βρέθηκε κανένα τουρνουά κάτω από τις επικεφαλίδες.');
  return { events, errors, title };
}
  const CACHE = 'calendarCache_v1';
  const iso = d => d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : '';
  const pd = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  function cache(events){
    try{ localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), events: events.map(e => Object.assign({}, e, { from: iso(e.from), to: iso(e.to), dl: iso(e.dl) })) })); }catch(e){}
  }
  function cached(){
    try{ const c = JSON.parse(localStorage.getItem(CACHE) || 'null'); if(!c) return [];
      return c.events.map(e => Object.assign({}, e, { from: pd(e.from), to: pd(e.to), dl: pd(e.dl) })); }catch(e){ return []; }
  }
  async function load(){
    const r = await fetch('Calendar.xlsx?t=' + Date.now()); if(!r.ok) throw new Error('http ' + r.status);
    const res = parse(XLSX.read(new Uint8Array(await r.arrayBuffer()), { type:'array' }));
    cache(res.events); return res.events;
  }
  window.BVCal = { parse, load, cache, cached, iso };
})();

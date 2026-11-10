/* BV Supervisor Tools — «ενεργό τουρνουά» κοινό για όλα τα εργαλεία.
 *
 * Τα εργαλεία ενός τουρνουά (Αρχική Λίστα, Πρόγραμμα, Πληρωμές, Φύλλο πληρωμής)
 * κρατούν τα δεδομένα τους σε δικά τους κλειδιά. Όταν αλλάζεις τουρνουά, τα κλειδιά
 * του προηγούμενου φυλάγονται σε «θήκη» (tourBuckets_v1) και φορτώνονται του νέου.
 * Λίστα Ελέγχου και Αναφορά έχουν ήδη πολλά τουρνουά: επιλέγεται/φτιάχνεται το σωστό.
 *
 *   BVTour.get()           → ενεργό τουρνουά ή null
 *   BVTour.switchTo(meta)  → αλλαγή (meta: {name, place, from, to, coef, cats})
 *   BVTour.list()          → προηγούμενα τουρνουά της συσκευής
 *   BVTour.progress()      → κατάσταση κάθε εργαλείου για το ενεργό τουρνουά
 *   BVTour.backup()/restore(obj)
 */
(function(){
  const ACTIVE = 'activeTournament_v1', BUCKETS = 'tourBuckets_v1';
  const SWAP = ['entryListSeeded_v1', 'entryListDraft_v1', 'schedulesState_v2', 'payments_v1', 'prizeSheet_v1'];
  const NEVER_BACKUP = ['bvGithubToken'];
  const MSH = ['Ιαν','Φεβ','Μαρ','Απρ','Μαΐ','Ιουν','Ιουλ','Αυγ','Σεπ','Οκτ','Νοε','Δεκ'];

  const read = k => { try{ return JSON.parse(localStorage.getItem(k) || 'null'); }catch(e){ return null; } };
  const write = (k, v) => { try{ if(v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
  const norm = s => String(s || '').toLocaleUpperCase('el-GR').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ---- ημερομηνίες (ISO yyyy-mm-dd) ----
  const pd = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  function datesText(t){ // «24-26/7/2026» (μορφή που ήδη γράφουν οι φόρμες)
    const a = pd(t.from), b = pd(t.to) || a; if(!a) return t.dates || '';
    if(+a === +b) return a.getDate() + '/' + (a.getMonth() + 1) + '/' + a.getFullYear();
    if(a.getMonth() === b.getMonth()) return a.getDate() + '-' + b.getDate() + '/' + (a.getMonth() + 1) + '/' + a.getFullYear();
    return a.getDate() + '/' + (a.getMonth() + 1) + '-' + b.getDate() + '/' + (b.getMonth() + 1) + '/' + b.getFullYear();
  }
  function rangeShort(t){ // «24-26 Ιουλ»
    const a = pd(t.from), b = pd(t.to) || a; if(!a) return t.dates || '';
    if(+a === +b) return a.getDate() + ' ' + MSH[a.getMonth()];
    if(a.getMonth() === b.getMonth()) return a.getDate() + '-' + b.getDate() + ' ' + MSH[a.getMonth()];
    return a.getDate() + ' ' + MSH[a.getMonth()] + ' – ' + b.getDate() + ' ' + MSH[b.getMonth()];
  }
  function daysTo(t){ const a = pd(t.from), b = pd(t.to) || a; if(!a) return null;
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if(d >= a && d <= b) return 0; return Math.round((a - d) / 86400000); }
  const iso = d => d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : '';

  function makeMeta(m){
    const season = String(m.season || (m.from ? m.from.slice(0, 4) : '') || (String(m.dates || '').match(/20\d\d/) || [])[0] || new Date().getFullYear());
    const t = { id: m.id || (season + '-' + norm(m.name).replace(/[^A-Z0-9Α-Ω]+/g, '-').replace(/^-|-$/g, '') + (m.from ? '-' + m.from.slice(5) : '')),
      name: String(m.name || '').trim(), place: m.place || '', from: m.from || '', to: m.to || m.from || '',
      coef: m.coef != null && m.coef !== '' ? m.coef : null, cats: m.cats || '', season, setAt: Date.now() };
    t.dates = m.from ? datesText(t) : (m.dates || '');
    if(m.closedAt) t.closedAt = m.closedAt;
    return t;
  }

  const get = () => read(ACTIVE);
  const buckets = () => read(BUCKETS) || {};

  function snapshot(){ const d = {}; SWAP.forEach(k => { const v = localStorage.getItem(k); if(v != null) d[k] = v; }); return d; }
  function hasData(){
    const p = read('payments_v1'), e = read('entryListDraft_v1'), z = read('prizeSheet_v1');
    return !!((p && p.teams && (p.teams.MEN.length || p.teams.WOMEN.length)) || (e && e.TEAMS && (e.TEAMS.MEN.length || e.TEAMS.WOMEN.length))
      || (z && z.cats && (z.cats.MEN.teams.length || z.cats.WOMEN.teams.length)) || read('entryListSeeded_v1'));
  }
  function currentDataName(){
    for(const k of ['entryListDraft_v1', 'payments_v1', 'prizeSheet_v1', 'schedulesState_v2']){ const v = read(k); if(v && v.tName) return v.tName; }
    return '';
  }

  // Συμπλήρωση ονόματος/ημερομηνιών/τόπου όπου είναι κενά
  function fill(t){
    const set = (k, f) => { const v = read(k) || {}; f(v); write(k, v); };
    set('entryListDraft_v1', v => { if(!v.tName) v.tName = t.name; if(!v.tDates) v.tDates = t.dates; });
    set('schedulesState_v2', v => { if(!v.tName) v.tName = t.name; });
    set('prizeSheet_v1', v => { if(!v.tName) v.tName = t.name; if(!v.tDate) v.tDate = t.dates; if(!v.tPlace) v.tPlace = t.place; if(!v.season) v.season = t.season; });
    set('payments_v1', v => { if(!v.tName) v.tName = t.name; });
    // Λίστα ελέγχου: ένα ανά τουρνουά
    const c = read('checklist_v1');
    if(c && Array.isArray(c.tournaments)){
      let x = c.tournaments.find(y => y.tourId === t.id) || c.tournaments.find(y => !y.tourId && norm(y.name) === norm(t.name));
      if(!x){
        const blank = c.tournaments.find(y => !y.tourId && Object.keys(y.checks || {}).length === 0 && /^(Το τουρνουά μου|Τουρνουά)?$/.test(y.name || ''));
        x = blank || { id: uid(), created: Date.now(), checks:{}, notes:{} };
        if(!blank) c.tournaments.unshift(x);
        x.name = t.name;
      }
      x.tourId = t.id; c.current = x.id; write('checklist_v1', c);
    } else write('checklist_v1', { tournaments:[{ id: uid(), name: t.name, created: Date.now(), checks:{}, notes:{}, tourId: t.id }], current: null, custom:{}, edits:{}, hidden:{} });
    const c2 = read('checklist_v1'); if(c2 && !c2.current){ c2.current = c2.tournaments[0].id; write('checklist_v1', c2); }
    // Αναφορά: μία ανά τουρνουά
    const R = read('supervisorReport_v1') || { reports:[], current:null };
    let r = R.reports.find(y => y.tourId === t.id) || R.reports.find(y => !y.tourId && norm((y.f && y.f.name) || y.name) === norm(t.name));
    if(!r){
      const blank = R.reports.find(y => !y.tourId && !(y.f && y.f.name) && !(y.incidents || []).length);
      const prev = R.reports.find(y => y.f && y.f.supervisor);
      r = blank || { id: uid(), created: Date.now(), f:{ incPay:true }, rates:{}, weather:[], incidents:[] };
      if(!blank) R.reports.unshift(r);
      if(prev && !r.f.supervisor) r.f.supervisor = prev.f.supervisor;
    }
    r.tourId = t.id; r.name = r.name || t.name;
    r.f = r.f || {}; if(!r.f.name) r.f.name = t.name; if(!r.f.place) r.f.place = t.place; if(!r.f.dates) r.f.dates = t.dates;
    if(!r.season) r.season = t.season;
    R.current = r.id; write('supervisorReport_v1', R);
  }

  // Αλλαγή ενεργού τουρνουά
  function switchTo(m){
    const t = makeMeta(m), cur = get(), B = buckets();
    if(cur && cur.id === t.id){ write(ACTIVE, Object.assign(cur, t, { closedAt: cur.closedAt })); fill(get()); return get(); }
    const regList = (read('payments_v1') || {}).regList; // μητρώο σεζόν: κοινό για όλα τα τουρνουά
    const prevPay = read('payments_v1') || {};
    if(cur){ B[cur.id] = { meta: cur, data: snapshot(), savedAt: Date.now() }; }
    else if(hasData()){
      const nm = currentDataName();
      if(!nm || norm(nm) === norm(t.name)){ /* τα υπάρχοντα στοιχεία ανήκουν σε αυτό το τουρνουά */ write(BUCKETS, B); write(ACTIVE, t); fill(t); return t; }
      const old = makeMeta({ name: nm, id: 'prev-' + uid() }); B[old.id] = { meta: old, data: snapshot(), savedAt: Date.now() };
    }
    const nb = B[t.id];
    SWAP.forEach(k => { const v = nb && nb.data[k]; if(v != null) localStorage.setItem(k, v); else localStorage.removeItem(k); });
    // πληρωμές: νέο τουρνουά με τις ίδιες ρυθμίσεις, ίδιο μητρώο σεζόν
    const pay = read('payments_v1') || { fee: prevPay.fee != null ? prevPay.fee : 40, per: prevPay.per || 'team', regFee: prevPay.regFee || '', teams:{ MEN:[], WOMEN:[] } };
    if(Array.isArray(regList)) pay.regList = regList;
    write('payments_v1', pay);
    if(nb){ if(nb.meta.closedAt && !t.closedAt) t.closedAt = nb.meta.closedAt; delete B[t.id]; }
    write(BUCKETS, B); write(ACTIVE, t); fill(t);
    return t;
  }
  function update(fields){ const t = get(); if(!t) return null; Object.assign(t, fields); write(ACTIVE, t); return t; }

  function list(){ const B = buckets(); return Object.values(B).map(b => Object.assign({}, b.meta, { savedAt: b.savedAt })).sort((a, b) => String(b.from).localeCompare(String(a.from)) || b.savedAt - a.savedAt); }
  function forget(id){ const B = buckets(); delete B[id]; write(BUCKETS, B); }
  // Όλα τα δεδομένα του ενεργού τουρνουά (για αρχείο σεζόν)
  function bundle(){
    const t = get(), d = {}; SWAP.forEach(k => { const v = read(k); if(v != null) d[k] = v; });
    const c = read('checklist_v1'), R = read('supervisorReport_v1');
    const cl = c && c.tournaments.find(x => x.tourId === (t && t.id));
    return { app:'BV Supervisor Tools', kind:'tournament', meta: t, data: d,
      checklist: cl ? { item: cl, custom: c.custom, edits: c.edits, hidden: c.hidden } : null,
      report: R && R.reports.find(x => x.tourId === (t && t.id)) || null };
  }
  // Επαναφορά τουρνουά από το αρχείο
  function restoreBundle(b){
    const t = switchTo(Object.assign({}, b.meta, { id: b.meta.id }));
    Object.entries(b.data || {}).forEach(([k, v]) => { if(SWAP.includes(k) && k !== 'payments_v1') write(k, v); });
    if(b.data && b.data.payments_v1){ const p = b.data.payments_v1, reg = (read('payments_v1') || {}).regList; if(reg) p.regList = reg; write('payments_v1', p); }
    if(b.checklist){ const c = read('checklist_v1'); const i = c.tournaments.findIndex(x => x.tourId === t.id);
      const item = Object.assign({}, b.checklist.item, { tourId: t.id }); if(i >= 0) c.tournaments[i] = item; else c.tournaments.unshift(item); c.current = item.id; write('checklist_v1', c); }
    if(b.report){ const R = read('supervisorReport_v1') || { reports:[] }; const r = Object.assign({}, b.report, { tourId: t.id });
      R.reports = R.reports.filter(x => x.tourId !== t.id && x.id !== r.id); R.reports.unshift(r); R.current = r.id; write('supervisorReport_v1', R); }
    return t;
  }

  // ---- πρόοδος ανά εργαλείο ----
  function progress(){
    const t = get(), out = [];
    const el = read('entryListDraft_v1'), seeded = read('entryListSeeded_v1');
    const nM = el && el.TEAMS && el.TEAMS.MEN.length ? el.TEAMS.MEN.length : (seeded && seeded.MEN || []).length, nW = el && el.TEAMS && el.TEAMS.WOMEN.length ? el.TEAMS.WOMEN.length : (seeded && seeded.WOMEN || []).length;
    out.push({ k:'entry', label:'Αρχική Λίστα', href:'EntryList.html',
      state: seeded && ((seeded.MEN || []).length + (seeded.WOMEN || []).length) ? 'done' : (nM + nW ? 'doing' : 'todo'),
      text: nM + nW ? `${nM} ανδρών · ${nW} γυναικών` : 'Καμία ομάδα ακόμα' });
    const sc = read('schedulesState_v2');
    out.push({ k:'sched', label:'Πρόγραμμα Αγώνων', href:'Schedules.html', state: 'info',
      text: sc && sc.courts ? `${sc.courts} γήπεδα · ${sc.days || 1} ${sc.days === 1 ? 'ημέρα' : 'ημέρες'}` : 'Δεν έχει ρυθμιστεί' });
    const p = read('payments_v1');
    if(p && p.teams){ const all = p.teams.MEN.concat(p.teams.WOMEN), paid = all.filter(x => x.status === 'cash' || x.status === 'bank' || (x.exempt && !(x.reg || []).includes('owes'))).length;
      out.push({ k:'pay', label:'Πληρωμές', href:'Payments.html', state: !all.length ? 'todo' : paid === all.length ? 'done' : 'doing',
        text: all.length ? `${paid}/${all.length} ομάδες εξοφλημένες` : 'Δεν έχουν μπει ομάδες' });
    } else out.push({ k:'pay', label:'Πληρωμές', href:'Payments.html', state:'todo', text:'Δεν έχουν μπει ομάδες' });
    const c = read('checklist_v1'), ci = c && c.tournaments && c.tournaments.find(x => t && x.tourId === t.id);
    const pr = ci && ci.progress;
    out.push({ k:'check', label:'Λίστα Ελέγχου', href:'Checklist.html', state: pr && pr.total ? (pr.done >= pr.total ? 'done' : pr.done ? 'doing' : 'todo') : 'todo',
      text: pr && pr.total ? `${pr.done}/${pr.total} έλεγχοι (${Math.round(pr.done * 100 / pr.total)}%)` : 'Δεν έχει ξεκινήσει' });
    const R = read('supervisorReport_v1'), r = R && R.reports.find(x => t && x.tourId === t.id);
    const filled = r ? ['general','courts','medic','referees','organizer'].filter(k => r.f && r.f[k]).length + Object.keys(r.rates || {}).length + (r.incidents || []).length : 0;
    out.push({ k:'report', label:'Αναφορά Supervisor', href:'Report.html', state: r && r.archivedAt ? 'done' : filled ? 'doing' : 'todo',
      text: r && r.archivedAt ? 'Στο αρχείο σεζόν' : filled ? `Σε εξέλιξη${(r.incidents || []).length ? ' · ' + r.incidents.length + ' περιστατικά' : ''}` : 'Δεν έχει ξεκινήσει' });
    const z = read('prizeSheet_v1'), zt = z && z.cats ? z.cats.MEN.teams.concat(z.cats.WOMEN.teams) : [], zp = zt.filter(x => x.place).length;
    out.push({ k:'prize', label:'Φύλλο Πληρωμής Επάθλων', href:'PrizeSheet.html', state: z && z.archivedAt ? 'done' : zp ? 'doing' : 'todo',
      text: z && z.archivedAt ? 'Στο αρχείο σεζόν' : zt.length ? `${zp}/${zt.length} ομάδες με θέση` : 'Δεν έχει ξεκινήσει' });
    return out;
  }

  // ---- αντίγραφο ασφαλείας ----
  function backup(){
    const keys = {};
    for(let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if(!NEVER_BACKUP.includes(k)) keys[k] = localStorage.getItem(k); }
    return { app:'BV Supervisor Tools', kind:'backup', createdAt: new Date().toISOString(), keys };
  }
  function restore(obj){
    if(!obj || obj.app !== 'BV Supervisor Tools' || obj.kind !== 'backup' || !obj.keys) throw new Error('Δεν είναι αντίγραφο ασφαλείας του BV Supervisor Tools.');
    Object.entries(obj.keys).forEach(([k, v]) => { if(!NEVER_BACKUP.includes(k)) localStorage.setItem(k, v); });
    return Object.keys(obj.keys).length;
  }

  // ---- λωρίδα «Τουρνουά: …» κάτω από τη μπάρα (σελίδες με data-bar) ----
  function bar(){
    const nav = document.querySelector('.bv-topbar'); if(!nav || document.querySelector('.bv-tour')) return;
    const t = get(), a = document.createElement('a');
    a.className = 'bv-tour'; a.href = 'Tournament.html';
    const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    a.innerHTML = t ? `<span class="bv-tour-k">Τουρνουά</span><b>${esc(t.name)}</b><span class="bv-tour-d">${esc(rangeShort(t))}</span><span class="bv-tour-c">Αλλαγή ›</span>`
                    : `<span class="bv-tour-k">Τουρνουά</span><b>Δεν έχει οριστεί</b><span class="bv-tour-c">Ορισμός ›</span>`;
    nav.insertAdjacentElement('afterend', a);
    // Το «Νέο τουρνουά» μιας σελίδας θα έσβηνε τα δεδομένα του ενεργού: πάμε στη σελίδα Τουρνουά
    document.addEventListener('click', e => {
      const b = e.target.closest('#clearBtn'); if(!b || !get()) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if(confirm('Για νέο τουρνουά άλλαξε το ενεργό τουρνουά. Τα δεδομένα του «' + get().name + '» φυλάγονται στη συσκευή. Να ανοίξει η σελίδα Τουρνουά;')) location.href = 'Tournament.html#new';
    }, true);
  }
  const me = document.currentScript;
  if(me && me.hasAttribute('data-bar')){
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bar); else bar();
  }

  window.BVTour = { get, switchTo, update, list, forget, bundle, restoreBundle, progress, backup, restore, makeMeta, datesText, rangeShort, daysTo, iso, SWAP };
})();

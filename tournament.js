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
  const SWAP = ['entryListSeeded_v1', 'entryListDraft_v1', 'schedulesState_v2', 'payments_v1', 'prizeSheet_v1', 'results_v1', 'poolDrawGR_v1'];
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
  // Reset ενεργού τουρνουά: σβήνει όλα τα δεδομένα του, κρατά το τουρνουά και τις ρυθμίσεις σεζόν
  function resetActive(){
    const t = get(); if(!t) return null;
    const pay = read('payments_v1') || {};
    SWAP.forEach(k => localStorage.removeItem(k));
    write('payments_v1', { fee: pay.fee != null ? pay.fee : 40, per: pay.per || 'team', regFee: pay.regFee || '', regList: pay.regList || [], teams:{ MEN:[], WOMEN:[] } });
    const c = read('checklist_v1');
    if(c && Array.isArray(c.tournaments)){ c.tournaments.forEach(x => { if(x.tourId === t.id){ x.checks = {}; x.notes = {}; delete x.progress; } }); write('checklist_v1', c); }
    const R = read('supervisorReport_v1');
    if(R && Array.isArray(R.reports)){
      const sup = (R.reports.find(x => x.f && x.f.supervisor) || {}).f;
      R.reports = R.reports.filter(x => x.tourId !== t.id);
      R.reports.unshift({ id: uid(), created: Date.now(), f:{ incPay:true, supervisor: sup ? sup.supervisor : '' }, rates:{}, weather:[], incidents:[], tourId: t.id });
      write('supervisorReport_v1', R);
    }
    delete t.doneSteps; delete t.closedAt; write(ACTIVE, t);
    fill(t);
    return t;
  }
  function update(fields){
    const t = get(); if(!t) return null;
    const old = { name: t.name, dates: t.dates, place: t.place };
    Object.assign(t, fields); write(ACTIVE, t);
    propagate(old, t);
    return t;
  }
  // Νέο όνομα/ημερομηνίες/τόπος → και στα εργαλεία, όπου είχαν τα παλιά (ή τίποτα)
  function propagate(o, t){
    const same = (v, ov) => !v || norm(v) === norm(ov);
    const set = (k, f) => { const v = read(k); if(v){ f(v); write(k, v); } };
    set('entryListDraft_v1', v => { if(same(v.tName, o.name)) v.tName = t.name; if(same(v.tDates, o.dates)) v.tDates = t.dates; });
    set('schedulesState_v2', v => { if(same(v.tName, o.name)) v.tName = t.name; });
    set('payments_v1', v => { if(same(v.tName, o.name)) v.tName = t.name; });
    set('prizeSheet_v1', v => { if(same(v.tName, o.name)) v.tName = t.name; if(same(v.tDate, o.dates)) v.tDate = t.dates; if(same(v.tPlace, o.place)) v.tPlace = t.place; });
    set('checklist_v1', c => { (c.tournaments || []).forEach(x => { if(x.tourId === t.id && same(x.name, o.name)) x.name = t.name; }); });
    set('supervisorReport_v1', R => { (R.reports || []).forEach(r => { if(r.tourId !== t.id) return;
      if(same(r.name, o.name)) r.name = t.name; r.f = r.f || {};
      if(same(r.f.name, o.name)) r.f.name = t.name; if(same(r.f.dates, o.dates)) r.f.dates = t.dates; if(same(r.f.place, o.place)) r.f.place = t.place; }); });
  }

  function list(){ const B = buckets(); return Object.values(B).map(b => Object.assign({}, b.meta, { savedAt: b.savedAt })).sort((a, b) => String(b.from).localeCompare(String(a.from)) || b.savedAt - a.savedAt); }
  // Διαγραφή τουρνουά από τη συσκευή (ενεργού ή προηγούμενου), με τη λίστα ελέγχου και την αναφορά του
  function forget(id){
    const B = buckets(); delete B[id]; write(BUCKETS, B);
    const c = read('checklist_v1');
    if(c && Array.isArray(c.tournaments)){
      c.tournaments = c.tournaments.filter(x => x.tourId !== id);
      if(!c.tournaments.some(x => x.id === c.current)) c.current = c.tournaments[0] ? c.tournaments[0].id : null;
      write('checklist_v1', c);
    }
    const R = read('supervisorReport_v1');
    if(R && Array.isArray(R.reports)){
      R.reports = R.reports.filter(x => x.tourId !== id);
      if(!R.reports.some(x => x.id === R.current)) R.current = R.reports[0] ? R.reports[0].id : null;
      write('supervisorReport_v1', R);
    }
    const t = get();
    if(t && t.id === id){
      const pay = read('payments_v1') || {};
      SWAP.forEach(k => localStorage.removeItem(k));
      // ρυθμίσεις σεζόν μένουν για το επόμενο τουρνουά
      write('payments_v1', { fee: pay.fee != null ? pay.fee : 40, per: pay.per || 'team', regFee: pay.regFee || '', regList: pay.regList || [], teams:{ MEN:[], WOMEN:[] } });
      localStorage.removeItem(ACTIVE);
    }
  }
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
    const pd = read('poolDrawGR_v1'), pdc = pd ? ['MEN','WOMEN'].filter(c => pd[c] && pd[c].pools) : [];
    out.push({ k:'draw', label:'Κλήρωση Ομίλων', href:'PoolDrawGR.html', state: pdc.length ? 'done' : 'todo',
      text: pdc.length ? pdc.map(c => (c === 'MEN' ? 'Άνδρες' : 'Γυναίκες') + ': ' + pd[c].pools.length + (pd[c].pools.length === 1 ? ' όμιλος' : ' όμιλοι')).join(' · ') : 'Δεν έχει γίνει κλήρωση' });
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
    const rs = read('results_v1'), rt = rs && rs.cats ? (rs.cats.MEN.teams || []).concat(rs.cats.WOMEN.teams || []) : [], rp = rt.filter(x => x.place).length;
    out.push({ k:'results', label:'Αποτελέσματα & Βαθμολογία', href:'Results.html', state: rs && rs.publishedAt ? 'done' : rp ? 'doing' : 'todo',
      text: rs && rs.publishedAt ? 'Στο Ranking.xlsx' : rt.length ? `${rp}/${rt.length} ομάδες με θέση` : 'Δεν έχει ξεκινήσει' });
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
  // ---- βήματα τουρνουά ----
  const STEPS = [
    { k:'tour',   n:'Τουρνουά',              href:'Tournament.html',   d:'Διάλεξε το τουρνουά που δουλεύεις' },
    { k:'entry',  n:'Αρχική Λίστα',          href:'EntryList.html',    d:'Δηλώσεις και seeding από τη βαθμολογία' },
    { k:'draw',   n:'Κλήρωση Ομίλων',        href:'PoolDrawGR.html',   d:'Όμιλοι από την Αρχική Λίστα' },
    { k:'sched',  n:'Πρόγραμμα Αγώνων',      href:'Schedules.html',    d:'Γήπεδα, ώρες και αγώνες', manual:true },
    { k:'pay',    n:'Συμμετοχές & Πληρωμές', href:'Payments.html',     d:'Ποιος πλήρωσε συμμετοχή και μητρώο' },
    { k:'check',  n:'Λίστα Ελέγχου',         href:'Checklist.html',    d:'Όλοι οι έλεγχοι του supervisor' },
    { k:'prize',  n:'Φύλλο Πληρωμής Επάθλων', href:'PrizeSheet.html',  d:'Θέσεις, ποσά και υπογραφές' },
    { k:'results', n:'Αποτελέσματα & Βαθμολογία', href:'Results.html', d:'Τελικές θέσεις → πόντοι και Ranking.xlsx' },
    { k:'report', n:'Αναφορά Supervisor',    href:'Report.html',       d:'Η αναφορά για την ομοσπονδία' },
    { k:'close',  n:'Κλείσιμο τουρνουά',     href:'Tournament.html#closeCard', d:'Όλα στο αρχείο σεζόν', admin:true }
  ];
  const isAdmin = () => document.documentElement.classList.contains('bv-admin');
  // Βήματα με κατάσταση: done (αυτόματα ή «Ολοκληρώθηκε»), doing, todo
  function steps(){
    const t = get(), P = {}, done = (t && t.doneSteps) || {};
    progress().forEach(x => P[x.k] = x);
    const out = STEPS.filter(s => !s.admin || isAdmin()).map((s, i) => {
      const p = P[s.k] || {};
      let state = p.state === 'info' ? 'todo' : (p.state || 'todo'), text = p.text || s.d;
      if(s.k === 'tour'){ state = t ? 'done' : 'todo'; text = t ? t.name + (t.from ? ' · ' + rangeShort(t) : '') : s.d; }
      if(s.k === 'close'){ state = t && t.closedAt ? 'done' : 'todo'; text = t && t.closedAt ? 'Στο αρχείο σεζόν' : s.d; }
      if(done[s.k] && state !== 'done'){ state = 'done'; }
      return Object.assign({}, s, { num: 0, state, text, manualDone: !!done[s.k] });
    });
    out.forEach((s, i) => s.num = i + 1);
    const next = out.find(s => s.state !== 'done');
    if(next) next.next = true;
    return out;
  }
  function markDone(k, v){ const t = get(); if(!t) return; t.doneSteps = t.doneSteps || {}; if(v) t.doneSteps[k] = Date.now(); else delete t.doneSteps[k]; write(ACTIVE, t); }
  function pageStep(){
    const f = (location.pathname.split('/').pop() || 'index.html');
    const hash = location.hash;
    return STEPS.find(s => s.href === f || (s.href.split('#')[0] === f && !s.href.includes('#')));
  }

  const escH = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  // Πάνω λωρίδα: «Βήμα 3 από 9 · Κλήρωση Ομίλων» + τουρνουά. Κάτω: Προηγούμενο / Ολοκληρώθηκε → Επόμενο
  // ---- «Τι κάνεις εδώ»: εργασίες ανά βήμα (✓ μόνες τους από τα δεδομένα ή όταν πατηθεί το κουμπί) ----
  const cnt = o => o ? (o.MEN || []).length + (o.WOMEN || []).length : 0;
  const entryTeams = () => { const d = read('entryListDraft_v1'), s = read('entryListSeeded_v1'); return (d && d.TEAMS ? cnt(d.TEAMS) : 0) || (s ? (s.MEN || []).length + (s.WOMEN || []).length : 0); };
  const ticked = k => { const t = get(); return !!(t && t.ticks && t.ticks[k]); };
  function tick(k){ const t = get(); if(!t) return; t.ticks = t.ticks || {}; if(!t.ticks[k]){ t.ticks[k] = Date.now(); write(ACTIVE, t); } }
  const GUIDE = {
    entry: { tasks: [
      { t:'Ανέβασε το Excel δηλώσεων ή πρόσθεσε ομάδες', ok: () => entryTeams() > 0 },
      { t:'Δες τα ονόματα με «0 / ΝΕΟΣ;» ή «≈» και διόρθωσέ τα αν χρειάζεται', hint:true },
      { t:'Κατέβασε την Αρχική Λίστα σε Excel', ok: () => ticked('entry.xls'), tick:'entry.xls', sel:'[onclick^="exportXlsx"]' } ] },
    draw: { needs:'entry', tasks: [
      { t:'Διάλεξε κατηγορία και αριθμό ομίλων', hint:true },
      { t:'Πάτα «Κλήρωση»', ok: () => { const d = read('poolDrawGR_v1'); return !!(d && ((d.MEN && d.MEN.pools) || (d.WOMEN && d.WOMEN.pools))); } },
      { t:'Κατέβασε Excel ή PDF', ok: () => ticked('draw.out'), tick:'draw.out', sel:'#xlsBtn,#pdfBtn' } ] },
    sched: { tasks: [
      { t:'Βάλε γήπεδα, ημέρες και ώρες', ok: () => { const v = read('schedulesState_v2'); return !!(v && v.courts); } },
      { t:'Πάτα «Δημιουργία προγράμματος»', ok: () => ticked('sched.go'), tick:'sched.go', sel:'#goBtn' },
      { t:'Κατέβασε το πρόγραμμα σε Excel', ok: () => ticked('sched.xls'), tick:'sched.xls', sel:'#xlsBtn' } ] },
    pay: { needs:'entry', tasks: [
      { t:'Οι ομάδες έρχονται μόνες τους από την Αρχική Λίστα', ok: () => { const p = read('payments_v1'); return !!(p && p.teams && cnt(p.teams)); } },
      { t:'Σημείωσε ποιος πλήρωσε (μετρητά ή κατάθεση)', ok: () => { const x = progress().find(q => q.k === 'pay'); return x && x.state === 'done'; } },
      { t:'Κατέβασε το Excel για το ταμείο', ok: () => ticked('pay.xls'), tick:'pay.xls', sel:'#xlsBtn' } ] },
    check: { tasks: [
      { t:'Τσέκαρε κάθε έλεγχο όταν γίνεται (πριν, στο τουρνουά, μετά)', ok: () => { const x = progress().find(q => q.k === 'check'); return x && x.state === 'done'; } } ] },
    prize: { needs:'entry', tasks: [
      { t:'Γράψε το χρηματικό έπαθλο κάθε κατηγορίας', ok: () => { const z = read('prizeSheet_v1'); return !!(z && z.cats && ((+z.cats.MEN.prize) || (+z.cats.WOMEN.prize))); } },
      { t:'Διάλεξε την τελική θέση των ομάδων με έπαθλο', ok: () => { const x = progress().find(q => q.k === 'prize'); return x && x.state !== 'todo' && /^(\d+)\/\1 /.test(x.text) || (x && x.state === 'done'); } },
      { t:'Βγάλε PDF ή Word για τις υπογραφές', ok: () => ticked('prize.out'), tick:'prize.out', sel:'#printBtn,#wordBtn' } ] },
    results: { needs:'entry', tasks: [
      { t:'Οι θέσεις έρχονται από το Φύλλο Πληρωμής· συμπλήρωσε όσες λείπουν', ok: () => { const x = progress().find(q => q.k === 'results'); return x && x.state !== 'todo'; } },
      { t:'Πάτα «Έλεγχος αλλαγών»', ok: () => ticked('res.check'), tick:'res.check', sel:'#checkBtn' },
      { t:'Κατέβασε ή δημοσίευσε το Ranking.xlsx', ok: () => ticked('res.out') || (progress().find(q => q.k === 'results') || {}).state === 'done', tick:'res.out', sel:'#dlBtn,#pubBtn' } ] },
    report: { tasks: [
      { t:'Συμπλήρωσε στοιχεία, καιρό και εγκαταστάσεις', ok: () => { const R = read('supervisorReport_v1'), t = get(), r = R && t && R.reports.find(x => x.tourId === t.id); return !!(r && (r.weather || []).length && Object.keys(r.rates || {}).length); } },
      { t:'Πρόσθεσε περιστατικά, ενστάσεις ή τραυματισμούς (αν υπήρξαν)', hint:true },
      { t:'Βγάλε PDF ή Word για την ομοσπονδία', ok: () => ticked('report.out'), tick:'report.out', sel:'#printBtn,#wordBtn' } ] }
  };
  function guideState(k){
    const g = GUIDE[k]; if(!g) return null;
    const tasks = g.tasks.map(x => Object.assign({}, x, { done: x.ok ? !!x.ok() : false }));
    const real = tasks.filter(x => !x.hint);
    return { tasks, done: real.filter(x => x.done).length, total: real.length, blocked: g.needs === 'entry' && !entryTeams() };
  }

  // Όταν υπάρχει ενεργό τουρνουά, τα πεδία «όνομα τουρνουά» και τα κουμπιά «νέο τουρνουά» των εργαλείων περισσεύουν
  const HIDE = {
    'EntryList.html': ['#tName', '#tDates'],
    'Schedules.html': ['#tName', '[data-import]'],
    'Payments.html':  ['#tName', '#clearBtn', '#importBtn'],
    'PrizeSheet.html':['#tName', '#tDate', '#tPlace', '#clearBtn', '#importBtn'],
    'Results.html':   ['#importBtn'],
    'Checklist.html': ['.trow', '#newBox', '#renameBtn', '#delBtn'],
    'Report.html':    ['.trow', '#newBox', '#delBtn', '#fillBtn']
  };
  // Αυτόματη μεταφορά ομάδων: τα κουμπιά εισαγωγής μόνο προσθέτουν ό,τι λείπει, άρα τρέχουν με ασφάλεια
  const SYNC = { 'Schedules.html':['[data-import="men"]', '[data-import="women"]'], 'Payments.html':['#importBtn'], 'PrizeSheet.html':['#importBtn'], 'Results.html':['#importBtn', '#prizeImportBtn'], 'Report.html':['#fillBtn'] };

  // Κάρτες ρυθμίσεων που σπάνια αλλάζουν: μαζεύονται κάτω από «⚙» (ταιριάζουν με τον τίτλο της κάρτας)
  const COLLAPSE = {
    'EntryList.html': [[/Υπολογισμός βαθμών/, 'Ρυθμίσεις βαθμών και κυρίως ταμπλό']],
    'Results.html':   [[/Πίνακας βαθμών/, 'Πίνακας βαθμών και συντελεστής']]
  };
  function collapseSettings(){
    (COLLAPSE[pageName()] || []).forEach(([re, label]) => {
      const h = [...document.querySelectorAll('main h2, main h3, body > .wrap h2')].find(x => re.test(x.textContent));
      const card = h && (h.closest('section, .card, .panel') || h.parentElement); if(!card || card.closest('details.bv-set')) return;
      const d = document.createElement('details'); d.className = 'bv-set'; d.lang = 'el';
      d.innerHTML = `<summary><span>⚙ ${escH(label)}</span><small>Αλλαγή</small></summary>`;
      const cs = getComputedStyle(card);
      d.style.marginLeft = cs.marginLeft; d.style.marginRight = cs.marginRight; if(parseFloat(cs.marginTop)) d.style.marginTop = cs.marginTop;
      card.parentNode.insertBefore(d, card); d.appendChild(card);
    });
  }
  // Κάρτα που άδειασε επειδή κρύψαμε τα περιεχόμενά της: φεύγει κι αυτή
  function hideEmptyCards(){
    document.querySelectorAll('section, .card, .tbar, .panel').forEach(c => {
      if(c.hidden || c.closest('[hidden], .bv-guide, .bv-steps, details.bv-set') || c.offsetParent === null) return;
      const live = [...c.querySelectorAll('input, select, textarea, button, a, table, .team, li, svg, img')].some(e => e.offsetParent !== null);
      let txt = c.innerText || '';
      c.querySelectorAll('h2, h3, .saved, #saved').forEach(h => { txt = txt.replace(h.innerText || '', ''); });
      if(!live && txt.trim().length < 3) c.style.display = 'none';
    });
  }
  // Επεξηγήσεις: κρυμμένες μέχρι να πατηθεί «ⓘ Βοήθεια» (ο οδηγός του βήματος λέει ήδη τι κάνεις)
  function helpTexts(){
    const out = [];
    document.querySelectorAll('header p, .hero > p, p.msg, p.hint, .help, main > footer, body > footer, .wrap > footer').forEach(e => {
      if(e.id || e.closest('.bv-guide, .bv-steps, .bv-tour')) return;
      const host = e.closest('[id]');
      if(host && /^(DIV|UL|OL|TABLE|TBODY|SPAN)$/.test(host.tagName)) return; // περιεχόμενο που ζωγραφίζει η σελίδα
      if(e.querySelector('input, select, button, textarea')) return;
      if(e.textContent.trim().length < 60) return;
      out.push(e);
    });
    out.forEach(e => e.classList.add('bv-help-text'));
    return out.length;
  }
  function pageName(){ return location.pathname.split('/').pop() || 'index.html'; }
  function cleanup(){
    if(!get()) return;
    (HIDE[pageName()] || []).forEach(sel => document.querySelectorAll(sel).forEach(el => {
      const box = el.closest('label.f, label') || el; box.hidden = true; box.style.display = 'none';
    }));
  }
  function autoSync(){
    const t = get(); if(!t) return;
    const list = SYNC[pageName()]; if(!list) return;
    const el = read('entryListSeeded_v1'), stamp = el && el.savedAt || 0, z = read('prizeSheet_v1');
    const key = pageName(), last = (t.sync || {})[key] || 0;
    const src = Math.max(stamp, z && z.archivedAt || 0, z ? 1 : 0);
    if(!entryTeams() && !(z && z.cats)) return;
    if(last && last >= stamp && pageName() !== 'Results.html') return;
    const t0 = window.toast; window.toast = function(){};
    list.forEach(sel => { const b = document.querySelector(sel); if(b) try{ b.click(); }catch(e){} });
    setTimeout(() => { window.toast = t0; }, 0);
    const tt = get(); tt.sync = tt.sync || {}; tt.sync[key] = Date.now(); write(ACTIVE, tt);
  }

  function guideHTML(cur){
    const gs = guideState(cur.k); if(!gs) return '';
    const items = gs.tasks.map(x => `<li class="${x.hint ? 'hint' : x.done ? 'ok' : ''}"><span class="bv-g-i">${x.hint ? '•' : x.done ? '✓' : ''}</span>${escH(x.t)}</li>`).join('');
    const blocked = gs.blocked ? `<div class="bv-g-need">Πρώτα χρειάζεται η Αρχική Λίστα (βήμα 2). <a href="EntryList.html">Πήγαινε στο βήμα 2 ›</a></div>` : '';
    const all = gs.total && gs.done === gs.total;
    return `<div class="bv-g-h"><b>Βήμα ${cur.num} · Τι κάνεις εδώ</b><span>${gs.total ? gs.done + '/' + gs.total : ''}</span></div>${blocked}<ol>${items}</ol>
      ${all ? `<div class="bv-g-all">✓ Έτοιμο. Πάτα «Ολοκλήρωσα» κάτω για το επόμενο βήμα.</div>` : ''}`;
  }

  // Πάνω λωρίδα (βήμα + τουρνουά), οδηγός, και σταθερή μπάρα κάτω: ‹ Προηγούμενο | ✓ Ολοκλήρωσα → Επόμενο
  function bar(mode){
    const nav = document.querySelector('.bv-topbar'); if(!nav || document.querySelector('.bv-tour')) return;
    const t = get(), all = steps(), me = pageStep(), cur = me && all.find(s => s.k === me.k);
    const idx = cur ? all.indexOf(cur) : -1, prev = all[idx - 1], nxt = all[idx + 1];
    if(mode !== 'nav'){
      const a = document.createElement('a');
      a.className = 'bv-tour'; a.href = 'index.html#steps'; a.lang = 'el';
      a.innerHTML = (cur ? `<span class="bv-tour-k">Βήμα ${cur.num}/${all.length}</span>` : '<span class="bv-tour-k">Τουρνουά</span>')
        + (t ? `<b>${escH(t.name)}</b><span class="bv-tour-d">${escH(rangeShort(t))}</span>` : '<b>Δεν έχει οριστεί τουρνουά</b>')
        + '<span class="bv-tour-c">Βήματα ›</span>';
      if(!t) a.href = 'Tournament.html';
      nav.insertAdjacentElement('afterend', a);
      cleanup();
      autoSync();
      collapseSettings();
      hideEmptyCards();
      const helpN = helpTexts();
      // οδηγός κάτω από την κεφαλίδα
      if(cur && GUIDE[cur.k]){
        const head = document.querySelector('body > header, header.hero, .hero') || a;
        const wrap = document.createElement('div'); wrap.className = 'wrap bv-guide-wrap'; wrap.lang = 'el';
        const box = document.createElement('section'); box.className = 'bv-guide'; wrap.appendChild(box);
        head.insertAdjacentElement('afterend', wrap);
        const paint = () => { box.innerHTML = guideHTML(cur) + (helpN ? `<button type="button" class="bv-help-btn">${document.body.classList.contains('bv-help') ? 'Κρύψε τη βοήθεια' : 'ⓘ Βοήθεια: περισσότερες εξηγήσεις'}</button>` : '');
          const hb = box.querySelector('.bv-help-btn'); if(hb) hb.onclick = () => { document.body.classList.toggle('bv-help'); paint(); }; };
        paint();
        GUIDE[cur.k].tasks.forEach(x => { if(x.tick && x.sel) document.addEventListener('click', e => { if(e.target.closest(x.sel)){ tick(x.tick); setTimeout(paint, 50); } }, true); });
        // οι σελίδες αποθηκεύουν σε localStorage: ξαναζωγραφίζουμε τον οδηγό μετά από κάθε αποθήκευση
        let tm = 0; const orig = Storage.prototype.setItem;
        Storage.prototype.setItem = function(k, v){ orig.call(this, k, v); clearTimeout(tm); tm = setTimeout(paint, 120); };
      }
    }
    if(cur){
      document.body.classList.add('bv-has-steps');
      const box = document.createElement('nav'); box.className = 'bv-steps'; box.lang = 'el'; box.setAttribute('aria-label', 'Βήματα τουρνουά');
      const nextHref = nxt ? nxt.href : 'index.html';
      const canMark = t && cur.k !== 'tour' && cur.k !== 'close' && cur.state !== 'done';
      const main = canMark
        ? `<button type="button" class="bv-main bv-mark">✓ Ολοκλήρωσα${nxt ? ' · Επόμενο ›' : ''}</button>`
        : `<a class="bv-main" href="${nextHref}">${nxt ? `Επόμενο: ${escH(nxt.n)} ›` : 'Τέλος · Αρχική ›'}</a>`;
      box.innerHTML = `<div class="bv-steps-in">
        ${prev ? `<a class="bv-prev" href="${prev.href}" aria-label="Προηγούμενο: ${escH(prev.n)}" title="${escH(prev.n)}">‹</a>` : '<a class="bv-prev" href="index.html" aria-label="Βήματα">‹</a>'}
        <div class="bv-mid">${cur.state === 'done' ? `<span class="bv-done">✓ Βήμα ${cur.num} ολοκληρώθηκε${cur.manualDone ? ' · <button type="button" class="bv-undo">Αναίρεση</button>' : ''}</span>` : `<span class="bv-done muted">Βήμα ${cur.num} από ${all.length}</span>`}${main}</div>
      </div>`;
      document.body.appendChild(box);
      const m = box.querySelector('.bv-mark');
      if(m) m.onclick = () => { markDone(cur.k, true); location.href = nextHref; };
      const u = box.querySelector('.bv-undo');
      if(u) u.onclick = () => { markDone(cur.k, false); location.reload(); };
    }
    // Το «Νέο τουρνουά» μιας σελίδας θα έσβηνε τα δεδομένα του ενεργού: πάμε στη σελίδα Τουρνουά
    document.addEventListener('click', e => {
      const b = e.target.closest('#clearBtn'); if(!b || !get()) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if(confirm('Για νέο τουρνουά άλλαξε το ενεργό τουρνουά. Τα δεδομένα του «' + get().name + '» φυλάγονται στη συσκευή. Να ανοίξει η σελίδα Τουρνουά;')) location.href = 'Tournament.html#new';
    }, true);
  }
  // ---- προστασία από «παλιές» σελίδες ----
  // Μια σελίδα που έμεινε ανοιχτή (άλλη καρτέλα/παράθυρο ή «Πίσω» στο Safari) κρατά στη μνήμη
  // δεδομένα που μπορεί να άλλαξαν αλλού· αν αποθηκεύσει, θα γράψει πάνω τους. Την ξαναφορτώνουμε.
  const WATCH = [ACTIVE, 'checklist_v1', 'supervisorReport_v1'].concat(SWAP);
  let stale = false;
  function freshReload(){
    try{ const last = +sessionStorage.getItem('bvReloadAt') || 0; if(Date.now() - last < 2000) return; sessionStorage.setItem('bvReloadAt', Date.now()); }catch(e){}
    location.reload();
  }
  window.addEventListener('storage', e => {
    if(e.key !== null && !WATCH.includes(e.key)) return;
    if(document.visibilityState === 'visible') freshReload(); else stale = true;
  });
  document.addEventListener('visibilitychange', () => { if(stale && document.visibilityState === 'visible'){ stale = false; freshReload(); } });
  window.addEventListener('pageshow', e => { if(e.persisted) freshReload(); });

  const me = document.currentScript;
  if(me && me.hasAttribute('data-bar')){
    const mode = me.getAttribute('data-bar'), go = () => bar(mode);
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }

  window.BVTour = { guideState, tick, resetActive, steps, markDone, STEPS, get, switchTo, update, propagate, list, forget, bundle, restoreBundle, progress, backup, restore, makeMeta, datesText, rangeShort, daysTo, iso, SWAP };
})();

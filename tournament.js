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
    const pd = read('poolDrawGR_v1'), pdc = pd ? ['MEN','WOMEN'].filter(c => pd[c] && pd[c].pools) : [];
    out.push({ k:'draw', label:'Κλήρωση Ομίλων', href:'PoolDrawGR.html', state: pdc.length ? 'done' : 'todo',
      text: pdc.length ? pdc.map(c => (c === 'MEN' ? 'Άνδρες' : 'Γυναίκες') + ': ' + pd[c].pools.length + ' όμιλοι').join(' · ') : 'Δεν έχει γίνει κλήρωση' });
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
    }
    if(cur){
      const box = document.createElement('nav'); box.className = 'bv-steps'; box.lang = 'el'; box.setAttribute('aria-label', 'Βήματα τουρνουά');
      const nextHref = nxt ? nxt.href : 'index.html';
      box.innerHTML = `<div class="bv-steps-in">
        ${t && cur.k !== 'tour' && cur.k !== 'close' ? (cur.state === 'done'
          ? `<div class="bv-steps-done">✓ Το βήμα ${cur.num} ολοκληρώθηκε${cur.manualDone ? ' · <button type="button" class="bv-undo">Αναίρεση</button>' : ''}</div>`
          : `<button type="button" class="bv-mark">✓ Ολοκλήρωσα το βήμα ${cur.num}</button>`) : ''}
        <div class="bv-steps-row">
          ${prev ? `<a class="bv-prev" href="${prev.href}">‹ ${escH(prev.n)}</a>` : '<span></span>'}
          ${nxt ? `<a class="bv-next" href="${nextHref}">Βήμα ${nxt.num}: ${escH(nxt.n)} ›</a>` : '<a class="bv-next" href="index.html">Τέλος ›</a>'}
        </div></div>`;
      (document.querySelector('main') || document.body).appendChild(box);
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

  window.BVTour = { resetActive, steps, markDone, STEPS, get, switchTo, update, propagate, list, forget, bundle, restoreBundle, progress, backup, restore, makeMeta, datesText, rangeShort, daysTo, iso, SWAP };
})();

/* BV Supervisor Tools — γράφει τα αποτελέσματα ενός τουρνουά στο Ranking.xlsx.
 * Χρησιμοποιεί ExcelJS (vendor/exceljs.min.js) ώστε να μένει η μορφοποίηση του αρχείου.
 *
 *   const R = await BVRankingWriter.open(bytes)
 *   R.columns('MEN')                → [{ col, header, name, coef, dates, filled }]
 *   R.findColumn('MEN', meta)       → col | 0 (κατά όνομα, αλλιώς κατά ημερομηνίες)
 *   R.athletes('MEN')               → Set με κλειδιά ονομάτων του φύλλου
 *   R.apply('MEN', { col | header+dates, values: [{ name, value }] , addMissing:true })
 *        → { sheet, col, header, updated, added:[], replaced, created }
 *   await R.save()                  → Uint8Array
 *
 * Σε κάθε φύλλο: η στήλη του τουρνουά καθαρίζει και ξαναγράφεται, το ΣΥΝΟΛΟ ξαναϋπολογίζεται
 * (άθροισμα των στηλών τουρνουά), οι αθλητές ταξινομούνται κατά ΣΥΝΟΛΟ και η στήλη Α
 * γράφει τη θέση («-» όταν ισοβαθμεί με τον από πάνω).
 */
(function(){
  const HEADER_ROW = 2, DATES_ROW = 3, FIRST = 4, NAME_COL = 2, RANK_COL = 1;
  const LATIN = {A:'Α',B:'Β',E:'Ε',H:'Η',I:'Ι',K:'Κ',M:'Μ',N:'Ν',O:'Ο',P:'Ρ',T:'Τ',X:'Χ',Y:'Υ',Z:'Ζ'};
  const nameKey = s => String(s || '').toLocaleUpperCase('el-GR').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[ABEHIKMNOPTXYZ]/g, c => LATIN[c]).replace(/[.\-–_,]+/g, ' ').replace(/\s+/g, ' ').trim();
  const tourKey = s => nameKey(String(s || '').replace(/\([^)]*\)/g, ''));
  const txt = v => {
    if(v == null) return '';
    if(typeof v === 'object'){
      if(v.richText) return v.richText.map(r => r.text).join('');
      if('result' in v) return txt(v.result);
      if(v instanceof Date) return v.getDate() + '/' + (v.getMonth() + 1) + '/' + v.getFullYear();
      if(v.text) return String(v.text);
    }
    return String(v);
  };
  const num = v => {
    if(v == null || v === '') return null;
    if(typeof v === 'number') return v;
    if(typeof v === 'object' && v && 'result' in v) return num(v.result);
    const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? null : n;
  };
  const r2 = x => Math.round(x * 100) / 100;
  const coefText = c => { const n = Number(c); return isNaN(n) ? '' : n.toFixed(1).replace('.', ','); };
  const clone = o => o ? JSON.parse(JSON.stringify(o)) : {};

  async function open(bytes){
    if(!window.ExcelJS) throw new Error('Δεν φορτώθηκε η βιβλιοθήκη Excel.');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);

    const sheet = name => {
      const ws = wb.getWorksheet(name);
      if(!ws) throw new Error('Το Ranking.xlsx δεν έχει φύλλο «' + name + '».');
      return ws;
    };
    function totalCol(ws){
      const row = ws.getRow(HEADER_ROW);
      for(let c = 3; c <= Math.max(ws.columnCount, 40); c++) if(nameKey(txt(row.getCell(c).value)) === 'ΣΥΝΟΛΟ') return c;
      throw new Error('Δεν βρέθηκε η στήλη ΣΥΝΟΛΟ στο φύλλο «' + ws.name + '».');
    }
    function lastDataRow(ws){
      let r = FIRST;
      while(txt(ws.getCell(r, NAME_COL).value).trim()) r++;
      return r - 1;
    }
    function columns(name){
      const ws = sheet(name), tc = totalCol(ws), last = lastDataRow(ws), out = [];
      for(let c = 3; c < tc; c++){
        const header = txt(ws.getCell(HEADER_ROW, c).value).trim();
        const m = header.match(/\(([\d.,]+)\)\s*$/);
        let filled = 0; for(let r = FIRST; r <= last; r++) if(num(ws.getCell(r, c).value) != null) filled++;
        out.push({ col: c, header, name: header.replace(/\([^)]*\)\s*$/, '').trim(), coef: m ? parseFloat(m[1].replace(',', '.')) : null,
          dates: txt(ws.getCell(DATES_ROW, c).value).trim(), filled });
      }
      return out;
    }
    function findColumn(name, meta){
      const cols = columns(name), k = tourKey(meta.name);
      let hit = cols.find(c => tourKey(c.header) === k);
      if(!hit && k) hit = cols.find(c => { const h = tourKey(c.header); return h && (h.startsWith(k) || k.startsWith(h)); });
      if(!hit && meta.dates) hit = cols.find(c => c.dates && c.dates.replace(/\s/g, '') === String(meta.dates).replace(/\s/g, '') && !c.filled);
      return hit ? hit.col : 0;
    }
    function athletes(name){
      const ws = sheet(name), last = lastDataRow(ws), s = new Set();
      for(let r = FIRST; r <= last; r++) s.add(nameKey(txt(ws.getCell(r, NAME_COL).value)));
      return s;
    }

    // Νέα στήλη τουρνουά ακριβώς πριν το ΣΥΝΟΛΟ (το ΣΥΝΟΛΟ πάει μία θέση δεξιά)
    function insertColumn(ws, header, dates){
      const tc = totalCol(ws), rows = Math.max(ws.rowCount, lastDataRow(ws) + 1);
      // συγχωνευμένα κελιά που ακουμπούν τη στήλη ΣΥΝΟΛΟ
      const merges = (ws.model.merges || []).slice();
      const parse = a => { const m = a.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/); return m && { c1: colNum(m[1]), r1: +m[2], c2: colNum(m[3]), r2: +m[4] }; };
      const moved = [];
      merges.forEach(a => { const m = parse(a); if(!m || m.c2 < tc) return; ws.unMergeCells(a); moved.push(m); });
      for(let r = 1; r <= rows; r++){
        const src = ws.getCell(r, tc), dst = ws.getCell(r, tc + 1), prev = ws.getCell(r, tc - 1);
        dst.value = src.value; dst.style = clone(src.style);
        src.value = null; src.style = clone(prev.style);
      }
      ws.getColumn(tc + 1).width = ws.getColumn(tc).width;
      ws.getColumn(tc).width = ws.getColumn(tc - 1).width;
      moved.forEach(m => {
        const c1 = m.c1 >= tc ? m.c1 + 1 : m.c1, c2 = m.c2 + 1;
        ws.mergeCells(m.r1, c1, m.r2, c2);
      });
      ws.getCell(HEADER_ROW, tc).value = header;
      ws.getCell(DATES_ROW, tc).value = dates || null;
      return tc;
    }

    function apply(name, opt){
      const ws = sheet(name);
      let col = opt.col, created = false;
      if(!col){ col = insertColumn(ws, opt.header, opt.dates); created = true; }
      const tc = totalCol(ws), last = lastDataRow(ws);
      // όλα τα στοιχεία των αθλητών (στήλες Α..ΣΥΝΟΛΟ)
      const recs = [];
      for(let r = FIRST; r <= last; r++){
        const vals = []; for(let c = 1; c <= tc; c++) vals[c] = ws.getCell(r, c).value;
        recs.push({ key: nameKey(txt(vals[NAME_COL])), vals, order: r });
      }
      const byKey = new Map(); recs.forEach(x => { if(!byKey.has(x.key)) byKey.set(x.key, x); });
      let replaced = 0;
      recs.forEach(x => { if(num(x.vals[col]) != null){ replaced++; x.vals[col] = null; } });
      let updated = 0; const added = [];
      (opt.values || []).forEach(v => {
        const val = Number(v.value); if(!val) return;
        const k = nameKey(v.name); if(!k) return;
        let x = byKey.get(k);
        if(!x){
          if(opt.addMissing === false) return;
          const vals = []; vals[NAME_COL] = String(v.name).trim().toLocaleUpperCase('el-GR');
          x = { key: k, vals, order: 1e9 + recs.length }; recs.push(x); byKey.set(k, x); added.push(vals[NAME_COL]);
        }
        x.vals[col] = r2((num(x.vals[col]) || 0) + val); updated++;
      });
      // ΣΥΝΟΛΟ, ταξινόμηση, θέση
      recs.forEach(x => { let s = 0; for(let c = 3; c < tc; c++){ const n = num(x.vals[c]); if(n != null) s += n; } x.total = r2(s); x.vals[tc] = x.total; });
      recs.sort((a, b) => (b.total - a.total) || (a.order - b.order));
      recs.forEach((x, i) => { x.vals[RANK_COL] = i && recs[i - 1].total === x.total ? '-' : i + 1; });
      // σειρές που χρειάζονται πέρα από τις υπάρχουσες: χρησιμοποιούμε τις κενές σειρές-πρότυπα,
      // αλλιώς προσθέτουμε νέες με τη μορφή της τελευταίας σειράς αθλητή
      for(let r = last + 1; r < FIRST + recs.length; r++){
        let busy = false; for(let c = 3; c < tc; c++) if(num(ws.getCell(r, c).value) != null){ busy = true; break; }
        if(busy){ ws.spliceRows(r, 0, []); for(let c = 1; c <= tc; c++) ws.getCell(r, c).style = clone(ws.getCell(FIRST, c).style); }
      }
      recs.forEach((x, i) => { const r = FIRST + i; for(let c = 1; c <= tc; c++) ws.getCell(r, c).value = x.vals[c] == null ? null : x.vals[c]; });
      return { sheet: name, col, header: txt(ws.getCell(HEADER_ROW, col).value), updated, added, replaced, created };
    }

    // Η επισήμανση διπλών ονομάτων (στήλη B) του Excel δεν διατηρείται από τη βιβλιοθήκη·
    // την ξαναβάζουμε ως κανόνα τύπου, με το ίδιο κόκκινο.
    function markDuplicates(ws){
      ws.addConditionalFormatting({ ref: 'B' + FIRST + ':B2000', rules: [{
        type: 'expression', priority: 1,
        formulae: ['AND(B' + FIRST + '<>"",COUNTIF($B$' + FIRST + ':$B$2000,B' + FIRST + ')>1)'],
        style: { font: { color: { argb: 'FF9C0006' } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' } } }
      }] });
    }
    async function save(){
      wb.worksheets.forEach(ws => { if(wb.getWorksheet(ws.name) && ws.getCell(HEADER_ROW, 1).value != null) markDuplicates(ws); });
      return new Uint8Array(await wb.xlsx.writeBuffer());
    }
    return { wb, columns, findColumn, athletes, apply, save };
  }
  function colNum(s){ let n = 0; for(const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; }

  window.BVRankingWriter = { open, nameKey, coefText };
})();

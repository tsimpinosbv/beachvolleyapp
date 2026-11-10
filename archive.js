/* BV Supervisor Tools — αρχείο σεζόν στο ιδιωτικό repo (bv-supervisor-archive).
 * Δομή:  <σεζόν>/<τουρνουά>/Αναφορά Supervisor.json + .doc
 *                          /Φύλλο Πληρωμής Επάθλων.json + .doc
 * Το .json ξανανοίγει στην εφαρμογή για διόρθωση, το .doc είναι το έγγραφο.
 * Χρειάζεται gh-publish.js (κλειδί GitHub) και word-export.js. */
(function(){
  const KINDS = {
    report: { file:'Αναφορά Supervisor', page:'Report.html' },
    prize:  { file:'Φύλλο Πληρωμής Επάθλων', page:'PrizeSheet.html' },
    tournament: { file:'Τουρνουά (όλα τα δεδομένα)', page:'Tournament.html' },
    summary: { file:'Σύνοψη τουρνουά', page:'' }
  };
  // Σεζόν από το κείμενο ημερομηνιών/ονόματος (π.χ. «24-26/7/2026»), αλλιώς το τρέχον έτος
  function seasonOf(){
    for(const t of arguments){ const m = String(t || '').match(/\b(20\d\d)\b/); if(m) return m[1]; }
    return String(new Date().getFullYear());
  }
  function folderName(name){
    return String(name || '').replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  const enc = s => new TextEncoder().encode(s);

  // Ανεβάζει δεδομένα + Word. Επιστρέφει { ok, folder } ή { ok:false, error|cancelled }
  async function save(o){
    const k = KINDS[o.kind], season = String(o.season || '').trim(), folder = folderName(o.tournament);
    if(!folder) return { ok:false, error:'Γράψε πρώτα το όνομα του τουρνουά.' };
    if(!/^20\d\d$/.test(season)) return { ok:false, error:'Η σεζόν πρέπει να είναι έτος, π.χ. 2026.' };
    const base = season + '/' + folder + '/' + k.file;
    const payload = { app:'BV Supervisor Tools', kind:o.kind, season, tournament:o.tournament, savedAt:new Date().toISOString(), data:o.data };
    const msg = k.file + ' — ' + o.tournament + ' (' + season + ')';
    const r1 = await BVPublish.publish({ repo:BVPublish.ARCHIVE, path:base + '.json', bytes:enc(JSON.stringify(payload, null, 1)), message:msg });
    if(!r1.ok) return r1;
    const r2 = await BVPublish.publish({ repo:BVPublish.ARCHIVE, path:base + '.doc', bytes:enc('\ufeff' + BVWord.html(o.docHtml, k.file)), message:msg + ' (Word)' });
    if(!r2.ok) return r2;
    return { ok:true, folder: season + ' / ' + folder };
  }

  // Οποιοδήποτε αρχείο στον φάκελο του τουρνουά
  async function put(season, tournament, fileName, bytes, message){
    const folder = folderName(tournament);
    if(!folder) return { ok:false, error:'Λείπει το όνομα του τουρνουά.' };
    const r = await BVPublish.publish({ repo:BVPublish.ARCHIVE, path: season + '/' + folder + '/' + fileName, bytes, message: message || fileName + ' — ' + tournament + ' (' + season + ')' });
    return r.ok ? { ok:true, folder: season + ' / ' + folder } : r;
  }

  window.BVArchive = { save, put, seasonOf, folderName, KINDS };
})();

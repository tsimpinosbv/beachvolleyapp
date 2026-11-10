/* BV Supervisor Tools — δημοσίευση αρχείων στο GitHub από την εφαρμογή.
 * Χρησιμοποιεί το ίδιο κλειδί (token) με τη σελίδα Βαθμολογίας (localStorage 'bvGithubToken').
 *
 *   BVPublish.publish({ path:'PointSystem.xlsx', bytes:Uint8Array, message:'…' })
 *     → Promise<{ ok:true } | { ok:false, error:'…' } | { ok:false, cancelled:true }>
 *   Με repo: BVPublish.ARCHIVE γράφει στο ιδιωτικό αρχείο σεζόν.
 *   BVPublish.tree(repo) → λίστα διαδρομών, BVPublish.getFile(repo, path) → Uint8Array
 */
(function(){
  const OWNER = 'tsimpinosbv', REPO = 'beachvolleyapp', BRANCH = 'main';
  const ARCHIVE = 'bv-supervisor-archive'; // ιδιωτικό repo για αναφορές & φύλλα πληρωμής
  const TOKEN_KEY = 'bvGithubToken';
  const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new?name=BV%20Supervisor%20Tools&description=%CE%94%CE%B7%CE%BC%CE%BF%CF%83%CE%AF%CE%B5%CF%85%CF%83%CE%B7%20%CE%B1%CF%81%CF%87%CE%B5%CE%AF%CF%89%CE%BD%20%CE%B1%CF%80%CF%8C%20%CF%84%CE%B7%CE%BD%20%CE%B5%CF%86%CE%B1%CF%81%CE%BC%CE%BF%CE%B3%CE%AE&contents=write';

  function getToken(){ try{ return localStorage.getItem(TOKEN_KEY) || ''; }catch(e){ return ''; } }
  function setToken(t){ try{ localStorage.setItem(TOKEN_KEY, t); }catch(e){} }
  function clearToken(){ try{ localStorage.removeItem(TOKEN_KEY); }catch(e){} }

  function api(path, opts){
    const o = Object.assign({ cache:'no-store' }, opts || {});
    o.headers = Object.assign({ 'Accept':'application/vnd.github+json', 'Authorization':'Bearer ' + getToken(), 'X-GitHub-Api-Version':'2022-11-28' }, o.headers || {});
    return fetch('https://api.github.com' + path, o);
  }
  function b64(bytes){
    let bin = '';
    for(let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  // ---------- παράθυρο κλειδιού ----------
  let modal = null;
  function ensureModal(){
    if(modal) return modal;
    const css = document.createElement('style');
    css.textContent = `
      .bvp-modal{position:fixed;inset:0;background:rgba(10,30,50,.55);display:none;align-items:flex-end;justify-content:center;z-index:9999;padding:16px;font-family:'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
      .bvp-modal.show{display:flex;}
      @media(min-width:600px){.bvp-modal{align-items:center;}}
      .bvp-card{background:#fff;color:#0f2438;border-radius:16px;width:100%;max-width:520px;max-height:90vh;overflow:auto;padding:18px;box-shadow:0 18px 40px rgba(0,0,0,.3);}
      .bvp-card h3{margin:0 0 6px;font-size:19px;color:#0d3a5c;font-family:'Space Grotesk',sans-serif;}
      .bvp-card p,.bvp-card ol{font-size:13.5px;line-height:1.55;margin:6px 0;}
      .bvp-card ol{padding-left:20px;}
      .bvp-card a{color:#155a8a;font-weight:700;}
      .bvp-card input{width:100%;box-sizing:border-box;font-family:'IBM Plex Mono',monospace;font-size:13.5px;border:1.5px solid #d6e6f2;border-radius:9px;padding:10px;margin-top:8px;}
      .bvp-err{color:#b6402f;font-size:12.5px;font-weight:600;min-height:16px;margin-top:6px;}
      .bvp-note{font-size:12px!important;color:rgba(15,36,56,.65);}
      .bvp-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap;}
      .bvp-actions button{font-family:inherit;font-weight:700;font-size:14px;padding:10px 14px;border-radius:9px;cursor:pointer;border:1.5px solid #155a8a;background:#fff;color:#155a8a;}
      .bvp-actions button.primary{background:#0d3a5c;border-color:#0d3a5c;color:#fff;}`;
    document.head.appendChild(css);
    modal = document.createElement('div');
    modal.className = 'bvp-modal';
    modal.innerHTML = `
      <div class="bvp-card" role="dialog">
        <h3>Σύνδεση με το GitHub</h3>
        <p>Για να δημοσιεύεις αρχεία από την εφαρμογή χρειάζεται ένα <b>κλειδί πρόσβασης (token)</b> του GitHub. Το φτιάχνεις μία φορά:</p>
        <ol>
          <li>Άνοιξε τη <a href="${TOKEN_URL}" target="_blank" rel="noopener">σελίδα δημιουργίας token</a> (συνδεδεμένος ως tsimpinosbv).</li>
          <li><b>Expiration</b>: διάλεξε διάρκεια, π.χ. 1 χρόνο.</li>
          <li><b>Repository access</b>: <b>Only select repositories</b> → <b>beachvolleyapp</b> και <b>bv-supervisor-archive</b> (αν το έχεις φτιάξει).</li>
          <li><b>Permissions</b>: το <b>Contents</b> να είναι <b>Read and write</b> (είναι ήδη επιλεγμένο).</li>
          <li><b>Generate token</b>, αντέγραψε το κλειδί (<code>github_pat_…</code>) και επικόλλησέ το εδώ:</li>
        </ol>
        <input type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false">
        <div class="bvp-err"></div>
        <p class="bvp-note">Το κλειδί αποθηκεύεται μόνο σε αυτή τη συσκευή και επιτρέπει αλλαγές μόνο στα repositories που διάλεξες. Μην το δίνεις σε άλλους.</p>
        <div class="bvp-actions"><button type="button" data-a="cancel">Άκυρο</button><button type="button" class="primary" data-a="save">Αποθήκευση και δημοσίευση</button></div>
      </div>`;
    document.body.appendChild(modal);
    return modal;
  }

  // Ζητά κλειδί, το ελέγχει και επιστρέφει true/false
  function askToken(msg, repo){
    repo = repo || REPO;
    return new Promise(resolve => {
      const m = ensureModal();
      const inp = m.querySelector('input'), err = m.querySelector('.bvp-err');
      const save = m.querySelector('[data-a=save]'), cancel = m.querySelector('[data-a=cancel]');
      inp.value = ''; err.textContent = msg || '';
      m.classList.add('show'); setTimeout(() => inp.focus(), 50);
      function done(v){ m.classList.remove('show'); save.onclick = cancel.onclick = m.onclick = null; resolve(v); }
      cancel.onclick = () => done(false);
      m.onclick = e => { if(e.target === m) done(false); };
      save.onclick = async () => {
        const t = inp.value.trim();
        if(!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(t)){ err.textContent = 'Αυτό δεν μοιάζει με κλειδί GitHub (ξεκινά με github_pat_).'; return; }
        save.disabled = true; err.textContent = 'Έλεγχος κλειδιού…';
        const prev = getToken(); setToken(t);
        try{
          const r = await api('/repos/' + OWNER + '/' + repo);
          if(r.status === 401) throw new Error('Το κλειδί δεν είναι έγκυρο ή έχει λήξει.');
          if(r.status === 404) throw new Error(repo === ARCHIVE ? 'Το κλειδί δεν βλέπει το ' + ARCHIVE + '. Είτε δεν έχεις φτιάξει ακόμα το ιδιωτικό repo, είτε πρέπει να το προσθέσεις στο Repository access του κλειδιού (δες Οδηγίες, ενότητα 7).' : 'Το κλειδί δεν έχει πρόσβαση στο beachvolleyapp. Στο Repository access διάλεξε beachvolleyapp.');
          if(!r.ok) throw new Error('Το GitHub απάντησε με σφάλμα ' + r.status + '.');
          const info = await r.json();
          if(info.permissions && info.permissions.push === false) throw new Error('Το κλειδί δεν έχει δικαίωμα εγγραφής. Στο Permissions → Contents διάλεξε Read and write.');
          save.disabled = false; done(true);
        }catch(e){
          if(prev) setToken(prev); else clearToken();
          err.textContent = (e && e.message && !/fetch/i.test(e.message)) ? e.message : 'Δεν υπάρχει σύνδεση με το GitHub. Έλεγξε το internet.';
          save.disabled = false;
        }
      };
    });
  }

  async function publish(opts){
    const repo = opts.repo || REPO;
    if(!getToken()){ if(!(await askToken('', repo))) return { ok:false, cancelled:true }; }
    const path = '/repos/' + OWNER + '/' + repo + '/contents/' + opts.path.split('/').map(encodeURIComponent).join('/');
    const content = b64(opts.bytes);
    for(let attempt = 0; attempt < 3; attempt++){
      try{
        const cur = await api(path + '?ref=' + BRANCH + '&_=' + Date.now());
        if(cur.status === 401){ clearToken(); if(!(await askToken('Το κλειδί δεν είναι πλέον έγκυρο (ίσως έληξε). Φτιάξε νέο.', repo))) return { ok:false, cancelled:true }; continue; }
        let sha; if(cur.ok) sha = (await cur.json()).sha; else if(cur.status !== 404) return { ok:false, error:'Το GitHub απάντησε με σφάλμα (' + cur.status + '). Δοκίμασε ξανά σε λίγο.' };
        const body = { message: opts.message || ('Ενημέρωση ' + opts.path + ' από την εφαρμογή'), content, branch: BRANCH };
        if(sha) body.sha = sha;
        const res = await api(path, { method:'PUT', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) });
        if(res.ok) return { ok:true };
        if(res.status === 401){ clearToken(); if(!(await askToken('Το κλειδί δεν είναι πλέον έγκυρο (ίσως έληξε). Φτιάξε νέο.', repo))) return { ok:false, cancelled:true }; continue; }
        if(res.status === 409) continue; // άλλαξε στο μεταξύ
        if(res.status === 403 || res.status === 404) return { ok:false, error: repo === ARCHIVE
          ? 'Το κλειδί δεν μπορεί να γράψει στο ' + ARCHIVE + '. Φτιάξε το ιδιωτικό repo και πρόσθεσέ το στο κλειδί (Οδηγίες, ενότητα 7).'
          : 'Το κλειδί δεν έχει δικαίωμα εγγραφής στο beachvolleyapp (Contents: Read and write).' };
        return { ok:false, error:'Το GitHub απάντησε με σφάλμα (' + res.status + '). Δοκίμασε ξανά σε λίγο.' };
      }catch(e){
        return { ok:false, error:'Έλεγξε τη σύνδεση στο internet και δοκίμασε ξανά.' };
      }
    }
    return { ok:false, error:'Η δημοσίευση απέτυχε. Δοκίμασε ξανά σε λίγο.' };
  }

  // Όλες οι διαδρομές αρχείων ενός repo (μία κλήση). Άδειο repo → []
  async function tree(repo){
    if(!getToken()){ if(!(await askToken('', repo))) return { ok:false, cancelled:true }; }
    for(let attempt = 0; attempt < 2; attempt++){
      try{
        const r = await api('/repos/' + OWNER + '/' + repo + '/git/trees/' + BRANCH + '?recursive=1&_=' + Date.now());
        if(r.status === 401){
          clearToken(); if(!(await askToken('Το κλειδί δεν είναι πλέον έγκυρο (ίσως έληξε). Φτιάξε νέο.', repo))) return { ok:false, cancelled:true }; continue;
        }
        if((r.status === 404 || r.status === 403) && !(await repoVisible(repo)))
          return { ok:false, noAccess:true, error:'Το κλειδί δεν βλέπει το ιδιωτικό repo ' + repo + '. Φτιάξε το repo και πρόσθεσέ το στο κλειδί (Οδηγίες, ενότητα 7).' };
        if(r.status === 404 || r.status === 409) return { ok:true, paths:[] }; // άδειο repo
        if(!r.ok) return { ok:false, error:'Το GitHub απάντησε με σφάλμα (' + r.status + ').' };
        const j = await r.json();
        return { ok:true, paths: j.tree.filter(x => x.type === 'blob').map(x => x.path) };
      }catch(e){ return { ok:false, error:'Έλεγξε τη σύνδεση στο internet και δοκίμασε ξανά.' }; }
    }
    return { ok:false, error:'Δεν ήταν δυνατή η ανάγνωση του αρχείου.' };
  }
  async function repoVisible(repo){ try{ return (await api('/repos/' + OWNER + '/' + repo)).ok; }catch(e){ return true; } }
  async function getFile(repo, filePath){
    const r = await api('/repos/' + OWNER + '/' + repo + '/contents/' + filePath.split('/').map(encodeURIComponent).join('/') + '?ref=' + BRANCH,
      { headers:{ 'Accept':'application/vnd.github.raw' } });
    if(!r.ok) throw new Error('Σφάλμα ' + r.status);
    return new Uint8Array(await r.arrayBuffer());
  }

  window.BVPublish = { publish, tree, getFile, ARCHIVE, hasToken: () => !!getToken() };
})();

/* BV Supervisor Tools — λήψη εγγράφου ως επεξεργάσιμο αρχείο Word (.doc).
   Παίρνει το ίδιο HTML με το PDF (.doc div) και το τυλίγει ώστε να ανοίγει
   σε Word, Google Docs, Pages ή LibreOffice για αλλαγές πριν την αποστολή. */
(function(){
  const CSS = `
    @page{size:21cm 29.7cm; margin:1.4cm 1.2cm;}
    body{font-family:Arial,sans-serif; font-size:11pt; color:#000;}
    h1{font-size:17pt; margin:0 0 4pt;}
    h2{font-size:12.5pt; margin:14pt 0 4pt; border-bottom:1px solid #000; padding-bottom:2pt;}
    p{margin:3pt 0; line-height:1.35;}
    .sub{font-size:10pt; color:#333; margin:0 0 8pt;}
    table{width:100%; border-collapse:collapse; font-size:10pt;}
    th,td{border:1px solid #555; padding:4pt 5pt; text-align:left; vertical-align:top;}
    th{background:#eeeeee;}
    .r{text-align:right; white-space:nowrap;}
    td.sig{width:30%; height:24pt;}
    table.sign td{border:none; border-top:1px solid #000; text-align:center; padding-top:3pt; width:50%;}
    table.sign td.gap{border-top:none; width:8%;}`;

  function toWordHtml(inner){
    const box = document.createElement('div');
    box.innerHTML = inner;
    // Οι υπογραφές είναι flex στο PDF: στο Word γίνονται πίνακας
    box.querySelectorAll('div.sign').forEach(s => {
      const cells = [...s.children].map(d => `<td>${d.innerHTML}</td>`).join('<td class="gap"></td>');
      const t = document.createElement('div');
      t.innerHTML = `<br><br><table class="sign"><tr>${cells}</tr></table>`;
      s.replaceWith(...t.childNodes);
    });
    // Πλαίσια και πλάτη απευθείας στα στοιχεία (τα διαβάζουν σωστά Word και LibreOffice)
    box.querySelectorAll('table:not(.sign)').forEach(t => {
      t.setAttribute('width', '100%'); t.setAttribute('border', '1'); t.setAttribute('cellspacing', '0'); t.setAttribute('cellpadding', '5');
      t.style.cssText = 'width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:10pt';
    });
    box.querySelectorAll('table:not(.sign) th, table:not(.sign) td').forEach(c => {
      c.style.border = '1px solid #555555'; c.style.padding = '4pt 5pt'; c.style.verticalAlign = 'top';
      if(c.tagName === 'TH') c.style.background = '#eeeeee';
      if(c.classList.contains('r')){ c.style.textAlign = 'right'; c.style.whiteSpace = 'nowrap'; c.innerHTML = c.innerHTML.replace(/ €/g, '&nbsp;€'); }
      if(c.classList.contains('sig')) c.style.width = '32%';
    });
    box.querySelectorAll('table.sign').forEach(t => { t.setAttribute('width', '100%'); t.style.width = '100%'; t.setAttribute('cellspacing', '0'); });
    box.querySelectorAll('table.sign td').forEach(c => {
      c.style.cssText = c.classList.contains('gap') ? 'width:10%;border:none' : 'width:45%;border:none;border-top:1px solid #000000;text-align:center;padding-top:3pt;font-family:Arial,sans-serif;font-size:10pt';
    });
    box.querySelectorAll('h1,h2,p').forEach(e => { e.style.fontFamily = 'Arial,sans-serif'; });
    box.querySelectorAll('h2').forEach(e => { e.style.borderBottom = '1px solid #000000'; });
    // Κάθε κατηγορία σε νέα σελίδα
    box.querySelectorAll('div.page').forEach((p, i) => { if(i) p.style.pageBreakBefore = 'always'; });
    return box.innerHTML;
  }

  function html(inner, filename){
    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${filename}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>${CSS}</style></head><body>${toWordHtml(inner)}</body></html>`;
  }

  function download(inner, filename){
    const blob = new Blob(['\ufeff', html(inner, filename)], { type: 'application/msword' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename.replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.doc';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  window.BVWord = { download, html };
})();

/* BV Supervisor Tools — λειτουργίες διαχειριστή (δημοσίευση στο GitHub, αρχείο σεζόν).
   Εμφανίζονται όταν η συσκευή έχει κλειδί GitHub ή αν ενεργοποιηθούν από τη σελίδα Τουρνουά.
   bvAdmin_v1: '1' = πάντα ναι, '0' = πάντα όχι, κενό = αυτόματα. Φορτώνεται στο <head>. */
(function(){
  var on = false;
  try{ var v = localStorage.getItem('bvAdmin_v1'); on = v === '1' || (v !== '0' && !!localStorage.getItem('bvGithubToken')); }catch(e){}
  if(on) document.documentElement.classList.add('bv-admin');
  window.BVAdmin = { isOn: function(){ return document.documentElement.classList.contains('bv-admin'); },
    set: function(v){ try{ localStorage.setItem('bvAdmin_v1', v ? '1' : '0'); }catch(e){} document.documentElement.classList.toggle('bv-admin', !!v); } };
})();

/* Νέα έκδοση της εφαρμογής: ένα ανοιχτό παράθυρο ελέγχει για ενημέρωση όταν ξαναγίνεται ορατό
   και ανανεώνεται μόνο του μόλις η νέα έκδοση αναλάβει, ώστε να μην τρέχει παλιό κώδικα. */
(function(){
  if(!('serviceWorker' in navigator)) return;
  var had = !!navigator.serviceWorker.controller, done = false;
  navigator.serviceWorker.addEventListener('controllerchange', function(){
    if(!had || done) return; done = true; location.reload();
  });
  function check(){ navigator.serviceWorker.getRegistration().then(function(r){ if(r) r.update(); }).catch(function(){}); }
  document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'visible') check(); });
  window.addEventListener('focus', check);
})();

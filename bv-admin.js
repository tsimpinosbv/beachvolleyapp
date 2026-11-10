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

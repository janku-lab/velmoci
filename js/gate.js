// Jednoduchá vstupní brána s heslem (jen pro vlastní web; v Claude artefaktu se nepoužívá).
// Hra se načte až po zadání správného hesla; odemčení si prohlížeč pamatuje.
(function () {
  var KEY = 'velmoci-gate';
  var HASH = 'c52f9ad00420407c9f45d2aa16682fa3616c140ac97f323bc60ef0f60e996099'; // SHA-256 hesla
  var FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
  var SCRIPTS = [FB + 'firebase-app-compat.js', FB + 'firebase-auth-compat.js', FB + 'firebase-firestore-compat.js',
    'js/fb.js', 'js/data.js', 'js/engine.js', 'js/app.js'];

  function loadGame() {
    var i = 0;
    (function next() {
      if (i >= SCRIPTS.length) return;
      var s = document.createElement('script');
      s.src = SCRIPTS[i++];
      s.onload = next;
      s.onerror = next; // bez Firebase (offline) hra poběží lokálně
      document.body.appendChild(s);
    })();
  }

  function unlocked() { try { return localStorage.getItem(KEY) === HASH; } catch (e) { return false; } }

  async function sha256(t) {
    var b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
    return Array.from(new Uint8Array(b)).map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
  }

  if (unlocked()) { loadGame(); return; }

  var app = document.getElementById('app');
  app.innerHTML =
    '<div class="gate"><form class="gate-box" autocomplete="off">' +
    '<div class="gate-k">Velmoci <span>1901</span></div>' +
    '<label for="gate-pw">Heslo</label>' +
    '<input id="gate-pw" type="password" autofocus>' +
    '<button class="btn primary big" type="submit">Vstoupit</button>' +
    '<p class="gate-err" role="alert" hidden>Špatné heslo.</p>' +
    '</form></div>';
  var form = app.querySelector('form'), inp = app.querySelector('input'), err = app.querySelector('.gate-err');
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var h = await sha256(inp.value.trim().toLowerCase());
    if (h !== HASH) { err.hidden = false; inp.select(); return; }
    try { localStorage.setItem(KEY, HASH); } catch (e2) { /* ignore */ }
    app.innerHTML = '';
    loadGame();
  });
})();

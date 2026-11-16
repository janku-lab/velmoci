// Velmoci 1901 – online backend pro vlastní web (Firebase: anonymní přihlášení + Firestore).
// Používá se jen mimo Claude artefakt. Rozhraní je stejné jako dbBackend/localBackend v app.js.
(function () {
  'use strict';
  var CONFIG = {
    apiKey: 'AIzaSyCX-_JwENt9uk0ju9pOaAgvoNuSzpuCxVI',
    authDomain: 'velmoci-b14db.firebaseapp.com',
    projectId: 'velmoci-b14db',
    storageBucket: 'velmoci-b14db.firebasestorage.app',
    messagingSenderId: '321739089981',
    appId: '1:321739089981:web:5906fed9b37587b1f3a254',
  };
  var NAME_KEY = 'velmoci-nick';
  var SESSION = Math.random().toString(36).slice(2);

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  // Firestore neumí undefined – vyčistit přes JSON
  function clean(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function withId(d) { var x = d.data() || {}; x.id = d.id; return x; }

  // přezdívka hráče – jednoduchý dialog přes celou obrazovku
  function askName() {
    return new Promise(function (resolve) {
      var w = document.createElement('div');
      w.className = 'gate fbname';
      w.innerHTML = '<form class="gate-box" autocomplete="off">' +
        '<div class="gate-k">Velmoci <span>1901</span></div>' +
        '<label for="fb-nick">Tvoje přezdívka (uvidí ji spoluhráči)</label>' +
        '<input id="fb-nick" maxlength="24" required autofocus>' +
        '<button class="btn primary big" type="submit">Pokračovat</button></form>';
      document.body.appendChild(w);
      var inp = w.querySelector('input');
      setTimeout(function () { inp.focus(); }, 50);
      w.querySelector('form').addEventListener('submit', function (e) {
        e.preventDefault();
        var n = inp.value.trim().slice(0, 24);
        if (!n) return;
        lsSet(NAME_KEY, n); w.remove(); resolve(n);
      });
    });
  }

  async function connect() {
    var fb = window.firebase;
    if (!fb || !fb.firestore || !fb.auth) throw new Error('firebase sdk missing');
    if (!fb.apps.length) fb.initializeApp(CONFIG);
    var db = fb.firestore();
    try { db.settings({ ignoreUndefinedProperties: true }); } catch (e) { /* ignore */ }
    var auth = fb.auth();
    var cred = auth.currentUser ? { user: auth.currentUser } : null;
    if (!cred) {
      // počkat na obnovené přihlášení, jinak se přihlásit anonymně
      var existing = await new Promise(function (res) { var off = auth.onAuthStateChanged(function (u) { off(); res(u); }); });
      cred = existing ? { user: existing } : await auth.signInAnonymously();
    }
    var uid = cred.user.uid;
    var name = lsGet(NAME_KEY) || await askName();
    db.doc('profiles/' + uid).set({ name: name, t: Date.now() }).catch(function () {});

    function lease(path, ttl) {
      var ref = db.doc('leases/' + path.replace(/\//g, '__'));
      return db.runTransaction(function (t) {
        return t.get(ref).then(function (s) {
          var d = s.exists ? s.data() : null; var now = Date.now();
          if (d && d.holder !== SESSION && d.until > now) return { acquired: false };
          t.set(ref, { holder: SESSION, until: now + ttl });
          return { acquired: true };
        });
      }).catch(function () { return { acquired: false }; });
    }
    var g = function (id) { return db.doc('games/' + id); };
    var backend = {
      kind: 'fb', uid: uid,
      watchGames: function (cb, err) { return db.collection('games').orderBy('created', 'desc').limit(60).onSnapshot(function (s) { cb(s.docs.map(withId)); }, err); },
      watchGame: function (id, cb, err) { return g(id).onSnapshot(function (s) { cb(s.exists ? withId(s) : null); }, err); },
      watchSub: function (id, name, cb) { return db.collection('games/' + id + '/' + name).onSnapshot(function (s) { cb(s.docs.map(withId)); }, function () {}); },
      create: async function (data) { var ref = db.collection('games').doc(); await ref.set(clean(data)); return ref.id; },
      getGame: async function (id) { var s = await g(id).get(); return s.exists ? clean(s.data()) : null; },
      getSub: async function (id, name) { var s = await db.collection('games/' + id + '/' + name).get(); return s.docs.map(function (d) { return clean(withId(d)); }); },
      setGame: function (id, data) { var d = clean(data); delete d.id; return g(id).set(d); },
      // hluboké sloučení (jako v Claude db), např. players: { uid: čas }
      updateGame: function (id, patch) { return g(id).set(clean(patch), { merge: true }); },
      setSub: function (id, name, docId, data) { return db.doc('games/' + id + '/' + name + '/' + docId).set(clean(data)); },
      addSub: function (id, name, data) { return db.collection('games/' + id + '/' + name).add(clean(data)); },
      acquire: function (id) { return lease('game/' + id, 20000); },
      removeGame: async function (id) {
        for (var sub of ['orders', 'history', 'chat', 'ai']) {
          var s = await db.collection('games/' + id + '/' + sub).get();
          await Promise.all(s.docs.map(function (d) { return d.ref.delete(); }));
        }
        return g(id).delete();
      },
      acquireDoc: function (path) { return lease(path, 180000); },
      getDoc: async function (path) { var s = await db.doc(path).get(); return s.exists ? clean(s.data()) : null; },
      setDoc: function (path, data) { return db.doc(path).set(clean(data)); },
    };
    // náhrada za Claude `user`: jména hráčů z kolekce profiles
    var user = {
      profiles: async function (ids) {
        var out = {};
        await Promise.all(ids.map(function (id) { return db.doc('profiles/' + id).get().then(function (s) { if (s.exists) out[id] = { name: s.data().name || '' }; }).catch(function () {}); }));
        return out;
      },
      can: async function () { return true; },
      id: async function () { return uid; },
    };
    return { backend: backend, user: user, name: name };
  }

  window.VFB = { connect: connect, rename: function () { try { localStorage.removeItem(NAME_KEY); } catch (e) { /* ignore */ } location.reload(); } };
})();

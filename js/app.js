// Velmoci 1901 – online klient
(function () {
  'use strict';
  const E = window.VEngine, D = window.VDATA, POS = D.pos, NAMES = D.names;
  const PW = E.POWERS;
  const SESSION = Math.random().toString(36).slice(2);
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const enc = (o) => { try { return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).split('').reverse().join(''); } catch (e) { return ''; } };
  const dec = (s) => { try { return JSON.parse(decodeURIComponent(escape(atob(String(s).split('').reverse().join(''))))); } catch (e) { return []; } };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };

  // ------------------------------------------------------------------ backends
  function dbBackend(db, uid) {
    const g = (id) => db.doc('games/' + id);
    return {
      kind: 'db', uid,
      watchGames(cb, err) { return db.collection('games').orderBy('created', 'desc').limit(60).onSnapshot((s) => cb(s.docs.map((d) => Object.assign({ id: d.id }, d.data()))), err); },
      watchGame(id, cb, err) { return g(id).onSnapshot((s) => cb(s.exists ? Object.assign({ id }, s.data()) : null), err); },
      watchSub(id, name, cb) { return db.collection(`games/${id}/${name}`).onSnapshot((s) => cb(s.docs.map((d) => Object.assign({ id: d.id }, d.data()))), () => {}); },
      async create(data) { const ref = db.collection('games').doc(); await ref.set(data); return ref.id; },
      async getGame(id) { const s = await g(id).get(); return s.exists ? JSON.parse(JSON.stringify(s.data())) : null; },
      async getSub(id, name) { const s = await db.collection(`games/${id}/${name}`).get(); return s.docs.map((d) => Object.assign({ id: d.id }, JSON.parse(JSON.stringify(d.data())))); },
      setGame(id, data) { return g(id).set(data); },
      updateGame(id, patch) { return g(id).update(patch); },
      setSub(id, name, docId, data) { return db.doc(`games/${id}/${name}/${docId}`).set(data); },
      addSub(id, name, data) { return db.collection(`games/${id}/${name}`).add(data); },
      acquire(id) { return g(id).acquire({ holder: SESSION, ttlMs: 20000 }); },
      removeGame(id) { return g(id).delete(); },
      acquireDoc(path) { return db.doc(path).acquire({ holder: SESSION, ttlMs: 180000 }); },
      async getDoc(path) { const s = await db.doc(path).get(); return s.exists ? JSON.parse(JSON.stringify(s.data())) : null; },
      setDoc(path, data) { return db.doc(path).set(data); },
    };
  }
  function localBackend() {
    const KEY = 'velmoci-local-v1';
    const store = lsGet(KEY, { games: {}, sub: {} });
    const L = new Set();
    const save = () => lsSet(KEY, store);
    const emit = () => setTimeout(() => L.forEach((f) => f()), 0);
    const clone = (o) => JSON.parse(JSON.stringify(o));
    const listen = (f) => { L.add(f); f(); return () => L.delete(f); };
    const subOf = (id, name) => ((store.sub[id] = store.sub[id] || {})[name] = (store.sub[id] || {})[name] || {});
    const merge = (a, b) => { for (const k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') merge(a[k], b[k]); else a[k] = b[k]; } return a; };
    return {
      kind: 'local', uid: 'local',
      watchGames(cb) { return listen(() => cb(Object.entries(store.games).map(([id, d]) => Object.assign({ id }, clone(d))).sort((a, b) => b.created - a.created))); },
      watchGame(id, cb) { return listen(() => cb(store.games[id] ? Object.assign({ id }, clone(store.games[id])) : null)); },
      watchSub(id, name, cb) { return listen(() => cb(Object.entries(subOf(id, name)).map(([k, v]) => Object.assign({ id: k }, clone(v))))); },
      async create(data) { const id = 'g' + Date.now().toString(36); store.games[id] = clone(data); save(); emit(); return id; },
      async getGame(id) { return store.games[id] ? clone(store.games[id]) : null; },
      async getSub(id, name) { return Object.entries(subOf(id, name)).map(([k, v]) => Object.assign({ id: k }, clone(v))); },
      async setGame(id, data) { store.games[id] = clone(data); save(); emit(); },
      async updateGame(id, patch) { merge(store.games[id], clone(patch)); save(); emit(); },
      async setSub(id, name, docId, data) { subOf(id, name)[docId] = clone(data); save(); emit(); },
      async addSub(id, name, data) { subOf(id, name)['m' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)] = clone(data); save(); emit(); },
      async acquire() { return { acquired: true }; },
      async removeGame(id) { delete store.games[id]; delete store.sub[id]; save(); emit(); },
      async acquireDoc() { return { acquired: true }; },
      async getDoc(path) { const d = (store.docs || {})[path]; return d ? clone(d) : null; },
      async setDoc(path, data) { (store.docs = store.docs || {})[path] = clone(data); save(); },
    };
  }

  // ------------------------------------------------------------------ app state
  const S = {
    B: null, user: null, me: null, canWrite: true,
    games: null, gid: null, game: null, orders: {}, history: [], chat: [],
    unsub: [], names: {},
    tab: lsGet('velmoci-tab', 'orders'), side: lsGet('velmoci-side', true),
    myPower: null, drafts: {}, sel: null, view: null, zoom: lsGet('velmoci-zoom', 1),
    chatTo: 'ALL', resolving: false, toast: null,
  };

  const isBot = (g, p) => !!(g.bots && g.bots[p]) || !(g.seats && g.seats[p]);
  const TEMPO = { live: { l: 'Živě podle pravidel: 30 min první jaro, pak 15 min, ústupy a stavby 5 min', s: '30/15 min', m: [30, 15, 5] }, m20: { l: '20 min na kolo, ústupy a stavby 3 min', s: '20 min', m: [20, 20, 3] }, m10: { l: '10 min na kolo, ústupy a stavby 2 min', s: '10 min', m: [10, 10, 2] }, fast: { l: 'Rychlovka: 10 min první jaro, pak 5 min, ústupy a stavby 2 min', s: '10/5 min', m: [10, 5, 2] }, m3: { l: 'Blesková: 3 min na kolo, ústupy a stavby 1 min', s: '3 min', m: [3, 3, 1] }, h1: { l: '1 hodina na kolo', s: '1 h', h: 1 }, h24: { l: '24 hodin na kolo (hra na dálku)', s: '24 h', h: 24 }, none: { l: 'Bez limitu – čeká se na všechny', s: 'bez limitu' } };
  function phaseLimit(g) {
    const st = g.state; if (!st) return 0;
    if (!g.tempo) return g.deadline > 0 ? g.deadline * 3600e3 : 0;
    const t = TEMPO[g.tempo]; if (!t) return 0;
    if (t.m) return (st.type === 'M' ? (st.year === 1901 && st.season === 'S' ? t.m[0] : t.m[1]) : t.m[2]) * 60e3;
    return t.h ? t.h * 3600e3 : 0;
  }
  const timeLeft = (g) => { const lim = phaseLimit(g); if (!lim) return null; if (g.paused != null) return g.paused; return (g.phaseAt || 0) + lim - Date.now(); };
  const isAI = (g, p) => !!(g.ai && g.ai[p]) && !(g.seats && g.seats[p]);
  const PERSONAS = [
    'Lstivý machiavelista: rozdává sliby a zradí, jakmile mu to vynese centrum.',
    'Věrný, ale pomstychtivý: drží slovo, dokud ho někdo nepodrazí; zradu tvrdě oplácí.',
    'Opatrný obchodník: hledá stabilní dohody a neutrální zóny, riskuje málo.',
    'Agresivní dobyvatel: chce rychle růst, vyhrožuje a tlačí na slabší sousedy.',
    'Blafař: rád straší, předstírá sílu a spojenectví, která nemá.',
    'Chladný stratég: mluví málo a věcně, spojence vybírá podle mapy a bez sentimentu.',
    'Šarmantní lichotník: všem lichotí, každému nabízí výhodný obchod a sám si vybere, koho obětuje.',
  ];
  const shuffle = (a) => { const r = new Uint32Array(a.length); try { crypto.getRandomValues(r); } catch (e) { for (let i = 0; i < r.length; i++) r[i] = Math.random() * 4e9; } for (let i = a.length - 1; i > 0; i--) { const j = r[i] % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function drawPowers(g) {
    const players = shuffle(Object.keys(g.players || {})).slice(0, 7);
    const powers = shuffle(PW.slice());
    const seats = {}, ai = {}, bots = {};
    for (const p of PW) seats[p] = '';
    players.forEach((uid, i) => (seats[powers[i]] = uid));
    const pers = shuffle(PERSONAS.slice()); let k = 0;
    for (const p of PW) if (!seats[p]) { if (g.fill === 'bot') bots[p] = true; else ai[p] = { persona: pers[k++ % pers.length] }; }
    return { seats, ai, bots };
  }
  const myPowers = (g) => (g && g.seats ? PW.filter((p) => g.seats[p] && g.seats[p] === S.B.uid) : []);
  const humansActing = (g) => E.actingPowers(g.state).filter((p) => !isBot(g, p));

  async function profiles(ids) {
    if (!S.user || !ids.length) return;
    try { const ps = await S.user.profiles(ids); let ch = false; for (const id of ids) { const n = (ps[id] && ps[id].name) || ''; if (S.names[id] !== n) { S.names[id] = n; ch = true; } } if (ch) render(); } catch (e) { /* ignore */ }
  }
  const nameOf = (uid) => (uid === S.B.uid ? 'ty' : (S.names[uid] || 'hráč'));

  // ------------------------------------------------------------------ boot
  async function boot() {
    render();
    let db = null, user = null;
    try { if (window.claude && window.claude.use) { [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]); window.claude.use('sample').then((x) => { SAMPLE = x; render(); aiTick(); }).catch(() => {}); } } catch (e) { /* ignore */ }
    let uid = null;
    if (user) { try { uid = await user.id(); } catch (e) { uid = null; } }
    if (db && uid) {
      S.B = dbBackend(db, uid); S.user = user;
      try { const c = await user.can('data.write'); if (c === false) S.canWrite = false; } catch (e) { /* ignore */ }
    } else S.B = localBackend();
    S.loadTimer = setTimeout(() => { if (!S.games) { S.loadSlow = true; render(); } }, 10000);
    S.B.watchGames((list) => { clearTimeout(S.loadTimer); S.games = list || []; profiles([...new Set(S.games.flatMap((g) => Object.values(g.seats || {}).filter(Boolean)))]); render(); },
      () => { S.games = []; S.loadErr = true; render(); });
    const h = (location.hash || '').replace('#', '');
    if (h.startsWith('hra-')) openGame(h.slice(4));
    else if (h === 'tutorial') openTutorial(0);
    else if (h === 'mapa') { S.explore = true; S.ex = { t: 'A', p: null, c: null }; render(); }
    window.addEventListener('hashchange', () => { const x = (location.hash || '').replace('#', ''); if (x.startsWith('hra-')) { if (x.slice(4) !== S.gid) openGame(x.slice(4)); } else if (S.gid) closeGame(); });
    setInterval(() => { if (S.game && S.game.status === 'play') tickClock(); }, 1000);
    setInterval(() => { if (S.game && S.game.status === 'play') maybeResolve(false); }, 5000);
  }

  function openGame(id) {
    closeGame(true); S.modal = null; S.menu = false;
    S.gid = id; S.game = undefined; S.orders = {}; S.history = []; S.chat = []; S.sel = null; S.view = null; S.drafts = {};
    try { if (location.hash !== '#hra-' + id) location.hash = 'hra-' + id; } catch (e) { /* ignore */ }
    S.unsub.push(S.B.watchGame(id, (g) => {
      const prevKey = S.game && S.game.state && E.phaseKey(S.game.state);
      S.game = g;
      if (g) {
        profiles(Object.values(g.seats || {}).filter(Boolean));
        const mp = myPowers(g);
        if (!S.myPower || !mp.includes(S.myPower)) S.myPower = mp[0] || null;
        if (prevKey && g.state && prevKey !== E.phaseKey(g.state)) { S.sel = null; S.view = null; flash('Nové kolo: ' + E.phaseName(g.state)); if (g.state.type !== 'M' && E.actingPowers(g.state).some((p) => mp.includes(p))) { if (S.L.float !== 'orders') S.tab = 'orders'; if (S.L.mode === 'map') S.L.mode = 'split'; } }
      }
      render(); maybeResolve(false); aiTick();
    }, () => { S.game = null; render(); }));
    S.unsub.push(S.B.watchSub(id, 'orders', (docs) => { S.orders = {}; for (const d of docs) S.orders[d.id] = d; render(); maybeResolve(false); }));
    S.unsub.push(S.B.watchSub(id, 'history', (docs) => {
      S.history = docs.sort((a, b) => a.n - b.n);
      const key = 'velmoci-hseen-' + id; const seen = lsGet(key, null);
      if (seen == null) lsSet(key, S.history.length);
      else if (S.history.length > seen) {
        lsSet(key, S.history.length);
        let k = S.history.length - 1; for (let j = seen; j < S.history.length; j++) if (S.history[j].key.endsWith('M')) { k = j; break; }
        if (lsGet('velmoci-autoreplay', true) && !S.tutorial && !S.explore) { rpOpen(k, true); return; }
      }
      if (S.rp) { S.rp.data = rpBuild(S.rp.i); }
      render();
    }));
    S.unsub.push(S.B.watchSub(id, 'chat', (docs) => { S.chat = docs.sort((a, b) => a.t - b.t); profiles([...new Set(docs.map((d) => d.uid).filter(Boolean))]); renderChat(); updateTabs(); aiTick(); }));
    render();
  }
  function closeGame(silent) {
    clearTimeout(S.rpT); S.rp = null;
    S.unsub.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    S.unsub = []; S.gid = null; S.game = null;
    if (!silent) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; } render(); }
  }

  // ------------------------------------------------------------------ resolution
  async function maybeResolve(force) {
    const g = S.game;
    if (!g || g.status !== 'play' || !g.state || g.state.over || S.resolving) return;
    if (!S.canWrite) return;
    const key = E.phaseKey(g.state);
    const need = humansActing(g);
    const ready = need.every((p) => { const o = S.orders[p]; return o && o.key === key && o.ready; });
    const tl = timeLeft(g); const late = tl != null && g.paused == null && tl <= 0;
    if (!force && !ready && !late) return;
    if (!force && !late && g.state.type === 'M') {
      const aiPend = PW.filter((p) => isAI(g, p) && E.unitCount(g.state, p) > 0 && !(S.orders[p] && S.orders[p].key === key));
      if (aiPend.length && Date.now() - (g.phaseAt || 0) < 240e3) return;
    }
    if (!force && need.length === 0 && myPowers(g).length === 0 && g.createdBy !== S.B.uid) return;
    S.resolving = true; render();
    try {
      const lease = await S.B.acquire(g.id);
      if (lease && lease.acquired === false) return;
      const fresh = await S.B.getGame(g.id);
      if (!fresh || fresh.status !== 'play' || E.phaseKey(fresh.state) !== key) return;
      const docs = await S.B.getSub(g.id, 'orders');
      let st = fresh.state, seq = fresh.seq || 0;
      const recs = [];
      for (let i = 0; i < 12; i++) {
        const k = E.phaseKey(st);
        const ob = {};
        for (const p of E.actingPowers(st)) {
          const dd = docs.find((x) => x.id === p);
          if (isAI(fresh, p) && st.type === 'M' && dd && dd.key === k && dd.uid === 'ai') ob[p] = dec(dd.enc);
          else if (isBot(fresh, p)) ob[p] = E.botOrders(st, p);
          else { const d = docs.find((x) => x.id === p); ob[p] = d && d.key === k ? dec(d.enc) : []; }
        }
        const r = E.advance(st, ob);
        recs.push(Object.assign({}, r.record, { n: seq++ }));
        st = r.state;
        if (st.over) break;
        if (E.actingPowers(st).some((p) => !isBot(fresh, p))) break;
        if (E.actingPowers(st).length === 0 && st.type !== 'M') continue;
        if (!E.actingPowers(st).some((p) => !isBot(fresh, p)) && !PW.some((p) => !isBot(fresh, p) && E.alive(st, p))) break;
      }
      for (const rec of recs) await S.B.setSub(g.id, 'history', rec.key, JSON.parse(JSON.stringify(rec)));
      const out = Object.assign({}, fresh, { state: st, seq, phaseAt: Date.now(), paused: null, status: st.over ? 'over' : 'play' });
      delete out.id;
      await S.B.setGame(g.id, JSON.parse(JSON.stringify(out)));
    } catch (e) {
      console.error(e); flash('Vyhodnocení se nepovedlo, zkus to znovu.');
    } finally { S.resolving = false; render(); }
  }

  // ------------------------------------------------------------------ AI diplomats
  let SAMPLE = null;
  const AIQ = { running: 0, queue: [], tried: new Set() };
  const aiHosting = () => !!(SAMPLE && S.gid && lsGet('velmoci-aihost-' + S.gid, false) && !S.aiOff);
  function aiHostBox(g) {
    if (!g || g.status !== 'play' || !PW.some((p) => isAI(g, p))) return '';
    if (!SAMPLE) return `<p class="muted small aibox">AI diplomaty tady spustit nejde. Běží jen v aplikaci Claude u přihlášeného hráče.</p>`;
    if (!myPowers(g).length && g.createdBy !== S.B.uid) return '';
    const on = aiHosting();
    const busy = AIQ.running + AIQ.queue.length;
    return `<div class="aibox"><div><b>AI diplomaté</b> ${on ? (busy ? `<span class="aist">přemýšlí (${busy})…</span>` : '<span class="aist ok">běží u tebe</span>') : '<span class="aist">vypnuto na tomto zařízení</span>'}</div>
      <p class="muted small">${S.aiOff ? 'Claude teď odmítl další dotazy (limit nebo nepovolený přístup). Zkus to později.' : 'Aby AI velmoci psaly zprávy a zadávaly rozkazy, musí je u sebe hostit aspoň jeden hráč. Spotřebovává to jeho využití Clauda.'}</p>
      <button class="btn sm${on ? '' : ' primary'}" data-act="aihost">${on ? 'Přestat hostit' : 'Hostit AI diplomaty'}</button></div>`;
  }
  function aiTick() {
    const g = S.game;
    if (!aiHosting() || !g || g.status !== 'play' || !g.state || g.state.over || !S.canWrite) return;
    const st = g.state; const key = E.phaseKey(st);
    if (st.type !== 'M') return;
    for (const p of PW) if (isAI(g, p) && E.unitCount(st, p) > 0) enqueue(`o-${key}-${p}`, () => aiTurn(p, null));
    const since = (g.phaseAt || 0) - 120e3;
    for (const m of S.chat) {
      if (m.t < since || m.ai || !m.from) continue;
      if (PW.includes(m.to) && isAI(g, m.to)) enqueue(`r-${m.id}`, () => aiTurn(m.to, m));
      else if (m.to === 'ALL') {
        // public message: the AI powers it names answer
        const named = PW.filter((p) => isAI(g, p) && new RegExp(E.PNAME[p].slice(0, 5), 'i').test(m.text));
        for (const p of named.slice(0, 2)) enqueue(`r-${m.id}-${p}`, () => aiTurn(p, m));
      }
    }
  }
  function enqueue(id, fn) { if (AIQ.tried.has(id)) return; AIQ.tried.add(id); AIQ.queue.push({ id, fn }); pump(); }
  function pump() {
    while (AIQ.running < 2 && AIQ.queue.length && aiHosting()) {
      const job = AIQ.queue.shift(); AIQ.running++;
      runJob(job).finally(() => { AIQ.running--; refreshAiBox(); pump(); });
    }
    refreshAiBox();
  }
  function refreshAiBox() { document.querySelectorAll('.aibox .aist').forEach((el) => { const busy = AIQ.running + AIQ.queue.length; el.textContent = !aiHosting() ? 'vypnuto na tomto zařízení' : busy ? `přemýšlí (${busy})…` : 'běží u tebe'; el.classList.toggle('ok', aiHosting() && !busy); }); }
  async function runJob(job) {
    const ref = `games/${S.gid}/ai/${job.id}`;
    try {
      const lease = await S.B.acquireDoc(ref);
      if (lease && lease.acquired === false) return;
      const d = await S.B.getDoc(ref); if (d && d.done) return;
      await job.fn();
      await S.B.setDoc(ref, { done: true, t: Date.now() });
    } catch (e) {
      const c = e && e.code;
      if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'rate_limited', 'session_expired'].includes(c)) { S.aiOff = true; AIQ.queue = []; render(); }
      console.warn('AI', job.id, e);
    }
  }
  const PALIAS = { RAK: 'RAK', AUS: 'RAK', ANG: 'ANG', ENG: 'ANG', FRA: 'FRA', NEM: 'NEM', 'NĚM': 'NEM', GER: 'NEM', ITA: 'ITA', RUS: 'RUS', TUR: 'TUR', ALL: 'ALL', 'VŠEM': 'ALL', VSEM: 'ALL' };
  const normPower = (x) => PALIAS[String(x || '').trim().toUpperCase()] || PW.find((p) => E.PNAME[p].toUpperCase() === String(x || '').trim().toUpperCase()) || null;

  function buildPrompt(g, p, notes, incoming) {
    const st = g.state;
    const L = [];
    const kind = (q) => (g.seats[q] ? 'živý hráč' : isAI(g, q) ? 'AI hráč' : 'jednoduchý bot, nevyjednává');
    L.push(`Hraješ deskovou hru Diplomacie (česká verze „Velmoci 1901“) za velmoc ${E.PNAME[p]} (${p}). Hraj naplno jako zkušený živý hráč: vyjednávej, uzavírej spojenectví, slibuj, vyhrožuj, blafuj, a když se to vyplatí, zraď. Lži a podrazy v jednání jsou v této hře povolené a běžné, je to jen hra. Nikdy neprozrazuj, že jsi AI nebo program; mluv jako vláda své země. Nepiš nic urážlivého.`);
    L.push(`Tvá povaha: ${(g.ai[p] && g.ai[p].persona) || PERSONAS[0]}`);
    L.push(`Pravidla v kostce: vítězí ten, kdo po podzimu ovládá 18 z 34 zásobovacích center. Jednotka má sílu 1, každá platná podpora +1; tah uspěje jen silnější než obrana, při rovnosti se odrazí. Podporu přeruší útok na podporující jednotku odjinud než z pole, kam podpora míří. Vlastní jednotku nelze vytlačit. Centra se přepočítávají po podzimu, v zimě se podle nich staví nebo ruší jednotky. Armáda (A) chodí po souši, loďstvo (F) po mořích a pobřežích, loďstvo na moři může konvojovat armádu.`);
    L.push(`Fáze: ${E.phaseName(st)}.`);
    L.push('Velmoci (centra / jednotky):');
    for (const q of PW) {
      const sc = E.SC.filter((c) => st.sc[c] === q);
      const us = st.units.filter((u) => u.o === q).map((u) => `${u.t} ${u.p}${u.c ? '/' + u.c : ''}`);
      if (!sc.length && !us.length) { L.push(`- ${q} ${E.PNAME[q]}: vyřazena`); continue; }
      L.push(`- ${q} ${E.PNAME[q]}${q === p ? ' (TY)' : ` [${kind(q)}]`}: ${sc.length} center (${sc.join(' ')}); jednotky: ${us.join(', ') || 'žádné'}`);
    }
    L.push(`Neutrální centra: ${E.SC.filter((c) => !st.sc[c]).join(' ') || 'žádná'}`);
    L.push('Kam mohou táhnout tvé jednotky:');
    for (const u of st.units.filter((x) => x.o === p)) L.push(`- ${u.t} ${u.p}${u.c ? '/' + u.c : ''}: ${E.unitNeighbors(u).map((n) => n.p + (n.c ? '/' + n.c : '')).join(', ')}`);
    const last = [...S.history].reverse().find((r) => r.key && r.key.endsWith('M'));
    if (last) {
      L.push(`Co se doopravdy stalo v posledním kole (${last.name}) – porovnej se sliby, ať víš, kdo lže:`);
      for (const q of PW) { const os = (last.orders || []).filter((o) => o.o === q); if (os.length) L.push(`- ${q}: ${os.map((o) => E.orderText({ units: last.units }, o) + (last.results && last.results[o.p] && last.results[o.p] !== 'ok' ? ' [' + last.results[o.p] + ']' : '')).join('; ')}`); }
    }
    const conv = S.chat.filter((m) => m.to === 'ALL' || m.to === p || m.from === p).slice(-36);
    if (conv.length) {
      L.push('Jednání, které vidíš (nejstarší první):');
      for (const m of conv) L.push(`[${m.ph || ''}] ${m.from} → ${m.to === 'ALL' ? 'všem' : m.to}: ${String(m.text).slice(0, 400)}`);
    }
    L.push(`Tvé soukromé poznámky z minula: ${notes || '(zatím žádné)'}`);
    if (incoming) L.push(`PRÁVĚ TI PŘIŠLA ZPRÁVA od ${E.PNAME[incoming.from]} (${incoming.from}${incoming.to === 'ALL' ? ', veřejně' : ', soukromě'}): „${String(incoming.text).slice(0, 600)}“. Odpověz (a pokud chceš, napiš i jiným), případně uprav své rozkazy. Když rozkazy neměníš, dej "rozkazy": [].`);
    else L.push('Začíná nové kolo. Rozmysli strategii, pošli 0–3 zprávy (klidně každému něco jiného) a zadej rozkazy pro všechny své jednotky.');
    L.push(`Odpověz jen JSON objektem:
{"poznamky": "soukromý plán na další kola: komu co slibuješ, komu věříš, koho podrazíš (max 700 znaků)",
 "zpravy": [{"komu": "FRA", "text": "česky, 1–3 věty, v roli"}],
 "rozkazy": ["A PAR - BUR", "A MAR S A PAR - BUR", "F BRE H", "F ENG C A LON - BEL", "F MAO - SPA/NC"]}
"komu" je RAK, ANG, FRA, NEM, ITA, RUS, TUR nebo ALL (veřejně). Nepiš jednoduchým botům. Rozkazy: H drž, - táhni, S podpoř, C konvoj; pobřeží NC/SC/EC. Ostatní tvé rozkazy uvidí až po vyhodnocení.`);
    return L.join('\n');
  }
  async function aiTurn(p, incoming) {
    const g = S.game; if (!g || !SAMPLE) return;
    const st = g.state; const key = E.phaseKey(st);
    const memRef = `games/${S.gid}/ai/mem-${p}`;
    const mem = (await S.B.getDoc(memRef)) || {};
    const out = await SAMPLE.json(buildPrompt(g, p, mem.notes || '', incoming), { cache: false, effort: incoming ? 'low' : 'medium' });
    const g2 = S.game; if (!g2 || !g2.state || E.phaseKey(g2.state) !== key) return;
    if (out && typeof out.poznamky === 'string') await S.B.setDoc(memRef, { notes: out.poznamky.slice(0, 2000), t: Date.now() });
    const msgs = Array.isArray(out && out.zpravy) ? out.zpravy.slice(0, 4) : [];
    for (const m of msgs) {
      const to = normPower(m && m.komu); const text = String((m && m.text) || '').trim().slice(0, 700);
      if (!to || to === p || !text) continue;
      if (to !== 'ALL' && isBot(g2, to) && !isAI(g2, to)) continue;
      await S.B.addSub(S.gid, 'chat', { from: p, to, text, t: Date.now(), uid: 'ai', ai: true, ph: E.phaseName(st).split(' · ')[0] });
    }
    const raw = Array.isArray(out && out.rozkazy) ? out.rozkazy : [];
    if (raw.length || !incoming) {
      const parsed = [];
      for (const t of raw) { const o = E.parseOrder(st, p, t); if (o && !parsed.some((x) => x.p === o.p)) parsed.push(o); }
      for (const o of E.botOrders(st, p)) if (!parsed.some((x) => x.p === o.p)) parsed.push(o);
      await S.B.setSub(S.gid, 'orders', p, { key, enc: enc(parsed), ready: true, uid: 'ai', t: Date.now() });
    }
  }

  // ------------------------------------------------------------------ orders (drafts)
  function draftFor(pw) {
    const g = S.game; if (!g || !g.state) return null;
    const key = E.phaseKey(g.state);
    let d = S.drafts[pw];
    if (!d || d.key !== key) {
      const doc = S.orders[pw];
      const list = doc && doc.key === key ? dec(doc.enc) : [];
      d = S.drafts[pw] = { key, list: Array.isArray(list) ? list : [] };
    }
    return d;
  }
  let saveTimer = null;
  function setDraft(pw, list, ready) {
    const d = draftFor(pw); d.list = list;
    const doc = { key: d.key, enc: enc(list), ready: !!ready, uid: S.B.uid, t: Date.now() };
    S.orders[pw] = doc;
    clearTimeout(saveTimer);
    const write = () => S.B.setSub(S.gid, 'orders', pw, doc).catch(() => flash('Rozkazy se nepodařilo uložit. Máš k této hře právo zápisu?'));
    if (ready) write(); else saveTimer = setTimeout(write, 700);
    render();
    if (ready) setTimeout(() => maybeResolve(false), 300);
  }
  function setUnitOrder(pw, o) {
    const d = draftFor(pw);
    const list = d.list.filter((x) => x.p !== o.p);
    list.push(o);
    setDraft(pw, list, false);
  }
  function clearUnitOrder(pw, p) { const d = draftFor(pw); setDraft(pw, d.list.filter((x) => x.p !== p), false); }

  // ------------------------------------------------------------------ geometry
  const posOf = (p, c) => (c && POS.coast[p + '/' + c]) || POS.unit[p];
  // centre of a territory for target rings: the territory's name on the map (coast marker for split coasts)
  const ctrOf = (p, c) => (c && POS.coast[p + '/' + c]) || (POS.label[p] ? [POS.label[p][0], POS.label[p][1] - 8] : POS.unit[p]);
  const tgtPos = (t) => (t.unit ? posOf(t.p, t.c) : ctrOf(t.p, t.c));
  const locStr = (p, c) => (c ? p + '/' + c : p);

  function viewState() {
    if (S.view != null) { const r = S.history[S.view]; return r ? { units: r.units, sc: r.sc, dislodged: r.dislodged || [], rec: r } : null; }
    return S.game && S.game.state;
  }

  // targets for current selection
  function adjustTargets(g) {
    const st = g.state; const needs = E.adjustmentNeeds(st); const out = [];
    for (const pw of myPowers(g)) {
      const n = needs[pw]; if (!n) continue;
      const list = draftFor(pw).list;
      if (n > 0) {
        if (list.filter((x) => x.k === 'B').length >= n) continue;
        for (const h of E.HOME[pw]) if (st.sc[h] === pw && !E.unitAt(st, h) && !list.some((x) => x.k === 'B' && x.p === h)) out.push({ p: h, c: null, build: pw });
      } else for (const u of st.units.filter((x) => x.o === pw)) out.push({ p: u.p, c: u.c, unit: true, disb: pw });
    }
    return out;
  }
  function targets() {
    const g = S.game, sel = S.sel; if (!g || S.view != null || g.status !== 'play') return [];
    const st = g.state;
    if (st.type === 'A' && (!sel || sel.mode === 'buildpick')) return adjustTargets(g);
    if (!sel) return [];
    const u = sel.unit;
    if (st.type === 'M') {
      if (sel.mode === 'move') {
        const t = E.unitNeighbors(u).map((n) => ({ p: n.p, c: n.c }));
        if (u.t === 'A' && E.isCoastal(u.p)) for (const p of convoyReach(st, u)) if (!t.some((x) => x.p === p)) t.push({ p, c: null, vc: true });
        return t;
      }
      if (sel.mode === 'sup1') return st.units.filter((x) => x.p !== u.p && (E.canReach(u, x.p) || E.unitNeighbors(x).some((n) => n.p !== u.p && E.canReach(u, n.p)))).map((x) => ({ p: x.p, c: x.c, unit: true }));
      if (sel.mode === 'sup2') {
        const x = sel.other; const out = [];
        if (E.canReach(u, x.p)) out.push({ p: x.p, c: x.c, hold: true });
        for (const n of E.unitNeighbors(x)) if (n.p !== u.p && E.canReach(u, n.p) && !out.some((o) => o.p === n.p)) out.push({ p: n.p, c: null });
        if (x.t === 'A' && E.isCoastal(x.p)) for (const p of convoyReach(st, x)) if (p !== u.p && E.canReach(u, p) && !out.some((o) => o.p === p)) out.push({ p, c: null });
        return out;
      }
      if (sel.mode === 'conv1') return st.units.filter((x) => x.t === 'A' && E.isCoastal(x.p) && E.dist('A', x.p, x.p) === 0 && E.ADJ[u.p].some((q) => q === x.p || E.isSea(q))).map((x) => ({ p: x.p, c: null, unit: true }));
      if (sel.mode === 'conv2') return Object.keys(E.ADJ).filter((p) => E.isCoastal(p) && p !== sel.other.p).map((p) => ({ p, c: null }));
    }
    if (st.type === 'R' && sel.mode === 'retreat') return (sel.d.opts || []).map((s) => { const [p, c] = s.split('/'); return { p, c: c || null }; });
    if (st.type === 'A' && sel.mode === 'build') return sel.free.map((p) => ({ p, c: null }));
    return [];
  }
  // coastal provinces reachable by an army via sea chains containing fleets
  function convoyReach(st, u) {
    const fleetSeas = new Set(st.units.filter((x) => x.t === 'F' && E.isSea(x.p)).map((x) => x.p));
    const seen = new Set(); const q = [];
    for (const n of E.ADJ[u.p]) if (fleetSeas.has(n)) { seen.add(n); q.push(n); }
    const out = new Set();
    while (q.length) { const s = q.shift(); for (const n of E.ADJ[s]) { if (fleetSeas.has(n) && !seen.has(n)) { seen.add(n); q.push(n); } else if (E.isCoastal(n) && n !== u.p) out.add(n); } }
    return [...out];
  }

  // ------------------------------------------------------------------ map interaction
  function onMapClick(ev) {
    if (S.rp) return;
    if (S.dragged && Date.now() - S.dragged < 250) return;
    const svg = $('#mapsvg'); if (!svg) return;
    const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const m = pt.matrixTransform(svg.getScreenCTM().inverse());
    const tokenEl = ev.target.closest && ev.target.closest('[data-unit]');
    const g = S.game; if (!g || g.status !== 'play' || S.view != null) return;
    const st = g.state;
    const ts = targets();
    const tEl = ev.target.closest && ev.target.closest('[data-tgt]');
    if (tEl && ts[+tEl.getAttribute('data-tgt')]) { pickTarget(ts[+tEl.getAttribute('data-tgt')]); return; }
    if (ts.length) {
      let best = null;
      for (const t of ts) {
        const pts = [tgtPos(t)];
        if (!t.c) { if (POS.label[t.p]) pts.push(POS.label[t.p]); if (POS.sc[t.p]) pts.push(POS.sc[t.p]); }
        for (const q of pts) { const d = Math.hypot(q[0] - m.x, q[1] - m.y) * (q === pts[0] ? 1 : 1.35); if (!best || d < best.d) best = { d, t }; }
      }
      if (best && best.d < 60) { pickTarget(best.t); return; }
    }
    // select unit
    let target = null;
    if (tokenEl) target = tokenEl.getAttribute('data-unit');
    else {
      let best = null;
      const pool = st.type === 'R' ? st.dislodged.map((d) => ({ p: d.p, xy: dislodgedPos(d) })) : st.units.map((u) => ({ p: u.p, xy: posOf(u.p, u.c) }));
      for (const x of pool) { const d = Math.hypot(x.xy[0] - m.x, x.xy[1] - m.y); if (!best || d < best.d) best = { d, p: x.p }; }
      if (best && best.d < 42) target = best.p;
      if (!target && st.type === 'A') {
        for (const p of PW.flatMap((x) => E.HOME[x])) { const q = POS.sc[p] || POS.unit[p]; if (Math.hypot(q[0] - m.x, q[1] - m.y) < 45) target = p; }
      }
    }
    if (target) selectAt(target); else { S.sel = null; render(); }
  }
  const dislodgedPos = (d) => { const p = posOf(d.p, d.c); return [p[0] + 34, p[1] + 30]; };

  function selectAt(p) {
    const g = S.game, st = g.state;
    const mine = myPowers(g);
    if (st.type === 'M') {
      const u = E.unitAt(st, p);
      if (!u || !mine.includes(u.o)) { S.sel = null; render(); return; }
      if (S.sel && S.sel.unit && S.sel.unit.p === p && S.sel.mode === 'move') { setUnitOrder(u.o, { p, k: 'H' }); S.sel = null; render(); return; }
      S.myPower = u.o; S.sel = { unit: u, mode: 'move' }; render(); return;
    }
    if (st.type === 'R') {
      const d = st.dislodged.find((x) => x.p === p);
      if (!d || !mine.includes(d.o)) { S.sel = null; render(); return; }
      S.myPower = d.o; S.sel = { unit: d, d, mode: 'retreat' }; render(); return;
    }
    if (st.type === 'A') {
      const needs = E.adjustmentNeeds(st);
      const u = E.unitAt(st, p);
      if (u && mine.includes(u.o) && needs[u.o] < 0) {
        const d = draftFor(u.o);
        const has = d.list.some((x) => x.k === 'X' && x.p === p);
        if (has) setDraft(u.o, d.list.filter((x) => !(x.k === 'X' && x.p === p)), false);
        else if (d.list.filter((x) => x.k === 'X').length < -needs[u.o]) setDraft(u.o, d.list.concat([{ k: 'X', p }]), false);
        else flash('Už máš vybráno dost jednotek k rozpuštění.');
        return;
      }
      const owner = PW.find((x) => E.HOME[x].includes(p));
      if (owner && mine.includes(owner) && needs[owner] > 0 && st.sc[p] === owner && !u) {
        S.myPower = owner; S.sel = { mode: 'buildpick', p, pw: owner, free: [p] }; render(); return;
      }
    }
    S.sel = null; render();
  }

  function pickTarget(t) {
    const st = S.game.state;
    if (st.type === 'A') { if (t.build) { S.myPower = t.build; S.sel = { mode: 'buildpick', p: t.p, pw: t.build }; render(); } else if (t.disb) selectAt(t.p); return; }
    const sel = S.sel, u = sel.unit;
    if (st.type === 'M') {
      if (sel.mode === 'move') { setUnitOrder(u.o, { p: u.p, k: 'M', to: t.p, tc: t.c || null, vc: !!t.vc }); S.sel = null; if (t.vc) autoConvoy(u, t.p); }
      else if (sel.mode === 'sup1') { const x = E.unitAt(st, t.p); S.sel = { unit: u, mode: 'sup2', other: x }; }
      else if (sel.mode === 'sup2') { setUnitOrder(u.o, { p: u.p, k: 'S', sp: sel.other.p, st: t.hold ? null : t.p }); S.sel = null; }
      else if (sel.mode === 'conv1') { S.sel = { unit: u, mode: 'conv2', other: E.unitAt(st, t.p) }; }
      else if (sel.mode === 'conv2') {
        setUnitOrder(u.o, { p: u.p, k: 'C', sp: sel.other.p, st: t.p });
        if (sel.other.o === u.o) setUnitOrder(u.o, { p: sel.other.p, k: 'M', to: t.p, tc: null, vc: true });
        S.sel = null;
      }
    } else if (st.type === 'R') { setUnitOrder(sel.d.o, { p: sel.d.p, k: 'R', to: t.p, tc: t.c || null }); S.sel = null; }
    render();
  }
  // shortest chain of fleets at sea that can carry army at `from` to `to`
  function convoyPath(st, from, to) {
    const fleetSea = new Map(st.units.filter((x) => x.t === 'F' && E.isSea(x.p)).map((x) => [x.p, x]));
    const prev = {}; const q = [];
    for (const n of E.ADJ[from]) if (fleetSea.has(n)) { prev[n] = null; q.push(n); }
    while (q.length) {
      const s0 = q.shift();
      if (E.ADJ[s0].includes(to)) { const path = []; let c = s0; while (c) { path.unshift(fleetSea.get(c)); c = prev[c]; } return path; }
      for (const n of E.ADJ[s0]) if (fleetSea.has(n) && !(n in prev)) { prev[n] = s0; q.push(n); }
    }
    return null;
  }
  function autoConvoy(army, to) {
    const st = S.game.state; const path = convoyPath(st, army.p, to);
    if (!path) { flash('Na tuhle cestu teď nejsou loďstva.'); return; }
    const foreign = [];
    for (const f of path) {
      if (f.o === army.o) { const cur = draftFor(f.o).list.find((x) => x.p === f.p); if (!cur || cur.k === 'H' || cur.k === 'C') setUnitOrder(f.o, { p: f.p, k: 'C', sp: army.p, st: to }); }
      else foreign.push(`${E.PNAME[f.o]} (L ${f.p})`);
    }
    flash(foreign.length ? `Konvoj potřebuje i cizí loďstvo: ${foreign.join(', ')}. Domluv se, ať zadá „K A ${army.p} – ${to}“.` : `Konvoj ${army.p} – ${to}: tvá loďstva dostala rozkaz převézt armádu.`);
  }
  function addBuild(pw, p, t, c) {
    const st = S.game.state; const d = draftFor(pw); const n = E.adjustmentNeeds(st)[pw];
    const list = d.list.filter((x) => !(x.k === 'B' && x.p === p));
    if (list.filter((x) => x.k === 'B').length >= n) { flash('Víc staveb už nemáš.'); return; }
    list.push({ k: 'B', p, t, c: c || null }); S.sel = null; setDraft(pw, list, false);
  }

  // ------------------------------------------------------------------ SVG
  const ICON = {
    A: '<g class="ico"><rect x="-9" y="-6.5" width="17" height="5.5" rx="1.6" transform="rotate(-18)"/><circle cx="-2.5" cy="4.5" r="5.2"/><circle cx="-2.5" cy="4.5" r="1.7" class="hub"/><rect x="4" y="5" width="8" height="2.6" rx="1"/></g>',
    F: '<g class="ico"><path d="M-12 2 H12 L8 9 H-8 Z"/><rect x="-6" y="-4" width="10" height="5" rx="0.8"/><rect x="-2.6" y="-10" width="3" height="6.5"/><rect x="5" y="-1.6" width="5" height="1.8"/></g>',
  };
  function tokenSVG(u, x, y, extra) {
    const cls = ['tok', 'pw-' + u.o].concat(extra || []).join(' ');
    return `<g class="${cls}" transform="translate(${x},${y}) scale(1.32)" data-unit="${u.p}"><rect x="-21" y="-21" width="42" height="42" rx="6" class="tok-bg"/><rect x="-17" y="-17" width="34" height="34" rx="4" class="tok-in"/>${ICON[u.t]}</g>`;
  }
  function arrow(x1, y1, x2, y2, cls, shrink) {
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
    const s1 = 30, s2 = shrink == null ? 34 : shrink;
    const ax = x1 + dx * s1 / L, ay = y1 + dy * s1 / L, bx = x2 - dx * s2 / L, by = y2 - dy * s2 / L;
    // slight curve
    const mx = (ax + bx) / 2 - dy * 0.08, my = (ay + by) / 2 + dx * 0.08;
    const d = `M${ax.toFixed(1)} ${ay.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
    return `<path class="halo ${cls}" d="${d}"/><path class="${cls}" d="${d}"/>`;
  }
  function ordersSVG(units, orders, results) {
    let s = '';
    const at = (p) => units.find((x) => x.p === p);
    for (const o of orders) {
      const u = at(o.p); if (!u) continue;
      const pw = o.o || u.o;
      const [x1, y1] = posOf(u.p, u.c);
      const r = results ? results[o.p] : null;
      const fail = r && /bounce|cut|void|invalid|noconvoy|disrupted/.test(r) ? ' fail' : '';
      if (o.k === 'M') { const [x2, y2] = posOf(o.to, o.tc); s += arrow(x1, y1, x2, y2, `ord mv pw-${pw}${fail}`).replace(/\/>$/, ` marker-end="url(#ah-${pw})"/>`); if (fail) s += xmark(x2, y2, x1, y1); }
      else if (o.k === 'S') {
        const su = at(o.sp); if (!su) continue;
        const [sx, sy] = posOf(su.p, su.c);
        if (o.st) { const [tx, ty] = posOf(o.st, null); const mx = sx + (tx - sx) * 0.55, my = sy + (ty - sy) * 0.55; s += arrow(x1, y1, mx, my, `ord sp pw-${pw}${fail}`, 4) + `<circle class="spdot pw-${pw}${fail}" cx="${mx}" cy="${my}" r="6"/>`; }
        else s += arrow(x1, y1, sx, sy, `ord sp pw-${pw}${fail}`, 28) + `<circle class="sphold pw-${pw}${fail}" cx="${sx}" cy="${sy}" r="35"/>`;
      } else if (o.k === 'C') {
        const a = at(o.sp); if (!a) continue;
        const [ax, ay] = posOf(a.p, a.c); const [tx, ty] = posOf(o.st, null);
        s += arrow(x1, y1, (ax + tx) / 2, (ay + ty) / 2, `ord cv pw-${pw}${fail}`, 4);
      } else if (o.k === 'H' && !o.inv) s += `<rect class="hold pw-${pw}" x="${x1 - 33}" y="${y1 - 33}" width="66" height="66" rx="9"/>`;
      else if (o.k === 'R' && o.to) { const [x2, y2] = posOf(o.to, o.tc); s += arrow(x1 + 34, y1 + 30, x2, y2, `ord mv rt pw-${pw}`).replace(/\/>$/, ` marker-end="url(#ah-${pw})"/>`); }
    }
    return s;
  }
  const xmark = (x, y, fx, fy) => { const dx = x - fx, dy = y - fy, L = Math.hypot(dx, dy) || 1; const cx = x - dx * 30 / L, cy = y - dy * 30 / L; return `<g class="xm" transform="translate(${cx},${cy})"><path d="M-7 -7 L7 7 M7 -7 L-7 7"/></g>`; };

  function mapSVG() {
    if (S.rp && S.rp.data) return rpSVG();
    const g = S.game;
    const vs = viewState();
    if (!vs) return '';
    let s = `<svg id="mapsvg" viewBox="0 0 2500 1770" xmlns="http://www.w3.org/2000/svg"><defs>${PW.map((p) => `<marker id="ah-${p}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse"><path class="ahp pw-${p}" d="M0 0 L10 5 L0 10 z"/></marker>`).join('')}</defs>`;
    // SC ownership
    for (const p of E.SC) {
      const own = vs.sc && vs.sc[p]; const q = POS.sc[p]; if (!q) continue;
      if (own) s += `<circle class="scring pw-${own}" cx="${q[0]}" cy="${q[1]}" r="17"/>`;
    }
    // orders
    let ordList = [], results = null;
    if (S.view != null) { ordList = vs.rec.orders || []; results = vs.rec.results; }
    else if (g.state.type === 'M' || g.state.type === 'R') {
      for (const pw of myPowers(g)) { const d = draftFor(pw); if (d) ordList = ordList.concat(d.list.map((o) => Object.assign({ o: pw }, o))); }
    }
    const isMove = S.view != null ? vs.rec.key.endsWith('M') : g.state.type === 'M';
    s += `<g class="orders">${isMove || (S.view == null && g.state.type === 'R') ? ordersSVG(S.view == null && g.state.type === 'R' ? g.state.dislodged : vs.units, ordList, results) : ''}</g>`;
    // units
    const selP = S.sel && S.sel.unit ? S.sel.unit.p : null;
    const mine = new Set(myPowers(g));
    const pendX = S.view == null && g.state.type === 'A' ? new Set(myPowers(g).flatMap((pw) => draftFor(pw).list.filter((x) => x.k === 'X').map((x) => x.p))) : new Set();
    for (const u of vs.units) {
      const [x, y] = posOf(u.p, u.c);
      const ex = [];
      if (selP === u.p && g.state.type === 'M' && S.view == null) ex.push('sel');
      if (mine.has(u.o) && S.view == null) ex.push('mine');
      if (pendX.has(u.p)) ex.push('gone');
      if (S.sel && S.sel.other && S.sel.other.p === u.p) ex.push('sel2');
      s += tokenSVG(u, x, y, ex);
    }
    const dl = S.view != null ? (S.history[S.view + 1] && S.history[S.view + 1].key.endsWith('R') ? S.history[S.view + 1].dislodged || [] : []) : (g.state.type === 'R' ? g.state.dislodged : []);
    for (const d of dl) { const [x, y] = dislodgedPos(d); s += tokenSVG(d, x, y, ['disl'].concat(selP === d.p ? ['sel'] : [])); }
    // targets (on top, directly clickable)
    const ts = targets();
    ts.forEach((t, i) => {
      const [x, y] = tgtPos(t);
      const lab = t.p + (t.c ? '/' + E.COAST_CZ[t.c] : '');
      s += `<g class="tgt${t.vc ? ' vc' : ''}${t.hold ? ' th' : ''}${t.unit ? ' tu' : ''}" data-tgt="${i}" transform="translate(${x},${y})"><circle class="hit" r="30"/><circle r="${t.unit ? 34 : 24}"/><rect class="tl" x="-26" y="${t.unit ? 36 : 26}" width="52" height="22" rx="4"/><text class="tlt" y="${t.unit ? 52 : 42}">${lab}</text></g>`;
    });
    // builds pending
    if (S.view == null && g.state.type === 'A') {
      for (const pw of myPowers(g)) for (const b of draftFor(pw).list.filter((x) => x.k === 'B')) { const [x, y] = posOf(b.p, b.c); s += tokenSVG({ o: pw, t: b.t, p: b.p }, x, y, ['new']); }
    }
    s += '</svg>';
    return s;
  }

  // ------------------------------------------------------------------ render
  const app = () => $('#app');
  function render() {
    const root = app(); if (!root) return;
    if (!S.B) { root.innerHTML = `<div class="loading">Načítám…</div>`; return; }
    if (S.tutorial) renderTutorial(root);
    else if (S.explore) renderExplorer(root);
    else if (!S.gid) renderLobby(root);
    else renderGame(root);
    musSync();
  }

  // ------------------------------------------------------------------ music: recordings (Musopen, public domain)
  const MUS = { on: lsGet('velmoci-music', true), cur: null, els: {}, unlocked: false, vol: 0.6 };
  window.__velmociMusic = MUS;
  const MSRC = { menu: 'music/menu.mp3', spring: 'music/spring.mp3', fall: 'music/fall.mp3' };
  function musEl(name) {
    let a = MUS.els[name];
    if (!a) {
      a = new Audio(); a.loop = true; a.preload = 'auto'; a.volume = 0; a.src = MSRC[name];
      a.addEventListener('error', () => { if (a._blob) return; a._blob = true; fetch(MSRC[name]).then((r) => r.blob()).then((bl) => { a.src = URL.createObjectURL(bl); if (MUS.cur === name) a.play().catch(() => {}); }).catch(() => {}); });
      MUS.els[name] = a;
    }
    return a;
  }
  function fadeTo(a, target, ms, done) {
    clearInterval(a._fade); const start = a.volume, t0 = Date.now();
    a._fade = setInterval(() => { const k = Math.min(1, (Date.now() - t0) / ms); try { a.volume = Math.max(0, Math.min(1, start + (target - start) * k)); } catch (e) { /* iOS */ } if (k >= 1) { clearInterval(a._fade); if (done) done(); } }, 50);
  }
  function wantTheme() {
    const g = S.game;
    if (S.gid && g && g.status === 'play' && g.state && !S.explore && !S.tutorial) return g.state.season === 'S' ? 'spring' : 'fall';
    return 'menu';
  }
  function musSync() {
    if (!MUS.unlocked) return;
    const want = MUS.on ? wantTheme() : null;
    if (want === MUS.cur) return;
    if (MUS.cur) { const old = musEl(MUS.cur); fadeTo(old, 0, 1800, () => old.pause()); }
    MUS.cur = want;
    if (want) { const a = musEl(want); const p = a.play(); if (p && p.catch) p.catch(() => { MUS.unlocked = false; MUS.cur = null; }); fadeTo(a, MUS.vol, 2500); }
  }
  function musUnlock() { if (MUS.unlocked || !MUS.on) return; MUS.unlocked = true; musSync(); }
  function musToggle() {
    MUS.on = !MUS.on; lsSet('velmoci-music', MUS.on);
    if (MUS.on) { MUS.unlocked = true; } musSync();
    document.querySelectorAll('[data-act="music"]').forEach((b) => { b.setAttribute('aria-pressed', MUS.on ? 'true' : 'false'); b.classList.toggle('off', !MUS.on); b.title = MUS.on ? 'Vypnout hudbu' : 'Zapnout hudbu'; });
  }
  const musBtn = (cls) => `<button class="musbtn ${cls || ''}${MUS.on ? '' : ' off'}" data-act="music" aria-pressed="${MUS.on ? 'true' : 'false'}" title="${MUS.on ? 'Vypnout hudbu' : 'Zapnout hudbu'}"><span class="mi" aria-hidden="true">♪</span><span class="ml">Hudba</span></button>`;
  ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, musUnlock, { capture: true }));

  // ------------------------------------------------------------------ replay of resolution (animated, step by step)
  const RP_SPEED = { slow: 3600, normal: 2100, fast: 1100 };
  const RP_SPEED_L = { slow: 'Pomalu', normal: 'Normálně', fast: 'Rychle' };
  const rpUnitPos = (u) => posOf(u.p, u.c);
  function rpBuild(i) {
    const r = S.history[i]; if (!r) return null;
    const units = (r.units || []).map((u, id) => Object.assign({ id }, u));
    const at = (p) => units.find((u) => u.p === p);
    const res = r.results || {};
    const ords = (r.orders || []).map((o) => Object.assign({}, o));
    const ordOf = (p) => ords.find((o) => o.p === p && o.k !== 'B') || { p, k: 'H' };
    const nextSc = (S.history[i + 1] && S.history[i + 1].sc) || (S.game && S.game.state && S.game.state.sc) || r.sc || {};
    const kind = r.key.slice(-1);
    const D = { i, r, units, kind, events: [], scFrom: r.sc || {}, scTo: nextSc };
    if (kind === 'M') {
      const okRes = (p) => String(res[p] || '').split(' ')[0] === 'ok';
      const sup = (pred) => ords.filter((s) => s.k === 'S' && pred(s));
      const byTo = {};
      for (const o of ords) if (o.k === 'M') (byTo[o.to] = byTo[o.to] || []).push(o);
      for (const p of Object.keys(byTo)) {
        const moves = byTo[p].map((o) => {
          const u = at(o.p); const r0 = String(res[o.p] || '').split(' ')[0];
          const sups = sup((s) => s.sp === o.p && s.st === o.to);
          const att = r0 === 'noconvoy' || r0 === 'invalid' ? 0 : 1 + sups.filter((s) => okRes(s.p)).length;
          return { o, u, ok: r0 === 'ok', r0, att, sups };
        });
        const occ = at(p);
        let def = null, occMoved = false, occO = null, holdSups = [];
        if (occ) {
          occO = ordOf(occ.p);
          if (occO.k === 'M' && okRes(occ.p)) occMoved = true;
          else if (occO.k === 'M') def = 1;
          else { holdSups = sup((s) => s.sp === occ.p && !s.st); def = 1 + holdSups.filter((s) => okRes(s.p)).length; }
        }
        const disl = occ && String(res[occ.p] || '').includes('dislodged') ? occ : null;
        const cut = moves.flatMap((m) => m.sups).concat(holdSups).filter((s) => res[s.p] === 'cut');
        D.events.push({ p, moves, occ, occO, def, occMoved, disl, cut, holdSups });
      }
      D.events.sort((a, b) => ctrOf(a.p, null)[0] - ctrOf(b.p, null)[0]);
      const easy = D.events.filter((e) => e.moves.length === 1 && e.moves[0].ok && !e.occ && !e.moves[0].sups.length);
      if (easy.length) {
        D.events = D.events.filter((e) => !easy.includes(e));
        D.events.unshift({ group: true, p: null, moves: easy.map((e) => e.moves[0]), occ: null, def: null, occMoved: false, disl: null, cut: [], holdSups: [] });
      }
    } else if (kind === 'R') {
      D.events.push({ p: null, retreats: ords });
    } else {
      D.events.push({ p: null, adjust: ords });
    }
    D.steps = kind === 'M' ? D.events.length + 2 : 2;
    return D;
  }
  function rpPowerName(p) { return E.PNAME[p] || p; }
  function rpCaption(D, step) {
    const r = D.r;
    if (D.kind === 'M') {
      if (step === 0) return `<b>Rozkazy všech velmocí</b> jsou odkryté. Šipky ukazují tahy, tečkované čáry podpory. Teď se postupně vyhodnotí každý střet${D.events.length ? ` (${D.events.length})` : ''}.`;
      if (step === D.steps - 1) {
        const lost = []; const fall = r.key.slice(-2, -1) === 'F';
        if (fall) for (const p of E.SC) { const a = D.scFrom[p] || null, b = D.scTo[p] || null; if (a !== b && b) lost.push(`${NAMES[p]} → ${rpPowerName(b)}`); }
        const disl = D.events.filter((e) => e.disl).map((e) => `${rpPowerName(e.disl.o)} v ${NAMES[e.disl.p]}`);
        return `<b>Konec vyhodnocení.</b> ${disl.length ? `Vytlačeny: ${esc(disl.join(', '))}. ` : 'Nikdo nebyl vytlačen. '}${fall ? (lost.length ? `Centra změnila majitele: ${esc(lost.join(', '))}.` : 'Žádné centrum nezměnilo majitele.') : 'Centra se počítají až po podzimu.'}`;
      }
      const e = D.events[step - 1];
      if (e.group) return `<span class="rpwhere">Volné postupy</span> bez boje, nikdo jim nestál v cestě:<br>${e.moves.map((m) => `<span class="rpmv">${esc(E.PSHORT[m.u.o])} ${esc(NAMES[m.o.p])} → ${esc(NAMES[m.o.to])}</span>`).join(' ')}`;
      const mv = e.moves.map((m) => `<span class="rpmv">${esc(rpPowerName(m.u ? m.u.o : m.o.o))}: ${esc(NAMES[m.o.p])} → <span class="sp">síla ${m.att}</span></span>${m.sups.length ? ` <span class="muted">podpora: ${m.sups.map((sx) => esc(NAMES[sx.p]) + (D.r.results && D.r.results[sx.p] === 'cut' ? ' (přerušena)' : '')).join(', ')}</span>` : ''}`).join(' <b>proti</b> ');
      let defT = '';
      if (e.occ) defT = e.occMoved ? ` · ${esc(rpPowerName(e.occ.o))} pole včas opustilo` : ` · brání ${esc(rpPowerName(e.occ.o))} <span class="sp">síla ${e.def}</span>`;
      const win = e.moves.find((m) => m.ok);
      let out;
      if (win) out = `<b class="okc">Postup: ${esc(rpPowerName(win.u.o))} obsazuje pole.</b>${e.disl ? ` <b class="badc">${esc(rpPowerName(e.disl.o))} je vytlačeno a musí ustoupit.</b>` : ''}`;
      else if (e.moves.some((m) => m.r0 === 'noconvoy')) out = `<b class="badc">Konvoj selhal, armáda zůstává na místě.</b>`;
      else if (e.moves.length > 1 && !e.occ) out = `<b class="badc">Odraz: síly jsou vyrovnané, nevstoupí nikdo.</b>`;
      else out = `<b class="badc">Útok odražen, obrana vydržela.</b>`;
      const cut = e.cut.length ? ` <span class="muted">Přerušená podpora: ${e.cut.map((sx) => esc(NAMES[sx.p])).join(', ')}.</span>` : '';
      return `<span class="rpwhere">${esc(NAMES[e.p])}</span> ${mv}${defT}<br>→ ${out}${cut}`;
    }
    if (D.kind === 'R') {
      if (step === 0) return `<b>Ústupy.</b> Vytlačené jednotky ustupují, nebo zanikají.`;
      return D.events[0].retreats.map((o) => { const rr = o.res || ''; return `${esc(rpPowerName(o.o))}: ${o.t === 'A' ? 'armáda' : 'loďstvo'} z ${esc(NAMES[o.p])} ${rr.startsWith('retreat') ? 'ustoupila do ' + esc(NAMES[rr.split(':')[1].split('/')[0]]) : 'zaniká'}`; }).join('<br>') || 'Nic se nestalo.';
    }
    if (step === 0) return `<b>Zima.</b> Velmoci staví nové jednotky, nebo rozpouštějí přebytečné.`;
    return D.events[0].adjust.map((o) => `${esc(rpPowerName(o.pw))}: ${o.k === 'B' ? 'postavena ' + (o.t === 'A' ? 'armáda' : 'loďstvo') + ' v ' + esc(NAMES[o.p]) : 'rozpuštěna jednotka v ' + esc(NAMES[o.p]) + (o.auto ? ' (automaticky)' : '')}`).join('<br>') || 'Žádné změny.';
  }
  // unit placement + classes at a step
  function rpState(D, step) {
    const pos = {}; const cls = {};
    for (const u of D.units) { pos[u.id] = rpUnitPos(u); cls[u.id] = []; }
    if (D.kind === 'M') {
      const upto = Math.min(step, D.events.length);
      for (let k = 0; k < upto; k++) {
        const e = D.events[k];
        for (const m of e.moves) if (m.ok && m.u) pos[m.u.id] = posOf(m.o.to, m.o.tc || null);
        if (e.disl) { pos[e.disl.id] = dislodgedPos(e.disl); cls[e.disl.id].push('disl'); }
      }
    } else if (D.kind === 'R' && step >= 1) {
      for (const o of D.events[0].retreats) {
        const u = D.units.find((x) => x.p === o.p && x.o === o.o) || null;
        if (!u) continue; const rr = o.res || '';
        if (rr.startsWith('retreat')) { const [p, c] = rr.split(':')[1].split('/'); pos[u.id] = posOf(p, c || null); } else cls[u.id].push('gone');
      }
    } else if (D.kind === 'A' && step >= 1) {
      for (const o of D.events[0].adjust) if (o.k === 'X') { const u = D.units.find((x) => x.p === o.p); if (u) cls[u.id].push('gone'); }
    }
    return { pos, cls };
  }
  function rpSVG() {
    const D = S.rp.data; if (!D) return '';
    let s = `<svg id="mapsvg" class="rpsvg" viewBox="0 0 2500 1770" xmlns="http://www.w3.org/2000/svg"><defs>${PW.map((p) => `<marker id="ah-${p}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse"><path class="ahp pw-${p}" d="M0 0 L10 5 L0 10 z"/></marker>`).join('')}</defs>`;
    s += `<g id="rpsc">`;
    for (const p of E.SC) { const q = POS.sc[p]; if (!q) continue; const own = D.scFrom[p]; s += `<circle class="scring${own ? ' pw-' + own : ' none'}" data-sc="${p}" cx="${q[0]}" cy="${q[1]}" r="17"/>`; }
    s += `</g><g id="rparrows">`;
    if (D.kind === 'M') {
      D.events.forEach((e, k) => {
        for (const m of e.moves) {
          if (!m.u) continue; const [x1, y1] = rpUnitPos(m.u); const [x2, y2] = posOf(m.o.to, m.o.tc || null);
          s += `<g class="rpa" data-ev="${k}" data-ok="${m.ok ? 1 : 0}">${arrow(x1, y1, x2, y2, `ord mv pw-${m.u.o}`).replace(/\/>$/, ` marker-end="url(#ah-${m.u.o})"/>`)}</g>`;
          for (const sp of m.sups) { const su = D.units.find((u) => u.p === sp.p); if (!su) continue; const [sx, sy] = rpUnitPos(su); const mx = x1 + (x2 - x1) * 0.6, my = y1 + (y2 - y1) * 0.6; s += `<g class="rpa sup${D.r.results[sp.p] === 'cut' ? ' cut' : ''}" data-ev="${k}">${arrow(sx, sy, mx, my, `ord sp pw-${su.o}`, 4)}<circle class="spdot pw-${su.o}" cx="${mx}" cy="${my}" r="6"/></g>`; }
        }
        for (const sp of e.holdSups) { const su = D.units.find((u) => u.p === sp.p); if (!su || !e.occ) continue; const [sx, sy] = rpUnitPos(su); const [tx, ty] = rpUnitPos(e.occ); s += `<g class="rpa sup${D.r.results[sp.p] === 'cut' ? ' cut' : ''}" data-ev="${k}">${arrow(sx, sy, tx, ty, `ord sp pw-${su.o}`, 30)}</g>`; }
      });
    } else if (D.kind === 'R') {
      for (const o of D.events[0].retreats) { const rr = o.res || ''; if (!rr.startsWith('retreat')) continue; const u = D.units.find((x) => x.p === o.p); if (!u) continue; const [x1, y1] = rpUnitPos(u); const [p, c] = rr.split(':')[1].split('/'); const [x2, y2] = posOf(p, c || null); s += `<g class="rpa" data-ev="0">${arrow(x1, y1, x2, y2, `ord mv pw-${u.o}`).replace(/\/>$/, ` marker-end="url(#ah-${u.o})"/>`)}</g>`; }
    }
    s += `</g><g id="rpunits">`;
    for (const u of D.units) { const [x, y] = rpUnitPos(u); s += `<g class="tok rpu pw-${u.o}" id="rpu-${u.id}" data-unit="${u.p}" style="transform: translate(${x}px, ${y}px) scale(1.32)"><rect x="-21" y="-21" width="42" height="42" rx="6" class="tok-bg"/><rect x="-17" y="-17" width="34" height="34" rx="4" class="tok-in"/>${ICON[u.t]}</g>`; }
    if (D.kind === 'A') for (const o of D.events[0].adjust) if (o.k === 'B') { const [x, y] = posOf(o.p, o.c || null); s += `<g class="tok rpu rpnew pw-${o.pw}" id="rpb-${o.p}" style="transform: translate(${x}px, ${y}px) scale(1.32)"><rect x="-21" y="-21" width="42" height="42" rx="6" class="tok-bg"/><rect x="-17" y="-17" width="34" height="34" rx="4" class="tok-in"/>${ICON[o.t]}</g>`; }
    s += `</g><g id="rpfx"></g></svg>`;
    return s;
  }
  const tf = (p) => `translate(${p[0]}px, ${p[1]}px) scale(1.32)`;
  function rpApply(anim) {
    const R = S.rp; if (!R || !R.data) return; const D = R.data; const step = R.step;
    const svg = $('#mapsvg'); if (!svg || !svg.classList.contains('rpsvg')) return;
    const dur = Math.round(RP_SPEED[R.speed] * 0.42);
    const prev = R.applied != null ? rpState(D, R.applied) : null;
    const now = rpState(D, step);
    const cur = D.kind === 'M' && step >= 1 && step <= D.events.length ? D.events[step - 1] : null;
    for (const u of D.units) {
      const el = $('#rpu-' + u.id); if (!el) continue;
      const to = now.pos[u.id];
      el.setAttribute('class', ['tok', 'rpu', 'pw-' + u.o].concat(now.cls[u.id]).join(' '));
      const from = prev ? prev.pos[u.id] : to;
      el.style.transform = tf(to);
      if (anim && (from[0] !== to[0] || from[1] !== to[1])) {
        const isDisl = now.cls[u.id].includes('disl') && !(prev && prev.cls[u.id].includes('disl'));
        const frames = isDisl ? [{ transform: tf(from) }, { transform: tf([from[0] - 8, from[1]]), offset: 0.15 }, { transform: tf([from[0] + 8, from[1]]), offset: 0.3 }, { transform: tf([from[0] - 6, from[1]]), offset: 0.45 }, { transform: tf(to) }] : [{ transform: tf(from) }, { transform: tf(to) }];
        try { el.animate(frames, { duration: isDisl ? dur * 1.4 : dur, easing: 'cubic-bezier(.45,.05,.3,1)', delay: isDisl ? dur * 0.55 : 0 }); } catch (e) { /* ignore */ }
      }
      // bounce bump for failed movers in the current event
      if (anim && cur && R.applied === step - 1) {
        const m = cur.moves.find((mm) => mm.u && mm.u.id === u.id && !mm.ok);
        if (m) { const a = to, b = posOf(m.o.to, m.o.tc || null); const mid = [a[0] + (b[0] - a[0]) * 0.32, a[1] + (b[1] - a[1]) * 0.32]; try { el.animate([{ transform: tf(a) }, { transform: tf(mid), offset: 0.45 }, { transform: tf(a) }], { duration: dur, easing: 'ease-in-out' }); } catch (e) { /* ignore */ } }
      }
    }
    // new builds / sc rings
    document.querySelectorAll('.rpnew').forEach((el) => el.classList.toggle('shown', step >= 1));
    const finalStep = step === D.steps - 1;
    document.querySelectorAll('#rpsc [data-sc]').forEach((c) => { const p = c.getAttribute('data-sc'); const own = finalStep ? D.scTo[p] : D.scFrom[p]; const changed = finalStep && (D.scFrom[p] || null) !== (D.scTo[p] || null); c.setAttribute('class', 'scring' + (own ? ' pw-' + own : ' none') + (changed ? ' flip' : '')); });
    // arrows
    document.querySelectorAll('#rparrows .rpa').forEach((g) => {
      const k = +g.getAttribute('data-ev');
      let c = 'rpa' + (g.classList.contains('sup') ? ' sup' : '') + (g.classList.contains('cut') ? ' cut' : '');
      if (D.kind === 'M') { if (cur && k === step - 1) c += ' cur'; else if (step >= 1 && k < step - 1) c += ' done' + (g.getAttribute('data-ok') === '0' ? ' failed' : ''); else if (step >= 1 && !finalStep) c += ' wait'; else if (finalStep) c += ' done' + (g.getAttribute('data-ok') === '0' ? ' failed' : ''); }
      else c += step >= 1 ? ' cur' : '';
      g.setAttribute('class', c);
    });
    // fx: focus ring, strength badges, stamp
    const fx = $('#rpfx'); let h = '';
    if (cur && !cur.group) {
      const [cx, cy] = ctrOf(cur.p, null);
      h += `<circle class="rpfocus" cx="${cx}" cy="${cy}" r="70"/>`;
      for (const m of cur.moves) { if (!m.u) continue; const [x1, y1] = rpUnitPos(m.u); const [x2, y2] = posOf(m.o.to, m.o.tc || null); const bx = x1 + (x2 - x1) * 0.42, by = y1 + (y2 - y1) * 0.42; h += `<g transform="translate(${bx},${by})"><g class="rpbadge pw-${m.u.o}"><circle r="21"/><text y="8">${m.att}</text></g></g>`; }
      if (cur.occ && !cur.occMoved) { const [x, y] = rpUnitPos(cur.occ); h += `<g transform="translate(${x + 30},${y - 34})"><g class="rpbadge def pw-${cur.occ.o}"><rect x="-20" y="-20" width="40" height="40" rx="6"/><text y="8">${cur.def}</text></g></g>`; }
      const win = cur.moves.find((m) => m.ok);
      h += `<g transform="translate(${cx},${cy - 86})"><g class="rpstamp ${win ? 'ok' : 'bad'}"><rect x="-92" y="-24" width="184" height="44" rx="4"/><text y="9">${win ? (cur.disl ? 'PROLOMENO' : 'POSTUP') : 'ODRAŽENO'}</text></g></g>`;
    }
    fx.innerHTML = h;
    // caption + controls state
    const cap = $('#rpcap'); if (cap) cap.innerHTML = rpCaption(D, step);
    const pr = $('#rpprog'); if (pr) pr.innerHTML = Array.from({ length: D.steps }, (_, k) => `<button class="rpdot${k === step ? ' on' : k < step ? ' done' : ''}" data-act="rp-go" data-s="${k}" aria-label="Krok ${k + 1}"></button>`).join('');
    const pp = $('#rpplay'); if (pp) { pp.textContent = R.playing ? '❚❚' : '▶'; pp.setAttribute('aria-label', R.playing ? 'Pozastavit' : 'Přehrát'); }
    const st = $('#rpstep'); if (st) st.textContent = `${step + 1} / ${D.steps}`;
    pr && pr.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', onAct));
    // camera
    if (anim && cur && !cur.group) { const w = $('#mapwrap'); if (w && S.zoom > 1) { const [cx, cy] = ctrOf(cur.p, null); w.scrollTo({ left: cx / 2500 * w.scrollWidth - w.clientWidth / 2, top: cy / 1770 * w.scrollHeight - w.clientHeight / 2, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } }
    R.applied = step;
  }
  function rpBar() {
    const R = S.rp; const D = R.data;
    return `<div class="rpbar" role="region" aria-label="Přehrávání vyhodnocení">
      <div class="rphead"><span class="rptitle">${esc(D.r.name)}</span><span class="rpstep" id="rpstep"></span><span class="grow"></span>
        <div class="seg sm" role="group" aria-label="Rychlost">${Object.keys(RP_SPEED).map((k) => `<button class="btn xs${R.speed === k ? ' on' : ''}" data-act="rp-speed" data-s="${k}">${RP_SPEED_L[k]}</button>`).join('')}</div>
        <button class="btn sm primary" data-act="rp-close" title="Přeskočit přehrávání (Esc)">Přeskočit ⏭</button></div>
      <div class="rpcap" id="rpcap" aria-live="polite"></div>
      <div class="rpctl">
        <button class="btn sm icon" data-act="rp-prevrec" title="Předchozí fáze" ${R.i <= 0 ? 'disabled' : ''}>⏮</button>
        <button class="btn sm icon" data-act="rp-prev" title="Krok zpět (←)">◀</button>
        <button class="btn sm icon primary" id="rpplay" data-act="rp-play" title="Přehrát / pozastavit (mezerník)">▶</button>
        <button class="btn sm icon" data-act="rp-next" title="Krok vpřed (→)">▶▏</button>
        <button class="btn sm icon" data-act="rp-nextrec" title="Další fáze" ${R.i >= S.history.length - 1 ? 'disabled' : ''}>⏭</button>
        <div class="rpprog" id="rpprog"></div>
      </div>
    </div>`;
  }
  function rpOpen(i, play) {
    if (!S.history[i]) return;
    if (!S.rp) S.rpZoom = S.zoom;
    clearTimeout(S.rpT);
    S.rp = { i, step: 0, playing: !!play, speed: lsGet('velmoci-rpspeed', 'normal'), data: rpBuild(i), applied: null };
    S.sel = null; S.view = null;
    if (S.zoom < 1.5 && !mobile()) S.zoom = 1.6;
    render(); rpSchedule();
  }
  function rpClose() { clearTimeout(S.rpT); S.rp = null; if (S.rpZoom != null) { S.zoom = S.rpZoom; S.rpZoom = null; } render(); }
  function rpGo(step, anim) { const R = S.rp; if (!R) return; R.step = Math.max(0, Math.min(R.data.steps - 1, step)); rpApply(anim); }
  function rpSchedule() {
    clearTimeout(S.rpT); const R = S.rp; if (!R || !R.playing) { rpApply(false); return; }
    S.rpT = setTimeout(() => {
      if (!S.rp || !S.rp.playing) return;
      if (S.rp.step >= S.rp.data.steps - 1) { S.rp.playing = false; rpApply(false); return; }
      rpGo(S.rp.step + 1, true); rpSchedule();
    }, S.rp.step === 0 ? Math.max(1400, RP_SPEED[R.speed] * 0.8) : RP_SPEED[R.speed]);
  }

  // ------------------------------------------------------------------ tutorial
  const U = (s) => s.split(',').map((x) => { const [o, t, pc] = x.trim().split(' '); const [p, c] = pc.split('/'); return { o, t: t === 'L' ? 'F' : t, p, c: c || null }; });
  const OPENINGS = {
    ANG: { o: [['LON', 'NTH'], ['EDI', 'NWG'], ['LVP', 'YOR']], t: 'Severní zahájení: loďstva do Severního a Norského moře míří na Norsko, armáda jde do Yorkshiru, odkud ji loďstvo může konvojovat na kontinent. Anglie je ostrov, takže potřebuje hodně loďstev.' },
    FRA: { o: [['BRE', 'MAO'], ['PAR', 'BUR'], ['MAR', 'SPA']], t: 'Klasika: loďstvo do Atlantiku míří na Portugalsko, armáda z Marseille na Španělsko a Paříž hlídá Burgundsko proti Německu. Na podzim bereš dvě iberská centra.' },
    NEM: { o: [['KIE', 'DEN'], ['BER', 'KIE'], ['MUN', 'RUH']], t: 'Loďstvo jde do Dánska, armáda z Berlína kryje Kiel, Mnichov míří do Porúří a na podzim do Holandska nebo Belgie. Německo má nejvíc sousedů, takže diplomacie je tu nejdůležitější.' },
    ITA: { o: [['NAP', 'ION'], ['ROM', 'APU'], ['VEN', 'VEN']], t: 'Příprava „Lepanta“: loďstvo do Iónského moře a armáda do Apulie. Na podzim ji loďstvo může konvojovat do Tuniska, nebo s Rakouskem zaútočíte na Turecko.' },
    RAK: { o: [['TRI', 'ALB'], ['VIE', 'GAL'], ['BUD', 'SER']], t: 'Balkánské zahájení: Budapešť bere Srbsko, Terst se přes Albánii dívá na Řecko a Vídeň v Haliči brzdí Rusko. Rakousko je uprostřed, potřebuje aspoň jednoho spolehlivého spojence.' },
    RUS: { o: [['STP', 'BOT'], ['MOS', 'UKR'], ['WAR', 'GAL'], ['SEV', 'BLA']], t: 'Jižní tlak: Sevastopol do Černého moře, Moskva na Ukrajinu, Varšava do Haliče a loďstvo z Petrohradu do Botnického zálivu míří na Švédsko. Rusko má čtyři jednotky, ale velmi dlouhé hranice.' },
    TUR: { o: [['ANK', 'BLA'], ['CON', 'BUL'], ['SMY', 'CON']], t: 'Standard: Cařihrad bere Bulharsko, Smyrna jde do Cařihradu a Ankara do Černého moře. Turecko v rohu mapy se těžko porazí, ale pomalu roste.' },
  };
  const TUT = [
    { t: 'Cíl hry', start: true,
      h: `<p>Sedm velmocí bojuje o Evropu roku 1901. Na mapě je <b>34 zásobovacích center</b> (kroužky s tečkou). Kdo jich po podzimu ovládá <b>18</b>, vyhrál.</p>
          <p>Každý rok má <b>jaro a podzim</b>. V každém kole se nejdřív vyjednává, pak všichni <b>tajně</b> zadají rozkazy a ty se vyhodnotí <b>naráz</b>. Nehází se kostkou. Rozhoduje plán a hlavně to, s kým se domluvíš.</p>
          <p>Barevné kroužky ukazují, komu centrum patří. 12 center je na začátku neutrálních. Kdo je obsadí první, roste.</p>` },
    { t: 'Armáda a loďstvo', units: U('FRA A PAR, FRA L BRE'), moves: ['PAR', 'BRE'],
      h: `<p><b>Armáda</b> (dělo) chodí po souši: do sousedního vnitrozemí nebo pobřeží. Na moře nesmí.</p>
          <p><b>Loďstvo</b> (loď) pluje po mořích a podél pobřeží. Do vnitrozemí nesmí. Mezi dvěma pobřežími smí jen tehdy, když je omývá stejné moře.</p>
          <p>Šipky ukazují, kam smí armáda z Paříže a loďstvo z Brestu. Všechny jednotky jsou stejně silné a v jednom poli smí stát jen jedna.</p>
          <p class="muted small">Pro libovolné pole si to ověříš v <b>Průvodci tahy</b> (klávesa G).</p>` },
    { t: 'Tvůj první tah', units: U('FRA A PAR, FRA A MAR, FRA L BRE'), me: 'FRA',
      task: { kind: 'M', unit: 'PAR', to: 'BUR', say: 'Klikni na armádu v <b>Paříži</b> a pak na <b>Burgundsko</b> (BUR).' },
      h: `<p>Tah zadáš kliknutím na svou jednotku a pak na cíl. Zvýrazní se jen pole, kam jednotka smí. Druhé kliknutí na jednotku znamená <b>drž</b>, tedy zůstaň a braň se.</p>`,
      after: 'Burgundsko bylo prázdné a nikdo jiný tam netáhl, takže armáda postoupila. Jednotka bez rozkazu automaticky drží.' },
    { t: 'Odraz', units: U('FRA A PAR, NEM A MUN'), orders: [{ o: 'FRA', p: 'PAR', k: 'M', to: 'BUR' }, { o: 'NEM', p: 'MUN', k: 'M', to: 'BUR' }],
      h: `<p>Francie i Německo táhnou do Burgundska. Obě armády mají sílu 1. <b>Při rovnosti nepostoupí nikdo</b> a obě zůstanou doma.</p>
          <p>Tomu se říká <i>odraz</i>. Hodí se i schválně: když nechceš, aby soused obsadil pole, pošli tam taky jednotku a zablokuješ ho, aniž bys pole sám obsadil.</p>`,
      after: 'Obě armády se odrazily. Burgundsko zůstalo prázdné.' },
    { t: 'Podpora', units: U('FRA A PAR, FRA A MAR, NEM A BUR'), me: 'FRA', orders: [{ o: 'FRA', p: 'PAR', k: 'M', to: 'BUR' }],
      task: { kind: 'S', unit: 'MAR', sp: 'PAR', st: 'BUR', say: 'Klikni na armádu v <b>Marseille</b>, pak na armádu v <b>Paříži</b> a nakonec na <b>Burgundsko</b>.' },
      h: `<p>Sám na obsazené pole neprorazíš: útok 1 proti obraně 1 se odrazí. Proto existuje <b>podpora</b>: jiná jednotka nikam netáhne a přidá svou sílu +1.</p>
          <p>Podporovat smíš jen do pole, kam bys sám mohl táhnout. Podpora musí přesně odpovídat rozkazu podporované jednotky. Podpořit můžeš i <b>cizí</b> jednotku, na tom stojí spojenectví.</p>`,
      after: 'Útok 2 proti obraně 1: německá armáda je <b>vytlačena</b> a musí ustoupit (červeně orámovaná). Francie Burgundsko obsadila.' },
    { t: 'Přerušení podpory', units: U('FRA A PAR, FRA A MAR, NEM A BUR, ITA A PIE'), me: 'ITA',
      orders: [{ o: 'FRA', p: 'PAR', k: 'M', to: 'BUR' }, { o: 'FRA', p: 'MAR', k: 'S', sp: 'PAR', st: 'BUR' }],
      task: { kind: 'M', unit: 'PIE', to: 'MAR', say: 'Hraješ za Itálii, spojence Německa. Klikni na armádu v <b>Piemontu</b> a zaútoč na <b>Marseille</b>.' },
      h: `<p>Podpora padá, když na podporující jednotku <b>kdokoli zaútočí</b>, i když útok sám neuspěje. Neplatí to jen pro útok z pole, kam podpora míří.</p>
          <p>Je to nejčastější obranný trik: nemusíš vyhrát bitvu, stačí „zaťukat“ na podporovatele.</p>`,
      after: 'Italský útok na Marseille neuspěl, ale přerušil francouzskou podporu. Útok na Burgundsko měl tak jen sílu 1 a Německo se ubránilo.' },
    { t: 'Podpora držení', units: U('FRA A PAR, FRA A MAR, NEM A BUR, NEM A MUN'), me: 'NEM',
      orders: [{ o: 'FRA', p: 'PAR', k: 'M', to: 'BUR' }, { o: 'FRA', p: 'MAR', k: 'S', sp: 'PAR', st: 'BUR' }],
      task: { kind: 'S', unit: 'MUN', sp: 'BUR', st: null, say: 'Klikni na armádu v <b>Mnichově</b>, pak na armádu v <b>Burgundsku</b> a znovu na <b>Burgundsko</b> (tím ji podpoříš v držení).' },
      h: `<p>Podporovat jde i <b>obranu</b>. Jednotka, která drží, dostane +1 za každou podporu držení.</p>
          <p>Útok musí být <b>silnější</b> než obrana. Při rovnosti obránce vždy drží.</p>`,
      after: 'Útok 2 proti obraně 2: obránce drží. Pozor: jednotka s rozkazem k tahu nemůže dostat podporu držení, ani když její tah selže.' },
    { t: 'Konvoj', units: U('ANG A LON, ANG L NTH'), me: 'ANG',
      task: { kind: 'M', unit: 'LON', to: 'BEL', vc: true, say: 'Klikni na armádu v <b>Londýně</b> a vyber <b>modrý</b> kroužek v <b>Belgii</b> (cesta po moři).' },
      h: `<p>Armáda se dostane přes moře jen <b>konvojem</b>. Loďstvo stojící na moři ji převeze z pobřeží na pobřeží, i přes víc moří za sebou, když v každém stojí konvojující loďstvo.</p>
          <p>V aplikaci stačí vybrat modrý cíl. Tvá loďstva na cestě dostanou rozkaz „K“ automaticky. Když je některé loďstvo v řetězu vytlačeno, konvoj selže.</p>`,
      after: 'Loďstvo v Severním moři převezlo armádu do Belgie. Takhle se Anglie dostává na kontinent.' },
    { t: 'Ústup', units: U('FRA A PAR, FRA A MAR, NEM A BUR, NEM A MUN'), orders: [{ o: 'FRA', p: 'PAR', k: 'M', to: 'BUR' }, { o: 'FRA', p: 'MAR', k: 'S', sp: 'PAR', st: 'BUR' }], showRetreat: true,
      h: `<p>Vytlačená jednotka musí <b>ustoupit</b> do volného sousedního pole. Nesmí do pole, odkud přišel útočník, ani do pole, kde v tom kole došlo k odrazu. Když nemá kam, nebo nezadáš rozkaz, <b>zanikne</b>.</p>
          <p>Klikni na <b>Vyhodnotit</b>. Kroužky pak ukážou, kam může vytlačená německá armáda ustoupit.</p>`,
      after: 'Německá armáda může ustoupit do Belgie, Gaskoňska, Pikardie nebo Porúří. Ne do Paříže, odkud přišel útok, a ne do Mnichova a Marseille, kde už někdo stojí.' },
    { t: 'Zima: centra a stavby', units: U('FRA A BEL, FRA L MAO, FRA A BUR'), sc: { BRE: 'FRA', MAR: 'FRA', PAR: 'FRA', BEL: 'FRA', SPA: 'FRA' }, builds: ['BRE', 'MAR', 'PAR'],
      h: `<p>Po každém <b>podzimu</b> se centra přepočítají: patří tomu, čí jednotka v nich stojí. Jarní průchod centrem nestačí, na podzim tam musíš <b>stát</b>.</p>
          <p>V zimě porovnáš centra s jednotkami. Francie má 5 center a 3 jednotky, takže <b>postaví 2 nové</b>. Stavět smíš jen ve <b>vlastních domovských centrech, která jsou prázdná</b> (zakroužkovaná).</p>
          <p>Když máš míň center než jednotek, musíš jednotky <b>rozpustit</b>. Proto si hlídej domovská centra: obsazené ti brání stavět.</p>` },
    { t: 'Klíčová území', places: [
        ['NTH', 'Severní moře', 'Nejdůležitější moře na mapě. Odtud vede cesta do Norska, Dánska, Holandska, Belgie i k anglickým břehům. Kdo ho drží, ovládá sever.'],
        ['ENG', 'Kanál La Manche', 'Brána mezi Anglií a Francií. Francouzské loďstvo tady přímo ohrožuje Londýn, proto se o něm Anglie s Francií obvykle domlouvají jako o neutrální zóně.'],
        ['MAO', 'Atlantický oceán – střed', 'Vstup do Středomoří a k Iberii. Odtud loďstvo dosáhne Portugalska, Španělska, Severní Afriky i západního Středomoří.'],
        ['SKA', 'Skagerrak', 'Úzký průliv mezi Norskem, Švédskem a Dánskem. Loďstvo tady může podpořit útok na kterékoli ze tří skandinávských center.'],
        ['BUR', 'Burgundsko', 'Křižovatka Francie a Německa: sousedí s Paříží, Marseille, Mnichovem i Belgií. Nejčastější neutrální zóna na západě.'],
        ['GAL', 'Halič', 'Rakousko proti Rusku. Armáda tady ohrožuje Vídeň, Budapešť, Varšavu i Rumunsko. Klasická neutrální zóna na východě.'],
        ['TYR', 'Tyrolsko', 'Spojnice Itálie, Rakouska a Německa. Italská armáda v Tyrolsku je pro Rakousko jasné varování.'],
        ['SER', 'Srbsko', 'Srdce Balkánu a neutrální centrum. Sousedí se šesti poli, Rakousko si ho obvykle bere jako první.'],
        ['BLA', 'Černé moře', 'Rusko proti Turecku. Sousedí s Ankarou, Sevastopolem, Rumunskem, Bulharskem i Cařihradem. Na jaře 1901 ho obě strany často zablokují odrazem.'],
        ['CON', 'Cařihrad', 'Průplav mezi Černým a Egejským mořem. Kdo ho obsadí, odřízne turecké loďstvo od Středomoří.'],
        ['ION', 'Iónské moře', 'Centrum Středomoří se sousedy na všech stranách: Itálie, Řecko, Tunisko i východ. Kdo ho drží, rozhoduje o jihu.'],
        ['DEN', 'Dánsko a Kiel', 'Průplavy mezi Baltským a Severním mořem. Loďstvo jimi proplouvá z jednoho moře do druhého, armády tudy chodí normálně.'],
      ],
      h: `<p>Některá pole jsou důležitější než jiná: hodně sousedů, průliv, nebo hranice dvou velmocí. Kdo je drží, má výhodu. O kterých se nejčastěji vyjednává, ukazuje mapa.</p><p class="muted small">Klikni na číslo na mapě nebo na položku v seznamu.</p>` },
    { t: 'Kvíz: najdi na mapě', quiz: ['BLA', 'NTH', 'BUR', 'GAL', 'CON', 'SKA', 'ION', 'SER'],
      h: `<p>Ověř si, že víš, kde co je. Klikni na mapě na hledané území, stačí kliknout poblíž jeho názvu.</p>` },
    { t: 'Zahájení: první tah', openings: true,
      h: `<p>Každá velmoc má osvědčená zahájení. Vyber velmoc a podívej se na klasický první tah:</p>` },
    { t: 'Taktické triky', units: U('FRA A PAR, FRA A MAR, NEM A MUN'), orders: [{ o: 'FRA', p: 'PAR', k: 'M', to: 'BUR' }, { o: 'FRA', p: 'MAR', k: 'M', to: 'BUR' }, { o: 'NEM', p: 'MUN', k: 'M', to: 'BUR' }],
      h: `<ul class="tlist">
          <li><b>Blokace:</b> dvě vlastní jednotky do stejného pole se odrazí, ale zablokují ho i proti nepříteli (na mapě: nikdo nevstoupí do Burgundska).</li>
          <li><b>Přeruš podporu</b> místo toho, abys útočil na hlavní cíl. Často stačí jedna jednotka a celý útok soupeře padne.</li>
          <li><b>Hlídej domov na podzim.</b> Na jaře můžeš riskovat, na podzim se centra počítají.</li>
          <li><b>Neutrální zóny:</b> domluvte se, že do určitého pole (Burgundsko, Černé moře, Halič…) nikdo nevstoupí. Ušetříte jednotky na jiný front.</li>
          <li><b>Podpora cizího tahu</b> je nejsilnější diplomatická karta. Ukáže, že to se spojenectvím myslíš vážně.</li>
          <li><b>Sleduj Historii.</b> Co kdo doopravdy zadal, je vidět po každém kole. Sliby tam nejsou, jen činy.</li>
        </ul>`,
      after: 'Tři armády se odrazily a Burgundsko zůstalo prázdné. Francii stačilo zablokovat pole, nemusela ho obsadit.' },
    { t: 'Diplomacie', start: true,
      h: `<p>Sám nevyhraje nikdo. Diplomacie je jádro hry:</p>
        <ul class="tlist">
          <li><b>Mluv se všemi</b>, hlavně se sousedy. Kdo mlčí, je podezřelý a snadný cíl.</li>
          <li><b>Nic není závazné.</b> Slib, lež i zrada jsou povolené. Zradit se vyplatí hlavně tehdy, když ti to vynese centrum <i>na podzim</i> a soused se nestihne pomstít.</li>
          <li><b>Klasická spojenectví:</b> Anglie + Francie proti Německu, Rakousko + Itálie proti Turecku („Lepanto“), Rusko + Turecko („Juggernaut“), Německo + Rakousko proti Rusku.</li>
          <li><b>Nenech nikoho přerůst.</b> Kdo má 12+ center, toho začnou ostatní spojenecky brzdit.</li>
          <li><b>Soukromé zprávy</b> jsou v záložce Jednání. Každý vidí jen to, co je určené jemu.</li>
        </ul>` },
    { t: 'Ovládání klávesnicí', units: U('FRA A PAR, FRA A MAR, FRA L BRE, NEM A MUN'), me: 'FRA', free: true,
      checklist: [
        ['n', '<kbd>N</kbd> vybere tvou další jednotku'],
        ['d', '<kbd>D</kbd> vybraná jednotka drží'],
        ['move', '<kbd>N</kbd>, pak <kbd>T</kbd> a klikni na cíl: tah'],
        ['sup', '<kbd>N</kbd>, pak <kbd>P</kbd>, klikni na podporovanou jednotku a na cíl: podpora'],
        ['esc', 'vyber jednotku a stiskni <kbd>Esc</kbd>: zrušíš výběr'],
        ['zoom', '<kbd>+</kbd> nebo <kbd>−</kbd> přiblíží / oddálí mapu'],
        ['help', '<kbd>?</kbd> ukáže všechny zkratky (zavřeš <kbd>Esc</kbd>)'],
        ['submit', '<kbd>Shift</kbd>+<kbd>Enter</kbd> odevzdá rozkazy (tady se rovnou vyhodnotí)'],
      ],
      h: `<p>S klávesnicí zadáš kolo za pár vteřin. Hraješ za Francii. Splň úkoly v seznamu, pořadí je libovolné.</p>`,
      after: 'Hotovo. Takhle zadáš rozkazy i ve skutečné hře. Kompletní přehled je kdykoli pod klávesou ?.' },
    { t: 'Jsi připraven', start: true,
      h: `<p>Shrnutí ovládání v aplikaci:</p>
        <ul class="tlist">
          <li>Klikni na jednotku → klikni na cíl. Nebo použij tlačítka „Kam:“ pod mapou.</li>
          <li><kbd>T</kbd> táhni, <kbd>D</kbd> drž, <kbd>P</kbd> podpoř, <kbd>K</kbd> konvoj, <kbd>N</kbd> další jednotka, <kbd>?</kbd> všechny zkratky.</li>
          <li>Když máš rozkazy hotové, dej <b>Odevzdat rozkazy</b>. Kolo se vyhodnotí, až odevzdají všichni, nebo vyprší čas.</li>
          <li>V zimě stavíš tlačítky Armáda / Loďstvo v panelu Rozkazy.</li>
        </ul>
        <div class="tutend"><button class="btn primary" data-act="tut-close">Založit první hru</button><button class="btn" data-act="tut-explore">Otevřít Průvodce tahy</button></div>` },
  ];

  function tutStep() { return TUT[S.tutI]; }
  function tutReset() { S.tut = { orders: [], phase: 'before', res: null, sel: null, msg: '', ok: false, op: S.tut && S.tut.op || 'FRA', done: {}, place: null, qi: 0, score: 0, miss: 0, qmsg: '', qlast: null }; }
  function tutUnits() {
    const st = tutStep();
    if (st.start || st.openings) return E.initialState().units;
    if (st.places || st.quiz) return [];
    return st.units || [];
  }
  function tutAllOrders() {
    const st = tutStep();
    if (st.openings) { const op = OPENINGS[S.tut.op]; return op.o.filter(([a, b]) => a !== b).map(([a, b]) => ({ o: S.tut.op, p: a, k: 'M', to: b, tc: null })); }
    return (st.orders || []).concat(S.tut.orders);
  }
  function tutTargets() {
    const st = tutStep(), T = S.tut; if (!T.sel || T.phase !== 'before') return [];
    const units = tutUnits(); const u = T.sel.unit;
    const fake = { units };
    if (T.sel.mode === 'move') {
      const t = E.unitNeighbors(u).map((n) => ({ p: n.p, c: n.c }));
      if (u.t === 'A' && E.isCoastal(u.p)) for (const p of convoyReach(fake, u)) if (!t.some((x) => x.p === p)) t.push({ p, c: null, vc: true });
      return t;
    }
    if (T.sel.mode === 'sup1') return units.filter((x) => x.p !== u.p).map((x) => ({ p: x.p, c: x.c, unit: true }));
    if (T.sel.mode === 'sup2') {
      const x = T.sel.other; const out = [];
      if (E.canReach(u, x.p)) out.push({ p: x.p, c: x.c, hold: true });
      for (const n of E.unitNeighbors(x)) if (n.p !== u.p && E.canReach(u, n.p) && !out.some((o) => o.p === n.p)) out.push({ p: n.p, c: null });
      return out;
    }
    return [];
  }
  function tutSVG() {
    const st = tutStep(), T = S.tut;
    let units = tutUnits();
    let s = `<svg id="tutsvg" viewBox="0 0 2500 1770" xmlns="http://www.w3.org/2000/svg"><defs>${PW.concat(['EX']).map((p) => `<marker id="ah-${p}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse"><path class="ahp pw-${p}" d="M0 0 L10 5 L0 10 z"/></marker>`).join('')}<marker id="ah-ex" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse"><path class="ahx" d="M0 0 L10 5 L0 10 z"/></marker></defs>`;
    const sc = st.sc || ((st.start || st.openings) ? E.initialState().sc : null);
    if (sc) for (const p of E.SC) { const own = sc[p]; const q = POS.sc[p]; if (own && q) s += `<circle class="scring pw-${own}" cx="${q[0]}" cy="${q[1]}" r="17"/>`; }
    if (st.moves) for (const p of st.moves) {
      const u = units.find((x) => x.p === p); const [x1, y1] = posOf(u.p, u.c);
      for (const n of E.unitNeighbors(u)) { const [x2, y2] = ctrOf(n.p, n.c); s += arrow(x1, y1, x2, y2, 'exarr').replace(/\/>$/, ' marker-end="url(#ah-ex)"/>') + `<g class="exok" transform="translate(${x2},${y2})"><circle r="18"/></g>`; }
    }
    if (st.places) st.places.forEach(([p], i) => {
      const [x, y] = ctrOf(p, null); const on = T.place === i;
      if (on) for (const q of E.ADJ[p]) { const [x2, y2] = ctrOf(q, null); s += `<line class="plink" x1="${x}" y1="${y}" x2="${x2}" y2="${y2}"/><circle class="pnb" cx="${x2}" cy="${y2}" r="9"/>`; }
      s += `<g class="pmark${on ? ' on' : ''}" data-pl="${i}" transform="translate(${x},${y})"><circle class="hit" r="34"/><circle r="${on ? 30 : 22}"/><text y="7">${i + 1}</text></g>`;
    });
    if (st.quiz && T.qlast) { const [x, y] = ctrOf(T.qlast.p, null); s += `<g class="${T.qlast.ok ? 'exok' : 'exno'}" transform="translate(${x},${y})"><circle r="30"/>${T.qlast.ok ? '' : '<path d="M-8 -8 L8 8 M8 -8 L-8 8"/>'}</g>`; }
    if (st.builds) for (const p of st.builds) { const [x, y] = ctrOf(p, null); s += `<g class="tgt"><circle cx="${x}" cy="${y}" r="26"/></g>`; }
    if (T.phase === 'after' && T.res) {
      s += `<g class="orders">${ordersSVG(units, T.res.orders.map((o) => Object.assign({ o: units.find((x) => x.p === o.p).o }, o)), T.res.results)}</g>`;
      units = T.res.units;
    } else {
      s += `<g class="orders">${ordersSVG(units, tutAllOrders(), null)}</g>`;
    }
    const selP = T.sel && T.sel.unit ? T.sel.unit.p : null;
    const taskU = st.task && T.phase === 'before' && !T.ok ? st.task.unit : null;
    for (const u of units) { const [x, y] = posOf(u.p, u.c); s += tokenSVG(u, x, y, [selP === u.p ? 'sel' : '', taskU === u.p && !selP ? 'pulse' : '', T.sel && T.sel.other && T.sel.other.p === u.p ? 'sel2' : ''].filter(Boolean)); }
    if (T.phase === 'after' && T.res) for (const d of T.res.dislodged) {
      const [x, y] = dislodgedPos(d); s += tokenSVG(d, x, y, ['disl']);
      if (st.showRetreat) for (const o of d.opts) { const [p, c] = o.split('/'); const [tx, ty] = ctrOf(p, c || null); s += `<g class="exok" transform="translate(${tx},${ty})"><circle r="22"/></g>`; }
    }
    tutTargets().forEach((t, i) => {
      const [x, y] = tgtPos(t);
      s += `<g class="tgt${t.vc ? ' vc' : ''}${t.hold ? ' th' : ''}${t.unit ? ' tu' : ''}" data-tt="${i}" transform="translate(${x},${y})"><circle class="hit" r="30"/><circle r="${t.unit ? 34 : 24}"/><rect class="tl" x="-26" y="${t.unit ? 36 : 26}" width="52" height="22" rx="4"/><text class="tlt" y="${t.unit ? 52 : 42}">${t.p}</text></g>`;
    });
    return s + '</svg>';
  }
  function tutResolve() {
    const units = tutUnits();
    S.tut.res = E.adjudicateMovement({ units, sc: {} }, tutAllOrders());
    S.tut.phase = 'after'; S.tut.sel = null; render();
  }
  function tutPick(t) {
    const st = tutStep(), T = S.tut, task = st.task, u = T.sel.unit;
    if (T.sel.mode === 'sup1') { T.sel = { unit: u, mode: 'sup2', other: tutUnits().find((x) => x.p === t.p) }; render(); return; }
    let o;
    if (T.sel.mode === 'move') o = { o: u.o, p: u.p, k: 'M', to: t.p, tc: t.c || null, vc: !!t.vc };
    else o = { o: u.o, p: u.p, k: 'S', sp: T.sel.other.p, st: t.hold ? null : t.p };
    T.sel = null;
    if (st.free) { T.orders = T.orders.filter((x) => x.p !== o.p).concat([o]); T.done[o.k === 'M' ? 'move' : 'sup'] = 1; render(); return; }
    const good = task.kind === 'M' ? (o.k === 'M' && o.to === task.to) : (o.k === 'S' && o.sp === task.sp && (o.st || null) === (task.st || null));
    if (!good) { T.msg = 'Tohle není ono, zkus to znovu. ' + task.say; render(); return; }
    T.orders = [o];
    if (o.vc) for (const f of tutUnits().filter((x) => x.t === 'F' && E.isSea(x.p) && x.o === u.o)) T.orders.push({ o: u.o, p: f.p, k: 'C', sp: u.p, st: o.to });
    T.ok = true; T.msg = 'Správně! Teď klikni na <b>Vyhodnotit</b>.'; render();
  }
  function tutClick(ev) {
    if (S.dragged && Date.now() - S.dragged < 250) return;
    const st = tutStep(), T = S.tut;
    const sv0 = $('#tutsvg'); const pt0 = sv0.createSVGPoint(); pt0.x = ev.clientX; pt0.y = ev.clientY; const m0 = pt0.matrixTransform(sv0.getScreenCTM().inverse());
    if (st.places) {
      const el = ev.target.closest && ev.target.closest('[data-pl]');
      let i = el ? +el.getAttribute('data-pl') : -1;
      if (i < 0) { let best = null; st.places.forEach(([p], j) => { const q = ctrOf(p, null); const d = Math.hypot(q[0] - m0.x, q[1] - m0.y); if (!best || d < best.d) best = { d, j }; }); if (best && best.d < 60) i = best.j; }
      if (i >= 0) { T.place = i; S.tutFocusPt = ctrOf(st.places[i][0], null); render(); }
      return;
    }
    if (st.quiz) {
      if (T.qi >= st.quiz.length) return;
      let best = null;
      for (const p of Object.keys(NAMES)) for (const q of [ctrOf(p, null), POS.unit[p], POS.sc[p]].filter(Boolean)) { const d = Math.hypot(q[0] - m0.x, q[1] - m0.y); if (!best || d < best.d) best = { d, p }; }
      if (!best || best.d > 130) return;
      const want = st.quiz[T.qi];
      if (best.p === want) { T.score++; T.qlast = { p: want, ok: true }; T.qmsg = `Správně, to je ${NAMES[want]}.`; T.qi++; }
      else { T.miss++; T.qlast = { p: best.p, ok: false }; T.qmsg = `To je ${NAMES[best.p]} (${best.p}). Zkus to znovu.`; }
      render(); return;
    }
    if (st.free) {
      if (T.phase !== 'before') return;
      const ts = tutTargets();
      const tEl = ev.target.closest && ev.target.closest('[data-tt]');
      if (tEl && ts[+tEl.getAttribute('data-tt')]) { tutPick(ts[+tEl.getAttribute('data-tt')]); return; }
      if (ts.length) { let best = null; for (const t of ts) { const q = tgtPos(t); const d = Math.hypot(q[0] - m0.x, q[1] - m0.y); if (!best || d < best.d) best = { d, t }; } if (best && best.d < 55) { tutPick(best.t); return; } }
      let best = null;
      for (const u of tutUnits().filter((x) => x.o === st.me)) { const q = posOf(u.p, u.c); const d = Math.hypot(q[0] - m0.x, q[1] - m0.y); if (!best || d < best.d) best = { d, u }; }
      if (best && best.d < 45) { T.sel = { unit: best.u, mode: 'move' }; render(); }
      return;
    }
    if (!st.task || T.phase !== 'before' || T.ok) return;
    const ts = tutTargets();
    const tEl = ev.target.closest && ev.target.closest('[data-tt]');
    if (tEl && ts[+tEl.getAttribute('data-tt')]) { tutPick(ts[+tEl.getAttribute('data-tt')]); return; }
    const sv = $('#tutsvg'); const pt = sv.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; const m = pt.matrixTransform(sv.getScreenCTM().inverse());
    if (ts.length) {
      let best = null;
      for (const t of ts) { const q = tgtPos(t); const d = Math.hypot(q[0] - m.x, q[1] - m.y); if (!best || d < best.d) best = { d, t }; }
      if (best && best.d < 55) { tutPick(best.t); return; }
    }
    let best = null;
    for (const u of tutUnits()) { const q = posOf(u.p, u.c); const d = Math.hypot(q[0] - m.x, q[1] - m.y); if (!best || d < best.d) best = { d, u }; }
    if (best && best.d < 45) {
      if (best.u.p !== st.task.unit) { T.msg = 'Teď potřebuješ jinou jednotku. ' + st.task.say; T.sel = null; render(); return; }
      T.sel = { unit: best.u, mode: st.task.kind === 'S' ? 'sup1' : 'move' }; T.msg = ''; render();
    }
  }
  function renderTutorial(root) {
    const keepScroll = $('#mapwrap') ? [$('#mapwrap').scrollLeft, $('#mapwrap').scrollTop] : null;
    const st = tutStep(), T = S.tut, n = TUT.length;
    let body = st.h;
    if (st.openings) {
      body += `<div class="opbtns">${PW.map((p) => `<button class="btn sm${T.op === p ? ' on' : ''}" data-act="tut-op" data-p="${p}">${powerChip(p)} ${esc(E.PNAME[p])}</button>`).join('')}</div>
        <p class="optext">${esc(OPENINGS[T.op].t)}</p><p class="small muted">${OPENINGS[T.op].o.map(([a, b]) => a === b ? `${a} drží` : `${a} – ${b}`).join(' · ')}</p>`;
    }
    let act = '';
    if (st.places) {
      body += `<ol class="plist2">${st.places.map(([p, name], i) => `<li class="${T.place === i ? 'on' : ''}"><button class="prow" data-act="tut-pl" data-i="${i}"><span class="pn">${i + 1}</span><span>${esc(name)}</span><span class="code">${p}</span></button>${T.place === i ? `<div class="pdesc">${esc(st.places[i][2])}<div class="muted small">Sousedí s ${E.ADJ[p].length} poli: ${E.ADJ[p].map((q) => esc(NAMES[q])).join(', ')}.</div></div>` : ''}</li>`).join('')}</ol>`;
    }
    if (st.quiz) {
      const done = T.qi >= st.quiz.length;
      act += done ? `<div class="ttask ok"><b>Hotovo!</b> Našel jsi všech ${st.quiz.length} území${T.miss ? `, ${T.miss}× ses spletl` : ' bez jediné chyby'}.</div><button class="btn sm" data-act="tut-again">Znovu</button>`
        : `<div class="ttask"><span class="tstep">Otázka ${T.qi + 1} z ${st.quiz.length}</span><br>Najdi na mapě: <b class="qbig">${esc(NAMES[st.quiz[T.qi]])}</b></div>${T.qmsg ? `<div class="ttask ${T.qlast && T.qlast.ok ? 'ok' : ''}">${esc(T.qmsg)}</div>` : ''}`;
    }
    if (st.checklist) {
      const all = st.checklist.every(([k]) => T.done[k]);
      act += `<ul class="chk">${st.checklist.map(([k, l]) => `<li class="${T.done[k] ? 'ok' : ''}"><span class="cb">${T.done[k] ? '✓' : ''}</span><span>${l}</span></li>`).join('')}</ul>`;
      if (T.sel && T.phase === 'before') act += `<div class="ttask">Vybráno: <b>${T.sel.unit.t === 'A' ? 'armáda' : 'loďstvo'} ${esc(NAMES[T.sel.unit.p])}</b> · režim ${{ move: 'tah', sup1: 'podpora (vyber jednotku)', sup2: 'podpora (vyber cíl)' }[T.sel.mode]}</div>`;
      if (all && T.phase === 'after') act += `<div class="ttask ok"><b>Všechno splněno.</b></div>`;
    }
    if (st.task) {
      if (!T.ok && T.phase === 'before') act += `<div class="ttask"><b>Úkol:</b> ${T.msg && !T.msg.startsWith('Správně') ? T.msg : st.task.say}</div>`;
      else if (T.phase === 'before') act += `<div class="ttask ok">${T.msg}</div>`;
    }
    const canResolve = (st.orders && st.orders.length) || (st.task && T.ok) || (st.free && T.orders.length);
    if (canResolve && T.phase === 'before') act += `<button class="btn primary" data-act="tut-resolve">Vyhodnotit</button>`;
    if (T.phase === 'after') act += `<div class="ttask ok"><b>Výsledek:</b> ${st.after || ''}</div><button class="btn sm" data-act="tut-again">Zkusit znovu</button>`;
    const side = `<div class="pane tutpane">
      <div class="tprog">${TUT.map((x, i) => `<button class="tdot${i === S.tutI ? ' on' : i < S.tutI ? ' done' : ''}" data-act="tut-go" data-i="${i}" title="${esc(x.t)}" aria-label="Krok ${i + 1}: ${esc(x.t)}"></button>`).join('')}</div>
      <div class="tstep">Krok ${S.tutI + 1} z ${n}</div>
      <h3>${esc(st.t)}</h3>
      <div class="tbody">${body}</div>
      <div class="tact">${act}</div>
      <div class="tnav"><button class="btn" data-act="tut-prev" ${S.tutI === 0 ? 'disabled' : ''}>‹ Zpět</button><span class="grow"></span>${S.tutI < n - 1 ? `<button class="btn primary" data-act="tut-next">Další ›</button>` : ''}</div>
    </div>`;
    root.innerHTML = header(`<span class="sub">jak hrát</span>`) + `
      <main class="game${S.side ? '' : ' noside'}">
        <section class="mapcol">
          <div class="maptools">
            <button class="btn sm primary" data-act="tut-close">‹ ${S.gid ? 'Zpět do hry' : 'Zpět na seznam'}</button>
            <span class="grow"></span>
            <button class="btn sm icon" data-act="zoom-out" aria-label="Oddálit" ${S.zoom <= 1 ? 'disabled' : ''}>−</button><span class="zl">${Math.round(S.zoom * 100)} %</span><button class="btn sm icon" data-act="zoom-in" aria-label="Přiblížit" ${S.zoom >= 3 ? 'disabled' : ''}>+</button>
            <button class="btn sm sidebtn" data-act="side">${S.side ? 'Celá mapa ›' : '‹ Panel'}</button>
          </div>
          <div id="mapwrap" class="mapwrap"><div class="mapinner" style="width:${(S.zoom * 100).toFixed(0)}%"><img src="map.jpg" alt="Mapa Evropy 1901" draggable="false">${tutSVG()}</div></div>
        </section>
        <aside class="side">${side}</aside>
      </main>${keysModal()}`;
    bind(root);
    const sv = $('#tutsvg', root); if (sv) sv.addEventListener('click', tutClick);
    if (keepScroll && !S.tutFocus && !S.tutFocusPt) { const w0 = $('#mapwrap', root); w0.scrollLeft = keepScroll[0]; w0.scrollTop = keepScroll[1]; }
    if (S.tutFocusPt) {
      const fp = S.tutFocusPt; const w = $('#mapwrap', root);
      if (S.zoom < 1.6) { S.zoom = 1.6; render(); return; }
      S.tutFocusPt = null;
      if (w) { const go = () => { w.scrollLeft = fp[0] / 2500 * w.scrollWidth - w.clientWidth / 2; w.scrollTop = fp[1] / 1770 * w.scrollHeight - w.clientHeight / 2; }; go(); requestAnimationFrame(go); }
    } else if (S.tutFocus) {
      S.tutFocus = false;
      const pts = (st.start || st.openings || st.places || st.quiz) ? [] : tutUnits().map((u) => posOf(u.p, u.c)).concat((st.builds || []).map((p) => posOf(p, null)));
      const w = $('#mapwrap', root);
      if (pts.length && w) {
        const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const span = Math.max(Math.max(...xs) - Math.min(...xs) + 500, (Math.max(...ys) - Math.min(...ys) + 420) * 1.41);
        const z = Math.max(1, Math.min(2, 2500 / span));
        if (Math.abs(z - S.zoom) > 0.01) { S.zoom = +z.toFixed(2); S.tutFocus = true; render(); return; }
        const iw = w.scrollWidth, ih = w.scrollHeight;
        const go = () => { w.scrollLeft = cx / 2500 * w.scrollWidth - w.clientWidth / 2; w.scrollTop = cy / 1770 * w.scrollHeight - w.clientHeight / 2; };
        go(); requestAnimationFrame(go);
      } else if (S.zoom !== 1 && (st.start || st.openings || st.places || st.quiz)) { S.zoom = 1; render(); }
    }
  }
  function openTutorial(i) { S.tutorial = true; S.explore = false; S.tutI = i || 0; tutReset(); S.side = true; S.tutFocus = true; render(); }

  // ------------------------------------------------------------------ movement explorer
  const NO_FLEET_PAIRS = ['ANK-SMY', 'APU-ROM', 'ARM-SMY', 'ARM-SYR', 'EDI-LVP', 'FIN-NWY', 'GAS-MAR', 'LVP-YOR', 'PIE-VEN', 'ROM-VEN', 'TUS-VEN', 'WAL-YOR'];
  const ptype = (p) => (E.isSea(p) ? 'moře' : E.isCoastal(p) ? 'pobřežní území' : 'vnitrozemí');
  const locName = (p, c) => NAMES[p] + (c ? ' (' + { NC: 'severní', SC: 'jižní', EC: 'východní' }[c] + ' pobřeží)' : '');
  function exploreInfo(t, p, c) {
    const u = { t, p, c };
    const res = { ok: [], no: [], err: null };
    if (t === 'A' && E.isSea(p)) { res.err = 'Armáda nemůže stát na moři. Přes moře se dostane jen konvojem.'; return res; }
    if (t === 'F' && !E.isSea(p) && !E.isCoastal(p)) { res.err = 'Loďstvo nesmí do vnitrozemí, takže tady stát nemůže.'; return res; }
    if (t === 'F' && E.SPLIT[p] && !c) { res.err = 'split'; return res; }
    const ok = E.unitNeighbors(u);
    res.ok = ok;
    for (const q of E.ADJ[p]) {
      if (ok.some((n) => n.p === q)) continue;
      let why;
      if (t === 'A') why = 'je to moře (jen konvojem)';
      else if (!E.isSea(q) && !E.isCoastal(q)) why = 'vnitrozemí';
      else if (NO_FLEET_PAIRS.includes([p, q].sort().join('-'))) why = 'nesdílí s ním moře – loďstvo nesmí podél pobřeží';
      else if (E.SPLIT[p]) why = 'je u druhého pobřeží';
      else why = 'nedosáhne';
      res.no.push({ p: q, why });
    }
    return res;
  }
  function exploreSVG() {
    const ex = S.ex; let s = `<svg id="exsvg" viewBox="0 0 2500 1770" xmlns="http://www.w3.org/2000/svg"><defs><marker id="ah-ex" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse"><path class="ahx" d="M0 0 L10 5 L0 10 z"/></marker></defs>`;
    if (ex.p) {
      const info = exploreInfo(ex.t, ex.p, ex.c);
      const [x1, y1] = posOf(ex.p, ex.c);
      if (!info.err) {
        for (const n of info.no) { const [x, y] = ctrOf(n.p, null); s += `<g class="exno" transform="translate(${x},${y})"><circle r="20"/><path d="M-8 -8 L8 8 M8 -8 L-8 8"/></g>`; }
        for (const n of info.ok) { const [x2, y2] = ctrOf(n.p, n.c); s += arrow(x1, y1, x2, y2, 'exarr').replace(/\/>$/, ' marker-end="url(#ah-ex)"/>') + `<g class="exok" transform="translate(${x2},${y2})"><circle r="22"/>${n.c ? `<text y="5">${E.COAST_CZ[n.c]}</text>` : ''}</g>`; }
      } else if (info.err === 'split') {
        for (const c of Object.keys(E.SPLIT[ex.p])) { const [x, y] = posOf(ex.p, c); s += `<g class="exok" transform="translate(${x},${y})"><circle r="24"/><text y="5">${E.COAST_CZ[c]}</text></g>`; }
      }
      if (info.err !== 'split') s += tokenSVG({ o: 'EX', t: ex.t, p: ex.p }, x1, y1, info.err ? ['gone'] : ['sel']);
    }
    return s + '</svg>';
  }
  function renderExplorer(root) {
    const keepScroll = $('#mapwrap') ? [$('#mapwrap').scrollLeft, $('#mapwrap').scrollTop] : null;
    const ex = S.ex;
    const info = ex.p ? exploreInfo(ex.t, ex.p, ex.c) : null;
    const opts = Object.keys(NAMES).sort((a, b) => NAMES[a].localeCompare(NAMES[b], 'cs')).map((p) => `<option value="${p}"${ex.p === p ? ' selected' : ''}>${esc(NAMES[p])} (${p})</option>`).join('');
    let side = `<div class="pane expane">
      <h3>Průvodce tahy</h3>
      <p class="muted small">Vyber jednotku a klikni na území na mapě. Zelené kroužky ukážou, kam smí táhnout, šedé křížky sousedy, kam nesmí.</p>
      <div class="seg" role="group" aria-label="Typ jednotky"><button class="btn${ex.t === 'A' ? ' on' : ''}" data-act="ex-t" data-t="A">Armáda (pěchota)</button><button class="btn${ex.t === 'F' ? ' on' : ''}" data-act="ex-t" data-t="F">Loďstvo</button></div>
      <label for="ex-sel" class="small muted">nebo vyber ze seznamu</label>
      <select id="ex-sel"><option value="">— území —</option>${opts}</select>`;
    if (ex.p) {
      side += `<h4>${esc(NAMES[ex.p])} <span class="code">${ex.p}</span></h4><p class="small">${ptype(ex.p)}${E.SC.includes(ex.p) ? ' · zásobovací centrum' : ''}${E.HOME[PW.find((x) => E.HOME[x].includes(ex.p))] ? ' · domovské: ' + esc(E.PNAME[PW.find((x) => E.HOME[x].includes(ex.p))]) : ''}${E.SPLIT[ex.p] ? ' · dvě pobřeží' : ''}</p>`;
      if (info.err === 'split') side += `<p>Loďstvo tu stojí vždy u jednoho pobřeží. Které?</p><div class="seg">${Object.keys(E.SPLIT[ex.p]).map((c) => `<button class="btn${ex.c === c ? ' on' : ''}" data-act="ex-c" data-c="${c}">${{ NC: 'Severní', SC: 'Jižní', EC: 'Východní' }[c]} (${E.COAST_CZ[c]})</button>`).join('')}</div>`;
      else if (info.err) side += `<p class="warnp">${esc(info.err)}</p>`;
      else {
        if (E.SPLIT[ex.p]) side += `<div class="seg">${Object.keys(E.SPLIT[ex.p]).map((c) => `<button class="btn sm${ex.c === c ? ' on' : ''}" data-act="ex-c" data-c="${c}">${{ NC: 'Severní', SC: 'Jižní', EC: 'Východní' }[c]} pobřeží</button>`).join('')}</div>`;
        side += `<h4>${ex.t === 'A' ? 'Armáda' : 'Loďstvo'} smí táhnout do (${info.ok.length})</h4><ul class="exl ok">${info.ok.map((n) => `<li><span class="code">${n.p}${n.c ? '/' + E.COAST_CZ[n.c] : ''}</span>${esc(locName(n.p, n.c))}<span class="t">${ptype(n.p)}</span></li>`).join('')}</ul>`;
        if (info.no.length) side += `<h4>Sousedí, ale nesmí</h4><ul class="exl no">${info.no.map((n) => `<li><span class="code">${n.p}</span>${esc(NAMES[n.p])}<span class="t">${esc(n.why)}</span></li>`).join('')}</ul>`;
        if (ex.t === 'A' && E.isCoastal(ex.p)) side += `<p class="small muted">Konvojem se armáda dostane i na vzdálené pobřeží, pokud na každém moři cesty stojí loďstvo s rozkazem konvoje.</p>`;
        if (ex.t === 'F' && E.isSea(ex.p)) side += `<p class="small muted">Odtud může loďstvo i konvojovat armádu z pobřeží, které s tímto mořem sousedí.</p>`;
        side += `<p class="small muted">Podporovat smí jednotka do stejných polí, kam smí sama táhnout.</p>`;
      }
    }
    side += `</div>`;
    root.innerHTML = header(`<span class="sub">průvodce tahy</span>`) + `
      <main class="game${S.side ? '' : ' noside'}">
        <section class="mapcol">
          <div class="maptools">
            <button class="btn sm primary" data-act="ex-close">‹ ${S.gid ? 'Zpět do hry' : 'Zpět na seznam'}</button>
            <div class="seg sm"><button class="btn sm${ex.t === 'A' ? ' on' : ''}" data-act="ex-t" data-t="A">Armáda</button><button class="btn sm${ex.t === 'F' ? ' on' : ''}" data-act="ex-t" data-t="F">Loďstvo</button></div>
            <span class="grow"></span>
            <button class="btn sm" data-act="keys" title="Klávesové zkratky (?)">⌨ Zkratky</button>
            <button class="btn sm icon" data-act="zoom-out" aria-label="Oddálit" ${S.zoom <= 1 ? 'disabled' : ''}>−</button><span class="zl">${Math.round(S.zoom * 100)} %</span><button class="btn sm icon" data-act="zoom-in" aria-label="Přiblížit" ${S.zoom >= 3 ? 'disabled' : ''}>+</button>
            <button class="btn sm sidebtn" data-act="side">${S.side ? 'Celá mapa ›' : '‹ Panel'}</button>
          </div>
          <div id="mapwrap" class="mapwrap"><div class="mapinner" style="width:${(S.zoom * 100).toFixed(0)}%"><img src="map.jpg" alt="Mapa Evropy 1901" draggable="false">${exploreSVG()}</div></div>
        </section>
        <aside class="side">${side}</aside>
      </main>${keysModal()}`;
    bind(root);
    if (keepScroll) { const w0 = $('#mapwrap', root); w0.scrollLeft = keepScroll[0]; w0.scrollTop = keepScroll[1]; }
    const sel = $('#ex-sel', root); if (sel) sel.addEventListener('change', () => { if (sel.value) { S.ex.p = sel.value; S.ex.c = null; render(); } });
    const sv = $('#exsvg', root);
    if (sv) sv.addEventListener('click', (ev) => {
      if (S.dragged && Date.now() - S.dragged < 250) return;
      const pt = sv.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; const m = pt.matrixTransform(sv.getScreenCTM().inverse());
      let best = null;
      for (const p of Object.keys(NAMES)) {
        const pts = [POS.unit[p], POS.label[p], POS.sc[p]].filter(Boolean).map((q) => ({ q, c: null }));
        if (E.SPLIT[p]) for (const c of Object.keys(E.SPLIT[p])) pts.push({ q: POS.coast[p + '/' + c], c });
        for (const x of pts) { const d = Math.hypot(x.q[0] - m.x, x.q[1] - m.y); if (!best || d < best.d) best = { d, p, c: x.c }; }
      }
      if (!best || best.d > 90) return;
      S.ex.p = best.p; S.ex.c = S.ex.t === 'F' && E.SPLIT[best.p] ? best.c || null : null; render();
    });
  }

  // ------------------------------------------------------------------ shortcuts modal
  function keysModal() {
    if (!S.keys) return '';
    const rows = [
      ['N', 'nebo Tab', 'další moje jednotka (nejdřív ty bez rozkazu)'], ['T', '', 'táhni'], ['D', '', 'drž'], ['P', '', 'podpoř'], ['K', '', 'konvoj (loďstvo na moři)'],
      ['Del', '', 'smaž rozkaz vybrané jednotky'], ['Esc', '', 'zrušit výběr / zavřít'], ['X', '', 'ústup: rozpustit jednotku'], ['A', '', 'zima: postav armádu'], ['L', '', 'zima: postav loďstvo'],
      ['Shift+Enter', '', 'odevzdat rozkazy'], ['+ / −', '', 'přiblížit / oddálit mapu'], ['M', '', 'celá mapa (skrýt panel)'], ['G', '', 'průvodce tahy'], ['?', '', 'tahle nápověda'],
    ];
    return `<div class="reveal" role="dialog" aria-modal="true" aria-label="Klávesové zkratky" data-act="keys-off"><div class="rv-box keysbox" data-stop="1">
      <h2 class="rv-h">Klávesové zkratky</h2>
      <table class="keys">${rows.map(([k, k2, d]) => `<tr><td>${k.split(' / ').map((x) => `<kbd>${esc(x)}</kbd>`).join(' / ')}${k2 ? ` <span class="muted small">${esc(k2.replace('nebo ', 'nebo '))}</span>` : ''}</td><td>${esc(d)}</td></tr>`).join('')}</table>
      <p class="muted small">Myš: kliknutí na jednotku a cíl · dvojklik přiblíží · tažením posuneš přiblíženou mapu · Ctrl/⌘ + kolečko zoom.</p>
      <button class="btn primary" data-act="keys-off">Zavřít</button></div></div>`;
  }

  function header(inner, noMus) {
    return `<header class="top"><a class="brand" href="#" data-act="home"><span class="b1">Velmoci</span><span class="b2">1901</span></a>${inner || ''}${noMus ? '' : musBtn('hdr')}</header>`;
  }

  // ---------- lobby
  function renderLobby(root) {
    const games = S.games;
    const mine = (g) => Object.values(g.seats || {}).includes(S.B.uid) || (g.status === 'lobby' && g.players && g.players[S.B.uid]);
    let list;
    if (!games) list = `<p class="muted">${S.loadSlow ? 'Seznam her se zatím nepodařilo načíst. Zkontroluj připojení.' : 'Načítám hry…'}</p>`;
    else if (!games.length) list = `<div class="empty"><p class="lead">Zatím tu není žádná rozehraná partie.</p><p class="muted">Založ novou hru ve formuláři. Volná místa můžeš obsadit boty a hrát hned, nebo počkat na přátele.</p></div>`;
    else list = `<ul class="glist">${games.map((g) => {
      const st = g.state; const seats = PW.map((p) => `<span class="dot pw-${p}${g.seats && g.seats[p] ? ' on' : ''}${(g.bots && g.bots[p]) || (g.ai && g.ai[p]) ? ' bot' : ''}" title="${esc(E.PNAME[p])}"></span>`).join('');
      const ph = g.status === 'lobby' ? `U stolu ${Object.keys(g.players || {}).length} z 7, čeká se na los` : g.status === 'over' ? (st && st.winner ? 'Vyhrálo ' + E.PNAME[st.winner] : st && st.ended ? 'Ukončeno' : 'Konec') : (st ? E.phaseName(st) : '');
      const own = g.createdBy === S.B.uid;
      const conf = S.confirm === 'del-' + g.id && Date.now() - S.confirmAt < 6000;
      return `<li class="gli"><a href="#hra-${esc(g.id)}" class="gitem${mine(g) ? ' my' : ''}"><span class="gname">${esc(g.name || 'Bez názvu')}</span><span class="gph">${esc(ph)}</span><span class="seats">${seats}</span>${mine(g) ? '<span class="tag">hraješ</span>' : ''}</a>${own ? `<button class="btn sm gdel${conf ? ' danger' : ''}" data-act="dellist" data-id="${esc(g.id)}" title="Smazat hru" aria-label="Smazat hru ${esc(g.name || '')}">${conf ? 'Opravdu smazat?' : 'Smazat'}</button>` : ''}</li>`;
    }).join('')}</ul>`;
    const local = S.B.kind === 'local';
    const nGames = games ? games.filter((g) => g.status !== 'over').length : 0;
    const myOpen = games ? games.filter((g) => g.status !== 'over' && mine(g)) : [];
    const notes = `${local ? `<div class="note">Tahle kopie stránky nemá sdílené úložiště, takže hry jsou uložené jen v tomto prohlížeči. Hra proti botům funguje normálně.</div>` : ''}${!S.canWrite ? `<div class="note">Máš k téhle stránce jen čtecí přístup. Hry vidíš, ale abys mohl hrát, potřebuješ od vlastníka přístup Editor nebo Contributor.</div>` : ''}`;
    let modal = '';
    if (S.modal === 'new') modal = `<form id="newgame" class="mbox">
        <div class="mhead"><h2>Nová hra</h2><button type="button" class="btn sm ghost" data-act="modal-off" aria-label="Zavřít">×</button></div>
        <label for="ng-name">Název</label>
        <input id="ng-name" maxlength="40" placeholder="např. Páteční Evropa" value="">
        <label for="ng-mode">Kdo hraje</label>
        <select id="ng-mode"><option value="table">pozvu přátele, země se vylosují při startu</option><option value="now">hraju hned sám, země se vylosuje teď</option></select>
        <label for="ng-fill">Volné velmoci převezmou</label>
        <select id="ng-fill"><option value="ai">AI diplomaté: vyjednávají, blafují, zrazují</option><option value="bot">jednoduší boti: jen táhnou, nemluví</option></select>
        <label for="ng-dl">Odpočet času</label>
        <select id="ng-dl">${Object.entries(TEMPO).map(([k, t]) => `<option value="${k}"${k === 'live' ? ' selected' : ''}>${esc(t.l)}</option>`).join('')}</select>
        ${notes}
        <button type="submit" class="btn primary big" ${S.canWrite ? '' : 'disabled'}>Založit hru</button>
      </form>`;
    else if (S.modal === 'games') modal = `<div class="mbox wide">
        <div class="mhead"><h2>Rozehrané hry</h2><button type="button" class="btn sm ghost" data-act="modal-off" aria-label="Zavřít">×</button></div>
        ${notes}${list}
        <div class="mfoot"><button class="btn primary" data-act="modal-new">Začít novou hru</button></div>
      </div>`;
    root.innerHTML = `
      <section class="herob">
        <img src="hero.jpg" alt="Vojáci na dřevěném chodníku mezi rozstřílenými stromy v Chateau Wood u Ypres, 1917" width="1600" height="920">
        <div class="herok">Velmoci <span>1901</span></div>
        <div class="herot"><h1>Diplomacie. Zrada. Válka.</h1><p>Roku 1901 je Evropa na vrcholu moci, ale pod povrchem to vře: Trojspolek Německa, Rakouska-Uherska a Itálie stojí proti spojenectví Francie a Ruska a Británie ze svých ostrovů střeží rovnováhu sil. Loděnice spouštějí na vodu nové bitevní lodě, na Balkáně to doutná a diplomaté v salonech slibují mír, kterému nikdo nevěří.</p>
          <div class="herobtns">${myOpen.length ? `<a class="btn primary big" href="#hra-${esc(myOpen[0].id)}">Pokračovat: ${esc(myOpen[0].name || 'hra')}</a><button class="btn big ghostlight" data-act="modal-new">Nová hra</button>` : `<button class="btn primary big" data-act="modal-new">Začít novou hru</button>`}<button class="btn big ghostlight" data-act="tutorial">Jak hrát</button></div></div>
        <nav class="topmenu">
          ${musBtn('light')}
          <button class="menubtn" data-act="menu" aria-expanded="${S.menu ? 'true' : 'false'}" aria-haspopup="true">Menu <span class="burger" aria-hidden="true"><i></i><i></i><i></i></span></button>
          ${S.menu ? `<div class="menudrop" role="menu">
            <button role="menuitem" data-act="modal-games"><span>Rozehrané hry</span>${nGames ? `<span class="mcount">${nGames}</span>` : ''}</button>
            <button role="menuitem" data-act="modal-new"><span>Začít novou hru</span></button>
            <button role="menuitem" data-act="tutorial"><span>Jak hrát – tutoriál</span></button>
            <hr>
            <button role="menuitem" data-act="explore"><span>Průvodce tahy</span><kbd>G</kbd></button>
            <button role="menuitem" data-act="keys"><span>Klávesové zkratky</span><kbd>?</kbd></button>
          </div>` : ''}
        </nav>
      </section>
      ${modal ? `<div class="mlay" data-act="modal-bg">${modal}</div>` : ''}${keysModal()}`;
    bind(root);
    const nm = $('#ng-name', root); if (nm) nm.focus();
  }
  function rulesCard() {
    return `<details class="card rules"><summary>Jak se ovládá mapa</summary>
      <ol><li>Klikni na svou jednotku. Zvýrazní se, kam může táhnout.</li>
      <li>Klikni na cíl a rozkaz je zapsaný. Druhé kliknutí na jednotku = drž.</li>
      <li>Pro podporu nebo konvoj zvol akci v panelu, pak vyber podporovanou jednotku a cíl.</li>
      <li>Když máš vše, dej <b>Odevzdat rozkazy</b>. Jakmile odevzdají všichni, kolo se vyhodnotí.</li></ol>
      <p class="muted">Rozkaz bez zadání = jednotka drží. Pravidla jsou stejná jako v tištěné sadě.</p></details>`;
  }

  // ---------- game
  function renderGame(root) {
    const g = S.game;
    if (g === undefined) { root.innerHTML = header() + `<div class="loading">Načítám partii…</div>`; bind(root); return; }
    if (g === null) { root.innerHTML = header() + `<div class="loading">Tahle hra neexistuje nebo k ní nemáš přístup. <a href="#" data-act="home">Zpět na seznam</a></div>`; bind(root); return; }
    if (g.status === 'lobby') { renderSeats(root, g); return; }
    const st = g.state;
    const vs = viewState();
    const phase = S.view != null ? S.history[S.view].name : E.phaseName(st);
    const mapScroll = $('#mapwrap') ? [$('#mapwrap').scrollLeft, $('#mapwrap').scrollTop] : null;
    const chatDraft = $('#chat-in') ? $('#chat-in').value : '';
    const L = S.L; const floatTab = !mobile() && L.float ? L.float : null;
    let dock = S.tab; if (dock === floatTab) dock = TABS.map((t) => t[0]).find((t) => t !== floatTab);
    const floatScroll = $('#fwin .pane') ? $('#fwin .pane').scrollTop : 0;
    root.innerHTML = header(`<span class="gtitle">${esc(g.name || '')}</span><span class="phase${S.view != null ? ' hist' : ''}">${esc(phase)}</span><span class="clock" id="clock"></span>${gameMenu(g)}`, true) + `
      <main class="game lay-${L.mode} side-${L.side}" style="--sidew:${L.w}px">
        <section class="mapcol">
          <div class="maptools">
            ${S.rp ? `<span class="histnote">Přehrávání vyhodnocení</span>` : S.view != null ? `<span class="histnote">Prohlížíš historii</span><button class="btn sm" data-act="hist-prev" ${S.view <= 0 ? 'disabled' : ''}>‹</button><button class="btn sm" data-act="hist-next">›</button><button class="btn sm primary" data-act="hist-off">Zpět na aktuální stav</button>` :
              (S.history.length ? `<button class="btn sm" data-act="hist-last">Výsledek minulého kola</button>` : '')}
            <span class="grow"></span>
            <button class="btn sm icon" data-act="zoom-out" aria-label="Oddálit" ${S.zoom <= 1 ? 'disabled' : ''}>−</button><span class="zl">${Math.round(S.zoom * 100)} %</span><button class="btn sm icon" data-act="zoom-in" aria-label="Přiblížit" ${S.zoom >= 3 ? 'disabled' : ''}>+</button>
          </div>
          <div id="mapwrap" class="mapwrap"><div class="mapinner" style="width:${(S.zoom * 100).toFixed(0)}%"><img src="map.jpg" alt="Mapa Evropy 1901 se 75 provinciemi" draggable="false">${mapSVG()}</div></div>
          ${selBar()}
        </section>
        <div class="split" role="separator" aria-orientation="vertical" aria-label="Šířka panelu (táhni nebo šipky)" aria-valuenow="${L.w}" aria-valuemin="260" aria-valuemax="900" tabindex="0" title="Táhni pro změnu šířky · dvojklik = výchozí"><span></span></div>
        <aside class="side">
          <nav class="tabs" role="tablist">
            ${TABS.map(([k, l]) => `<button role="tab" class="tab${dock === k ? ' on' : ''}${floatTab === k ? ' floated' : ''}" data-tab="${k}" ${floatTab === k ? 'title="Je v plovoucím okně – kliknutím ho připojíš zpět"' : ''}>${l}${k === 'chat' ? `<span class="badge" id="chatbadge"></span>` : ''}</button>`).join('')}
            <span class="tabtools">${L.mode === 'panel' ? `<button class="btn xs" data-act="lay-mode" data-m="split" title="Zobrazit i mapu">Mapa</button>` : ''}${!mobile() ? `<button class="btn xs" data-act="lay-float" title="Odpojit tuhle záložku do plovoucího okna">⧉</button>` : ''}</span>
          </nav>
          <div class="pane" id="pane">${paneHTML(dock, g, vs)}</div>
        </aside>
      </main>${floatTab ? floatHTML(floatTab, g, vs) : ''}${revealHTML(g) || buildModalHTML(g)}${keysModal()}${S.rulesModal ? `<div class="reveal" role="dialog" aria-modal="true" aria-label="Pravidla" data-act="rules-off"><div class="rv-box rulesbox" data-stop="1"><div class="mhead"><h2>Pravidla</h2><button class="btn sm ghost" data-act="rules-off" aria-label="Zavřít">×</button></div>${rulesPane(g)}</div></div>` : ''}`;
    if (mapScroll) { const w = $('#mapwrap'); w.scrollLeft = mapScroll[0]; w.scrollTop = mapScroll[1]; }
    if ($('#chat-in')) { $('#chat-in').value = chatDraft; renderChat(); }
    if (floatTab && $('#fwin .pane')) $('#fwin .pane').scrollTop = floatScroll;
    bind(root); bindLayout(root);
    if (S.rp) rpApply(false);
    tickClock(); updateTabs();
  }

  // ------------------------------------------------------------------ layout: splitter, view modes, floating window
  const TABS = [['orders', 'Rozkazy'], ['chat', 'Jednání'], ['overview', 'Přehled'], ['history', 'Historie']];
  const mobile = () => { try { return window.matchMedia('(max-width: 900px)').matches; } catch (e) { return false; } };
  if (S.tab === 'rules') S.tab = 'orders';
  S.L = Object.assign({ w: 360, mode: 'split', side: 'right', float: null, fx: null, fy: 130, fw: 380, fh: 460 }, lsGet('velmoci-layout', {}));
  if (S.L.float === 'rules') S.L.float = null;
  const saveL = () => lsSet('velmoci-layout', S.L);
  function paneHTML(tab, g, vs) { return tab === 'orders' ? ordersPane(g) : tab === 'overview' ? overviewPane(g, vs) : tab === 'history' ? historyPane() : tab === 'rules' ? rulesPane(g) : chatPane(g); }
  function layoutTools(L) {
    return `<div class="seg sm lay" role="group" aria-label="Rozložení">
      <button class="btn sm${L.mode === 'map' ? ' on' : ''}" data-act="lay-mode" data-m="map" title="Jen mapa (M)">Mapa</button><button class="btn sm${L.mode === 'split' ? ' on' : ''}" data-act="lay-mode" data-m="split" title="Mapa a panel">Obojí</button><button class="btn sm${L.mode === 'panel' ? ' on' : ''}" data-act="lay-mode" data-m="panel" title="Jen panel">Panel</button>
    </div>${L.mode === 'split' && !mobile() ? `<button class="btn sm icon" data-act="lay-swap" title="Přesunout panel na druhou stranu" aria-label="Přesunout panel na druhou stranu">⇄</button>` : ''}`;
  }
  function floatHTML(tab, g, vs) {
    const L = S.L; const vw = window.innerWidth, vh = window.innerHeight;
    const fw = Math.min(Math.max(280, L.fw), vw - 20), fh = Math.min(Math.max(220, L.fh), vh - 20);
    const fx = Math.min(Math.max(0, L.fx == null ? vw - fw - 40 - (L.mode === 'split' && L.side === 'right' ? L.w : 0) : L.fx), vw - 80);
    const fy = Math.min(Math.max(0, L.fy), vh - 60);
    const label = (TABS.find((t) => t[0] === tab) || [0, ''])[1];
    return `<div class="fwin" id="fwin" role="dialog" aria-label="${esc(label)}" style="left:${fx}px;top:${fy}px;width:${fw}px;height:${fh}px">
      <div class="fwhead" id="fwhead"><span class="fwt">${esc(label)}</span><select id="fw-tab" class="fwsel" aria-label="Obsah okna">${TABS.map(([k, l]) => `<option value="${k}"${k === tab ? ' selected' : ''}>${l}</option>`).join('')}</select><span class="grow"></span><button class="btn xs" data-act="lay-dock" title="Vrátit do panelu">Připojit</button><button class="btn xs" data-act="lay-close" aria-label="Zavřít okno">×</button></div>
      <div class="pane fwbody">${paneHTML(tab, g, vs)}</div></div>`;
  }
  function bindLayout(root) {
    const game = $('.game', root); const sp = $('.split', root);
    if (sp && game) {
      const setW = (w) => { const max = Math.max(300, Math.min(900, game.clientWidth - 320)); S.L.w = Math.round(Math.max(260, Math.min(max, w))); game.style.setProperty('--sidew', S.L.w + 'px'); sp.setAttribute('aria-valuenow', S.L.w); };
      let drag = null;
      sp.addEventListener('pointerdown', (e) => { drag = true; sp.setPointerCapture(e.pointerId); sp.classList.add('on'); e.preventDefault(); });
      sp.addEventListener('pointermove', (e) => { if (!drag) return; const r = game.getBoundingClientRect(); setW(S.L.side === 'right' ? r.right - e.clientX - 4 : e.clientX - r.left - 4); });
      const end = () => { if (drag) { drag = false; sp.classList.remove('on'); saveL(); } };
      sp.addEventListener('pointerup', end); sp.addEventListener('pointercancel', end);
      sp.addEventListener('dblclick', () => { setW(360); saveL(); });
      sp.addEventListener('keydown', (e) => { const d = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0; if (!d) return; e.preventDefault(); setW(S.L.w + d * 30 * (S.L.side === 'right' ? 1 : -1)); saveL(); });
    }
    const fw = $('#fwin', root), fh = $('#fwhead', root);
    if (fw && fh) {
      let st = null;
      fh.addEventListener('pointerdown', (e) => { if (e.target.closest('button,select')) return; st = { x: e.clientX, y: e.clientY, l: fw.offsetLeft, t: fw.offsetTop }; fh.setPointerCapture(e.pointerId); fw.classList.add('moving'); });
      fh.addEventListener('pointermove', (e) => { if (!st) return; const l = Math.min(Math.max(0, st.l + e.clientX - st.x), window.innerWidth - 80), t = Math.min(Math.max(0, st.t + e.clientY - st.y), window.innerHeight - 40); fw.style.left = l + 'px'; fw.style.top = t + 'px'; });
      const end = () => { if (!st) return; st = null; fw.classList.remove('moving'); S.L.fx = fw.offsetLeft; S.L.fy = fw.offsetTop; saveL(); };
      fh.addEventListener('pointerup', end); fh.addEventListener('pointercancel', end);
      let rt = null;
      try { new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { if (!document.body.contains(fw)) return; S.L.fw = fw.offsetWidth; S.L.fh = fw.offsetHeight; saveL(); }, 300); }).observe(fw); } catch (e) { /* ignore */ }
      const sel = $('#fw-tab', root); if (sel) sel.addEventListener('change', () => { S.L.float = sel.value; if (S.tab === sel.value) S.tab = TABS.map((t) => t[0]).find((t) => t !== sel.value); saveL(); render(); });
    }
  }

  function selBar() {
    if (S.rp && S.rp.data) return rpBar();
    const g = S.game; if (!g || S.view != null || g.status !== 'play') return '';
    const st = g.state, sel = S.sel;
    if (!sel) {
      const mine = myPowers(g);
      if (!mine.length) return `<div class="selbar muted">Sleduješ hru. Rozkazy zadávají jen hráči.</div>`;
      const acting = E.actingPowers(st).filter((p) => mine.includes(p));
      if (!acting.length) return `<div class="selbar muted">V téhle fázi nemáš co zadat. Čeká se na ostatní.</div>`;
      const nd = E.adjustmentNeeds(st); const nb = acting.reduce((a, p) => a + (nd[p] || 0), 0);
      const hint = st.type === 'M' ? 'Klikni na svou jednotku a pak na cíl. Armádu přes moře pošleš kliknutím na modrý kroužek (konvoj).' : st.type === 'R' ? 'Klikni na vytlačenou jednotku (červený okraj) a vyber, kam ustoupí.' : nb > 0 ? `<b>Zima: můžeš postavit ${nb} ${nb === 1 ? 'novou jednotku' : 'nové jednotky'}.</b> Klikni na zvýrazněné domovské centrum, nebo použij tlačítka v panelu Rozkazy.` : `<b>Zima: musíš rozpustit ${-nb} ${-nb === 1 ? 'jednotku' : 'jednotky'}.</b> Klikni na jednotku na mapě.`;
      return `<div class="selbar ${st.type === 'A' ? 'winter' : 'muted'}"><span>${hint}</span></div>`;
    }
    const u = sel.unit;
    if (st.type === 'M') {
      const title = `<b>${u.t === 'A' ? 'Armáda' : 'Loďstvo'} ${esc(NAMES[u.p])}</b>`;
      const step = { move: 'vyber cíl tahu', sup1: 'vyber jednotku, kterou podpoříš', sup2: 'vyber, kam podpora míří (její pole = podpora držení)', conv1: 'vyber armádu k převezení', conv2: 'vyber cílový přístav' }[sel.mode];
      const tip = { move: 'Kroužky = kam smíš. Modrý = jen konvojem. Druhé kliknutí na jednotku = drž.', sup1: 'Podpořit můžeš i cizí jednotku, ale jen do pole, kam bys sám dosáhl.', sup2: 'Podpora platí jen tehdy, když podporovaná jednotka dostane přesně tenhle rozkaz.', conv1: 'Konvojovat smí jen loďstvo na moři. Armáda pak musí táhnout „konvojem“ na stejný cíl.', conv2: 'Delší cesta přes víc moří potřebuje loďstvo v každém z nich.' }[sel.mode];
      return `<div class="selbar">${title}<span class="step">${step}</span><span class="grow"></span>
        <button class="btn sm${sel.mode === 'move' ? ' on' : ''}" data-act="m-move">Táhni</button>
        <button class="btn sm" data-act="m-hold">Drž</button>
        <button class="btn sm${sel.mode.startsWith('sup') ? ' on' : ''}" data-act="m-sup">Podpoř</button>
        ${u.t === 'F' && E.isSea(u.p) ? `<button class="btn sm${sel.mode.startsWith('conv') ? ' on' : ''}" data-act="m-conv">Konvoj</button>` : ''}
        <button class="btn sm ghost" data-act="m-cancel">Zavřít</button>${tgtButtons()}<div class="tip">${tip}</div></div>`;
    }
    if (st.type === 'R') return `<div class="selbar"><b>Ústup: ${u.t === 'A' ? 'A' : 'L'} ${esc(NAMES[u.p])}</b><span class="step">${sel.d.opts.length ? 'vyber pole pro ústup' : 'nemá kam ustoupit'}</span><span class="grow"></span><button class="btn sm" data-act="r-disband">Rozpustit</button><button class="btn sm ghost" data-act="m-cancel">Zavřít</button>${tgtButtons()}</div>`;
    if (st.type === 'A' && sel.mode === 'buildpick') {
      const p = sel.p; const coastal = E.isCoastal(p);
      const fb = coastal ? (E.SPLIT[p] ? Object.keys(E.SPLIT[p]).map((c) => `<button class="btn sm" data-act="b-F" data-c="${c}">Loďstvo (${E.COAST_CZ[c]})</button>`).join('') : `<button class="btn sm" data-act="b-F">Loďstvo</button>`) : '';
      return `<div class="selbar"><b>Stavba: ${esc(NAMES[p])}</b><span class="grow"></span><button class="btn sm" data-act="b-A">Armáda</button>${fb}<button class="btn sm ghost" data-act="m-cancel">Zavřít</button></div>`;
    }
    return '';
  }

  function orderWarnings(st, pw, list) {
    const W = [];
    const ord = {}; for (const o of list) ord[o.p] = o;
    const ordOf = (p) => ord[p] || { p, k: 'H' };
    const mine = st.units.filter((u) => u.o === pw);
    const tgt = {};
    for (const u of mine) { const o = ordOf(u.p); if (o.k === 'M') (tgt[o.to] = tgt[o.to] || []).push(u.p); }
    for (const t in tgt) if (tgt[t].length > 1) W.push(`${tgt[t].join(' a ')} táhnou obě do ${t} – navzájem se odrazí a nepostoupí žádná.`);
    for (const u of mine) {
      const o = ordOf(u.p);
      if (o.k === 'M') {
        const occ = E.unitAt(st, o.to);
        if (occ && occ.o === pw) { const oo = ordOf(occ.p); if (oo.k !== 'M') W.push(`${u.p} – ${o.to}: v ${o.to} stojí tvoje jednotka, která netáhne. Vlastní jednotku nevytlačíš.`); else if (oo.to === u.p) W.push(`${u.p} a ${o.to} si chtějí vyměnit místa. Bez konvoje se to nepovede.`); }
      }
      if (o.k === 'S') {
        const su = E.unitAt(st, o.sp);
        if (su && su.o === pw) {
          const so = ordOf(su.p);
          if (o.st && !(so.k === 'M' && so.to === o.st)) W.push(`${u.p} podporuje tah ${o.sp} – ${o.st}, ale ${o.sp} má jiný rozkaz. Podpora nebude platit.`);
          if (!o.st && so.k === 'M') W.push(`${u.p} podporuje držení ${o.sp}, jenže ${o.sp} táhne. Podpora držení tahu nepomůže.`);
        }
      }
      if (o.k === 'C') { const a = E.unitAt(st, o.sp); if (a && a.o === pw) { const ao = ordOf(a.p); if (!(ao.k === 'M' && ao.to === o.st)) W.push(`${u.p} konvojuje ${o.sp} – ${o.st}, ale armáda tak netáhne.`); } }
    }
    return W;
  }
  function rulesPane(g) {
    const sec = (h, items) => `<section class="rsec"><h4>${h}</h4><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul></section>`;
    return `<div class="rules-pane"><button class="btn sm primary" data-act="tutorial">Spustit tutoriál Jak hrát</button>
      <p class="lead small">Kolo: <b>jednání</b> → <b>tajné rozkazy</b> → <b>vyhodnocení naráz</b> → ústupy. Po podzimu se počítají centra a v zimě se staví. Vítězí <b>18 z 34 center</b>.</p>
      ${phaseLimit(g) ? `<p class="small">Odpočet: ${esc(g.tempo ? TEMPO[g.tempo].l : g.deadline + ' h na kolo')}. Když čas vyprší, nezadané jednotky drží.</p>` : ''}
      ${sec('Co smíš', [
        '<b>Táhni (–)</b>: armáda do sousední pevniny nebo pobřeží, loďstvo na sousední moře nebo pobřeží podél společné pobřežní čáry.',
        '<b>Drž (D)</b>: jednotka brání svoje pole. Bez rozkazu jednotka automaticky drží.',
        '<b>Podpoř (P)</b> jakoukoli jednotku, i cizí, do pole, kam bys sám mohl táhnout. Podporující jednotka nemusí sousedit s podporovanou.',
        '<b>Konvoj (K)</b>: loďstvo na moři převeze armádu z pobřeží na pobřeží, i přes řetěz moří. V aplikaci klikni na armádu a vyber <b>modrý kroužek</b>; tvá loďstva na cestě dostanou rozkaz automaticky. Cizí loďstvo musí konvoj zadat jeho hráč.',
        'Slibovat, lhát, ukazovat (i falešné) rozkazy, uzavírat a rušit spojenectví. Nic z jednání není závazné.',
      ])}
      ${sec('Co nesmíš / co nefunguje', [
        'Dvě jednotky v jednom poli. Švýcarsko a šrafovaná území jsou neprůchodná.',
        'Loďstvo do vnitrozemí. Armáda na moře (jen konvojem).',
        'Loďstvo mezi pobřežími, která nemají společné moře: Ankara–Smyrna, Apulie–Řím, Arménie–Smyrna, Arménie–Sýrie, Edinburgh–Liverpool, Finsko–Norsko, Gaskoňsko–Marseille, Liverpool–Yorkshire, Piemont–Benátky, Řím–Benátky, Toskánsko–Benátky, Wales–Yorkshire.',
        'Vytlačit vlastní jednotku – ani s podporou. Ani cizí podpora ti s tím nepomůže.',
        'Dvě jednotky si vymění místa bez konvoje: odrazí se.',
        'Jednotka s rozkazem k tahu nemůže dostat podporu držení, ani když tah selže.',
        'Konvojovat smí jen loďstvo na moři, ne v přístavu.',
      ])}
      ${sec('Jak se vyhodnocuje', [
        'Každá jednotka má sílu 1, každá platná podpora +1. Útok projde jen se <b>silou větší</b> než obrana. Při rovnosti se odrazí.',
        'Podporu <b>přeruší</b> jakýkoli útok na podporující jednotku, i neúspěšný. Neplatí to pro útok z pole, kam podpora míří, a pro útok vlastní velmoci.',
        'Konvoj selže, když je některé loďstvo v řetězu vytlačeno.',
        'Vytlačená jednotka ustoupí do volného sousedního pole, kromě pole, odkud přišel útočník, a polí, kde došlo k odrazu. Nemá-li kam, zanikne.',
      ])}
      ${sec('Klávesové zkratky', [
        '<kbd>N</kbd> nebo <kbd>Tab</kbd> další moje jednotka (nejdřív ty bez rozkazu)',
        '<kbd>T</kbd> táhni · <kbd>D</kbd> drž · <kbd>P</kbd> podpoř · <kbd>K</kbd> konvoj · <kbd>Del</kbd> smaž rozkaz · <kbd>Esc</kbd> zrušit výběr',
        'Ústup: <kbd>X</kbd> rozpustit. Zima: <kbd>A</kbd> postav armádu, <kbd>L</kbd> loďstvo',
        '<kbd>Shift</kbd>+<kbd>Enter</kbd> odevzdat rozkazy',
        '<kbd>+</kbd> / <kbd>−</kbd> přiblížit, <kbd>M</kbd> celá mapa, <kbd>G</kbd> průvodce tahy, <kbd>?</kbd> přehled zkratek',
      ])}
      ${sec('Zima', [
        'Centrum patří tomu, kdo v něm stojí po podzimu (i když tam jen prošel na podzim).',
        'Víc center než jednotek = stavíš v <b>prázdném vlastním domovském centru</b>. Míň = rozpouštíš.',
        'Petrohrad, Španělsko a Bulharsko mají dvě pobřeží: loďstvo tam stojí u jednoho z nich.',
      ])}
    </div>`;
  }
  function gameMenu(g) {
    const conf = (k) => S.confirm === k && Date.now() - S.confirmAt < 6000;
    const L = S.L;
    let end = '';
    if (g && g.status === 'play') {
      if (g.createdBy === S.B.uid) end = `<button role="menuitem" class="mdanger${conf('end') ? ' on' : ''}" data-act="endgame"><span>${conf('end') ? 'Opravdu ukončit? Klikni znovu' : 'Ukončit hru'}</span></button>`;
      else if (myPowers(g).length) end = `<button role="menuitem" class="mdanger${conf('leave') ? ' on' : ''}" data-act="leavegame"><span>${conf('leave') ? 'Opravdu odejít? Klikni znovu' : 'Opustit hru'}</span></button>`;
    }
    return `<div class="gmenu">
      <button class="btn sm gmenubtn" data-act="gmenu" aria-expanded="${S.gmenu ? 'true' : 'false'}" aria-haspopup="true">Menu <span class="burger" aria-hidden="true"><i></i><i></i><i></i></span></button>
      ${S.gmenu ? `<div class="menudrop" role="menu">
        <button role="menuitem" data-act="explore"><span>Průvodce tahy</span><kbd>G</kbd></button>
        <button role="menuitem" data-act="keys"><span>Klávesové zkratky</span><kbd>?</kbd></button>
        <button role="menuitem" data-act="g-rules"><span>Pravidla</span></button>
        <button role="menuitem" data-act="tutorial"><span>Jak hrát – tutoriál</span></button>
        <hr>
        <div class="mrow"><span class="mlab">Zobrazení</span><div class="seg sm" role="group" aria-label="Rozložení"><button class="btn xs${L.mode === 'map' ? ' on' : ''}" data-act="lay-mode" data-m="map">Mapa</button><button class="btn xs${L.mode === 'split' ? ' on' : ''}" data-act="lay-mode" data-m="split">Obojí</button><button class="btn xs${L.mode === 'panel' ? ' on' : ''}" data-act="lay-mode" data-m="panel">Panel</button></div></div>
        ${L.mode === 'split' && !mobile() ? `<button role="menuitem" data-act="lay-swap"><span>Panel ${L.side === 'right' ? 'vlevo' : 'vpravo'}</span><span class="mhint">⇄</span></button>` : ''}
        <button role="menuitem" data-act="music"><span>Hudba</span><span class="mhint">${MUS.on ? 'zapnuto' : 'vypnuto'}</span></button>
        <hr>
        ${end}
        <button role="menuitem" data-act="home"><span>Zpět na úvodní obrazovku</span></button>
      </div>` : ''}
    </div>`;
  }
  function buildModalHTML(g) {
    if (!g || g.status !== 'play' || !g.state || g.state.type !== 'A' || S.rp || S.view != null) return '';
    const st = g.state; const key = E.phaseKey(st); const needs = E.adjustmentNeeds(st);
    if ((S.buildHide || {})[key]) return '';
    const pws = myPowers(g).filter((p) => needs[p] && !(S.orders[p] && S.orders[p].key === key && S.orders[p].ready));
    if (!pws.length) return '';
    let body = '';
    let allDone = true;
    for (const pw of pws) {
      const n = needs[pw]; const list = draftFor(pw).list;
      if (n > 0) {
        const b = list.filter((x) => x.k === 'B');
        if (b.length < n) allDone = false;
        body += `<section class="bmsec"><h3>${powerChip(pw)} ${esc(E.PNAME[pw])}: ${n === 1 ? 'můžeš postavit 1 novou jednotku' : `můžeš postavit ${n} nové jednotky`}</h3><p class="muted small">Vybráno ${b.length} z ${n}. Stavět jde jen ve vlastních prázdných domovských centrech.</p><ul class="bmlist">`;
        for (const h of E.HOME[pw]) {
          if (st.sc[h] !== pw || E.unitAt(st, h)) continue;
          const cur = b.find((x) => x.p === h); const full = b.length >= n && !cur;
          const opt = (t, c, label) => { const on = cur && cur.t === t && (cur.c || null) === (c || null); return `<button class="btn${on ? ' on' : ''}" data-act="bm-b" data-pw="${pw}" data-p="${h}" data-t="${t}" ${c ? `data-c="${c}"` : ''} ${full ? 'disabled' : ''}>${label}</button>`; };
          const fl = E.isCoastal(h) ? (E.SPLIT[h] ? Object.keys(E.SPLIT[h]).map((c) => opt('F', c, `⚓ Loďstvo (${E.COAST_CZ[c]})`)).join('') : opt('F', null, '⚓ Loďstvo')) : '';
          body += `<li><span class="bmname">${esc(NAMES[h])}</span><span class="bmopts">${opt('A', null, '⚔ Armáda')}${fl}<button class="btn${!cur ? ' on' : ''}" data-act="bm-none" data-pw="${pw}" data-p="${h}">Nestavět</button></span></li>`;
        }
        body += `</ul></section>`;
      } else {
        const x = list.filter((y) => y.k === 'X'); const need = -n;
        if (x.length < need) allDone = false;
        body += `<section class="bmsec"><h3>${powerChip(pw)} ${esc(E.PNAME[pw])}: ${need === 1 ? 'musíš rozpustit 1 jednotku' : `musíš rozpustit ${need} jednotky`}</h3><p class="muted small">Vybráno ${x.length} z ${need}. Když nevybereš, rozpustí se jednotky nejdál od domova.</p><ul class="bmlist">`;
        for (const u of st.units.filter((y) => y.o === pw)) {
          const on = x.some((y) => y.p === u.p); const full = x.length >= need && !on;
          body += `<li><span class="bmname">${u.t === 'A' ? '⚔ Armáda' : '⚓ Loďstvo'} · ${esc(NAMES[u.p])}</span><span class="bmopts"><button class="btn${on ? ' on danger' : ''}" data-act="bm-x" data-pw="${pw}" data-p="${u.p}" ${full ? 'disabled' : ''}>${on ? 'Rozpustit ✓' : 'Rozpustit'}</button></span></li>`;
        }
        body += `</ul></section>`;
      }
    }
    return `<div class="mlay bmlay" role="dialog" aria-modal="true" aria-label="Zimní stavby"><div class="mbox wide bmbox">
      <div class="mhead"><h2>Zima ${st.year - 0}: stavby a rozpouštění</h2></div>
      <p class="small">Po podzimu se přepočítala centra. Vyber, co postavíš (nebo rozpustíš), a potvrď. ${phaseLimit(g) ? 'Běží odpočet, nezadané stavby propadnou.' : ''}</p>
      ${body}
      <div class="mfoot"><button class="btn ghost" data-act="bm-hide">Rozhodnu později</button><button class="btn primary big" data-act="bm-ok">${allDone ? 'Potvrdit a odevzdat' : 'Potvrdit (zbytek nevyužít)'}</button></div>
    </div></div>`;
  }
  function tgtButtons() {
    const ts = targets(); if (!ts.length) return '';
    const lbl = S.sel && S.sel.mode === 'sup1' ? 'Podpoř:' : S.sel && S.sel.mode === 'conv1' ? 'Armáda:' : 'Kam:';
    return `<div class="tgtrow"><span class="muted small">${lbl}</span>${ts.map((t, i) => `<button class="btn xs${t.vc ? ' vc' : ''}" data-act="tgt" data-i="${i}" title="${esc(NAMES[t.p])}${t.vc ? ' – konvojem' : ''}${t.hold ? ' – podpora držení' : ''}"><b>${t.p}${t.c ? '/' + E.COAST_CZ[t.c] : ''}</b> ${esc(NAMES[t.p].split(' – ')[0])}${t.hold ? ' (drží)' : ''}</button>`).join('')}</div>`;
  }
  function powerChip(p, extra) { return `<span class="pchip pw-${p}">${esc(E.PSHORT[p])}</span>${extra || ''}`; }

  function ordersPane(g) {
    const st = g.state;
    if (g.status === 'over') {
      const rows = PW.map((p) => ({ p, c: E.scCount(st, p) })).sort((a, b) => b.c - a.c);
      return `<div class="over"><h3>${st.winner ? 'Vítězí ' + esc(E.PNAME[st.winner]) : st.ended ? 'Hra ukončena' : 'Hra skončila'}</h3><p class="muted">${st.winner ? `${esc(E.PNAME[st.winner])} ovládá ${E.scCount(st, st.winner)} zásobovacích center.` : `Konečný stav: ${esc(E.phaseName(st))}.`}</p>
        <ol class="final">${rows.map((r) => `<li>${powerChip(r.p)} ${esc(E.PNAME[r.p])} <span class="grow"></span><b>${r.c}</b></li>`).join('')}</ol>
        <p><a href="#" data-act="home">Zpět na seznam her</a></p>${g.createdBy === S.B.uid ? `<button class="btn sm ghost" data-act="delgame">Smazat hru</button>` : ''}</div>`;
    }
    const mine = myPowers(g);
    const key = E.phaseKey(st);
    let html = '';
    if (mine.length > 1) html += `<div class="pwswitch">${mine.map((p) => `<button class="btn sm${S.myPower === p ? ' on' : ''}" data-act="pw" data-p="${p}">${esc(E.PNAME[p])}</button>`).join('')}</div>`;
    const pw = S.myPower;
    if (!pw) html += `<p class="muted">Sleduješ hru jako divák.</p>`;
    else if (!E.alive(st, pw)) html += `<p class="muted">${esc(E.PNAME[pw])} už ve hře nemá žádné jednotky ani centra.</p>`;
    else if (!E.actingPowers(st).includes(pw)) html += `<p class="muted">${esc(E.PNAME[pw])} v této fázi nic nezadává.</p>`;
    else {
      const d = draftFor(pw);
      const doc = S.orders[pw];
      const ready = doc && doc.key === key && doc.ready;
      html += `<div class="ohead">${powerChip(pw)}<span>${esc(E.PNAME[pw])}</span><span class="grow"></span><span class="ostat ${ready ? 'ok' : ''}">${ready ? 'Odevzdáno' : 'Rozepsáno'}</span></div>`;
      html += `<ul class="olist">`;
      if (st.type === 'M') {
        for (const u of st.units.filter((x) => x.o === pw)) {
          const o = d.list.find((x) => x.p === u.p);
          const txt = o ? E.orderText(st, o) : `${u.t === 'A' ? 'A' : 'L'} ${E.loc(u.p, u.c)} D`;
          html += `<li class="${o ? '' : 'dflt'}${S.sel && S.sel.unit && S.sel.unit.p === u.p ? ' cur' : ''}"><button class="orow" data-act="sel" data-p="${u.p}"><span class="otext">${esc(txt)}</span><span class="oname">${esc(NAMES[u.p])}${o ? '' : ' · drží'}</span></button>${o ? `<button class="x" data-act="clr" data-p="${u.p}" aria-label="Smazat rozkaz">×</button>` : ''}</li>`;
        }
      } else if (st.type === 'R') {
        for (const dd of st.dislodged.filter((x) => x.o === pw)) {
          const o = d.list.find((x) => x.p === dd.p);
          const txt = o && o.k === 'R' ? `${dd.t === 'A' ? 'A' : 'L'} ${dd.p} ustoupí – ${E.loc(o.to, o.tc)}` : `${dd.t === 'A' ? 'A' : 'L'} ${dd.p} se rozpustí`;
          html += `<li class="${o ? '' : 'dflt'}"><button class="orow" data-act="sel" data-p="${dd.p}"><span class="otext">${esc(txt)}</span><span class="oname">vytlačena z: ${esc(NAMES[dd.p])}</span></button>${o ? `<button class="x" data-act="clr" data-p="${dd.p}" aria-label="Smazat">×</button>` : ''}</li>`;
        }
      } else if (st.type === 'A') {
        const n = E.adjustmentNeeds(st)[pw];
        if (n > 0) {
          const b = d.list.filter((x) => x.k === 'B');
          html += `<li class="info">Můžeš postavit ${n} ${n === 1 ? 'jednotku' : n < 5 ? 'jednotky' : 'jednotek'} na volných domovských centrech. Zbývá ${n - b.length}. <button class="btn sm primary" data-act="bm-open">Otevřít výběr staveb</button></li>`;
          if (n - b.length > 0) for (const h of E.HOME[pw]) {
            if (st.sc[h] !== pw || E.unitAt(st, h) || b.some((x) => x.p === h)) continue;
            const fl = E.isCoastal(h) ? (E.SPLIT[h] ? Object.keys(E.SPLIT[h]).map((c) => `<button class="btn sm" data-act="bq" data-pw="${pw}" data-p="${h}" data-t="F" data-c="${c}">Loďstvo ${E.COAST_CZ[c]}</button>`).join('') : `<button class="btn sm" data-act="bq" data-pw="${pw}" data-p="${h}" data-t="F">Loďstvo</button>`) : '';
            html += `<li class="bopt"><span class="bn">${esc(NAMES[h])}</span><span class="grow"></span><button class="btn sm" data-act="bq" data-pw="${pw}" data-p="${h}" data-t="A">Armáda</button>${fl}</li>`;
          }
          for (const x of b) html += `<li><span class="orow static"><span class="otext">Postav ${x.t === 'A' ? 'A' : 'L'} ${esc(E.loc(x.p, x.c))}</span><span class="oname">${esc(NAMES[x.p])}</span></span><button class="x" data-act="clrb" data-p="${x.p}" aria-label="Zrušit stavbu">×</button></li>`;
        } else {
          const x = d.list.filter((y) => y.k === 'X');
          html += `<li class="info">Máš o ${-n} ${-n === 1 ? 'jednotku' : 'jednotky'} víc, než uživíš. Klikni na mapě na jednotky k rozpuštění (zbývá ${-n - x.length}). Když nevybereš, rozpustí se ty nejvzdálenější od domova.</li>`;
          for (const y of x) { const u = E.unitAt(st, y.p); html += `<li><span class="orow static"><span class="otext">Rozpusť ${u ? (u.t === 'A' ? 'A' : 'L') : ''} ${esc(y.p)}</span><span class="oname">${esc(NAMES[y.p])}</span></span><button class="x" data-act="clrx" data-p="${y.p}" aria-label="Zrušit">×</button></li>`; }
        }
      }
      html += `</ul>`;
      const warns = st.type === 'M' ? orderWarnings(st, pw, d.list) : [];
      if (warns.length) html += `<ul class="warns">${warns.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`;
      html += `<div class="oact">${ready ? `<button class="btn" data-act="unready">Upravit rozkazy</button>` : `<button class="btn primary" data-act="ready" ${S.canWrite ? '' : 'disabled'}>Odevzdat rozkazy</button>`}</div>`;
    }
    // status of others
    const need = E.actingPowers(st);
    html += `<h4>Kdo už odevzdal</h4><ul class="readyl">${need.map((p) => {
      const bot = isBot(g, p); const o = S.orders[p]; const r = isAI(g, p) ? (o && o.key === key) : bot || (o && o.key === key && o.ready);
      return `<li>${powerChip(p)}<span>${esc(E.PNAME[p])}</span><span class="grow"></span><span class="rs ${r ? 'ok' : ''}">${isAI(g, p) ? (o && o.key === key ? 'AI · hotovo' : 'AI · přemýšlí') : bot ? 'bot' : r ? 'hotovo' : 'píše…'}</span></li>`;
    }).join('')}</ul>`;
    html += aiHostBox(g);
    if (g.createdBy === S.B.uid) html += `<div class="oact tempo-row"><label for="tempo-game" class="small muted">Čas na kolo</label><select id="tempo-game" class="inlsel">${Object.entries(TEMPO).map(([k, t]) => `<option value="${k}"${(g.tempo || 'none') === k ? ' selected' : ''}>${esc(t.s || t.l)}</option>`).join('')}</select><span class="muted small">platí hned</span></div>`;
    if (g.createdBy === S.B.uid) html += `<div class="oact"><button class="btn sm" data-act="force" ${S.resolving ? 'disabled' : ''}>${S.resolving ? 'Vyhodnocuji…' : 'Vyhodnotit hned'}</button><span class="muted small">Chybějící rozkazy = držení.</span></div>`;
    else if (S.resolving) html += `<p class="muted small">Vyhodnocuji kolo…</p>`;
    return html;
  }

  function overviewPane(g, vs) {
    const st = vs || g.state;
    const rows = PW.map((p) => ({ p, c: Object.values(st.sc || {}).filter((x) => x === p).length, u: (st.units || []).filter((x) => x.o === p).length })).sort((a, b) => b.c - a.c);
    return `<table class="ov"><thead><tr><th>Velmoc</th><th>Hráč</th><th class="n">Centra</th><th class="n">Jedn.</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${powerChip(r.p)} ${esc(E.PNAME[r.p])}</td><td>${g.seats && g.seats[r.p] ? esc(nameOf(g.seats[r.p])) : isAI(g, r.p) ? `<span class="muted" title="${esc(g.ai[r.p].persona || '')}">AI diplomat</span>` : '<span class="muted">bot</span>'}</td><td class="n">${r.c}</td><td class="n">${r.u}</td></tr><tr class="barrow"><td colspan="4"><span class="bar pw-${r.p}" style="width:${(r.c / 18 * 100).toFixed(1)}%"></span></td></tr>`).join('')}</tbody></table>
      <p class="muted small">Pruh ukazuje cestu k vítězství: 18 center z 34.</p>
      <h4>Centra</h4><div class="sclist">${E.SC.slice().sort().map((p) => `<span class="sc ${st.sc && st.sc[p] ? 'pw-' + st.sc[p] : 'neutral'}" title="${esc(NAMES[p])}">${p}</span>`).join('')}</div>
      ${phaseLimit(g) ? `<p class="muted small">Časový limit: ${esc(g.tempo ? TEMPO[g.tempo].l : g.deadline + ' h na kolo')}. Po uplynutí se kolo vyhodnotí; kdo nestihl, jeho jednotky drží.</p>` : ''}
      ${g.createdBy === S.B.uid ? `<details class="danger"><summary>Správa hry</summary><button class="btn sm" data-act="delgame">Smazat hru</button></details>` : ''}`;
  }

  function historyPane() {
    if (!S.history.length) return `<p class="muted">Zatím se nehrálo žádné kolo.</p>`;
    let html = `<ul class="hlist">`;
    for (let i = S.history.length - 1; i >= 0; i--) {
      const r = S.history[i];
      html += `<li class="hli${S.view === i ? ' on' : ''}"><button class="hrow" data-act="hist" data-i="${i}"><span>${esc(r.name)}</span><span class="muted small">${(r.orders || []).length} rozkazů</span></button><button class="btn xs hplay" data-act="rp-open" data-i="${i}" title="Přehrát vyhodnocení">▶ Přehrát</button></li>`;
    }
    html += `</ul>`;
    if (S.view != null) {
      const r = S.history[S.view];
      const st = { units: r.units };
      const byPw = {};
      for (const o of r.orders || []) (byPw[o.o || o.pw] = byPw[o.o || o.pw] || []).push(o);
      html += `<h4>${esc(r.name)}</h4>`;
      for (const p of PW) {
        if (!byPw[p]) continue;
        html += `<div class="hpw">${powerChip(p)}<ul>${byPw[p].map((o) => {
          let t, res = r.results ? r.results[o.p] : null;
          if (o.k === 'B') t = `Postaveno ${o.t === 'A' ? 'A' : 'L'} ${E.loc(o.p, o.c)}`;
          else if (o.k === 'X') t = `Rozpuštěno ${o.t === 'A' ? 'A' : 'L'} ${o.p}${o.auto ? ' (automaticky)' : ''}`;
          else if (o.k === 'R') { const rr = o.res || ''; t = `${o.t === 'A' ? 'A' : 'L'} ${o.p} ${rr.startsWith('retreat') ? 'ustoupila – ' + rr.split(':')[1].replace('/NC', '/SP').replace('/SC', '/JP').replace('/EC', '/VP') : 'rozpuštěna'}`; res = null; }
          else t = E.orderText(st, o);
          return `<li class="${res && res !== 'ok' && res !== 'dislodged' ? 'f' : ''}"><span class="otext">${esc(t)}</span>${res ? `<span class="res">${esc(resText(res))}</span>` : ''}</li>`;
        }).join('')}</ul></div>`;
      }
    }
    return html;
  }
  function resText(r) {
    const m = { ok: '', bounce: 'odraženo', cut: 'podpora přerušena', void: 'neodpovídá', invalid: 'neplatné', noconvoy: 'konvoj selhal', disrupted: 'konvoj narušen', dislodged: 'vytlačena' };
    return r.split(' ').map((x) => m[x] != null ? m[x] : x).filter(Boolean).join(', ');
  }

  // ---------- chat
  function chatPane(g) {
    const mine = myPowers(g);
    const opts = [['ALL', 'Všem (veřejně)']].concat(PW.filter((p) => !mine.includes(p) && (!isBot(g, p) || isAI(g, p)) && E.alive(g.state, p)).map((p) => [p, 'Jen ' + E.PNAME[p] + (isAI(g, p) ? ' (AI)' : '')]));
    if (!opts.some((o) => o[0] === S.chatTo)) S.chatTo = 'ALL';
    return `<div class="chat"><div class="msgs" id="msgs"></div>
      ${mine.length ? `<form id="chatf" class="chatf"><select id="chat-to" aria-label="Komu">${opts.map(([v, l]) => `<option value="${v}"${S.chatTo === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <div class="chrow"><input id="chat-in" maxlength="500" placeholder="Navrhni spojenectví…" autocomplete="off"><button class="btn primary" type="submit">Poslat</button></div></form>` : '<p class="muted small">Psát můžou jen hráči.</p>'}
      <p class="muted small">Soukromé zprávy vidí jen adresát. AI diplomaté odpovídají a sami píšou, ale jejich slovo nic neznamená. Jednoduší boti nevyjednávají.</p>${aiHostBox(g)}</div>`;
  }
  function visibleChat() {
    const g = S.game; if (!g) return [];
    const mine = myPowers(g);
    return S.chat.filter((m) => m.to === 'ALL' || mine.includes(m.to) || mine.includes(m.from));
  }
  function renderChat() {
    const box = $('#msgs'); if (!box) return;
    const ms = visibleChat();
    if (!ms.length) { box.innerHTML = `<p class="muted small">Zatím ticho. Diplomacie začíná první zprávou.</p>`; return; }
    box.innerHTML = ms.map((m) => `<div class="msg${m.to !== 'ALL' ? ' priv' : ''}"><div class="mh">${m.from ? powerChip(m.from) : ''}<span class="who">${esc(m.from ? E.PNAME[m.from] : 'Systém')}</span>${m.to !== 'ALL' ? `<span class="to">→ ${esc(E.PNAME[m.to] || '')}</span>` : ''}<span class="grow"></span><span class="when">${esc(m.ph || '')}</span></div><div class="mt"></div></div>`).join('');
    const nodes = box.querySelectorAll('.mt'); ms.forEach((m, i) => { nodes[i].textContent = m.text; });
    box.scrollTop = box.scrollHeight;
    S.chatSeen = ms.length; lsSet('velmoci-seen-' + S.gid, ms.length);
  }
  function updateTabs() {
    const b = $('#chatbadge'); if (!b) return;
    const n = visibleChat().length; const seen = S.tab === 'chat' ? n : lsGet('velmoci-seen-' + S.gid, 0);
    b.textContent = n > seen ? String(n - seen) : '';
  }

  function fmtLeft(ms) {
    if (ms >= 3600e3) { const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3); return `${h} h ${m} min`; }
    const m = Math.floor(ms / 60e3), sec = Math.floor((ms % 60e3) / 1000); return `${m}:${String(sec).padStart(2, '0')}`;
  }
  function tickClock() {
    const el = $('#clock'); const g = S.game; if (!el) return;
    if (!g || g.status !== 'play' || !g.state) { el.innerHTML = ''; return; }
    const tl = timeLeft(g);
    if (tl == null) { el.innerHTML = ''; el.className = 'clock'; return; }
    const what = g.state.type === 'M' ? 'jednání a rozkazy' : g.state.type === 'R' ? 'ústupy' : 'stavby';
    const host = g.createdBy === S.B.uid && phaseLimit(g) <= 3600e3;
    el.className = 'clock' + (g.paused != null ? ' paused' : tl < 120e3 ? ' hurry' : '');
    el.innerHTML = `<span class="cl-l">${g.paused != null ? 'pauza' : tl <= 0 ? 'čas vypršel' : what}</span><span class="cl-t">${fmtLeft(Math.max(0, tl))}</span>${host ? `<button class="btn sm ghost cl-b" data-act="pause">${g.paused != null ? 'Pokračovat' : 'Pauza'}</button>` : ''}`;
    const b = el.querySelector('[data-act]'); if (b) b.addEventListener('click', onAct);
  }

  // ---------- table (game lobby) + draw reveal
  function cardBack(i) { return `<div class="cback" style="--i:${i}"><span>V</span></div>`; }
  function renderSeats(root, g) {
    const creator = g.createdBy === S.B.uid;
    const players = Object.keys(g.players || {});
    const seated = !!(g.players && g.players[S.B.uid]);
    root.innerHTML = header(`<span class="gtitle">${esc(g.name || '')}</span><span class="phase">Čeká se na los</span>`) + `
      <main class="seatsv">
        <div class="seathead"><h1>${esc(g.name || 'Nová hra')}</h1><p>Přisedni ke stolu a pošli přátelům odkaz na tuhle stránku. Až budou všichni, zakladatel zamíchá karty a každému se vylosuje jedna velmoc. Zbylé převezmou ${g.fill === 'bot' ? 'jednoduší boti' : 'AI diplomaté, kteří vyjednávají, blafují a zrazují jako lidé'}.</p></div>
        <div class="deck" aria-hidden="true">${PW.map((_, i) => cardBack(i)).join('')}</div>
        <h2>U stolu (${players.length} z 7)</h2>
        <ul class="plist">${players.map((u) => `<li><span class="pdot"></span>${esc(nameOf(u))}${u === g.createdBy ? ' <span class="muted small">zakladatel</span>' : ''}</li>`).join('') || '<li class="muted">Zatím nikdo.</li>'}</ul>
        <div class="seatfoot">
          ${seated ? (creator ? '' : `<button class="btn" data-act="leave">Odejít od stolu</button>`) : `<button class="btn primary" data-act="join" ${S.canWrite && players.length < 7 ? '' : 'disabled'}>Přisednout ke stolu</button>`}
          ${creator ? `<button class="btn primary big" data-act="start" ${players.length ? '' : 'disabled'}>Zamíchat a losovat země</button>
            <label class="inl" for="fill-sel">Volná místa:</label><select id="fill-sel" class="inlsel"><option value="ai"${g.fill !== 'bot' ? ' selected' : ''}>AI diplomaté</option><option value="bot"${g.fill === 'bot' ? ' selected' : ''}>jednoduší boti</option></select>
            <label class="inl" for="tempo-sel">Čas:</label><select id="tempo-sel" class="inlsel">${Object.entries(TEMPO).map(([k, t]) => `<option value="${k}"${(g.tempo || 'none') === k ? ' selected' : ''}>${esc(t.l)}</option>`).join('')}</select>
            <button class="btn sm ghost" data-act="delgame">Smazat hru</button>` : `<span class="muted">Losovat bude zakladatel hry. Čas: ${esc(TEMPO[g.tempo || 'none'].l)}.</span>`}
        </div>
        ${S.B.kind === 'db' ? `<p class="muted small">Spoluhráči potřebují k téhle stránce přístup s právem zápisu (Editor, nebo Contributor ve tvé organizaci).</p>` : ''}
      </main>`;
    bind(root);
    const ts = $('#tempo-sel', root); if (ts) ts.addEventListener('change', () => S.B.updateGame(S.gid, { tempo: ts.value }).catch(() => {}));
    const fs = $('#fill-sel', root); if (fs) fs.addEventListener('change', () => S.B.updateGame(S.gid, { fill: fs.value }).catch(() => {}));
  }

  function revealHTML(g) {
    const mine = myPowers(g);
    if (!mine.length || !g.drawAt || g.status !== 'play') return '';
    if (lsGet('velmoci-rev-' + g.id, 0) === g.drawAt) return '';
    const card = (p) => {
      const units = E.initialState().units.filter((u) => u.o === p);
      return `<div class="pcard pw-${p}"><div class="pc-in"><div class="pc-face pc-front"><span>V</span></div><div class="pc-face pc-back">
        <div class="pc-title">${esc(E.PNAME[p].toUpperCase())}</div>
        <div class="pc-sec">Domovská centra</div><div class="pc-txt">${E.HOME[p].map((h) => esc(NAMES[h])).join(', ')}</div>
        <div class="pc-sec">Výchozí jednotky</div><div class="pc-units">${units.map((u) => `<div>${u.t === 'A' ? 'A' : 'L'} ${u.p}${u.c ? '/' + E.COAST_CZ[u.c] : ''} <span>${u.t === 'A' ? 'armáda' : 'loďstvo'} ${esc(NAMES[u.p])}</span></div>`).join('')}</div>
        <div class="pc-foot">D drží · – táhne · P podporuje · K převáží</div></div></div></div>`;
    };
    const others = PW.filter((p) => !mine.includes(p)).map((p) => `<li>${powerChip(p)} ${esc(E.PNAME[p])}: ${g.seats[p] ? esc(nameOf(g.seats[p])) : isAI(g, p) ? 'AI diplomat' : 'bot'}</li>`).join('');
    const hasAI = PW.some((p) => isAI(g, p));
    return `<div class="reveal" role="dialog" aria-modal="true" aria-label="Výsledek losování"><div class="rv-box">
      <div class="rv-kicker">Los padl</div>
      <h2 class="rv-h">Hraješ za ${mine.map((p) => esc(E.PNAME[p])).join(' a ')}</h2>
      <div class="rv-cards">${mine.map(card).join('')}</div>
      <ul class="rv-others">${others}</ul>
      <div class="rv-act"><button class="btn primary big" data-act="rv-go">Do boje</button>${hasAI && SAMPLE ? `<label class="rv-ai"><input type="checkbox" id="rv-ai" ${lsGet('velmoci-aihost-' + g.id, false) ? 'checked' : ''}> Hostit AI diplomaty na tomhle zařízení</label>` : ''}</div>
    </div></div>`;
  }

  // ------------------------------------------------------------------ events
  function flash(msg) {
    let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('on'); clearTimeout(S.toastT); S.toastT = setTimeout(() => t.classList.remove('on'), 3200);
  }

  function bind(root) {
    root.querySelectorAll('[data-act]').forEach((el) => el.addEventListener('click', onAct));
    root.querySelectorAll('[data-tab]').forEach((el) => el.addEventListener('click', () => { if (S.L.float === el.dataset.tab && !mobile()) { S.L.float = null; saveL(); } S.tab = el.dataset.tab; lsSet('velmoci-tab', S.tab); render(); }));
    const ng = $('#newgame', root); if (ng) ng.addEventListener('submit', createGame);
    const svg = $('#mapsvg', root); if (svg) svg.addEventListener('click', onMapClick);
    const mw = $('#mapwrap', root); if (mw) bindPan(mw);
    const cf = $('#chatf', root); if (cf) cf.addEventListener('submit', sendChat);
    const tg = $('#tempo-game', root);
    if (tg) tg.addEventListener('change', () => { const g = S.game; const patch = { tempo: tg.value }; if (g.paused != null) patch.paused = null; S.B.updateGame(S.gid, patch).then(() => flash('Čas na kolo: ' + (TEMPO[tg.value].s || TEMPO[tg.value].l))).catch(() => flash('Nepovedlo se změnit tempo.')); });
    const ct = $('#chat-to', root); if (ct) ct.addEventListener('change', () => { S.chatTo = ct.value; });
  }

  async function createGame(ev) {
    ev.preventDefault();
    const name = ($('#ng-name').value || '').trim() || 'Partie ' + new Date().toLocaleDateString('cs-CZ');
    const mode = $('#ng-mode').value; const fill = $('#ng-fill').value; const tempo = $('#ng-dl').value;
    const seats = {}; for (const p of PW) seats[p] = '';
    const data = { name, created: Date.now(), createdBy: S.B.uid, status: 'lobby', players: { [S.B.uid]: Date.now() }, fill, seats, bots: {}, ai: {}, tempo, deadline: 0, paused: null, phaseAt: 0, seq: 0, state: E.initialState() };
    if (mode === 'now') { Object.assign(data, drawPowers(data), { status: 'play', phaseAt: Date.now(), drawAt: Date.now() }); }
    try { const id = await S.B.create(data); if (fill === 'ai') lsSet('velmoci-aihost-' + id, true); openGame(id); } catch (e) { flash('Hru se nepodařilo založit. Máš k této stránce právo zápisu?'); }
  }

  async function sendChat(ev) {
    ev.preventDefault();
    const inp = $('#chat-in'); const text = (inp.value || '').trim(); if (!text) return;
    const g = S.game; const from = S.myPower || myPowers(g)[0]; if (!from) return;
    inp.value = '';
    try { await S.B.addSub(S.gid, 'chat', { from, to: S.chatTo, text, t: Date.now(), uid: S.B.uid, ph: E.phaseName(g.state).split(' · ')[0] }); }
    catch (e) { flash('Zprávu se nepodařilo odeslat.'); inp.value = text; }
  }

  function setZoom(z, cx, cy) {
    z = Math.max(1, Math.min(3, +z.toFixed(2))); if (z === S.zoom) return;
    const w = $('#mapwrap'); let rx = 0.5, ry = 0.5, ox = 0, oy = 0;
    if (w) { ox = cx != null ? cx : w.clientWidth / 2; oy = cy != null ? cy : w.clientHeight / 2; rx = (w.scrollLeft + ox) / w.scrollWidth; ry = (w.scrollTop + oy) / w.scrollHeight; }
    S.zoom = z; lsSet('velmoci-zoom', z); S.keepScroll = false; render();
    const w2 = $('#mapwrap'); if (w2) { w2.scrollLeft = rx * w2.scrollWidth - ox; w2.scrollTop = ry * w2.scrollHeight - oy; }
  }
  function bindPan(w) {
    let st = null;
    w.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' || e.button !== 0) return; st = { x: e.clientX, y: e.clientY, l: w.scrollLeft, t: w.scrollTop, moved: false }; });
    w.addEventListener('pointermove', (e) => { if (!st) return; const dx = e.clientX - st.x, dy = e.clientY - st.y; if (!st.moved && Math.hypot(dx, dy) > 6) { st.moved = true; w.classList.add('drag'); } if (st.moved) { w.scrollLeft = st.l - dx; w.scrollTop = st.t - dy; } });
    const end = () => { if (st && st.moved) { S.dragged = Date.now(); } st = null; w.classList.remove('drag'); };
    w.addEventListener('pointerup', end); w.addEventListener('pointerleave', end);
    w.addEventListener('wheel', (e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); const r = w.getBoundingClientRect(); setZoom(S.zoom + (e.deltaY < 0 ? 0.25 : -0.25), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    w.addEventListener('dblclick', (e) => { const r = w.getBoundingClientRect(); setZoom(S.zoom >= 2 ? 1 : S.zoom + 1, e.clientX - r.left, e.clientY - r.top); });
  }
  async function onAct(ev) {
    try { await onActInner(ev); } catch (e) { console.error(e); flash('Akce se nepovedla: ' + ((e && (e.message || e.code)) || 'neznámá chyba')); }
  }
  async function onActInner(ev) {
    const el = ev.currentTarget; const a = el.dataset.act; const p = el.dataset.p; const g = S.game;
    if (a === 'modal-bg' && ev.target !== el) return;
    ev.preventDefault();
    switch (a) {
      case 'home': S.gmenu = false; closeGame(); break;
      case 'zoom-in': setZoom(S.zoom + 0.5); break;
      case 'zoom-out': setZoom(S.zoom - 0.5); break;
      case 'sel': selectAt(p); break;
      case 'clr': clearUnitOrder(S.myPower, p); break;
      case 'clrb': { const d = draftFor(S.myPower); setDraft(S.myPower, d.list.filter((x) => !(x.k === 'B' && x.p === p)), false); break; }
      case 'clrx': { const d = draftFor(S.myPower); setDraft(S.myPower, d.list.filter((x) => !(x.k === 'X' && x.p === p)), false); break; }
      case 'pw': S.myPower = p; S.sel = null; render(); break;
      case 'ready': setDraft(S.myPower, draftFor(S.myPower).list, true); S.sel = null; break;
      case 'unready': setDraft(S.myPower, draftFor(S.myPower).list, false); break;
      case 'force': maybeResolve(true); break;
      case 'm-move': S.sel.mode = 'move'; render(); break;
      case 'm-hold': setUnitOrder(S.sel.unit.o, { p: S.sel.unit.p, k: 'H' }); S.sel = null; render(); break;
      case 'm-sup': S.sel = { unit: S.sel.unit, mode: 'sup1' }; render(); break;
      case 'm-conv': S.sel = { unit: S.sel.unit, mode: 'conv1' }; render(); break;
      case 'm-cancel': S.sel = null; render(); break;
      case 'r-disband': setUnitOrder(S.sel.d.o, { p: S.sel.d.p, k: 'X' }); S.sel = null; render(); break;
      case 'b-A': case 'b-F': addBuild(S.sel.pw, S.sel.p, a === 'b-A' ? 'A' : 'F', el.dataset.c); break;
      case 'bq': addBuild(el.dataset.pw, p, el.dataset.t, el.dataset.c); break;
      case 'leavegame': {
        if (!(S.confirm === 'leave' && Date.now() - S.confirmAt < 6000)) { S.confirm = 'leave'; S.confirmAt = Date.now(); render(); setTimeout(render, 6100); break; }
        S.confirm = null;
        const fresh = await S.B.getGame(S.gid); if (!fresh) break;
        const pers = shuffle(PERSONAS.slice());
        fresh.ai = fresh.ai || {}; fresh.bots = fresh.bots || {};
        for (const p of PW) if (fresh.seats[p] === S.B.uid) { fresh.seats[p] = ''; if (fresh.fill === 'bot') fresh.bots[p] = true; else fresh.ai[p] = { persona: pers.pop() }; }
        await S.B.setGame(S.gid, fresh).then(() => { flash('Odešel jsi ze hry. Tvou velmoc převzal počítač.'); closeGame(); }).catch(() => flash('Nepovedlo se.')); break;
      }
      case 'endgame': {
        if (!(S.confirm === 'end' && Date.now() - S.confirmAt < 6000)) { S.confirm = 'end'; S.confirmAt = Date.now(); render(); setTimeout(render, 6100); break; }
        S.confirm = null;
        const fresh = await S.B.getGame(S.gid); if (!fresh) break;
        fresh.status = 'over'; fresh.state.over = true; fresh.state.ended = true; fresh.endedAt = Date.now();
        await S.B.setGame(S.gid, fresh).catch(() => flash('Hru se nepodařilo ukončit.')); break;
      }
      case 'hist': S.view = +el.dataset.i; S.sel = null; render(); break;
      case 'hist-last': { let k = S.history.length - 1; while (k > 0 && !S.history[k].key.endsWith('M')) k--; rpOpen(k, true); break; }
      case 'bm-b': addBuild(el.dataset.pw, p, el.dataset.t, el.dataset.c || null); break;
      case 'bm-none': { const d = draftFor(el.dataset.pw); setDraft(el.dataset.pw, d.list.filter((x) => !(x.k === 'B' && x.p === p)), false); break; }
      case 'bm-x': { const pw = el.dataset.pw; const d = draftFor(pw); const has = d.list.some((x) => x.k === 'X' && x.p === p); setDraft(pw, has ? d.list.filter((x) => !(x.k === 'X' && x.p === p)) : d.list.concat([{ k: 'X', p }]), false); break; }
      case 'bm-ok': { const st = g.state; const key = E.phaseKey(st); const needs = E.adjustmentNeeds(st); for (const pw of myPowers(g)) if (needs[pw]) setDraft(pw, draftFor(pw).list, true); S.buildHide = S.buildHide || {}; S.buildHide[key] = true; flash('Stavby odevzdány.'); render(); break; }
      case 'bm-hide': { S.buildHide = S.buildHide || {}; S.buildHide[E.phaseKey(g.state)] = true; render(); break; }
      case 'bm-open': { S.buildHide = S.buildHide || {}; delete S.buildHide[E.phaseKey(g.state)]; render(); break; }
      case 'rp-open': rpOpen(+el.dataset.i, true); break;
      case 'rp-close': rpClose(); break;
      case 'rp-play': if (S.rp) { S.rp.playing = !S.rp.playing; if (S.rp.playing && S.rp.step >= S.rp.data.steps - 1) rpGo(0, false); rpSchedule(); } break;
      case 'rp-next': if (S.rp) { S.rp.playing = false; clearTimeout(S.rpT); rpGo(S.rp.step + 1, true); } break;
      case 'rp-prev': if (S.rp) { S.rp.playing = false; clearTimeout(S.rpT); rpGo(S.rp.step - 1, true); } break;
      case 'rp-go': if (S.rp) { S.rp.playing = false; clearTimeout(S.rpT); rpGo(+el.dataset.s, true); } break;
      case 'rp-prevrec': if (S.rp && S.rp.i > 0) rpOpen(S.rp.i - 1, false); break;
      case 'rp-nextrec': if (S.rp && S.rp.i < S.history.length - 1) rpOpen(S.rp.i + 1, true); break;
      case 'rp-speed': if (S.rp) { S.rp.speed = el.dataset.s; lsSet('velmoci-rpspeed', S.rp.speed); render(); rpSchedule(); } break;
      case 'hist-prev': if (S.view > 0) { S.view--; render(); } break;
      case 'hist-next': if (S.view < S.history.length - 1) S.view++; else S.view = null; render(); break;
      case 'hist-off': S.view = null; render(); break;
      case 'join': await S.B.updateGame(S.gid, { players: { [S.B.uid]: Date.now() } }).catch(() => flash('Nepodařilo se přisednout. Máš k této stránce právo zápisu?')); break;
      case 'leave': {
        const fresh = await S.B.getGame(S.gid); if (!fresh) break;
        const pl = Object.assign({}, fresh.players); delete pl[S.B.uid];
        await S.B.setGame(S.gid, Object.assign(fresh, { players: pl })).catch(() => flash('Nepovedlo se.')); break;
      }
      case 'start': {
        try {
          const lease = await S.B.acquire(S.gid); if (lease && lease.acquired === false) { flash('Zkus to za chvíli.'); break; }
          const fresh = await S.B.getGame(S.gid); if (!fresh || fresh.status !== 'lobby') break;
          Object.assign(fresh, drawPowers(fresh), { status: 'play', phaseAt: Date.now(), drawAt: Date.now(), state: E.initialState() });
          await S.B.setGame(S.gid, fresh);
        } catch (e) { flash('Hru se nepodařilo spustit.'); }
        break;
      }
      case 'rv-go': {
        const cb = $('#rv-ai'); if (cb) lsSet('velmoci-aihost-' + S.gid, cb.checked);
        lsSet('velmoci-rev-' + S.gid, g.drawAt); render(); aiTick(); break;
      }
      case 'pause': {
        const lim = phaseLimit(g); if (!lim) break;
        if (g.paused != null) await S.B.updateGame(S.gid, { paused: null, phaseAt: Date.now() - (lim - g.paused) }).catch(() => {});
        else await S.B.updateGame(S.gid, { paused: Math.max(0, timeLeft(g)) }).catch(() => {});
        break;
      }
      case 'side': S.side = !S.side; lsSet('velmoci-side', S.side); render(); break;
      case 'explore': S.menu = false; S.gmenu = false; S.modal = null; S.explore = true; S.ex = S.ex || { t: 'A', p: null, c: null }; S.sel = null; render(); break;
      case 'ex-close': S.explore = false; try { if (location.hash === '#mapa') history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ } render(); break;
      case 'ex-t': S.ex.t = el.dataset.t; S.ex.c = null; render(); break;
      case 'ex-c': S.ex.c = el.dataset.c; render(); break;
      case 'keys': S.menu = false; S.gmenu = false; S.keys = true; render(); break;
      case 'keys-off': if (ev.target.closest('[data-stop]') && !ev.target.closest('.btn')) break; S.keys = false; render(); break;
      case 'tgt': { const t = targets()[+el.dataset.i]; if (t) pickTarget(t); break; }
      case 'tutorial': S.menu = false; S.gmenu = false; S.rulesModal = false; S.modal = null; openTutorial(0); break;
      case 'menu': S.menu = !S.menu; render(); break;
      case 'music': musToggle(); if (S.gmenu) render(); break;
      case 'gmenu': S.gmenu = !S.gmenu; render(); break;
      case 'g-rules': S.gmenu = false; S.rulesModal = true; render(); break;
      case 'rules-off': if (ev.target.closest('[data-stop]') && !ev.target.closest('.btn')) break; S.rulesModal = false; render(); break;
      case 'modal-new': S.menu = false; S.modal = 'new'; render(); break;
      case 'modal-games': S.menu = false; S.modal = 'games'; render(); break;
      case 'modal-off': S.modal = null; render(); break;
      case 'modal-bg': if (ev.target === el) { S.modal = null; render(); } break;
      case 'to-lobby': { const l = $('#lobby'); if (l) l.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); break; }
      case 'tut-go': S.tutI = +el.dataset.i; tutReset(); S.tutFocus = true; render(); break;
      case 'tut-prev': if (S.tutI > 0) { S.tutI--; tutReset(); S.tutFocus = true; render(); } break;
      case 'tut-next': if (S.tutI < TUT.length - 1) { S.tutI++; tutReset(); S.tutFocus = true; render(); } break;
      case 'tut-close': S.tutorial = false; try { if (location.hash === '#tutorial') history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ } render(); break;
      case 'tut-explore': S.tutorial = false; S.explore = true; S.ex = S.ex || { t: 'A', p: null, c: null }; render(); break;
      case 'tut-resolve': tutResolve(); break;
      case 'tut-again': tutReset(); render(); break;
      case 'tut-pl': S.tut.place = +el.dataset.i; S.tutFocusPt = ctrOf(tutStep().places[S.tut.place][0], null); render(); break;
      case 'tut-op': S.tut.op = p; S.tut.phase = 'before'; S.tut.res = null; render(); break;
      case 'lay-mode': S.L.mode = el.dataset.m; saveL(); S.gmenu = false; render(); break;
      case 'lay-swap': S.gmenu = false; S.L.side = S.L.side === 'right' ? 'left' : 'right'; saveL(); render(); break;
      case 'lay-float': { const cur = S.tab === S.L.float ? TABS.map((t) => t[0]).find((t) => t !== S.L.float) : S.tab; S.L.float = cur; S.L.fx = null; S.tab = TABS.map((t) => t[0]).find((t) => t !== cur); if (S.L.mode === 'panel') S.L.mode = 'split'; saveL(); render(); break; }
      case 'lay-dock': S.tab = S.L.float; S.L.float = null; saveL(); render(); break;
      case 'lay-close': S.L.float = null; saveL(); render(); break;
      case 'aihost': lsSet('velmoci-aihost-' + S.gid, !lsGet('velmoci-aihost-' + S.gid, false)); S.aiOff = false; render(); aiTick(); break;
      case 'dellist': {
        const id = el.dataset.id;
        if (!(S.confirm === 'del-' + id && Date.now() - S.confirmAt < 6000)) { S.confirm = 'del-' + id; S.confirmAt = Date.now(); render(); setTimeout(render, 6100); break; }
        S.confirm = null;
        await S.B.removeGame(id).then(() => flash('Hra smazána.')).catch(() => flash('Smazání se nepovedlo.')); break;
      }
      case 'delgame': {
        if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Opravdu smazat? Klikni znovu'; break; }
        await S.B.removeGame(S.gid).catch(() => flash('Smazání se nepovedlo.')); closeGame(); break;
      }
    }
  }
  document.addEventListener('click', (e) => { if (S.menu && !(e.target.closest && e.target.closest('.topmenu'))) { S.menu = false; render(); } if (S.gmenu && !(e.target.closest && e.target.closest('.gmenu'))) { S.gmenu = false; render(); } });
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
    const g = S.game; const k = e.key.toLowerCase();
    if (k === 'escape' && S.keys) { S.keys = false; render(); return; }
    if (k === 'escape' && S.rulesModal) { S.rulesModal = false; render(); return; }
    if (S.rp && S.gid && !S.keys) {
      if (k === 'escape') { rpClose(); return; }
      if (k === ' ' || k === 'spacebar') { e.preventDefault(); S.rp.playing = !S.rp.playing; if (S.rp.playing && S.rp.step >= S.rp.data.steps - 1) rpGo(0, false); rpSchedule(); return; }
      if (k === 'arrowright') { S.rp.playing = false; clearTimeout(S.rpT); rpGo(S.rp.step + 1, true); return; }
      if (k === 'arrowleft') { S.rp.playing = false; clearTimeout(S.rpT); rpGo(S.rp.step - 1, true); return; }
      return;
    }
    if (k === 'escape' && (S.modal || S.menu || S.gmenu)) { S.modal = null; S.menu = false; S.gmenu = false; render(); return; }
    if (S.tutorial) {
      const st = tutStep(), T = S.tut;
      if (k === '?') { S.keys = !S.keys; if (st.free) T.done.help = 1; render(); return; }
      if (k === '+' || k === '=' || k === '-') { setZoom(S.zoom + (k === '-' ? -0.5 : 0.5)); if (st.free) { T.done.zoom = 1; render(); } return; }
      if (st.free && T.phase === 'before') {
        const mine = tutUnits().filter((x) => x.o === st.me);
        if (k === 'n' || k === 'tab') { e.preventDefault(); const cur = T.sel ? mine.findIndex((x) => x.p === T.sel.unit.p) : -1; T.sel = { unit: mine[(cur + 1) % mine.length], mode: 'move' }; T.done.n = 1; render(); return; }
        if (T.sel && k === 't') { T.sel = { unit: T.sel.unit, mode: 'move' }; render(); return; }
        if (T.sel && (k === 'd' || k === 'h')) { T.orders = T.orders.filter((x) => x.p !== T.sel.unit.p).concat([{ o: st.me, p: T.sel.unit.p, k: 'H' }]); T.sel = null; T.done.d = 1; render(); return; }
        if (T.sel && (k === 'p' || k === 's')) { T.sel = { unit: T.sel.unit, mode: 'sup1' }; render(); return; }
        if (T.sel && k === 'escape') { T.sel = null; T.done.esc = 1; render(); return; }
        if (k === 'enter' && e.shiftKey) { T.done.submit = 1; tutResolve(); return; }
      }
      if (k === 'escape') { S.tutorial = false; render(); }
      else if (k === 'arrowright' && S.tutI < TUT.length - 1) { S.tutI++; tutReset(); S.tutFocus = true; render(); }
      else if (k === 'arrowleft' && S.tutI > 0) { S.tutI--; tutReset(); S.tutFocus = true; render(); }
      return;
    }
    if (k === '?') { S.keys = !S.keys; render(); return; }
    if (k === 'g' && !S.explore) { S.explore = true; S.ex = S.ex || { t: 'A', p: null, c: null }; render(); return; }
    if (S.explore) {
      if (k === 'escape') { S.explore = false; render(); }
      else if (k === 'a' || k === 'l' || k === 'f') { S.ex.t = k === 'a' ? 'A' : 'F'; S.ex.c = null; render(); }
      else if (k === '+' || k === '=') setZoom(S.zoom + 0.5); else if (k === '-') setZoom(S.zoom - 0.5);
      return;
    }
    if (k === 'escape') { if (S.sel) { S.sel = null; render(); } else if (S.view != null) { S.view = null; render(); } return; }
    if (!g || !S.gid || S.keys) return;
    if (k === '+' || k === '=') { setZoom(S.zoom + 0.5); return; }
    if (k === '-') { setZoom(S.zoom - 0.5); return; }
    if (k === 'm') { if (S.gid && !S.explore && !S.tutorial) { S.L.mode = S.L.mode === 'map' ? 'split' : 'map'; saveL(); } else { S.side = !S.side; lsSet('velmoci-side', S.side); } render(); return; }
    if (g.status !== 'play' || S.view != null) return;
    const st = g.state;
    if (k === 'n' || k === 'tab') {
      // next own unit (prefers units without an order)
      e.preventDefault();
      const pw = S.myPower; if (!pw) return;
      const pool = st.type === 'R' ? st.dislodged.filter((d) => d.o === pw) : st.type === 'M' ? st.units.filter((u) => u.o === pw) : [];
      if (!pool.length) return;
      const has = new Set(draftFor(pw).list.map((o) => o.p));
      const cur = S.sel && S.sel.unit ? pool.findIndex((u) => u.p === S.sel.unit.p) : -1;
      const order = pool.slice(cur + 1).concat(pool.slice(0, cur + 1));
      const next = order.find((u) => !has.has(u.p)) || order[0];
      selectAt(next.p); return;
    }
    if (st.type === 'M' && S.sel && S.sel.unit) {
      const u = S.sel.unit;
      if (k === 't') { S.sel = { unit: u, mode: 'move' }; render(); }
      else if (k === 'd' || k === 'h') { setUnitOrder(u.o, { p: u.p, k: 'H' }); S.sel = null; render(); }
      else if (k === 'p' || k === 's') { S.sel = { unit: u, mode: 'sup1' }; render(); }
      else if ((k === 'k' || k === 'c') && u.t === 'F' && E.isSea(u.p)) { S.sel = { unit: u, mode: 'conv1' }; render(); }
      else if (k === 'delete' || k === 'backspace') { clearUnitOrder(u.o, u.p); S.sel = null; render(); }
      return;
    }
    if (st.type === 'R' && S.sel && S.sel.d && (k === 'x' || k === 'r')) { setUnitOrder(S.sel.d.o, { p: S.sel.d.p, k: 'X' }); S.sel = null; render(); return; }
    if (st.type === 'A' && S.sel && S.sel.mode === 'buildpick') {
      if (k === 'a') addBuild(S.sel.pw, S.sel.p, 'A');
      else if (k === 'l' || k === 'f') { if (E.isCoastal(S.sel.p)) addBuild(S.sel.pw, S.sel.p, 'F', E.SPLIT[S.sel.p] ? 'SC' : null); }
      return;
    }
    if (k === 'enter' && e.shiftKey && S.myPower) { setDraft(S.myPower, draftFor(S.myPower).list, true); S.sel = null; }
  });
  boot();
})();


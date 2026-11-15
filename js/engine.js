// Velmoci 1901 – herní engine (mapa, rozhodčí, ústupy, stavby, bot)
(function (root) {
  const D = root.VDATA;
  const POWERS = ['RAK', 'ANG', 'FRA', 'NEM', 'ITA', 'RUS', 'TUR'];
  const PNAME = { RAK: 'Rakousko-Uhersko', ANG: 'Anglie', FRA: 'Francie', NEM: 'Německo', ITA: 'Itálie', RUS: 'Rusko', TUR: 'Turecko' };
  const PSHORT = { RAK: 'RAK', ANG: 'ANG', FRA: 'FRA', NEM: 'NĚM', ITA: 'ITA', RUS: 'RUS', TUR: 'TUR' };
  const HOME = {
    RAK: ['BUD', 'TRI', 'VIE'], ANG: ['EDI', 'LON', 'LVP'], FRA: ['BRE', 'MAR', 'PAR'], NEM: ['BER', 'KIE', 'MUN'],
    ITA: ['NAP', 'ROM', 'VEN'], RUS: ['MOS', 'SEV', 'STP', 'WAR'], TUR: ['ANK', 'CON', 'SMY'],
  };
  const NEUTRAL = ['BEL', 'BUL', 'DEN', 'GRE', 'HOL', 'NWY', 'POR', 'RUM', 'SER', 'SPA', 'SWE', 'TUN'];
  const SC = [].concat(...Object.values(HOME), NEUTRAL);
  const START_UNITS = [
    ['RAK', 'A', 'VIE'], ['RAK', 'A', 'BUD'], ['RAK', 'F', 'TRI'],
    ['ANG', 'F', 'LON'], ['ANG', 'F', 'EDI'], ['ANG', 'A', 'LVP'],
    ['FRA', 'F', 'BRE'], ['FRA', 'A', 'PAR'], ['FRA', 'A', 'MAR'],
    ['NEM', 'F', 'KIE'], ['NEM', 'A', 'BER'], ['NEM', 'A', 'MUN'],
    ['ITA', 'F', 'NAP'], ['ITA', 'A', 'ROM'], ['ITA', 'A', 'VEN'],
    ['RUS', 'F', 'STP', 'SC'], ['RUS', 'A', 'MOS'], ['RUS', 'A', 'WAR'], ['RUS', 'F', 'SEV'],
    ['TUR', 'F', 'ANK'], ['TUR', 'A', 'CON'], ['TUR', 'A', 'SMY'],
  ];
  const ADJ = D.adj;
  const SEA = new Set(D.seas);
  const INLAND = new Set(D.inland);
  const isSea = (p) => SEA.has(p);
  const isLand = (p) => !SEA.has(p);
  const isCoastal = (p) => isLand(p) && !INLAND.has(p);
  const SPLIT = {
    STP: { NC: ['BAR', 'NWY'], SC: ['BOT', 'FIN', 'LVN'] },
    SPA: { NC: ['GAS', 'MAO', 'POR'], SC: ['LYO', 'MAO', 'MAR', 'POR', 'WES'] },
    BUL: { EC: ['BLA', 'CON', 'RUM'], SC: ['AEG', 'CON', 'GRE'] },
  };
  const COAST_CZ = { NC: 'SP', SC: 'JP', EC: 'VP' };
  const COAST_FROM_CZ = { SP: 'NC', JP: 'SC', VP: 'EC', NC: 'NC', SC: 'SC', EC: 'EC' };
  const NO_FLEET = new Set(['ANK-SMY', 'APU-ROM', 'ARM-SMY', 'ARM-SYR', 'EDI-LVP', 'FIN-NWY', 'GAS-MAR', 'LVP-YOR', 'PIE-VEN', 'ROM-VEN', 'TUS-VEN', 'WAL-YOR']);
  const pairKey = (a, b) => (a < b ? a + '-' + b : b + '-' + a);

  // Fleet locations: "PROV" or "PROV/NC"
  function fleetNeighbors(p, c) {
    if (SPLIT[p]) {
      if (!c) return [];
      return SPLIT[p][c].map((q) => ({ p: q, c: null })).flatMap((x) => expandCoast(p, x.p));
    }
    const out = [];
    for (const q of ADJ[p]) {
      if (isSea(p)) {
        if (isSea(q)) out.push({ p: q, c: null });
        else if (isCoastal(q)) {
          if (SPLIT[q]) for (const cc in SPLIT[q]) { if (SPLIT[q][cc].includes(p)) out.push({ p: q, c: cc }); }
          else out.push({ p: q, c: null });
        }
      } else if (isCoastal(p)) {
        if (isSea(q)) out.push({ p: q, c: null });
        else if (isCoastal(q) && !NO_FLEET.has(pairKey(p, q))) {
          if (SPLIT[q]) for (const cc in SPLIT[q]) { if (SPLIT[q][cc].includes(p)) out.push({ p: q, c: cc }); }
          else out.push({ p: q, c: null });
        }
      }
    }
    return out;
  }
  function expandCoast(from, q) {
    // neighbors listed from a split coast: q is a plain province name
    if (isSea(q)) return [{ p: q, c: null }];
    if (SPLIT[q]) {
      const r = [];
      for (const cc in SPLIT[q]) if (SPLIT[q][cc].includes(from)) r.push({ p: q, c: cc });
      return r;
    }
    return [{ p: q, c: null }];
  }
  function armyNeighbors(p) { return isSea(p) ? [] : ADJ[p].filter(isLand); }
  function unitNeighbors(u) {
    return u.t === 'A' ? armyNeighbors(u.p).map((q) => ({ p: q, c: null })) : fleetNeighbors(u.p, u.c);
  }
  // can unit move (directly) to province `to` (any coast); returns array of allowed coasts ([null] if not split)
  function moveCoasts(u, to) {
    const r = [];
    for (const n of unitNeighbors(u)) if (n.p === to) r.push(n.c);
    return r;
  }
  const canReach = (u, to) => moveCoasts(u, to).length > 0;

  // ---------- state ----------
  function initialState() {
    const sc = {};
    for (const p of POWERS) for (const h of HOME[p]) sc[h] = p;
    return {
      year: 1901, season: 'S', type: 'M',
      units: START_UNITS.map(([o, t, p, c]) => ({ o, t, p, c: c || null })),
      sc, dislodged: [], bounced: [],
    };
  }
  const phaseKey = (s) => `${s.year}${s.season}${s.type}`;
  function phaseName(s) {
    const se = s.season === 'S' ? 'Jaro' : s.season === 'F' ? 'Podzim' : 'Zima';
    const ty = s.type === 'M' ? 'tahy' : s.type === 'R' ? 'ústupy' : 'stavby';
    return `${se} ${s.year} · ${ty}`;
  }
  const unitAt = (st, p) => st.units.find((u) => u.p === p);
  const homeOf = (p) => POWERS.find((x) => HOME[x].includes(p)) || null;
  function scCount(st, pw) { return Object.values(st.sc).filter((x) => x === pw).length; }
  function unitCount(st, pw) { return st.units.filter((u) => u.o === pw).length; }

  // ---------- order text ----------
  const loc = (p, c) => p + (c ? '/' + COAST_CZ[c] : '');
  const T = (t) => (t === 'A' ? 'A' : 'L');
  function orderText(st, o, units) {
    const us = units || st.units;
    const u = us.find((x) => x.p === o.p);
    if (!u) return '';
    const head = `${T(u.t)} ${loc(u.p, u.c)}`;
    switch (o.k) {
      case 'H': return `${head} D`;
      case 'M': return `${head} – ${loc(o.to, o.tc)}${o.vc ? ' (konvojem)' : ''}`;
      case 'S': {
        const s = us.find((x) => x.p === o.sp);
        const sh = s ? `${T(s.t)} ${o.sp}` : o.sp;
        return o.st ? `${head} P ${sh} – ${o.st}` : `${head} P ${sh}`;
      }
      case 'C': return `${head} K A ${o.sp} – ${o.st}`;
    }
    return head;
  }

  // ---------- movement adjudication (Kruijswijk) ----------
  function adjudicateMovement(st, rawOrders) {
    const units = st.units;
    const byP = {};
    units.forEach((u) => (byP[u.p] = u));
    const raw = {};
    for (const o of rawOrders || []) {
      const u = byP[o.p];
      if (!u || raw[o.p]) continue;
      raw[o.p] = Object.assign({}, o);
    }
    // validate
    const ord = {};
    for (const u of units) {
      let o = raw[u.p];
      const hold = { p: u.p, k: 'H' };
      if (!o) { ord[u.p] = hold; continue; }
      o = Object.assign({}, o);
      if (o.k === 'M') {
        if (!o.to || o.to === u.p || !ADJ[o.to]) { ord[u.p] = Object.assign(hold, { inv: 1 }); continue; }
        if (u.t === 'F') {
          const cs = moveCoasts(u, o.to);
          if (!cs.length) { ord[u.p] = Object.assign(hold, { inv: 1 }); continue; }
          if (SPLIT[o.to]) {
            if (o.tc && cs.includes(o.tc)) { /* ok */ } else if (!o.tc && cs.length === 1) o.tc = cs[0];
            else { ord[u.p] = Object.assign(hold, { inv: 1 }); continue; }
          } else o.tc = null;
          o.vc = false;
        } else {
          o.tc = null;
          if (isSea(o.to)) { ord[u.p] = Object.assign(hold, { inv: 1 }); continue; }
          const adj = canReach(u, o.to);
          const convoyers = Object.values(raw).filter((c) => c.k === 'C' && c.sp === u.p && c.st === o.to && byP[c.p] && byP[c.p].t === 'F' && isSea(c.p));
          if (adj && !o.vc) o.vc = false;
          else if (convoyers.length && isCoastal(u.p) && isCoastal(o.to)) o.vc = true;
          else if (adj) o.vc = false;
          else { ord[u.p] = Object.assign(hold, { inv: 1 }); continue; }
        }
        ord[u.p] = o;
      } else if (o.k === 'S') {
        const s = byP[o.sp];
        const tgt = o.st || o.sp;
        if (!s || o.sp === u.p || tgt === u.p || !canReach(u, tgt)) { ord[u.p] = Object.assign(hold, { inv: 1 }); continue; }
        ord[u.p] = { p: u.p, k: 'S', sp: o.sp, st: o.st || null };
      } else if (o.k === 'C') {
        if (u.t !== 'F' || !isSea(u.p) || !byP[o.sp] || byP[o.sp].t !== 'A') { ord[u.p] = Object.assign(hold, { inv: 1 }); continue; }
        ord[u.p] = { p: u.p, k: 'C', sp: o.sp, st: o.st };
      } else ord[u.p] = hold;
    }
    // match supports & convoys
    for (const p in ord) {
      const o = ord[p];
      if (o.k === 'S') {
        const so = ord[o.sp];
        const ok = o.st ? (so.k === 'M' && so.to === o.st) : (so.k !== 'M');
        if (!ok) { o.void = 1; }
      } else if (o.k === 'C') {
        const ao = ord[o.sp];
        if (!(ao && ao.k === 'M' && ao.to === o.st && ao.vc)) o.void = 1;
      }
    }
    const list = Object.values(ord);
    const idx = {};
    list.forEach((o, i) => (idx[o.p] = i));
    const N = list.length;
    const state = new Array(N).fill(0); // 0 unresolved, 1 guessing, 2 resolved
    const res = new Array(N).fill(false);
    let dep = [];
    const szyk = new Set();
    const owner = (p) => byP[p].o;
    const movesInto = (p) => list.filter((o) => o.k === 'M' && o.to === p);
    const activeS = (o) => o.k === 'S' && !o.void;
    const activeC = (o) => o.k === 'C' && !o.void;

    function hasPath(o) {
      if (!o.vc) return true;
      if (szyk.has(o.p)) return false;
      const seen = new Set();
      const q = [];
      for (const n of ADJ[o.p]) {
        const c = ord[n];
        if (c && activeC(c) && c.sp === o.p && c.st === o.to && !seen.has(n)) { seen.add(n); q.push(n); }
      }
      while (q.length) {
        const s = q.shift();
        if (!resolve(idx[s])) continue;
        if (ADJ[s].includes(o.to)) return true;
        for (const n of ADJ[s]) {
          const c = ord[n];
          if (c && activeC(c) && c.sp === o.p && c.st === o.to && !seen.has(n)) { seen.add(n); q.push(n); }
        }
      }
      return false;
    }
    function supportsFor(o, excludePower) {
      let n = 0;
      for (const s of list) {
        if (!activeS(s) || s.sp !== o.p) continue;
        if (o.k === 'M') { if (s.st !== o.to) continue; } else if (s.st) continue;
        if (excludePower && owner(s.p) === excludePower) continue;
        if (resolve(idx[s.p])) n++;
      }
      return n;
    }
    function h2h(o) {
      if (o.vc) return null;
      const d = ord[o.to];
      if (d && d.k === 'M' && d.to === o.p && !d.vc) return d;
      return null;
    }
    function attackStrength(o) {
      if (!hasPath(o)) return 0;
      const occ = ord[o.to];
      const opp = h2h(o);
      if (!occ || (occ.k === 'M' && !opp && resolve(idx[occ.p]))) return 1 + supportsFor(o);
      if (owner(occ.p) === owner(o.p)) return 0;
      return 1 + supportsFor(o, owner(occ.p));
    }
    function holdStrength(p) {
      const occ = ord[p];
      if (!occ) return 0;
      if (occ.k === 'M') return resolve(idx[occ.p]) ? 0 : 1;
      return 1 + supportsFor(occ);
    }
    function preventStrength(o) {
      if (!hasPath(o)) return 0;
      const opp = h2h(o);
      if (opp && resolve(idx[opp.p])) return 0;
      return 1 + supportsFor(o);
    }
    function adjudicate(i) {
      const o = list[i];
      if (o.k === 'M') {
        if (szyk.has(o.p)) return false;
        const att = attackStrength(o);
        const opp = h2h(o);
        if (opp) { if (att <= 1 + supportsFor(opp)) return false; }
        else if (att <= holdStrength(o.to)) return false;
        for (const m of movesInto(o.to)) if (m !== o && att <= preventStrength(m)) return false;
        return true;
      }
      if (o.k === 'S') {
        if (o.void) return false;
        for (const m of movesInto(o.p)) {
          if (owner(m.p) === owner(o.p)) continue;
          if (o.st && m.p === o.st) { if (resolve(idx[m.p])) return false; continue; }
          if (m.vc) { if (hasPath(m)) return false; continue; }
          return false;
        }
        return true;
      }
      if (o.k === 'C') {
        for (const m of movesInto(o.p)) if (resolve(idx[m.p])) return false;
        return true;
      }
      // hold: "succeeds" if not dislodged
      for (const m of movesInto(o.p)) if (resolve(idx[m.p])) return false;
      return true;
    }
    function backup(old) {
      const cyc = dep.slice(old);
      const convoyInvolved = cyc.some((i) => list[i].k === 'C');
      for (const i of cyc) state[i] = 0;
      if (convoyInvolved) {
        for (const i of cyc) if (list[i].k === 'M' && list[i].vc) { szyk.add(list[i].p); res[i] = false; state[i] = 2; }
        // also any convoyed move whose convoying fleets are in cycle
        for (const i of cyc) if (list[i].k === 'C') { const a = ord[list[i].sp]; if (a && a.vc) { szyk.add(a.p); res[idx[a.p]] = false; state[idx[a.p]] = 2; } }
      } else {
        for (const i of cyc) if (list[i].k === 'M') { res[i] = true; state[i] = 2; }
      }
      dep = dep.slice(0, old);
    }
    function resolve(i) {
      if (state[i] === 2) return res[i];
      if (state[i] === 1) { if (!dep.includes(i)) dep.push(i); return res[i]; }
      const old = dep.length;
      res[i] = false; state[i] = 1;
      const first = adjudicate(i);
      if (dep.length === old) {
        if (state[i] !== 2) { res[i] = first; state[i] = 2; }
        return res[i];
      }
      if (dep[old] !== i) { dep.push(i); res[i] = first; return first; }
      while (dep.length > old) state[dep.pop()] = 0;
      res[i] = true; state[i] = 1;
      const second = adjudicate(i);
      if (first === second) {
        while (dep.length > old) state[dep.pop()] = 0;
        res[i] = first; state[i] = 2;
        return first;
      }
      backup(old);
      return resolve(i);
    }
    for (let i = 0; i < N; i++) resolve(i);

    // results
    const moved = new Set();
    const results = {};
    list.forEach((o, i) => {
      let r = 'ok';
      if (o.inv) r = 'invalid';
      else if (o.k === 'M') r = res[i] ? 'ok' : (o.vc && !hasPath(o) ? 'noconvoy' : 'bounce');
      else if (o.k === 'S') r = o.void ? 'void' : (res[i] ? 'ok' : 'cut');
      else if (o.k === 'C') r = o.void ? 'void' : (res[i] ? 'ok' : 'disrupted');
      results[o.p] = r;
      if (o.k === 'M' && res[i]) moved.add(o.p);
    });
    const newUnits = [];
    const dislodged = [];
    for (const u of units) {
      const o = ord[u.p];
      if (o.k === 'M' && moved.has(u.p)) { newUnits.push({ o: u.o, t: u.t, p: o.to, c: o.tc || null }); continue; }
      const att = list.find((m) => m.k === 'M' && m.to === u.p && moved.has(m.p));
      if (att) { dislodged.push({ o: u.o, t: u.t, p: u.p, c: u.c, from: att.p }); results[u.p] = results[u.p] === 'ok' && o.k !== 'M' ? 'dislodged' : results[u.p] + ' dislodged'; }
      else newUnits.push(Object.assign({}, u));
    }
    const occupied = new Set(newUnits.map((u) => u.p));
    const bounced = new Set();
    for (const o of list) if (o.k === 'M' && !moved.has(o.p) && hasPath(o) && !occupied.has(o.to)) bounced.add(o.to);
    for (const d of dislodged) {
      d.opts = [];
      for (const n of unitNeighbors(d)) {
        if (occupied.has(n.p) || n.p === d.from || bounced.has(n.p)) continue;
        d.opts.push(n.c ? n.p + '/' + n.c : n.p);
      }
    }
    return { units: newUnits, dislodged, bounced: [...bounced], orders: list.map((o) => Object.assign({}, o)), results };
  }

  // ---------- retreats ----------
  function adjudicateRetreats(st, orders) {
    const want = {};
    for (const d of st.dislodged) {
      const o = (orders || []).find((x) => x.p === d.p);
      if (o && o.k === 'R' && o.to) {
        const key = o.to + (o.tc ? '/' + o.tc : '');
        let ok = d.opts.includes(key);
        let tc = o.tc || null;
        if (!ok && !o.tc) { const m = d.opts.filter((x) => x.split('/')[0] === o.to); if (m.length === 1) { ok = true; tc = m[0].split('/')[1] || null; } }
        if (ok) { want[d.p] = { to: o.to, tc }; }
      }
    }
    const cnt = {};
    for (const p in want) cnt[want[p].to] = (cnt[want[p].to] || 0) + 1;
    const units = st.units.slice();
    const results = {};
    for (const d of st.dislodged) {
      const w = want[d.p];
      if (w && cnt[w.to] === 1) { units.push({ o: d.o, t: d.t, p: w.to, c: w.tc }); results[d.p] = 'retreat:' + w.to + (w.tc ? '/' + w.tc : ''); }
      else results[d.p] = w ? 'disband:bounce' : 'disband';
    }
    return { units, results };
  }

  // ---------- adjustments ----------
  function adjustmentNeeds(st) {
    const r = {};
    for (const p of POWERS) {
      const n = scCount(st, p) - unitCount(st, p);
      if (n > 0) {
        const free = HOME[p].filter((h) => st.sc[h] === p && !unitAt(st, h));
        const k = Math.min(n, free.length);
        if (k > 0) r[p] = k;
      } else if (n < 0) r[p] = n;
    }
    return r;
  }
  function adjudicateAdjustments(st, ordersByPower) {
    const needs = adjustmentNeeds(st);
    let units = st.units.slice();
    const log = [];
    for (const pw of POWERS) {
      const n = needs[pw];
      if (!n) continue;
      const ords = (ordersByPower[pw] || []);
      if (n > 0) {
        let left = n;
        const used = new Set();
        for (const o of ords) {
          if (left <= 0) break;
          if (o.k !== 'B') continue;
          if (!HOME[pw].includes(o.p) || st.sc[o.p] !== pw || used.has(o.p) || units.some((u) => u.p === o.p)) continue;
          if (o.t === 'F' && !isCoastal(o.p)) continue;
          let c = null;
          if (o.t === 'F' && SPLIT[o.p]) { c = o.c && SPLIT[o.p][o.c] ? o.c : null; if (!c) continue; }
          units.push({ o: pw, t: o.t, p: o.p, c }); used.add(o.p); left--;
          log.push({ pw, k: 'B', t: o.t, p: o.p, c });
        }
      } else {
        let left = -n;
        for (const o of ords) {
          if (left <= 0) break;
          if (o.k !== 'X') continue;
          const i = units.findIndex((u) => u.p === o.p && u.o === pw);
          if (i < 0) continue;
          log.push({ pw, k: 'X', t: units[i].t, p: o.p }); units.splice(i, 1); left--;
        }
        if (left > 0) {
          // civil disorder: disband farthest from home
          const mine = units.filter((u) => u.o === pw).map((u) => ({ u, d: distToSet(u, HOME[pw]) }));
          mine.sort((a, b) => b.d - a.d || (a.u.t === 'F' ? -1 : 1) || a.u.p.localeCompare(b.u.p));
          for (const m of mine.slice(0, left)) { units = units.filter((x) => x !== m.u); log.push({ pw, k: 'X', t: m.u.t, p: m.u.p, auto: 1 }); }
        }
      }
    }
    return { units, log };
  }

  // ---------- distances ----------
  const distCache = {};
  function bfsFrom(start, t) {
    const key = t + start;
    if (distCache[key]) return distCache[key];
    const nb = (p) => {
      if (t === 'A') return armyNeighbors(p);
      if (SPLIT[p]) return [].concat(...Object.keys(SPLIT[p]).map((c) => fleetNeighbors(p, c).map((n) => n.p)));
      return fleetNeighbors(p, null).map((n) => n.p);
    };
    const d = { [start]: 0 };
    const q = [start];
    while (q.length) {
      const p = q.shift();
      for (const n of nb(p)) if (d[n] === undefined) { d[n] = d[p] + 1; q.push(n); }
    }
    distCache[key] = d;
    return d;
  }
  function dist(t, a, b) { const d = bfsFrom(a, t)[b]; return d === undefined ? 99 : d; }
  function distToSet(u, set) { let m = 99; for (const s of set) m = Math.min(m, dist(u.t, u.p, s)); return m; }

  // ---------- phase advance ----------
  // returns {state, record}
  function advance(st, ordersByPower) {
    const s = JSON.parse(JSON.stringify(st));
    const rec = { key: phaseKey(st), name: phaseName(st), units: st.units, sc: st.sc, dislodged: st.dislodged };
    if (st.type === 'M') {
      const all = [].concat(...POWERS.map((p) => (ordersByPower[p] || []).filter((o) => { const u = unitAt(st, o.p); return u && u.o === p; })));
      const r = adjudicateMovement(st, all);
      rec.orders = r.orders.map((o) => ({ ...o, o: unitAt(st, o.p).o }));
      rec.results = r.results;
      s.units = r.units; s.dislodged = r.dislodged; s.bounced = r.bounced;
      if (r.dislodged.length) { s.type = 'R'; return { state: s, record: rec }; }
    } else if (st.type === 'R') {
      const all = [].concat(...POWERS.map((p) => (ordersByPower[p] || []).filter((o) => st.dislodged.some((d) => d.p === o.p && d.o === p))));
      const r = adjudicateRetreats(st, all);
      rec.orders = st.dislodged.map((d) => ({ p: d.p, o: d.o, t: d.t, k: 'R', res: r.results[d.p] }));
      rec.results = r.results;
      s.units = r.units; s.dislodged = [];
    } else if (st.type === 'A') {
      const r = adjudicateAdjustments(st, ordersByPower);
      rec.orders = r.log;
      s.units = r.units;
      s.year = st.year + 1; s.season = 'S'; s.type = 'M'; s.bounced = [];
      return finish(s, rec);
    }
    s.dislodged = [];
    s.bounced = [];
    if (s.season === 'S') { s.season = 'F'; s.type = 'M'; return finish(s, rec); }
    // fall finished -> ownership
    for (const u of s.units) if (SC.includes(u.p)) s.sc[u.p] = u.o;
    const needs = adjustmentNeeds(s);
    const winner = POWERS.find((p) => scCount(s, p) >= 18);
    if (winner) { s.winner = winner; s.season = 'W'; s.type = 'A'; s.over = true; return finish(s, rec); }
    if (Object.keys(needs).length) { s.season = 'W'; s.type = 'A'; return finish(s, rec); }
    s.year++; s.season = 'S'; s.type = 'M';
    return finish(s, rec);
  }
  function finish(s, rec) { return { state: s, record: rec }; }

  // which powers must act in this phase
  function actingPowers(st) {
    if (st.over) return [];
    if (st.type === 'M') return POWERS.filter((p) => unitCount(st, p) > 0);
    if (st.type === 'R') return POWERS.filter((p) => st.dislodged.some((d) => d.o === p));
    if (st.type === 'A') return Object.keys(adjustmentNeeds(st));
    return [];
  }
  function alive(st, p) { return unitCount(st, p) > 0 || scCount(st, p) > 0; }

  // ---------- BOT ----------
  function rng(seed) { let x = seed >>> 0 || 1; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  function botMovement(st, pw) {
    const R = rng(hashStr(phaseKey(st) + pw));
    const mine = st.units.filter((u) => u.o === pw);
    const enemyAdj = (p) => st.units.some((e) => e.o !== pw && canReach(e, p));
    const val = {};
    for (const p of SC) {
      const own = st.sc[p];
      if (own === pw) {
        if (!unitAt(st, p) && enemyAdj(p)) val[p] = HOME[pw].includes(p) ? 7 : 5;
      } else val[p] = own ? 8 : 10;
    }
    const targets = Object.keys(val);
    function score(u, dest) {
      let s = 0;
      for (const t of targets) {
        const d = dist(u.t, dest, t);
        if (d >= 99) continue;
        s = Math.max(s, val[t] / (1 + d * 1.6));
      }
      if (val[dest]) s += val[dest] * (st.season === 'F' ? 1.5 : 0.9);
      return s;
    }
    const plans = [];
    for (const u of mine) {
      const opts = [{ k: 'H', to: u.p, s: score(u, u.p) * 0.92 + (st.season === 'F' && SC.includes(u.p) && st.sc[u.p] !== pw ? 12 : 0) }];
      if (st.season === 'F' && SC.includes(u.p) && st.sc[u.p] === pw && enemyAdj(u.p)) opts[0].s += 6;
      for (const n of unitNeighbors(u)) {
        const occ = unitAt(st, n.p);
        let s = score(u, n.p);
        if (occ && occ.o === pw) s -= 2;
        if (occ && occ.o !== pw) s *= 0.75;
        s += R() * 1.5;
        opts.push({ k: 'M', to: n.p, tc: n.c, s });
      }
      opts.sort((a, b) => b.s - a.s);
      plans.push({ u, opts });
    }
    // greedy assignment
    plans.sort((a, b) => b.opts[0].s - a.opts[0].s);
    const taken = new Set();
    const orders = [];
    const chosen = {};
    for (const pl of plans) {
      let pick = pl.opts.find((o) => !taken.has(o.to));
      if (!pick) pick = { k: 'H', to: pl.u.p };
      taken.add(pick.to);
      chosen[pl.u.p] = pick;
    }
    // avoid swapping own units (head to head) and moving into own unit that holds
    for (const pl of plans) {
      const c = chosen[pl.u.p];
      if (c.k === 'M') {
        const occ = unitAt(st, c.to);
        if (occ && occ.o === pw && (!chosen[occ.p] || chosen[occ.p].k !== 'M' || chosen[occ.p].to === pl.u.p)) chosen[pl.u.p] = { k: 'H', to: pl.u.p };
      }
    }
    // supports: idle units support attacks into enemy-held or contested provinces
    for (const pl of plans) {
      const u = pl.u;
      const c = chosen[u.p];
      if (c.k !== 'H') continue;
      let best = null;
      for (const ou of mine) {
        const oc = chosen[ou.p];
        if (ou === u || !oc || oc.k !== 'M') continue;
        if (!canReach(u, oc.to)) continue;
        const occ = unitAt(st, oc.to);
        const contested = occ ? occ.o !== pw : enemyAdj(oc.to);
        if (!contested) continue;
        const w = (val[oc.to] || 2) + (occ ? 3 : 0) + R();
        if (!best || w > best.w) best = { w, o: { p: u.p, k: 'S', sp: ou.p, st: oc.to } };
      }
      const keepHome = SC.includes(u.p) && st.sc[u.p] !== pw && st.season === 'F';
      if (best && !keepHome) { chosen[u.p] = null; orders.push(best.o); }
    }
    for (const u of mine) {
      const c = chosen[u.p];
      if (c === null) continue;
      if (c.k === 'M') orders.push({ p: u.p, k: 'M', to: c.to, tc: c.tc || null });
      else orders.push({ p: u.p, k: 'H' });
    }
    // hold-supports for threatened holders
    return orders;
  }
  function botRetreats(st, pw) {
    const out = [];
    for (const d of st.dislodged.filter((x) => x.o === pw)) {
      let best = null;
      for (const opt of d.opts) {
        const [p, c] = opt.split('/');
        let s = 0;
        if (SC.includes(p) && st.sc[p] !== pw) s += 5;
        if (HOME[pw].includes(p)) s += 3;
        s -= distToSet({ t: d.t, p }, HOME[pw]) * 0.3;
        if (!best || s > best.s) best = { s, p, c: c || null };
      }
      out.push(best ? { p: d.p, k: 'R', to: best.p, tc: best.c } : { p: d.p, k: 'X' });
    }
    return out;
  }
  function botAdjust(st, pw) {
    const n = adjustmentNeeds(st)[pw];
    if (!n) return [];
    const R = rng(hashStr(phaseKey(st) + pw + 'a'));
    if (n > 0) {
      const free = HOME[pw].filter((h) => st.sc[h] === pw && !unitAt(st, h));
      const fleets = unitCount(st, pw) ? st.units.filter((u) => u.o === pw && u.t === 'F').length / unitCount(st, pw) : 0;
      const wantF = { ANG: 0.65, TUR: 0.4, ITA: 0.4, FRA: 0.35, NEM: 0.25, RUS: 0.3, RAK: 0.15 }[pw];
      const res = [];
      for (const h of free.slice(0, n)) {
        let t = 'A';
        if (isCoastal(h) && (fleets < wantF || R() < 0.2)) t = 'F';
        if (pw === 'ANG' && h !== 'LVP') t = 'F';
        const c = t === 'F' && SPLIT[h] ? (R() < 0.6 ? 'SC' : 'NC') : null;
        res.push({ k: 'B', p: h, t, c });
      }
      return res;
    }
    const mine = st.units.filter((u) => u.o === pw);
    const targets = SC.filter((p) => st.sc[p] !== pw);
    const ranked = mine.map((u) => ({ u, d: Math.min(distToSet(u, targets), 50) })).sort((a, b) => b.d - a.d);
    return ranked.slice(0, -n).map((x) => ({ k: 'X', p: x.u.p }));
  }
  function botOrders(st, pw) {
    if (st.type === 'M') return botMovement(st, pw);
    if (st.type === 'R') return botRetreats(st, pw);
    if (st.type === 'A') return botAdjust(st, pw);
    return [];
  }


  // ---------- text order parser (for AI players) ----------
  function parseOrder(st, pw, text) {
    let t = String(text || '').toUpperCase().replace(/[–—−]/g, '-').replace(/->/g, '-').replace(/\s+/g, ' ').trim();
    t = t.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    const C = '(?:/(NC|SC|EC|SP|JP|VP))?';
    const m = t.match(new RegExp('^(?:(A|F|L) )?([A-Z]{3})' + C + '(?: (.*))?$'));
    if (!m) return null;
    const p = m[2];
    const u = st.units.find((x) => x.p === p);
    if (!u || u.o !== pw) return null;
    const rest = (m[4] || '').trim();
    const cc = (x) => (x ? COAST_FROM_CZ[x] : null);
    if (!rest || /^(H|D|HOLD|DRŽ|DRZ)$/.test(rest)) return { p, k: 'H' };
    let r;
    if ((r = rest.match(new RegExp('^- ?([A-Z]{3})' + C + '(?: (VIA|KONVOJEM|BY CONVOY))?$')))) return { p, k: 'M', to: r[1], tc: cc(r[2]), vc: !!r[3] };
    if ((r = rest.match(new RegExp('^(?:S|P) (?:(?:A|F|L) )?([A-Z]{3})' + C + '(?: ?- ?([A-Z]{3})' + C + ')?(?: (?:H|D))?$')))) return { p, k: 'S', sp: r[1], st: r[3] || null };
    if ((r = rest.match(/^(?:C|K) (?:A )?([A-Z]{3}) ?- ?([A-Z]{3})$/))) return { p, k: 'C', sp: r[1], st: r[2] };
    return null;
  }

  root.VEngine = {
    POWERS, PNAME, PSHORT, HOME, SC, NEUTRAL, SPLIT, COAST_CZ, COAST_FROM_CZ, ADJ,
    isSea, isLand, isCoastal, unitNeighbors, moveCoasts, canReach, fleetNeighbors, armyNeighbors,
    initialState, phaseKey, phaseName, unitAt, scCount, unitCount, orderText, loc,
    adjudicateMovement, adjudicateRetreats, adjudicateAdjustments, adjustmentNeeds,
    advance, actingPowers, alive, botOrders, dist, parseOrder,
  };
})(typeof window !== 'undefined' ? window : globalThis);

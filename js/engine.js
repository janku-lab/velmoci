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
  let SALT = ''; // jen pro testy (různé partie se stejnými boty)
  function hashStr(s) { s = SALT + s; let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  function botMovementV1(st, pw) {
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
  // ---------- BOT v2: hodnoty provincií + výběr z více variant simulací tahu ----------
  function provValues(st, pw) {
    const str = {}; for (const q of POWERS) str[q] = Math.max(1, scCount(st, q));
    const threat = (p) => st.units.filter((e) => e.o !== pw && canReach(e, p)).length;
    const V = {};
    for (const p of SC) {
      const own = st.sc[p];
      if (own === pw) { const t = threat(p); if (t) V[p] = 5 + 4 * t; }
      else {
        let v = own ? 7 + Math.min(4, str[own] * 0.6) : 11;
        const occ = unitAt(st, p);
        if (!occ) v += 3; else if (occ.o !== pw) v -= 2;
        V[p] = v;
      }
    }
    return V;
  }
  function spread(st, pw, V, t) {
    // D[p] = nejlepší hodnota cíle dosažitelného z p, tlumená vzdáleností
    const D = {};
    for (const s in V) {
      const d = bfsFrom(s, t);
      for (const p in d) { const v = V[s] * Math.pow(0.55, d[p]); if (!D[p] || v > D[p]) D[p] = v; }
    }
    return D;
  }
  function genOrders(st, pw, ctx, R, temp) {
    const mine = st.units.filter((u) => u.o === pw);
    const fall = st.season === 'F';
    const plans = mine.map((u) => {
      const D = ctx.D[u.t];
      const opts = [];
      let hv = (D[u.p] || 0) * 0.9;
      if (SC.includes(u.p) && st.sc[u.p] === pw && ctx.V[u.p]) hv += ctx.V[u.p] * 0.8; // bránit ohrožené centrum
      if (fall && SC.includes(u.p) && st.sc[u.p] !== pw) hv += 14; // udržet dobyté centrum do podzimu
      opts.push({ k: 'H', to: u.p, s: hv + R() * temp });
      for (const n of unitNeighbors(u)) {
        let v = D[n.p] || 0;
        if (SC.includes(n.p) && st.sc[n.p] !== pw) v += fall ? 9 : 4;
        const occ = unitAt(st, n.p);
        if (occ && occ.o === pw) v -= 3;
        if (occ && occ.o !== pw) v *= 0.8;
        opts.push({ k: 'M', to: n.p, tc: n.c, s: v + R() * temp });
      }
      opts.sort((a, b) => b.s - a.s);
      return { u, opts };
    });
    plans.sort((a, b) => b.opts[0].s - a.opts[0].s);
    const taken = new Set(); const ch = {};
    for (const pl of plans) {
      const pick = pl.opts.find((o) => !taken.has(o.to)) || { k: 'H', to: pl.u.p };
      taken.add(pick.to); ch[pl.u.p] = pick;
    }
    // žádné výměny vlastních jednotek a tahy do vlastní stojící jednotky
    for (let it = 0; it < 3; it++) for (const u of mine) {
      const c = ch[u.p]; if (c.k !== 'M') continue;
      const occ = unitAt(st, c.to);
      if (occ && occ.o === pw && (ch[occ.p].k !== 'M' || ch[occ.p].to === u.p)) ch[u.p] = { k: 'H', to: u.p };
    }
    const orders = [];
    // podpory: jednotky, které jen stojí, podpoří tah do sporné provincie nebo obranu centra
    for (const u of mine) {
      const c = ch[u.p];
      if (c.k !== 'H') continue;
      if (fall && SC.includes(u.p) && st.sc[u.p] !== pw) continue;
      let best = null;
      for (const o of mine) {
        if (o === u) continue;
        const oc = ch[o.p] || { k: 'S' };
        if (oc.k === 'M') {
          if (!canReach(u, oc.to)) continue;
          const occ = unitAt(st, oc.to);
          const contested = (occ && occ.o !== pw) || st.units.some((e) => e.o !== pw && canReach(e, oc.to));
          if (!contested) continue;
          const w = (ctx.V[oc.to] || 2) + (occ ? 4 : 1) + R();
          if (!best || w > best.w) best = { w, o: { p: u.p, k: 'S', sp: o.p, st: oc.to } };
        } else if (ctx.V[o.p] && st.sc[o.p] === pw && canReach(u, o.p)) {
          const w = ctx.V[o.p] * 0.7 + R();
          if (!best || w > best.w) best = { w, o: { p: u.p, k: 'S', sp: o.p, st: null } };
        }
      }
      const ownThreat = SC.includes(u.p) && st.sc[u.p] === pw && ctx.V[u.p];
      if (best && !(ownThreat && best.w < ctx.V[u.p])) { ch[u.p] = null; orders.push(best.o); }
    }
    for (const u of mine) {
      const c = ch[u.p]; if (!c) continue;
      orders.push(c.k === 'M' ? { p: u.p, k: 'M', to: c.to, tc: c.tc || null } : { p: u.p, k: 'H' });
    }
    return orders;
  }
  function scoreResult(st, pw, res, ctx) {
    const fall = st.season === 'F';
    let s = 0;
    for (const u of res.units) {
      if (u.o === pw) {
        s += (ctx.D[u.t][u.p] || 0) * 0.35;
        if (SC.includes(u.p)) s += st.sc[u.p] === pw ? 1 : (fall ? 14 : 5);
      } else if (SC.includes(u.p) && st.sc[u.p] === pw) s -= fall ? 14 : 5;
    }
    for (const d of res.dislodged) if (d.o === pw) s -= d.opts.length ? 6 : 10;
    return s;
  }
  // Konvoje pro bota: vlastní armáda na pobřeží + řetěz 1–2 vlastních loďstev na moři
  function convoyOptions(st, pw) {
    const mine = st.units.filter((u) => u.o === pw);
    const fset = new Set(mine.filter((u) => u.t === 'F' && isSea(u.p)).map((u) => u.p));
    const out = []; const seen = new Set();
    if (!fset.size) return out;
    for (const a of mine) {
      if (a.t !== 'A' || !isCoastal(a.p)) continue;
      const walk = new Set(armyNeighbors(a.p));
      const prev = {}; const q = [];
      for (const s of ADJ[a.p]) if (fset.has(s)) { prev[s] = null; q.push(s); }
      while (q.length) {
        const s = q.shift();
        const chain = []; for (let x = s; x !== null; x = prev[x]) chain.push(x);
        for (const n of ADJ[s]) {
          if (fset.has(n)) { if (prev[n] === undefined && chain.length < 2) { prev[n] = s; q.push(n); } }
          else if (isCoastal(n) && n !== a.p && !walk.has(n) && !seen.has(a.p + n)) { seen.add(a.p + n); out.push({ a: a.p, to: n, chain }); }
        }
      }
    }
    return out;
  }
  // v2: předpověď soupeřů = bot v1 + agresivní varianta; v3 navíc „chamtivý“ v2 soupeř a konvoje
  function botMovementV2(st, pw, v3) {
    const R = rng(hashStr(phaseKey(st) + pw + 'v2'));
    const V = provValues(st, pw);
    const ctx = { V, D: { A: spread(st, pw, V, 'A'), F: spread(st, pw, V, 'F') } };
    const others = POWERS.filter((q) => q !== pw && unitCount(st, q) > 0);
    const base = [].concat(...others.map((q) => botMovementV1(st, q)));
    const aggr = base.map((o) => {
      const u = unitAt(st, o.p);
      const tgt = SC.find((c) => st.sc[c] === pw && canReach(u, c) && !base.some((b) => b.k === 'M' && b.to === c && b.p !== o.p));
      if (tgt && R() < 0.6) { const cs = moveCoasts(u, tgt); return { p: o.p, k: 'M', to: tgt, tc: cs[0] || null }; }
      return o;
    });
    const scen = [[base, 0.5], [aggr, 0.5]];
    if (v3) {
      const R0 = rng(1);
      const greedy = [].concat(...others.map((q) => {
        const Vq = provValues(st, q);
        return genOrders(st, q, { V: Vq, D: { A: spread(st, q, Vq, 'A'), F: spread(st, q, Vq, 'F') } }, R0, 0);
      }));
      scen.length = 0; scen.push([base, 0.3], [greedy, 0.4], [aggr, 0.3]);
    }
    const evalSet = (mine) => { let s = 0; for (const [opp, w] of scen) s += scoreResult(st, pw, adjudicateMovement(st, mine.concat(opp)), ctx) * w; return s; };
    let best = null;
    const N = 14;
    for (let i = 0; i < N; i++) {
      const mine = genOrders(st, pw, ctx, R, i === 0 ? 0 : 1 + i * 0.5);
      const s = evalSet(mine);
      if (!best || s > best.s) best = { s, mine };
    }
    // lokální vylepšení: zkusit u každé jednotky jiný rozkaz (drž, tah, podpora) a nechat lepší
    let cur = best.mine, curS = best.s;
    const convoys = v3 ? convoyOptions(st, pw) : [];
    for (let pass = 0; pass < 2; pass++) {
      let improved = false;
      for (let i = 0; i < cur.length; i++) {
        const u = unitAt(st, cur[i].p);
        const alts = [{ p: u.p, k: 'H' }];
        for (const n of unitNeighbors(u)) alts.push({ p: u.p, k: 'M', to: n.p, tc: n.c });
        for (const o of cur) {
          if (o.p === u.p) continue;
          if (o.k === 'M' && o.to !== u.p && canReach(u, o.to)) alts.push({ p: u.p, k: 'S', sp: o.p, st: o.to });
          else if (o.k !== 'M' && o.k !== 'C' && canReach(u, o.p)) alts.push({ p: u.p, k: 'S', sp: o.p, st: null });
        }
        for (const a of alts) {
          const trial = cur.slice(); trial[i] = a;
          const sc = evalSet(trial);
          if (sc > curS + 0.01) { cur = trial; curS = sc; improved = true; }
        }
      }
      // konvoje: armáda + celý řetěz loďstev najednou
      for (const c of convoys) {
        const trial = cur.map((o) => {
          if (o.p === c.a) return { p: c.a, k: 'M', to: c.to, tc: null, vc: true };
          if (c.chain.includes(o.p)) return { p: o.p, k: 'C', sp: c.a, st: c.to };
          return o;
        });
        const sc = evalSet(trial);
        if (sc > curS + 0.01) { cur = trial; curS = sc; improved = true; }
      }
      if (!improved) break;
    }
    return cur;
  }
  function botRetreatsV2(st, pw) {
    const V = provValues(st, pw);
    const out = [];
    for (const d of st.dislodged.filter((x) => x.o === pw)) {
      const D = spread(st, pw, V, d.t);
      let best = null;
      for (const opt of d.opts) {
        const [p, c] = opt.split('/');
        let s = (D[p] || 0) + (SC.includes(p) && st.sc[p] !== pw && st.season === 'F' ? 10 : 0) + (V[p] && st.sc[p] === pw ? 4 : 0);
        if (!best || s > best.s) best = { s, p, c: c || null };
      }
      out.push(best ? { p: d.p, k: 'R', to: best.p, tc: best.c } : { p: d.p, k: 'X' });
    }
    return out;
  }
  function botAdjustV2(st, pw) {
    const n = adjustmentNeeds(st)[pw];
    if (!n) return [];
    const V = provValues(st, pw);
    const DA = spread(st, pw, V, 'A'), DF = spread(st, pw, V, 'F');
    if (n > 0) {
      const free = HOME[pw].filter((h) => st.sc[h] === pw && !unitAt(st, h));
      const cand = [];
      for (const h of free) {
        cand.push({ k: 'B', p: h, t: 'A', c: null, s: (DA[h] || 0) + (V[h] || 0) });
        if (isCoastal(h)) {
          if (SPLIT[h]) for (const cc of Object.keys(SPLIT[h])) {
            const best = Math.max(0, ...SPLIT[h][cc].map((q) => DF[q] || 0));
            cand.push({ k: 'B', p: h, t: 'F', c: cc, s: best * 0.9 + (V[h] || 0) });
          } else cand.push({ k: 'B', p: h, t: 'F', c: null, s: (DF[h] || 0) + (V[h] || 0) });
        }
      }
      cand.sort((a, b) => b.s - a.s);
      const used = new Set(); const res = [];
      for (const c of cand) { if (res.length >= n) break; if (used.has(c.p)) continue; used.add(c.p); res.push({ k: 'B', p: c.p, t: c.t, c: c.c }); }
      return res;
    }
    const mine = st.units.filter((u) => u.o === pw).map((u) => ({ u, s: ((u.t === 'A' ? DA : DF)[u.p] || 0) + (V[u.p] && st.sc[u.p] === pw ? V[u.p] : 0) }));
    mine.sort((a, b) => a.s - b.s);
    return mine.slice(0, -n).map((x) => ({ k: 'X', p: x.u.p }));
  }
  let BOT_LEVEL = 3;
  function botOrders(st, pw, level) {
    const lv = level || BOT_LEVEL, v2 = lv >= 2;
    if (st.type === 'M') return v2 ? botMovementV2(st, pw, lv >= 3) : botMovementV1(st, pw);
    if (st.type === 'R') return v2 ? botRetreatsV2(st, pw) : botRetreats(st, pw);
    if (st.type === 'A') return v2 ? botAdjustV2(st, pw) : botAdjust(st, pw);
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
    _test: { setSalt: (x) => { SALT = String(x); }, setLevel: (l) => { BOT_LEVEL = l; } },
  };
})(typeof window !== 'undefined' ? window : globalThis);

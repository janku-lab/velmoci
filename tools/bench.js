// Test síly botů: node tools/bench.js [počet her na velmoc] [do roku]
// node tools/bench.js N ROK [úrovně hrdiny, např. 2,3] [úroveň ostatních, výchozí 1]
// Jedna velmoc hraje botem dané úrovně, ostatní botem úrovně FIELD; průměr center hrdiny.
global.window = globalThis;
require('../js/data.js'); require('../js/engine.js');
const E = VEngine;
const N = +process.argv[2] || 4, END = +process.argv[3] || 1910;
const LV = (process.argv[4] || '1,2').split(',').map(Number), FIELD = +process.argv[5] || 1;
function play(hero, heroLevel, salt) {
  E._test.setSalt(salt);
  let st = E.initialState();
  while (!st.over && st.year <= END) {
    const ob = {};
    for (const p of E.actingPowers(st)) ob[p] = E.botOrders(st, p, p === hero ? heroLevel : FIELD);
    st = E.advance(st, ob).state;
  }
  return { sc: E.scCount(st, hero), win: st.winner === hero };
}
const t0 = Date.now();
const out = {};
for (const lvl of LV) {
  let tot = 0, wins = 0, per = {};
  for (const hero of E.POWERS) { per[hero] = 0; for (let i = 0; i < N; i++) { const r = play(hero, lvl, 's' + i); tot += r.sc; per[hero] += r.sc / N; wins += r.win; } }
  out[lvl] = { avgSC: +(tot / (N * 7)).toFixed(2), wins, per: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, +v.toFixed(1)])) };
}
console.log(JSON.stringify(out, null, 1), '\n', ((Date.now() - t0) / 1000).toFixed(1) + ' s');

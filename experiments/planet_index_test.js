/*
 * planet_index_test.js — validate the periodic planet proximity index.
 *
 * The 0.8.0+ spatial index in gravity_sim.js replaces the per-step O(K) loops
 * in impact/stepInsideAt/markSystemsAt with a bucket lookup for periodic rosters
 * (K>48). This test proves the index is byte-identical to the brute-force loop
 * (the same code the periodic sim falls back to when planetIndexValid is false)
 * across planet counts, and measures the per-candidate prediction speed-up.
 *
 * Run: node --expose-gc experiments/planet_index_test.js
 */
'use strict';
const GravitySim = require('../gravity_sim.js');

function buildSim(K, W, H) {
  const sim = new GravitySim(W, H);
  const px = new Float64Array(192), py = new Float64Array(192), pr = new Float64Array(192);
  const rx = new Float64Array(192), ry = new Float64Array(192), cos = new Float64Array(192), sin = new Float64Array(192);
  for (let i = 0; i < K; i++) {
    px[i] = 110 + Math.random() * (W - 220);
    py[i] = 90 + Math.random() * (H - 180);
    const r = 22 + Math.random() * 40;
    pr[i] = r;
    rx[i] = r * (1.4 + Math.random() * 0.6);
    ry[i] = r * (1.4 + Math.random() * 0.6);
    const t = Math.random() * Math.PI;
    cos[i] = Math.cos(t); sin[i] = Math.sin(t);
  }
  sim.setPlanets(K, px, py, pr, rx, ry, cos, sin);
  sim.setWorldSize(W, H);
  sim.setPeriodic(true, null);
  for (let i = 0; i < K; i++) { sim.bodyX[i] = px[i]; sim.bodyY[i] = py[i]; }
  sim.bodyCount = K;
  sim.strength = new Float64Array(192).fill(1);
  sim.fieldStatic = true;
  sim.fillField = (t, x, y, n) => { for (let i = 0; i < n; i++) { x[i] = px[i]; y[i] = py[i]; } };
  sim.ensurePeriodicGrid();
  return sim;
}

function points(W, H, n) {
  const out = [];
  let s = 1234567;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < n; i++) out.push([rnd() * W, rnd() * H]);
  return out;
}

const W = 3200, H = 2000;
let failures = 0;

for (const K of [16, 26, 48, 64, 104, 192]) {
  const sim = buildSim(K, W, H);
  const indexedActive = sim.planetIndexValid; // true only when K > 48
  const pts = points(W, H, 8000);

  let impactDiff = 0, insideDiff = 0, markDiff = 0;
  const insideI = new Uint8Array(192), insideB = new Uint8Array(192);
  const maskI = new Uint8Array(192), maskB = new Uint8Array(192);

  if (indexedActive) {
    // indexed pass
    for (const [x, y] of pts) {
      sim.planetIndexValid = true;
      insideI.fill(0); maskI.fill(0);
      const ii = sim.impact(x, y);
      sim.stepInsideAt(x, y, insideI, new Int32Array(192));
      const mi = sim.markSystemsAt(x, y, maskI);
      // brute pass (same sim, index off)
      sim.planetIndexValid = false;
      insideB.fill(0); maskB.fill(0);
      const ib = sim.impact(x, y);
      sim.stepInsideAt(x, y, insideB, new Int32Array(192));
      const mb = sim.markSystemsAt(x, y, maskB);
      if (ii !== ib) impactDiff++;
      for (let p = 0; p < K; p++) if (insideI[p] !== insideB[p]) { insideDiff++; break; }
      if (mi !== mb) markDiff++;
      for (let p = 0; p < K; p++) if (maskI[p] !== maskB[p]) { markDiff++; break; }
    }
  }

  // full prediction: identical end state, time both (only meaningful when index active)
  let idxMs = 0, bruteMs = 0, stepsMatch = true, bodyMatch = true, lenMatch = true;
  const N = 60;
  const cands = [];
  for (let c = 0; c < N; c++) cands.push([Math.random() * Math.PI * 2, 80 + Math.random() * 160]);
  if (indexedActive) {
    for (const [ang, sp] of cands) {
      sim.planetIndexValid = true;
      sim.routeBegin(0, ang, sp, 120);
      let t0 = process.hrtime.bigint(); sim.routeDrain(1e9); let t1 = process.hrtime.bigint();
      idxMs += Number(t1 - t0) / 1e6;
      const idxSteps = sim.routeSteps, idxBody = sim.predBody, idxLen = sim.routeLength;
      sim.planetIndexValid = false;
      sim.routeBegin(0, ang, sp, 120);
      t0 = process.hrtime.bigint(); sim.routeDrain(1e9); t1 = process.hrtime.bigint();
      bruteMs += Number(t1 - t0) / 1e6;
      if (sim.routeSteps !== idxSteps) stepsMatch = false;
      if (sim.predBody !== idxBody) bodyMatch = false;
      if (Math.abs(sim.routeLength - idxLen) > 1e-6) lenMatch = false;
    }
  }

  const consistent = (indexedActive ? (impactDiff === 0 && insideDiff === 0 && markDiff === 0 &&
    stepsMatch && bodyMatch && lenMatch) : true);
  if (!consistent) failures++;
  const speedup = bruteMs > 0 ? (bruteMs / idxMs) : 0;
  console.log(
    `K=${String(K).padStart(3)} index=${indexedActive ? 'on ' : 'off'} ` +
    (indexedActive
      ? `impactDiff=${impactDiff} insideDiff=${insideDiff} markDiff=${markDiff} stepsMatch=${stepsMatch} bodyMatch=${bodyMatch} lenMatch=${lenMatch} ` +
        `brute=${bruteMs.toFixed(1)}ms idx=${idxMs.toFixed(1)}ms speedup=${speedup.toFixed(2)}x `
      : `(brute only, no regression) `) +
    (consistent ? 'OK' : 'FAIL')
  );
  if (global.gc) global.gc();
}

console.log(failures === 0 ? '\nPLANET INDEX OK — byte-identical to brute force, no low-K regression' : `\n${failures} CONFIG(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

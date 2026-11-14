/*
 * Career statistics (0.6.10 plan §1): `careerStats` and `mapStats` on the
 * career object, the purse identity and the rule that each statistic moves
 * only at its own transaction. Headless, node-only.
 * Run: node experiments/career_stats_test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const OrbitTech = require(path.join(root, 'orbit_tech.js'));
const OrbitWorld = require(path.join(root, 'orbit_world.js'));
const Sim = require(path.join(root, 'orbit_sim.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));
const GravityGame = require(path.join(root, 'gravity_game.js'));

const PLANETS = OrbitWorld.PLANETS;
const UNIVERSE = 13;
const SEED = 11;
const STARTER = OrbitTech.starterGrant().purse;
const CAT = OrbitTech.CATAPULTS;
const HOLD = OrbitTech.HOLDS;
const ENGINE = OrbitTech.ENGINES;
const CAREER = GravityGame.CAREER;
const STATUS_FLYING = GravitySim.STATUS_FLYING;
const RATE = 1;

const STAT_FIELDS = [
    'visitIncome', 'flownPx', 'feesPaid', 'buildSpent', 'sciSpent',
    'earned', 'bribeIncome', 'taxEarned', 'fuelSpent', 'evacuations'
];

let failures = 0;
function check(name, fn) {
    try { fn(); console.log('ok - ' + name); }
    catch (e) { failures++; console.log('FAIL - ' + name + ': ' + e.message); }
}
function finish() {
    if (failures > 0) { console.log(failures + ' failure(s)'); process.exit(1); }
    console.log('all checks passed');
}

/* a two-company career on a seeded 13-planet universe; YOU are index 0, the
 * rival index 1 and each starts with a starter pad at its HQ */
function makeCareer(seed) {
    const trade = new Sim(seed);
    trade.advanceTo(420);
    const sim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
    const mask = new Uint8Array(PLANETS);
    mask.fill(1, 0, UNIVERSE);
    const strength = new Float64Array(GravitySim.MAX_BODIES).fill(0);
    for (let p = 0; p < PLANETS; p++) strength[p] = mask[p] ? GravityGame.planetGravity(seed, p) : 0;
    if (GravityGame.specialPlanets()) {
        if (trade.world.capitalPlanet >= 0) strength[trade.world.capitalPlanet] = 1;
        if (trade.world.arfPlanet >= 0) strength[trade.world.arfPlanet] = 1;
    }
    const fill = (t, ox, oy, n) => {
        for (let i = 0; i < n; i++) { ox[i] = trade.planetX[i]; oy[i] = trade.planetY[i]; }
    };
    sim.setField(PLANETS, trade.planetR, strength, fill, true);
    sim.fieldT = trade.t;
    sim.stepLimit = GravityGame.CAP_STEPS;
    const galaxy = GravityGame.createGalaxy();
    GravityGame.resetGalaxy(galaxy, seed);
    const seats = GravityGame.prepareCareerStarts(galaxy, trade.world, trade, mask, UNIVERSE, 2, sim);
    assert.strictEqual(seats.length, 2);
    for (const seat of seats) strength[seat] = 1;
    sim.setField(PLANETS, trade.planetR, strength, fill, true);
    sim.fieldT = trade.t;
    const market = GravityGame.createMarket();
    GravityGame.resetMarket(market);
    GravityGame.applyMarketUniverse(market, mask, UNIVERSE);
    GravityGame.applyMarketSpecials(market, trade.world);
    GravityGame.bindRun(market, galaxy, trade.world);
    const career = GravityGame.createCareer(GravityGame.createLedger());
    GravityGame.setCareerUniverse(career, mask, UNIVERSE);
    GravityGame.startCareer(career, sim, seed, trade, null, galaxy, seats[0]);
    const rival = GravityGame.createCareer(GravityGame.createLedger());
    GravityGame.setCareerUniverse(rival, mask, UNIVERSE);
    GravityGame.startCareer(rival, sim, GravityGame.rivalSeed(seed, 0), trade, null, galaxy, seats[1]);
    return { trade, sim, market, galaxy, career, rival, mask, seats, step: 0 };
}

/* the fastest shot from `from` that lands on `want` (any planet when < 0),
 * never on the capital or the A.R.F. world */
function findShot(w, from, want) {
    const sim = w.sim;
    const capital = w.trade.world.capitalPlanet;
    const arf = w.trade.world.arfPlanet;
    const limit = sim.speedLimit(from);
    let best = null;
    for (let s = Math.floor(limit); s >= GravitySim.SPEED_MIN; s -= 10) {
        for (let a = 0; a < 72; a++) {
            const angle = (a + 0.31) / 72 * Math.PI * 2;
            sim.predictFast(from, angle, s, GravityGame.CAP_SECONDS);
            if (sim.predReason !== GravitySim.END_IMPACT || sim.predBody === from) continue;
            if (sim.predBody === capital || sim.predBody === arf) continue;
            if (want >= 0 && sim.predBody !== want) continue;
            const score = sim.predLength;
            if (!best || score > best.score) best = { angle, speed: s };
        }
        if (best) return best;
    }
    return null;
}

/* launch, fly to the end and settle the landing; returns the flight's shot
 * gain (what the visits paid into the purse and into visitIncome) */
function fly(w, from, angle, speed) {
    const { sim, career, trade } = w;
    sim.launch(from, angle, speed);
    GravityGame.careerBeginFlight(career, sim);
    while (sim.status === STATUS_FLYING) {
        w.step += 1;
        sim.stepOne();
        GravityGame.stepHarvest(career.ledger, w.market, sim, w.step);
        GravityGame.careerAdvance(career, 1);
    }
    trade.advanceTo(sim.flightFieldT);
    return GravityGame.careerEndFlight(career, sim, w.trade, w.step);
}

function snapshot(career) {
    const out = { purse: career.ledger.purse };
    for (let i = 0; i < STAT_FIELDS.length; i++) out[STAT_FIELDS[i]] = career[STAT_FIELDS[i]];
    return out;
}

/* assert each statistic moved by exactly its expected delta (0 = untouched) */
function checkMoves(name, before, after, expected) {
    let bad = '';
    for (let i = 0; i < STAT_FIELDS.length; i++) {
        const f = STAT_FIELDS[i];
        const d = after[f] - before[f];
        const want = expected[f] === undefined ? 0 : expected[f];
        if (Math.abs(d - want) > 1e-9) bad += f + ': got ' + d + ', want ' + want + '; ';
    }
    const dp = after.purse - before.purse;
    const wantP = expected.purse === undefined ? 0 : expected.purse;
    if (Math.abs(dp - wantP) > 1e-9) bad += 'purse: got ' + dp + ', want ' + wantP + '; ';
    assert.strictEqual(bad, '', name + ': unexpected moves (' + bad + ')');
}

/* purse = starter purse + profit − property − science */
function checkIdentity(career, tag) {
    const out = {};
    GravityGame.careerStats(out, career);
    const want = STARTER + out.profit - out.property - out.science;
    assert.ok(Math.abs(career.ledger.purse - want) < 1e-9,
        tag + ': purse ' + career.ledger.purse.toFixed(2) + ' want ' + want.toFixed(2));
}

/* map-wide numbers equal their direct sums over the in-play planets */
function checkMapStats(market, step, tag) {
    const out = {};
    GravityGame.mapStats(out, market, step);
    let rot = 0;
    let standing = 0;
    for (let p = 0; p < PLANETS; p++) {
        if (market.planetMask && market.planetMask[p] !== 1) continue;
        rot += market.corruption[p];
        const pay = GravityGame.planetProfit(market, p, step);
        if (pay > 0) standing += pay;
    }
    assert.strictEqual(out.rot, rot, tag + ': rot ' + out.rot + ' want ' + rot);
    assert.strictEqual(out.standing, standing, tag + ': standing ' + out.standing + ' want ' + standing);
}

check('mapStats on a fresh career: no rot, standing equals the direct sum', () => {
    const w = makeCareer(SEED);
    checkMapStats(w.market, w.step, 'fresh');
    const out = {};
    GravityGame.careerStats(out, w.career);
    assert.strictEqual(out.income, 0);
    assert.strictEqual(out.running, 0);
    assert.strictEqual(out.profit, 0);
    assert.strictEqual(out.property, 0);
    assert.strictEqual(out.science, 0);
    assert.strictEqual(out.flown, 0);
    checkIdentity(w.career, 'fresh');
});

check('purse identity and per-transaction isolation over a scripted career', () => {
    const w = makeCareer(SEED);
    const { career, sim, market, trade, seats } = w;
    const hq = career.hq;
    const rivalHQ = seats[1];
    const capital = trade.world.capitalPlanet;
    const arf = trade.world.arfPlanet;

    /* two plain planets reachable in sequence: HQ -> P1 -> P2 -> rival HQ,
     * none of them the HQs, the capital or the A.R.F. world */
    const excluded = p => p === hq || p === rivalHQ || p === capital || p === arf;
    let P1 = -1;
    let P2 = -1;
    let s1 = null;
    let s2 = null;
    let s3 = null;
    outer: for (let a = 0; a < UNIVERSE; a++) {
        if (excluded(a)) continue;
        s1 = findShot(w, hq, a);
        if (!s1) continue;
        for (let b = 0; b < UNIVERSE; b++) {
            if (excluded(b) || b === a) continue;
            s2 = findShot(w, a, b);
            if (!s2) continue;
            s3 = findShot(w, b, rivalHQ);
            if (s3) { P1 = a; P2 = b; break outer; }
        }
    }
    assert.ok(P1 >= 0 && P2 >= 0 && s3, 'no three-leg route HQ -> P1 -> P2 -> rival HQ');

    const before = snapshot(career);
    checkMoves('start', before, snapshot(career), {});
    checkIdentity(career, 'start');

    /* flight 1: HQ -> P1 on the own pad, free */
    fly(w, hq, s1.angle, s1.speed);
    const after1 = snapshot(career);
    const g1 = after1.visitIncome - before.visitIncome;
    checkMoves('flight 1 (own rail, free)', before, after1, {
        visitIncome: g1, flownPx: sim.flightLength, purse: g1
    });
    checkIdentity(career, 'after flight 1');

    /* build a catapult on P1 and fit a bigger hold */
    assert.ok(GravityGame.buildGear(career, P1, OrbitTech.KIND_CATAPULT, CAT[0]), 'P1 build failed');
    const build1 = CAT[0].buildCost;
    assert.ok(GravityGame.installPart(career, OrbitTech.KIND_HOLD, HOLD[1]), 'hold fit failed');
    const build2 = HOLD[1].buildCost;
    const afterBuild = snapshot(career);
    checkMoves('build catapult + fit hold', after1, afterBuild, {
        buildSpent: build1 + build2, purse: -(build1 + build2)
    });
    checkIdentity(career, 'after build');

    /* research the starter engine point: inside the seeded hull, base fee */
    const engCost = GravityGame.researchCost(career, OrbitTech.KIND_ENGINE, [ENGINE[0].thrust, ENGINE[0].mass]);
    assert.ok(Number.isFinite(engCost) && engCost > 0, 'research must be priceable');
    assert.ok(GravityGame.researchPoint(career, OrbitTech.KIND_ENGINE, [ENGINE[0].thrust, ENGINE[0].mass], 'research'), 'research failed');
    const afterResearch = snapshot(career);
    checkMoves('research engine point', afterBuild, afterResearch, {
        sciSpent: engCost, purse: -engCost
    });
    checkIdentity(career, 'after research');

    /* flight 2: P1 -> P2 on the own pad, free */
    fly(w, P1, s2.angle, s2.speed);
    const after2 = snapshot(career);
    const g2 = after2.visitIncome - afterBuild.visitIncome;
    checkMoves('flight 2 (own rail, free)', afterResearch, after2, {
        visitIncome: g2, flownPx: sim.flightLength, purse: g2
    });
    checkIdentity(career, 'after flight 2');

    /* flight 3: P2 -> the rival HQ; launching from P2 uses the commercial rail,
     * landing puts the ship on the rival's rail */
    const fee3 = GravityGame.launchFee(career, P2, s3.speed);
    assert.ok(fee3 > 0, 'commercial launch from P2 should charge');
    fly(w, P2, s3.angle, s3.speed);
    const after3 = snapshot(career);
    const g3 = after3.visitIncome - after2.visitIncome;
    checkMoves('flight 3 (commercial launch, rival landing)', after2, after3, {
        feesPaid: fee3, visitIncome: g3, flownPx: sim.flightLength, purse: g3 - fee3
    });
    checkIdentity(career, 'after flight 3');

    /* a bribe on the planet the ship sits on */
    const bribePlanetIdx = bribePlanet(w, rivalHQ, P2, capital, arf);
    market.corruption[bribePlanetIdx] = 90;
    const bribeAmountBefore = GravityGame.bribeAmount(market, bribePlanetIdx, w.step);
    const bribed = GravityGame.acceptBribe(career, market, sim, bribePlanetIdx, w.step);
    const afterBribe = snapshot(career);
    const bribeDelta = bribed.ok ? bribeAmountBefore : 0;
    checkMoves('bribe', after3, afterBribe, {
        bribeIncome: bribeDelta, purse: bribeDelta
    });
    checkIdentity(career, 'after bribe');

    /* an evacuation from the planet the ship is stranded on */
    if (career.stranded) {
        assert.ok(GravityGame.evacuate(career, sim), 'evacuate failed');
        const afterEvac = snapshot(career);
        checkMoves('evacuation', afterBribe, afterEvac, {
            evacuations: 1, purse: -CAREER.evacFee
        });
        checkIdentity(career, 'after evacuation');
    } else {
        console.log('note: career not stranded, evacuation step skipped');
    }

    /* the identity must hold after every transaction */
    checkIdentity(career, 'final');

    /* map-wide numbers track their direct sums */
    checkMapStats(market, w.step, 'final');

    /* the sample-free getters must not move a decision: nothing here reads
     * them, which is the point; re-run identity once more for good measure */
    const out = {};
    GravityGame.careerStats(out, career);
    assert.strictEqual(typeof out.profit, 'number');
});

/* pick a planet the ship has just landed on that can be bribed */
function bribePlanet(w, preferred, fallback, capital, arf) {
    const p = w.career.at;
    if (p >= 0 && p !== capital && p !== arf) return p;
    return preferred !== capital && preferred !== arf ? preferred : fallback;
}

/* drive the sampler headlessly: one sample per call, company values forced
 * distinct per step so thinning and determinism compare real data */
function driveSampler(w, samples) {
    for (let k = 0; k < samples; k++) {
        const stats = w.galaxy.stats;
        w.career.visitIncome = (k + 1) * 1.5;
        w.career.flownPx = (k + 1) * 120;
        w.rival.visitIncome = (k + 1) * 0.5;
        GravityGame.sampleStats(w.galaxy, w.market, stats.nextStep);
    }
    return w.galaxy.stats;
}

function seriesCopy(stats) {
    return stats.series.map(a => Array.from(a.subarray(0, stats.count)));
}

check('sampler: identical blocks for two runs of one seed', () => {
    const a = makeCareer(SEED);
    const b = makeCareer(SEED);
    driveSampler(a, 40);
    driveSampler(b, 40);
    const sa = a.galaxy.stats;
    const sb = b.galaxy.stats;
    assert.strictEqual(sa.count, sb.count);
    assert.strictEqual(sa.every, sb.every);
    assert.strictEqual(sa.nextStep, sb.nextStep);
    assert.deepStrictEqual(seriesCopy(sa), seriesCopy(sb));
});

check('sampler: a thinned block equals every second sample of the unthinned one', () => {
    const w = makeCareer(SEED);
    const block = w.galaxy.stats.series[0].length;
    driveSampler(w, block);
    const stats = w.galaxy.stats;
    assert.strictEqual(stats.count, block);
    const before = seriesCopy(stats);
    driveSampler(w, 1);
    assert.strictEqual(stats.count, block / 2 + 1);
    for (let s = 0; s < stats.series.length; s++) {
        for (let i = 0; i < block / 2; i++) {
            assert.strictEqual(stats.series[s][i], before[s][i * 2],
                'series ' + s + ' sample ' + i);
        }
    }
});

check('sampler: long runs stay capped at one block', () => {
    const w = makeCareer(SEED);
    const block = w.galaxy.stats.series[0].length;
    driveSampler(w, block * 3 + 10);
    assert.ok(w.galaxy.stats.count <= block, 'count ' + w.galaxy.stats.count);
});

check('purse identity holds for a free (communism) evacuation', () => {
    const w = makeCareer(SEED);
    w.career.cheat = GravityGame.CHEAT_COMMUNISM;
    w.career.stranded = true;
    const purseBefore = w.career.ledger.purse;
    assert.ok(GravityGame.evacuate(w.career, w.sim), 'evacuate failed');
    assert.strictEqual(w.career.ledger.purse, purseBefore, 'a communism evacuation is free');
    checkIdentity(w.career, 'communism evacuation');
});

finish();

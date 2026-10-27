/*
 * Game-mode determinism bench (archive/game.1-plan.md).
 *
 * 1. trade world: advanceTo in random chunks vs one jump; reset vs new Sim
 * 2. replay link codec round trip + rejects; aim grid idempotence
 * 3. a scripted game played through the page at 60 Hz (planets, moving ports,
 *    natural flight endings), then its copied link replayed at 144 Hz, with jittery frames,
 *    at x16 and via skip: every end state must match bit for bit
 * 4. cross-engine proxy: 1-ulp launch-angle nudge and 1-ulp port-position
 *    nudge at every field fill; outcome flips and end-point drift
 * Run: node experiments/game_bench.js
 */
'use strict';

const path = require('path');
const root = path.join(__dirname, '..');
const Sim = require(path.join(root, 'orbit_sim.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));
const GravityGame = require(path.join(root, 'gravity_game.js'));
const { loadPage } = require('./dom_stub.js');

const STATUS_FLYING = GravitySim.STATUS_FLYING;
const END_IMPACT = GravitySim.END_IMPACT;
const PLANETS = Sim.PLANETS;
let failures = 0;

function check(ok, message) {
	if (ok) return;
	failures += 1;
	console.log('FAIL', message);
}

function seededRandom(seed) {
	let a = seed >>> 0;
	return function () {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function tradeFingerprint(sim) {
	let pop = 0;
	for (let p = 0; p < sim.portCount; p++) pop += sim.colonies[p].pop;
	return [sim.t, sim.portCount, sim.shipCount, sim.delivered, sim.coloniesBuilt,
		sim.events.size, Array.from(sim.portPlanet.subarray(0, sim.portCount)).join('.'), pop].join('|');
}

/* 1. trade world */
function benchTrade() {
	const rand = seededRandom(99);
	let runs = 0;
	for (const seed of [7, 42, 913]) {
		for (const total of [500, 2000, 8000]) {
			const whole = new Sim(seed);
			whole.advanceTo(total);
			const chunked = new Sim(seed);
			while (chunked.t < total) chunked.advanceTo(Math.min(total, chunked.t + rand() * 3));
			check(tradeFingerprint(whole) === tradeFingerprint(chunked),
				'trade chunking seed ' + seed + ' total ' + total);
			runs += 1;
		}
	}
	const used = new Sim(5);
	used.step(3000);
	used.reset(42);
	used.step(420);
	const fresh = new Sim(42);
	fresh.step(420);
	check(tradeFingerprint(used) === tradeFingerprint(fresh), 'reset differs from new Sim');
	console.log('trade: advanceTo chunks 0-3 min vs one jump,', runs, 'runs identical incl. exact t; reset == new Sim');
}

/* 2. codec and grid */
function benchCodec() {
	const rand = seededRandom(7);
	let longest = 0;
	const ruleList = [GravityGame.RULE_TOUR, GravityGame.RULE_ROUTE, GravityGame.RULE_MONEY];
	const botList = [GravityGame.BOT_OFF, GravityGame.BOT_EASY, GravityGame.BOT_NORMAL, GravityGame.BOT_HARD];
	for (let n = 0; n < 300; n++) {
		const shots = [];
		const rule = ruleList[n % ruleList.length];
		const planner = GravityGame.RULES[rule].planner;
		const count = planner ? Math.floor(rand() * 2) : Math.floor(rand() * 40);
		const bot = botList[(n * 3) % botList.length];
		const player = n % 4 === 0 ? GravityGame.PLAYER_BOT : GravityGame.PLAYER_USER;
		const cap = GravityGame.RULES[rule].capSteps;
		const length = Math.floor(rand() * 20000);
		for (let k = 0; k < count; k++) {
			shots.push(GravityGame.createShot(rand() < 0.5 ? 0 : 1, Math.floor(rand() * PLANETS),
				GravityGame.angleUnits(rand() * 7 - 3.5),
				GravityGame.speedUnits(GravitySim.SPEED_MIN + rand() * (GravitySim.SPEED_MAX - GravitySim.SPEED_MIN)),
				planner || rand() >= 0.2 ? GravityGame.NO_ABORT : Math.floor(rand() * cap)));
		}
		const gravityScale = n % 7 === 0 ? Math.round(rand() * 90) / 10 : 1;
		const forceScale = n % 5 === 0 ? Math.round((0.25 + rand() * 2.75) * 100) / 100 : 1;
		const game = { seed: 1 + Math.floor(rand() * 4e9), rate: (1 + Math.floor(rand() * 24)) / 2,
			rule, bot, player, gravityScale, forceScale, shots, visited: Math.floor(rand() * 27),
			steps: Math.floor(rand() * 1e6), length };
		const text = GravityGame.encodeLink(game);
		const back = GravityGame.decodeLink('#' + text);
		const same = back && back.seed === game.seed && back.rate === game.rate &&
			back.rule === game.rule && back.bot === game.bot && back.player === game.player &&
			back.gravityScale === gravityScale && back.forceScale === forceScale &&
			JSON.stringify(back.shots) === JSON.stringify(shots) &&
			(count === 0 ? back.end === null : back.end.visited === game.visited && back.end.steps === game.steps) &&
			(!planner || count === 0 || back.length === length);
		check(same, 'codec round trip ' + text);
		if (count > 0) longest = Math.max(longest, text.length / count);
	}
	const rejects = ['game=2&seed=5&rate=1', 'game=1&seed=0&rate=1', 'game=1&seed=5&rate=0.7',
		'game=1&seed=5&rate=13', 'game=1&seed=5&rate=1&shots=x0.0.p00', 'game=1&seed=5&rate=1&shots=p26.0.p00',
		'game=1&seed=5&rate=1&shots=p0.0.10', 'game=1&seed=5&rate=1&shots=p0.mzzz.p00',
		'game=1&seed=5&rate=1&shots=p0.0.p00.ba0', 'game=1&seed=5&rate=1&shots=p0.0.p00_',
		'game=1&seed=5&rate=1&rule=bogus', 'game=1&seed=5&rate=1&bot=impossible',
		'game=1&seed=5&rate=1&you=robot',
		'game=1&seed=5&rate=1&rule=route&shots=p0.0.3aio_p1.0.3aio',
		'game=1&seed=5&rate=1&rule=route&shots=p0.0.3aio.1',
		'game=1&seed=5&rate=1&rule=route&shots=p0.0.3aio&len=-1',
		'game=1&seed=5&rate=1&gs=9.05', 'game=1&seed=5&rate=1&gs=-0.1',
		'game=1&seed=5&rate=1&gs=1.234', 'game=1&seed=5&rate=1&fs=0.1',
		'game=1&seed=5&rate=1&fs=3.01', 'game=1&seed=5&rate=1&gs=abc',
		'game=1&seed=5&rate=1&fs='];
	for (const text of rejects) check(GravityGame.decodeLink(text) === null, 'accepted bad link ' + text);
	/* route is a one-plan link: its traced length is part of the verdict */
	check(GravityGame.decodeShot('p0.0.3aio.ba0', GravityGame.CAP_STEPS) === null,
		'a tour link accepted an abort past its 120 s cap');
	const routeLink = GravityGame.decodeLink(
		'#game=1&seed=5&rate=1&rule=route&you=bot&shots=p0.0.3aio&end=3.1234&len=4321');
	check(routeLink && routeLink.rule === GravityGame.RULE_ROUTE &&
		routeLink.player === GravityGame.PLAYER_BOT && routeLink.shots.length === 1 &&
		routeLink.shots[0].abort === GravityGame.NO_ABORT && routeLink.length === 4321,
		'a valid one-plan route link was rejected');
	const plainLink = GravityGame.encodeLink({ seed: 5, rate: 1, rule: GravityGame.RULE_TOUR,
		bot: GravityGame.BOT_OFF, player: GravityGame.PLAYER_USER, shots: [] });
	check(plainLink === 'game=1&seed=5&rate=1' &&
		GravityGame.decodeLink('#' + plainLink).gravityScale === 1,
		'default scales leaked into a link: ' + plainLink);
	const scaledLink = GravityGame.decodeLink(
		'#game=1&seed=5&rate=1&rule=career&gs=0.8&fs=1.5');
	check(scaledLink && scaledLink.gravityScale === 0.8 && scaledLink.forceScale === 1.5,
		'valid experimental scales were rejected');
	check(GravityGame.encodeLink({ seed: 5, rate: 1, rule: GravityGame.RULE_CAREER,
		bot: GravityGame.BOT_OFF, player: GravityGame.PLAYER_USER, cheat: null,
		gravityScale: 0.8, forceScale: 1.5, shots: [] }) ===
		'game=1&seed=5&rate=1&rule=career&gs=0.8&fs=1.5', 'scales are not encoded');
	let worst = 0;
	for (let n = 0; n < 100000; n++) {
		const angle = rand() * 20 - 10;
		const units = GravityGame.angleUnits(angle);
		const snapped = GravityGame.angleOf(units);
		check(GravityGame.angleUnits(snapped) === units, 'angle grid not idempotent');
		const turn = Math.PI * 2;
		const err = Math.abs(((angle - snapped) % turn + turn * 1.5) % turn - turn * 0.5);
		if (err > worst) worst = err;
		const speed = 30 + rand() * 290;
		const su = GravityGame.speedUnits(speed);
		check(GravityGame.speedUnits(GravityGame.speedOf(su)) === su, 'speed grid not idempotent');
	}
	check(worst <= Math.PI / GravityGame.ANGLE_STEPS * 1.000001, 'angle snap error ' + worst);
	console.log('codec: 300 round trips, ' + rejects.length + ' rejects, ~' + longest.toFixed(1) +
		' chars/shot; grid: 1e5 idempotent, angle snap ≤ ' + worst.toExponential(2) + ' rad');
}

/* 3. scripted game + cross-cadence replays */
function pageState(page) {
	const scene = page.context.GravityScene;
	const cargo = scene.sim;
	if (scene.rule() === GravityGame.RULE_ROUTE) {
		const plan = scene.routePlan();
		const last = cargo.predCount - 1;
		return [plan.origin, plan.length, plan.steps, plan.visits, plan.reason, plan.body,
			last >= 0 ? cargo.predX[last] : 0, last >= 0 ? cargo.predY[last] : 0,
			scene.game.shots.length, cargo.status,
			tradeFingerprint(page.context.OrbitScene.sim)].join('|');
	}
	return [cargo.cargo.x, cargo.cargo.y, cargo.visitedCount, scene.scoreSteps(), scene.game.steps,
		Math.round(scene.routeLength()), cargo.landedBody, cargo.endReason,
		scene.game.shots.length, scene.game.money.purse.toFixed(4),
		tradeFingerprint(page.context.OrbitScene.sim)].join('|');
}

/*
 * Short landing hops keep the run multi-shot: a greedy long shot can tour all
 * 26 systems in two flights, and the vm clock never trips the prediction budget,
 * so long in-flight continuations would dominate the bench time.
 */
const FIRST_ORIGINS = [0, 6, 12, 18, 24];

function chooseShot(page, horizon = 20) {
	const cargo = page.context.GravityScene.sim;
	const keep = cargo.horizon;
	cargo.horizon = horizon;
	let best = null;
	const origins = cargo.landedBody >= 0 ? [cargo.landedBody] : FIRST_ORIGINS;
	for (const p of origins) {
		for (let a = 0; a < 48; a++) {
			for (const speed of [100, 150, 200, 250]) {
				const angle = (a + 0.37) / 48 * Math.PI * 2;
				cargo.predict(p, angle, speed);
				const lands = cargo.predReason === END_IMPACT && cargo.predBody !== p;
				const score = (lands ? 1000 : 0) + cargo.predNewVisits * 10 - cargo.predTime;
				if (!best || score > best.score) best = { p, angle, speed, score };
			}
		}
	}
	cargo.horizon = keep;
	return best;
}

const SCRIPT = [
	{ src: 'srcPlanets' }, { src: 'srcPlanets' }, { src: 'srcPlanets' },
	{ src: 'srcPorts' }, { src: 'srcPorts' }, { src: 'srcPorts' },
	{ src: 'srcPlanets' }, { src: 'srcPlanets' }
];

function playScript() {
	const page = loadPage({ hash: '#game=1&seed=31&rate=3' });
	const scene = page.context.GravityScene;
	const cargo = scene.sim;
	page.runFrames(2, 16.7);
	const ends = [];
	for (const step of SCRIPT) {
		page.choose(step.src);
		page.runFrames(1, 16.7);
		const shot = chooseShot(page);
		page.dragAim(shot.p, shot.angle, shot.speed);
		page.runFrames(1, 16.7);
		const fired = scene.game.shots.length;
		page.click('launch');
		if (scene.game.shots.length !== fired + 1) throw new Error('scripted shot did not fire');
		for (let f = 0; cargo.status === STATUS_FLYING; f++) {
			page.runFrames(1, 16.7);
		}
		ends.push(endName(cargo.endReason) + (cargo.endReason === END_IMPACT ? ' P' + cargo.endBody : ''));
	}
	page.runFrames(2, 16.7);
	page.click('gameCopy');
	return { page, link: page.clipboardText, state: pageState(page), ends,
		score: page.elements.get('gameScore').textContent };
}

function endName(reason) {
	return ['open', 'impact', 'exit', 'cap', 'budget', 'abort'][reason];
}

function replayAt(link, label, stepMs, speedClicks) {
	const page = loadPage({ hash: link.slice(link.indexOf('#')) });
	const replay = page.context.GravityScene.replay;
	for (let k = 0; k < speedClicks; k++) page.click('replaySpeed');
	const started = Date.now();
	let frames = 0;
	if (stepMs === 'skip') {
		page.runFrames(1, 16.7);
		page.click('replaySkip');
	} else {
		while (replay.on && frames < 400000) {
			page.runFrames(1, typeof stepMs === 'function' ? stepMs(frames) : stepMs);
			frames += 1;
		}
	}
	page.runFrames(1, 16.7);
	return { label, frames, ms: Date.now() - started, state: pageState(page),
		verdict: page.elements.get('replayReadout').textContent };
}

function benchReplay() {
	const started = Date.now();
	const played = playScript();
	const playMs = Date.now() - started;
	const steps = played.page.context.GravityScene.game.steps;
	console.log('scripted game (seed 31, rate 3, 60 Hz):', played.score, '· ends', played.ends.join(', '),
		'· ' + steps + ' steps · ' + playMs + ' ms');
	console.log('  link', played.link.slice(played.link.indexOf('#')).length + ' chars:',
		played.link.slice(played.link.indexOf('#')));
	const jitter = seededRandom(1234);
	const cases = [
		replayAt(played.link, '144 Hz x4', 1000 / 144, 1),
		replayAt(played.link, 'jitter 4-45 ms + 120 ms stalls x1', () => (jitter() < 0.03 ? 120 : 4 + jitter() * 41), 0),
		replayAt(played.link, '60 Hz x16', 16.7, 2),
		replayAt(played.link, 'skip', 'skip', 0)
	];
	for (const c of cases) {
		const same = c.state === played.state;
		check(same, 'replay ' + c.label + ' differs:\n  ' + c.state + '\n  ' + played.state);
		check(c.verdict.startsWith('verified ✓'), 'replay ' + c.label + ' verdict ' + c.verdict);
		console.log('  replay ' + c.label + ':', same ? 'identical' : 'DIFFERS', '·', c.verdict,
			'·', c.frames ? c.frames + ' frames · ' : '', c.ms + ' ms');
	}
}

/* 3b. route: one finished traced plan is the score; nothing is launched */
function chooseRouteShot(page) {
	const scene = page.context.GravityScene;
	const cargo = scene.sim;
	const keep = cargo.horizon;
	cargo.horizon = 12;
	let best = null;
	for (const p of FIRST_ORIGINS) {
		if (scene.routeOccupiedBy(p) >= 0) continue;
		for (let a = 0; a < 48; a++) {
			for (const speed of [80, 120, 160]) {
				const angle = (a + 0.37) / 48 * Math.PI * 2;
				cargo.predict(p, angle, speed);
				if (cargo.predReason !== END_IMPACT || cargo.predBody === p) continue;
				const score = cargo.predLength - cargo.predTime * 6;
				if (!best || score > best.score) best = { p, angle, speed, score };
			}
		}
	}
	cargo.horizon = keep;
	if (!best) throw new Error('no route shot found');
	return best;
}

function playRoute() {
	const page = loadPage({ hash: '#game=1&seed=31&rate=3' });
	const scene = page.context.GravityScene;
	const cargo = scene.sim;
	page.runFrames(2, 16.7);
	page.choose('modeRoute');
	page.runFrames(1, 16.7);
	if (scene.rule() !== GravityGame.RULE_ROUTE) throw new Error('rule did not switch');
	if (!page.elements.get('launch').disabled) throw new Error('route planner left launch enabled');
	const shot = chooseRouteShot(page);
	page.dragAim(shot.p, shot.angle, shot.speed);
	let frames = 0;
	while ((!scene.routePlan().ready || cargo.routeActive) && frames < 1000) {
		page.runFrames(1, 16.7);
		frames += 1;
	}
	const plan = scene.routePlan();
	if (!plan.ready || plan.steps <= 0) throw new Error('route plan did not finish tracing');
	if (scene.game.shots.length !== 1) throw new Error('route did not record one plan');
	if (cargo.status === STATUS_FLYING || cargo.liveSteps !== 0) {
		throw new Error('route planner launched the cargo');
	}
	page.click('launch');
	page.runFrames(10, 16.7);
	if (scene.game.shots.length !== 1 || cargo.status === STATUS_FLYING) {
		throw new Error('route launch control started a flight');
	}
	page.click('gameCopy');
	const end = endName(plan.reason) + (plan.reason === END_IMPACT ? ' P' + plan.body : '');
	return { page, link: page.clipboardText, state: pageState(page), end, frames,
		plan: { steps: plan.steps, length: plan.length, visits: plan.visits },
		score: page.elements.get('gameScore').textContent, length: scene.routeLength() };
}

function benchRoute() {
	const started = Date.now();
	const played = playRoute();
	const playMs = Date.now() - started;
	const decoded = GravityGame.decodeLink(played.link.slice(played.link.indexOf('#')));
	check(played.link.indexOf('&rule=route&') > 0, 'route link lost its rule: ' + played.link);
	check(decoded && decoded.shots.length === 1 && decoded.length === Math.round(played.length),
		'route link does not carry one plan and its length: ' + played.link);
	check(played.score === Math.round(played.length) + ' px',
		'route scoreboard is not the plan length: ' + played.score);
	check(played.plan.steps > 0 && played.frames > 0, 'route plan was not traced over frames');
	console.log('route planner (seed 31, rate 3, 60 Hz):', played.score, '· ends', played.end,
		'· ' + played.plan.steps + ' steps in ' + played.frames + ' sliced frames · ' + playMs + ' ms');
	console.log('  plan', (played.plan.steps * GravitySim.DT).toFixed(1) + ' s / ' +
		Math.round(played.plan.length) + ' px · no launch · world stayed at t+07:00');
	console.log('  link', played.link.slice(played.link.indexOf('#')).length + ' chars:',
		played.link.slice(played.link.indexOf('#')));
	const jitter = seededRandom(4321);
	const cases = [
		replayAt(played.link, '60 Hz trace', 16.7, 0),
		replayAt(played.link, 'jitter 4-45 ms + 120 ms stalls',
			() => (jitter() < 0.03 ? 120 : 4 + jitter() * 41), 0),
		replayAt(played.link, 'skip trace', 'skip', 0)
	];
	for (const c of cases) {
		const same = c.state === played.state;
		check(same, 'route replay ' + c.label + ' differs:\n  ' + c.state + '\n  ' + played.state);
		check(c.verdict.startsWith('verified ✓'), 'route replay ' + c.label + ' verdict ' + c.verdict);
		console.log('  replay ' + c.label + ':', same ? 'identical' : 'DIFFERS', '·', c.verdict,
			'·', c.frames ? c.frames + ' frames · ' : '', c.ms + ' ms');
	}
}

/* 3c. money mode (0.3.2): the purse is a pure function of the shot list */

/*
 * Two greedy tours on seed 31 rate 3 under the per-planet growing profit
 * market (purse0 = 3.00, cost = 1.00, initial slope k = 0.00625/s easing
 * asymptotically to the 3.00 cap), played at x8.
 */
const MONEY_TOURS = [
	{ horizon: 12, shots: 11, purse: 0.1935 },
	{ horizon: 60, shots: 6, purse: 10.6310 }
];

function playMoneyTour(horizon) {
	const page = loadPage({ hash: '#game=1&seed=31&rate=3' });
	const scene = page.context.GravityScene;
	const cargo = scene.sim;
	page.runFrames(2, 16.7);
	for (let i = 0; i < 3; i++) page.click('playFaster');
	const rows = [];
	while (cargo.visitedCount < PLANETS && scene.game.money.purse >= 1 && rows.length < 30) {
		const shot = chooseShot(page, horizon);
		page.dragAim(shot.p, shot.angle, shot.speed);
		page.runFrames(1, 16.7);
		page.click('launch');
		let frames = 0;
		while (cargo.status === STATUS_FLYING && frames < 200000) {
			page.runFrames(1, 16.7);
			frames += 1;
		}
		rows.push(scene.game.money.shotVisits + '/' + (cargo.liveSteps * GravitySim.DT).toFixed(1));
	}
	page.runFrames(2, 16.7);
	page.click('gameCopy');
	return { page, link: page.clipboardText, rows,
		purse: scene.game.money.purse, shots: scene.game.shots.length };
}

function benchMoney() {
	const started = Date.now();
	for (const row of MONEY_TOURS) {
		const tour = playMoneyTour(row.horizon);
		check(tour.shots === row.shots, 'greedy ' + row.horizon + ' s tour took ' +
			tour.shots + ' shots, expected ' + row.shots);
		check(Math.abs(tour.purse - row.purse) <= 0.05, 'greedy ' + row.horizon +
			' s tour purse ' + tour.purse.toFixed(4) + ', expected ' + row.purse);
		const replayed = replayAt(tour.link, 'skip', 'skip', 0);
		check(replayed.state === pageState(tour.page),
			'money tour ' + row.horizon + ' s replay differs:\n  ' + replayed.state +
			'\n  ' + pageState(tour.page));
		check(replayed.verdict.startsWith('verified ✓'),
			'money tour replay verdict ' + replayed.verdict);
		const net = tour.purse - GravityGame.MONEY.purse0;
		console.log('money tour ' + row.horizon + ' s:', tour.rows.join(' · '),
			'· purse', tour.purse.toFixed(2), (net >= 0 ? '+' : '') + net.toFixed(2),
			'· replay', replayed.verdict);
	}
	console.log('  both tours replayed the purse exactly ·', Date.now() - started, 'ms');
}

/*
 * A run that burns its purse with low-profit natural flights: launches are
 * refused when broke, and the recorded link still replays and verifies.
 */
function benchBroke() {
	const page = loadPage({ hash: '#game=1&seed=31&rate=3' });
	const scene = page.context.GravityScene;
	const cargo = scene.sim;
	page.runFrames(2, 16.7);
	for (let i = 0; i < 3; i++) page.click('playFaster');
	while (scene.game.money.purse >= 1 && scene.game.shots.length < 30) {
		const origin = cargo.landedBody >= 0 ? cargo.landedBody : 0;
		let angle = 0;
		let speed = 30;
		let fewest = Infinity;
		for (let a = 0; a < 72 && fewest > 0; a++) {
			for (const v of [30, 60, 120, 200, 320]) {
				const trial = a / 72 * Math.PI * 2;
				cargo.predict(origin, trial, v);
				if (cargo.predNewVisits < fewest) {
					fewest = cargo.predNewVisits;
					angle = trial;
					speed = v;
				}
			}
		}
		page.dragAim(origin, angle, speed);
		page.runFrames(1, 16.7);
		const fired = scene.game.shots.length;
		page.click('launch');
		if (scene.game.shots.length !== fired + 1) throw new Error('waste shot did not fire');
		let guard = 0;
		while (cargo.status === STATUS_FLYING && guard++ < 2000) page.runFrames(1, 16.7);
		check(cargo.status !== STATUS_FLYING, 'waste shot did not finish');
	}
	check(scene.game.money.purse < 1, 'the run did not go broke: ' + scene.game.money.purse);
	const brokePurse = scene.game.money.purse;
	page.dragAim(cargo.landedBody >= 0 ? cargo.landedBody : 0, 0.7, 120);
	page.runFrames(1, 16.7);
	const fired = scene.game.shots.length;
	page.click('launch');
	check(scene.game.shots.length === fired, 'a broke run accepted a launch');
	page.click('gameCopy');
	const replayed = replayAt(page.clipboardText, 'skip', 'skip', 0);
	check(replayed.verdict.startsWith('verified ✓'), 'broke replay verdict ' + replayed.verdict);
	check(Math.abs(page.context.GravityScene.game.money.purse - brokePurse) < 1e-9,
		'broke replay purse differs');
	console.log('broke run:', scene.game.shots.length, 'shots · purse left',
		brokePurse.toFixed(2), '· launch refused · replay', replayed.verdict);
}

/* 4. cross-engine proxy */
const f64 = new Float64Array(1);
const i64 = new BigInt64Array(f64.buffer);
function nextUp(x) {
	f64[0] = x;
	i64[0] += x >= 0 ? 1n : -1n;
	return f64[0];
}

function flyOnce(cargo, t0, rate, p, angle, speed) {
	cargo.clear();
	cargo.fieldT = t0;
	cargo.fieldRate = rate;
	cargo.stepLimit = GravityGame.CAP_STEPS;
	cargo.limitReason = GravitySim.END_TIME;
	cargo.launch(p, angle, speed);
	while (cargo.status === STATUS_FLYING) cargo.step(0.2);
	return { reason: cargo.endReason, body: cargo.endBody, visits: cargo.visitedCount, steps: cargo.liveSteps,
		x: cargo.cargo.x, y: cargo.cargo.y };
}

function sweepUlp(cargo, label, t0, rate, nudgeField) {
	const baseFill = cargo.fillField;
	const nudged = function (t, outX, outY, count) {
		baseFill(t, outX, outY, count);
		for (let i = 0; i < count; i++) {
			outX[i] = nextUp(outX[i]);
			outY[i] = nextUp(outY[i]);
		}
	};
	let flights = 0;
	let flips = 0;
	let worst = 0;
	const drift = [];
	for (let p = 0; p < PLANETS; p++) {
		for (let a = 0; a < 24; a++) {
			for (const speed of [90, 160, 240]) {
				const angle = (a + 0.5) / 24 * Math.PI * 2;
				const base = flyOnce(cargo, t0, rate, p, angle, speed);
				if (nudgeField) cargo.fillField = nudged;
				const other = flyOnce(cargo, t0, rate, p, nudgeField ? angle : nextUp(angle), speed);
				cargo.fillField = baseFill;
				flights += 1;
				if (base.reason !== other.reason || base.body !== other.body ||
					base.visits !== other.visits || base.steps !== other.steps) {
					flips += 1;
					continue;
				}
				const d = Math.hypot(base.x - other.x, base.y - other.y);
				drift.push(d);
				if (d > worst) worst = d;
			}
		}
	}
	drift.sort((u, v) => u - v);
	const at = q => drift[Math.min(drift.length - 1, Math.floor(q * drift.length))];
	console.log('  ' + label + ':', flights, 'flights,', flips, 'outcome flips · end drift median',
		at(0.5).toExponential(1), 'p99', at(0.99).toExponential(1), 'max', worst.toExponential(1), 'px');
	check(flips === 0, label + ' flipped ' + flips + ' outcomes');
}

function benchUlp() {
	const page = loadPage();
	const cargo = page.context.GravityScene.sim;
	const t0 = page.context.OrbitScene.sim.t;
	console.log('cross-engine proxy (1 ulp):');
	sweepUlp(cargo, 'planets · launch angle', t0, 0, false);
	page.choose('srcPorts');
	sweepUlp(cargo, 'ports x3 · launch angle', t0, 3, false);
	sweepUlp(cargo, 'ports x3 · every port position', t0, 3, true);
}

benchTrade();
benchCodec();
benchReplay();
benchRoute();
benchMoney();
benchBroke();
benchUlp();
console.log(failures === 0 ? 'GAME BENCH OK' : 'GAME BENCH FAILED (' + failures + ')');
if (failures > 0) process.exitCode = 1;

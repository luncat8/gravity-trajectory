/* Three-bot career capture and playback check, using the page's own clipboard
 * and open-replay paths. No human inputs; the page still records fireQueued
 * for the player-seat barrel. Sparse replays need the matching bot code.
 * MAP=10 RATE=0.5 STEPS=120473 OUT=archive/replays/run.txt node experiments/career_replay_capture.js */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadPage } = require('./dom_stub.js');

const MAP = Number(process.env.MAP || 10);
const STEPS = Number(process.env.STEPS || 120473);
const RATE = Number(process.env.RATE || 0.5);
const OUT = process.env.OUT || 'archive/replays/career-3bots.txt';
const names = ['YOU', 'R1', 'R2'];
const live = loadPage({ search: '?map=' + MAP + '&rate=' + RATE + '&you=bot' });
const get = (env, code) => vm.runInContext(code, env.context);
assert.ok(get(live, 'game.on && careerRule()'), 'the map did not boot a career');
assert.strictEqual(get(live, 'slotTypes.slice(0, slotCount()).join(",")'), 'bot,bot,bot');

/* Observe ownership at impact, not at the end (when the landing may have
 * been claimed or seized). This counter spans refinancings, unlike a ledger. */
const unclaimed = [0, 0, 0];
const { GravityScene, GravityGame, GravityBot, GravitySim } = live.context;
const seconds = steps => GravitySim.gameSeconds(steps).toFixed(2);
const activity = names.map(() => ({ flights: 0, returns: 0, flightSteps: 0, stop: 0, longestGap: 0, sits: 0, noShots: 0 }));
const bot = GravityScene.bot;
const trace = bot.traceAdd;
bot.traceAdd = function (index, decision, detail, step, move) {
	const slot = index === GravityBot.PLAYER_INDEX ? 0 : index + 1;
	if (index >= 0 && slot < activity.length) {
		const row = activity[slot];
		if (decision === 'fire') row.longestGap = Math.max(row.longestGap, step - row.stop);
		if (decision === 'sit') row.sits++;
		if (decision === 'no shot') row.noShots++;
	}
	return trace.call(this, index, decision, detail, step, move);
};
const first = [null, null, null];
const build = GravityGame.buildGear;
GravityGame.buildGear = function (career, planet, kind, item) {
	const before = career.padCount;
	const bought = build(career, planet, kind, item);
	if (bought && career.padCount > before && career.at === planet && !first[career.index]) {
		first[career.index] = `P${planet} ${item.id} (g ${GravityScene.bot.strength[planet]}) @ ${get(live, 'game.clockSteps')}`;
	}
	return bought;
};
const land = GravityScene.bot.traceCareerLanding;
GravityScene.bot.traceCareerLanding = function (career, sim, step) {
	const row = activity[career.index];
	row.stop = step;
	row.flightSteps += sim.liveSteps;
	if (career.at >= 0) row.flights++;
	if (career.at === sim.origin) row.returns++;
	if (career.at >= 0 && !career.pads[career.at].catapult && GravityGame.planetBuildable(career, career.at)) {
		unclaimed[career.index]++;
	}
	return land.call(this, career, sim, step);
};

/* A refinanced company gets a fresh ledger. Keep the old activity for a
 * fair whole-run comparison rather than silently counting just its last life. */
const retired = names.map(() => ({ flights: 0, visits: 0, profit: 0, restarts: 0 }));
const stats = {};
const restart = GravityScene.bot.careerRestart;
GravityScene.bot.careerRestart = function (r, index, trade, step) {
	const totals = retired[r.career.index];
	totals.flights += r.career.flights;
	totals.visits += r.career.visitIncome;
	GravityGame.careerStats(stats, r.career);
	totals.profit += stats.profit;
	totals.restarts++;
	return restart.call(this, r, index, trade, step);
};

function finish(env, slice) {
	const advance = get(env, `(limit) => {
		playAcc = 0;
		stepGame(performance.now(), (limit + 0.25) * DT / playScale());
		return game.clockSteps;
	}`);
	for (let step = get(env, 'game.clockSteps'); step < STEPS;) {
		const after = advance(Math.min(slice, STEPS - step));
		assert.ok(after > step && after <= STEPS, 'clock stalled or overshot at ' + step);
		step = after;
	}
}

finish(live, 240);
live.click('gameCopy');
const payload = live.clipboardText;
const data = live.context.CareerActions.decode(payload);
assert.ok(data && data.steps === STEPS, 'expected a sparse replay at step ' + STEPS);

/* Import on a clean page at a different playback cadence. The page verifies
 * the selected history; compare all three companies, including pad charge. */
const replay = loadPage({ search: '?mode=lab&seed=7' });
replay.elements.get('replayInput').value = payload;
replay.click('replayLoad');
assert.ok(get(replay, 'careerActionReplay.active'));
assert.strictEqual(get(replay, 'game.clockSteps'), 0, 'replay must start at the opening');
finish(replay, 173);
assert.match(replay.elements.get('careerMsg').textContent, /history matches/);
assert.strictEqual(get(replay, 'careerActionReplay.skipped'), 0);
const state = 'JSON.stringify(careerRecordingSnapshot().state.careers)';
assert.strictEqual(get(replay, state), get(live, state), 'company states differ after playback');
for (let i = 0; i < names.length; i++) {
	const history = 'JSON.stringify(careerEventsFor(' + i + '))';
	assert.strictEqual(get(replay, history), get(live, history), names[i] + ' history differs after playback');
}

console.log('seed', data.seed, '· map', MAP, '· step', data.steps, '· rate', data.rate);
for (let i = 0; i < names.length; i++) {
	const c = GravityScene.career.galaxy.actors[i];
	const past = retired[i];
	GravityGame.careerStats(stats, c);
	const profit = past.profit + stats.profit;
	console.log(names[i] + ' · first on-site EMC ' + (first[i] || 'none') +
		' · ' + unclaimed[i] + ' unclaimed landings · ' + c.padCount + ' pads · ' + c.flights +
		' flights · purse ' + c.ledger.purse.toFixed(2) + ' · visits ' + c.visitIncome.toFixed(2) +
		' · build ' + c.buildSpent.toFixed(2) + ' · fees ' + c.feesPaid.toFixed(2) +
		' · tax +' + c.taxEarned.toFixed(2) + ' / −' + c.taxPaid.toFixed(2) +
		' · ' + c.delivered + ' delivered · ' + c.evacuations + ' evac · repairs ' + c.maintenanceSpent.toFixed(2) +
		' · ' + past.restarts + ' restarts' + (c.ended ? ' · ended ' + c.ended : ''));
	const row = activity[i];
	const partial = c.flying ? get(live, 'slotSim(' + i + ').liveSteps') : 0;
	if (!c.flying) row.longestGap = Math.max(row.longestGap, STEPS - row.stop);
	console.log('  ' + row.flights + ' landings · ' + row.returns + ' returns · ' +
		seconds(row.flightSteps + partial) + ' s flying · longest gap ' + seconds(row.longestGap) +
		' s · ' + row.sits + ' sits · ' + row.noShots + ' no shots' +
		' · operating profit ' + profit.toFixed(2) + ' (' + (profit / GravitySim.gameSeconds(STEPS)).toFixed(4) + '/game s)');

	if (past.restarts) console.log('  including retired ledgers: ' + (c.flights + past.flights) +
		' flights · visits ' + (c.visitIncome + past.visits).toFixed(2));
}
const file = path.resolve(__dirname, '..', OUT);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, payload + '\n');
console.log('verified and wrote', OUT, '·', data.actions.length, 'actions ·', data.events.length, 'watched events');

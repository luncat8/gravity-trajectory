/*
 * Three-bot career capture: boots a saved map with every seat handed to the
 * bot, flies the world clock to a step endpoint and writes the page's own
 * `copy career replay` payload (`GRAVITY_ACTIONS:` v3) to a file, plus the
 * scoreboard of all three companies.
 *
 * The payload is the exact text the page copies, so it opens with
 * `open replay` / `load from link` and re-flies the run deterministically:
 * no seat takes a human input, so the recording holds no actions at all and
 * the bots alone reproduce it.
 *
 *   node experiments/career_replay_capture.js                       # ?map=10, 120473 steps
 *   MAP=10 STEPS=120473 RATE=0.5 OUT=archive/replays/run.txt node …
 *
 * Not a gate: it prints numbers and writes a file.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadPage } = require('./dom_stub.js');

const root = path.join(__dirname, '..');
const MAP = Number(process.env.MAP || 10);
const STEPS = Number(process.env.STEPS || 120473);
const RATE = Number(process.env.RATE || 0.5);
const OUT = process.env.OUT || 'archive/replays/career-3bots.txt';
const SLICE = 240;

const env = loadPage({ search: '?map=' + MAP + '&rate=' + RATE + '&you=bot' });
const get = (code) => vm.runInContext(code, env.context);

if (!get('game.on') || !get('careerRule()')) throw new Error('the map did not boot a career');
if (get('slotTypes.slice(0, 3).join(",")') !== 'bot,bot,bot') {
	throw new Error('every seat must be a bot: ' + get('slotTypes.slice(0, 3).join(",")'));
}

/* one frame's worth of settled steps, without the render loop */
const advance = get(`(limit) => {
	playAcc = 0;
	stepGame(performance.now(), (limit + 0.25) * DT / playScale());
	return game.clockSteps;
}`);
let step = get('game.clockSteps');
for (let guard = 0; step < STEPS; guard++) {
	if (guard > 1e6) throw new Error('the clock stalled at step ' + step);
	const after = advance(Math.min(SLICE, STEPS - step));
	if (after <= step) throw new Error('the clock stalled at step ' + step);
	step = after;
}

env.click('gameCopy');
const payload = env.clipboardText;
if (!payload || !payload.startsWith('GRAVITY_ACTIONS:')) {
	throw new Error('gameCopy did not copy the sparse career recording');
}
const data = env.context.CareerActions.decode(payload);
if (!data || data.steps !== STEPS) throw new Error('the recording does not end at step ' + STEPS);

function company(slot) {
	const at = slot === 0 ? 'game.career' : 'bot.rivals[' + (slot - 1) + '].career';
	const value = (field) => get(at + '.' + field);
	return {
		purse: value('ledger.purse'), pads: value('padCount'), flights: value('flights'),
		visits: value('visitIncome'), build: value('buildSpent'), fees: value('feesPaid'),
		taxEarned: value('taxEarned'), taxPaid: value('taxPaid'), delivered: value('delivered'),
		evacuations: value('evacuations'), repairs: value('repairs'),
		spentRepair: value('maintenanceSpent'), ended: value('ended')
	};
}

const rows = [0, 1, 2].map(company);
const money = (v) => v.toFixed(2).padStart(7);
console.log('seed', get('game.seed'), '· map', MAP, '· step', step, '· t+' +
	(step * get('DT')).toFixed(1) + ' s · rate', RATE);
for (let i = 0; i < rows.length; i++) {
	const r = rows[i];
	console.log('  ' + ['YOU', 'R1 ', 'R2 '][i] + ' purse' + money(r.purse) + ' · ' +
		r.pads + ' pads · ' + r.flights + ' flights · visits' + money(r.visits) +
		' · build' + money(r.build) + ' · fees' + money(r.fees) +
		' · tax +' + r.taxEarned.toFixed(2) + ' / −' + r.taxPaid.toFixed(2) +
		' · ' + r.delivered + ' delivered · ' + r.evacuations + ' evac · ' +
		r.repairs + ' repairs ' + r.spentRepair.toFixed(2) + (r.ended ? ' · ended ' + r.ended : ''));
}
const total = rows.reduce((sum, r) => sum + r.purse, 0);
console.log('  combined purse ' + total.toFixed(2) + ' · pads ' +
	rows.reduce((sum, r) => sum + r.pads, 0) + ' · visits ' +
	rows.reduce((sum, r) => sum + r.visits, 0).toFixed(2));

const file = path.join(root, OUT);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, payload + '\n');
console.log('wrote ' + OUT + ' · ' + payload.length + ' chars · ' + data.actions.length + ' actions');

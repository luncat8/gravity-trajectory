/*
 * One entry point for the check tiers in experiments/. Every listed file is a
 * standalone node script that exits non-zero on failure, so the runner only
 * keeps the order, the totals and the handful of files that are red on a
 * clean main (KNOWN_RED: they run, they do not sink the tier, and a green
 * result means the note below is stale).
 *
 * Run: node experiments/run_fast.js              fast tier (the per-edit loop)
 *      node experiments/run_fast.js --slow      + slow logic and page boots
 *      node experiments/run_fast.js --bench     + benches (laws and budgets)
 *      node experiments/run_fast.js --smoke     + the whole page in a stub DOM
 *      node experiments/run_fast.js --only=career_pause   one file, any tier
 *      node experiments/run_fast.js --list      what the tiers hold
 *      node experiments/run_fast.js --keep-going          all failures, not the first
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

/* red at f987145 on a clean main, for reasons experiments/README.md explains:
 * a fixture that never arms the bot's exit probe, colours pinned to a seed */
const KNOWN_RED = {
	'bot_gravity_test.js': 'careerNextPad fixture never arms exitProbe (pick −1)',
	'gravity_view_test.js': 'drag-zone colours at seed 61, red since 0.7.1',
	'career_bench.js': '3 known failures, findings-pitfalls-skills.md',
	'career_bot_bench.js': '10 known failures, findings-pitfalls-skills.md',
	'bot_bench.js': '1 known failure, findings-pitfalls-skills.md'
};

/* logic only, no page boot: the tier you can afford after every edit */
const FAST = [
	['balance_changes_test.js', 0.2],
	['bribe_score_test.js', 0.2],
	['wear_flight_test.js', 0.2],
	['trade_route_mask_test.js', 0.6],
	['balance_lab_test.js', 2],
	['career_stats_test.js', 3],
	['career_wear_test.js', 6],
	['obs_test.js', 8],
	['career_expansion_start_test.js', 10],
	['fragile_test.js', 10],
	['politics_test.js', 15],
	['saved_map_test.js', 30]
];

/* a page test pays one career boot before its first assertion (~35 s here) */
const SLOW = [
	['orbit_clock_test.js', 5],
	['special_planets_test.js', 128],
	['sound_test.js', 34],
	['trajectory_sound_test.js', 0.2],
	['voronoi_sound_test.js', 1.2],
	['multiplayer_career_test.js', 38],
	['multiplayer_pause_preview_test.js', 38],
	['multiplayer_impulse_test.js', 41],
	['wear_forecast_gui_test.js', 39],
	['obs_fragile_gui_test.js', 44],
	['gravity_view_test.js', 189],
	['helper_multiplayer_test.js', 157],
	['career_guidance_test.js', 40],
	['politics_gui_test.js', 45],
	['profit_monotonic_test.js', 55],
	['career_pause_test.js', 80],
	['career_departure_test.js', 95],
	['career_start_seat_test.js', 105],
	['player_growth_test.js', 900]
];

/* measurement, not regression: run when a law, a budget or a bot changed */
const BENCH = [
	['gravity_seed_test.js', 360],
	['gravity_bench.js', 120],
	['colony_bench.js', 120],
	['route_bench.js', 180],
	['bot_bench.js', 180],
	['game_bench.js', 300],
	['career_bench.js', 240],
	['career_bot_bench.js', 330],
	['career_gravity_bench.js', 240]
];

/* the whole page wiring in a stub DOM: once per plan, not per step */
const SMOKE = [['dom_smoke.js', 1500]];

const TIERS = [
	['fast', 'per-edit logic checks', FAST],
	['slow', 'slow logic and one page boot each', SLOW],
	['bench', 'measurement benches', BENCH],
	['smoke', 'page integration in a stub DOM', SMOKE]
];

const args = process.argv.slice(2);
const has = name => args.includes('--' + name);
const keepGoing = has('keep-going');

function minutes(seconds) {
	return '~' + Math.max(1, Math.round(seconds / 60)) + ' min';
}

function selected() {
	const only = args.find(arg => arg.startsWith('--only='));
	if (only) {
		const want = only.slice('--only='.length);
		const hit = TIERS.flatMap(tier => tier[2]).filter(entry => entry[0].includes(want));
		return hit.length ? [['only', 'matched ' + want, hit]] : [];
	}
	const names = ['fast'];
	if (has('slow')) names.push('slow');
	if (has('bench')) names.push('bench');
	if (has('smoke')) names.push('smoke');
	return names.map(name => TIERS.find(tier => tier[0] === name));
}

if (has('list')) {
	for (const tier of TIERS) {
		const total = tier[2].reduce((sum, entry) => sum + entry[1], 0);
		console.log('\n' + tier[0] + ' — ' + tier[1] + ' (' + minutes(total) + ')');
		for (const entry of tier[2]) {
			const mark = KNOWN_RED[entry[0]] ? '  (known red)' : '';
			console.log('\t' + entry[0] + '\t~' + entry[1] + ' s' + mark);
		}
	}
	console.log('\nbrowser only (needs CHROME_PATH), never in a tier:');
	console.log('\tfield_gl_test.js · sound_browser_test.js');
	process.exit(0);
}

const KNOWN_ARGS = ['--slow', '--bench', '--smoke', '--keep-going', '--list', '--only='];
if (!args.every(arg => KNOWN_ARGS.includes(arg) ||
		(arg.startsWith('--only=') && arg.length > 7))) {
	console.error('usage: node experiments/run_fast.js [--slow] [--bench] [--smoke] ' +
		'[--only=name] [--list] [--keep-going]');
	process.exit(2);
}

const failures = [];
const knownRed = [];
const staleKnown = [];
const t0 = Date.now();
for (const tier of selected()) {
	console.log('\n== ' + tier[0] + ' — ' + tier[1]);
	for (const entry of tier[2]) {
		const file = entry[0];
		const note = KNOWN_RED[file];
		const started = Date.now();
		const run = spawnSync(process.execPath, [path.join(__dirname, file)], { cwd: path.join(__dirname, '..') });
		const seconds = Math.round((Date.now() - started) / 100) / 10;
		if (run.status === 0) {
			if (note) staleKnown.push(file);
			console.log('ok   ' + file + ' (' + seconds + ' s)');
			continue;
		}
		if (note) {
			knownRed.push(file);
			console.log('red  ' + file + ' (' + seconds + ' s) known: ' + note);
			continue;
		}
		failures.push(file);
		console.log('FAIL ' + file + ' (' + seconds + ' s, exit ' + run.status + ')');
		if (!keepGoing) break;
	}
	if (failures.length && !keepGoing) break;
}
const seconds = Math.round((Date.now() - t0) / 1000);
if (knownRed.length) console.log('\nknown red, not this tier\'s failure: ' + knownRed.join(', '));
if (staleKnown.length) {
	console.log('now green, update the notes in experiments/README.md: ' + staleKnown.join(', '));
}
if (failures.length) {
	console.log('\nfailed: ' + failures.join(', ') + ' · ' + seconds + ' s');
	process.exit(1);
}
console.log('\nall checks passed · ' + seconds + ' s');

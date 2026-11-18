/*
 * One entry point for the check tiers in experiments/. Every listed file is a
 * standalone node script that exits non-zero on failure, so the runner only
 * keeps the order, the totals and the handful of files that are red on a
 * clean main (KNOWN_RED: they run, they do not sink the tier, and a green
 * result means the note below is stale). A red file prints why it failed,
 * known or not, and a file that runs ten times its listed cost is stopped and
 * reported as timed out, not left to look like a long run.
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
	'career_bench.js': '3 known failures, findings-pitfalls-skills.md',
	'career_bot_bench.js': '10 known failures, findings-pitfalls-skills.md'
};

/* logic only, no page boot: the tier you can afford after every edit */
const FAST = [
	['launch_reason_test.js', 0.2],
	['comms_facts_test.js', 0.4],
	['comms_topics_test.js', 0.4],
	['comms_call_test.js', 1],
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
	['saved_map_test.js', 10]
];

/* 100-seed sweeps, the seat search itself, and the page tests: those boot a
 * saved map (`mapSearch`, ~0.2 s) unless the opening search is their subject.
 * An entry may carry arguments for its script. */
const SLOW = [
	['orbit_clock_test.js', 2],
	['special_planets_test.js', 120],
	['sound_test.js', 4],
	['trajectory_sound_test.js', 0.2],
	['voronoi_sound_test.js', 1],
	['multiplayer_career_test.js', 1],
	['multiplayer_pause_preview_test.js', 1],
	['multiplayer_impulse_test.js', 1],
	['career_replay_test.js', 15],
	['career_actions_test.js', 20],
	['career_history_seed_test.js', 45],
	['wear_forecast_gui_test.js', 2],
	['obs_fragile_gui_test.js', 1],
	['gravity_view_test.js', 12],
	['helper_multiplayer_test.js', 3],
	['career_guidance_test.js', 1],
	['politics_gui_test.js', 1],
	['comms_page_test.js', 1],
	['profit_monotonic_test.js', 1],
	['career_pause_test.js', 1],
	['career_departure_test.js', 85],
	['career_start_seat_test.js', 8],
	['career_start_fairness.js', 20],
	['player_growth_test.js', 45],
	['make_saved_maps.js', 22, ['--check']]
];

/* measurement, not regression: run when a law, a budget or a bot changed */
const BENCH = [
	['gravity_seed_test.js', 40],
	['gravity_bench.js', 120],
	['colony_bench.js', 120],
	['route_bench.js', 180],
	['bot_bench.js', 60],
	['game_bench.js', 40],
	['career_bench.js', 240],
	['career_bot_bench.js', 330],
	['career_gravity_bench.js', 240]
];

/* the whole page wiring in a stub DOM: once per plan, not per step */
const SMOKE = [['dom_smoke.js', 110]];

const TIERS = [
	['fast', 'per-edit logic checks', FAST],
	['slow', 'seed sweeps, the seat search and the page tests', SLOW],
	['bench', 'measurement benches', BENCH],
	['smoke', 'page integration in a stub DOM', SMOKE]
];

const args = process.argv.slice(2);
const has = name => args.includes('--' + name);
const keepGoing = has('keep-going');

function minutes(seconds) {
	return '~' + Math.max(1, Math.round(seconds / 60)) + ' min';
}

const scriptArgs = entry => entry[2] || [];
const label = entry => [entry[0]].concat(scriptArgs(entry)).join(' ');

/* a hang ends as a named failure: ten times the listed cost, never under a minute */
const limitSeconds = entry => Math.max(60, entry[1] * 10);

/* why a file failed, without a rerun: the failures it names, else its error
 * message and the two frames under it (a check helper, then its caller), else
 * its last words */
function reasonLines(lines) {
	const named = lines.filter(line => line.includes('FAIL'));
	if (named.length) return named;
	const at = lines.findIndex(line => /^\w*Error\b/.test(line));
	return at >= 0 ? lines.slice(at, at + 3) : lines.slice(-3);
}

function failureLines(run) {
	const lines = (String(run.stdout) + String(run.stderr)).split('\n')
		.map(line => line.trim()).filter(line => line !== '');
	return reasonLines(lines).map(line => '\n\t' + line).join('');
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
			console.log('\t' + label(entry) + '\t~' + entry[1] + ' s' + mark);
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
		const file = label(entry);
		const note = KNOWN_RED[entry[0]];
		const started = Date.now();
		/* the buffer holds an assertion that prints two captured run states */
		const run = spawnSync(process.execPath,
			[path.join(__dirname, entry[0])].concat(scriptArgs(entry)),
			{ cwd: path.join(__dirname, '..'), timeout: limitSeconds(entry) * 1000,
				maxBuffer: 1 << 26 });
		const seconds = Math.round((Date.now() - started) / 100) / 10;
		const timedOut = run.error !== undefined && run.error.code === 'ETIMEDOUT';
		if (run.status === 0) {
			if (note) staleKnown.push(file);
			console.log('ok   ' + file + ' (' + seconds + ' s)');
			continue;
		}
		/* a known red still says why it failed: a new reason must not hide behind the old note */
		if (note && !timedOut) {
			knownRed.push(file);
			console.log('red  ' + file + ' (' + seconds + ' s) known: ' + note + failureLines(run));
			continue;
		}
		failures.push(file);
		console.log(timedOut
			? 'TIME ' + file + ' (stopped at ' + limitSeconds(entry) + ' s, listed ~' + entry[1] + ' s)'
			: 'FAIL ' + file + ' (' + seconds + ' s, exit ' + run.status + ')' + failureLines(run));
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

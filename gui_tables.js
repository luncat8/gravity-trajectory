/*
 * Static tables and aliases the gui reads: sim/game constants, gear, tech, science and help copy, speed and replay presets. Also declares root and the element lookup for the whole gui family, so it stays the first gui script.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

const root = typeof globalThis !== 'undefined' ? globalThis : this;

const $ = id => document.getElementById(id);
const SPEED_MIN = GravitySim.SPEED_MIN;
const SPEED_MAX = GravitySim.SPEED_MAX;
const GRIP_MAX = GravitySim.GRIP_MAX;
const STATUS_IDLE = GravitySim.STATUS_IDLE;
const STATUS_FLYING = GravitySim.STATUS_FLYING;
const STATUS_ENDED = GravitySim.STATUS_ENDED;
const END_IMPACT = GravitySim.END_IMPACT;
const END_EXIT = GravitySim.END_EXIT;
const END_TIME = GravitySim.END_TIME;
const END_TRUNCATED = GravitySim.END_TRUNCATED;
const END_ABORT = GravitySim.END_ABORT;
const DT = GravitySim.DT;
const PLANETS = OrbitSim.PLANETS;
const NO_PORT = OrbitSim.NO_PORT;
const MODE_PLANETS = GravityGame.SRC_PLANETS;
const MODE_PORTS = GravityGame.SRC_PORTS;
const NO_ABORT = GravityGame.NO_ABORT;
const RULES = GravityGame.RULES;
const RULE_TOUR = GravityGame.RULE_TOUR;
const RULE_ROUTE = GravityGame.RULE_ROUTE;
const RULE_MONEY = GravityGame.RULE_MONEY;
const RULE_CAREER = GravityGame.RULE_CAREER;
const BOT_OFF = GravityGame.BOT_OFF;
const BOT_EASY = GravityGame.BOT_EASY;
const BOT_NORMAL = GravityGame.BOT_NORMAL;
const BOT_HARD = GravityGame.BOT_HARD;
const PLAYER_USER = GravityGame.PLAYER_USER;
const PLAYER_BOT = GravityGame.PLAYER_BOT;
const MONEY = GravityGame.MONEY;
const OrbitTech = root.OrbitTech;
const OrbitScience = root.OrbitScience;
const OrbitEcon = root.OrbitEcon;
const GEAR_ROWS = [
	{ kind: OrbitTech.KIND_CATAPULT, label: 'catapult', table: OrbitTech.CATAPULTS },
	{ kind: OrbitTech.KIND_PANEL, label: 'panel', table: OrbitTech.PANELS },
	{ kind: OrbitTech.KIND_BATTERY, label: 'battery', table: OrbitTech.BATTERIES }
];
const TANK_ROW = { kind: OrbitTech.KIND_TANK, label: 'tank', table: OrbitTech.TANKS };
const ENGINE_ROW = { kind: OrbitTech.KIND_ENGINE, label: 'engine', table: OrbitTech.ENGINES };
const PART_ROWS = [
	{ kind: OrbitTech.KIND_HOLD, label: 'hold', table: OrbitTech.HOLDS },
	TANK_ROW,
	ENGINE_ROW,
	{ kind: OrbitTech.KIND_OBS, label: 'observer', table: OrbitTech.OBS }
];
/* one lookup for every shop button: kind → item table */
const TECH_TABLES = {
	catapult: OrbitTech.CATAPULTS,
	panel: OrbitTech.PANELS,
	battery: OrbitTech.BATTERIES,
	hold: OrbitTech.HOLDS,
	tank: OrbitTech.TANKS,
	engine: OrbitTech.ENGINES,
	obs: OrbitTech.OBS
};
/* §10 science: the researchable 2-D parameter spaces and their slider
 * ranges; axis order matches the hull points seeded in GravityGame */
const SCIENCE_AXES = {
	engine: [
		{ key: 'thrust', label: 'thrust kN', min: 4, max: 60, step: 0.5, digits: 1 },
		{ key: 'mass', label: 'mass t', min: 0.2, max: 3.6, step: 0.1, digits: 1 }
	],
	catapult: [
		{ key: 'maxForce', label: 'force kN', min: 10, max: 230, step: 1, digits: 0 },
		{ key: 'efficiency', label: 'efficiency', min: 0.5, max: 0.98, step: 0.01, digits: 2 }
	],
	tank: [
		{ key: 'fuelCap', label: 'fuel kg', min: 20, max: 220, step: 5, digits: 0 },
		{ key: 'emptyMass', label: 'mass t', min: 0.15, max: 1.9, step: 0.05, digits: 2 }
	],
	battery: [
		{ key: 'capacity', label: 'capacity kWh', min: 1, max: 22, step: 0.5, digits: 1 },
		{ key: 'leak', label: 'leak /pad min', min: 0.0001, max: 0.0012, step: 0.0001, digits: 4 }
	]
};
/* near-hull defaults: the first invention costs ~base fee and fits the
 * starter purse, while pushing a slider outward shows the k·dist growth */
const SCIENCE_DEFAULTS = {
	engine: { thrust: 26, mass: 1.8 },
	catapult: { maxForce: 100, efficiency: 0.76 },
	tank: { fuelCap: 100, emptyMass: 1.0 },
	battery: { capacity: 6, leak: 0.0005 }
};
const SCI_PLOT_COLS = 36;
const SCI_PLOT_ROWS = 24;
const SCI_PLOT = { width: 224, height: 158, left: 36, top: 6, right: 6, bottom: 30 };
const SCI_PLOT_STOPS = [
	[17, 39, 62], [27, 82, 108], [158, 104, 52], [204, 78, 46], [230, 54, 48]
];
/* career map-statistics strip (0.6.10 §4): six small game-clock plots under
 * the score rows; the svg scales to the panel through its viewBox */
const STATS_PLOT = { width: 224, height: 56, left: 4, top: 4, right: 4, bottom: 4 };
const STATS_LABELS = {
	profit: 'profit / time',
	property: 'property',
	science: 'science',
	flown: 'distance / time',
	rot: 'rot',
	standing: 'standing value'
};
/* the `all` mean and the two map series share one neutral line colour */
const STATS_NEUTRAL = '#9fb4c8';
let scienceFamily = OrbitTech.KIND_ENGINE;
/* the slider draft of every family: a copy of the defaults, editable in place */
const scienceValues = {};
for (const family in SCIENCE_DEFAULTS) {
	scienceValues[family] = {};
	for (const key in SCIENCE_DEFAULTS[family]) scienceValues[family][key] = SCIENCE_DEFAULTS[family][key];
}
/* one press of wait moves the clock GravitySim.WAIT_SEC game seconds — the
 * sunlight it buys is WAIT_PAD_SEC pad seconds, the trade sky drifts
 * `WAIT_SEC · TRADE_MIN_PER_GAME_SEC` trade minutes — eased over CAREER_WAIT_SEC
 * of real time so the sky visibly fast-forwards; each frame may credit at most
 * WAIT_FRAME_MS (a 50 fps budget), so a slow machine stretches the wait instead
 * of freezing the view. The button names the game seconds, the tooltip the real
 * ones. */
const CAREER_WAIT_MS = 2000;
const CAREER_WAIT_SEC = CAREER_WAIT_MS / 1000;
const WAIT_FRAME_MS = 20;
const VIEW_SPACE = 'space';
const VIEW_FIELD = 'field';
const VIEW_POTENTIAL = 'potential';
const VIEW_MODES = [VIEW_SPACE, VIEW_FIELD, VIEW_POTENTIAL];
/* zoom frames owned by the renderer: the planet field, or the whole flight area */
const FRAME_MAIN = OrbitScene.FRAME_MAIN;
const FRAME_FULL = OrbitScene.FRAME_FULL;
/* refit button `data-tier` that empties the engine slot (the tech tables have no `null` record) */
const NO_TIER = -1;
/* the flat mode row: lab has no rule, every other mode is a game rule */
const PLAY_LAB = 'lab';
/* route mode traces a 1 800 s shot in slices: per-frame slice of tracer work */
const ROUTE_STEP_MS = 4;
const ROUTE_FIELD_DELTA = 4;
/* rival search slice budget per frame so frame work stays well under 16.7 ms */
const BOT_STEP_MS = 3;
const MAX_GAME_STEPS = 256;
const PROFIT_MAX_CENTS = 300;
const PROFIT_STRINGS = new Array(PROFIT_MAX_CENTS + 1);
for (let c = 0; c <= PROFIT_MAX_CENTS; c++) {
	PROFIT_STRINGS[c] = '+' + (c / 100).toFixed(2);
}
/* special-planet pills (0.5.11): the Capital levies a fixed entry fee, A.R.F.
 * pays nothing. Cached so draw() stays 0-alloc. */
const CAPITAL_PROFIT_TEXT = GravityGame.CAPITAL_VISIT_PAY.toFixed(2);
const CAPITAL_TAG = 'CAPITAL';
const ARF_TAG = 'A.R.F.';
/* political pills (0.5.12): a rebellion and the rot that feeds it. Both are
 * cached per integer so draw() stays 0-alloc. */
const REBEL_TAG = 'REBELLION';
/* rot is only worth a pill once it is on its way to a rebellion */
const CORRUPTION_TAG_MIN = 20;
const CORRUPTION_STRINGS = new Array(101);
for (let c = 0; c <= 100; c++) CORRUPTION_STRINGS[c] = 'rot ' + c + '%';
/* a planet that went quiet (0.6.1): nobody's visit reports there */
const QUIET_STRINGS = new Array(101);
for (let c = 0; c <= 100; c++) QUIET_STRINGS[c] = 'quiet · rot ' + c + '%';
const QUIET_COLOUR = 'rgba(176, 156, 255, 0.85)';
/* Planet-card gravity lines are cached like profit lines: no strings in draw(). */
const GRAVITY_STRINGS = new Array(701);
for (let c = -200; c <= 500; c++) {
	GRAVITY_STRINGS[c + 200] = 'g ' + (c > 0 ? '+' : '') + (c / 100).toFixed(2);
}
const HEAVY_G = root.GravityField ? root.GravityField.HEAVY_G : 2;
/* Ordered by perceptual separation, including YOU's mint and the two original rivals. */
const RIVAL_COLOURS = [
	'#b99aff', '#ff85a8', '#ffc21a', '#1aff1a', '#42afd7', '#ffd4a3',
	'#a5d742', '#ff7c4d', '#1aff94', '#ffff1a', '#ff80ff', '#e7ffa3',
	'#1af0ff', '#d79b42', '#efb3e7', '#a3ff1a'
];
function rivalRgba(hex, alpha) {
	const rgb = parseInt(hex.slice(1), 16);
	return 'rgba(' + (rgb >> 16) + ', ' + ((rgb >> 8) & 255) + ', ' +
		(rgb & 255) + ', ' + alpha + ')';
}
const RIVAL_TRAILS = RIVAL_COLOURS.map((colour, i) => rivalRgba(colour, i === 1 ? 0.44 : 0.48));
const RIVAL_TAGS = RIVAL_COLOURS.map((colour, i) => 'R' + (i + 1));
const SLOT_NAMES = ['YOU', ...RIVAL_TAGS];
const REPLAY_AIM_MS = 700;
const REPLAY_GAP_MS = 450;
/* replay multipliers; index 2 is real time */
const REPLAY_SPEEDS = [0.25, 0.5, 1, 4, 16];
const REPLAY_DEFAULT = 2;
/* live playback: how fast the game is watched, in game seconds per real second;
 * the physics steps never change. One ladder in every mode — ×1 is real time —
 * and each mode opens on the rung it is balanced at: the lab at ×1, career at
 * ×4, the pace the career economy was priced at. PLAY_MAX caps the loop, so a
 * replay's ×16 over the top rung is what the cap is for. */
const PLAY_SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
const PLAY_INDEX_LAB = 2;
const PLAY_INDEX_CAREER = 4;
const PLAY_MAX_INDEX = PLAY_SPEEDS.length - 1;
const PLAY_MAX = PLAY_SPEEDS[PLAY_MAX_INDEX];
const PHASE_AIM = 0;
const PHASE_FLY = 1;
const PHASE_GAP = 2;
const SEED_RANGE = 999999;
const PORT_R = 6;
const HIT_PX = 18;
const HUD_INTERVAL = 100;
const FPS_FRAME_MS = 1000 / 60;
const FPS_DROP_MS = 17.5;
const HELPER_BUDGET_MS = 3;
const HELPER_CANDIDATE_MS = 8;
const SENS_FINE = 1 / 20;
const DRAG_TAKEOVER_PX = 7;
const WELL_BASE = 24;
const WELL_SCALE = 64;
const NO_DASH = [];
const TAU = Math.PI * 2;
const ATTRACT = 'rgba(103, 224, 255, 0.07)';
const ATTRACT_HOVER = 'rgba(103, 224, 255, 0.26)';
const ATTRACT_SELECT = 'rgba(255, 207, 110, 0.42)';
const REPEL = 'rgba(255, 126, 160, 0.10)';
const REPEL_HOVER = 'rgba(255, 126, 160, 0.32)';
const REPEL_SELECT = 'rgba(255, 207, 110, 0.48)';
const WELL_COLOURS = [
	[ATTRACT, ATTRACT_HOVER, ATTRACT_SELECT],
	[REPEL, REPEL_HOVER, REPEL_SELECT]
];
const GOLD = '#ffcf6e';
const MINT = '#8ef0c0';
const WARN = '#ff9478';
/* a rebellion has its own colour: seized ground, not a warning state */
const REBEL = '#ff7ea0';
const ICE = '#67e0ff';
const SIGN_POS = '#ff5f57';
const SIGN_NEG = '#57a8ff';
const PLATE = 'rgba(5, 13, 24, 0.92)';
const PRED_DASH = [0, 0];
const GRIP_DASH = [0, 0];
const REPEL_DASH = [0, 0];
const SYS_DASH = [0, 0];
const LOCK_DASH = [0, 0];
const COMMON_HELP = 'Drag from a planet or pad to aim; hold Shift for 1/20 fine control. ' +
	'Release to preview; in flight modes, Enter or launch fires and landing stages the next shot. ' +
	'Esc cancels an aim or queued launch. Planet gravity is seeded from −1 to +3.5; ' +
	'negative gravity repels. The seed is in the URL; a seedless startup draws a new one. ' +
	'f cycles space → gravity field → gravity potential; potential shows gravity zones by size, not direction: blue where gravity repels, see-through near zero, green where it pulls and red around a heavy planet (g ≥ +2). ' +
	'z switches the camera between the planet field and the whole flight area, where a ship that left the canvas is still visible.';
/* the politics topic (0.6.1): previewed in the help drawer while the pointer
 * is on the bribe or go-quiet row; same shape as a rule's entry */
const POLITICS_HELP = {
	name: 'corruption · bribes · reports',
	goal: 'Every visit is a report to the Capital: it pays the planet\u2019s value and cools its corruption by ' +
		OrbitEcon.CORRUPTION_VISIT_DECAY.toFixed(1) + '. Reporting while landed slowly cools rot; without reports it grows after a grace period. Tradition sets a 5% floor.',
	score: 'Once per landing the rulers pay for silence: visit value \u00d7 corruption \u00d7 ' +
		OrbitEcon.BRIBE_VALUE_COEF.toFixed(0) + '. Visit value grows at half speed while landed. A bribe raises corruption; above ' +
		OrbitEcon.REBEL_START + '% it can end in arrest (a slow Capital transport) and the planet can rebel.',
	detailLabel: 'Device',
	detail: 'The observation device ' + OrbitTech.OBS[1].id + ' (ship refit, observer) is what reports. Without it the ship is ' +
		OrbitTech.OBS[1].mass.toFixed(1) + ' t lighter, its visits pay nothing and clear nothing. Above ' +
		GravityGame.QUIET_MIN + '% corruption, go quiet takes the device off on that planet: nobody reports there ' +
		'until medics quell it, the unreported value keeps growing, and only a bribe cashes it.',
	controls: ''
};
const RULE_HELP = {
	lab: {
		name: 'lab',
		goal: 'Experiment freely.',
		score: 'No score.',
		detailLabel: '',
		detail: '',
		controls: ''
	},
	tour: {
		name: 'tour',
		goal: 'Enter every planet system.',
		score: 'Most systems. Ties: fewer launches, less flight time, higher purse.',
		detailLabel: 'Limit',
		detail: '120 s per flight. Launch costs 1.00; entering a system collects its shown profit.',
		controls: ''
	},
	route: {
		name: 'route · longest trajectory',
		goal: 'Plan one trajectory with the greatest distance.',
		score: 'Trajectory length only, until it lands or leaves the map. Systems and purse do not score.',
		detailLabel: 'Start',
		detail: 'Choose an unclaimed planet. No launch is needed—the finished traced plan is your entry.',
		controls: 'Use best restores your longest finished plan.'
	},
	money: {
		name: 'money',
		goal: 'Finish the 10-launch contract.',
		score: 'Highest purse. Ties: more systems, fewer launches, less flight time.',
		detailLabel: 'Money',
		detail: 'Launch costs 1.00. Entering a system collects its shown profit; profit grows while unvisited, easing toward +3.00 the longer it waits.',
		controls: ''
	},
	career: {
		name: 'career · catapult network',
		goal: 'Build a catapult on every active planet; rival players build theirs.',
		score: 'Purse. The run ends on completion or when you go broke.',
		detailLabel: 'Network',
		detail: 'Start at your own HQ, a seeded shallow world (g ≤ 1) the starter rail can leave; a deep well is never a home. ' +
			'Your EMC claims its planet; each planet also offers a commercial EMC-1 for ' +
			GravityGame.COMMERCIAL_BASE.toFixed(2) + ' + ' + GravityGame.COMMERCIAL_KWH.toFixed(2) +
			' per kWh of the shot (from ' + GravityGame.commercialMinFee().toFixed(2) +
			'). An owned or rival pad spends battery charge; guests also pay the owner a usage tax of the shot\u2019s energy × the rail\u2019s tier. ' +
			'A queued shot reserves its energy and fires when the barrel aligns (one turn every 2…5 s). ' +
			'On its own pad a bot buys the next panel, battery or rail only when that pad\'s last launch ' +
			'pays the price back in money per world second, a rail always with the battery that fills it. ' +
			'The career runs on the world clock; pause on landing holds it still, and each human player holds it ' +
			'separately — a hatched scoreboard row is still holding time. Evacuation to HQ costs ' +
			GravityGame.CAREER.evacFee.toFixed(2) + '. Fragile freight (light planets only, pays \u00d7' +
			GravityGame.FRAGILE_PAY.toFixed(1) + ') breaks when launched above ' +
			Math.floor(GravityGame.FRAGILE_SPEED) + ' px/s: a full-force EMC-1 is gentle enough, a stronger rail must be aimed softer. ' +
			'Deep freight (' + GravityGame.DEEP_TONS + ' t or more from a well of g ≥ ' +
			GravityGame.DEEP_G.toFixed(1) + ', pays \u00d7' + (1 + GravityGame.DEEP_BONUS).toFixed(1) +
			') needs an EMC-3+ rail at its origin.',
		controls: 'Wait charges pads. Fuel is bought or converted from your own pad battery; tanks never refill for free. With an impulse engine and fuel, pause time with Space / P or the game-bar time button, then drag the ship to aim a burn; a bot flying your company burns on its own.'
	}
};

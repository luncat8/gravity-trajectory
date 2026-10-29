/*
 * Cargo overlay: planet-system grand tour, aiming, gravity editing and HUD.
 *
 * Launches always start from static planets in every gravity mode; once the
 * ship lands on a planet, the next launch is staged from that landed body.
 * Prediction updates at up to 60 fps when gravity centres move or change (backing
 * off automatically when the smoothed frame time exceeds 17.5 ms) and continues
 * ahead of the flying container until it lands.
 *
 * Game mode (archive/game.1-plan.md): seeded world, the trade clock advances
 * only with the cargo's fixed physics steps, the aim snaps to an integer grid,
 * and a replay link re-flies every recorded shot.
 */
(function (root) {
	'use strict';

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
		ENGINE_ROW
	];
	/* one lookup for every shop button: kind → item table */
	const TECH_TABLES = {
		catapult: OrbitTech.CATAPULTS,
		panel: OrbitTech.PANELS,
		battery: OrbitTech.BATTERIES,
		hold: OrbitTech.HOLDS,
		tank: OrbitTech.TANKS,
		engine: OrbitTech.ENGINES
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
			{ key: 'leak', label: 'leak /y', min: 0.0001, max: 0.0012, step: 0.0001, digits: 4 }
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
	let scienceFamily = OrbitTech.KIND_ENGINE;
	/* the slider draft of every family: a copy of the defaults, editable in place */
	const scienceValues = {};
	for (const family in SCIENCE_DEFAULTS) {
		scienceValues[family] = {};
		for (const key in SCIENCE_DEFAULTS[family]) scienceValues[family][key] = SCIENCE_DEFAULTS[family][key];
	}
	/* one press of wait runs the world clock: 30 world minutes of sunlight,
	 * eased over 2 s so the trade sky visibly fast-forwards; each frame may
	 * credit at most WAIT_FRAME_MS (a 50 fps budget), so a slow machine
	 * stretches the wait past 2 s instead of freezing the view */
	const CAREER_WAIT_MIN = 30;
	const CAREER_WAIT_MS = 2000;
	const WAIT_FRAME_MS = 20;
	const VIEW_SPACE = 'space';
	const VIEW_FIELD = 'field';
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
	const RIVAL_COLOURS = ['#b99aff', '#ff85a8'];
	const RIVAL_TRAILS = ['rgba(185, 154, 255, 0.48)', 'rgba(255, 133, 168, 0.44)'];
	const RIVAL_TAGS = ['R1', 'R2'];
	const SLOT_NAMES = ['YOU', 'R1', 'R2'];
	const REPLAY_AIM_MS = 700;
	const REPLAY_GAP_MS = 450;
	/* replay multipliers; index 2 is real time */
	const REPLAY_SPEEDS = [0.25, 0.5, 1, 4, 16];
	const REPLAY_DEFAULT = 2;
	/* live playback: how fast the flight is watched; the physics steps never change.
	 * Career defaults 4x faster (×4) with 4x higher ceiling (×32 vs ×8). */
	const PLAY_SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
	const PLAY_DEFAULT = 2;
	const PLAY_MAX_INDEX = 5;
	const PLAY_CAREER_DEFAULT = 4;
	const PLAY_CAREER_MAX_INDEX = 7;
	const PLAY_MAX = 32;
	const GAME_SLICE = 1 / 60;
	const PLAY_GUARD = 128;
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
		'negative gravity repels. The seed is in the URL.';
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
			detail: 'Start at your own HQ (g = 1). Your EMC claims its planet; each planet also offers a commercial EMC-1 for ' +
				GravityGame.CAREER.commercialFee.toFixed(2) + ' per launch. An owned or rival pad spends battery charge; guests also pay the owner. ' +
				'A queued shot reserves its energy and fires when the barrel aligns (one turn every 2…5 s). ' +
				'The career runs on the world clock; pause on landing holds it still. Evacuation to HQ costs ' +
				GravityGame.CAREER.evacFee.toFixed(2) + '.',
			controls: 'Wait charges pads. With an impulse engine and fuel, use Space / P or drag the ship in flight to aim a burn.'
		}
	};

	const scene = root.OrbitScene;
	const tradeSim = scene.sim;
	const view = scene.view;
	const gravity = new GravitySim(OrbitSim.WORLD_W, OrbitSim.WORLD_H);
	const bot = new GravityBot(OrbitSim.WORLD_W, OrbitSim.WORLD_H);
	const predHarvestMask = new Uint8Array(PLANETS);
	/* systems the flying ship is inside right now: lit on entry, dark on exit */
	const liveHarvestMask = new Uint8Array(PLANETS);

	/* per-mode strength kept across switches; port strength keyed by parent planet */
	const planetBaseStrength = new Float64Array(PLANETS).fill(1);
	const planetStrength = new Float64Array(PLANETS).fill(1);
	const portPlanetStrength = new Float64Array(PLANETS).fill(1);
	const portStrength = new Float64Array(OrbitSim.PORTS).fill(1);
	const portRadius = new Float64Array(OrbitSim.PORTS).fill(PORT_R);
	/* the field's port → planet roster; a game flight keeps the one taken at launch */
	const fieldPortPlanet = new Int16Array(OrbitSim.PORTS).fill(-1);

	function fillPlanets(t, outX, outY, count) {
		for (let i = 0; i < count; i++) {
			outX[i] = tradeSim.planetX[i];
			outY[i] = tradeSim.planetY[i];
		}
	}

	/* closed-form port positions, keeping strength bound to each port's planet */
	function fillPorts(t, outX, outY, count) {
		for (let p = 0; p < count; p++) {
			const planet = fieldPortPlanet[p];
			portStrength[p] = planetMask[planet] ? portPlanetStrength[planet] : 0;
			const angle = tradeSim.orbitPhase[planet] + tradeSim.orbitOmega[planet] * t;
			const rx = tradeSim.orbitRX[planet] * Math.cos(angle);
			const ry = tradeSim.orbitRY[planet] * Math.sin(angle);
			outX[p] = tradeSim.planetX[planet] +
				rx * tradeSim.orbitTiltCos[planet] - ry * tradeSim.orbitTiltSin[planet];
			outY[p] = tradeSim.planetY[planet] +
				rx * tradeSim.orbitTiltSin[planet] + ry * tradeSim.orbitTiltCos[planet];
		}
	}

	function syncPlanetGravity() {
		if (!scene.planetG) return;
		for (let p = 0; p < PLANETS; p++) {
			if (!planetMask[p]) {
				scene.planetG[p] = 0;
				continue;
			}
			const port = tradeSim.planetPort[p];
			scene.planetG[p] = mode === MODE_PORTS && port !== NO_PORT
				? portPlanetStrength[p]
				: planetStrength[p];
		}
	}

	function syncPortRoster() {
		let changed = gravity.setCount(tradeSim.portCount);
		for (let p = 0; p < tradeSim.portCount; p++) {
			const planet = tradeSim.portPlanet[p];
			if (fieldPortPlanet[p] !== planet) {
				fieldPortPlanet[p] = planet;
				portStrength[p] = planetMask[planet] ? portPlanetStrength[planet] : 0;
				changed = true;
			}
		}
		if (selected >= gravity.bodyCount) setSelected(-1);
		if (changed) syncPlanetGravity();
		return changed;
	}

	const canvas = $('g');
	const ctx = canvas.getContext('2d');
	const fieldCanvas = $('f');
	const fieldRenderer = root.GravityField && fieldCanvas
		? root.GravityField.create(fieldCanvas, () => syncViewState()) : null;
	const glow = makeGlow('rgba(92, 255, 139, 0.95)');
	const impactGlow = makeGlow('rgba(255, 126, 160, 0.5)');

	const expClockEl = $('expClock');
	const statusEl = $('cargoStatus');
	const visitEl = $('visitReadout');
	const visitLabelEl = $('visitLabel');
	const planetCountInputEl = $('planetCountInput');
	const planetPadsLabelEl = $('planetPadsLabel');
	const planetRowSepEl = $('planetRowSep');
	const padCountEl = $('padCount');
	const padTotalEl = $('padTotal');
	const playerCountValueEl = $('playerCountValue');
	const playerCountDownEl = $('playerCountDown');
	const playerCountUpEl = $('playerCountUp');
	const predVisitEl = $('predVisitReadout');
	const predVisitLabelEl = $('predVisitLabel');
	const predProfitRowEl = $('predProfitRow');
	const predProfitEl = $('predProfitReadout');
	const flightEl = $('cargoFlight');
	const aimEl = $('aimReadout');
	const pathEl = $('pathReadout');
	const lengthEl = $('lengthReadout');
	const calcEl = $('calcReadout');
	const bodyTagEl = $('bodyTag');
	const viewTagEl = $('viewTag');
	const viewSpaceEl = $('viewSpace');
	const viewFieldEl = $('viewField');
	const careerCleanEl = $('careerClean');
	const careerCleanLabelEl = $('careerCleanLabel');
	const sourceTagEl = $('sourceTag');
	const srcPlanetsEl = $('srcPlanets');
	const srcPortsEl = $('srcPorts');
	const gravitySlider = $('gravity');
	const gravityLabel = $('gravityLabel');
	const trimSlider = $('trim');
	const trimLabel = $('trimLabel');
	const horizonSlider = $('horizon');
	const horizonLabel = $('horizonLabel');
	const horizonTagEl = $('horizonTag');
	const trimTargetEl = $('trimTarget');
	const expGravityEl = $('expGravity');
	const expGravityLabelEl = $('expGravityLabel');
	const expForceEl = $('expForce');
	const expForceLabelEl = $('expForceLabel');
	const expHarvestEl = $('expHarvest');
	const expTagEl = $('expTag');
	const launchButton = $('launch');
	const planetActionsEl = $('planetActions');
	const launchBuildBtn = $('launchBuild');
	const launchCommercialBtn = $('launchCommercial');
	const launchEvacBtn = $('launchEvac');
	const clearButton = $('clear');
	const routeBestBtn = $('routeBest');
	const leftHudEl = $('leftHud');
	const cargoHudEl = $('cargoHud');
	const careerHudEl = $('careerHud');
	const cargoFootEl = $('cargoFoot');
	const flightRowEl = $('flightRow');
	const bodyGroupEl = $('bodyGroup');
	const horizonGroupEl = $('horizonGroup');
	const playbackGroupEl = $('playbackGroup');
	const helpBtn = $('helpBtn');
	const soundToggle = $('soundToggle');
	let soundEnabled = true;
	try { soundEnabled = root.localStorage.getItem('gravity-sound-enabled') !== 'false'; }
	catch (err) { /* localStorage can be unavailable on file://. */ }
	const sound = root.GravitySound.create({ enabled: soundEnabled });
	let soundFlightSim = null;
	const foldBtn = $('foldBtn');
	const scoreFoldBtn = $('scoreFoldBtn');
	const careerFoldBtn = $('careerFoldBtn');
	const tradeFoldBtn = $('tradeFoldBtn');
	const helpDrawer = $('helpDrawer');
	const helpClose = $('helpClose');
	const helpModeTitleEl = $('helpModeTitle');
	const helpRuleNameEl = $('helpRuleName');
	const helpGoalEl = $('helpGoal');
	const helpScoreEl = $('helpScore');
	const helpDetailRowEl = $('helpDetailRow');
	const helpDetailLabelEl = $('helpDetailLabel');
	const helpDetailEl = $('helpDetail');
	const helpControlsEl = $('helpControls');
	const helpModeControlsEl = $('helpModeControls');
	const tradeCanvas = $('c');
	const modeTagEl = $('modeTag');
	const modeEls = [
		[RULE_CAREER, $('modeCareer')],
		[PLAY_LAB, $('modeLab')],
		[RULE_TOUR, $('modeTour')],
		[RULE_ROUTE, $('modeRoute')],
		[RULE_MONEY, $('modeMoney')]
	];
	const runBoxEl = $('runBox');
	const rivalGroupEl = $('rivalGroup');
	const careerBoxEl = $('careerBox');
	const careerTagEl = $('careerTag');
	const careerPlanetEl = $('careerPlanet');
	const careerPadEl = $('careerPad');
	const careerShopEl = $('careerShop');
	const careerScienceEl = $('careerScience');
	const careerUpgradesEl = $('careerUpgrades');
	const careerShotsEl = $('careerShots');
	const careerSciencePanelEl = $('careerSciencePanel');
	const careerUpgradesTabEl = $('careerUpgradesTab');
	const careerShotsTabEl = $('careerShotsTab');
	const careerScienceTabEl = $('careerScienceTab');
	const careerTaskEl = $('careerTasks');
	const careerLaunchListEl = $('careerLaunchList');
	const careerWaitInfoEl = $('careerWaitInfo');
	const careerWaitBtn = $('careerWait');
	const careerClockBtn = $('careerClock');
	const careerPauseLandEl = $('careerPauseLand');
	const careerPauseLandLabelEl = $('careerPauseLandLabel');
	const careerEvacBtn = $('careerEvac');
	const careerMsgEl = $('careerMsg');
	const ruleTagEl = $('ruleTag');
	const scoreHudEl = $('scoreHud');
	const scoreRuleTagEl = $('scoreRuleTag');
	const goalRoleEl = $('goalRole');
	const playerScoreMetaEl = $('playerScoreMeta');
	const scoreRowEls = [$('scorePlayer'), $('scoreRival1'), $('scoreRival2')];
	const scoreBotEls = [$('playerBot'), $('rivalBot1'), $('rivalBot2')];
	const scoreBotLabelEls = [$('scoreBotLabel0'), $('scoreBotLabel1'), $('scoreBotLabel2')];
	const rivalScoreRows = [$('scoreRival1'), $('scoreRival2')];
	const rivalScoreEls = [$('rivalScore1'), $('rivalScore2')];
	const rivalMetaEls = [$('rivalMeta1'), $('rivalMeta2')];
	const rivalTagEl = $('rivalTag');
	const playerBotEl = scoreBotEls[0];
	const botOffEl = $('botOff');
	const botEasyEl = $('botEasy');
	const botNormalEl = $('botNormal');
	const botHardEl = $('botHard');
	const gameScoreEl = $('gameScore');
	const gamePurseEl = $('gamePurse');
	const purseRowEl = $('purseRow');
	const rivalRowEl = $('rivalRow');
	const rivalEl = $('rivalReadout');
	const replayRowEl = $('replayRow');
	const replayEl = $('replayReadout');
	const gameRestartBtn = $('gameRestart');
	const gameNewSeedBtn = $('gameNewSeed');
	const gameCopyBtn = $('gameCopy');
	const botCopyBtn = $('botCopy');
	const botLogBtn = $('botLog');
	const botLogBoxEl = $('botLogBox');
	const botLogTextEl = $('botLogText');
	const botLogCloseBtn = $('botLogClose');
	const replaySpeedBtn = $('replaySpeed');
	const replaySkipBtn = $('replaySkip');
	const gameLinkEl = $('gameLink');
	const playTagEl = $('playTag');
	const playSlowerBtn = $('playSlower');
	const playResetBtn = $('playReset');
	const playFasterBtn = $('playFaster');
	const helperGroupEl = $('helperGroup');
	const helperTagEl = $('helperTag');
	const helperScanBtn = $('helperScan');
	const helperFocusBtn = $('helperFocus');
	const helperTweakBtn = $('helperTweak');
	const helperProfitBtn = $('helperProfit');
	const helperEmcBtn = $('helperEmc');
	const helperProgressEl = $('helperProgress');
	const helperProgressFillEl = $('helperProgressFill');
	const helperProgressTextEl = $('helperProgressText');
	const helperStopBtn = $('helperStop');

	let lastWX = 0;
	let lastWY = 0;
	let hoverBody = -1;
	let hoverPlanet = -1;
	let selected = -1;
	let aimBody = -1;
	let aiming = false;
	let armed = false;
	let aimAngle = 0;
	let aimSpeed = SPEED_MIN;
	let gripX = 0;
	let gripY = 0;
	let gripLen = 0;
	/* the drag range the grip was placed on: a slider move invalidates it */
	let aimCeiling = SPEED_MAX;
	let mode = MODE_PLANETS;
	let viewMode = VIEW_SPACE;
	let viewDesired = VIEW_SPACE;
	/* career clean canvas: hides thick orbit visit highlights + past flight trails */
	let cleanCareerView = true;
	let pressing = false;
	let pressPlanet = -1;
	let pressClientX = 0;
	let pressClientY = 0;
	let pendGripX = 0;
	let pendGripY = 0;
	let savedArmed = false;
	let savedBody = -1;
	let savedAngle = 0;
	let savedSpeed = SPEED_MIN;
	let burnPaused = false;
	let burnAiming = false;
	let burnArmed = false;
	let burnPressing = false;
	let burnAngle = 0;
	let burnDv = 0;
	let burnCeiling = 0;
	let savedBurnArmed = false;
	let savedBurnAngle = 0;
	let savedBurnDv = 0;
	let blockedPlanet = -1;
	let blockedUntil = -Infinity;
	let blockedKind = 0;
	let blockedBy = -1;
	let helpRule = 'lab';
	let helpOpen = false;
	let loadingUrl = false;
	let helpPinned = false;
	let ruleHelpHold = false;
	let hudFolded = false;
	let fine = false;
	let dirty = false;
	let trimLast = 0;
	/* experimental settings: system-wide gravity, catapult rail force and the
	 * career-only stay-pay (every step inside a system collects what regrew) */
	let gravityScale = 1;
	let forceScale = 1;
	let harvestTick = false;
	let experimentTouched = false;
	let hudAt = -Infinity;
	let lastFrame = performance.now();
	const expStart = performance.now();
	let emaFrameMs = 16;
	let otherWorkMs = 1;
	let autoSkip = 0;
	let lastAutoInterval = 1;
	let selectedLabel = '';
	let hoverLabel = '';
	let aimLabel = '';
	let aimGuidance = 0;
	let hudAimText = '';
	let hudTagText = '';
	let hudVisitText = '';
	let hudPadsText = '';
	let hudPredVisitText = '';
	let hudPredProfitText = '';
	let hudLengthText = '';
	let hudPathText = '';
	let hudScoreText = '';
	let hudPlayerMetaText = '';
	const hudRivalScoreTexts = ['', ''];
	const hudRivalMetaTexts = ['', ''];
	const hudRivalStateTexts = ['', ''];
	let hudPurseText = '';
	let hudRuleText = '';
	let hudRivalTagText = '';
	let hudRouteBestText = '';
	let hudRivalText = '';
	let hudReplayText = '';
	let predGain = 0;
	const aimEconomics = { state: 0, launchable: true, fee: 0, exit: 0, net: 0, source: '' };
	let launchState = -1;
	let launchNote = '';
	let linkNote = '';
	let playIndex = PLAY_DEFAULT;
	/* partial game slice carried between frames, so 0.25x and 32x both stay smooth */
	let playAcc = 0;
	/* photo deck: one space view per planet and one surface view per landing, per run */
	const photoSpace = new Uint8Array(PLANETS);
	const photoLanded = new Uint8Array(PLANETS);
	const PHOTO_CAREER = ['catapult', 'delivery', 'sport'];
	const photoCareer = new Uint8Array(PHOTO_CAREER.length);

	/* user helper tools: background candidate search reusing GravitySim slicing */
	const helperProbe = new GravitySim(OrbitSim.WORLD_W, OrbitSim.WORLD_H);
	const helperState = {
		active: false, mode: '', goal: 'score', candidates: null, index: 0,
		best: null, bestScore: -Infinity, horizon: 60, startedAt: 0,
		fromBook: false
	};
	let helperHudTag = 'ready';

	function makeRoutePlanSlot() {
		return { ready: false, length: 0, steps: 0, visits: 0,
			reason: GravitySim.END_OPEN, body: -1, origin: -1 };
	}

	function makeBestSlot() {
		return { ready: false, length: 0, origin: -1, angleU: 0, speedU: 0 };
	}

	function makeAimSlot() {
		return { armed: false, body: -1, angle: 0, speed: SPEED_MIN };
	}

	/*
	 * game: steps = finished player flight steps, clockSteps = shared market clock step,
	 * doneSteps = step the 26th system was entered, fixedRate = link rate is locked,
	 * market = per-planet visit clock shared with rivals, money = player purse ledger
	 */
	const game = { on: false, seed: 0, fixedRate: false, rule: RULE_TOUR, bot: BOT_NORMAL,
		player: PLAYER_USER, cheat: null, playerCount: 0, planetUniverse: 0,
		shots: [], steps: 0, clockSteps: 0, doneSteps: -1, length: 0,
		market: GravityGame.createMarket(), money: GravityGame.createLedger(),
		galaxy: GravityGame.createGalaxy() };
	game.career = GravityGame.createCareer(game.money);
	/* the run's planet universe: a subset of the 26 generated planets. Career
	 * starts on 13, every other rule on all 26; the number input and the
	 * scoreboard +/- change it live — increase adds a random planet, decrease
	 * removes a random one (no refund) while every player's first HQ stays. */
	const PLANET_UNIVERSE_MIN = 4;
	const PLANET_UNIVERSE_MAX = PLANETS;
	const PLANET_CAREER_DEFAULT = 13;
	const PLANET_DEFAULT = PLANETS;
	const planetMask = new Uint8Array(PLANET_UNIVERSE_MAX);
	let planetCount = PLANET_DEFAULT;
	/* last used game mode, restored on load */
	const MODE_STORAGE = 'gravity.lastMode';
	function loadLastMode() {
		try {
			const value = root.localStorage && root.localStorage.getItem(MODE_STORAGE);
			if (value && (RULES[value] || value === PLAY_LAB)) return value;
		} catch (e) { /* private mode */ }
		return null;
	}
	function saveLastMode(rule) {
		try {
			if (root.localStorage) root.localStorage.setItem(MODE_STORAGE, rule);
		} catch (e) { /* private mode */ }
	}
	/* career world clock: runs while unpaused; by default it pauses when your
	 * flight ends so you can aim in peace (launching resumes it) */
	let careerPaused = false;
	/* wall-clock instant the career clock was paused; draw ticks freeze on it
	 * so nothing animates while the world clock holds still */
	let careerPauseNow = 0;
	let pauseOnLanding = true;
	/* a career launch is queued until the planet's EMC barrel reaches the aim */
	const turret = { pending: false, body: -1, angle: 0, speed: 0, fireAt: 0,
		pad: null, energy: 0 };
	const slotTypes = [PLAYER_USER, PLAYER_BOT, PLAYER_BOT];
	const rivalTypesArg = [PLAYER_BOT, PLAYER_BOT];
	let activeSlot = 0;
	/* the player's one route entry; `ready` means its trace reached an end */
	const routePlan = makeRoutePlanSlot();
	const slotPlans = [routePlan, makeRoutePlanSlot(), makeRoutePlanSlot()];
	/* per-slot best manual plan, scoped to one start planet and one game run */
	const slotBest = [makeBestSlot(), makeBestSlot(), makeBestSlot()];
	const slotAim = [makeAimSlot(), makeAimSlot(), makeAimSlot()];
	let routeLeader = -2;
	let routeBotVersion = -1;
	let playerBotSyncNeeded = true;
	/* replay of a link: shots fired in order, aim shown then flown; verdict after the last */
	const replay = { on: false, shots: null, end: null, index: 0, phase: PHASE_GAP, until: 0,
		speed: REPLAY_DEFAULT, verdict: '', route: false, length: null,
		activeShot: null, burnIndex: 0 };

	function makeGlow(fill) {
		const sprite = document.createElement('canvas');
		sprite.width = 64;
		sprite.height = 64;
		const paint = sprite.getContext('2d');
		const gradient = paint.createRadialGradient(32, 32, 0, 32, 32, 32);
		gradient.addColorStop(0, fill);
		gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
		paint.fillStyle = gradient;
		paint.fillRect(0, 0, 64, 64);
		return sprite;
	}

	function plate(x, y, width, height, stroke) {
		const r = 6;
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + width, y, x + width, y + height, r);
		ctx.arcTo(x + width, y + height, x, y + height, r);
		ctx.arcTo(x, y + height, x, y, r);
		ctx.arcTo(x, y, x + width, y, r);
		ctx.closePath();
		ctx.fillStyle = PLATE;
		ctx.fill();
		if (stroke) {
			ctx.strokeStyle = stroke;
			ctx.lineWidth = 1;
			ctx.stroke();
		}
	}

	/* the flat mode row drives both the help drawer and the running rule */
	function selectedHelpRule() {
		return game.on ? game.rule : PLAY_LAB;
	}

	function updateHelp(rule) {
		helpRule = RULE_HELP[rule] ? rule : selectedHelpRule();
		const help = RULE_HELP[helpRule];
		if (helpModeTitleEl) helpModeTitleEl.textContent = help.name;
		if (helpRuleNameEl) helpRuleNameEl.textContent = help.name;
		if (helpGoalEl) helpGoalEl.textContent = help.goal;
		if (helpScoreEl) helpScoreEl.textContent = help.score;
		if (helpDetailRowEl) helpDetailRowEl.hidden = help.detail === '';
		if (helpDetailLabelEl) helpDetailLabelEl.textContent = help.detailLabel;
		if (helpDetailEl) helpDetailEl.textContent = help.detail;
		if (helpControlsEl) helpControlsEl.textContent = COMMON_HELP;
		if (helpModeControlsEl) {
			const controls = helpRule === RULE_ROUTE && game.on && game.player === PLAYER_BOT
				? 'A bot plans your trajectory; the leader updates live.' : help.controls;
			helpModeControlsEl.textContent = controls;
			helpModeControlsEl.hidden = controls === '';
		}
	}

	function setHelpOpen(open, preview = false) {
		if (!preview) helpPinned = open;
		if (open && !preview) updateHelp(selectedHelpRule());
		helpOpen = open;
		if (helpDrawer) helpDrawer.classList.toggle('open', open);
		if (helpBtn) helpBtn.classList.toggle('on', open);
	}

	/* pressing, hovering or focusing a rule radio shows that rule at once */
	function showRuleHelp(rule, pin) {
		updateHelp(rule);
		setHelpOpen(true, !pin);
	}

	function updateRuleHelp(rule) {
		updateHelp(rule || selectedHelpRule());
	}

	function beginRuleHelpHold(rule) {
		ruleHelpHold = true;
		updateRuleHelp(RULE_HELP[rule] ? rule : selectedHelpRule());
		setHelpOpen(true, true);
	}

	function endRuleHelpHold() {
		ruleHelpHold = false;
		updateRuleHelp(selectedHelpRule());
		if (!helpPinned) setHelpOpen(false, true);
	}

	function refreshViewUi() {
		if (viewSpaceEl) viewSpaceEl.checked = viewMode === VIEW_SPACE;
		if (viewFieldEl) viewFieldEl.checked = viewMode === VIEW_FIELD;
		if (careerCleanLabelEl) careerCleanLabelEl.hidden = !careerRule();
		if (careerCleanEl) careerCleanEl.checked = cleanCareerView;
		if (!viewTagEl) return;
		if (viewMode !== VIEW_FIELD || !fieldRenderer) {
			const lost = fieldRenderer !== null && fieldRenderer.backend() === 'lost';
			viewTagEl.textContent = lost ? 'space · field lost' : 'space';
			viewTagEl.title = lost
				? 'gravity field paused: the WebGL context was lost · f retries once it restores'
				: 'starfield backdrop and gravity well rings';
			return;
		}
		const gl = fieldRenderer.backend() === 'webgl';
		const div = fieldRenderer.scaleDiv();
		viewTagEl.textContent = gl
			? 'hue · grad · WebGL' + (div > 1 ? ' 1/' + div : '')
			: 'hue · grad · 1/' + div;
		viewTagEl.title = 'hue = pull direction · lightness = potential gradient · ' +
			(gl ? 'WebGL shader' : '1/' + div + ' 2D raster');
	}

	/* a lost WebGL context falls back to the starfield until `webglcontextrestored`
	 * rebuilds the shader and automatically restores the requested view */
	function activeFieldView() {
		return viewDesired === VIEW_FIELD &&
			(!fieldRenderer || fieldRenderer.backend() !== 'lost');
	}

	function syncViewState() {
		viewMode = activeFieldView() ? VIEW_FIELD : VIEW_SPACE;
		if (fieldCanvas) fieldCanvas.hidden = viewMode !== VIEW_FIELD;
		if (scene.setBackdrop) scene.setBackdrop(viewMode !== VIEW_FIELD);
		if (viewMode === VIEW_FIELD && fieldRenderer) fieldRenderer.invalidate();
		refreshViewUi();
		hudAt = -Infinity;
	}

	function fieldLost() {
		syncViewState();
	}

	function setViewMode(next) {
		viewDesired = next === VIEW_FIELD ? VIEW_FIELD : VIEW_SPACE;
		syncViewState();
	}

	function resizeOverlay() {
		const width = window.innerWidth;
		const height = window.innerHeight;
		const dpr = view.dpr;
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
		canvas.style.width = width + 'px';
		canvas.style.height = height + 'px';
		if (fieldCanvas) {
			fieldCanvas.style.width = width + 'px';
			fieldCanvas.style.height = height + 'px';
		}
		if (fieldRenderer) fieldRenderer.invalidate();
		reserveTradeFooter();
		measureHudRects();
	}

	/* panel rects for the world plates (3 panels × 4 numbers): refreshed on resize and
	 * whenever the HUD content changes, never per frame */
	const hudRects = new Float64Array(12);
	const hudRectEls = [$('cargoHud'), $('leftHud'), $('cargoFoot')];

	function measureHudRects() {
		for (let i = 0; i < hudRectEls.length; i++) {
			const el = hudRectEls[i];
			const r = el && !el.hidden ? el.getBoundingClientRect() : null;
			const o = i * 4;
			hudRects[o] = r ? r.left : 0;
			hudRects[o + 1] = r ? r.top : 0;
			hudRects[o + 2] = r ? r.right : 0;
			hudRects[o + 3] = r ? r.bottom : 0;
		}
	}

	/* does a screen rect cross one of the panels? */
	function rectUnderHud(x, y, width, height) {
		for (let i = 0; i < hudRectEls.length; i++) {
			const o = i * 4;
			const right = hudRects[o + 2];
			const bottom = hudRects[o + 3];
			if (right <= hudRects[o] || bottom <= hudRects[o + 1]) continue;
			if (x >= right || x + width <= hudRects[o]) continue;
			if (y >= bottom || y + height <= hudRects[o + 1]) continue;
			return true;
		}
		return false;
	}

	/* the wrapped trade footer grows; both HUD columns stop above it, and the
	 * right cargo HUD also stops above the separate bottom launch/helpers panel */
	function reserveTradeFooter() {
		if (!cargoHudEl) return;
		const vv = root.visualViewport;
		const vh = vv && vv.height > 0 ? vv.height : window.innerHeight;
		if (!(vh > 0)) return;
		const hudRect = cargoHudEl.getBoundingClientRect();
		const hudTop = hudRect.top > 0 && hudRect.top < vh * 0.5 ? hudRect.top : 14;
		const tradeEl = $('tradeControls');
		const rect = tradeEl ? tradeEl.getBoundingClientRect() : null;
		let bottomY = vh - 10;
		if (rect && rect.height > 0 && rect.height < vh * 0.5) {
			bottomY = Math.min(bottomY, rect.top - 10);
		}
		const leftMaxH = Math.max(180, Math.floor(bottomY - hudTop)) + 'px';
		const reserve = Math.ceil(vh - bottomY) + 'px';
		cargoHudEl.style.setProperty('--footReserve', reserve);
		if (cargoFootEl && cargoFootEl.style) {
			cargoFootEl.style.setProperty('--footReserve', reserve);
		}
		if (leftHudEl && leftHudEl.style) {
			leftHudEl.style.setProperty('--footReserve', reserve);
			leftHudEl.style.setProperty('--hudMaxH', leftMaxH);
		}
		/* the postcard and #cargoFoot sit just above the bar, taller in career (wait line) */
		const rootEl = root.document && root.document.documentElement;
		if (rootEl && rootEl.style) rootEl.style.setProperty('--footReserve', reserve);
		let cargoBottomY = bottomY;
		const footRect = cargoFootEl ? cargoFootEl.getBoundingClientRect() : null;
		if (footRect && footRect.height > 0 && footRect.height < vh * 0.6) {
			cargoBottomY = Math.min(cargoBottomY, footRect.top - 8);
		}
		const cargoMaxH = Math.max(140, Math.floor(cargoBottomY - hudTop)) + 'px';
		cargoHudEl.style.setProperty('--hudMaxH', cargoMaxH);
	}

	function worldX(clientX) {
		return (clientX - view.offX) / view.scale;
	}

	function worldY(clientY) {
		return (clientY - view.offY) / view.scale;
	}

	function planetAt(wx, wy) {
		const reach = HIT_PX / view.scale;
		const reach2 = reach * reach;
		let best = -1;
		let bestD2 = Infinity;
		for (let i = 0; i < PLANETS; i++) {
			if (!planetMask[i]) continue;
			const dx = tradeSim.planetX[i] - wx;
			const dy = tradeSim.planetY[i] - wy;
			const d2 = dx * dx + dy * dy;
			if (d2 <= reach2 && d2 < bestD2) {
				bestD2 = d2;
				best = i;
			}
		}
		return best;
	}

	function bodyAt(wx, wy) {
		const reach = HIT_PX / view.scale;
		const reach2 = reach * reach;
		let best = -1;
		let bestD2 = Infinity;
		for (let i = 0; i < gravity.bodyCount; i++) {
			const dx = gravity.bodyX[i] - wx;
			const dy = gravity.bodyY[i] - wy;
			const d2 = dx * dx + dy * dy;
			if (d2 <= reach2 && d2 < bestD2) {
				bestD2 = d2;
				best = i;
			}
		}
		return best;
	}

	function shipAt(wx, wy) {
		if (gravity.status !== STATUS_FLYING) return false;
		const reach = HIT_PX / view.scale;
		const dx = gravity.cargo.x - wx;
		const dy = gravity.cargo.y - wy;
		return dx * dx + dy * dy <= reach * reach;
	}

	function planetName(index) {
		return 'P' + index;
	}

	function bodyName(index) {
		return mode === MODE_PORTS ? 'port ' + index : 'P' + index;
	}

	function tradeRate() {
		return scene.trade.paused ? 0 : scene.trade.speed;
	}

	function playDefaultIndex() {
		return careerRule() ? PLAY_CAREER_DEFAULT : PLAY_DEFAULT;
	}

	function playMaxIndex() {
		return careerRule() ? PLAY_CAREER_MAX_INDEX : PLAY_MAX_INDEX;
	}

	function playScale() {
		return PLAY_SPEEDS[playIndex];
	}

	function refreshPlaybackUi() {
		if (!playTagEl) return;
		playTagEl.textContent = '×' + playScale();
		if (playSlowerBtn) playSlowerBtn.disabled = playIndex === 0;
		if (playFasterBtn) playFasterBtn.disabled = playIndex >= playMaxIndex();
		if (playResetBtn) {
			const def = PLAY_SPEEDS[playDefaultIndex()];
			playResetBtn.textContent = def + '×';
			playResetBtn.title = careerRule()
				? 'default career pace (×' + def + ')'
				: 'real time (×' + def + ')';
		}
	}

	function stepPlayback(step) {
		const next = playIndex + step;
		if (next < 0 || next > playMaxIndex()) return;
		playIndex = next;
		refreshPlaybackUi();
	}

	function resetPlayback() {
		playIndex = playDefaultIndex();
		refreshPlaybackUi();
	}

	function careerPhoto(kind) {
		if (!root.PhotoDeck || !root.PhotoDeck.showCareer) return;
		const index = PHOTO_CAREER.indexOf(kind);
		if (index < 0 || photoCareer[index] === 1) return;
		photoCareer[index] = 1;
		root.PhotoDeck.showCareer(kind);
	}

	/* one postcard per new system, then the surface card when the cargo lands */
	function photoTick() {
		if (!root.PhotoDeck || !tradeSim.planetType) return;
		for (let i = 0; i < PLANETS; i++) {
			if (!planetMask[i]) continue;
			if (gravity.visited[i] !== 1 || photoSpace[i] === 1) continue;
			photoSpace[i] = 1;
			root.PhotoDeck.show('space', tradeSim.planetType[i], i);
		}
		if (gravity.status !== STATUS_ENDED || gravity.endReason !== END_IMPACT ||
			gravity.endBody < 0 || photoLanded[gravity.endBody] === 1) return;
		photoLanded[gravity.endBody] = 1;
		root.PhotoDeck.show('landed', tradeSim.planetType[gravity.endBody], gravity.endBody);
	}

	function syncUserRivalFields() {
		if (!game.on) return;
		for (let i = 0; i < bot.count; i++) {
			if (bot.isRivalBot(i)) continue;
			const rSim = bot.rivals[i].sim;
			rSim.setField(gravity.bodyCount, gravity.bodyR, gravity.strength,
				gravity.fillField, gravity.fieldStatic);
			rSim.fieldT = gravity.fieldT;
			rSim.fieldRate = gravity.fieldRate;
			if (!rSim.fieldStatic) rSim.refreshField();
		}
	}

	function applyMode() {
		if (mode === MODE_PORTS) {
			fieldPortPlanet.fill(-1);
			for (let p = 0; p < tradeSim.portCount; p++) {
				const planet = tradeSim.portPlanet[p];
				fieldPortPlanet[p] = planet;
				portStrength[p] = planetMask[planet] ? portPlanetStrength[planet] : 0;
			}
			gravity.setField(tradeSim.portCount, portRadius, portStrength, fillPorts, false);
			sourceTagEl.textContent = 'ports · moving';
			sourceTagEl.title = tradeSim.portCount + ' ports · launch from planets';
		} else {
			gravity.setField(PLANETS, tradeSim.planetR, planetStrength, fillPlanets, true);
			sourceTagEl.textContent = 'planets';
			sourceTagEl.title = planetCount + ' planets';
		}
		syncUserRivalFields();
		syncPlanetGravity();
	}

	function setBodyStrength(body, value) {
		if (!gravity.setStrength(body, value)) return false;
		if (mode === MODE_PORTS && body >= 0 && body < gravity.bodyCount) {
			portPlanetStrength[fieldPortPlanet[body]] = gravity.strength[body];
		} else if (mode === MODE_PLANETS) {
			planetBaseStrength[body] = gravity.strength[body];
			bot.strength[body] = gravity.strength[body];
		}
		syncPlanetGravity();
		return true;
	}

	function strengthText(index) {
		const value = gravity.strength[index];
		return (value > 0 ? '+' : '') + value.toFixed(2);
	}

	function refreshSelected() {
		if (selected < 0 || selected >= gravity.bodyCount) {
			selected = -1;
			selectedLabel = '';
			bodyTagEl.textContent = 'none selected';
			gravitySlider.disabled = true;
			gravityLabel.textContent = '—';
			return;
		}
		selectedLabel = bodyName(selected) + ' · g ' + strengthText(selected) +
			(gravity.strength[selected] < 0 ? ' repel' : '');
		bodyTagEl.textContent = selectedLabel;
		gravitySlider.disabled = game.on;
		gravitySlider.value = gravity.strength[selected].toFixed(2);
		gravityLabel.textContent = gravity.strength[selected].toFixed(2);
	}

	function setSelected(index) {
		selected = index;
		refreshSelected();
		helperUpdateUi();
		hudAt = -Infinity;
	}

	function slotCount() {
		return game.on ? 1 + bot.count : 1;
	}

	function slotIsBot(slot) {
		return game.on && slotTypes[slot] === PLAYER_BOT;
	}

	function activeSlotIndex() {
		return game.on && !replay.on ? activeSlot : 0;
	}

	function slotSim(slot) {
		return slot === 0 ? gravity : bot.rivals[slot - 1].sim;
	}

	function activeSim() {
		return slotSim(activeSlotIndex());
	}

	function slotLedger(slot) {
		return slot === 0 ? game.money : bot.rivals[slot - 1].ledger;
	}

	function slotShots(slot) {
		return slot === 0 ? game.shots : bot.rivals[slot - 1].shots;
	}

	function activeRoutePlan() {
		return slotPlans[activeSlotIndex()];
	}

	function activeRouteBest() {
		return slotBest[activeSlotIndex()];
	}

	function slotName(slot) {
		return SLOT_NAMES[slot] || 'YOU';
	}

	function ensureValidActiveSlot(preferred) {
		if (!game.on) {
			activeSlot = 0;
			return;
		}
		const count = slotCount();
		if (activeSlot >= count) activeSlot = 0;
		if (slotTypes[activeSlot] === PLAYER_USER) return;
		if (preferred >= 0 && preferred < count && slotTypes[preferred] === PLAYER_USER) {
			activeSlot = preferred;
			return;
		}
		for (let s = 0; s < count; s++) {
			if (slotTypes[s] === PLAYER_USER) {
				activeSlot = s;
				return;
			}
		}
	}

	function refreshPredGain() {
		const sim = activeSim();
		if (!game.on || routeRule() || sim.predCount < 2) {
			predGain = 0;
			return;
		}
		let gain = GravityGame.estimateProfit(game.market, game.clockSteps, sim);
		if (careerRule() && sim.predReason === END_IMPACT && sim.predBody >= 0) {
			const career = game.career;
			const endStep = game.clockSteps + sim.predSteps;
			if (career.contract >= 0) {
				const task = career.tasks[career.contract];
				if (task.state === GravityGame.TASK_LOADED &&
					sim.predBody === task.to && endStep <= task.deadline) {
					gain += task.reward;
				}
			}
			const compete = career.tasks[GravityGame.COMPETE_SLOT];
			const origin = sim.status === STATUS_FLYING ? sim.origin : aimBody;
			const len = (sim.status === STATUS_FLYING ? sim.flightLength : 0) + sim.predLength;
			if (compete && compete.kind === GravityGame.TASK_COMPETE &&
				origin === compete.planet && len >= compete.minLength &&
				endStep <= compete.deadline) {
				gain += compete.reward;
			}
		}
		predGain = gain;
	}

	function predictedCareerEconomics(sim) {
		const out = aimEconomics;
		out.state = 0;
		out.launchable = true;
		out.fee = 0;
		out.exit = 0;
		out.net = predGain;
		out.source = '';
		if (!careerRule() || sim.predCount < 2 || sim.predReason !== END_IMPACT ||
			sim.predBody < 0) return out;
		const career = game.career;
		const origin = sim.status === STATUS_FLYING ? sim.origin
			: aimBody >= 0 ? aimBody : career.at;
		const fee = sim.status === STATUS_FLYING ? 0
			: GravityGame.launchFee(career, origin, aimSpeed);
		const cash = career.ledger.purse + predGain - fee;
		const mass = bot.careerArrivalMass(career, sim.predBody);
		const departure = bot.careerDeparture(career, sim.predBody, cash, mass, gravity);
		out.fee = fee;
		out.exit = departure.cost;
		out.source = departure.source;
		out.launchable = career.ledger.purse + 1e-9 >= fee && departure.ok;
		out.net = predGain - fee - (departure.ok ? departure.cost : 0);
		out.state = !out.launchable ? 2 : out.net > 1e-9 ? 1 : 0;
		return out;
	}

	function predProfitText(sim, economics) {
		if (careerRule()) {
			const money = economics || predictedCareerEconomics(sim);
			if (!money.launchable) return signedMoney(predGain) + ' · no exit';
			return signedMoney(money.net);
		}
		return signedMoney(predGain);
	}

	function predRateText(sim) {
		const rate = sim.predTime > 1e-6 ? predGain / sim.predTime : 0;
		return '+' + rate.toFixed(2) + '/s';
	}

	/* The traced estimate prices the entry rule only; with the stay-pay on, a
	 * shot pays at least that (0.4.30-plan-harvest-ticks.md). */
	function predTickNote() {
		return harvestTick && careerRule() ? ' · ≥ticks' : '';
	}

	/* While aiming in career at the pickup planet of an accepted delivery that
	 * is not yet loaded, note the cargo that will be picked up and whether a
	 * starter EMC-1 there can lift the newly loaded ship. Returns '' when there
	 * is nothing to report. `postMass` is the ship once the cargo is aboard. */
	function careerPickupNote(career, planet) {
		if (!career || career.contract < 0) return '';
		const task = career.tasks[career.contract];
		if (task.state !== GravityGame.TASK_ACCEPTED || task.from !== planet) return '';
		const postMass = career.ship.mass + task.tons;
		const pad = career.pads[planet];
		let cap;
		if (pad.catapult === null || pad.catapult.id !== OrbitTech.CATAPULTS[0].id) {
			/* a starter EMC-1 with a fresh BAT-1 at full charge */
			cap = padCapMass(OrbitTech.CATAPULTS[0], OrbitTech.BATTERIES[0], postMass);
		} else {
			cap = padCapMass(pad.catapult, pad.battery, postMass);
		}
		return ' · loads ' + task.tons + ' t → ' + planetName(task.to) +
			' · EMC-1: ' + Math.round(cap) + ' px/s';
	}

	function refreshAimLabel() {
		const sim = activeSim();
		aimGuidance = 0;
		if (burnAiming || burnArmed) {
			const deg = ((-burnAngle * 180 / Math.PI) % 360 + 360) % 360;
			const ship = game.career.ship;
			const usedKg = OrbitTech.impulseFuel(burnDv, ship.engine, ship.mass, ship.fuelKg);
			const economics = sim.predCount >= 2 && careerRule()
				? predictedCareerEconomics(sim) : null;
			if (economics) aimGuidance = economics.state;
			const visitNote = sim.predCount >= 2
				? ' · ' + predProfitText(sim, economics) + ' · ' + predRateText(sim) +
					' · ' + sim.predTime.toFixed(1) + ' s · +' + sim.predNewVisits +
					' (' + sim.predVisits + ' sys)' + predTickNote()
				: '';
			aimLabel = 'Δv ' + burnDv.toFixed(1) + ' px/s · ' + deg.toFixed(1) + '° · −' +
				usedKg.toFixed(1) + ' kg' + (fine ? ' · fine' : '') + visitNote;
			return;
		}
		if (!aiming && !armed) {
			aimLabel = '';
			return;
		}
		const deg = ((-aimAngle * 180 / Math.PI) % 360 + 360) % 360;
		const ceiling = aimBody >= 0 ? speedCeiling(aimBody) : SPEED_MAX;
		const economics = sim.predCount >= 2 && careerRule()
			? predictedCareerEconomics(sim) : null;
		if (economics) aimGuidance = economics.state;
		const visitNote = sim.predCount >= 2
			? routeRule()
				? ' · ' + Math.round(sim.predLength) + ' px · ' +
					sim.predTime.toFixed(1) + ' s' +
					(sim.routeActive ? ' · tracing' : '')
				: (game.on ? ' · ' + predProfitText(sim, economics) + ' · ' + predRateText(sim) : '') +
					' · ' + sim.predTime.toFixed(1) + ' s · +' +
					sim.predNewVisits + ' (' + sim.predVisits + ' sys)' + predTickNote()
			: '';
		aimLabel = Math.round(aimSpeed) + ' px/s · ' + deg.toFixed(1) + '°' +
			(fine ? ' · fine' : '') +
			(ceiling < SPEED_MAX - 1e-9 ? ' · max ' + Math.round(ceiling) : '') + visitNote +
			(careerRule() ? careerPickupNote(game.career, aimBody) : '');
	}

	/* the drag maps all of GRIP_MAX onto SPEED_MIN…this planet's real ceiling:
	 * a weak rail or a drained career battery shrinks the range instead of
	 * letting the player aim a shot the pad then refuses to fire */
	function speedCeiling(planet) {
		const limit = careerRule() && planet >= 0 ? gravity.speedLimit(planet) : SPEED_MAX;
		if (limit < SPEED_MIN) return SPEED_MIN;
		return limit > SPEED_MAX ? SPEED_MAX : limit;
	}

	/* experimental panel: one world, so the player sim, the auto helpers and
	 * every rival bot must predict and fly with the same two multipliers; the
	 * stay-pay is a career rule, so it is off for the other three */
	function applyExperiment() {
		gravity.setScales(gravityScale, forceScale);
		helperProbe.setScales(gravityScale, forceScale);
		bot.setScales(gravityScale, forceScale);
		if (game.career) game.career.forceScale = forceScale;
		GravityGame.setHarvestMode(harvestTick && careerRule()
			? GravityGame.HARVEST_TICK : GravityGame.HARVEST_ENTRY);
	}

	function refreshExperimentUi() {
		const gravityText = '×' + gravityScale.toFixed(2);
		const forceText = '×' + forceScale.toFixed(2);
		if (expGravityLabelEl) expGravityLabelEl.textContent = gravityText;
		if (expForceLabelEl) expForceLabelEl.textContent = forceText;
		if (expHarvestEl) expHarvestEl.checked = harvestTick;
		if (expTagEl) {
			expTagEl.textContent = 'g ' + gravityText + ' · force ' + forceText +
				(harvestTick ? ' · ticks' : '');
		}
	}

	/* one entry point for the sliders and for a link that carries the scales */
	function setExperimentScales(nextGravity, nextForce, nextHarvest) {
		gravityScale = Math.round(nextGravity * 100) / 100;
		forceScale = Math.round(nextForce * 100) / 100;
		harvestTick = nextHarvest === true;
		if (expGravityEl) expGravityEl.value = String(gravityScale);
		if (expForceEl) expForceEl.value = String(forceScale);
		applyExperiment();
		refreshExperimentUi();
	}

	/* The stay-pay changes what a flight earns, so it is world state like the
	 * scales: flipping it mid-career only changes the steps still to fly. The
	 * box is dark outside career, where it springs back if anything ticks it. */
	function onHarvestChange() {
		harvestTick = Boolean(expHarvestEl && expHarvestEl.checked) && careerRule();
		applyExperiment();
		refreshExperimentUi();
		dirty = true;
		hudAt = -Infinity;
	}

	/* a pad can lose its ceiling while a shot is armed (drained battery, lowered
	 * force slider): keep the aim inside what can fire, and put the grip dot back
	 * on the new drag range so the dot still shows the armed speed */
	function clampArmedToPad() {
		if (!armed || aimBody < 0) return;
		const ceiling = speedCeiling(aimBody);
		if (ceiling === aimCeiling && aimSpeed <= ceiling) return;
		aimSpeed = aimSpeed > ceiling ? ceiling : aimSpeed;
		placeGripFromSpeed();
		dirty = true;
	}

	function onExperimentInput() {
		const nextGravity = Math.round(Number(expGravityEl.value) * 100) / 100;
		const nextForce = Math.round(Number(expForceEl.value) * 100) / 100;
		if (nextGravity !== gravityScale || nextForce !== forceScale) experimentTouched = true;
		setExperimentScales(nextGravity, nextForce, harvestTick);
		clampArmedToPad();
		/* the drawer prints the pad's cap: re-render it or the number goes stale */
		if (careerRule()) refreshCareerPanel();
		dirty = true;
		hudAt = -Infinity;
	}

	/* the route planner scores traced plans, so its world must not change under
	 * a half-finished trace: restart the contest on release, like a field switch */
	function onExperimentChange() {
		if (!experimentTouched) return;
		experimentTouched = false;
		if (game.on && routeRule()) {
			startGame(game.seed, game.fixedRate, game.rule, game.bot, game.player, game.cheat);
		}
	}

	function refreshHoverLabel() {
		if (hoverBody < 0 || hoverBody >= gravity.bodyCount) {
			hoverLabel = '';
			return;
		}
		hoverLabel = bodyName(hoverBody) + ' · g ' + strengthText(hoverBody) +
			(gravity.strength[hoverBody] < 0 ? ' repel' : '');
	}

	/* launch base is always a static planet core */
	function updateAim() {
		const cx = tradeSim.planetX[aimBody];
		const cy = tradeSim.planetY[aimBody];
		const dx = gripX - cx;
		const dy = gripY - cy;
		let len = Math.sqrt(dx * dx + dy * dy);
		if (len > GRIP_MAX) {
			const k = GRIP_MAX / len;
			gripX = cx + dx * k;
			gripY = cy + dy * k;
			len = GRIP_MAX;
		}
		if (len > 0.5) {
			aimAngle = Math.atan2(dy, dx);
			gripLen = len;
		} else {
			gripLen = 0;
		}
		aimCeiling = speedCeiling(aimBody);
		aimSpeed = gravity.speedAt(gripLen, aimCeiling);
		snapAim();
		refreshAimLabel();
	}

	/* game shots live on an integer grid so the link carries the exact launch
	 * inputs; the grid point is floored at the pad ceiling so a maximum drag
	 * still rounds to a shot the pad can fire */
	function snapAim() {
		if (!game.on) return;
		aimAngle = GravityGame.angleOf(GravityGame.angleUnits(aimAngle));
		const maxU = Math.floor(speedCeiling(aimBody) * GravityGame.SPEED_STEPS + 1e-9);
		const units = GravityGame.speedUnits(aimSpeed);
		aimSpeed = GravityGame.speedOf(units < maxU ? units : maxU);
	}

	function placeGripFromSpeed() {
		const ceiling = speedCeiling(aimBody);
		aimCeiling = ceiling;
		if (aimSpeed > ceiling) aimSpeed = ceiling;
		else if (aimSpeed < SPEED_MIN) aimSpeed = SPEED_MIN;
		snapAim();
		gripLen = gravity.gripLength(aimSpeed, ceiling);
		const cx = tradeSim.planetX[aimBody];
		const cy = tradeSim.planetY[aimBody];
		gripX = cx + Math.cos(aimAngle) * gripLen;
		gripY = cy + Math.sin(aimAngle) * gripLen;
		refreshAimLabel();
	}

	function beginPress(planet, event, wx, wy) {
		pressing = true;
		pressPlanet = planet;
		pressClientX = event.clientX;
		pressClientY = event.clientY;
		pendGripX = wx;
		pendGripY = wy;
	}

	function syncSoundLoop() {
		if (replay.on) sound.setLoop('idle');
		else if (aiming) sound.setLoop('aim');
		else if (armed && !routeRule()) sound.setLoop('armed');
		else sound.setLoop('idle');
	}

	function takeOverAim(now) {
		if (!canAimFrom(pressPlanet)) {
			pressing = false;
			showBlocked(pressPlanet, now);
			hudAt = -Infinity;
			return;
		}
		/* re-aiming rewrites the queued shot, so the pending one is cancelled */
		cancelTurret();
		blockedPlanet = -1;
		blockedKind = 0;
		blockedBy = -1;
		const best = activeRouteBest();
		if (routeRule() && best.ready && pressPlanet !== best.origin) resetRouteBest();
		savedArmed = armed;
		savedBody = aimBody;
		savedAngle = aimAngle;
		savedSpeed = aimSpeed;
		aimBody = pressPlanet;
		aiming = true;
		armed = false;
		syncSoundLoop();
		gripX = pendGripX;
		gripY = pendGripY;
		updateAim();
		activeSim().predCount = 0;
		dirty = true;
		hudAt = -Infinity;
	}

	function restoreSaved() {
		aimBody = savedBody;
		aimAngle = savedAngle;
		aimSpeed = savedSpeed;
		armed = true;
		placeGripFromSpeed();
		dirty = true;
	}

	/* the barrel must line up with the aimed direction before the rail fires */
	function cancelTurret() {
		if (!turret.pending) return;
		turret.pending = false;
		GravityGame.releaseEnergy(turret.pad, turret.energy);
		careerNotice('');
		launchState = -1;
		hudAt = -Infinity;
		refreshGameUi();
		refreshCareerWaitUi(game.career, game.career.ended !== GravityGame.CAREER_OPEN);
	}

	/* the barrel turns with the in-game career clock, so a queued launch fires
	 * when the barrel lines up with the aim on world time, not on wall clock,
	 * and the aimed shot's energy is reserved from the pad battery at the click */
	function queueTurretShot() {
		const period = GravityGame.turretPeriod(game.galaxy, aimBody);
		const seconds = game.clockSteps * DT;
		const gun = GravityGame.turretAngle(game.galaxy, aimBody, seconds);
		let delta = aimAngle - gun;
		delta -= Math.floor(delta / TAU) * TAU;
		const wait = delta < 0.02 ? 0 : delta / TAU * period;
		turret.pending = true;
		turret.body = aimBody;
		turret.angle = aimAngle;
		turret.speed = aimSpeed;
		/* the queued shot claims its energy now: the first to queue gets the
		 * charge, whether it is the pad owner or a guest */
		turret.pad = GravityGame.padAt(game.career, aimBody);
		turret.energy = gravity.launchEnergy(aimBody, aimSpeed);
		GravityGame.reserveEnergy(turret.pad, turret.energy);
		turret.fireAt = game.clockSteps + Math.ceil(wait / DT);
		/* the barrel only turns while the world clock runs */
		setCareerPaused(false);
		careerNotice(wait > 0
			? 'EMC turning · ' + wait.toFixed(1) + ' s to ' + planetName(aimBody)
			: 'EMC aligned · ' + planetName(aimBody));
		launchState = -1;
		hudAt = -Infinity;
		refreshGameUi();
		careerWaitBtn.disabled = true;
	}

	/* the world clock turns the barrel; once it reaches the aligned step the
	 * queued shot fires by itself (a paused clock holds the barrel still) */
	function tickTurret() {
		if (!turret.pending || game.clockSteps < turret.fireAt) return;
		if (careerRule() && careerPaused) return;
		turret.pending = false;
		aimBody = turret.body;
		aimAngle = turret.angle;
		aimSpeed = turret.speed;
		armed = true;
		careerNotice('');
		fire(NO_ABORT);
	}

	function cancelAim() {
		const sim = activeSim();
		cancelTurret();
		aiming = false;
		armed = false;
		pressing = false;
		savedArmed = false;
		dirty = false;
		syncSoundLoop();
		if (game.on && routeRule() && !replay.on) resetSlotRoutePlan(activeSlotIndex());
		if (sim.status !== STATUS_FLYING) sim.predCount = 0;
		else dirty = true;
		refreshRouteBestUi();
		hudAt = -Infinity;
	}

	function canImpulse() {
		return careerRule() && !replay.on && gravity.status === STATUS_FLYING &&
			gravity.burnLimit() > 0;
	}

	function clearBurnAim() {
		burnPaused = false;
		burnAiming = false;
		burnArmed = false;
		burnPressing = false;
		savedBurnArmed = false;
	}

	function setBurnPaused(next) {
		if (next) {
			if (!canImpulse()) return false;
			burnPaused = true;
			playAcc = 0;
			dirty = true;
			launchState = -1;
			hudAt = -Infinity;
			return true;
		}
		clearBurnAim();
		playAcc = 0;
		dirty = true;
		refreshAimLabel();
		launchState = -1;
		hudAt = -Infinity;
		return true;
	}

	function snapBurnAim() {
		burnAngle = GravityGame.angleOf(GravityGame.angleUnits(burnAngle));
		const maxU = Math.floor(burnCeiling * GravityGame.SPEED_STEPS + 1e-9);
		const units = GravityGame.speedUnits(burnDv);
		burnDv = GravityGame.speedOf(units < maxU ? units : maxU);
	}

	function updateBurnAim() {
		const cx = gravity.cargo.x;
		const cy = gravity.cargo.y;
		const dx = gripX - cx;
		const dy = gripY - cy;
		let len = Math.sqrt(dx * dx + dy * dy);
		if (len > GRIP_MAX) {
			const k = GRIP_MAX / len;
			gripX = cx + dx * k;
			gripY = cy + dy * k;
			len = GRIP_MAX;
		}
		if (len > 0.25) {
			burnAngle = Math.atan2(dy, dx);
			gripLen = len;
		} else {
			gripLen = 0;
		}
		burnCeiling = gravity.burnLimit();
		burnDv = gravity.speedAt(gripLen, burnCeiling, 0);
		snapBurnAim();
		refreshAimLabel();
	}

	function placeBurnGrip() {
		burnCeiling = gravity.burnLimit();
		if (burnDv > burnCeiling) burnDv = burnCeiling;
		else if (burnDv < 0) burnDv = 0;
		snapBurnAim();
		gripLen = gravity.gripLength(burnDv, burnCeiling, 0);
		gripX = gravity.cargo.x + Math.cos(burnAngle) * gripLen;
		gripY = gravity.cargo.y + Math.sin(burnAngle) * gripLen;
		refreshAimLabel();
	}

	function takeOverBurnAim() {
		if (!canImpulse()) {
			burnPressing = false;
			return;
		}
		if (!burnPaused) setBurnPaused(true);
		savedBurnArmed = burnArmed;
		savedBurnAngle = burnAngle;
		savedBurnDv = burnDv;
		burnAiming = true;
		burnArmed = false;
		gripX = pendGripX;
		gripY = pendGripY;
		updateBurnAim();
		dirty = true;
		launchState = -1;
		hudAt = -Infinity;
	}

	function executeBurn() {
		if (!canImpulse() || !burnArmed || !(burnDv > 0)) return false;
		const angleU = GravityGame.angleUnits(burnAngle);
		const dvU = GravityGame.speedUnits(burnDv);
		if (dvU < 1) return false;
		const angle = GravityGame.angleOf(angleU);
		const dv = GravityGame.speedOf(dvU);
		const step = gravity.liveSteps;
		const ship = game.career.ship;
		const beforeFuel = ship.fuelKg;
		if (!GravityGame.careerBurn(game.career, gravity, angle, dv)) return false;
		const used = beforeFuel - ship.fuelKg;
		if (game.shots.length > 0) {
			game.shots[game.shots.length - 1].burns.push(GravityGame.createBurn(step, angleU, dvU));
		}
		clearBurnAim();
		playAcc = 0;
		dirty = true;
		launchState = -1;
		const remDv = OrbitTech.impulseDeltaV(ship.fuelKg, ship.engine, ship.mass, ship.fuelKg);
		careerNotice('burned Δv ' + dv.toFixed(1) + ' px/s (−' + used.toFixed(1) + ' kg) · fuel ' +
			ship.fuelKg.toFixed(1) + ' kg' +
			(remDv > 0.05 ? ' · Δv ' + remDv.toFixed(1) + ' px/s left' : ' · tank empty'));
		refreshGameUi();
		return true;
	}

	function launch() {
		if (canImpulse()) {
			if (!burnPaused) setBurnPaused(true);
			else if (burnArmed) executeBurn();
			else setBurnPaused(false);
			return;
		}
		if (routeRule() && game.on) return;
		if (turret.pending) {
			cancelTurret();
			careerNotice('launch cancelled');
			return;
		}
		if (!armed || !canAimFrom(aimBody) || gameLocked()) return;
		if (!activeSim().canFire(aimBody, aimSpeed)) return;
		if (careerRule() && !GravityGame.careerCanFire(game.career, gravity, aimBody, aimSpeed)) return;
		/* in career the click queues the shot: the barrel winds to the aim */
		if (careerRule() && !replay.on) {
			queueTurretShot();
			return;
		}
		if (careerRule()) setCareerPaused(false);
		fire(NO_ABORT);
	}

	function fire(abortStep) {
		if (game.on && routeRule()) return;
		clearBurnAim();
		const slot = activeSlotIndex();
		const sim = slotSim(slot);
		if (game.on) recordSlotShot(slot, abortStep);
		predictShot();
		dirty = false;
		sim.launch(aimBody, aimAngle, aimSpeed);
		if (!replay.on && (!game.on || !slotIsBot(slot))) {
			sound.launch();
			soundFlightSim = sim;
		}
		if (game.on) {
			if (careerRule()) {
				GravityGame.careerBeginFlight(game.career, sim);
				careerPhoto('catapult');
			} else GravityGame.beginFlight(slotLedger(slot), sim);
			if (slot > 0) bot.rivals[slot - 1].basePlanet = aimBody;
		}
		aiming = false;
		armed = false;
		pressing = false;
		savedArmed = false;
		blockedPlanet = -1;
		hudAt = -Infinity;
		if (game.on) refreshGameUi();
	}

	/* the launch state must not depend on frame timing, so roster and clock are re-read here */
	function recordSlotShot(slot, abortStep) {
		const sim = slotSim(slot);
		if (mode === MODE_PORTS) {
			syncPortRoster();
			syncUserRivalFields();
		} else if (slot > 0) {
			syncUserRivalFields();
		}
		sim.fieldT = tradeSim.t;
		sim.fieldRate = scene.trade.speed;
		sim.stepLimit = abortStep === NO_ABORT ? ruleSpec().capSteps : abortStep;
		sim.limitReason = abortStep === NO_ABORT ? END_TIME : END_ABORT;
		slotShots(slot).push(GravityGame.createShot(mode, aimBody,
			GravityGame.angleUnits(aimAngle), GravityGame.speedUnits(aimSpeed), abortStep));
	}

	function clearCargo() {
		sound.reset();
		soundFlightSim = null;
		photoSpace.fill(0);
		photoLanded.fill(0);
		photoCareer.fill(0);
		if (root.PhotoDeck) root.PhotoDeck.hide();
		playAcc = 0;
		gravity.clear();
		clearBurnAim();
		aiming = false;
		armed = false;
		pressing = false;
		savedArmed = false;
		blockedPlanet = -1;
		blockedUntil = -Infinity;
		dirty = false;
		if (helperState.active) helperStop();
		hudAt = -Infinity;
	}

	/* gravity source: static planets or their moving ports */
	function setSource(next) {
		if (next === mode && gravity.fillField) return;
		mode = next;
		srcPlanetsEl.checked = mode === MODE_PLANETS;
		srcPortsEl.checked = mode === MODE_PORTS;
		if (game.on && routeRule() && !replay.on) {
			/* every route plan is traced in one field; changing it restarts the contest */
			startGame(game.seed, game.fixedRate, game.rule, game.bot, game.player, game.cheat);
			return;
		}
		cancelAim();
		hoverBody = -1;
		refreshHoverLabel();
		setSelected(-1);
		applyMode();
		if (activeSim().status === STATUS_FLYING) dirty = true;
		hudAt = -Infinity;
		syncSeedUrl(replay.on);
	}

	function fieldChanged() {
		const sim = activeSim();
		if (armed || aiming || sim.status === STATUS_FLYING) dirty = true;
		else sim.predCount = 0;
		hudAt = -Infinity;
	}

	function ruleSpec() {
		return RULES[game.rule];
	}

	function routeRule() {
		return game.on && game.rule === RULE_ROUTE;
	}

	function playerIsBot() {
		return slotIsBot(activeSlotIndex());
	}

	function moneyRule() {
		return game.rule === RULE_MONEY;
	}

	function careerRule() {
		return game.on && game.rule === RULE_CAREER;
	}

	/* a flown slot stops when the purse cannot cover a launch; a career when it ended */
	function slotBroke(slot) {
		if (careerRule()) return game.career.ended !== GravityGame.CAREER_OPEN;
		return slotLedger(slot).purse < MONEY.cost;
	}

	function careerOverText() {
		const career = game.career;
		if (career.ended === GravityGame.CAREER_BROKE) return 'broke · career over';
		if (career.ended === GravityGame.CAREER_COMPLETE) return 'catapult network complete';
		if (!career.stranded) return '';
		if (career.at < 0) return 'lost in space · evacuate';
		/* no own EMC here, but a standing rail (commercial or a rival's) that
		 * can lift the ship is a launch button, not a dead end */
		if (GravityGame.padLift(career, career.at) + 1e-9 >= GravitySim.SPEED_MIN) return '';
		/* short enough for the launch button, which must not wrap */
		return 'stranded · build or evacuate';
	}

	/* the career clock button mirrors the pause; both career time controls
	 * live in the trade bar and only show in career runs */
	function refreshCareerClockUi() {
		const career = careerRule();
		if (careerClockBtn) {
			careerClockBtn.hidden = !career;
			careerClockBtn.textContent = careerPaused ? '▶ time' : '❚❚ time';
			careerClockBtn.classList.toggle('on', career && careerPaused);
			careerClockBtn.title = careerPaused
				? 'career world clock is paused — click to run time (pads charge, rivals fly, visit profits grow)'
				: 'career world clock is running — click to pause time and aim in peace';
		}
		if (careerPauseLandLabelEl) careerPauseLandLabelEl.hidden = !career;
		if (careerPauseLandEl) careerPauseLandEl.checked = pauseOnLanding;
	}

	function setCareerPaused(next) {
		if (careerPaused === next) return;
		careerPaused = next;
		playAcc = 0;
		if (next) careerPauseNow = performance.now();
		if (scene.setFrozen) scene.setFrozen(careerRule() && next);
		refreshCareerClockUi();
		hudAt = -Infinity;
	}

	/* why the armed shot cannot fire from its pad right now ('' when it can) */
	function careerPadNote() {
		if (!careerRule() || !armed || aimBody < 0) return '';
		const career = game.career;
		const fee = GravityGame.launchFee(career, aimBody, aimSpeed);
		if (fee > 0 && career.ledger.purse + 1e-9 < fee) {
			return 'EMC fee ' + fee.toFixed(2) + ' · purse ' + career.ledger.purse.toFixed(2);
		}
		if (gravity.canFire(aimBody, aimSpeed)) return '';
		return 'pad ' + gravity.pads[aimBody].chargeKwh.toFixed(2) + ' kWh · shot ' +
			gravity.launchEnergy(aimBody, aimSpeed).toFixed(2) + ' · max ' +
			Math.round(gravity.speedLimit(aimBody)) + ' px/s';
	}

	function routeOccupiedBy(planet) {
		if (!routeRule() || planet < 0) return -1;
		const slot = activeSlotIndex();
		for (let i = 0; i < bot.count; i++) {
			if (slot === i + 1) continue;
			if (bot.rivals[i].routeOrigin === planet) return i;
		}
		if (slot !== 0) {
			const p0Origin = slotIsBot(0) ? bot.player.routeOrigin : routePlan.origin;
			if (p0Origin === planet) return GravityBot.PLAYER_INDEX;
		}
		return -1;
	}

	function canAimFrom(planet) {
		if (planet < 0) return false;
		if (playerIsBot()) return false;
		if (routeRule()) return routeOccupiedBy(planet) < 0;
		return activeSim().canLaunchFrom(planet);
	}

	function showBlocked(planet, now) {
		blockedPlanet = planet;
		blockedUntil = now + 2600;
		blockedBy = routeOccupiedBy(planet);
		blockedKind = blockedBy >= 0 ? 1 : 0;
	}

	function resetSlotRoutePlan(slot) {
		const plan = slotPlans[slot];
		plan.ready = false;
		plan.length = 0;
		plan.steps = 0;
		plan.visits = 0;
		plan.reason = GravitySim.END_OPEN;
		plan.body = -1;
		plan.origin = -1;
		if (slot === 0) {
			game.length = 0;
			game.steps = 0;
			if (routeRule()) game.shots.length = 0;
		} else if (slot - 1 < bot.count) {
			const r = bot.rivals[slot - 1];
			r.routeReady = false;
			r.routeLength = 0;
			r.routeSteps = 0;
			r.routeVisits = 0;
			r.routeReason = GravitySim.END_OPEN;
			r.routeBody = -1;
			r.routeOrigin = -1;
			r.length = 0;
			r.steps = 0;
			if (routeRule()) r.shots.length = 0;
		}
		refreshRouteLeader();
	}

	function resetRoutePlan() {
		for (let s = 0; s < slotPlans.length; s++) {
			const plan = slotPlans[s];
			plan.ready = false;
			plan.length = 0;
			plan.steps = 0;
			plan.visits = 0;
			plan.reason = GravitySim.END_OPEN;
			plan.body = -1;
			plan.origin = -1;
		}
		routeLeader = -2;
		routeBotVersion = -1;
		game.length = 0;
		game.steps = 0;
		if (routeRule()) game.shots.length = 0;
	}

	function refreshRouteBestUi() {
		const shown = routeRule();
		if (cargoFootEl) cargoFootEl.classList.toggle('routeMode', shown);
		routeBestBtn.hidden = !shown;
		const best = activeRouteBest();
		const plan = activeRoutePlan();
		const enabled = shown && best.ready && !playerIsBot() && !replay.on;
		routeBestBtn.disabled = !enabled;
		routeBestBtn.classList.toggle('bestReady', enabled);
		routeBestBtn.classList.toggle('on', enabled &&
			(!plan.ready || best.length > plan.length + 0.5));
		const text = best.ready
			? 'use best · ' + Math.round(best.length) + ' px'
			: 'use best';
		if (text !== hudRouteBestText) {
			hudRouteBestText = text;
			routeBestBtn.textContent = text;
		}
		routeBestBtn.title = best.ready
			? 'restore ' + Math.round(best.length) + ' px from ' + planetName(best.origin)
			: 'the longest finished plan for this planet is saved while you adjust aim';
		helperUpdateUi();
	}

	function helperHelperOrigin() {
		if (selected >= 0 && selected < PLANETS) return selected;
		if (aiming || armed) return aimBody;
		return -1;
	}

	function helperUpdateUi() {
		if (!helperGroupEl) return;
		helperGroupEl.hidden = false;
		const route = routeRule();
		const canScan = !helperState.active && !replay.on && !playerIsBot() && !gameLocked() || !game.on;
		const focusOrigin = helperHelperOrigin();
		const focusOk = focusOrigin >= 0 && (route ? routeOccupiedBy(focusOrigin) < 0 : canAimFrom(focusOrigin));
		const best = activeRouteBest();
		const tweakOk = !helperState.active && best.ready && !replay.on && !playerIsBot() && (route ? routeOccupiedBy(best.origin) < 0 : true);
		if (helperScanBtn) {
			helperScanBtn.disabled = !canScan;
			helperScanBtn.textContent = route ? 'quick scan' : 'auto scan';
			helperScanBtn.title = selected >= 0
				? 'broad scan biased to ' + planetName(selected) + ' plus random planets'
				: 'broad random scan over all planets · each press adds fresh jitter';
		}
		if (helperFocusBtn) {
			helperFocusBtn.disabled = !canScan || !focusOk;
			helperFocusBtn.textContent = focusOk ? 'scan ' + planetName(focusOrigin) : 'scan here';
			helperFocusBtn.title = focusOk
				? 'scan many angles and speeds from ' + planetName(focusOrigin)
				: 'select a free planet first';
		}
		if (helperTweakBtn) {
			helperTweakBtn.disabled = !tweakOk;
			helperTweakBtn.textContent = best.ready ? 'tweak ' + Math.round(best.length) + ' px' : 'tweak best';
			helperTweakBtn.title = best.ready
				? 'nudge the ' + Math.round(best.length) + ' px best by ± small angle and ±8 % speed · each press tries new jitter'
				: 'make a best plan first (drag and wait for trace to finish)';
		}
		const career = careerRule();
		const landed = career && !gameLocked() && gravity.status !== STATUS_FLYING ? game.career.at : -1;
		const profitOk = canScan && landed >= 0 && gravity.fieldStatic &&
			game.career.ended === GravityGame.CAREER_OPEN;
		if (helperProfitBtn) {
			helperProfitBtn.hidden = !career;
			helperProfitBtn.disabled = !profitOk;
			helperProfitBtn.textContent = 'best profit';
			helperProfitBtn.title = landed < 0
				? 'career · land somewhere to scan for money shots'
				: 'scan 34 aims from ' + planetName(landed) +
					' · rank by money (visits + tasks − EMC fee − exit cost)' +
					' · a saved shot that pays more wins';
		}
		if (helperEmcBtn) {
			helperEmcBtn.hidden = !career;
			helperEmcBtn.disabled = !profitOk;
			helperEmcBtn.textContent = 'profit + EMC';
			helperEmcBtn.title = landed < 0
				? 'career · land somewhere to scan'
				: 'scan from ' + planetName(landed) + ' for the best money shot that lands where an ' +
					'EMC-1 can be built · a saved shot that pays more wins';
		}
		if (helperStopBtn) helperStopBtn.hidden = !helperState.active;
		if (helperProgressEl) helperProgressEl.hidden = !helperState.active;
		const tag = helperState.active
			? helperState.mode + ' ' + (helperState.index + 1) + '/' + helperState.candidates.length +
				(helperProbe.routeActive ? ' · ' + Math.round(helperProbe.routeProgress() * 100) + '%' : '')
			: best.ready ? 'best ' + Math.round(best.length) + ' px' : 'ready';
		if (tag !== helperHudTag) {
			helperHudTag = tag;
			if (helperTagEl) helperTagEl.textContent = tag;
		}
		if (helperState.active && helperProgressFillEl && helperState.candidates) {
			const pct = Math.max(0, Math.min(100, helperState.index / helperState.candidates.length * 100));
			helperProgressFillEl.style.width = pct.toFixed(1) + '%';
		}
		if (helperProgressTextEl) {
			if (helperState.active) {
				const done = helperState.index;
				const total = helperState.candidates ? helperState.candidates.length : 0;
				const bestLen = helperState.best ? Math.round(helperState.best.length) : 0;
				helperProgressTextEl.textContent = done + '/' + total + (bestLen ? ' · best ' + bestLen + ' px' : '');
			} else helperProgressTextEl.textContent = '';
		}
	}

	function helperAttachWorld() {
		helperProbe.setPlanets(PLANETS, tradeSim.planetX, tradeSim.planetY, tradeSim.planetR,
			tradeSim.orbitRX, tradeSim.orbitRY, tradeSim.orbitTiltCos, tradeSim.orbitTiltSin);
		helperProbe.setPlanetMask(planetMask);
		helperProbe.setField(gravity.bodyCount, gravity.bodyR, gravity.strength, gravity.fillField, gravity.fieldStatic);
		helperProbe.fieldT = gravity.fieldT;
		helperProbe.fieldRate = gravity.fieldRate;
	}

	function helperScore(probe, cand) {
		const origin = cand.origin;
		if (routeRule()) {
			if (probe.predReason === END_IMPACT || probe.predReason === END_EXIT) return probe.predLength;
			return -1e12;
		}
		let careerMoney = null;
		if (careerRule()) {
			if (probe.predReason !== END_IMPACT || probe.predBody < 0) return -Infinity;
			careerMoney = traceMoney(probe, origin, GravityGame.speedOf(cand.speedU));
			if (!moneyFlyable(careerMoney)) return -Infinity;
			if (helperState.goal !== 'score') {
				if (helperState.goal === 'profitEmc' && !careerMoney.builds) return -Infinity;
				return careerMoney.net;
			}
		}
		const profit = game.on ? GravityGame.estimateProfit(game.market, game.clockSteps, probe) : 0;
		const lands = probe.predReason === END_IMPACT && probe.predBody !== origin ? 1 : 0;
		const samePad = probe.predReason === END_IMPACT && probe.predBody === origin ? 1 : 0;
		const newVisits = probe.predNewVisits;
		let score = lands * 12 - samePad * 35 - (probe.predReason === END_EXIT ? 220 : 0);
		if (careerRule()) {
			const career = game.career;
			const body = probe.predBody;
			if (career.contract >= 0) {
				const task = career.tasks[career.contract];
				if (task.state === GravityGame.TASK_LOADED && body === task.to) score += task.reward * 40;
				else if (task.state === GravityGame.TASK_ACCEPTED && body === task.from) score += task.reward * 20;
			}
			const compete = career.tasks[GravityGame.COMPETE_SLOT];
			if (compete.kind === GravityGame.TASK_COMPETE && origin === compete.planet &&
				probe.predLength >= compete.minLength &&
				game.clockSteps + probe.predSteps <= compete.deadline) {
				score += compete.reward * 35;
			}
			score += profit * 28 + newVisits * 4 - probe.predTime * 0.12;
		} else if (game.on && ruleSpec().stopOnTour) {
			const wouldComplete = activeSim().visitedCount + newVisits >= planetCount;
			score += (wouldComplete ? 80 : 0) + newVisits * 12 + profit * 18 - probe.predTime * 0.16;
		} else if (game.on && moneyRule()) {
			score += profit * 30 + newVisits * 3 - probe.predTime * 0.14;
		} else {
			score += newVisits * 10 + profit * 12 - probe.predTime * 0.12;
		}
		score += probe.predLength * 0.0002;
		return score;
	}

	function helperSnapSpeedUnits(origin, speed) {
		const maxU = Math.floor(speedCeiling(origin) * GravityGame.SPEED_STEPS + 1e-9);
		const minU = GravityGame.speedUnits(SPEED_MIN);
		let u = GravityGame.speedUnits(speed);
		if (u < minU) u = minU;
		if (u > maxU) u = maxU;
		return u;
	}

	function helperMakeBroad(count) {
		const route = routeRule();
		const out = [];
		const fixedOrigin = game.on && !route ? activeSim().landedBody : -1;
		if (fixedOrigin >= 0 && !canAimFrom(fixedOrigin)) return out;
		let attempts = 0;
		while (out.length < count && attempts < count * 6) {
			attempts += 1;
			let planet;
			if (fixedOrigin >= 0) planet = fixedOrigin;
			else if (selected >= 0 && planetMask[selected] && Math.random() < 0.42) planet = selected;
			else planet = randomActivePlanet();
			if (route && routeOccupiedBy(planet) >= 0) continue;
			if (!route && !game.on && planet >= PLANETS) continue;
			if (game.on && !route && !canAimFrom(planet)) continue;
			const cap = speedCeiling(planet);
			const angle = Math.random() * TAU;
			const speed = SPEED_MIN + Math.random() * Math.max(0, cap - SPEED_MIN);
			out.push({
				origin: planet,
				angleU: GravityGame.angleUnits(angle),
				speedU: helperSnapSpeedUnits(planet, speed)
			});
		}
		return out;
	}

	function helperMakeFocus(origin, count) {
		const out = [];
		const cap = speedCeiling(origin);
		const span = Math.max(0, cap - SPEED_MIN);
		for (let i = 0; i < count; i++) {
			const angle = Math.random() * TAU;
			const jitter = (Math.random() - 0.5) * 0.06;
			const a = (angle + jitter + TAU) % TAU;
			const speed = SPEED_MIN + Math.random() * span;
			const s = speed * (0.97 + Math.random() * 0.06);
			out.push({
				origin: origin,
				angleU: GravityGame.angleUnits(a),
				speedU: helperSnapSpeedUnits(origin, s)
			});
		}
		return out;
	}

	function helperMakeTweak(base, count) {
		const baseAngle = GravityGame.angleOf(base.angleU);
		const baseSpeed = GravityGame.speedOf(base.speedU);
		const out = [];
		out.push({
			origin: base.origin,
			angleU: base.angleU,
			speedU: helperSnapSpeedUnits(base.origin, baseSpeed)
		});
		for (let i = 1; i < count; i++) {
			let angle = baseAngle + (Math.random() - 0.5) * 0.26;
			angle = (angle % TAU + TAU) % TAU;
			const speed = baseSpeed * (0.92 + Math.random() * 0.16);
			out.push({
				origin: base.origin,
				angleU: GravityGame.angleUnits(angle),
				speedU: helperSnapSpeedUnits(base.origin, speed)
			});
		}
		return out;
	}

	function helperBeginCandidate() {
		if (!helperState.active || helperState.index >= helperState.candidates.length) return;
		const cand = helperState.candidates[helperState.index];
		helperProbe.visited.set(activeSim().visited);
		helperProbe.visitedCount = activeSim().visitedCount;
		helperProbe.fieldT = gravity.fieldT;
		helperProbe.fieldRate = gravity.fieldRate;
		helperProbe.horizon = helperState.horizon;
		if (!helperProbe.fieldStatic) helperProbe.refreshField();
		const angle = GravityGame.angleOf(cand.angleU);
		const speed = GravityGame.speedOf(cand.speedU);
		helperProbe.routeBegin(cand.origin, angle, speed, helperState.horizon);
	}

	/* `seed` is a saved shot already known to be worth `score`: the scan has to
	 * beat it, so a press never returns worse than the launch list */
	function helperRun(candidates, mode, goal, seed) {
		if (!candidates || candidates.length === 0) return;
		helperAttachWorld();
		helperState.active = true;
		helperState.mode = mode;
		helperState.goal = goal || 'score';
		helperState.candidates = candidates;
		helperState.index = 0;
		helperState.best = seed || null;
		helperState.bestScore = seed ? seed.score : -Infinity;
		helperState.fromBook = Boolean(seed);
		helperState.startedAt = performance.now();
		if (routeRule()) helperState.horizon = ruleSpec().horizon;
		/* a career flight is capped by the rule, not by the preview slider */
		else if (careerRule()) helperState.horizon = GravityGame.CAP_SECONDS;
		else helperState.horizon = gravity.horizon;
		helperBeginCandidate();
		helperUpdateUi();
		hudAt = -Infinity;
	}

	function helperStartBroad() {
		if (helperState.active || replay.on || playerIsBot()) return;
		if (game.on && gameLocked()) return;
		const count = routeRule() ? 28 : 20;
		const cands = helperMakeBroad(count);
		if (cands.length === 0) return;
		helperRun(cands, 'quick scan');
	}

	function helperStartFocus() {
		if (helperState.active || replay.on || playerIsBot()) return;
		if (game.on && gameLocked()) return;
		let origin = helperHelperOrigin();
		if (origin < 0) return;
		if (routeRule() && routeOccupiedBy(origin) >= 0) return;
		if (!routeRule() && !canAimFrom(origin)) {
			const landed = activeSim().landedBody;
			if (landed >= 0 && origin !== landed) return;
		}
		const count = routeRule() ? 22 : 18;
		const cands = helperMakeFocus(origin, count);
		helperRun(cands, 'scan ' + planetName(origin));
	}

	/* career profit scans: random aims from the landed pad, plus, when a pad to
	 * build on is the point, a few aims at the nearest padless planets */
	function helperMakeProfit(origin, count, requireEmc) {
		const out = helperMakeFocus(origin, count);
		if (!requireEmc) return out;
		const career = game.career;
		const cap = speedCeiling(origin);
		const span = Math.max(0, cap - SPEED_MIN);
		const near = [];
		for (let p = 0; p < PLANETS; p++) {
			if (!planetMask[p]) continue;
			if (p === origin || career.pads[p].catapult !== null) continue;
			const dx = gravity.planetX[p] - gravity.planetX[origin];
			const dy = gravity.planetY[p] - gravity.planetY[origin];
			near.push({ planet: p, dist: dx * dx + dy * dy });
		}
		near.sort((a, b) => a.dist - b.dist);
		const picks = Math.min(4, near.length);
		for (let i = 0; i < picks; i++) {
			const planet = near[i].planet;
			const angle = Math.atan2(gravity.planetY[planet] - gravity.planetY[origin],
				gravity.planetX[planet] - gravity.planetX[origin]);
			for (let k = 0; k < 3; k++) {
				const a = (angle + (k - 1) * 0.08) % TAU;
				const speed = SPEED_MIN + span * (0.35 + 0.2 * k);
				out.push({
					origin: origin,
					angleU: GravityGame.angleUnits(a < 0 ? a + TAU : a),
					speedU: helperSnapSpeedUnits(origin, speed)
				});
			}
		}
		return out;
	}

	/* the seed slot: a saved shot priced for the scan, reused between presses */
	const helperSeed = { origin: -1, angleU: 0, speedU: 0, length: 0, steps: 0,
		reason: END_IMPACT, body: -1, score: -Infinity };

	/*
	 * The best saved shot from this rail for the money buttons, priced at the
	 * live market and the live cap without spending a trace. It seeds the scan,
	 * so a search only replaces it with something that actually pays more.
	 */
	function helperBookSeed(career, origin, requireEmc) {
		if (!GravityGame.bookReady(career.launchBook, pageBookTag())) return null;
		const entries = career.launchBook.entries;
		const cap = speedCeiling(origin);
		let best = null;
		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			if (entry.origin !== origin) continue;
			if (GravityGame.speedOf(entry.speedU) > cap + 1e-9) continue;
			const money = storedMoney(entry);
			const score = money.net;
			if (!moneyFlyable(money)) continue;
			if (requireEmc && !money.builds) continue;
			if (best !== null && score <= best.score) continue;
			helperSeed.origin = entry.origin;
			helperSeed.angleU = entry.angleU;
			helperSeed.speedU = entry.speedU;
			helperSeed.length = entry.length;
			helperSeed.steps = entry.steps;
			helperSeed.body = entry.body;
			helperSeed.score = score;
			best = helperSeed;
		}
		return best;
	}

	function helperStartProfit(requireEmc) {
		if (helperState.active || replay.on || playerIsBot()) return;
		if (!careerRule() || gameLocked() || !gravity.fieldStatic) return;
		const origin = game.career.at;
		if (origin < 0 || gravity.status === STATUS_FLYING) return;
		if (game.career.ended !== GravityGame.CAREER_OPEN) return;
		const cands = helperMakeProfit(origin, requireEmc ? 26 : 34, requireEmc);
		if (cands.length === 0) return;
		helperRun(cands, requireEmc ? 'profit + EMC' : 'best profit',
			requireEmc ? 'profitEmc' : 'profit',
			helperBookSeed(game.career, origin, requireEmc));
	}

	function helperStartTweak() {
		if (helperState.active || replay.on || playerIsBot()) return;
		if (game.on && gameLocked()) return;
		const best = activeRouteBest();
		let base = null;
		if (routeRule() && best.ready) base = { origin: best.origin, angleU: best.angleU, speedU: best.speedU };
		else if (armed) base = { origin: aimBody, angleU: GravityGame.angleUnits(aimAngle), speedU: GravityGame.speedUnits(aimSpeed) };
		else return;
		if (routeRule() && routeOccupiedBy(base.origin) >= 0) return;
		const cands = helperMakeTweak(base, 16);
		helperRun(cands, 'tweak');
	}

	function helperStop() {
		if (!helperState.active) return;
		helperState.active = false;
		helperState.candidates = null;
		if (helperProgressFillEl) helperProgressFillEl.style.width = '0%';
		helperUpdateUi();
		hudAt = -Infinity;
	}

	function helperTick(budgetMs) {
		if (!helperState.active) return;
		const budget = budgetMs > 0 ? budgetMs : HELPER_BUDGET_MS;
		const start = performance.now();
		while (helperState.active && performance.now() - start < budget) {
			if (helperProbe.routeActive) {
				const left = budget - (performance.now() - start);
				if (left <= 0.3) break;
				helperProbe.routeStep(Math.min(left, 2));
				if (helperProbe.routeActive) break;
			}
			if (!helperProbe.routeActive) {
				const idx = helperState.index;
				if (idx < helperState.candidates.length) {
					const cand = helperState.candidates[idx];
					const score = helperScore(helperProbe, cand);
					if (careerRule()) saveTrace(helperProbe, cand.origin, cand.angleU, cand.speedU);
					if (score > helperState.bestScore) {
						helperState.bestScore = score;
						helperState.fromBook = false;
						helperState.best = {
							origin: cand.origin, angleU: cand.angleU, speedU: cand.speedU,
							length: helperProbe.predLength, steps: helperProbe.predSteps,
							reason: helperProbe.predReason, body: helperProbe.predBody,
							score: score
						};
					}
					helperState.index += 1;
					if (helperState.index < helperState.candidates.length) {
						helperBeginCandidate();
						continue;
					}
				}
				if (helperState.index >= helperState.candidates.length) {
					const best = helperState.best;
					helperState.active = false;
					helperState.candidates = null;
					if (best && best.score > -1e11) {
						if (careerRule()) {
							careerNotice(helperState.goal === 'score' ? ''
								: (helperState.fromBook ? 'launch list' : 'best money shot') +
									' · ' + planetName(best.body) + ' · ' +
									signedMoney(best.score));
						}
						aimBody = best.origin;
						aimAngle = GravityGame.angleOf(best.angleU);
						aimSpeed = GravityGame.speedOf(best.speedU);
						aiming = false;
						armed = true;
						pressing = false;
						savedArmed = false;
						placeGripFromSpeed();
						if (careerRule()) {
							/* the scan traced the rule cap, not the shorter
							 * preview slider: show that landing too, so the
							 * armed shot's preview and launch book agree */
							activeSim().predictFull(aimBody, aimAngle, aimSpeed,
								Math.min(GravityGame.CAP_SECONDS,
									best.steps * GravitySim.DT + 0.2));
							refreshPredGain();
							dirty = false;
						} else dirty = true;
						hudAt = -Infinity;
						if (helperProgressFillEl) helperProgressFillEl.style.width = '100%';
						setTimeout(() => { if (helperProgressFillEl && !helperState.active) helperProgressFillEl.style.width = '0%'; }, 900);
					} else if (careerRule() && helperState.goal !== 'score') {
						/* nothing flyable was found: say so instead of leaving the
						 * previously armed shot standing in as a false find */
						careerNotice(helperState.goal === 'profitEmc'
							? 'no EMC-buildable landing'
							: 'no paying shot found');
					}
					helperUpdateUi();
					break;
				}
			}
		}
		if (helperState.active) helperUpdateUi();
	}

	function resetBestSlot(best) {
		best.ready = false;
		best.length = 0;
		best.origin = -1;
		best.angleU = 0;
		best.speedU = 0;
	}

	function resetRouteBest() {
		resetBestSlot(activeRouteBest());
		refreshRouteBestUi();
	}

	function resetAllRouteBest() {
		for (let s = 0; s < slotBest.length; s++) {
			resetBestSlot(slotBest[s]);
			slotAim[s].armed = false;
			slotAim[s].body = -1;
			slotAim[s].angle = 0;
			slotAim[s].speed = SPEED_MIN;
		}
		refreshRouteBestUi();
	}

	function rememberSlotRouteBest(slot, origin, angleU, speedU) {
		if (!routeRule() || slotIsBot(slot) || replay.on) return;
		const plan = slotPlans[slot];
		if (!plan.ready || plan.origin !== origin || origin < 0) return;
		const best = slotBest[slot];
		if (best.ready && best.origin === origin && best.length >= plan.length) return;
		best.ready = true;
		best.length = plan.length;
		best.origin = origin;
		best.angleU = angleU;
		best.speedU = speedU;
	}

	function rememberRouteBest() {
		if (!aiming && !armed) {
			refreshRouteBestUi();
			return;
		}
		rememberSlotRouteBest(activeSlotIndex(), aimBody,
			GravityGame.angleUnits(aimAngle), GravityGame.speedUnits(aimSpeed));
		refreshRouteBestUi();
	}

	function restoreRouteBest() {
		const best = activeRouteBest();
		if (!routeRule() || !best.ready || playerIsBot() || replay.on) return;
		if (routeOccupiedBy(best.origin) >= 0) return;
		aimBody = best.origin;
		aimAngle = GravityGame.angleOf(best.angleU);
		aimSpeed = GravityGame.speedOf(best.speedU);
		aiming = false;
		armed = true;
		pressing = false;
		savedArmed = false;
		placeGripFromSpeed();
		dirty = true;
		hudAt = -Infinity;
	}

	function setSlotRouteShot(slot, origin, angle, speed) {
		const shots = slotShots(slot);
		const angleU = GravityGame.angleUnits(angle);
		const speedU = GravityGame.speedUnits(speed);
		if (shots.length === 0) {
			shots.push(GravityGame.createShot(mode, origin, angleU, speedU, NO_ABORT));
			return;
		}
		const shot = shots[0];
		shot.src = mode;
		shot.origin = origin;
		shot.angle = angleU;
		shot.speed = speedU;
		shot.abort = NO_ABORT;
		shots.length = 1;
	}

	function syncSlotRouteFromSim(slot, origin) {
		const sim = slotSim(slot);
		const plan = slotPlans[slot];
		plan.origin = origin;
		const finished = !sim.routeActive && sim.predCount >= 2 &&
			(sim.predReason === END_IMPACT || sim.predReason === END_EXIT);
		plan.ready = finished;
		plan.length = finished ? sim.predLength : 0;
		plan.steps = finished ? sim.predSteps : 0;
		plan.visits = finished ? sim.predVisits : 0;
		plan.reason = sim.predReason;
		plan.body = sim.predBody;
		if (slot === 0) {
			game.length = plan.length;
			game.steps = plan.steps;
			return;
		}
		const r = bot.rivals[slot - 1];
		r.routeOrigin = origin;
		r.routeReady = plan.ready;
		r.routeLength = plan.length;
		r.routeSteps = plan.steps;
		r.routeVisits = plan.visits;
		r.routeReason = plan.reason;
		r.routeBody = plan.body;
		r.length = plan.length;
		r.steps = plan.steps;
	}

	/* A route entry exists while it is being planned; it scores only when the
	 * sliced trace has reached a landing or the edge of the map. */
	function syncRoutePlan() {
		if (!routeRule()) return;
		if (slotIsBot(0) && !replay.on) {
			const actor = bot.player;
			routePlan.ready = actor.routeReady;
			routePlan.length = actor.routeReady ? actor.routeLength : 0;
			routePlan.steps = actor.routeSteps;
			routePlan.visits = actor.routeVisits;
			routePlan.reason = actor.routeReason;
			routePlan.body = actor.routeBody;
			routePlan.origin = actor.routeOrigin;
			game.length = routePlan.length;
			game.steps = routePlan.steps;
			if (actor.routeReady) {
				setSlotRouteShot(0, actor.routeOrigin,
					GravityGame.angleOf(actor.routeAngleU),
					GravityGame.speedOf(actor.routeSpeedU));
			} else game.shots.length = 0;
		}
		const slot = activeSlotIndex();
		if ((!slotIsBot(slot) || replay.on) && (aiming || armed || replay.on)) {
			if (aimBody >= 0) setSlotRouteShot(slot, aimBody, aimAngle, aimSpeed);
			syncSlotRouteFromSim(slot, aimBody);
		}
		refreshRouteLeader();
		refreshRouteBestUi();
	}

	function refreshRouteLeader() {
		routeLeader = -2;
		if (!routeRule()) return;
		let best = -1;
		let tie = false;
		if (routePlan.ready) {
			best = routePlan.length;
			routeLeader = -1;
		}
		for (let i = 0; i < bot.count; i++) {
			const actor = bot.rivals[i];
			if (!actor.routeReady) continue;
			if (actor.routeLength > best + 0.5) {
				best = actor.routeLength;
				routeLeader = i;
				tie = false;
			} else if (best >= 0 && Math.abs(actor.routeLength - best) <= 0.5) {
				tie = true;
			}
		}
		if (tie) routeLeader = -2;
	}

	function syncPlayerBotAim() {
		if (!routeRule() || !slotIsBot(0) || activeSlotIndex() !== 0) return;
		const actor = bot.player;
		if (!actor.routeReady || actor.routeVersion === routeBotVersion) return;
		routeBotVersion = actor.routeVersion;
		aimBody = actor.routeOrigin;
		aimAngle = GravityGame.angleOf(actor.routeAngleU);
		aimSpeed = GravityGame.speedOf(actor.routeSpeedU);
		armed = true;
		aiming = false;
		placeGripFromSpeed();
		dirty = true;
		hudAt = -Infinity;
	}

	function clearRoutePlan() {
		if (!routeRule() || playerIsBot() || replay.on) return;
		cancelAim();
		activeSim().predCount = 0;
		refreshRouteLeader();
		hudAt = -Infinity;
	}

	/*
	 * Route mode traces a shot to its end over several frames. The job survives
	 * field ticks (it is a snapshot), so it is restarted only by an aim edit or
	 * when the world has moved on enough for the snapshot to be misleading.
	 */
	function aimTraceStale(bodiesMoved) {
		if (!bodiesMoved) return false;
		if (!routeRule()) return true;
		const sim = activeSim();
		return !sim.routeActive &&
			Math.abs(sim.fieldT - sim.routeT0) > ROUTE_FIELD_DELTA;
	}

	function startAimTrace(budgetMs) {
		const sim = activeSim();
		if (routeRule()) {
			sim.routeBegin(aimBody, aimAngle, aimSpeed, ruleSpec().horizon);
			if (!replay.on) sim.routeStep(ROUTE_STEP_MS);
		} else sim.predict(aimBody, aimAngle, aimSpeed, budgetMs);
		refreshPredGain();
		syncRoutePlan();
		rememberRouteBest();
	}

	/* a launch—and a copied route plan—always sees a finished path */
	function predictShot() {
		const sim = activeSim();
		if (routeRule()) {
			sim.predictFull(aimBody, aimAngle, aimSpeed, ruleSpec().horizon);
		} else sim.predict(aimBody, aimAngle, aimSpeed);
		refreshPredGain();
		syncRoutePlan();
		rememberRouteBest();
	}

	function slotGoalDone(slot) {
		if (routeRule()) return false;
		const spec = ruleSpec();
		const sim = slotSim(slot);
		if (slot === 0) {
			if (spec.stopOnTour && game.doneSteps >= 0) return true;
			return spec.maxShots > 0 && game.shots.length >= spec.maxShots &&
				sim.status !== STATUS_FLYING;
		}
		const r = bot.rivals[slot - 1];
		if (spec.stopOnTour && r.doneSteps >= 0) return true;
		return spec.maxShots > 0 && r.shots.length >= spec.maxShots &&
			sim.status !== STATUS_FLYING;
	}

	function slotFlownDone(slot) {
		if (routeRule()) return false;
		return slotGoalDone(slot) || slotBroke(slot);
	}

	function playerGoalDone() {
		return slotGoalDone(activeSlotIndex());
	}

	function hasLiveUser() {
		const count = slotCount();
		for (let s = 0; s < count; s++) {
			if (!slotIsBot(s) && !slotFlownDone(s)) return true;
		}
		return false;
	}

	function rivalFlying(wantBot) {
		for (let i = 0; i < bot.count; i++) {
			if (bot.isRivalBot(i) === wantBot && bot.rivals[i].sim.status === STATUS_FLYING) return true;
		}
		return false;
	}

	/* A human flight always drives the clock, even after its run was decided
	 * mid-air (26th system, purse below the fee), so it still reaches its end.
	 * Bot flights drive it only once no human can still act. */
	function clockDriverFlying() {
		const slot0Flying = gravity.status === STATUS_FLYING;
		if (replay.on) return slot0Flying;
		/* career rivals fly on the same clock, so their flights drive it too */
		if (careerRule() && rivalFlying(true)) return true;
		if (slot0Flying && !slotIsBot(0)) return true;
		if (rivalFlying(false)) return true;
		if (hasLiveUser()) return false;
		if (slot0Flying) return true;
		return slotFlownDone(0) && rivalFlying(true);
	}

	function runOver() {
		if (routeRule()) return false;
		if (!game.on || replay.on || clockDriverFlying()) return false;
		return !hasLiveUser() && slotFlownDone(0);
	}

	/* Manual aim closes during a flight/replay, when a bot controls the active
	 * slot, and in the flown rules after the goal is met or purse cannot launch. */
	function gameLocked() {
		if (!game.on) return false;
		if (careerWaitBusy()) return true;
		const slot = activeSlotIndex();
		const sim = slotSim(slot);
		if (replay.on || sim.status === STATUS_FLYING || slotIsBot(slot)) return true;
		if (routeRule()) return false;
		return slotFlownDone(slot);
	}

	function flownRunLocked() {
		return game.on && !routeRule() && slotFlownDone(activeSlotIndex());
	}

	function gameSteps() {
		return gravity.status === STATUS_FLYING ? game.steps + gravity.liveSteps : game.steps;
	}

	function scoreSteps() {
		if (routeRule()) return routePlan.steps;
		return ruleSpec().stopOnTour && game.doneSteps >= 0 ? game.doneSteps : gameSteps();
	}

	/* --- planet universe ------------------------------------------------- */

	const MAX_PLAYERS = scoreRowEls.length;

	function planetUniverseDefault(rule) {
		return rule === RULE_CAREER ? PLANET_CAREER_DEFAULT : PLANET_DEFAULT;
	}

	/* a uniform draw over the run's in-play planets */
	function randomActivePlanet() {
		let pick = Math.floor(Math.random() * planetCount);
		for (let i = 0; i < PLANET_UNIVERSE_MAX; i++) {
			if (!planetMask[i]) continue;
			if (pick === 0) return i;
			pick -= 1;
		}
		return -1;
	}

	function initPlanetUniverse(n) {
		const count = Math.max(PLANET_UNIVERSE_MIN, Math.min(n, PLANET_UNIVERSE_MAX));
		planetMask.fill(0);
		for (let i = 0; i < count; i++) planetMask[i] = 1;
		planetCount = count;
	}

	/* inactive planets carry no gravity: the field and every bot sim skip them */
	function syncPlanetStrengths() {
		for (let i = 0; i < PLANET_UNIVERSE_MAX; i++) {
			planetStrength[i] = planetMask[i] ? planetBaseStrength[i] : 0;
		}
		bot.strength.set(planetStrength);
	}

	/* push the current subset into the career, market, field, scene and bot */
	function applyPlanetUniverse() {
		GravityGame.setCareerUniverse(game.career, planetMask, planetCount);
		GravityGame.applyMarketUniverse(game.market, planetMask, planetCount);
		gravity.setPlanetMask(planetMask);
		helperProbe.setPlanetMask(planetMask);
		if (scene.setPlanetMask) scene.setPlanetMask(planetMask);
		if (bot.setPlanetMask) bot.setPlanetMask(planetMask, planetCount);
		syncPlanetStrengths();
		applyMode();
		refreshPlanetUniverseUi();
	}

	/* every planet a player calls home, or the ship currently sits on, is kept */
	function isProtectedPlanet(planet) {
		if (game.career.hq === planet || game.career.at === planet) return true;
		if (gravity.landedBody === planet) return true;
		const galaxy = game.galaxy;
		if (!galaxy) return false;
		for (let i = 0; i < galaxy.actors.length; i++) {
			const actor = galaxy.actors[i];
			if (actor.hq === planet || actor.at === planet) return true;
		}
		return false;
	}

	/* a removed planet loses its pads (no refund) so re-adding it starts fresh */
	function clearPlanetPads(planet) {
		const actors = game.galaxy ? game.galaxy.actors : [game.career];
		for (let i = 0; i < actors.length; i++) {
			const career = actors[i];
			const pad = career.pads[planet];
			if (!pad) continue;
			if (pad.catapult !== null) {
				career.padCount = career.padCount > 0 ? career.padCount - 1 : 0;
			}
			pad.catapult = null;
			pad.panel = null;
			pad.battery = null;
			pad.chargeKwh = 0;
			pad.reservedKwh = 0;
		}
		if (game.career.commercialPlanet === planet) game.career.commercialPlanet = -1;
		if (game.galaxy) GravityGame.refreshNetwork(game.galaxy);
	}

	/* grow or shrink the active subset by the requested amount, one random
	 * planet per step, refusing to touch a protected planet */
	function setPlanetUniverseSize(next) {
		const count = Math.max(PLANET_UNIVERSE_MIN, Math.min(next, PLANET_UNIVERSE_MAX));
		if (count === planetCount) return false;
		if (count > planetCount) {
			const need = count - planetCount;
			const free = [];
			for (let i = 0; i < PLANET_UNIVERSE_MAX; i++) {
				if (!planetMask[i]) free.push(i);
			}
			if (free.length < need) return false;
			for (let k = 0; k < need; k++) {
				const j = k + Math.floor(Math.random() * (free.length - k));
				const swap = free[k];
				free[k] = free[j];
				free[j] = swap;
				planetMask[free[k]] = 1;
			}
		} else {
			const need = planetCount - count;
			const removable = [];
			for (let i = 0; i < PLANET_UNIVERSE_MAX; i++) {
				if (!planetMask[i]) continue;
				if (isProtectedPlanet(i)) continue;
				removable.push(i);
			}
			if (removable.length < need) return false;
			for (let k = 0; k < need; k++) {
				const j = k + Math.floor(Math.random() * (removable.length - k));
				const swap = removable[k];
				removable[k] = removable[j];
				removable[j] = swap;
				const pick = removable[k];
				planetMask[pick] = 0;
				clearPlanetPads(pick);
			}
		}
		planetCount = count;
		game.planetUniverse = count;
		applyPlanetUniverse();
		return true;
	}

	/* planets in play that no actor calls home — a new player needs one */
	function freePlanetCount() {
		const galaxy = game.galaxy;
		let free = 0;
		for (let i = 0; i < PLANET_UNIVERSE_MAX; i++) {
			if (!planetMask[i]) continue;
			let used = false;
			if (galaxy) {
				for (let a = 0; a < galaxy.actors.length; a++) {
					if (galaxy.actors[a].hq === i) { used = true; break; }
				}
			}
			if (!used) free += 1;
		}
		return free;
	}

	/* Rebuild strengths from the world seed without consuming the trade random stream. */
	function attachWorld() {
		gravity.setPlanets(
			PLANETS,
			tradeSim.planetX, tradeSim.planetY, tradeSim.planetR,
			tradeSim.orbitRX, tradeSim.orbitRY,
			tradeSim.orbitTiltCos, tradeSim.orbitTiltSin
		);
		bot.attachWorld(tradeSim);
		for (let p = 0; p < PLANETS; p++) {
			planetBaseStrength[p] = GravityGame.planetGravity(tradeSim.seed, p);
			portPlanetStrength[p] = planetBaseStrength[p];
		}
		syncPlanetStrengths();
		cancelAim();
		hoverBody = -1;
		hoverPlanet = -1;
		refreshHoverLabel();
		setSelected(-1);
		applyMode();
		if (routeRule()) bot.useField(gravity, mode);
		helperAttachWorld();
		helperUpdateUi();
		applyExperiment();
	}

	function syncModeRadios() {
		const current = game.on ? game.rule : PLAY_LAB;
		for (let i = 0; i < modeEls.length; i++) {
			const el = modeEls[i][1];
			if (el) el.checked = modeEls[i][0] === current;
		}
	}

	function syncBotRadios() {
		if (botOffEl) botOffEl.checked = game.bot === BOT_OFF;
		if (botEasyEl) botEasyEl.checked = game.bot === BOT_EASY;
		if (botNormalEl) botNormalEl.checked = game.bot === BOT_NORMAL;
		if (botHardEl) botHardEl.checked = game.bot === BOT_HARD;
	}

	function syncScoreControls(flightLock) {
		const active = activeSlotIndex();
		for (let s = 0; s < scoreRowEls.length; s++) {
			const row = scoreRowEls[s];
			const box = scoreBotEls[s];
			const isBot = slotTypes[s] === PLAYER_BOT;
			const isUser = !isBot;
			const isActive = isUser && active === s;
			if (box) {
				box.checked = isBot;
				box.disabled = replay.on || careerRule();
			}
			if (!row) continue;
			if (s > 0) row.hidden = s - 1 >= bot.count;
			row.classList.toggle('locked', replay.on);
			row.classList.toggle('isUser', isUser);
			row.classList.toggle('isActive', isActive);
			row.tabIndex = isUser && !flightLock ? 0 : -1;
			row.title = isBot
				? slotName(s) + ' · bot controlled (uncheck bot to play manually)'
				: isActive
				? slotName(s) + ' · active user'
				: 'Click to play as ' + slotName(s);
		}
	}

	/* Keep the address shareable without navigating or overwriting a replay hash. */
	function syncSeedUrl(keepReplay = false) {
		if (loadingUrl) return;
		const params = new URLSearchParams(location.search);
		params.set('seed', String(game.on ? game.seed : tradeSim.seed));
		params.set('mode', game.on ? game.rule : PLAY_LAB);
		params.delete('game');
		params.delete('rule');
		params.delete('source');
		if (mode === MODE_PORTS) params.set('src', 'ports');
		else params.delete('src');
		params.delete('player');
		if (game.on && game.player === PLAYER_BOT) params.set('you', PLAYER_BOT);
		else params.delete('you');
		if (game.on && game.bot !== BOT_NORMAL) params.set('bot', game.bot);
		else params.delete('bot');
		if (game.on && game.cheat) params.set('cheat', game.cheat);
		else params.delete('cheat');
		if (game.on && game.fixedRate) {
			params.set('rate', String(scene.trade.speed));
			params.delete('speed');
		} else {
			params.delete('rate');
			if (scene.trade.speed !== 0.5) params.set('speed', String(scene.trade.speed));
			else params.delete('speed');
		}
		if (!keepReplay) {
			params.delete('shots');
			params.delete('end');
			params.delete('len');
		}
		const hash = keepReplay || !GravityGame.isGameLink(location.hash) ? location.hash : '';
		const base = location.href.split('#')[0].split('?')[0];
		try { root.history.replaceState(null, '', base + '?' + params.toString() + hash); }
		catch (e) { /* Some file:// viewers do not permit history updates. */ }
	}

	function startGame(seed, fixedRate, rule, botLevel, playerType, cheat) {
		const wasCareer = careerRule();
		cancelCareerWait();
		stopReplay();
		linkNote = '';
		game.on = true;
		game.seed = seed;
		game.fixedRate = fixedRate;
		if (rule) game.rule = rule;
		game.cheat = game.rule === RULE_CAREER && GravityGame.CHEATS[cheat] ? cheat : null;
		if (careerRule() !== wasCareer) resetPlayback();
		else if (playIndex > playMaxIndex()) {
			playIndex = playMaxIndex();
			refreshPlaybackUi();
		}
		if (botLevel) game.bot = botLevel;
		/* 0 means "follow the difficulty level's rival count" */
		if (game.playerCount > 0) game.playerCount = Math.max(1, Math.min(MAX_PLAYERS, game.playerCount));
		/* a human-only rule (career) is flown by hand; its rival setting picks
		 * how many rival career players share the map instead */
		if (RULES[game.rule].humanOnly) playerType = PLAYER_USER;
		if (playerType) {
			game.player = playerType;
			slotTypes[0] = playerType;
		} else {
			game.player = slotTypes[0];
		}
		rivalTypesArg[0] = slotTypes[1];
		rivalTypesArg[1] = slotTypes[2];
		syncModeRadios();
		syncBotRadios();
		updateHelp(game.rule);
		game.shots.length = 0;
		game.steps = 0;
		game.clockSteps = 0;
		game.length = 0;
		game.doneSteps = -1;
		resetRoutePlan();
		resetAllRouteBest();
		if (helperState.active) helperStop();
		playerBotSyncNeeded = true;
		predGain = 0;
		GravityGame.resetMarket(game.market);
		GravityGame.resetLedger(game.money);
		scene.reset(seed);
		scene.setGameClock(true);
		clearCargo();
		gravity.fieldT = tradeSim.t;
		gravity.fieldRate = scene.trade.speed;
		bot.reset(seed, game.rule, game.bot, game.player, rivalTypesArg,
			game.playerCount > 0 ? game.playerCount - 1 : undefined);
		initPlanetUniverse(game.planetUniverse > 0 ? game.planetUniverse : planetUniverseDefault(game.rule));
		applyPlanetUniverse();
		ensureValidActiveSlot(-1);
		attachWorld();
		if (careerRule()) startCareerRun(seed);
		else {
			careerPaused = false;
			if (scene.setFrozen) scene.setFrozen(false);
			gravity.setLaunchNetwork(null, null);
		}
		careerFollow = true;
		careerNotice('');
		if (routeRule()) bot.useField(gravity, mode);
		launchState = -1;
		gameLinkEl.hidden = true;
		hideBotLog();
		refreshGameUi();
		syncSeedUrl();
	}

	/* one galaxy per career run: YOU join first, then every rival career, so pads
	 * and usage tax are shared ground from the first launch */
	function startCareerRun(seed) {
		cancelTurret();
		GravityGame.resetGalaxy(game.galaxy, seed);
		GravityGame.startCareer(game.career, gravity, seed, tradeSim, game.cheat, game.galaxy);
		const hq = game.career.hq;
		planetBaseStrength[hq] = 1;
		portPlanetStrength[hq] = 1;
		syncPlanetStrengths();
		if (mode === MODE_PORTS) gravity.refreshField();
		syncPlanetGravity();
		bot.startCareers(game.galaxy, seed, tradeSim);
		bot.setPlanetMask(planetMask, planetCount);
		game.career.forceScale = gravity.forceScale;
		/* the ship starts landed on HQ: the landing pause applies from turn one */
		careerPaused = pauseOnLanding;
		if (careerPaused) careerPauseNow = performance.now();
		if (scene.setFrozen) scene.setFrozen(careerPaused);
		refreshCareerClockUi();
	}

	/* one flat row: lab stops the run, every other mode starts its rule at once */
	function setPlayMode(next) {
		if (next === PLAY_LAB) {
			if (game.on) stopGame();
			saveLastMode(PLAY_LAB);
			updateRuleHelp(PLAY_LAB);
			syncModeRadios();
			return;
		}
		if (!RULES[next]) {
			syncModeRadios();
			return;
		}
		if (game.on && game.rule === next) {
			updateRuleHelp(next);
			return;
		}
		saveLastMode(next);
		updateRuleHelp(next);
		startGame(game.on ? game.seed : tradeSim.seed, game.on ? game.fixedRate : false, next);
	}

	function setBot(next) {
		if (next === game.bot) return;
		startGame(game.seed, game.fixedRate, game.rule, next, game.player, game.cheat);
	}

	/* the scoreboard +/- sets how many players share the run; a human-only rule
	 * keeps YOU human and the rest are rival careers. 0 means the difficulty
	 * level picks the rival count */
	function playerCountShown() {
		return game.playerCount > 0 ? game.playerCount : 1 + bot.count;
	}

	function setPlayerCount(delta) {
		const current = playerCountShown();
		const count = Math.max(1, Math.min(MAX_PLAYERS, current + delta));
		if (count === current) return;
		if (delta > 0) {
			/* a new player needs a planet to call home; if the universe is
			 * full of HQs, grow it so the increase can proceed */
			while (freePlanetCount() < 1 && planetCount < PLANET_UNIVERSE_MAX) {
				if (!setPlanetUniverseSize(planetCount + 1)) break;
			}
		}
		game.playerCount = count;
		if (game.on) startGame(game.seed, game.fixedRate, game.rule, game.bot, game.player, game.cheat);
		else {
			syncScoreControls(false);
			refreshPlanetUniverseUi();
		}
	}

	/* the planet-count input and the player +/- reflect the live state */
	function refreshPlanetUniverseUi() {
		if (planetCountInputEl) {
			if (document.activeElement !== planetCountInputEl) {
				planetCountInputEl.value = planetCount;
			}
			planetCountInputEl.min = PLANET_UNIVERSE_MIN;
			planetCountInputEl.max = PLANET_UNIVERSE_MAX;
		}
		const shown = playerCountShown();
		if (playerCountValueEl) playerCountValueEl.textContent = shown;
		if (playerCountDownEl) playerCountDownEl.disabled = shown <= 1;
		if (playerCountUpEl) playerCountUpEl.disabled = shown >= MAX_PLAYERS;
	}

	function setSlotType(slot, next) {
		if (slot < 0 || slot >= slotTypes.length) return;
		const normalized = next === PLAYER_BOT ? PLAYER_BOT : PLAYER_USER;
		if (slotTypes[slot] === normalized && (slot !== 0 || game.player === normalized)) return;
		slotTypes[slot] = normalized;
		if (slot === 0) game.player = normalized;
		ensureValidActiveSlot(normalized === PLAYER_USER ? slot : -1);
		if (game.on) startGame(game.seed, game.fixedRate, game.rule, game.bot, slotTypes[0], game.cheat);
		else syncScoreControls(false);
	}

	function selectUserSlot(slot) {
		if (!game.on || replay.on) return;
		if (slot < 0 || slot >= slotCount() || slotIsBot(slot)) return;
		if (slot === activeSlot) return;
		if (clockDriverFlying()) return;
		const prev = activeSlot;
		slotAim[prev].armed = armed;
		slotAim[prev].body = aimBody;
		slotAim[prev].angle = aimAngle;
		slotAim[prev].speed = aimSpeed;
		aiming = false;
		pressing = false;
		savedArmed = false;
		blockedPlanet = -1;
		blockedKind = 0;
		blockedBy = -1;
		activeSlot = slot;
		const nextAim = slotAim[slot];
		armed = nextAim.armed;
		aimBody = nextAim.body;
		aimAngle = nextAim.angle;
		aimSpeed = nextAim.speed;
		if (armed && aimBody >= 0) {
			placeGripFromSpeed();
			if (activeSim().predCount < 2) dirty = true;
		} else {
			refreshAimLabel();
		}
		refreshPredGain();
		launchState = -1;
		refreshGameUi();
	}

	/* back to lab: the world stays, the clock returns to real time, a running flight continues */
	function stopGame() {
		const wasCareer = careerRule();
		cancelCareerWait();
		stopReplay();
		cancelTurret();
		careerPaused = false;
		if (scene.setFrozen) scene.setFrozen(false);
		clearBurnAim();
		linkNote = '';
		game.on = false;
		activeSlot = 0;
		predGain = 0;
		if (wasCareer) resetPlayback();
		else refreshPlaybackUi();
		gravity.setLaunchNetwork(null, null);
		resetAllRouteBest();
		updateRuleHelp(selectedHelpRule());
		scene.setGameClock(false);
		gravity.stepLimit = Infinity;
		gravity.limitReason = END_TIME;
		launchState = -1;
		gameLinkEl.hidden = true;
		hideBotLog();
		refreshSelected();
		refreshGameUi();
		syncSeedUrl();
	}

	function launchPlayerBotIfReady(budgetMs, force) {
		if (!slotIsBot(0) || gravity.status === STATUS_FLYING || slotFlownDone(0)) return true;
		if (playerBotSyncNeeded) {
			bot.syncPlayer(gravity, game.money, game.shots.length,
				game.steps, game.length, game.doneSteps, game.clockSteps);
			playerBotSyncNeeded = false;
		}
		while (true) {
			const ready = bot.tickPlayer(game.clockSteps, game.market, force ? 1e9 : budgetMs);
			if (!ready) {
				if (!force) return false;
				continue;
			}
			break;
		}
		if (!bot.playerPlanValid(game.clockSteps, game.market)) return true;
		const origin = bot.player.planOrigin;
		const angle = GravityGame.angleOf(bot.player.planAngleU);
		const speed = GravityGame.speedOf(bot.player.planSpeedU);
		if (activeSlotIndex() === 0) {
			aimBody = origin;
			aimAngle = angle;
			aimSpeed = speed;
			placeGripFromSpeed();
			armed = true;
			fire(NO_ABORT);
			return true;
		}
		gravity.fieldT = tradeSim.t;
		gravity.fieldRate = scene.trade.speed;
		gravity.stepLimit = ruleSpec().capSteps;
		gravity.limitReason = END_TIME;
		game.shots.push(GravityGame.createShot(MODE_PLANETS, origin,
			bot.player.planAngleU, bot.player.planSpeedU, NO_ABORT));
		gravity.predict(origin, angle, speed);
		gravity.launch(origin, angle, speed);
		GravityGame.beginFlight(game.money, gravity);
		refreshGameUi();
		return true;
	}

	/*
	 * Playback scales the wall-clock slice fed to the fixed-step physics. Player
	 * and rivals step in exact integer DT lockstep against the shared planet
	 * market; if a rival is searching its next shot, clockSteps pauses for a few
	 * 3 ms slices and resumes from the exact same step.
	 */
	function stepGame(now, dt) {
		if (routeRule()) {
			playAcc = 0;
			if (replay.on) {
				if (!gravity.routeActive && gravity.predCount >= 2) finishRouteReplay();
				return;
			}
			bot.tickRoute(BOT_STEP_MS);
			const count = slotCount();
			const active = activeSlotIndex();
			for (let s = 0; s < count; s++) {
				if (s === active || slotIsBot(s)) continue;
				const bgSim = slotSim(s);
				if (!bgSim.routeActive) continue;
				bgSim.routeStep(2);
				syncSlotRouteFromSim(s, slotAim[s].body);
				if (!bgSim.routeActive) {
					rememberSlotRouteBest(s, slotAim[s].body,
						GravityGame.angleUnits(slotAim[s].angle),
						GravityGame.speedUnits(slotAim[s].speed));
				}
			}
			syncPlayerBotAim();
			syncRoutePlan();
			return;
		}
		if (replay.on && replay.phase !== PHASE_FLY && now >= replay.until) advanceReplay(now);
		/* a queued career launch fires once the in-game clock reaches the step
		 * where the EMC barrel lines up with the aim; the world clock keeps
		 * running through the wind-up (pausing it would stop the barrel) */
		if (turret.pending) tickTurret();
		/* the eased career wait owns the world clock for its 2 s */
		if (careerWaitBusy()) {
			playAcc = 0;
			return;
		}
		/* a paused career clock freezes everyone — rival companies included —
		 * so the player can aim while nothing on the shared map changes */
		if (careerRule() && careerPaused && !replay.on) {
			playAcc = 0;
			return;
		}
		const capSteps = ruleSpec().capSteps;
		/* in career the clock also runs between flights while unpaused: pads
		 * charge, visit profits grow and the rival companies fly their turns */
		const careerIdle = careerRule() && !replay.on && !careerPaused &&
			game.career.ended === GravityGame.CAREER_OPEN && !clockDriverFlying();
		if (!clockDriverFlying() && !careerIdle) {
			playAcc = 0;
			if (replay.on) return;
			if (!hasLiveUser()) {
				if (slotIsBot(0) && !slotFlownDone(0)) {
					launchPlayerBotIfReady(BOT_STEP_MS, false);
				} else if (bot.count > 0) {
					bot.prepareStep(game.clockSteps, game.market, capSteps, BOT_STEP_MS, false);
				}
				return;
			}
			bot.tickIdle(game.clockSteps, game.market, BOT_STEP_MS);
			if (slotIsBot(0) && !slotFlownDone(0)) {
				if (playerBotSyncNeeded) {
					bot.syncPlayer(gravity, game.money, game.shots.length,
						game.steps, game.length, game.doneSteps, game.clockSteps);
					playerBotSyncNeeded = false;
				}
				bot.tickPlayer(game.clockSteps, game.market, BOT_STEP_MS);
			}
			return;
		}
		if (burnPaused || burnAiming) {
			playAcc = 0;
			return;
		}
		let scale = playScale() * (replay.on ? REPLAY_SPEEDS[replay.speed] : 1);
		if (scale > PLAY_MAX) scale = PLAY_MAX;
		playAcc += dt * scale;
		if (playAcc > PLAY_MAX * 0.1) playAcc = PLAY_MAX * 0.1;
		let wasSlot0Flying = gravity.status === STATUS_FLYING;
		let wasUserRivalMask = 0;
		for (let i = 0; i < bot.count; i++) {
			if (!bot.isRivalBot(i) && bot.rivals[i].sim.status === STATUS_FLYING) {
				wasUserRivalMask |= 1 << i;
			}
		}
		let stepsDone = 0;
		while ((clockDriverFlying() || careerIdle) && playAcc >= DT && stepsDone < MAX_GAME_STEPS) {
			/* never step past the aligned barrel: the queued shot fires first */
			if (turret.pending && game.clockSteps >= turret.fireAt) break;
			if (!bot.prepareStep(game.clockSteps, game.market, capSteps, BOT_STEP_MS, false)) {
				playAcc = 0;
				break;
			}
			if (!replay.on && !launchPlayerBotIfReady(BOT_STEP_MS, false)) {
				playAcc = 0;
				break;
			}
			if (gravity.status === STATUS_FLYING) wasSlot0Flying = true;
			advanceGameOneStep();
			playAcc -= DT;
			stepsDone += 1;
		}
		/* the clock reached the aligned step: the queued shot leaves now */
		if (turret.pending) tickTurret();
		let fieldMoved = false;
		if (wasSlot0Flying || gravity.status === STATUS_FLYING) {
			tradeSim.advanceTo(gravity.flightFieldT);
			fieldMoved = true;
		} else {
			for (let i = 0; i < bot.count; i++) {
				const rSim = bot.rivals[i].sim;
				if ((wasUserRivalMask & (1 << i)) || rSim.status === STATUS_FLYING) {
					tradeSim.advanceTo(rSim.flightFieldT);
					fieldMoved = true;
					break;
				}
			}
		}
		/* career steps without a driving human flight (idle clock, or only
		 * rival companies airborne) still move the trade world the same span */
		if (!fieldMoved && careerRule() && stepsDone > 0) {
			tradeSim.advanceTo(tradeSim.t + stepsDone * DT * scene.trade.speed);
		}
		if (wasSlot0Flying && gravity.status !== STATUS_FLYING) {
			if (!clockDriverFlying()) playAcc = 0;
			endGameFlight();
		}
		for (let i = 0; i < bot.count; i++) {
			if ((wasUserRivalMask & (1 << i)) && bot.rivals[i].sim.status !== STATUS_FLYING) {
				if (!clockDriverFlying()) playAcc = 0;
				endUserRivalFlight(i);
			}
		}
	}

	function applyReplayBurns() {
		const rShot = replay.activeShot;
		if (!rShot || !rShot.burns) return;
		while (replay.burnIndex < rShot.burns.length &&
			rShot.burns[replay.burnIndex].step === gravity.liveSteps) {
			const b = rShot.burns[replay.burnIndex++];
			const angle = GravityGame.angleOf(b.angle);
			const dv = GravityGame.speedOf(b.dv);
			const ok = careerRule()
				? GravityGame.careerBurn(game.career, gravity, angle, dv)
				: gravity.burn(angle, dv);
			if (!ok) continue;
			if (game.shots.length > 0) {
				game.shots[game.shots.length - 1].burns.push(
					GravityGame.createBurn(b.step, b.angle, b.dv));
			}
			dirty = true;
		}
	}

	function advanceGameOneStep() {
		let endedLimit = false;
		if (gravity.status === STATUS_FLYING && gravity.liveSteps >= gravity.stepLimit) {
			gravity.stepOne();
			endedLimit = true;
		}
		for (let i = 0; i < bot.count; i++) {
			const r = bot.rivals[i];
			if (bot.isRivalBot(i) || r.sim.status !== STATUS_FLYING) continue;
			if (r.sim.liveSteps < r.sim.stepLimit) continue;
			r.sim.stepOne();
			GravityGame.endFlight(r.ledger);
			if (r.sim.endReason === END_IMPACT && r.sim.endBody >= 0) {
				r.basePlanet = r.sim.endBody;
			}
			r.steps += r.sim.liveSteps;
			r.length += r.sim.flightLength;
			endedLimit = true;
		}
		if (endedLimit && (!clockDriverFlying() ||
			(gravity.status !== STATUS_FLYING &&
				slotTypes[1] === PLAYER_BOT && slotTypes[2] === PLAYER_BOT))) {
			return;
		}
		if (replay.on && gravity.status === STATUS_FLYING) applyReplayBurns();
		game.clockSteps += 1;
		if (careerRule()) GravityGame.careerAdvance(game.career, scene.trade.speed, 1);
		if (gravity.status === STATUS_FLYING) {
			gravity.stepOne();
			GravityGame.stepHarvest(game.money, game.market, gravity, game.clockSteps);
			if (ruleSpec().stopOnTour && gravity.visitedCount === planetCount && game.doneSteps < 0) {
				game.doneSteps = game.steps + gravity.visitStep;
			}
		}
		if (careerRule()) bot.stepCareer(game.clockSteps, game.market, tradeSim, scene.trade.speed);
		else bot.stepOne(game.clockSteps, game.market);
	}

	function settleBotsWhenUsersDone() {
		if (hasLiveUser() || replay.on) return;
		const spec = ruleSpec();
		if (slotIsBot(0) && !slotFlownDone(0)) return;
		if (bot.count > 0) {
			game.clockSteps = bot.settle(game.clockSteps, game.market, spec.capSteps);
		}
	}

	function endGameFlight() {
		clearBurnAim();
		const spec = ruleSpec();
		if (spec.stopOnTour && gravity.visitedCount === planetCount && game.doneSteps < 0) {
			game.doneSteps = game.steps + gravity.visitStep;
		}
		if (careerRule()) {
			const career = game.career;
			const delivered = career.delivered;
			const competitions = career.competitions;
			GravityGame.careerEndFlight(career, gravity, tradeSim, game.clockSteps);
			if (career.delivered > delivered) careerPhoto('delivery');
			else if (career.competitions > competitions) careerPhoto('sport');
			/* the shop follows the ship again after every landing / stranding */
			careerFollow = true;
			/* default: freeze the world clock at flight end (rivals too) so
			 * the next shot can be aimed in peace; the setting can turn it off */
			if (pauseOnLanding && !replay.on) setCareerPaused(true);
		} else GravityGame.endFlight(game.money);
		game.steps += gravity.liveSteps;
		game.length += gravity.flightLength;
		playerBotSyncNeeded = true;
		const settleRivals = !hasLiveUser() &&
			((slotBroke(0) && !(spec.stopOnTour && game.doneSteps >= 0)) ||
				(spec.maxShots > 0 && game.shots.length >= spec.maxShots));
		if (settleRivals && bot.count > 0) {
			game.clockSteps = bot.settle(game.clockSteps, game.market, spec.capSteps);
		}
		if (replay.on) {
			replay.activeShot = null;
			replay.burnIndex = 0;
			replay.phase = PHASE_GAP;
			replay.until = performance.now() + REPLAY_GAP_MS / REPLAY_SPEEDS[replay.speed];
		}
		moneyToastFor(0, gravity, game.money, game.shots.length);
		refreshGameUi();
	}

	function endUserRivalFlight(rIdx) {
		const r = bot.rivals[rIdx];
		settleBotsWhenUsersDone();
		moneyToastFor(rIdx + 1, r.sim, r.ledger, r.shots.length);
		refreshGameUi();
	}

	function signedMoney(value) {
		return (value < 0 ? '−' : '+') + Math.abs(value).toFixed(2);
	}

	/*
	 * The shot's money as a 2.5 s text card in the postcard slot. A landing
	 * card arriving this frame keeps its moment; a still-open entry card holds
	 * the slot and the toast follows it (a newer card then drops it).
	 */
	function moneyToastFor(slot, sim, m, shotCount) {
		if (!root.PhotoDeck) return;
		if (slot === 0 && sim.endReason === END_IMPACT && sim.endBody >= 0 &&
			photoLanded[sim.endBody] !== 1) return;
		const parts = [];
		if (m.shotVisits === 1) {
			parts.push('P' + m.lastPlanet + ' +' + m.shotGain.toFixed(2));
		} else if (m.shotVisits > 1) {
			parts.push(m.shotVisits + ' visits +' + m.shotGain.toFixed(2));
		} else {
			parts.push('no harvest');
		}
		if (careerRule()) {
			const career = game.career;
			if (career.lastFee > 0) parts.push('EMC fee −' + career.lastFee.toFixed(2));
			else parts.push('pad −' + career.lastEnergy.toFixed(2) + ' kWh');
			if (career.lastFuel > 0) parts.push('fuel −' + career.lastFuel.toFixed(1) + ' kg');
			if (career.lastReward > 0) parts.push('task +' + career.lastReward.toFixed(2));
		} else {
			parts.push('cost −' + MONEY.cost.toFixed(2));
		}
		parts.push('purse ' + m.purse.toFixed(2));
		const who = slot === 0 ? 'purse' : slotName(slot) + ' purse';
		root.PhotoDeck.toast(who + ' · shot ' + shotCount,
			signedMoney(m.last), parts.join(' · '));
	}

	function startReplay(shots, end, length) {
		sound.reset();
		soundFlightSim = null;
		clearBurnAim();
		replay.on = true;
		replay.shots = shots;
		replay.end = end;
		replay.length = length === undefined ? null : length;
		replay.route = routeRule();
		replay.index = 0;
		replay.speed = REPLAY_DEFAULT;
		replay.verdict = '';
		replay.activeShot = null;
		replay.burnIndex = 0;
		if (replay.route) {
			const shot = shots[0];
			replay.phase = PHASE_AIM;
			replay.until = Infinity;
			setSource(shot.src);
			bot.useField(gravity, mode);
			if (routeOccupiedBy(shot.origin) >= 0) {
				finishRouteReplay('desync · ' + planetName(shot.origin) + ' is occupied');
				return;
			}
			setShotAim(shot);
			armed = true;
			dirty = true;
			refreshGameUi();
			return;
		}
		replay.phase = PHASE_GAP;
		replay.until = performance.now() + REPLAY_GAP_MS;
		refreshGameUi();
	}

	function stopReplay() {
		replay.on = false;
		replay.route = false;
		replay.length = null;
		replay.verdict = '';
		replay.activeShot = null;
		replay.burnIndex = 0;
	}

	function routeVerdictText() {
		if (!routePlan.ready) return 'differs · plan did not land or leave the map';
		const length = Math.round(routePlan.length);
		if (!replay.end) return 'planned ' + length + ' px';
		const lengthOk = replay.length === null || replay.length === length;
		if (lengthOk && replay.end.visited === routePlan.visits &&
			replay.end.steps === routePlan.steps) {
			return 'verified ✓ · ' + length + ' px';
		}
		return 'differs · recorded ' +
			(replay.length === null ? '—' : replay.length + ' px') + ' · ' +
			(replay.end.steps * DT).toFixed(2) + ' s';
	}

	function finishRouteReplay(problem) {
		if (!problem) {
			syncRoutePlan();
			if (routePlan.ready) {
				bot.seedPlayerRoutePlan(replay.shots[0], routePlan.length,
					routePlan.steps, routePlan.visits, routePlan.reason, routePlan.body);
				routeBotVersion = bot.player.routeVersion;
			}
		}
		replay.on = false;
		replay.verdict = problem || routeVerdictText();
		armed = !problem;
		refreshGameUi();
	}

	/* gap → aim the next shot (or finish) → fire; a flight hands back through endGameFlight */
	function advanceReplay(now) {
		if (replay.phase === PHASE_AIM) {
			const shot = replay.shots[replay.index++];
			replay.activeShot = shot;
			replay.burnIndex = 0;
			setShotAim(shot);
			replay.phase = PHASE_FLY;
			fire(shot.abort);
			return;
		}
		if (replay.index >= replay.shots.length) {
			finishReplay('');
			return;
		}
		aimReplayShot(replay.shots[replay.index], now);
	}

	function aimReplayShot(shot, now) {
		setSource(shot.src);
		if (!gravity.canLaunchFrom(shot.origin)) {
			finishReplay('desync · shot ' + (replay.index + 1) + ' from ' + planetName(shot.origin));
			return;
		}
		setShotAim(shot);
		armed = true;
		dirty = true;
		replay.phase = PHASE_AIM;
		replay.until = now + REPLAY_AIM_MS / REPLAY_SPEEDS[replay.speed];
		hudAt = -Infinity;
	}

	function setShotAim(shot) {
		aimBody = shot.origin;
		aimAngle = GravityGame.angleOf(shot.angle);
		aimSpeed = GravityGame.speedOf(shot.speed);
		placeGripFromSpeed();
	}

	function finishReplay(problem) {
		replay.on = false;
		replay.activeShot = null;
		replay.burnIndex = 0;
		replay.verdict = problem || verdictText(replay.end);
		armed = false;
		refreshGameUi();
	}

	function verdictText(end) {
		if (!end) return 'replayed ' + replay.shots.length + ' shots';
		/* the purse is re-derived by the replay itself, not carried by the link */
		if (end.visited === gravity.visitedCount && end.steps === scoreSteps()) {
			return 'verified ✓ · purse ' + game.money.purse.toFixed(2);
		}
		return 'differs · recorded ' + end.visited + ' / ' + PLANETS + ' · ' +
			(end.steps * DT).toFixed(2) + ' s';
	}

	function skipReplay() {
		if (routeRule() && replay.on) {
			predictShot();
			finishRouteReplay();
			return;
		}
		const now = performance.now();
		const capSteps = ruleSpec().capSteps;
		playAcc = 0;
		while (replay.on) {
			if (gravity.status === STATUS_FLYING) {
				while (gravity.status === STATUS_FLYING) {
					bot.prepareStep(game.clockSteps, game.market, capSteps, 1e9, true);
					advanceGameOneStep();
				}
				tradeSim.advanceTo(gravity.flightFieldT);
				endGameFlight();
			} else {
				advanceReplay(now);
			}
		}
	}

	function copyUrlText(url, btn, label) {
		gameLinkEl.value = url;
		const clipboard = navigator.clipboard;
		if (!clipboard) {
			showLink();
			return;
		}
		clipboard.writeText(url).then(() => {
			btn.textContent = 'copied ✓';
			setTimeout(() => {
				btn.textContent = label;
			}, 1600);
		}, showLink);
	}

	function copyLink() {
		if (routeRule() && (armed || aiming)) predictShot();
		const slot = activeSlotIndex();
		if (slot > 0) {
			const hash = bot.rivalLink(game.seed, scene.trade.speed, slot - 1,
				gravityScale, forceScale);
			if (!hash) return;
			copyUrlText(location.href.split('#')[0] + '#' + hash, gameCopyBtn, 'copy replay');
			return;
		}
		const url = location.href.split('#')[0] + '#' + GravityGame.encodeLink({
			seed: game.seed,
			rate: scene.trade.speed,
			rule: game.rule,
			bot: game.bot,
			player: game.player,
			cheat: game.cheat,
			gravityScale: gravityScale,
			forceScale: forceScale,
			harvestTick: harvestTick,
			shots: game.shots,
			visited: routeRule() ? routePlan.visits : gravity.visitedCount,
			steps: scoreSteps(),
			length: routeRule() ? routePlan.length : undefined
		});
		copyUrlText(url, gameCopyBtn, 'copy replay');
	}

	function copyBotLink() {
		if (bot.count === 0) return;
		const rIdx = activeSlotIndex() === 1 && bot.count > 1 ? 1 : 0;
		if (bot.rivals[rIdx].shots.length === 0) return;
		const hash = bot.rivalLink(game.seed, scene.trade.speed, rIdx, gravityScale, forceScale);
		if (!hash) return;
		const url = location.href.split('#')[0] + '#' + hash;
		copyUrlText(url, botCopyBtn, 'copy rival');
	}

	function showLink() {
		gameLinkEl.hidden = false;
		gameLinkEl.focus();
		gameLinkEl.select();
	}

	/* --- rival decisions: a copyable log and a read-only snapshot -------- */

	function botLogHeader() {
		return game.rule + ' · ' + game.bot + ' · ' + bot.count + ' rivals · seed ' +
			game.seed + ' · t+ ' + (game.clockSteps * DT).toFixed(1) +
			' s (step ' + game.clockSteps + ') · ×' + scene.trade.speed +
			' · g ×' + gravityScale.toFixed(2) + ' · force ×' + forceScale.toFixed(2) +
			' · ' + (gravity.fieldStatic ? 'planets · static · lists on' : 'ports · moving · lists off') +
			(careerRule() && careerPaused ? ' · world clock paused' : '');
	}

	function hideBotLog() {
		if (!botLogBoxEl) return;
		botLogBoxEl.hidden = true;
		if (botLogTextEl) botLogTextEl.value = '';
	}

	/* without a clipboard the panel is the copy source: select the whole log */
	function showBotLog() {
		if (!botLogTextEl || !botLogBoxEl) return;
		botLogBoxEl.hidden = false;
		botLogTextEl.focus();
		botLogTextEl.select();
	}

	function copyBotLog() {
		if (!game.on || !botLogBtn || !botLogTextEl || !botLogBoxEl) return;
		const text = bot.decisionLog(game.clockSteps, botLogHeader());
		botLogTextEl.value = text;
		botLogBoxEl.hidden = false;
		if (botLogBoxEl.scrollIntoView) botLogBoxEl.scrollIntoView({ block: 'nearest' });
		const clipboard = navigator.clipboard;
		if (!clipboard) {
			showBotLog();
			return;
		}
		clipboard.writeText(text).then(() => {
			botLogBtn.textContent = 'copied ✓';
			setTimeout(() => { botLogBtn.textContent = 'copy bot log'; }, 1600);
		}, showBotLog);
	}

	function loadLink() {
		if (!GravityGame.isGameLink(location.hash)) return false;
		const link = GravityGame.decodeLink(location.hash);
		if (!link) {
			linkNote = game.on ? 'invalid game link' : 'invalid link · back to lab';
			refreshGameUi();
			return false;
		}
		loadingUrl = true;
		scene.setSpeed(link.rate);
		setExperimentScales(link.gravityScale, link.forceScale, link.harvestTick);
		startGame(link.seed, true, link.rule, link.bot, link.player, link.cheat);
		if (link.shots.length > 0) startReplay(link.shots, link.end, link.length);
		loadingUrl = false;
		syncSeedUrl(true);
		return true;
	}

	function loadSearchParams() {
		const search = location.search || '';
		if (!search || search === '?') return false;
		const params = new URLSearchParams(search);
		const viewParam = params.get('view');
		if (viewParam === VIEW_FIELD || viewParam === VIEW_SPACE) setViewMode(viewParam);
		const hasGameHint = params.has('mode') || params.has('game') || params.has('rule') ||
			params.has('seed') || params.has('rate') || params.has('bot') || params.has('src') ||
			params.has('source') || params.has('player') || params.has('you') || params.has('shots');
		if (!hasGameHint) return false;
		const modeParam = params.get('mode');
		const gameParam = params.get('game');
		const modeRule = modeParam && RULES[modeParam] ? modeParam : null;
		const shouldGame = modeParam === 'game' || gameParam === '1' || modeRule !== null ||
			params.has('rule') || params.has('seed') || params.has('rate') || params.has('bot');
		const seedStr = params.get('seed');
		const seedNum = seedStr !== null ? Number(seedStr) : tradeSim.seed;
		if (seedStr !== null && (!Number.isInteger(seedNum) || seedNum < 1 || seedNum > 0xffffffff)) return false;
		const rateStr = params.get('rate');
		const speedStr = rateStr !== null ? rateStr : params.get('speed');
		const rateNum = speedStr !== null ? Number(speedStr) : scene.trade.speed;
		if (speedStr !== null && (!Number.isFinite(rateNum) || rateNum < 0.5 || rateNum > 12)) return false;
		const sourceStr = params.get('src') || params.get('source');
		if (modeParam === PLAY_LAB) {
			loadingUrl = true;
			stopGame();
			if (seedNum !== tradeSim.seed) {
				scene.reset(seedNum);
				clearCargo();
				attachWorld();
			}
			if (sourceStr === 'ports' || sourceStr === 'port') setSource(MODE_PORTS);
			else if (sourceStr === 'planets' || sourceStr === 'planet') setSource(MODE_PLANETS);
			if (speedStr !== null) scene.setSpeed(rateNum);
			loadingUrl = false;
			syncSeedUrl(true);
			return true;
		}
		if (!shouldGame) return false;
		let ruleStr = params.get('rule');
		const botStr = params.get('bot');
		const playerStr = params.get('player') || params.get('you');
		if (ruleStr !== null && !RULES[ruleStr]) return false;
		if (!ruleStr && modeRule) ruleStr = modeRule;
		if (!ruleStr) ruleStr = RULE_TOUR;
		if (botStr !== null && !(botStr in GravityGame.BOTS)) return false;
		if (playerStr !== null && !(playerStr in GravityGame.PLAYER_TYPES)) return false;
		const cheatStr = params.get('cheat');
		if (cheatStr !== null && !(ruleStr === RULE_CAREER && GravityGame.CHEATS[cheatStr])) return false;
		loadingUrl = true;
		if (speedStr !== null) scene.setSpeed(rateNum);
		startGame(seedNum, rateStr !== null, ruleStr, botStr || undefined, playerStr || undefined,
			cheatStr || undefined);
		if (sourceStr === 'ports' || sourceStr === 'port') setSource(MODE_PORTS);
		else if (sourceStr === 'planets' || sourceStr === 'planet') setSource(MODE_PLANETS);
		const shotsParam = params.get('shots');
		const endParam = params.get('end');
		const lenParam = params.get('len');
		if (shotsParam) {
			const fakeHash = '#game=1&seed=' + seedNum + '&rate=' + rateNum +
				'&rule=' + ruleStr + (botStr ? '&bot=' + botStr : '') +
				'&shots=' + shotsParam + (endParam ? '&end=' + endParam : '') + (lenParam ? '&len=' + lenParam : '');
			const link = GravityGame.decodeLink(fakeHash);
			if (link && link.shots.length > 0) startReplay(link.shots, link.end, link.length);
		}
		loadingUrl = false;
		syncSeedUrl(true);
		return true;
	}

	/* control locks and button states; runs on game state changes, not per frame */
	function refreshGameUi() {
		const route = routeRule();
		const career = careerRule();
		const anyFlying = clockDriverFlying();
		const activeFlying = activeSim().status === STATUS_FLYING;
		const flightLock = game.on && (career
			? activeFlying || turret.pending || replay.on
			: anyFlying || replay.on);
		const activeSlotNow = activeSlotIndex();
		/* "run" matches the run box: the rule itself is named in its caption */
		modeTagEl.textContent = linkNote || (game.on
			? activeSlotNow > 0 && !playerIsBot()
				? (route ? 'run · planner · ' : 'run · ') + slotName(activeSlotNow)
				: route ? 'run · planner · no launch'
				: career ? 'career · world clock'
				: 'run · clock runs in flight'
			: 'lab · free clock');
		if (goalRoleEl) {
			goalRoleEl.textContent = career ? 'catapult network · pads & tasks'
				: route ? 'one plan · longest trajectory'
				: game.on ? (moneyRule() ? 'ten launches · visit profit' : 'visit every system')
				: 'one ship · gravity only';
		}
		runBoxEl.hidden = !game.on;
		if (careerBoxEl) careerBoxEl.hidden = !career;
		if (careerHudEl) careerHudEl.hidden = !career;
		if (careerCleanLabelEl) careerCleanLabelEl.hidden = !career;
		if (careerCleanEl) careerCleanEl.checked = cleanCareerView;
		refreshCareerClockUi();
		if (rivalGroupEl) rivalGroupEl.hidden = !game.on || RULES[game.rule].solo;
		syncModeRadios();
		if (scoreHudEl) scoreHudEl.hidden = !game.on;
		if (bodyGroupEl) bodyGroupEl.hidden = game.on;
		if (horizonGroupEl) horizonGroupEl.hidden = route;
		if (playbackGroupEl) playbackGroupEl.hidden = route;
		if (flightRowEl) flightRowEl.hidden = route;
		srcPlanetsEl.disabled = flightLock;
		srcPortsEl.disabled = flightLock;
		/* a flight locks the rule; lab stays reachable as the way out */
		for (let i = 0; i < modeEls.length; i++) {
			if (modeEls[i][1]) modeEls[i][1].disabled = flightLock && modeEls[i][0] !== PLAY_LAB;
		}
		if (botOffEl) botOffEl.disabled = flightLock;
		if (botEasyEl) botEasyEl.disabled = flightLock;
		if (botNormalEl) botNormalEl.disabled = flightLock;
		if (botHardEl) botHardEl.disabled = flightLock;
		syncScoreControls(flightLock);
		let anyShots = game.shots.length > 0;
		for (let i = 0; i < bot.count && !anyShots; i++) {
			if (bot.rivals[i].shots.length > 0) anyShots = true;
		}
		/* the scales define the world a link re-flies, so a flown run locks them;
		 * career has no shot replay and stays tunable while it runs */
		const experimentLock = game.on && (career ? replay.on : replay.on || anyShots);
		if (expGravityEl) expGravityEl.disabled = experimentLock;
		if (expForceEl) expForceEl.disabled = experimentLock;
		/* the stay-pay only exists in career: outside it the box is off and dim */
		if (expHarvestEl) expHarvestEl.disabled = experimentLock || !career;
		scene.lockSpeed(game.on && (route || game.fixedRate || anyShots || replay.on));
		clearButton.hidden = game.on && !route;
		clearButton.textContent = route ? 'clear plan' : 'clear';
		clearButton.disabled = route && (replay.on || playerIsBot());
		gameCopyBtn.disabled = flightLock;
		if (botCopyBtn) {
			const rIdx = activeSlotIndex() === 1 && bot.count > 1 ? 1 : 0;
			botCopyBtn.hidden = game.bot === BOT_OFF;
			botCopyBtn.disabled = flightLock || bot.count === 0 ||
				bot.rivals[rIdx].shots.length === 0;
		}
		if (botLogBtn) {
			const hasBots = game.on && (bot.count > 0 || playerIsBot());
			botLogBtn.hidden = !hasBots;
			if (!hasBots) hideBotLog();
		}
		if (rivalRowEl) rivalRowEl.hidden = game.bot === BOT_OFF;
		if (purseRowEl) purseRowEl.hidden = route;
		if (predProfitRowEl) predProfitRowEl.hidden = !game.on || route;
		if (visitLabelEl) visitLabelEl.textContent = route ? 'route score' : 'systems visited';
		if (predVisitLabelEl) predVisitLabelEl.textContent = route ? 'plan end' : 'pred visits';
		horizonSlider.disabled = route;

		replaySpeedBtn.hidden = !replay.on || replay.route;
		replaySkipBtn.hidden = !replay.on;
		replaySpeedBtn.textContent = '×' + REPLAY_SPEEDS[replay.speed];
		replayRowEl.hidden = !replay.on && replay.verdict === '';
		refreshPlaybackUi();
		refreshRouteBestUi();
		refreshCareerPanel();
		helperUpdateUi();
		updateLiveHud();
		measureHudRects();
		reserveTradeFooter();
		hudAt = -Infinity;
	}

	function scoreValue(summary) {
		if (routeRule()) {
			return summary.ready ? Math.round(summary.length) + ' px' : 'planning…';
		}
		if (moneyRule() || careerRule()) return summary.purse.toFixed(2) + ' purse';
		return summary.visited + ' / ' + planetCount + (summary.done ? ' ✓' : '');
	}

	function scoreMeta(summary) {
		const time = (summary.steps * DT).toFixed(1) + ' s';
		if (routeRule()) {
			if (!summary.ready) {
				return summary.origin >= 0
					? planetName(summary.origin) + ' · tracing one plan'
					: 'no finished plan yet';
			}
			const end = summary.reason === END_IMPACT
				? 'lands ' + planetName(summary.body)
				: 'leaves map';
			return planetName(summary.origin) + ' · ' + end + ' · ' + time +
				(summary.planning ? ' · still planning' : '');
		}
		if (moneyRule()) {
			return summary.visited + ' systems · ' + summary.shots + ' / ' +
				GravityGame.MONEY_SHOTS + ' shots · ' + time;
		}
		if (careerRule()) {
			const pads = summary.visited;
			return pads + (pads === 1 ? ' pad · ' : ' pads · ') +
				summary.shots + (summary.shots === 1 ? ' shot · ' : ' shots · ') + time;
		}
		const shots = summary.shots + (summary.shots === 1 ? ' shot' : ' shots');
		return shots + ' · ' + time + ' · purse ' + summary.purse.toFixed(2);
	}

	function rivalTagText() {
		if (careerRule()) {
			return bot.count === 1 ? '1 rival · flying' : bot.count + ' rivals · flying';
		}
		if (routeRule()) {
			if (bot.routeThinking()) {
				return 'planning ' + Math.round(bot.routeProgress() * 100) + ' %';
			}
			if (game.bot === BOT_OFF) return slotIsBot(0) ? 'your bot · ready' : 'solo';
			return game.bot === BOT_HARD ? '2 rivals · plans ready' : '1 rival · plan ready';
		}
		if (game.bot === BOT_OFF) return 'solo';
		if (bot.thinking() && bot.jobRival !== GravityBot.PLAYER_INDEX) {
			return 'thinking ' + Math.round(bot.progress() * 100) + ' %';
		}
		if (game.bot === BOT_HARD) return '2 rivals · 1-ply';
		if (game.bot === BOT_NORMAL) return '1 rival · route';
		return '1 rival · greedy';
	}

	function playerSummary() {
		const isBot0 = slotIsBot(0);
		if (routeRule()) {
			return {
				visited: routePlan.visits,
				done: isBot0 ? bot.player.routeDone : routePlan.ready,
				steps: routePlan.steps,
				shots: routePlan.ready ? 1 : 0,
				length: routePlan.length,
				purse: game.money.purse,
				origin: routePlan.origin,
				reason: routePlan.reason,
				body: routePlan.body,
				ready: routePlan.ready,
				planning: isBot0 ? !bot.player.routeDone : gravity.routeActive
			};
		}
		const flyingLength = gravity.status === STATUS_FLYING ? gravity.flightLength : 0;
		return {
			visited: careerRule() ? game.career.padCount : gravity.visitedCount,
			done: game.doneSteps >= 0,
			steps: scoreSteps(),
			shots: game.shots.length,
			length: game.length + flyingLength,
			purse: game.money.purse,
			origin: gravity.landedBody,
			reason: gravity.endReason,
			body: gravity.endBody,
			ready: game.shots.length > 0,
			planning: false
		};
	}

	function rivalSummaryInfo(player) {
		if (bot.count === 0) return { text: '—', outcome: 0 };
		const slot = activeSlotIndex();
		const activeSummary = slot === 0 ? player : bot.actorSummary(slot - 1);
		let bestCmp = Infinity;
		if (slot !== 0) {
			bestCmp = GravityGame.compareScores(game.rule, activeSummary, player);
		}
		for (let i = 0; i < bot.count; i++) {
			if (slot === i + 1) continue;
			const cmp = GravityGame.compareScores(game.rule, activeSummary, bot.actorSummary(i));
			if (cmp < bestCmp) bestCmp = cmp;
		}
		const finished = runOver();
		if (finished) {
			return {
				text: bestCmp > 0 ? 'WIN' : bestCmp < 0 ? 'LOSS' : 'TIE',
				outcome: bestCmp
			};
		}
		if (!routeRule() && bot.thinking() && bot.jobRival !== GravityBot.PLAYER_INDEX) {
			return { text: 'THINK ' + Math.round(bot.progress() * 100) + '%', outcome: 0 };
		}
		if (bestCmp > 0) return { text: 'AHEAD', outcome: 1 };
		if (bestCmp < 0) return { text: 'BEHIND', outcome: -1 };
		return { text: 'EVEN', outcome: 0 };
	}

	function careerRuleText() {
		const career = game.career;
		const pads = career.padCount + ' / ' + planetCount + ' pads';
		if (career.ended === GravityGame.CAREER_BROKE) return 'career · broke · ' + pads;
		if (career.ended === GravityGame.CAREER_COMPLETE) return 'career · complete';
		return 'career · ' + pads + (career.cheat ? ' · ' + career.cheat : '');
	}

	/* the scoreboard tag drops the pad count — that lives on the pads/planets
	 * row so the rule name stays on one line */
	function careerScoreTag() {
		const career = game.career;
		if (career.ended === GravityGame.CAREER_BROKE) return 'career · broke';
		if (career.ended === GravityGame.CAREER_COMPLETE) return 'career · complete';
		return 'career' + (career.cheat ? ' · ' + career.cheat : '');
	}

	/* --- career drawer: pad readout, shop, task board ------------------- */

	/* the planet selector follows the ship until the player picks one */
	let careerFollow = true;

	/* the running fast-forward: its clock starts at the click and clears on finish */
	let careerWaitAnim = null;

	function careerCost(career, value) {
		return career.cheat === GravityGame.CHEAT_COMMUNISM ? 0 : value;
	}

	function costText(value) {
		return value === 0 ? 'free' : value.toFixed(2);
	}

	/* full-battery cap of one pad for a given ship mass, so the shop can answer
	 * "can this pad lift this cargo?" and "what does this part cost in rail
	 * speed?" from the same rail model; 0 = no pad */
	function padCapMass(catapult, battery, mass) {
		if (catapult === null || battery === null) return 0;
		const cap = OrbitTech.speedLimit(battery.capacity, mass, catapult, gravity.forceScale);
		return cap > SPEED_MAX ? SPEED_MAX : cap;
	}

	function padCap(career, catapult, battery) {
		return padCapMass(catapult, battery, career.ship.mass);
	}

	function panelWaitKwh(career, planet, panel) {
		return panel ? OrbitTech.solarCharge(panel, career.light[planet], CAREER_WAIT_MIN * 60) : 0;
	}

	/* kWh one wait adds to that pad's battery (solar over the wait, before the leak) */
	function waitGain(career, planet, panel) {
		const item = panel === undefined ? career.pads[planet].panel : panel;
		return panelWaitKwh(career, planet, item).toFixed(2);
	}

	/* game-clock seconds of sunlight for `panel` on `planet` to cover one full-cap shot */
	function panelReadySec(career, planet, pad, panel) {
		const gain = panelWaitKwh(career, planet, panel);
		const rate = scene.trade.speed;
		if (gain <= 0 || rate <= 0) return 0;
		const cat = pad.catapult || OrbitTech.CATAPULTS[0];
		const bat = pad.battery || OrbitTech.BATTERIES[0];
		const cap = padCap(career, cat, bat);
		const shotKwh = cap > 0 ? OrbitTech.launchEnergy(career.ship.mass, cat, cap) : bat.capacity;
		return Math.max(1, Math.round(shotKwh / gain * (CAREER_WAIT_MIN / rate)));
	}

	/* `91 → 132 px/s`: the cap a row's next tier would buy */
	function capArrowText(now, after) {
		if (after <= 0) return '';
		const to = Math.round(after);
		if (now <= 0) return to + ' px/s';
		const from = Math.round(now);
		return from === to ? to + ' px/s' : from + ' → ' + to + ' px/s';
	}

	/* rails/batteries move the cap; panels move solar kWh/wait and full-shot ready time */
	function gearCapText(career, planet, pad, kind, next) {
		if (kind === OrbitTech.KIND_PANEL) {
			const item = next || pad.panel;
			if (!item) return '';
			return '+' + waitGain(career, planet, item) + ' kWh · ready in ' +
				panelReadySec(career, planet, pad, item) + ' s';
		}
		const now = padCap(career, pad.catapult, pad.battery);
		if (next === null) return now > 0 ? Math.round(now) + ' px/s' : '';
		/* a first catapult arrives with the starter panel and battery */
		const after = kind === OrbitTech.KIND_CATAPULT
			? padCap(career, next, pad.catapult === null ? OrbitTech.BATTERIES[0] : pad.battery)
			: padCap(career, pad.catapult, next);
		return capArrowText(now, after);
	}

	function capHtml(text) {
		return text === '' ? '' : '<span class="careerCap">' + text + '</span>';
	}

	/* the next record above the installed one (a pad starts from nothing) */
	function nextTier(table, current) {
		const tier = current ? current.tier : 0;
		for (let i = 0; i < table.length; i++) {
			if (table[i].tier > tier) return table[i];
		}
		return null;
	}

	/* shop buttons carry the table index, not the tier: tables differ per kind */
	function tierIndex(table, item) {
		for (let i = 0; i < table.length; i++) {
			if (table[i] === item) return i;
		}
		return -1;
	}

	function careerPickPlanet() {
		const career = game.career;
		if (careerFollow) return career.at >= 0 ? career.at : career.hq;
		const raw = careerPlanetEl ? careerPlanetEl.value : '';
		const picked = raw === '' ? -1 : Math.round(Number(raw));
		if (picked >= 0 && picked < PLANETS) return picked;
		return career.at >= 0 ? career.at : career.hq;
	}

	function careerNotice(text) {
		if (!careerMsgEl) return;
		careerMsgEl.textContent = text;
		careerMsgEl.hidden = text === '';
	}

	function shopButton(label, act, kind, tier, disabled, title, costly) {
		return shopButtonRef(label, act, kind, 'data-tier="' + tier + '"', disabled, title, costly);
	}

	/* `ref` names the record: a table tier, or the id of a research prototype;
	 * `costly` marks the purse itself as the blocker, so the price stays red
	 * instead of fading like a state gate (HQ only, cargo, no catapult) */
	function shopButtonRef(label, act, kind, ref, disabled, title, costly) {
		return '<button class="miniBtn' + (disabled && costly ? ' costly' : '') +
			'" data-act="' + act + '" data-kind="' + kind + '" ' + ref +
			(disabled ? ' disabled' : '') + ' title="' + title + '">' + label + '</button>';
	}

	/* a price the purse cannot cover (free under the communism cheat) */
	function purseTooSmall(career, price) {
		return career.ledger.purse + 1e-9 < price;
	}

	function recordRef(table, item) {
		const index = tierIndex(table, item);
		return index >= 0 ? 'data-tier="' + index + '"' : 'data-item="' + item.id + '"';
	}

	/* a button's record: its table tier, or its prototype id (null when unknown) */
	function shopRecord(data) {
		if (data.item) return GravityGame.prototypeById(game.career, data.kind, data.item);
		const table = TECH_TABLES[data.kind];
		if (!table) return null;
		return table[Math.round(Number(data.tier))] || null;
	}

	/* §11 balance tooling: the spec a row shares is the tier on offer, else
	 * the one fitted; copy stays enabled with an empty purse or a closed career */
	function copyButtonHtml(row, item) {
		if (!item) return '';
		return shopButtonRef('copy', 'copy', row.kind, recordRef(row.table, item), false,
			'copy the balance spec of ' + item.id);
	}

	function careerTagText() {
		const career = game.career;
		const at = career.at;
		const where = at < 0 ? 'lost in space'
			: at === career.hq ? 'HQ ' + planetName(at)
			: 'at ' + planetName(at) + ' · HQ ' + planetName(career.hq);
		const state = career.ended === GravityGame.CAREER_BROKE ? ' · broke'
			: career.ended === GravityGame.CAREER_COMPLETE ? ' · complete' : '';
		return where + state;
	}

	function shipImpulseNote(ship) {
		if (!ship.engine || ship.tank.fuelCap <= 0) return '';
		const remDv = OrbitTech.impulseDeltaV(ship.fuelKg, ship.engine, ship.mass, ship.fuelKg);
		const burnCap = OrbitTech.burnLimit(ship.fuelKg, ship.engine, ship.mass);
		if (ship.fuelKg < ship.tank.fuelCap - 0.05) {
			return ' · fuel ' + ship.fuelKg.toFixed(1) + '/' + ship.tank.fuelCap + ' kg' +
				(remDv > 0.05 ? ' · Δv ' + remDv.toFixed(1) + ' px/s' : ' · empty');
		}
		if (remDv <= 0) return '';
		return ' · Δv ' + remDv.toFixed(1) + ' px/s' +
			(burnCap < remDv - 0.05 ? ' (burn ' + burnCap.toFixed(1) + ')' : '');
	}

	/* who owns which planet's EMC claim, counted per player */
	function claimCounts() {
		const counts = [0, 0, 0];
		for (let i = 0; i < PLANETS; i++) {
			const owner = GravityGame.claimOwner(game.galaxy, i);
			if (owner >= 0 && owner < counts.length) counts[owner] += 1;
		}
		return counts;
	}

	function claimTag(owner) {
		if (owner < 0) return 'commercial';
		return owner === 0 ? 'YOU' : RIVAL_TAGS[owner - 1];
	}

	function claimLineHtml() {
		const counts = claimCounts();
		let text = 'EMC claims · YOU ' + counts[0];
		for (let i = 1; i <= bot.count && i < counts.length; i++) {
			text += ' · ' + RIVAL_TAGS[i - 1] + ' ' + counts[i];
		}
		return '<div class="careerLine dim">' + text + '</div>';
	}

	function padBlockHtml(career) {
		const at = career.at;
		if (at < 0) return '<div class="careerLine warn">lost in space · evacuate to HQ</div>';
		const pad = career.pads[at];
		const ship = career.ship;
		const cargo = ship.cargoTons > 0 ? ' · cargo ' + ship.cargoTons + ' t' : '';
		const claim = GravityGame.claimOwner(game.galaxy, at);
		let html = '<div class="careerLine"><b>' + planetName(at) + (at === career.hq ? ' · HQ' : '') +
			'</b> · ' + ship.mass.toFixed(1) + ' t' + cargo + ' · ' + claimTag(claim) + ' EMC</div>';
		html += '<div class="careerLine dim">ship ' + ship.hold.id + ' · ' +
			(ship.engine ? ship.engine.id : 'no engine') + ' · ' + ship.tank.id +
			shipImpulseNote(ship) + '</div>';
		if (career.commercialPlanet === at) {
			const lift = GravityGame.padLift(career, at);
			html += '<div class="careerLine">commercial EMC-1 selected · fee ' +
				costText(careerCost(career, GravityGame.CAREER.commercialFee)) +
				' · lifts to ' + Math.round(lift) + ' px/s</div>';
		}
		if (pad.catapult === null) {
			const first = OrbitTech.CATAPULTS[0];
			const cost = careerCost(career, first.buildCost);
			const poor = purseTooSmall(career, cost);
			const fresh = padCap(career, first, OrbitTech.BATTERIES[0]);
			const fee = careerCost(career, GravityGame.CAREER.commercialFee);
			const lift = GravityGame.padLift(career, at);
			const heavy = lift + 1e-9 < GravitySim.SPEED_MIN;
			html += '<div class="careerLine warn">no EMC here · commercial rail · fee ' +
				costText(fee) + '</div>' +
				'<div class="careerLine dim">lifts ' + ship.mass.toFixed(1) + ' t to ' +
				Math.round(lift) + ' px/s' + (heavy
					? ' · too heavy · evacuate ' + costText(careerCost(career, GravityGame.CAREER.evacFee))
					: ' · charged for you') + '</div>' +
				'<div class="careerRow"><span class="careerBtns">' +
				shopButton('build ' + first.id + ' here · ' + costText(cost), 'build', 'catapult', 0,
					poor,
					'build your own EMC-1 on ' + planetName(at) + ' · full battery lifts ' +
						ship.mass.toFixed(1) + ' t to ' + Math.round(fresh) + ' px/s · claims the planet', poor) +
				capHtml(capArrowText(0, fresh)) + '</span></div>' + claimLineHtml();
			return html;
		}
		const limit = gravity.speedLimit(at);
		const full = padCap(career, pad.catapult, pad.battery);
		const shot = OrbitTech.launchEnergy(ship.mass, pad.catapult, limit);
		const frac = pad.battery.capacity > 0 ? pad.chargeKwh / pad.battery.capacity : 0;
		html += '<div class="careerLine">' + pad.catapult.id + ' · ' + pad.panel.id + ' · ' +
			pad.battery.id + ' · <span id="careerPadCharge">' + pad.chargeKwh.toFixed(2) + ' / ' +
			pad.battery.capacity.toFixed(2) + ' kWh</span></div>';
		html += '<div class="careerBar"><i id="careerPadBar" style="width:' + Math.round(frac * 100) + '%"></i></div>';
		/* a pad on a full battery is rail-limited: say "full" only when the charge bites */
		const fullNote = Math.round(full) === Math.round(limit) ? ''
			: ' · full ' + Math.round(full) + ' px/s';
		html += '<div class="careerLine dim">max ' + Math.round(limit) + ' px/s' + fullNote +
			' · shot ' + shot.toFixed(2) + ' kWh</div>';
		if (limit < SPEED_MIN && full >= SPEED_MIN) {
			const need = OrbitTech.launchEnergy(ship.mass, pad.catapult, SPEED_MIN) - pad.chargeKwh;
			const gain = panelWaitKwh(career, at, pad.panel);
			const rate = scene.trade.speed;
			if (need > 0 && gain > 0 && rate > 0) {
				const sec = Math.max(1, Math.ceil(need / gain * (CAREER_WAIT_MIN / rate)));
				html += '<div class="careerLine dim">solar +' + gain.toFixed(2) +
					' kWh/wait · ready in ' + sec + ' s</div>';
			}
		}
		if (full < GravitySim.SPEED_MIN) {
			html += '<div class="careerLine warn">cannot lift ' + ship.mass.toFixed(1) +
				' t · buy a bigger rail below</div>';
		}
		html += claimLineHtml();
		return html;
	}

	function gearRowHtml(career, row, planet) {
		const pad = career.pads[planet];
		const cur = pad[row.kind];
		const next = nextTier(row.table, cur);
		let html = '<div class="careerRow"><span class="careerKind">' + row.label + '</span>' +
			'<span class="careerNow">' + (cur ? cur.id : 'none') + '</span>' +
			capHtml(gearCapText(career, planet, pad, row.kind, next)) + '<span class="careerBtns">';
		if (next === null) return html + '<i>max</i> ' + copyButtonHtml(row, cur) + '</span></div>';
		if (cur === null && row.kind !== OrbitTech.KIND_CATAPULT) {
			return html + '<i>needs a catapult</i></span></div>';
		}
		const buildCost = careerCost(career, next.buildCost);
		const poor = purseTooSmall(career, buildCost);
		const btnTitle = row.kind === OrbitTech.KIND_PANEL && cur
			? 'build ' + next.id + ' on ' + planetName(planet) + ' · +' +
				waitGain(career, planet, cur) + ' → +' + waitGain(career, planet, next) +
				' kWh · ready in ' + panelReadySec(career, planet, pad, cur) + ' → ' +
				panelReadySec(career, planet, pad, next) + ' s'
			: 'build ' + next.id + ' on ' + planetName(planet);
		html += shopButton(next.id + ' · ' + costText(buildCost), 'build', row.kind, tierIndex(row.table, next),
			poor, btnTitle, poor);
		html += bulkButtonHtml(career, row, next, 'data-tier="' + tierIndex(row.table, next) + '"');
		html += copyButtonHtml(row, next);
		return html + '</span></div>';
	}

	/* `all N`: one upgrade applied to every already-built facility that is below
	 * it — a table tier and a researched prototype share the rule and the total */
	function bulkButtonHtml(career, row, item, ref) {
		let count = 0;
		for (let i = 0; i < career.pads.length; i++) {
			if (OrbitTech.upgrades(career.pads[i], row.kind, item)) count += 1;
		}
		if (count === 0) return '';
		const cost = GravityGame.bulkUpgradeCost(career, row.kind, item);
		const poor = purseTooSmall(career, cost);
		return shopButtonRef('all ' + count + ' · ' + costText(cost), 'bulk', row.kind, ref,
			poor,
			'fit ' + item.id + ' to ' + count + ' built ' + row.label + (count === 1 ? '' : 's'),
			poor);
	}

	/* what a part row leads with: hold tons, tank fuel kg, engine thrust kN */
	function partStatText(kind, item) {
		if (item === null) return kind === OrbitTech.KIND_ENGINE ? '0 kN' : 'none';
		if (kind === OrbitTech.KIND_HOLD) return item.capacity + ' t';
		if (kind === OrbitTech.KIND_TANK) return item.fuelCap + ' kg';
		return item.thrust + ' kN';
	}

	/* heaviest owned tier below the fitted one: the free way back to a lighter
	 * ship; null when nothing lighter is owned (a hold/tank always has a tier 0).
	 * When a prototype is fitted, an owned ladder item on that same integer rung
	 * is also offered so the player can always swap back to the standard part. */
	function lighterTier(career, table, cur) {
		if (cur === null) return null;
		const proto = tierIndex(table, cur) < 0;
		for (let i = table.length - 1; i >= 0; i--) {
			const ok = proto ? table[i].tier <= cur.tier : table[i].tier < cur.tier;
			if (ok && career.owned[table[i].id]) return table[i];
		}
		return null;
	}

	/* full-battery cap of HQ with `item` in `kind` and the ship as loaded now */
	function partCap(career, row, item) {
		const pad = career.pads[career.hq];
		return padCapMass(pad.catapult, pad.battery,
			OrbitTech.refitMass(career.ship, row.kind, item, career.ship.cargoTons));
	}

	/* `8 → 24 t · 88 → 78 px/s`: the stat the offered refit holds and the HQ cap
	 * it buys, so a heavy fit reads as a launch limit before it is fitted;
	 * `change` undefined prints the fit as it is, null means the empty engine slot */
	function partCapText(career, row, cur, change) {
		const now = partCap(career, row, cur);
		const after = change === undefined ? now : partCap(career, row, change);
		const stat = change === undefined ? partStatText(row.kind, cur)
			: partStatText(row.kind, cur) + ' → ' + partStatText(row.kind, change);
		const cap = capArrowText(now, after);
		return cap === '' ? stat : stat + ' · ' + cap;
	}

	/* one refit button: forward buys/installs the next tier, `back` returns to
	 * an owned lighter one (item null = strip the engine) */
	function partButtonHtml(career, row, item, back) {
		const atHq = career.at === career.hq;
		const owned = item === null || Boolean(career.owned[item.id]);
		const price = owned ? 0 : careerCost(career, item.buildCost);
		const fits = row.kind !== OrbitTech.KIND_HOLD || item.capacity >= career.ship.cargoTons;
		const name = item === null ? 'no engine' : item.id;
		const mass = OrbitTech.refitMass(career.ship, row.kind, item, career.ship.cargoTons);
		const dv = OrbitTech.refitDeltaV(career.ship, row.kind, item, career.ship.cargoTons);
		const burnCap = OrbitTech.refitBurnLimit(career.ship, row.kind, item, career.ship.cargoTons);
		const dvNote = dv > 0
			? ' · Δv ' + dv.toFixed(1) + ' px/s' +
				(burnCap < dv - 0.05 ? ' (burn ' + burnCap.toFixed(1) + ')' : '')
			: '';
		const title = 'refit ' + name + (atHq ? '' : ' at HQ only') + ' · ' +
			partStatText(row.kind, item) + ' · ship ' + mass.toFixed(1) + ' t · HQ cap ' +
			Math.round(partCap(career, row, item)) + ' px/s' + dvNote +
			(fits ? '' : ' · drops ' + career.ship.cargoTons + ' t cargo first');
		const label = back ? 'back ' + name
			: (owned ? 'fit ' : 'buy ') + name + ' · ' + costText(price);
		const poor = purseTooSmall(career, price);
		return shopButton(label, 'part', row.kind,
			item === null ? NO_TIER : tierIndex(row.table, item),
			!atHq || !fits || poor, title, poor && atHq && fits);
	}

	function partRowHtml(career, row) {
		const cur = career.ship[row.kind];
		const next = nextTier(row.table, cur);
		const engine = row.kind === OrbitTech.KIND_ENGINE;
		const back = lighterTier(career, row.table, cur);
		const canBack = cur !== null && (engine || back !== null);
		/* the arrow describes the action on offer: the upgrade, else the step down */
		const change = next !== null ? next : canBack ? back : undefined;
		let html = '<div class="careerRow"><span class="careerKind">' + row.label + '</span>' +
			'<span class="careerNow">' + (cur ? cur.id : 'none') + '</span>' +
			capHtml(partCapText(career, row, cur, change)) + '<span class="careerBtns">';
		if (next !== null) html += partButtonHtml(career, row, next, false);
		if (canBack) html += partButtonHtml(career, row, back, true);
		html += copyButtonHtml(row, next !== null ? next : cur);
		return html + '</span></div>';
	}

	/* a researched ship part (engine or tank) is owned like a bought part: refit
	 * free at HQ, and the fitted one is marked instead of offered */
	function protoPartRowHtml(career, row, proto) {
		const fitted = career.ship[row.kind] === proto;
		let html = '<div class="careerRow"><span class="careerKind">↳ ' + row.label + '</span>' +
			'<span class="careerNow">' + proto.id + '</span>' +
			capHtml(partCapText(career, row, proto, undefined)) + '<span class="careerBtns">';
		if (fitted) html += '<i>fitted</i>';
		else {
			const mass = OrbitTech.refitMass(career.ship, row.kind, proto, career.ship.cargoTons);
			const dv = OrbitTech.refitDeltaV(career.ship, row.kind, proto, career.ship.cargoTons);
			const note = row.kind === OrbitTech.KIND_ENGINE ? ' · isp ' + proto.isp
				: row.kind === OrbitTech.KIND_TANK ? ' · empty ' + proto.emptyMass + ' t' : '';
			const dvNote = dv > 0 ? ' · Δv ' + dv.toFixed(1) + ' px/s' : '';
			html += shopButtonRef('fit ' + proto.id, 'part', row.kind, 'data-item="' + proto.id + '"',
				career.at !== career.hq, 'refit ' + proto.id + ' at HQ ' + planetName(career.hq) +
				' · ' + partStatText(row.kind, proto) + note + ' · ship ' + mass.toFixed(1) + ' t' + dvNote);
		}
		return html + copyButtonHtml(row, proto) + '</span></div>';
	}

	/* a researched pad upgrade is built under the tech tables' upgrade rule: a
	 * free catapult slot, or a higher rung than what the pad already has (a
	 * panel/battery needs a catapult first, like every other pad gear) */
	function gearFits(pad, kind, item) {
		if (kind === OrbitTech.KIND_CATAPULT) {
			return pad.catapult === null || OrbitTech.upgrades(pad, kind, item);
		}
		return pad.catapult !== null && OrbitTech.upgrades(pad, kind, item);
	}

	function protoGearStatText(kind, proto) {
		if (kind === OrbitTech.KIND_CATAPULT) return proto.maxForce + ' kN';
		if (kind === OrbitTech.KIND_BATTERY) return proto.capacity + ' kWh';
		return proto.power + ' kW';
	}

	function protoGearNoteText(kind, proto) {
		if (kind === OrbitTech.KIND_CATAPULT) return proto.maxForce + ' kN · eff ' + proto.efficiency;
		if (kind === OrbitTech.KIND_BATTERY) return proto.capacity + ' kWh · leak ' + proto.leak + '/y';
		return proto.power + ' kW';
	}

	function protoGearRowHtml(career, row, planet, proto) {
		const pad = career.pads[planet];
		const fits = gearFits(pad, row.kind, proto);
		const cost = careerCost(career, proto.buildCost);
		const cap = gearCapText(career, planet, pad, row.kind, proto);
		const stat = protoGearStatText(row.kind, proto);
		let html = '<div class="careerRow"><span class="careerKind">↳ ' + row.label + '</span>' +
			'<span class="careerNow">' + proto.id + '</span>' +
			capHtml(cap ? stat + ' · ' + cap : stat) + '<span class="careerBtns">';
		if (pad[row.kind] === proto) html += '<i>built</i>';
		else {
			const poor = purseTooSmall(career, cost);
			const why = row.kind !== OrbitTech.KIND_CATAPULT && pad.catapult === null
				? planetName(planet) + ' has no catapult yet'
				: proto.id + ' is not above the ' + row.label + ' on ' + planetName(planet);
			html += shopButtonRef('build ' + proto.id + ' · ' + costText(cost), 'build', row.kind,
				'data-item="' + proto.id + '"', !fits || poor,
				fits ? 'build ' + proto.id + ' on ' + planetName(planet) + ' · ' +
					protoGearNoteText(row.kind, proto) : why, poor && fits);
		}
		html += bulkButtonHtml(career, row, proto, 'data-item="' + proto.id + '"');
		return html + copyButtonHtml(row, proto) + '</span></div>';
	}

	function shopBlockHtml(career) {
		const planet = careerPickPlanet();
		let html = '<div class="careerHead">pad on ' + planetName(planet) + '</div>';
		for (let i = 0; i < GEAR_ROWS.length; i++) {
			const row = GEAR_ROWS[i];
			html += gearRowHtml(career, row, planet);
			const list = GravityGame.prototypesOf(career, row.kind) || [];
			for (let j = 0; j < list.length; j++) html += protoGearRowHtml(career, row, planet, list[j]);
		}
		html += '<div class="careerHead">ship refit · HQ ' + planetName(career.hq) + '</div>';
		for (let i = 0; i < PART_ROWS.length; i++) {
			const row = PART_ROWS[i];
			html += partRowHtml(career, row);
			const list = GravityGame.prototypesOf(career, row.kind) || [];
			for (let j = 0; j < list.length; j++) html += protoPartRowHtml(career, row, list[j]);
		}
		return html;
	}

	/* --- §10 science: hull-distance research on custom parameter vectors --- */

	function scienceParams(family) {
		const axes = SCIENCE_AXES[family];
		const out = new Array(axes.length);
		for (let i = 0; i < axes.length; i++) out[i] = scienceValues[family][axes[i].key];
		return out;
	}

	function scienceAxisText(axis, value) {
		return value.toFixed(axis.digits);
	}

	function scienceVectorText(family, params) {
		const axes = SCIENCE_AXES[family];
		const parts = new Array(axes.length);
		for (let i = 0; i < axes.length; i++) parts[i] = params[i].toFixed(axes[i].digits);
		return '[' + parts.join(', ') + ']';
	}

	function sciencePlotX(axis, value) {
		const width = SCI_PLOT.width - SCI_PLOT.left - SCI_PLOT.right;
		return SCI_PLOT.left + (value - axis.min) / (axis.max - axis.min) * width;
	}

	function sciencePlotY(axis, value) {
		const height = SCI_PLOT.height - SCI_PLOT.top - SCI_PLOT.bottom;
		return SCI_PLOT.top + (axis.max - value) / (axis.max - axis.min) * height;
	}

	function scienceCross(o, a, b) {
		return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	}

	/* monotone chain: tech records are chronological, not polygon order */
	function scienceHullVertices(points) {
		const sorted = new Array(points.length);
		for (let i = 0; i < points.length; i++) sorted[i] = points[i].params;
		sorted.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
		const lower = [];
		const upper = [];
		for (let i = 0; i < sorted.length; i++) {
			while (lower.length >= 2 && scienceCross(lower[lower.length - 2], lower[lower.length - 1], sorted[i]) <= 0) {
				lower.pop();
			}
			lower.push(sorted[i]);
		}
		for (let i = sorted.length - 1; i >= 0; i--) {
			while (upper.length >= 2 && scienceCross(upper[upper.length - 2], upper[upper.length - 1], sorted[i]) <= 0) {
				upper.pop();
			}
			upper.push(sorted[i]);
		}
		lower.pop();
		upper.pop();
		return lower.concat(upper);
	}

	function scienceHullOutlineHtml(career, family, axes) {
		const vertices = scienceHullVertices(OrbitScience.pointsHull(career.science, family));
		if (vertices.length < 2) return '';
		const points = new Array(vertices.length);
		for (let i = 0; i < vertices.length; i++) {
			points[i] = sciencePlotX(axes[0], vertices[i][0]).toFixed(2) + ',' +
				sciencePlotY(axes[1], vertices[i][1]).toFixed(2);
		}
		const tag = vertices.length === 2 ? 'polyline' : 'polygon';
		return '<' + tag + ' class="sciKnownHull" points="' + points.join(' ') + '"/>';
	}

	/* dashed bounds of the per-axis researched range: easy edges stay cool,
	 * hard frontier edges (weight >= 1) highlight warm where cost steepens */
	function scienceRangeHtml(career, family, axes) {
		const range = OrbitScience.rangeHull(career.science, family);
		if (!range) return '';
		const x0 = sciencePlotX(axes[0], Math.max(axes[0].min, range.min[0]));
		const x1 = sciencePlotX(axes[0], Math.min(axes[0].max, range.max[0]));
		const y0 = sciencePlotY(axes[1], Math.min(axes[1].max, range.max[1]));
		const y1 = sciencePlotY(axes[1], Math.max(axes[1].min, range.min[1]));
		if (x1 - x0 < 0.5 || y1 - y0 < 0.5) return '';
		let html = '<rect class="sciRange" x="' + x0.toFixed(2) + '" y="' + y0.toFixed(2) +
			'" width="' + (x1 - x0).toFixed(2) + '" height="' + (y1 - y0).toFixed(2) +
			'"><title>researched range: outside it new work has a directional cost</title></rect>';
		const dirs = OrbitScience.FRONTIER[family];
		if (!dirs) return html;
		const xa = x0.toFixed(2), xb = x1.toFixed(2), ya = y0.toFixed(2), yb = y1.toFixed(2);
		if (dirs[0].below >= 1 && range.min[0] > axes[0].min) {
			html += '<line class="sciRangeHard" x1="' + xa + '" y1="' + ya + '" x2="' + xa + '" y2="' + yb + '"/>';
		}
		if (dirs[0].above >= 1 && range.max[0] < axes[0].max) {
			html += '<line class="sciRangeHard" x1="' + xb + '" y1="' + ya + '" x2="' + xb + '" y2="' + yb + '"/>';
		}
		if (dirs[1].below >= 1 && range.min[1] > axes[1].min) {
			html += '<line class="sciRangeHard" x1="' + xa + '" y1="' + yb + '" x2="' + xb + '" y2="' + yb + '"/>';
		}
		if (dirs[1].above >= 1 && range.max[1] < axes[1].max) {
			html += '<line class="sciRangeHard" x1="' + xa + '" y1="' + ya + '" x2="' + xb + '" y2="' + ya + '"/>';
		}
		return html;
	}

	function scienceCostColor(cost, base, max) {
		if (max <= base + 1e-9) return 'rgb(' + SCI_PLOT_STOPS[0].join(',') + ')';
		const t = Math.pow(Math.min(1, Math.max(0, (cost - base) / (max - base))), 0.78);
		const pos = t * (SCI_PLOT_STOPS.length - 1);
		const i = Math.min(SCI_PLOT_STOPS.length - 2, Math.floor(pos));
		const f = pos - i;
		const a = SCI_PLOT_STOPS[i];
		const b = SCI_PLOT_STOPS[i + 1];
		return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' +
			Math.round(a[1] + (b[1] - a[1]) * f) + ',' +
			Math.round(a[2] + (b[2] - a[2]) * f) + ')';
	}

	/* x/y are the two engineering parameters; colour is the actual career fee.
	 * The expensive surface changes only with the hull, not on every slider tick. */
	function sciencePlotHtml(career, family) {
		const axes = SCIENCE_AXES[family];
		const plotWidth = SCI_PLOT.width - SCI_PLOT.left - SCI_PLOT.right;
		const plotHeight = SCI_PLOT.height - SCI_PLOT.top - SCI_PLOT.bottom;
		const cellWidth = plotWidth / SCI_PLOT_COLS;
		const cellHeight = plotHeight / SCI_PLOT_ROWS;
		const total = SCI_PLOT_COLS * SCI_PLOT_ROWS;
		const costs = new Array(total);
		let min = Infinity, max = 0;
		for (let row = 0; row < SCI_PLOT_ROWS; row++) {
			const y = axes[1].max - (row + 0.5) / SCI_PLOT_ROWS * (axes[1].max - axes[1].min);
			for (let col = 0; col < SCI_PLOT_COLS; col++) {
				const x = axes[0].min + (col + 0.5) / SCI_PLOT_COLS * (axes[0].max - axes[0].min);
				const p = GravityGame.researchPreview(career, family, [x, y]);
				const cost = Number.isFinite(p.cost) ? careerCost(career, p.cost) : Infinity;
				const k = row * SCI_PLOT_COLS + col;
				costs[k] = cost;
				if (cost < min) min = cost;
				if (cost > max) max = cost;
			}
		}
		let html = '<div class="sciPlotWrap"><svg id="sciCostPlot" class="sciPlot" viewBox="0 0 ' +
			SCI_PLOT.width + ' ' + SCI_PLOT.height + '" role="img" aria-label="' + family +
			' research fee over ' + axes[0].label + ' and ' + axes[1].label + '">' +
			'<g shape-rendering="crispEdges">';
		for (let row = 0; row < SCI_PLOT_ROWS; row++) {
			for (let col = 0; col < SCI_PLOT_COLS; col++) {
				const k = row * SCI_PLOT_COLS + col;
				html += '<rect x="' + (SCI_PLOT.left + col * cellWidth).toFixed(2) + '" y="' +
					(SCI_PLOT.top + row * cellHeight).toFixed(2) + '" width="' + (cellWidth + 0.25).toFixed(2) +
					'" height="' + (cellHeight + 0.25).toFixed(2) + '" fill="' +
					scienceCostColor(costs[k], min, max) + '"/>';
			}
		}
		html += '</g><rect class="sciPlotFrame" x="' + SCI_PLOT.left + '" y="' + SCI_PLOT.top +
			'" width="' + plotWidth + '" height="' + plotHeight + '"/>';
		html += scienceRangeHtml(career, family, axes);
		html += scienceHullOutlineHtml(career, family, axes);
		const known = OrbitScience.pointsHull(career.science, family);
		for (let i = 0; i < known.length; i++) {
			const p = known[i];
			html += '<circle class="sciKnownPoint" cx="' + sciencePlotX(axes[0], p.params[0]).toFixed(2) +
				'" cy="' + sciencePlotY(axes[1], p.params[1]).toFixed(2) + '" r="2"><title>' +
				p.label + ' ' + scienceVectorText(family, p.params) + '</title></circle>';
		}
		const draft = scienceValues[family];
		html += '<circle id="sciDraft" class="sciDraft" cx="' +
			sciencePlotX(axes[0], draft[axes[0].key]).toFixed(2) + '" cy="' +
			sciencePlotY(axes[1], draft[axes[1].key]).toFixed(2) + '" r="3.5"/>';
		html += '<text class="sciPlotTick" x="' + SCI_PLOT.left + '" y="140">' +
			scienceAxisText(axes[0], axes[0].min) + '</text>';
		html += '<text class="sciPlotTick" x="' + (SCI_PLOT.width - SCI_PLOT.right) +
			'" y="140" text-anchor="end">' + scienceAxisText(axes[0], axes[0].max) + '</text>';
		html += '<text class="sciPlotTick" x="' + (SCI_PLOT.left - 3) + '" y="9" text-anchor="end">' +
			scienceAxisText(axes[1], axes[1].max) + '</text>';
		html += '<text class="sciPlotTick" x="' + (SCI_PLOT.left - 3) + '" y="131" text-anchor="end">' +
			scienceAxisText(axes[1], axes[1].min) + '</text>';
		html += '<text class="sciPlotLabel" x="' + (SCI_PLOT.left + plotWidth / 2) +
			'" y="154" text-anchor="middle">' + axes[0].label + '</text>';
		html += '<text class="sciPlotLabel" transform="translate(6 67) rotate(-90)" text-anchor="middle">' +
			axes[1].label + '</text>';
		html += '</svg><div class="sciPlotLegend"><span><i class="sciRamp"></i>fee ' + costText(min) +
			'–' + costText(max) + '</span><span>◎ draft</span>' +
			'<span>┄ researched range</span></div></div>';
		return html;
	}

	/* one RU in engineering units: the inverse of the family's metric scale, so
	 * the line follows the axes and needs no prose per family */
	function scienceMetricText(family) {
		const axes = SCIENCE_AXES[family];
		const scale = OrbitScience.METRIC_SCALE[family];
		const rate = (OrbitScience.K_DIST * (OrbitScience.TIER_SCALE[family] || 1)).toFixed(2);
		let text = 'metric · 1 RU';
		for (let i = 0; i < axes.length; i++) {
			text += ' = ' + (scale ? Number((1 / scale[i]).toPrecision(3)) : '?') + ' ' + axes[i].label;
		}
		return text + ' · +' + rate + ' / RU of distance or frontier work';
	}

	/* par of one merit axis in the axis' own units: a mirrored axis stores its
	 * loss, so par 0.20 of the catapult efficiency row reads back as 80 % */
	function scienceParText(family, axis) {
		const a = OrbitScience.MERIT[family][axis];
		const meta = SCIENCE_AXES[family][axis];
		const value = a.mirror === undefined ? a.par : a.mirror - a.par;
		return value.toFixed(meta.digits);
	}

	/* the draft's own merit: which characteristic carries the fee right now */
	function scienceMeritText(family, params) {
		const row = OrbitScience.MERIT[family];
		if (!row) return '';
		const axes = SCIENCE_AXES[family];
		const parts = new Array(axes.length);
		for (let i = 0; i < axes.length; i++) {
			parts[i] = axes[i].key + ' ×' + OrbitScience.axisMerit(family, i, params[i]).toFixed(2);
		}
		return 'spec · ' + parts.join(' · ') + ' → ×' + OrbitScience.meritFactor(family, params).toFixed(2);
	}

	/* the rule behind it: per axis the step per doubling of merit, its par, and
	 * the clamp band of the product */
	function scienceMeritRuleText(family) {
		const row = OrbitScience.MERIT[family];
		if (!row) return '';
		const axes = SCIENCE_AXES[family];
		const parts = new Array(axes.length);
		for (let i = 0; i < axes.length; i++) {
			parts[i] = axes[i].key + ' 2× ' + (row[i].lower ? 'better' : 'more') + ' = ×' +
				row[i].per2.toFixed(2) + ' (par ' + scienceParText(family, i) + ')';
		}
		return 'spec rule · ' + parts.join(' · ') + ' · band ×' + OrbitScience.MERIT_MIN.toFixed(2) +
			'–×' + OrbitScience.MERIT_MAX.toFixed(2);
	}

	/* the balance knobs themselves, so a player sees why one direction is dear */
	function scienceFrontierText(family) {
		const dirs = OrbitScience.FRONTIER[family];
		if (!dirs) return '';
		const axes = SCIENCE_AXES[family];
		const parts = new Array(axes.length);
		for (let i = 0; i < axes.length; i++) {
			parts[i] = axes[i].key + ' ↓×' + dirs[i].below.toFixed(2) + ' ↑×' + dirs[i].above.toFixed(2);
		}
		return 'frontier · ' + parts.join(' · ') + ' · per RU beyond the researched range';
	}

	/* §11 balance tooling for the frontier knobs themselves: one paste-ready
	 * line per family, usable in an LLM chat like the tech: spec lines */
	function scienceSpecText(family) {
		const dirs = OrbitScience.FRONTIER[family];
		if (!dirs) return '';
		const axes = SCIENCE_AXES[family];
		const parts = new Array(axes.length);
		for (let i = 0; i < axes.length; i++) {
			parts[i] = axes[i].key + ': { below: ' + dirs[i].below.toFixed(2) +
				', above: ' + dirs[i].above.toFixed(2) + ' }';
		}
		const scale = (OrbitScience.METRIC_SCALE[family] || []).map(v => Number(v.toFixed(4)));
		const rows = OrbitScience.MERIT[family] || [];
		const merit = rows.map((a, i) => axes[i].key + ': { par: ' + a.par +
			(a.lower ? ', lower: true' : '') +
			(a.mirror === undefined ? '' : ', mirror: ' + a.mirror) +
			', per2: ' + a.per2.toFixed(2) + ' }');
		return 'frontier: ' + family.toUpperCase() + ' { ' + parts.join(', ') + ' }\n' +
			'metric: scale [' + scale.join(', ') + '] RU/unit · k ' + OrbitScience.K_DIST.toFixed(2) +
			' · tier ' + (OrbitScience.TIER_SCALE[family] || 1).toFixed(2) + '\n' +
			'merit: ' + family.toUpperCase() + ' { ' + merit.join(', ') + ' } · band ' +
			OrbitScience.MERIT_MIN + '–' + OrbitScience.MERIT_MAX;
	}

	function careerCopyFrontier(family) {
		const text = scienceSpecText(family);
		if (!text) return;
		const clipboard = navigator.clipboard;
		if (!clipboard) {
			careerNotice(text);
			return;
		}
		clipboard.writeText(text).then(
			() => careerNotice('copied the ' + family + ' frontier and merit knobs'),
			() => careerNotice(text));
	}

	function sciencePreviewText(career, family) {
		const params = scienceParams(family);
		const p = GravityGame.researchPreview(career, family, params);
		const where = p.inside ? 'inside hull · recombine' : 'outside · dist ' + p.dist.toFixed(3) + ' RU';
		const frontier = p.frontier > 1e-9 ? ' · frontier +' + p.frontier.toFixed(2) + ' RU' : '';
		const spec = Number.isFinite(p.merit) ? ' · spec ×' + p.merit.toFixed(2) : '';
		return scienceVectorText(family, params) + ' · ' + where + frontier + spec +
			' · fee ' + costText(GravityGame.researchCost(career, family, params));
	}

	function scienceAcceptWhy(open, poor) {
		if (!open) return 'the career has ended';
		if (poor) return 'the purse cannot cover the research fee';
		return 'accept this point into the knowledge hull';
	}

	function scienceAcceptButton(career, family) {
		const cost = GravityGame.researchCost(career, family, scienceParams(family));
		const open = career.ended === GravityGame.CAREER_OPEN;
		const poor = !Number.isFinite(cost) || purseTooSmall(career, cost);
		const disabled = !open || poor;
		const why = scienceAcceptWhy(open, poor);
		return '<button class="miniBtn' + (poor && open ? ' costly' : '') +
			'" id="sciAccept" data-act="sciAccept" data-kind="' + family + '"' +
			(disabled ? ' disabled' : '') + ' title="' + why + '">research · ' + costText(cost) + '</button>';
	}

	function scienceHullText(career) {
		let html = '';
		for (let i = 0; i < GravityGame.SCIENCE_KINDS.length; i++) {
			const kind = GravityGame.SCIENCE_KINDS[i];
			const st = OrbitScience.statsHull(career.science, kind);
			const points = OrbitScience.pointsHull(career.science, kind);
			let custom = '';
			for (let j = 0; j < points.length; j++) {
				if (points[j].label.charAt(0) === 'R') {
					custom += (custom ? ', ' : '') + points[j].label;
				}
			}
			html += '<div class="careerLine dim sciHull">' + kind + ' hull · ' + st.n + ' points' +
				(custom ? ' · ' + custom : '') + '</div>';
		}
		return html;
	}

	function scienceBlockHtml(career) {
		const family = scienceFamily;
		const axes = SCIENCE_AXES[family];
		let html = '<div id="sciHead" class="careerHead">research lab · purse ' +
			career.ledger.purse.toFixed(2) + '</div>';
		html += '<div class="careerRow sciFamilyRow"><span class="careerBtns">';
		for (let i = 0; i < GravityGame.SCIENCE_KINDS.length; i++) {
			const kind = GravityGame.SCIENCE_KINDS[i];
			html += '<button class="miniBtn' + (kind === family ? ' on' : '') +
				'" data-act="sciFamily" data-family="' + kind +
				'" title="research the ' + kind + ' parameter space">' + kind + '</button>';
		}
		html += '</span></div>';
		html += sciencePlotHtml(career, family);
		for (let i = 0; i < axes.length; i++) {
			const a = axes[i];
			const v = scienceValues[family][a.key];
			html += '<div class="careerRow sciAxis"><span class="careerKind">' + a.label + '</span>' +
				'<input type="range" data-sci-family="' + family + '" data-sci-axis="' + a.key +
				'" min="' + a.min + '" max="' + a.max + '" step="' + a.step + '" value="' + v +
				'" aria-label="' + a.label + '"><span class="sciVal" id="sciVal' + i + '">' +
				scienceAxisText(a, v) + '</span></div>';
		}
		html += '<div class="careerLine dim sciPreview" id="sciPreview" title="base + k·(directional distance + frontier work), multiplied by the spec merit: how demanding the target is on every axis at once">' +
			sciencePreviewText(career, family) + '</div>';
		html += '<div class="careerLine dim sciMetric">' + scienceMetricText(family) + '</div>';
		html += '<div class="careerLine dim sciMetric" id="sciMerit" title="every axis carries its own curve: a stronger, lighter or tighter target is dearer, a weaker, heavier or leakier one cheaper">' +
			scienceMeritText(family, scienceParams(family)) + '</div>';
		html += '<div class="careerLine dim sciMetric">' + scienceMeritRuleText(family) + '</div>';
		html += '<div class="careerRow sciKnobsRow"><span class="careerLine dim sciMetric">' +
			scienceFrontierText(family) + '</span><button class="miniBtn" data-act="sciCopy" data-family="' +
			family + '" title="copy the frontier and spec merit knobs for a balance chat">copy knobs</button></div>';
		html += '<div class="careerRow sciAcceptRow"><span class="careerBtns">' +
			scienceAcceptButton(career, family) + '</span></div>';
		return html + scienceHullText(career);
	}

	/* keep the research button + purse header live when money moves mid-flight */
	function syncSciencePurse(career) {
		if (!careerScienceEl || !career) return;
		const headEl = $('sciHead');
		if (headEl) headEl.textContent = 'research lab · purse ' + career.ledger.purse.toFixed(2);
		const acceptEl = $('sciAccept');
		if (!acceptEl) return;
		const family = scienceFamily;
		const cost = GravityGame.researchCost(career, family, scienceParams(family));
		const open = career.ended === GravityGame.CAREER_OPEN;
		const poor = !Number.isFinite(cost) || purseTooSmall(career, cost);
		acceptEl.disabled = !open || poor;
		acceptEl.classList.toggle('costly', open && poor);
		acceptEl.title = scienceAcceptWhy(open, poor);
		acceptEl.textContent = 'research · ' + costText(cost);
	}

	/* sliders stay mounted while dragged: patch the readout, draft marker and
	 * accept button without resampling the cost surface */
	function refreshScienceReadout(career) {
		if (!careerScienceEl || !career) return;
		const family = scienceFamily;
		const axes = SCIENCE_AXES[family];
		for (let i = 0; i < axes.length; i++) {
			const valEl = $('sciVal' + i);
			if (valEl) valEl.textContent = scienceAxisText(axes[i], scienceValues[family][axes[i].key]);
		}
		const previewEl = $('sciPreview');
		if (previewEl) previewEl.textContent = sciencePreviewText(career, family);
		const meritEl = $('sciMerit');
		if (meritEl) meritEl.textContent = scienceMeritText(family, scienceParams(family));
		const draftEl = $('sciDraft');
		if (draftEl) {
			const draft = scienceValues[family];
			draftEl.setAttribute('cx', sciencePlotX(axes[0], draft[axes[0].key]));
			draftEl.setAttribute('cy', sciencePlotY(axes[1], draft[axes[1].key]));
		}
		syncSciencePurse(career);
	}

	function scienceSliderInput(node) {
		const family = node.dataset.sciFamily;
		const axisKey = node.dataset.sciAxis;
		const axes = SCIENCE_AXES[family];
		if (!axes) return;
		let meta = null;
		for (let i = 0; i < axes.length; i++) {
			if (axes[i].key === axisKey) meta = axes[i];
		}
		if (!meta) return;
		let v = Number(node.value);
		if (!Number.isFinite(v)) return;
		if (v < meta.min) v = meta.min;
		if (v > meta.max) v = meta.max;
		scienceValues[family][axisKey] = v;
		refreshScienceReadout(game.career);
	}

	function careerScienceFamily(family) {
		if (!SCIENCE_AXES[family]) return;
		scienceFamily = family;
		refreshCareerPanel();
	}

	function careerResearch() {
		const career = game.career;
		const family = scienceFamily;
		const label = GravityGame.researchLabel(career);
		const params = scienceParams(family);
		const before = career.ledger.purse;
		if (!GravityGame.researchPoint(career, family, params, label)) {
			careerNotice(career.ended !== GravityGame.CAREER_OPEN
				? 'career over · restart for a new HQ'
				: 'research needs the preview fee in the purse');
			return;
		}
		if (turret.pending && !GravityGame.careerCanFire(career, gravity, turret.body, turret.speed)) {
			cancelTurret();
		}
		const n = OrbitScience.statsHull(career.science, family).n;
		careerNotice('researched ' + family + ' ' + label + ' ' + scienceVectorText(family, params) +
			' · −' + (before - career.ledger.purse).toFixed(2) + ' · hull ' + n + ' points');
		careerChanged();
	}

	/* §11 share a tech record's balance line; without a clipboard the line is
	 * shown in the drawer notice so it stays selectable on file:// pages */
	function careerCopySpec(data) {
		if (!data.item && Math.round(Number(data.tier)) === NO_TIER) return;
		const item = shopRecord(data);
		if (!item) return;
		const text = OrbitTech.copySpec(data.kind, item);
		const clipboard = navigator.clipboard;
		if (!clipboard) {
			careerNotice(text);
			return;
		}
		clipboard.writeText(text).then(
			() => careerNotice('copied spec · ' + item.id),
			() => careerNotice(text));
	}

	function taskRowHtml(career, index) {
		const task = career.tasks[index];
		const sport = index === GravityGame.COMPETE_SLOT;
		const kind = sport ? 'sport' : 'delivery';
		if (task.kind === GravityGame.TASK_NONE) {
			return '<div class="careerRow dim"><span class="careerKind">' + kind +
				'</span><span class="careerNow">no offer</span></div>';
		}
		const left = Math.max(0, Math.round((task.deadline - game.clockSteps) * DT));
		if (task.kind === GravityGame.TASK_COMPETE) {
			return '<div class="careerRow"><span class="careerKind">sport</span>' +
				'<span class="careerNow">' + planetName(task.planet) + ' · land ≥ ' +
				task.minLength + ' px</span><span class="careerBtns">+' + task.reward.toFixed(2) +
				' · ' + left + ' s</span></div>';
		}
		const good = OrbitEcon.GOODS_TABLE[task.good].id;
		const state = task.state === GravityGame.TASK_LOADED
			? 'loaded → ' + planetName(task.to)
			: task.state === GravityGame.TASK_ACCEPTED
			? 'load at ' + planetName(task.from)
			: planetName(task.from) + ' → ' + planetName(task.to);
		let html = '<div class="careerRow"><span class="careerKind">' + kind + '</span>' +
			'<span class="careerNow">' + state + ' · ' + good + ' ' + task.tons + ' t</span>' +
			'<span class="careerBtns">+' + task.reward.toFixed(2) + ' · ' + left + ' s';
		if (task.state === GravityGame.TASK_OFFERED) {
			const hold = career.ship.hold.capacity;
			const ok = GravityGame.canAccept(career, index);
			html += '<button class="miniBtn" data-act="accept" data-slot="' + index + '"' +
				(ok ? '' : ' disabled') +
				' title="' + (ok ? 'take this delivery' : hold < task.tons
					? 'needs a ' + task.tons + ' t hold (have ' + hold + ' t)'
					: 'one contract at a time') + '">accept</button>';
		} else {
			html += '<button class="miniBtn" data-act="drop" title="drop the contract and its cargo">drop</button>';
		}
		return html + '</span></div>';
	}

	function taskBlockHtml(career) {
		let html = '<div class="careerHead">task board</div>';
		for (let i = 0; i < career.tasks.length; i++) html += taskRowHtml(career, i);
		return html;
	}

	/* --- launch list: saved trajectories -------------------------------- */

	/* the field the page traces in: stored paths only hold inside this world */
	function pageBookTag() {
		return GravityGame.launchBookTag(gravity.fieldStatic, gravity.gravityScale,
			gravity.forceScale, gravity.strength, gravity.bodyCount);
	}

	/* one scratch result: callers read it before the next pricing call */
	const shotMoney = {
		cash: 0, fee: 0, exit: Infinity, net: -Infinity,
		builds: false, launchable: false, source: ''
	};

	/* A fresh trace and a stored visit log differ only in the harvest they
	 * price, so both feed this table: contract and competition pay, the launch
	 * fee and the cost of leaving the landing planet. */
	function moneyFacts(origin, speed, body, steps, length, visitPay) {
		const career = game.career;
		let cash = visitPay;
		if (career.contract >= 0) {
			const task = career.tasks[career.contract];
			if (task.state === GravityGame.TASK_LOADED && body === task.to) cash += task.reward;
		}
		const compete = career.tasks[GravityGame.COMPETE_SLOT];
		if (compete.kind === GravityGame.TASK_COMPETE && origin === compete.planet &&
			length >= compete.minLength &&
			game.clockSteps + steps <= compete.deadline) cash += compete.reward;
		const fee = GravityGame.launchFee(career, origin, speed);
		const available = career.ledger.purse + cash - fee;
		const mass = bot.careerArrivalMass(career, body);
		const departure = bot.careerDeparture(career, body, available, mass, gravity);
		const padless = career.pads[body].catapult === null;
		shotMoney.cash = cash;
		shotMoney.fee = fee;
		shotMoney.exit = departure.ok ? departure.cost : Infinity;
		shotMoney.net = departure.ok ? cash - fee - departure.cost : -Infinity;
		shotMoney.builds = padless && (departure.builds || departure.canBuildStarter);
		shotMoney.launchable = career.ledger.purse + 1e-9 >= fee && departure.ok;
		shotMoney.source = departure.source;
		return shotMoney;
	}

	function traceMoney(probe, origin, speed) {
		return moneyFacts(origin, speed, probe.predBody, probe.predSteps, probe.predLength,
			GravityGame.estimateProfit(game.market, game.clockSteps, probe));
	}

	/* a saved trace priced at the live market: not one trace is spent */
	function storedMoney(entry) {
		return moneyFacts(entry.origin, GravityGame.speedOf(entry.speedU), entry.body,
			entry.steps, entry.length,
			GravityGame.estimateProfitLog(game.market, game.clockSteps,
				entry.logPlanet, entry.logStep, entry.logCount));
	}

	/* the two live gates the launch button applies: the fee is covered and the
	 * landing can be left again */
	function moneyFlyable(money) {
		return money.launchable && game.career.ledger.purse + 1e-9 >= money.fee;
	}

	function escapeHtml(text) {
		return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	/* one finished page trace joins the career's book */
	function saveTrace(probe, origin, angleU, speedU) {
		if (!careerRule() || !gravity.fieldStatic) return;
		if (probe.predReason !== END_IMPACT || probe.predBody < 0) return;
		const money = traceMoney(probe, origin, GravityGame.speedOf(speedU));
		GravityGame.recordLaunch(game.career.launchBook, pageBookTag(), {
			origin: origin, angleU: angleU, speedU: speedU, body: probe.predBody,
			steps: probe.predSteps, time: probe.predTime, length: probe.predLength,
			score: money.net, logPlanet: probe.predLogPlanet, logStep: probe.predLogStep,
			logCount: probe.predLogCount
		});
	}

	/* the armed preview is saved once per aim, so a good find is never lost */
	const lastAimTrace = { origin: -1, angleU: 0, speedU: 0, body: -1 };
	function recordArmedTrace() {
		const sim = activeSim();
		const origin = aimBody;
		if (origin < 0 || sim.predReason !== END_IMPACT || sim.predBody < 0) return;
		const angleU = GravityGame.angleUnits(aimAngle);
		const speedU = GravityGame.speedUnits(aimSpeed);
		if (lastAimTrace.origin === origin && lastAimTrace.angleU === angleU &&
			lastAimTrace.speedU === speedU && lastAimTrace.body === sim.predBody) return;
		lastAimTrace.origin = origin;
		lastAimTrace.angleU = angleU;
		lastAimTrace.speedU = speedU;
		lastAimTrace.body = sim.predBody;
		saveTrace(sim, origin, angleU, speedU);
	}

	const bookOrder = new Int32Array(GravityGame.BOOK_MAX);
	const bookNet = new Float64Array(GravityGame.BOOK_MAX);
	const bookFire = new Uint8Array(GravityGame.BOOK_MAX);

	/* what stops a saved shot now: a moving field voids the path itself, the
	 * rest is the live rail gate the bot log prints */
	function launchBlock(career, entry, speed) {
		if (!gravity.fieldStatic) return 'moving field';
		if (playerIsBot()) return 'bot controls the ship';
		return GravityGame.railBlock(career, gravity, entry.origin, speed) ||
			(turret.pending ? 'a shot is already queued'
				: careerWaitBusy() ? 'the clock is settling a wait' : '');
	}

	/* the whole book, fireable rows first, best live money first (insertion
	 * sort over at most BOOK_MAX rows: a drawer refresh, not a frame) */
	function rankLaunchList(career) {
		const book = career.launchBook;
		let count = 0;
		for (let i = 0; i < book.entries.length && count < bookOrder.length; i++) {
			const entry = book.entries[i];
			const net = storedMoney(entry).net;
			const fire = launchBlock(career, entry, GravityGame.speedOf(entry.speedU)) === '' ? 1 : 0;
			let j = count - 1;
			while (j >= 0 && (bookFire[j] < fire || (bookFire[j] === fire && bookNet[j] < net))) {
				bookOrder[j + 1] = bookOrder[j];
				bookNet[j + 1] = bookNet[j];
				bookFire[j + 1] = bookFire[j];
				j -= 1;
			}
			bookOrder[j + 1] = i;
			bookNet[j + 1] = net;
			bookFire[j + 1] = fire;
			count += 1;
		}
		return count;
	}

	function launchRowHtml(career, index, net) {
		const entry = career.launchBook.entries[index];
		const speed = GravityGame.speedOf(entry.speedU);
		const kind = entry.body === entry.origin ? 'loop'
			: career.pads[entry.body].catapult === null ? 'EMC' : 'pad';
		const load = entry.body === entry.origin ? 'returns to ' + planetName(entry.origin)
			: career.pads[entry.body].catapult === null
				? 'lands where no own EMC stands · another owner\'s rail or a build'
				: 'lands on your own EMC';
		const block = launchBlock(career, entry, speed);
		const title = (block === '' ? 'arm this saved shot'
				: 'cannot fire · ' + block + ' · use stays off until it clears') +
			' · P' + entry.origin + ' → ' + planetName(entry.body) +
			' · ' + Math.round(entry.length) + ' px · ' + entry.logCount + ' systems · ' + load;
		return '<div class="careerRow' + (block === '' ? '' : ' dim') + '">' +
			'<span class="careerKind">' + kind + '</span>' +
			'<span class="careerNow">' + planetName(entry.body) + ' · ' +
			entry.time.toFixed(1) + ' s · ' + signedMoney(net) + '</span>' +
			'<span class="careerBtns"><button class="miniBtn" data-act="book" data-entry="' +
			index + '"' + (block === '' ? '' : ' disabled') + ' title="' +
			escapeHtml(title) + '">use</button></span>' +
			(block === '' ? '' : '<span class="careerWhy">' + escapeHtml(block) + '</span>') +
			'</div>';
	}

	/* the shared rail line is longer than the drawer: break it before the fee */
	function railLinesHtml(rail) {
		const cut = rail.indexOf(' · fee ');
		if (cut < 0) return '<div class="careerLine dim">' + escapeHtml(rail) + '</div>';
		return '<div class="careerLine dim" title="' + escapeHtml(rail) + '">' +
			escapeHtml(rail.slice(0, cut)) + '</div>' +
			'<div class="careerLine dim">' + escapeHtml(rail.slice(cut + 3)) + '</div>';
	}

	/* the shots tab: the live rail line, then every saved shot with its gate */
	function launchListHtml(career) {
		const head = '<div class="careerHead">launch list</div>';
		const book = career.launchBook;
		const html = head + railLinesHtml(GravityGame.railText(career, gravity, career.at));
		if (book.entries.length === 0) {
			return html + '<div class="careerLine dim">empty · aim or scan to save a shot</div>';
		}
		if (!gravity.fieldStatic) {
			return html + '<div class="careerLine warn">paused · gravity bodies move · ' +
				'paths only hold in a static field</div>' + launchRowsHtml(career);
		}
		if (!GravityGame.bookReady(book, pageBookTag())) {
			return html + '<div class="careerLine warn">stale · ' + book.entries.length +
				' saved in another field · these paths no longer hold</div>' +
				'<div class="careerLine dim"><button class="miniBtn" data-act="bookDrop">clear</button>' +
				' · a gravity edit makes every saved aim stale</div>';
		}
		return html + launchRowsHtml(career);
	}

	function launchRowsHtml(career) {
		const count = rankLaunchList(career);
		let fire = 0;
		for (let i = 0; i < count; i++) fire += bookFire[i];
		let html = '<div class="careerLine dim">' + count + ' saved · ' +
			fire + ' fireable here · best money first</div>';
		for (let i = 0; i < count; i++) html += launchRowHtml(career, bookOrder[i], bookNet[i]);
		return html;
	}

	/* the list re-renders when the book, the ship, the field, the rail or the
	 * purse changed, and every so often so the money follows the market */
	let launchListKey = '';
	function refreshLaunchList(force) {
		if (!careerLaunchListEl) return;
		if (!careerRule()) {
			if (launchListKey !== '') {
				careerLaunchListEl.innerHTML = '';
				launchListKey = '';
			}
			return;
		}
		const career = game.career;
		const pad = career.at >= 0 ? GravityGame.padAt(career, career.at) : null;
		const key = career.launchBook.version + '|' + pageBookTag() + '|' + career.at + '|' +
			(gravity.fieldStatic ? 1 : 0) + '|' + gravity.status + '|' +
			(turret.pending ? 1 : 0) + '|' + (careerWaitBusy() ? 1 : 0) + '|' +
			(pad ? Math.round(pad.chargeKwh * 100) : -1) + '|' +
			Math.round(career.ledger.purse * 100) + '|' + Math.round(game.clockSteps / 240);
		if (!force && key === launchListKey) return;
		launchListKey = key;
		careerLaunchListEl.innerHTML = launchListHtml(career);
	}

	/* a stale book cannot be flown: drop it by hand instead of losing it
	 * silently on the next save */
	function dropStaleBook() {
		const book = game.career.launchBook;
		if (book.entries.length === 0) return;
		const count = book.entries.length;
		GravityGame.resetLaunchBook(book);
		careerNotice('cleared ' + count + ' stale saved shots');
		refreshLaunchList(true);
	}

	/* arm a saved shot: the list's one click, then the launch button fires it.
	 * The tag and the rail gate are refused with the words the row shows. */
	function useBookEntry(index) {
		if (!careerRule() || careerWaitBusy() || turret.pending) return;
		const career = game.career;
		const entry = career.launchBook.entries[index];
		if (!entry) return;
		if (!GravityGame.bookReady(career.launchBook, pageBookTag())) {
			careerNotice('saved shot is stale · the gravity field changed · clear the list or scan again');
			return;
		}
		const speed = GravityGame.speedOf(entry.speedU);
		const block = launchBlock(career, entry, speed);
		if (block !== '') {
			careerNotice('saved shot is not firable · ' + block);
			return;
		}
		aimBody = entry.origin;
		aimAngle = GravityGame.angleOf(entry.angleU);
		aimSpeed = speed;
		aiming = false;
		armed = true;
		pressing = false;
		savedArmed = false;
		blockedPlanet = -1;
		placeGripFromSpeed();
		dirty = true;
		launchState = -1;
		hudAt = -Infinity;
		careerNotice('armed from list · ' + planetName(entry.origin) + ' → ' + planetName(entry.body));
		refreshGameUi();
	}

	function fillCareerPlanets(career) {
		if (!careerPlanetEl) return;
		const picked = careerPickPlanet();
		let html = '';
		for (let i = 0; i < PLANETS; i++) {
			if (!planetMask[i]) continue;
			const pad = career.pads[i];
			/* the cap comes before the gear id so a narrow picker clips the tier,
			 * not the answer to "can the ship leave this planet?" */
			const cap = GravityGame.padLift(career, i);
			const note = cap + 1e-9 < GravitySim.SPEED_MIN ? 'cannot lift'
				: Math.round(cap) + ' px/s';
			const gear = pad.catapult
				? pad.catapult.id + ' · ' + claimTag(GravityGame.claimOwner(game.galaxy, i))
				: 'commercial';
			html += '<option value="' + i + '">' + planetName(i) + (i === career.hq ? ' ★' : '') +
				' · ' + note + ' · ' + gear + '</option>';
		}
		careerPlanetEl.innerHTML = html;
		careerPlanetEl.value = String(picked);
	}

	/* exact net kWh, board ageing and visit-profit growth one wait will settle */
	function waitSettlement(career) {
		const rate = scene.trade.speed;
		const steps = Math.max(1, Math.round(CAREER_WAIT_MIN / (DT * rate)));
		const minutes = steps * DT * rate;
		const seconds = minutes * 60;
		const gameSec = Math.round(steps * DT);
		const nextStep = game.clockSteps + steps;
		const here = career.at >= 0 ? career.at : career.hq;
		let hereGain = 0;
		let totalGain = 0;
		let chargingPads = 0;
		for (let i = 0; i < career.pads.length; i++) {
			const pad = career.pads[i];
			if (pad.catapult === null) continue;
			const after = Math.min(pad.battery.capacity,
				OrbitTech.batteryLeak(pad.battery, pad.chargeKwh, minutes) +
				OrbitTech.solarCharge(pad.panel, career.light[i], seconds));
			const gain = after > pad.chargeKwh ? after - pad.chargeKwh : 0;
			if (i === here) hereGain = gain;
			if (gain > 0.005) {
				totalGain += gain;
				chargingPads += 1;
			}
		}
		let rotating = 0;
		for (let i = 0; i < career.tasks.length; i++) {
			const task = career.tasks[i];
			if (task.kind !== GravityGame.TASK_NONE && nextStep > task.deadline) rotating += 1;
		}
		const dropsContract = career.contract >= 0 &&
			nextStep > career.tasks[career.contract].deadline;
		let profitGain = 0;
		let growingPlanets = 0;
		for (let i = 0; i < PLANETS; i++) {
			if (!planetMask[i]) continue;
			const d = GravityGame.planetProfit(game.market, i, nextStep) -
				GravityGame.planetProfit(game.market, i, game.clockSteps);
			if (d > 1e-6) {
				profitGain += d;
				growingPlanets += 1;
			}
		}
		return {
			steps,
			gameSec,
			here,
			hereHasPad: career.pads[here].catapult !== null,
			hereGain,
			totalGain,
			chargingPads,
			rotating,
			dropsContract,
			profitGain,
			growingPlanets
		};
	}

	function refreshCareerWaitUi(career, ended) {
		const busy = careerWaitBusy();
		careerWaitBtn.disabled = busy || ended || turret.pending ||
			gravity.status === STATUS_FLYING;
		careerWaitBtn.classList.toggle('on', busy);
		if (!busy) careerWaitBtn.textContent = 'wait · ' + CAREER_WAIT_MIN + ' min';
		/* the running fast-forward keeps its own live progress line */
		if (busy) return;
		if (ended) {
			if (careerWaitInfoEl) {
				careerWaitInfoEl.textContent = '';
				careerWaitInfoEl.hidden = true;
			}
			careerWaitBtn.title = 'career has ended';
			return;
		}
		const s = waitSettlement(career);
		const hereName = planetName(s.here);
		const padShort = s.hereGain > 0.005
			? hereName + ' +' + s.hereGain.toFixed(2) + ' kWh' +
				(s.chargingPads > 1 ? ' (+' + s.totalGain.toFixed(2) + ' all)' : '')
			: s.totalGain > 0.005
			? s.chargingPads + (s.chargingPads === 1 ? ' pad +' : ' pads +') + s.totalGain.toFixed(2) + ' kWh'
			: s.hereHasPad ? hereName + ' full' : hereName + ' no pad';
		const boardShort = s.dropsContract ? 'drops contract!'
			: 'board −' + s.gameSec + ' s' + (s.rotating > 0 ? ' (' + s.rotating + ' exp)' : '');
		const profitShort = s.profitGain > 0.005 ? 'visits +' + s.profitGain.toFixed(2) : 'visits max';
		const line = 'wait → ' + padShort + ' · ' + boardShort + ' · ' + profitShort;
		const padFull = s.hereHasPad
			? (s.hereGain > 0.005
				? hereName + ' +' + s.hereGain.toFixed(2) + ' kWh' +
					(s.chargingPads > 1 ? ' (' + s.chargingPads + ' pads +' + s.totalGain.toFixed(2) + ' kWh)' : '')
				: hereName + ' full (solar +' + waitGain(career, s.here) + ' kWh)' +
					(s.totalGain > 0.005 ? ' · ' + s.chargingPads +
						(s.chargingPads === 1 ? ' pad +' : ' pads +') + s.totalGain.toFixed(2) + ' kWh' : ''))
			: hereName + ' has no pad' + (s.totalGain > 0.005
				? ' · ' + s.chargingPads + (s.chargingPads === 1 ? ' pad +' : ' pads +') +
					s.totalGain.toFixed(2) + ' kWh' : '');
		const boardFull = s.dropsContract
			? 'drops active contract!'
			: 'board −' + s.gameSec + ' s' + (s.rotating > 0
				? ' (' + s.rotating + (s.rotating === 1 ? ' offer rotates)' : ' offers rotate)') : '');
		const profitFull = s.profitGain > 0.005
			? 'planet visits +' + s.profitGain.toFixed(2) + ' (' + s.growingPlanets + ' growing)'
			: 'planet visits at cap';
		const title = 'wait ' + CAREER_WAIT_MIN + ' min (' + s.gameSec + ' s): ' +
			padFull + ' · ' + boardFull + ' · ' + profitFull;
		careerWaitBtn.title = title;
		if (careerWaitInfoEl) {
			careerWaitInfoEl.hidden = false;
			careerWaitInfoEl.textContent = line;
			careerWaitInfoEl.title = title;
			careerWaitInfoEl.className = s.dropsContract ? 'careerLine warn' : 'careerLine dim';
		}
	}

	/* one row per career tab: the pad and the shop, the saved shots, research */
	let careerTab = 'upgrades';
	const careerTabs = [
		{ name: 'upgrades', button: careerUpgradesTabEl, panel: careerUpgradesEl },
		{ name: 'shots', button: careerShotsTabEl, panel: careerShotsEl },
		{ name: 'science', button: careerScienceTabEl, panel: careerSciencePanelEl }
	];

	function refreshCareerTabs() {
		for (let i = 0; i < careerTabs.length; i++) {
			const tab = careerTabs[i];
			if (!tab.button || !tab.panel) continue;
			const on = tab.name === careerTab;
			tab.panel.hidden = !on;
			tab.button.classList.toggle('on', on);
			tab.button.setAttribute('aria-selected', on ? 'true' : 'false');
			tab.button.tabIndex = on ? 0 : -1;
		}
	}

	function careerSelectTab(tab) {
		for (let i = 0; i < careerTabs.length; i++) {
			if (careerTabs[i].name !== tab) continue;
			careerTab = tab;
			refreshCareerTabs();
			return;
		}
	}

	function refreshCareerPanel() {
		if (!careerBoxEl) return;
		refreshCareerTabs();
		/* the wait button sits in the bottom trade bar, so it follows the rule */
		careerWaitBtn.hidden = !careerRule();
		if (careerWaitInfoEl && !careerRule()) careerWaitInfoEl.hidden = true;
		if (!careerRule()) {
			careerPadEl.innerHTML = '';
			careerShopEl.innerHTML = '';
			if (careerScienceEl) careerScienceEl.innerHTML = '';
			careerTaskEl.innerHTML = '';
			refreshLaunchList(true);
			if (careerWaitInfoEl) {
				careerWaitInfoEl.textContent = '';
				careerWaitInfoEl.hidden = true;
			}
			careerNotice('');
			return;
		}
		const career = game.career;
		if (careerTagEl) careerTagEl.textContent = careerTagText();
		fillCareerPlanets(career);
		careerPadEl.innerHTML = padBlockHtml(career);
		careerTaskEl.innerHTML = taskBlockHtml(career);
		refreshLaunchList(true);
		careerShopEl.innerHTML = shopBlockHtml(career);
		if (careerScienceEl) careerScienceEl.innerHTML = scienceBlockHtml(career);
		const ended = career.ended !== GravityGame.CAREER_OPEN;
		refreshCareerWaitUi(career, ended);
		const evacCost = careerCost(career, GravityGame.CAREER.evacFee);
		const evacPoor = purseTooSmall(career, evacCost);
		careerEvacBtn.disabled = ended || !career.stranded || gravity.status === STATUS_FLYING || careerWaitBusy();
		careerEvacBtn.classList.toggle('costly', evacPoor && !ended && career.stranded);
		careerEvacBtn.textContent = 'evacuate · ' + costText(evacCost);
		launchState = -1;
		updateLiveHud();
	}

	/* any career edit can change the armed shot, the clock and the board */
	function careerChanged() {
		clampArmedToPad();
		launchState = -1;
		dirty = true;
		refreshGameUi();
	}

	function careerBuild(career, planet, kind, item) {
		const before = career.ledger.purse;
		if (!GravityGame.buildGear(career, planet, kind, item)) {
			careerNotice('cannot build ' + item.id + ' on ' + planetName(planet) + ' · ' +
				costText(careerCost(career, item.buildCost)) + ' and a free ' + kind + ' slot');
			return;
		}
		careerNotice('built ' + item.id + ' on ' + planetName(planet) + ' · −' +
			(before - career.ledger.purse).toFixed(2));
		careerChanged();
	}

	function careerBulk(career, kind, item) {
		const cost = GravityGame.bulkUpgradeCost(career, kind, item);
		if (!GravityGame.bulkUpgrade(career, kind, item)) {
			careerNotice('cannot fit ' + item.id + ' on every pad · ' + costText(cost));
			return;
		}
		careerNotice('every ' + kind + ' now ' + item.id + ' · −' + cost.toFixed(2));
		careerChanged();
	}

	function careerPart(career, kind, item) {
		const name = item === null ? 'no engine' : item.id;
		if (!GravityGame.installPart(career, kind, item)) {
			careerNotice('cannot fit ' + name + ' · refit at HQ ' + planetName(career.hq) +
				(kind === OrbitTech.KIND_HOLD ? ' and keep the hold at least as big as the cargo' : ''));
			return;
		}
		const dv = OrbitTech.shipDeltaV(career.ship, career.ship.cargoTons);
		careerNotice('fitted ' + name + ' · ship ' + career.ship.mass.toFixed(1) + ' t' +
			(dv > 0 ? ' · Δv ' + dv.toFixed(1) + ' px/s' : ''));
		careerChanged();
	}

	function careerAccept(career, index) {
		if (!GravityGame.acceptTask(career, index)) {
			careerNotice('cannot take that delivery');
			return;
		}
		const task = career.tasks[index];
		careerNotice(task.state === GravityGame.TASK_LOADED
			? 'contract accepted · cargo loaded at ' + planetName(task.from)
			: 'contract accepted · load at ' + planetName(task.from));
		careerChanged();
	}

	function careerDrop(career) {
		if (career.contract < 0) return;
		GravityGame.dropContract(career);
		/* a freed slot is offered again at once instead of after the next landing */
		GravityGame.refreshBoard(career, tradeSim, game.clockSteps);
		careerNotice('contract dropped');
		careerChanged();
	}

	function careerWaitBusy() {
		return careerWaitAnim !== null;
	}

	/* cubic ease-in-out: the fast-forward starts gently, races, then settles */
	function easeInOut(p) {
		const q = p < 0.5 ? 2 * p : 2 - 2 * p;
		return p < 0.5 ? q * q * q / 2 : 1 - q * q * q / 2;
	}

	function careerWaitProgress(p, eased) {
		const pct = Math.round(p * 100);
		if (pct === careerWaitAnim.pct) return;
		careerWaitAnim.pct = pct;
		careerWaitBtn.textContent = 'waiting · ' + pct + ' %';
		const career = careerWaitAnim.career;
		const pad = career.pads[careerWaitAnim.planet];
		if (pad && pad.catapult !== null) {
			const chargeEl = $('careerPadCharge');
			if (chargeEl) {
				chargeEl.textContent = pad.chargeKwh.toFixed(2) + ' / ' +
					pad.battery.capacity.toFixed(2) + ' kWh';
			}
			const barEl = $('careerPadBar');
			if (barEl && barEl.style) {
				const frac = pad.battery.capacity > 0 ? pad.chargeKwh / pad.battery.capacity : 0;
				barEl.style.width = Math.round(frac * 100) + '%';
			}
		}
		if (!careerWaitInfoEl) return;
		careerWaitInfoEl.hidden = false;
		careerWaitInfoEl.className = 'careerLine dim';
		/* the minutes are the eased world time, the % is wall-clock progress */
		const padNote = pad && pad.catapult !== null
			? ' · ' + planetName(careerWaitAnim.planet) + ' ' + pad.chargeKwh.toFixed(2) +
				' / ' + pad.battery.capacity.toFixed(2) + ' kWh'
			: '';
		careerWaitInfoEl.textContent = 'fast-forward · ' + (CAREER_WAIT_MIN * eased).toFixed(1) +
			' / ' + CAREER_WAIT_MIN + ' min' + padNote + ' · ' + pct + ' %';
	}

	/* the whole settled result lands exactly on the old instant wait */
	function careerWaitFinish() {
		const anim = careerWaitAnim;
		careerWaitAnim = null;
		const career = anim.career;
		const pad = career.pads[anim.planet];
		const after = pad.catapult === null ? 0 : pad.chargeKwh;
		const gain = after - anim.before;
		GravityGame.refreshBoard(career, tradeSim, game.clockSteps);
		GravityGame.checkEnded(career);
		gravity.predCount = 0;
		careerNotice('waited ' + CAREER_WAIT_MIN + ' min · ' + planetName(anim.planet) + ' pad ' +
			(gain > 0.005 ? '+' + gain.toFixed(2) + ' kWh'
				: pad.catapult === null ? 'has no catapult' : 'already full'));
		careerWaitBtn.classList.remove('on');
		careerChanged();
	}

	/* the world advances in eased chunks each frame: the trade planets visibly
	 * race, pads charge and the board ages exactly as one instant wait did.
	 * Each frame credits at most WAIT_FRAME_MS toward the wait, so below
	 * ~50 fps the wall-clock run stretches past 2 s and every frame keeps a
	 * bounded step chunk — slow machines slow down instead of freezing. */
	function careerWaitTick(now) {
		const anim = careerWaitAnim;
		if (anim === null) return;
		const dt = now - anim.last;
		anim.last = now;
		if (dt > 0) anim.credit += dt < WAIT_FRAME_MS ? dt : WAIT_FRAME_MS;
		const p = anim.credit < CAREER_WAIT_MS ? anim.credit / CAREER_WAIT_MS : 1;
		const eased = easeInOut(p);
		const steps = Math.round(eased * anim.steps);
		tradeSim.advanceTo(anim.startT + CAREER_WAIT_MIN * eased);
		gravity.fieldT = tradeSim.t;
		if (steps > anim.done) {
			/* recharge from the start snapshot, so the eased chunks land on the
			 * exact single-call result (leak is exponential, solar is linear) */
			const pads = anim.career.pads;
			for (let i = 0; i < pads.length; i++) pads[i].chargeKwh = anim.charges[i];
			GravityGame.careerAdvance(anim.career, anim.rate, steps);
			/* the rival companies live the same fast-forwarded steps: they
			 * charge, launch, fly and harvest while you wait */
			for (let s = anim.done + 1; s <= steps; s++) {
				bot.stepCareer(anim.startClock + s, game.market, tradeSim, anim.rate);
			}
			game.clockSteps = anim.startClock + steps;
			anim.done = steps;
			gravity.predCount = 0;
		}
		if (p < 1) careerWaitProgress(p, eased);
		else careerWaitFinish();
	}

	/* one press starts the 2 s fast-forward; only the end settles the board */
	function careerWait() {
		if (!careerRule() || careerWaitBusy() || turret.pending ||
			gravity.status === STATUS_FLYING) return;
		const career = game.career;
		if (career.ended !== GravityGame.CAREER_OPEN) return;
		const planet = career.at >= 0 ? career.at : career.hq;
		const pad = career.pads[planet];
		const rate = scene.trade.speed;
		careerWaitAnim = {
			career: career,
			planet: planet,
			before: pad.catapult === null ? 0 : pad.chargeKwh,
			charges: Float64Array.from(career.pads, p => p.chargeKwh),
			rate: rate,
			steps: Math.max(1, Math.round(CAREER_WAIT_MIN / (DT * rate))),
			done: 0,
			pct: -1,
			credit: 0,
			last: performance.now(),
			startClock: game.clockSteps,
			startT: tradeSim.t
		};
		careerWaitBtn.disabled = true;
		careerWaitBtn.classList.add('on');
		careerWaitProgress(0, 0);
		hudAt = -Infinity;
	}

	function cancelCareerWait() {
		if (careerWaitAnim === null) return;
		careerWaitAnim = null;
		careerWaitBtn.classList.remove('on');
		careerWaitBtn.textContent = 'wait · ' + CAREER_WAIT_MIN + ' min';
	}

	function careerEvacuate() {
		const career = game.career;
		if (!GravityGame.evacuate(career, gravity)) {
			careerNotice('nothing to evacuate');
			return;
		}
		cancelAim();
		careerNotice('evacuated to HQ ' + planetName(career.hq));
		careerChanged();
	}

	/* every shop / board button carries data-act (and its args) */
	function careerAct(data) {
		if (!careerRule()) return;
		const act = data.act;
		if (act === 'careerTab') return careerSelectTab(data.tab);
		if (act === 'bookDrop') return dropStaleBook();
		const career = game.career;
		/* balance tooling + science R&D stay available during flight, wait or turret spin */
		if (act === 'copy') return careerCopySpec(data);
		if (act === 'sciCopy') return careerCopyFrontier(data.family);
		if (act === 'sciFamily') return careerScienceFamily(data.family);
		if (act === 'sciAccept') {
			if (career.ended !== GravityGame.CAREER_OPEN) {
				careerNotice('career over · restart for a new HQ');
				return;
			}
			return careerResearch();
		}
		/* the eased world clock owns the career for its 2 s */
		if (careerWaitBusy() || turret.pending || gravity.status === STATUS_FLYING) return;
		if (act === 'wait') return careerWait();
		if (act === 'evac') return careerEvacuate();
		if (act === 'book') return useBookEntry(Number(data.entry));
		if (career.ended !== GravityGame.CAREER_OPEN) {
			careerNotice('career over · restart for a new HQ');
			return;
		}
		if (act === 'drop') return careerDrop(career);
		if (act === 'accept') return careerAccept(career, Number(data.slot));
		if (!data.item && Math.round(Number(data.tier)) === NO_TIER) {
			if (act === 'part') careerPart(career, data.kind, null);
			return;
		}
		const item = shopRecord(data);
		if (!item) return;
		if (act === 'build') careerBuild(career, careerPickPlanet(), data.kind, item);
		else if (act === 'bulk') careerBulk(career, data.kind, item);
		else if (act === 'part') careerPart(career, data.kind, item);
	}

	/* delegated click on the generated rows; data-* args live on the button */
	function careerEventData(event) {
		let node = event && event.target;
		while (node) {
			if (node.dataset && node.dataset.act) return node.dataset;
			node = node.parentElement;
		}
		return null;
	}

	function updateGameHud() {
		const ruleText = moneyRule()
			? 'money · ' + GravityGame.MONEY_SHOTS + ' shots'
			: routeRule()
			? 'route · longest one plan'
			: careerRule() ? careerRuleText()
			: 'tour · ' + GravityGame.CAP_SECONDS + ' s cap';
		if (ruleText !== hudRuleText) {
			hudRuleText = ruleText;
			ruleTagEl.textContent = ruleText;
			if (scoreRuleTagEl) {
				scoreRuleTagEl.textContent = careerRule() ? careerScoreTag() : ruleText;
			}
		}
		const rTag = rivalTagText();
		if (rTag !== hudRivalTagText) {
			hudRivalTagText = rTag;
			if (rivalTagEl) rivalTagEl.textContent = rTag;
		}
		if (botCopyBtn && game.bot !== BOT_OFF) {
			const rIdx = activeSlotIndex() === 1 && bot.count > 1 ? 1 : 0;
			botCopyBtn.disabled = replay.on || bot.count === 0 ||
				bot.rivals[rIdx].shots.length === 0;
		}

		const player = playerSummary();
		const score = scoreValue(player);
		if (score !== hudScoreText) {
			hudScoreText = score;
			gameScoreEl.textContent = score;
		}
		const playerMeta = scoreMeta(player);
		if (playerMeta !== hudPlayerMetaText) {
			hudPlayerMetaText = playerMeta;
			playerScoreMetaEl.textContent = playerMeta;
			playerScoreMetaEl.title = playerMeta;
		}
		for (let i = 0; i < bot.count; i++) {
			const summary = bot.actorSummary(i);
			const rivalScore = scoreValue(summary);
			if (rivalScore !== hudRivalScoreTexts[i]) {
				hudRivalScoreTexts[i] = rivalScore;
				rivalScoreEls[i].textContent = rivalScore;
			}
			const rivalMeta = scoreMeta(summary) + ' · ' +
				bot.actorStateShort(i, game.clockSteps);
			if (rivalMeta !== hudRivalMetaTexts[i]) {
				hudRivalMetaTexts[i] = rivalMeta;
				rivalMetaEls[i].textContent = rivalMeta;
			}
			const rivalState = bot.actorStatus(i, game.clockSteps);
			if (rivalState !== hudRivalStateTexts[i]) {
				hudRivalStateTexts[i] = rivalState;
				rivalMetaEls[i].title = rivalState;
			}
		}
		if (game.bot !== BOT_OFF && rivalEl) {
			const info = rivalSummaryInfo(player);
			if (info.text !== hudRivalText) {
				hudRivalText = info.text;
				rivalEl.textContent = info.text;
				rivalEl.classList.toggle('gain', info.outcome > 0);
				rivalEl.classList.toggle('loss', info.outcome < 0);
			}
		}
		const activeSlotNow = activeSlotIndex();
		const ledger = slotLedger(activeSlotNow);
		const shots = slotShots(activeSlotNow);
		const purseText = ledger.purse.toFixed(2) +
			(shots.length ? ' · last ' + signedMoney(ledger.last) : '');
		if (purseText !== hudPurseText) {
			hudPurseText = purseText;
			if (gamePurseEl) {
				gamePurseEl.textContent = purseText;
				const loss = slotBroke(activeSlotNow) ||
					(shots.length > 0 && ledger.last < 0);
				gamePurseEl.classList.toggle('loss', loss);
				gamePurseEl.classList.toggle('gain', !loss && shots.length > 0 &&
					ledger.last > 0);
			}
			if (careerRule()) syncSciencePurse(game.career);
		}
		const replayText = replay.on
			? replay.route
				? 'tracing one plan · ' + Math.round(gravity.routeProgress() * 100) + ' %'
				: 'shot ' + (replay.index + (replay.phase === PHASE_AIM ? 1 : 0)) + ' / ' +
					replay.shots.length + ' · ×' + REPLAY_SPEEDS[replay.speed]
			: replay.verdict;
		if (replayText !== hudReplayText) {
			hudReplayText = replayText;
			replayEl.textContent = replayText;
		}
	}

	/* a planet disc or paused ship hidden under a HUD panel still aims: the
	 * press is taken over only on a launchable pad or impulse ship, never a control */
	function hudPadPress(event) {
		const node = event.target;
		if (!node || node === tradeCanvas) return false;
		const inCargo = Boolean(cargoHudEl && typeof cargoHudEl.contains === 'function' && cargoHudEl.contains(node));
		const inLeft = Boolean(leftHudEl && typeof leftHudEl.contains === 'function' && leftHudEl.contains(node));
		const inFoot = Boolean(cargoFootEl && typeof cargoFootEl.contains === 'function' && cargoFootEl.contains(node));
		if (!inCargo && !inLeft && !inFoot) return false;
		if (node.closest && node.closest('button, input, select, label, textarea, .scoreEntry')) return false;
		const wx = worldX(event.clientX);
		const wy = worldY(event.clientY);
		if (canImpulse() && shipAt(wx, wy)) return true;
		const planet = planetAt(wx, wy);
		return planet >= 0 && canAimFrom(planet);
	}

	function onPointerDown(event) {
		sound.unlock();
		if (event.button !== 0 || (event.target !== tradeCanvas && !hudPadPress(event))) return;
		const wx = worldX(event.clientX);
		const wy = worldY(event.clientY);
		if (canImpulse() && shipAt(wx, wy)) {
			lastWX = wx;
			lastWY = wy;
			burnPressing = true;
			pressClientX = event.clientX;
			pressClientY = event.clientY;
			pendGripX = wx;
			pendGripY = wy;
			if (!burnPaused) setBurnPaused(true);
			return;
		}
		const planet = planetAt(wx, wy);
		const body = bodyAt(wx, wy);
		if (planet < 0 && body < 0) {
			if (!aiming && !pressing && !burnAiming && !burnPressing && selected >= 0) {
				setSelected(-1);
				helperUpdateUi();
			}
			return;
		}
		lastWX = wx;
		lastWY = wy;
		if (body >= 0) {
			setSelected(body);
		} else if (mode === MODE_PORTS && tradeSim.planetPort[planet] !== NO_PORT) {
			setSelected(tradeSim.planetPort[planet]);
		}
		const basePlanet = planet >= 0 ? planet : fieldPortPlanet[body];
		if (basePlanet >= 0 && routeRule() && routeOccupiedBy(basePlanet) >= 0) {
			showBlocked(basePlanet, performance.now());
			hudAt = -Infinity;
			return;
		}
		if (basePlanet >= 0 && !gameLocked()) {
			if (!canAimFrom(basePlanet)) showBlocked(basePlanet, performance.now());
			beginPress(basePlanet, event, wx, wy);
		}
	}

	function onPointerMove(event) {
		const wx = worldX(event.clientX);
		const wy = worldY(event.clientY);
		fine = event.shiftKey;
		if (burnAiming) {
			const prevAngle = burnAngle;
			const prevDv = burnDv;
			const dx = wx - lastWX;
			const dy = wy - lastWY;
			const sens = fine ? SENS_FINE : 1;
			gripX += dx * sens;
			gripY += dy * sens;
			updateBurnAim();
			if (burnAngle !== prevAngle || burnDv !== prevDv || activeSim().predCount < 2) {
				dirty = true;
			}
		} else if (burnPressing) {
			const dx = wx - lastWX;
			const dy = wy - lastWY;
			const sens = fine ? SENS_FINE : 1;
			pendGripX += dx * sens;
			pendGripY += dy * sens;
			const movedX = event.clientX - pressClientX;
			const movedY = event.clientY - pressClientY;
			if (movedX * movedX + movedY * movedY > DRAG_TAKEOVER_PX * DRAG_TAKEOVER_PX) {
				takeOverBurnAim();
			}
		} else if (aiming) {
			const prevAngle = aimAngle;
			const prevSpeed = aimSpeed;
			const dx = wx - lastWX;
			const dy = wy - lastWY;
			const sens = fine ? SENS_FINE : 1;
			gripX += dx * sens;
			gripY += dy * sens;
			updateAim();
			const sim = activeSim();
			if (aimAngle !== prevAngle || aimSpeed !== prevSpeed ||
				(sim.predCount < 2 && !sim.routeActive)) {
				dirty = true;
			}
		} else if (pressing) {
			const dx = wx - lastWX;
			const dy = wy - lastWY;
			const sens = fine ? SENS_FINE : 1;
			pendGripX += dx * sens;
			pendGripY += dy * sens;
			const movedX = event.clientX - pressClientX;
			const movedY = event.clientY - pressClientY;
			if (movedX * movedX + movedY * movedY > DRAG_TAKEOVER_PX * DRAG_TAKEOVER_PX) {
				takeOverAim(performance.now());
			}
		} else {
			const onCanvas = event.target === tradeCanvas;
			const body = onCanvas ? bodyAt(wx, wy) : -1;
			const planet = onCanvas ? planetAt(wx, wy) : -1;
			if (body !== hoverBody) {
				hoverBody = body;
				refreshHoverLabel();
			}
			hoverPlanet = planet;
		}
		lastWX = wx;
		lastWY = wy;
	}

	function onPointerUp(event) {
		fine = event.shiftKey;
		if (burnPressing && !burnAiming) {
			burnPressing = false;
			return;
		}
		if (burnAiming) {
			burnAiming = false;
			burnPressing = false;
			if (gripLen > 6 / view.scale && burnDv >= GravityGame.speedOf(1)) {
				burnArmed = true;
			} else if (savedBurnArmed) {
				burnAngle = savedBurnAngle;
				burnDv = savedBurnDv;
				burnArmed = true;
				placeBurnGrip();
			} else {
				burnArmed = false;
			}
			savedBurnArmed = false;
			dirty = true;
			refreshAimLabel();
			launchState = -1;
			hudAt = -Infinity;
			return;
		}
		if (pressing && !aiming) {
			pressing = false;
			return;
		}
		if (!aiming) return;
		aiming = false;
		pressing = false;
		const sim = activeSim();
		const reach = tradeSim.planetR[aimBody] + 6 / view.scale;
		if (gripLen > reach && aimSpeed > SPEED_MIN + 4) {
			armed = true;
			if (sim.predCount < 2 && !sim.routeActive) dirty = true;
			else {
				syncRoutePlan();
				rememberRouteBest();
			}
		} else if (savedArmed) {
			restoreSaved();
		} else {
			armed = false;
			dirty = false;
			if (sim.status !== STATUS_FLYING) sim.predCount = 0;
			else dirty = true;
			if (routeRule() && !replay.on) resetSlotRoutePlan(activeSlotIndex());
		}
		savedArmed = false;
		syncSoundLoop();
		refreshAimLabel();
		hudAt = -Infinity;
	}

	function onTrimInput() {
		const value = Number(trimSlider.value);
		const delta = value - trimLast;
		trimLast = value;
		if (delta === 0) return;
		/* a trim rewrites the queued shot's speed, so the pending one is cancelled */
		cancelTurret();
		const factor = 1 + delta / 100;
		if (burnArmed && canImpulse()) {
			const ceiling = gravity.burnLimit();
			const minDv = GravityGame.speedOf(1);
			burnDv = burnDv * factor;
			if (burnDv < minDv) burnDv = minDv;
			else if (burnDv > ceiling) burnDv = ceiling;
			placeBurnGrip();
			dirty = true;
			launchState = -1;
		} else if (armed) {
			const ceiling = speedCeiling(aimBody);
			aimSpeed = aimSpeed * factor;
			if (aimSpeed < SPEED_MIN) aimSpeed = SPEED_MIN;
			else if (aimSpeed > ceiling) aimSpeed = ceiling;
			placeGripFromSpeed();
			dirty = true;
		} else if (selected >= 0 && !game.on) {
			setBodyStrength(selected, gravity.strength[selected] * factor);
			refreshSelected();
			refreshHoverLabel();
			fieldChanged();
		}
		trimLabel.textContent = (value > 0 ? '+' : '') + value.toFixed(1) + '%';
		hudAt = -Infinity;
	}

	function resetTrim() {
		trimSlider.value = '0';
		trimLast = 0;
		trimLabel.textContent = '0%';
	}

	function updateHarvestMasks() {
		const sim = activeSim();
		const activePred = aiming || armed || sim.status === STATUS_FLYING;
		predHarvestMask.fill(0);
		if (activePred) {
			for (let k = 0; k < sim.predLogCount; k++) {
				predHarvestMask[sim.predLogPlanet[k]] = 1;
			}
		}
		liveHarvestMask.fill(0);
		if (game.on && sim.status === STATUS_FLYING) {
			const inside = slotLedger(activeSlotIndex()).inside;
			for (let i = 0; i < PLANETS; i++) {
				if (planetMask[i] && inside[i]) liveHarvestMask[i] = 1;
			}
		}
	}

	/* highlights the planet's own outline plus a tight outer ring, leaving thin orbits untouched */
	function drawPlanetVisitOutline(x, y, r, px, pulse, inside) {
		ctx.setLineDash(NO_DASH);
		ctx.beginPath();
		ctx.arc(x, y, r + 0.5 * px, 0, TAU);
		ctx.strokeStyle = inside ? 'rgba(205, 255, 224, 0.98)' : 'rgba(92, 255, 139, 0.96)';
		ctx.lineWidth = (inside ? 2.2 : 1.9) * px;
		ctx.stroke();

		ctx.beginPath();
		ctx.arc(x, y, r + (inside ? 3.8 : 3.4 + pulse * 1.6) * px, 0, TAU);
		ctx.strokeStyle = inside ? 'rgba(158, 255, 190, 0.92)' : 'rgba(92, 255, 139, 0.78)';
		ctx.lineWidth = (inside ? 1.5 : 1.3) * px;
		ctx.stroke();
	}

	/* Past visits stay dim outside clean career view; active/upcoming planet visits
	 * highlight the planet outline + outer ring (and omit thick orbit rings when clean). */
	function drawSystemVisits(now) {
		if (routeRule()) return;
		const sim = activeSim();
		const px = 1 / view.scale;
		const activePred = aiming || armed || sim.status === STATUS_FLYING;
		const clean = careerRule() && cleanCareerView;
		const pulse = 0.5 + 0.5 * Math.sin(now * 0.006);
		SYS_DASH[0] = 5 * px;
		SYS_DASH[1] = 5 * px;
		for (let i = 0; i < PLANETS; i++) {
			if (!planetMask[i]) continue;
			const inside = liveHarvestMask[i] === 1;
			const willVisit = inside || (activePred &&
				(game.on ? predHarvestMask[i] === 1 : sim.predVisit[i] === 1));
			if (clean) {
				if (willVisit) {
					drawPlanetVisitOutline(tradeSim.planetX[i], tradeSim.planetY[i],
						tradeSim.planetR[i], px, pulse, inside);
				}
				continue;
			}
			const wasVisited = sim.visited[i] === 1;
			if (!wasVisited && !willVisit) continue;
			const x = tradeSim.planetX[i];
			const y = tradeSim.planetY[i];
			const r = tradeSim.planetR[i];
			ctx.beginPath();
			ctx.ellipse(x, y, tradeSim.orbitRX[i], tradeSim.orbitRY[i],
				tradeSim.orbitTilt[i], 0, TAU);
			if (!willVisit) {
				ctx.setLineDash(NO_DASH);
				ctx.strokeStyle = 'rgba(142, 240, 192, 0.14)';
				ctx.lineWidth = 1.1 * px;
				ctx.stroke();

				ctx.beginPath();
				ctx.arc(x, y, r + 3.2 * px, 0, TAU);
				ctx.strokeStyle = 'rgba(142, 240, 192, 0.38)';
				ctx.lineWidth = 1.25 * px;
				ctx.stroke();
				continue;
			}
			ctx.setLineDash(SYS_DASH);
			ctx.strokeStyle = 'rgba(92, 255, 139, 0.85)';
			ctx.lineWidth = 1.35 * px;
			ctx.stroke();
			drawPlanetVisitOutline(x, y, r, px, pulse, inside);
		}
		ctx.setLineDash(NO_DASH);
	}

	/* highlights the landed body where the next launch must originate */
	function drawLandedBase(now) {
		const base = activeSim().landedBody;
		if (base < 0) return;
		const px = 1 / view.scale;
		const x = tradeSim.planetX[base];
		const y = tradeSim.planetY[base];
		const r = tradeSim.planetR[base];
		const pulse = 0.5 + 0.5 * Math.sin(now * 0.0055);
		const inner = r + 5.5 * px;
		const outer = inner + (4 + pulse * 3) * px;

		ctx.setLineDash(NO_DASH);
		ctx.beginPath();
		ctx.arc(x, y, inner, 0, TAU);
		ctx.strokeStyle = MINT;
		ctx.lineWidth = 1.6 * px;
		ctx.stroke();

		ctx.beginPath();
		ctx.arc(x, y, outer, 0, TAU);
		ctx.strokeStyle = 'rgba(255, 207, 110, 0.45)';
		ctx.lineWidth = 1.0 * px;
		ctx.stroke();

		/* four launch-pad ticks around the landed planet */
		const tick0 = inner + 1.5 * px;
		const tick1 = tick0 + 4.5 * px;
		ctx.beginPath();
		ctx.moveTo(x - tick1, y);
		ctx.lineTo(x - tick0, y);
		ctx.moveTo(x + tick0, y);
		ctx.lineTo(x + tick1, y);
		ctx.moveTo(x, y - tick1);
		ctx.lineTo(x, y - tick0);
		ctx.moveTo(x, y + tick0);
		ctx.lineTo(x, y + tick1);
		ctx.strokeStyle = GOLD;
		ctx.lineWidth = 1.4 * px;
		ctx.stroke();
	}

	function activeBlockedPlanet(now) {
		if (aiming) return -1;
		if (routeRule()) {
			const hoverBy = routeOccupiedBy(hoverPlanet);
			if (hoverBy >= 0) {
				blockedKind = 1;
				blockedBy = hoverBy;
				return hoverPlanet;
			}
			if (blockedKind === 1 && blockedPlanet >= 0 && now < blockedUntil) {
				return blockedPlanet;
			}
			return -1;
		}
		const landed = activeSim().landedBody;
		if (landed < 0) return -1;
		blockedKind = 0;
		blockedBy = -1;
		if (hoverPlanet >= 0 && hoverPlanet !== landed) return hoverPlanet;
		if (blockedPlanet >= 0 && blockedPlanet !== landed && now < blockedUntil) {
			return blockedPlanet;
		}
		return -1;
	}

	/* guide vector + arrowheads from a non-landed planet to the landed base */
	function drawBlockedArrowWorld(src, now) {
		const dst = activeSim().landedBody;
		if (dst < 0) return;
		const px = 1 / view.scale;
		const x0 = tradeSim.planetX[src];
		const y0 = tradeSim.planetY[src];
		const x1 = tradeSim.planetX[dst];
		const y1 = tradeSim.planetY[dst];
		const dx = x1 - x0;
		const dy = y1 - y0;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist < 1e-3) return;
		const angle = Math.atan2(dy, dx);
		const ux = dx / dist;
		const uy = dy / dist;
		const startGap = tradeSim.planetR[src] + 7 * px;
		const endGap = tradeSim.planetR[dst] + 10 * px;
		if (dist <= startGap + endGap) return;

		ctx.beginPath();
		ctx.arc(x0, y0, tradeSim.planetR[src] + 5 * px, 0, TAU);
		ctx.strokeStyle = WARN;
		ctx.lineWidth = 1.4 * px;
		ctx.setLineDash(NO_DASH);
		ctx.stroke();

		LOCK_DASH[0] = 6 * px;
		LOCK_DASH[1] = 6 * px;
		const sx = x0 + ux * startGap;
		const sy = y0 + uy * startGap;
		const ex = x1 - ux * endGap;
		const ey = y1 - uy * endGap;
		ctx.beginPath();
		ctx.moveTo(sx, sy);
		ctx.lineTo(ex, ey);
		ctx.strokeStyle = 'rgba(255, 148, 120, 0.72)';
		ctx.lineWidth = 1.35 * px;
		ctx.setLineDash(LOCK_DASH);
		ctx.stroke();
		ctx.setLineDash(NO_DASH);

		/* animated chevrons streaming toward the landed planet */
		const span = dist - startGap - endGap;
		const phase = (now * 0.09 * px) % (90 * px);
		ctx.fillStyle = GOLD;
		for (let d = phase; d < span - 14 * px; d += 90 * px) {
			const cx = sx + ux * d;
			const cy = sy + uy * d;
			ctx.beginPath();
			ctx.moveTo(cx + ux * 5 * px, cy + uy * 5 * px);
			ctx.lineTo(cx + Math.cos(angle + 2.5) * 4.2 * px,
				cy + Math.sin(angle + 2.5) * 4.2 * px);
			ctx.lineTo(cx + Math.cos(angle - 2.5) * 4.2 * px,
				cy + Math.sin(angle - 2.5) * 4.2 * px);
			ctx.closePath();
			ctx.fill();
		}

		ctx.beginPath();
		ctx.moveTo(ex + ux * 4 * px, ey + uy * 4 * px);
		ctx.lineTo(ex + Math.cos(angle + 2.55) * 7 * px,
			ey + Math.sin(angle + 2.55) * 7 * px);
		ctx.lineTo(ex + Math.cos(angle - 2.55) * 7 * px,
			ey + Math.sin(angle - 2.55) * 7 * px);
		ctx.closePath();
		ctx.fillStyle = WARN;
		ctx.fill();
	}

	function drawOccupiedPlanetWorld(src) {
		const px = 1 / view.scale;
		const x = tradeSim.planetX[src];
		const y = tradeSim.planetY[src];
		const r = tradeSim.planetR[src] + 5 * px;
		ctx.setLineDash(NO_DASH);
		ctx.beginPath();
		ctx.arc(x, y, r, 0, TAU);
		ctx.strokeStyle = WARN;
		ctx.lineWidth = 1.5 * px;
		ctx.stroke();
		const arm = r * 0.62;
		ctx.beginPath();
		ctx.moveTo(x - arm, y - arm);
		ctx.lineTo(x + arm, y + arm);
		ctx.moveTo(x + arm, y - arm);
		ctx.lineTo(x - arm, y + arm);
		ctx.strokeStyle = WARN;
		ctx.lineWidth = 1.3 * px;
		ctx.stroke();
	}

	function drawBlockedTooltipScreen(src) {
		if (blockedKind === 1) {
			const sx = tradeSim.planetX[src] * view.scale + view.offX;
			const sy = tradeSim.planetY[src] * view.scale + view.offY;
			const who = blockedBy >= 0 && blockedBy < RIVAL_TAGS.length
				? RIVAL_TAGS[blockedBy]
				: slotIsBot(0) ? 'BOT' : 'YOU';
			const text = planetName(src) + ' occupied by ' + who +
				' · choose another start planet';
			const width = 18 + text.length * 6.45;
			const height = 22;
			let x = sx + 14;
			let y = sy + 14;
			if (x + width > window.innerWidth - 8) x = window.innerWidth - width - 8;
			if (y + height > window.innerHeight - 10) y = sy - height - 16;
			plate(x, y, width, height, 'rgba(255, 148, 120, 0.55)');
			ctx.fillStyle = WARN;
			ctx.textAlign = 'left';
			ctx.textBaseline = 'middle';
			ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
			ctx.fillText(text, x + 9, y + height * 0.5 + 0.5);
			return;
		}
		const dst = activeSim().landedBody;
		if (dst < 0) return;
		const sx = tradeSim.planetX[src] * view.scale + view.offX;
		const sy = tradeSim.planetY[src] * view.scale + view.offY;
		const dx = tradeSim.planetX[dst] - tradeSim.planetX[src];
		const dy = tradeSim.planetY[dst] - tradeSim.planetY[src];
		const angle = Math.atan2(dy, dx);
		const text = 'launch not allowed · ship landed at ' + planetName(dst);
		const width = 36 + text.length * 6.45;
		const height = 22;
		let x = sx + 14;
		let y = sy + 14;
		if (x + width > window.innerWidth - 8) x = window.innerWidth - width - 8;
		if (y + height > window.innerHeight - 10) y = sy - height - 16;
		plate(x, y, width, height, 'rgba(255, 148, 120, 0.55)');

		/* inline directional arrow pointing directly toward the landed planet */
		const ax = x + 14;
		const ay = y + height * 0.5;
		const ux = Math.cos(angle);
		const uy = Math.sin(angle);
		ctx.strokeStyle = WARN;
		ctx.lineWidth = 1.6;
		ctx.beginPath();
		ctx.moveTo(ax - ux * 5.5, ay - uy * 5.5);
		ctx.lineTo(ax + ux * 5.5, ay + uy * 5.5);
		ctx.stroke();
		ctx.fillStyle = GOLD;
		ctx.beginPath();
		ctx.moveTo(ax + ux * 7, ay + uy * 7);
		ctx.lineTo(ax + Math.cos(angle + 2.45) * 3.5, ay + Math.sin(angle + 2.45) * 3.5);
		ctx.lineTo(ax + Math.cos(angle - 2.45) * 3.5, ay + Math.sin(angle - 2.45) * 3.5);
		ctx.closePath();
		ctx.fill();

		ctx.fillStyle = WARN;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
		ctx.fillText(text, x + 26, y + height * 0.5 + 0.5);
	}

	function drawWells() {
		const px = 1 / view.scale;
		REPEL_DASH[0] = 4 * px;
		REPEL_DASH[1] = 7 * px;
		for (let i = 0; i < gravity.bodyCount; i++) {
			const g = gravity.strength[i] * gravity.gravityScale;
			const mag = g < 0 ? -g : g;
			if (mag < 0.02) continue;
			const level = i === selected ? 2 : i === hoverBody ? 1 : 0;
			if (viewMode === VIEW_FIELD && level === 0) continue;
			const colours = WELL_COLOURS[g < 0 ? 1 : 0];
			ctx.beginPath();
			ctx.arc(gravity.bodyX[i], gravity.bodyY[i],
				WELL_BASE + mag * WELL_SCALE, 0, TAU);
			ctx.strokeStyle = colours[level];
			ctx.lineWidth = (level === 2 ? 1.3 : 0.9) * px;
			if (g < 0) {
				ctx.setLineDash(REPEL_DASH);
			} else {
				ctx.setLineDash(NO_DASH);
			}
			ctx.stroke();
		}
		ctx.setLineDash(NO_DASH);
	}

	function drawSigns() {
		const px = 1 / view.scale;
		ctx.lineCap = 'round';
		ctx.setLineDash(NO_DASH);
		for (let i = 0; i < gravity.bodyCount; i++) {
			const g = gravity.strength[i];
			if (g > -0.02 && g < 0.02) continue;
			const x = gravity.bodyX[i];
			const y = gravity.bodyY[i];
			let arm = gravity.bodyR[i] * 0.6;
			if (arm < 3.2 * px) arm = 3.2 * px;
			if (arm > 9 * px) arm = 9 * px;
			const colour = g > 0 ? SIGN_POS : SIGN_NEG;
			const signGlow = g > 0 ? 'rgba(255, 95, 87, 0.22)' : 'rgba(87, 168, 255, 0.22)';
			ctx.strokeStyle = signGlow;
			ctx.lineWidth = 6 * px;
			ctx.beginPath();
			ctx.moveTo(x - arm, y);
			ctx.lineTo(x + arm, y);
			if (g > 0) {
				ctx.moveTo(x, y - arm);
				ctx.lineTo(x, y + arm);
			}
			ctx.stroke();
			ctx.strokeStyle = colour;
			ctx.lineWidth = 1.7 * px;
			ctx.beginPath();
			ctx.moveTo(x - arm, y);
			ctx.lineTo(x + arm, y);
			if (g > 0) {
				ctx.moveTo(x, y - arm);
				ctx.lineTo(x, y + arm);
			}
			ctx.stroke();
			if (i === selected) {
				ctx.beginPath();
				ctx.arc(x, y, gravity.bodyR[i] + 1.5 * px, 0, TAU);
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
				ctx.lineWidth = px;
				ctx.stroke();
			}
		}
		ctx.lineCap = 'butt';
	}

	function drawPortVelocities() {
		if (mode !== MODE_PORTS || gravity.fieldRate === 0) return;
		const px = 1 / view.scale;
		if (Math.abs(gravity.fieldRate) < 0.05) return;
		ctx.lineCap = 'round';
		ctx.setLineDash(NO_DASH);
		const t = tradeSim.t;
		const eps = 0.12;
		for (let i = 0; i < gravity.bodyCount; i++) {
			const planet = fieldPortPlanet[i];
			const a0 = tradeSim.orbitPhase[planet] + tradeSim.orbitOmega[planet] * t;
			const a1 = tradeSim.orbitPhase[planet] + tradeSim.orbitOmega[planet] * (t + eps);
			const rx0 = tradeSim.orbitRX[planet] * Math.cos(a0);
			const ry0 = tradeSim.orbitRY[planet] * Math.sin(a0);
			const rx1 = tradeSim.orbitRX[planet] * Math.cos(a1);
			const ry1 = tradeSim.orbitRY[planet] * Math.sin(a1);
			const x0 = tradeSim.planetX[planet] + rx0 * tradeSim.orbitTiltCos[planet] - ry0 * tradeSim.orbitTiltSin[planet];
			const y0 = tradeSim.planetY[planet] + rx0 * tradeSim.orbitTiltSin[planet] + ry0 * tradeSim.orbitTiltCos[planet];
			const x1 = tradeSim.planetX[planet] + rx1 * tradeSim.orbitTiltCos[planet] - ry1 * tradeSim.orbitTiltSin[planet];
			const y1 = tradeSim.planetY[planet] + rx1 * tradeSim.orbitTiltSin[planet] + ry1 * tradeSim.orbitTiltCos[planet];
			const vx = (x1 - x0) / eps * gravity.fieldRate;
			const vy = (y1 - y0) / eps * gravity.fieldRate;
			const speed = Math.sqrt(vx * vx + vy * vy);
			if (speed < 0.15 / px) continue;
			const x = gravity.bodyX[i];
			const y = gravity.bodyY[i];
			const len = Math.min(18 * px, Math.max(6 * px, speed * 0.18 * px));
			const angle = Math.atan2(vy, vx);
			ctx.strokeStyle = 'rgba(180, 200, 220, 0.24)';
			ctx.lineWidth = 1.0 * px;
			ctx.beginPath();
			ctx.moveTo(x, y);
			ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
			ctx.lineTo(x + Math.cos(angle + 2.6) * 3.2 * px, y + Math.sin(angle + 2.6) * 3.2 * px);
			ctx.lineTo(x + Math.cos(angle - 2.6) * 3.2 * px, y + Math.sin(angle - 2.6) * 3.2 * px);
			ctx.closePath();
			ctx.fillStyle = 'rgba(180, 200, 220, 0.32)';
			ctx.fill();
		}
		ctx.lineCap = 'butt';
	}

	function drawPrediction() {
		const slot = activeSlotIndex();
		const sim = slotSim(slot);
		const count = sim.predCount;
		if (count < 2) return;
		const px = 1 / view.scale;
		PRED_DASH[0] = 6 * px;
		PRED_DASH[1] = 6 * px;
		const pathX = sim.predX;
		const pathY = sim.predY;
		const stride = count > 6000 ? 4 : count > 1400 ? 2 : 1;
		const isLeader = routeRule() &&
			((slot === 0 && routeLeader === -1) || (slot > 0 && routeLeader === slot - 1));
		ctx.beginPath();
		ctx.moveTo(pathX[0], pathY[0]);
		for (let i = stride; i < count; i += stride) ctx.lineTo(pathX[i], pathY[i]);
		const last = count - 1;
		if (last % stride !== 0) ctx.lineTo(pathX[last], pathY[last]);
		ctx.strokeStyle = isLeader ? GOLD : 'rgba(255, 207, 110, 0.78)';
		ctx.lineWidth = (isLeader ? 2.1 : 1.3) * px;
		ctx.setLineDash(PRED_DASH);
		ctx.stroke();
		ctx.setLineDash(NO_DASH);

		/* one dot per simulated second */
		ctx.fillStyle = 'rgba(255, 207, 110, 0.6)';
		for (let i = 119; i < count; i += 120) {
			ctx.beginPath();
			ctx.arc(pathX[i], pathY[i], 1.7 * px, 0, TAU);
			ctx.fill();
		}

		const ex = pathX[last];
		const ey = pathY[last];
		ctx.beginPath();
		ctx.arc(ex, ey, 5 * px, 0, TAU);
		ctx.strokeStyle = sim.predReason === END_IMPACT ? GOLD : 'rgba(190, 210, 230, 0.65)';
		ctx.lineWidth = 1.2 * px;
		ctx.stroke();
		if (sim.predReason === END_IMPACT) {
			ctx.beginPath();
			ctx.arc(ex, ey, 2 * px, 0, TAU);
			ctx.fillStyle = GOLD;
			ctx.fill();
		}
		if (isLeader) {
			ctx.beginPath();
			ctx.arc(ex, ey, 9 * px, 0, TAU);
			ctx.strokeStyle = GOLD;
			ctx.lineWidth = 1.1 * px;
			ctx.stroke();
		}
	}

	function drawTrail() {
		if (careerRule() && cleanCareerView) return;
		const count = gravity.trailCount;
		if (count < 2) return;
		const px = 1 / view.scale;
		const stride = count > 2400 ? 2 : 1;
		ctx.beginPath();
		ctx.moveTo(gravity.trailX[0], gravity.trailY[0]);
		for (let i = stride; i < count; i += stride) {
			ctx.lineTo(gravity.trailX[i], gravity.trailY[i]);
		}
		const last = count - 1;
		if (last % stride !== 0) ctx.lineTo(gravity.trailX[last], gravity.trailY[last]);
		ctx.strokeStyle = 'rgba(103, 224, 255, 0.9)';
		ctx.lineWidth = 1.8 * px;
		ctx.setLineDash(NO_DASH);
		ctx.stroke();
	}

	function drawCargo(now) {
		if (gravity.status === GravitySim.STATUS_IDLE) return;
		const px = 1 / view.scale;
		const x = gravity.cargo.x;
		const y = gravity.cargo.y;
		if (gravity.status === STATUS_FLYING) {
			if (burnPaused) {
				const holdPulse = 0.5 + 0.5 * Math.sin(now * 0.006);
				ctx.beginPath();
				ctx.arc(x, y, (8 + holdPulse * 3) * px, 0, TAU);
				ctx.strokeStyle = ICE;
				ctx.lineWidth = 1.25 * px;
				ctx.stroke();
			}
			const angle = Math.atan2(gravity.cargo.vy, gravity.cargo.vx);
			ctx.globalAlpha = 0.7;
			ctx.drawImage(glow, x - 18 * px, y - 18 * px, 36 * px, 36 * px);
			ctx.globalAlpha = 1;
			const size = 4.6 * px;
			ctx.beginPath();
			ctx.moveTo(x + Math.cos(angle) * size, y + Math.sin(angle) * size);
			ctx.lineTo(x + Math.cos(angle + 2.4) * size, y + Math.sin(angle + 2.4) * size);
			ctx.lineTo(x + Math.cos(angle - 2.4) * size, y + Math.sin(angle - 2.4) * size);
			ctx.closePath();
			ctx.fillStyle = GOLD;
			ctx.fill();
			ctx.strokeStyle = 'rgba(3, 8, 16, 0.8)';
			ctx.lineWidth = 0.8 * px;
			ctx.stroke();
			return;
		}
		const pulse = 0.5 + 0.5 * Math.sin(now * 0.006);
		ctx.globalAlpha = 0.55;
		ctx.drawImage(impactGlow, x - 16 * px, y - 16 * px, 32 * px, 32 * px);
		ctx.globalAlpha = 1;
		ctx.beginPath();
		ctx.arc(x, y, (5 + pulse * 4) * px, 0, TAU);
		ctx.strokeStyle = gravity.endReason === END_IMPACT ? GOLD : 'rgba(190, 210, 230, 0.6)';
		ctx.lineWidth = 1.2 * px;
		ctx.stroke();
	}

	function drawAim() {
		const isBurn = (burnArmed || burnAiming) && gravity.status === STATUS_FLYING;
		if (!isBurn && !armed && !aiming) return;
		const px = 1 / view.scale;
		const cx = isBurn ? gravity.cargo.x : tradeSim.planetX[aimBody];
		const cy = isBurn ? gravity.cargo.y : tradeSim.planetY[aimBody];
		const angle = isBurn ? burnAngle : aimAngle;
		const mainStroke = isBurn ? ICE : GOLD;
		GRIP_DASH[0] = 3 * px;
		GRIP_DASH[1] = 7 * px;
		ctx.beginPath();
		ctx.arc(cx, cy, GRIP_MAX, 0, TAU);
		ctx.strokeStyle = isBurn ? 'rgba(103, 224, 255, 0.14)' : 'rgba(255, 207, 110, 0.10)';
		ctx.lineWidth = px;
		ctx.setLineDash(GRIP_DASH);
		ctx.stroke();
		ctx.setLineDash(NO_DASH);

		const sim = activeSim();
		const sx = !isBurn && sim.predCount > 0 ? sim.predX[0] : cx;
		const sy = !isBurn && sim.predCount > 0 ? sim.predY[0] : cy;
		ctx.beginPath();
		ctx.moveTo(sx, sy);
		ctx.lineTo(gripX, gripY);
		ctx.strokeStyle = isBurn ? 'rgba(103, 224, 255, 0.85)' : 'rgba(255, 207, 110, 0.82)';
		ctx.lineWidth = 1.2 * px;
		ctx.stroke();

		const size = (4 + (gripLen > 0 ? gripLen / GRIP_MAX : 0) * 4) * px;
		ctx.beginPath();
		ctx.arc(gripX, gripY, size, 0, TAU);
		ctx.fillStyle = isBurn ? 'rgba(103, 224, 255, 0.18)' : 'rgba(255, 207, 110, 0.16)';
		ctx.fill();
		ctx.strokeStyle = mainStroke;
		ctx.lineWidth = 1.4 * px;
		ctx.stroke();
		const tip = 11 * px;
		const side = 4.5 * px;
		ctx.beginPath();
		ctx.moveTo(gripX + Math.cos(angle) * tip, gripY + Math.sin(angle) * tip);
		ctx.lineTo(gripX + Math.cos(angle + 2.5) * side,
			gripY + Math.sin(angle + 2.5) * side);
		ctx.lineTo(gripX + Math.cos(angle - 2.5) * side,
			gripY + Math.sin(angle - 2.5) * side);
		ctx.closePath();
		ctx.fillStyle = mainStroke;
		ctx.fill();
	}

	function drawMarkers() {
		const px = 1 / view.scale;
		for (let i = 0; i < gravity.bodyCount; i++) {
			if (i !== selected && i !== hoverBody) continue;
			ctx.beginPath();
			ctx.arc(gravity.bodyX[i], gravity.bodyY[i],
				gravity.bodyR[i] + 5 * px, 0, TAU);
			ctx.strokeStyle = i === selected ? GOLD : ICE;
			ctx.globalAlpha = 0.7;
			ctx.lineWidth = 1.2 * px;
			ctx.stroke();
			ctx.globalAlpha = 1;
		}
	}

	function drawLabel(text, wx, wy, colour, below) {
		if (!text) return;
		const sx = wx * view.scale + view.offX + 14;
		const sy = wy * view.scale + view.offY - 14 +
			(below ? gravity.bodyR[selected] * view.scale + 34 : 0);
		const width = 18 + text.length * 6.4;
		let x = sx;
		let y = sy - 16;
		if (x + width > window.innerWidth - 8) x = window.innerWidth - width - 8;
		if (y < 8) y = 8;
		plate(x, y, width, 18);
		ctx.fillStyle = colour;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
		ctx.fillText(text, x + 9, y + 9.5);
	}

	function drawGripLabel() {
		if (!aimLabel || (!armed && !aiming && !burnArmed && !burnAiming)) return;
		ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
		const sx = gripX * view.scale + view.offX + 16;
		const sy = gripY * view.scale + view.offY - 12;
		const width = 20 + aimLabel.length * 6.7;
		let x = sx;
		let y = sy - 18;
		if (y < 8) y = sy + 22;
		if (x + width > window.innerWidth - 8 || rectUnderHud(x, y, width, 20)) {
			x = sx - width - 32;
			for (let i = 0; i < hudRectEls.length; i++) {
				const o = i * 4;
				const left = hudRects[o];
				const right = hudRects[o + 2];
				const bottom = hudRects[o + 3];
				if (right <= left || bottom <= hudRects[o + 1]) continue;
				if (y >= bottom || y + 20 <= hudRects[o + 1]) continue;
				if (x < right && x + width > left && left > width + 12) {
					x = left - width - 6;
				}
			}
			if (x < 8) x = 8;
		}
		plate(x, y, width, 20);
		ctx.fillStyle = !careerRule() || aimGuidance === 0
			? fine ? ICE : GOLD : aimGuidance === 1 ? MINT : WARN;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		ctx.fillText(aimLabel, x + 10, y + 10.5);
	}

	function drawRoutePlanEntry(sim, leader, colour, dimColour, px) {
		const planCount = sim.predCount;
		const planStride = planCount > 6000 ? 4 : planCount > 1400 ? 2 : 1;
		ctx.beginPath();
		ctx.moveTo(sim.predX[0], sim.predY[0]);
		for (let i = planStride; i < planCount; i += planStride) {
			ctx.lineTo(sim.predX[i], sim.predY[i]);
		}
		const planLast = planCount - 1;
		if (planLast % planStride !== 0) {
			ctx.lineTo(sim.predX[planLast], sim.predY[planLast]);
		}
		ctx.strokeStyle = leader ? colour : dimColour;
		ctx.lineWidth = (leader ? 2.1 : 1.25) * px;
		PRED_DASH[0] = 6 * px;
		PRED_DASH[1] = 6 * px;
		ctx.setLineDash(PRED_DASH);
		ctx.stroke();
		ctx.setLineDash(NO_DASH);
		ctx.beginPath();
		ctx.arc(sim.predX[planLast], sim.predY[planLast],
			(leader ? 6 : 4.5) * px, 0, TAU);
		ctx.strokeStyle = colour;
		ctx.lineWidth = 1.2 * px;
		ctx.stroke();
		if (leader) {
			ctx.beginPath();
			ctx.arc(sim.predX[planLast], sim.predY[planLast], 9 * px, 0, TAU);
			ctx.strokeStyle = GOLD;
			ctx.lineWidth = 1.1 * px;
			ctx.stroke();
		}
	}

	function drawRivalsWorld(now) {
		const px = 1 / view.scale;
		const active = activeSlotIndex();
		if (active > 0 && routeRule() && gravity.predCount >= 2) {
			drawRoutePlanEntry(gravity, routeLeader === -1, MINT,
				'rgba(142, 240, 192, 0.48)', px);
		}
		for (let rIdx = 0; rIdx < bot.count; rIdx++) {
			const r = bot.rivals[rIdx];
			const sim = r.sim;
			const colour = RIVAL_COLOURS[rIdx];
			/* in route, the rival's current best plan is its entry—no ship flies */
			if (routeRule() && sim.predCount >= 2 && active !== rIdx + 1) {
				drawRoutePlanEntry(sim, routeLeader === rIdx, colour, RIVAL_TRAILS[rIdx], px);
			}
			/* rival trail */
			const count = sim.trailCount;
			if (count >= 2 && !(careerRule() && cleanCareerView)) {
				const stride = count > 2400 ? 2 : 1;
				ctx.beginPath();
				ctx.moveTo(sim.trailX[0], sim.trailY[0]);
				for (let i = stride; i < count; i += stride) {
					ctx.lineTo(sim.trailX[i], sim.trailY[i]);
				}
				const last = count - 1;
				if (last % stride !== 0) ctx.lineTo(sim.trailX[last], sim.trailY[last]);
				ctx.strokeStyle = RIVAL_TRAILS[rIdx];
				ctx.lineWidth = 1.4 * px;
				ctx.setLineDash(NO_DASH);
				ctx.stroke();
			}
			/* rival base diamond when parked at a planet */
			if (sim.status !== STATUS_FLYING && r.basePlanet >= 0) {
				const bx = tradeSim.planetX[r.basePlanet];
				const by = tradeSim.planetY[r.basePlanet];
				const br = tradeSim.planetR[r.basePlanet] + (6 + rIdx * 3.5) * px;
				ctx.beginPath();
				ctx.moveTo(bx, by - br);
				ctx.lineTo(bx + br, by);
				ctx.lineTo(bx, by + br);
				ctx.lineTo(bx - br, by);
				ctx.closePath();
				ctx.strokeStyle = colour;
				ctx.globalAlpha = 0.68;
				ctx.lineWidth = 1.15 * px;
				ctx.stroke();
				ctx.globalAlpha = 1;
			}
			/* rival ship chevron in flight or ring when ended */
			if (sim.status === STATUS_FLYING) {
				const x = sim.cargo.x;
				const y = sim.cargo.y;
				const angle = Math.atan2(sim.cargo.vy, sim.cargo.vx);
				const size = 4.3 * px;
				ctx.beginPath();
				ctx.moveTo(x + Math.cos(angle) * size, y + Math.sin(angle) * size);
				ctx.lineTo(x + Math.cos(angle + 2.4) * size, y + Math.sin(angle + 2.4) * size);
				ctx.lineTo(x + Math.cos(angle - 2.4) * size, y + Math.sin(angle - 2.4) * size);
				ctx.closePath();
				ctx.fillStyle = colour;
				ctx.fill();
				ctx.strokeStyle = 'rgba(3, 8, 16, 0.85)';
				ctx.lineWidth = 0.8 * px;
				ctx.stroke();
			} else if (sim.status === STATUS_ENDED) {
				const pulse = 0.5 + 0.5 * Math.sin(now * 0.005 + rIdx);
				ctx.beginPath();
				ctx.arc(sim.cargo.x, sim.cargo.y, (4.2 + pulse * 2.5) * px, 0, TAU);
				ctx.strokeStyle = colour;
				ctx.globalAlpha = 0.7;
				ctx.lineWidth = 1.1 * px;
				ctx.stroke();
				ctx.globalAlpha = 1;
			}
		}
	}

	/*
	 * Per-planet fly-visit profit pills drawn beneath each planet in game mode.
	 * Uses preallocated cent strings and predHarvestMask so draw() stays 0-alloc.
	 *
	 * Two greens: the systems the traced path will still enter, and — while a
	 * ship flies — the ones it is inside right now. The second set comes from
	 * the ledger's live inside-flags, not from the trace: the trace starts at
	 * the ship, so a system being harvested has already left its log, and the
	 * pill would go dark exactly when the money arrives. The flags are cleared
	 * by the same step that flies the ship out, so the pill drops on exit.
	 */
	function drawPlanetProfits() {
		const step = game.clockSteps;
		ctx.font = '600 10.5px ui-monospace, SFMono-Regular, Menlo, monospace';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const maxX = window.innerWidth - 42;
		const maxY = window.innerHeight - 18;
		for (let i = 0; i < PLANETS; i++) {
			if (!planetMask[i]) continue;
			const val = GravityGame.planetProfit(game.market, i, step);
			let cents = Math.round(val * 100);
			if (cents < 0) cents = 0;
			else if (cents > PROFIT_MAX_CENTS) cents = PROFIT_MAX_CENTS;
			const sx = tradeSim.planetX[i] * view.scale + view.offX;
			const sy = (tradeSim.planetY[i] + tradeSim.planetR[i]) * view.scale + view.offY + 11;
			let x = sx - 19;
			let y = sy - 7;
			if (x < 4) x = 4;
			else if (x > maxX) x = maxX;
			if (y < 4) y = 4;
			else if (y > maxY) y = maxY;
			const inside = liveHarvestMask[i] === 1;
			const onRoute = inside || predHarvestMask[i] === 1;
			const border = inside ? 'rgba(158, 255, 190, 0.95)'
				: onRoute ? 'rgba(92, 255, 139, 0.6)'
				: cents >= 100 ? 'rgba(255, 207, 110, 0.42)'
				: cents >= 50 ? 'rgba(142, 240, 192, 0.28)'
				: null;
			plate(x, y, 38, 14, border);
			ctx.fillStyle = inside ? '#ffffff' : onRoute ? '#9effbe'
				: cents >= 100 ? GOLD
				: cents >= 50 ? MINT
				: cents >= 14 ? 'rgba(210, 230, 246, 0.86)'
				: 'rgba(128, 156, 184, 0.52)';
			ctx.fillText(PROFIT_STRINGS[cents], x + 19, y + 7.5);
		}
	}

	/*
	 * Every player EMC is a claim ring around its planet plus its barrel, in
	 * the owner's colour (mint = YOU, the rival colours after it). The barrel
	 * turns once per 2…5 s of in-game career time and the queued launch fires
	 * when it lines up with the aim. While the career clock is paused the
	 * barrel holds its position. The neutral commercial rail shows only a dim
	 * barrel, so an unclaimed planet still reads as "you can leave from here".
	 */
	function drawCareerEmc() {
		const galaxy = game.galaxy;
		if (galaxy.actors.length === 0) return;
		const px = 1 / view.scale;
		/* career runs on in-game time: the clock is frozen while paused, so the
		 * barrel does not rotate then */
		const seconds = game.clockSteps * DT;
		for (let p = 0; p < PLANETS; p++) {
			if (!planetMask[p]) continue;
			const owner = GravityGame.claimOwner(galaxy, p);
			const x = tradeSim.planetX[p];
			const y = tradeSim.planetY[p];
			const r = tradeSim.planetR[p];
			const angle = GravityGame.turretAngle(galaxy, p, seconds);
			const cos = Math.cos(angle);
			const sin = Math.sin(angle);
			const inner = r + 3.5 * px;
			const outer = r + 13 * px;
			ctx.lineWidth = owner < 0 ? 1.2 * px : 2 * px;
			ctx.strokeStyle = owner < 0 ? 'rgba(150, 178, 204, 0.34)'
				: owner === 0 ? MINT : RIVAL_COLOURS[owner - 1];
			ctx.beginPath();
			ctx.moveTo(x + cos * inner, y + sin * inner);
			ctx.lineTo(x + cos * outer, y + sin * outer);
			ctx.stroke();
			if (owner < 0) continue;
			ctx.beginPath();
			ctx.arc(x, y, r + 6.5 * px, 0, TAU);
			ctx.globalAlpha = 0.5;
			ctx.lineWidth = 1.3 * px;
			ctx.stroke();
			ctx.globalAlpha = 1;
		}
	}

	/* pad plate under the landed planet: catapult tier, battery charge, speed cap.
	 * The string is cached so draw() stays 0-alloc; the key covers every input
	 * of that text, including ship mass and the force scale. */
	const padPlate = { key: -1, text: '', frac: 0, warn: false };

	function careerPadPlate(career) {
		const at = career.at;
		const pad = at >= 0 ? career.pads[at] : null;
		const tier = pad && pad.catapult ? pad.catapult.tier : 0;
		const mass = career.ship.mass;
		const key = ((((at + 1) * 16 + tier) * 200000 +
			(pad && pad.catapult ? Math.round(pad.chargeKwh * 100) : 0)) * 40000 +
			Math.round(mass * 100)) * 400 + Math.round(gravity.forceScale * 100);
		if (key === padPlate.key) return padPlate;
		padPlate.key = key;
		if (!pad) {
			padPlate.text = 'lost in space';
			padPlate.frac = 0;
			padPlate.warn = true;
			return padPlate;
		}
		if (!pad.catapult) {
			padPlate.text = planetName(at) + ' · no catapult';
			padPlate.frac = 0;
			padPlate.warn = true;
			return padPlate;
		}
		const limit = gravity.speedLimit(at);
		padPlate.text = pad.catapult.id + ' · ' + pad.chargeKwh.toFixed(2) + ' kWh · ' +
			Math.round(limit) + ' px/s';
		padPlate.frac = pad.chargeKwh / pad.battery.capacity;
		/* same rule the bot uses to repair a pad: can the ship even leave? */
		padPlate.warn = limit < GravitySim.SPEED_MIN + 1e-9;
		return padPlate;
	}

	function drawCareerPad() {
		const at = game.career.at;
		if (at < 0) return;
		const info = careerPadPlate(game.career);
		const width = 186;
		const height = 18;
		const sx = tradeSim.planetX[at] * view.scale + view.offX;
		const sy = tradeSim.planetY[at] * view.scale + view.offY;
		const radius = tradeSim.planetR[at] * view.scale + 8;
		const maxX = window.innerWidth - width - 6;
		const maxY = window.innerHeight - height - 6;
		/* below, above, right, left of the planet: the first slot clear of both HUD panels */
		let x = 0;
		let y = 0;
		for (let slot = 0; slot < 4; slot++) {
			x = sx - width * 0.5 + (slot === 2 ? radius : slot === 3 ? -radius - width : 0);
			y = sy - height * 0.5 + (slot === 0 ? radius : slot === 1 ? -radius - height : 0);
			if (x < 4) x = 4;
			else if (x > maxX) x = maxX;
			if (y < 4) y = 4;
			else if (y > maxY) y = maxY;
			if (!rectUnderHud(x, y, width, height)) break;
		}
		plate(x, y, width, height, info.warn ? 'rgba(255, 148, 120, 0.7)' : 'rgba(255, 207, 110, 0.34)');
		ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillStyle = info.warn ? WARN : GOLD;
		ctx.fillText(info.text, x + width * 0.5, y + 6.5);
		const frac = info.frac < 0 ? 0 : info.frac > 1 ? 1 : info.frac;
		ctx.fillStyle = 'rgba(140, 170, 200, 0.28)';
		ctx.fillRect(x + 5, y + 13, width - 10, 3);
		ctx.fillStyle = info.warn ? WARN : MINT;
		ctx.fillRect(x + 5, y + 13, (width - 10) * frac, 3);
	}

	function drawRivalTags() {
		ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const maxX = window.innerWidth - 26;
		const maxY = window.innerHeight - 18;
		for (let rIdx = 0; rIdx < bot.count; rIdx++) {
			const r = bot.rivals[rIdx];
			const flying = r.sim.status === STATUS_FLYING;
			const wx = flying ? r.sim.cargo.x : tradeSim.planetX[r.basePlanet];
			const wy = flying ? r.sim.cargo.y : tradeSim.planetY[r.basePlanet];
			let x = wx * view.scale + view.offX + (flying ? 8 : -11 + rIdx * 22);
			let y = wy * view.scale + view.offY - (flying ? 18 : tradeSim.planetR[r.basePlanet] * view.scale + 19);
			if (x < 4) x = 4;
			else if (x > maxX) x = maxX;
			if (y < 4) y = 4;
			else if (y > maxY) y = maxY;
			plate(x, y, 22, 13, RIVAL_COLOURS[rIdx]);
			ctx.fillStyle = RIVAL_COLOURS[rIdx];
			ctx.fillText(RIVAL_TAGS[rIdx], x + 11, y + 7);
		}
	}

	function draw(now) {
		if (viewMode === VIEW_FIELD && fieldRenderer) {
			if (fieldRenderer.backend() === 'lost') fieldLost();
			else {
				const prevDiv = fieldRenderer.scaleDiv();
				fieldRenderer.render(gravity, view, window.innerWidth, window.innerHeight,
					emaFrameMs > FPS_DROP_MS);
				if (fieldRenderer.scaleDiv() !== prevDiv) refreshViewUi();
			}
		}
		const blocked = activeBlockedPlanet(now);
		/* a paused career clock freezes every animation: ticks are drawn at the
	 * pause instant instead of wall clock (other modes keep animating) */
		const tickNow = careerRule() && careerPaused ? careerPauseNow : now;
		updateHarvestMasks();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
		ctx.save();
		ctx.translate(view.offX, view.offY);
		ctx.scale(view.scale, view.scale);
		drawSystemVisits(tickNow);
		if (careerRule()) drawCareerEmc();
		drawWells();
		drawPortVelocities();
		if (game.on && bot.count > 0) drawRivalsWorld(tickNow);
		drawPrediction();
		drawTrail();
		drawLandedBase(tickNow);
		if (blocked >= 0) {
			if (blockedKind === 1) drawOccupiedPlanetWorld(blocked);
			else drawBlockedArrowWorld(blocked, tickNow);
		}
		drawAim();
		drawCargo(tickNow);
		drawMarkers();
		drawSigns();
		ctx.restore();
		if (game.on && !routeRule()) drawPlanetProfits();
		if (careerRule()) drawCareerPad();
		if (game.on && bot.count > 0) drawRivalTags();
		if (hoverBody >= 0 && hoverBody !== selected && !aiming) {
			drawLabel(hoverLabel, gravity.bodyX[hoverBody],
				gravity.bodyY[hoverBody], ICE);
		}
		if (selected >= 0) {
			drawLabel(selectedLabel, gravity.bodyX[selected],
				gravity.bodyY[selected], GOLD,
				mode === MODE_PLANETS && (aiming || armed) && selected === aimBody);
		}
		const landed = activeSim().landedBody;
		if (landed >= 0 && !aiming &&
			!(mode === MODE_PLANETS && selected === landed)) {
			drawLabel('landed · launch here (' + planetName(landed) + ')',
				tradeSim.planetX[landed],
				tradeSim.planetY[landed], MINT);
		}
		if (blocked >= 0) drawBlockedTooltipScreen(blocked);
		drawGripLabel();
	}

	function formatClock(label, seconds) {
		const total = Math.floor(seconds * 10) / 10;
		const mins = Math.floor(total / 60);
		const secs = total - mins * 60;
		return label + ' + ' + (mins < 10 ? '0' : '') + mins + ':' +
			(secs < 10 ? '0' : '') + secs.toFixed(1);
	}

	function endText(reason, body) {
		if (reason === END_IMPACT) return 'impact ' + planetName(body);
		if (reason === END_EXIT) return 'left field';
		if (reason === END_TIME) return 'time cap';
		if (reason === END_TRUNCATED) return 'budget cap';
		if (reason === END_ABORT) return 'aborted';
		return 'open';
	}

	/* trajectory & visit readouts update immediately whenever changed */
	function updateLiveHud() {
		const sim = activeSim();
		const plan = activeRoutePlan();
		const guidedCareer = careerRule() && sim.predCount >= 2 &&
			(aiming || armed || burnAiming || burnArmed || sim.status === STATUS_FLYING);
		const economics = guidedCareer ? predictedCareerEconomics(sim) : null;
		aimGuidance = economics ? economics.state : 0;
		if (aimEl) {
			aimEl.classList.toggle('profitable', guidedCareer && aimGuidance === 1);
			aimEl.classList.toggle('neutral', guidedCareer && aimGuidance === 0);
			aimEl.classList.toggle('unlaunchable', guidedCareer && aimGuidance === 2);
		}
		if (predVisitEl) {
			predVisitEl.classList.toggle('profitable', guidedCareer && aimGuidance === 1);
			predVisitEl.classList.toggle('neutral', guidedCareer && aimGuidance === 0);
			predVisitEl.classList.toggle('unlaunchable', guidedCareer && aimGuidance === 2);
		}
		if (predProfitEl) {
			predProfitEl.classList.toggle('profitable', guidedCareer && aimGuidance === 1);
			predProfitEl.classList.toggle('neutral', guidedCareer && aimGuidance === 0);
			predProfitEl.classList.toggle('unlaunchable', guidedCareer && aimGuidance === 2);
		}
		const text = aiming || armed || burnAiming || burnArmed ? aimLabel : '—';
		if (text !== hudAimText) {
			hudAimText = text;
			aimEl.textContent = text;
			aimEl.title = text === '—' ? '' : text;
		}
		let tag = 'none selected';
		if (hoverBody >= 0 && !aiming) {
			tag = 'hover ' + bodyName(hoverBody) + ' · ' + strengthText(hoverBody);
		} else if (selected >= 0) tag = selectedLabel;
		if (tag !== hudTagText) {
			hudTagText = tag;
			bodyTagEl.textContent = tag;
		}
		const visitText = routeRule()
			? plan.ready ? Math.round(plan.length) + ' px'
				: sim.predCount >= 2 ? 'tracing…' : '—'
			: sim.visitedCount + ' / ' + planetCount;
		if (visitText !== hudVisitText) {
			hudVisitText = visitText;
			if (visitEl) visitEl.textContent = visitText;
		}
		/* the scoreboard pads/planets line: pads only exist in career */
		if (planetPadsLabelEl) planetPadsLabelEl.hidden = !careerRule();
		if (planetRowSepEl) planetRowSepEl.hidden = !careerRule();
		if (careerRule()) {
			const padsText = game.career.padCount + ' / ' + planetCount;
			if (padsText !== hudPadsText) {
				hudPadsText = padsText;
				if (padCountEl) padCountEl.textContent = game.career.padCount;
				if (padTotalEl) padTotalEl.textContent = planetCount;
			}
		}
		const predText = sim.predCount >= 2
			? routeRule()
				? sim.routeActive ? 'tracing…' : endText(sim.predReason, sim.predBody)
				: sim.predVisits + ' sys · +' + sim.predNewVisits +
					' (' + (sim.visitedCount + sim.predNewVisits) + '/' + planetCount + ')' +
					(game.on ? ' · ' + predProfitText(sim, economics) : '')
			: '—';
		if (predText !== hudPredVisitText) {
			hudPredVisitText = predText;
			if (predVisitEl) predVisitEl.textContent = predText;
		}
		const profitText = game.on && !routeRule() && sim.predCount >= 2
			? predProfitText(sim, economics) + ' · ' + predRateText(sim) +
				' · ' + sim.predTime.toFixed(1) + ' s' + predTickNote()
			: '—';
		if (profitText !== hudPredProfitText) {
			hudPredProfitText = profitText;
			if (predProfitEl) predProfitEl.textContent = profitText;
		}
		const lenText = sim.predCount >= 2 ? Math.round(sim.predLength) + ' px' : '—';
		if (lenText !== hudLengthText) {
			hudLengthText = lenText;
			lengthEl.textContent = lenText;
		}
		const pText = sim.predCount >= 2
			? sim.predTime.toFixed(1) + ' s · ' + (sim.routeActive
				? 'computing ' + Math.round(sim.routeProgress() * 100) + ' %'
				: endText(sim.predReason, sim.predBody))
			: '—';
		if (pText !== hudPathText) {
			hudPathText = pText;
			pathEl.textContent = pText;
		}
		const impulseOk = canImpulse();
		const locked = gameLocked();
		const trimOff = (locked && !(impulseOk && burnArmed)) ||
			(!armed && !(impulseOk && burnArmed) && (game.on || selected < 0));
		if (trimSlider.disabled !== trimOff) trimSlider.disabled = trimOff;
		const exitWarning = !routeRule() && (aiming || armed || burnAiming || burnArmed) &&
			sim.predCount >= 2 && sim.predReason === END_EXIT;
		setLaunchState(locked || !armed || !canAimFrom(aimBody), exitWarning);
	}

	function setLaunchState(blocked, exitWarning) {
		if (canImpulse()) {
			const ship = game.career.ship;
			const usedKg = burnArmed
				? OrbitTech.impulseFuel(burnDv, ship.engine, ship.mass, ship.fuelKg) : 0;
			const warnExit = burnArmed && exitWarning;
			const text = !burnPaused
				? 'impulse · max ' + gravity.burnLimit().toFixed(1) + ' px/s'
				: burnArmed
				? (warnExit ? 'burn · leaves map · ' : 'burn · Δv ') +
					burnDv.toFixed(1) + ' px/s (−' + usedKg.toFixed(1) + ' kg)'
				: 'resume · drag ship to burn';
			const state = 1024 + (burnPaused ? 2048 : 0) + (burnArmed ? 4096 : 0) +
				(warnExit ? 2 : 0);
			if (state === launchState && text === launchNote) return;
			launchState = state;
			launchNote = text;
			launchButton.hidden = false;
			if (planetActionsEl) planetActionsEl.hidden = true;
			launchButton.disabled = false;
			launchButton.classList.toggle('exitWarning', warnExit);
			launchButton.textContent = text;
			launchButton.title = !burnPaused
				? 'Pause flight to aim an impulse burn (Space / P, or drag from the ship)'
				: burnArmed
				? 'Execute impulse burn and resume flight (Enter) · Escape cancels burn'
				: 'Drag from the ship to aim a burn, or click / press Space to resume coasting';
			return;
		}
		if (turret.pending) {
			const left = Math.max(0, turret.fireAt - game.clockSteps) * DT;
			launchButton.hidden = false;
			if (planetActionsEl) planetActionsEl.hidden = true;
			launchButton.disabled = false;
			launchButton.classList.remove('costly', 'exitWarning');
			launchButton.textContent = 'gun · ' + left.toFixed(1) + ' s';
			launchButton.title = 'The EMC turns its barrel to the aim · click or Esc to cancel';
			launchState = -1;
			return;
		}
		const route = routeRule();
		const slot = activeSlotIndex();
		const botPlayer = slotIsBot(slot);
		const ledger = slotLedger(slot);
		const plan = slotPlans[slot];
		const career = careerRule();
		/* planet actions beside launch: build yours, fire the commercial rail
		 * that stands on every planet, or evacuate — shown whenever the career
		 * ship sits landed (lost in space keeps only the evacuation) */
		const c = game.career;
		const landed = career && c.ended === GravityGame.CAREER_OPEN &&
			gravity.status !== STATUS_FLYING;
		const showActions = landed && (c.at >= 0 || c.stranded);
		const commercialOn = showActions && c.at >= 0 && c.commercialPlanet === c.at;
		launchButton.hidden = showActions && c.at < 0;
		if (planetActionsEl) planetActionsEl.hidden = !showActions;
		if (showActions) {
			const waitBusy = careerWaitBusy();
			if (launchBuildBtn) {
				if (c.at < 0 || c.pads[c.at].catapult !== null) {
					launchBuildBtn.hidden = true;
				} else {
					const first = OrbitTech.CATAPULTS[0];
					const buildCost = careerCost(c, first.buildCost);
					const buildPoor = purseTooSmall(c, buildCost);
					const fresh = padCap(c, first, OrbitTech.BATTERIES[0]);
					launchBuildBtn.hidden = false;
					launchBuildBtn.disabled = buildPoor || waitBusy;
					launchBuildBtn.classList.toggle('costly', buildPoor);
					launchBuildBtn.textContent = 'buy ' + first.id + ' · ' + costText(buildCost);
					launchBuildBtn.title = 'build the first catapult on ' + planetName(c.at) +
						' · full battery lifts ' + c.ship.mass.toFixed(1) + ' t to ' +
						Math.round(fresh) + ' px/s';
				}
			}
			if (launchCommercialBtn) {
				if (c.at < 0) {
					launchCommercialBtn.hidden = true;
				} else {
					const fee = careerCost(c, GravityGame.CAREER.commercialFee);
					const lift = padCap(c, OrbitTech.CATAPULTS[0], OrbitTech.BATTERIES[0]);
					const canLift = lift + 1e-9 >= SPEED_MIN;
					const feePoor = purseTooSmall(c, fee);
					const armedHere = armed && aimBody === c.at;
					launchCommercialBtn.hidden = false;
					launchCommercialBtn.disabled = waitBusy || !canLift;
					launchCommercialBtn.classList.toggle('costly', feePoor);
					launchCommercialBtn.classList.toggle('on', commercialOn);
					launchCommercialBtn.textContent = commercialOn && armedHere
						? 'commercial launch · ' + costText(fee)
						: 'commercial EMC-1 · ' + costText(fee);
					launchCommercialBtn.title = !canLift
						? 'the commercial EMC-1 cannot lift ' + c.ship.mass.toFixed(1) +
							' t (max ' + Math.round(lift) + ' px/s)'
						: commercialOn
						? armedHere
							? 'fire the armed shot from the commercial EMC-1 for ' + costText(fee)
							: 'commercial EMC-1 selected · drag from ' + planetName(c.at) +
								' to aim · click again for the standing rail'
						: 'launch from the commercial EMC-1 on ' + planetName(c.at) +
							' · always charged · lifts the ship to ' + Math.round(lift) +
							' px/s · never claims the planet or blocks building yours';
				}
			}
			if (launchEvacBtn) {
				if (!c.stranded) {
					launchEvacBtn.hidden = true;
				} else {
					const evacCost = careerCost(c, GravityGame.CAREER.evacFee);
					const evacPoor = purseTooSmall(c, evacCost);
					launchEvacBtn.hidden = false;
					launchEvacBtn.disabled = waitBusy;
					launchEvacBtn.classList.toggle('costly', evacPoor);
					launchEvacBtn.textContent = 'evacuate · ' + costText(evacCost);
					launchEvacBtn.title = 'fly the ship home to HQ ' + planetName(c.hq) +
						' for ' + costText(evacCost);
				}
			}
		}
		const note = career ? careerOverText() || careerPadNote() : '';
		const broke = game.on && !route && (career ? note !== '' : ledger.purse < MONEY.cost);
		const state = (blocked || broke ? 1 : 0) + (exitWarning ? 2 : 0) +
			(broke ? 4 : 0) + (route ? 8 : 0) + (botPlayer ? 16 : 0) +
			(route && plan.ready ? 32 : 0) + (slot * 64) + (showActions ? 8192 : 0) +
			(commercialOn ? 16384 : 0) + (careerPaused ? 32768 : 0);
		const who = slotName(slot);
		const prefix = game.on && slot > 0 ? who + ' · ' : '';
		const text = route
			? plan.ready ? 'plan counts · no launch' : 'plan only · no launch'
			: botPlayer ? 'bot controls ' + who
			: broke
			? career ? note : 'purse ' + ledger.purse.toFixed(2) + ' · need ' + MONEY.cost.toFixed(2)
			: exitWarning ? prefix + 'launch · leaves system'
			: prefix + 'launch' + launchRideText(career ? c : null);
		/* the label carries live numbers (pad energy, rail fee), so the text
		 * itself is the change key, not only the state bits */
		if (state === launchState && text === launchNote) return;
		launchState = state;
		launchNote = text;
		launchButton.disabled = route || botPlayer || blocked || broke;
		launchButton.classList.toggle('exitWarning', exitWarning);
		/* only a missing launch fee is a price; a career pad note is a state gate */
		launchButton.classList.toggle('costly', broke && !career);
		launchButton.textContent = text;
		launchButton.title = route
			? 'Route is a planner: the finished traced trajectory is the entry'
			: botPlayer ? 'Clear bot in the ' + who + ' score row to aim and launch manually'
			: broke
			? career ? 'The pad cannot fire this shot' : 'The purse cannot cover a launch; this run is over'
			: exitWarning ? 'Warning: predicted trajectory ends outside the system'
			: launchRideTitle(career ? c : null);
	}

	/* What the armed shot spends: an own EMC draws its pad battery (kWh), a
	 * fallback rail - the commercial EMC-1 or a rival's pad - charges a price,
	 * and a non-career run pays the flat launch fee. */
	function launchRideText(career) {
		if (!career) return game.on ? ' · ' + MONEY.cost.toFixed(2) : '';
		if (aimBody < 0) return '';
		if (GravityGame.padOwner(career, aimBody) === career.index) {
			return ', ' + gravity.launchEnergy(aimBody, aimSpeed).toFixed(2) + ' kWh';
		}
		return ', ' + costText(GravityGame.launchFee(career, aimBody, aimSpeed));
	}

	function launchRideTitle(career) {
		if (!career || aimBody < 0) return '';
		if (GravityGame.padOwner(career, aimBody) === career.index) {
			const pad = career.pads[aimBody];
			return 'the shot drains ' + gravity.launchEnergy(aimBody, aimSpeed).toFixed(2) +
				' kWh of the ' + pad.catapult.id + ' battery (' + pad.chargeKwh.toFixed(2) + ' kWh charged)';
		}
		const owner = GravityGame.padOwner(career, aimBody);
		if (owner === GravityGame.OWNER_COMMERCIAL) {
			return 'the commercial EMC-1 charges ' +
				costText(GravityGame.launchFee(career, aimBody, aimSpeed)) + ' and never runs dry';
		}
		return 'a rival EMC lifts this shot for a ' +
			costText(GravityGame.launchFee(career, aimBody, aimSpeed)) +
			' usage tax and spends its own battery charge';
	}

	function statusText() {
		if (replay.on) {
			if (replay.route) return 'replay · tracing plan';
			return gravity.status === STATUS_FLYING ? 'replay · in flight' : 'replay · aiming';
		}
		const slot = activeSlotIndex();
		const sim = slotSim(slot);
		const plan = slotPlans[slot];
		const ledger = slotLedger(slot);
		const who = slotName(slot);
		const whoPrefix = game.on && slot > 0 ? who + ' · ' : '';
		if (routeRule()) {
			if (aiming) return whoPrefix + 'planning · ' + planetName(aimBody);
			if (sim.routeActive) {
				return whoPrefix + 'tracing plan · ' + Math.round(sim.routeProgress() * 100) + ' %';
			}
			if (routeLeader === -1 && routePlan.ready) {
				return 'leader · ' + (slotIsBot(0) ? 'BOT' : 'YOU') + ' · ' +
					Math.round(routePlan.length) + ' px';
			}
			if (routeLeader >= 0) {
				return 'leader · ' + RIVAL_TAGS[routeLeader] + ' · ' +
					Math.round(bot.rivals[routeLeader].routeLength) + ' px';
			}
			if (plan.ready) return 'tied lead · ' + Math.round(plan.length) + ' px';
			if (bot.routeThinking()) {
				return 'planning · ' + Math.round(bot.routeProgress() * 100) + ' %';
			}
			if (armed) return whoPrefix + 'plan has no landing or map exit';
			return slotIsBot(slot) ? 'bot plan ready' : whoPrefix + 'choose a free start planet';
		}
		if (slotIsBot(slot) && sim.status !== STATUS_FLYING) {
			if (flownRunLocked()) return playerGoalDone() ? 'bot run complete' : 'purse empty · run over';
			const actorIdx = slot === 0 ? GravityBot.PLAYER_INDEX : slot - 1;
			return bot.thinking() && bot.jobRival === actorIdx
				? who + ' · bot thinking ' + Math.round(bot.progress() * 100) + ' %'
				: who + ' · bot ready';
		}
		if (burnAiming) return 'aiming impulse · Δv ' + burnDv.toFixed(1) + ' px/s';
		if (burnArmed) return 'burn armed · Δv ' + burnDv.toFixed(1) + ' px/s';
		if (burnPaused) return 'flight paused · drag ship for impulse';
		if (aiming) return whoPrefix + 'aiming ' + planetName(aimBody);
		if (armed) return whoPrefix + 'armed · ' + planetName(aimBody);
		if (sim.status === STATUS_FLYING) {
			if (game.on && bot.thinking() && bot.jobRival !== GravityBot.PLAYER_INDEX) {
				return 'rival thinking ' + Math.round(bot.progress() * 100) + ' %';
			}
			return game.on ? whoPrefix + 'in flight · clock runs' : 'in flight';
		}
		if (game.on && playerGoalDone()) {
			return whoPrefix + (moneyRule() ? GravityGame.MONEY_SHOTS + ' shots complete' : 'tour complete');
		}
		const careerNote = careerRule() ? careerOverText() : '';
		if (careerNote) return careerNote;
		if (game.on && slotBroke(slot)) return whoPrefix + 'purse empty · run over';
		const rest = sim.status === STATUS_ENDED
			? endText(sim.endReason, sim.endBody)
			: sim.landedBody >= 0 ? 'landed ' + planetName(sim.landedBody) : 'ready';
		if (!game.on) return rest;
		const clockNote = careerRule() && !careerPaused ? ' · clock runs' : ' · clock paused';
		return whoPrefix + rest + clockNote;
	}

	function updateHud(now) {
		if (now - hudAt < HUD_INTERVAL) return;
		hudAt = now;
		const sim = activeSim();
		expClockEl.textContent = game.on
			? formatClock('game', game.clockSteps * DT)
			: formatClock('exp', (now - expStart) / 1000);
		statusEl.textContent = statusText();
		if (game.on) updateGameHud();

		if (sim.status === STATUS_IDLE) {
			flightEl.textContent = '—';
		} else {
			flightEl.textContent = sim.flightTime.toFixed(2) + ' s · ' +
				Math.round(sim.flightLength) + ' px';
		}

		calcEl.textContent = sim.predCount >= 2
			? sim.predSteps + ' steps · ' + sim.predMs.toFixed(2) + ' ms'
			: '—';

		if (burnArmed) trimTargetEl.textContent = 'burn Δv';
		else if (armed) trimTargetEl.textContent = 'aim speed';
		else if (selected >= 0) trimTargetEl.textContent = bodyName(selected) + ' g';
		else trimTargetEl.textContent = '—';
	}

	/* field clock and geometry follow the trade world; a game flight keeps its launch roster */
	function syncField() {
		gravity.fieldT = tradeSim.t;
		const rate = game.on ? scene.trade.speed : tradeRate();
		if (rate !== gravity.fieldRate) {
			gravity.fieldRate = rate;
			gravity.stepStale = true;
			if (!gravity.fieldStatic) fieldChanged();
			if (careerRule()) refreshCareerPanel();
		}
		const rosterLocked = game.on && clockDriverFlying();
		if (mode === MODE_PORTS && !rosterLocked && syncPortRoster()) fieldChanged();
		if (!gravity.fieldStatic) gravity.refreshField();
		if (game.on) {
			for (let i = 0; i < bot.count; i++) {
				if (bot.isRivalBot(i)) continue;
				const rSim = bot.rivals[i].sim;
				rSim.fieldT = tradeSim.t;
				if (rate !== rSim.fieldRate) {
					rSim.fieldRate = rate;
					rSim.stepStale = true;
				}
				if (!rSim.fieldStatic) rSim.refreshField();
			}
		}
	}

	function frame(now) {
		const frameStart = performance.now();
		const rawMs = now - lastFrame;
		if (rawMs > 0 && rawMs < 120) {
			emaFrameMs = emaFrameMs * 0.8 + rawMs * 0.2;
		}
		const dt = Math.min(0.1, rawMs / 1000);
		lastFrame = now;

		if (careerWaitBusy()) careerWaitTick(now);
		if (game.on) stepGame(now, dt);
		if (helperState.active) helperTick(HELPER_BUDGET_MS);
		syncField();
		if (!game.on) gravity.step(dt * playScale());
		if (soundFlightSim && soundFlightSim.status !== STATUS_FLYING) {
			sound.stopFlight();
			soundFlightSim = null;
		}
		syncSoundLoop();
		photoTick();

		/* adaptive 60 fps budget: update every frame at 60 fps, throttle if slower */
		const interval = emaFrameMs <= FPS_DROP_MS ? 1 : emaFrameMs < 25 ? 2 : 4;
		lastAutoInterval = interval;
		const budgetMs = emaFrameMs <= FPS_DROP_MS
			? GravitySim.BUDGET_MS
			: Math.max(2, FPS_FRAME_MS - otherWorkMs - 1.5);
		autoSkip = autoSkip > 0 ? autoSkip - 1 : 0;

		const sim = activeSim();
		const bodiesMoved = !sim.fieldStatic && sim.fieldT !== sim.predFieldT;
		if (armed || aiming) {
			if (!dirty && autoSkip === 0 && aimTraceStale(bodiesMoved)) {
				dirty = true;
				autoSkip = interval - 1;
			}
			if (dirty) {
				startAimTrace(budgetMs);
				refreshAimLabel();
				dirty = false;
			} else if (sim.routeActive) {
				sim.routeStep(ROUTE_STEP_MS);
				refreshPredGain();
				syncRoutePlan();
				rememberRouteBest();
				refreshAimLabel();
			} else if (armed && careerRule()) {
				recordArmedTrace();
			}
		} else if (sim.status === STATUS_FLYING) {
			if (burnAiming || burnArmed) {
				if (dirty) {
					sim.predictBurn(burnAngle, burnDv, budgetMs);
					refreshPredGain();
					refreshAimLabel();
					dirty = false;
				}
			} else if (dirty || (autoSkip === 0 && !burnPaused)) {
				sim.predictFlight(budgetMs);
				refreshPredGain();
				dirty = false;
				autoSkip = interval - 1;
			}
		} else if (sim.predCount > 0) {
			sim.predCount = 0;
			predGain = 0;
		}
		refreshLaunchList(false);

		const renderStart = performance.now();
		draw(now);
		updateLiveHud();
		updateHud(now);
		otherWorkMs = otherWorkMs * 0.8 + (performance.now() - renderStart) * 0.2;
		const frameWork = performance.now() - frameStart;
		if (frameWork > FPS_FRAME_MS) {
			emaFrameMs = Math.max(emaFrameMs, frameWork);
		}
		requestAnimationFrame(frame);
	}

	gravitySlider.addEventListener('input', () => {
		if (selected < 0) return;
		if (setBodyStrength(selected, Number(gravitySlider.value))) {
			refreshSelected();
			refreshHoverLabel();
			fieldChanged();
		}
	});
	if (viewSpaceEl) {
		viewSpaceEl.addEventListener('change', () => {
			if (viewSpaceEl.checked) setViewMode(VIEW_SPACE);
		});
	}
	if (viewFieldEl) {
		viewFieldEl.addEventListener('change', () => {
			if (viewFieldEl.checked) setViewMode(VIEW_FIELD);
		});
	}
	if (careerCleanEl) {
		careerCleanEl.addEventListener('change', () => {
			cleanCareerView = careerCleanEl.checked;
		});
	}
	srcPlanetsEl.addEventListener('change', () => setSource(MODE_PLANETS));
	srcPortsEl.addEventListener('change', () => setSource(MODE_PORTS));
	$('tradeSpeed').addEventListener('input', () => syncSeedUrl(replay.on));
	trimSlider.addEventListener('input', onTrimInput);
	trimSlider.addEventListener('change', resetTrim);
	if (expGravityEl) {
		expGravityEl.addEventListener('input', onExperimentInput);
		expGravityEl.addEventListener('change', onExperimentChange);
	}
	if (expForceEl) {
		expForceEl.addEventListener('input', onExperimentInput);
		expForceEl.addEventListener('change', onExperimentChange);
	}
	if (expHarvestEl) expHarvestEl.addEventListener('change', onHarvestChange);
	horizonSlider.addEventListener('input', () => {
		gravity.horizon = Number(horizonSlider.value);
		const text = gravity.horizon + ' s';
		horizonLabel.textContent = text;
		if (horizonTagEl) horizonTagEl.textContent = text;
		fieldChanged();
		hudAt = -Infinity;
	});
	launchButton.addEventListener('click', launch);
	routeBestBtn.addEventListener('click', restoreRouteBest);
	if (helperScanBtn) helperScanBtn.addEventListener('click', helperStartBroad);
	if (helperFocusBtn) helperFocusBtn.addEventListener('click', helperStartFocus);
	if (helperTweakBtn) helperTweakBtn.addEventListener('click', helperStartTweak);
	if (helperProfitBtn) helperProfitBtn.addEventListener('click', () => helperStartProfit(false));
	if (helperEmcBtn) helperEmcBtn.addEventListener('click', () => helperStartProfit(true));
	if (helperStopBtn) helperStopBtn.addEventListener('click', helperStop);
	clearButton.addEventListener('click', () => {
		if (helperState.active) { helperStop(); return; }
		if (playerIsBot()) return;
		if (routeRule()) clearRoutePlan();
		else if (!game.on) clearCargo();
	});
	/* the flat mode row replaces the old mode + rule groups */
	for (let mIdx = 0; mIdx < modeEls.length; mIdx++) {
		const el = modeEls[mIdx][1];
		if (!el) continue;
		const value = modeEls[mIdx][0];
		el.addEventListener('change', () => {
			if (el.checked) setPlayMode(value);
		});
	}
	if (careerBoxEl) {
		careerBoxEl.addEventListener('click', event => {
			const data = careerEventData(event);
			if (data) careerAct(data);
		});
		careerBoxEl.addEventListener('input', event => {
			const node = event && event.target;
			if (node && node.dataset && node.dataset.sciAxis) scienceSliderInput(node);
		});
	}
	if (careerWaitBtn) careerWaitBtn.addEventListener('click', () => careerAct({ act: 'wait' }));
	if (careerEvacBtn) careerEvacBtn.addEventListener('click', () => careerAct({ act: 'evac' }));
	if (launchBuildBtn) {
		launchBuildBtn.addEventListener('click', () => {
			if (!careerRule() || careerWaitBusy() || gravity.status === STATUS_FLYING) return;
			const career = game.career;
			if (career.ended !== GravityGame.CAREER_OPEN || career.at < 0 ||
				career.pads[career.at].catapult !== null) return;
			careerFollow = true;
			careerBuild(career, career.at, OrbitTech.KIND_CATAPULT, OrbitTech.CATAPULTS[0]);
		});
	}
	if (launchCommercialBtn) {
		launchCommercialBtn.addEventListener('click', () => {
			if (!careerRule() || careerWaitBusy() || gravity.status === STATUS_FLYING) return;
			const career = game.career;
			if (career.ended !== GravityGame.CAREER_OPEN || career.at < 0) return;
			if (career.commercialPlanet === career.at) {
				/* selected and armed: the button is the commercial launch itself */
				if (armed && aimBody === career.at) {
					launch();
					return;
				}
				GravityGame.setCommercial(career, -1);
				careerNotice('standing rail on ' + planetName(career.at));
			} else {
				GravityGame.setCommercial(career, career.at);
				careerNotice('commercial EMC-1 · ' + planetName(career.at) + ' · drag to aim');
			}
			/* the drag range follows the newly selected rail's ceiling */
			if ((armed || aiming) && aimBody === career.at) {
				placeGripFromSpeed();
				dirty = true;
			}
			launchState = -1;
			careerChanged();
		});
	}
	if (launchEvacBtn) {
		launchEvacBtn.addEventListener('click', () => careerAct({ act: 'evac' }));
	}
	if (careerClockBtn) {
		careerClockBtn.addEventListener('click', () => {
			if (careerRule()) setCareerPaused(!careerPaused);
		});
	}
	if (careerPauseLandEl) {
		careerPauseLandEl.addEventListener('change', () => {
			pauseOnLanding = careerPauseLandEl.checked;
			/* apply at once while landed, so the setting is never a surprise */
			if (careerRule() && gravity.status !== STATUS_FLYING) {
				setCareerPaused(pauseOnLanding);
			}
			refreshCareerClockUi();
		});
	}
	if (careerPlanetEl) {
		const pickPlanet = () => {
			careerFollow = false;
			refreshCareerPanel();
		};
		careerPlanetEl.addEventListener('change', pickPlanet);
		careerPlanetEl.addEventListener('input', pickPlanet);
	}
	for (let rIdx = 0; rIdx < modeEls.length; rIdx++) {
		const el = modeEls[rIdx][1];
		if (!el) continue;
		const targets = el.parentElement && el.parentElement !== el
			? [el, el.parentElement] : [el];
		for (let tIdx = 0; tIdx < targets.length; tIdx++) {
			const target = targets[tIdx];
			target.addEventListener('pointerdown', () => beginRuleHelpHold(el.value));
			target.addEventListener('pointerup', endRuleHelpHold);
			target.addEventListener('pointercancel', endRuleHelpHold);
		}
		const hoverTarget = targets[targets.length - 1];
		hoverTarget.addEventListener('pointerenter', event => {
			if (event.pointerType !== 'touch') showRuleHelp(el.value, false);
		});
		hoverTarget.addEventListener('pointerleave', () => {
			if (helpPinned) updateRuleHelp(selectedHelpRule());
			else if (!ruleHelpHold) setHelpOpen(false, true);
		});
		el.addEventListener('focus', () => showRuleHelp(el.value, false));
		el.addEventListener('blur', () => {
			if (helpPinned) updateRuleHelp(selectedHelpRule());
			else if (!ruleHelpHold) setHelpOpen(false, true);
		});
	}
	function isBotControlTarget(slot, target) {
		if (!target) return false;
		const box = scoreBotEls[slot];
		const lbl = scoreBotLabelEls[slot];
		if (target === box || target === lbl) return true;
		return Boolean(box && box.parentElement && target === box.parentElement);
	}

	for (let s = 0; s < scoreRowEls.length; s++) {
		const row = scoreRowEls[s];
		const box = scoreBotEls[s];
		const lbl = scoreBotLabelEls[s];
		const stopRowSelect = event => {
			if (event && event.stopPropagation) event.stopPropagation();
		};
		if (box) {
			box.addEventListener('click', stopRowSelect);
			box.addEventListener('change', () => {
				setSlotType(s, box.checked ? PLAYER_BOT : PLAYER_USER);
			});
			if (box.parentElement && box.parentElement !== row) {
				box.parentElement.addEventListener('click', stopRowSelect);
			}
		}
		if (lbl) lbl.addEventListener('click', stopRowSelect);
		if (!row) continue;
		row.addEventListener('click', event => {
			if (isBotControlTarget(s, event && event.target)) return;
			selectUserSlot(s);
		});
		row.addEventListener('keydown', event => {
			if (!event || isBotControlTarget(s, event.target)) return;
			if (event.key !== 'Enter' && event.key !== ' ') return;
			if (event.preventDefault) event.preventDefault();
			selectUserSlot(s);
		});
	}
	if (botOffEl) botOffEl.addEventListener('change', () => setBot(BOT_OFF));
	if (botEasyEl) botEasyEl.addEventListener('change', () => setBot(BOT_EASY));
	if (botNormalEl) botNormalEl.addEventListener('change', () => setBot(BOT_NORMAL));
	if (botHardEl) botHardEl.addEventListener('change', () => setBot(BOT_HARD));
	/* the number input sets the run's planet count; +/- in the scoreboard set
	 * how many players share it. Both restart the run so the world rebuilds */
	if (planetCountInputEl) {
		planetCountInputEl.addEventListener('change', () => {
			const value = Math.round(Number(planetCountInputEl.value));
			if (!Number.isFinite(value) || !setPlanetUniverseSize(value)) {
				planetCountInputEl.value = planetCount;
			}
		});
	}
	if (playerCountDownEl) playerCountDownEl.addEventListener('click', () => setPlayerCount(-1));
	if (playerCountUpEl) playerCountUpEl.addEventListener('click', () => setPlayerCount(1));
	gameRestartBtn.addEventListener('click', () =>
		startGame(game.seed, game.fixedRate, undefined, undefined, undefined, game.cheat));
	gameNewSeedBtn.addEventListener('click', () => {
		startGame(1 + Math.floor(Math.random() * SEED_RANGE), false);
	});
	gameCopyBtn.addEventListener('click', copyLink);
	if (botCopyBtn) botCopyBtn.addEventListener('click', copyBotLink);
	if (botLogBtn) botLogBtn.addEventListener('click', copyBotLog);
	if (botLogCloseBtn) botLogCloseBtn.addEventListener('click', hideBotLog);
	replaySpeedBtn.addEventListener('click', () => {
		replay.speed = (replay.speed + 1) % REPLAY_SPEEDS.length;
		refreshGameUi();
	});
	replaySkipBtn.addEventListener('click', skipReplay);
	playSlowerBtn.addEventListener('click', () => stepPlayback(-1));
	playFasterBtn.addEventListener('click', () => stepPlayback(1));
	playResetBtn.addEventListener('click', resetPlayback);
	window.addEventListener('hashchange', loadLink);
	if (helpBtn) {
		helpBtn.addEventListener('click', () => setHelpOpen(!helpPinned));
		helpBtn.addEventListener('pointerenter', event => {
			if (event.pointerType !== 'touch') showRuleHelp(selectedHelpRule(), false);
		});
		helpBtn.addEventListener('pointerleave', () => {
			if (!helpPinned) setHelpOpen(false, true);
		});
	}
	function bindFold(btn, panel) {
		if (!btn || !panel) return;
		btn.addEventListener('click', () => {
			const folded = !panel.classList.contains('folded');
			panel.classList.toggle('folded', folded);
			if (panel === cargoHudEl) hudFolded = folded;
			btn.textContent = folded ? '+' : '−';
			btn.title = folded ? 'expand panel' : 'minimize panel';
			if (btn.setAttribute) btn.setAttribute('aria-expanded', folded ? 'false' : 'true');
			measureHudRects();
		});
	}
	bindFold(foldBtn, cargoHudEl);
	bindFold(scoreFoldBtn, scoreHudEl);
	bindFold(careerFoldBtn, careerHudEl);
	bindFold(tradeFoldBtn, $('tradeHud'));
	if (helpClose) helpClose.addEventListener('click', () => setHelpOpen(false));
	function refreshSoundToggle() {
		if (!soundToggle) return;
		soundToggle.textContent = soundEnabled ? 'sound on' : 'sound off';
		soundToggle.setAttribute('aria-pressed', soundEnabled ? 'true' : 'false');
	}
	refreshSoundToggle();
	if (soundToggle) soundToggle.addEventListener('click', () => {
		soundEnabled = !soundEnabled;
		sound.setEnabled(soundEnabled);
		refreshSoundToggle();
		try { root.localStorage.setItem('gravity-sound-enabled', String(soundEnabled)); }
		catch (err) { /* Sound still works without persistent preferences. */ }
	});
	window.addEventListener('blur', () => sound.setActive(false));
	window.addEventListener('focus', () => sound.setActive(true));
	if (document.addEventListener) document.addEventListener('visibilitychange', () => {
		sound.setActive(!document.hidden);
	});
	window.addEventListener('pointerdown', onPointerDown);
	window.addEventListener('pointermove', onPointerMove);
	window.addEventListener('pointerup', onPointerUp);
	window.addEventListener('pointercancel', onPointerUp);
	window.addEventListener('resize', () => {
		resizeOverlay();
		if (root.PhotoDeck) root.PhotoDeck.layout();
	});
	if (root.visualViewport && root.visualViewport.addEventListener) {
		root.visualViewport.addEventListener('resize', resizeOverlay);
	}
	const tradeControlsEl = $('tradeControls');
	if (typeof root.ResizeObserver === 'function' && tradeControlsEl) {
		const footObserver = new root.ResizeObserver(() => {
			reserveTradeFooter();
			measureHudRects();
		});
		footObserver.observe(tradeControlsEl);
		if (cargoFootEl) footObserver.observe(cargoFootEl);
	}
	window.addEventListener('keydown', event => {
		sound.unlock();
		if (event.key === 'Shift') {
			fine = true;
			refreshAimLabel();
			return;
		}
		if (event.key === '?' || (event.code === 'KeyH' && !event.ctrlKey && !event.metaKey)) {
			const tag = event.target && event.target.tagName;
			if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
				setHelpOpen(!helpOpen);
				return;
			}
		}
		if (event.code === 'KeyF' && !event.ctrlKey && !event.metaKey && !event.altKey) {
			const tag = event.target && event.target.tagName;
			if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
				setViewMode(viewMode === VIEW_FIELD ? VIEW_SPACE : VIEW_FIELD);
				return;
			}
		}
		if ((event.code === 'Space' || event.code === 'KeyP') &&
			!event.ctrlKey && !event.metaKey && !event.altKey) {
			const tag = event.target && event.target.tagName;
			if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' &&
				careerRule() && !replay.on && gravity.status === STATUS_FLYING) {
				if (event.preventDefault) event.preventDefault();
				if (canImpulse()) setBurnPaused(!burnPaused);
				else {
					careerNotice(game.career.ship.engine
						? 'fuel tank empty' : 'no impulse engine fitted · refit at HQ');
				}
				return;
			}
		}
		if (event.code === 'Enter') {
			if (burnPaused && burnArmed && canImpulse()) {
				if (event.preventDefault) event.preventDefault();
				executeBurn();
				return;
			}
			if (!armed) return;
			event.preventDefault();
			launch();
			return;
		}
		if (event.code === 'Escape') {
			if (helpOpen) setHelpOpen(false);
			else if (burnAiming || burnArmed) {
				burnAiming = false;
				burnArmed = false;
				savedBurnArmed = false;
				dirty = true;
				refreshAimLabel();
				launchState = -1;
				hudAt = -Infinity;
			} else if (burnPaused) setBurnPaused(false);
			else if (!replay.on) cancelAim();
		}
	});
	window.addEventListener('keyup', event => {
		if (event.key !== 'Shift') return;
		fine = false;
		refreshAimLabel();
	});

	root.GravityScene = {
		sim: gravity,
		sound: sound,
		activeSim: activeSim,
		bot: bot,
		game: game,
		career: game.career,
		replay: replay,
		playScale: playScale,
		playIndex: () => playIndex,
		scoreSteps: scoreSteps,
		startGame: startGame,
		stopGame: stopGame,
		loadLink: loadLink,
		rule: () => game.rule,
		botLevel: () => game.bot,
		playerType: () => game.player,
		slotType: slot => slotTypes[slot],
		setSlotType: setSlotType,
		activeSlot: () => activeSlotIndex(),
		selectUserSlot: selectUserSlot,
		careerAct,
		careerWait,
		careerPaused: () => careerPaused,
		setCareerPaused,
		pauseOnLanding: () => pauseOnLanding,
		careerNotice,
		careerPickPlanet,
		refreshCareerPanel,
		waitSettlement: () => (game.career ? waitSettlement(game.career) : null),
		viewMode: () => viewMode,
		setViewMode,
		cleanCareerView: () => cleanCareerView,
		fieldRenderer: () => fieldRenderer,
		playMode: () => (game.on ? game.rule : PLAY_LAB),
		setPlayMode,
		setPlayerCount,
		setPlanetUniverseSize,
		planetCount: () => planetCount,
		freePlanetCount: freePlanetCount,
		predGain: () => predGain,
		aimGuidance: () => aimGuidance,
		predTime: () => activeSim().predTime,
		speedCeiling,
		experimentScales: () => ({ gravity: gravityScale, force: forceScale }),
		/* the profit-pill highlight: systems a flying ship is inside vs the ones
		 * the traced path ahead will enter */
		harvestMarks: () => ({ inside: liveHarvestMask, route: predHarvestMask }),
		careerPadInfo: () => (game.career ? careerPadPlate(game.career) : null),
		aimState: () => ({ angle: aimAngle, speed: aimSpeed, grip: gripLen, ceiling: aimCeiling }),
		burnPaused: () => burnPaused,
		setBurnPaused,
		burnState: () => ({
			paused: burnPaused, armed: burnArmed,
			angle: burnAngle, dv: burnDv, grip: gripLen, ceiling: burnCeiling
		}),
		startReplay,
		routeLength: () => activeRoutePlan().length,
		routePlan: activeRoutePlan,
		routeBest: activeRouteBest,
		routeOccupiedBy: routeOccupiedBy,
		setHelpOpen: setHelpOpen,
		helpOpen: () => helpOpen,
		helpRule: () => helpRule,
		autoInterval: () => lastAutoInterval
	};

	for (let s = 0; s < scoreBotEls.length; s++) {
		if (scoreBotEls[s]) {
			slotTypes[s] = scoreBotEls[s].checked ? PLAYER_BOT : PLAYER_USER;
		}
	}
	game.player = slotTypes[0];

	refreshPlaybackUi();
	if (careerCleanEl) cleanCareerView = careerCleanEl.checked;
	if (careerPauseLandEl) pauseOnLanding = careerPauseLandEl.checked;
	refreshCareerClockUi();
	gravity.horizon = Number(horizonSlider.value);
	horizonLabel.textContent = gravity.horizon + ' s';
	if (horizonTagEl) horizonTagEl.textContent = gravity.horizon + ' s';

	if (botOffEl && botOffEl.checked) game.bot = BOT_OFF;
	else if (botEasyEl && botEasyEl.checked) game.bot = BOT_EASY;
	else if (botHardEl && botHardEl.checked) game.bot = BOT_HARD;
	else game.bot = BOT_NORMAL;

	mode = srcPortsEl.checked ? MODE_PORTS : MODE_PLANETS;
	gravity.fieldT = tradeSim.t;
	gravity.fieldRate = tradeRate();
	updateRuleHelp(selectedHelpRule());
	initPlanetUniverse(PLANET_DEFAULT);
	applyPlanetUniverse();
	attachWorld();
	refreshExperimentUi();
	const initialView = new URLSearchParams(location.search).get('view');
	if (initialView === VIEW_FIELD || initialView === VIEW_SPACE) setViewMode(initialView);
	if (!loadLink() && !loadSearchParams()) {
		const last = loadLastMode();
		if (last) setPlayMode(last);
		else refreshGameUi();
		syncSeedUrl();
	}

	resizeOverlay();
	refreshSelected();
	refreshAimLabel();
	updateLiveHud();
	updateHud(performance.now());
	requestAnimationFrame(frame);
})(typeof globalThis !== 'undefined' ? globalThis : this);

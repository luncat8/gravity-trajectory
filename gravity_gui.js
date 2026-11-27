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
	 * Sections are indexed in place: grep -n '── ' gravity_gui.js lists every area,
	 * each naming what it holds and the file it is slated to move into (0.5 plan).
 */
'use strict';

/* ── composer state · gravity_gui.js ── shared sims, every element ref, the game/replay/helperState/sound objects, slot factories */
const scene = root.OrbitScene;
const tradeSim = scene.sim;
const view = scene.view;
const cargoSim = new GravitySim(OrbitSim.WORLD_W, OrbitSim.WORLD_H);
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
	let changed = cargoSim.setCount(tradeSim.portCount);
	for (let p = 0; p < tradeSim.portCount; p++) {
		const planet = tradeSim.portPlanet[p];
		if (fieldPortPlanet[p] !== planet) {
			fieldPortPlanet[p] = planet;
			portStrength[p] = planetMask[planet] ? portPlanetStrength[planet] : 0;
			changed = true;
		}
	}
	if (selected >= cargoSim.bodyCount) setSelected(-1);
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
const aimEl = $('aimReadout');
const pathEl = $('pathReadout');
const lengthEl = $('lengthReadout');
const calcEl = $('calcReadout');
const bodyTagEl = $('bodyTag');
const viewTagEl = $('viewTag');
const viewSpaceEl = $('viewSpace');
const viewFieldEl = $('viewField');
const viewPotentialEl = $('viewPotential');
const viewFullEl = $('viewFull');
const potentialLegendEl = $('potentialLegend');
const zoneBarEl = $('zoneBar');
const careerCleanEl = $('careerClean');
const trailViewEl = $('trailView');
const predViewEl = $('predView');
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
const expWearEl = $('expWear');
const expWearLabelEl = $('expWearLabel');
const expPadsEl = $('expPads');
const expPadsLabelEl = $('expPadsLabel');
const expRotEl = $('expRot');
const expRotLabelEl = $('expRotLabel');
const expPayEl = $('expPay');
const expPayLabelEl = $('expPayLabel');
const expHarvestEl = $('expHarvest');
const expFleetEl = $('expFleet');
const expTagEl = $('expTag');
const giftBlockEl = $('giftBlock');
const giftAllEl = $('giftAll');
const giftBotEl = $('giftBot');
const giftHumanEl = $('giftHuman');
const giftAllLabelEl = $('giftAllLabel');
const giftBotLabelEl = $('giftBotLabel');
const giftHumanLabelEl = $('giftHumanLabel');
const giftPeekEl = $('giftPeek');
const giftPreviewEl = $('giftPreview');
const launchButton = $('launch');
const launchMenuBtn = $('launchMenuBtn');
const launchMenuEl = $('launchMenu');
const launchRepairBtn = $('launchRepair');
const launchOnlyBtn = $('launchOnly');
const planetActionsEl = $('planetActions');
const launchBuildBtn = $('launchBuild');
const launchCommercialBtn = $('launchCommercial');
const launchEvacBtn = $('launchEvac');
const clearButton = $('clear');
const routeBestBtn = $('routeBest');
const leftHudEl = $('leftHud');
const cargoHudEl = $('cargoHud');
const careerHudEl = $('careerHud');
const bodyGroupEl = $('bodyGroup');
const horizonGroupEl = $('horizonGroup');
const playbackGroupEl = $('playbackGroup');
const helpBtn = $('helpBtn');
const soundToggle = $('soundToggle');
const soundEngineEl = $('soundEngine');
const soundAimEl = $('soundAim');
const soundFlightEl = $('soundFlight');
const soundVoronoiPresetEl = $('soundVoronoiPreset');
const soundVoronoiPresetControlEl = $('soundVoronoiPresetControl');
const soundDistanceEl = $('soundDistance');
const soundDistanceLabelEl = $('soundDistanceLabel');
const soundDistanceControlEl = $('soundDistanceControl');
const soundVolumeEl = $('soundVolume');
const soundVolumeLabelEl = $('soundVolumeLabel');
const soundSettingsTagEl = $('soundSettingsTag');
const soundHintEl = $('soundHint');
const trajectorySoundOptionsEl = $('trajectorySoundOptions');
function readSoundChoice(key, fallback, choices) {
	try {
		const value = root.localStorage.getItem(key);
		return choices.indexOf(value) >= 0 ? value : fallback;
	} catch (err) { return fallback; }
}
let soundEnabled = true;
try { soundEnabled = root.localStorage.getItem('gravity-sound-enabled') !== 'false'; }
catch (err) { /* localStorage can be unavailable on file://. */ }
let soundVolumePct = 45;
try {
	const stored = root.localStorage.getItem('gravity-sound-volume');
	const value = Number(stored);
	if (stored !== null && Number.isFinite(value) && value >= 0 && value <= 100) soundVolumePct = value;
} catch (err) { /* default volume */ }
let soundDistanceScale = root.GravityVoronoiSound.DEFAULT_DISTANCE_SCALE;
try {
	const stored = root.localStorage.getItem('gravity-sound-distance-scale');
	const value = Number(stored);
	if (stored !== null && Number.isFinite(value) && value >= 0.25 && value <= 2) soundDistanceScale = value;
} catch (err) { /* default distance scale */ }
const sound = root.GravitySound.createController({
	enabled: soundEnabled && !liteMode,
	volume: soundVolumePct / 100,
	distanceScale: soundDistanceScale,
	voronoiPreset: readSoundChoice('gravity-sound-voronoi-preset', 'point', ['point', 'distance']),
	engine: readSoundChoice('gravity-sound-engine', 'voronoi', ['voronoi', 'trajectory', 'samples', 'fallback']),
	aimMode: readSoundChoice('gravity-sound-aim', 'outcome', ['outcome', 'flythrough']),
	flightMode: readSoundChoice('gravity-sound-flight', 'pentatonic', ['pentatonic', 'instrument'])
});
let soundFlightSim = null;
const aimSoundState = { sim: null, ready: false, tracing: false, hasProfit: false,
	profit: 0, length: 0, destination: -1,
	aimBody: -1, aimAngle: 0, aimSpeed: 0, aimCeiling: 0,
	emcKnown: false, emcReady: true, emcTier: 0, emcSpeed: 0 };
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
const careerFleetEl = $('careerFleet');
const careerPadEl = $('careerPad');
const careerShopEl = $('careerShop');
const careerScienceEl = $('careerScience');
const careerTaskEl = $('careerTasks');
const careerLaunchListEl = $('careerLaunchList');
const careerWaitInfoEl = $('careerWaitInfo');
const careerWaitBtn = $('careerWait');
const careerClockBtn = $('careerClock');
const careerPauseLandEl = $('careerPauseLand');
const careerPauseLandLabelEl = $('careerPauseLandLabel');
const careerAutoRepairEl = $('careerAutoRepair');
const careerAutoRepairLabelEl = $('careerAutoRepairLabel');

const careerMsgEl = $('careerMsg');
const ruleTagEl = $('ruleTag');
const scoreHudEl = $('scoreHud');
const statsStripEl = $('statsStrip');
const statsPlotsEl = $('statsPlots');
const scoreRuleTagEl = $('scoreRuleTag');
const goalRoleEl = $('goalRole');
const playerScoreMetaEl = $('playerScoreMeta');
const scoreBotEls = [$('playerBot')];
const scoreBotLabelEls = [$('scoreBotLabel0')];
const rivalScoreRows = [];
const rivalScoreEls = [];
const rivalMetaEls = [];
for (let i = 1; i < MAX_PLAYERS; i++) {
	scoreBotEls.push($('rivalBot' + i));
	scoreBotLabelEls.push($('scoreBotLabel' + i));
	rivalScoreRows.push($('scoreRival' + i));
	rivalScoreEls.push($('rivalScore' + i));
	rivalMetaEls.push($('rivalMeta' + i));
}
const rivalTagEl = $('rivalTag');
const playerBotEl = scoreBotEls[0];
const botOffEl = $('botOff');
const botEasyEl = $('botEasy');
const botNormalEl = $('botNormal');
const botHardEl = $('botHard');
const startRowEl = $('startRow');
const playerCountRowEl = $('playerCountRow');
const planetRowEl = $('planetRow');
const startEls = [
	[GravityGame.START_PLANET, $('startPlanet')],
	[GravityGame.START_SPACE, $('startSpace')],
	[GravityGame.START_CAPITAL, $('startCapital')]
];
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
const careerSaveCopyBtn = $('careerSaveCopy');
const botCopyBtn = $('botCopy');
const botLogBtn = $('botLog');
const gameHudEl = $('gameHud');
const gameClockEl = $('gameClock');
const gameShotsEl = $('gameShots');
const gameFlightsEl = $('gameFlights');
const gamePadsEl = $('gamePads');
const gameFoldBtn = $('gameFoldBtn');
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
const helperQuestBtn = $('helperQuest');
const helperPlanQuestBtn = $('helperPlanQuest');
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
/* career clean canvas: hides the own past-flight trail + thick orbit visit
 * highlights — the own layer only, other players have their own checkboxes */
/* view checkboxes remembered across visits, like the last mode */
const CLEAN_STORAGE = 'gravity.cleanRender';
const TRAILS_STORAGE = 'gravity.trails';
function loadViewFlag(key, fallback) {
	try {
		const value = root.localStorage.getItem(key);
		return value === null ? fallback : value === '1';
	} catch (e) { return fallback; }
}
function saveViewFlag(key, on) {
	try { root.localStorage.setItem(key, on ? '1' : '0'); }
	catch (e) { /* private mode */ }
}
let cleanCareerView = loadViewFlag(CLEAN_STORAGE, true);
/* other players' past-flight trails (0.7.51): their own checkbox, every mode */
let trailRivalsOn = loadViewFlag(TRAILS_STORAGE, true);
/* other players' predicted trajectories (0.7.51): their own checkbox, every
 * mode — career alone locks it until the selected company's HQ holds the
 * radar, and the build ticks it; hovering or pressing a rival ship reveals
 * that one ship even with the box off */
let predRivalsOn = false;
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
let burnAiming = false;
let burnArmed = false;
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
/* experimental gravity, rail force, career space ageing, pads, rot, pay and stay-pay */
let gravityScale = 1;
let forceScale = 1;
let spaceWearScale = 1;
let padScale = 1;
let rotScale = 1;
let payScale = 1;
let harvestTick = false;
/* start-gift budgets (cr) for the next career start; `game.gift*` holds the running one's */
let giftAll = 0;
let giftBot = 0;
let giftHuman = 0;
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
const aimEconomics = { state: 0, launchable: true, fee: 0, fuel: 0, repair: 0, wear: 0, exit: 0, net: 0, gain: 0,
	source: '', speed: 0, tier: 0, own: false };
let launchState = -1;
let launchNote = '';
/* the menu's repair price in cents: part of the launch control's change key */
let launchRepairCents = -1;
let linkNote = '';
/* the mode's default rung; `defaultPlayIndex` reads the rule, which boots as lab */
let playIndex = PLAY_INDEX_LAB;
/* partial game slice carried between frames, so 0.25 and 32 both stay smooth */
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
	startMode: GravityGame.START_PLANET,
	gravityScale: 1, forceScale: 1, spaceWearScale: 1, padScale: 1, rotScale: 1, payScale: 1, harvestTick: false,
	giftAll: 0, giftBot: 0, giftHuman: 0,
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
const PLANET_CAREER_DEFAULT = 16;
const PLANET_DEFAULT = OrbitWorld.DEFAULT_PLANETS;
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
/* map-statistics strip: open state, remembered like the last mode */
const STATS_STORAGE = 'gravity.statsOpen';
let statsOpen = false;
function loadStatsOpen() {
	try {
		return Boolean(root.localStorage) && root.localStorage.getItem(STATS_STORAGE) === '1';
	} catch (e) { /* private mode */ }
	return false;
}
function saveStatsOpen() {
	try {
		if (root.localStorage) root.localStorage.setItem(STATS_STORAGE, statsOpen ? '1' : '0');
	} catch (e) { /* private mode */ }
}
/* career world clock: runs while unpaused; by default it pauses when your
 * flight ends so you can aim in peace (launching resumes it) */
let careerPaused = false;
/* 0.7.47 WS4: a career whose seat search has not accepted inside the
 * synchronous budget keeps the run open and plans in the background. The
 * driver lives in gui_game.js; this flag gates every roster/input change
 * while it is active so the search is never invalidated under it. */
let careerPlanning = false;
let careerPlanSearch = null;
let careerPlanSeed = 0;
let careerPlanMode = GravityGame.START_PLANET;
/* WS4 decision frozen at a tier end or an acceptance: the page never
 * auto-advances or auto-starts — H offers play-as-is / load saves /
 * wait more (or start fair), and the snapshot plan is the tier that was
 * complete when this decision appeared */
let careerPlanDecision = null;
const slotPaused = new Array(MAX_PLAYERS).fill(false);
/* wall-clock instant the career clock was paused; draw ticks freeze on it
 * so nothing animates while the world clock holds still */
let careerPauseNow = 0;
let pauseOnLanding = true;
/* auto-repair the ship on landing while the purse covers it and keeps one cheap way off */
let autoRepair = true;
/* a career launch is queued until the planet's EMC barrel reaches the aim */
const slotTurrets = Array.from({ length: MAX_PLAYERS }, () => ({
	pending: false, body: -1, angle: 0, speed: 0, fireAt: 0, pad: null, energy: 0
}));
let turret = slotTurrets[0];
const slotTypes = new Array(MAX_PLAYERS).fill(PLAYER_BOT);
slotTypes[0] = PLAYER_USER;
const rivalTypesArg = new Array(GravityBot.MAX_RIVALS).fill(PLAYER_BOT);
let activeSlot = 0;
/* the player's one route entry; `ready` means its trace reached an end */
const routePlan = makeRoutePlanSlot();
const slotPlans = [routePlan];
for (let i = 1; i < MAX_PLAYERS; i++) slotPlans.push(makeRoutePlanSlot());
/* per-slot best manual plan, scoped to one start planet and one game run */
const slotBest = Array.from({ length: MAX_PLAYERS }, makeBestSlot);
const slotAim = Array.from({ length: MAX_PLAYERS }, makeAimSlot);
let routeLeader = -2;
let routeBotVersion = -1;
let playerBotSyncNeeded = true;
/* replay of a link: shots fired in order, aim shown then flown; verdict after the last */
const replay = { on: false, shots: null, end: null, index: 0, phase: PHASE_GAP, until: 0,
	speed: REPLAY_DEFAULT, verdict: '', route: false, career: false, length: null,
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

/* ── field, sound & key wiring · gravity_gui.js ── top-level bindings for the slider, source, trim, fold and sound controls;
   they read element refs at load, so the composer keeps them (plan rule 5) even though the functions they call live in gui_frame.js and gui_aim.js */

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
if (viewPotentialEl) {
	viewPotentialEl.addEventListener('change', () => {
		if (viewPotentialEl.checked) setViewMode(VIEW_POTENTIAL);
	});
}
if (viewFullEl) {
	viewFullEl.addEventListener('change', () => {
		setViewFrame(viewFullEl.checked ? FRAME_FULL : FRAME_MAIN);
	});
}
if (careerCleanEl) {
	careerCleanEl.addEventListener('change', () => {
		cleanCareerView = careerCleanEl.checked;
		saveViewFlag(CLEAN_STORAGE, cleanCareerView);
	});
}
if (trailViewEl) {
	trailViewEl.addEventListener('change', () => {
		trailRivalsOn = trailViewEl.checked;
		saveViewFlag(TRAILS_STORAGE, trailRivalsOn);
	});
}
if (predViewEl) {
	predViewEl.addEventListener('change', () => {
		predRivalsOn = predViewEl.checked;
	});
}
srcPlanetsEl.addEventListener('change', () => setSource(MODE_PLANETS));
srcPortsEl.addEventListener('change', () => setSource(MODE_PORTS));
/* the fleet checkbox (0.7.45) is the only writer of the live career's
 * mirror; ships bought while it was on keep flying when it goes off again */
function onFleetChange() {
	if (careerInputLocked()) return;
	if (game.career) game.career.fleetUnlocked = expFleetEl.checked;
	refreshGameUi();
	dirty = true;
	hudAt = -Infinity;
}

/* a restart is a new company, so its mirror starts cleared: the box's
 * standing intent re-arms it on the next refresh */
function syncFleetCheckbox() {
	if (expFleetEl && expFleetEl.checked && game.career) game.career.fleetUnlocked = true;
}

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
if (expWearEl) expWearEl.addEventListener('input', onWearInput);
if (expPadsEl) expPadsEl.addEventListener('input', onPadsInput);
if (expRotEl) expRotEl.addEventListener('input', onRotInput);
if (expPayEl) expPayEl.addEventListener('input', onPayInput);
if (expHarvestEl) expHarvestEl.addEventListener('change', onHarvestChange);
if (expFleetEl) expFleetEl.addEventListener('change', onFleetChange);
for (const el of [giftAllEl, giftBotEl, giftHumanEl]) if (el) el.addEventListener('input', onGiftInput);
if (giftPeekEl) giftPeekEl.addEventListener('change', refreshGiftUi);
horizonSlider.addEventListener('input', () => {
	cargoSim.horizon = Number(horizonSlider.value);
	const text = cargoSim.horizon + ' s';
	horizonLabel.textContent = text;
	if (horizonTagEl) horizonTagEl.textContent = text;
	fieldChanged();
	hudAt = -Infinity;
});
launchButton.addEventListener('click', () => {
	if (launchButton.value === 'evac') careerAct({ act: 'evac' });
	else launchShot();
});
launchMenuBtn.addEventListener('click', () => setLaunchMenu(launchMenuEl.hidden));
launchRepairBtn.addEventListener('click', () => {
	setLaunchMenu(false);
	careerAct({ act: 'repair' });
});
launchOnlyBtn.addEventListener('click', () => {
	setLaunchMenu(false);
	launchArmedShot();
});
if (flightRefuelBtn) flightRefuelBtn.addEventListener('click', flightRefuel);
if (flightHudEl) {
	flightHudEl.addEventListener('pointerover', flightQuestsOver);
	flightHudEl.addEventListener('pointerleave', flightHoverClear);
}
routeBestBtn.addEventListener('click', restoreRouteBest);
if (helperScanBtn) helperScanBtn.addEventListener('click', helperStartBroad);
if (helperFocusBtn) helperFocusBtn.addEventListener('click', helperStartFocus);
if (helperTweakBtn) helperTweakBtn.addEventListener('click', helperStartTweak);
if (helperProfitBtn) helperProfitBtn.addEventListener('click', () => helperStartProfit(false));
if (helperEmcBtn) helperEmcBtn.addEventListener('click', () => helperStartProfit(true));
if (helperQuestBtn) helperQuestBtn.addEventListener('click', helperStartQuest);
if (helperPlanQuestBtn) helperPlanQuestBtn.addEventListener('click', helperStartPlanQuest);
if (helperStopBtn) helperStopBtn.addEventListener('click', stopHelper);
clearButton.addEventListener('click', () => {
	if (helperState.active) { stopHelper(); return; }
	if (playerIsBot()) return;
	if (routeRule()) clearRoutePlan();
	else if (!game.on) clearCargo();
});
for (let mIdx = 0; mIdx < modeEls.length; mIdx++) {
	const el = modeEls[mIdx][1];
	if (!el) continue;
	const value = modeEls[mIdx][0];
	el.addEventListener('change', () => {
		if (el.checked) setPlayMode(value);
	});
}
for (let sIdx = 0; sIdx < startEls.length; sIdx++) {
	const el = startEls[sIdx][1];
	if (!el) continue;
	const value = startEls[sIdx][0];
	el.addEventListener('change', () => {
		if (el.checked) setStartMode(value);
	});
}
if (careerBoxEl) {
	careerBoxEl.addEventListener('click', event => {
		const data = careerEventData(event);
		/* the eye is a pure UI toggle: reveal a row's before → after delta on
		 * touch where there is no hover; keep it out of the career state machine */
		if (data && data.act === 'peek') {
			const row = event.target.closest('.careerRow');
			if (row) row.classList.toggle('showCap');
			return;
		}
		if (data) careerAct(data);
	});
	careerBoxEl.addEventListener('input', event => {
		const node = event && event.target;
		if (node && node.dataset && node.dataset.sciAxis) scienceSliderInput(node);
	});
	careerBoxEl.addEventListener('pointerover', topicHelpOver);
	careerBoxEl.addEventListener('pointerleave', topicHelpLeave);
}
if (careerWaitBtn) careerWaitBtn.addEventListener('click', () => careerAct({ act: 'wait' }));
if (launchBuildBtn) {
	launchBuildBtn.addEventListener('click', () => {
		if (replay.on || careerInputLocked() || !careerRule() || careerWaitBusy() || activeSim().status === STATUS_FLYING) return;
		const career = playerCareer();
		if (career.ended !== GravityGame.CAREER_OPEN || career.at < 0 ||
			career.pads[career.at].catapult !== null) return;
		careerFollow = true;
		careerBuild(career, career.at, OrbitTech.KIND_CATAPULT, OrbitTech.CATAPULTS[0]);
	});
}
if (launchCommercialBtn) {
	launchCommercialBtn.addEventListener('click', () => toggleCommercialRail(false));
}
if (launchEvacBtn) {
	launchEvacBtn.addEventListener('click', () => careerAct({ act: 'evac' }));
}
if (careerClockBtn) {
	careerClockBtn.addEventListener('click', () => {
		toggleFlightPause();
	});
}
if (careerPauseLandEl) {
	careerPauseLandEl.addEventListener('change', () => {
		pauseOnLanding = careerPauseLandEl.checked;
		/* apply at once while landed, so the setting is never a surprise */
		if (pauseAllowed() && activeSim().status !== STATUS_FLYING &&
			!(careerRule() && activeCareer().evacuating)) {
			setCareerPaused(pauseOnLanding);
		}
		refreshCareerClockUi();
	});
}
if (careerAutoRepairEl) {
	careerAutoRepairEl.addEventListener('change', () => {
		autoRepair = careerAutoRepairEl.checked;
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
		selectSlot(s);
	});
	row.addEventListener('keydown', event => {
		if (!event || isBotControlTarget(s, event.target)) return;
		if (event.key !== 'Enter' && event.key !== ' ') return;
		if (event.preventDefault) event.preventDefault();
		selectSlot(s);
	});
}
if (botOffEl) botOffEl.addEventListener('change', () => setBot(BOT_OFF));
if (botEasyEl) botEasyEl.addEventListener('change', () => setBot(BOT_EASY));
if (botNormalEl) botNormalEl.addEventListener('change', () => setBot(BOT_NORMAL));
if (botHardEl) botHardEl.addEventListener('change', () => setBot(BOT_HARD));
if (planetCountInputEl) {
	planetCountInputEl.addEventListener('change', () => {
		const value = Math.round(Number(planetCountInputEl.value));
		if (!Number.isFinite(value) || !setPlanetUniverseSize(value)) {
			planetCountInputEl.value = planetCount;
			return;
		}
		/* a planet-count change is the other half of the unfair-roster fix:
		 * it cancels the live search and restarts it on the wider world */
		if (careerPlanning) {
			cancelCareerPlanning();
			startGame(game.seed, game.fixedRate, game.rule, game.bot, game.player, game.cheat);
			return;
		}
		if (careerRule()) recordCareerAction('universe', { mask: Array.from(planetMask).join('') });
		careerRecordingCapture(true);
	});
}
if (playerCountDownEl) playerCountDownEl.addEventListener('click', () => setPlayerCount(-1));
if (playerCountUpEl) playerCountUpEl.addEventListener('click', () => setPlayerCount(1));
gameRestartBtn.addEventListener('click', () =>
	startGame(game.seed, game.fixedRate, undefined, undefined, undefined, game.cheat));
gameNewSeedBtn.addEventListener('click', event => {
	clearMapField();
	startGame(newRunSeed(event.shiftKey === true), false);
});
gameCopyBtn.addEventListener('click', copyLink);
if (botCopyBtn) botCopyBtn.addEventListener('click', copyBotLink);
if (botLogBtn) botLogBtn.addEventListener('click', copyBotLog);
replaySpeedBtn.addEventListener('click', () => {
	replay.speed = (replay.speed + 1) % REPLAY_SPEEDS.length;
	refreshGameUi();
});
replaySkipBtn.addEventListener('click', skipReplay);
playSlowerBtn.addEventListener('click', () => stepPlayback(-1));
playFasterBtn.addEventListener('click', () => stepPlayback(1));
playResetBtn.addEventListener('click', resetPlayback);
window.addEventListener('hashchange', () => loadLink());
if (helpBtn) {
	helpBtn.addEventListener('click', () => setHelpOpen(!helpPinned));
	helpBtn.addEventListener('pointerenter', event => {
		if (event.pointerType !== 'touch') showRuleHelp(selectedHelpRule(), false);
	});
	helpBtn.addEventListener('pointerleave', () => {
		if (!helpPinned) setHelpOpen(false, true);
	});
}
bindFold(foldBtn, cargoHudEl);
bindFold(scoreFoldBtn, scoreHudEl);
bindFold(careerFoldBtn, careerHudEl);
bindFold(tradeFoldBtn, $('tradeHud'));
if (gameFoldBtn && gameHudEl) bindFold(gameFoldBtn, gameHudEl);
if (helpClose) helpClose.addEventListener('click', () => setHelpOpen(false));
if (statsStripEl) statsStripEl.addEventListener('toggle', () => {
	statsOpen = statsStripEl.open === true;
	saveStatsOpen();
	refreshStatsStrip();
});
refreshSoundToggle();
if (soundToggle) soundToggle.addEventListener('click', () => {
	soundEnabled = !soundEnabled;
	sound.setEnabled(soundEnabled);
	refreshSoundToggle();
	try { root.localStorage.setItem('gravity-sound-enabled', String(soundEnabled)); }
	catch (err) { /* Sound still works without persistent preferences. */ }
});
refreshSoundSettings();
if (soundEngineEl) soundEngineEl.addEventListener('change', () => {
	sound.setEngine(soundEngineEl.value);
	saveSoundPreference('gravity-sound-engine', sound.engine());
	refreshSoundSettings();
	sound.unlock();
});
if (soundAimEl) soundAimEl.addEventListener('change', () => {
	sound.setAimMode(soundAimEl.value);
	saveSoundPreference('gravity-sound-aim', sound.aimMode());
	refreshSoundSettings();
});
if (soundFlightEl) soundFlightEl.addEventListener('change', () => {
	sound.setFlightMode(soundFlightEl.value);
	saveSoundPreference('gravity-sound-flight', sound.flightMode());
	refreshSoundSettings();
});
if (soundVoronoiPresetEl) soundVoronoiPresetEl.addEventListener('change', () => {
	sound.setVoronoiPreset(soundVoronoiPresetEl.value);
	saveSoundPreference('gravity-sound-voronoi-preset', sound.voronoiPreset());
	refreshSoundSettings();
});
if (soundDistanceEl) soundDistanceEl.addEventListener('input', () => {
	sound.setDistanceScale(soundDistanceEl.value);
	if (soundDistanceLabelEl) soundDistanceLabelEl.textContent = '×' + sound.distanceScale().toFixed(2);
	saveSoundPreference('gravity-sound-distance-scale', String(sound.distanceScale()));
});
if (soundVolumeEl) soundVolumeEl.addEventListener('input', () => {
	soundVolumePct = Number(soundVolumeEl.value);
	sound.setVolume(soundVolumePct / 100);
	if (soundVolumeLabelEl) soundVolumeLabelEl.textContent = Math.round(soundVolumePct) + '%';
	saveSoundPreference('gravity-sound-volume', String(soundVolumePct));
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

/* ── boot · gravity_gui.js ── observers, keyboard, initial view and mode, the first frame */
const gameControlsEl = $('gameControls');
if (typeof root.ResizeObserver === 'function' && gameControlsEl) {
	const footObserver = new root.ResizeObserver(() => {
		reserveGameFooter();
		measureHudRects();
	});
	footObserver.observe(gameControlsEl);
	if (flightHudEl) footObserver.observe(flightHudEl);
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
			setViewMode(nextViewMode());
			return;
		}
	}
	if (event.code === 'KeyZ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
		const tag = event.target && event.target.tagName;
		if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
			toggleViewFrame();
			return;
		}
	}
	/* Let the focused options handle their own keyboard activation. */
	if (event.code === 'Enter' || event.code === 'Space') {
		const button = event.target;
		if (button && (button === launchMenuBtn || button.parentElement === launchMenuEl ||
			(button === launchButton && launchButton.value !== ''))) return;
	}
	if ((event.code === 'Space' || event.code === 'KeyP') &&
		!event.ctrlKey && !event.metaKey && !event.altKey) {
		const tag = event.target && event.target.tagName;
		if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' &&
			careerRule() && !replay.on) {
			if (event.preventDefault) event.preventDefault();
			if (!event.repeat) toggleFlightPause();
			return;
		}
	}
	if (event.code === 'Enter') {
		if (canImpulse()) {
			if (!burnArmed) return;
			if (event.preventDefault) event.preventDefault();
			executeBurn();
			return;
		}
		if (!armed) return;
		event.preventDefault();
		launchShot();
		return;
	}
	if (event.code === 'Escape') {
		if (commsEscape()) return;
		if (helpOpen) setHelpOpen(false);
		else if (!launchMenuEl.hidden) {
			setLaunchMenu(false);
			if (event.target && event.target.parentElement === launchMenuEl) launchMenuBtn.focus();
		} else if (burnAiming || burnArmed) {
			burnAiming = false;
			burnArmed = false;
			savedBurnArmed = false;
			dirty = true;
			refreshAimLabel();
			launchState = -1;
			hudAt = -Infinity;
		} else if (isBurnPaused()) setBurnPaused(false);
		else if (!replay.on && !careerInputLocked()) cancelAim();
	}
});
window.addEventListener('keyup', event => {
	if (event.key !== 'Shift') return;
	fine = false;
	refreshAimLabel();
});

	root.GravityScene = {
	sim: cargoSim,
	sound: sound,
	activeSim: activeSim,
	bot: bot,
	game: game,
	/* the bought fleet ships of the live career (0.7.45 test contract):
	 * fleetCount is the size, fleet the records themselves (read-only) */
	fleetCount: () => (game.career ? game.career.fleet.length : 0),
	fleet: () => (game.career ? game.career.fleet : null),
	career: game.career,
	activeCareer: activeCareer,
	slotCareer: slotCareer,
	careerWorldOpen: careerWorldOpen,
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
	startMode: () => game.startMode,
	setStartMode,
	careerPlanning: () => careerPlanning,
	drainCareerPlanning,
	slotType: slot => slotTypes[slot],
	setSlotType: setSlotType,
	activeSlot: () => activeSlotIndex(),
	selectSlot: selectSlot,
	careerAct,
	waitCareer,
	careerPaused: () => careerPaused,
	slotPaused: slot => slotPaused[slot],
	setCareerPaused,
	pauseOnLanding: () => pauseOnLanding,
	autoRepair: () => autoRepair,
	careerNotice,
	careerPickPlanet,
	refreshCareerPanel,
	waitSettlement: () => (game.career ? waitSettlement(game.career) : null),
	viewMode: () => viewMode,
	setViewMode,
	frame: () => scene.view.frame,
	setFrame: setViewFrame,
	cleanCareerView: () => cleanCareerView,
	trailRivals: () => trailRivalsOn,
	predRivals: () => predRivalsOn,
	liteMode: () => liteMode,
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
	startGifts: () => ({ all: giftAll, bot: giftBot, human: giftHuman, run: GravityGame.startGiftsOf() }),
	experimentScales: () => ({
		gravity: gravityScale, force: forceScale, spaceWear: spaceWearScale,
		pad: padScale, rot: rotScale, pay: payScale, harvestTick: harvestTick && careerRule()
	}),
	/* the profit-pill highlight: systems a flying ship is inside vs the ones
	 * the traced path ahead will enter */
	harvestMarks: () => ({ inside: liveHarvestMask, route: predHarvestMask }),
	careerPadInfo: () => (game.career ? careerPadPlate(game.career) : null),
	aimState: () => ({ armed: armed, body: aimBody, angle: aimAngle, speed: aimSpeed, grip: gripLen, ceiling: aimCeiling }),
	burnPaused: isBurnPaused,
	setBurnPaused,
	toggleFlightPause,
	flightRefuel,
	questHover: () => questHoverBody,
	flightHudState: () => (flightHud.action = flightStateText()),
	burnState: () => ({
		paused: isBurnPaused(), armed: burnArmed,
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

if (careerCleanEl) careerCleanEl.checked = cleanCareerView;
if (trailViewEl) trailViewEl.checked = trailRivalsOn;
if (predViewEl) predRivalsOn = predViewEl.checked;
if (careerPauseLandEl) pauseOnLanding = careerPauseLandEl.checked;
if (careerAutoRepairEl) autoRepair = careerAutoRepairEl.checked;
refreshPlaybackUi();
refreshCareerClockUi();
cargoSim.horizon = Number(horizonSlider.value);
horizonLabel.textContent = cargoSim.horizon + ' s';
if (horizonTagEl) horizonTagEl.textContent = cargoSim.horizon + ' s';

if (botOffEl && botOffEl.checked) game.bot = BOT_OFF;
else if (botEasyEl && botEasyEl.checked) game.bot = BOT_EASY;
else if (botHardEl && botHardEl.checked) game.bot = BOT_HARD;
else game.bot = BOT_NORMAL;

mode = srcPortsEl.checked ? MODE_PORTS : MODE_PLANETS;
cargoSim.fieldT = tradeSim.t;
cargoSim.fieldRate = tradeRate();
updateRuleHelp(selectedHelpRule());
applyLite();
/* the boot world's pre-history waits: a run started below resets it anyway */
scene.reset(startupSeed(), true);
initPlanetUniverse(PLANET_DEFAULT);
applyPlanetUniverse();
attachWorld();
refreshExperimentUi();
paintZoneLegend();
const initialView = new URLSearchParams(location.search).get('view');
if (VIEW_MODES.includes(initialView)) setViewMode(initialView);
statsOpen = loadStatsOpen();
if (statsStripEl) statsStripEl.open = statsOpen;
if (!loadLink() && !loadSearchParams()) {
	const last = loadLastMode();
	if (last) setPlayMode(last);
	else refreshGameUi();
	syncSeedUrl();
}
/* no run started, so the lab world still owes its pre-history */
if (scene.settle()) attachWorld();

resizeOverlay();
refreshSelected();
refreshAimLabel();
updateLiveHud();
updateHud(performance.now());
requestAnimationFrame(frame);

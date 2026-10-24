/*
 * Game-mode rules shared by the page, rival bots and the node benches: the aim
 * grid, per-rule caps, replay link codec, the shared per-planet growing
 * visit-profit market, and the career rule (catapult network, pad energy,
 * contract board, evacuation, cheats).
 */
(function (root) {
	'use strict';

	const GravitySim = typeof module !== 'undefined' && module.exports
		? require('./gravity_sim.js')
		: root.GravitySim;
	const OrbitWorld = typeof module !== 'undefined' && module.exports
		? require('./orbit_world.js')
		: root.OrbitWorld;
	const OrbitEcon = typeof module !== 'undefined' && module.exports
		? require('./orbit_econ.js')
		: root.OrbitEcon;
	const OrbitTech = typeof module !== 'undefined' && module.exports
		? require('./orbit_tech.js')
		: root.OrbitTech;
	const OrbitScience = typeof module !== 'undefined' && module.exports
		? require('./orbit_science.js')
		: root.OrbitScience;

	const FORMAT = 1;
	const ANGLE_STEPS = 1048576;
	const ANGLE_UNIT = Math.PI * 2 / ANGLE_STEPS;
	const SPEED_STEPS = 1024;
	const SPEED_UNITS_MIN = GravitySim.SPEED_MIN * SPEED_STEPS;
	const SPEED_UNITS_MAX = GravitySim.SPEED_MAX * SPEED_STEPS;
	const CAP_SECONDS = 120;
	const CAP_STEPS = Math.round(CAP_SECONDS / GravitySim.DT);
	const ROUTE_SECONDS = 1800;
	const ROUTE_STEPS = Math.round(ROUTE_SECONDS / GravitySim.DT);
	const MONEY_SHOTS = 10;
	const RULE_TOUR = 'tour';
	const RULE_ROUTE = 'route';
	const RULE_MONEY = 'money';
	const RULE_CAREER = 'career';
	/*
	 * One table for everything a rule changes: flight cap, preview horizon
	 * (null = the lab slider), shot ceiling (0 = unlimited), whether the run
	 * stops when all 26 systems are visited, and whether rivals may join.
	 */
	const RULES = {
		tour: { name: RULE_TOUR, capSteps: CAP_STEPS, horizon: null, maxShots: 0, stopOnTour: true, planner: false, solo: false },
		route: { name: RULE_ROUTE, capSteps: ROUTE_STEPS, horizon: ROUTE_SECONDS, maxShots: 1, stopOnTour: false, planner: true, solo: false },
		money: { name: RULE_MONEY, capSteps: CAP_STEPS, horizon: null, maxShots: MONEY_SHOTS, stopOnTour: false, planner: false, solo: false },
		career: { name: RULE_CAREER, capSteps: CAP_STEPS, horizon: null, maxShots: 0, stopOnTour: false, planner: false, solo: true }
	};
	const CHEAT_COMMUNISM = 'communism';
	const CHEAT_ENDGAME = 'endgame';
	const CHEATS = { communism: CHEAT_COMMUNISM, endgame: CHEAT_ENDGAME };
	const BOT_OFF = 'off';
	const BOT_EASY = 'easy';
	const BOT_NORMAL = 'normal';
	const BOT_HARD = 'hard';
	const BOTS = {
		off: BOT_OFF,
		easy: BOT_EASY,
		normal: BOT_NORMAL,
		hard: BOT_HARD
	};
	const PLAYER_USER = 'user';
	const PLAYER_BOT = 'bot';
	const PLAYER_TYPES = {
		user: PLAYER_USER,
		bot: PLAYER_BOT
	};
	const RATE_MIN = 0.5;
	const RATE_MAX = 12;
	/*
	 * Per-planet growing visit profit: each launch costs 1.00 from a tight
	 * starting purse of 3.00; every planet starts with 40 s of accrued age
	 * (+0.25) and grows +0.00625 per flight-second (+0.25 per 40 s) up to 0.75.
	 * Entering a planet's port orbit collects its value and resets it to 0.00.
	 */
	const MONEY = {
		cost: 1,
		k: 0.00625,
		initSec: 40,
		cap: 0.75,
		purse0: 3
	};
	const PURSE_PRESETS = { tight: 2, standard: 3, relaxed: 6 };
	/* experimental settings panel bounds; links carry the two multipliers */
	const EXPERIMENT = {
		gravityMin: 0, gravityMax: 2,
		forceMin: 0.25, forceMax: 3
	};
	const SRC_PLANETS = 0;
	const SRC_PORTS = 1;
	const SRC_CODES = 'pm';
	const NO_ABORT = -1;
	const SHOT_FORM = /^([pm])(\d{1,2})\.([0-9a-z]{1,4})\.([0-9a-z]{1,4})(?:\.([0-9a-z]{1,4}))?$/;
	const BURN_FORM = /^b([0-9a-z]{1,4})\.([0-9a-z]{1,4})\.([0-9a-z]{1,4})$/;
	const END_FORM = /^(\d{1,2})\.(\d{1,9})$/;
	const estScratch = new Int32Array(OrbitWorld.PLANETS);

	function angleUnits(angle) {
		return (Math.round(angle / ANGLE_UNIT) % ANGLE_STEPS + ANGLE_STEPS) % ANGLE_STEPS;
	}

	function angleOf(units) {
		return units * ANGLE_UNIT;
	}

	function speedUnits(speed) {
		return Math.round(speed * SPEED_STEPS);
	}

	function speedOf(units) {
		return units / SPEED_STEPS;
	}

	function createBurn(step, angle, dv) {
		return { step: step, angle: angle, dv: dv };
	}

	function encodeBurn(burn) {
		return 'b' + burn.step.toString(36) + '.' + burn.angle.toString(36) + '.' + burn.dv.toString(36);
	}

	function createShot(src, origin, angle, speed, abort, burns) {
		return {
			src: src, origin: origin, angle: angle, speed: speed, abort: abort,
			burns: burns ? burns.slice() : []
		};
	}

	function encodeShot(shot) {
		const head = SRC_CODES[shot.src] + shot.origin + '.' +
			shot.angle.toString(36) + '.' + shot.speed.toString(36);
		const base = shot.abort === NO_ABORT ? head : head + '.' + shot.abort.toString(36);
		if (!shot.burns || shot.burns.length === 0) return base;
		let out = base;
		for (let i = 0; i < shot.burns.length; i++) out += '-' + encodeBurn(shot.burns[i]);
		return out;
	}

	/* two-decimal multiplier, omitted at the default 1 */
	function scalePart(name, value) {
		if (value === undefined || value === 1) return '';
		return '&' + name + '=' + (Math.round(value * 100) / 100);
	}

	/* `game` = { seed, rate, rule, bot, player, cheat, gravityScale, forceScale,
	 * shots, visited, steps, length }; default rule/bot/player/scales stay
	 * omitted; `length` verifies a route plan. A career link starts the same
	 * career (seed, rate, cheat, scales) — its builds and contracts are not
	 * replayed, so it never carries shots. */
	function encodeLink(game) {
		const rulePart = game.rule && game.rule !== RULE_TOUR ? '&rule=' + game.rule : '';
		const botPart = game.bot && game.bot !== BOT_OFF ? '&bot=' + game.bot : '';
		const playerPart = game.player === PLAYER_BOT ? '&you=' + PLAYER_BOT : '';
		const cheatPart = game.rule === RULE_CAREER && game.cheat ? '&cheat=' + game.cheat : '';
		const head = 'game=' + FORMAT + '&seed=' + game.seed + '&rate=' + game.rate +
			rulePart + botPart + playerPart + cheatPart +
			scalePart('gs', game.gravityScale) + scalePart('fs', game.forceScale);
		if (game.shots.length === 0 || game.rule === RULE_CAREER) return head;
		const lengthPart = game.rule === RULE_ROUTE && Number.isFinite(game.length)
			? '&len=' + Math.round(game.length) : '';
		return head + '&shots=' + game.shots.map(encodeShot).join('_') +
			'&end=' + game.visited + '.' + game.steps + lengthPart;
	}

	function decodeShot(text, capSteps) {
		const parts = String(text).split('-');
		const match = SHOT_FORM.exec(parts[0]);
		if (!match) return null;
		const origin = Number(match[2]);
		const angle = parseInt(match[3], 36);
		const speed = parseInt(match[4], 36);
		const abort = match[5] === undefined ? NO_ABORT : parseInt(match[5], 36);
		const limit = capSteps || ROUTE_STEPS;
		if (origin >= OrbitWorld.PLANETS || angle >= ANGLE_STEPS) return null;
		if (speed < SPEED_UNITS_MIN || speed > SPEED_UNITS_MAX) return null;
		if (abort >= limit) return null;
		const maxBurnStep = abort === NO_ABORT ? limit : abort;
		const burns = [];
		let prevStep = 0;
		for (let i = 1; i < parts.length; i++) {
			const bm = BURN_FORM.exec(parts[i]);
			if (!bm) return null;
			const bStep = parseInt(bm[1], 36);
			const bAngle = parseInt(bm[2], 36);
			const bDv = parseInt(bm[3], 36);
			if (bStep < prevStep || bStep >= maxBurnStep) return null;
			if (bAngle >= ANGLE_STEPS || bDv < 1 || bDv > SPEED_UNITS_MAX) return null;
			prevStep = bStep;
			burns.push(createBurn(bStep, bAngle, bDv));
		}
		return createShot(SRC_CODES.indexOf(match[1]), origin, angle, speed, abort, burns);
	}

	/* absent = 1, otherwise a plain up-to-two-decimal number inside [min, max] */
	function decodeScale(text, min, max) {
		if (text === null) return 1;
		if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
		const value = Number(text);
		if (!Number.isFinite(value) || value < min || value > max) return null;
		return value;
	}

	/* Returns { seed, rate, rule, bot, player, cheat, gravityScale, forceScale,
	 * shots, end, length } or null. */
	function decodeLink(text) {
		const params = new URLSearchParams(String(text).replace(/^#/, ''));
		if (params.get('game') !== String(FORMAT)) return null;
		const seed = Number(params.get('seed'));
		const rate = Number(params.get('rate'));
		if (!Number.isInteger(seed) || seed < 1 || seed > 0xffffffff) return null;
		if (!Number.isInteger(rate * 2) || rate < RATE_MIN || rate > RATE_MAX) return null;
		const ruleText = params.get('rule');
		const rule = ruleText === null ? RULES.tour : RULES[ruleText];
		if (!rule) return null;
		const botText = params.get('bot');
		const bot = botText === null ? BOT_OFF : BOTS[botText];
		if (!bot) return null;
		const playerText = params.get('you');
		const player = playerText === null ? PLAYER_USER : PLAYER_TYPES[playerText];
		if (!player) return null;
		const cheatText = params.get('cheat');
		const cheat = cheatText === null ? null : CHEATS[cheatText];
		if (cheat === undefined || (cheat !== null && rule.name !== RULE_CAREER)) return null;
		const gravityScale = decodeScale(params.get('gs'), EXPERIMENT.gravityMin, EXPERIMENT.gravityMax);
		const forceScale = decodeScale(params.get('fs'), EXPERIMENT.forceMin, EXPERIMENT.forceMax);
		if (gravityScale === null || forceScale === null) return null;
		const list = params.get('shots');
		const parts = list ? list.split('_') : [];
		if (rule.planner && parts.length > 1) return null;
		if (rule.name === RULE_CAREER && parts.length > 0) return null;
		const shots = [];
		for (const part of parts) {
			const shot = decodeShot(part, rule.capSteps);
			if (!shot || (rule.planner && (shot.abort !== NO_ABORT || shot.burns.length > 0))) {
				return null;
			}
			shots.push(shot);
		}
		const lengthText = params.get('len');
		const length = lengthText === null ? null : Number(lengthText);
		if (lengthText !== null &&
			(!Number.isInteger(length) || length < 0 || length > 10000000)) return null;
		const endMatch = END_FORM.exec(params.get('end') || '');
		const end = endMatch ? { visited: Number(endMatch[1]), steps: Number(endMatch[2]) } : null;
		return { seed: seed, rate: rate, rule: rule.name, bot: bot, player: player, cheat: cheat,
			gravityScale: gravityScale, forceScale: forceScale, shots: shots, end: end, length: length };
	}

	function isGameLink(text) {
		return new URLSearchParams(String(text).replace(/^#/, '')).has('game');
	}

	function initSteps() {
		return Math.round(MONEY.initSec / GravitySim.DT);
	}

	/* shared planet-value state for a game run; player and rivals harvest from the same table */
	function createMarket() {
		const market = {
			lastVisitStep: new Int32Array(OrbitWorld.PLANETS),
			stamp: 0
		};
		resetMarket(market);
		return market;
	}

	function resetMarket(market) {
		market.lastVisitStep.fill(-initSteps());
		market.stamp += 1;
	}

	function planetProfitAtStep(lastStep, runStep) {
		const age = (runStep - lastStep) * GravitySim.DT;
		if (age <= 0) return 0;
		const pay = age * MONEY.k;
		return pay > MONEY.cap ? MONEY.cap : pay;
	}

	function planetProfit(market, planet, runStep) {
		return planetProfitAtStep(market.lastVisitStep[planet], runStep);
	}

	/* `fee` is what the current flight's launch cost, so `last` nets it out */
	function createLedger(purse0) {
		return {
			purse: purse0 === undefined ? MONEY.purse0 : purse0,
			fee: MONEY.cost,
			last: 0,
			shotGain: 0,
			shotVisits: 0,
			lastPlanet: -1,
			inside: new Uint8Array(GravitySim.MAX_BODIES),
			entered: new Int32Array(GravitySim.MAX_BODIES)
		};
	}

	function resetLedger(ledger, purse0) {
		ledger.purse = purse0 === undefined ? MONEY.purse0 : purse0;
		ledger.fee = MONEY.cost;
		ledger.last = 0;
		ledger.shotGain = 0;
		ledger.shotVisits = 0;
		ledger.lastPlanet = -1;
		ledger.inside.fill(0);
	}

	/* deducts the launch fee and marks the launch base as already inside so departure pays 0 */
	function openFlight(ledger, sim, fee) {
		ledger.purse -= fee;
		ledger.fee = fee;
		ledger.shotGain = 0;
		ledger.shotVisits = 0;
		ledger.lastPlanet = -1;
		ledger.inside.fill(0);
		sim.markSystemsAt(sim.cargo.x, sim.cargo.y, ledger.inside);
	}

	function beginFlight(ledger, sim) {
		openFlight(ledger, sim, MONEY.cost);
	}

	function harvestPlanet(ledger, market, planet, runStep) {
		const pay = planetProfit(market, planet, runStep);
		market.lastVisitStep[planet] = runStep;
		market.stamp += 1;
		ledger.purse += pay;
		ledger.shotGain += pay;
		ledger.shotVisits += 1;
		ledger.lastPlanet = planet;
		return pay;
	}

	/* advances one step of system-entry harvesting for either the player or a rival */
	function stepHarvest(ledger, market, sim, runStep) {
		const count = sim.stepInsideAt(sim.cargo.x, sim.cargo.y, ledger.inside, ledger.entered);
		let gained = 0;
		for (let i = 0; i < count; i++) {
			gained += harvestPlanet(ledger, market, ledger.entered[i], runStep);
		}
		if (sim.status === GravitySim.STATUS_ENDED &&
			sim.endReason === GravitySim.END_IMPACT &&
			sim.endBody >= 0 && !ledger.inside[sim.endBody]) {
			ledger.inside[sim.endBody] = 1;
			gained += harvestPlanet(ledger, market, sim.endBody, runStep);
		}
		return gained;
	}

	function endFlight(ledger) {
		ledger.last = ledger.shotGain - ledger.fee;
		return ledger.shotGain;
	}

	/* exact predicted harvest along a traced probe without mutating the live market */
	function estimateProfit(market, baseStep, sim) {
		const count = sim.predLogCount;
		if (count === 0) return 0;
		estScratch.set(market.lastVisitStep);
		let total = 0;
		for (let i = 0; i < count; i++) {
			const planet = sim.predLogPlanet[i];
			const at = baseStep + sim.predLogStep[i];
			total += planetProfitAtStep(estScratch[planet], at);
			estScratch[planet] = at;
		}
		return total;
	}

	/* --- career ------------------------------------------------------------ */

	/*
	 * Career: a launch costs pad energy, never money. The purse grows from the
	 * shared visit market (the always-available "visit a long-unvisited planet"
	 * task), delivery contracts (land cargo on a planet, needs a hold) and
	 * route competitions (one flight from a planet at least `minLength` long).
	 * Only a planet with a built EM catapult can be launched from: landing
	 * anywhere else strands the ship until a catapult is bought there or an
	 * evacuation flies it back to HQ for `evacFee` — more than any delivery
	 * pays, so a contract is profitable only once its target has a pad.
	 * The run ends broke (purse below zero, or stranded with no affordable exit)
	 * or complete (a catapult on every planet; cheat runs never complete).
	 */
	const CAREER = {
		evacFee: 5,
		endgamePurse: 99,
		hqMinLight: 0.5,
		lightFloor: 0.25,
		deliverySlots: 4,
		deliverySec: 240,
		competeSec: 180,
		competeEvery: 3,
		deliveryBase: 0.5,
		deliveryPerTon: 0.06,
		deliveryDistPx: 900,
		deliveryMax: 4.5,
		competeMinPx: 1500,
		competeSpanPx: 1500,
		competeBase: 2,
		competeSpan: 2
	};
	const CARGO_TONS = [4, 8, 16, 24];
	const BOARD_SIZE = CAREER.deliverySlots + 1;
	const COMPETE_SLOT = CAREER.deliverySlots;
	const TASK_NONE = 0;
	const TASK_DELIVERY = 1;
	const TASK_COMPETE = 2;
	const TASK_OFFERED = 0;
	const TASK_ACCEPTED = 1;
	const TASK_LOADED = 2;
	const CAREER_OPEN = 0;
	const CAREER_BROKE = 1;
	const CAREER_COMPLETE = 2;
	const SALT_HQ = 0xca;
	const SALT_TASK = 0xcb;
	const WORLD_SEC_PER_MIN = 60;

	function createPad() {
		return { catapult: null, panel: null, battery: null, chargeKwh: 0 };
	}

	function createTask() {
		return { kind: TASK_NONE, state: TASK_OFFERED, good: 0, tons: 0, from: -1, to: -1,
			planet: -1, minLength: 0, reward: 0, deadline: 0 };
	}

	function clearTask(task) {
		task.kind = TASK_NONE;
		task.state = TASK_OFFERED;
	}

	/* `ledger` is the purse shared with the page's score rows; pads and ship
	 * are the objects a GravitySim gates on (setLaunchNetwork) */
	function createCareer(ledger) {
		const pads = [];
		for (let i = 0; i < OrbitWorld.PLANETS; i++) pads.push(createPad());
		const tasks = [];
		for (let i = 0; i < BOARD_SIZE; i++) tasks.push(createTask());
		return {
			ledger: ledger,
			seed: 0,
			cheat: null,
			hq: -1,
			at: -1,
			stranded: false,
			pads: pads,
			padCount: 0,
			light: new Float64Array(OrbitWorld.PLANETS),
			ship: {
				hold: OrbitTech.HOLDS[0], engine: null, tank: OrbitTech.TANKS[0],
				cargoTons: 0, fuelKg: 0, mass: 0
			},
			owned: {},
			science: OrbitScience.createHull(),
			prototypes: newPrototypes(),
			research: 0,
			tasks: tasks,
			contract: -1,
			serial: 0,
			flights: 0,
			burns: 0,
			evacuations: 0,
			delivered: 0,
			competitions: 0,
			earned: 0,
			lastEnergy: 0,
			lastReward: 0,
			lastFuel: 0,
			lastResearch: 0,
			ended: CAREER_OPEN
		};
	}

	function price(career, cost) {
		return career.cheat === CHEAT_COMMUNISM ? 0 : cost;
	}

	function canPay(career, cost) {
		return career.ledger.purse + 1e-9 >= price(career, cost);
	}

	function refitShip(career) {
		career.ship.mass = OrbitTech.shipMass(career.ship, career.ship.cargoTons);
	}

	function refuelShip(career) {
		career.ship.fuelKg = career.ship.tank ? career.ship.tank.fuelCap : 0;
	}

	function draw01(career, salt) {
		career.serial += 1;
		return OrbitWorld.hashBits(career.seed, career.serial, salt) / 4294967296;
	}

	/* HQ: a random planet with enough sunlight to run its starter pad */
	function pickHq(seed, world) {
		let count = 0;
		for (let i = 0; i < world.planetCount; i++) {
			if (world.planetLight[i] >= CAREER.hqMinLight) count += 1;
		}
		let pick = OrbitWorld.hashBits(seed, 0, SALT_HQ) % count;
		for (let i = 0; i < world.planetCount; i++) {
			if (world.planetLight[i] < CAREER.hqMinLight) continue;
			if (pick === 0) return i;
			pick -= 1;
		}
		return 0;
	}

	/* pad sunlight: orbit light above a floor so no world is dead, star brightness a mild modifier */
	function fillLight(career, world) {
		const lumNorm = OrbitWorld.clamp01(Math.sqrt(world.lum) / 1.5);
		const star = 0.5 + 0.5 * lumNorm;
		for (let i = 0; i < world.planetCount; i++) {
			career.light[i] = (CAREER.lightFloor + (1 - CAREER.lightFloor) * world.planetLight[i]) * star;
		}
	}

	function fitPad(career, planet, catapult, panel, battery) {
		const pad = career.pads[planet];
		if (pad.catapult === null) career.padCount += 1;
		pad.catapult = catapult;
		pad.panel = panel;
		pad.battery = battery;
		pad.chargeKwh = battery.capacity;
	}

	/* researchable parameter spaces, in the axis order the science panel sliders use */
	const SCIENCE_KINDS = [OrbitTech.KIND_ENGINE, OrbitTech.KIND_CATAPULT];

	function newPrototypes() {
		return { engine: [], catapult: [] };
	}

	/* the tech tree itself is discovered science: its items seed the hull so the
	 * first custom inventions pay only the distance beyond known tradeoffs */
	function seedScience(career) {
		career.science = OrbitScience.createHull();
		for (let i = 0; i < OrbitTech.ENGINES.length; i++) {
			const e = OrbitTech.ENGINES[i];
			OrbitScience.acceptHull(career.science, OrbitTech.KIND_ENGINE, [e.thrust, e.mass], e.id);
		}
		for (let i = 0; i < OrbitTech.CATAPULTS.length; i++) {
			const c = OrbitTech.CATAPULTS[i];
			OrbitScience.acceptHull(career.science, OrbitTech.KIND_CATAPULT,
				[c.maxForce, c.efficiency], c.id);
		}
	}

	function researchPreview(career, family, params) {
		return OrbitScience.previewHull(career.science, family, params);
	}

	/* purse price of a preview after the active cheat (communism researches free) */
	function researchCost(career, family, params) {
		const p = OrbitScience.previewHull(career.science, family, params);
		if (!Number.isFinite(p.cost)) return Infinity;
		return price(career, p.cost);
	}

	/* one counter for the whole career, so a label names one record in every family */
	function researchLabel(career) {
		return 'R' + (career.research + 1);
	}

	/* research unlocks its point as a record on the family's ladder (owned, like a part) */
	function unlockPrototype(career, family, params, id) {
		const record = family === OrbitTech.KIND_ENGINE
			? OrbitTech.engineRecord(id, params[0], params[1])
			: OrbitTech.catapultRecord(id, params[0], params[1]);
		career.prototypes[family].push(record);
		career.owned[id] = true;
	}

	function prototypesOf(career, family) {
		return career.prototypes[family];
	}

	function prototypeById(career, family, id) {
		const list = career.prototypes[family];
		for (let i = 0; list && i < list.length; i++) {
			if (list[i].id === id) return list[i];
		}
		return null;
	}

	/* invent a parameter point at HQ: the purse pays the hull-distance fee and
	 * the point expands the career's knowledge hull for the next invention */
	function researchPoint(career, family, params, label) {
		if (career.ended !== CAREER_OPEN || career.at !== career.hq) return false;
		if (SCIENCE_KINDS.indexOf(family) < 0) return false;
		const p = OrbitScience.previewHull(career.science, family, params);
		if (!Number.isFinite(p.cost)) return false;
		const cost = price(career, p.cost);
		if (!canPay(career, cost)) return false;
		career.ledger.purse -= cost;
		OrbitScience.acceptHull(career.science, family, params, label);
		career.research += 1;
		career.lastResearch = cost;
		unlockPrototype(career, family, params, label);
		return true;
	}

	function resetCareer(career, seed, trade, cheat) {
		const grant = OrbitTech.starterGrant();
		career.seed = seed >>> 0;
		career.cheat = cheat || null;
		resetLedger(career.ledger, cheat === CHEAT_ENDGAME ? CAREER.endgamePurse : grant.purse);
		career.ledger.fee = 0;
		for (let i = 0; i < career.pads.length; i++) {
			const pad = career.pads[i];
			pad.catapult = null;
			pad.panel = null;
			pad.battery = null;
			pad.chargeKwh = 0;
		}
		career.padCount = 0;
		fillLight(career, trade.world);
		career.hq = pickHq(career.seed, trade.world);
		career.at = career.hq;
		career.stranded = false;
		career.ship.hold = grant.ship.hold;
		career.ship.engine = grant.ship.engine;
		career.ship.tank = grant.ship.tank;
		career.ship.cargoTons = 0;
		career.owned = {};
		career.prototypes = newPrototypes();
		seedScience(career);
		career.research = 0;
		career.lastResearch = 0;
		/* the starter fit is owned from the start, so every refit is reversible */
		ownPart(career, career.ship.hold);
		ownPart(career, career.ship.tank);
		fitPad(career, career.hq, grant.pad.catapult, grant.pad.panel, grant.pad.battery);
		if (career.cheat === CHEAT_ENDGAME) fitEndgame(career);
		refitShip(career);
		refuelShip(career);
		for (let i = 0; i < BOARD_SIZE; i++) clearTask(career.tasks[i]);
		career.contract = -1;
		career.serial = 0;
		career.flights = 0;
		career.burns = 0;
		career.evacuations = 0;
		career.delivered = 0;
		career.competitions = 0;
		career.earned = 0;
		career.lastEnergy = 0;
		career.lastReward = 0;
		career.lastFuel = 0;
		career.ended = CAREER_OPEN;
		refreshBoard(career, trade, 0);
	}

	function topTier(table) {
		return table[table.length - 1];
	}

	function ownPart(career, item) {
		if (item !== null) career.owned[item.id] = true;
	}

	/* endgame cheat: every pad at top tier, every ship part owned and the ship fully fitted */
	function fitEndgame(career) {
		for (let i = 0; i < career.pads.length; i++) {
			fitPad(career, i, topTier(OrbitTech.CATAPULTS), topTier(OrbitTech.PANELS),
				topTier(OrbitTech.BATTERIES));
		}
		for (let k = 0; k < OrbitTech.PART_KINDS.length; k++) {
			const table = OrbitTech.TABLES[OrbitTech.PART_KINDS[k]];
			for (let i = 0; i < table.length; i++) ownPart(career, table[i]);
		}
		career.ship.hold = topTier(OrbitTech.HOLDS);
		career.ship.engine = topTier(OrbitTech.ENGINES);
		career.ship.tank = topTier(OrbitTech.TANKS);
	}

	/* places the idle vessel on a planet and syncs the sim's landed base */
	function placeShip(career, sim, planet) {
		career.at = planet;
		career.stranded = career.pads[planet].catapult === null;
		if (!career.stranded) refuelShip(career);
		sim.relocate(planet);
	}

	/* a career begins with the vessel on HQ and the sim gating on the network */
	function startCareer(career, sim, seed, trade, cheat) {
		resetCareer(career, seed, trade, cheat);
		sim.setLaunchNetwork(career.pads, career.ship);
		placeShip(career, sim, career.hq);
	}

	/* broke = negative purse, or stranded without the money for any way out
	 * (a catapult where the vessel sits, or the evacuation) */
	function checkEnded(career) {
		if (career.ended !== CAREER_OPEN) return career.ended;
		const purse = career.ledger.purse;
		const evac = price(career, CAREER.evacFee);
		const exit = career.at < 0 ? evac : Math.min(evac, price(career, OrbitTech.CATAPULTS[0].buildCost));
		if (purse < -1e-9 || (career.stranded && purse + 1e-9 < exit)) career.ended = CAREER_BROKE;
		else if (career.cheat === null && career.padCount === career.pads.length) {
			career.ended = CAREER_COMPLETE;
		}
		return career.ended;
	}

	/* --- building ------------------------------------------------------ */

	/* a first catapult brings a starter panel and battery (charged) with it;
	 * a panel or battery needs a pad to sit on */
	function buildGear(career, planet, kind, item) {
		const pad = career.pads[planet];
		const fresh = kind === OrbitTech.KIND_CATAPULT && pad.catapult === null;
		if (!fresh && !OrbitTech.upgrades(pad, kind, item)) return false;
		if (!canPay(career, item.buildCost)) return false;
		career.ledger.purse -= price(career, item.buildCost);
		if (fresh) {
			fitPad(career, planet, item, OrbitTech.PANELS[0], OrbitTech.BATTERIES[0]);
		} else {
			pad[kind] = item;
			if (kind === OrbitTech.KIND_BATTERY) pad.chargeKwh = item.capacity;
		}
		if (planet === career.at) {
			career.stranded = false;
			refuelShip(career);
		}
		checkEnded(career);
		return true;
	}

	function bulkUpgradeCost(career, kind, item) {
		return price(career, OrbitTech.bulkUpgradeCost(career.pads, kind, item));
	}

	/* applies `item` to every already-built facility of `kind` at once */
	function bulkUpgrade(career, kind, item) {
		const cost = bulkUpgradeCost(career, kind, item);
		if (career.ledger.purse + 1e-9 < cost) return false;
		for (let i = 0; i < career.pads.length; i++) {
			const pad = career.pads[i];
			if (!OrbitTech.upgrades(pad, kind, item)) continue;
			pad[kind] = item;
			if (kind === OrbitTech.KIND_BATTERY) pad.chargeKwh = item.capacity;
		}
		career.ledger.purse -= cost;
		return true;
	}

	/* ship parts are refitted at HQ; a bought part stays owned, so swapping back
	 * to a lighter owned tier is free; only the engine has a `null` = none step */
	function installPart(career, kind, item) {
		if (career.at !== career.hq || career.ship[kind] === item) return false;
		if (item === null && kind !== OrbitTech.KIND_ENGINE) return false;
		if (kind === OrbitTech.KIND_HOLD && item.capacity < career.ship.cargoTons) return false;
		if (item !== null && !career.owned[item.id]) {
			if (!canPay(career, item.buildCost)) return false;
			career.ledger.purse -= price(career, item.buildCost);
			ownPart(career, item);
		}
		career.ship[kind] = item;
		refitShip(career);
		refuelShip(career);
		return true;
	}

	/* --- contracts ----------------------------------------------------- */

	function planetDistance(trade, a, b) {
		const dx = trade.planetX[a] - trade.planetX[b];
		const dy = trade.planetY[a] - trade.planetY[b];
		return Math.sqrt(dx * dx + dy * dy);
	}

	function round2(value) {
		return Math.round(value * 100) / 100;
	}

	/* delivery: a colony with a real export to the colony short of that good
	 * (else the lowest supply); pays by tons, scarcity and distance, capped
	 * below the evacuation fee */
	function makeDelivery(career, trade, step, task) {
		const colonies = trade.colonies;
		const count = colonies.length;
		if (count < 2) return false;
		const first = Math.floor(draw01(career, SALT_TASK) * count);
		let src = null;
		let good = -1;
		for (let k = 0; k < count && good < 0; k++) {
			src = colonies[(first + k) % count];
			good = OrbitEcon.bestExport(src);
		}
		if (good < 0) return false;
		let dst = null;
		let bestShort = 0;
		let lowSupply = 2;
		for (let k = 0; k < count; k++) {
			const colony = colonies[k];
			if (colony === src) continue;
			const short = OrbitEcon.goodShortfall(colony, good);
			const supply = OrbitEcon.marketSupply(colony, good);
			const better = bestShort > 0 ? short > bestShort : short > 0 || supply < lowSupply;
			if (!better) continue;
			dst = colony;
			bestShort = short;
			lowSupply = supply;
		}
		const tons = CARGO_TONS[Math.floor(draw01(career, SALT_TASK) * CARGO_TONS.length)];
		const scarcity = 1 - OrbitEcon.marketSupply(dst, good);
		const dist = Math.min(planetDistance(trade, src.planet, dst.planet), CAREER.deliveryDistPx);
		const pay = CAREER.deliveryBase + tons * CAREER.deliveryPerTon * (1 + scarcity) *
			(1 + dist / CAREER.deliveryDistPx);
		task.kind = TASK_DELIVERY;
		task.state = TASK_OFFERED;
		task.good = good;
		task.tons = tons;
		task.from = src.planet;
		task.to = dst.planet;
		task.planet = -1;
		task.minLength = 0;
		task.reward = round2(Math.min(pay, CAREER.deliveryMax));
		task.deadline = step + Math.round(CAREER.deliverySec / GravitySim.DT);
		return true;
	}

	/* competition: one flight launched from `planet` that lands after at least `minLength` px */
	function makeCompete(career, step, task) {
		task.kind = TASK_COMPETE;
		task.state = TASK_OFFERED;
		task.planet = Math.floor(draw01(career, SALT_TASK) * OrbitWorld.PLANETS);
		task.minLength = Math.round((CAREER.competeMinPx + draw01(career, SALT_TASK) * CAREER.competeSpanPx) / 50) * 50;
		task.reward = round2(CAREER.competeBase + draw01(career, SALT_TASK) * CAREER.competeSpan);
		task.from = -1;
		task.to = -1;
		task.good = 0;
		task.tons = 0;
		task.deadline = step + Math.round(CAREER.competeSec / GravitySim.DT);
	}

	function dropContract(career) {
		if (career.contract < 0) return;
		clearTask(career.tasks[career.contract]);
		career.contract = -1;
		career.ship.cargoTons = 0;
		refitShip(career);
	}

	/* drops expired offers (and an expired contract with its cargo), refills the board */
	function refreshBoard(career, trade, step) {
		for (let i = 0; i < BOARD_SIZE; i++) {
			const task = career.tasks[i];
			if (task.kind === TASK_NONE || step <= task.deadline) continue;
			if (i === career.contract) dropContract(career);
			else clearTask(task);
		}
		for (let i = 0; i < CAREER.deliverySlots; i++) {
			const task = career.tasks[i];
			if (task.kind === TASK_NONE) makeDelivery(career, trade, step, task);
		}
		const compete = career.tasks[COMPETE_SLOT];
		if (compete.kind === TASK_NONE && draw01(career, SALT_TASK) * CAREER.competeEvery < 1) {
			makeCompete(career, step, compete);
		}
	}

	function canAccept(career, index) {
		const task = career.tasks[index];
		return task.kind === TASK_DELIVERY && task.state === TASK_OFFERED &&
			career.contract < 0 && career.ship.hold.capacity >= task.tons;
	}

	function loadCargo(career, task) {
		task.state = TASK_LOADED;
		career.ship.cargoTons = task.tons;
		refitShip(career);
	}

	/* one contract at a time; cargo loads at once when the ship already sits at the origin */
	function acceptTask(career, index) {
		if (!canAccept(career, index)) return false;
		const task = career.tasks[index];
		task.state = TASK_ACCEPTED;
		career.contract = index;
		if (career.at === task.from) loadCargo(career, task);
		return true;
	}

	function pay(career, amount) {
		career.ledger.purse += amount;
		career.earned += amount;
		career.lastReward += amount;
	}

	/* landing on `planet`: cargo pickup, delivery payout, competition payout */
	function settleLanding(career, sim, planet, step) {
		for (let i = 0; i < BOARD_SIZE; i++) {
			const task = career.tasks[i];
			if (task.kind !== TASK_COMPETE || sim.origin !== task.planet) continue;
			if (sim.flightLength < task.minLength || step > task.deadline) continue;
			pay(career, task.reward);
			career.competitions += 1;
			clearTask(task);
		}
		if (career.contract < 0) return;
		const task = career.tasks[career.contract];
		if (task.state === TASK_ACCEPTED && planet === task.from) loadCargo(career, task);
		else if (task.state === TASK_LOADED && planet === task.to) {
			pay(career, task.reward);
			career.delivered += 1;
			dropContract(career);
		}
	}

	/* --- flights ------------------------------------------------------- */

	/* the pad battery pays for the launch; the purse does not */
	function careerBeginFlight(career, sim) {
		const pad = career.pads[sim.origin];
		const energy = OrbitTech.launchEnergy(career.ship.mass, pad.catapult, sim.speed);
		pad.chargeKwh = pad.chargeKwh > energy ? pad.chargeKwh - energy : 0;
		refuelShip(career);
		career.lastEnergy = energy;
		career.lastReward = 0;
		career.lastFuel = 0;
		career.flights += 1;
		openFlight(career.ledger, sim, 0);
	}

	/* spends tank fuel for an in-flight impulse burn at the current step boundary */
	function careerBurn(career, sim, angle, dv) {
		if (career.ended !== CAREER_OPEN || !sim.canBurn(dv)) return false;
		const ship = career.ship;
		const used = OrbitTech.impulseFuel(dv, ship.engine, ship.mass, ship.fuelKg);
		if (!(used > 0)) return false;
		if (!sim.burn(angle, dv)) return false;
		ship.fuelKg = ship.fuelKg > used ? ship.fuelKg - used : 0;
		career.burns += 1;
		career.lastFuel += used;
		return true;
	}

	/* pads charge on the world clock (DT · rate world minutes per step): solar gain
	 * over those minutes minus the battery's slow leak (one world minute = one leak year) */
	function careerAdvance(career, rate, steps) {
		const minutes = steps * GravitySim.DT * rate;
		const seconds = minutes * WORLD_SEC_PER_MIN;
		for (let i = 0; i < career.pads.length; i++) {
			const pad = career.pads[i];
			if (pad.catapult === null) continue;
			const charge = OrbitTech.batteryLeak(pad.battery, pad.chargeKwh, minutes) +
				OrbitTech.solarCharge(pad.panel, career.light[i], seconds);
			pad.chargeKwh = charge < pad.battery.capacity ? charge : pad.battery.capacity;
		}
	}

	/* a landing settles contracts; a vessel that left the map or timed out is
	 * lost in space (at = -1) and only an evacuation brings it back */
	function careerEndFlight(career, sim, trade, step) {
		endFlight(career.ledger);
		const landed = sim.endReason === GravitySim.END_IMPACT && sim.endBody >= 0;
		if (landed) settleLanding(career, sim, sim.endBody, step);
		career.at = landed ? sim.endBody : -1;
		career.stranded = !landed || career.pads[sim.endBody].catapult === null;
		if (!career.stranded) refuelShip(career);
		refreshBoard(career, trade, step);
		return checkEnded(career);
	}

	/* flies the stranded ship home for the fee (the cargo rides along) */
	function evacuate(career, sim) {
		if (!career.stranded) return false;
		career.ledger.purse -= price(career, CAREER.evacFee);
		career.evacuations += 1;
		placeShip(career, sim, career.hq);
		checkEnded(career);
		return true;
	}

	/* > 0 when actor `a` beats `b` under `ruleName` */
	function compareScores(ruleName, a, b) {
		if (ruleName === RULE_ROUTE) {
			return Math.abs(a.length - b.length) > 0.5 ? a.length - b.length : 0;
		}
		if (ruleName === RULE_MONEY || ruleName === RULE_CAREER) {
			if (Math.abs(a.purse - b.purse) > 1e-9) return a.purse - b.purse;
			if (a.visited !== b.visited) return a.visited - b.visited;
			if (a.shots !== b.shots) return b.shots - a.shots;
			return b.steps - a.steps;
		}
		if (a.visited !== b.visited) return a.visited - b.visited;
		if (a.shots !== b.shots) return b.shots - a.shots;
		if (a.steps !== b.steps) return b.steps - a.steps;
		return a.purse - b.purse;
	}

	const GravityGame = {
		FORMAT, ANGLE_STEPS, SPEED_STEPS, CAP_SECONDS, CAP_STEPS, RATE_MIN, RATE_MAX,
		ROUTE_SECONDS, ROUTE_STEPS, MONEY_SHOTS,
		RULE_TOUR, RULE_ROUTE, RULE_MONEY, RULE_CAREER, RULES,
		BOT_OFF, BOT_EASY, BOT_NORMAL, BOT_HARD, BOTS,
		PLAYER_USER, PLAYER_BOT, PLAYER_TYPES,
		CHEAT_COMMUNISM, CHEAT_ENDGAME, CHEATS,
		SRC_PLANETS, SRC_PORTS, NO_ABORT, MONEY, PURSE_PRESETS, EXPERIMENT,
		angleUnits, angleOf, speedUnits, speedOf,
		createBurn, encodeBurn, createShot, encodeShot, encodeLink, decodeShot, decodeLink, isGameLink,
		initSteps, createMarket, resetMarket, planetProfit,
		createLedger, resetLedger, beginFlight, stepHarvest, endFlight,
		estimateProfit, compareScores,
		CAREER, BOARD_SIZE, COMPETE_SLOT, CARGO_TONS,
		TASK_NONE, TASK_DELIVERY, TASK_COMPETE, TASK_OFFERED, TASK_ACCEPTED, TASK_LOADED,
		CAREER_OPEN, CAREER_BROKE, CAREER_COMPLETE,
		createCareer, resetCareer, startCareer, checkEnded,
		SCIENCE_KINDS, seedScience, researchPreview, researchCost, researchLabel, researchPoint,
		prototypesOf, prototypeById,
		buildGear, bulkUpgradeCost, bulkUpgrade, installPart,
		refreshBoard, canAccept, acceptTask, dropContract,
		careerBeginFlight, careerBurn, careerAdvance, careerEndFlight, evacuate
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = GravityGame;
	else root.GravityGame = GravityGame;
})(typeof globalThis !== 'undefined' ? globalThis : this);

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
		career: { name: RULE_CAREER, capSteps: CAP_STEPS, horizon: null, maxShots: 0, stopOnTour: false, planner: false, solo: false, humanOnly: true }
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
	 * (≈ +0.24) and grows toward the 3.00 cap along a saturation curve whose
	 * slope starts at +0.00625 per flight-second (+0.25 per 40 s) and eases
	 * off as the value nears the cap, reaching it only at infinite age.
	 * Entering a planet's port orbit collects its value and resets it to 0.00.
	 */
	const MONEY = {
		cost: 1,
		k: 0.00625,
		initSec: 40,
		cap: 3,
		purse0: 3
	};
	const PURSE_PRESETS = { tight: 2, standard: 3, relaxed: 6 };
	/*
	 * Visit-profit collection modes. `HARVEST_ENTRY` is the rule: the first
	 * encounter with a system pays everything it has accrued since the last one
	 * and stamps its clock, so a long flight that crosses the same system again
	 * later collects what regrew in between. The experimental `HARVEST_TICK`
	 * also pays, on every step the ship stays inside, what re-accrued during
	 * that step — a slow or looping pass earns more than a fly-by. Career only;
	 * the traces that price a shot still assume the entry rule (see
	 * 0.4.30-plan-harvest-ticks.md).
	 */
	const HARVEST_ENTRY = 0;
	const HARVEST_TICK = 1;
	let harvestMode = HARVEST_ENTRY;
	/* experimental settings panel bounds; links carry the two multipliers */
	const EXPERIMENT = {
		gravityMin: 0, gravityMax: 9,
		forceMin: 0.25, forceMax: 3
	};
	const SRC_PLANETS = 0;
	const SRC_PORTS = 1;
	const SRC_CODES = 'pm';
	const NO_ABORT = -1;
	const SALT_GRAVITY = 0xce;
	const PLANET_GRAVITY_MIN = -1;
	const PLANET_GRAVITY_MAX = 3.5;
	const PLANET_GRAVITY_STEPS = 20;
	const PLANET_GRAVITY_CHOICES = (PLANET_GRAVITY_MAX - PLANET_GRAVITY_MIN) * PLANET_GRAVITY_STEPS + 1;
	const SHOT_FORM = /^([pm])(\d{1,2})\.([0-9a-z]{1,4})\.([0-9a-z]{1,4})(?:\.([0-9a-z]{1,4}))?$/;
	const BURN_FORM = /^b([0-9a-z]{1,4})\.([0-9a-z]{1,4})\.([0-9a-z]{1,4})$/;
	const END_FORM = /^(\d{1,2})\.(\d{1,9})$/;
		const estScratch = new Int32Array(OrbitWorld.PLANETS);
	/* launch book: saved career trajectories and the visit log each one keeps */
	const BOOK_MAX = 10;
	const BOOK_LOG_MAX = 64;

	/* A separate seed stream keeps gravity stable when planets are added or removed. */
	function planetGravity(seed, planet) {
		const step = Math.floor(OrbitWorld.hash01(seed, planet, SALT_GRAVITY) * PLANET_GRAVITY_CHOICES);
		return (step + PLANET_GRAVITY_MIN * PLANET_GRAVITY_STEPS) / PLANET_GRAVITY_STEPS;
	}

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
			scalePart('gs', game.gravityScale) + scalePart('fs', game.forceScale) +
			(game.harvestTick ? '&ht=1' : '');
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
	 * harvestTick, shots, end, length } or null. */
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
		const harvestText = params.get('ht');
		if (harvestText !== null && harvestText !== '1' && harvestText !== '0') return null;
		const harvestTick = harvestText === '1';
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
			gravityScale: gravityScale, forceScale: forceScale, harvestTick: harvestTick,
			shots: shots, end: end, length: length };
	}

	function isGameLink(text) {
		return new URLSearchParams(String(text).replace(/^#/, '')).has('game');
	}

	function initSteps() {
		return Math.round(MONEY.initSec / GravitySim.DT);
	}

	/*
	 * Shared per-planet state for a game run; player and rivals harvest from
	 * the same table. The political half (0.5.12) is the same kind of shared
	 * ground: rot, the visit that carried a bribe, the rebellion clock and the
	 * seized rail of each planet. `galaxy` is bound by bindRun and is what
	 * makes the political clock run at all; `politicsSeed`/`politicsSerial`
	 * are the deterministic stream every roll reads.
	 */
	function createMarket() {
		const market = {
			lastVisitStep: new Int32Array(OrbitWorld.PLANETS),
			visitPay: new Float64Array(OrbitWorld.PLANETS),
			corruption: new Float64Array(OrbitWorld.PLANETS),
			bribeVisitStep: new Int32Array(OrbitWorld.PLANETS),
			rebel: new Uint8Array(OrbitWorld.PLANETS),
			seized: new Uint8Array(OrbitWorld.PLANETS),
			rebelSinceStep: new Int32Array(OrbitWorld.PLANETS),
			patients: new Uint8Array(OrbitWorld.PLANETS),
			rebelCooldownStep: new Int32Array(OrbitWorld.PLANETS),
			lastCheckEpoch: new Int32Array(OrbitWorld.PLANETS),
			rebelPads: new Array(OrbitWorld.PLANETS),
			stamp: 0,
			k: MONEY.k,
			arfPlanet: -1,
			capitalPlanet: -1,
			politicsSeed: 1,
			politicsSerial: 0,
			politicsStep: -1,
			politicsRate: 1,
			politicsSec: 0,
			galaxy: null
		};
		resetMarket(market);
		return market;
	}

	function resetMarket(market) {
		market.lastVisitStep.fill(-initSteps());
		market.visitPay.fill(0);
		market.stamp += 1;
		market.k = MONEY.k;
		market.arfPlanet = -1;
		market.capitalPlanet = -1;
		market.corruption.fill(0);
		market.bribeVisitStep.fill(-1);
		market.rebel.fill(0);
		market.seized.fill(0);
		market.rebelSinceStep.fill(0);
		market.patients.fill(0);
		market.rebelCooldownStep.fill(0);
		market.lastCheckEpoch.fill(-1);
		market.rebelPads.fill(null);
		market.politicsSeed = 1;
		market.politicsSerial = 0;
		market.politicsStep = -1;
		market.politicsRate = 1;
		market.politicsSec = 0;
		market.galaxy = null;
	}

	/*
	 * One run, one political world: the market owns the shared arrays and the
	 * galaxy names the careers they act on. Called by the page and by benches;
	 * without it every political rule is inert, which keeps the historical
	 * career numbers of `career_bench` untouched.
	 */
	function bindRun(market, galaxy, world) {
		market.galaxy = galaxy || null;
		market.politicsSeed = world ? world.seed >>> 0 : 1;
		if (!galaxy) return market;
		galaxy.market = market;
		for (let i = 0; i < galaxy.actors.length; i++) galaxy.actors[i].market = market;
		return market;
	}

	/* wire the seeded world's specials into the shared market (career runs only);
	 * with the A/B switch off the indices stay -1 and every planet pays normally */
	function applyMarketSpecials(market, world) {
		if (specialPlanets && world) {
			market.arfPlanet = world.arfPlanet;
			market.capitalPlanet = world.capitalPlanet;
		} else {
			market.arfPlanet = -1;
			market.capitalPlanet = -1;
		}
		if (world) market.politicsSeed = world.seed >>> 0;
	}

	/* cap·(1 − e^(−k·age/cap)): initial slope k, asymptote cap at infinite age */
	function planetProfitAtStep(lastStep, runStep, k) {
		const age = (runStep - lastStep) * GravitySim.DT;
		if (age <= 0) return 0;
		return -MONEY.cap * Math.expm1(-age * (k === undefined ? MONEY.k : k) / MONEY.cap);
	}

	/* career clock seconds of a step: the political formulas are priced in
	 * the same seconds the HUD prints, scaled by the world speed setting */
	function politicsSeconds(market, step) {
		return step * GravitySim.DT * market.politicsRate;
	}

	/* the rail the rebels run on `planet`, or null; a seized rail outlives the
	 * rebellion as a commercial one */
	function rebelRail(career, planet) {
		const market = career.market;
		return market && market.seized[planet] ? (market.rebelPads[planet] || COMMERCIAL_PAD) : null;
	}

	/*
	 * The one special-aware visit value every harvest and estimate reads:
	 * A.R.F. pays 0, the Capital charges a flat −3 on each entry, every other
	 * planet grows toward the cap. A rebellious planet multiplies its growing
	 * value by the fly-by ramp. Every planet still stamps lastVisitStep, so
	 * the market clock advances exactly as a normal visit would.
	 */
	function planetProfitAt(market, planet, at, lastStep) {
		if (planet === market.capitalPlanet) return CAPITAL_VISIT_PAY;
		if (planet === market.arfPlanet) return 0;
		const pay = planetProfitAtStep(lastStep, at, market.k);
		if (!market.rebel[planet]) return pay;
		const age = politicsSeconds(market, at) -
			politicsSeconds(market, market.rebelSinceStep[planet]);
		return pay * OrbitEcon.flybyMultiplier(age);
	}

	function planetProfit(market, planet, runStep) {
		return planetProfitAt(market, planet, runStep, market.lastVisitStep[planet]);
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

	/*
	 * One fly-visit: collect the value, stamp the clock, and let the rulers
	 * breathe — a visit is the only thing that clears rot, and it also opens a
	 * fresh window for one bribe (the rulers only complain once per visit).
	 */
	function harvestPlanet(ledger, market, planet, runStep) {
		const pay = planetProfit(market, planet, runStep);
		market.lastVisitStep[planet] = runStep;
		market.visitPay[planet] = pay;
		market.stamp += 1;
		if (planet !== market.capitalPlanet && planet !== market.arfPlanet &&
			market.corruption[planet] > 0) {
			market.corruption[planet] = OrbitEcon.clampCorruption(
				market.corruption[planet] - OrbitEcon.CORRUPTION_VISIT_DECAY);
		}
		market.bribeVisitStep[planet] = -1;
		ledger.purse += pay;
		ledger.shotGain += pay;
		ledger.shotVisits += 1;
		ledger.lastPlanet = planet;
		return pay;
	}

	/*
	 * One step of the experimental stay-pay: every system the ship is inside
	 * pays what re-accrued since its last stamp, so a system the ship never
	 * leaves keeps paying instead of sitting at the value it had on entry. The
	 * systems it launched from are inside already, so their stored value — pad
	 * time included — is collected by the first flight step; stamping them at
	 * launch instead would delete that value from the shared market, which is
	 * the one thing this mode must not do.
	 *
	 * Deliberately no `market.stamp` bump: that one invalidates a rival's
	 * sliced plan, and a drip on every step would leave no plan ever
	 * finishing. No `shotVisits` either: lingering in a system is not another
	 * encounter.
	 */
	function harvestStay(ledger, market, sim, runStep) {
		const count = sim.planetCount;
		const inside = ledger.inside;
		let gained = 0;
		for (let p = 0; p < count; p++) {
			if (!inside[p]) continue;
			const pay = planetProfit(market, p, runStep);
			if (pay <= 0) continue;
			market.lastVisitStep[p] = runStep;
			ledger.purse += pay;
			ledger.shotGain += pay;
			gained += pay;
		}
		return gained;
	}

	/* advances one step of system-entry harvesting for either the player or a rival */
	function stepHarvest(ledger, market, sim, runStep) {
		const count = sim.stepInsideAt(sim.cargo.x, sim.cargo.y, ledger.inside, ledger.entered);
		let gained = 0;
		for (let i = 0; i < count; i++) {
			gained += harvestPlanet(ledger, market, ledger.entered[i], runStep);
		}
		if (harvestMode === HARVEST_TICK) gained += harvestStay(ledger, market, sim, runStep);
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

	/* the page's experimental panel drives the collection mode for every ledger */
	function setHarvestMode(mode) {
		harvestMode = mode === HARVEST_TICK ? HARVEST_TICK : HARVEST_ENTRY;
		return harvestMode;
	}

	function harvestModeOf() {
		return harvestMode;
	}

	/* exact predicted harvest of one visit log without mutating the live market;
	 * it prices specials exactly like the live harvest, not the raw growth curve */
	function estimateProfitLog(market, baseStep, planets, steps, count) {
		if (count === 0) return 0;
		estScratch.set(market.lastVisitStep);
		let total = 0;
		for (let i = 0; i < count; i++) {
			const planet = planets[i];
			const at = baseStep + steps[i];
			total += planetProfitAt(market, planet, at, estScratch[planet]);
			estScratch[planet] = at;
		}
		return total;
	}

	/* exact predicted harvest along a traced probe */
	function estimateProfit(market, baseStep, sim) {
		return estimateProfitLog(market, baseStep, sim.predLogPlanet, sim.predLogStep,
			sim.predLogCount);
	}

	/* the generated universe is always PLANET_MAX planets; a run plays a subset.
	 * `mask[i] === 1` marks a planet in play and `count` is how many there are.
	 * The visit profit grows faster on a smaller world (k scales by
	 * PLANET_MAX / count) so a 13-planet career regenerates profit 2× as fast
	 * as the 26-planet default and the economy keeps pace. */
	function setCareerUniverse(career, mask, count) {
		career.planetMask = mask;
		career.planetCount = count;
	}

	function applyMarketUniverse(market, mask, count) {
		market.planetMask = mask;
		market.planetCount = count;
		market.k = MONEY.k * (OrbitWorld.DEFAULT_PLANETS / count);
	}

	/* a planet of the run's universe is in play when it is not masked out */
	function planetInPlay(career, planet) {
		return planet >= 0 && planet < OrbitWorld.PLANETS &&
			(!career.planetMask || career.planetMask[planet] === 1);
	}

	/* --- career ------------------------------------------------------------ */

	/*
	 * Career: launching spends the pad's solar-charged battery. The purse grows
	 * from the shared visit market (the always-available "visit a long-unvisited
	 * planet" task), delivery contracts (land cargo on a planet, needs a hold)
	 * and route competitions (one flight from a planet at least `minLength`
	 * long). Every planet carries an EMC (electromagnetic catapult) and the
	 * planet is claimed by whoever owns the best rail on it: your own EMC
	 * launches for its battery energy alone, a rival player's EMC charges a
	 * usage tax that scales with the energy of the shot and pays that player,
	 * and the neutral commercial EMC-1 standing on every planet charges a flat
	 * fee. So a padless planet is no longer a dead end, only an expensive one.
	 * The run ends broke (purse below zero, or no affordable exit) or complete
	 * (a catapult on every planet; cheat runs never complete).
	 */
	const CAREER = {
		evacFee: 6,
		commercialFee: 3,
		taxPerKwh: 1,
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
		competeSpan: 2,
		turretMinSec: 2,
		turretSpanSec: 3
	};
	const FUEL_KG_PER_KWH = 20;
	const FUEL_PRICE = 0.08;
	const FUEL_BUY_STEP = 10;
	const CARGO_TONS = [4, 8, 16, 24];
	const COMPETE_SLOT = CAREER.deliverySlots;
	const MEDIC_SLOT = CAREER.deliverySlots + 1;
	const BOARD_SIZE = CAREER.deliverySlots + 2;
	const TASK_NONE = 0;
	const TASK_DELIVERY = 1;
	const TASK_COMPETE = 2;
	const TASK_MEDIC = 3;
	const TASK_OFFERED = 0;
	const TASK_ACCEPTED = 1;
	const TASK_LOADED = 2;
	const CAREER_OPEN = 0;
	const CAREER_BROKE = 1;
	const CAREER_COMPLETE = 2;
	const SALT_HQ = 0xca;
	const SALT_TASK = 0xcb;
	const SALT_TURRET = 0xcc;
	const SALT_RIVAL = 0xcd;
	const SALT_POLITICS = 0xce;
	const SALT_ARREST = 0xcf;
	const SALT_BRIBE = 0xd0;
	const WORLD_SEC_PER_MIN = 60;
	const TAU = Math.PI * 2;

	/*
	 * The commercial EMC-1 is the fallback pad of every planet: a neutral
	 * operator keeps it fully charged and charges a flat fee per launch. It is
	 * one immutable record — nothing drains or upgrades it.
	 */
	const COMMERCIAL_PAD = {
		catapult: OrbitTech.CATAPULTS[0],
		panel: OrbitTech.PANELS[0],
		battery: OrbitTech.BATTERIES[0],
		chargeKwh: OrbitTech.BATTERIES[0].capacity,
		reservedKwh: 0
	};
	const OWNER_COMMERCIAL = -1;

	/*
	 * The Empire Capital's fixed imperial rail (0.5.11): one immutable EMC-3
	 * pad, always full, never reserved, free to launch from. Nobody owns or
	 * builds it; every actor's launchPads[capitalPlanet] points here. Like the
	 * commercial rail it never drains, but it claims the planet for the Empire
	 * and forbids building.
	 */
	const OWNER_CAPITAL = -2;
	const CAPITAL_PAD = {
		catapult: OrbitTech.CATAPULTS[2],
		panel: OrbitTech.PANELS[2],
		battery: OrbitTech.BATTERIES[2],
		chargeKwh: OrbitTech.BATTERIES[2].capacity,
		reservedKwh: 0
	};
	/* a fly-visit to the Capital pays this flat fee on each entry; A.R.F. pays 0 */
	const CAPITAL_VISIT_PAY = -3;
	/* tourist-delivery bias: A.R.F. destinations and Capital resort origins and
	 * destinations each weigh 2x an ordinary endpoint (0.5.11) */
	const TOURIST_CHANCE = 0.35;
	const TOURIST_WEIGHT = 2;

	/*
	 * Rebellious worlds (0.5.12). A rebellion seizes every player rail on its
	 * planet into one commercial rail the rebels run: the tiers survive, the
	 * fee is the ordinary commercial one, and the planet can never be claimed
	 * or built again. Until it is quelled, visits there pay a fly-by multiple
	 * that ramps from 1x toward 4x as the rebellion ages.
	 */
	const OWNER_REBEL = -3;

	/* politics is a property of the shared market; the A/B switch freezes the
	 * whole clock (POLITICS=0 reproduces the 0.5.11 economy) */
	let politics = true;
	function setPolitics(on) {
		politics = Boolean(on);
		return politics;
	}
	function politicsOn() {
		return politics;
	}

	/* specials are a property of the seeded world; the A/B switch turns their
	 * rules off without touching geometry (SPECIAL=0 reproduces the old economy) */
	let specialPlanets = true;
	function setSpecialPlanets(on) {
		specialPlanets = Boolean(on);
		return specialPlanets;
	}
	function specialPlanetsOn() {
		return specialPlanets;
	}

	/* `reservedKwh` is the charge queued launches have already claimed */
	function createPad() {
		return { catapult: null, panel: null, battery: null, chargeKwh: 0, reservedKwh: 0 };
	}

	/*
	 * A queued launch claims the energy of its shot from the pad battery before
	 * the barrel lines up, so whoever queued first gets the charge — the owner
	 * of the rail and a guest on it alike. The reservation lowers everyone's
	 * launch ceiling (GravitySim.speedLimit) until the shot fires or is
	 * cancelled, and the neutral commercial rail (kept charged by its operator)
	 * never reserves nor drains.
	 */
	function reserveEnergy(pad, energy) {
		if (!pad || pad === COMMERCIAL_PAD || pad === CAPITAL_PAD || !(energy > 0)) return;
		pad.reservedKwh += energy;
	}

	function releaseEnergy(pad, energy) {
		if (!pad || pad === COMMERCIAL_PAD || pad === CAPITAL_PAD || !(energy > 0)) return;
		pad.reservedKwh = pad.reservedKwh > energy ? pad.reservedKwh - energy : 0;
	}

	function createTask() {
		return { kind: TASK_NONE, state: TASK_OFFERED, good: 0, tons: 0, from: -1, to: -1,
			planet: -1, minLength: 0, reward: 0, deadline: 0, tourist: false,
			medics: 0, patients: 0, aboard: 0 };
	}

	function clearTask(task) {
		task.kind = TASK_NONE;
		task.state = TASK_OFFERED;
		task.tourist = false;
		task.medics = 0;
		task.patients = 0;
		task.aboard = 0;
	}

	/* --- EMC network ------------------------------------------------------- */

	/*
	 * A galaxy is the shared map of one career run: every actor (you and each
	 * rival player) owns pads, and `launchPads[planet]` is the EMC each actor
	 * actually fires from — its own, else the best rival EMC standing there,
	 * else the commercial one. Sim, bots and benches read that array, so the
	 * launch gate never has to know who owns what.
	 */
	function createGalaxy() {
		return {
			seed: 0,
			actors: [],
			period: new Float64Array(OrbitWorld.PLANETS),
			phase: new Float64Array(OrbitWorld.PLANETS)
		};
	}

	/* seeded turret: each planet's EMC turns once per 2…5 s of in-game career time, so
	 * a queued launch fires when the barrel lines up with the player's aim */
	function resetGalaxy(galaxy, seed) {
		galaxy.seed = seed >>> 0;
		galaxy.actors.length = 0;
		for (let p = 0; p < OrbitWorld.PLANETS; p++) {
			galaxy.period[p] = CAREER.turretMinSec + CAREER.turretSpanSec *
				(OrbitWorld.hashBits(galaxy.seed, p, SALT_TURRET) / 4294967296);
			galaxy.phase[p] = TAU * (OrbitWorld.hashBits(galaxy.seed,
				p + OrbitWorld.DEFAULT_PLANETS, SALT_TURRET) / 4294967296);
		}
	}

	function turretPeriod(galaxy, planet) {
		return galaxy.period[planet];
	}

	/* barrel direction (radians) of the planet's EMC after `seconds` */
	function turretAngle(galaxy, planet, seconds) {
		return galaxy.phase[planet] + seconds / galaxy.period[planet] * TAU;
	}

	/* actor index of the best foreign EMC on `planet`, -1 when only the commercial one stands there */
	function foreignOwner(galaxy, self, planet) {
		let owner = OWNER_COMMERCIAL;
		let tier = 0;
		for (let i = 0; i < galaxy.actors.length; i++) {
			const actor = galaxy.actors[i];
			if (actor === self) continue;
			const pad = actor.pads[planet];
			if (pad.catapult === null || pad.catapult.tier <= tier) continue;
			owner = i;
			tier = pad.catapult.tier;
		}
		return owner;
	}

	/* the pad `career` fires from on `planet`: the commercial EMC-1 stands on
	 * every planet and wins whenever it is the chosen rail, else your own EMC,
	 * else the best rival EMC, else the commercial one again */
	function padAt(career, planet) {
		if (planet === career.capitalPlanet) return CAPITAL_PAD;
		const rebel = rebelRail(career, planet);
		if (rebel) return rebel;
		if (career.commercialPlanet === planet) return COMMERCIAL_PAD;
		if (career.pads[planet].catapult !== null) return career.pads[planet];
		if (!career.galaxy) return COMMERCIAL_PAD;
		const owner = foreignOwner(career.galaxy, career, planet);
		return owner === OWNER_COMMERCIAL ? COMMERCIAL_PAD : career.galaxy.actors[owner].pads[planet];
	}

	/* owner index of that pad, -1 for the neutral commercial EMC, -2 for the
	 * fixed imperial rail on the Capital */
	function padOwner(career, planet) {
		if (planet === career.capitalPlanet) return OWNER_CAPITAL;
		const market = career.market;
		if (market && market.rebel[planet]) return OWNER_REBEL;
		/* a quelled rebellion leaves its rail commercial for good */
		if (market && market.seized[planet]) return OWNER_COMMERCIAL;
		if (career.commercialPlanet === planet) return OWNER_COMMERCIAL;
		if (career.pads[planet].catapult !== null) return career.index;
		if (!career.galaxy) return OWNER_COMMERCIAL;
		return foreignOwner(career.galaxy, career, planet);
	}

	/* choose (planet >= 0) or drop (-1) the commercial rail for the next launch;
	 * it never claims the planet and never blocks building your own EMC there */
	function setCommercial(career, planet) {
		/* the Capital rail is imperial and a rebellious planet runs its own */
		if (planet >= 0 && planet === career.capitalPlanet) return;
		if (planet >= 0 && rebelRail(career, planet)) return;
		career.commercialPlanet = planet;
		syncCareerNetwork(career);
	}

	/* planet claim: the highest rail there wins, ties keep the older actor; the
	 * Capital is always the Empire's, never a player claim */
	function claimOwner(galaxy, planet) {
		if (galaxy.actors.length > 0 && galaxy.actors[0].capitalPlanet === planet) return OWNER_CAPITAL;
		const market = galaxy.market;
		if (market && market.rebel[planet]) return OWNER_REBEL;
		if (market && market.seized[planet]) return OWNER_COMMERCIAL;
		let owner = OWNER_COMMERCIAL;
		let tier = 0;
		for (let i = 0; i < galaxy.actors.length; i++) {
			const pad = galaxy.actors[i].pads[planet];
			if (pad.catapult === null || pad.catapult.tier <= tier) continue;
			owner = i;
			tier = pad.catapult.tier;
		}
		return owner;
	}

	/* a build anywhere changes what every actor may fire from, so refresh all */
	function refreshNetwork(galaxy) {
		for (let i = 0; i < galaxy.actors.length; i++) {
			const actor = galaxy.actors[i];
			for (let p = 0; p < OrbitWorld.PLANETS; p++) actor.launchPads[p] = padAt(actor, p);
		}
	}

	/* a solo career has no galaxy: its own launchPads must still mirror padAt */
	function syncCareerNetwork(career) {
		if (career.galaxy) {
			refreshNetwork(career.galaxy);
			return;
		}
		for (let p = 0; p < OrbitWorld.PLANETS; p++) career.launchPads[p] = padAt(career, p);
	}

	function joinGalaxy(career, galaxy) {
		career.galaxy = galaxy;
		career.market = galaxy.market || career.market || null;
		career.index = galaxy.actors.indexOf(career);
		if (career.index < 0) {
			career.index = galaxy.actors.length;
			galaxy.actors.push(career);
		}
		refreshNetwork(galaxy);
	}

	/* money the EMC owner charges for a launch at `speed`; 0 on your own pad
	 * and on the Capital's free imperial rail */
	function launchFee(career, planet, speed) {
		const owner = padOwner(career, planet);
		if (owner === career.index || owner === OWNER_CAPITAL) return 0;
		if (owner === OWNER_COMMERCIAL || owner === OWNER_REBEL) {
			return price(career, CAREER.commercialFee);
		}
		const pad = padAt(career, planet);
		return price(career, CAREER.taxPerKwh *
			OrbitTech.launchEnergy(career.ship.mass, pad.catapult, speed));
	}

	/*
	 * Cheapest way off `planet` with a ship of `mass`: your own EMC is free, the
	 * commercial rail charges its fee while it can lift the ship, a rival rail
	 * its usage tax at the slowest firable shot, and a build or an evacuation
	 * is the fallback. Infinity when nothing can leave.
	 */
	function exitCostAt(career, planet, mass) {
		if (planet < 0) return price(career, CAREER.evacFee);
		if (planet === career.capitalPlanet) return 0;
		if (career.pads[planet].catapult !== null) return 0;
		const rebel = rebelRail(career, planet);
		const rail = rebel || COMMERCIAL_PAD;
		const lift = OrbitTech.speedLimit(rail.battery.capacity,
			mass, rail.catapult, career.forceScale);
		const commercial = lift + 1e-9 >= GravitySim.SPEED_MIN
			? price(career, CAREER.commercialFee) : Infinity;
		let foreign = Infinity;
		const owner = padOwner(career, planet);
		if (owner !== OWNER_COMMERCIAL && owner !== OWNER_REBEL && owner !== career.index) {
			const pad = padAt(career, planet);
			const railLift = OrbitTech.speedLimit(pad.battery.capacity,
				mass, pad.catapult, career.forceScale);
			if (railLift + 1e-9 >= GravitySim.SPEED_MIN) {
				foreign = price(career, CAREER.taxPerKwh *
					OrbitTech.launchEnergy(mass, pad.catapult, GravitySim.SPEED_MIN));
			}
		}
		const build = price(career, OrbitTech.CATAPULTS[0].buildCost);
		const evac = price(career, CAREER.evacFee);
		return Math.min(commercial, foreign, build, evac);
	}

	function exitCost(career) {
		return exitCostAt(career, career.at, career.ship.mass);
	}

	/* who owns the rail on `planet`, named as the page and the bot log read it */
	function railOwnerText(career, planet) {
		const owner = padOwner(career, planet);
		const tier = padAt(career, planet).catapult ? padAt(career, planet).catapult.tier + 1 : 1;
		if (owner === career.index) return 'own EMC-' + tier;
		if (owner === OWNER_CAPITAL) return 'imperial EMC-3';
		if (owner === OWNER_REBEL) return 'rebel EMC-' + tier;
		if (owner === OWNER_COMMERCIAL && rebelRail(career, planet)) {
			return 'seized EMC-' + tier;
		}
		if (owner === OWNER_COMMERCIAL) return 'commercial EMC-1';
		return (owner === 0 ? 'YOU' : 'R' + owner) + ' rail';
	}

	/*
	 * The live numbers behind every launch gate: the rail under the ship, its
	 * charge and the speed that buys, the fee and the purse. The launch list
	 * and the bot decision log both print this line, so a player and a rival
	 * never read two different stories about the same pad.
	 */
	function railText(career, sim, planet) {
		if (planet < 0) {
			return 'ship in space · evac ' + price(career, CAREER.evacFee).toFixed(2) +
				' · purse ' + career.ledger.purse.toFixed(2);
		}
		const pad = padAt(career, planet);
		const exit = exitCostAt(career, planet, career.ship.mass);
		return 'P' + planet + ' · ' + railOwnerText(career, planet) + ' · ' +
			pad.chargeKwh.toFixed(2) + '/' + pad.battery.capacity.toFixed(2) + ' kWh → ' +
			sim.speedLimit(planet).toFixed(0) + ' px/s (min ' + GravitySim.SPEED_MIN + ') · fee ' +
			launchFee(career, planet, GravitySim.SPEED_MIN).toFixed(2) +
			' · purse ' + career.ledger.purse.toFixed(2) + ' · exit ' +
			(Number.isFinite(exit) ? exit.toFixed(2) : 'impossible');
	}

	/*
	 * The one reason a shot at `speed` cannot leave `planet` now, in the words
	 * the launch list prints under a row and the bot log puts on a "no shot"
	 * line. '' means firable.
	 */
	function railBlock(career, sim, planet, speed) {
		if (career.arrested) return 'under arrest · Capital transport';
		if (career.at < 0) return 'ship in space';
		if (career.at !== planet) return 'shot leaves from P' + planet;
		if (!sim.canLaunchFrom(planet)) return 'no rail under the ship';
		const cap = sim.speedLimit(planet);
		if (speed > cap + 1e-9) return 'cap ' + cap.toFixed(0) + ' < ' + speed.toFixed(0) + ' px/s';
		const fee = launchFee(career, planet, speed);
		if (career.ledger.purse + 1e-9 < fee) {
			return 'fee ' + fee.toFixed(2) + ' > purse ' + career.ledger.purse.toFixed(2);
		}
		return '';
	}

	/* the rail gate plus the purse, spelled by the same facts the list prints */
	function careerCanFire(career, sim, planet, speed) {
		return railBlock(career, sim, planet, speed) === '';
	}

	/* full-battery speed cap of the pad `career` fires from on `planet` */
	function padLift(career, planet, forceScale) {
		const pad = padAt(career, planet);
		const cap = OrbitTech.speedLimit(pad.battery.capacity, career.ship.mass,
			pad.catapult, forceScale === undefined ? career.forceScale : forceScale);
		return cap;
	}

	/* deterministic rival seed: own task board, HQ and science hull per player */
	function rivalSeed(seed, index) {
		return OrbitWorld.hashBits(seed >>> 0, index + 1, SALT_RIVAL);
	}

	/* `ledger` is the purse shared with the page's score rows; pads and ship
	 * are the objects a GravitySim gates on (setLaunchNetwork) */
	function createCareer(ledger) {
		const pads = [];
		for (let i = 0; i < OrbitWorld.PLANETS; i++) pads.push(createPad());
		const launchPads = [];
		for (let i = 0; i < OrbitWorld.PLANETS; i++) launchPads.push(COMMERCIAL_PAD);
		const tasks = [];
		for (let i = 0; i < BOARD_SIZE; i++) tasks.push(createTask());
		return {
			ledger: ledger,
			seed: 0,
			cheat: null,
			galaxy: null,
			index: 0,
			/* the run's active planet subset; null = every planet in play */
			planetMask: null,
			planetCount: OrbitWorld.PLANETS,
			hq: -1,
			at: -1,
			stranded: false,
			commercialPlanet: -1,
			capitalPlanet: -1,
			arfPlanet: -1,
			launchBook: createLaunchBook(),
			pads: pads,
			launchPads: launchPads,
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
			taxPaid: 0,
			taxEarned: 0,
			lastEnergy: 0,
			lastFee: 0,
			lastReward: 0,
			lastFuel: 0,
			fuelBoughtKg: 0,
			fuelProducedKg: 0,
			fuelSpent: 0,
			lastResearch: 0,
			forceScale: 1,
			ended: CAREER_OPEN,
			market: null,
			arrested: false,
			arrestUntilStep: 0,
			arrests: 0,
			bribes: 0,
			bribeIncome: 0,
			patientsDelivered: 0,
			medicTrips: 0
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

	function fuelPrice(career) {
		return price(career, FUEL_PRICE);
	}

	/* Both transactions need a landed, usable drive; a tank alone is not enough. */
	function fuelRequest(career, kg) {
		const ship = career.ship;
		if (career.ended !== CAREER_OPEN || career.at < 0 || !ship.engine || !ship.tank ||
			!Number.isFinite(kg) || kg <= 0) return 0;
		return Math.max(0, Math.min(kg, ship.tank.fuelCap - ship.fuelKg));
	}

	/* Only the career's own pad feeds the converter, never a guest/commercial rail. */
	function produceFuel(career, planet, kg) {
		let amount = fuelRequest(career, kg);
		if (amount <= 0 || planet !== career.at) return 0;
		const pad = career.pads[planet];
		if (!pad || pad.catapult === null) return 0;
		const freeKwh = Math.max(0, pad.chargeKwh - pad.reservedKwh);
		amount = Math.min(Math.floor(amount), Math.floor(freeKwh * FUEL_KG_PER_KWH + 1e-9));
		if (amount <= 0) return 0;
		pad.chargeKwh -= amount / FUEL_KG_PER_KWH;
		career.ship.fuelKg += amount;
		career.fuelProducedKg += amount;
		return amount;
	}

	function buyFuel(career, kg) {
		let amount = fuelRequest(career, kg);
		if (amount <= 0) return 0;
		const unitPrice = fuelPrice(career);
		if (unitPrice > 0) amount = Math.min(amount, Math.max(0, career.ledger.purse) / unitPrice);
		if (amount <= 0) return 0;
		const cost = amount * unitPrice;
		career.ledger.purse = Math.max(0, career.ledger.purse - cost);
		career.ship.fuelKg += amount;
		career.fuelBoughtKg += amount;
		career.fuelSpent += cost;
		checkEnded(career);
		return amount;
	}

	function draw01(career, salt) {
		career.serial += 1;
		return OrbitWorld.hashBits(career.seed, career.serial, salt) / 4294967296;
	}

	/* a uniform draw over the run's in-play planets */
	function activePlanetDraw(career) {
		const count = career.planetCount || OrbitWorld.PLANETS;
		let pick = Math.floor(draw01(career, SALT_TASK) * count);
		for (let i = 0; i < OrbitWorld.PLANETS; i++) {
			if (career.planetMask && career.planetMask[i] === 0) continue;
			if (pick === 0) return i;
			pick -= 1;
		}
		return 0;
	}

	/* a colony sits on a planet of the run only when that planet is in play */
	function colonyInPlay(career, colony) {
		return planetInPlay(career, colony.planet);
	}

	/* deepest well a starter rail leaves: the EMC-1 + BAT-1 reaches another
	 * system from nearly every planet at or below this strength and from fewer
	 * and fewer above it (experiments/hq_gravity_probe.js), so a heavier HQ is
	 * a company that can never fly */
	const HQ_GRAVITY_MAX = 1;

	/* HQ: a planet in play that no other player already calls home. Sunlight
	 * matters — the starter panel charges the rail — but a deep well matters
	 * more, so the order is sunlit-and-shallow, then shallow, then sunlit, then
	 * any free planet. `mask`/`count` restrict the choice to the run's planets. */
	/* the Capital is the Empire's: no company may call it home (0.5.11) */
	function hqForbidden(world, i) {
		return specialPlanets && i === world.capitalPlanet;
	}

	function pickHq(seed, world, used, mask, count) {
		for (let tier = 0; tier < 4; tier++) {
			const needLight = tier === 0 || tier === 2;
			const needShallow = tier < 2;
			let total = 0;
			for (let i = 0; i < OrbitWorld.PLANETS; i++) {
				if (mask && mask[i] === 0) continue;
				if (used && used[i]) continue;
				if (hqForbidden(world, i)) continue;
				if (needLight && world.planetLight[i] < CAREER.hqMinLight) continue;
				if (needShallow && planetGravity(world.seed, i) > HQ_GRAVITY_MAX) continue;
				total += 1;
			}
			if (total === 0) continue;
			let pick = OrbitWorld.hashBits(seed, 0, SALT_HQ) % total;
			for (let i = 0; i < OrbitWorld.PLANETS; i++) {
				if (mask && mask[i] === 0) continue;
				if (used && used[i]) continue;
				if (hqForbidden(world, i)) continue;
				if (needLight && world.planetLight[i] < CAREER.hqMinLight) continue;
				if (needShallow && planetGravity(world.seed, i) > HQ_GRAVITY_MAX) continue;
				if (pick === 0) return i;
				pick -= 1;
			}
		}
		return 0;
	}

	/* HQs already taken by the players of `galaxy` */
	function hqMask(career) {
		const used = new Uint8Array(OrbitWorld.PLANETS);
		const actors = career.galaxy ? career.galaxy.actors : null;
		for (let i = 0; actors && i < actors.length; i++) {
			if (actors[i] !== career && actors[i].hq >= 0) used[actors[i].hq] = 1;
		}
		return used;
	}

	/* pad sunlight: orbit light above a floor so no world is dead, star brightness a mild modifier */
	function fillLight(career, world) {
		const lumNorm = OrbitWorld.clamp01(Math.sqrt(world.lum) / 1.5);
		const star = 0.5 + 0.5 * lumNorm;
		const mask = career.planetMask;
		for (let i = 0; i < OrbitWorld.PLANETS; i++) {
			if (mask && mask[i] === 0) {
				career.light[i] = 0;
				continue;
			}
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

	/* Researchable parameter spaces in one table: `params` gives the axes in the
	 * order the science panel sliders use, `record` turns an invented point back
	 * into a ladder record. A new family is one entry here plus its slider axes
	 * in gravity_gui.js; the hull seeding, prototype lists and the accept gate
	 * all follow. The tier-0 empty slot of a part table is not a known tradeoff,
	 * so `seedScience` skips it (FT-0 would put the tank range at zero). */
	const SCIENCE_FAMILIES = [
		{
			kind: OrbitTech.KIND_ENGINE, table: OrbitTech.ENGINES,
			params: e => [e.thrust, e.mass], record: OrbitTech.engineRecord
		},
		{
			kind: OrbitTech.KIND_CATAPULT, table: OrbitTech.CATAPULTS,
			params: c => [c.maxForce, c.efficiency], record: OrbitTech.catapultRecord
		},
		{
			kind: OrbitTech.KIND_TANK, table: OrbitTech.TANKS,
			params: t => [t.fuelCap, t.emptyMass], record: OrbitTech.tankRecord
		},
		{
			kind: OrbitTech.KIND_BATTERY, table: OrbitTech.BATTERIES,
			params: b => [b.capacity, b.leak], record: OrbitTech.batteryRecord
		}
	];
	const SCIENCE_KINDS = SCIENCE_FAMILIES.map(f => f.kind);

	function scienceFamilyOf(kind) {
		for (let i = 0; i < SCIENCE_FAMILIES.length; i++) {
			if (SCIENCE_FAMILIES[i].kind === kind) return SCIENCE_FAMILIES[i];
		}
		return null;
	}

	/* one prototype list per family, so a new family needs no edit here */
	function newPrototypes() {
		const out = {};
		for (let i = 0; i < SCIENCE_KINDS.length; i++) out[SCIENCE_KINDS[i]] = [];
		return out;
	}

	/* tiers known out of the box per gear kind; anything above must be
	 * researched. Only the first two EMC rails ship with starter tech — the
	 * high-power tiers (EMC-3, 4, 5) sit beyond the initial hull. Panels and
	 * holds are not researchable families, so their whole ladder ships known. */
	const STARTING_RESEARCH_TIER = {
		catapult: 2,
		panel: 99,
		battery: 99,
		engine: 99,
		tank: 99
	};

	/* the tech tree itself is discovered science: its items seed the hull so the
	 * first custom inventions pay only the distance beyond known tradeoffs */
	function seedScience(career) {
		career.science = OrbitScience.createHull();
		career.knownGear = {};
		for (const kind in OrbitTech.TABLES) {
			const table = OrbitTech.TABLES[kind];
			const maxTier = STARTING_RESEARCH_TIER[kind] || 99;
			for (let j = 0; j < table.length; j++) {
				const item = table[j];
				if (item.tier > 0 && item.tier <= maxTier) career.knownGear[item.id] = true;
			}
		}
		for (let i = 0; i < SCIENCE_FAMILIES.length; i++) {
			const spec = SCIENCE_FAMILIES[i];
			for (let j = 0; j < spec.table.length; j++) {
				const item = spec.table[j];
				if (item.tier > 0 && career.knownGear[item.id])
					OrbitScience.acceptHull(career.science, spec.kind, spec.params(item), item.id);
			}
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

	/* research unlocks its point as a record on the family's ladder (owned, like
	 * a part); a prototype at or above a stock rung proves that rung, so the
	 * stock tier joins the shop beside the invention */
	function unlockPrototype(career, family, params, id) {
		const spec = scienceFamilyOf(family);
		if (!spec) return;
		const record = spec.record(id, params[0], params[1]);
		career.prototypes[family].push(record);
		career.owned[id] = true;
		for (let i = 0; i < spec.table.length; i++) {
			const item = spec.table[i];
			if (item.tier > 0 && item.tier <= record.tier) career.knownGear[item.id] = true;
		}
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

	/* invent a parameter point: the purse pays the hull-distance fee and the
	 * point expands the career's knowledge hull regardless of ship position */
	function researchPoint(career, family, params, label) {
		if (career.ended !== CAREER_OPEN) return false;
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

	function resetCareer(career, seed, trade, cheat, homePlanet) {
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
			pad.reservedKwh = 0;
		}
		career.padCount = 0;
		for (let i = 0; i < OrbitWorld.PLANETS; i++) career.launchPads[i] = COMMERCIAL_PAD;
		fillLight(career, trade.world);
		career.hq = homePlanet === undefined ? pickHq(career.seed, trade.world, hqMask(career),
			career.planetMask, career.planetCount) : homePlanet;
		career.at = career.hq;
		career.stranded = false;
		career.commercialPlanet = -1;
		career.capitalPlanet = specialPlanets ? trade.world.capitalPlanet : -1;
		career.arfPlanet = specialPlanets ? trade.world.arfPlanet : -1;
		resetLaunchBook(career.launchBook);
		career.ship.hold = grant.ship.hold;
		career.ship.engine = grant.ship.engine;
		career.ship.tank = grant.ship.tank;
		career.ship.cargoTons = 0;
		career.ship.fuelKg = career.cheat === CHEAT_ENDGAME ? career.ship.tank.fuelCap : 0;
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
		for (let i = 0; i < BOARD_SIZE; i++) clearTask(career.tasks[i]);
		career.contract = -1;
		career.serial = 0;
		career.flights = 0;
		career.burns = 0;
		career.evacuations = 0;
		career.delivered = 0;
		career.competitions = 0;
		career.earned = 0;
		career.taxPaid = 0;
		career.taxEarned = 0;
		career.lastEnergy = 0;
		career.lastFee = 0;
		career.lastReward = 0;
		career.lastFuel = 0;
		career.fuelBoughtKg = 0;
		career.fuelProducedKg = 0;
		career.fuelSpent = 0;
		career.forceScale = 1;
		career.ended = CAREER_OPEN;
		career.arrested = false;
		career.arrestUntilStep = 0;
		career.arrests = 0;
		career.bribes = 0;
		career.bribeIncome = 0;
		career.patientsDelivered = 0;
		career.medicTrips = 0;
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
			if (career.planetMask && career.planetMask[i] === 0) continue;
			if (i === career.capitalPlanet) continue;
			if (rebelRail(career, i)) continue;
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
		setCommercial(career, -1);
		career.stranded = career.pads[planet].catapult === null;
		sim.relocate(planet);
	}

	/* a career begins with the vessel on HQ and the sim gating on the network;
	 * every career in one run joins the same galaxy, so pads are shared ground */
	function startCareer(career, sim, seed, trade, cheat, galaxy, homePlanet) {
		career.galaxy = galaxy || null;
		career.market = galaxy && galaxy.market ? galaxy.market : null;
		resetCareer(career, seed, trade, cheat, homePlanet);
		career.forceScale = sim.forceScale;
		if (galaxy) joinGalaxy(career, galaxy);
		else syncCareerNetwork(career);
		sim.setLaunchNetwork(career.launchPads, career.ship);
		placeShip(career, sim, career.hq);
	}

	/* the Capital's fixed imperial rail counts as covered, so "a catapult on
	 * every active planet" stays winnable even though nobody can build there */
	function capitalCovered(career) {
		return career.capitalPlanet >= 0 && planetInPlay(career, career.capitalPlanet) ? 1 : 0;
	}

	/* a seized planet is covered by the rebel rail for good: nobody may build
	 * there, so the completion count must not ask for a catapult on it */
	function coveredPlanets(career) {
		let covered = capitalCovered(career);
		const market = career.market;
		if (!market) return covered;
		for (let p = 0; p < OrbitWorld.PLANETS; p++) {
			if (market.seized[p] && planetInPlay(career, p)) covered += 1;
		}
		return covered;
	}

	/* broke = negative purse, or no affordable way off the planet */
	function checkEnded(career) {
		if (career.ended !== CAREER_OPEN) return career.ended;
		const purse = career.ledger.purse;
		if (purse < -1e-9 ||
			(career.stranded && purse + 1e-9 < exitCost(career))) career.ended = CAREER_BROKE;
		else if (career.cheat === null &&
			career.padCount >= career.planetCount - coveredPlanets(career)) {
			career.ended = CAREER_COMPLETE;
		}
		return career.ended;
	}

	/* --- politics: rot, bribes, arrest, rebellion (0.5.12) ---------------- */

	/*
	 * The career clock every political rate is priced in. `advancePolitics`
	 * runs once per world step from GravityBot.stepCareer, so the GUI and the
	 * benches share one clock. It raises rot on every world nobody visited
	 * lately, copies the rot into the trade colonies, retires finished
	 * arrests, and rolls one rebellion per planet per epoch — never per step.
	 */
	function advancePolitics(market, trade, runStep, rate) {
		const galaxy = market.galaxy;
		if (!politics || !galaxy || runStep === market.politicsStep) return 0;
		market.politicsStep = runStep;
		market.politicsRate = rate > 0 ? rate : 1;
		const seconds = politicsSeconds(market, runStep);
		const dtSec = seconds - market.politicsSec;
		market.politicsSec = seconds;
		if (trade && trade.setCorruption && trade.corruption !== market.corruption) {
			trade.setCorruption(market.corruption);
		}
		const secondsPerStep = GravitySim.DT * market.politicsRate;
		const epoch = Math.floor(seconds / OrbitEcon.REBEL_CHECK_SECONDS);
		let seized = 0;
		const count = market.planetCount || OrbitWorld.PLANETS;
		for (let p = 0; p < count; p++) {
			if (market.planetMask && market.planetMask[p] !== 1) continue;
			if (p === market.capitalPlanet || p === market.arfPlanet) continue;
			if (!market.rebel[p] && dtSec > 0 &&
				(seconds - market.lastVisitStep[p] * secondsPerStep) > OrbitEcon.CORRUPTION_GRACE) {
				market.corruption[p] = OrbitEcon.clampCorruption(
					market.corruption[p] + OrbitEcon.CORRUPTION_PASSIVE_RATE * dtSec);
			}
			if (market.rebel[p] || runStep < market.rebelCooldownStep[p]) continue;
			if (epoch <= market.lastCheckEpoch[p]) continue;
			/* a clean planet saves its epoch roll for when rot crosses the line */
			if (market.corruption[p] <= OrbitEcon.REBEL_START) continue;
			market.lastCheckEpoch[p] = epoch;
			if (!rebellionRoll(market, p, epoch, market.corruption[p])) continue;
			seizePlanet(market, galaxy, p, runStep);
			seized += 1;
		}
		retireArrests(galaxy, runStep);
		return seized;
	}

	/* one deterministic roll per planet per epoch: no wall time, no Math.random */
	function rebellionRoll(market, planet, epoch, corruption) {
		const chance = OrbitEcon.rebellionChance(corruption);
		if (chance <= 0) return false;
		const key = OrbitWorld.hashBits(market.politicsSeed, planet, SALT_POLITICS);
		const roll = OrbitWorld.hashBits(key, epoch, SALT_ARREST) / 4294967296;
		return roll < chance;
	}

	/* the arrested career waits for its slow transport, then is free again */
	function retireArrests(galaxy, runStep) {
		for (let i = 0; i < galaxy.actors.length; i++) {
			const career = galaxy.actors[i];
			if (!career.arrested || runStep < career.arrestUntilStep) continue;
			career.arrested = false;
			career.arrestUntilStep = 0;
		}
	}

	/*
	 * Seizure: every player rail on the planet becomes one commercial rail the
	 * rebels run, with the best tiers that stood there. The former owners lose
	 * the pad (and the claim), the planet can never be built on again, and a
	 * rebellion plants the patients the medical quest has to ferry out.
	 */
	function seizePlanet(market, galaxy, planet, runStep) {
		market.rebel[planet] = 1;
		market.seized[planet] = 1;
		market.rebelSinceStep[planet] = runStep;
		market.patients[planet] = OrbitEcon.MEDIC_PATIENTS;
		market.rebelCooldownStep[planet] = 0;
		market.rebelPads[planet] = seizedPad(galaxy, planet);
		for (let i = 0; i < galaxy.actors.length; i++) {
			const career = galaxy.actors[i];
			clearPad(career, planet);
		}
		refreshNetwork(galaxy);
		return market.rebelPads[planet];
	}

	/* the seized rail: the strongest former player pad, else the commercial one */
	function seizedPad(galaxy, planet) {
		let catapult = COMMERCIAL_PAD.catapult;
		let panel = COMMERCIAL_PAD.panel;
		let battery = COMMERCIAL_PAD.battery;
		for (let i = 0; i < galaxy.actors.length; i++) {
			const pad = galaxy.actors[i].pads[planet];
			if (pad.catapult === null || pad.catapult.tier <= catapult.tier) continue;
			catapult = pad.catapult;
			panel = pad.panel;
			battery = pad.battery;
		}
		/* rebels keep their rail charged, so a seized planet is never a trap */
		return { catapult: catapult, panel: panel, battery: battery,
			chargeKwh: battery.capacity, reservedKwh: 0 };
	}

	function clearPad(career, planet) {
		const pad = career.pads[planet];
		if (!pad || pad.catapult === null) return;
		career.padCount = career.padCount > 0 ? career.padCount - 1 : 0;
		pad.catapult = null;
		pad.panel = null;
		pad.battery = null;
		pad.chargeKwh = 0;
		pad.reservedKwh = 0;
		if (career.at === planet) {
			career.stranded = padLift(career, planet) + 1e-9 < GravitySim.SPEED_MIN;
		}
	}

	/* a medical mission ends for some other reason: unload and drop it */
	function clearMedicalCargo(career) {
		if (career.contract < 0) return false;
		const task = career.tasks[career.contract];
		if (task.kind !== TASK_MEDIC) return false;
		dropContract(career);
		return true;
	}

	/*
	 * The bribe (0.5.12, repriced 0.5.13): the local rulers pay for the visit's
	 * silence — the visit value (what the landing collected plus what regrew
	 * while the ship sits) scaled by the planet's rot. A clean lord pays
	 * nothing, a freshly reported planet is worth nothing, and a rot-rich
	 * planet pays well right where the arrest roll is at its worst. The purse
	 * and the bribe stats grow, and the rot grows with the money. One bribe per
	 * visit, and a rot-rich planet may arrest the briber and ship them to the
	 * Capital instead of paying.
	 */
	const BRIBE = { ok: false, amount: 0, corruption: 0, arrested: false, reason: '' };

	function bribeRefusal(career, market, planet) {
		if (!career || career.ended !== CAREER_OPEN) return 'career over';
		if (!market || !market.galaxy) return 'no politics here';
		if (career.arrested) return 'under arrest';
		if (planet < 0 || career.at !== planet) return 'not landed there';
		if (planet === market.capitalPlanet) return 'the Empire does not deal';
		if (planet === market.arfPlanet) return 'A.R.F. takes no bribes';
		if (market.rebel[planet]) return 'rebels hold the planet';
		const stamped = market.lastVisitStep[planet];
		if (stamped >= 0 && market.bribeVisitStep[planet] === stamped) return 'already bribed this visit';
		return '';
	}

	/*
	 * What the rulers pay (0.5.13): the visit value — the payout the landing
	 * collected plus the value that regrew while the ship sits — times the rot
	 * fraction times BRIBE_VALUE_COEF. The visit value is the base: a planet
	 * whose profit is low has already been reported to the Capital, so its lord
	 * has nothing to buy. The rot is the lord's appetite: clean worlds pay
	 * nothing, and a long sit on a rotten world is a parking income the player
	 * collects without flying — at the price of the arrest roll.
	 */
	function bribeAmount(market, planet, runStep) {
		const grown = planetProfit(market, planet, runStep);
		const collected = market.visitPay[planet] > 0 ? market.visitPay[planet] : 0;
		return OrbitEcon.bribeValue(collected + grown, market.corruption[planet]);
	}

	function acceptBribe(career, market, sim, planet, runStep) {
		BRIBE.ok = false;
		BRIBE.arrested = false;
		BRIBE.amount = 0;
		BRIBE.corruption = market ? market.corruption[planet] : 0;
		BRIBE.reason = bribeRefusal(career, market, planet);
		if (BRIBE.reason !== '') return BRIBE;
		const amount = bribeAmount(market, planet, runStep);
		if (!(amount > 0)) {
			BRIBE.reason = 'the rulers owe nothing yet';
			return BRIBE;
		}
		BRIBE.ok = true;
		BRIBE.amount = amount;
		career.ledger.purse += amount;
		career.bribes += 1;
		career.bribeIncome += amount;
		market.bribeVisitStep[planet] = market.lastVisitStep[planet];
		market.corruption[planet] = OrbitEcon.clampCorruption(
			market.corruption[planet] + OrbitEcon.bribeCorruption(amount));
		BRIBE.corruption = market.corruption[planet];
		market.politicsSerial += 1;
		const roll = OrbitWorld.hashBits(market.politicsSeed, market.politicsSerial, SALT_ARREST) /
			4294967296;
		if (roll >= OrbitEcon.arrestChance(BRIBE.corruption)) return BRIBE;
		arrestCareer(career, market, sim, runStep);
		BRIBE.arrested = true;
		return BRIBE;
	}

	/* the Capital's slow transport: no fee, no reward, no medics, no planning */
	function arrestCareer(career, market, sim, runStep) {
		const capital = career.capitalPlanet;
		if (capital < 0) return false;
		career.arrestUntilStep = runStep + Math.round(OrbitEcon.ARREST_SECONDS / GravitySim.DT);
		career.arrested = true;
		career.arrests += 1;
		clearMedicalCargo(career);
		setCommercial(career, -1);
		placeShip(career, sim, capital);
		career.stranded = false;
		return true;
	}

	/* quelled: no more 4x visits and no more patients, but the rail stays
	 * commercial and the planet stays unbuildable for good */
	function pacifyPlanet(market, planet, runStep) {
		market.rebel[planet] = 0;
		market.patients[planet] = 0;
		market.rebelSinceStep[planet] = 0;
		market.rebelCooldownStep[planet] =
			runStep + Math.round(OrbitEcon.REBEL_CHECK_SECONDS * 2 / GravitySim.DT);
		market.corruption[planet] = market.corruption[planet] > OrbitEcon.PACIFY_CORRUPTION_MAX
			? OrbitEcon.PACIFY_CORRUPTION_MAX : market.corruption[planet];
	}

	/* --- building ------------------------------------------------------ */

	/* stock (table) gear is only buildable when it is known: EMC tiers 1-2
	 * start known, panels/batteries/engines/tanks all do, but higher EMCs
	 * (3/4/5) must be unlocked via science — a researched prototype at or
	 * above their rung proves the rung and the stock tier joins the shop;
	 * the invention itself carries its own build cost either way. The
	 * communism cheat unlocks every tier. */
	function gearKnown(career, item) {
		if (!item) return false;
		if (career.cheat === CHEAT_COMMUNISM) return true;
		if (career.owned[item.id]) return true;
		if (career.knownGear && career.knownGear[item.id]) return true;
		return false;
	}

	/* planet ownership: a planet can hold at most one player-owned EMC (plus
	 * the neutral commercial EMC-1 and the evacuate option). Building your
	 * own EMC on a planet that already carries another player's rail is
	 * forbidden — claim the planet by landing on an unclaimed one first. */
	/* a rebel planet: seized ground that never becomes buildable again */
	function planetSeized(career, planet) {
		const market = career.market;
		return market !== null && market.seized[planet] === 1;
	}

	function planetBuildable(career, planet) {
		if (planet === career.capitalPlanet) return false;
		/* a seized planet is the rebels' ground, quelled or not */
		if (rebelRail(career, planet)) return false;
		if (!career.galaxy) return true;
		const owner = claimOwner(career.galaxy, planet);
		return owner === OWNER_COMMERCIAL || owner === career.index;
	}

	/* a first catapult brings a starter panel and battery (charged) with it;
	 * a panel or battery needs a pad to sit on */
	function buildGear(career, planet, kind, item) {
		if (planet === career.capitalPlanet) return false;
		if (rebelRail(career, planet)) return false;
		const pad = career.pads[planet];
		const fresh = kind === OrbitTech.KIND_CATAPULT && pad.catapult === null;
		if (fresh && !planetBuildable(career, planet)) return false;
		if (!fresh && !OrbitTech.upgrades(pad, kind, item)) return false;
		if (!gearKnown(career, item)) return false;
		if (!canPay(career, item.buildCost)) return false;
		career.ledger.purse -= price(career, item.buildCost);
		if (fresh) {
			fitPad(career, planet, item, OrbitTech.PANELS[0], OrbitTech.BATTERIES[0]);
		} else {
			pad[kind] = item;
			if (kind === OrbitTech.KIND_BATTERY) pad.chargeKwh = item.capacity;
		}
		if (planet === career.at) {
			/* a fresh rail rescues stranding only when it can actually lift
			 * the ship; a pad too weak for the current load leaves the
			 * vessel stranded until an upgrade or evacuation */
			career.stranded = !(OrbitTech.speedLimit(pad.battery.capacity, career.ship.mass,
				pad.catapult, career.forceScale) + 1e-9 >= GravitySim.SPEED_MIN);
		}
		/* a fresh own rail replaces a commercial choice made for the same planet */
		if (fresh && career.commercialPlanet === planet) career.commercialPlanet = -1;
		syncCareerNetwork(career);
		checkEnded(career);
		return true;
	}

	function bulkUpgradeCost(career, kind, item) {
		return price(career, OrbitTech.bulkUpgradeCost(career.pads, kind, item));
	}

	/* applies `item` to every already-built facility of `kind` at once */
	function bulkUpgrade(career, kind, item) {
		if (!gearKnown(career, item)) return false;
		const cost = bulkUpgradeCost(career, kind, item);
		if (career.ledger.purse + 1e-9 < cost) return false;
		for (let i = 0; i < career.pads.length; i++) {
			const pad = career.pads[i];
			if (!OrbitTech.upgrades(pad, kind, item)) continue;
			pad[kind] = item;
			if (kind === OrbitTech.KIND_BATTERY) pad.chargeKwh = item.capacity;
		}
		career.ledger.purse -= cost;
		syncCareerNetwork(career);
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
		career.ship.fuelKg = Math.min(career.ship.fuelKg, career.ship.tank.fuelCap);
		refitShip(career);
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

	/* a uniform in-play planet other than `exclude` (the tourist's free endpoint) */
	function otherActivePlanet(career, exclude) {
		const count = career.planetCount || OrbitWorld.PLANETS;
		const span = count - (planetInPlay(career, exclude) ? 1 : 0);
		if (span < 1) return -1;
		let pick = Math.floor(draw01(career, SALT_TASK) * span);
		for (let i = 0; i < OrbitWorld.PLANETS; i++) {
			if (!planetInPlay(career, i) || i === exclude) continue;
			if (pick === 0) return i;
			pick -= 1;
		}
		return -1;
	}

	/*
	 * Tourist delivery (0.5.11): a TASK_DELIVERY of MIGRANTS flagged tourist.
	 * One deterministic draw picks the special endpoint role, each offered at
	 * TOURIST_WEIGHT (2x an ordinary endpoint): to the A.R.F. world, to the
	 * Capital resort, or from the Capital resort. The other endpoint is a
	 * uniform in-play planet. Reward stays positive and capped like freight.
	 */
	function makeTouristDelivery(career, trade, step, task) {
		const capital = career.capitalPlanet;
		const arf = career.arfPlanet;
		const role = Math.floor(draw01(career, SALT_TASK) * 3);
		let from;
		let to;
		if (role === 0) {
			to = arf;
			from = otherActivePlanet(career, arf);
		} else if (role === 1) {
			to = capital;
			from = otherActivePlanet(career, capital);
		} else {
			from = capital;
			to = otherActivePlanet(career, capital);
		}
		if (from < 0 || to < 0 || from === to) return false;
		const tons = CARGO_TONS[Math.floor(draw01(career, SALT_TASK) * CARGO_TONS.length)];
		const dist = Math.min(planetDistance(trade, from, to), CAREER.deliveryDistPx);
		/* tourists are not market goods: a mid scarcity keeps the pay between
		 * the freight floor and ceiling */
		const pay = CAREER.deliveryBase + tons * CAREER.deliveryPerTon * 1.5 *
			(1 + dist / CAREER.deliveryDistPx);
		task.kind = TASK_DELIVERY;
		task.state = TASK_OFFERED;
		task.good = OrbitEcon.MIGRANTS;
		task.tourist = true;
		task.tons = tons;
		task.from = from;
		task.to = to;
		task.planet = -1;
		task.minLength = 0;
		task.reward = round2(Math.min(pay, CAREER.deliveryMax));
		task.deadline = step + Math.round(CAREER.deliverySec / GravitySim.DT);
		return true;
	}

	/* delivery: a colony with a real export to the colony short of that good
	 * (else the lowest supply); pays by tons, scarcity and distance, capped
	 * below the evacuation fee */
	function makeDelivery(career, trade, step, task) {
		/* the tourist branch is gated off entirely for the SPECIAL=0 A/B, so the
		 * ordinary delivery stream is then bit-identical to the historical one */
		if (specialPlanets && career.capitalPlanet >= 0 &&
			draw01(career, SALT_TASK) < TOURIST_CHANCE &&
			makeTouristDelivery(career, trade, step, task)) return true;
		const colonies = trade.colonies;
		const count = colonies.length;
		if (count < 2) return false;
		const first = Math.floor(draw01(career, SALT_TASK) * count);
		let src = null;
		let good = -1;
		for (let k = 0; k < count && good < 0; k++) {
			const colony = colonies[(first + k) % count];
			if (!colonyInPlay(career, colony)) continue;
			src = colony;
			good = OrbitEcon.bestExport(colony);
		}
		if (good < 0 || !src) return false;
		let dst = null;
		let bestShort = 0;
		let lowSupply = 2;
		for (let k = 0; k < count; k++) {
			const colony = colonies[k];
			if (!colonyInPlay(career, colony)) continue;
			if (colony === src) continue;
			const short = OrbitEcon.goodShortfall(colony, good);
			const supply = OrbitEcon.marketSupply(colony, good);
			const better = bestShort > 0 ? short > bestShort : short > 0 || supply < lowSupply;
			if (!better) continue;
			dst = colony;
			bestShort = short;
			lowSupply = supply;
		}
		if (!dst) return false;
		const tons = CARGO_TONS[Math.floor(draw01(career, SALT_TASK) * CARGO_TONS.length)];
		const scarcity = 1 - OrbitEcon.marketSupply(dst, good);
		const dist = Math.min(planetDistance(trade, src.planet, dst.planet), CAREER.deliveryDistPx);
		const pay = CAREER.deliveryBase + tons * CAREER.deliveryPerTon * (1 + scarcity) *
			(1 + dist / CAREER.deliveryDistPx);
		task.kind = TASK_DELIVERY;
		task.state = TASK_OFFERED;
		task.good = good;
		task.tourist = false;
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
		task.planet = activePlanetDraw(career);
		task.minLength = Math.round((CAREER.competeMinPx + draw01(career, SALT_TASK) * CAREER.competeSpanPx) / 50) * 50;
		task.reward = round2(CAREER.competeBase + draw01(career, SALT_TASK) * CAREER.competeSpan);
		task.from = -1;
		task.to = -1;
		task.good = 0;
		task.tons = 0;
		task.tourist = false;
		task.deadline = step + Math.round(CAREER.competeSec / GravitySim.DT);
	}

	/*
	 * The medical quest (0.5.12): a rebellious planet's patients have to reach
	 * the Capital. Half the hold rides out as medics, the same number rides
	 * back as patients, and the planet is quelled once its last patient lands.
	 * The contract's kind is TASK_MEDIC, so every other rule ignores it.
	 */
	function medicPlanet(career, market) {
		let best = -1;
		let most = 0;
		for (let p = 0; p < OrbitWorld.PLANETS; p++) {
			if (!market.rebel[p] || !market.patients[p]) continue;
			if (!planetInPlay(career, p)) continue;
			if (market.patients[p] <= most) continue;
			best = p;
			most = market.patients[p];
		}
		return best;
	}

	function makeMedic(career, market, step, task) {
		const planet = medicPlanet(career, market);
		if (planet < 0 || career.capitalPlanet < 0) return false;
		/* no hold, no medics: the offer waits in the slot until a hold fits */
		const medics = medicLoad(career, market.patients[planet]);
		if (medics < 1) return false;
		task.kind = TASK_MEDIC;
		task.state = TASK_OFFERED;
		task.good = OrbitEcon.MIGRANTS;
		task.tourist = false;
		task.tons = 0;
		task.from = career.capitalPlanet;
		task.to = planet;
		task.planet = planet;
		task.patients = market.patients[planet];
		task.medics = medics;
		task.aboard = 0;
		task.minLength = 0;
		task.reward = round2(task.patients * OrbitEcon.MEDIC_REWARD_PER_PATIENT);
		/* two trips with the standard hold, one with a big one */
		task.deadline = step + Math.round(CAREER.deliverySec * 2 / GravitySim.DT);
		return true;
	}

	/* half the hold rides as medics: no new ship stat, no full-hold dead end */
	function medicLoad(career, patients) {
		const half = Math.floor(career.ship.hold.capacity / 2);
		return Math.min(half, patients);
	}

	function loadMedics(career, task, patients) {
		task.medics = medicLoad(career, patients);
		task.aboard = 0;
		career.ship.cargoTons = task.medics;
		refitShip(career);
		return task.medics;
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
		/* the medical mission is a standing offer while a rebellion has patients,
		 * and a stale offer leaves as soon as the planet is quelled */
		const medic = career.tasks[MEDIC_SLOT];
		const market = career.market;
		if (!market || !market.galaxy) return;
		if (medic.kind === TASK_MEDIC && career.contract !== MEDIC_SLOT &&
			(!market.rebel[medic.to] || !market.patients[medic.to])) {
			clearTask(medic);
		}
		if (medic.kind === TASK_NONE) makeMedic(career, market, step, medic);
	}

	function canAccept(career, index) {
		const task = career.tasks[index];
		if (career.contract >= 0 || career.arrested || task.state !== TASK_OFFERED) return false;
		if (task.kind === TASK_MEDIC) {
			return career.capitalPlanet >= 0 && career.at === career.capitalPlanet &&
				task.medics > 0 && task.patients > 0;
		}
		return task.kind === TASK_DELIVERY && career.ship.hold.capacity >= task.tons;
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
		career.contract = index;
		if (task.kind === TASK_MEDIC) {
			/* taken at the Capital, so the medics board at once */
			task.state = TASK_LOADED;
			loadMedics(career, task, task.patients);
			return true;
		}
		task.state = TASK_ACCEPTED;
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
		if (task.kind === TASK_MEDIC) return settleMedic(career, task, planet, step);
		if (task.state === TASK_ACCEPTED && planet === task.from) loadCargo(career, task);
		else if (task.state === TASK_LOADED && planet === task.to) {
			pay(career, task.reward);
			career.delivered += 1;
			dropContract(career);
		}
	}

	/* the medics go in at the Capital, the patients come out at the rebellion,
	 * the patients go out at the Capital — and the last one quells the planet */
	function settleMedic(career, task, planet, step) {
		const market = career.market;
		if (!market) return false;
		if (task.aboard === 0 && planet === task.to) {
			const picked = Math.min(task.medics, market.patients[task.to]);
			task.aboard = picked;
			career.ship.cargoTons = picked;
			career.medicTrips += 1;
			refitShip(career);
			return true;
		}
		if (task.aboard === 0 || planet !== career.capitalPlanet) return false;
		const delivered = task.aboard;
		const left = market.patients[task.to] > delivered
			? market.patients[task.to] - delivered : 0;
		market.patients[task.to] = left;
		career.patientsDelivered += delivered;
		task.aboard = 0;
		career.ship.cargoTons = 0;
		refitShip(career);
		pay(career, delivered * OrbitEcon.MEDIC_REWARD_PER_PATIENT);
		if (left > 0) {
			loadMedics(career, task, left);
			task.deadline = step + Math.round(CAREER.deliverySec * 2 / GravitySim.DT);
			return true;
		}
		pacifyPlanet(market, task.to, step);
		dropContract(career);
		return true;
	}

	/* --- flights ------------------------------------------------------- */

	/*
	 * Every EMC pad spends its own battery charge on the shot it fires, whether
	 * the launcher owns the rail or is only a guest on it. The neutral
	 * commercial EMC-1, kept charged by its operator, never runs dry and
	 * charges a flat fee instead. A rival-owned rail also charges its usage tax
	 * (the energy of the shot, paid to that player's purse).
	 */
	function careerBeginFlight(career, sim) {
		const planet = sim.origin;
		const pad = padAt(career, planet);
		const owner = padOwner(career, planet);
		const energy = OrbitTech.launchEnergy(career.ship.mass, pad.catapult, sim.speed);
		/* the commercial, imperial and rebel rails are kept charged: they never drain */
		const freeRail = owner === OWNER_COMMERCIAL || owner === OWNER_CAPITAL ||
			owner === OWNER_REBEL;
		if (!freeRail) {
			pad.chargeKwh = pad.chargeKwh > energy ? pad.chargeKwh - energy : 0;
			releaseEnergy(pad, energy);
		}
		const fee = launchFee(career, planet, sim.speed);
		career.ledger.purse -= fee;
		if (!freeRail && owner !== career.index) {
			const host = career.galaxy.actors[owner];
			host.ledger.purse += fee;
			host.taxEarned += fee;
			career.taxPaid += fee;
		}
		career.lastEnergy = freeRail ? 0 : energy;
		career.lastFee = fee;
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
		/* the commercial choice bought one launch; the next planet starts fresh */
		setCommercial(career, -1);
		/* the Capital's free imperial rail is a way off, so it never strands */
		career.stranded = !landed ||
			(career.pads[sim.endBody].catapult === null && sim.endBody !== career.capitalPlanet);
		refreshBoard(career, trade, step);
		return checkEnded(career);
	}

	/* flies the stranded ship home for the fee (the cargo rides along) */
	function evacuate(career, sim) {
		if (!career.stranded) return false;
		clearMedicalCargo(career);
		career.ledger.purse -= price(career, CAREER.evacFee);
		career.evacuations += 1;
		placeShip(career, sim, career.hq);
		checkEnded(career);
		return true;
	}

	/* --- launch book --------------------------------------------------- */

	/*
	 * A launch book keeps career trajectories that were already traced, so a
	 * planner can re-fly one instead of searching for it again. Each entry
	 * stores the aim in engine units plus the visit log of its trace: pricing
	 * that log at the live market gives the harvest exactly, so a stored shot
	 * scores like a fresh trace without running one. The list is per career, so
	 * the player and every rival company remember their own finds.
	 */

	/* the world a trace was made in: a different tag makes stored paths stale */
	function launchBookTag(fieldStatic, gravityScale, forceScale, strength, count) {
		let tag = fieldStatic ? 0x9e3779b9 : 0x85ebca6b;
		for (let i = 0; i < count; i++) {
			tag = Math.imul(tag ^ (Math.round(strength[i] * 100) + i * 31), 0x01000193) >>> 0;
		}
		tag = Math.imul(tag ^ Math.round(gravityScale * 100), 0x01000193) >>> 0;
		return Math.imul(tag ^ Math.round(forceScale * 100), 0x01000193) >>> 0;
	}

	function createLaunchBook() {
		return { entries: [], tag: 0, version: 0 };
	}

	function resetLaunchBook(book) {
		book.entries.length = 0;
		book.tag = 0;
		book.version += 1;
	}

	function bookReady(book, tag) {
		return book.tag === tag;
	}

	/* planets a trace entered as a bit mask: two shots with one mask harvest
	 * the same systems, so only the faster arrival is worth keeping */
	function launchMask(planets, count) {
		let mask = 0;
		for (let i = 0; i < count; i++) {
			const bit = 2 ** planets[i];
			if (Math.floor(mask / bit) % 2 === 0) mask += bit;
		}
		return mask;
	}

	function findLaunchEntry(book, origin, body, mask) {
		for (let i = 0; i < book.entries.length; i++) {
			const entry = book.entries[i];
			if (entry.origin === origin && entry.body === body && entry.mask === mask) return i;
		}
		return -1;
	}

	/*
	 * The weakest score leaves first; rows from other planets go before the
	 * current one, so a company that moved on does not starve the pad it stands
	 * on. `origin` is the trace being saved.
	 */
	function pruneLaunchBook(book, origin) {
		while (book.entries.length > BOOK_MAX) {
			let worst = -1;
			let fallback = 0;
			for (let i = 0; i < book.entries.length; i++) {
				const entry = book.entries[i];
				if (entry.score < book.entries[fallback].score) fallback = i;
				if (entry.origin === origin) continue;
				if (worst < 0 || entry.score < book.entries[worst].score) worst = i;
			}
			book.entries.splice(worst < 0 ? fallback : worst, 1);
		}
	}

	/*
	 * Save one finished trace; `trace` carries origin, angleU, speedU, body,
	 * steps, time, length, score and the visit log arrays. Same start planet,
	 * landing and visited set: the slower arrival never replaces the faster one.
	 */
	function recordLaunch(book, tag, trace) {
		if (book.tag !== tag) {
			resetLaunchBook(book);
			book.tag = tag;
		}
		const count = trace.logCount < BOOK_LOG_MAX ? trace.logCount : BOOK_LOG_MAX;
		const mask = launchMask(trace.logPlanet, count);
		const at = findLaunchEntry(book, trace.origin, trace.body, mask);
		if (at >= 0 && book.entries[at].steps <= trace.steps) return book.entries[at];
		const entry = at >= 0 ? book.entries[at] : null;
		const out = entry || { logPlanet: new Int32Array(BOOK_LOG_MAX), logStep: new Int32Array(BOOK_LOG_MAX) };
		out.origin = trace.origin;
		out.angleU = trace.angleU;
		out.speedU = trace.speedU;
		out.body = trace.body;
		out.steps = trace.steps;
		out.time = trace.time;
		out.length = trace.length;
		out.mask = mask;
		out.score = trace.score;
		/* the cash the flight itself collected: launch time is priced against it */
		out.money = trace.money === undefined ? trace.score : trace.money;
		out.logCount = count;
		for (let i = 0; i < count; i++) {
			out.logPlanet[i] = trace.logPlanet[i];
			out.logStep[i] = trace.logStep[i];
		}
		if (entry === null) {
			book.entries.push(out);
			pruneLaunchBook(book, trace.origin);
		}
		book.version += 1;
		return out;
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
		HARVEST_ENTRY, HARVEST_TICK, setHarvestMode, harvestMode: harvestModeOf,
		PLANET_GRAVITY_MIN, PLANET_GRAVITY_MAX, PLANET_GRAVITY_STEPS, HQ_GRAVITY_MAX,
		planetGravity, angleUnits, angleOf, speedUnits, speedOf,
		createBurn, encodeBurn, createShot, encodeShot, encodeLink, decodeShot, decodeLink, isGameLink,
		initSteps, createMarket, resetMarket, planetProfit, planetProfitAt, applyMarketSpecials,
		bindRun, politicsSeconds, rebelRail, setPolitics, politicsOn,
		advancePolitics, acceptBribe, bribeAmount, arrestCareer, pacifyPlanet, seizePlanet, clearMedicalCargo,
		bribeRefusal, coveredPlanets, BRIBE,
		createLedger, resetLedger, beginFlight, stepHarvest, harvestPlanet, endFlight,
		estimateProfit, estimateProfitLog, compareScores,
		setSpecialPlanets, specialPlanets: specialPlanetsOn,
		setCareerUniverse, applyMarketUniverse, planetInPlay, colonyInPlay, activePlanetDraw,
		BOOK_MAX, BOOK_LOG_MAX, createLaunchBook, resetLaunchBook, launchBookTag, bookReady,
		launchMask, recordLaunch, pruneLaunchBook,
		CAREER, FUEL_KG_PER_KWH, FUEL_PRICE, FUEL_BUY_STEP, fuelPrice, produceFuel, buyFuel,
		CAPITAL_VISIT_PAY, TOURIST_CHANCE, TOURIST_WEIGHT,
		BOARD_SIZE, COMPETE_SLOT, MEDIC_SLOT, CARGO_TONS,
		TASK_NONE, TASK_DELIVERY, TASK_COMPETE, TASK_MEDIC,
		TASK_OFFERED, TASK_ACCEPTED, TASK_LOADED,
		CAREER_OPEN, CAREER_BROKE, CAREER_COMPLETE,
		createCareer, resetCareer, startCareer, checkEnded, placeShip,
		COMMERCIAL_PAD, OWNER_COMMERCIAL, CAPITAL_PAD, OWNER_CAPITAL, OWNER_REBEL, capitalCovered,
		createGalaxy, resetGalaxy, joinGalaxy, rivalSeed,
		turretPeriod, turretAngle, padAt, padOwner, claimOwner, refreshNetwork, setCommercial,
		launchFee, exitCost, exitCostAt, careerCanFire, padLift, reserveEnergy, releaseEnergy,
		railOwnerText, railText, railBlock,
		SCIENCE_FAMILIES, SCIENCE_KINDS, seedScience, researchPreview, researchCost, researchLabel, researchPoint,
		prototypesOf, prototypeById, gearKnown, planetBuildable, planetSeized,
		buildGear, bulkUpgradeCost, bulkUpgrade, installPart,
		refreshBoard, canAccept, acceptTask, dropContract, medicLoad, settleMedic,
		careerBeginFlight, careerBurn, careerAdvance, careerEndFlight, evacuate
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = GravityGame;
	else root.GravityGame = GravityGame;
})(typeof globalThis !== 'undefined' ? globalThis : this);

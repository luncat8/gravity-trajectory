/*
 * Game-mode rules shared by the page, rival bots and the node benches: the aim
 * grid, per-rule caps, replay link codec, the shared per-planet growing
 * visit-profit market, and the career rule (catapult network, pad energy,
 * contract board, evacuation, cheats).
 *
 * This core holds the rule vocabulary every part reads — the rule table,
 * mode/bot/player/cheat enums, purse presets, experiment bounds, the replay
 * link codec, the CAREER table, task/leg/owner enums, pad/task records and
 * price — plus PARTS, the load order and table of contents. Each part takes
 * names from the core and earlier parts on its `const { … } = inner;` line,
 * publishes its public keys onto GravityGame and its shared names onto inner,
 * and reaches a later part as `inner.name(…)` at call time.
 * experiments/parts_test.js checks the wiring.
 */
(function (root) {
	'use strict';

	/* load order; index.html lists the same files right after this one */
	const PARTS = [
		'game_ship.js',        // ship wear, repair, fuel, evacuation fare, balance knobs
		'game_market.js',      // visit-profit market, ledger, harvest, universe mask
		'game_book.js',        // launch book: saved trajectories and their visit logs
		'game_network.js',     // galaxy, EMC pads and turrets, fees, launch gates
		'game_opening.js',     // seat solver 1/5: opening fans and exit margin
		'game_seat_stats.js',  // seat solver 2/5: set stats and seat matching
		'game_seat_rank.js',   // seat solver 3/5: set ranking, laws, composition
		'game_seat_walk.js',   // seat solver 4/5: the resumable single-law walk
		'game_seat_search.js', // seat solver 5/5: seat plans, tiered search, HQ pick
		'game_sport.js',       // the shared sport race
		'game_contracts.js',   // deliveries, medics, task board, accept, payouts
		'game_politics.js',    // rot, bribes, arrest, rebellion
		'game_build.js',       // pad fit, building, parts, radar
		'game_science.js',     // research hull, prototypes, start gifts
		'game_departure.js',   // leg probe, arrival mass/charge, departure solvency
		'game_legs.js',        // two-leg quests: impact ways, pair slots, careerLegPlan
		'game_career.js',      // create/reset/start a company, placement, stats, end
		'game_flight.js',      // flights, landing settlement, evacuation ride
	];

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
	const PlanetGravity = typeof module !== 'undefined' && module.exports
		? require('./planet_gravity.js')
		: root.PlanetGravity;

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
/* stats sampling (0.6.10 plan §3): one sample every STATS_SEC game seconds,
 * kept in fixed 256-sample blocks that thin themselves (keep every second
 * sample, double the interval) when they fill, so a whole career stays on
 * the plot without growing without bound */
const STATS_SAMPLES = 256;
	const RULE_TOUR = 'tour';
	const RULE_ROUTE = 'route';
	const RULE_MONEY = 'money';
	const RULE_CAREER = 'career';
	/*
	 * One table for everything a rule changes: flight cap, preview horizon
	 * (null = the lab slider; a number is traced to its end as a job sliced
	 * over frames), shot ceiling (0 = unlimited), whether the run stops when
	 * all 26 systems are visited, whether rivals may join, and whether the
	 * players can hold the game clock (the pause button and the landing pause).
	 */
	const RULES = {
		tour: { name: RULE_TOUR, capSteps: CAP_STEPS, horizon: null, maxShots: 0, stopOnTour: true, planner: false, solo: false, pause: false },
		route: { name: RULE_ROUTE, capSteps: ROUTE_STEPS, horizon: ROUTE_SECONDS, maxShots: 1, stopOnTour: false, planner: true, solo: false, pause: false },
		money: { name: RULE_MONEY, capSteps: CAP_STEPS, horizon: null, maxShots: MONEY_SHOTS, stopOnTour: false, planner: false, solo: false, pause: false },
		career: { name: RULE_CAREER, capSteps: CAP_STEPS, horizon: CAP_SECONDS, maxShots: 0, stopOnTour: false, planner: false, solo: false, humanOnly: true, pause: true }
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
	 * (≈ +0.24) and grows toward the 4.00 cap along a saturation curve whose
	 * slope starts at +0.00625 per flight-second (+0.25 per 40 s) and eases
	 * off as the value nears the cap, reaching it only at infinite age.
	 * Entering a planet's port orbit collects its value and resets it to 0.00.
	 */
	const MONEY = {
		cost: 1,
		k: 0.00625,
		initSec: 40,
		cap: 4,
		purse0: 3
	};
	const PURSE_PRESETS = { tight: 2, standard: 3, relaxed: 6 };
	/* experimental settings panel bounds; links carry non-default multipliers */
	const EXPERIMENT = {
		gravityMin: 0, gravityMax: 9,
		forceMin: 0.25, forceMax: 3,
		spaceWearMin: 0, spaceWearMax: 3,
		padMin: 0.25, padMax: 4,
		rotMin: 0, rotMax: 3,
		payMin: 0.25, payMax: 3
	};
	const SRC_PLANETS = 0;
	const SRC_PORTS = 1;
	const SRC_CODES = 'pm';
	const NO_ABORT = -1;
	/* the seeded field lives in its own file (the map-generator helper reads the
	 * same draw); these names stay the game's public ones */
	const PLANET_GRAVITY_MIN = PlanetGravity.MIN;
	const PLANET_GRAVITY_MAX = PlanetGravity.MAX;
	const PLANET_GRAVITY_STEPS = PlanetGravity.STEPS;
	const planetGravity = PlanetGravity.gravity;
	const SHOT_FORM = /^([pm])(\d{1,2})\.([0-9a-z]{1,4})\.([0-9a-z]{1,4})(?:\.([0-9a-z]{1,4}))?$/;
	const BURN_FORM = /^b([0-9a-z]{1,4})\.([0-9a-z]{1,4})\.([0-9a-z]{1,4})$/;
	const END_FORM = /^(\d{1,2})\.(\d{1,9})$/;
		const estScratch = new Float64Array(OrbitWorld.PLANETS);
	const BOOK_LOG_MAX = GravitySim.PRED_LOG_MAX;

	function angleUnits(angle) {
		return (Math.round(angle / ANGLE_UNIT) % ANGLE_STEPS + ANGLE_STEPS) % ANGLE_STEPS;
	}

	function angleOf(units) {
		return units * ANGLE_UNIT;
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

	/* whole-cr start-gift budget, omitted at 0 */
	function giftPart(name, value) {
		return value > 0 ? '&' + name + '=' + value : '';
	}

	/* `game` = { seed, rate, rule, bot, player, cheat, gravityScale, forceScale,
	 * spaceWearScale, harvestTick, giftAll, giftBot, giftHuman, shots, visited,
	 * steps, length }; default rule/bot/player/scales/gifts stay
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
			(game.rule === RULE_CAREER
				? scalePart('ws', game.spaceWearScale) + scalePart('ps', game.padScale) +
					scalePart('rs', game.rotScale) + scalePart('ys', game.payScale)
				: '') +
			(game.rule === RULE_CAREER && game.harvestTick ? '&ht=1' : '') +
			(game.rule === RULE_CAREER
				? giftPart('ga', game.giftAll) + giftPart('gb', game.giftBot) + giftPart('gh', game.giftHuman)
				: '');
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

	/* absent = 0, otherwise a whole number of cr inside [0, GIFT.budgetMax] */
	function decodeGift(text) {
		if (text === null) return 0;
		if (!/^\d{1,2}$/.test(text)) return null;
		const value = Number(text);
		return value <= inner.GIFT.budgetMax ? value : null;
	}

	/* Returns { seed, rate, rule, bot, player, cheat, gravityScale, forceScale,
	 * spaceWearScale, harvestTick, giftAll, giftBot, giftHuman, shots, end, length } or null. */
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
		const spaceWearScale = decodeScale(params.get('ws'), EXPERIMENT.spaceWearMin, EXPERIMENT.spaceWearMax);
		const padScale = decodeScale(params.get('ps'), EXPERIMENT.padMin, EXPERIMENT.padMax);
		const rotScale = decodeScale(params.get('rs'), EXPERIMENT.rotMin, EXPERIMENT.rotMax);
		const payScale = decodeScale(params.get('ys'), EXPERIMENT.payMin, EXPERIMENT.payMax);
		if (gravityScale === null || forceScale === null || spaceWearScale === null ||
			padScale === null || rotScale === null || payScale === null) return null;
		const harvestText = params.get('ht');
		if (harvestText !== null && harvestText !== '1' && harvestText !== '0') return null;
		const harvestTick = harvestText === '1';
		const giftAll = decodeGift(params.get('ga'));
		const giftBot = decodeGift(params.get('gb'));
		const giftHuman = decodeGift(params.get('gh'));
		if (giftAll === null || giftBot === null || giftHuman === null) return null;
		if (rule.name !== RULE_CAREER && giftAll + giftBot + giftHuman > 0) return null;
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
			gravityScale: gravityScale, forceScale: forceScale, spaceWearScale: spaceWearScale,
			padScale: padScale, rotScale: rotScale, payScale: payScale, harvestTick: harvestTick,
			giftAll: giftAll, giftBot: giftBot, giftHuman: giftHuman,
			shots: shots, end: end, length: length };
	}

	function isGameLink(text) {
		return new URLSearchParams(String(text).replace(/^#/, '')).has('game');
	}

	/* the `bribeVisitStep` marker of a visit that has not carried a bribe: far
	 * below any step a run holds, so it can never equal a visit stamp by
	 * accident and open the window shut, or shut one still open */
	const BRIBE_OPEN = -0x7fffffff;
	/* fragile load (0.6.3): the launch acceleration m/s² the load survives.
	 * accel = speed² / (2 · RAIL_M), so the limit prices force, not the rail
	 * tier: EMC-1 at full force stays under it on a loaded ship, a stronger
	 * rail must be fired gently. FRAGILE_SPEED is the same limit in px/s. */
	const FRAGILE_ACCEL = 2.0;
	const FRAGILE_SPEED = Math.sqrt(2 * FRAGILE_ACCEL * OrbitTech.RAIL_M);

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
	 * and the neutral commercial EMC-1 standing on every planet charges a fee
	 * that scales with the shot. So a padless planet is no longer a dead end,
	 * only an expensive one.
	 * A company has ten game minutes to recover from insolvency, or completes
	 * (a catapult on every planet; cheat runs never complete). Evacuation can
	 * use the remaining purse and trades time for any unpaid fare.
	 * Every `*Sec` below is flight seconds (`steps · DT`) — the clock the board,
	 * the barrels and the HUD read — never world minutes or real seconds.
	 */
	const CAREER = {
		evacFee: 6,
		evacFullSeconds: 12,
		evacFreeSeconds: 240,
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
	const FUEL_BUY_STEP = 10;
	const START_MODES = { planet: true, space: true, capital: true };
	const COMPETE_SLOT = CAREER.deliverySlots;
	const MEDIC_SLOT = CAREER.deliverySlots + 1;
	const BOARD_SIZE = CAREER.deliverySlots + 2;
	const SPORT_LENGTH = 0;
	const TASK_NONE = 0;
	const TASK_DELIVERY = 1;
	const TASK_COMPETE = 2;
	const TASK_MEDIC = 3;
	const TASK_OFFERED = 0;
	const TASK_ACCEPTED = 1;
	const TASK_LOADED = 2;
	/* what a landing can complete: a contract leg or the competition. Both the
	 * money the purse takes (`cash`) and the progress that unlocks the rest of
	 * the payout (`credit`) are read off one table. */
	const LEG_NONE = 0;
	const LEG_LOAD = 1;
	const LEG_DELIVER = 2;
	const LEG_MEDICS = 3;
	const LEG_PATIENTS = 4;
	/* a leg that only advances a contract is worth its reward times this while
	 * the payout is still unrealized: loaded cargo is not yet money in the purse */
	const LEG_CREDIT = 0.35;
	const CAREER_OPEN = 0;
	const SALT_HQ = 0xca;
	const SALT_TASK = 0xcb;
	const SALT_BRIBE = 0xd0;
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
	/* accepting any quest or sport at the Capital refunds the entry fee at once;
	 * failing or removing that quest or sport deducts the refund back */
	const CAPITAL_REFUND = -CAPITAL_VISIT_PAY;
	const TOURIST_WEIGHT = 2;

	/*
	 * Rebellious worlds (0.5.12). A rebellion seizes every player rail on its
	 * planet into one commercial rail the rebels run: the tiers survive, the
	 * fee is the ordinary commercial one, and the planet can never be claimed
	 * or built again. Until it is quelled, visits there pay a fly-by multiple
	 * that ramps from 1x toward 4x as the rebellion ages.
	 */
	const OWNER_REBEL = -3;
	/* an uninhabited world (0.7.44): no rail of any kind stands there, nothing
	 * can be built until a colonization kit founds the colony, and a landing
	 * pays nothing. Escape without founding is the evacuation tow. */
	const OWNER_EMPTY = -4;

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

	/*
	 * A queued launch claims the energy of its shot from the pad battery before
	 * the barrel lines up, so whoever queued first gets the charge — the owner
	 * of the rail and a guest on it alike. The reservation lowers everyone's
	 * launch ceiling (GravitySim.speedLimit) until the shot fires or is
	 * cancelled, and the neutral commercial rail (kept charged by its operator)
	 * never reserves nor drains.
	 */
	function reserveEnergy(pad, energy) {
		if (!pad || pad === COMMERCIAL_PAD || pad.commercial || pad === CAPITAL_PAD || !(energy > 0)) return;
		pad.reservedKwh += energy;
	}

	function releaseEnergy(pad, energy) {
		if (!pad || pad === COMMERCIAL_PAD || pad.commercial || pad === CAPITAL_PAD || !(energy > 0)) return;
		pad.reservedKwh = pad.reservedKwh > energy ? pad.reservedKwh - energy : 0;
	}

	function clearTask(task) {
		task.kind = TASK_NONE;
		task.state = TASK_OFFERED;
		task.tourist = false;
		task.fragile = false;
		task.deep = false;
		task.medics = 0;
		task.patients = 0;
		task.aboard = 0;
		task.capitalRefund = 0;
		task.startsAt = 0;
	}

	function price(career, cost) {
		return career.cheat === CHEAT_COMMUNISM ? 0 : cost;
	}

	function canPay(career, cost) {
		return career.ledger.purse + 1e-9 >= price(career, cost);
	}

	function draw01(career, salt) {
		career.serial += 1;
		return OrbitWorld.hashBits(career.seed, career.serial, salt) / 4294967296;
	}

	function round2(value) {
		return Math.round(value * 100) / 100;
	}

	function pay(career, amount) {
		career.ledger.purse += amount;
		career.earned += amount;
		career.lastReward += amount;
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
		FORMAT, ANGLE_STEPS, SPEED_STEPS, CAP_SECONDS, CAP_STEPS, RATE_MIN, RATE_MAX, ROUTE_SECONDS,
		ROUTE_STEPS, MONEY_SHOTS, RULE_TOUR, RULE_ROUTE, RULE_MONEY, RULE_CAREER, RULES, BOT_OFF,
		BOT_EASY, BOT_NORMAL, BOT_HARD, BOTS, PLAYER_USER, PLAYER_BOT, PLAYER_TYPES, CHEAT_COMMUNISM,
		CHEAT_ENDGAME, CHEATS, SRC_PLANETS, SRC_PORTS, NO_ABORT, MONEY, PURSE_PRESETS, EXPERIMENT,
		PLANET_GRAVITY_MIN, PLANET_GRAVITY_MAX, PLANET_GRAVITY_STEPS, planetGravity, angleUnits,
		angleOf, speedOf, createBurn, encodeBurn, createShot, encodeShot, encodeLink, decodeShot,
		decodeLink, isGameLink, compareScores, setSpecialPlanets, specialPlanets: specialPlanetsOn,
		BOOK_LOG_MAX, CAREER, FUEL_BUY_STEP, START_MODES, CAPITAL_VISIT_PAY, CAPITAL_REFUND,
		TOURIST_WEIGHT, FRAGILE_ACCEL, FRAGILE_SPEED, BOARD_SIZE, COMPETE_SLOT, MEDIC_SLOT,
		SPORT_LENGTH, TASK_NONE, TASK_DELIVERY, TASK_COMPETE, TASK_MEDIC, TASK_OFFERED,
		TASK_ACCEPTED, TASK_LOADED, LEG_NONE, LEG_LOAD, LEG_DELIVER, LEG_MEDICS, LEG_PATIENTS,
		LEG_CREDIT, CAREER_OPEN, COMMERCIAL_PAD, OWNER_COMMERCIAL, CAPITAL_PAD, OWNER_CAPITAL,
		OWNER_REBEL, OWNER_EMPTY, reserveEnergy, releaseEnergy
	};
	const inner = {
		GravitySim, OrbitWorld, OrbitEcon, OrbitTech, OrbitScience, PlanetGravity, SPEED_STEPS,
		CAP_SECONDS, CAP_STEPS, STATS_SAMPLES, RULES, CHEAT_COMMUNISM, CHEAT_ENDGAME, MONEY,
		EXPERIMENT, planetGravity, estScratch, BOOK_LOG_MAX, angleUnits, angleOf, speedOf,
		BRIBE_OPEN, FRAGILE_SPEED, CAREER, COMPETE_SLOT, MEDIC_SLOT, BOARD_SIZE, SPORT_LENGTH,
		TASK_NONE, TASK_DELIVERY, TASK_COMPETE, TASK_MEDIC, TASK_OFFERED, TASK_ACCEPTED, TASK_LOADED,
		LEG_NONE, LEG_LOAD, LEG_DELIVER, LEG_MEDICS, LEG_PATIENTS, LEG_CREDIT, CAREER_OPEN, SALT_HQ,
		SALT_TASK, COMMERCIAL_PAD, OWNER_COMMERCIAL, OWNER_CAPITAL, CAPITAL_PAD, CAPITAL_VISIT_PAY,
		CAPITAL_REFUND, OWNER_REBEL, OWNER_EMPTY, specialPlanetsOn, releaseEnergy, clearTask, price, canPay,
		draw01, round2, pay
	};

	let attached = 0;
	function part(file, attach) {
		if (file !== PARTS[attached]) throw new Error('gravity_game.js: expected ' + PARTS[attached] + ', got ' + file);
		attach(GravityGame, inner);
		attached += 1;
		if (attached < PARTS.length) return;
		delete GravityGame.part;
	}

	if (typeof module !== 'undefined' && module.exports) {
		for (const file of PARTS) part(file, require('./' + file));
		module.exports = GravityGame;
	} else {
		Object.defineProperty(GravityGame, 'part', { value: part, configurable: true });
		root.GravityGame = GravityGame;
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);

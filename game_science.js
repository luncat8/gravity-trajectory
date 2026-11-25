/*
 * Science: the research hull, prototypes, and the start-gift budget and
 * draws (gifts grant prototypes and science points).
 * not here: when gifts are granted → game_career.js
 *
 * Part of GravityGame (load order: PARTS in gravity_game.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityGame.part('game_science.js', attach)
)(function (GravityGame, inner) {
	'use strict';
	const {
		OrbitWorld, OrbitTech, OrbitScience, CAREER_OPEN, price, canPay, round2, RADAR_COST, ownPart
	} = inner;

	const SALT_GIFT = 0xd1;

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
		career.sciSpent += cost;
		OrbitScience.acceptHull(career.science, family, params, label);
		career.research += 1;
		career.lastResearch = cost;
		unlockPrototype(career, family, params, label);
		return true;
	}

	/* --- start gifts (0.7.48) ------------------------------------------------
	 * an operator budget drawn per company at start: a few pool entries, the
	 * rest as cash. The pool is data. A kit is priced at its parts' build cost,
	 * so a gift never disagrees with the shop; kits pair an engine with its
	 * tank, because an engine without fuel is no gift. Gifted parts are owned,
	 * not fitted: the start ship stays the one the fair-start seats were
	 * planned for, and a refit to an owned part is free. A science entry is
	 * the research budget of one invention. Cash is never an entry: it is
	 * what the draws leave. The 0.7.49 radar entry joins the table when the
	 * facility exists. */
	const GIFT = { budgetMax: 20, maxDraws: 3 };
	const GIFT_PART = 'part';
	const GIFT_SCIENCE = 'science';
	/* the radar facility itself (0.7.49): granted past the build gate, paid
	 * from the budget like any other entry — the flag is the whole machine */
	const GIFT_RADAR = 'radar';
	const GIFT_POOL = [
		{ id: 'imp1', kind: GIFT_PART, weight: 3, items: ['IMP-1', 'FT-1'] },
		{ id: 'imp2', kind: GIFT_PART, weight: 2, items: ['IMP-2', 'FT-2'] },
		{ id: 'imp3', kind: GIFT_PART, weight: 1, items: ['IMP-3', 'FT-3'] },
		{ id: 'sci3', kind: GIFT_SCIENCE, weight: 2, value: 3 },
		{ id: 'sci6', kind: GIFT_SCIENCE, weight: 2, value: 6 },
		{ id: 'sci10', kind: GIFT_SCIENCE, weight: 1, value: 10 },
		{ id: 'radar', kind: GIFT_RADAR, weight: 2, value: RADAR_COST }
	];
	for (let i = 0; i < GIFT_POOL.length; i++) {
		const entry = GIFT_POOL[i];
		if (entry.kind !== GIFT_PART) continue;
		entry.parts = entry.items.map(giftPartById);
		entry.value = round2(entry.parts.reduce((sum, item) => sum + item.buildCost, 0));
	}
	/* a science gift invents one point on the segment from a known rung toward
	 * the family's next step, as far out as its value pays at the start hull */
	const GIFT_FRONTIER = [
		{ family: OrbitTech.KIND_CATAPULT, from: 'EMC-2', to: [135, 0.80] },
		{ family: OrbitTech.KIND_ENGINE, from: 'IMP-3', to: [56, 2.5] },
		{ family: OrbitTech.KIND_TANK, from: 'FT-3', to: [220, 1.4] },
		{ family: OrbitTech.KIND_BATTERY, from: 'BAT-5', to: [22, 0.0003] }
	];
	const GIFT_T_STEPS = 100;
	let giftAll = 0;
	let giftBot = 0;
	let giftHuman = 0;

	function giftPartById(id) {
		for (let k = 0; k < OrbitTech.PART_KINDS.length; k++) {
			const item = OrbitTech.findKind(OrbitTech.PART_KINDS[k], id);
			if (item) return item;
		}
		throw new Error('unknown gift part ' + id);
	}

	function clampGift(value) {
		const v = Math.round(Number(value));
		if (!Number.isFinite(v) || v < 0) return 0;
		return v > GIFT.budgetMax ? GIFT.budgetMax : v;
	}

	/* the run's three budgets; read once per company start */
	function setStartGifts(all, bot, human) {
		giftAll = clampGift(all);
		giftBot = clampGift(bot);
		giftHuman = clampGift(human);
	}

	function startGiftsOf() {
		return { all: giftAll, bot: giftBot, human: giftHuman };
	}

	function giftBudget(isBot) {
		return giftAll + (isBot ? giftBot : giftHuman);
	}

	function giftFits(entry, remaining, drawn, last) {
		if (entry.value > remaining + 1e-9 || entry === last) return false;
		/* a kit once, a radar once; science entries may repeat */
		return entry.kind === GIFT_SCIENCE || drawn.indexOf(entry) < 0;
	}

	/* pure and deterministic in (budget, seed): up to GIFT.maxDraws weighted
	 * picks among the entries the rest of the budget still pays, never the same
	 * entry twice in a row nor a kit twice; whatever is left is cash */
	function drawGifts(budget, seed) {
		const drawn = [];
		let remaining = clampGift(budget);
		let last = null;
		for (let k = 0; k < GIFT.maxDraws; k++) {
			let total = 0;
			for (let i = 0; i < GIFT_POOL.length; i++) {
				if (giftFits(GIFT_POOL[i], remaining, drawn, last)) total += GIFT_POOL[i].weight;
			}
			if (total === 0) break;
			let pick = OrbitWorld.hash01(seed >>> 0, k, SALT_GIFT) * total;
			let chosen = null;
			for (let i = 0; i < GIFT_POOL.length && pick >= 0; i++) {
				if (!giftFits(GIFT_POOL[i], remaining, drawn, last)) continue;
				chosen = GIFT_POOL[i];
				pick -= chosen.weight;
			}
			drawn.push(chosen);
			remaining = round2(remaining - chosen.value);
			last = chosen;
		}
		return { drawn: drawn, cash: remaining };
	}

	function frontierPoint(from, to, t) {
		return [round4(from[0] + (to[0] - from[0]) * t), round4(from[1] + (to[1] - from[1]) * t)];
	}

	function round4(value) {
		return Math.round(value * 10000) / 10000;
	}

	/* the farthest hundredth of the frontier segment whose research fee fits */
	function giftSciencePoint(career, frontier, value) {
		const spec = scienceFamilyOf(frontier.family);
		const from = spec.params(OrbitTech.findKind(frontier.family, frontier.from));
		for (let s = GIFT_T_STEPS; s > 0; s--) {
			const params = frontierPoint(from, frontier.to, s / GIFT_T_STEPS);
			if (OrbitScience.previewHull(career.science, frontier.family, params).cost <= value) return params;
		}
		return null;
	}

	/* one invention, researched for free: it widens the hull and is owned as
	 * a prototype, exactly what `researchPoint` buys */
	function grantGiftScience(career, value, seed, k) {
		const first = Math.floor(OrbitWorld.hash01(seed >>> 0, GIFT.maxDraws + k, SALT_GIFT) * GIFT_FRONTIER.length);
		for (let n = 0; n < GIFT_FRONTIER.length; n++) {
			const frontier = GIFT_FRONTIER[(first + n) % GIFT_FRONTIER.length];
			const params = giftSciencePoint(career, frontier, value);
			if (!params) continue;
			const label = researchLabel(career);
			OrbitScience.acceptHull(career.science, frontier.family, params, label);
			career.research += 1;
			unlockPrototype(career, frontier.family, params, label);
			career.sciSpent += value;
			return label + ' ' + frontier.family;
		}
		return null;
	}

	/* the whole budget enters the purse; every non-cash gift is paid out of it
	 * into property or science, so purse = starter + gift + profit − property − science */
	function grantStartGifts(career, budget) {
		career.giftCredit = 0;
		career.giftCash = 0;
		career.giftDrawn = [];
		const credit = clampGift(budget);
		if (credit === 0) return;
		const draw = drawGifts(credit, career.seed);
		career.giftCredit = credit;
		career.ledger.purse += credit;
		let cash = credit;
		for (let k = 0; k < draw.drawn.length; k++) {
			const entry = draw.drawn[k];
			if (entry.kind === GIFT_PART) {
				for (let i = 0; i < entry.parts.length; i++) ownPart(career, entry.parts[i]);
				career.buildSpent += entry.value;
				career.giftDrawn.push(entry.items.join(' + '));
			} else if (entry.kind === GIFT_RADAR) {
				/* the flag, past the build gate: a gifted radar works in any
				 * start that has (or will settle) an HQ */
				career.radar = true;
				career.buildSpent += entry.value;
				career.giftDrawn.push('radar');
			} else {
				const text = grantGiftScience(career, entry.value, career.seed, k);
				if (text === null) continue;
				career.giftDrawn.push(text);
			}
			career.ledger.purse -= entry.value;
			cash -= entry.value;
		}
		career.giftCash = round2(cash);
	}

	/* `start gift · IMP-1 + FT-1 · R1 catapult · cash 2.00` */
	function giftText(career) {
		if (!(career.giftCredit > 0)) return '';
		const parts = career.giftDrawn.slice();
		if (career.giftCash > 0) parts.push('cash ' + career.giftCash.toFixed(2));
		return 'start gift ' + career.giftCredit + ' cr · ' + parts.join(' · ');
	}

	Object.assign(GravityGame, {
		GIFT, GIFT_POOL, GIFT_FRONTIER, setStartGifts, startGiftsOf, giftBudget, drawGifts,
		grantStartGifts, giftText, SCIENCE_FAMILIES, SCIENCE_KINDS, seedScience, researchPreview,
		researchCost, researchLabel, researchPoint, prototypesOf, prototypeById
	});
	Object.assign(inner, {
		newPrototypes, seedScience, GIFT, giftBudget, grantStartGifts
	});
});

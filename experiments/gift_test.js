/*
 * Start gifts (0.7.48): a start-gift budget drawn per company.
 *   - the draw is pure and deterministic in (budget, seed), 1+ gifts when the
 *     cheapest entry fits, the rest cash
 *   - the grant: the whole budget enters the purse, gifts are paid out of it
 *     into property/science, so purse = starter + gift + profit − property − science
 *   - parts are owned, never fitted; a science gift is one free invention
 *   - every company draws its own budget (bot or human); a 0 budget is today's start
 *   - links, the address and saved maps carry the three budgets
 *
 * Run: node experiments/gift_test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const OrbitWorld = require(path.join(root, 'orbit_world.js'));
const OrbitSim = require(path.join(root, 'orbit_sim.js'));
const OrbitTech = require(path.join(root, 'orbit_tech.js'));
const GravitySim = require(path.join(root, 'gravity_sim.js'));
const GravityGame = require(path.join(root, 'gravity_game.js'));
const GravityBot = require(path.join(root, 'gravity_bot.js'));
const { loadPage, mapSearch } = require('./dom_stub.js');
require(path.join(root, 'career_actions.js'));
const CareerActions = globalThis.CareerActions;

const STARTER = OrbitTech.starterGrant().purse;
let failures = 0;

function check(name, fn) {
	try {
		GravityGame.setStartGifts(0, 0, 0);
		fn();
		console.log('ok - ' + name);
	} catch (err) {
		failures += 1;
		console.error('FAIL - ' + name + ': ' + err.message);
		if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
	} finally {
		GravityGame.setStartGifts(0, 0, 0);
	}
}

function makeWorld(seed) {
	const mask = new Uint8Array(OrbitWorld.PLANETS);
	mask.fill(1, 0, 13);
	const trade = new OrbitSim(seed);
	trade.setPlanetMask(mask);
	trade.step(420);
	trade.setPlanetLimit(13);
	const sim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	const strength = new Float64Array(GravitySim.MAX_BODIES).fill(0);
	for (let p = 0; p < 13; p++) strength[p] = 1;
	const fill = (t, ox, oy, n) => {
		for (let i = 0; i < n; i++) { ox[i] = trade.planetX[i]; oy[i] = trade.planetY[i]; }
	};
	sim.setField(OrbitWorld.PLANETS, trade.planetR, strength, fill, true);
	sim.setPlanets(OrbitWorld.PLANETS, trade.planetX, trade.planetY, trade.planetR,
		trade.orbitRX, trade.orbitRY, trade.orbitTiltCos, trade.orbitTiltSin);
	sim.setPlanetMask(mask);
	sim.bodyCount = 13;
	return { seed, mask, trade, sim };
}

function startOne(w, seed, isBot, cheat) {
	const career = GravityGame.createCareer(GravityGame.createLedger());
	GravityGame.setCareerUniverse(career, w.mask, 13);
	GravityGame.startCareer(career, w.sim, seed, w.trade, cheat || null, null, undefined, undefined, isBot);
	return career;
}

function moneyIdentity(career) {
	const out = {};
	GravityGame.careerStats(out, career);
	return STARTER + out.gift + out.profit - out.property - out.science;
}

const minValue = Math.min(...GravityGame.GIFT_POOL.map(e => e.value));
const world = makeWorld(42);

check('pool: kits are priced at their parts\' build cost and every entry fits the slider', () => {
	for (const entry of GravityGame.GIFT_POOL) {
		assert.ok(entry.value > 0 && entry.value <= GravityGame.GIFT.budgetMax, entry.id);
		if (entry.kind !== 'part') continue;
		const sum = entry.parts.reduce((s, item) => s + item.buildCost, 0);
		assert.strictEqual(entry.value, Math.round(sum * 100) / 100, entry.id + ' value');
		assert.ok(entry.parts.some(item => item.thrust) && entry.parts.some(item => item.fuelCap),
			entry.id + ' pairs an engine with a tank');
	}
});

check('pool: the colonization kit is an endgame purchase, never a start gift', () => {
	assert.ok(!GravityGame.GIFT_POOL.some(entry => entry.id === OrbitTech.COLONY_KIT.id),
		'the kit opens an empty world; it cannot arrive as a start gift');
	for (const entry of GravityGame.GIFT_POOL) {
		if (entry.kind !== 'part') continue;
		assert.ok(!entry.parts.some(item => item.id === OrbitTech.COLONY_KIT.id), entry.id);
	}
});

check('draw: deterministic, inside the budget, 1+ gifts once the cheapest fits, rest cash', () => {
	let differs = 0;
	for (let seed = 1; seed <= 300; seed++) {
		for (const budget of [0, 1, 2, 3, 6, 12, 20]) {
			const a = GravityGame.drawGifts(budget, seed);
			const b = GravityGame.drawGifts(budget, seed);
			assert.deepStrictEqual(a.drawn.map(e => e.id), b.drawn.map(e => e.id));
			const spent = a.drawn.reduce((s, e) => s + e.value, 0);
			assert.ok(Math.abs(spent + a.cash - budget) < 1e-9, 'spent + cash = budget');
			assert.ok(a.cash >= -1e-9, 'never over budget');
			assert.ok(a.drawn.length <= GravityGame.GIFT.maxDraws);
			if (budget < minValue) assert.strictEqual(a.drawn.length, 0, 'sub-minimum budget is pure cash');
			else assert.ok(a.drawn.length >= 1, 'budget ' + budget + ' seed ' + seed + ' draws 1+');
			for (let i = 1; i < a.drawn.length; i++) assert.notStrictEqual(a.drawn[i], a.drawn[i - 1]);
			const kits = a.drawn.filter(e => e.kind === 'part').map(e => e.id);
			assert.strictEqual(new Set(kits).size, kits.length, 'a kit is drawn once');
		}
		const here = GravityGame.drawGifts(20, seed).drawn.map(e => e.id).join();
		const next = GravityGame.drawGifts(20, seed + 1).drawn.map(e => e.id).join();
		if (here !== next) differs += 1;
	}
	assert.ok(differs > 150, 'a new seed re-rolls (' + differs + '/300 neighbours differ)');
});

check('default: all budgets 0 is the fixed starter grant, bit for bit', () => {
	const career = startOne(world, 42, false);
	assert.strictEqual(career.ledger.purse, STARTER);
	assert.strictEqual(career.giftCredit, 0);
	assert.deepStrictEqual(career.giftDrawn, []);
	assert.strictEqual(career.research, 0);
	assert.strictEqual(career.buildSpent, 0);
	assert.strictEqual(GravityGame.giftText(career), '');
	assert.strictEqual(moneyIdentity(career), career.ledger.purse);
});

check('grant: budget enters the purse, gifts are paid into property/science, the money identity holds', () => {
	for (let seed = 1; seed <= 40; seed++) {
		for (const budget of [3, 6, 12, 20]) {
			GravityGame.setStartGifts(0, 0, budget);
			const career = startOne(world, seed, false);
			const draw = GravityGame.drawGifts(budget, career.seed);
			assert.strictEqual(career.giftCredit, budget);
			assert.ok(career.giftDrawn.length >= 1, 'seed ' + seed + ' budget ' + budget + ' got a gift');
			assert.strictEqual(career.giftDrawn.length, draw.drawn.length);
			assert.ok(Math.abs(career.ledger.purse - (STARTER + draw.cash)) < 1e-9, 'purse = starter + cash');
			assert.ok(Math.abs(career.giftCash - draw.cash) < 1e-9);
			assert.ok(Math.abs(moneyIdentity(career) - career.ledger.purse) < 1e-9, 'money identity');
			assert.ok(GravityGame.giftText(career).startsWith('start gift ' + budget + ' cr · '));
		}
	}
});

check('part gift: owned, never fitted — the start ship is the one the seats were planned for', () => {
	let seen = 0;
	for (let seed = 1; seed <= 200 && seen < 5; seed++) {
		const draw = GravityGame.drawGifts(20, GravityGame.rivalSeed(seed, 0));
		if (!draw.drawn.some(e => e.kind === 'part')) continue;
		GravityGame.setStartGifts(20, 0, 0);
		const gifted = startOne(world, GravityGame.rivalSeed(seed, 0), false);
		GravityGame.setStartGifts(0, 0, 0);
		const plain = startOne(world, GravityGame.rivalSeed(seed, 0), false);
		for (const entry of draw.drawn.filter(e => e.kind === 'part')) {
			for (const item of entry.parts) assert.strictEqual(gifted.owned[item.id], true, item.id + ' owned');
		}
		assert.strictEqual(gifted.ship.engine, plain.ship.engine);
		assert.strictEqual(gifted.ship.tank, plain.ship.tank);
		assert.strictEqual(gifted.ship.mass, plain.ship.mass);
		assert.strictEqual(gifted.hq, plain.hq, 'the gift does not move the HQ');
		/* owned = a free refit, the shop's own rule */
		const engine = draw.drawn.find(e => e.kind === 'part').parts[0];
		const purse = gifted.ledger.purse;
		assert.ok(GravityGame.installPart(gifted, OrbitTech.KIND_ENGINE, engine));
		assert.strictEqual(gifted.ledger.purse, purse, 'refit to a gifted part is free');
		seen += 1;
	}
	assert.ok(seen >= 3, 'found part draws (' + seen + ')');
});

check('science gift: one free invention beyond the stock hull, within its value, not fitted', () => {
	let seen = 0;
	const families = new Set();
	for (let seed = 1; seed <= 300; seed++) {
		const draw = GravityGame.drawGifts(10, seed);
		const sci = draw.drawn.filter(e => e.kind === 'science');
		if (sci.length === 0) continue;
		GravityGame.setStartGifts(0, 10, 0);
		const career = startOne(world, seed, true);
		assert.strictEqual(career.research, sci.length, 'one research per science gift');
		let protos = 0;
		for (const kind of GravityGame.SCIENCE_KINDS) {
			for (const record of GravityGame.prototypesOf(career, kind)) {
				protos += 1;
				families.add(kind);
				assert.strictEqual(career.owned[record.id], true);
			}
		}
		assert.strictEqual(protos, sci.length);
		const sciValue = sci.reduce((s, e) => s + e.value, 0);
		assert.ok(Math.abs(career.sciSpent - sciValue) < 1e-9, 'science stat carries the gift value');
		assert.strictEqual(career.ship.engine, null, 'nothing fitted');
		seen += 1;
	}
	assert.ok(seen >= 20, 'science draws found (' + seen + ')');
	assert.ok(families.size >= 3, 'science spreads over families (' + [...families].join(',') + ')');
	/* the point is the farthest hundredth of the frontier the value pays */
	for (const frontier of GravityGame.GIFT_FRONTIER) {
		const spec = GravityGame.SCIENCE_FAMILIES.find(f => f.kind === frontier.family);
		assert.ok(spec && OrbitTech.findKind(frontier.family, frontier.from), frontier.family + ' frontier resolves');
	}
});

check('per company: bots draw the bot budget, humans the human budget', () => {
	GravityGame.setStartGifts(2, 4, 10);
	assert.strictEqual(GravityGame.giftBudget(true), 6);
	assert.strictEqual(GravityGame.giftBudget(false), 12);
	const bot = startOne(world, 7, true);
	const human = startOne(world, 7, false);
	assert.strictEqual(bot.giftCredit, 6);
	assert.strictEqual(human.giftCredit, 12);
	/* the endgame cheat starts maxed: no gift on top */
	const endgame = startOne(world, 7, false, GravityGame.CHEAT_ENDGAME);
	assert.strictEqual(endgame.giftCredit, 0);
	assert.deepStrictEqual(GravityGame.startGiftsOf(), { all: 2, bot: 4, human: 10 });
	GravityGame.setStartGifts(-3, 99, 2.6);
	assert.deepStrictEqual(GravityGame.startGiftsOf(), { all: 0, bot: 20, human: 3 }, 'clamped whole cr');
});

check('rivals: GravityBot starts every rival on the bot budget', () => {
	GravityGame.setStartGifts(0, 8, 0);
	const w = makeWorld(5);
	const galaxy = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(galaxy, 5);
	const market = GravityGame.createMarket();
	GravityGame.resetMarket(market);
	GravityGame.applyMarketUniverse(market, w.mask, 13);
	GravityGame.applyMarketSpecials(market, w.trade.world);
	GravityGame.bindRun(market, galaxy, w.trade.world);
	const you = GravityGame.createCareer(GravityGame.createLedger());
	GravityGame.setCareerUniverse(you, w.mask, 13);
	GravityGame.startCareer(you, w.sim, 5, w.trade, null, galaxy);
	const bot = new GravityBot(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	bot.reset(5, GravityGame.RULE_CAREER, GravityGame.BOT_NORMAL, GravityGame.PLAYER_USER, null, 2);
	bot.setPlanetMask(w.mask, 13);
	bot.startCareers(galaxy, 5, w.trade, GravityGame.START_PLANET);
	assert.strictEqual(you.giftCredit, 0, 'YOU draws the human budget');
	for (let i = 0; i < bot.count; i++) {
		assert.strictEqual(bot.rivals[i].career.giftCredit, 8, 'rival ' + i + ' draws the bot budget');
	}
	assert.ok(bot.rivals[0].career.giftDrawn.length >= 1, 'an 8 cr budget draws 1+ gifts');
});

check('link: ga/gb/gh round-trip on a career link, refused out of range or outside career', () => {
	const base = { seed: 9, rate: 1, rule: GravityGame.RULE_CAREER, shots: [] };
	const hash = GravityGame.encodeLink({ ...base, giftAll: 3, giftBot: 0, giftHuman: 12 });
	assert.ok(hash.includes('&ga=3') && !hash.includes('&gb=') && hash.includes('&gh=12'), hash);
	const link = GravityGame.decodeLink(hash);
	assert.strictEqual(link.giftAll, 3);
	assert.strictEqual(link.giftBot, 0);
	assert.strictEqual(link.giftHuman, 12);
	const plain = GravityGame.encodeLink(base);
	assert.ok(!/&g[abh]=/.test(plain), 'default omits the budgets');
	assert.strictEqual(GravityGame.decodeLink(plain).giftAll, 0);
	assert.strictEqual(GravityGame.decodeLink(hash.replace('&gh=12', '&gh=21')), null);
	assert.strictEqual(GravityGame.decodeLink(hash.replace('&gh=12', '&gh=1.5')), null);
	assert.strictEqual(GravityGame.decodeLink('game=' + plain.split('game=')[1].replace(/&rule=career/, '') + '&ga=2'),
		null, 'gifts are career only');
});

check('page: the address sets the budgets, the run draws them, the shop names the gift', () => {
	const page = loadPage({ search: '?rule=career&seed=42&rate=1&ga=2&gh=6' });
	const scene = page.context.GravityScene;
	const gifts = JSON.parse(JSON.stringify(scene.startGifts()));
	assert.deepStrictEqual(gifts, { all: 2, bot: 0, human: 6, run: { all: 2, bot: 0, human: 6 } });
	const you = vm.runInContext('game.career', page.context);
	assert.strictEqual(you.giftCredit, 8, 'YOU drew all + human');
	const rivals = vm.runInContext('bot.rivals.slice(0, bot.count).map(r => r.career.giftCredit)', page.context);
	assert.ok(rivals.length >= 1 && rivals.every(v => v === 2), 'rivals drew all + bot: ' + rivals);
	assert.strictEqual(page.elements.get('giftAllLabel').textContent, '2 cr');
	assert.ok(page.elements.get('giftPreview').textContent.startsWith('bots 2 cr · humans 8 cr'));
	assert.ok(!page.elements.get('giftPreview').textContent.includes('e.g.'), 'no example until 👀');
	page.toggle('giftPeek');
	assert.ok(page.elements.get('giftPreview').textContent.includes('e.g. bot '), '👀 shows an example');
	assert.ok(vm.runInContext('careerShopEl.innerHTML', page.context).includes('start gift 8 cr'));
	const search = vm.runInContext('location.search', page.context);
	assert.ok(search.includes('ga=2') && search.includes('gh=6') && !search.includes('gb='), search);
	/* a slider move waits for the next start */
	page.setValue('giftBot', 5);
	assert.strictEqual(vm.runInContext('game.giftBot', page.context), 0);
	assert.ok(page.elements.get('giftPreview').textContent.includes('from next start'));
	assert.ok(vm.runInContext('location.search', page.context).includes('gb=5'));
	/* the copied career link carries the run's budgets, the saved record too */
	const record = vm.runInContext('GravityMaps.runRecord(mapRunInfo())', page.context);
	assert.deepStrictEqual(Array.from(record.gift), [2, 0, 6]);
	page.runFrames(20, 25);
	page.click('gameCopy');
	const actionsText = page.clipboardText;
	const data = CareerActions.decode(actionsText);
	assert.deepStrictEqual(Array.from(data.gift), [2, 0, 6], 'career replay payload carries the run budgets');
	/* the replay starts from a page with no gifts and re-draws the same ones */
	const replayPage = loadPage({ search: mapSearch(3) });
	assert.strictEqual(vm.runInContext('game.career.giftCredit', replayPage.context), 0);
	replayPage.elements.get('replayInput').value = actionsText;
	replayPage.click('replayLoad');
	for (let i = 0; i < 60 && vm.runInContext('careerActionReplay.active', replayPage.context); i++) {
		replayPage.runFrames(2, 25);
	}
	const note = replayPage.elements.get('careerMsg').textContent;
	assert.ok(note.includes('history matches'), 'gifted career replays exactly: ' + note);
	const replayed = vm.runInContext('game.career', replayPage.context);
	assert.strictEqual(replayed.giftCredit, 8);
	assert.deepStrictEqual(Array.from(replayed.giftDrawn), Array.from(you.giftDrawn));
});

if (failures > 0) {
	console.error(failures + ' failure(s)');
	process.exit(1);
}
console.log('START GIFTS OK · draw, grant, per company, links, address, page');

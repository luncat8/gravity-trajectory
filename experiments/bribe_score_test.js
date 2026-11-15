/*
 * The bribe a bot prices before it launches, against the money the landing
 * actually offers. A worn-out observation device must still leave the bribe
 * worth flying for: the visit pays nothing, the rulers still cash the value.
 */
'use strict';

const assert = require('assert');
const Game = require('../gravity_game.js');
const Econ = require('../orbit_econ.js');
const Sim = require('../gravity_sim.js');
const World = require('../orbit_world.js');
const Tech = require('../orbit_tech.js');
const Bot = require('../gravity_bot.js');

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9,
	(message || 'value') + ': ' + actual + ' != ' + expected);

let checks = 0;
function ok(value, message) {
	checks += 1;
	assert.ok(value, message);
}

const ORIGIN = 0;
const BODY = 3;
const SPEED = 100;
const LAND_STEP = 600;

/* One scorer with one probe, so every case differs only in its market/career. */
function fixture(prone) {
	const bot = new Bot(World.WORLD_W, World.WORLD_H);
	const market = Game.createMarket();
	const career = Game.createCareer(Game.createLedger(100));
	career.at = ORIGIN;
	career.hq = ORIGIN;
	career.index = 0;
	career.market = market;
	career.ship.mass = 10;
	career.pads[ORIGIN].catapult = Tech.CATAPULTS[0];
	career.bribeProne = prone;
	bot.careerDeparture = () => ({ ok: true, cost: 0, builds: false,
		canBuildStarter: true, source: 'own', physical: true, speed: 30 });
	bot.careerSiteValue = () => 0;
	const probe = bot.probe;
	probe.predReason = Sim.END_IMPACT;
	probe.predBody = BODY;
	probe.predLength = 500;
	probe.predSteps = LAND_STEP;
	probe.predLogCount = 1;
	probe.predLogPlanet[0] = BODY;
	probe.predLogStep[0] = LAND_STEP;
	const rail = { launchEnergy: () => 0 };
	return { bot, market, career, probe, rail };
}

function score(fix, runStep) {
	return fix.bot.careerScoreProbe(fix.career, fix.rail, ORIGIN, SPEED, fix.market,
		runStep === undefined ? 0 : runStep);
}

/* give the landing planet a long-neglected value near the cap */
function age(world, planet) {
	world.market.lastVisitStep[planet] = LAND_STEP - Math.round(1800 / Sim.DT);
}

/* --- 1. the persona prices the offer, the value is the visit's own -------- */
{
	const prone = fixture(true);
	const plain = fixture(false);
	age(prone, BODY);
	age(plain, BODY);
	const value = Game.planetProfit(prone.market, BODY, LAND_STEP);
	ok(value > 1, 'the fixture value is worth a bribe: ' + value);
	const proneScore = score(prone);
	const plainScore = score(plain);
	const offer = prone.bot.careerEval.bribe;
	near(offer, Econ.bribeValue(value), 'the priced bribe is twice the landing value');
	near(offer, 2 * value, 'twice the visit value');
	ok(prone.bot.careerEval.cash > 0, 'the bribe is cash in the purse');
	near(proneScore - plainScore, offer, 'the persona is the only difference in the score');
	ok(plain.bot.careerEval.bribe === 0, 'a company that does not take bribes prices none');
}

/* --- 2. the same gates as the real button --------------------------------- */
{
	const cases = [
		['own rail', fix => { fix.career.pads[BODY].catapult = Tech.CATAPULTS[0]; }],
		['rebel planet', fix => { fix.market.rebel[BODY] = 1; }],
		['capital', fix => { fix.market.capitalPlanet = BODY; }],
		['A.R.F.', fix => { fix.market.arfPlanet = BODY; }],
		['no value yet', fix => { fix.market.lastVisitStep[BODY] = LAND_STEP; }]
	];
	for (const [name, breakIt] of cases) {
		const fix = fixture(true);
		age(fix, BODY);
		breakIt(fix);
		score(fix);
		ok(fix.bot.careerEval.bribe === 0, name + ' must not price a bribe');
	}
}

/* --- 3. a petty offer is taken only on an already rotten world ------------ */
{
	const fix = fixture(true);
	fix.market.lastVisitStep[BODY] = LAND_STEP - Math.round(100 / Sim.DT);
	const small = Game.planetProfit(fix.market, BODY, LAND_STEP);
	ok(Econ.bribeValue(small) >= Econ.BRIBE_MIN && Econ.bribeValue(small) < 2,
		'the fixture offer is petty: ' + small);
	score(fix);
	ok(fix.bot.careerEval.bribe === 0, 'a petty offer on a clean world is refused');
	const rotten = fixture(true);
	rotten.market.lastVisitStep[BODY] = LAND_STEP - Math.round(100 / Sim.DT);
	rotten.market.corruption[BODY] = Econ.CORRUPTION_BRIBE_BASE + 30;
	score(rotten);
	near(rotten.bot.careerEval.bribe, Econ.bribeValue(small), 'a rotten world pays the petty offer');
}

/* --- 4. a worn-out device pays no visit but the bribe still prices it ---- */
{
	const fix = fixture(true);
	age(fix, BODY);
	const value = Game.planetProfit(fix.market, BODY, LAND_STEP);
	/* 0.6 s of space left: the device dies long before the 60 s landing */
	Game.setShipCondition(fix.career, Game.launchWear(fix.career, SPEED) +
		Game.spaceWear(fix.career, Math.round(0.6 / Sim.DT)) + 1e-6);
	score(fix);
	ok(fix.bot.careerEval.bribe > 0, 'a dead device does not make the landing worthless');
	near(fix.bot.careerEval.bribe, 2 * value, 'the bribe cashes the unreported value');
	/* the visit itself is lost: a reporting company would have taken the pay */
	const plain = fixture(false);
	age(plain, BODY);
	Game.setShipCondition(plain.career, 1);
	score(plain);
	near(plain.bot.careerEval.cash, value, 'a reporting company takes the visit');
}

/* --- 5. the priced offer is the money the landing really offers ---------- */
{
	const prone = fixture(true);
	age(prone, BODY);
	score(prone);
	const priced = prone.bot.careerEval.bribe;
	/* the landing itself: the harvest stamps the visit, then the rulers pay */
	Game.harvestPlanet(prone.career.ledger, prone.market, BODY, LAND_STEP);
	const paid = Game.bribeAmount(prone.market, BODY, LAND_STEP);
	near(paid, priced, 'the priced bribe is the offered bribe after the visit');

	/* and the dead device: the visit is stamped away by nothing, the offer holds */
	const blind = fixture(true);
	age(blind, BODY);
	Game.setShipCondition(blind.career, Game.launchWear(blind.career, SPEED) +
		Game.spaceWear(blind.career, Math.round(0.6 / Sim.DT)) + 1e-6);
	score(blind);
	const pricedBlind = blind.bot.careerEval.bribe;
	/* the device reaches 0 before the landing: the visit must go silent */
	Game.setShipCondition(blind.career, 0);
	const gain = Game.harvestPlanet(blind.career.ledger, blind.market, BODY, LAND_STEP);
	ok(gain === 0, 'the worn-out device reported nothing');
	near(Game.bribeAmount(blind.market, BODY, LAND_STEP), pricedBlind,
		'the offer after the silent landing');
}

/* --- 6. a stored trajectory prices the same offer as a fresh trace ------- */
{
	const fix = fixture(true);
	age(fix, BODY);
	const probeScore = score(fix);
	const entry = { origin: ORIGIN, speedU: Game.speedUnits(SPEED), body: BODY,
		steps: LAND_STEP, length: 500, logPlanet: fix.probe.predLogPlanet,
		logStep: fix.probe.predLogStep, logCount: 1 };
	const stored = fix.bot.careerScoreStored(fix.career, fix.rail, fix.market, 0, entry);
	near(stored, probeScore, 'stored score');
	ok(fix.bot.careerEval.bribe > 0, 'the book keeps the bribe in the score');
}

/* --- 7. the aid table stays truthful: a human helper never prices one ---- */
{
	const fix = fixture(false);
	age(fix, BODY);
	const gain = Game.estimateProfit(fix.market, 0, fix.probe, fix.career.ledger);
	ok(gain > 0, 'the readout still shows the visit');
	ok(fix.bot.careerEval.bribe === 0 && !fix.career.bribeProne,
		'a company without the persona has no bribe to price');
}

Game.setSpaceWearScale(1);
console.log('BRIBE SCORE OK · ' + checks + ' checks');

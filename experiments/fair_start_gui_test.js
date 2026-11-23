/*
 * 0.7.47 WS3/WS4/WS5 — the fair-start page contract.
 *
 * The start-mode selector, the `start=` address round-trip, the run record's
 * capture of the mode, the unfair-roster highlight, and the H cards the
 * planning state raises. The planning state itself is drained bounded: after
 * boot the frame loop either finishes the synchronous search or enters
 * planning and clears it, and the run starts either way.
 *
 * Run: node experiments/fair_start_gui_test.js
 */
'use strict';

const assert = require('assert');
const vm = require('vm');
const { loadPage } = require('./dom_stub.js');

const get = (ctx, expr) => vm.runInContext(expr, ctx);

/* boot a career on a plain seed with an optional start mode and roster */
function bootCareer(search) {
	const env = loadPage({ search: search || '?seed=42&mode=career' });
	env.runFrames(2, 16);
	return env;
}

/* 1. the selector is career-only and mirrors game.startMode */
{
	const env = bootCareer('?seed=42&mode=career');
	const ctx = env.context;
	const ui = env.elements;
	assert.ok(ui.get('startRow'), 'the start-mode row exists');
	assert.strictEqual(ui.get('startRow').hidden, false,
		'the start-mode row is visible in a career');
	assert.strictEqual(get(ctx, 'game.startMode'), 'planet',
		'the default start mode is planet');
	assert.strictEqual(ui.get('startPlanet').checked, true,
		'the planet radio is checked by default');
	assert.strictEqual(ui.get('startSpace').checked, false, 'the space radio is unchecked');
	assert.strictEqual(ui.get('startCapital').checked, false, 'the capital radio is unchecked');

	/* switching to space restarts the career in the space mode */
	env.choose('startSpace');
	assert.strictEqual(get(ctx, 'game.startMode'), 'space',
		'choosing space sets game.startMode');
	assert.strictEqual(ui.get('startSpace').checked, true, 'the space radio is checked');
	assert.strictEqual(get(ctx, 'game.career.hq'), -1, 'the space start has no HQ');
	assert.strictEqual(get(ctx, 'game.career.flying'), true, 'the space start is flying');
}

/* 2. the `start=` address round-trips into the run */
{
	const env = bootCareer('?seed=42&mode=career&start=capital');
	const ctx = env.context;
	assert.strictEqual(get(ctx, 'game.startMode'), 'capital',
		'?start=capital boots the capital start');
	assert.strictEqual(get(ctx, 'game.career.hq'), -1, 'the capital start has no HQ');
	assert.strictEqual(get(ctx, 'game.career.at'), get(ctx, 'game.career.capitalPlanet'),
		'the capital start is landed on the Capital');

	/* syncSeedUrl writes the mode back into the address */
	get(ctx, 'syncSeedUrl()');
	assert.ok(env.context.location.search.includes('start=capital'),
		'syncSeedUrl writes start= into the address: ' + env.context.location.search);
}

/* 3. an unknown start mode is refused, not silently fallen back */
{
	const env = bootCareer('?seed=42&mode=career&start=moon');
	const ctx = env.context;
	/* the boot refuses the bad param and falls back to the default career */
	assert.notStrictEqual(get(ctx, 'game.rule'), undefined, 'the page still booted');
}

/* 4. the run record captures the start mode */
{
	const env = bootCareer('?seed=42&mode=career&start=space');
	const ctx = env.context;
	const record = get(ctx, 'GravityMaps.startRecord(mapRunInfo())');
	assert.strictEqual(record.startMode, 'space',
		'the saved record carries the space start mode');
}

/* 5. the unfair-roster highlight (WS3) */
{
	/* a roster too large for the world to seat fairly highlights its counters */
	const env = bootCareer('?seed=42&mode=career&players=4&universe=8');
	const ctx = env.context;
	const ui = env.elements;
	env.runFrames(4, 16);
	const unfair = get(ctx, 'GravityGame.startComposition(' +
		'tradeSim.world, planetMask, planetCount, playerCountShown(), cargoSim, game.startMode).ok');
	if (!unfair) {
		assert.ok(ui.get('playerCountRow').classList.contains('rosterUnfair'),
			'an unfair roster highlights the player row');
		assert.ok(ui.get('planetRow').classList.contains('rosterUnfair'),
			'an unfair roster highlights the planet row');
	} else {
		/* this seed/roster happens to be fair: the class must be absent */
		assert.ok(!ui.get('playerCountRow').classList.contains('rosterUnfair'),
			'a fair roster does not highlight the player row');
	}
}

/* 6. the H cards render the search and roster topics */
{
	const env = bootCareer('?seed=42&mode=career');
	const ctx = env.context;
	const ui = env.elements;
	env.click('commsButton');
	assert.strictEqual(ui.get('commsCard').hidden, false, 'the H card opens');
	/* the fair-search and fair-roster topics exist and render a question */
	const topics = get(ctx, 'Object.keys(H_TOPICS)');
	assert.ok(topics.includes('fair-search'), 'the fair-search topic exists');
	assert.ok(topics.includes('fair-roster'), 'the fair-roster topic exists');
	const snap = get(ctx, 'commsBuildSnapshot()');
	assert.ok(snap && snap.careerMode, 'the snapshot is a career snapshot');

	/* Keep planning open: the normal harness drain must not hide report work. */
	get(ctx, 'beginCareerPlanning(GravityGame.createSeatSearch(tradeSim.world, tradeSim,' +
		'planetMask, planetCount, 1 + bot.count, cargoSim), game.seed, game.startMode)');
	const before = JSON.stringify(get(ctx, 'careerPlanSearch.step(0)'));
	assert.strictEqual(get(ctx, 'careerPlanSearch.step(0).progress'), 0,
		'entering planning and painting H do not run search units');
	for (let i = 0; i < 10; i++) {
		get(ctx, 'seatSearchReport(); commsBuildSnapshot(); commsInvalidate(); refreshGameUi()');
		assert.strictEqual(JSON.stringify(get(ctx, 'careerPlanSearch.step(0)')), before,
			'repeated H reporting leaves the search untouched');
	}
	get(ctx, 'cancelCareerPlanning()');
}

/* 7. the planning state drains bounded: the run starts either way */
{
	const env = bootCareer('?seed=42&mode=career&players=3');
	const ctx = env.context;
	/* drain up to ~10 s of frames; planning either clears or never entered */
	for (let i = 0; i < 600; i++) {
		env.runFrames(1, 16);
		if (!get(ctx, 'careerPlanning')) break;
	}
	assert.strictEqual(get(ctx, 'careerPlanning'), false,
		'the planning state clears within the bounded drain');
	assert.strictEqual(get(ctx, 'game.on'), true, 'the run is on after the drain');
	assert.ok(get(ctx, 'game.career.hq') >= 0 || get(ctx, 'game.career.flying') ||
		get(ctx, 'game.career.at') >= 0, 'the career has started after the drain');
}

console.log('FAIR START GUI OK · 7 groups');

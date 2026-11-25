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

/* 8. A new-seed search runs in real frames and starts the career on acceptance. */
{
	const env = bootCareer('?rule=career&seed=42&players=3&universe=14&rate=1');
	const ctx = env.context;
	const ui = env.elements;
	assert.strictEqual(get(ctx, 'planetCount'), 14);
	assert.strictEqual(get(ctx, '1 + bot.count'), 3);
	/* Force only the first synchronous slice to zero; subsequent frames do real work. */
	get(ctx, `globalThis.originalSeatSearch = GravityGame.createSeatSearch;
		GravityGame.createSeatSearch = function (...args) {
			const search = originalSeatSearch(...args);
			const step = search.step;
			let first = true;
			search.step = function (ms) {
				if (first) { first = false; return step(0); }
				return step(ms);
			};
			return search;
		}`);
	get(ctx, 'startGame(123456, true, "career", game.bot, game.player, game.cheat)');
	assert.strictEqual(get(ctx, 'careerPlanning'), true);
	assert.strictEqual(get(ctx, 'game.galaxy.actors.length'), 0);
	get(ctx, 'game.career.ended = GravityGame.CAREER_BROKE; commsTick()');
	assert.strictEqual(get(ctx, 'commsState.callReason.id'), 'fair-search',
		'a previous ended career does not hide the search call');
	assert.match(ui.get('commsCallReason').textContent, /testing candidates/);
	get(ctx, `globalThis.reportingStep = careerPlanSearch.step;
		careerPlanSearch.step = ms => ms === 0 ? { ...reportingStep(0),
			best: { stats: {}, ratio: 0.4, minPay: 2, maxPay: 5, unmet: '≥ 55 %' } } : reportingStep(ms);
		commsTick()`);
	assert.strictEqual(get(ctx, 'commsState.callReason.id'), 'fair-search',
		'live progress does not dismiss the call while the clock is frozen');
	get(ctx, 'careerPlanSearch.step = reportingStep; commsOpen(); commsTick()');
	assert.match(ui.get('commsAnswer').textContent, /Preparing the map for 3 companies on 14 planets/);
	assert.match(ui.get('commsAnswer').textContent, /Search pass 1/);
	assert.doesNotMatch(ui.get('commsAnswer').textContent, /Career closed|fair set is ready/);
	for (let i = 0; i < 3000 && get(ctx, 'careerPlanning'); i++) env.runFrames(1, 16);
	assert.strictEqual(get(ctx, 'careerPlanning'), false, 'real frames finish the search');
	assert.strictEqual(get(ctx, 'game.galaxy.actors.length'), 3, 'all careers exist');
	assert.ok(get(ctx, 'game.career.hq') >= 0, 'player has an HQ');
	assert.ok(ui.get('careerShop').innerHTML.length > 0, 'shop is refreshed after async startup');
	assert.ok(get(ctx, 'careerRecording.record'), 'recording begins after the roster exists');
	const asyncSeats = JSON.stringify(get(ctx, 'game.galaxy.mapSeats'));
	get(ctx, 'GravityGame.createSeatSearch = originalSeatSearch; startGame(123456, true, "career", game.bot, game.player, game.cheat); drainCareerPlanning()');
	assert.strictEqual(JSON.stringify(get(ctx, 'game.galaxy.mapSeats')), asyncSeats,
		'the same seed seats identically on restart');
}

/* 9. Completed offers stay usable while the next pass runs, including exhaustion. */
{
	const env = bootCareer('?rule=career&seed=42&players=3&universe=14&rate=1');
	const ctx = env.context;
	get(ctx, `globalThis.mockPlan = { homes: game.galaxy.mapSeats.slice(), targetPay: 1, stats: {} };
		globalThis.mockTier = 0; globalThis.mockDone = false; globalThis.mockSteps = 0;
		globalThis.mockSearch = {
			get tier() { return mockTier; },
			step(ms) {
				if (ms > 0) { mockSteps++; mockDone = true; }
				return { done: mockDone, accepted: false, tier: mockTier, progress: mockDone ? 1 : 0,
					best: { stats: {}, ratio: 0.4, minPay: 2, maxPay: 5, unmet: '≥ 55 %' } };
			},
			bestPlan() { return mockPlan; },
			canAdvanceTier() { return mockTier < 2; },
			advanceTier() { if (!mockDone || mockTier >= 2) return false; mockTier++; mockDone = false; return true; }
		};
		globalThis.originalComposition = GravityGame.startComposition;
		GravityGame.startComposition = () => ({ ok: true });
		beginCareerPlanning(mockSearch, game.seed, game.startMode);
		stepCareerPlanning(8)`);
	assert.strictEqual(get(ctx, 'mockTier'), 1, 'next pass starts automatically');
	assert.strictEqual(get(ctx, 'careerPlanningDecision().plan'), true);
	get(ctx, 'commsOpen(); commsAsk("fair-search"); commsTick()');
	assert.match(env.elements.get('commsAnswer').textContent, /2.0–5.0 cr/);
	assert.match(env.elements.get('commsAnswer').textContent, /less than 55%/);
	assert.ok(env.elements.get('commsCtas').innerHTML.includes('fair-play-as-is'));
	assert.strictEqual(get(ctx, 'commsRunAction("fair-play-as-is")'), true,
		'a completed plan can be started while the next pass is running');
	assert.strictEqual(get(ctx, 'careerPlanning'), false);
	get(ctx, 'mockTier = 0; mockDone = false; mockSteps = 0; beginCareerPlanning(mockSearch, game.seed, game.startMode); stepCareerPlanning(8)');
	get(ctx, 'stepCareerPlanning(8); stepCareerPlanning(8)');
	assert.strictEqual(get(ctx, 'mockSteps'), 3, 'search continues while offer is open');
	assert.strictEqual(get(ctx, 'careerPlanningDecision().canAdvance'), false);
	assert.match(get(ctx, 'CommsCopy.renderTopic("fair-search", commsBuildSnapshot(), {}).text'), /Search finished/);
	get(ctx, 'playFairSearchAsIs(); GravityGame.startComposition = originalComposition');
	assert.strictEqual(get(ctx, 'careerPlanning'), false);
	assert.ok(get(ctx, 'game.career.hq') >= 0);
}

/* Acceptance after the synchronous budget starts immediately, with UI and recording. */
{
	const env = bootCareer('?rule=career&seed=42&players=3&universe=14&rate=1');
	const ctx = env.context;
	get(ctx, `globalThis.acceptedPlan = { homes: game.galaxy.mapSeats.slice(), targetPay: 1, stats: {} };
		globalThis.acceptedSearch = {
			tier: 0, step(ms) { return { done: ms > 0, accepted: ms > 0, tier: 0, progress: ms > 0 ? 1 : 0, best: null }; },
			bestPlan() { return acceptedPlan; }
		};
		beginCareerPlanning(acceptedSearch, game.seed, game.startMode); stepCareerPlanning(8)`);
	assert.strictEqual(get(ctx, 'careerPlanning'), false);
	assert.ok(get(ctx, 'game.career.hq') >= 0);
	assert.ok(env.elements.get('careerShop').innerHTML.length > 0);
	assert.ok(get(ctx, 'careerRecording.record'));
}

/* A final search with no plan still offers a fallback; a cramped roster starts automatically. */
{
	const env = bootCareer('?rule=career&seed=42&players=3&universe=14&rate=1');
	const ctx = env.context;
	get(ctx, `globalThis.noPlanSearch = {
		tier: 2,
		step(ms) { return { done: true, accepted: false, tier: 2, progress: 1, best: null }; },
		bestPlan() { return null; }, canAdvanceTier() { return false; }
	};
	globalThis.savedComposition = GravityGame.startComposition;
	GravityGame.startComposition = () => ({ ok: true });
	beginCareerPlanning(noPlanSearch, game.seed, game.startMode); stepCareerPlanning(8);
	commsOpen(); commsAsk('fair-search'); commsTick()`);
	assert.match(env.elements.get('commsAnswer').textContent, /Search finished without a fair opening/);
	assert.doesNotMatch(env.elements.get('commsAnswer').textContent, /best completed pass/);
	assert.strictEqual(get(ctx, 'commsRunAction("fair-play-as-is")'), true);
	assert.strictEqual(get(ctx, 'careerPlanning'), false);
	assert.ok(get(ctx, 'game.career.hq') >= 0);
	get(ctx, `GravityGame.startComposition = () => ({ ok: false });
		beginCareerPlanning(noPlanSearch, game.seed, game.startMode); stepCareerPlanning(8);
		GravityGame.startComposition = savedComposition`);
	assert.strictEqual(get(ctx, 'careerPlanning'), false, 'unfair composition starts the fallback');
	assert.ok(get(ctx, 'game.career.hq') >= 0);
}

/* 10. the fair-save picker loads a saved map and leaves planning behind */
{
	const env = bootCareer('?seed=42&mode=career');
	const ctx = env.context;
	get(ctx, 'beginCareerPlanning(GravityGame.createSeatSearch(tradeSim.world, tradeSim,' +
		'planetMask, planetCount, 1 + bot.count, cargoSim), game.seed, game.startMode)');
	const options = get(ctx, 'fairSaveOptions()');
	assert.ok(options.length > 0, 'the picker has at least one fair save');
	const chosen = options[0];
	get(ctx, 'loadFairSaveRecord(' + JSON.stringify(chosen.id) + ')');
	assert.strictEqual(get(ctx, 'careerPlanning'), false, 'loading a save leaves planning');
	assert.strictEqual(get(ctx, 'game.seed'), chosen.record.seed,
		'the chosen save\'s seed is the running world');
	assert.strictEqual(get(ctx, 'game.on'), true, 'the loaded save starts a run');
}

/* The roster call explains the failing checks and follows real roster edits. */
{
	const env = bootCareer('?rule=career&seed=42&players=3&universe=14&rate=1');
	const ctx = env.context;
	const ui = env.elements;
	get(ctx, `globalThis.originalRosterComposition = GravityGame.startComposition;
		GravityGame.startComposition = (world, mask, count, players) => ({
			ok: count > 15, minimal: 10, light: count > 15 ? players : 2,
			heavyEmc2: 1, heavyEmc3: count > 15 ? 1 : 0,
			missing: count > 15 ? [] : ['light', 'emc3']
		});
		commsResetVisit(null, -2); commsTick()`);
	assert.match(ui.get('commsCallReason').textContent, /missing starter-accessible planets 2\/3 · EMC-3 heavy planets 0\/1$/);
	get(ctx, 'commsOpen()');
	assert.match(ui.get('commsAnswer').textContent,
		/Missing on this map:\n✗ starter-accessible planets: 2 of 3 · 1 more needed\n✗ EMC-3 heavy planets: 0 \(at least 1\) · 1 more needed\n\nAlready met:\n✓ planets: 14 \(at least 10\)/);
	assert.match(ui.get('commsAnswer').textContent, /does not reseat existing HQs/);
	const home = get(ctx, 'game.career.hq');
	assert.strictEqual(get(ctx, 'commsRunAction("fair-more-planets")'), true);
	assert.strictEqual(get(ctx, 'planetCount'), 15);
	assert.strictEqual(get(ctx, 'game.career.hq'), home, 'adding a planet does not reseat the player');
	assert.match(ui.get('commsAnswer').textContent, /15-planet map does not meet/);
	assert.match(ui.get('commsAnswer').textContent, /✗ EMC-3 heavy planets: 0 \(at least 1\)/);
	assert.strictEqual(get(ctx, 'commsRunAction("fair-more-planets")'), true);
	assert.strictEqual(get(ctx, 'planetCount'), 16);
	assert.match(ui.get('commsAnswer').textContent, /16-planet map now meets/);
	assert.match(ui.get('commsAnswer').textContent, /not a guarantee/);
	assert.match(ui.get('commsAnswer').textContent, /Map check, all met:\n✓ planets: 16/);
	assert.doesNotMatch(ui.get('commsAnswer').textContent, /✗/);
	assert.doesNotMatch(ui.get('commsCtas').innerHTML, /fair-more-planets/);

	/* Repainting unchanged text must not destroy a browser selection. */
	for (const id of ['commsAnswer', 'commsTranscript', 'commsCallReason']) {
		const element = ui.get(id);
		let value = element.textContent;
		let writes = 0;
		Object.defineProperty(element, 'textContent', {
			get() { return value; },
			set(next) { writes++; value = next; }, configurable: true
		});
		get(ctx, 'commsPaint(); commsPaint()');
		assert.strictEqual(writes, 0, id + ' is not replaced on an unchanged paint');
	}
	get(ctx, 'GravityGame.startComposition = originalRosterComposition; startGame(12345, true, game.rule, game.bot, game.player, game.cheat)');
	assert.strictEqual(ui.get('commsCard').hidden, true, 'a new game closes the old conversation');
	assert.strictEqual(get(ctx, 'commsState.exchanges.length'), 0);
}

/* A full map cannot offer an enabled add-planet action. */
{
	const env = bootCareer('?rule=career&seed=42&players=3&universe=14&rate=1');
	const ctx = env.context;
	get(ctx, `globalThis.fullSnapshot = Object.assign({}, commsBuildSnapshot(), {
		rosterOk: false, rosterPlanets: OrbitWorld.PLANETS
	});`);
	assert.strictEqual(get(ctx, 'HH_FACTS["can-add-planet"].test(fullSnapshot)'), false);
}

console.log('FAIR START GUI OK · startup, search, radio and fallback');

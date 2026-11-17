/* Career playback records the shared world, not just one company's shots.
 * Snapshots are delta-compressed and sampled during play; no bot is re-run. */
'use strict';

const CAREER_RECORD_STEPS = Math.round(0.5 / DT);
const CAREER_RECORD_HOLD = 0.35;
const CAREER_RECORD_INTERVAL_MS = 100;
const CAREER_LINK_LIMIT = 200000;
const careerRecording = {
	record: null, previous: null, step: 0, time: 0, revision: 0, wall: 0,
	dirty: false, loading: false, movie: null, current: null, next: null, index: 0, elapsed: 0,
	finished: false, follow: -1
};
const careerActionLog = [];

function recordCareerAction(type, data) {
	if (!careerRule() || replay.on || careerRecording.loading) return;
	const entry = Object.assign({ step: game.clockSteps, slot: activeSlotIndex(), type: type }, data || {});
	careerActionLog.push(entry);
}

function careerRecordingSnapshot() {
	const snapshot = GravityMaps.runRecord(mapRunInfo());
	/* Live roster changes do not rewrite the opening's original mapSeats. */
	snapshot.seats = snapshot.state.careers.map(career => career.hq);
	snapshot.source = mode;
	snapshot.state.slotPaused = slotPaused.slice(0, slotCount());
	snapshot.state.field = {
		planets: Array.from(planetBaseStrength), ports: Array.from(portPlanetStrength)
	};
	return snapshot;
}

function careerRecordingClear() {
	if (careerRecording.loading) return;
	careerRecording.record = null;
	careerRecording.previous = null;
	careerRecording.dirty = false;
	careerActionLog.length = 0;
}

function careerRecordingReset() {
	if (careerRecording.loading || !careerRule() || !game.galaxy.mapSeats) return;
	careerActionLog.length = 0;
	const start = careerRecordingSnapshot();
	careerRecording.record = CareerReplay.create(start);
	careerRecording.previous = start;
	careerRecording.step = game.clockSteps;
	careerRecording.time = 0;
	careerRecording.revision = bot.traceRevision;
	careerRecording.wall = performance.now();
	careerRecording.dirty = false;
}

function careerRecordingMark() {
	if (careerRecording.record && !replay.on && !careerRecording.loading) careerRecording.dirty = true;
}

function careerRecordingCapture(force) {
	if (!careerRecording.record || !careerRule() || replay.on || careerRecording.loading) return;
	const elapsed = game.clockSteps - careerRecording.step;
	const wall = performance.now();
	if (!force && !careerRecording.dirty && careerRecording.revision === bot.traceRevision &&
		(elapsed < CAREER_RECORD_STEPS || wall - careerRecording.wall < CAREER_RECORD_INTERVAL_MS)) return;
	const snapshot = careerRecordingSnapshot();
	const delta = CareerReplay.difference(careerRecording.previous, snapshot);
	careerRecording.dirty = false;
	careerRecording.revision = bot.traceRevision;
	careerRecording.wall = wall;
	if (!delta) return;
	careerRecording.time += elapsed > 0 ? elapsed * DT : CAREER_RECORD_HOLD;
	careerRecording.record.frames.push({ t: careerRecording.time, d: delta });
	careerRecording.previous = snapshot;
	careerRecording.step = game.clockSteps;
}

function copyCareerReplay(followSlot, button = gameCopyBtn, label = 'copy replay') {
	const record = replay.on && replay.career ? careerRecording.movie : careerRecording.record;
	if (!record) return;
	if (!replay.on) careerRecordingCapture(true);
	const shared = followSlot === undefined ? record : Object.assign({}, record, { watch: followSlot });
	const encoded = CareerReplay.encode(shared);
	const head = GravityGame.encodeLink({
		seed: game.seed, rate: scene.trade.speed, rule: game.rule, bot: game.bot,
		player: game.player, cheat: game.cheat, gravityScale: gravityScale,
		forceScale: forceScale, spaceWearScale: spaceWearScale, harvestTick: harvestTick,
		shots: []
	});
	const url = location.href.split('#')[0] + '#' + head + '&replay=' + encoded;
	const text = url.length <= CAREER_LINK_LIMIT ? url : CareerReplay.PREFIX + encoded;
	if (text !== url) {
		careerNotice('long replay copied as text · paste it into open replay');
	}
	copyUrlText(text, button, label);
}

function copyCareerActions(button = gameCopyBtn, label = 'copy replay') {
	const payload = {
		v: 1,
		seed: game.seed,
		rule: game.rule,
		rate: scene.trade.speed,
		bot: game.bot,
		player: game.player,
		playerCount: typeof playerCountShown === 'function' ? playerCountShown() : (1 + bot.count),
		g: gravityScale,
		f: forceScale,
		w: spaceWearScale,
		h: harvestTick,
		steps: game.clockSteps,
		actions: careerActionLog.slice()
	};
	if (game.cheat) payload.cheat = game.cheat;
	const text = CareerActions.encode(payload);
	copyUrlText(text, button, label);
}

function startCareerActionsReplay(data) {
	if (!data || !Number.isFinite(data.seed)) return false;
	if (typeof data.g === 'number') gravityScale = data.g;
	if (typeof data.f === 'number') forceScale = data.f;
	if (typeof data.w === 'number') spaceWearScale = data.w;
	if (typeof data.h === 'number') harvestTick = data.h;
	const rule = data.rule || 'career';
	const rate = Number.isFinite(data.rate) ? data.rate : scene.trade.speed;
	const botDiff = data.bot || game.bot;
	const player = data.player || game.player;
	const cheat = data.cheat || '';
	startGame(data.seed, rate, rule, botDiff, player, cheat);
	if (typeof data.playerCount === 'number' && typeof setPlayerCount === 'function') {
		while (playerCountShown() < data.playerCount) setPlayerCount(1);
		while (playerCountShown() > data.playerCount) setPlayerCount(-1);
	}
	careerActionLog.length = 0;
	for (let i = 0; i < data.actions.length; i++) {
		careerActionLog.push(data.actions[i]);
	}
	careerNotice('actions loaded · ' + data.actions.length + ' player actions from seed ' + data.seed);
	return true;
}

function careerReplayRoster(snapshot) {
	const state = snapshot.state;
	const mask = state.mask;
	let changed = false;
	let count = 0;
	for (let i = 0; i < PLANETS; i++) {
		const next = mask[i] === '1' ? 1 : 0;
		if (planetMask[i] !== next) changed = true;
		planetMask[i] = next;
		count += next;
	}
	if (changed) {
		planetCount = count;
		game.planetUniverse = count;
		applyPlanetUniverse();
	}
	const wanted = state.careers.length - 1;
	if (activeSlot > wanted) selectSlot(0);
	while (bot.count > wanted) bot.removeCareerRival();
	while (bot.count < wanted) {
		const saved = state.careers[bot.count + 1];
		bot.addCareerRival(game.galaxy, tradeSim, saved.hq, state.clock.clockSteps);
	}
	game.playerCount = wanted + 1;
	ensureValidActiveSlot(-1);
}

function restoreCareerReplayField(field) {
	let changed = false;
	for (let i = 0; i < PLANETS; i++) {
		if (planetBaseStrength[i] !== field.planets[i] || portPlanetStrength[i] !== field.ports[i]) {
			changed = true;
			break;
		}
	}
	if (!changed) return;
	planetBaseStrength.set(field.planets);
	portPlanetStrength.set(field.ports);
	syncPlanetStrengths();
	applyMode();
}

function applyCareerReplaySnapshot(snapshot) {
	careerReplayRoster(snapshot);
	if (snapshot.source !== mode) setSource(snapshot.source);
	if (snapshot.gs !== gravityScale || snapshot.fs !== forceScale ||
		snapshot.ws !== spaceWearScale || snapshot.ht !== harvestTick) {
		setExperimentScales(snapshot.gs, snapshot.fs, snapshot.ht, snapshot.ws);
	}
	if (!GravityMaps.applyState(mapRunInfo(), snapshot)) throw new Error('invalid career state');
	restoreCareerReplayField(snapshot.state.field);
	game.bot = snapshot.bot;
	game.player = slotTypes[0];
	bot.level = snapshot.bot;
	bot.setPlayerType(slotTypes[0]);
	for (let i = 0; i < bot.count; i++) bot.rivalTypes[i] = slotTypes[i + 1];
	careerPaused = snapshot.state.clock.paused === true;
	for (let i = 0; i < slotCount(); i++) {
		slotPaused[i] = Boolean(snapshot.state.slotPaused && snapshot.state.slotPaused[i]);
	}
	if (scene.setFrozen) scene.setFrozen(careerPaused);
	refreshPlanetUniverseUi();
	if (careerRecording.follow >= 0 && careerRecording.follow < slotCount()) {
		const slot = careerRecording.follow;
		careerRecording.follow = -1;
		selectSlot(slot);
	}
	refreshGameUi();
	hudAt = -Infinity;
}

function stopCareerReplay() {
	careerRecording.movie = null;
	careerRecording.current = null;
	careerRecording.next = null;
	careerRecording.index = 0;
	careerRecording.elapsed = 0;
	careerRecording.finished = false;
	careerRecording.follow = -1;
}

function startCareerReplay(record, verified = false) {
	if (!record || (!verified && !CareerReplay.valid(record))) return false;
	careerRecording.loading = true;
	let started = false;
	try {
		const initial = CareerReplay.copy(record.start);
		if (!startMapRecord(initial)) return false;
		careerRecording.movie = record;
		careerRecording.current = initial;
		careerRecording.index = 0;
		careerRecording.elapsed = 0;
		careerRecording.finished = record.frames.length === 0;
		replay.on = true;
		replay.career = true;
		replay.route = false;
		replay.speed = REPLAY_DEFAULT;
		replay.verdict = '';
		for (const aim of slotAim) aim.armed = false;
		armed = false;
		selectSlot(0);
		careerRecording.follow = record.watch === undefined ? 0 : record.watch;
		applyCareerReplaySnapshot(initial);
		prepareNextCareerFrame();
		started = true;
		return true;
	} catch (error) {
		stopCareerReplay();
		replay.on = false;
		replay.career = false;
		return false;
	} finally {
		careerRecording.loading = false;
		if (!started) careerRecordingClear();
	}
}

function prepareNextCareerFrame() {
	const movie = careerRecording.movie;
	if (!movie || careerRecording.index >= movie.frames.length) {
		careerRecording.next = null;
		return;
	}
	careerRecording.next = CareerReplay.apply(CareerReplay.copy(careerRecording.current),
		movie.frames[careerRecording.index].d);
}

/* Between samples interpolate only the same continuous flight, never across
 * a landing or a new launch. The authoritative state remains the recorded one. */
function interpolateCareerShips() {
	const movie = careerRecording.movie;
	const next = careerRecording.next;
	if (!movie || !next) return;
	const index = careerRecording.index;
	const fromTime = index > 0 ? movie.frames[index - 1].t : 0;
	const toTime = movie.frames[index].t;
	const ratio = toTime > fromTime
		? Math.max(0, Math.min(1, (careerRecording.elapsed - fromTime) / (toTime - fromTime))) : 1;
	const before = careerRecording.current.state;
	const after = next.state;
	for (let slot = 0; slot < before.ships.length && slot < after.ships.length; slot++) {
		const a = before.ships[slot];
		const b = after.ships[slot];
		const shotsA = slot === 0 ? before.run.shots : before.rivals[slot - 1].shots;
		const shotsB = slot === 0 ? after.run.shots : after.rivals[slot - 1].shots;
		if (a.status !== STATUS_FLYING || b.status !== STATUS_FLYING ||
			!shotsA || !shotsB || shotsA.length !== shotsB.length || b.liveSteps <= a.liveSteps) continue;
		const cargo = slotSim(slot).cargo;
		cargo.x = a.cargo.x + (b.cargo.x - a.cargo.x) * ratio;
		cargo.y = a.cargo.y + (b.cargo.y - a.cargo.y) * ratio;
		cargo.vx = a.cargo.vx + (b.cargo.vx - a.cargo.vx) * ratio;
		cargo.vy = a.cargo.vy + (b.cargo.vy - a.cargo.vy) * ratio;
	}
}

function advanceCareerReplay(dt, skip) {
	const movie = careerRecording.movie;
	if (!movie || careerRecording.finished) return;
	careerRecording.elapsed = skip ? Infinity : careerRecording.elapsed +
		dt * Math.min(PLAY_MAX, playScale() * REPLAY_SPEEDS[replay.speed]);
	let changed = false;
	try {
		while (careerRecording.index < movie.frames.length &&
			movie.frames[careerRecording.index].t <= careerRecording.elapsed) {
			const frame = movie.frames[careerRecording.index++];
			careerRecording.current = CareerReplay.apply(careerRecording.current, frame.d);
			changed = true;
		}
		if (changed) {
			applyCareerReplaySnapshot(careerRecording.current);
			prepareNextCareerFrame();
		}
		if (careerRecording.index >= movie.frames.length) {
			careerRecording.finished = true;
			refreshGameUi();
		} else interpolateCareerShips();
	} catch (error) {
		careerRecording.finished = true;
		replay.verdict = 'invalid career replay';
		refreshGameUi();
	}
}

const replayAgainButton = $('replayAgain');
if (replayAgainButton) replayAgainButton.addEventListener('click', () => {
	const movie = careerRecording.movie;
	if (movie) startCareerReplay(movie, true);
});

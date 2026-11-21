/* Compact input replay and the optional sampled world save. */
'use strict';

const CAREER_RECORD_STEPS = Math.round(0.5 / DT);
const CAREER_RECORD_HOLD = 0.35;
const CAREER_RECORD_INTERVAL_MS = 100;
const CAREER_LINK_LIMIT = 200000;
const careerRecording = {
	record: null, previous: null, step: 0, time: 0, revision: 0, wall: 0, restored: false,
	dirty: false, loading: false, movie: null, current: null, next: null, index: 0, elapsed: 0,
	finished: false, follow: -1
};
const careerHistory = [];
const careerActionReplay = {
	active: false, applying: false, pending: [], index: 0, skipped: 0,
	endStep: 0, watch: 0, halted: false, expected: []
};

function careerInputLocked() {
	return careerActionReplay.active && !careerActionReplay.applying;
}

function recordsCareerHistory() {
	return careerRecording.record && careerRule() && !replay.on && !careerRecording.loading;
}

function recordCareerAction(type, data, slot = activeSlotIndex()) {
	if (!recordsCareerHistory() || careerActionReplay.active) return;
	careerHistory.push({ step: game.clockSteps, slot: slot, type: type, ...data });
}

/* The HUD still uses its recent bot trace. Keep the sparse events separately
 * for export so neither the HUD limit nor a controller switch drops history. */
function recordCareerTrace(index, decision, detail, step, move) {
	if (!recordsCareerHistory()) return;
	const slot = index === GravityBot.PLAYER_INDEX ? 0 : index + 1;
	const event = [step, slot, decision, detail];
	if (move) event.push(...move);
	careerHistory.push(event);
}

function careerActionReplayReset() {
	careerActionReplay.active = false;
	careerActionReplay.applying = false;
	careerActionReplay.halted = false;
	careerActionReplay.pending = [];
	careerActionReplay.expected = [];
	careerActionReplay.index = 0;
	careerActionReplay.skipped = 0;
}

function careerRecordingSnapshot() {
	const snapshot = GravityMaps.runRecord(mapRunInfo());
	/* Live roster changes do not rewrite the opening's original mapSeats. */
	snapshot.seats = snapshot.state.careers.map(career => career.hq);
	snapshot.source = mode;
	snapshot.rate = scene.trade.speed;
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
	careerHistory.length = 0;
	careerActionReplayReset();
}

function careerRecordingReset(restored = false) {
	if (careerRecording.loading || !careerRule() || !game.galaxy.mapSeats) return;
	careerHistory.length = 0;
	careerRecording.restored = restored;
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

function copyCareerReplay() {
	const record = replay.on && replay.career ? careerRecording.movie : careerRecording.record;
	if (!record) return;
	if (!replay.on) careerRecordingCapture(true);
	const shared = replay.on ? record : { ...record, watch: activeSlotIndex() };
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
	copyUrlText(text, careerSaveCopyBtn, 'copy full save');
}

function careerOpening(start) {
	return {
		seed: start.seed, rate: start.rate, bot: start.bot,
		players: start.state.run.slots.slice(0, start.seats.length),
		mask: start.state.mask, seats: start.seats, targetPay: start.targetPay,
		g: start.gs, f: start.fs, w: start.ws, h: start.ht,
		source: start.source, corruption: start.state.market.permanentCorruption,
		...(Array.isArray(start.gravity) ? { gravity: start.gravity } : {}),
		...(start.cheat ? { cheat: start.cheat } : {})
	};
}

function careerEventsFor(slot) {
	return careerHistory.filter(entry => Array.isArray(entry) && entry[1] === slot)
		.sort((a, b) => a[0] - b[0]);
}

function copyCareerActions() {
	if (!recordsCareerHistory() || careerActionReplay.active) return;
	if (careerWaitBusy()) { careerNotice('wait for the current fast-forward to finish before copying'); return; }
	if (careerRecording.restored) {
		careerNotice('the opening history is unavailable for a restored run · use full save');
		return;
	}
	const watch = activeSlotIndex();
	const payload = {
		v: CareerActions.FORMAT, ...careerOpening(careerRecording.record.start),
		steps: game.clockSteps, watch: watch,
		actions: careerHistory.filter(entry => !Array.isArray(entry)),
		events: careerEventsFor(watch)
	};
	copyUrlText(CareerActions.encode(payload), gameCopyBtn, 'copy career replay');
}

const CAREER_MOVES = new Set(['fire', 'burn', 'land']);

function validCareerActions(data) {
	if (!data || data.v !== CareerActions.FORMAT || !Number.isInteger(data.seed) || data.seed < 1 || data.seed > 0xffffffff ||
		!Number.isSafeInteger(data.steps) || data.steps < 0 ||
		!Number.isFinite(data.rate) || data.rate < 0.5 || data.rate > 12 ||
		!Number.isFinite(data.g) || data.g < 0 || data.g > 9 ||
		!Number.isFinite(data.f) || data.f < 0.25 || data.f > 3 ||
		!Number.isFinite(data.w) || data.w < 0 || data.w > 3 || typeof data.h !== 'boolean' ||
		!Object.hasOwn(GravityGame.BOTS, data.bot) ||
		(data.cheat !== undefined && !Object.hasOwn(GravityGame.CHEATS, data.cheat)) ||
		(data.source !== MODE_PLANETS && data.source !== MODE_PORTS) || typeof data.corruption !== 'boolean' ||
		typeof data.mask !== 'string' || !/^[01]+$/.test(data.mask) || data.mask.length !== PLANETS ||
		!Array.isArray(data.players) || data.players.length < 1 || data.players.length > MAX_PLAYERS ||
		!data.players.every(p => Object.hasOwn(GravityGame.PLAYER_TYPES, p)) ||
		!Array.isArray(data.seats) || data.seats.length !== data.players.length ||
		new Set(data.seats).size !== data.seats.length ||
		!data.seats.every(p => Number.isInteger(p) && p >= 0 && p < PLANETS && data.mask[p] === '1') ||
		!Number.isFinite(data.targetPay) || !Number.isInteger(data.watch) || data.watch < 0 || data.watch >= MAX_PLAYERS ||
		!Array.isArray(data.actions) || !Array.isArray(data.events)) return false;
	const universe = data.mask.split('1').length - 1;
	if (universe < PLANET_UNIVERSE_MIN || universe > PLANET_UNIVERSE_MAX) return false;
	if (data.gravity !== undefined) {
		if (!Array.isArray(data.gravity) || data.gravity.length !== universe) return false;
		for (let i = 0; i < data.gravity.length; i++) {
			const g = data.gravity[i];
			if (!Number.isFinite(g) || g < PlanetGravity.MIN || g > PlanetGravity.MAX) return false;
		}
	}
	let last = 0;
	for (const entry of data.actions) {
		if (!entry || !Number.isInteger(entry.step) || entry.step < last || entry.step > data.steps ||
			!Number.isInteger(entry.slot) || entry.slot < 0 || entry.slot >= MAX_PLAYERS ||
			typeof entry.type !== 'string') return false;
		last = entry.step;
	}
	last = 0;
	for (const event of data.events) {
		if (!Array.isArray(event) || !Number.isInteger(event[0]) || event[0] < last || event[0] > data.steps ||
			event[1] !== data.watch || typeof event[2] !== 'string' || typeof event[3] !== 'string' ||
			event.length !== (CAREER_MOVES.has(event[2]) ? 7 : 4) ||
			!event.slice(4).every(Number.isFinite)) return false;
		last = event[0];
	}
	return true;
}

function startCareerActionsReplay(data) {
	if (!validCareerActions(data)) return false;
	const universe = data.mask.split('1').length - 1;
	careerActionReplayReset();
	GravityMaps.applyField(data);
	activeFieldMap = fieldParamKey(data);
	GravityMaps.arm({ seed: data.seed, seats: data.seats, universe: universe,
		gs: data.g, fs: data.f, targetPay: data.targetPay,
		...(Array.isArray(data.gravity) ? { gravity: data.gravity } : {}),
		state: { mask: data.mask } });
	game.planetUniverse = universe;
	game.playerCount = data.players.length;
	for (let i = 0; i < MAX_PLAYERS; i++) slotTypes[i] = data.players[i] || PLAYER_BOT;
	$('permanentCorruption').checked = data.corruption;
	setExperimentScales(data.g, data.f, data.h, data.w);
	scene.setSpeed(data.rate);
	setSource(data.source, false);
	startGame(data.seed, true, RULE_CAREER, data.bot, data.players[0], data.cheat);
	careerActionReplay.active = true;
	careerActionReplay.pending = data.actions;
	careerActionReplay.endStep = data.steps;
	careerActionReplay.watch = data.watch;
	careerActionReplay.expected = data.events;
	if (data.watch < slotCount()) selectSlot(data.watch);
	slotPaused.fill(false);
	syncCareerPause();
	refreshGameUi();
	careerNotice('replaying career from seed ' + data.seed + ' to step ' + data.steps);
	return true;
}

/* Inputs are attempted at their recorded steps; a launch or burn that no
 * longer matches the world is skipped rather than forced. */

function applyCareerLaunch(entry) {
	const slot = entry.slot;
	if (slotIsBot(slot) || turret.pending || careerWaitBusy()) return false;
	const career = playerCareer();
	if (!career || career.ended !== GravityGame.CAREER_OPEN || career.at !== entry.origin ||
		!Number.isFinite(entry.angle) || !Number.isFinite(entry.speed)) return false;
	if (!GravityGame.careerCanFire(career, activeCareerSim(), entry.origin, entry.speed)) return false;
	aimBody = entry.origin;
	aimAngle = entry.angle;
	aimSpeed = entry.speed;
	armed = true;
	queueTurretShot();
	return true;
}

function applyCareerBurn(entry) {
	const slot = entry.slot;
	const sim = activeSim();
	const career = playerCareer();
	if (slotIsBot(slot) || sim.status !== STATUS_FLYING || sim.liveSteps !== entry.live ||
		!Number.isInteger(entry.angleU) || !Number.isInteger(entry.dvU)) return false;
	const angle = GravityGame.angleOf(entry.angleU);
	const dv = GravityGame.speedOf(entry.dvU);
	if (!(dv > 0)) return false;
	if (!GravityGame.careerBurn(career, sim, angle, dv)) return false;
	bot.traceCareerBurn(career, sim, angle, dv, game.clockSteps);
	const shots = slotShots(slot);
	if (shots.length > 0) shots[shots.length - 1].burns.push(GravityGame.createBurn(entry.live, entry.angleU, entry.dvU));
	return true;
}

function applyCareerAct(data) {
	if (data.act === 'sciAccept') {
		/* drive the real research button through the recorded family/params:
		 * the notice, turret cancel and careerChanged all stay honest */
		const career = playerCareer();
		if (!career || career.ended !== GravityGame.CAREER_OPEN) return false;
		if (!Object.hasOwn(SCIENCE_AXES, data.family) || !Array.isArray(data.params) ||
			data.params.length !== SCIENCE_AXES[data.family].length || !data.params.every(Number.isFinite)) return false;
		scienceFamily = data.family;
		for (let i = 0; i < data.params.length; i++) {
			scienceValues[data.family][SCIENCE_AXES[data.family][i].key] = data.params[i];
		}
		return careerResearch();
	}
	if (data.act === 'evac' && (!Number.isSafeInteger(data.steps) || data.steps < 1)) return false;
	return careerAct({ ...data, slot: data.targetSlot });
}

function applyCareerCommercial(entry) {
	const career = playerCareer();
	if (!career || career.ended !== GravityGame.CAREER_OPEN || career.at < 0) return false;
	const want = Boolean(entry.on);
	if ((career.commercialPlanet === career.at) === want) return true;
	/* never go through the armed-launch branch of the toggle: a recorded rail
	 * switch is not a launch */
	GravityGame.setCommercial(career, want ? career.at : -1);
	careerChanged();
	return true;
}

function applyCareerAction(entry) {
	if (entry.slot >= slotCount()) return false;
	if (entry.type !== 'controller' && entry.type !== 'cancelLaunch' && entry.slot !== activeSlotIndex()) selectSlot(entry.slot);
	if (entry.type === 'launch') return applyCareerLaunch(entry);
	if (entry.type === 'fireQueued') return tickTurret();
	if (entry.type === 'burn') return applyCareerBurn(entry);
	if (entry.type === 'refuel') return flightRefuel();
	if (entry.type === 'cancelLaunch') { cancelTurret(slotTurrets[entry.slot]); return true; }
	if (entry.type === 'act') return applyCareerAct(entry);
	if (entry.type === 'bookTrace') return applyCareerBookTrace(entry.trace);
	if (entry.type === 'commercial') return applyCareerCommercial(entry);
	if (entry.type === 'controller') {
		if (!Object.hasOwn(GravityGame.PLAYER_TYPES, entry.player)) return false;
		setSlotType(entry.slot, entry.player);
		return true;
	}
	if (entry.type === 'gravity') {
		if (!Number.isInteger(entry.body) || !Number.isFinite(entry.value)) return false;
		return setBodyStrength(entry.body, entry.value);
	}
	if (entry.type === 'universe') {
		if (typeof entry.mask !== 'string' || entry.mask.length !== PLANETS || !/^[01]+$/.test(entry.mask)) return false;
		let count = 0;
		for (let i = 0; i < PLANETS; i++) {
			if (planetMask[i] && entry.mask[i] === '0') clearPlanetPads(i);
			planetMask[i] = entry.mask[i] === '1' ? 1 : 0;
			count += planetMask[i];
		}
		planetCount = game.planetUniverse = count;
		applyPlanetUniverse();
		return true;
	}
	if (entry.type === 'difficulty') {
		if (!Object.hasOwn(GravityGame.BOTS, entry.bot) || entry.bot === BOT_OFF) return false;
		setBot(entry.bot); return true;
	}
	if (entry.type === 'scales') { setExperimentScales(entry.g, entry.f, entry.h, entry.w); return true; }
	if (entry.type === 'source') {
		if (entry.mode !== MODE_PLANETS && entry.mode !== MODE_PORTS) return false;
		setSource(entry.mode);
		return true;
	}
	if (entry.type === 'playerCount') {
		if (entry.delta === -1) return setPlayerCount(-1);
		if (entry.delta === 1 && Number.isInteger(entry.planet)) return setPlayerCount(1, entry.planet);
	}
	return false;
}

/* A step is settled (including landings) before any external inputs at it. */
function applyCareerActionsDue() {
	const playback = careerActionReplay;
	if (!playback.active || playback.applying) return;
	const selected = activeSlotIndex();
	let applied = false;
	while (playback.index < playback.pending.length) {
		const entry = playback.pending[playback.index];
		if (entry.step > game.clockSteps) break;
		playback.index += 1;
		applied = true;
		careerHistory.push(entry);
		playback.applying = true;
		try {
			if (entry.step !== game.clockSteps || !applyCareerAction(entry)) playback.skipped += 1;
		} catch (error) {
			playback.skipped += 1;
		} finally {
			playback.applying = false;
		}
	}
	if (applied && selected !== activeSlotIndex() && selected < slotCount()) selectSlot(selected);
	if (game.clockSteps >= playback.endStep && !careerWaitBusy()) finishCareerActionsReplay();
}

function finishCareerActionsReplay() {
	const playback = careerActionReplay;
	const actual = careerEventsFor(playback.watch);
	const expected = playback.expected;
	let i = 0;
	while (i < actual.length && i < expected.length && JSON.stringify(actual[i]) === JSON.stringify(expected[i])) i++;
	const same = i === actual.length && i === expected.length;
	const step = Math.min(actual[i]?.[0] ?? Infinity, expected[i]?.[0] ?? Infinity);
	const name = slotName(playback.watch);
	playback.active = false;
	playback.halted = true;
	playback.pending = [];
	playback.expected = [];
	if (playback.watch < slotCount()) selectSlot(playback.watch);
	syncCareerPause();
	refreshGameUi();
	const reached = game.clockSteps === playback.endStep;
	const result = !reached ? 'world stopped before step ' + playback.endStep
		: !same ? 'history differs at step ' + step
		: playback.skipped ? 'could not reproduce all inputs' : 'history matches (' + actual.length + ' events)';
	careerNotice('career replay · step ' + game.clockSteps + ' · ' + name + ' ' + result +
		(playback.skipped ? ' · ' + playback.skipped + ' inputs skipped' : ''));
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

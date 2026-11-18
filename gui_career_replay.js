/* Career playback records the shared world, not just one company's shots.
 * Snapshots are delta-compressed and sampled during play; no bot is re-run.
 *
 * The compact GRAVITY_ACTIONS record contains the opening and timed inputs;
 * bots are simulated again, rather than saved as world snapshots. */
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
const careerFlights = [];

function recordCareerFlight(slot, step, origin, angle, speed) {
	if (!careerRule() || replay.on || careerRecording.loading) return;
	careerFlights.push({ slot: slot, step: step, origin: origin, angle: angle, speed: speed });
}
/* the action replay in flight: the recorded inputs, applied at their steps */
const careerActionReplay = {
	active: false, applying: false, pending: [], index: 0, applied: 0, skipped: 0, endStep: 0, watch: 0, halted: false, expected: []
};

function recordCareerAction(type, data) {
	if (!careerRule() || replay.on || careerRecording.loading || careerActionReplay.applying) return;
	const entry = Object.assign({ step: game.clockSteps, slot: activeSlotIndex(), type: type }, data || {});
	careerActionLog.push(entry);
}

/* drops any queued action replay; called whenever a run (re)starts */
function careerActionReplayReset(actions, endStep = 0) {
	careerActionReplay.pending = Array.isArray(actions) ? actions.slice() : [];
	careerActionReplay.index = 0;
	careerActionReplay.applied = 0;
	careerActionReplay.skipped = 0;
	careerActionReplay.endStep = endStep;
	careerActionReplay.halted = false;
	careerActionReplay.active = endStep > 0 || careerActionReplay.pending.length > 0;
	careerActionReplay.applying = false;
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
	careerFlights.length = 0;
	careerActionReplayReset([]);
}

function careerRecordingReset() {
	if (careerRecording.loading || !careerRule() || !game.galaxy.mapSeats) return;
	careerActionLog.length = 0;
	careerFlights.length = 0;
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

function copyCareerActions(button = gameCopyBtn, label = 'copy career replay') {
	const start = careerRecording.record && careerRecording.record.start;
	if (!start || replay.on || careerActionReplay.active) return;
	if (careerWaitBusy()) { careerNotice('wait for the current fast-forward to finish before copying'); return; }
	const payload = {
		v: 2, seed: start.seed, rule: 'career', rate: start.rate,
		bot: start.bot, player: start.player, playerCount: start.seats.length,
		players: start.state.run.slots.slice(0, start.seats.length),
		universe: start.universe, mask: start.state.mask, seats: start.seats, targetPay: start.targetPay,
		g: start.gs, f: start.fs, w: start.ws, h: start.ht,
		source: start.source, corruption: start.state.market.permanentCorruption,
		steps: game.clockSteps, watch: activeSlotIndex(), actions: careerActionLog.slice(),
		flights: careerFlights.filter(flight => flight.slot === activeSlotIndex())
	};
	if (start.cheat) payload.cheat = start.cheat;
	if (start.state.clock.clockSteps !== 0) {
		careerNotice('compact replay unavailable for a restored run · use full save');
		return;
	}
	copyUrlText(CareerActions.encode(payload), button, label);
}

function startCareerActionsReplay(data) {
	if (!data || data.v !== 2 || !Number.isInteger(data.seed) || data.seed < 1 || data.seed > 0xffffffff ||
		data.rule !== 'career' || !Number.isInteger(data.steps) || data.steps < 0 ||
		!Number.isInteger(data.playerCount) || data.playerCount < 1 || data.playerCount > MAX_PLAYERS ||
		!Number.isInteger(data.universe) || data.universe < PLANET_UNIVERSE_MIN || data.universe > PLANET_UNIVERSE_MAX ||
		!Number.isFinite(data.rate) || data.rate < 0.5 || data.rate > 12 ||
		!Number.isFinite(data.g) || data.g < 0 || data.g > 9 ||
		!Number.isFinite(data.f) || data.f < 0.25 || data.f > 3 ||
		!Number.isFinite(data.w) || data.w < 0 || data.w > 3 || typeof data.h !== 'boolean' ||
		!Object.prototype.hasOwnProperty.call(GravityGame.BOTS, data.bot) ||
		(data.cheat && !Object.prototype.hasOwnProperty.call(GravityGame.CHEATS, data.cheat)) ||
		(data.source !== MODE_PLANETS && data.source !== MODE_PORTS) ||
		typeof data.mask !== 'string' || !/^[01]+$/.test(data.mask) || data.mask.length !== PLANETS ||
		data.mask.split('1').length - 1 !== data.universe ||
		!Array.isArray(data.seats) || data.seats.length !== data.playerCount ||
		new Set(data.seats).size !== data.seats.length ||
		!data.seats.every(p => Number.isInteger(p) && p >= 0 && p < PLANETS && data.mask[p] === '1') ||
		!Number.isFinite(data.targetPay) || !Number.isInteger(data.watch) || data.watch < 0 || data.watch >= MAX_PLAYERS ||
		!Array.isArray(data.flights) || !Array.isArray(data.players) || data.players.length !== data.playerCount ||
		!data.players.every(p => GravityGame.PLAYER_TYPES[p]) ||
		!Array.isArray(data.actions)) return false;
	let last = 0;
	for (const entry of data.actions) {
		if (!entry || !Number.isInteger(entry.step) || entry.step < last || entry.step > data.steps ||
			!Number.isInteger(entry.slot) || entry.slot < 0 || entry.slot >= MAX_PLAYERS ||
			typeof entry.type !== 'string') return false;
		last = entry.step;
	}
	GravityMaps.disarm();
	if (Array.isArray(data.seats) && data.seats.length === data.playerCount &&
		typeof data.mask === 'string' && /^[01]+$/.test(data.mask) && data.mask.length === PLANETS) {
		GravityMaps.arm({ seed: data.seed, seats: data.seats, universe: data.universe,
			gs: data.g, fs: data.f, targetPay: data.targetPay, state: { mask: data.mask } });
	}
	game.planetUniverse = data.universe;
	game.playerCount = data.playerCount;
	for (let i = 0; i < MAX_PLAYERS; i++) slotTypes[i] = data.players[i] || PLAYER_BOT;
	$('permanentCorruption').checked = Boolean(data.corruption);
	setExperimentScales(data.g, data.f, data.h, data.w);
	scene.setSpeed(data.rate);
	if (data.source === MODE_PLANETS || data.source === MODE_PORTS) setSource(data.source);
	startGame(data.seed, true, 'career', data.bot, data.players[0], data.cheat);
	careerActionLog.push(...data.actions);
	careerActionReplayReset(data.actions, data.steps);
	careerActionReplay.active = true;
	careerActionReplay.watch = Number.isInteger(data.watch) ? data.watch : 0;
	careerActionReplay.expected = Array.isArray(data.flights) ? data.flights : [];
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
	if (slot >= slotCount() || slotIsBot(slot)) return false;
	if (activeSlotIndex() !== slot) selectSlot(slot);
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
	const slot = Number.isInteger(entry.slot) ? entry.slot : 0;
	if (slot !== activeSlotIndex()) selectSlot(slot);
	const sim = activeSim();
	const career = playerCareer();
	if (sim.status !== STATUS_FLYING) return false;
	const angle = GravityGame.angleOf(entry.angleU);
	const dv = GravityGame.speedOf(entry.dvU);
	if (!(dv > 0)) return false;
	const live = Number.isFinite(entry.live) ? entry.live : sim.liveSteps;
	if (!GravityGame.careerBurn(career, sim, angle, dv)) return false;
	const shots = slotShots(slot);
	if (shots.length > 0) shots[shots.length - 1].burns.push(GravityGame.createBurn(live, entry.angleU, entry.dvU));
	return true;
}

function applyCareerAct(data) {
	if (!data || typeof data !== 'object') return false;
	if (data.act === 'sciAccept') {
		/* drive the real research button through the recorded family/params:
		 * the notice, turret cancel and careerChanged all stay honest */
		const career = playerCareer();
		if (!career || career.ended !== GravityGame.CAREER_OPEN) return false;
		if (typeof data.family !== 'string' || !SCIENCE_AXES[data.family]) return false;
		scienceFamily = data.family;
		if (!Array.isArray(data.params) || data.params.length !== SCIENCE_AXES[data.family].length) return false;
		for (let i = 0; i < data.params.length; i++) {
			if (!Number.isFinite(data.params[i])) return false;
			scienceValues[data.family][SCIENCE_AXES[data.family][i].key] = data.params[i];
		}
		careerResearch();
		return true;
	}
	const action = Object.assign({}, data);
	if (data.targetSlot !== undefined) action.slot = data.targetSlot;
	careerAct(action);
	return true;
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
	if (!entry || typeof entry !== 'object') return false;
	if (entry.type === 'launch') return applyCareerLaunch(entry);
	if (entry.type === 'burn') return applyCareerBurn(entry);
	if (entry.type === 'refuel') {
		if (entry.slot >= slotCount()) return false;
		if (entry.slot !== activeSlotIndex()) selectSlot(entry.slot);
		return flightRefuel();
	}
	if (entry.type === 'cancelLaunch') {
		if (entry.slot >= slotCount()) return false;
		cancelTurret(slotTurrets[entry.slot]);
		return true;
	}
	if (entry.type === 'act') {
		const slot = Number.isInteger(entry.slot) ? entry.slot : 0;
		if (slot !== activeSlotIndex()) selectSlot(slot);
		return applyCareerAct(entry);
	}
	if (entry.type === 'commercial') {
		if (entry.slot >= slotCount()) return false;
		if (entry.slot !== activeSlotIndex()) selectSlot(entry.slot);
		return applyCareerCommercial(entry);
	}
	if (entry.type === 'controller') {
		if (entry.slot >= slotCount() || !GravityGame.PLAYER_TYPES[entry.player]) return false;
		setSlotType(entry.slot, entry.player);
		slotPaused.fill(false);
		syncCareerPause();
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
		if (!GravityGame.BOTS[entry.bot] || entry.bot === BOT_OFF) return false;
		setBot(entry.bot); return true;
	}
	if (entry.type === 'scales') { setExperimentScales(entry.g, entry.f, entry.h, entry.w); return true; }
	if (entry.type === 'source') {
		if (entry.mode !== MODE_PLANETS && entry.mode !== MODE_PORTS) return false;
		setSource(entry.mode);
		return true;
	}
	if (entry.type === 'playerCount') {
		const delta = Number(entry.delta);
		if (!Number.isFinite(delta) || delta === 0) return false;
		setPlayerCount(delta);
		return true;
	}
	return false;
}

/* applies everything due at the current game step, in recorded order; a
 * recorded input never moves the world backwards, it just plays out.
 * Returns how many launches were applied, so the caller can hold the clock
 * at the step exactly like the EMC barrel does when its shot fires */
function applyCareerActionsDue() {
	if (!careerActionReplay.active || careerActionReplay.applying || replay.on || careerWaitBusy()) return 0;
	let launches = 0;
	while (careerActionReplay.index < careerActionReplay.pending.length) {
		const entry = careerActionReplay.pending[careerActionReplay.index];
		const step = entry && Number.isFinite(entry.step) ? entry.step : -1;
		if (step > game.clockSteps) break;
		careerActionReplay.index += 1;
		careerActionReplay.applying = true;
		let ok = false;
		try { ok = applyCareerAction(entry); } catch (error) { ok = false; }
		careerActionReplay.applying = false;
		if (ok) {
			careerActionReplay.applied += 1;

		} else {
			careerActionReplay.skipped += 1;
		}
		if (careerWaitBusy()) break;
	}
	if (careerActionReplay.active && careerActionReplay.index >= careerActionReplay.pending.length && !careerWaitBusy() &&
		game.clockSteps >= careerActionReplay.endStep) {
		careerActionReplay.active = false;
		if (careerActionReplay.watch < slotCount()) selectSlot(careerActionReplay.watch);
		careerActionReplay.halted = true;
		syncCareerPause();
		const actual = careerFlights.filter(flight => flight.slot === careerActionReplay.watch);
		const sameFlights = JSON.stringify(actual) === JSON.stringify(careerActionReplay.expected);
		const applied = careerActionReplay.applied;
		const skipped = careerActionReplay.skipped;
		refreshGameUi();
		careerNotice(skipped === 0
			? 'career replay reached step ' + game.clockSteps + ' · ' + applied +
				' inputs attempted · selected flights ' + (sameFlights ? 'match' : 'differ from recording')
			: 'career replay · ' + applied + ' inputs attempted · ' + skipped +
				' skipped (world diverged)');
	}
	return launches;
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

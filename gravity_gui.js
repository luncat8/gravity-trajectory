/*
 * Cargo overlay: planet-system grand tour, aiming, gravity editing and HUD.
 *
 * Launches always start from static planets in every gravity mode; once the
 * ship lands on a planet, the next launch is staged from that landed body.
 * Prediction updates at up to 60 fps when gravity centres move or change (backing
 * off automatically when the smoothed frame time exceeds 17.5 ms) and continues
 * ahead of the flying container until it lands.
 *
 * Game mode (archive/game.1-plan.md): seeded world, the trade clock advances
 * only with the cargo's fixed physics steps, the aim snaps to an integer grid,
 * and a replay link re-flies every recorded shot.
 */
(function (root) {
	'use strict';

	const $ = id => document.getElementById(id);
	const SPEED_MIN = GravitySim.SPEED_MIN;
	const SPEED_MAX = GravitySim.SPEED_MAX;
	const GRIP_MAX = GravitySim.GRIP_MAX;
	const STATUS_IDLE = GravitySim.STATUS_IDLE;
	const STATUS_FLYING = GravitySim.STATUS_FLYING;
	const STATUS_ENDED = GravitySim.STATUS_ENDED;
	const END_IMPACT = GravitySim.END_IMPACT;
	const END_EXIT = GravitySim.END_EXIT;
	const END_TIME = GravitySim.END_TIME;
	const END_TRUNCATED = GravitySim.END_TRUNCATED;
	const END_ABORT = GravitySim.END_ABORT;
	const DT = GravitySim.DT;
	const PLANETS = OrbitSim.PLANETS;
	const NO_PORT = OrbitSim.NO_PORT;
	const MODE_PLANETS = GravityGame.SRC_PLANETS;
	const MODE_PORTS = GravityGame.SRC_PORTS;
	const NO_ABORT = GravityGame.NO_ABORT;
	const REPLAY_AIM_MS = 700;
	const REPLAY_GAP_MS = 450;
	const REPLAY_SPEEDS = [1, 4, 16];
	const PHASE_AIM = 0;
	const PHASE_FLY = 1;
	const PHASE_GAP = 2;
	const SEED_RANGE = 999999;
	const PORT_R = 6;
	const HIT_PX = 18;
	const HUD_INTERVAL = 100;
	const FPS_FRAME_MS = 1000 / 60;
	const FPS_DROP_MS = 17.5;
	const SENS_FINE = 1 / 20;
	const DRAG_TAKEOVER_PX = 7;
	const WELL_BASE = 24;
	const WELL_SCALE = 64;
	const NO_DASH = [];
	const TAU = Math.PI * 2;
	const ATTRACT = 'rgba(103, 224, 255, 0.07)';
	const ATTRACT_HOVER = 'rgba(103, 224, 255, 0.26)';
	const ATTRACT_SELECT = 'rgba(255, 207, 110, 0.42)';
	const REPEL = 'rgba(255, 126, 160, 0.10)';
	const REPEL_HOVER = 'rgba(255, 126, 160, 0.32)';
	const REPEL_SELECT = 'rgba(255, 207, 110, 0.48)';
	const WELL_COLOURS = [
		[ATTRACT, ATTRACT_HOVER, ATTRACT_SELECT],
		[REPEL, REPEL_HOVER, REPEL_SELECT]
	];
	const GOLD = '#ffcf6e';
	const MINT = '#8ef0c0';
	const WARN = '#ff9478';
	const ICE = '#67e0ff';
	const SIGN_POS = '#ff5f57';
	const SIGN_NEG = '#57a8ff';
	const PLATE = 'rgba(5, 13, 24, 0.92)';
	const PRED_DASH = [0, 0];
	const GRIP_DASH = [0, 0];
	const REPEL_DASH = [0, 0];
	const SYS_DASH = [0, 0];
	const LOCK_DASH = [0, 0];
	const PASSENGERS = ['tourist', 'emperor’s emissary'];

	const scene = root.OrbitScene;
	const tradeSim = scene.sim;
	const view = scene.view;
	const gravity = new GravitySim(OrbitSim.WORLD_W, OrbitSim.WORLD_H);

	/* per-mode strength kept across switches; port strength keyed by parent planet */
	const planetStrength = new Float64Array(PLANETS).fill(1);
	const portPlanetStrength = new Float64Array(PLANETS).fill(1);
	const portStrength = new Float64Array(OrbitSim.PORTS).fill(1);
	const portRadius = new Float64Array(OrbitSim.PORTS).fill(PORT_R);
	/* the field's port → planet roster; a game flight keeps the one taken at launch */
	const fieldPortPlanet = new Int16Array(OrbitSim.PORTS).fill(-1);

	function fillPlanets(t, outX, outY, count) {
		for (let i = 0; i < count; i++) {
			outX[i] = tradeSim.planetX[i];
			outY[i] = tradeSim.planetY[i];
		}
	}

	/* closed-form port positions, keeping strength bound to each port's planet */
	function fillPorts(t, outX, outY, count) {
		for (let p = 0; p < count; p++) {
			const planet = fieldPortPlanet[p];
			portStrength[p] = portPlanetStrength[planet];
			const angle = tradeSim.orbitPhase[planet] + tradeSim.orbitOmega[planet] * t;
			const rx = tradeSim.orbitRX[planet] * Math.cos(angle);
			const ry = tradeSim.orbitRY[planet] * Math.sin(angle);
			outX[p] = tradeSim.planetX[planet] +
				rx * tradeSim.orbitTiltCos[planet] - ry * tradeSim.orbitTiltSin[planet];
			outY[p] = tradeSim.planetY[planet] +
				rx * tradeSim.orbitTiltSin[planet] + ry * tradeSim.orbitTiltCos[planet];
		}
	}

	function syncPlanetGravity() {
		if (!scene.planetG) return;
		for (let p = 0; p < PLANETS; p++) {
			const port = tradeSim.planetPort[p];
			scene.planetG[p] = mode === MODE_PORTS && port !== NO_PORT
				? portPlanetStrength[p]
				: planetStrength[p];
		}
	}

	function syncPortRoster() {
		let changed = gravity.setCount(tradeSim.portCount);
		for (let p = 0; p < tradeSim.portCount; p++) {
			const planet = tradeSim.portPlanet[p];
			if (fieldPortPlanet[p] !== planet) {
				fieldPortPlanet[p] = planet;
				portStrength[p] = portPlanetStrength[planet];
				changed = true;
			}
		}
		if (selected >= gravity.bodyCount) setSelected(-1);
		if (changed) syncPlanetGravity();
		return changed;
	}

	const canvas = $('g');
	const ctx = canvas.getContext('2d');
	const glow = makeGlow('rgba(92, 255, 139, 0.95)');
	const impactGlow = makeGlow('rgba(255, 126, 160, 0.5)');

	const expClockEl = $('expClock');
	const statusEl = $('cargoStatus');
	const visitEl = $('visitReadout');
	const predVisitEl = $('predVisitReadout');
	const flightEl = $('cargoFlight');
	const aimEl = $('aimReadout');
	const pathEl = $('pathReadout');
	const lengthEl = $('lengthReadout');
	const calcEl = $('calcReadout');
	const bodyTagEl = $('bodyTag');
	const sourceTagEl = $('sourceTag');
	const srcPlanetsEl = $('srcPlanets');
	const srcPortsEl = $('srcPorts');
	const gravitySlider = $('gravity');
	const gravityLabel = $('gravityLabel');
	const trimSlider = $('trim');
	const trimLabel = $('trimLabel');
	const horizonSlider = $('horizon');
	const horizonLabel = $('horizonLabel');
	const horizonTagEl = $('horizonTag');
	const trimTargetEl = $('trimTarget');
	const launchButton = $('launch');
	const clearButton = $('clear');
	const goalRoleEl = $('goalRole');
	const cargoHudEl = $('cargoHud');
	const helpBtn = $('helpBtn');
	const foldBtn = $('foldBtn');
	const helpDrawer = $('helpDrawer');
	const helpClose = $('helpClose');
	const drawerPassengerEl = $('drawerPassenger');
	const goalStoryEl = $('goalStory');
	const rerollGoalBtn = $('rerollGoal');
	const tradeCanvas = $('c');
	const modeTagEl = $('modeTag');
	const modeLabEl = $('modeLab');
	const modeGameEl = $('modeGame');
	const gameBoxEl = $('gameBox');
	const gameSeedEl = $('gameSeed');
	const gameScoreEl = $('gameScore');
	const replayRowEl = $('replayRow');
	const replayEl = $('replayReadout');
	const gameRestartBtn = $('gameRestart');
	const gameNewSeedBtn = $('gameNewSeed');
	const gameCopyBtn = $('gameCopy');
	const replaySpeedBtn = $('replaySpeed');
	const replaySkipBtn = $('replaySkip');
	const gameLinkEl = $('gameLink');

	let lastWX = 0;
	let lastWY = 0;
	let hoverBody = -1;
	let hoverPlanet = -1;
	let selected = -1;
	let aimBody = -1;
	let aiming = false;
	let armed = false;
	let aimAngle = 0;
	let aimSpeed = SPEED_MIN;
	let gripX = 0;
	let gripY = 0;
	let gripLen = 0;
	let mode = MODE_PLANETS;
	let pressing = false;
	let pressPlanet = -1;
	let pressClientX = 0;
	let pressClientY = 0;
	let pendGripX = 0;
	let pendGripY = 0;
	let savedArmed = false;
	let savedBody = -1;
	let savedAngle = 0;
	let savedSpeed = SPEED_MIN;
	let blockedPlanet = -1;
	let blockedUntil = -Infinity;
	let helpOpen = false;
	let helpPinned = false;
	let hudFolded = false;
	let passenger = PASSENGERS[0];
	let fine = false;
	let dirty = false;
	let trimLast = 0;
	let hudAt = -Infinity;
	let lastFrame = performance.now();
	const expStart = performance.now();
	let emaFrameMs = 16;
	let otherWorkMs = 1;
	let autoSkip = 0;
	let lastAutoInterval = 1;
	let selectedLabel = '';
	let hoverLabel = '';
	let aimLabel = '';
	let hudAimText = '';
	let hudTagText = '';
	let hudVisitText = '';
	let hudPredVisitText = '';
	let hudLengthText = '';
	let hudPathText = '';
	let hudSeedText = '';
	let hudScoreText = '';
	let hudReplayText = '';
	let launchState = -1;
	let linkNote = '';

	/*
	 * game: steps = finished flight steps, doneSteps = step the 26th system was entered,
	 * fixedRate = the rate came with a link and must not change
	 */
	const game = { on: false, seed: 0, fixedRate: false, shots: [], steps: 0, doneSteps: -1 };
	/* replay of a link: shots fired in order, aim shown then flown; verdict after the last */
	const replay = { on: false, shots: null, end: null, index: 0, phase: PHASE_GAP, until: 0, speed: 0, verdict: '' };

	function makeGlow(fill) {
		const sprite = document.createElement('canvas');
		sprite.width = 64;
		sprite.height = 64;
		const paint = sprite.getContext('2d');
		const gradient = paint.createRadialGradient(32, 32, 0, 32, 32, 32);
		gradient.addColorStop(0, fill);
		gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
		paint.fillStyle = gradient;
		paint.fillRect(0, 0, 64, 64);
		return sprite;
	}

	function plate(x, y, width, height, stroke) {
		const r = 6;
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + width, y, x + width, y + height, r);
		ctx.arcTo(x + width, y + height, x, y + height, r);
		ctx.arcTo(x, y + height, x, y, r);
		ctx.arcTo(x, y, x + width, y, r);
		ctx.closePath();
		ctx.fillStyle = PLATE;
		ctx.fill();
		if (stroke) {
			ctx.strokeStyle = stroke;
			ctx.lineWidth = 1;
			ctx.stroke();
		}
	}

	function rollPassenger(forceNext) {
		if (forceNext) {
			setPassenger(passenger === PASSENGERS[0] ? PASSENGERS[1] : PASSENGERS[0]);
		} else {
			setPassenger(Math.random() < 0.5 ? PASSENGERS[0] : PASSENGERS[1]);
		}
	}

	function setPassenger(name) {
		passenger = name;
		if (goalRoleEl) goalRoleEl.textContent = passenger + ' · fly through all systems';
		if (drawerPassengerEl) drawerPassengerEl.textContent = passenger;
		if (goalStoryEl) {
			goalStoryEl.textContent = passenger === PASSENGERS[0]
				? 'A tourist aboard your vessel wants to fly through each planet system. Sweep inside as many port orbits as possible and land on a planet to stage your next hop.'
				: 'The emperor’s emissary aboard your vessel wants to fly through each planet system. Sweep inside every port orbit on a grand tour and land on planets to continue the inspection.';
		}
	}

	function setHelpOpen(open, preview = false) {
		if (!preview) helpPinned = open;
		helpOpen = open;
		if (helpDrawer) helpDrawer.classList.toggle('open', open);
		if (helpBtn) helpBtn.classList.toggle('on', open);
	}

	function resizeOverlay() {
		const width = window.innerWidth;
		const height = window.innerHeight;
		const dpr = view.dpr;
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
		canvas.style.width = width + 'px';
		canvas.style.height = height + 'px';
	}

	function worldX(clientX) {
		return (clientX - view.offX) / view.scale;
	}

	function worldY(clientY) {
		return (clientY - view.offY) / view.scale;
	}

	function planetAt(wx, wy) {
		const reach = HIT_PX / view.scale;
		const reach2 = reach * reach;
		let best = -1;
		let bestD2 = Infinity;
		for (let i = 0; i < PLANETS; i++) {
			const dx = tradeSim.planetX[i] - wx;
			const dy = tradeSim.planetY[i] - wy;
			const d2 = dx * dx + dy * dy;
			if (d2 <= reach2 && d2 < bestD2) {
				bestD2 = d2;
				best = i;
			}
		}
		return best;
	}

	function bodyAt(wx, wy) {
		const reach = HIT_PX / view.scale;
		const reach2 = reach * reach;
		let best = -1;
		let bestD2 = Infinity;
		for (let i = 0; i < gravity.bodyCount; i++) {
			const dx = gravity.bodyX[i] - wx;
			const dy = gravity.bodyY[i] - wy;
			const d2 = dx * dx + dy * dy;
			if (d2 <= reach2 && d2 < bestD2) {
				bestD2 = d2;
				best = i;
			}
		}
		return best;
	}

	function planetName(index) {
		return 'P' + index;
	}

	function bodyName(index) {
		return mode === MODE_PORTS ? 'port ' + index : 'P' + index;
	}

	function tradeRate() {
		return scene.trade.paused ? 0 : scene.trade.speed;
	}

	function applyMode() {
		if (mode === MODE_PORTS) {
			fieldPortPlanet.fill(-1);
			for (let p = 0; p < tradeSim.portCount; p++) {
				const planet = tradeSim.portPlanet[p];
				fieldPortPlanet[p] = planet;
				portStrength[p] = portPlanetStrength[planet];
			}
			gravity.setField(tradeSim.portCount, portRadius, portStrength, fillPorts, false);
			sourceTagEl.textContent = 'ports · moving';
			sourceTagEl.title = tradeSim.portCount + ' ports · launch from planets';
		} else {
			gravity.setField(PLANETS, tradeSim.planetR, planetStrength, fillPlanets, true);
			sourceTagEl.textContent = 'planets';
			sourceTagEl.title = PLANETS + ' planets';
		}
		syncPlanetGravity();
	}

	function setBodyStrength(body, value) {
		if (!gravity.setStrength(body, value)) return false;
		if (mode === MODE_PORTS && body >= 0 && body < gravity.bodyCount) {
			portPlanetStrength[fieldPortPlanet[body]] = gravity.strength[body];
		}
		syncPlanetGravity();
		return true;
	}

	function strengthText(index) {
		const value = gravity.strength[index];
		return (value > 0 ? '+' : '') + value.toFixed(2);
	}

	function refreshSelected() {
		if (selected < 0 || selected >= gravity.bodyCount) {
			selected = -1;
			selectedLabel = '';
			bodyTagEl.textContent = 'none selected';
			gravitySlider.disabled = true;
			gravityLabel.textContent = '—';
			return;
		}
		selectedLabel = bodyName(selected) + ' · g ' + strengthText(selected) +
			(gravity.strength[selected] < 0 ? ' repel' : '');
		bodyTagEl.textContent = selectedLabel;
		gravitySlider.disabled = game.on;
		gravitySlider.value = gravity.strength[selected].toFixed(2);
		gravityLabel.textContent = gravity.strength[selected].toFixed(2);
	}

	function setSelected(index) {
		selected = index;
		refreshSelected();
		hudAt = -Infinity;
	}

	function refreshAimLabel() {
		if (!aiming && !armed) {
			aimLabel = '';
			return;
		}
		const deg = ((-aimAngle * 180 / Math.PI) % 360 + 360) % 360;
		const visitNote = gravity.predCount >= 2
			? ' · +' + gravity.predNewVisits + ' (' + gravity.predVisits + ' sys)'
			: '';
		aimLabel = Math.round(aimSpeed) + ' px/s · ' + deg.toFixed(1) + '°' +
			(fine ? ' · fine' : '') + visitNote;
	}

	function refreshHoverLabel() {
		if (hoverBody < 0 || hoverBody >= gravity.bodyCount) {
			hoverLabel = '';
			return;
		}
		hoverLabel = bodyName(hoverBody) + ' · g ' + strengthText(hoverBody) +
			(gravity.strength[hoverBody] < 0 ? ' repel' : '');
	}

	/* launch base is always a static planet core */
	function updateAim() {
		const cx = tradeSim.planetX[aimBody];
		const cy = tradeSim.planetY[aimBody];
		const dx = gripX - cx;
		const dy = gripY - cy;
		let len = Math.sqrt(dx * dx + dy * dy);
		if (len > GRIP_MAX) {
			const k = GRIP_MAX / len;
			gripX = cx + dx * k;
			gripY = cy + dy * k;
			len = GRIP_MAX;
		}
		if (len > 0.5) {
			aimAngle = Math.atan2(dy, dx);
			gripLen = len;
		} else {
			gripLen = 0;
		}
		aimSpeed = gravity.speedAt(gripLen);
		snapAim();
		refreshAimLabel();
	}

	/* game shots live on an integer grid so the link carries the exact launch inputs */
	function snapAim() {
		if (!game.on) return;
		aimAngle = GravityGame.angleOf(GravityGame.angleUnits(aimAngle));
		aimSpeed = GravityGame.speedOf(GravityGame.speedUnits(aimSpeed));
	}

	function placeGripFromSpeed() {
		const cx = tradeSim.planetX[aimBody];
		const cy = tradeSim.planetY[aimBody];
		snapAim();
		gripLen = gravity.gripLength(aimSpeed);
		gripX = cx + Math.cos(aimAngle) * gripLen;
		gripY = cy + Math.sin(aimAngle) * gripLen;
		refreshAimLabel();
	}

	function beginPress(planet, event, wx, wy) {
		pressing = true;
		pressPlanet = planet;
		pressClientX = event.clientX;
		pressClientY = event.clientY;
		pendGripX = wx;
		pendGripY = wy;
	}

	function takeOverAim(now) {
		if (!gravity.canLaunchFrom(pressPlanet)) {
			pressing = false;
			blockedPlanet = pressPlanet;
			blockedUntil = now + 2600;
			hudAt = -Infinity;
			return;
		}
		blockedPlanet = -1;
		savedArmed = armed;
		savedBody = aimBody;
		savedAngle = aimAngle;
		savedSpeed = aimSpeed;
		aimBody = pressPlanet;
		aiming = true;
		armed = false;
		gripX = pendGripX;
		gripY = pendGripY;
		updateAim();
		gravity.predCount = 0;
		dirty = true;
		hudAt = -Infinity;
	}

	function restoreSaved() {
		aimBody = savedBody;
		aimAngle = savedAngle;
		aimSpeed = savedSpeed;
		armed = true;
		placeGripFromSpeed();
		dirty = true;
	}

	function cancelAim() {
		aiming = false;
		armed = false;
		pressing = false;
		savedArmed = false;
		dirty = false;
		if (gravity.status !== STATUS_FLYING) gravity.predCount = 0;
		else dirty = true;
		hudAt = -Infinity;
	}

	function launch() {
		if (!armed || !gravity.canLaunchFrom(aimBody) || gameLocked()) return;
		fire(NO_ABORT);
	}

	function fire(abortStep) {
		if (game.on) recordShot(abortStep);
		gravity.predict(aimBody, aimAngle, aimSpeed);
		dirty = false;
		gravity.launch(aimBody, aimAngle, aimSpeed);
		aiming = false;
		armed = false;
		pressing = false;
		savedArmed = false;
		blockedPlanet = -1;
		hudAt = -Infinity;
		if (game.on) refreshGameUi();
	}

	/* the launch state must not depend on frame timing, so roster and clock are re-read here */
	function recordShot(abortStep) {
		if (mode === MODE_PORTS) syncPortRoster();
		gravity.fieldT = tradeSim.t;
		gravity.fieldRate = scene.trade.speed;
		gravity.stepLimit = abortStep === NO_ABORT ? GravityGame.CAP_STEPS : abortStep;
		gravity.limitReason = abortStep === NO_ABORT ? END_TIME : END_ABORT;
		game.shots.push(GravityGame.createShot(mode, aimBody,
			GravityGame.angleUnits(aimAngle), GravityGame.speedUnits(aimSpeed), abortStep));
	}

	function clearCargo() {
		gravity.clear();
		aiming = false;
		armed = false;
		pressing = false;
		savedArmed = false;
		blockedPlanet = -1;
		blockedUntil = -Infinity;
		dirty = false;
		hudAt = -Infinity;
	}

	function setMode(next) {
		if (next === mode && gravity.fillField) return;
		mode = next;
		srcPlanetsEl.checked = mode === MODE_PLANETS;
		srcPortsEl.checked = mode === MODE_PORTS;
		cancelAim();
		hoverBody = -1;
		refreshHoverLabel();
		setSelected(-1);
		applyMode();
		if (gravity.status === STATUS_FLYING) dirty = true;
		hudAt = -Infinity;
	}

	function fieldChanged() {
		if (armed || aiming || gravity.status === STATUS_FLYING) dirty = true;
		else gravity.predCount = 0;
		hudAt = -Infinity;
	}

	/* aim edits and launches close while a game flight or replay runs, and after 26 / 26 */
	function gameLocked() {
		return game.on && (replay.on || gravity.status === STATUS_FLYING || game.doneSteps >= 0);
	}

	function gameSteps() {
		return gravity.status === STATUS_FLYING ? game.steps + gravity.liveSteps : game.steps;
	}

	function scoreSteps() {
		return game.doneSteps >= 0 ? game.doneSteps : gameSteps();
	}

	/* the trade world may have been rebuilt with fresh arrays: re-wire the field, strengths back to 1 */
	function attachWorld() {
		gravity.setPlanets(
			PLANETS,
			tradeSim.planetX, tradeSim.planetY, tradeSim.planetR,
			tradeSim.orbitRX, tradeSim.orbitRY,
			tradeSim.orbitTiltCos, tradeSim.orbitTiltSin
		);
		planetStrength.fill(1);
		portPlanetStrength.fill(1);
		portStrength.fill(1);
		cancelAim();
		hoverBody = -1;
		hoverPlanet = -1;
		refreshHoverLabel();
		setSelected(-1);
		applyMode();
	}

	function startGame(seed, fixedRate) {
		stopReplay();
		linkNote = '';
		game.on = true;
		game.seed = seed;
		game.fixedRate = fixedRate;
		game.shots.length = 0;
		game.steps = 0;
		game.doneSteps = -1;
		scene.reset(seed);
		scene.setGameClock(true);
		clearCargo();
		gravity.fieldT = tradeSim.t;
		gravity.fieldRate = scene.trade.speed;
		attachWorld();
		setPassenger(PASSENGERS[seed % PASSENGERS.length]);
		gameLinkEl.hidden = true;
		refreshGameUi();
	}

	/* back to lab: the world stays, the clock returns to real time, a running flight continues */
	function stopGame() {
		stopReplay();
		linkNote = '';
		game.on = false;
		scene.setGameClock(false);
		gravity.stepLimit = Infinity;
		gravity.limitReason = END_TIME;
		gameLinkEl.hidden = true;
		refreshSelected();
		refreshGameUi();
	}

	function stepGame(now, dt) {
		if (replay.on && replay.phase !== PHASE_FLY && now >= replay.until) advanceReplay(now);
		const runs = replay.on ? REPLAY_SPEEDS[replay.speed] : 1;
		for (let k = 0; k < runs && gravity.status === STATUS_FLYING; k++) advanceGame(dt);
	}

	/* the world clock is the cargo's field clock: it moves only with fixed flight steps */
	function advanceGame(dt) {
		gravity.step(dt);
		tradeSim.advanceTo(gravity.flightFieldT);
		if (gravity.status !== STATUS_FLYING) endGameFlight();
	}

	function endGameFlight() {
		if (gravity.visitedCount === PLANETS && game.doneSteps < 0) {
			game.doneSteps = game.steps + gravity.visitStep;
		}
		game.steps += gravity.liveSteps;
		if (replay.on) {
			replay.phase = PHASE_GAP;
			replay.until = performance.now() + REPLAY_GAP_MS / REPLAY_SPEEDS[replay.speed];
		}
		refreshGameUi();
	}

	function abortFlight() {
		if (replay.on || gravity.status !== STATUS_FLYING) return;
		game.shots[game.shots.length - 1].abort = gravity.liveSteps;
		gravity.abort();
		endGameFlight();
	}

	function startReplay(shots, end) {
		replay.on = true;
		replay.shots = shots;
		replay.end = end;
		replay.index = 0;
		replay.phase = PHASE_GAP;
		replay.until = performance.now() + REPLAY_GAP_MS;
		replay.verdict = '';
		refreshGameUi();
	}

	function stopReplay() {
		replay.on = false;
		replay.verdict = '';
	}

	/* gap → aim the next shot (or finish) → fire; a flight hands back through endGameFlight */
	function advanceReplay(now) {
		if (replay.phase === PHASE_AIM) {
			const shot = replay.shots[replay.index++];
			setShotAim(shot);
			replay.phase = PHASE_FLY;
			fire(shot.abort);
			return;
		}
		if (replay.index >= replay.shots.length) {
			finishReplay('');
			return;
		}
		aimReplayShot(replay.shots[replay.index], now);
	}

	function aimReplayShot(shot, now) {
		setMode(shot.src);
		if (!gravity.canLaunchFrom(shot.origin)) {
			finishReplay('desync · shot ' + (replay.index + 1) + ' from ' + planetName(shot.origin));
			return;
		}
		setShotAim(shot);
		armed = true;
		dirty = true;
		replay.phase = PHASE_AIM;
		replay.until = now + REPLAY_AIM_MS / REPLAY_SPEEDS[replay.speed];
		hudAt = -Infinity;
	}

	function setShotAim(shot) {
		aimBody = shot.origin;
		aimAngle = GravityGame.angleOf(shot.angle);
		aimSpeed = GravityGame.speedOf(shot.speed);
		placeGripFromSpeed();
	}

	function finishReplay(problem) {
		replay.on = false;
		replay.verdict = problem || verdictText(replay.end);
		armed = false;
		refreshGameUi();
	}

	function verdictText(end) {
		if (!end) return 'replayed ' + replay.shots.length + ' shots';
		if (end.visited === gravity.visitedCount && end.steps === scoreSteps()) return 'verified ✓';
		return 'differs · recorded ' + end.visited + ' / ' + PLANETS + ' · ' +
			(end.steps * DT).toFixed(2) + ' s';
	}

	function skipReplay() {
		const now = performance.now();
		while (replay.on) {
			if (gravity.status === STATUS_FLYING) advanceGame(0.1);
			else advanceReplay(now);
		}
	}

	function copyLink() {
		const url = location.href.split('#')[0] + '#' + GravityGame.encodeLink({
			seed: game.seed,
			rate: scene.trade.speed,
			shots: game.shots,
			visited: gravity.visitedCount,
			steps: scoreSteps()
		});
		gameLinkEl.value = url;
		const clipboard = navigator.clipboard;
		if (!clipboard) {
			showLink();
			return;
		}
		clipboard.writeText(url).then(() => {
			gameCopyBtn.textContent = 'copied ✓';
			setTimeout(() => {
				gameCopyBtn.textContent = 'copy replay';
			}, 1600);
		}, showLink);
	}

	function showLink() {
		gameLinkEl.hidden = false;
		gameLinkEl.focus();
		gameLinkEl.select();
	}

	function loadLink() {
		if (!GravityGame.isGameLink(location.hash)) return false;
		const link = GravityGame.decodeLink(location.hash);
		if (!link) {
			linkNote = 'invalid game link';
			refreshGameUi();
			return false;
		}
		modeGameEl.checked = true;
		scene.setSpeed(link.rate);
		startGame(link.seed, true);
		if (link.shots.length > 0) startReplay(link.shots, link.end);
		return true;
	}

	/* control locks and button states; runs on game state changes, not per frame */
	function refreshGameUi() {
		const flying = gravity.status === STATUS_FLYING;
		const flightLock = game.on && (flying || replay.on);
		modeTagEl.textContent = linkNote || (game.on ? 'game · clock runs in flight' : 'lab · free clock');
		gameBoxEl.hidden = !game.on;
		srcPlanetsEl.disabled = flightLock;
		srcPortsEl.disabled = flightLock;
		scene.lockSpeed(game.on && (game.fixedRate || game.shots.length > 0 || replay.on));
		if (rerollGoalBtn) rerollGoalBtn.disabled = game.on;
		clearButton.textContent = game.on ? 'abort' : 'clear';
		clearButton.disabled = game.on && (!flying || replay.on);
		gameCopyBtn.disabled = flightLock;
		replaySpeedBtn.hidden = !replay.on;
		replaySkipBtn.hidden = !replay.on;
		replaySpeedBtn.textContent = '×' + REPLAY_SPEEDS[replay.speed];
		replayRowEl.hidden = !replay.on && replay.verdict === '';
		hudAt = -Infinity;
	}

	function updateGameHud() {
		const seedText = 'seed ' + game.seed + ' · ×' + scene.trade.speed;
		if (seedText !== hudSeedText) {
			hudSeedText = seedText;
			gameSeedEl.textContent = seedText;
		}
		const shots = game.shots.length;
		const scoreText = gravity.visitedCount + ' / ' + PLANETS + (game.doneSteps >= 0 ? ' ✓' : '') +
			' · ' + shots + (shots === 1 ? ' shot' : ' shots') + ' · ' +
			(scoreSteps() * DT).toFixed(2) + ' s';
		if (scoreText !== hudScoreText) {
			hudScoreText = scoreText;
			gameScoreEl.textContent = scoreText;
		}
		const replayText = replay.on
			? 'shot ' + (replay.index + (replay.phase === PHASE_AIM ? 1 : 0)) + ' / ' +
				replay.shots.length + ' · ×' + REPLAY_SPEEDS[replay.speed]
			: replay.verdict;
		if (replayText !== hudReplayText) {
			hudReplayText = replayText;
			replayEl.textContent = replayText;
		}
	}

	function onPointerDown(event) {
		if (event.button !== 0 || event.target !== tradeCanvas) return;
		const wx = worldX(event.clientX);
		const wy = worldY(event.clientY);
		const planet = planetAt(wx, wy);
		const body = bodyAt(wx, wy);
		if (planet < 0 && body < 0) return;
		lastWX = wx;
		lastWY = wy;
		if (body >= 0) {
			setSelected(body);
		} else if (mode === MODE_PORTS && tradeSim.planetPort[planet] !== NO_PORT) {
			setSelected(tradeSim.planetPort[planet]);
		}
		const basePlanet = planet >= 0 ? planet : fieldPortPlanet[body];
		if (basePlanet >= 0 && !gameLocked()) {
			if (!gravity.canLaunchFrom(basePlanet)) {
				blockedPlanet = basePlanet;
				blockedUntil = performance.now() + 2600;
			}
			beginPress(basePlanet, event, wx, wy);
		}
	}

	function onPointerMove(event) {
		const wx = worldX(event.clientX);
		const wy = worldY(event.clientY);
		fine = event.shiftKey;
		if (aiming) {
			const dx = wx - lastWX;
			const dy = wy - lastWY;
			const sens = fine ? SENS_FINE : 1;
			gripX += dx * sens;
			gripY += dy * sens;
			updateAim();
			dirty = true;
		} else if (pressing) {
			const dx = wx - lastWX;
			const dy = wy - lastWY;
			const sens = fine ? SENS_FINE : 1;
			pendGripX += dx * sens;
			pendGripY += dy * sens;
			const movedX = event.clientX - pressClientX;
			const movedY = event.clientY - pressClientY;
			if (movedX * movedX + movedY * movedY > DRAG_TAKEOVER_PX * DRAG_TAKEOVER_PX) {
				takeOverAim(performance.now());
			}
		} else {
			const onCanvas = event.target === tradeCanvas;
			const body = onCanvas ? bodyAt(wx, wy) : -1;
			const planet = onCanvas ? planetAt(wx, wy) : -1;
			if (body !== hoverBody) {
				hoverBody = body;
				refreshHoverLabel();
			}
			hoverPlanet = planet;
		}
		lastWX = wx;
		lastWY = wy;
	}

	function onPointerUp(event) {
		fine = event.shiftKey;
		if (pressing && !aiming) {
			pressing = false;
			return;
		}
		if (!aiming) return;
		aiming = false;
		pressing = false;
		const reach = tradeSim.planetR[aimBody] + 6 / view.scale;
		if (gripLen > reach && aimSpeed > SPEED_MIN + 4) {
			armed = true;
			dirty = true;
		} else if (savedArmed) {
			restoreSaved();
		} else {
			armed = false;
			dirty = false;
			if (gravity.status !== STATUS_FLYING) gravity.predCount = 0;
			else dirty = true;
		}
		savedArmed = false;
		refreshAimLabel();
		hudAt = -Infinity;
	}

	function onTrimInput() {
		const value = Number(trimSlider.value);
		const delta = value - trimLast;
		trimLast = value;
		if (delta === 0) return;
		const factor = 1 + delta / 100;
		if (armed) {
			aimSpeed = aimSpeed * factor;
			if (aimSpeed < SPEED_MIN) aimSpeed = SPEED_MIN;
			else if (aimSpeed > SPEED_MAX) aimSpeed = SPEED_MAX;
			placeGripFromSpeed();
			dirty = true;
		} else if (selected >= 0 && !game.on) {
			setBodyStrength(selected, gravity.strength[selected] * factor);
			refreshSelected();
			refreshHoverLabel();
			fieldChanged();
		}
		trimLabel.textContent = (value > 0 ? '+' : '') + value.toFixed(1) + '%';
		hudAt = -Infinity;
	}

	function resetTrim() {
		trimSlider.value = '0';
		trimLast = 0;
		trimLabel.textContent = '0%';
	}

	/* Past visits stay dim; current predictions take priority in bright green. */
	function drawSystemVisits(now) {
		const px = 1 / view.scale;
		const activePred = aiming || armed || gravity.status === STATUS_FLYING;
		const pulse = 0.5 + 0.5 * Math.sin(now * 0.006);
		SYS_DASH[0] = 5 * px;
		SYS_DASH[1] = 5 * px;
		for (let i = 0; i < PLANETS; i++) {
			const wasVisited = gravity.visited[i] === 1;
			const willVisit = activePred && gravity.predVisit[i] === 1;
			if (!wasVisited && !willVisit) continue;
			const x = tradeSim.planetX[i];
			const y = tradeSim.planetY[i];
			const r = tradeSim.planetR[i];
			ctx.beginPath();
			ctx.ellipse(x, y, tradeSim.orbitRX[i], tradeSim.orbitRY[i],
				tradeSim.orbitTilt[i], 0, TAU);
			if (!willVisit) {
				ctx.setLineDash(NO_DASH);
				ctx.strokeStyle = 'rgba(142, 240, 192, 0.14)';
				ctx.lineWidth = 1.1 * px;
				ctx.stroke();

				ctx.beginPath();
				ctx.arc(x, y, r + 3.2 * px, 0, TAU);
				ctx.strokeStyle = 'rgba(142, 240, 192, 0.38)';
				ctx.lineWidth = 1.25 * px;
				ctx.stroke();
				continue;
			}
			ctx.setLineDash(SYS_DASH);
			ctx.strokeStyle = 'rgba(92, 255, 139, 0.85)';
			ctx.lineWidth = 1.35 * px;
			ctx.stroke();
			ctx.setLineDash(NO_DASH);

			ctx.beginPath();
			ctx.arc(x, y, r + (3.5 + pulse * 2.5) * px, 0, TAU);
			ctx.strokeStyle = 'rgba(92, 255, 139, 0.95)';
			ctx.lineWidth = 1.1 * px;
			ctx.stroke();
		}
		ctx.setLineDash(NO_DASH);
	}

	/* highlights the landed body where the next launch must originate */
	function drawLandedBase(now) {
		const base = gravity.landedBody;
		if (base < 0) return;
		const px = 1 / view.scale;
		const x = tradeSim.planetX[base];
		const y = tradeSim.planetY[base];
		const r = tradeSim.planetR[base];
		const pulse = 0.5 + 0.5 * Math.sin(now * 0.0055);
		const inner = r + 5.5 * px;
		const outer = inner + (4 + pulse * 3) * px;

		ctx.setLineDash(NO_DASH);
		ctx.beginPath();
		ctx.arc(x, y, inner, 0, TAU);
		ctx.strokeStyle = MINT;
		ctx.lineWidth = 1.6 * px;
		ctx.stroke();

		ctx.beginPath();
		ctx.arc(x, y, outer, 0, TAU);
		ctx.strokeStyle = 'rgba(255, 207, 110, 0.45)';
		ctx.lineWidth = 1.0 * px;
		ctx.stroke();

		/* four launch-pad ticks around the landed planet */
		const tick0 = inner + 1.5 * px;
		const tick1 = tick0 + 4.5 * px;
		ctx.beginPath();
		ctx.moveTo(x - tick1, y);
		ctx.lineTo(x - tick0, y);
		ctx.moveTo(x + tick0, y);
		ctx.lineTo(x + tick1, y);
		ctx.moveTo(x, y - tick1);
		ctx.lineTo(x, y - tick0);
		ctx.moveTo(x, y + tick0);
		ctx.lineTo(x, y + tick1);
		ctx.strokeStyle = GOLD;
		ctx.lineWidth = 1.4 * px;
		ctx.stroke();
	}

	function activeBlockedPlanet(now) {
		if (gravity.landedBody < 0 || aiming) return -1;
		if (hoverPlanet >= 0 && hoverPlanet !== gravity.landedBody) return hoverPlanet;
		if (blockedPlanet >= 0 && blockedPlanet !== gravity.landedBody && now < blockedUntil) {
			return blockedPlanet;
		}
		return -1;
	}

	/* guide vector + arrowheads from a non-landed planet to the landed base */
	function drawBlockedArrowWorld(src, now) {
		const dst = gravity.landedBody;
		const px = 1 / view.scale;
		const x0 = tradeSim.planetX[src];
		const y0 = tradeSim.planetY[src];
		const x1 = tradeSim.planetX[dst];
		const y1 = tradeSim.planetY[dst];
		const dx = x1 - x0;
		const dy = y1 - y0;
		const dist = Math.sqrt(dx * dx + dy * dy);
		if (dist < 1e-3) return;
		const angle = Math.atan2(dy, dx);
		const ux = dx / dist;
		const uy = dy / dist;
		const startGap = tradeSim.planetR[src] + 7 * px;
		const endGap = tradeSim.planetR[dst] + 10 * px;
		if (dist <= startGap + endGap) return;

		ctx.beginPath();
		ctx.arc(x0, y0, tradeSim.planetR[src] + 5 * px, 0, TAU);
		ctx.strokeStyle = WARN;
		ctx.lineWidth = 1.4 * px;
		ctx.setLineDash(NO_DASH);
		ctx.stroke();

		LOCK_DASH[0] = 6 * px;
		LOCK_DASH[1] = 6 * px;
		const sx = x0 + ux * startGap;
		const sy = y0 + uy * startGap;
		const ex = x1 - ux * endGap;
		const ey = y1 - uy * endGap;
		ctx.beginPath();
		ctx.moveTo(sx, sy);
		ctx.lineTo(ex, ey);
		ctx.strokeStyle = 'rgba(255, 148, 120, 0.72)';
		ctx.lineWidth = 1.35 * px;
		ctx.setLineDash(LOCK_DASH);
		ctx.stroke();
		ctx.setLineDash(NO_DASH);

		/* animated chevrons streaming toward the landed planet */
		const span = dist - startGap - endGap;
		const phase = (now * 0.09 * px) % (90 * px);
		ctx.fillStyle = GOLD;
		for (let d = phase; d < span - 14 * px; d += 90 * px) {
			const cx = sx + ux * d;
			const cy = sy + uy * d;
			ctx.beginPath();
			ctx.moveTo(cx + ux * 5 * px, cy + uy * 5 * px);
			ctx.lineTo(cx + Math.cos(angle + 2.5) * 4.2 * px,
				cy + Math.sin(angle + 2.5) * 4.2 * px);
			ctx.lineTo(cx + Math.cos(angle - 2.5) * 4.2 * px,
				cy + Math.sin(angle - 2.5) * 4.2 * px);
			ctx.closePath();
			ctx.fill();
		}

		ctx.beginPath();
		ctx.moveTo(ex + ux * 4 * px, ey + uy * 4 * px);
		ctx.lineTo(ex + Math.cos(angle + 2.55) * 7 * px,
			ey + Math.sin(angle + 2.55) * 7 * px);
		ctx.lineTo(ex + Math.cos(angle - 2.55) * 7 * px,
			ey + Math.sin(angle - 2.55) * 7 * px);
		ctx.closePath();
		ctx.fillStyle = WARN;
		ctx.fill();
	}

	function drawBlockedTooltipScreen(src) {
		const dst = gravity.landedBody;
		const sx = tradeSim.planetX[src] * view.scale + view.offX;
		const sy = tradeSim.planetY[src] * view.scale + view.offY;
		const dx = tradeSim.planetX[dst] - tradeSim.planetX[src];
		const dy = tradeSim.planetY[dst] - tradeSim.planetY[src];
		const angle = Math.atan2(dy, dx);
		const text = 'launch not allowed · ship landed at ' + planetName(dst);
		const width = 36 + text.length * 6.45;
		const height = 22;
		let x = sx + 14;
		let y = sy + 14;
		if (x + width > window.innerWidth - 8) x = window.innerWidth - width - 8;
		if (y + height > window.innerHeight - 10) y = sy - height - 16;
		plate(x, y, width, height, 'rgba(255, 148, 120, 0.55)');

		/* inline directional arrow pointing directly toward the landed planet */
		const ax = x + 14;
		const ay = y + height * 0.5;
		const ux = Math.cos(angle);
		const uy = Math.sin(angle);
		ctx.strokeStyle = WARN;
		ctx.lineWidth = 1.6;
		ctx.beginPath();
		ctx.moveTo(ax - ux * 5.5, ay - uy * 5.5);
		ctx.lineTo(ax + ux * 5.5, ay + uy * 5.5);
		ctx.stroke();
		ctx.fillStyle = GOLD;
		ctx.beginPath();
		ctx.moveTo(ax + ux * 7, ay + uy * 7);
		ctx.lineTo(ax + Math.cos(angle + 2.45) * 3.5, ay + Math.sin(angle + 2.45) * 3.5);
		ctx.lineTo(ax + Math.cos(angle - 2.45) * 3.5, ay + Math.sin(angle - 2.45) * 3.5);
		ctx.closePath();
		ctx.fill();

		ctx.fillStyle = WARN;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
		ctx.fillText(text, x + 26, y + height * 0.5 + 0.5);
	}

	function drawWells() {
		const px = 1 / view.scale;
		REPEL_DASH[0] = 4 * px;
		REPEL_DASH[1] = 7 * px;
		for (let i = 0; i < gravity.bodyCount; i++) {
			const g = gravity.strength[i];
			const mag = g < 0 ? -g : g;
			if (mag < 0.02) continue;
			const level = i === selected ? 2 : i === hoverBody ? 1 : 0;
			const colours = WELL_COLOURS[g < 0 ? 1 : 0];
			ctx.beginPath();
			ctx.arc(gravity.bodyX[i], gravity.bodyY[i],
				WELL_BASE + mag * WELL_SCALE, 0, TAU);
			ctx.strokeStyle = colours[level];
			ctx.lineWidth = (level === 2 ? 1.3 : 0.9) * px;
			if (g < 0) {
				ctx.setLineDash(REPEL_DASH);
			} else {
				ctx.setLineDash(NO_DASH);
			}
			ctx.stroke();
		}
		ctx.setLineDash(NO_DASH);
	}

	function drawSigns() {
		const px = 1 / view.scale;
		ctx.lineCap = 'round';
		ctx.setLineDash(NO_DASH);
		for (let i = 0; i < gravity.bodyCount; i++) {
			const g = gravity.strength[i];
			if (g > -0.02 && g < 0.02) continue;
			const x = gravity.bodyX[i];
			const y = gravity.bodyY[i];
			let arm = gravity.bodyR[i] * 0.6;
			if (arm < 3.2 * px) arm = 3.2 * px;
			if (arm > 9 * px) arm = 9 * px;
			const colour = g > 0 ? SIGN_POS : SIGN_NEG;
			const signGlow = g > 0 ? 'rgba(255, 95, 87, 0.22)' : 'rgba(87, 168, 255, 0.22)';
			ctx.strokeStyle = signGlow;
			ctx.lineWidth = 6 * px;
			ctx.beginPath();
			ctx.moveTo(x - arm, y);
			ctx.lineTo(x + arm, y);
			if (g > 0) {
				ctx.moveTo(x, y - arm);
				ctx.lineTo(x, y + arm);
			}
			ctx.stroke();
			ctx.strokeStyle = colour;
			ctx.lineWidth = 1.7 * px;
			ctx.beginPath();
			ctx.moveTo(x - arm, y);
			ctx.lineTo(x + arm, y);
			if (g > 0) {
				ctx.moveTo(x, y - arm);
				ctx.lineTo(x, y + arm);
			}
			ctx.stroke();
			if (i === selected) {
				ctx.beginPath();
				ctx.arc(x, y, gravity.bodyR[i] + 1.5 * px, 0, TAU);
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
				ctx.lineWidth = px;
				ctx.stroke();
			}
		}
		ctx.lineCap = 'butt';
	}

	function drawPortVelocities() {
		if (mode !== MODE_PORTS || gravity.fieldRate === 0) return;
		const px = 1 / view.scale;
		if (Math.abs(gravity.fieldRate) < 0.05) return;
		ctx.lineCap = 'round';
		ctx.setLineDash(NO_DASH);
		const t = tradeSim.t;
		const eps = 0.12;
		for (let i = 0; i < gravity.bodyCount; i++) {
			const planet = fieldPortPlanet[i];
			const a0 = tradeSim.orbitPhase[planet] + tradeSim.orbitOmega[planet] * t;
			const a1 = tradeSim.orbitPhase[planet] + tradeSim.orbitOmega[planet] * (t + eps);
			const rx0 = tradeSim.orbitRX[planet] * Math.cos(a0);
			const ry0 = tradeSim.orbitRY[planet] * Math.sin(a0);
			const rx1 = tradeSim.orbitRX[planet] * Math.cos(a1);
			const ry1 = tradeSim.orbitRY[planet] * Math.sin(a1);
			const x0 = tradeSim.planetX[planet] + rx0 * tradeSim.orbitTiltCos[planet] - ry0 * tradeSim.orbitTiltSin[planet];
			const y0 = tradeSim.planetY[planet] + rx0 * tradeSim.orbitTiltSin[planet] + ry0 * tradeSim.orbitTiltCos[planet];
			const x1 = tradeSim.planetX[planet] + rx1 * tradeSim.orbitTiltCos[planet] - ry1 * tradeSim.orbitTiltSin[planet];
			const y1 = tradeSim.planetY[planet] + rx1 * tradeSim.orbitTiltSin[planet] + ry1 * tradeSim.orbitTiltCos[planet];
			const vx = (x1 - x0) / eps * gravity.fieldRate;
			const vy = (y1 - y0) / eps * gravity.fieldRate;
			const speed = Math.sqrt(vx * vx + vy * vy);
			if (speed < 0.15 / px) continue;
			const x = gravity.bodyX[i];
			const y = gravity.bodyY[i];
			const len = Math.min(18 * px, Math.max(6 * px, speed * 0.18 * px));
			const angle = Math.atan2(vy, vx);
			ctx.strokeStyle = 'rgba(180, 200, 220, 0.24)';
			ctx.lineWidth = 1.0 * px;
			ctx.beginPath();
			ctx.moveTo(x, y);
			ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
			ctx.lineTo(x + Math.cos(angle + 2.6) * 3.2 * px, y + Math.sin(angle + 2.6) * 3.2 * px);
			ctx.lineTo(x + Math.cos(angle - 2.6) * 3.2 * px, y + Math.sin(angle - 2.6) * 3.2 * px);
			ctx.closePath();
			ctx.fillStyle = 'rgba(180, 200, 220, 0.32)';
			ctx.fill();
		}
		ctx.lineCap = 'butt';
	}

	function drawPrediction() {
		const count = gravity.predCount;
		if (count < 2) return;
		const px = 1 / view.scale;
		PRED_DASH[0] = 6 * px;
		PRED_DASH[1] = 6 * px;
		const pathX = gravity.predX;
		const pathY = gravity.predY;
		const stride = count > 6000 ? 4 : count > 1400 ? 2 : 1;
		ctx.beginPath();
		ctx.moveTo(pathX[0], pathY[0]);
		for (let i = stride; i < count; i += stride) ctx.lineTo(pathX[i], pathY[i]);
		const last = count - 1;
		if (last % stride !== 0) ctx.lineTo(pathX[last], pathY[last]);
		ctx.strokeStyle = 'rgba(255, 207, 110, 0.78)';
		ctx.lineWidth = 1.3 * px;
		ctx.setLineDash(PRED_DASH);
		ctx.stroke();
		ctx.setLineDash(NO_DASH);

		/* one dot per simulated second */
		ctx.fillStyle = 'rgba(255, 207, 110, 0.6)';
		for (let i = 119; i < count; i += 120) {
			ctx.beginPath();
			ctx.arc(pathX[i], pathY[i], 1.7 * px, 0, TAU);
			ctx.fill();
		}

		const ex = pathX[last];
		const ey = pathY[last];
		ctx.beginPath();
		ctx.arc(ex, ey, 5 * px, 0, TAU);
		ctx.strokeStyle = gravity.predReason === END_IMPACT ? GOLD : 'rgba(190, 210, 230, 0.65)';
		ctx.lineWidth = 1.2 * px;
		ctx.stroke();
		if (gravity.predReason === END_IMPACT) {
			ctx.beginPath();
			ctx.arc(ex, ey, 2 * px, 0, TAU);
			ctx.fillStyle = GOLD;
			ctx.fill();
		}
	}

	function drawTrail() {
		const count = gravity.trailCount;
		if (count < 2) return;
		const px = 1 / view.scale;
		const stride = count > 2400 ? 2 : 1;
		ctx.beginPath();
		ctx.moveTo(gravity.trailX[0], gravity.trailY[0]);
		for (let i = stride; i < count; i += stride) {
			ctx.lineTo(gravity.trailX[i], gravity.trailY[i]);
		}
		const last = count - 1;
		if (last % stride !== 0) ctx.lineTo(gravity.trailX[last], gravity.trailY[last]);
		ctx.strokeStyle = 'rgba(103, 224, 255, 0.9)';
		ctx.lineWidth = 1.8 * px;
		ctx.setLineDash(NO_DASH);
		ctx.stroke();
	}

	function drawCargo(now) {
		if (gravity.status === GravitySim.STATUS_IDLE) return;
		const px = 1 / view.scale;
		const x = gravity.cargo.x;
		const y = gravity.cargo.y;
		if (gravity.status === STATUS_FLYING) {
			const angle = Math.atan2(gravity.cargo.vy, gravity.cargo.vx);
			ctx.globalAlpha = 0.7;
			ctx.drawImage(glow, x - 18 * px, y - 18 * px, 36 * px, 36 * px);
			ctx.globalAlpha = 1;
			const size = 4.6 * px;
			ctx.beginPath();
			ctx.moveTo(x + Math.cos(angle) * size, y + Math.sin(angle) * size);
			ctx.lineTo(x + Math.cos(angle + 2.4) * size, y + Math.sin(angle + 2.4) * size);
			ctx.lineTo(x + Math.cos(angle - 2.4) * size, y + Math.sin(angle - 2.4) * size);
			ctx.closePath();
			ctx.fillStyle = GOLD;
			ctx.fill();
			ctx.strokeStyle = 'rgba(3, 8, 16, 0.8)';
			ctx.lineWidth = 0.8 * px;
			ctx.stroke();
			return;
		}
		const pulse = 0.5 + 0.5 * Math.sin(now * 0.006);
		ctx.globalAlpha = 0.55;
		ctx.drawImage(impactGlow, x - 16 * px, y - 16 * px, 32 * px, 32 * px);
		ctx.globalAlpha = 1;
		ctx.beginPath();
		ctx.arc(x, y, (5 + pulse * 4) * px, 0, TAU);
		ctx.strokeStyle = gravity.endReason === END_IMPACT ? GOLD : 'rgba(190, 210, 230, 0.6)';
		ctx.lineWidth = 1.2 * px;
		ctx.stroke();
	}

	function drawAim() {
		if (!armed && !aiming) return;
		const px = 1 / view.scale;
		const cx = tradeSim.planetX[aimBody];
		const cy = tradeSim.planetY[aimBody];
		GRIP_DASH[0] = 3 * px;
		GRIP_DASH[1] = 7 * px;
		ctx.beginPath();
		ctx.arc(cx, cy, GRIP_MAX, 0, TAU);
		ctx.strokeStyle = 'rgba(255, 207, 110, 0.10)';
		ctx.lineWidth = px;
		ctx.setLineDash(GRIP_DASH);
		ctx.stroke();
		ctx.setLineDash(NO_DASH);

		const sx = gravity.predCount > 0 ? gravity.predX[0] : cx;
		const sy = gravity.predCount > 0 ? gravity.predY[0] : cy;
		ctx.beginPath();
		ctx.moveTo(sx, sy);
		ctx.lineTo(gripX, gripY);
		ctx.strokeStyle = 'rgba(255, 207, 110, 0.82)';
		ctx.lineWidth = 1.2 * px;
		ctx.stroke();

		const size = (4 + (aimSpeed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN) * 4) * px;
		ctx.beginPath();
		ctx.arc(gripX, gripY, size, 0, TAU);
		ctx.fillStyle = 'rgba(255, 207, 110, 0.16)';
		ctx.fill();
		ctx.strokeStyle = GOLD;
		ctx.lineWidth = 1.4 * px;
		ctx.stroke();
		const tip = 11 * px;
		const side = 4.5 * px;
		ctx.beginPath();
		ctx.moveTo(gripX + Math.cos(aimAngle) * tip, gripY + Math.sin(aimAngle) * tip);
		ctx.lineTo(gripX + Math.cos(aimAngle + 2.5) * side,
			gripY + Math.sin(aimAngle + 2.5) * side);
		ctx.lineTo(gripX + Math.cos(aimAngle - 2.5) * side,
			gripY + Math.sin(aimAngle - 2.5) * side);
		ctx.closePath();
		ctx.fillStyle = GOLD;
		ctx.fill();
	}

	function drawMarkers() {
		const px = 1 / view.scale;
		for (let i = 0; i < gravity.bodyCount; i++) {
			if (i !== selected && i !== hoverBody) continue;
			ctx.beginPath();
			ctx.arc(gravity.bodyX[i], gravity.bodyY[i],
				gravity.bodyR[i] + 5 * px, 0, TAU);
			ctx.strokeStyle = i === selected ? GOLD : ICE;
			ctx.globalAlpha = 0.7;
			ctx.lineWidth = 1.2 * px;
			ctx.stroke();
			ctx.globalAlpha = 1;
		}
	}

	function drawLabel(text, wx, wy, colour, below) {
		if (!text) return;
		const sx = wx * view.scale + view.offX + 14;
		const sy = wy * view.scale + view.offY - 14 +
			(below ? gravity.bodyR[selected] * view.scale + 34 : 0);
		const width = 18 + text.length * 6.4;
		let x = sx;
		let y = sy - 16;
		if (x + width > window.innerWidth - 8) x = window.innerWidth - width - 8;
		if (y < 8) y = 8;
		plate(x, y, width, 18);
		ctx.fillStyle = colour;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
		ctx.fillText(text, x + 9, y + 9.5);
	}

	function drawGripLabel() {
		if (!aimLabel || (!armed && !aiming)) return;
		const sx = gripX * view.scale + view.offX + 16;
		const sy = gripY * view.scale + view.offY - 12;
		const width = 20 + aimLabel.length * 6.4;
		let x = sx;
		let y = sy - 18;
		if (x + width > window.innerWidth - 8) x = sx - width - 32;
		if (y < 8) y = sy + 22;
		plate(x, y, width, 20);
		ctx.fillStyle = fine ? ICE : GOLD;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
		ctx.fillText(aimLabel, x + 10, y + 10.5);
	}

	function draw(now) {
		const blocked = activeBlockedPlanet(now);
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
		ctx.save();
		ctx.translate(view.offX, view.offY);
		ctx.scale(view.scale, view.scale);
		drawSystemVisits(now);
		drawWells();
		drawPortVelocities();
		drawPrediction();
		drawTrail();
		drawLandedBase(now);
		if (blocked >= 0) drawBlockedArrowWorld(blocked, now);
		drawAim();
		drawCargo(now);
		drawMarkers();
		drawSigns();
		ctx.restore();
		if (hoverBody >= 0 && hoverBody !== selected && !aiming) {
			drawLabel(hoverLabel, gravity.bodyX[hoverBody],
				gravity.bodyY[hoverBody], ICE);
		}
		if (selected >= 0) {
			drawLabel(selectedLabel, gravity.bodyX[selected],
				gravity.bodyY[selected], GOLD,
				mode === MODE_PLANETS && (aiming || armed) && selected === aimBody);
		}
		if (gravity.landedBody >= 0 && !aiming &&
			!(mode === MODE_PLANETS && selected === gravity.landedBody)) {
			drawLabel('landed · launch here (' + planetName(gravity.landedBody) + ')',
				tradeSim.planetX[gravity.landedBody],
				tradeSim.planetY[gravity.landedBody], MINT);
		}
		if (blocked >= 0) drawBlockedTooltipScreen(blocked);
		drawGripLabel();
	}

	function formatClock(label, seconds) {
		const total = Math.floor(seconds * 10) / 10;
		const mins = Math.floor(total / 60);
		const secs = total - mins * 60;
		return label + ' + ' + (mins < 10 ? '0' : '') + mins + ':' +
			(secs < 10 ? '0' : '') + secs.toFixed(1);
	}

	function endText(reason, body) {
		if (reason === END_IMPACT) return 'impact ' + planetName(body);
		if (reason === END_EXIT) return 'left field';
		if (reason === END_TIME) return 'time cap';
		if (reason === END_TRUNCATED) return 'budget cap';
		if (reason === END_ABORT) return 'aborted';
		return 'open';
	}

	/* trajectory & visit readouts update immediately whenever changed */
	function updateLiveHud() {
		const text = aiming || armed ? aimLabel : '—';
		if (text !== hudAimText) {
			hudAimText = text;
			aimEl.textContent = text;
		}
		let tag = 'none selected';
		if (hoverBody >= 0 && !aiming) {
			tag = 'hover ' + bodyName(hoverBody) + ' · ' + strengthText(hoverBody);
		} else if (selected >= 0) tag = selectedLabel;
		if (tag !== hudTagText) {
			hudTagText = tag;
			bodyTagEl.textContent = tag;
		}
		const visitText = gravity.visitedCount + ' / ' + PLANETS;
		if (visitText !== hudVisitText) {
			hudVisitText = visitText;
			if (visitEl) visitEl.textContent = visitText;
		}
		const predText = gravity.predCount >= 2
			? gravity.predVisits + ' sys · +' + gravity.predNewVisits +
				' (' + (gravity.visitedCount + gravity.predNewVisits) + '/' + PLANETS + ')'
			: '—';
		if (predText !== hudPredVisitText) {
			hudPredVisitText = predText;
			if (predVisitEl) predVisitEl.textContent = predText;
		}
		const lenText = gravity.predCount >= 2 ? Math.round(gravity.predLength) + ' px' : '—';
		if (lenText !== hudLengthText) {
			hudLengthText = lenText;
			lengthEl.textContent = lenText;
		}
		const pText = gravity.predCount >= 2
			? gravity.predTime.toFixed(1) + ' s · ' + endText(gravity.predReason, gravity.predBody)
			: '—';
		if (pText !== hudPathText) {
			hudPathText = pText;
			pathEl.textContent = pText;
		}
		const locked = gameLocked();
		const trimOff = locked || (!armed && (game.on || selected < 0));
		if (trimSlider.disabled !== trimOff) trimSlider.disabled = trimOff;
		const exitWarning = (aiming || armed) && gravity.predCount >= 2 && gravity.predReason === END_EXIT;
		setLaunchState(locked || !armed || !gravity.canLaunchFrom(aimBody), exitWarning);
	}

	function setLaunchState(blocked, exitWarning) {
		const state = (blocked ? 1 : 0) + (exitWarning ? 2 : 0);
		if (state === launchState) return;
		launchState = state;
		launchButton.disabled = blocked;
		launchButton.classList.toggle('exitWarning', exitWarning);
		launchButton.textContent = exitWarning ? 'launch · leaves system' : 'launch';
		launchButton.title = exitWarning ? 'Warning: predicted trajectory ends outside the system' : '';
	}

	function statusText() {
		if (replay.on) return gravity.status === STATUS_FLYING ? 'replay · in flight' : 'replay · aiming';
		if (aiming) return 'aiming ' + planetName(aimBody);
		if (armed) return 'armed · ' + planetName(aimBody);
		if (gravity.status === STATUS_FLYING) return game.on ? 'in flight · clock runs' : 'in flight';
		if (game.on && game.doneSteps >= 0) return 'tour complete';
		const rest = gravity.status === STATUS_ENDED
			? endText(gravity.endReason, gravity.endBody)
			: gravity.landedBody >= 0 ? 'landed ' + planetName(gravity.landedBody) : 'ready';
		return game.on ? rest + ' · clock paused' : rest;
	}

	function updateHud(now) {
		if (now - hudAt < HUD_INTERVAL) return;
		hudAt = now;
		expClockEl.textContent = game.on
			? formatClock('game', gameSteps() * DT)
			: formatClock('exp', (now - expStart) / 1000);
		statusEl.textContent = statusText();
		if (game.on) updateGameHud();

		if (gravity.status === STATUS_IDLE) {
			flightEl.textContent = '—';
		} else {
			flightEl.textContent = gravity.flightTime.toFixed(2) + ' s · ' +
				Math.round(gravity.flightLength) + ' px';
		}

		calcEl.textContent = gravity.predCount >= 2
			? gravity.predSteps + ' steps · ' + gravity.predMs.toFixed(2) + ' ms'
			: '—';

		if (armed) trimTargetEl.textContent = 'aim speed';
		else if (selected >= 0) trimTargetEl.textContent = bodyName(selected) + ' g';
		else trimTargetEl.textContent = '—';
	}

	/* field clock and geometry follow the trade world; a game flight keeps its launch roster */
	function syncField() {
		gravity.fieldT = tradeSim.t;
		const rate = game.on ? scene.trade.speed : tradeRate();
		if (rate !== gravity.fieldRate) {
			gravity.fieldRate = rate;
			gravity.stepStale = true;
			if (!gravity.fieldStatic) fieldChanged();
		}
		const rosterLocked = game.on && gravity.status === STATUS_FLYING;
		if (mode === MODE_PORTS && !rosterLocked && syncPortRoster()) fieldChanged();
		if (!gravity.fieldStatic) gravity.refreshField();
	}

	function frame(now) {
		const frameStart = performance.now();
		const rawMs = now - lastFrame;
		if (rawMs > 0 && rawMs < 120) {
			emaFrameMs = emaFrameMs * 0.8 + rawMs * 0.2;
		}
		const dt = Math.min(0.1, rawMs / 1000);
		lastFrame = now;

		if (game.on) stepGame(now, dt);
		syncField();
		if (!game.on) gravity.step(dt);

		/* adaptive 60 fps budget: update every frame at 60 fps, throttle if slower */
		const interval = emaFrameMs <= FPS_DROP_MS ? 1 : emaFrameMs < 25 ? 2 : 4;
		lastAutoInterval = interval;
		const budgetMs = emaFrameMs <= FPS_DROP_MS
			? GravitySim.BUDGET_MS
			: Math.max(2, FPS_FRAME_MS - otherWorkMs - 1.5);
		autoSkip = autoSkip > 0 ? autoSkip - 1 : 0;

		const bodiesMoved = !gravity.fieldStatic && gravity.fieldT !== gravity.predFieldT;
		if (armed || aiming) {
			if (!dirty && bodiesMoved && autoSkip === 0) {
				dirty = true;
				autoSkip = interval - 1;
			}
			if (dirty) {
				gravity.predict(aimBody, aimAngle, aimSpeed, budgetMs);
				refreshAimLabel();
				dirty = false;
			}
		} else if (gravity.status === STATUS_FLYING) {
			if (dirty || autoSkip === 0) {
				gravity.predictFlight(budgetMs);
				dirty = false;
				autoSkip = interval - 1;
			}
		} else if (gravity.predCount > 0) {
			gravity.predCount = 0;
		}

		const renderStart = performance.now();
		draw(now);
		updateLiveHud();
		updateHud(now);
		otherWorkMs = otherWorkMs * 0.8 + (performance.now() - renderStart) * 0.2;
		const frameWork = performance.now() - frameStart;
		if (frameWork > FPS_FRAME_MS) {
			emaFrameMs = Math.max(emaFrameMs, frameWork);
		}
		requestAnimationFrame(frame);
	}

	gravitySlider.addEventListener('input', () => {
		if (selected < 0) return;
		if (setBodyStrength(selected, Number(gravitySlider.value))) {
			refreshSelected();
			refreshHoverLabel();
			fieldChanged();
		}
	});
	srcPlanetsEl.addEventListener('change', () => setMode(MODE_PLANETS));
	srcPortsEl.addEventListener('change', () => setMode(MODE_PORTS));
	trimSlider.addEventListener('input', onTrimInput);
	trimSlider.addEventListener('change', resetTrim);
	horizonSlider.addEventListener('input', () => {
		gravity.horizon = Number(horizonSlider.value);
		const text = gravity.horizon + ' s';
		horizonLabel.textContent = text;
		if (horizonTagEl) horizonTagEl.textContent = text;
		fieldChanged();
		hudAt = -Infinity;
	});
	launchButton.addEventListener('click', launch);
	clearButton.addEventListener('click', () => {
		if (game.on) abortFlight();
		else clearCargo();
	});
	modeLabEl.addEventListener('change', stopGame);
	modeGameEl.addEventListener('change', () => startGame(tradeSim.seed, false));
	gameRestartBtn.addEventListener('click', () => startGame(game.seed, game.fixedRate));
	gameNewSeedBtn.addEventListener('click', () => {
		startGame(1 + Math.floor(Math.random() * SEED_RANGE), false);
	});
	gameCopyBtn.addEventListener('click', copyLink);
	replaySpeedBtn.addEventListener('click', () => {
		replay.speed = (replay.speed + 1) % REPLAY_SPEEDS.length;
		refreshGameUi();
	});
	replaySkipBtn.addEventListener('click', skipReplay);
	window.addEventListener('hashchange', loadLink);
	if (helpBtn) {
		helpBtn.addEventListener('click', () => setHelpOpen(!helpPinned));
		helpBtn.addEventListener('pointerenter', event => {
			if (event.pointerType !== 'touch') setHelpOpen(true, true);
		});
		helpBtn.addEventListener('pointerleave', () => {
			if (!helpPinned) setHelpOpen(false, true);
		});
	}
	if (foldBtn && cargoHudEl) {
		foldBtn.addEventListener('click', () => {
			hudFolded = !hudFolded;
			cargoHudEl.classList.toggle('folded', hudFolded);
			foldBtn.textContent = hudFolded ? '+' : '−';
		});
	}
	if (helpClose) helpClose.addEventListener('click', () => setHelpOpen(false));
	if (rerollGoalBtn) rerollGoalBtn.addEventListener('click', () => rollPassenger(true));
	window.addEventListener('pointerdown', onPointerDown);
	window.addEventListener('pointermove', onPointerMove);
	window.addEventListener('pointerup', onPointerUp);
	window.addEventListener('pointercancel', onPointerUp);
	window.addEventListener('resize', resizeOverlay);
	window.addEventListener('keydown', event => {
		if (event.key === 'Shift') {
			fine = true;
			refreshAimLabel();
			return;
		}
		if (event.key === '?' || (event.code === 'KeyH' && !event.ctrlKey && !event.metaKey)) {
			const tag = event.target && event.target.tagName;
			if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
				setHelpOpen(!helpOpen);
				return;
			}
		}
		if (event.code === 'Enter') {
			if (!armed) return;
			event.preventDefault();
			launch();
			return;
		}
		if (event.code === 'Escape') {
			if (helpOpen) setHelpOpen(false);
			else if (!replay.on) cancelAim();
		}
	});
	window.addEventListener('keyup', event => {
		if (event.key !== 'Shift') return;
		fine = false;
		refreshAimLabel();
	});

	root.GravityScene = {
		sim: gravity,
		game: game,
		replay: replay,
		scoreSteps: scoreSteps,
		passenger: () => passenger,
		rollPassenger: rollPassenger,
		setHelpOpen: setHelpOpen,
		helpOpen: () => helpOpen,
		autoInterval: () => lastAutoInterval
	};

	rollPassenger(false);
	gravity.horizon = Number(horizonSlider.value);
	horizonLabel.textContent = gravity.horizon + ' s';
	if (horizonTagEl) horizonTagEl.textContent = gravity.horizon + ' s';

	mode = srcPortsEl.checked ? MODE_PORTS : MODE_PLANETS;
	gravity.fieldT = tradeSim.t;
	gravity.fieldRate = tradeRate();
	attachWorld();
	if (!loadLink()) refreshGameUi();

	resizeOverlay();
	refreshSelected();
	refreshAimLabel();
	updateLiveHud();
	updateHud(performance.now());
	requestAnimationFrame(frame);
})(typeof globalThis !== 'undefined' ? globalThis : this);

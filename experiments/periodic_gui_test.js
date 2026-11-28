/*
 * Step 4 & Step 5 periodic torus GUI, field/potential view, seam paint/input,
 * URL/replay/saved-map topology, designed-field refusal, radar seam and Voronoi
 * sound integration tests.
 *
 * Run: node experiments/periodic_gui_test.js
 */
'use strict';

const assert = require('assert');
const vm = require('vm');
const GravityFFT = require('../gravity_fft.js');
const GravitySim = require('../gravity_sim.js');
const GravityField = require('../gravity_field.js');
const OrbitWorld = require('../orbit_world.js');
const OrbitSim = require('../orbit_sim.js');
const GravityGame = require('../gravity_game.js');
const Voronoi = require('../gravity_voronoi_sound.js');
const { loadPage } = require('./dom_stub.js');

function check(cond, msg) {
	if (!cond) throw new Error(msg);
}

/* ── 1. Step 4: periodic GravityField static & moving CPU rasters + WebGL blit ── */
{
	const W = OrbitWorld.WORLD_W;
	const H = OrbitWorld.WORLD_H;
	const sim = new GravitySim(W, H);
	sim.setPeriodic(true);
	const bx = new Float64Array(192);
	const by = new Float64Array(192);
	const br = new Float64Array(192).fill(8);
	const str = new Float64Array(192);
	/* Place an attracting well near x = 6 and a repelling well near x = 800 */
	bx[0] = 6; by[0] = 500; str[0] = 3.0;
	bx[1] = 800; by[1] = 500; str[1] = -2.0;
	/* Also place a high-index well (>= 48) near y = 6 to prove >48 bodies participate */
	bx[120] = 400; by[120] = 6; str[120] = 2.5;
	const fillStatic = (_t, ox, oy, n) => {
		for (let i = 0; i < n; i++) { ox[i] = bx[i]; oy[i] = by[i]; }
	};
	sim.setField(192, br, str, fillStatic, true);

	let solves = 0;
	const origSolve = GravityFFT.solve;
	GravityFFT.solve = function () {
		solves++;
		return origSolve.apply(this, arguments);
	};
	try {
		const snap = sim.ensurePeriodicGrid();
		assert.strictEqual(solves, 1, 'initial ensurePeriodicGrid solves once');
		assert.ok(snap && snap.gridX === 256 && snap.gridY === 256);

		const view = { scale: 1, offX: 0, offY: 0, dpr: 1 };
		const rw = W, rh = H;
		const renderBuf = (m, s) => GravityField.renderBuffer(
			new Uint8ClampedArray(rw * rh * 4), rw, rh, s, view, rw, rh, m);
		const fieldPixels = renderBuf('field', sim);
		const potPixels = renderBuf('potential', sim);
		assert.strictEqual(solves, 1, 'static field + potential renderBuffer reuse cargoSim grid with 0 extra FFT solves');

		/* Changing gravityScale recolours without re-solving FFT */
		sim.setScales(2.0, 1.0);
		const scaledField = renderBuf('field', sim);
		const scaledPot = renderBuf('potential', sim);
		assert.strictEqual(solves, 1, 'gravityScale change does not re-solve FFT');
		sim.setScales(1.0, 1.0);

		let changedPixels = 0;
		for (let i = 0; i < fieldPixels.length; i += 64) {
			if (fieldPixels[i] !== scaledField[i] || fieldPixels[i + 1] !== scaledField[i + 1] ||
				fieldPixels[i + 2] !== scaledField[i + 2]) changedPixels++;
			if (potPixels[i + 3] !== scaledPot[i + 3]) changedPixels++;
		}
		check(changedPixels > 100, 'gravityScale recolours periodic field and potential buffers');

		/* Seam continuity: x = 0 (wx=0.5) and x = rw - 1 (wx=1599.5) straddle x = 0 / W by 1 px */
		const yMid = 500;
		const leftIdx = (yMid * rw + 0) * 4;
		const rightIdx = (yMid * rw + (rw - 1)) * 4;
		for (let c = 0; c < 3; c++) {
			const diff = Math.abs(fieldPixels[leftIdx + c] - fieldPixels[rightIdx + c]);
			check(diff <= 12, 'field seam continuity across x=0/W channel ' + c + ': diff=' + diff);
		}
		const yTopIdx = (0 * rw + 400) * 4;
		const yBotIdx = ((rh - 1) * rw + 400) * 4;
		for (let c = 0; c < 3; c++) {
			const diff = Math.abs(fieldPixels[yTopIdx + c] - fieldPixels[yBotIdx + c]);
			check(diff <= 12, 'field seam continuity across y=0/H channel ' + c + ': diff=' + diff);
		}

		/* Signed mean-zero potential polarity:
		 * near attracting well (6, 500) -> pixel (6, 500): green/red > blue
		 * near repelling well (800, 500) -> pixel (800, 500): blue > red */
		const attIdx = (500 * rw + 6) * 4;
		const repIdx = (500 * rw + 800) * 4;
		check(potPixels[attIdx + 3] > 60 &&
			Math.max(potPixels[attIdx], potPixels[attIdx + 1]) > potPixels[attIdx + 2],
			'attracting well in periodic potential is warm/green, not blue: ' +
			Array.from(potPixels.slice(attIdx, attIdx + 4)));
		check(potPixels[repIdx + 3] > 40 && potPixels[repIdx + 2] > potPixels[repIdx],
			'repelling well in periodic potential is blue: ' +
			Array.from(potPixels.slice(repIdx, repIdx + 4)));

		/* Moving-port periodic view (`fieldStatic = false`): zero FFT solves, >48 bodies active */
		const mView = { scale: 0.25, offX: 0, offY: 0, dpr: 1 };
		const mw = 400, mh = 250;
		const movingSim = new GravitySim(W, H);
		movingSim.setPeriodic(true);
		const mStr = new Float64Array(192);
		mStr[150] = 3.5;
		bx[150] = 8; by[150] = 500;
		movingSim.setField(192, br, mStr, fillStatic, false);
		const solvesBeforeMoving = solves;
		const movField = GravityField.renderBuffer(
			new Uint8ClampedArray(mw * mh * 4), mw, mh, movingSim, mView, mw, mh, 'field');
		const movPot = GravityField.renderBuffer(
			new Uint8ClampedArray(mw * mh * 4), mw, mh, movingSim, mView, mw, mh, 'potential');
		assert.strictEqual(solves, solvesBeforeMoving, 'moving periodic field/potential never calls GravityFFT.solve');
		/* Pixel across seam at x = mw - 1 (world x = 1598, 10 px from port 150 at x = 8) feels strong pull */
		const seamMovIdx = (125 * mw + (mw - 1)) * 4;
		const farMovIdx = (125 * mw + 200) * 4;
		const seamLum = movField[seamMovIdx] + movField[seamMovIdx + 1] + movField[seamMovIdx + 2];
		const farLum = movField[farMovIdx] + movField[farMovIdx + 1] + movField[farMovIdx + 2];
		check(seamLum > farLum + 80,
			'moving port #150 (>48) pulls strongly across seam: seamLum=' + seamLum + ' farLum=' + farLum);
		check(movPot[seamMovIdx + 3] > movPot[farMovIdx + 3] + 40,
			'moving port #150 (>48) potential well crosses seam');
	} finally {
		GravityFFT.solve = origSolve;
	}
}

/* Mock WebGL periodic texture-blit test: verifies gl.REPEAT + half-texel UV + aPos restore */
{
	const glCalls = { texImage2D: 0, drawArrays: 0, repeatS: 0, repeatT: 0, halfTexel: null, world: null };
	const uniforms = new Map();
	let activeProg = null;
	const mockGl = {
		VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
		ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TRIANGLE_STRIP: 8,
		TEXTURE_2D: 9, TEXTURE0: 10, TEXTURE_MIN_FILTER: 11, TEXTURE_MAG_FILTER: 12,
		TEXTURE_WRAP_S: 13, TEXTURE_WRAP_T: 14, LINEAR: 15, REPEAT: 16,
		CLAMP_TO_EDGE: 17, RGBA: 18, UNSIGNED_BYTE: 19, COLOR_BUFFER_BIT: 20,
		UNPACK_PREMULTIPLY_ALPHA_WEBGL: 21,
		createShader: () => ({}),
		shaderSource: () => {},
		compileShader: () => {},
		getShaderParameter: () => true,
		createProgram: () => ({ id: Math.random() }),
		attachShader: () => {},
		linkProgram: () => {},
		getProgramParameter: () => true,
		deleteShader: () => {},
		createBuffer: () => ({}),
		bindBuffer: () => {},
		bufferData: () => {},
		getAttribLocation: () => 0,
		enableVertexAttribArray: () => {},
		vertexAttribPointer: () => {},
		getUniformLocation: (prog, name) => {
			const loc = { prog, name };
			uniforms.set(loc, name);
			return loc;
		},
		createTexture: () => ({}),
		activeTexture: () => {},
		bindTexture: () => {},
		pixelStorei: () => {},
		texParameteri: (_target, pname, param) => {
			if (pname === 13 && param === 16) glCalls.repeatS++;
			if (pname === 14 && param === 16) glCalls.repeatT++;
		},
		texImage2D: () => { glCalls.texImage2D++; },
		viewport: () => {},
		clearColor: () => {},
		clear: () => {},
		useProgram: prog => { activeProg = prog; },
		uniform1i: () => {},
		uniform1f: () => {},
		uniform2f: (loc, x, y) => {
			if (loc && loc.name === 'uHalfTexel') glCalls.halfTexel = [x, y];
			if (loc && loc.name === 'uWorld') glCalls.world = [x, y];
		},
		uniform3fv: () => {},
		uniform4fv: () => {},
		drawArrays: () => { glCalls.drawArrays++; }
	};
	const prevDoc = globalThis.document;
	globalThis.document = {
		createElement: () => ({
			width: 0, height: 0,
			getContext: type => (type === '2d' ? {
				createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
				putImageData: () => {},
				clearRect: () => {},
				drawImage: () => {}
			} : null)
		})
	};
	try {
		const glCanvas = {
			width: 320, height: 200,
			addEventListener: () => {},
			getContext: type => (type === 'webgl' ? mockGl : null)
		};
		const renderer = GravityField.create(glCanvas);
		assert.strictEqual(renderer.backend(), 'webgl');
		renderer.setMode('field');

		const pSim = new GravitySim(1600, 1000);
		pSim.setPeriodic(true);
		const bx = new Float64Array([100, 900]);
		const by = new Float64Array([200, 700]);
		const br = new Float64Array([10, 10]);
		const st = new Float64Array([2.0, -1.0]);
		pSim.setField(2, br, st, (_t, ox, oy, n) => {
			for (let i = 0; i < n; i++) { ox[i] = bx[i]; oy[i] = by[i]; }
		}, true);

		const view = { dpr: 1, scale: 0.2, offX: 0, offY: 0 };
		renderer.render(pSim, view, 320, 200, true);
		assert.strictEqual(glCalls.texImage2D, 1, 'periodic static WebGL uploads 256x256 grid texture once');
		check(glCalls.repeatS >= 1 && glCalls.repeatT >= 1, 'periodic static WebGL sets gl.REPEAT on S and T');
		assert.deepStrictEqual(glCalls.world, [1600, 1000]);
		assert.deepStrictEqual(glCalls.halfTexel, [0.5 / 256, 0.5 / 256],
			'periodic WebGL shader applies half-texel seam offset (0.5/gridX, 0.5/gridY)');

		/* Cached frame blit on view pan does NOT re-upload texture unless grid/scale changed */
		view.offX = 12;
		renderer.render(pSim, view, 320, 200, true);
		assert.strictEqual(glCalls.texImage2D, 1, 'panning blits cached periodic texture without re-upload');

		/* Switching back to classic sim draws cleanly via classic WebGL program */
		pSim.setPeriodic(false);
		renderer.invalidate();
		const drawsBefore = glCalls.drawArrays;
		renderer.render(pSim, view, 320, 200, true);
		assert.strictEqual(glCalls.drawArrays, drawsBefore + 1, 'classic WebGL draw works after periodic blit');
		assert.ok(activeProg !== null);
	} finally {
		globalThis.document = prevDoc;
	}
}
console.log('step 4 field/potential CPU + WebGL seam/scale/moving checks ok');

/* ── 2. Step 4 & Step 5 page UI, seam polylines, wrap ghosts, min-image aim & hit-tests ── */
{
	const page = loadPage({ search: '?mode=lab&seed=7' });
	const ctx = page.context;
	const ui = page.elements;
	const gs = ctx.GravityScene;
	page.runFrames(2);

	/* Off state */
	const expPeriodic = ui.get('expPeriodic');
	const viewFullLabel = ui.get('viewFullLabel');
	const planetInput = ui.get('planetCountInput');
	check(Boolean(expPeriodic), 'expPeriodic checkbox present');
	assert.strictEqual(expPeriodic.checked, false);
	assert.strictEqual(gs.periodic(), false);
	assert.strictEqual(gs.periodicGrid(), null);
	assert.strictEqual(viewFullLabel.hidden, false, 'classic: full view visible');
	assert.strictEqual(String(planetInput.max), '48', 'classic: planet max 48');
	check(!ui.get('expTag').textContent.includes('fft'), 'classic: expTag omits fft');

	/* Route disables periodic checkbox */
	gs.setPlayMode('route');
	page.runFrames(2);
	assert.strictEqual(expPeriodic.disabled, true, 'route disables periodic checkbox');
	assert.match(expPeriodic.title, /route/i, 'disabled periodic checkbox explains route lock');
	assert.strictEqual(gs.setPeriodic(true), false, 'setPeriodic(true) refused in route');
	assert.strictEqual(gs.periodic(), false);

	/* Back to lab -> tick periodic checkbox */
	gs.setPlayMode('lab');
	page.runFrames(2);
	assert.strictEqual(expPeriodic.disabled, false);
	expPeriodic.checked = true;
	page.fireElement(expPeriodic, 'change', {});
	page.runFrames(2);

	assert.strictEqual(gs.periodic(), true, 'checkbox enables periodicMode');
	assert.strictEqual(viewFullLabel.hidden, true, 'periodic: full view hidden');
	assert.strictEqual(String(planetInput.max), '192', 'periodic: planet max 192');
	assert.strictEqual(gs.planetCount(), 104, 'periodic lab default is 104 worlds');
	assert.match(ui.get('expTag').textContent, / · fft$/, 'periodic: expTag carries · fft');
	assert.strictEqual(new URL(ctx.location.href).searchParams.get('fft'), '1', 'syncSeedUrl writes fft=1');

	/* Route radio locked & setPlayMode('route') refused while periodic */
	assert.strictEqual(ui.get('modeRoute').disabled, true, 'modeRoute disabled while periodic');
	gs.setPlayMode('route');
	assert.strictEqual(gs.playMode(), 'lab', 'setPlayMode(route) refused while periodic');

	/* View tags in periodic static vs moving ports */
	gs.setViewMode('field');
	assert.strictEqual(ui.get('viewTag').textContent, 'hue · grad · FFT');
	gs.setViewMode('potential');
	assert.strictEqual(ui.get('viewTag').textContent, 'periodic φ · FFT');

	/* Trigger a field sample so periodicGrid() is populated, check revision stability on gs change */
	gs.sim.ensurePeriodicGrid();
	const grid1 = gs.periodicGrid();
	check(grid1 && grid1.gridX === 256 && grid1.gridY === 256 && Number.isInteger(grid1.revision),
		'GravityScene.periodicGrid() exposes immutable 256x256 snapshot');
	ui.get('expGravity').value = '1.5';
	page.fireElement(ui.get('expGravity'), 'input', {});
	assert.strictEqual(gs.periodicGrid(), grid1, 'g field slider does not invalidate periodicGrid snapshot');
	ui.get('expGravity').value = '1';
	page.fireElement(ui.get('expGravity'), 'input', {});

	/* Moving ports: periodicGrid() returns null, viewTag switches to 1/4 */
	ui.get('srcPorts').checked = true;
	ui.get('srcPlanets').checked = false;
	page.fireElement(ui.get('srcPorts'), 'change', {});
	assert.strictEqual(gs.periodicGrid(), null, 'moving ports periodicGrid() is null');
	assert.strictEqual(ui.get('viewTag').textContent, 'periodic φ · 1/4');
	ui.get('srcPlanets').checked = true;
	ui.get('srcPorts').checked = false;
	page.fireElement(ui.get('srcPlanets'), 'change', {});
	gs.setViewMode('space');

	/* Seam polyline split & ghost wrap geometry helpers */
	const ops = [];
	const overlayCtx = vm.runInContext('ctx', ctx);
	const origMoveTo = overlayCtx.moveTo;
	const origLineTo = overlayCtx.lineTo;
	overlayCtx.moveTo = (x, y) => ops.push(['M', Math.round(x), Math.round(y)]);
	overlayCtx.lineTo = (x, y) => ops.push(['L', Math.round(x), Math.round(y)]);
	try {
		const seamXs = new Float64Array([1590, 1598, 4, 14]);
		const seamYs = new Float64Array([500, 500, 500, 500]);
		vm.runInContext('traceWorldPolyline', ctx)(seamXs, seamYs, 4, 1);
	} finally {
		overlayCtx.moveTo = origMoveTo;
		overlayCtx.lineTo = origLineTo;
	}
	/* Crossing 1598 -> 4 must NOT draw a direct chord 1598 -> 4 without seam split */
	const hasFullChord = ops.some((op, idx) =>
		op[0] === 'L' && idx > 0 && Math.abs(op[1] - ops[idx - 1][1]) > 800);
	assert.strictEqual(hasFullChord, false, 'traceWorldPolyline splits seam crossing without full-width chord');
	check(ops.filter(op => op[0] === 'M').length >= 2, 'traceWorldPolyline starts a new subpath across seam');

	let cornerCopies = 0;
	let centerCopies = 0;
	vm.runInContext('forWorldWraps', ctx)(5, 5, 12, 12, () => { cornerCopies++; });
	vm.runInContext('forWorldWraps', ctx)(800, 500, 12, 12, () => { centerCopies++; });
	assert.strictEqual(cornerCopies, 4, 'corner circle straddling both edges blits 4 wrapped copies');
	assert.strictEqual(centerCopies, 1, 'interior circle blits 1 copy');

	/* Minimum-image hit-testing & aiming across x = 0 / W seam */
	ctx.OrbitScene.sim.planetX[0] = 6;
	ctx.OrbitScene.sim.planetY[0] = 500;
	gs.sim.planetX[0] = 6;
	gs.sim.planetY[0] = 500;
	gs.sim.bodyX[0] = 6;
	gs.sim.bodyY[0] = 500;
	assert.strictEqual(vm.runInContext('planetAt(1598, 500)', ctx), 0,
		'planetAt finds planet at x=6 from wrapped pointer at x=1598');
	assert.strictEqual(vm.runInContext('bodyAt(1598, 500)', ctx), 0,
		'bodyAt finds body at x=6 from wrapped pointer at x=1598');

	vm.runInContext('aimBody = 0; aiming = true; gripX = 1576; gripY = 500; updateAim();', ctx);
	const aim = gs.aimState();
	/* From x = 6 aiming toward wrapped x = 1576 is dx = -30 -> angle = pi (+/- tiny) */
	check(Math.abs(Math.cos(aim.angle) - (-1)) < 1e-6,
		'updateAim across seam points west (cos=-1), got angle=' + aim.angle);
	check(aim.grip > 10 && aim.grip < 40, 'updateAim across seam uses 30 px min-image drag, not 1570 px: ' + aim.grip);
}
console.log('step 4/5 UI, viewTag, periodicGrid, seam split & min-image aim/hit checks ok');

/* ── 3. Tour boot with &fft=1 wraps a shot across seam + 3-digit link round-trip ── */
{
	const tourPage = loadPage({ search: '?mode=tour&seed=5&fft=1&bot=off' });
	const ctx = tourPage.context;
	const gs = ctx.GravityScene;
	tourPage.runFrames(2);
	assert.strictEqual(gs.periodic(), true);
	assert.strictEqual(gs.playMode(), 'tour');
	assert.strictEqual(gs.planetCount(), 104);

	/* Find a planet near an edge and fire straight across the seam at max speed */
	let edgePlanet = 0;
	let bestEdgeDist = Infinity;
	for (let i = 0; i < 104; i++) {
		const x = gs.sim.planetX[i];
		const d = Math.min(x, OrbitWorld.WORLD_W - x);
		if (d < bestEdgeDist) { bestEdgeDist = d; edgePlanet = i; }
	}
	const goEast = gs.sim.planetX[edgePlanet] > OrbitWorld.WORLD_W * 0.5;
	const angle = goEast ? 0 : Math.PI;
	vm.runInContext(`
		aimBody = ${edgePlanet};
		aimAngle = ${angle};
		aimSpeed = GravitySim.SPEED_MAX;
		placeGripFromSpeed();
		armed = true;
		predictShot();
	`, ctx);
	assert.notStrictEqual(gs.sim.predReason, GravitySim.END_EXIT,
		'periodic tour prediction never terminates with END_EXIT');
	tourPage.click('launch');
	let wrapped = false;
	let prevX = gs.sim.cargo.x;
	for (let f = 0; f < 120 && gs.sim.status === GravitySim.STATUS_FLYING; f++) {
		tourPage.runFrames(1, 16);
		const curX = gs.sim.cargo.x;
		if (Math.abs(curX - prevX) > OrbitWorld.WORLD_W * 0.5) wrapped = true;
		prevX = curX;
	}
	check(wrapped, 'periodic tour flight wrapped across x=0/W seam');
	assert.notStrictEqual(gs.sim.endReason, GravitySim.END_EXIT,
		'periodic tour flight never ends with END_EXIT');

	/* Copy link from high-index planet (>99) and replay on a fresh classic-default page */
	if (gs.sim.status === GravitySim.STATUS_FLYING) {
		for (let f = 0; f < 2000 && gs.sim.status === GravitySim.STATUS_FLYING; f++) {
			tourPage.runFrames(4, 16);
		}
	}
	tourPage.click('gameCopy');
	const copiedUrl = tourPage.clipboardText;
	const hash = copiedUrl.slice(copiedUrl.indexOf('#'));
	assert.match(hash, /&fft=1/, 'copied periodic tour replay link carries &fft=1');

	const replayPage = loadPage({ search: '?mode=lab&seed=1', hash });
	assert.strictEqual(replayPage.context.GravityScene.periodic(), true,
		'loading #...&fft=1 hash switches fresh page to periodic before replay');
	for (let f = 0; f < 2500 && vm.runInContext('replay.on', replayPage.context); f++) {
		replayPage.runFrames(4, 16);
	}
	assert.match(replayPage.elements.get('replayReadout').textContent, /verified ✓/,
		'periodic tour replay verifies identically: ' + replayPage.elements.get('replayReadout').textContent);

	/* Route + fft rejection in query & hash */
	const badQueryPage = loadPage({ search: '?mode=route&seed=5&fft=1' });
	assert.notStrictEqual(badQueryPage.context.GravityScene.playMode(), 'route',
		'?mode=route&fft=1 is rejected');
	assert.strictEqual(GravityGame.decodeLink('#game=1&seed=5&rate=1&rule=route&fft=1&shots=00:0000.000'), null,
		'decodeLink rejects rule=route with fft=1');
}
console.log('step 5 tour seam flight, &fft=1 link replay & route+fft refusal ok');

/* ── 4. Saved start/run maps, compact & full career replay, picker & designed-field refusal ── */
{
	/* Build a fast 12-world periodic career with high-index sparse planets (including 100, 191) */
	const maskBits = new Array(OrbitWorld.PLANETS).fill('0');
	const chosen = [0, 1, 2, 3, 10, 20, 45, 72, 100, 130, 160, 191];
	for (const p of chosen) maskBits[p] = '1';
	const customPeriodicStart = {
		v: 1, kind: 'start', name: 'periodic sparse 12',
		fft: true, seed: 11, universe: 12,
		seats: [100, 191], targetPay: 1.4,
		rule: 'career', bot: 'easy', player: 'bot',
		cheat: null, startMode: 'planet',
		rate: 1, gs: 1, fs: 1, ws: 1, ps: 1, rs: 1, ys: 1, ht: false,
		state: { mask: maskBits.join('') }
	};

	/* Classic page restores periodic topology before seating high-index HQs (100, 191) */
	const careerPage = loadPage({ search: '?mode=lab&seed=1' });
	assert.strictEqual(careerPage.context.GravityScene.periodic(), false);
	assert.ok(careerPage.context.startMapRecord(customPeriodicStart),
		'classic page loads periodic saved start with seats [100, 191]');
	assert.strictEqual(careerPage.context.GravityScene.periodic(), true);
	assert.strictEqual(careerPage.context.GravityScene.career.hq, 100);
	assert.strictEqual(careerPage.context.GravityScene.bot.rivals[0].career.hq, 191);

	/* Saved-map picker filters by topology: classic SAVED_MAPS hidden while periodic,
	 * newly saved periodic start & run appear while periodic and hide when classic */
	assert.strictEqual(careerPage.elements.get('mapPick').disabled, true,
		'classic SAVED_MAPS excluded from periodic picker');
	assert.strictEqual(careerPage.elements.get('mapLoad').disabled, true,
		'mapLoad disabled when no periodic saved map exists yet');

	/* Advance until at rest, test radar near seam & save start + run + replays */
	for (let i = 0; i < 400 && vm.runInContext('careerAtRest() !== ""', careerPage.context); i++) {
		careerPage.runFrames(4, 16);
	}
	/* Save start map & run state if at rest */
	const savedStart = careerPage.context.saveStartMap();
	assert.strictEqual(savedStart.fft, true, 'saveStartMap records fft: true');
	assert.strictEqual(careerPage.elements.get('mapPick').disabled, false,
		'periodic picker enables once a periodic map is saved');
	assert.strictEqual(careerPage.elements.get('mapLoad').disabled, false,
		'mapLoad enables once a periodic start map is saved');

	/* Radar seam check (§8): build/grant radar, place flying rival crossing seam, draw cleanly */
	vm.runInContext(`
		game.career.radar = true;
		predRivalsOn = true;
	`, careerPage.context);
	careerPage.runFrames(8, 16);

	/* Copy compact career actions + full career replay and restore each onto a classic page */
	careerPage.click('gameCopy');
	const actionsPayload = careerPage.clipboardText;
	const decodedActions = careerPage.context.CareerActions.decode(actionsPayload);
	assert.strictEqual(decodedActions.fft, true, 'CareerActions encodes fft: true');
	assert.deepStrictEqual(Array.from(decodedActions.seats), [100, 191]);

	careerPage.click('careerSaveCopy');
	const fullPayload = careerPage.clipboardText;
	const movieEncoded = fullPayload.includes('#')
		? new URLSearchParams(fullPayload.split('#')[1]).get('replay')
		: fullPayload.replace(/^gravity-career:/, '');
	const decodedMovie = careerPage.context.CareerReplay.decode(movieEncoded);
	assert.ok(decodedMovie && decodedMovie.start.fft === true, 'CareerReplay encodes start.fft === true');

	const actionsRestore = loadPage({ search: '?mode=lab&seed=1' });
	actionsRestore.elements.get('replayInput').value = actionsPayload;
	actionsRestore.click('replayLoad');
	assert.strictEqual(actionsRestore.elements.get('replayLoadNote').textContent, 'replay opened');
	assert.strictEqual(actionsRestore.context.GravityScene.periodic(), true,
		'CareerActions restores periodic topology on classic page');
	assert.strictEqual(actionsRestore.context.GravityScene.career.hq, 100);

	const movieRestore = loadPage({ search: '?mode=lab&seed=1' });
	movieRestore.elements.get('replayInput').value = fullPayload;
	movieRestore.click('replayLoad');
	assert.strictEqual(movieRestore.elements.get('replayLoadNote').textContent, 'replay opened');
	assert.strictEqual(movieRestore.context.GravityScene.periodic(), true,
		'CareerReplay restores periodic topology on classic page');
	assert.strictEqual(movieRestore.context.GravityScene.career.hq, 100);

	/* CareerReplay seam ship interpolation: crossing 1596 -> 4 at ratio=0.5 lands at 0, not 800 */
	vm.runInContext(`
		careerRecording.movie = { frames: [{ t: 1, d: [] }] };
		careerRecording.index = 0;
		careerRecording.elapsed = 0.5;
		careerRecording.current = {
			state: {
				run: { shots: [{}] }, rivals: [],
				ships: [{ status: GravitySim.STATUS_FLYING, liveSteps: 10, cargo: { x: 1596, y: 998, vx: 40, vy: 20 } }]
			}
		};
		careerRecording.next = {
			state: {
				run: { shots: [{}] }, rivals: [],
				ships: [{ status: GravitySim.STATUS_FLYING, liveSteps: 15, cargo: { x: 4, y: 2, vx: 40, vy: 20 } }]
			}
		};
		interpolateCareerShips();
	`, movieRestore.context);
	const interpCargo = movieRestore.context.GravityScene.sim.cargo;
	check((interpCargo.x < 10 || interpCargo.x > 1590) && (interpCargo.y < 10 || interpCargo.y > 990),
		'interpolateCareerShips wraps across seam instead of jumping through center: ' +
		interpCargo.x + ',' + interpCargo.y);

	/* applySeats refuses to inject a classic opening into a periodic world */
	const tSim = new OrbitSim(1, { periodic: true });
	const pSim = new GravitySim(OrbitWorld.WORLD_W, OrbitWorld.WORLD_H);
	pSim.setPeriodic(true);
	const gal = GravityGame.createGalaxy();
	GravityGame.resetGalaxy(gal, 1);
	const mask13 = new Uint8Array(OrbitWorld.PLANETS);
	mask13.fill(1, 0, 13);
	const Maps = require('../saved_map.js');
	const SAVED = require('../saved_maps.js');
	Maps.arm(SAVED[0]);
	assert.strictEqual(Maps.applySeats(gal, tSim.world, tSim, mask13, 13, SAVED[0].seats.length, pSim), null,
		'applySeats refuses classic saved opening on a periodic sim');
	Maps.disarm();

	/* Designed field refusals: classic field in periodic mode + partial periodic field */
	const pFieldPage = loadPage({ search: '?mode=lab&seed=3&fft=1' });
	assert.strictEqual(pFieldPage.context.GravityScene.periodic(), true);
	const classicDesigned = {
		v: 1, kind: 'field', name: 'classic 8', seed: 3, universe: 8,
		seats: [0, 1], targetPay: 1.2, rule: 'career', bot: 'easy', player: 'user',
		gravity: [1, 1, 0.8, 1.2, 0.5, 1.4, 0.9, 1.1]
	};
	pFieldPage.context.MAP_FIELDS.push(classicDesigned);
	pFieldPage.context.refreshMapsUi();
	assert.strictEqual(pFieldPage.context.loadSavedMap('start'), false,
		'classic designed field without fft: true is refused by periodic loader');
	assert.match(pFieldPage.elements.get('mapNote').textContent, /periodic/i);
	pFieldPage.context.MAP_FIELDS.length = 0;

	/* Direct startMapRecord on a classic designed field switches topology back to classic
	 * rather than silently loading classic seats/wells into a periodic world */
	assert.strictEqual(pFieldPage.context.startMapRecord(classicDesigned), true);
	assert.strictEqual(pFieldPage.context.GravityScene.periodic(), false,
		'direct startMapRecord restores classic topology before applying classic designed field');
	pFieldPage.context.GravityScene.setPeriodic(true);
	assert.strictEqual(pFieldPage.context.GravityScene.periodic(), true);

	const partialPeriodicDesigned = {
		v: 1, kind: 'field', fft: true, name: 'partial 12', seed: 3, universe: 12,
		seats: [0, 1], targetPay: 1.2, rule: 'career', bot: 'easy', player: 'user',
		gravity: [1, 1, 0.8, 1.2, 0.5, 1.4, 0.9, 1.1]
	};
	assert.strictEqual(pFieldPage.context.startMapRecord(partialPeriodicDesigned), false,
		'periodic designed field supplying fewer wells than universe is refused');
	assert.match(pFieldPage.elements.get('mapNote').textContent, /8 of 12/);

	const fullPeriodicDesigned = {
		v: 1, kind: 'field', fft: true, name: 'full periodic 8', seed: 3, universe: 8,
		seats: [0, 1], targetPay: 1.2, rule: 'career', bot: 'easy', player: 'user',
		gravity: [1, 1, 0.75, 1.25, -0.35, 1.4, 0.9, 2.1]
	};
	assert.strictEqual(pFieldPage.context.startMapRecord(fullPeriodicDesigned), true,
		'valid periodic designed field boots cleanly');
	assert.strictEqual(pFieldPage.context.setPlanetUniverseSize(10), false,
		'growing universe past armed designed field explicit wells is refused (no silent reroll)');
	assert.match(pFieldPage.elements.get('mapNote').textContent, /only supplies 8 wells/);
}
console.log('step 5 saved maps, career replays, topology isolation & designed-field checks ok');

/* ── 5. Voronoi sound minimum-image distance, seam adjacency & pan ── */
{
	class Param {
		constructor(v = 0) { this.value = v; }
		setValueAtTime(v) { this.value = v; }
		setTargetAtTime(v) { this.value = v; }
		cancelScheduledValues() {}
	}
	class Node {
		constructor(kind, list) {
			this.kind = kind;
			this.gain = new Param(1);
			this.frequency = new Param(440);
			this.pan = new Param(0);
			this.Q = new Param(0.7);
			list.push(this);
		}
		connect(n) { this.to = n; return n; }
		start() {}
	}
	class MockAudio {
		constructor() { this.currentTime = 1; this.nodes = []; this.destination = {}; }
		createGain() { return new Node('gain', this.nodes); }
		createOscillator() { return new Node('osc', this.nodes); }
		createStereoPanner() { return new Node('pan', this.nodes); }
		createBiquadFilter() { return new Node('filter', this.nodes); }
	}

	const seamSim = {
		periodic: true, worldW: 1600, worldH: 1000,
		cargo: { x: 1595, y: 500, vx: 0, vy: 50 },
		angle: Math.PI * 0.5,
		planetCount: 2,
		planetX: [5, 800],
		planetY: [500, 500],
		planetMask: null
	};
	assert.strictEqual(Voronoi.adjacent(seamSim, 0, 1), true,
		'periodic Voronoi adjacency holds across seam');
	const actx = new MockAudio();
	const vor = Voronoi.create(actx, actx.destination, 1, 'distance');
	vor.update(seamSim);
	const carrier = actx.nodes.find(n => n.kind === 'osc' && n.to && n.to.kind === 'filter');
	const panNode = actx.nodes.find(n => n.kind === 'pan' && n.pan.value !== 0);
	/* Ship at 1595, planet 0 at 5 -> min-image distance is 10 px, not 1590 px */
	const wantFreq = Voronoi.distanceFrequency(10);
	check(Math.abs(carrier.frequency.value - wantFreq) < 1e-6,
		'Voronoi distance across seam is 10 px (freq=' + carrier.frequency.value + ' want=' + wantFreq + ')');
	check(panNode && Math.abs(panNode.pan.value) <= 0.95 + 1e-9 && panNode.pan.value < -0.4,
		'Voronoi stereo pan across seam is bounded and signed for planet 10 px east of northbound ship: ' +
		(panNode && panNode.pan.value));
}
console.log('step 5 Voronoi min-image distance & stereo pan ok');
console.log('PERIODIC GUI TEST OK');

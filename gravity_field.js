/* Gravity field backdrop: hue = pull direction, lightness = potential gradient */
(function (root) {
	'use strict';

	const MU = 400000;
	const SOFT2 = 3600;
	const MAX_BODIES = 32;
	const LOW_DIV = 4;
	const SLOW_LIMIT = 6;
	const TAU = Math.PI * 2;
	const INV_TAU = 1 / TAU;
	const SAT = 0.88;
	const L_MAX = 0.56;
	const G_REF = 40;
	const G_KNEE = Math.pow(G_REF, 1.5);
	const BASE_R = 2;
	const BASE_G = 6;
	const BASE_B = 12;

	const KERN_SHIFT = 6;
	const KERN_STEP = 1 << KERN_SHIFT;
	const KERN_N = 131072;
	const HUE_MASK = 1023;
	const HUE_N = HUE_MASK + 1;
	const L_N = 8192;
	const L_G2_STEP = 2;

	const VERT_SRC = [
		'attribute vec2 aPos;',
		'void main() {',
		'	gl_Position = vec4(aPos, 0.0, 1.0);',
		'}'
	].join('\n');

	const FRAG_SRC = [
		'#ifdef GL_FRAGMENT_PRECISION_HIGH',
		'precision highp float;',
		'#else',
		'precision mediump float;',
		'#endif',
		'uniform vec2 uOrigin;',
		'uniform vec2 uStep;',
		'uniform int uCount;',
		'uniform vec3 uBodies[' + MAX_BODIES + '];',
		'const float SOFT2 = 3600.0;',
		'const float INV_TAU = 0.15915494309189535;',
		'const float L_MAX = 0.56;',
		'const float G_KNEE = 252.98221281347034;',
		'const float SAT = 0.88;',
		'const vec3 BASE = vec3(2.0 / 255.0, 6.0 / 255.0, 12.0 / 255.0);',
		'vec3 hsl2rgb(float h, float s, float l) {',
		'	vec3 u = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);',
		'	float c = (1.0 - abs(2.0 * l - 1.0)) * s;',
		'	return (u - 0.5) * c + l;',
		'}',
		'void main() {',
		'	vec2 w = uOrigin + gl_FragCoord.xy * uStep;',
		'	vec2 acc = vec2(0.0);',
		'	for (int i = 0; i < ' + MAX_BODIES + '; i++) {',
		'		if (i >= uCount) break;',
		'		vec3 b = uBodies[i];',
		'		vec2 d = b.xy - w;',
		'		float r2 = dot(d, d) + SOFT2;',
		'		float inv = inversesqrt(r2);',
		'		acc += d * (b.z * inv * inv * inv);',
		'	}',
		'	float g2 = dot(acc, acc);',
		'	if (g2 <= 1e-12) {',
		'		gl_FragColor = vec4(BASE, 1.0);',
		'		return;',
		'	}',
		'	float g = sqrt(g2);',
		'	float g15 = g * sqrt(g);',
		'	float l = L_MAX * g15 / (g15 + G_KNEE);',
		'	float h = fract(atan(acc.y, acc.x) * INV_TAU);',
		'	float fade = max(0.0, 1.0 - 2.0 * l);',
		'	gl_FragColor = vec4(clamp(hsl2rgb(h, SAT, l) + BASE * fade, 0.0, 1.0), 1.0);',
		'}'
	].join('\n');

	let tables = null;

	function hueUnit(h6) {
		const t = ((h6 % 6) + 6) % 6;
		const v = Math.abs(t - 3) - 1;
		return v < 0 ? 0 : v > 1 ? 1 : v;
	}

	function clampByte(v) {
		const n = Math.round(v);
		return n < 0 ? 0 : n > 255 ? 255 : n;
	}

	/* reference mapping for tests and probes: direction -> hue [0,1), |g| -> light */
	function sampleColor(ax, ay, out) {
		const g2 = ax * ax + ay * ay;
		if (g2 <= 1e-12) {
			out.hue = 0;
			out.light = 0;
			out.r = BASE_R;
			out.g = BASE_G;
			out.b = BASE_B;
			return out;
		}
		const mag = Math.sqrt(g2);
		const g15 = mag * Math.sqrt(mag);
		const light = L_MAX * g15 / (g15 + G_KNEE);
		const raw = Math.atan2(ay, ax) * INV_TAU;
		const hue = raw - Math.floor(raw);
		const c = (1 - Math.abs(2 * light - 1)) * SAT;
		const m = light - 0.5 * c;
		const fade = light < 0.5 ? 1 - 2 * light : 0;
		out.hue = hue;
		out.light = light;
		out.r = clampByte((hueUnit(hue * 6) * c + m) * 255 + BASE_R * fade);
		out.g = clampByte((hueUnit(hue * 6 + 4) * c + m) * 255 + BASE_G * fade);
		out.b = clampByte((hueUnit(hue * 6 + 2) * c + m) * 255 + BASE_B * fade);
		return out;
	}

	function ensureTables() {
		if (tables !== null) return tables;
		const kern = new Float32Array(KERN_N);
		for (let i = 0; i < KERN_N; i++) {
			const r2 = (i + 0.5) * KERN_STEP + SOFT2;
			kern[i] = 1 / (r2 * Math.sqrt(r2));
		}
		const hueR = new Float32Array(HUE_N);
		const hueG = new Float32Array(HUE_N);
		const hueB = new Float32Array(HUE_N);
		for (let i = 0; i < HUE_N; i++) {
			const h6 = (i / HUE_N) * 6;
			hueR[i] = hueUnit(h6);
			hueG[i] = hueUnit(h6 + 4);
			hueB[i] = hueUnit(h6 + 2);
		}
		const lC = new Float32Array(L_N);
		const lMR = new Float32Array(L_N);
		const lMG = new Float32Array(L_N);
		const lMB = new Float32Array(L_N);
		for (let i = 0; i < L_N; i++) {
			const g = Math.sqrt(i * L_G2_STEP);
			const g15 = g * Math.sqrt(g);
			const l = L_MAX * g15 / (g15 + G_KNEE);
			const c = (1 - Math.abs(2 * l - 1)) * SAT;
			const m = (l - 0.5 * c) * 255;
			const fade = l < 0.5 ? 1 - 2 * l : 0;
			lC[i] = c * 255;
			lMR[i] = m + BASE_R * fade;
			lMG[i] = m + BASE_G * fade;
			lMB[i] = m + BASE_B * fade;
		}
		tables = { kern, hueR, hueG, hueB, lC, lMR, lMG, lMB };
		return tables;
	}

	/* octant minimax atan2 index in [0, HUE_N) with <0.15 deg max error, zero trig */
	function hueIndex(ax, ay) {
		const x = ax < 0 ? -ax : ax;
		const y = ay < 0 ? -ay : ay;
		let a;
		if (x >= y) {
			const q = y / x;
			a = q * (0.125 + 0.04345 * (1 - q));
		} else {
			const q = x / y;
			a = 0.25 - q * (0.125 + 0.04345 * (1 - q));
		}
		if (ax < 0) a = 0.5 - a;
		if (ay < 0) a = 1 - a;
		return (a * HUE_N) & HUE_MASK;
	}

	/* fills an RGBA Uint8ClampedArray (w x h) for tests and the 1/4-res 2D fallback */
	function rasterize2D(pixels, w, h, sim, view, cssW, cssH, scratch) {
		const lut = ensureTables();
		const kern = lut.kern;
		const hueR = lut.hueR;
		const hueG = lut.hueG;
		const hueB = lut.hueB;
		const lC = lut.lC;
		const lMR = lut.lMR;
		const lMG = lut.lMG;
		const lMB = lut.lMB;
		const axRow = scratch.axRow;
		const ayRow = scratch.ayRow;
		const dxTab = scratch.dxTab;
		const dx2Tab = scratch.dx2Tab;
		const count = sim.bodyCount < MAX_BODIES ? sim.bodyCount : MAX_BODIES;
		const mu = MU * sim.gravityScale;
		const bx = sim.bodyX;
		const by = sim.bodyY;
		const str = sim.strength;
		const sx = (cssW / w) / view.scale;
		const sy = (cssH / h) / view.scale;
		const ox = (0.5 * (cssW / w) - view.offX) / view.scale;
		const oy = (0.5 * (cssH / h) - view.offY) / view.scale;

		for (let i = 0; i < count; i++) {
			const base = i * w;
			const px = bx[i];
			for (let x = 0; x < w; x++) {
				const dx = px - (ox + x * sx);
				dxTab[base + x] = dx;
				dx2Tab[base + x] = dx * dx;
			}
		}

		let p = 0;
		for (let y = 0; y < h; y++) {
			const wy = oy + y * sy;
			axRow.fill(0, 0, w);
			ayRow.fill(0, 0, w);
			for (let i = 0; i < count; i++) {
				const ms = mu * str[i];
				if (ms === 0) continue;
				const dy = by[i] - wy;
				const dy2 = dy * dy;
				const dym = dy * ms;
				const base = i * w;
				for (let x = 0; x < w; x++) {
					const r2 = dx2Tab[base + x] + dy2;
					const k = r2 >> KERN_SHIFT;
					const inv3 = k < KERN_N ? kern[k] : 1 / ((r2 + SOFT2) * Math.sqrt(r2 + SOFT2));
					axRow[x] += dxTab[base + x] * (ms * inv3);
					ayRow[x] += dym * inv3;
				}
			}
			for (let x = 0; x < w; x++) {
				const ax = axRow[x];
				const ay = ayRow[x];
				const g2 = ax * ax + ay * ay;
				if (g2 <= 1e-12) {
					pixels[p] = BASE_R;
					pixels[p + 1] = BASE_G;
					pixels[p + 2] = BASE_B;
					pixels[p + 3] = 255;
					p += 4;
					continue;
				}
				const hi = hueIndex(ax, ay);
				let li = (g2 * 0.5) | 0;
				if (li >= L_N) li = L_N - 1;
				const c = lC[li];
				let r = (hueR[hi] * c + lMR[li] + 0.5) | 0;
				let g = (hueG[hi] * c + lMG[li] + 0.5) | 0;
				let b = (hueB[hi] * c + lMB[li] + 0.5) | 0;
				if (r > 255) r = 255;
				if (g > 255) g = 255;
				if (b > 255) b = 255;
				pixels[p] = r < 0 ? 0 : r;
				pixels[p + 1] = g < 0 ? 0 : g;
				pixels[p + 2] = b < 0 ? 0 : b;
				pixels[p + 3] = 255;
				p += 4;
			}
		}
	}

	function compileShader(gl, type, src) {
		const shader = gl.createShader(type);
		if (!shader) return null;
		gl.shaderSource(shader, src);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			gl.deleteShader(shader);
			return null;
		}
		return shader;
	}

	function initWebGL(canvas) {
		const opts = {
			alpha: false,
			antialias: false,
			depth: false,
			stencil: false,
			preserveDrawingBuffer: true
		};
		let gl = null;
		try {
			gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
		} catch (err) {
			return null;
		}
		if (!gl || typeof gl.createShader !== 'function') return null;
		const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
		const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
		if (!vs || !fs) return null;
		const prog = gl.createProgram();
		gl.attachShader(prog, vs);
		gl.attachShader(prog, fs);
		gl.linkProgram(prog);
		gl.deleteShader(vs);
		gl.deleteShader(fs);
		if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
			gl.deleteProgram(prog);
			return null;
		}
		const buf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		const aPos = gl.getAttribLocation(prog, 'aPos');
		gl.useProgram(prog);
		gl.enableVertexAttribArray(aPos);
		gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
		return {
			gl,
			prog,
			aPos,
			uOrigin: gl.getUniformLocation(prog, 'uOrigin'),
			uStep: gl.getUniformLocation(prog, 'uStep'),
			uCount: gl.getUniformLocation(prog, 'uCount'),
			uBodies: gl.getUniformLocation(prog, 'uBodies[0]'),
			uniforms: new Float32Array(MAX_BODIES * 3)
		};
	}

	function makeScratch(w) {
		return {
			cap: w,
			axRow: new Float32Array(w),
			ayRow: new Float32Array(w),
			dxTab: new Float32Array(MAX_BODIES * w),
			dx2Tab: new Float32Array(MAX_BODIES * w)
		};
	}

	function create(canvas) {
		let glState = initWebGL(canvas);
		let ctx2d = glState === null ? canvas.getContext('2d') : null;
		let glDiv = 1;
		let slowStreak = 0;
		let fbW = 0;
		let fbH = 0;
		let scratch = makeScratch(512);
		let imgData = null;
		let dirty = true;
		let lastScale = 0;
		let lastOffX = 0;
		let lastOffY = 0;
		let lastG = -1;
		let lastCount = -1;
		let draws = 0;
		const lastBodies = new Float64Array(MAX_BODIES * 3);

		if (canvas && typeof canvas.addEventListener === 'function') {
			/* a canvas keeps the first context type it was given, so a lost WebGL
			 * context can never fall back to 2D on the same element: draw nothing
			 * until `webglcontextrestored` rebuilds the program and buffer */
			canvas.addEventListener('webglcontextlost', event => {
				if (event && typeof event.preventDefault === 'function') event.preventDefault();
				glState = null;
				ctx2d = null;
				fbW = 0;
				dirty = true;
			});
			canvas.addEventListener('webglcontextrestored', () => {
				glState = initWebGL(canvas);
				fbW = 0;
				dirty = true;
			});
		}

		function scaleDiv() {
			return glState !== null ? glDiv : LOW_DIV;
		}

		function invalidate() {
			dirty = true;
		}

		function targetSize(view, cssW, cssH, out) {
			if (glState !== null && glDiv === 1) {
				const dpr = view.dpr || 1;
				out.w = Math.max(1, Math.round(cssW * dpr));
				out.h = Math.max(1, Math.round(cssH * dpr));
				return out;
			}
			out.w = Math.max(1, Math.ceil(cssW / LOW_DIV));
			out.h = Math.max(1, Math.ceil(cssH / LOW_DIV));
			return out;
		}

		const sizeOut = { w: 1, h: 1 };

		function stateChanged(sim, view, w, h) {
			if (dirty || w !== fbW || h !== fbH) return true;
			if (view.scale !== lastScale || view.offX !== lastOffX || view.offY !== lastOffY) return true;
			const count = sim.bodyCount < MAX_BODIES ? sim.bodyCount : MAX_BODIES;
			if (sim.gravityScale !== lastG || count !== lastCount) return true;
			for (let i = 0; i < count; i++) {
				const k = i * 3;
				if (sim.bodyX[i] !== lastBodies[k] ||
					sim.bodyY[i] !== lastBodies[k + 1] ||
					sim.strength[i] !== lastBodies[k + 2]) return true;
			}
			return false;
		}

		function rememberState(sim, view, w, h) {
			dirty = false;
			fbW = w;
			fbH = h;
			lastScale = view.scale;
			lastOffX = view.offX;
			lastOffY = view.offY;
			lastG = sim.gravityScale;
			lastCount = sim.bodyCount < MAX_BODIES ? sim.bodyCount : MAX_BODIES;
			for (let i = 0; i < lastCount; i++) {
				const k = i * 3;
				lastBodies[k] = sim.bodyX[i];
				lastBodies[k + 1] = sim.bodyY[i];
				lastBodies[k + 2] = sim.strength[i];
			}
		}

		function drawWebGL(sim, view, cssW, cssH, w, h) {
			const gl = glState.gl;
			if (canvas.width !== w || canvas.height !== h) {
				canvas.width = w;
				canvas.height = h;
			}
			gl.viewport(0, 0, w, h);
			gl.useProgram(glState.prog);
			const count = sim.bodyCount < MAX_BODIES ? sim.bodyCount : MAX_BODIES;
			const mu = MU * sim.gravityScale;
			const u = glState.uniforms;
			for (let i = 0; i < count; i++) {
				const k = i * 3;
				u[k] = sim.bodyX[i];
				u[k + 1] = sim.bodyY[i];
				u[k + 2] = mu * sim.strength[i];
			}
			/* gl_FragCoord.y runs bottom->top while screen/world y runs top->bottom */
			gl.uniform2f(glState.uOrigin, -view.offX / view.scale, (cssH - view.offY) / view.scale);
			gl.uniform2f(glState.uStep, (cssW / w) / view.scale, -(cssH / h) / view.scale);
			gl.uniform1i(glState.uCount, count);
			if (count > 0) gl.uniform3fv(glState.uBodies, u);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		}

		function draw2D(sim, view, cssW, cssH, w, h) {
			if (!ctx2d || typeof ctx2d.createImageData !== 'function') return;
			if (canvas.width !== w || canvas.height !== h || imgData === null) {
				canvas.width = w;
				canvas.height = h;
				imgData = ctx2d.createImageData(w, h);
			}
			if (w > scratch.cap) scratch = makeScratch(w);
			rasterize2D(imgData.data, w, h, sim, view, cssW, cssH, scratch);
			ctx2d.putImageData(imgData, 0, 0);
		}

		function render(sim, view, cssW, cssH, slow) {
			if (cssW <= 0 || cssH <= 0 || view.scale <= 0) return false;
			if (glState === null && ctx2d === null) return false;
			if (glState !== null && glDiv === 1) {
				slowStreak = slow ? slowStreak + 1 : 0;
				if (slowStreak >= SLOW_LIMIT) {
					glDiv = LOW_DIV;
					dirty = true;
				}
			}
			targetSize(view, cssW, cssH, sizeOut);
			const w = sizeOut.w;
			const h = sizeOut.h;
			if (!stateChanged(sim, view, w, h)) return false;
			if (glState !== null) drawWebGL(sim, view, cssW, cssH, w, h);
			else draw2D(sim, view, cssW, cssH, w, h);
			rememberState(sim, view, w, h);
			draws += 1;
			return true;
		}

		return {
			backend: () => (glState !== null ? 'webgl' : ctx2d !== null ? '2d' : 'lost'),
			scaleDiv,
			draws: () => draws,
			pixels: () => (imgData ? imgData.data : null),
			invalidate,
			render
		};
	}

	function renderBuffer(pixels, w, h, sim, view, cssW, cssH) {
		rasterize2D(pixels, w, h, sim, view, cssW, cssH, makeScratch(w));
		return pixels;
	}

	const GravityField = {
		LOW_DIV,
		L_MAX,
		G_REF,
		SAT,
		sampleColor,
		renderBuffer,
		create
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = GravityField;
	else root.GravityField = GravityField;
})(typeof globalThis !== 'undefined' ? globalThis : this);

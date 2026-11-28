/* Gravity backdrops: two smooth per-pixel maps of the same bodies.
 *
 * field: pull direction -> hue, pull magnitude -> lightness.
 *
 * potential (gravity zones): no direction, only how much gravity sits where.
 * Every body spreads its signed gravity g (strength x world multiplier, the
 * number on its card) over a Plummer surface-density bump, so
 *   Z(x) = sum g_i / (1 + |x - b_i|^2 / ZONE_R^2)^2
 * and a lone body reads its own g at its centre. The colour follows Z:
 * negative blue (repels), near zero transparent with alpha = |Z| up to 1,
 * positive green (pulls), amber, then red from HEAVY_G 2 (a heavy planet),
 * lightening toward the heaviest. The sign is the sign of gravity, not of the
 * potential energy, so an attracting planet is green and a repelling one blue. */
(function (root) {
	'use strict';

	const GravityFFT = typeof module !== 'undefined' && module.exports
		? require('./gravity_fft.js')
		: root.GravityFFT;

	const MU = 400000;
	const SOFT = 60;
	const SOFT2 = 3600;
	const MAX_BODIES = 48;
	const PERIODIC_BODIES = 192;
	const LOW_DIV = 4;
	const SLOW_LIMIT = 6;
	const TAU = Math.PI * 2;
	const INV_TAU = 1 / TAU;
	const SAT = 0.88;
	const L_MAX = 0.56;
	const G_REF = 40;
	const G_KNEE = Math.pow(G_REF, 1.5);
	/* the card's heavy line: the zone palette is solid red from here */
	const HEAVY_G = 2;
	/* spread radius, 1.5x the sim's softening: neighbouring planets (>= 165 px
	 * apart) blend into one zone while a light planet stays its own */
	const ZONE_R = 90;
	const ZONE_INV_R2 = 1 / (ZONE_R * ZONE_R);
	/* pure green up to here, amber halfway to HEAVY_G, red from HEAVY_G, then
	 * red lightens toward HOT so the heaviest ground still has a gradient */
	const ZONE_GREEN_END = 1;
	const ZONE_HOT_END = 5;
	/* legend stops per unit of Z: the corners at 0, +-1 and HEAVY_G land on a stop */
	const LEGEND_PER_UNIT = 8;
	const ZONE_NEGATIVE = [42, 116, 255];
	const ZONE_POSITIVE = [72, 235, 139];
	const ZONE_AMBER = [255, 206, 72];
	const ZONE_HEAVY = [255, 72, 56];
	const ZONE_HOT = [255, 128, 108];
	const MODE_POTENTIAL = 'potential';
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

	/* GLSL literals come from the JS palette, so shader, raster and legend share one table */
	function glslFloat(v) {
		return Number.isInteger(v) ? v.toFixed(1) : String(v);
	}

	function glslVec3(rgb) {
		return 'vec3(' + glslFloat(rgb[0] / 255) + ', ' + glslFloat(rgb[1] / 255) + ', ' +
			glslFloat(rgb[2] / 255) + ')';
	}

	const FRAG_SRC = [
		'#ifdef GL_FRAGMENT_PRECISION_HIGH',
		'precision highp float;',
		'#else',
		'precision mediump float;',
		'#endif',
		'uniform vec2 uOrigin;',
		'uniform vec2 uStep;',
		'uniform int uCount;',
		'uniform int uPotential;',
		'uniform vec3 uBodies[' + MAX_BODIES + '];',
		'const float SOFT2 = 3600.0;',
		'const float INV_TAU = 0.15915494309189535;',
		'const float L_MAX = 0.56;',
		'const float G_KNEE = 252.98221281347034;',
		'const float SAT = 0.88;',
		'const vec3 BASE = vec3(2.0 / 255.0, 6.0 / 255.0, 12.0 / 255.0);',
		/* the weights are MU * g, the zone map wants g */
		'const float INV_MU = ' + glslFloat(1 / MU) + ';',
		'const float ZONE_INV_R2 = ' + glslFloat(ZONE_INV_R2) + ';',
		'const float ZONE_GREEN_END = ' + glslFloat(ZONE_GREEN_END) + ';',
		'const float ZONE_HOT_END = ' + glslFloat(ZONE_HOT_END) + ';',
		'const float HEAVY_G = ' + glslFloat(HEAVY_G) + ';',
		'const vec3 NEGATIVE = ' + glslVec3(ZONE_NEGATIVE) + ';',
		'const vec3 POSITIVE = ' + glslVec3(ZONE_POSITIVE) + ';',
		'const vec3 AMBER = ' + glslVec3(ZONE_AMBER) + ';',
		'const vec3 HEAVY = ' + glslVec3(ZONE_HEAVY) + ';',
		'const vec3 HOT = ' + glslVec3(ZONE_HOT) + ';',
		'vec3 hsl2rgb(float h, float s, float l) {',
		'	vec3 u = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);',
		'	float c = (1.0 - abs(2.0 * l - 1.0)) * s;',
		'	return (u - 0.5) * c + l;',
		'}',
		/* sampleZone() written in GLSL */
		'vec3 zoneColour(float zone) {',
		'	if (zone < 0.0) return NEGATIVE;',
		'	float heat = smoothstep(ZONE_GREEN_END, HEAVY_G, zone);',
		'	vec3 warm = mix(mix(POSITIVE, AMBER, min(2.0 * heat, 1.0)), HEAVY, max(2.0 * heat - 1.0, 0.0));',
		'	return mix(warm, HOT, smoothstep(HEAVY_G, ZONE_HOT_END, zone));',
		'}',
		'void main() {',
		'	vec2 w = uOrigin + gl_FragCoord.xy * uStep;',
		'	if (uPotential == 1) {',
		'		float zone = 0.0;',
		'		for (int i = 0; i < ' + MAX_BODIES + '; i++) {',
		'			if (i >= uCount) break;',
		'			vec3 b = uBodies[i];',
		'			vec2 d = b.xy - w;',
		'			float t = 1.0 / (1.0 + dot(d, d) * ZONE_INV_R2);',
		'			zone += b.z * t * t;',
		'		}',
		'		zone *= INV_MU;',
		/* the canvas is premultiplied: colour scaled by its own alpha */
		'		float alpha = min(abs(zone), 1.0);',
		'		gl_FragColor = vec4(zoneColour(zone) * alpha, alpha);',
		'		return;',
		'	}',
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

	function smooth01(t) {
		if (!(t > 0)) return 0;
		return t >= 1 ? 1 : t * t * (3 - 2 * t);
	}

	function lerp(a, b, t) {
		return a + (b - a) * t;
	}

	function zoneChannel(c, toAmber, toHeavy, hot) {
		const warm = lerp(lerp(ZONE_POSITIVE[c], ZONE_AMBER[c], toAmber), ZONE_HEAVY[c], toHeavy);
		return clampByte(lerp(warm, ZONE_HOT[c], hot));
	}

	/* reference zone palette for the 2D fallback, the legend and the tests: the
	 * shader's zoneColour() and alpha written out. Straight alpha, `a` in bytes. */
	function sampleZone(zone, out) {
		const m = zone < 0 ? -zone : zone;
		out.zone = zone;
		out.alpha = m < 1 ? m : 1;
		out.a = clampByte(out.alpha * 255);
		if (zone < 0) {
			out.r = ZONE_NEGATIVE[0];
			out.g = ZONE_NEGATIVE[1];
			out.b = ZONE_NEGATIVE[2];
			return out;
		}
		const heat = smooth01((zone - ZONE_GREEN_END) / (HEAVY_G - ZONE_GREEN_END));
		const toAmber = heat < 0.5 ? 2 * heat : 1;
		const toHeavy = heat > 0.5 ? 2 * heat - 1 : 0;
		const hot = smooth01((zone - HEAVY_G) / (ZONE_HOT_END - HEAVY_G));
		out.r = zoneChannel(0, toAmber, toHeavy, hot);
		out.g = zoneChannel(1, toAmber, toHeavy, hot);
		out.b = zoneChannel(2, toAmber, toHeavy, hot);
		return out;
	}

	/* exact Z at a world point: what the raster and the shader are tested against;
	 * on a periodic torus, returns mean-zero periodic Plummer potential scaled so
	 * attraction is positive (green -> red) and repulsion negative (blue) */
	function zoneAt(sim, x, y) {
		if (sim && sim.periodic && GravityFFT) {
			const worldW = sim.worldW || 1600;
			const worldH = sim.worldH || 1000;
			if (sim.fieldStatic && typeof sim.ensurePeriodicGrid === 'function') {
				const snap = sim.ensurePeriodicGrid();
				return -snap.samplePhi(x, y, sim.gravityScale) *
					(SOFT / (MU * GravityFFT.PERIODIC_STRENGTH));
			}
			const cap = sim.bodyCount < PERIODIC_BODIES ? sim.bodyCount : PERIODIC_BODIES;
			const mean = GravityFFT.unitPhiMean(worldW, worldH);
			let raw = 0;
			let totalS = 0;
			for (let i = 0; i < cap; i++) {
				const s = sim.strength[i];
				if (s === 0) continue;
				totalS += s;
				const dx = GravityFFT.minImage(sim.bodyX[i] - x, worldW);
				const dy = GravityFFT.minImage(sim.bodyY[i] - y, worldH);
				raw += s / Math.sqrt(dx * dx + dy * dy + SOFT2);
			}
			return sim.gravityScale * SOFT * (raw - mean * totalS);
		}
		const count = sim.bodyCount < MAX_BODIES ? sim.bodyCount : MAX_BODIES;
		let zone = 0;
		for (let i = 0; i < count; i++) {
			const dx = sim.bodyX[i] - x;
			const dy = sim.bodyY[i] - y;
			const t = 1 / (1 + (dx * dx + dy * dy) * ZONE_INV_R2);
			zone += sim.gravityScale * sim.strength[i] * t * t;
		}
		return zone;
	}

	/* CSS gradient of the palette over [zMin, zMax] for the legend key; CSS blends
	 * rgba stops premultiplied, as the canvas does */
	function legendGradient(zMin, zMax) {
		const steps = Math.ceil((zMax - zMin) * LEGEND_PER_UNIT);
		const c = { zone: 0, alpha: 0, a: 0, r: 0, g: 0, b: 0 };
		let css = 'linear-gradient(90deg';
		for (let i = 0; i <= steps; i++) {
			const f = i / steps;
			sampleZone(zMin + (zMax - zMin) * f, c);
			css += ', rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + c.alpha.toFixed(3) + ') ' +
				(f * 100).toFixed(2) + '%';
		}
		return css + ')';
	}

	function ensureTables() {
		if (tables !== null) return tables;
		const kern = new Float32Array(KERN_N);
		for (let i = 0; i < KERN_N; i++) {
			const r2 = (i + 0.5) * KERN_STEP + SOFT2;
			const inv = 1 / Math.sqrt(r2);
			kern[i] = inv / r2;
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

	/* the zone map row by row: Z summed over the bodies on the per-column dx^2 table */
	function rasterizeZones(pixels, w, h, sim, count, scratch, oy, sy) {
		const row = scratch.zoneRow;
		const colour = scratch.zoneColour;
		const dx2Tab = scratch.dx2Tab;
		const by = sim.bodyY;
		const str = sim.strength;
		let p = 0;
		for (let y = 0; y < h; y++) {
			const wy = oy + y * sy;
			row.fill(0, 0, w);
			for (let i = 0; i < count; i++) {
				const weight = sim.gravityScale * str[i];
				if (weight === 0) continue;
				const dy = by[i] - wy;
				const dy2 = dy * dy;
				const base = i * w;
				for (let x = 0; x < w; x++) {
					const t = 1 / (1 + (dx2Tab[base + x] + dy2) * ZONE_INV_R2);
					row[x] += weight * t * t;
				}
			}
			for (let x = 0; x < w; x++) {
				sampleZone(row[x], colour);
				pixels[p] = colour.r;
				pixels[p + 1] = colour.g;
				pixels[p + 2] = colour.b;
				pixels[p + 3] = colour.a;
				p += 4;
			}
		}
	}

	/* fills a straight-alpha RGBA Uint8ClampedArray (w x h) for tests and the 1/4-res 2D
	 * fallback; the field is opaque, the zone map transparent where Z is near 0 */
	function rasterize2D(pixels, w, h, sim, view, cssW, cssH, scratch, mode) {
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

		if (mode === MODE_POTENTIAL) {
			rasterizeZones(pixels, w, h, sim, count, scratch, oy, sy);
			return;
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
				/* The in-frame row fits the LUT; keep the rare zoomed-out fallback
				 * out of its per-pixel loop. Squared distance peaks at an endpoint. */
				if (Math.max(dx2Tab[base], dx2Tab[base + w - 1]) + dy2 < KERN_N * KERN_STEP) {
					for (let x = 0; x < w; x++) {
						const inv3 = kern[(dx2Tab[base + x] + dy2) >> KERN_SHIFT];
						axRow[x] += dxTab[base + x] * (ms * inv3);
						ayRow[x] += dym * inv3;
					}
					continue;
				}
				for (let x = 0; x < w; x++) {
					const r2 = dx2Tab[base + x] + dy2;
					const inv3 = r2 < KERN_N * KERN_STEP
						? kern[r2 >> KERN_SHIFT] : 1 / ((r2 + SOFT2) * Math.sqrt(r2 + SOFT2));
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

	function writeFieldPixel(pixels, p, ax, ay, lut) {
		const g2 = ax * ax + ay * ay;
		if (g2 <= 1e-12) {
			pixels[p] = BASE_R;
			pixels[p + 1] = BASE_G;
			pixels[p + 2] = BASE_B;
			pixels[p + 3] = 255;
			return;
		}
		const hi = hueIndex(ax, ay);
		let li = (g2 * 0.5) | 0;
		if (li >= L_N) li = L_N - 1;
		const c = lut.lC[li];
		let r = (lut.hueR[hi] * c + lut.lMR[li] + 0.5) | 0;
		let g = (lut.hueG[hi] * c + lut.lMG[li] + 0.5) | 0;
		let b = (lut.hueB[hi] * c + lut.lMB[li] + 0.5) | 0;
		if (r > 255) r = 255;
		if (g > 255) g = 255;
		if (b > 255) b = 255;
		pixels[p] = r < 0 ? 0 : r;
		pixels[p + 1] = g < 0 ? 0 : g;
		pixels[p + 2] = b < 0 ? 0 : b;
		pixels[p + 3] = 255;
	}

	function writeZonePixel(pixels, p, zone, colour, premultiply) {
		sampleZone(zone, colour);
		if (premultiply) {
			pixels[p] = clampByte(colour.r * colour.alpha);
			pixels[p + 1] = clampByte(colour.g * colour.alpha);
			pixels[p + 2] = clampByte(colour.b * colour.alpha);
			pixels[p + 3] = colour.a;
			return;
		}
		pixels[p] = colour.r;
		pixels[p + 1] = colour.g;
		pixels[p + 2] = colour.b;
		pixels[p + 3] = colour.a;
	}

	/* recolours a solved FFT snapshot in place without running another FFT */
	function recolourPeriodicGrid(snap, gravityScale, mode, pixels, premultiply) {
		const n = snap.gridX * snap.gridY;
		if (mode === MODE_POTENTIAL) {
			const colour = { zone: 0, alpha: 0, a: 0, r: 0, g: 0, b: 0 };
			const scale = -(SOFT / GravityFFT.PERIODIC_STRENGTH) * gravityScale;
			const phi = snap.phi;
			for (let i = 0; i < n; i++) {
				writeZonePixel(pixels, i << 2, phi[i] * scale, colour, premultiply);
			}
			return;
		}
		const lut = ensureTables();
		const mu = MU * gravityScale;
		const axGrid = snap.ax;
		const ayGrid = snap.ay;
		for (let i = 0; i < n; i++) {
			writeFieldPixel(pixels, i << 2, mu * axGrid[i], mu * ayGrid[i], lut);
		}
	}

	/* periodic CPU rasterizer: samples the shared FFT snapshot for static sources
	 * or evaluates minimum-image acceleration / mean-referenced potential for moving ports */
	function rasterizePeriodic(pixels, w, h, sim, view, cssW, cssH, scratch, mode, premultiply) {
		const worldW = sim.worldW || 1600;
		const worldH = sim.worldH || 1000;
		const sx = (cssW / w) / view.scale;
		const sy = (cssH / h) / view.scale;
		const ox = (0.5 * (cssW / w) - view.offX) / view.scale;
		const oy = (0.5 * (cssH / h) - view.offY) / view.scale;
		const isPot = mode === MODE_POTENTIAL;
		const lut = isPot ? null : ensureTables();
		const colour = scratch.zoneColour;

		if (sim.fieldStatic && typeof sim.ensurePeriodicGrid === 'function') {
			const snap = sim.ensurePeriodicGrid();
			const acc = { ax: 0, ay: 0 };
			const zScale = -(SOFT / (MU * GravityFFT.PERIODIC_STRENGTH));
			let p = 0;
			for (let y = 0; y < h; y++) {
				const wy = oy + y * sy;
				const inY = wy >= 0 && wy < worldH;
				for (let x = 0; x < w; x++) {
					const wx = ox + x * sx;
					if (!inY || wx < 0 || wx >= worldW) {
						pixels[p] = isPot ? 0 : BASE_R;
						pixels[p + 1] = isPot ? 0 : BASE_G;
						pixels[p + 2] = isPot ? 0 : BASE_B;
						pixels[p + 3] = isPot ? 0 : 255;
						p += 4;
						continue;
					}
					if (isPot) {
						const z = snap.samplePhi(wx, wy, sim.gravityScale) * zScale;
						writeZonePixel(pixels, p, z, colour, premultiply);
					} else {
						snap.sample(wx, wy, sim.gravityScale, acc);
						writeFieldPixel(pixels, p, acc.ax, acc.ay, lut);
					}
					p += 4;
				}
			}
			return;
		}

		const count = sim.bodyCount < PERIODIC_BODIES ? sim.bodyCount : PERIODIC_BODIES;
		const bx = sim.bodyX;
		const by = sim.bodyY;
		const str = sim.strength;
		const dxTab = scratch.dxTab;
		const dx2Tab = scratch.dx2Tab;
		const halfW = worldW * 0.5;
		const halfH = worldH * 0.5;
		for (let i = 0; i < count; i++) {
			const base = i * w;
			const px = bx[i];
			for (let x = 0; x < w; x++) {
				const dx = GravityFFT.minImage(px - (ox + x * sx), worldW);
				dx2Tab[base + x] = dx * dx;
				dxTab[base + x] = Math.abs(dx) === halfW ? 0 : dx;
			}
		}

		if (isPot) {
			const row = scratch.zoneRow;
			const mean = GravityFFT.unitPhiMean(worldW, worldH);
			let totalS = 0;
			for (let i = 0; i < count; i++) totalS += str[i];
			const offset = mean * totalS;
			const zScale = sim.gravityScale * SOFT;
			let p = 0;
			for (let y = 0; y < h; y++) {
				const wy = oy + y * sy;
				const inY = wy >= 0 && wy < worldH;
				if (!inY) {
					for (let x = 0; x < w; x++) {
						pixels[p] = 0; pixels[p + 1] = 0; pixels[p + 2] = 0; pixels[p + 3] = 0;
						p += 4;
					}
					continue;
				}
				row.fill(-offset, 0, w);
				for (let i = 0; i < count; i++) {
					const s = str[i];
					if (s === 0) continue;
					const dy = GravityFFT.minImage(by[i] - wy, worldH);
					const dy2 = dy * dy + SOFT2;
					const base = i * w;
					for (let x = 0; x < w; x++) {
						row[x] += s / Math.sqrt(dx2Tab[base + x] + dy2);
					}
				}
				for (let x = 0; x < w; x++) {
					const wx = ox + x * sx;
					if (wx < 0 || wx >= worldW) {
						pixels[p] = 0; pixels[p + 1] = 0; pixels[p + 2] = 0; pixels[p + 3] = 0;
					} else {
						writeZonePixel(pixels, p, row[x] * zScale, colour, premultiply);
					}
					p += 4;
				}
			}
			return;
		}

		const axRow = scratch.axRow;
		const ayRow = scratch.ayRow;
		const kern = lut.kern;
		const mu = MU * sim.gravityScale * GravityFFT.PERIODIC_STRENGTH;
		let p = 0;
		for (let y = 0; y < h; y++) {
			const wy = oy + y * sy;
			const inY = wy >= 0 && wy < worldH;
			if (!inY) {
				for (let x = 0; x < w; x++) {
					pixels[p] = BASE_R; pixels[p + 1] = BASE_G; pixels[p + 2] = BASE_B; pixels[p + 3] = 255;
					p += 4;
				}
				continue;
			}
			axRow.fill(0, 0, w);
			ayRow.fill(0, 0, w);
			for (let i = 0; i < count; i++) {
				const ms = mu * str[i];
				if (ms === 0) continue;
				const dy = GravityFFT.minImage(by[i] - wy, worldH);
				const dy2 = dy * dy;
				const dym = (Math.abs(dy) === halfH ? 0 : dy) * ms;
				const base = i * w;
				for (let x = 0; x < w; x++) {
					const r2 = dx2Tab[base + x] + dy2;
					const inv3 = r2 < KERN_N * KERN_STEP
						? kern[r2 >> KERN_SHIFT] : 1 / ((r2 + SOFT2) * Math.sqrt(r2 + SOFT2));
					axRow[x] += dxTab[base + x] * (ms * inv3);
					ayRow[x] += dym * inv3;
				}
			}
			for (let x = 0; x < w; x++) {
				const wx = ox + x * sx;
				if (wx < 0 || wx >= worldW) {
					pixels[p] = BASE_R; pixels[p + 1] = BASE_G; pixels[p + 2] = BASE_B; pixels[p + 3] = 255;
				} else {
					writeFieldPixel(pixels, p, axRow[x], ayRow[x], lut);
				}
				p += 4;
			}
		}
	}

	const PERIODIC_FRAG_SRC = [
		'#ifdef GL_FRAGMENT_PRECISION_HIGH',
		'precision highp float;',
		'#else',
		'precision mediump float;',
		'#endif',
		'uniform sampler2D uTex;',
		'uniform vec2 uOrigin;',
		'uniform vec2 uStep;',
		'uniform vec2 uWorld;',
		'uniform vec2 uHalfTexel;',
		'uniform int uScreenTex;',
		'uniform int uPotential;',
		'const vec3 BASE = vec3(2.0 / 255.0, 6.0 / 255.0, 12.0 / 255.0);',
		'void main() {',
		'	if (uScreenTex == 1) {',
		'		gl_FragColor = texture2D(uTex, uOrigin + gl_FragCoord.xy * uStep);',
		'		return;',
		'	}',
		'	vec2 w = uOrigin + gl_FragCoord.xy * uStep;',
		'	if (w.x < 0.0 || w.x >= uWorld.x || w.y < 0.0 || w.y >= uWorld.y) {',
		'		gl_FragColor = uPotential == 1 ? vec4(0.0) : vec4(BASE, 1.0);',
		'		return;',
		'	}',
		'	gl_FragColor = texture2D(uTex, w / uWorld + uHalfTexel);',
		'}'
	].join('\n');

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
		/* alpha: the zone map is see-through where gravity is near zero */
		const opts = {
			alpha: true,
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
			uPotential: gl.getUniformLocation(prog, 'uPotential'),
			uBodies: gl.getUniformLocation(prog, 'uBodies[0]'),
			uniforms: new Float32Array(MAX_BODIES * 3)
		};
	}

	function initPeriodicBlit(glState) {
		const gl = glState.gl;
		if (!gl || typeof gl.createTexture !== 'function') return null;
		const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
		const fs = compileShader(gl, gl.FRAGMENT_SHADER, PERIODIC_FRAG_SRC);
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
		return {
			prog,
			tex: gl.createTexture(),
			aPos: gl.getAttribLocation(prog, 'aPos'),
			uTex: gl.getUniformLocation(prog, 'uTex'),
			uOrigin: gl.getUniformLocation(prog, 'uOrigin'),
			uStep: gl.getUniformLocation(prog, 'uStep'),
			uWorld: gl.getUniformLocation(prog, 'uWorld'),
			uHalfTexel: gl.getUniformLocation(prog, 'uHalfTexel'),
			uScreenTex: gl.getUniformLocation(prog, 'uScreenTex'),
			uPotential: gl.getUniformLocation(prog, 'uPotential'),
			texW: 0,
			texH: 0,
			repeat: false
		};
	}

	function makeScratch(w, bodies) {
		const maxB = bodies || MAX_BODIES;
		return {
			cap: w,
			bodies: maxB,
			axRow: new Float64Array(w),
			ayRow: new Float64Array(w),
			zoneRow: new Float64Array(w),
			zoneColour: { zone: 0, alpha: 0, a: 0, r: 0, g: 0, b: 0 },
			dxTab: new Float64Array(maxB * w),
			dx2Tab: new Float64Array(maxB * w)
		};
	}

	function create(canvas, onStateChange) {
		let glState = initWebGL(canvas);
		let glPeriodic = null;
		let ctx2d = glState === null ? canvas.getContext('2d') : null;
		let mode = 'field';
		let glDiv = 1;
		let slowStreak = 0;
		let fbW = 0;
		let fbH = 0;
		let scratch = makeScratch(512, MAX_BODIES);
		let imgData = null;
		let dirty = true;
		let lastScale = 0;
		let lastOffX = 0;
		let lastOffY = 0;
		let lastG = -1;
		let lastCount = -1;
		let lastPeriodic = false;
		let lastFieldStatic = true;
		let lastRevision = -1;
		let draws = 0;
		const lastBodies = new Float64Array(PERIODIC_BODIES * 3);
		const gridCache = {
			revision: -1,
			mode: '',
			g: -1,
			premul: false,
			w: 0,
			h: 0,
			pixels: null,
			offCanvas: null,
			offCtx: null,
			offImg: null,
			glUploadedRev: -1,
			glUploadedMode: '',
			glUploadedG: -1
		};
		let glMovingBuf = null;

		if (canvas && typeof canvas.addEventListener === 'function') {
			/* a canvas keeps the first context type it was given, so a lost WebGL
			 * context can never fall back to 2D on the same element: draw nothing
			 * until `webglcontextrestored` rebuilds the program and buffer */
			canvas.addEventListener('webglcontextlost', event => {
				if (event && typeof event.preventDefault === 'function') event.preventDefault();
				glState = null;
				glPeriodic = null;
				ctx2d = null;
				fbW = 0;
				dirty = true;
				if (onStateChange) onStateChange();
			});
			canvas.addEventListener('webglcontextrestored', () => {
				glDiv = 1;
				slowStreak = 0;
				glState = initWebGL(canvas);
				glPeriodic = null;
				gridCache.glUploadedRev = -1;
				fbW = 0;
				dirty = true;
				if (onStateChange) onStateChange();
			});
		}

		function scaleDiv() {
			return glState !== null ? glDiv : LOW_DIV;
		}

		function invalidate() {
			dirty = true;
		}

		function setMode(next) {
			const normalized = next === MODE_POTENTIAL ? MODE_POTENTIAL : 'field';
			if (normalized === mode) return;
			mode = normalized;
			dirty = true;
		}

		function targetSize(sim, view, cssW, cssH, out) {
			const periodic = Boolean(sim && sim.periodic);
			if (glState !== null && glDiv === 1 && (!periodic || sim.fieldStatic)) {
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
			const periodic = Boolean(sim && sim.periodic);
			const fieldStatic = sim.fieldStatic !== false;
			if (periodic !== lastPeriodic || fieldStatic !== lastFieldStatic) return true;
			if (sim.gravityScale !== lastG) return true;
			if (periodic && fieldStatic && typeof sim.ensurePeriodicGrid === 'function') {
				const snap = sim.ensurePeriodicGrid();
				return snap.revision !== lastRevision;
			}
			const maxB = periodic ? PERIODIC_BODIES : MAX_BODIES;
			const count = sim.bodyCount < maxB ? sim.bodyCount : maxB;
			if (count !== lastCount) return true;
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
			lastPeriodic = Boolean(sim && sim.periodic);
			lastFieldStatic = sim.fieldStatic !== false;
			if (lastPeriodic && lastFieldStatic && typeof sim.ensurePeriodicGrid === 'function') {
				lastRevision = sim.ensurePeriodicGrid().revision;
				return;
			}
			lastRevision = -1;
			const maxB = lastPeriodic ? PERIODIC_BODIES : MAX_BODIES;
			lastCount = sim.bodyCount < maxB ? sim.bodyCount : maxB;
			for (let i = 0; i < lastCount; i++) {
				const k = i * 3;
				lastBodies[k] = sim.bodyX[i];
				lastBodies[k + 1] = sim.bodyY[i];
				lastBodies[k + 2] = sim.strength[i];
			}
		}

		function ensurePeriodicCache(snap, gravityScale, premul) {
			const w = snap.gridX;
			const h = snap.gridY;
			if (!gridCache.pixels || gridCache.w !== w || gridCache.h !== h) {
				gridCache.w = w;
				gridCache.h = h;
				gridCache.pixels = new Uint8Array(w * h * 4);
				gridCache.revision = -1;
				gridCache.glUploadedRev = -1;
			}
			if (gridCache.revision !== snap.revision ||
				gridCache.mode !== mode ||
				gridCache.g !== gravityScale ||
				gridCache.premul !== premul) {
				recolourPeriodicGrid(snap, gravityScale, mode, gridCache.pixels, premul);
				gridCache.revision = snap.revision;
				gridCache.mode = mode;
				gridCache.g = gravityScale;
				gridCache.premul = premul;
				return true;
			}
			return false;
		}

		function uploadGlTex(gl, pb, texW, texH, data, repeat) {
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, pb.tex);
			gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
			if (pb.texW !== texW || pb.texH !== texH || pb.repeat !== repeat) {
				pb.texW = texW;
				pb.texH = texH;
				pb.repeat = repeat;
				const wrapMode = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapMode);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapMode);
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texW, texH, 0,
					gl.RGBA, gl.UNSIGNED_BYTE, data);
			} else {
				gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, texW, texH,
					gl.RGBA, gl.UNSIGNED_BYTE, data);
			}
		}

		function drawPeriodicWebGL(sim, view, cssW, cssH, w, h) {
			if (glPeriodic === null) glPeriodic = initPeriodicBlit(glState);
			if (glPeriodic === null) return;
			const gl = glState.gl;
			if (canvas.width !== w || canvas.height !== h) {
				canvas.width = w;
				canvas.height = h;
			}
			gl.viewport(0, 0, w, h);
			gl.useProgram(glPeriodic.prog);
			gl.enableVertexAttribArray(glPeriodic.aPos);
			gl.vertexAttribPointer(glPeriodic.aPos, 2, gl.FLOAT, false, 0, 0);
			gl.uniform1i(glPeriodic.uTex, 0);
			gl.uniform1i(glPeriodic.uPotential, mode === MODE_POTENTIAL ? 1 : 0);

			if (sim.fieldStatic && typeof sim.ensurePeriodicGrid === 'function') {
				const snap = sim.ensurePeriodicGrid();
				const recoloured = ensurePeriodicCache(snap, sim.gravityScale, true);
				const repeat = GravityFFT.isPow2(snap.gridX) && GravityFFT.isPow2(snap.gridY);
				if (recoloured ||
					gridCache.glUploadedRev !== snap.revision ||
					gridCache.glUploadedMode !== mode ||
					gridCache.glUploadedG !== sim.gravityScale ||
					glPeriodic.texW !== snap.gridX ||
					glPeriodic.texH !== snap.gridY) {
					uploadGlTex(gl, glPeriodic, snap.gridX, snap.gridY, gridCache.pixels, repeat);
					gridCache.glUploadedRev = snap.revision;
					gridCache.glUploadedMode = mode;
					gridCache.glUploadedG = sim.gravityScale;
				} else {
					gl.activeTexture(gl.TEXTURE0);
					gl.bindTexture(gl.TEXTURE_2D, glPeriodic.tex);
				}
				gl.uniform1i(glPeriodic.uScreenTex, 0);
				gl.uniform2f(glPeriodic.uOrigin, -view.offX / view.scale, (cssH - view.offY) / view.scale);
				gl.uniform2f(glPeriodic.uStep, (cssW / w) / view.scale, -(cssH / h) / view.scale);
				gl.uniform2f(glPeriodic.uWorld, snap.worldW, snap.worldH);
				gl.uniform2f(glPeriodic.uHalfTexel, 0.5 / snap.gridX, 0.5 / snap.gridY);
				gl.drawArrays(gl.TRIANGLES, 0, 3);
				return;
			}

			const needB = PERIODIC_BODIES;
			if (w > scratch.cap || scratch.bodies < needB) scratch = makeScratch(Math.max(w, scratch.cap), needB);
			if (!glMovingBuf || glMovingBuf.length !== w * h * 4) {
				glMovingBuf = new Uint8Array(w * h * 4);
			}
			rasterizePeriodic(glMovingBuf, w, h, sim, view, cssW, cssH, scratch, mode, true);
			gridCache.glUploadedRev = -1;
			uploadGlTex(gl, glPeriodic, w, h, glMovingBuf, false);
			gl.uniform1i(glPeriodic.uScreenTex, 1);
			gl.uniform2f(glPeriodic.uOrigin, 0, 1);
			gl.uniform2f(glPeriodic.uStep, 1 / w, -1 / h);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		}

		function drawWebGL(sim, view, cssW, cssH, w, h) {
			if (sim && sim.periodic && GravityFFT) {
				drawPeriodicWebGL(sim, view, cssW, cssH, w, h);
				return;
			}
			const gl = glState.gl;
			if (canvas.width !== w || canvas.height !== h) {
				canvas.width = w;
				canvas.height = h;
			}
			gl.viewport(0, 0, w, h);
			gl.useProgram(glState.prog);
			if (glPeriodic !== null) {
				gl.enableVertexAttribArray(glState.aPos);
				gl.vertexAttribPointer(glState.aPos, 2, gl.FLOAT, false, 0, 0);
			}
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
			gl.uniform1i(glState.uPotential, mode === MODE_POTENTIAL ? 1 : 0);
			if (count > 0) gl.uniform3fv(glState.uBodies, u);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		}

		function drawPeriodicOffscreen2D(sim, view, cssW, cssH, w, h) {
			const snap = sim.ensurePeriodicGrid();
			const recoloured = ensurePeriodicCache(snap, sim.gravityScale, false);
			if (!gridCache.offCanvas && typeof document !== 'undefined' &&
				typeof document.createElement === 'function') {
				const oc = document.createElement('canvas');
				const octx = oc && typeof oc.getContext === 'function' ? oc.getContext('2d') : null;
				if (octx && typeof octx.createImageData === 'function' &&
					typeof octx.putImageData === 'function') {
					gridCache.offCanvas = oc;
					gridCache.offCtx = octx;
				}
			}
			if (!gridCache.offCtx || typeof ctx2d.drawImage !== 'function' ||
				typeof ctx2d.clearRect !== 'function') {
				return false;
			}
			const oc = gridCache.offCanvas;
			const octx = gridCache.offCtx;
			if (oc.width !== snap.gridX || oc.height !== snap.gridY || !gridCache.offImg) {
				oc.width = snap.gridX;
				oc.height = snap.gridY;
				gridCache.offImg = octx.createImageData(snap.gridX, snap.gridY);
				gridCache.offImg.data.set(gridCache.pixels);
				octx.putImageData(gridCache.offImg, 0, 0);
			} else if (recoloured) {
				gridCache.offImg.data.set(gridCache.pixels);
				octx.putImageData(gridCache.offImg, 0, 0);
			}
			if (canvas.width !== w || canvas.height !== h || imgData === null) {
				canvas.width = w;
				canvas.height = h;
				imgData = ctx2d.createImageData(w, h);
			}
			/* populate imgData when getImageData is absent so pixels() remains readable in tests */
			const scaleX = w / cssW;
			const scaleY = h / cssH;
			if (mode === MODE_POTENTIAL) {
				ctx2d.clearRect(0, 0, w, h);
			} else {
				ctx2d.fillStyle = 'rgb(' + BASE_R + ',' + BASE_G + ',' + BASE_B + ')';
				ctx2d.fillRect(0, 0, w, h);
			}
			ctx2d.imageSmoothingEnabled = true;
			ctx2d.drawImage(oc,
				view.offX * scaleX, view.offY * scaleY,
				snap.worldW * view.scale * scaleX, snap.worldH * view.scale * scaleY);
			if (typeof ctx2d.getImageData === 'function') {
				imgData = ctx2d.getImageData(0, 0, w, h);
			} else {
				rasterizePeriodic(imgData.data, w, h, sim, view, cssW, cssH, scratch, mode, false);
			}
			return true;
		}

		function draw2D(sim, view, cssW, cssH, w, h) {
			if (!ctx2d || typeof ctx2d.createImageData !== 'function') return;
			const periodic = Boolean(sim && sim.periodic && GravityFFT);
			const needB = periodic ? PERIODIC_BODIES : MAX_BODIES;
			if (w > scratch.cap || scratch.bodies < needB) {
				scratch = makeScratch(Math.max(w, scratch.cap), needB);
			}
			if (periodic && sim.fieldStatic && typeof sim.ensurePeriodicGrid === 'function' &&
				drawPeriodicOffscreen2D(sim, view, cssW, cssH, w, h)) {
				return;
			}
			if (canvas.width !== w || canvas.height !== h || imgData === null) {
				canvas.width = w;
				canvas.height = h;
				imgData = ctx2d.createImageData(w, h);
			}
			if (periodic) {
				rasterizePeriodic(imgData.data, w, h, sim, view, cssW, cssH, scratch, mode, false);
			} else {
				rasterize2D(imgData.data, w, h, sim, view, cssW, cssH, scratch, mode);
			}
			ctx2d.putImageData(imgData, 0, 0);
		}

		function render(sim, view, cssW, cssH, slow) {
			if (cssW <= 0 || cssH <= 0 || view.scale <= 0) return false;
			if (glState === null && ctx2d === null) return false;
			if (glState !== null && glDiv === 1 && !(sim && sim.periodic && !sim.fieldStatic)) {
				slowStreak = slow ? slowStreak + 1 : 0;
				if (slowStreak >= SLOW_LIMIT) {
					glDiv = LOW_DIV;
					dirty = true;
				}
			}
			targetSize(sim, view, cssW, cssH, sizeOut);
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
			mode: () => mode,
			setMode,
			scaleDiv,
			draws: () => draws,
			pixels: () => (imgData ? imgData.data : null),
			invalidate,
			render
		};
	}

	function renderBuffer(pixels, w, h, sim, view, cssW, cssH, mode) {
		const periodic = Boolean(sim && sim.periodic && GravityFFT);
		const scratch = makeScratch(w, periodic ? PERIODIC_BODIES : MAX_BODIES);
		if (periodic) rasterizePeriodic(pixels, w, h, sim, view, cssW, cssH, scratch, mode, false);
		else rasterize2D(pixels, w, h, sim, view, cssW, cssH, scratch, mode);
		return pixels;
	}

	const GravityField = {
		LOW_DIV,
		L_MAX,
		G_REF,
		HEAVY_G,
		SAT,
		ZONE_R,
		zoneAt,
		sampleZone,
		legendGradient,
		sampleColor,
		renderBuffer,
		create
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = GravityField;
	else root.GravityField = GravityField;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/*
 * Knowledge volume (career science). Each tech family lives in an N-D
 * parameter space. Discovered items are points; anything inside their convex
 * hull is cheap (a recombination of known tradeoffs). Outside, directional
 * distance charges only for improvements over known capabilities. Beyond the per-axis researched range
 * (min/max of the discovered points) a second, directional surcharge applies:
 * every family has a `below`/`above` difficulty per axis, so a lighter engine
 * is much harder to invent than a heavier one while high efficiency is harder
 * than low. Both terms are measured in normalized research units (RU), so
 * unlike engineering units do not set the balance by accident. Engine and tank
 * fees also scale with mass: doubling mass divides the fee by 1.5 when the
 * underlying research work is unchanged.
 * Pure functions, no DOM, node-safe.
 *
 * A hull is a plain object from createHull(), so every career owns an
 * isolated knowledge volume; the module also keeps a default hull behind the
 * family-only legacy API (used by the early node benches).
 *
 * Example from the brief: engine (force=1, mass=10) and (force=2, mass=15)
 * discovered → hull is the segment; inventing (force=1, mass=1) next makes
 * the hull a triangle — any (force, mass) inside is cheap.
 *
 * Distance to hull is the nearest-point problem min ||P w - p|| s.t. w on the
 * simplex, solved exactly by Wolfe's min-norm active-set method (finite, no
 * step-size tuning). Tech tuples are badly scaled and nearly collinear, where a
 * first-order method stalls and wrongly reports interior points as outside.
 */
(function (root) {
	'use strict';

	/* Reference masses keep the scale stable as the knowledge hull grows. */
	var MASS_REFERENCE = { engine: 1.0, tank: 0.5 };
	var MASS_EXPONENT = Math.log(1.5) / Math.log(2);

	function massFactor(family, params) {
		var reference = MASS_REFERENCE[family];
		if (!reference) return 1;
		if (!(params[1] > 0) || !Number.isFinite(params[1])) return Infinity;
		return Math.pow(reference / params[1], MASS_EXPONENT);
	}

	var INSIDE_EPS = 1e-9; // relative to the target magnitude
	var WOLFE_EPS = 1e-12;
	var MAX_CYCLES = 64;
	/* 1.5x discount across recombination fees, hull distance, and frontier work */
	var PRICE_SCALE = 1 / 1.5;
	var DEFAULT_BASE = 1.00 * PRICE_SCALE;
	var K_DIST = 6.0 * PRICE_SCALE; // purse per normalized research unit outside the hull

	var BASE_PRICE = {
		engine: 2.00 * PRICE_SCALE, catapult: 3.00 * PRICE_SCALE, panel: 1.50 * PRICE_SCALE,
		battery: 1.00 * PRICE_SCALE, hold: 1.00 * PRICE_SCALE, tank: 1.00 * PRICE_SCALE
	};
	var TIER_SCALE = {
		engine: 1.00, catapult: 1.20, panel: 0.90, battery: 1.00,
		hold: 1.10, tank: 1.00
	};

	/* One normalized research unit is a deliberate invention step, not one
	 * arbitrary engineering unit: 10 kN thrust ≈ 1 t engine mass,
	 * 30 kN rail force ≈ 0.10 efficiency, 50 kg fuel ≈ 0.5 t tank mass,
	 * 5 kWh battery capacity ≈ 0.0004 leak per year. */
	var METRIC_SCALE = {
		engine: [0.1, 1.0],
		catapult: [1 / 30, 10.0],
		tank: [0.02, 2.0],
		battery: [0.2, 2500.0]
	};

	/* Directional difficulty per axis: `below` weights stepping toward smaller
	 * values, `above` toward larger ones. A zero weight removes hull distance in
	 * the easy direction (adding mass, lowering efficiency or thrust, allowing
	 * more leak requires no additional science); beyond the researched range
	 * [min, max], `below`/`above` also adds uncharted-frontier work per RU. */
	var FRONTIER = {
		engine: [
			{ below: 0.00, above: 1.00 },  // thrust kN: weaker easy, stronger hard
			{ below: 3.00, above: 0.00 }   // mass t: lighter hard, heavier easy
		],
		catapult: [
			{ below: 0.00, above: 1.00 },  // maxForce kN: weaker easy, stronger hard
			{ below: 0.00, above: 2.50 }   // efficiency: lower easy, higher hard
		],
		tank: [
			{ below: 0.00, above: 1.00 },  // fuelCap kg: smaller easy, larger hard
			{ below: 3.00, above: 0.00 }   // emptyMass t: lighter hard, heavier easy
		],
		battery: [
			{ below: 0.00, above: 1.20 },  // capacity kWh: smaller easy, larger hard
			{ below: 2.50, above: 0.00 }   // leak /y: tighter hard, leakier easy
		]
	};

	function normalizedParams(family, params) {
		var scale = METRIC_SCALE[family];
		var out = new Array(params.length);
		for (var d = 0; d < params.length; d++) out[d] = params[d] * (scale ? scale[d] : 1);
		return out;
	}

	/* one career's knowledge volume: family -> { points, n, dim } */
	function createHull() {
		return { families: {} };
	}

	function ensureHull(hull, family, dim) {
		var f = hull.families[family];
		if (!f) {
			f = { points: [], n: 0, dim: dim };
			hull.families[family] = f;
		}
		return f;
	}

	/* per-axis min/max of the discovered points: the researched range whose
	 * edges the directional surcharge starts from. Null for an empty family. */
	function rangeHull(hull, family) {
		var f = hull.families[family];
		if (!f || f.n === 0) return null;
		var min = new Array(f.dim);
		var max = new Array(f.dim);
		var i, d, v;
		for (d = 0; d < f.dim; d++) {
			min[d] = Infinity;
			max[d] = -Infinity;
		}
		for (i = 0; i < f.points.length; i++) {
			for (d = 0; d < f.dim; d++) {
				v = f.points[i].params[d];
				if (v < min[d]) min[d] = v;
				if (v > max[d]) max[d] = v;
			}
		}
		return { min: min, max: max };
	}

	/* weighted RU of new work for stepping outside the researched range;
	 * an unconfigured family is pure hull geometry, as in the early benches. */
	function frontierWork(hull, family, params) {
		var dirs = FRONTIER[family];
		var range = dirs ? rangeHull(hull, family) : null;
		if (!range) return 0;
		var scale = METRIC_SCALE[family];
		var work = 0, d, unit, below, above;
		for (d = 0; d < params.length && d < dirs.length; d++) {
			unit = scale ? scale[d] : 1;
			below = (range.min[d] - params[d]) * unit;
			above = (params[d] - range.max[d]) * unit;
			if (below > 0) work += below * dirs[d].below;
			if (above > 0) work += above * dirs[d].above;
		}
		return work;
	}

	function dot(a, b) {
		var s = 0;
		for (var k = 0; k < a.length; k++) s += a[k] * b[k];
		return s;
	}

	/* min-norm point of aff(corral): alpha (sum 1) minimising ||sum alpha_k x_k||.
	 * Least squares on the offsets o_k = x_k - x_0 by modified Gram-Schmidt: it works
	 * on the offsets' condition number, where normal equations would square it
	 * (thin tech hulls lose ~10 digits that way). A vanishing R diagonal means the
	 * corral is affinely dependent, which returns null. */
	function affineMinNorm(xs, idx) {
		var m = idx.length;
		var cols = m - 1;
		var x0 = xs[idx[0]];
		var Q = new Array(cols);
		var R = new Array(cols);
		var g = new Array(cols);
		var beta = new Array(cols);
		var alpha = new Array(m);
		var c, j, d, v, norm0, rcc, sum;
		for (c = 0; c < cols; c++) R[c] = new Array(cols).fill(0);
		for (c = 0; c < cols; c++) {
			v = new Array(x0.length);
			for (d = 0; d < v.length; d++) v[d] = xs[idx[c + 1]][d] - x0[d];
			norm0 = Math.sqrt(dot(v, v));
			for (j = 0; j < c; j++) {
				R[j][c] = dot(Q[j], v);
				for (d = 0; d < v.length; d++) v[d] -= R[j][c] * Q[j][d];
			}
			rcc = Math.sqrt(dot(v, v));
			if (rcc <= WOLFE_EPS * norm0) return null;
			R[c][c] = rcc;
			for (d = 0; d < v.length; d++) v[d] /= rcc;
			Q[c] = v;
			g[c] = -dot(Q[c], x0);
		}
		/* R beta = Q' (-x0): back substitution gives beta = argmin ||x0 + D beta|| */
		for (c = cols - 1; c >= 0; c--) {
			sum = g[c];
			for (j = c + 1; j < cols; j++) sum -= R[c][j] * beta[j];
			beta[c] = sum / R[c][c];
		}
		sum = 1;
		for (c = 0; c < cols; c++) {
			alpha[c + 1] = beta[c];
			sum -= beta[c];
		}
		alpha[0] = sum;
		return alpha;
	}

	/* out = sum_k lam_k xs[idx_k] */
	function combine(xs, idx, lam, out) {
		var k, d;
		for (d = 0; d < out.length; d++) out[d] = 0;
		for (k = 0; k < idx.length; k++) {
			for (d = 0; d < out.length; d++) out[d] += lam[k] * xs[idx[k]][d];
		}
	}

	/* drop vertices whose weight vanished and renormalise the rest onto the simplex */
	function pruneCorral(idx, lam) {
		var k, w = 0, sum = 0;
		for (k = 0; k < idx.length; k++) {
			if (lam[k] <= WOLFE_EPS) continue;
			idx[w] = idx[k];
			lam[w] = lam[k];
			sum += lam[k];
			w++;
		}
		idx.length = w;
		lam.length = w;
		for (k = 0; k < w; k++) lam[k] /= sum;
	}

	/* Minor cycle: move the corral toward the affine min-norm point until it lies
	 * in the simplex. Returns false when the corral degenerates (rare); the
	 * current point stays a valid point of the hull. */
	function minorCycle(xs, idx, lam, x) {
		var alpha, k, theta, ratio, cycle;
		for (cycle = 0; cycle < MAX_CYCLES; cycle++) {
			alpha = affineMinNorm(xs, idx);
			if (!alpha) return false;
			theta = 1;
			for (k = 0; k < idx.length; k++) {
				if (alpha[k] >= -WOLFE_EPS) continue;
				ratio = lam[k] / (lam[k] - alpha[k]);
				if (ratio < theta) theta = ratio;
			}
			for (k = 0; k < idx.length; k++) lam[k] = (1 - theta) * lam[k] + theta * alpha[k];
			pruneCorral(idx, lam);
			combine(xs, idx, lam, x);
			if (theta === 1) return true;
		}
		return true;
	}

	/* Min-norm point of conv(xs): starts from the shortest vertex and adds the
	 * vertex most against the current iterate until no vertex improves it. */
	function wolfeMinNorm(xs, absFloor2) {
		var n = xs.length;
		var idx, lam, x, i, pick, pv, v, xx, nn, cycle;
		var bestNorm = Infinity, best = 0;
		for (i = 0; i < n; i++) {
			nn = dot(xs[i], xs[i]);
			if (nn < bestNorm) {
				bestNorm = nn;
				best = i;
			}
		}
		idx = [best];
		lam = [1];
		x = xs[best].slice();
		for (cycle = 0; cycle < MAX_CYCLES; cycle++) {
			xx = dot(x, x);
			pick = 0;
			pv = Infinity;
			for (i = 0; i < n; i++) {
				v = dot(x, xs[i]);
				if (v < pv) {
					pv = v;
					pick = i;
				}
			}
			/* relative gap on the squared distance; the absolute floor only ends exact-zero cases */
			if (xx <= absFloor2 || xx - pv <= WOLFE_EPS * xx || idx.indexOf(pick) >= 0) break;
			idx.push(pick);
			lam.push(0);
			if (!minorCycle(xs, idx, lam, x)) break;
		}
		return Math.sqrt(dot(x, x));
	}

	/* Euclidean distance from the target to conv(points) in normalized RU. */
	function nearestHullDist(points, target, scale) {
		var n = points.length;
		var dim = target.length;
		var xs = new Array(n);
		var absFloor = WOLFE_EPS * (1 + normTarget(target, scale));
		var i, d;
		for (i = 0; i < n; i++) {
			xs[i] = new Array(dim);
			for (d = 0; d < dim; d++) {
				xs[i][d] = (points[i].params[d] - target[d]) * (scale ? scale[d] : 1);
			}
		}
		return wolfeMinNorm(xs, absFloor * absFloor);
	}

	/* Asymmetric hull distance: stepping from a hull point x to target along axis d
	 * weights below-x steps by min(1, below) and above-x steps by min(1, above).
	 * Each asymmetric axis lifts by one slack coordinate (M, beta·M) with
	 * beta = cEasy / sqrt(cHard² - cEasy²), reducing to exact Wolfe min-norm. */
	function directionalHullDist(points, target, scale, dirs) {
		var n = points.length;
		var dim = target.length;
		var cNeg = new Array(dim);
		var cPos = new Array(dim);
		var extra = 0;
		var i, d, cHard, cEasy, sgn, unit, beta, maxAbs, a, M, next, shifted, slot;
		for (d = 0; d < dim; d++) {
			cNeg[d] = d < dirs.length ? Math.min(1, dirs[d].below) : 1;
			cPos[d] = d < dirs.length ? Math.min(1, dirs[d].above) : 1;
			if (Math.min(cNeg[d], cPos[d]) < Math.max(cNeg[d], cPos[d]) - 1e-15) extra++;
		}
		var xs = new Array(n);
		for (i = 0; i < n; i++) {
			xs[i] = new Array(dim + extra).fill(0);
			for (d = 0; d < dim; d++) {
				cHard = Math.max(cNeg[d], cPos[d]);
				sgn = cNeg[d] >= cPos[d] ? 1 : -1;
				unit = scale ? scale[d] : 1;
				xs[i][d] = cHard * sgn * (points[i].params[d] - target[d]) * unit;
			}
		}
		slot = dim;
		for (d = 0; d < dim; d++) {
			cHard = Math.max(cNeg[d], cPos[d]);
			cEasy = Math.min(cNeg[d], cPos[d]);
			if (cEasy >= cHard - 1e-15) continue;
			beta = cEasy / Math.sqrt(cHard * cHard - cEasy * cEasy);
			maxAbs = 0;
			for (i = 0; i < xs.length; i++) {
				a = Math.abs(xs[i][d]);
				if (a > maxAbs) maxAbs = a;
			}
			M = maxAbs + 1;
			next = new Array(xs.length * 2);
			for (i = 0; i < xs.length; i++) {
				next[2 * i] = xs[i];
				shifted = xs[i].slice();
				shifted[d] += M;
				shifted[slot] = beta * M;
				next[2 * i + 1] = shifted;
			}
			xs = next;
			slot++;
		}
		var absFloor = WOLFE_EPS * (1 + normTarget(target, scale));
		return wolfeMinNorm(xs, absFloor * absFloor);
	}

	function normTarget(target, scale) {
		var norm = 0;
		for (var d = 0; d < target.length; d++) {
			var v = target[d] * (scale ? scale[d] : 1);
			norm += v * v;
		}
		return Math.sqrt(norm);
	}

	/* distance in normalized research units; omitted scale/dirs keeps raw geometry */
	function distToHull(f, target, scale, dirs) {
		if (f.n === 0) return { inside: false, dist: Infinity };
		var plain = nearestHullDist(f.points, target, scale);
		var inside = plain <= INSIDE_EPS * (1 + normTarget(target, scale));
		if (inside) return { inside: true, dist: 0 };
		return {
			inside: false,
			dist: dirs ? directionalHullDist(f.points, target, scale, dirs) : plain
		};
	}

	/* research fee for one preview: base fee, plus k·(hull distance + frontier
	 * work) in normalized RU. The `inside` short circuit keeps recombinations
	 * at the base fee before the mass factor, even at a range edge. */
	function priceOf(family, t) {
		var base = BASE_PRICE[family] || DEFAULT_BASE;
		var rate = K_DIST * (TIER_SCALE[family] || 1.00);
		if (t.inside) return base;
		return base + rate * (t.dist + t.frontier);
	}

	/* Preview cost of a desired tuple before it is invented. */
	function previewHull(hull, family, params) {
		var f = hull.families[family];
		if (!f || f.n === 0) {
			return { inside: false, dist: Infinity, frontier: 0, cost: Infinity };
		}
		var t = distToHull(f, params, METRIC_SCALE[family], FRONTIER[family]);
		t.frontier = t.inside ? 0 : frontierWork(hull, family, params);
		t.massFactor = massFactor(family, params);
		t.cost = priceOf(family, t) * t.massFactor;
		return t;
	}

	/* Accept the invention: add the point, expanding the hull and its range. */
	function acceptHull(hull, family, params, label) {
		var f = ensureHull(hull, family, params.length);
		f.points.push({ params: params.slice(), label: label || '' });
		f.n = f.points.length;
		return previewHull(hull, family, params);
	}

	function statsHull(hull, family) {
		var f = hull.families[family];
		return f ? { n: f.n, dim: f.dim } : { n: 0, dim: 0 };
	}

	/* the discovered points of a family, oldest first (empty for an unknown family) */
	function pointsHull(hull, family) {
		var f = hull.families[family];
		return f ? f.points : [];
	}

	/* legacy default hull: the family-only API the early benches were written on */
	var defaultHull = createHull();

	function ensure(family, dim) {
		return ensureHull(defaultHull, family, dim);
	}

	function preview(family, params) {
		return previewHull(defaultHull, family, params);
	}

	function accept(family, params, label) {
		return acceptHull(defaultHull, family, params, label);
	}

	function stats(family) {
		return statsHull(defaultHull, family);
	}

	var OrbitScience = {
		createHull: createHull,
		ensureHull: ensureHull,
		previewHull: previewHull,
		acceptHull: acceptHull,
		statsHull: statsHull,
		pointsHull: pointsHull,
		rangeHull: rangeHull,
		frontierWork: frontierWork,
		distToHull: distToHull,
		normalizedParams: normalizedParams,
		ensure: ensure, preview: preview, accept: accept, stats: stats,
		BASE_PRICE: BASE_PRICE, DEFAULT_BASE: DEFAULT_BASE, FRONTIER: FRONTIER,
		TIER_SCALE: TIER_SCALE, METRIC_SCALE: METRIC_SCALE, K_DIST: K_DIST,
		MASS_REFERENCE: MASS_REFERENCE, massFactor: massFactor
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = OrbitScience;
	else root.OrbitScience = OrbitScience;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/*
 * Knowledge volume (career science). Each tech family lives in an N-D
 * parameter space. Discovered items are points; anything inside their convex
 * hull is cheap (a recombination of known tradeoffs), outside costs
 * `k * dist` of new scientific work. Pure functions, no DOM, node-safe.
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

	var INSIDE_EPS = 1e-9; // relative to the target magnitude
	var WOLFE_EPS = 1e-12;
	var MAX_CYCLES = 64;
	var K_DIST = 6.0; // purse per unit distance outside the hull

	var BASE_PRICE = {
		engine: 2.00, catapult: 3.00, panel: 1.50, battery: 1.00,
		hold: 1.00, tank: 1.00
	};
	var TIER_SCALE = {
		engine: 1.00, catapult: 1.20, panel: 0.90, battery: 1.00,
		hold: 1.10, tank: 1.00
	};

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

	/* Distance from the target to conv(points). Vertices are translated so the
	 * target is the origin; the major cycle adds the vertex most against the
	 * current nearest point until no vertex improves it (optimality certificate). */
	function nearestHullDist(points, target) {
		var n = points.length;
		var dim = target.length;
		var xs = new Array(n);
		var idx, lam, x, i, d, pick, pv, v, xx, nn, cycle;
		var bestNorm = Infinity, best = 0;
		var absFloor = WOLFE_EPS * (1 + Math.sqrt(dot(target, target)));
		var absFloor2 = absFloor * absFloor;
		for (i = 0; i < n; i++) {
			xs[i] = new Array(dim);
			for (d = 0; d < dim; d++) xs[i][d] = points[i].params[d] - target[d];
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

	function normTarget(target) {
		return Math.sqrt(dot(target, target));
	}

	/* distance from target to the family's hull, zero when inside */
	function distToHull(f, target) {
		if (f.n === 0) return { inside: false, dist: Infinity };
		var dist = nearestHullDist(f.points, target);
		var inside = dist <= INSIDE_EPS * (1 + normTarget(target));
		return { inside: inside, dist: inside ? 0 : dist };
	}

	/* research fee for one distance result: base fee, plus k·dist outside */
	function priceOf(family, t) {
		var base = BASE_PRICE[family] || 1.00;
		var scale = TIER_SCALE[family] || 1.00;
		return base + (t.inside ? 0 : K_DIST * t.dist * scale);
	}

	/* Preview cost of a desired tuple before it is invented. */
	function previewHull(hull, family, params) {
		var f = hull.families[family];
		if (!f || f.n === 0) {
			return { inside: false, dist: Infinity, cost: Infinity };
		}
		var t = distToHull(f, params);
		return { inside: t.inside, dist: t.dist, cost: priceOf(family, t) };
	}

	/* Accept the invention: add the point, expanding the hull. */
	function acceptHull(hull, family, params, label) {
		var f = ensureHull(hull, family, params.length);
		f.points.push({ params: params.slice(), label: label || '' });
		f.n = f.points.length;
		return { inside: true, dist: 0, cost: BASE_PRICE[family] || 1.00 };
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
		distToHull: distToHull,
		ensure: ensure, preview: preview, accept: accept, stats: stats,
		BASE_PRICE: BASE_PRICE,
		TIER_SCALE: TIER_SCALE, K_DIST: K_DIST
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = OrbitScience;
	else root.OrbitScience = OrbitScience;
})(typeof globalThis !== 'undefined' ? globalThis : this);

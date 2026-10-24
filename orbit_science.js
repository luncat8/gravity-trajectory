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
 * Distance to hull = min ||P w - p|| s.t. w >= 0, sum(w) = 1, solved by
 * projected gradient with simplex projection; by Carathéodory this is exact
 * for the convex hull of all discovered points of the family.
 */
(function (root) {
	'use strict';

	var EPS = 1e-7;
	var K_DIST = 6.0; // purse per unit distance outside the hull
	var MAX_ITER = 200;

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

	/* Project vector v onto the simplex {w >= 0, sum(w) = 1}. */
	function projectSimplex(v) {
		var n = v.length;
		var u = v.slice();
		var i, j, cum, t, s;
		u.sort(function (a, b) { return b - a; });
		cum = 0;
		t = 0;
		for (i = 0; i < n; i++) {
			cum += u[i];
			t = (cum - 1) / (i + 1);
			if (i + 1 < n && u[i + 1] <= t) break;
		}
		s = 0;
		for (j = 0; j < n; j++) {
			s = v[j] - t;
			v[j] = s < 0 ? 0 : s;
		}
		return v;
	}

	/* Distance from target to conv(points), and whether target is inside. */
	function distToHull(f, target) {
		var n = f.n;
		var dim = f.dim;
		var w = new Array(n);
		var grad = new Array(n);
		var Pw = new Array(dim);
		var i, k, d, norm2, resid, gw, same;
		var invL, best;

		if (n === 0) return { inside: false, dist: Infinity, cost: Infinity };
		if (n === 1) {
			d = 0;
			for (k = 0; k < dim; k++) {
				resid = target[k] - f.points[0].params[k];
				d += resid * resid;
			}
			return { inside: d <= EPS * EPS, dist: Math.sqrt(d), cost: Math.sqrt(d) };
		}

		/* an accepted vertex is exactly inside: the gradient solver below
		 * converges slowly on near-collinear real tech points */
		for (i = 0; i < n; i++) {
			same = true;
			for (k = 0; k < dim; k++) {
				if (Math.abs(target[k] - f.points[i].params[k]) > EPS * (1 + Math.abs(target[k]))) {
					same = false;
					break;
				}
			}
			if (same) return { inside: true, dist: 0, cost: 0 };
		}

		for (i = 0; i < n; i++) w[i] = 1 / n;
		/* Lipschitz constant upper bound: ||P||_F^2. */
		norm2 = 0;
		for (i = 0; i < n; i++) {
			for (k = 0; k < dim; k++) {
				d = f.points[i].params[k];
				norm2 += d * d;
			}
		}
		invL = 1 / (norm2 + EPS);

		for (i = 0; i < MAX_ITER; i++) {
			/* Pw */
			for (k = 0; k < dim; k++) Pw[k] = 0;
			for (k = 0; k < n; k++) {
				gw = w[k];
				if (gw === 0) continue;
				for (d = 0; d < dim; d++) Pw[d] += gw * f.points[k].params[d];
			}
			/* grad = P^T (Pw - target) */
			for (k = 0; k < n; k++) {
				grad[k] = 0;
				for (d = 0; d < dim; d++) grad[k] += f.points[k].params[d] * (Pw[d] - target[d]);
			}
			/* w = project(w - step * grad) */
			for (k = 0; k < n; k++) w[k] -= invL * grad[k];
			projectSimplex(w);
		}

		/* residual = ||Pw - target|| */
		for (k = 0; k < dim; k++) Pw[k] = 0;
		for (k = 0; k < n; k++) {
			gw = w[k];
			if (gw === 0) continue;
			for (d = 0; d < dim; d++) Pw[d] += gw * f.points[k].params[d];
		}
		resid = 0;
		for (d = 0; d < dim; d++) {
			best = target[d] - Pw[d];
			resid += best * best;
		}
		resid = Math.sqrt(resid);
		return { inside: resid <= EPS * (1 + normTarget(target)), dist: resid, cost: resid };
	}

	function normTarget(target) {
		var s = 0, i;
		for (i = 0; i < target.length; i++) s += target[i] * target[i];
		return Math.sqrt(s);
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

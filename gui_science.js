/*
 * Career science panel: the knowledge-hull plot geometry, the cost surface, merit and spec copy, the accept affordance and the family sliders.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

function scienceParams(family) {
	const axes = SCIENCE_AXES[family];
	const out = new Array(axes.length);
	for (let i = 0; i < axes.length; i++) out[i] = scienceValues[family][axes[i].key];
	return out;
}

function scienceAxisText(axis, value) {
	return value.toFixed(axis.digits);
}

function scienceVectorText(family, params) {
	const axes = SCIENCE_AXES[family];
	const parts = new Array(axes.length);
	for (let i = 0; i < axes.length; i++) parts[i] = params[i].toFixed(axes[i].digits);
	return '[' + parts.join(', ') + ']';
}

function sciencePlotX(axis, value) {
	const width = SCI_PLOT.width - SCI_PLOT.left - SCI_PLOT.right;
	return SCI_PLOT.left + (value - axis.min) / (axis.max - axis.min) * width;
}

function sciencePlotY(axis, value) {
	const height = SCI_PLOT.height - SCI_PLOT.top - SCI_PLOT.bottom;
	return SCI_PLOT.top + (axis.max - value) / (axis.max - axis.min) * height;
}

function scienceCross(o, a, b) {
	return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/* monotone chain: tech records are chronological, not polygon order */
function scienceHullVertices(points) {
	const sorted = new Array(points.length);
	for (let i = 0; i < points.length; i++) sorted[i] = points[i].params;
	sorted.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const lower = [];
	const upper = [];
	for (let i = 0; i < sorted.length; i++) {
		while (lower.length >= 2 && scienceCross(lower[lower.length - 2], lower[lower.length - 1], sorted[i]) <= 0) {
			lower.pop();
		}
		lower.push(sorted[i]);
	}
	for (let i = sorted.length - 1; i >= 0; i--) {
		while (upper.length >= 2 && scienceCross(upper[upper.length - 2], upper[upper.length - 1], sorted[i]) <= 0) {
			upper.pop();
		}
		upper.push(sorted[i]);
	}
	lower.pop();
	upper.pop();
	return lower.concat(upper);
}

function scienceHullOutlineHtml(career, family, axes) {
	const vertices = scienceHullVertices(OrbitScience.pointsHull(career.science, family));
	if (vertices.length < 2) return '';
	const points = new Array(vertices.length);
	for (let i = 0; i < vertices.length; i++) {
		points[i] = sciencePlotX(axes[0], vertices[i][0]).toFixed(2) + ',' +
			sciencePlotY(axes[1], vertices[i][1]).toFixed(2);
	}
	const tag = vertices.length === 2 ? 'polyline' : 'polygon';
	return '<' + tag + ' class="sciKnownHull" points="' + points.join(' ') + '"/>';
}

/* dashed bounds of the per-axis researched range: easy edges stay cool,
 * hard frontier edges (weight >= 1) highlight warm where cost steepens */
function scienceRangeHtml(career, family, axes) {
	const range = OrbitScience.rangeHull(career.science, family);
	if (!range) return '';
	const x0 = sciencePlotX(axes[0], Math.max(axes[0].min, range.min[0]));
	const x1 = sciencePlotX(axes[0], Math.min(axes[0].max, range.max[0]));
	const y0 = sciencePlotY(axes[1], Math.min(axes[1].max, range.max[1]));
	const y1 = sciencePlotY(axes[1], Math.max(axes[1].min, range.min[1]));
	if (x1 - x0 < 0.5 || y1 - y0 < 0.5) return '';
	let html = '<rect class="sciRange" x="' + x0.toFixed(2) + '" y="' + y0.toFixed(2) +
		'" width="' + (x1 - x0).toFixed(2) + '" height="' + (y1 - y0).toFixed(2) +
		'"><title>researched range: outside it new work has a directional cost</title></rect>';
	const dirs = OrbitScience.FRONTIER[family];
	if (!dirs) return html;
	const xa = x0.toFixed(2), xb = x1.toFixed(2), ya = y0.toFixed(2), yb = y1.toFixed(2);
	if (dirs[0].below >= 1 && range.min[0] > axes[0].min) {
		html += '<line class="sciRangeHard" x1="' + xa + '" y1="' + ya + '" x2="' + xa + '" y2="' + yb + '"/>';
	}
	if (dirs[0].above >= 1 && range.max[0] < axes[0].max) {
		html += '<line class="sciRangeHard" x1="' + xb + '" y1="' + ya + '" x2="' + xb + '" y2="' + yb + '"/>';
	}
	if (dirs[1].below >= 1 && range.min[1] > axes[1].min) {
		html += '<line class="sciRangeHard" x1="' + xa + '" y1="' + yb + '" x2="' + xb + '" y2="' + yb + '"/>';
	}
	if (dirs[1].above >= 1 && range.max[1] < axes[1].max) {
		html += '<line class="sciRangeHard" x1="' + xa + '" y1="' + ya + '" x2="' + xb + '" y2="' + ya + '"/>';
	}
	return html;
}

function scienceCostColor(cost, base, max) {
	if (max <= base + 1e-9) return 'rgb(' + SCI_PLOT_STOPS[0].join(',') + ')';
	const t = Math.pow(Math.min(1, Math.max(0, (cost - base) / (max - base))), 0.78);
	const pos = t * (SCI_PLOT_STOPS.length - 1);
	const i = Math.min(SCI_PLOT_STOPS.length - 2, Math.floor(pos));
	const f = pos - i;
	const a = SCI_PLOT_STOPS[i];
	const b = SCI_PLOT_STOPS[i + 1];
	return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' +
		Math.round(a[1] + (b[1] - a[1]) * f) + ',' +
		Math.round(a[2] + (b[2] - a[2]) * f) + ')';
}

/* x/y are the two engineering parameters; colour is the actual career fee.
 * The expensive surface changes only with the hull, not on every slider tick. */
function sciencePlotHtml(career, family) {
	const axes = SCIENCE_AXES[family];
	const plotWidth = SCI_PLOT.width - SCI_PLOT.left - SCI_PLOT.right;
	const plotHeight = SCI_PLOT.height - SCI_PLOT.top - SCI_PLOT.bottom;
	const cellWidth = plotWidth / SCI_PLOT_COLS;
	const cellHeight = plotHeight / SCI_PLOT_ROWS;
	const total = SCI_PLOT_COLS * SCI_PLOT_ROWS;
	const costs = new Array(total);
	let min = Infinity, max = 0;
	for (let row = 0; row < SCI_PLOT_ROWS; row++) {
		const y = axes[1].max - (row + 0.5) / SCI_PLOT_ROWS * (axes[1].max - axes[1].min);
		for (let col = 0; col < SCI_PLOT_COLS; col++) {
			const x = axes[0].min + (col + 0.5) / SCI_PLOT_COLS * (axes[0].max - axes[0].min);
			const p = GravityGame.researchPreview(career, family, [x, y]);
			const cost = Number.isFinite(p.cost) ? careerCost(career, p.cost) : Infinity;
			const k = row * SCI_PLOT_COLS + col;
			costs[k] = cost;
			if (cost < min) min = cost;
			if (cost > max) max = cost;
		}
	}
	let html = '<div class="sciPlotWrap"><svg id="sciCostPlot" class="sciPlot" viewBox="0 0 ' +
		SCI_PLOT.width + ' ' + SCI_PLOT.height + '" role="img" aria-label="' + family +
		' research fee over ' + axes[0].label + ' and ' + axes[1].label + '">' +
		'<g shape-rendering="crispEdges">';
	for (let row = 0; row < SCI_PLOT_ROWS; row++) {
		for (let col = 0; col < SCI_PLOT_COLS; col++) {
			const k = row * SCI_PLOT_COLS + col;
			html += '<rect x="' + (SCI_PLOT.left + col * cellWidth).toFixed(2) + '" y="' +
				(SCI_PLOT.top + row * cellHeight).toFixed(2) + '" width="' + (cellWidth + 0.25).toFixed(2) +
				'" height="' + (cellHeight + 0.25).toFixed(2) + '" fill="' +
				scienceCostColor(costs[k], min, max) + '"/>';
		}
	}
	html += '</g><rect class="sciPlotFrame" x="' + SCI_PLOT.left + '" y="' + SCI_PLOT.top +
		'" width="' + plotWidth + '" height="' + plotHeight + '"/>';
	html += scienceRangeHtml(career, family, axes);
	html += scienceHullOutlineHtml(career, family, axes);
	const known = OrbitScience.pointsHull(career.science, family);
	for (let i = 0; i < known.length; i++) {
		const p = known[i];
		html += '<circle class="sciKnownPoint" cx="' + sciencePlotX(axes[0], p.params[0]).toFixed(2) +
			'" cy="' + sciencePlotY(axes[1], p.params[1]).toFixed(2) + '" r="2"><title>' +
			p.label + ' ' + scienceVectorText(family, p.params) + '</title></circle>';
	}
	const draft = scienceValues[family];
	html += '<circle id="sciDraft" class="sciDraft" cx="' +
		sciencePlotX(axes[0], draft[axes[0].key]).toFixed(2) + '" cy="' +
		sciencePlotY(axes[1], draft[axes[1].key]).toFixed(2) + '" r="3.5"/>';
	html += '<text class="sciPlotTick" x="' + SCI_PLOT.left + '" y="140">' +
		scienceAxisText(axes[0], axes[0].min) + '</text>';
	html += '<text class="sciPlotTick" x="' + (SCI_PLOT.width - SCI_PLOT.right) +
		'" y="140" text-anchor="end">' + scienceAxisText(axes[0], axes[0].max) + '</text>';
	html += '<text class="sciPlotTick" x="' + (SCI_PLOT.left - 3) + '" y="9" text-anchor="end">' +
		scienceAxisText(axes[1], axes[1].max) + '</text>';
	html += '<text class="sciPlotTick" x="' + (SCI_PLOT.left - 3) + '" y="131" text-anchor="end">' +
		scienceAxisText(axes[1], axes[1].min) + '</text>';
	html += '<text class="sciPlotLabel" x="' + (SCI_PLOT.left + plotWidth / 2) +
		'" y="154" text-anchor="middle">' + axes[0].label + '</text>';
	html += '<text class="sciPlotLabel" transform="translate(6 67) rotate(-90)" text-anchor="middle">' +
		axes[1].label + '</text>';
	html += '</svg><div class="sciPlotLegend"><span><i class="sciRamp"></i>fee ' + costText(min) +
		'–' + costText(max) + '</span><span>◎ draft</span>' +
		'<span>┄ researched range</span></div></div>';
	return html;
}

/* one RU in engineering units: the inverse of the family's metric scale, so
 * the line follows the axes and needs no prose per family */
function scienceMetricText(family) {
	const axes = SCIENCE_AXES[family];
	const scale = OrbitScience.METRIC_SCALE[family];
	const rate = (OrbitScience.K_DIST * (OrbitScience.TIER_SCALE[family] || 1)).toFixed(2);
	let text = 'metric · 1 RU';
	for (let i = 0; i < axes.length; i++) {
		text += ' = ' + (scale ? Number((1 / scale[i]).toPrecision(3)) : '?') + ' ' + axes[i].label;
	}
	return text + ' · +' + rate + ' / RU of distance or frontier work';
}

/* par of one merit axis in the axis' own units: a mirrored axis stores its
 * loss, so par 0.20 of the catapult efficiency row reads back as 80 % */
function scienceParText(family, axis) {
	const a = OrbitScience.MERIT[family][axis];
	const meta = SCIENCE_AXES[family][axis];
	const value = a.mirror === undefined ? a.par : a.mirror - a.par;
	return value.toFixed(meta.digits);
}

/* the draft's own merit: which characteristic carries the fee right now */
function scienceMeritText(family, params) {
	const row = OrbitScience.MERIT[family];
	if (!row) return '';
	const axes = SCIENCE_AXES[family];
	const parts = new Array(axes.length);
	for (let i = 0; i < axes.length; i++) {
		parts[i] = axes[i].key + ' ×' + OrbitScience.axisMerit(family, i, params[i]).toFixed(2);
	}
	return 'spec · ' + parts.join(' · ') + ' → ×' + OrbitScience.meritFactor(family, params).toFixed(2);
}

/* the rule behind it: per axis the step per doubling of merit, its par, and
 * the clamp band of the product */
function scienceMeritRuleText(family) {
	const row = OrbitScience.MERIT[family];
	if (!row) return '';
	const axes = SCIENCE_AXES[family];
	const parts = new Array(axes.length);
	for (let i = 0; i < axes.length; i++) {
		parts[i] = axes[i].key + ' 2× ' + (row[i].lower ? 'better' : 'more') + ' = ×' +
			row[i].per2.toFixed(2) + ' (par ' + scienceParText(family, i) + ')';
	}
	return 'spec rule · ' + parts.join(' · ') + ' · band ×' + OrbitScience.MERIT_MIN.toFixed(2) +
		'–×' + OrbitScience.MERIT_MAX.toFixed(2);
}

/* the balance knobs themselves, so a player sees why one direction is dear */
function scienceFrontierText(family) {
	const dirs = OrbitScience.FRONTIER[family];
	if (!dirs) return '';
	const axes = SCIENCE_AXES[family];
	const parts = new Array(axes.length);
	for (let i = 0; i < axes.length; i++) {
		parts[i] = axes[i].key + ' ↓×' + dirs[i].below.toFixed(2) + ' ↑×' + dirs[i].above.toFixed(2);
	}
	return 'frontier · ' + parts.join(' · ') + ' · per RU beyond the researched range';
}

/* §11 balance tooling for the frontier knobs themselves: one paste-ready
 * line per family, usable in an LLM chat like the tech: spec lines */
function scienceSpecText(family) {
	const dirs = OrbitScience.FRONTIER[family];
	if (!dirs) return '';
	const axes = SCIENCE_AXES[family];
	const parts = new Array(axes.length);
	for (let i = 0; i < axes.length; i++) {
		parts[i] = axes[i].key + ': { below: ' + dirs[i].below.toFixed(2) +
			', above: ' + dirs[i].above.toFixed(2) + ' }';
	}
	const scale = (OrbitScience.METRIC_SCALE[family] || []).map(v => Number(v.toFixed(4)));
	const rows = OrbitScience.MERIT[family] || [];
	const merit = rows.map((a, i) => axes[i].key + ': { par: ' + a.par +
		(a.lower ? ', lower: true' : '') +
		(a.mirror === undefined ? '' : ', mirror: ' + a.mirror) +
		', per2: ' + a.per2.toFixed(2) + ' }');
	return 'frontier: ' + family.toUpperCase() + ' { ' + parts.join(', ') + ' }\n' +
		'metric: scale [' + scale.join(', ') + '] RU/unit · k ' + OrbitScience.K_DIST.toFixed(2) +
		' · tier ' + (OrbitScience.TIER_SCALE[family] || 1).toFixed(2) + '\n' +
		'merit: ' + family.toUpperCase() + ' { ' + merit.join(', ') + ' } · band ' +
		OrbitScience.MERIT_MIN + '–' + OrbitScience.MERIT_MAX;
}

function careerCopyFrontier(family) {
	const text = scienceSpecText(family);
	if (!text) return;
	const clipboard = navigator.clipboard;
	if (!clipboard) {
		careerNotice(text);
		return;
	}
	clipboard.writeText(text).then(
		() => careerNotice('copied the ' + family + ' frontier and merit knobs'),
		() => careerNotice(text));
}

function sciencePreviewText(career, family) {
	const params = scienceParams(family);
	const p = GravityGame.researchPreview(career, family, params);
	const where = p.inside ? 'inside hull · recombine' : 'outside · dist ' + p.dist.toFixed(3) + ' RU';
	const frontier = p.frontier > 1e-9 ? ' · frontier +' + p.frontier.toFixed(2) + ' RU' : '';
	const spec = Number.isFinite(p.merit) ? ' · spec ×' + p.merit.toFixed(2) : '';
	return scienceVectorText(family, params) + ' · ' + where + frontier + spec +
		' · fee ' + costText(GravityGame.researchCost(career, family, params));
}

function scienceAcceptWhy(open, poor) {
	if (!open) return 'the career has ended';
	if (poor) return 'the purse cannot cover the research fee';
	return 'accept this point into the knowledge hull';
}

function scienceAcceptButton(career, family) {
	const cost = GravityGame.researchCost(career, family, scienceParams(family));
	const open = career.ended === GravityGame.CAREER_OPEN;
	const poor = !Number.isFinite(cost) || purseTooSmall(career, cost);
	const disabled = !open || poor;
	const why = scienceAcceptWhy(open, poor);
	return '<button class="miniBtn' + (poor && open ? ' costly' : '') +
		'" id="sciAccept" data-act="sciAccept" data-kind="' + family + '"' +
		(disabled ? ' disabled' : '') + ' title="' + why + '">research · ' + costText(cost) + '</button>';
}

function scienceHullText(career) {
	let html = '';
	for (let i = 0; i < GravityGame.SCIENCE_KINDS.length; i++) {
		const kind = GravityGame.SCIENCE_KINDS[i];
		const st = OrbitScience.statsHull(career.science, kind);
		const points = OrbitScience.pointsHull(career.science, kind);
		let custom = '';
		for (let j = 0; j < points.length; j++) {
			if (points[j].label.charAt(0) === 'R') {
				custom += (custom ? ', ' : '') + points[j].label;
			}
		}
		html += '<div class="careerLine dim sciHull">' + kind + ' hull · ' + st.n + ' points' +
			(custom ? ' · ' + custom : '') + '</div>';
	}
	return html;
}

function scienceBlockHtml(career) {
	const family = scienceFamily;
	const axes = SCIENCE_AXES[family];
	let html = '<div id="sciHead" class="careerHead">research lab · purse ' +
		career.ledger.purse.toFixed(2) + '</div>';
	html += '<div class="careerRow sciFamilyRow"><span class="careerBtns">';
	for (let i = 0; i < GravityGame.SCIENCE_KINDS.length; i++) {
		const kind = GravityGame.SCIENCE_KINDS[i];
		html += '<button class="miniBtn' + (kind === family ? ' on' : '') +
			'" data-act="sciFamily" data-family="' + kind +
			'" title="research the ' + kind + ' parameter space">' + kind + '</button>';
	}
	html += '</span></div>';
	html += sciencePlotHtml(career, family);
	for (let i = 0; i < axes.length; i++) {
		const a = axes[i];
		const v = scienceValues[family][a.key];
		html += '<div class="careerRow sciAxis"><span class="careerKind">' + a.label + '</span>' +
			'<input type="range" data-sci-family="' + family + '" data-sci-axis="' + a.key +
			'" min="' + a.min + '" max="' + a.max + '" step="' + a.step + '" value="' + v +
			'" aria-label="' + a.label + '"><span class="sciVal" id="sciVal' + i + '">' +
			scienceAxisText(a, v) + '</span></div>';
	}
	html += '<div class="careerLine dim sciPreview" id="sciPreview" title="base + k·(directional distance + frontier work), multiplied by the spec merit: how demanding the target is on every axis at once">' +
		sciencePreviewText(career, family) + '</div>';
	html += '<div class="careerLine dim sciMetric">' + scienceMetricText(family) + '</div>';
	html += '<div class="careerLine dim sciMetric" id="sciMerit" title="every axis carries its own curve: a stronger, lighter or tighter target is dearer, a weaker, heavier or leakier one cheaper">' +
		scienceMeritText(family, scienceParams(family)) + '</div>';
	html += '<div class="careerLine dim sciMetric">' + scienceMeritRuleText(family) + '</div>';
	html += '<div class="careerRow sciKnobsRow"><span class="careerLine dim sciMetric">' +
		scienceFrontierText(family) + '</span><button class="miniBtn" data-act="sciCopy" data-family="' +
		family + '" title="copy the frontier and spec merit knobs for a balance chat">copy knobs</button></div>';
	html += '<div class="careerRow sciAcceptRow"><span class="careerBtns">' +
		scienceAcceptButton(career, family) + '</span></div>';
	return html + scienceHullText(career);
}

/* keep the research button + purse header live when money moves mid-flight */
function syncSciencePurse(career) {
	if (!careerScienceEl || !career) return;
	const headEl = $('sciHead');
	if (headEl) headEl.textContent = 'research lab · purse ' + career.ledger.purse.toFixed(2);
	const acceptEl = $('sciAccept');
	if (!acceptEl) return;
	const family = scienceFamily;
	const cost = GravityGame.researchCost(career, family, scienceParams(family));
	const open = career.ended === GravityGame.CAREER_OPEN;
	const poor = !Number.isFinite(cost) || purseTooSmall(career, cost);
	acceptEl.disabled = !open || poor;
	acceptEl.classList.toggle('costly', open && poor);
	acceptEl.title = scienceAcceptWhy(open, poor);
	acceptEl.textContent = 'research · ' + costText(cost);
}

/* sliders stay mounted while dragged: patch the readout, draft marker and
 * accept button without resampling the cost surface */
function refreshScienceReadout(career) {
	if (!careerScienceEl || !career) return;
	const family = scienceFamily;
	const axes = SCIENCE_AXES[family];
	for (let i = 0; i < axes.length; i++) {
		const valEl = $('sciVal' + i);
		if (valEl) valEl.textContent = scienceAxisText(axes[i], scienceValues[family][axes[i].key]);
	}
	const previewEl = $('sciPreview');
	if (previewEl) previewEl.textContent = sciencePreviewText(career, family);
	const meritEl = $('sciMerit');
	if (meritEl) meritEl.textContent = scienceMeritText(family, scienceParams(family));
	const draftEl = $('sciDraft');
	if (draftEl) {
		const draft = scienceValues[family];
		draftEl.setAttribute('cx', sciencePlotX(axes[0], draft[axes[0].key]));
		draftEl.setAttribute('cy', sciencePlotY(axes[1], draft[axes[1].key]));
	}
	syncSciencePurse(career);
}

function scienceSliderInput(node) {
	const family = node.dataset.sciFamily;
	const axisKey = node.dataset.sciAxis;
	const axes = SCIENCE_AXES[family];
	if (!axes) return;
	let meta = null;
	for (let i = 0; i < axes.length; i++) {
		if (axes[i].key === axisKey) meta = axes[i];
	}
	if (!meta) return;
	let v = Number(node.value);
	if (!Number.isFinite(v)) return;
	if (v < meta.min) v = meta.min;
	if (v > meta.max) v = meta.max;
	scienceValues[family][axisKey] = v;
	refreshScienceReadout(game.career);
}

function careerScienceFamily(family) {
	if (!SCIENCE_AXES[family]) return;
	scienceFamily = family;
	refreshCareerPanel();
}

function careerResearch() {
	const career = game.career;
	const family = scienceFamily;
	const label = GravityGame.researchLabel(career);
	const params = scienceParams(family);
	const before = career.ledger.purse;
	if (!GravityGame.researchPoint(career, family, params, label)) {
		careerNotice(career.ended !== GravityGame.CAREER_OPEN
			? 'career over · restart for a new HQ'
			: 'research needs the preview fee in the purse');
		return;
	}
	if (turret.pending && !GravityGame.careerCanFire(career, cargoSim, turret.body, turret.speed)) {
		cancelTurret();
	}
	const n = OrbitScience.statsHull(career.science, family).n;
	careerNotice('researched ' + family + ' ' + label + ' ' + scienceVectorText(family, params) +
		' · −' + (before - career.ledger.purse).toFixed(2) + ' · hull ' + n + ' points');
	careerChanged();
}

/*
 * Headless smoke of balance_lab.html: runs the page's classic scripts in a
 * vm with a minimal DOM stub and drives the family switches, sliders,
 * knobs, accept/reset and the copy panels. Run:
 * node experiments/balance_lab_smoke.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'balance_lab.html'), 'utf8');

const SCRIPTS = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
const INLINE = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

function makeEl(id) {
	return {
		id: id || '',
		innerHTML: '',
		textContent: '',
		value: '',
		hidden: false,
		checked: false,
		dataset: {},
		classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
		setAttribute(k, v) { this['attr_' + k] = v; },
		getAttribute(k) { return this['attr_' + k]; },
		focus() {}, select() {},
		addEventListener(type, fn) { (this._handlers = this._handlers || {})[type] = fn; },
		closest() { return null; }
	};
}

const elements = {};
function el(id) {
	if (!elements[id]) elements[id] = makeEl(id);
	return elements[id];
}

const listeners = {};
const document = {
	getElementById: el,
	querySelector(sel) { return makeEl('q:' + sel); },
	querySelectorAll(sel) { return []; },
	addEventListener(type, fn) { listeners[type] = fn; }
};

function fire(type, target) {
	listeners[type]({ target });
}

const sandbox = {
	document, navigator: {}, console, Math, Number, JSON,
	setTimeout: () => 0, clearTimeout: () => {},
	OrbitScience: require(path.join(root, 'orbit_science.js')),
	OrbitTech: require(path.join(root, 'orbit_tech.js'))
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const src of SCRIPTS) {
	vm.runInContext(fs.readFileSync(path.join(root, src), 'utf8'), sandbox, { filename: src });
}
vm.runInContext(INLINE[0], sandbox, { filename: 'balance_lab.html inline' });

let pass = 0, fail = 0;
function ok(name, cond) {
	if (cond) pass++;
	else { fail++; console.log('FAIL ' + name); }
}

/* one screen: family row, plot with tiers, draft, result, knobs, build */
ok('family row', el('familyRow').innerHTML.includes('data-act="family"'));
ok('plot has tier labels', el('plotWrap').innerHTML.includes('IMP-1'));
ok('plot has draft callout', el('plotWrap').innerHTML.includes('fee'));
ok('plot has force line', el('plotWrap').innerHTML.includes('forceLine'));
ok('plot has suggested rung', el('plotWrap').innerHTML.includes('rungMarker'));
ok('draft sliders', el('draftBlock').innerHTML.includes('data-spec="engine:thrust"'));
ok('result shows fee', el('resultBlock').innerHTML.includes('fee'));
ok('result shows build', el('resultBlock').innerHTML.includes('build'));
ok('result shows force', el('resultBlock').innerHTML.includes('thrust'));
ok('result shows suggestion', el('resultBlock').innerHTML.includes('suggests'));
ok('knob block frontier', el('knobBlock').innerHTML.includes('frontier:engine:0:below'));
ok('knob block merit', el('knobBlock').innerHTML.includes('merit:engine:0:par'));
ok('knob block global k', el('knobBlock').innerHTML.includes('data-knob="k"'));
ok('build ladder rows', el('buildBlock').innerHTML.includes('IMP-1'));
ok('build draft row', el('buildBlock').innerHTML.includes('draft'));
ok('build totals', el('buildBlock').innerHTML.includes('totals per family'));
ok('settings blob', el('copySettings').value.includes('frontier: ENGINE'));
ok('settings blob buildShare', el('copySettings').value.includes('buildShare:'));
ok('fee lines blob', el('copyFees').value.includes('fee'));
ok('build table blob', el('copyBuild').value.includes('IMP-1'));

/* spec slider: plot, result and build update live */
fire('input', { dataset: { spec: 'engine:thrust' }, value: '40', type: 'range' });
ok('spec slider moves result fee', el('resultBlock').innerHTML.includes('fee'));
ok('spec slider moves plot callout', el('plotWrap').innerHTML.includes('fee'));

/* balance knob range: plot, build and settings blob update live */
fire('input', { dataset: { knob: 'k', min: '0', max: '12' }, value: '500', type: 'range' });
ok('knob k rewrites settings blob', el('copySettings').value.includes('k 6.00'));
ok('knob k rewrites build table', el('copyBuild').value.includes('IMP-1'));

/* family switch: plot tiers, draft, knobs and build follow */
fire('click', { closest: () => ({ dataset: { act: 'family', family: 'catapult' } }) });
ok('family switch plot tiers', el('plotWrap').innerHTML.includes('EMC-1'));
ok('family switch knobs', el('knobBlock').innerHTML.includes('frontier:catapult:0:below'));
ok('family switch build', el('buildBlock').innerHTML.includes('EMC-1'));

/* accept into hull, then reset */
fire('click', { closest: () => ({ dataset: { act: 'accept' } }) });
ok('accept re-renders plot', el('plotWrap').innerHTML.includes('<svg'));
fire('click', { closest: () => ({ dataset: { act: 'reset' } }) });
ok('reset re-renders plot', el('plotWrap').innerHTML.includes('<svg'));

/* full ladder toggle */
fire('change', { dataset: { act: 'fullladder' }, checked: true });
ok('full ladder keeps plot', el('plotWrap').innerHTML.includes('<svg'));

/* knob number input + checkbox */
fire('change', { dataset: { knob: 'buildShare' }, value: '0.1', type: 'number' });
ok('build share rewrites blob', el('copySettings').value.includes('buildShare: 0.100'));

/* --- the ladder gain card: reprice a table, build-only kinds included --- */

ok('ladder starts on panels', el('ladderRow').innerHTML.includes('data-ladder-kind="panel"'));
ok('ladder lists every rung', el('ladderBlock').innerHTML.includes('SP-4'));
ok('ladder names the kept base', el('ladderBlock').innerHTML.includes('kept base'));
ok('ladder prices a rung per money', el('ladderBlock').innerHTML.includes('per 1.00'));
ok('ladder says a build-only table has no fee',
	el('ladderBlock').innerHTML.includes('build-only'));
ok('ladder patch is a paste-ready table', el('copyLadder').value.includes("const PANELS = ["));
ok('ladder patch keeps the digits of the shipped table',
	el('copyLadder').value.includes("id: 'SP-1', tier: 1, power: 1.0"));

/* gain ×2 moves every step above the kept rung and leaves the rung itself be */
fire('input', { dataset: { ladder: 'gain' }, type: 'range', value: '2' });
ok('gain ×2 doubles the step', el('copyLadder').value.includes("power: 6.6"));
ok('gain ×2 keeps the base rung', el('copyLadder').value.includes("id: 'SP-1', tier: 1, power: 1.0"));
ok('gain ×2 reports the drift against the shipped table',
	el('ladderBlock').innerHTML.includes('write the patch'));
ok('the shipped table is not mutated', sandbox.OrbitTech.PANELS[1].power === 3.8);

/* gain ×0 collapses the ladder: every moved rung buys nothing over the base */
fire('change', { dataset: { ladder: 'gain' }, type: 'number', value: '0' });
ok('a flat ladder is called out', el('ladderBlock').innerHTML.includes('flat step: SP-2'));
fire('click', { closest: () => ({ dataset: { act: 'ladderReset' } }) });
ok('reset restores the shipped specs', el('copyLadder').value.includes('gain ×1.00'));
ok('reset puts the doubled step back to the table value',
	el('copyLadder').value.includes("power: 3.8"));

/* another kind, and its tier-0 record survives the patch */
fire('click', { closest: () => ({ dataset: { act: 'ladder', ladderKind: 'hold' } }) });
ok('ladder follows the kind', el('ladderBlock').innerHTML.includes('HOLD-24'));
ok('the patch keeps the free tier-0 record', el('copyLadder').value.includes("'HOLD-0'"));
ok('the keep select lists the rungs', el('ladderKnob').innerHTML.includes('HOLD-8 · capacity 8'));
fire('change', { dataset: { ladder: 'keep' }, type: 'select-one', value: '1' });
ok('a rung below the kept one is marked, not moved',
	el('ladderBlock').innerHTML.includes('kept below'));
ok('the kept rung is the selected one', el('ladderBlock').innerHTML.includes('kept base'));

/* the fee knobs drive the ladder too: the build cost is the same formula */
const patchBeforeK = el('copyLadder').value;
fire('input', { dataset: { knob: 'k', min: '0', max: '12' }, value: '1000', type: 'range' });
ok('the ladder re-prices with the fee knobs', el('copyLadder').value !== patchBeforeK);

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

/*
 * View checkboxes remembered across visits: `trails` and `clean render`.
 *
 * 1. Without stored keys both boxes boot checked and toggling stores '0'/'1'.
 * 2. Stored '0' boots both boxes unchecked, the state flags follow, and the
 *    stored choice outranks the checkbox's HTML default.
 * 3. No localStorage (file:// private mode) still boots on the defaults.
 *
 * Run: node experiments/view_prefs_test.js
 */
'use strict';

const assert = require('assert');
const vm = require('vm');
const { loadPage } = require('./dom_stub.js');

const get = (env, expr) => vm.runInContext(expr, env.context);
const SEARCH = '?mode=lab&seed=5';

/* --- 1. defaults, toggles store ----------------------------------------- */
{
	const storage = {};
	const env = loadPage({ search: SEARCH, storage });
	assert.strictEqual(env.elements.get('trailView').checked, true, 'trails default on');
	assert.strictEqual(env.elements.get('careerClean').checked, true, 'clean render default on');
	env.toggle('trailView');
	env.toggle('careerClean');
	assert.strictEqual(storage['gravity.trails'], '0', 'trails off is stored');
	assert.strictEqual(storage['gravity.cleanRender'], '0', 'clean render off is stored');
	assert.strictEqual(get(env, 'trailRivalsOn'), false);
	assert.strictEqual(get(env, 'cleanCareerView'), false);
	env.toggle('trailView');
	assert.strictEqual(storage['gravity.trails'], '1', 'trails on again is stored');
}

/* --- 2. stored choice boots ---------------------------------------------- */
{
	const env = loadPage({ search: SEARCH, storage: { 'gravity.trails': '0', 'gravity.cleanRender': '0' } });
	assert.strictEqual(env.elements.get('trailView').checked, false, 'stored trails off shows unchecked');
	assert.strictEqual(env.elements.get('careerClean').checked, false, 'stored clean off shows unchecked');
	assert.strictEqual(get(env, 'trailRivalsOn'), false, 'and the trail flag follows');
	assert.strictEqual(get(env, 'cleanCareerView'), false, 'and the clean flag follows');
	env.runFrames(2, 16);
	assert.strictEqual(env.elements.get('trailView').checked, false, 'a UI refresh keeps the stored choice');
	assert.strictEqual(env.elements.get('careerClean').checked, false);
}

/* --- 3. no storage -------------------------------------------------------- */
{
	const env = loadPage({ search: SEARCH });
	assert.strictEqual(get(env, 'trailRivalsOn'), true);
	assert.strictEqual(get(env, 'cleanCareerView'), true);
	env.toggle('trailView');
	assert.strictEqual(get(env, 'trailRivalsOn'), false, 'toggling works without storage');
}

console.log('VIEW PREFS OK · trails and clean render remembered');

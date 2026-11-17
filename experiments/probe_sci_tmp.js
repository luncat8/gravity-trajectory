'use strict';
const vm = require('vm');
const { loadPage, mapSearch } = require('./dom_stub.js');
const get = (env, expr) => vm.runInContext(expr, env.context);
const search = '?rule=career&cheat=communism&seed=42&rate=1';
const live = loadPage({ search });
get(live, `(() => { const c = playerCareer(); c.ledger.purse = 5; scienceFamily = OrbitTech.KIND_ENGINE; })()`);
get(live, `careerAct({ act: 'sciAccept' })`);
const liveHull = get(live, `JSON.stringify(OrbitScience.statsHull(playerCareer().science, OrbitTech.KIND_ENGINE))`);
console.log('live hull after 1 research:', liveHull);
console.log('log actions:', get(live, 'JSON.stringify(careerActionLog)'));
live.click('gameCopy');
const actionsText = get(live, 'gameLinkEl.value');
const fresh = loadPage({ search });
fresh.elements.get('replayInput').value = actionsText;
fresh.click('replayLoad');
fresh.runFrames(60, 16.0);
console.log('fresh hull:', get(fresh, `JSON.stringify(OrbitScience.statsHull(playerCareer().science, OrbitTech.KIND_ENGINE))`));
console.log('applied', get(fresh, 'careerActionReplay.applied'), 'skipped', get(fresh, 'careerActionReplay.skipped'));
try {
	const r = fresh.context.applyCareerAct({ act: 'sciAccept', family: 'engine' });
	console.log('applyCareerAct direct ->', r);
} catch (error) {
	console.log('applyCareerAct threw:', error && error.stack);
}
try {
	fresh.context.careerResearch();
	console.log('careerResearch direct ok');
} catch (error) {
	console.log('careerResearch threw:', error && error.stack);
}

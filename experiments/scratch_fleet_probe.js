/* scratch: page boot with fleet wiring (not part of the tier) */
'use strict';
const { loadPage, mapSearch } = require('./dom_stub.js');

const page = loadPage({ search: mapSearch(1) });
const scene = page.context.GravityScene;
const G = page.context.GravityGame;
const career = scene.career;
console.log('boot ok · hq', career.hq, 'purse', career.ledger.purse.toFixed(2));
console.log('fleetCount', scene.fleetCount(), 'checkbox', page.elements.get('expFleet') ?
	(page.elements.get('expFleet').checked ? 'on' : 'off') : 'MISSING');
const careerFleetEl = page.elements.get('careerFleet');
console.log('drawer fleet block:', careerFleetEl ? careerFleetEl.textContent.slice(0, 90) : 'MISSING');
const fleetRows = page.elements.get('scoreFleetRows');
console.log('scoreFleetRows hidden:', fleetRows ? fleetRows.hidden : 'MISSING');
page.context.careerAct({ act: 'buyShip' });
console.log('buy with box off → fleet', scene.fleetCount());

// toggle the checkbox on, fund, buy
page.elements.get('expFleet').checked = true;
page.context.onFleetChange ? page.context.onFleetChange() : null;
career.ledger.purse = 100;
console.log('refusal now:', G.fleetBuyRefusal(career, scene.sim));
page.context.careerAct({ act: 'buyShip' });
console.log('buy → fleet', scene.fleetCount(), 'purse', career.ledger.purse.toFixed(2));
console.log('fleet rows:', fleetRows.hidden ? 'hidden' : 'shown',
	fleetRows ? fleetRows.children.length : 0);
console.log('row text:', fleetRows && fleetRows.children[0] ?
	fleetRows.children[0].textContent.replace(/\s+/g, ' ') : '-');
console.log('scene.fleet()', scene.fleet().length);
// turn the box off: ships stay
page.elements.get('expFleet').checked = false;
page.context.onFleetChange();
console.log('box off → fleetUnlocked', career.fleetUnlocked, 'fleet keeps', scene.fleetCount());
console.log('buy again →', G.fleetBuyRefusal(career, scene.sim));
// step a few world steps through the page's own loop pieces
const trade = page.context.tradeSim || require('vm').runInContext('tradeSim', page.context);
const market = scene.game.market;
for (let i = 0; i < 2000; i++) {
	const flying = scene.sim.status === 1 && scene.sim.liveSteps < scene.sim.stepLimit;
	G.careerAdvance(career, 1, flying);
	if (flying) scene.sim.stepOne();
	trade.advanceTo(trade.t + 1 / 120);
	scene.sim.fieldT = trade.t;
	scene.bot.stepCareer(i, market, trade, 1);
	scene.bot.stepFleet(i, market, trade, 1);
}
console.log('after steps: ship at', scene.fleet()[0].at, 'fly', scene.fleet()[0].flying,
	'cond', scene.fleet()[0].ship.condition.toFixed(2), 'purse', career.ledger.purse.toFixed(2));
console.log('fleetShip cleared:', career.fleetShip === null);
console.log('row text:', fleetRows.children[0]._fleetNodes.name.textContent, '·',
	fleetRows.children[0]._fleetNodes.meta.textContent);

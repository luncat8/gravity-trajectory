/*
 * Real-browser HUD layout check: the DOM smoke suite cannot measure CSS, so
 * this drives headless Chromium over index.html and asserts the action rows
 * stay reachable and the launch label never reflows its neighbours.
 *
 * Needs a Chromium/Chrome binary: CHROME_PATH=/path/to/chrome node experiments/layout_check.js
 * Optional: PUPPETEER_DIR=/path/to/module (when puppeteer-core is not resolvable).
 */
'use strict';

const path = require('path');

const CHROME_PATH = process.env.CHROME_PATH || '';
const PUPPETEER_DIR = process.env.PUPPETEER_DIR || '';

if (!CHROME_PATH) {
	console.log('LAYOUT CHECK SKIPPED — set CHROME_PATH to a Chromium binary');
	process.exit(0);
}

function loadPuppeteer() {
	try {
		return require('puppeteer-core');
	} catch (error) {
		if (!PUPPETEER_DIR) throw error;
		return require(path.join(PUPPETEER_DIR, 'puppeteer-core'));
	}
}

const puppeteer = loadPuppeteer();
const PAGE_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const SIZES = [[1440, 900], [1280, 800], [1280, 600], [1024, 700], [900, 640], [800, 560], [520, 760], [390, 700]];
const failures = [];

function check(ok, message) {
	if (ok) return;
	failures.push(message);
}

/* rects + the invariant: foot row above the trade footer, nothing outside the viewport */
async function measure(page) {
	return page.evaluate(() => {
		const rect = id => document.getElementById(id).getBoundingClientRect();
		const hud = document.getElementById('cargoHud');
		const body = document.getElementById('cargoBody');
		const foot = rect('cargoFoot');
		const trade = rect('tradeControls');
		const launch = rect('launch');
		const best = rect('routeBest');
		const clear = rect('clear');
		const hudRect = hud.getBoundingClientRect();
		const bestHit = best.width > 0 && best.height > 0
			? document.elementFromPoint(best.left + best.width * 0.5, best.top + best.height * 0.5)
			: null;
		return {
			footBottom: foot.bottom, footTop: foot.top,
			tradeTop: trade.top, viewport: innerHeight,
			launch: [launch.top, launch.height],
			best: [best.top, best.width, document.getElementById('routeBest').hidden,
				best.bottom, best.height, bestHit ? bestHit.id : ''],
			clearTop: clear.top,
			scrollable: body.scrollHeight > body.clientHeight + 1,
			hudBottom: hudRect.bottom
		};
	});
}

async function setRoute(page) {
	await page.evaluate(() => {
		const set = id => {
			const el = document.getElementById(id);
			el.checked = true;
			el.dispatchEvent(new Event('change', { bubbles: true }));
		};
		set('modeRoute');
	});
}

/* a free planet whose disc sits well inside the viewport at this window size */
async function pickPlanet(page) {
	return page.evaluate(() => {
		const sim = OrbitScene.sim;
		const view = OrbitScene.view;
		/* keep the disc clear of the three HUD panels, not just the window edges */
		const left = 260;
		const right = innerWidth - 340;
		const top = 250;
		const bottom = innerHeight - 100;
		for (let planet = 0; planet < sim.planetX.length; planet++) {
			const x = sim.planetX[planet] * view.scale + view.offX;
			const y = sim.planetY[planet] * view.scale + view.offY;
			if (x < left || y < top || x > right || y > bottom) continue;
			if (GravityScene.routeOccupiedBy(planet) >= 0) continue;
			return { planet, x, y, reach: GravityScene.sim.gripLength(120) * view.scale };
		}
		return null;
	});
}

/* one real drag from a planet, so a finished plan and its best slot exist */
async function dragPlan(page) {
	const start = await pickPlanet(page);
	if (!start) return false;
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x + Math.cos(-0.6) * start.reach,
		start.y + Math.sin(-0.6) * start.reach, { steps: 6 });
	await page.mouse.up();
	await page.waitForFunction(() => GravityScene.routeBest().ready, { timeout: 8000 });
	return true;
}

/* the aim label must stay on one line while the launch label changes */
async function dragAimAndWatchRow(page) {
	const start = await pickPlanet(page);
	if (!start) return;
	const rowBefore = await page.evaluate(() => {
		const clear = document.getElementById('clear').getBoundingClientRect();
		return [clear.top, clear.width, clear.height];
	});
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	for (const speed of [40, 90, 160]) {
		const reach = await page.evaluate(v => GravityScene.sim.gripLength(v) * OrbitScene.view.scale, speed);
		await page.mouse.move(start.x + Math.cos(1.4) * reach, start.y + Math.sin(1.4) * reach, { steps: 3 });
		await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
	}
	await page.mouse.up();
	await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
	const rowAfter = await page.evaluate(() => {
		const clear = document.getElementById('clear').getBoundingClientRect();
		const aim = document.getElementById('aimReadout');
		const style = getComputedStyle(aim);
		return { clear: [clear.top, clear.width, clear.height], aim: [aim.clientHeight, style.whiteSpace] };
	});
	check(rowBefore[0] === rowAfter.clear[0] && rowBefore[1] === rowAfter.clear[1] &&
		rowBefore[2] === rowAfter.clear[2], 'clear button moved while aiming on ' + start.planet);
	check(rowAfter.aim[1] === 'nowrap', 'aim readout wraps');
	check(rowAfter.aim[0] <= 20, 'aim readout grew to ' + rowAfter.aim[0] + 'px');
}

/* live score text must not resize the scoreboard and shove the trade HUD below it */
async function scoreboardStable(page) {
	const heights = new Set();
	for (let i = 0; i < 16; i++) {
		heights.add(await page.evaluate(() => Math.round(
			document.getElementById('scoreHud').getBoundingClientRect().height)));
		await page.evaluate(() => new Promise(done => requestAnimationFrame(done)));
	}
	check(heights.size === 1, 'scoreboard changes height while scores update: ' + [...heights].join('/'));
}

(async () => {
	const browser = await puppeteer.launch({
		executablePath: CHROME_PATH,
		args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'],
		headless: 'shell'
	});
	try {
		for (const [width, height] of SIZES) {
			const page = await browser.newPage();
			await page.setViewport({ width, height });
			const errors = [];
			page.on('pageerror', error => errors.push(error.message));
			await page.goto(PAGE_URL);
			await page.waitForSelector('#launch');
			await setRoute(page);
			const planned = await dragPlan(page);

			const layout = await measure(page);
			const label = width + 'x' + height;
			check(layout.footBottom <= layout.tradeTop,
				label + ': action row overlaps the trade footer (' + Math.round(layout.footBottom) + ' > ' + Math.round(layout.tradeTop) + ')');
			check(layout.best[3] <= layout.viewport && layout.best[0] >= 0 && !layout.best[2],
				label + ': use best is out of view (' + Math.round(layout.best[0]) + '..' + Math.round(layout.best[3]) + ' vs ' + layout.viewport + ')');
			check(layout.best[3] <= layout.hudBottom + 1,
				label + ': use best clipped below cargoHud');
			check(layout.best[5] === 'routeBest',
				label + ': use best occluded by #' + layout.best[5]);
			if (planned) check(layout.best[1] > 80, label + ': use best collapsed to ' + Math.round(layout.best[1]) + 'px');
			check(layout.launch[1] > 20, label + ': launch row collapsed');
			check(errors.length === 0, label + ': page error ' + errors.join(' / '));
			await dragAimAndWatchRow(page);
			await scoreboardStable(page);
			if (width === 1280 && height === 800) {
				await page.evaluate(() => {
					const hard = document.getElementById('botHard');
					hard.checked = true;
					hard.dispatchEvent(new Event('change', { bubbles: true }));
				});
				await page.click('#rivalBot1');
				await page.click('#scoreRival1');
				const multiCheck = await page.evaluate(() => {
					const r = id => document.getElementById(id).getBoundingClientRect();
					return {
						active: GravityScene.activeSlot(),
						types: [GravityScene.slotType(0), GravityScene.slotType(1), GravityScene.slotType(2)],
						botWidths: [r('playerBot').width, r('rivalBot1').width, r('rivalBot2').width],
						rowHeights: [r('scorePlayer').height, r('scoreRival1').height, r('scoreRival2').height]
					};
				});
				check(multiCheck.active === 1 && multiCheck.types[0] === 'user' &&
					multiCheck.types[1] === 'user' && multiCheck.types[2] === 'bot',
					label + ': scoreboard click/bot toggle failed ' + JSON.stringify(multiCheck));
				check(multiCheck.botWidths.every(w => w >= 10) &&
					multiCheck.rowHeights.every(h => h >= 28 && h <= 46),
					label + ': scoreboard checkbox geometry invalid ' + JSON.stringify(multiCheck));
			}
			console.log(label, 'foot', Math.round(layout.footTop) + '..' + Math.round(layout.footBottom),
				'| trade', Math.round(layout.tradeTop),
				'| use best', Math.round(layout.best[1]) + 'px',
				'| body scrolls', layout.scrollable ? 'yes' : 'no');
			await page.close();
		}
		/* the career drawer must keep the same invariants with the shop open */
		for (const [width, height] of SIZES) {
			const page = await browser.newPage();
			await page.setViewport({ width, height });
			const errors = [];
			page.on('pageerror', error => errors.push(error.message));
			await page.goto(PAGE_URL + '?mode=career&seed=42&rate=1');
			await page.waitForSelector('#careerBox');
			const label = width + 'x' + height + ' career';
			const layout = await measure(page);
const drawer = await page.evaluate(() => {
	const box = document.getElementById('careerBox');
	const panel = document.getElementById('careerHud');
	const hud = panel.getBoundingClientRect();
	const rect = box.getBoundingClientRect();
	return {
		visible: !box.hidden,
		run: !document.getElementById('runBox').hidden,
		rivals: document.getElementById('rivalGroup').hidden,
		scrollWidth: box.scrollWidth,
		width: rect.width,
		inside: rect.left >= hud.left - 1 && rect.right <= hud.right + 1,
		buttons: box.querySelectorAll('button').length,
		pad: document.getElementById('careerPad').textContent.indexOf('kWh') >= 0
	};
});
			check(errors.length === 0, label + ': page error ' + errors.join(' / '));
			check(layout.footBottom <= layout.tradeTop, label + ': foot row overlaps the trade footer');
			check(drawer.visible && drawer.run && drawer.rivals, label + ': boxes ' + JSON.stringify(drawer));
			check(drawer.buttons >= 7 && drawer.pad, label + ': shop ' + drawer.buttons + ' buttons');
			check(drawer.scrollWidth <= drawer.width + 1 && drawer.inside,
				label + ': drawer overflows ' + drawer.scrollWidth + ' > ' + Math.round(drawer.width));
			console.log(label, 'foot', Math.round(layout.footTop) + '..' + Math.round(layout.footBottom),
				'| trade', Math.round(layout.tradeTop), '| shop', drawer.buttons, 'buttons');
			await page.close();
		}
	} finally {
		await browser.close();
	}

	if (failures.length > 0) {
		console.error('LAYOUT CHECK FAILED\n  ' + failures.join('\n  '));
		process.exit(1);
	}
	console.log('LAYOUT CHECK OK');
})();

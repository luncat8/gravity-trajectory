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
			check(layout.hudBottom <= layout.footTop + 1,
				label + ': cargoHud overlaps cargoFoot (' + Math.round(layout.hudBottom) + ' > ' + Math.round(layout.footTop) + ')');
			check(layout.best[3] <= layout.viewport && layout.best[0] >= 0 && !layout.best[2],
				label + ': use best is out of view (' + Math.round(layout.best[0]) + '..' + Math.round(layout.best[3]) + ' vs ' + layout.viewport + ')');
			check(layout.best[3] <= layout.footBottom + 1,
				label + ': use best clipped below cargoFoot');
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
				const left = document.getElementById('leftHud');
				const score = document.getElementById('scoreHud');
				const trade = document.getElementById('tradeHud');
				const hud = panel.getBoundingClientRect();
				const rect = box.getBoundingClientRect();
				const leftRect = left.getBoundingClientRect();
				const scoreRect = score.getBoundingClientRect();
				const tradeRect = trade.getBoundingClientRect();
				return {
					visible: !box.hidden,
					run: !document.getElementById('runBox').hidden,
					rivals: document.getElementById('rivalGroup').hidden,
					scrollWidth: box.scrollWidth,
					width: rect.width,
					inside: rect.left >= hud.left - 1 && rect.right <= hud.right + 1 &&
						hud.right <= leftRect.right + 1,
					buttons: box.querySelectorAll('button').length,
					pad: document.getElementById('careerPad').textContent.indexOf('kWh') >= 0,
					pushedDown: scoreRect.bottom <= hud.top + 1 && hud.bottom <= tradeRect.top + 1 && hud.height >= 400,
					leftBottom: leftRect.bottom,
					leftScrolls: left.scrollHeight > left.clientHeight
				};
			});
			await page.click('#careerBox [data-act="careerTab"][data-tab="science"]');
			const sciLayout = [];
			for (const family of ['engine', 'catapult', 'tank', 'battery']) {
				await page.click('#careerBox [data-act="sciFamily"][data-family="' + family + '"]');
				sciLayout.push(await page.evaluate(fam => {
					const box = document.getElementById('careerBox');
					const hud = document.getElementById('careerHud').getBoundingClientRect();
					const left = document.getElementById('leftHud').getBoundingClientRect();
					const plot = document.getElementById('sciCostPlot').getBoundingClientRect();
					return {
						family: fam,
						overflow: box.scrollWidth - box.clientWidth,
						hudOverflow: hud.right - left.right,
						plotW: plot.width,
						plotH: plot.height
					};
				}, family));
			}
			await page.click('#careerBox [data-act="careerTab"][data-tab="operations"]');
			await page.evaluate(() => {
				const left = document.getElementById('leftHud');
				left.scrollTop = left.scrollHeight;
			});
			const afterScroll = await page.evaluate(() => {
				const leftRect = document.getElementById('leftHud').getBoundingClientRect();
				const tradeRect = document.getElementById('tradeHud').getBoundingClientRect();
				return {
					tradeVisible: tradeRect.top >= leftRect.top - 1 && tradeRect.bottom <= leftRect.bottom + 2
				};
			});
			await page.evaluate(() => { document.getElementById('leftHud').scrollTop = 0; });
			await page.click('#careerFoldBtn');
			const afterFold = await page.evaluate(() => {
				const panel = document.getElementById('careerHud');
				const scoreRect = document.getElementById('scoreHud').getBoundingClientRect();
				const careerRect = panel.getBoundingClientRect();
				const tradeRect = document.getElementById('tradeHud').getBoundingClientRect();
				return {
					folded: panel.classList.contains('folded'),
					careerH: careerRect.height,
					tradePulledUp: tradeRect.top <= scoreRect.bottom + careerRect.height + 20
				};
			});
			await page.click('#careerFoldBtn');
			const strandedLayout = await page.evaluate(() => {
				const career = GravityScene.career;
				const other = (career.hq + 1) % 26;
				career.at = other;
				career.stranded = true;
				GravityScene.refreshCareerPanel();
				const foot = document.getElementById('cargoFoot').getBoundingClientRect();
				const helper = document.getElementById('helperGroup').getBoundingClientRect();
				const launch = document.getElementById('launch');
				const actions = document.getElementById('planetActions');
				const launchShown = !launch.hidden;
				const actionsShown = !actions.hidden;
				const build = document.getElementById('launchBuild').getBoundingClientRect();
				const commercial = document.getElementById('launchCommercial').getBoundingClientRect();
				const evac = document.getElementById('launchEvac').getBoundingClientRect();
				career.at = -1;
				GravityScene.refreshCareerPanel();
				const lostBuildHidden = document.getElementById('launchBuild').hidden &&
					document.getElementById('launchCommercial').hidden;
				const lostEvac = document.getElementById('launchEvac').getBoundingClientRect();
				career.at = career.hq;
				career.stranded = false;
				GravityScene.refreshCareerPanel();
				return {
					helperInFoot: helper.top >= foot.top && helper.bottom <= foot.bottom,
					launchShown,
					actionsShown,
					buildW: build.width,
					buildH: build.height,
					commercialW: commercial.width,
					commercialH: commercial.height,
					evacW: evac.width,
					evacH: evac.height,
					insideFoot: build.right <= foot.right + 1 && commercial.right <= foot.right + 1 &&
						evac.right <= foot.right + 1,
					lostBuildHidden,
					lostEvacW: lostEvac.width,
					restoredLaunch: !launch.hidden &&
						!document.getElementById('launchCommercial').hidden
				};
			});
			check(errors.length === 0, label + ': page error ' + errors.join(' / '));
			check(layout.footBottom <= layout.tradeTop, label + ': foot row overlaps the trade footer');
			check(layout.hudBottom <= layout.footTop + 1,
				label + ': cargoHud overlaps cargoFoot (' + Math.round(layout.hudBottom) + ' > ' + Math.round(layout.footTop) + ')');
			check(strandedLayout.helperInFoot && strandedLayout.launchShown &&
				strandedLayout.actionsShown && strandedLayout.buildW >= 60 &&
				strandedLayout.commercialW >= 60 && strandedLayout.evacW >= 60 &&
				strandedLayout.buildH >= 24 && strandedLayout.commercialH >= 24 &&
				strandedLayout.insideFoot && strandedLayout.lostBuildHidden &&
				strandedLayout.lostEvacW >= 120 && strandedLayout.restoredLaunch,
				label + ': stranded cargoFoot layout invalid ' + JSON.stringify(strandedLayout));
			check(drawer.leftBottom <= layout.tradeTop + 1, label + ': leftHud overlaps the trade footer');
			check(drawer.visible && drawer.run && drawer.rivals, label + ': boxes ' + JSON.stringify(drawer));
			check(drawer.buttons >= 7 && drawer.pad, label + ': shop ' + drawer.buttons + ' buttons');
			check(drawer.scrollWidth <= drawer.width + 1 && drawer.inside,
				label + ': drawer overflows ' + drawer.scrollWidth + ' > ' + Math.round(drawer.width));
			for (const s of sciLayout) {
				check(s.overflow <= 1 && s.hudOverflow <= 1 && s.plotW >= 100 && s.plotH >= 60,
					label + ' science/' + s.family + ': ' + JSON.stringify(s));
			}
			check(drawer.pushedDown, label + ': panels do not push each other top-to-down');
			check(afterScroll.tradeVisible, label + ': scrolling leftHud column does not reveal tradeHud');
			check(afterFold.folded && afterFold.careerH <= 64 && afterFold.tradePulledUp,
				label + ': folding careerHud failed ' + JSON.stringify(afterFold));
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

/*
 * Career drawer copy: task rows and blocks, the spec line and career events.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

/* §11 share a tech record's balance line; without a clipboard the line is
 * shown in the drawer notice so it stays selectable on file:// pages */
function careerCopySpec(data) {
	if (!data.item && Math.round(Number(data.tier)) === NO_TIER) return;
	const item = shopRecord(data);
	if (!item) return;
	const text = OrbitTech.copySpec(data.kind, item);
	const clipboard = navigator.clipboard;
	if (!clipboard) {
		careerNotice(text);
		return;
	}
	clipboard.writeText(text).then(
		() => careerNotice('copied spec · ' + item.id),
		() => careerNotice(text));
}

function taskRowHtml(career, index) {
	const task = career.tasks[index];
	const sport = index === GravityGame.COMPETE_SLOT;
	const kind = sport ? 'sport' : 'delivery';
	if (task.kind === GravityGame.TASK_NONE) {
		return '<div class="careerRow dim"><span class="careerKind">' + kind +
			'</span><span class="careerNow">no offer</span></div>';
	}
	const left = Math.max(0, Math.round((task.deadline - game.clockSteps) * DT));
	if (task.kind === GravityGame.TASK_COMPETE) {
		return '<div class="careerRow"><span class="careerKind">sport</span>' +
			'<span class="careerNow">' + planetName(task.planet) + ' · land ≥ ' +
			task.minLength + ' px</span><span class="careerBtns">+' + task.reward.toFixed(2) +
			' · ' + left + ' s</span></div>';
	}
	const good = OrbitEcon.GOODS_TABLE[task.good].id;
	const state = task.state === GravityGame.TASK_LOADED
		? 'loaded → ' + planetName(task.to)
		: task.state === GravityGame.TASK_ACCEPTED
		? 'load at ' + planetName(task.from)
		: planetName(task.from) + ' → ' + planetName(task.to);
	let html = '<div class="careerRow"><span class="careerKind">' + kind + '</span>' +
		'<span class="careerNow">' + state + ' · ' + good + ' ' + task.tons + ' t</span>' +
		'<span class="careerBtns">+' + task.reward.toFixed(2) + ' · ' + left + ' s';
	if (task.state === GravityGame.TASK_OFFERED) {
		const hold = career.ship.hold.capacity;
		const ok = GravityGame.canAccept(career, index);
		html += '<button class="miniBtn" data-act="accept" data-slot="' + index + '"' +
			(ok ? '' : ' disabled') +
			' title="' + (ok ? 'take this delivery' : hold < task.tons
				? 'needs a ' + task.tons + ' t hold (have ' + hold + ' t)'
				: 'one contract at a time') + '">accept</button>';
	} else {
		html += '<button class="miniBtn" data-act="drop" title="drop the contract and its cargo">drop</button>';
	}
	return html + '</span></div>';
}

function taskBlockHtml(career) {
	let html = '<div class="careerHead">task board</div>';
	for (let i = 0; i < career.tasks.length; i++) html += taskRowHtml(career, i);
	return html;
}

/* --- launch list: saved trajectories -------------------------------- */

/* ── launch book & money trace ── book tags, net and trace of money, ranked launch list and rail lines */
/* the field the page traces in: stored paths only hold inside this world */
function pageBookTag() {
	return GravityGame.launchBookTag(cargoSim.fieldStatic, cargoSim.gravityScale,
		cargoSim.forceScale, cargoSim.strength, cargoSim.bodyCount);
}

/* one scratch result: callers read it before the next pricing call */
const shotMoney = {
	cash: 0, fee: 0, exit: Infinity, net: -Infinity,
	builds: false, launchable: false, source: ''
};

/* A fresh trace and a stored visit log differ only in the harvest they
 * price, so both feed this table: contract and competition pay, the launch
 * fee and the cost of leaving the landing planet. */
function moneyFacts(origin, speed, body, steps, length, visitPay) {
	const career = game.career;
	let cash = visitPay;
	if (career.contract >= 0) {
		const task = career.tasks[career.contract];
		if (task.state === GravityGame.TASK_LOADED && body === task.to) cash += task.reward;
	}
	const compete = career.tasks[GravityGame.COMPETE_SLOT];
	if (compete.kind === GravityGame.TASK_COMPETE && origin === compete.planet &&
		length >= compete.minLength &&
		game.clockSteps + steps <= compete.deadline) cash += compete.reward;
	const fee = GravityGame.launchFee(career, origin, speed);
	const available = career.ledger.purse + cash - fee;
	const mass = bot.careerArrivalMass(career, body);
	const departure = bot.careerDeparture(career, body, available, mass, cargoSim);
	const padless = career.pads[body].catapult === null;
	shotMoney.cash = cash;
	shotMoney.fee = fee;
	shotMoney.exit = departure.ok ? departure.cost : Infinity;
	shotMoney.net = departure.ok ? cash - fee - departure.cost : -Infinity;
	shotMoney.builds = padless && (departure.builds || departure.canBuildStarter);
	shotMoney.launchable = career.ledger.purse + 1e-9 >= fee && departure.ok;
	shotMoney.source = departure.source;
	return shotMoney;
}

function traceMoney(probe, origin, speed) {
	return moneyFacts(origin, speed, probe.predBody, probe.predSteps, probe.predLength,
		GravityGame.estimateProfit(game.market, game.clockSteps, probe));
}

/* a saved trace priced at the live market: not one trace is spent */
function storedMoney(entry) {
	return moneyFacts(entry.origin, GravityGame.speedOf(entry.speedU), entry.body,
		entry.steps, entry.length,
		GravityGame.estimateProfitLog(game.market, game.clockSteps,
			entry.logPlanet, entry.logStep, entry.logCount));
}

/* the two live gates the launch button applies: the fee is covered and the
 * landing can be left again */
function moneyFlyable(money) {
	return money.launchable && game.career.ledger.purse + 1e-9 >= money.fee;
}

function escapeHtml(text) {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/* one finished page trace joins the career's book */
function saveTrace(probe, origin, angleU, speedU) {
	if (!careerRule() || !cargoSim.fieldStatic) return;
	if (probe.predReason !== END_IMPACT || probe.predBody < 0) return;
	const money = traceMoney(probe, origin, GravityGame.speedOf(speedU));
	GravityGame.recordLaunch(game.career.launchBook, pageBookTag(), {
		origin: origin, angleU: angleU, speedU: speedU, body: probe.predBody,
		steps: probe.predSteps, time: probe.predTime, length: probe.predLength,
		score: money.net, logPlanet: probe.predLogPlanet, logStep: probe.predLogStep,
		logCount: probe.predLogCount
	});
}

/* the armed preview is saved once per aim, so a good find is never lost */
const lastAimTrace = { origin: -1, angleU: 0, speedU: 0, body: -1 };
function recordArmedTrace() {
	const sim = activeSim();
	const origin = aimBody;
	if (origin < 0 || sim.predReason !== END_IMPACT || sim.predBody < 0) return;
	const angleU = GravityGame.angleUnits(aimAngle);
	const speedU = GravityGame.speedUnits(aimSpeed);
	if (lastAimTrace.origin === origin && lastAimTrace.angleU === angleU &&
		lastAimTrace.speedU === speedU && lastAimTrace.body === sim.predBody) return;
	lastAimTrace.origin = origin;
	lastAimTrace.angleU = angleU;
	lastAimTrace.speedU = speedU;
	lastAimTrace.body = sim.predBody;
	saveTrace(sim, origin, angleU, speedU);
}

const bookOrder = new Int32Array(GravityGame.BOOK_MAX);
const bookNet = new Float64Array(GravityGame.BOOK_MAX);
const bookFire = new Uint8Array(GravityGame.BOOK_MAX);

/* what stops a saved shot now: a moving field voids the path itself, the
 * rest is the live rail gate the bot log prints */
function launchBlock(career, entry, speed) {
	if (!cargoSim.fieldStatic) return 'moving field';
	if (playerIsBot()) return 'bot controls the ship';
	return GravityGame.railBlock(career, cargoSim, entry.origin, speed) ||
		(turret.pending ? 'a shot is already queued'
			: careerWaitBusy() ? 'the clock is settling a wait' : '');
}

/* the whole book, fireable rows first, best live money first (insertion
 * sort over at most BOOK_MAX rows: a drawer refresh, not a frame) */
function rankLaunchList(career) {
	const book = career.launchBook;
	let count = 0;
	for (let i = 0; i < book.entries.length && count < bookOrder.length; i++) {
		const entry = book.entries[i];
		const net = storedMoney(entry).net;
		const fire = launchBlock(career, entry, GravityGame.speedOf(entry.speedU)) === '' ? 1 : 0;
		let j = count - 1;
		while (j >= 0 && (bookFire[j] < fire || (bookFire[j] === fire && bookNet[j] < net))) {
			bookOrder[j + 1] = bookOrder[j];
			bookNet[j + 1] = bookNet[j];
			bookFire[j + 1] = bookFire[j];
			j -= 1;
		}
		bookOrder[j + 1] = i;
		bookNet[j + 1] = net;
		bookFire[j + 1] = fire;
		count += 1;
	}
	return count;
}

function launchRowHtml(career, index, net) {
	const entry = career.launchBook.entries[index];
	const speed = GravityGame.speedOf(entry.speedU);
	const kind = entry.body === entry.origin ? 'loop'
		: career.pads[entry.body].catapult === null ? 'EMC' : 'pad';
	const load = entry.body === entry.origin ? 'returns to ' + planetName(entry.origin)
		: career.pads[entry.body].catapult === null
			? 'lands where no own EMC stands · another owner\'s rail or a build'
			: 'lands on your own EMC';
	const block = launchBlock(career, entry, speed);
	const title = (block === '' ? 'arm this saved shot'
			: 'cannot fire · ' + block + ' · use stays off until it clears') +
		' · P' + entry.origin + ' → ' + planetName(entry.body) +
		' · ' + Math.round(entry.length) + ' px · ' + entry.logCount + ' systems · ' + load;
	return '<div class="careerRow' + (block === '' ? '' : ' dim') + '">' +
		'<span class="careerKind">' + kind + '</span>' +
		'<span class="careerNow">' + planetName(entry.body) + ' · ' +
		entry.time.toFixed(1) + ' s · ' + signedMoney(net) + '</span>' +
		'<span class="careerBtns"><button class="miniBtn" data-act="book" data-entry="' +
		index + '"' + (block === '' ? '' : ' disabled') + ' title="' +
		escapeHtml(title) + '">use</button></span>' +
		(block === '' ? '' : '<span class="careerWhy">' + escapeHtml(block) + '</span>') +
		'</div>';
}

/* the shared rail line is longer than the drawer: break it before the fee */
function railLinesHtml(rail) {
	const cut = rail.indexOf(' · fee ');
	if (cut < 0) return '<div class="careerLine dim">' + escapeHtml(rail) + '</div>';
	return '<div class="careerLine dim" title="' + escapeHtml(rail) + '">' +
		escapeHtml(rail.slice(0, cut)) + '</div>' +
		'<div class="careerLine dim">' + escapeHtml(rail.slice(cut + 3)) + '</div>';
}

/* the shots tab: the live rail line, then every saved shot with its gate */
function launchListHtml(career) {
	const head = '<div class="careerHead">launch list</div>';
	const book = career.launchBook;
	const html = head + railLinesHtml(GravityGame.railText(career, cargoSim, career.at));
	if (book.entries.length === 0) {
		return html + '<div class="careerLine dim">empty · aim or scan to save a shot</div>';
	}
	if (!cargoSim.fieldStatic) {
		return html + '<div class="careerLine warn">paused · gravity bodies move · ' +
			'paths only hold in a static field</div>' + launchRowsHtml(career);
	}
	if (!GravityGame.bookReady(book, pageBookTag())) {
		return html + '<div class="careerLine warn">stale · ' + book.entries.length +
			' saved in another field · these paths no longer hold</div>' +
			'<div class="careerLine dim"><button class="miniBtn" data-act="bookDrop">clear</button>' +
			' · a gravity edit makes every saved aim stale</div>';
	}
	return html + launchRowsHtml(career);
}

function launchRowsHtml(career) {
	const count = rankLaunchList(career);
	let fire = 0;
	for (let i = 0; i < count; i++) fire += bookFire[i];
	let html = '<div class="careerLine dim">' + count + ' saved · ' +
		fire + ' fireable here · best money first</div>';
	for (let i = 0; i < count; i++) html += launchRowHtml(career, bookOrder[i], bookNet[i]);
	return html;
}

/* the list re-renders when the book, the ship, the field, the rail or the
 * purse changed, and every so often so the money follows the market */
let launchListKey = '';
function refreshLaunchList(force) {
	if (!careerLaunchListEl) return;
	if (!careerRule()) {
		if (launchListKey !== '') {
			careerLaunchListEl.innerHTML = '';
			launchListKey = '';
		}
		return;
	}
	const career = game.career;
	const pad = career.at >= 0 ? GravityGame.padAt(career, career.at) : null;
	const key = career.launchBook.version + '|' + pageBookTag() + '|' + career.at + '|' +
		(cargoSim.fieldStatic ? 1 : 0) + '|' + cargoSim.status + '|' +
		(turret.pending ? 1 : 0) + '|' + (careerWaitBusy() ? 1 : 0) + '|' +
		(pad ? Math.round(pad.chargeKwh * 100) : -1) + '|' +
		Math.round(career.ledger.purse * 100) + '|' + Math.round(game.clockSteps / 240);
	if (!force && key === launchListKey) return;
	launchListKey = key;
	careerLaunchListEl.innerHTML = launchListHtml(career);
}

/* a stale book cannot be flown: drop it by hand instead of losing it
 * silently on the next save */
function dropStaleBook() {
	const book = game.career.launchBook;
	if (book.entries.length === 0) return;
	const count = book.entries.length;
	GravityGame.resetLaunchBook(book);
	careerNotice('cleared ' + count + ' stale saved shots');
	refreshLaunchList(true);
}

/* arm a saved shot: the list's one click, then the launch button fires it.
 * The tag and the rail gate are refused with the words the row shows. */
function useBookEntry(index) {
	if (!careerRule() || careerWaitBusy() || turret.pending) return;
	const career = game.career;
	const entry = career.launchBook.entries[index];
	if (!entry) return;
	if (!GravityGame.bookReady(career.launchBook, pageBookTag())) {
		careerNotice('saved shot is stale · the gravity field changed · clear the list or scan again');
		return;
	}
	const speed = GravityGame.speedOf(entry.speedU);
	const block = launchBlock(career, entry, speed);
	if (block !== '') {
		careerNotice('saved shot is not firable · ' + block);
		return;
	}
	aimBody = entry.origin;
	aimAngle = GravityGame.angleOf(entry.angleU);
	aimSpeed = speed;
	aiming = false;
	armed = true;
	pressing = false;
	savedArmed = false;
	blockedPlanet = -1;
	placeGripFromSpeed();
	dirty = true;
	launchState = -1;
	hudAt = -Infinity;
	careerNotice('armed from list · ' + planetName(entry.origin) + ' → ' + planetName(entry.body));
	refreshGameUi();
}

function fillCareerPlanets(career) {
	if (!careerPlanetEl) return;
	const picked = careerPickPlanet();
	let html = '';
	for (let i = 0; i < PLANETS; i++) {
		if (!planetMask[i]) continue;
		const pad = career.pads[i];
		/* the cap comes before the gear id so a narrow picker clips the tier,
		 * not the answer to "can the ship leave this planet?" */
		const cap = GravityGame.padLift(career, i);
		const note = cap + 1e-9 < GravitySim.SPEED_MIN ? 'cannot lift'
			: Math.round(cap) + ' px/s';
		const gear = pad.catapult
			? pad.catapult.id + ' · ' + claimTag(GravityGame.claimOwner(game.galaxy, i))
			: 'commercial';
		html += '<option value="' + i + '">' + planetName(i) + (i === career.hq ? ' ★' : '') +
			' · ' + note + ' · ' + gear + '</option>';
	}
	careerPlanetEl.innerHTML = html;
	careerPlanetEl.value = String(picked);
}

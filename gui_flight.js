/*
 * Flight HUD: the ship facts (speed, flight time, fuel, engine), the refuel
 * transaction, the open-work rows and their guide arrow, and the panel state
 * tag. The action row belongs to gui_hud_text (setLaunchState) and the scans to
 * gui_helper; this file owns the panel around them.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

const flightHudEl = $('flightHud');
const flightStateEl = $('flightState');
const flightShipTagEl = $('flightShipTag');
const flightSpeedEl = $('flightSpeed');
const flightTimeEl = $('flightTime');
const flightFuelRowEl = $('flightFuelRow');
const flightFuelEl = $('flightFuel');
const flightFuelBarEl = $('flightFuelBar');
const flightFuelFillEl = $('flightFuelFill');
const flightEngineEl = $('flightEngine');
const flightReportRowEl = $('flightReportRow');
const flightReportEl = $('flightReport');
const flightRefuelRowEl = $('flightRefuelRow');
const flightRefuelBtn = $('flightRefuel');
const flightQuestGroupEl = $('flightQuestGroup');
const flightQuestTagEl = $('flightQuestTag');
const flightQuestsEl = $('flightQuests');
const flightActionTagEl = $('flightActionTag');
const flightQuestRows = [$('flightQuest0'), $('flightQuest1')];

/* the panel paints from these scratch values, and only writes a node when the
 * text really changed — the frame loop calls this twice a second */
const flightHud = {
	state: '', shipTag: '', speed: '', time: '', fuel: '', engine: '', report: '',
	fuelPct: -1, refuel: '', refuelText: '', refuelWhy: '', questTag: '', questKey: '',
	actionTag: '', refuelKg: 0
};
/* the work planet under the pointer: the canvas draws the guide to it */
let questHoverBody = -1;

/* a planet name plus what the leg wants there, printed on one row */
const QUEST_TAGS = ['plan', 'load', 'deliver', 'medics out', 'patients home', 'sport'];

/* the row's leg: the same two questions careerGoalBodies answers, asked once
 * per row so the label can say what happens there */
function flightQuestLegs(career, out) {
	out[0] = -1;
	out[1] = -1;
	if (career.contract >= 0) {
		const task = career.tasks[career.contract];
		if (task.kind === GravityGame.TASK_MEDIC) {
			out[0] = task.aboard > 0 ? career.capitalPlanet : task.to;
			out[1] = task.aboard > 0 ? GravityGame.LEG_PATIENTS : GravityGame.LEG_MEDICS;
		} else {
			out[0] = task.state === GravityGame.TASK_LOADED ? task.to : task.from;
			out[1] = task.state === GravityGame.TASK_LOADED ? GravityGame.LEG_DELIVER : GravityGame.LEG_LOAD;
		}
	}
	const compete = career.tasks[GravityGame.COMPETE_SLOT];
	if (compete.kind === GravityGame.TASK_COMPETE) {
		out[2] = compete.planet;
		out[3] = GravityGame.LEG_COMPETE;
	} else {
		out[2] = -1;
		out[3] = GravityGame.LEG_NONE;
	}
	return out;
}

const questScratch = new Int32Array(4);

/* rows are a flat table: rebuild only when the work itself changed */
function flightQuestKey(career) {
	flightQuestLegs(career, questScratch);
	const left = career.contract >= 0
		? Math.max(0, Math.round((career.tasks[career.contract].deadline - game.clockSteps) * DT / 15))
		: -1;
	return questScratch[0] + ':' + questScratch[1] + ':' + questScratch[2] + ':' +
		questScratch[3] + ':' + left + ':' + (career.ended === GravityGame.CAREER_OPEN ? 0 : 1);
}

function flightQuestHtml(slot, body, leg, left) {
	const on = body === questHoverBody;
	const when = left >= 0 ? ' · ' + left + ' s' : '';
	return '<div id="flightQuest' + slot + '" class="careerRow questRow' + (on ? ' on' : '') +
		'" data-quest="' + body + '" title="point here to draw the guide arrow to ' +
		planetName(body) + '"><span class="careerKind">' + QUEST_TAGS[leg] + '</span>' +
		'<span class="careerNow">' + planetName(body) + when + '</span></div>';
}

/* the two work rows: the open contract's next stop and the competition planet */
function rebuildFlightQuests(career) {
	let html = '';
	let rows = 0;
	let tag = 'nothing open';
	flightQuestLegs(career, questScratch);
	const contractLeft = career.contract >= 0
		? Math.max(0, Math.round((career.tasks[career.contract].deadline - game.clockSteps) * DT))
		: -1;
	const competeLeft = career.tasks[GravityGame.COMPETE_SLOT].kind === GravityGame.TASK_COMPETE
		? Math.max(0, Math.round((career.tasks[GravityGame.COMPETE_SLOT].deadline - game.clockSteps) * DT))
		: -1;
	if (questScratch[0] >= 0) {
		html += flightQuestHtml(0, questScratch[0], questScratch[1], contractLeft);
		rows += 1;
		tag = QUEST_TAGS[questScratch[1]];
	}
	if (questScratch[2] >= 0) {
		html += flightQuestHtml(1, questScratch[2], questScratch[3], competeLeft);
		rows += 1;
		tag = rows === 2 ? 'contract + sport' : 'sport';
	}
	if (rows === 0) html = '<div class="careerRow dim"><span class="careerNow">no contract open · ' +
		'accept one in the career drawer</span></div>';
	const contract = career.contract >= 0 ? career.tasks[career.contract] : null;
	if (contract && contract.fragile) tag = 'fragile · ' + fragileLimitText();
	if (flightQuestsEl) flightQuestsEl.innerHTML = html;
	flightQuestRows[0] = $('flightQuest0');
	flightQuestRows[1] = $('flightQuest1');
	/* a rebuilt list cannot keep the pointer's old row */
	if (questHoverBody >= 0) flightHoverClear();
	flightHud.questTag = tag;
	if (flightQuestTagEl) flightQuestTagEl.textContent = tag;
}

function flightHoverClear() {
	if (questHoverBody < 0) return;
	questHoverBody = -1;
	for (let i = 0; i < flightQuestRows.length; i++) {
		const node = flightQuestRows[i];
		if (node && node.classList) node.classList.remove('on');
	}
}

function flightHoverBodyFor(target) {
	let node = target;
	while (node) {
		if (node.dataset && node.dataset.quest) return Number(node.dataset.quest);
		if (node === flightHudEl) return -1;
		node = node.parentElement;
	}
	return -1;
}

function flightQuestsOver(event) {
	const body = flightHoverBodyFor(event && event.target);
	if (body >= 0) {
		questHoverBody = body;
		for (let i = 0; i < flightQuestRows.length; i++) {
			const node = flightQuestRows[i];
			if (node && node.classList) node.classList.toggle('on',
				Number(node.dataset.quest) === body);
		}
		return;
	}
	flightHoverClear();
}

/* refuel: the owner's unreserved charge converts first, the purse buys the
 * rest of one step, so the row prices the whole top-up, not a second rule */
function flightRefuelPlan(career) {
	const ship = career.ship;
	flightHud.refuelKg = 0;
	flightHud.refuelWhy = '';
	if (!ship.engine || !ship.tank || ship.tank.fuelCap <= 0) {
		flightHud.refuelWhy = 'needs an engine and a fuel tank';
		return 0;
	}
	const room = Math.floor(ship.tank.fuelCap - ship.fuelKg);
	if (room <= 0) {
		flightHud.refuelWhy = 'the tank is full';
		return 0;
	}
	const pad = career.at >= 0 ? career.pads[career.at] : null;
	const free = pad && pad.catapult !== null
		? Math.floor(Math.max(0, pad.chargeKwh - pad.reservedKwh) * GravityGame.FUEL_KG_PER_KWH + 1e-9)
		: 0;
	const price = GravityGame.fuelPrice(career);
	const buyable = price > 0 ? Math.floor(Math.max(0, career.ledger.purse) / price + 1e-9) : room;
	const kg = Math.min(GravityGame.FUEL_BUY_STEP, room, free + buyable);
	if (kg <= 0) {
		flightHud.refuelWhy = 'needs own charge or purse';
		return 0;
	}
	flightHud.refuelKg = kg;
	const converted = Math.min(kg, free);
	const bought = kg - converted;
	flightHud.refuel = bought > 0
		? 'refuel +' + kg + ' · ' + costText(bought * price)
		: 'refuel +' + kg + ' · free';
	flightHud.refuelWhy = '+' + kg + ' kg fuel · ' + converted + ' kg own charge' +
		(bought > 0 ? ' + ' + bought + ' kg bought for ' + costText(bought * price) : '') +
		(pad && pad.catapult !== null ? '' : ' · no own pad here, the purse buys it all');
	return kg;
}

function flightRefuel() {
	if (!careerRule() || replay.on || gameLocked()) return false;
	const career = activeCareer();
	if (career.ended !== GravityGame.CAREER_OPEN) return false;
	const kg = flightRefuelPlan(career);
	if (kg <= 0) return false;
	const before = career.ship.fuelKg;
	const converted = GravityGame.produceFuel(career, career.at, kg);
	const rest = kg - converted;
	const bought = rest > 0 ? GravityGame.buyFuel(career, rest) : 0;
	const gained = career.ship.fuelKg - before;
	if (gained <= 0) {
		careerNotice('refuel needs charge or purse');
		return false;
	}
	careerNotice('refuelled +' + gained.toFixed(1) + ' kg · ' + career.ship.fuelKg.toFixed(1) + ' / ' +
		career.ship.tank.fuelCap + ' kg' +
		(converted > 0 ? ' · ' + converted + ' kg own charge' : '') +
		(bought > 0 ? ' · ' + costText(gained - converted) : ''));
	launchState = -1;
	dirty = true;
	refreshGameUi();
	return true;
}

/* the context action: a career flight with a drive pauses, resumes or burns;
 * everything else is the launch row gui_hud_text paints */
function flightActionState() {
	if (canImpulse()) {
		flightHud.action = 'space';
		return 'space';
	}
	if (careerRule() && !replay.on) {
		flightHud.action = 'enter';
		return 'enter';
	}
	flightHud.action = game.on ? 'enter' : '';
	return flightHud.action;
}

function flightStateText() {
	/* every line here describes the selected player's ship, never YOU's */
	const sim = activeSim();
	const career = careerRule() ? activeCareer() : null;
	if (replay.on) return 'replay';
	if (career && career.ended !== GravityGame.CAREER_OPEN) return 'career over';
	if (burnArmed) return 'burn armed';
	if (burnAiming) return 'aiming impulse';
	if (career && careerPaused && sim.status === STATUS_FLYING) return 'flight paused';
	if (sim.status === STATUS_FLYING) return 'coasting';
	if (game.on && playerIsBot()) return 'bot flying';
	if (career) {
		if (career.at >= 0 && sim.status !== STATUS_FLYING) return 'landed ' + planetName(career.at);
		if (career.stranded) return 'stranded';
	}
	const landed = sim.landedBody;
	if (landed >= 0) return 'landed ' + planetName(landed);
	if (helperState.active) return 'scanning ' + (helperState.index + 1) + '/' +
		helperState.candidates.length;
	return game.on ? 'ready' : 'lab';
}

/* the panel repaints on the HUD tick; every node is written only on change */
function updateFlightHud() {
	const sim = activeSim();
	const flying = sim.status === STATUS_FLYING;
	const state = flightStateText();
	if (state !== flightHud.state) {
		flightHud.state = state;
		if (flightStateEl) flightStateEl.textContent = state;
	}
	const career = careerRule() ? activeCareer() : null;
	const ship = career ? career.ship : null;
	const speed = flying ? Math.sqrt(sim.cargo.vx * sim.cargo.vx +
		sim.cargo.vy * sim.cargo.vy)
		: burnArmed ? burnDv : armed ? aimSpeed : 0;
	const speedText = flying || burnArmed || armed ? speed.toFixed(1) + ' px/s' : '—';
	if (speedText !== flightHud.speed) {
		flightHud.speed = speedText;
		if (flightSpeedEl) flightSpeedEl.textContent = speedText;
	}
	const timeText = flying ? sim.flightTime.toFixed(2) + ' s · ' +
		Math.round(sim.flightLength) + ' px'
		: sim.landedBody >= 0 ? '0.00 s · landed' : '—';
	if (timeText !== flightHud.time) {
		flightHud.time = timeText;
		if (flightTimeEl) flightTimeEl.textContent = timeText;
	}
	const engineText = ship
		? ship.engine
			? ship.engine.id + ' · Δv ' + OrbitTech.shipDeltaV(ship, ship.cargoTons).toFixed(1)
			: 'none · fit in the shop'
		: '';
	if (engineText !== flightHud.engine) {
		flightHud.engine = engineText;
		if (flightEngineEl) flightEngineEl.textContent = engineText;
	}
	/* why a visit pays or not: the observation device (0.6.1) */
	const reportText = !ship ? '' : ship.obs.fitted ? ship.obs.id : 'none · visits pay 0';
	if (reportText !== flightHud.report) {
		flightHud.report = reportText;
		if (flightReportRowEl) flightReportRowEl.hidden = reportText === '';
		if (flightReportEl) flightReportEl.textContent = reportText;
	}
	if (flightShipTagEl) {
		const tag = ship ? ship.mass.toFixed(1) + ' t' : flying ? 'coasting' : 'one ship';
		if (tag !== flightHud.shipTag) {
			flightHud.shipTag = tag;
			flightShipTagEl.textContent = tag;
		}
	}
	updateFlightFuel(career, ship);
	updateFlightQuests(career);
	const action = flightActionState();
	if (action !== flightHud.actionTag) {
		flightHud.actionTag = action;
		if (flightActionTagEl) flightActionTagEl.textContent = action;
	}
}

function updateFlightFuel(career, ship) {
	const has = Boolean(ship && ship.tank && ship.tank.fuelCap > 0 && ship.engine);
	if (flightFuelRowEl) flightFuelRowEl.hidden = !has;
	if (flightFuelBarEl) flightFuelBarEl.hidden = !has;
	if (flightRefuelRowEl) flightRefuelRowEl.hidden = !has;
	if (!has) return;
	const cap = ship.tank.fuelCap;
	const fuelText = fuelGaugeText(ship);
	if (fuelText !== flightHud.fuel) {
		flightHud.fuel = fuelText;
		if (flightFuelEl) flightFuelEl.textContent = fuelText;
	}
	const pct = Math.round(ship.fuelKg / cap * 100);
	if (pct !== flightHud.fuelPct) {
		flightHud.fuelPct = pct;
		if (flightFuelFillEl) flightFuelFillEl.style.width = pct + '%';
	}
	/* refuelling is a landing transaction: in space there is nothing to buy from */
	const landed = career.ended === GravityGame.CAREER_OPEN && !gameLocked() &&
		activeSim().status !== STATUS_FLYING;
	const kg = landed ? flightRefuelPlan(career) : 0;
	const label = kg > 0 ? flightHud.refuel : 'refuel';
	const why = !landed ? 'land to refuel' : flightHud.refuelWhy || 'the tank is full';
	if (flightRefuelBtn) {
		if (label !== flightHud.refuelText) {
			flightHud.refuelText = label;
			flightRefuelBtn.textContent = label;
		}
		const off = kg <= 0;
		if (flightRefuelBtn.disabled !== off) flightRefuelBtn.disabled = off;
		if (flightRefuelBtn.title !== why) flightRefuelBtn.title = why;
	}
}

/* the work rows rebuild only when the contract or competition itself moved */
function updateFlightQuests(career) {
	if (flightQuestGroupEl) flightQuestGroupEl.hidden = !career;
	if (!career) return;
	const key = flightQuestKey(career);
	if (key === flightHud.questKey) return;
	flightHud.questKey = key;
	rebuildFlightQuests(career);
}

/* the guide arrow: the ship (flying) or its pad (landed) to the pointed row */
function drawQuestGuide(now) {
	if (questHoverBody < 0 || !careerRule()) return;
	const sim = activeSim();
	const from = sim.status === STATUS_FLYING ? -2 : activeCareer().at;
	if (from === -1) return;
	const px = 1 / view.scale;
	ctx.beginPath();
	ctx.arc(tradeSim.planetX[questHoverBody], tradeSim.planetY[questHoverBody],
		tradeSim.planetR[questHoverBody] + 9 * px, 0, TAU);
	ctx.strokeStyle = MINT;
	ctx.globalAlpha = 0.55 + 0.35 * Math.sin(now * 0.006);
	ctx.lineWidth = 1.3 * px;
	ctx.setLineDash(NO_DASH);
	ctx.stroke();
	ctx.globalAlpha = 1;
	if (from === -2) {
		drawGuideArrow(sim.cargo.x, sim.cargo.y, 6 * px,
			tradeSim.planetX[questHoverBody], tradeSim.planetY[questHoverBody],
			tradeSim.planetR[questHoverBody] + 10 * px, now,
			'rgba(142, 240, 192, 0.72)', MINT);
		return;
	}
	if (from === questHoverBody) return;
	drawGuideArrow(tradeSim.planetX[from], tradeSim.planetY[from],
		tradeSim.planetR[from] + 7 * px,
		tradeSim.planetX[questHoverBody], tradeSim.planetY[questHoverBody],
		tradeSim.planetR[questHoverBody] + 10 * px, now,
		'rgba(142, 240, 192, 0.72)', MINT);
}

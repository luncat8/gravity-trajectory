/*
 * Career shop numbers: cost, cap, pad, gear and part text, purse checks, the tier ladder and the shop buttons.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

function careerRuleText() {
	const career = game.career;
	const pads = career.padCount + ' / ' + planetCount + ' pads';
	if (career.ended === GravityGame.CAREER_BROKE) return 'career · broke · ' + pads;
	if (career.ended === GravityGame.CAREER_COMPLETE) return 'career · complete';
	return 'career · ' + pads + (career.cheat ? ' · ' + career.cheat : '');
}

/* the scoreboard tag drops the pad count — that lives on the pads/planets
 * row so the rule name stays on one line */
function careerScoreTag() {
	const career = game.career;
	if (career.ended === GravityGame.CAREER_BROKE) return 'career · broke';
	if (career.ended === GravityGame.CAREER_COMPLETE) return 'career · complete';
	return 'career' + (career.cheat ? ' · ' + career.cheat : '');
}

/* --- career drawer: pad readout, shop, task board ------------------- */

/* the planet selector follows the ship until the player picks one */
let careerFollow = true;

/* the running fast-forward: its clock starts at the click and clears on finish */
let careerWaitAnim = null;

function careerCost(career, value) {
	return career.cheat === GravityGame.CHEAT_COMMUNISM ? 0 : value;
}

function costText(value) {
	return value === 0 ? 'free' : value.toFixed(2);
}

/* full-battery cap of one pad for a given ship mass, so the shop can answer
 * "can this pad lift this cargo?" and "what does this part cost in rail
 * speed?" from the same rail model; 0 = no pad */
function padCapMass(catapult, battery, mass) {
	if (catapult === null || battery === null) return 0;
	const cap = OrbitTech.speedLimit(battery.capacity, mass, catapult, cargoSim.forceScale);
	return cap > SPEED_MAX ? SPEED_MAX : cap;
}

function padCap(career, catapult, battery) {
	return padCapMass(catapult, battery, career.ship.mass);
}

function panelWaitKwh(career, planet, panel) {
	return panel ? OrbitTech.solarCharge(panel, career.light[planet], CAREER_WAIT_MIN * 60) : 0;
}

/* kWh one wait adds to that pad's battery (solar over the wait, before the leak) */
function waitGain(career, planet, panel) {
	const item = panel === undefined ? career.pads[planet].panel : panel;
	return panelWaitKwh(career, planet, item).toFixed(2);
}

/* game-clock seconds of sunlight for `panel` on `planet` to cover one full-cap shot */
function panelReadySec(career, planet, pad, panel) {
	const gain = panelWaitKwh(career, planet, panel);
	const rate = scene.trade.speed;
	if (gain <= 0 || rate <= 0) return 0;
	const cat = pad.catapult || OrbitTech.CATAPULTS[0];
	const bat = pad.battery || OrbitTech.BATTERIES[0];
	const cap = padCap(career, cat, bat);
	const shotKwh = cap > 0 ? OrbitTech.launchEnergy(career.ship.mass, cat, cap) : bat.capacity;
	return Math.max(1, Math.round(shotKwh / gain * (CAREER_WAIT_MIN / rate)));
}

/* `91 → 132 px/s`: the cap a row's next tier would buy */
function capArrowText(now, after) {
	if (after <= 0) return '';
	const to = Math.round(after);
	if (now <= 0) return to + ' px/s';
	const from = Math.round(now);
	return from === to ? to + ' px/s' : from + ' → ' + to + ' px/s';
}

/* rails/batteries move the cap; panels move solar kWh/wait and full-shot ready time */
function gearCapText(career, planet, pad, kind, next) {
	if (kind === OrbitTech.KIND_PANEL) {
		const item = next || pad.panel;
		if (!item) return '';
		return '+' + waitGain(career, planet, item) + ' kWh · ready in ' +
			panelReadySec(career, planet, pad, item) + ' s';
	}
	const now = padCap(career, pad.catapult, pad.battery);
	if (next === null) return now > 0 ? Math.round(now) + ' px/s' : '';
	/* a first catapult arrives with the starter panel and battery */
	const after = kind === OrbitTech.KIND_CATAPULT
		? padCap(career, next, pad.catapult === null ? OrbitTech.BATTERIES[0] : pad.battery)
		: padCap(career, pad.catapult, next);
	return capArrowText(now, after);
}

function capHtml(text) {
	return text === '' ? '' : '<span class="careerCap">' + text + '</span>';
}

/* the next record above the installed one that is buildable right now
 * (a pad starts from nothing). Unknown stock tiers (e.g. EMC-3/4/5 before
 * science) are skipped — they have to be researched first. */
function nextTier(career, table, current) {
	const tier = current ? current.tier : 0;
	for (let i = 0; i < table.length; i++) {
		if (table[i].tier <= tier) continue;
		if (GravityGame.gearKnown(career, table[i])) return table[i];
	}
	return null;
}

/* shop buttons carry the table index, not the tier: tables differ per kind */
function tierIndex(table, item) {
	for (let i = 0; i < table.length; i++) {
		if (table[i] === item) return i;
	}
	return -1;
}

function careerPickPlanet() {
	const career = game.career;
	if (careerFollow) return career.at >= 0 ? career.at : career.hq;
	const raw = careerPlanetEl ? careerPlanetEl.value : '';
	const picked = raw === '' ? -1 : Math.round(Number(raw));
	if (picked >= 0 && picked < PLANETS) return picked;
	return career.at >= 0 ? career.at : career.hq;
}

function careerNotice(text) {
	if (!careerMsgEl) return;
	careerMsgEl.textContent = text;
	careerMsgEl.hidden = text === '';
}

function shopButton(label, act, kind, tier, disabled, title, costly) {
	return shopButtonRef(label, act, kind, 'data-tier="' + tier + '"', disabled, title, costly);
}

/* `ref` names the record: a table tier, or the id of a research prototype;
 * `costly` marks the purse itself as the blocker, so the price stays red
 * instead of fading like a state gate (HQ only, cargo, no catapult) */
function shopButtonRef(label, act, kind, ref, disabled, title, costly) {
	return '<button class="miniBtn' + (disabled && costly ? ' costly' : '') +
		'" data-act="' + act + '" data-kind="' + kind + '" ' + ref +
		(disabled ? ' disabled' : '') + ' title="' + title + '">' + label + '</button>';
}

/* a price the purse cannot cover (free under the communism cheat) */
function purseTooSmall(career, price) {
	return career.ledger.purse + 1e-9 < price;
}

function recordRef(table, item) {
	const index = tierIndex(table, item);
	return index >= 0 ? 'data-tier="' + index + '"' : 'data-item="' + item.id + '"';
}

/* a button's record: its table tier, or its prototype id (null when unknown) */
function shopRecord(data) {
	if (data.item) return GravityGame.prototypeById(game.career, data.kind, data.item);
	const table = TECH_TABLES[data.kind];
	if (!table) return null;
	return table[Math.round(Number(data.tier))] || null;
}

/* §11 balance tooling: the spec a row shares is the tier on offer, else
 * the one fitted; copy stays enabled with an empty purse or a closed career */
function copyButtonHtml(row, item) {
	if (!item) return '';
	return shopButtonRef('copy', 'copy', row.kind, recordRef(row.table, item), false,
		'copy the balance spec of ' + item.id);
}

function careerTagText() {
	const career = game.career;
	const at = career.at;
	const where = at < 0 ? 'lost in space'
		: at === career.hq ? 'HQ ' + planetName(at)
		: 'at ' + planetName(at) + ' · HQ ' + planetName(career.hq);
	const state = career.ended === GravityGame.CAREER_BROKE ? ' · broke'
		: career.ended === GravityGame.CAREER_COMPLETE ? ' · complete' : '';
	return where + state;
}

function shipImpulseNote(ship) {
	if (!ship.engine || ship.tank.fuelCap <= 0) return '';
	const remDv = OrbitTech.impulseDeltaV(ship.fuelKg, ship.engine, ship.mass, ship.fuelKg);
	const burnCap = OrbitTech.burnLimit(ship.fuelKg, ship.engine, ship.mass);
	if (ship.fuelKg < ship.tank.fuelCap - 0.05) {
		return ' · fuel ' + ship.fuelKg.toFixed(1) + '/' + ship.tank.fuelCap + ' kg' +
			(remDv > 0.05 ? ' · Δv ' + remDv.toFixed(1) + ' px/s' : ' · empty');
	}
	if (remDv <= 0) return '';
	return ' · Δv ' + remDv.toFixed(1) + ' px/s' +
		(burnCap < remDv - 0.05 ? ' (burn ' + burnCap.toFixed(1) + ')' : '');
}

/* ── pads, claims & parts ── EMC claim rings, pad blocks, gear/part/prototype rows and the shop block */
/* who owns which planet's EMC claim, counted per player */
function claimCounts() {
	const counts = [0, 0, 0];
	for (let i = 0; i < PLANETS; i++) {
		const owner = GravityGame.claimOwner(game.galaxy, i);
		if (owner >= 0 && owner < counts.length) counts[owner] += 1;
	}
	return counts;
}

function claimTag(owner) {
	if (owner < 0) return 'commercial';
	return owner === 0 ? 'YOU' : RIVAL_TAGS[owner - 1];
}

function claimLineHtml() {
	const counts = claimCounts();
	let text = 'EMC claims · YOU ' + counts[0];
	for (let i = 1; i <= bot.count && i < counts.length; i++) {
		text += ' · ' + RIVAL_TAGS[i - 1] + ' ' + counts[i];
	}
	return '<div class="careerLine dim">' + text + '</div>';
}

function padBlockHtml(career) {
	const at = career.at;
	if (at < 0) return '<div class="careerLine warn">lost in space · evacuate to HQ</div>';
	const pad = career.pads[at];
	const ship = career.ship;
	const cargo = ship.cargoTons > 0 ? ' · cargo ' + ship.cargoTons + ' t' : '';
	const claim = GravityGame.claimOwner(game.galaxy, at);
	let html = '<div class="careerLine"><b>' + planetName(at) + (at === career.hq ? ' · HQ' : '') +
		'</b> · ' + ship.mass.toFixed(1) + ' t' + cargo + ' · ' + claimTag(claim) + ' EMC</div>';
	html += '<div class="careerLine dim">ship ' + ship.hold.id + ' · ' +
		(ship.engine ? ship.engine.id : 'no engine') + ' · ' + ship.tank.id +
		shipImpulseNote(ship) + '</div>';
	if (career.commercialPlanet === at) {
		const lift = GravityGame.padLift(career, at);
		html += '<div class="careerLine">commercial EMC-1 selected · fee ' +
			costText(careerCost(career, GravityGame.CAREER.commercialFee)) +
			' · lifts to ' + Math.round(lift) + ' px/s</div>';
	}
	if (pad.catapult === null) {
		const first = OrbitTech.CATAPULTS[0];
		const cost = careerCost(career, first.buildCost);
		const poor = purseTooSmall(career, cost);
		const occupied = !GravityGame.planetBuildable(career, at);
		const fresh = padCap(career, first, OrbitTech.BATTERIES[0]);
		const fee = careerCost(career, GravityGame.CAREER.commercialFee);
		const lift = GravityGame.padLift(career, at);
		const heavy = lift + 1e-9 < GravitySim.SPEED_MIN;
		const claimOwnerIdx = GravityGame.claimOwner(game.galaxy, at);
		html += '<div class="careerLine warn">no EMC here · ' +
			(occupied ? claimTag(claimOwnerIdx) + ' rail' : 'commercial rail') +
			' · fee ' + costText(fee) + '</div>' +
			'<div class="careerLine dim">lifts ' + ship.mass.toFixed(1) + ' t to ' +
			Math.round(lift) + ' px/s' + (heavy
				? ' · too heavy · evacuate ' + costText(careerCost(career, GravityGame.CAREER.evacFee))
				: ' · charged for you') + '</div>';
		if (occupied) {
			html += '<div class="careerLine dim">' + claimTag(claimOwnerIdx) +
				' already owns this planet · use their rail or the commercial one</div>';
		} else {
			html += '<div class="careerRow"><span class="careerBtns">' +
				shopButton('build ' + first.id + ' here · ' + costText(cost), 'build', 'catapult', 0,
					poor,
					'build your own EMC-1 on ' + planetName(at) + ' · full battery lifts ' +
						ship.mass.toFixed(1) + ' t to ' + Math.round(fresh) + ' px/s · claims the planet', poor) +
				capHtml(capArrowText(0, fresh)) + '</span></div>';
		}
		html += claimLineHtml();
		return html;
	}
	const limit = cargoSim.speedLimit(at);
	const full = padCap(career, pad.catapult, pad.battery);
	const shot = OrbitTech.launchEnergy(ship.mass, pad.catapult, limit);
	const frac = pad.battery.capacity > 0 ? pad.chargeKwh / pad.battery.capacity : 0;
	html += '<div class="careerLine">' + pad.catapult.id + ' · ' + pad.panel.id + ' · ' +
		pad.battery.id + ' · <span id="careerPadCharge">' + pad.chargeKwh.toFixed(2) + ' / ' +
		pad.battery.capacity.toFixed(2) + ' kWh</span></div>';
	html += '<div class="careerBar"><i id="careerPadBar" style="width:' + Math.round(frac * 100) + '%"></i></div>';
	/* a pad on a full battery is rail-limited: say "full" only when the charge bites */
	const fullNote = Math.round(full) === Math.round(limit) ? ''
		: ' · full ' + Math.round(full) + ' px/s';
	html += '<div class="careerLine dim">max ' + Math.round(limit) + ' px/s' + fullNote +
		' · shot ' + shot.toFixed(2) + ' kWh</div>';
	if (limit < SPEED_MIN && full >= SPEED_MIN) {
		const need = OrbitTech.launchEnergy(ship.mass, pad.catapult, SPEED_MIN) - pad.chargeKwh;
		const gain = panelWaitKwh(career, at, pad.panel);
		const rate = scene.trade.speed;
		if (need > 0 && gain > 0 && rate > 0) {
			const sec = Math.max(1, Math.ceil(need / gain * (CAREER_WAIT_MIN / rate)));
			html += '<div class="careerLine dim">solar +' + gain.toFixed(2) +
				' kWh/wait · ready in ' + sec + ' s</div>';
		}
	}
	if (full < GravitySim.SPEED_MIN) {
		html += '<div class="careerLine warn">cannot lift ' + ship.mass.toFixed(1) +
			' t · buy a bigger rail below</div>';
	}
	html += claimLineHtml();
	return html;
}

/* the record a gear row offers to build: the next known stock tier above the
 * installed one, else the lowest researched prototype that still upgrades
 * this pad — so `max` only prints when nothing at all is buildable. Unknown
 * stock tiers (e.g. EMC-3/4/5 before science) are skipped — they have to be
 * researched first, so the row's `max` names them instead. */
function gearNext(career, row, pad) {
	const stock = nextTier(career, row.table, pad[row.kind]);
	if (stock) return stock;
	const list = GravityGame.prototypesOf(career, row.kind) || [];
	let best = null;
	for (let i = 0; i < list.length; i++) {
		const item = list[i];
		if (!gearFits(pad, row.kind, item)) continue;
		if (best === null || item.tier < best.tier ||
			(item.tier === best.tier && item.buildCost < best.buildCost)) best = item;
	}
	return best;
}

/* first stock tier above the installed one that science has not unlocked */
function lockedTier(career, row, cur) {
	const tier = cur ? cur.tier : 0;
	for (let i = 0; i < row.table.length; i++) {
		if (row.table[i].tier > tier && !GravityGame.gearKnown(career, row.table[i]))
			return row.table[i];
	}
	return null;
}

function gearRowHtml(career, row, planet, next) {
	const pad = career.pads[planet];
	const cur = pad[row.kind];
	let html = '<div class="careerRow"><span class="careerKind">' + row.label + '</span>' +
		'<span class="careerNow">' + (cur ? cur.id : 'none') + '</span>' +
		capHtml(gearCapText(career, planet, pad, row.kind, next)) + '<span class="careerBtns">';
	if (next === null) {
		/* nothing buildable here now: say so, and name the next stock tier
		 * when it is only waiting for science */
		const locked = lockedTier(career, row, cur);
		return html + '<i>max</i>' + (locked ? capHtml(locked.id + ' · needs science') : '') +
			' ' + copyButtonHtml(row, cur) + '</span></div>';
	}
	if (cur === null && row.kind !== OrbitTech.KIND_CATAPULT) {
		return html + '<i>needs a catapult</i></span></div>';
	}
	const buildCost = careerCost(career, next.buildCost);
	const poor = purseTooSmall(career, buildCost);
	const btnTitle = row.kind === OrbitTech.KIND_PANEL && cur
		? 'build ' + next.id + ' on ' + planetName(planet) + ' · +' +
			waitGain(career, planet, cur) + ' → +' + waitGain(career, planet, next) +
			' kWh · ready in ' + panelReadySec(career, planet, pad, cur) + ' → ' +
			panelReadySec(career, planet, pad, next) + ' s'
		: 'build ' + next.id + ' on ' + planetName(planet) +
			(tierIndex(row.table, next) < 0 ? ' · ' + protoGearNoteText(row.kind, next) : '');
	html += shopButtonRef(next.id + ' · ' + costText(buildCost), 'build', row.kind,
		recordRef(row.table, next), poor, btnTitle, poor);
	html += bulkButtonHtml(career, row, next, recordRef(row.table, next));
	html += copyButtonHtml(row, next);
	return html + '</span></div>';
}

/* `all N`: one upgrade applied to every already-built facility that is below
 * it — a table tier and a researched prototype share the rule and the total */
function bulkButtonHtml(career, row, item, ref) {
	let count = 0;
	for (let i = 0; i < career.pads.length; i++) {
		if (OrbitTech.upgrades(career.pads[i], row.kind, item)) count += 1;
	}
	if (count === 0) return '';
	const cost = GravityGame.bulkUpgradeCost(career, row.kind, item);
	const poor = purseTooSmall(career, cost);
	return shopButtonRef('all ' + count + ' · ' + costText(cost), 'bulk', row.kind, ref,
		poor,
		'fit ' + item.id + ' to ' + count + ' built ' + row.label + (count === 1 ? '' : 's'),
		poor);
}

/* what a part row leads with: hold tons, tank fuel kg, engine thrust kN */
function partStatText(kind, item) {
	if (item === null) return kind === OrbitTech.KIND_ENGINE ? '0 kN' : 'none';
	if (kind === OrbitTech.KIND_HOLD) return item.capacity + ' t';
	if (kind === OrbitTech.KIND_TANK) return item.fuelCap + ' kg';
	return item.thrust + ' kN';
}

/* heaviest owned tier below the fitted one: the free way back to a lighter
 * ship; null when nothing lighter is owned (a hold/tank always has a tier 0).
 * When a prototype is fitted, an owned ladder item on that same integer rung
 * is also offered so the player can always swap back to the standard part. */
function lighterTier(career, table, cur) {
	if (cur === null) return null;
	const proto = tierIndex(table, cur) < 0;
	for (let i = table.length - 1; i >= 0; i--) {
		const ok = proto ? table[i].tier <= cur.tier : table[i].tier < cur.tier;
		if (ok && career.owned[table[i].id]) return table[i];
	}
	return null;
}

/* full-battery cap of HQ with `item` in `kind` and the ship as loaded now */
function partCap(career, row, item) {
	const pad = career.pads[career.hq];
	return padCapMass(pad.catapult, pad.battery,
		OrbitTech.refitMass(career.ship, row.kind, item, career.ship.cargoTons));
}

/* `8 → 24 t · 88 → 78 px/s`: the stat the offered refit holds and the HQ cap
 * it buys, so a heavy fit reads as a launch limit before it is fitted;
 * `change` undefined prints the fit as it is, null means the empty engine slot */
function partCapText(career, row, cur, change) {
	const now = partCap(career, row, cur);
	const after = change === undefined ? now : partCap(career, row, change);
	const stat = change === undefined ? partStatText(row.kind, cur)
		: partStatText(row.kind, cur) + ' → ' + partStatText(row.kind, change);
	const cap = capArrowText(now, after);
	return cap === '' ? stat : stat + ' · ' + cap;
}

/* one refit button: forward buys/installs the next tier, `back` returns to
 * an owned lighter one (item null = strip the engine) */
function partButtonHtml(career, row, item, back) {
	const atHq = career.at === career.hq;
	const owned = item === null || Boolean(career.owned[item.id]);
	const price = owned ? 0 : careerCost(career, item.buildCost);
	const fits = row.kind !== OrbitTech.KIND_HOLD || item.capacity >= career.ship.cargoTons;
	const name = item === null ? 'no engine' : item.id;
	const mass = OrbitTech.refitMass(career.ship, row.kind, item, career.ship.cargoTons);
	const dv = OrbitTech.refitDeltaV(career.ship, row.kind, item, career.ship.cargoTons);
	const burnCap = OrbitTech.refitBurnLimit(career.ship, row.kind, item, career.ship.cargoTons);
	const dvNote = dv > 0
		? ' · Δv ' + dv.toFixed(1) + ' px/s' +
			(burnCap < dv - 0.05 ? ' (burn ' + burnCap.toFixed(1) + ')' : '')
		: '';
	const title = 'refit ' + name + (atHq ? '' : ' at HQ only') + ' · ' +
		partStatText(row.kind, item) + ' · ship ' + mass.toFixed(1) + ' t · HQ cap ' +
		Math.round(partCap(career, row, item)) + ' px/s' + dvNote +
		(fits ? '' : ' · drops ' + career.ship.cargoTons + ' t cargo first');
	const label = back ? 'back ' + name
		: (owned ? 'fit ' : 'buy ') + name + ' · ' + costText(price);
	const poor = purseTooSmall(career, price);
	return shopButton(label, 'part', row.kind,
		item === null ? NO_TIER : tierIndex(row.table, item),
		!atHq || !fits || poor, title, poor && atHq && fits);
}

function partRowHtml(career, row) {
	const cur = career.ship[row.kind];
	const next = nextTier(career, row.table, cur);
	const engine = row.kind === OrbitTech.KIND_ENGINE;
	const back = lighterTier(career, row.table, cur);
	const canBack = cur !== null && (engine || back !== null);
	/* the arrow describes the action on offer: the upgrade, else the step down */
	const change = next !== null ? next : canBack ? back : undefined;
	let html = '<div class="careerRow"><span class="careerKind">' + row.label + '</span>' +
		'<span class="careerNow">' + (cur ? cur.id : 'none') + '</span>' +
		capHtml(partCapText(career, row, cur, change)) + '<span class="careerBtns">';
	if (next !== null) html += partButtonHtml(career, row, next, false);
	if (canBack) html += partButtonHtml(career, row, back, true);
	html += copyButtonHtml(row, next !== null ? next : cur);
	return html + '</span></div>';
}

/* a researched ship part (engine or tank) is owned like a bought part: refit
 * free at HQ, and the fitted one is marked instead of offered */
function protoPartRowHtml(career, row, proto) {
	const fitted = career.ship[row.kind] === proto;
	let html = '<div class="careerRow"><span class="careerKind">↳ ' + row.label + '</span>' +
		'<span class="careerNow">' + proto.id + '</span>' +
		capHtml(partCapText(career, row, proto, undefined)) + '<span class="careerBtns">';
	if (fitted) html += '<i>fitted</i>';
	else {
		const mass = OrbitTech.refitMass(career.ship, row.kind, proto, career.ship.cargoTons);
		const dv = OrbitTech.refitDeltaV(career.ship, row.kind, proto, career.ship.cargoTons);
		const note = row.kind === OrbitTech.KIND_ENGINE ? ' · isp ' + proto.isp
			: row.kind === OrbitTech.KIND_TANK ? ' · empty ' + proto.emptyMass + ' t' : '';
		const dvNote = dv > 0 ? ' · Δv ' + dv.toFixed(1) + ' px/s' : '';
		html += shopButtonRef('fit ' + proto.id, 'part', row.kind, 'data-item="' + proto.id + '"',
			career.at !== career.hq, 'refit ' + proto.id + ' at HQ ' + planetName(career.hq) +
			' · ' + partStatText(row.kind, proto) + note + ' · ship ' + mass.toFixed(1) + ' t' + dvNote);
	}
	return html + copyButtonHtml(row, proto) + '</span></div>';
}

/* a researched pad upgrade is built under the tech tables' upgrade rule: a
 * free catapult slot, or a higher rung than what the pad already has (a
 * panel/battery needs a catapult first, like every other pad gear) */
function gearFits(pad, kind, item) {
	if (kind === OrbitTech.KIND_CATAPULT) {
		return pad.catapult === null || OrbitTech.upgrades(pad, kind, item);
	}
	return pad.catapult !== null && OrbitTech.upgrades(pad, kind, item);
}

function protoGearStatText(kind, proto) {
	if (kind === OrbitTech.KIND_CATAPULT) return proto.maxForce + ' kN';
	if (kind === OrbitTech.KIND_BATTERY) return proto.capacity + ' kWh';
	return proto.power + ' kW';
}

function protoGearNoteText(kind, proto) {
	if (kind === OrbitTech.KIND_CATAPULT) return proto.maxForce + ' kN · eff ' + proto.efficiency;
	if (kind === OrbitTech.KIND_BATTERY) return proto.capacity + ' kWh · leak ' + proto.leak + '/y';
	return proto.power + ' kW';
}

function protoGearRowHtml(career, row, planet, proto) {
	const pad = career.pads[planet];
	const fits = gearFits(pad, row.kind, proto);
	const cost = careerCost(career, proto.buildCost);
	const cap = gearCapText(career, planet, pad, row.kind, proto);
	const stat = protoGearStatText(row.kind, proto);
	let html = '<div class="careerRow"><span class="careerKind">↳ ' + row.label + '</span>' +
		'<span class="careerNow">' + proto.id + '</span>' +
		capHtml(cap ? stat + ' · ' + cap : stat) + '<span class="careerBtns">';
	if (pad[row.kind] === proto) html += '<i>built</i>';
	else {
		const poor = purseTooSmall(career, cost);
		const why = row.kind !== OrbitTech.KIND_CATAPULT && pad.catapult === null
			? planetName(planet) + ' has no catapult yet'
			: proto.id + ' is not above the ' + row.label + ' on ' + planetName(planet);
		html += shopButtonRef('build ' + proto.id + ' · ' + costText(cost), 'build', row.kind,
			'data-item="' + proto.id + '"', !fits || poor,
			fits ? 'build ' + proto.id + ' on ' + planetName(planet) + ' · ' +
				protoGearNoteText(row.kind, proto) : why, poor && fits);
	}
	html += bulkButtonHtml(career, row, proto, 'data-item="' + proto.id + '"');
	return html + copyButtonHtml(row, proto) + '</span></div>';
}

function shopBlockHtml(career) {
	const planet = careerPickPlanet();
	const pad = career.pads[planet];
	let html = '<div class="careerHead">pad on ' + planetName(planet) + '</div>';
	for (let i = 0; i < GEAR_ROWS.length; i++) {
		const row = GEAR_ROWS[i];
		const next = gearNext(career, row, pad);
		html += gearRowHtml(career, row, planet, next);
		const list = GravityGame.prototypesOf(career, row.kind) || [];
		/* a prototype promoted to the row's own build button is not listed
		 * twice; the rest stay as grouped option rows */
		for (let j = 0; j < list.length; j++) {
			if (list[j] !== next) html += protoGearRowHtml(career, row, planet, list[j]);
		}
	}
	html += '<div class="careerHead">ship refit · HQ ' + planetName(career.hq) + '</div>';
	for (let i = 0; i < PART_ROWS.length; i++) {
		const row = PART_ROWS[i];
		html += partRowHtml(career, row);
		const list = GravityGame.prototypesOf(career, row.kind) || [];
		for (let j = 0; j < list.length; j++) html += protoPartRowHtml(career, row, list[j]);
	}
	return html;
}

/* --- §10 science: hull-distance research on custom parameter vectors --- */

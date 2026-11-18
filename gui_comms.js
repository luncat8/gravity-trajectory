/*
 * H's live launch-gate call, non-modal card, ranked topic chips and verified CTAs.
 *
 * Facts, slots and topics live in comms_copy.js; this file owns only the DOM
 * surface, the per-visit call state and the 1-to-1 action dispatcher.
 */
'use strict';

const HH_FACTS = CommsCopy.HH_FACTS;
const H_SLOTS = CommsCopy.H_SLOTS;
const H_ACTIONS = CommsCopy.H_ACTIONS;
const H_TOPICS = CommsCopy.H_TOPICS;

const commsButton = $('commsButton');
const commsBadge = $('commsBadge');
const commsTag = $('commsTag');
const commsHelperButton = $('commsHelper');
const commsCall = $('commsCall');
const commsCallReason = $('commsCallReason');
const commsAnswerCallButton = $('commsAnswerCall');
const commsDismissCallButton = $('commsDismissCall');
const commsCard = $('commsCard');
const commsCloseButton = $('commsClose');
const commsFoldButton = $('commsFold');
const commsBackButton = $('commsBack');
const commsDismissButton = $('commsDismiss');
const commsChipsEl = $('commsChips');
const commsQuestionButton = $('commsQuestion');
const commsStamp = $('commsStamp');
const commsTranscript = $('commsTranscript');
const commsAnswer = $('commsAnswer');
const commsCtasEl = $('commsCtas');

const commsState = {
	open: false,
	collapsed: false,
	career: null,
	planet: -2,
	currentKey: '',
	callKey: '',
	callReason: null,
	lastCallSecond: -1,
	seen: Object.create(null),
	dismissed: Object.create(null),
	asked: Object.create(null),
	snapshot: null,
	snapshotDirty: true,
	chipsHtml: '',
	ctasHtml: '',
	exchanges: []
};

/* Every H_ACTIONS key maps to a real page handler; nothing here invents mechanics. */
const COMMS_HANDLERS = Object.freeze({
	'slower-shot'() {
		if (!armed || aimBody < 0) return;
		const limit = activeCareerSim().speedLimit(aimBody);
		if (limit + 1e-9 < SPEED_MIN) return;
		aimSpeed = limit;
		placeGripFromSpeed();
		careerNotice('aimed ' + Math.round(aimSpeed) + ' px/s · within rail cap');
		launchState = -1;
		dirty = true;
		refreshGameUi();
	},
	repair() {
		careerAct({ act: 'repair' });
	},
	commercial() {
		toggleCommercialRail(true);
	},
	'build-pad'(snapshot) {
		if (!snapshot || !snapshot.nextPadId) return;
		careerFollow = true;
		if (snapshot.nextPadProto) {
			careerAct({ act: 'build', kind: OrbitTech.KIND_CATAPULT, item: snapshot.nextPadProto });
			return;
		}
		if (snapshot.nextPadTier < 0) return;
		careerAct({ act: 'build', kind: OrbitTech.KIND_CATAPULT, tier: String(snapshot.nextPadTier) });
	},
	wait() {
		careerAct({ act: 'wait' });
	},
	evac(snapshot) {
		if (!snapshot || !HH_FACTS['can-evac'].test(snapshot)) return;
		careerAct({ act: 'evac' });
	},
	'produce-fuel'() {
		careerAct({ act: 'produceFuel' });
	},
	'buy-fuel'() {
		careerAct({ act: 'buyFuel' });
	},
	bribe() {
		careerAct({ act: 'bribe' });
	}
});

function commsEscapeHtml(text) {
	return String(text)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function commsFindingKey(reason, planet) {
	if (!reason) return '';
	return reason.id + '|P' + planet + '|' +
		(reason.need === null || reason.need === undefined ? '' : String(reason.need)) + '|' +
		(reason.have === null || reason.have === undefined ? '' : String(reason.have)) + '|' +
		(reason.repair ? 'repair' : 'launch');
}

function commsResetVisit(career, planet) {
	commsState.career = career;
	commsState.planet = planet;
	commsState.currentKey = '';
	commsState.callKey = '';
	commsState.callReason = null;
	commsState.lastCallSecond = -1;
	commsState.seen = Object.create(null);
	commsState.dismissed = Object.create(null);
	commsState.asked = Object.create(null);
	commsState.snapshot = null;
	commsState.snapshotDirty = true;
	commsState.exchanges.length = 0;
	commsPaint();
}

function commsActiveFinding(career) {
	if (!career || !careerRule() || replay.on || playerIsBot() ||
		career.ended !== GravityGame.CAREER_OPEN ||
		activeSim().status === STATUS_FLYING || careerWaitBusy()) return null;
	if (career.at < 0) {
		return career.stranded
			? GravityGame.launchReason(career, activeCareerSim(), career.hq, SPEED_MIN, false)
			: null;
	}
	const armedHere = armed && aimBody === career.at;
	const speed = armedHere ? aimSpeed : SPEED_MIN;
	const reason = GravityGame.launchReason(career, activeCareerSim(), career.at, speed, false);
	if (!reason) return null; /* no closed gate: an off-network landing you can afford is not news */
	/* a call only for a gate the player is standing behind: a worn hull, an
	 * unaffordable fee, a rail that cannot lift the load. Landing without your
	 * own pad is normal travel — the commercial rail covers it when the purse can. */
	if (!armedHere && reason.id !== 'worn' && reason.id !== 'fee' && reason.id !== 'cap') return null;
	return reason;
}

function commsBuildSnapshot() {
	const inCareer = careerRule() && !replay.on;
	const rule = replay.on ? 'replay' : game.on ? game.rule : PLAY_LAB;
	const career = inCareer ? playerCareer() : null;
	const sim = inCareer ? activeCareerSim() : activeSim();
	const snapshot = CommsCopy.buildSnapshot({
		rule: rule,
		gameOn: game.on && !replay.on,
		clockSteps: game.clockSteps,
		career: career,
		market: game.market,
		galaxy: game.galaxy,
		sim: sim,
		planetCount: planetCount,
		armed: armed,
		aimBody: aimBody,
		aimSpeed: aimSpeed,
		waitLocked: careerWaitBusy() || turret.pending || sim.status === STATUS_FLYING
	});
	commsState.snapshot = snapshot;
	commsState.snapshotDirty = false;
	if (commsStamp) {
		commsStamp.textContent = 'checked ' + snapshot.second + ' s · ' +
			(snapshot.planet >= 0 ? planetName(snapshot.planet)
				: snapshot.careerMode ? 'in space' : snapshot.rule);
	}
	return snapshot;
}

function commsRefreshLatest(snapshot) {
	if (!commsState.exchanges.length) return;
	const latest = commsState.exchanges[commsState.exchanges.length - 1];
	const rendered = CommsCopy.renderTopic(latest.id, snapshot, commsState.asked);
	latest.question = rendered.question;
	latest.answer = rendered.text;
	latest.actions = rendered.actions;
}

function commsTick() {
	const career = careerRule() ? playerCareer() : null;
	const planet = career ? career.at : -2;
	if (career !== commsState.career || planet !== commsState.planet) {
		commsResetVisit(career, planet);
	}
	const reason = commsActiveFinding(career);
	const key = reason ? commsFindingKey(reason, planet) : '';
	if (key !== commsState.currentKey) {
		commsState.currentKey = key;
		commsState.callKey = '';
		commsState.callReason = null;
	}
	const second = game.on && !replay.on ? Math.floor(game.clockSteps * DT) : 0;
	if (key && !commsState.open && !commsState.callKey &&
		!commsState.seen[key] && !commsState.dismissed[key]) {
		if (second !== commsState.lastCallSecond) {
			commsState.callKey = key;
			commsState.callReason = reason;
			commsState.seen[key] = true;
			commsState.lastCallSecond = second;
		}
	}
	if (commsState.open && (commsState.snapshotDirty || !commsState.snapshot ||
		second !== commsState.snapshot.second)) {
		const snapshot = commsBuildSnapshot();
		if (commsState.exchanges.length) commsRefreshLatest(snapshot);
		else commsAsk(CommsCopy.H_META_ID);
	}
	commsPaint();
}

function commsInvalidate() {
	commsState.snapshotDirty = true;
}

function commsAsk(topicId) {
	if (!commsState.open) return;
	const id = typeof topicId === 'string' && topicId ? topicId : CommsCopy.H_META_ID;
	const snapshot = commsBuildSnapshot();
	if (id !== CommsCopy.H_META_ID && H_TOPICS[id]) commsState.asked[id] = true;
	const rendered = CommsCopy.renderTopic(id, snapshot, commsState.asked);
	const latest = commsState.exchanges[commsState.exchanges.length - 1];
	if (latest && latest.id === rendered.id) {
		latest.question = rendered.question;
		latest.answer = rendered.text;
		latest.actions = rendered.actions;
	} else {
		commsState.exchanges.push({
			id: rendered.id,
			question: rendered.question,
			answer: rendered.text,
			actions: rendered.actions
		});
		if (commsState.exchanges.length > CommsCopy.EXCHANGE_CAP) commsState.exchanges.shift();
	}
	commsPaint();
}

function commsBack() {
	if (!commsState.open || commsState.exchanges.length <= 1) return false;
	commsState.exchanges.pop();
	commsRefreshLatest(commsBuildSnapshot());
	commsPaint();
	return true;
}

function commsRunAction(actId) {
	if (!commsState.open || !actId) return false;
	const handler = COMMS_HANDLERS[actId];
	if (!handler || !commsState.exchanges.length) return false;
	const snapshot = commsBuildSnapshot();
	commsRefreshLatest(snapshot);
	const latest = commsState.exchanges[commsState.exchanges.length - 1];
	let allowed = null;
	for (let i = 0; i < latest.actions.length; i++) {
		if (latest.actions[i].id === actId) allowed = latest.actions[i];
	}
	if (!allowed || !allowed.enabled) {
		commsPaint();
		return false;
	}
	handler(snapshot);
	commsInvalidate();
	commsTick();
	return true;
}

function commsOpen() {
	if (commsState.open) return;
	const topic = commsState.callReason && commsState.callReason.id === 'stranded'
		? 'pad' : CommsCopy.H_META_ID;
	commsState.open = true;
	commsState.collapsed = false;
	commsState.callKey = '';
	commsState.callReason = null;
	commsAsk(topic);
	const focusTarget = $('commsQuestion') || commsCloseButton;
	if (focusTarget && focusTarget.focus) focusTarget.focus();
}

function commsToggleFold() {
	commsState.collapsed = !commsState.collapsed;
	commsPaint();
}

function commsClose() {
	if (!commsState.open) return false;
	commsState.open = false;
	commsState.currentKey = '';
	commsPaint();
	if (commsButton && commsButton.focus) commsButton.focus();
	return true;
}

function commsDismiss() {
	const key = commsState.callKey || commsState.currentKey;
	if (key) commsState.dismissed[key] = true;
	commsState.callKey = '';
	commsState.callReason = null;
	commsClose();
	commsPaint();
}

function commsEscape() {
	return commsClose();
}

function commsChipsMarkup(snapshot, activeId) {
	const chips = CommsCopy.chipList(snapshot, commsState.asked);
	let html = '';
	for (let i = 0; i < chips.length; i++) {
		const chip = chips[i];
		const idAttr = chip.id === CommsCopy.H_META_ID ? ' id="commsQuestion"' : '';
		const onClass = chip.id === activeId ? ' on' : '';
		html += '<button' + idAttr + ' class="miniBtn' + onClass +
			'" type="button" data-comms-topic="' + commsEscapeHtml(chip.id) + '">' +
			commsEscapeHtml(chip.ask) + '</button>';
	}
	return html;
}

function commsCtasMarkup(actions) {
	if (!actions || actions.length === 0) return '';
	let html = '';
	for (let i = 0; i < actions.length; i++) {
		const act = actions[i];
		const cls = 'miniBtn' + (act.costly ? ' costly' : '');
		const dis = act.enabled ? '' : ' disabled';
		html += '<div class="commsActRow"><button class="' + cls +
			'" type="button" data-comms-act="' + commsEscapeHtml(act.id) + '"' + dis + '>' +
			commsEscapeHtml(act.label) + '</button>' +
			(act.why ? '<span class="commsWhy">' + commsEscapeHtml(act.why) + '</span>' : '') +
			'</div>';
	}
	return html;
}

function commsReasonText(reason) {
	if (!reason) return '';
	return reason.id === 'stranded' ? 'No affordable way off this planet · ask H how to leave'
		: GravityGame.formatLaunchReason(reason);
}

function commsPaint() {
	const called = Boolean(commsState.callKey);
	if (commsButton) {
		const tagText = called ? commsReasonText(commsState.callReason) : '';
		commsButton.classList.toggle('called', called);
		commsButton.setAttribute('aria-label', called
			? 'H calls: ' + tagText + ' · open radio assistant'
			: 'open H radio assistant');
		commsButton.title = called ? 'H calls: ' + tagText + ' · open radio assistant'
			: 'open H radio assistant';
		commsButton.setAttribute('aria-pressed', commsState.open ? 'true' : 'false');
	}
	if (commsCall) commsCall.hidden = !called;
	if (commsCallReason) {
		commsCallReason.textContent = called ? commsReasonText(commsState.callReason) : '';
	}
	if (commsBadge) commsBadge.hidden = !called;
	if (commsTag) {
		commsTag.hidden = !called;
		commsTag.textContent = called ? commsReasonText(commsState.callReason) : '';
	}
	if (commsCard) {
		commsCard.hidden = !commsState.open;
		commsCard.classList.toggle('collapsed', commsState.collapsed);
	}
	if (commsFoldButton) {
		commsFoldButton.textContent = commsState.collapsed ? '+' : '−';
		commsFoldButton.setAttribute('aria-expanded', commsState.collapsed ? 'false' : 'true');
		commsFoldButton.setAttribute('aria-label', commsState.collapsed ? 'expand H' : 'collapse H');
	}
	if (!commsState.open || !commsTranscript || !commsAnswer) return;
	const count = commsState.exchanges.length;
	const latest = count ? commsState.exchanges[count - 1] : null;
	let transcript = '';
	for (let i = 0; i < count - 1; i++) {
		const exchange = commsState.exchanges[i];
		transcript += (transcript ? '\n\n' : '') + 'You: ' + exchange.question +
			'\nH: ' + exchange.answer;
	}
	if (latest) transcript += (transcript ? '\n\n' : '') + 'You: ' + latest.question;
	commsTranscript.textContent = transcript;
	commsAnswer.textContent = latest ? latest.answer : '';
	if (commsBackButton) commsBackButton.hidden = count <= 1;
	if (commsChipsEl && commsState.snapshot) {
		const nextChips = commsChipsMarkup(commsState.snapshot, latest ? latest.id : '');
		if (nextChips !== commsState.chipsHtml) {
			commsState.chipsHtml = nextChips;
			commsChipsEl.innerHTML = nextChips;
		}
	}
	if (commsCtasEl) {
		const nextCtas = commsCtasMarkup(latest ? latest.actions : null);
		if (nextCtas !== commsState.ctasHtml) {
			commsState.ctasHtml = nextCtas;
			commsCtasEl.innerHTML = nextCtas;
		}
		commsCtasEl.hidden = nextCtas === '';
	}
}

function commsFindData(event, key) {
	let node = event && event.target;
	while (node) {
		if (node.disabled) return '';
		if (node.dataset && node.dataset[key]) return node.dataset[key];
		node = node.parentElement;
	}
	return '';
}

if (commsButton) commsButton.addEventListener('click', commsOpen);
if (commsHelperButton) commsHelperButton.addEventListener('click', commsOpen);
if (commsAnswerCallButton) commsAnswerCallButton.addEventListener('click', commsOpen);
if (commsDismissCallButton) commsDismissCallButton.addEventListener('click', commsDismiss);
if (commsCloseButton) commsCloseButton.addEventListener('click', commsClose);
if (commsFoldButton) commsFoldButton.addEventListener('click', commsToggleFold);
if (commsBackButton) commsBackButton.addEventListener('click', commsBack);
if (commsDismissButton) commsDismissButton.addEventListener('click', commsDismiss);
if (commsQuestionButton) commsQuestionButton.addEventListener('click', () => commsAsk(CommsCopy.H_META_ID));
if (commsChipsEl) {
	commsChipsEl.addEventListener('click', event => {
		const topic = commsFindData(event, 'commsTopic');
		if (topic) commsAsk(topic);
	});
}
if (commsCtasEl) {
	commsCtasEl.addEventListener('click', event => {
		const act = commsFindData(event, 'commsAct');
		if (act) commsRunAction(act);
	});
}

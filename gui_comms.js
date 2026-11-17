/*
 * H's live launch-gate call and factual answer card.
 *
 * Part of the gui family: a flat global script, no modules/build, file:// safe.
 */
'use strict';

const commsButton = document.getElementById('commsButton');
const commsBadge = document.getElementById('commsBadge');
const commsTag = document.getElementById('commsTag');
const commsCard = document.getElementById('commsCard');
const commsCloseButton = document.getElementById('commsClose');
const commsFoldButton = document.getElementById('commsFold');
const commsDismissButton = document.getElementById('commsDismiss');
const commsQuestionButton = document.getElementById('commsQuestion');
const commsStamp = document.getElementById('commsStamp');
const commsTranscript = document.getElementById('commsTranscript');
const commsAnswer = document.getElementById('commsAnswer');

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
	snapshot: null,
	snapshotDirty: true,
	exchanges: []
};

function commsReasonFact(id) {
	return {
		test(snapshot) {
			for (let i = 0; i < snapshot.reasons.length; i++) {
				if (snapshot.reasons[i].id === id) return true;
			}
			return false;
		},
		why(snapshot) {
			for (let i = 0; i < snapshot.reasons.length; i++) {
				const reason = snapshot.reasons[i];
				if (reason.id === id) return GravityGame.formatLaunchReason(reason);
			}
			return '';
		}
	};
}

const HH_FACTS = Object.freeze({
	arrest: commsReasonFact('arrest'),
	space: commsReasonFact('space'),
	'wrong-planet': commsReasonFact('wrong-planet'),
	worn: commsReasonFact('worn'),
	'no-rail': commsReasonFact('no-rail'),
	cap: commsReasonFact('cap'),
	fee: commsReasonFact('fee')
});

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
	commsState.seen = Object.create(null);
	commsState.dismissed = Object.create(null);
	commsState.snapshot = null;
	commsState.snapshotDirty = true;
	commsState.exchanges.length = 0;
	commsPaint();
}

function commsActiveFinding(career) {
	if (!career || !careerRule() || replay.on || playerIsBot() ||
		career.ended !== GravityGame.CAREER_OPEN || career.at < 0 ||
		activeSim().status === STATUS_FLYING || careerWaitBusy()) return null;
	const armedHere = armed && aimBody === career.at;
	if (!armedHere && career.ship.condition !== 0) return null;
	const speed = armedHere ? aimSpeed : GravitySim.SPEED_MIN;
	const reason = GravityGame.launchReason(career, activeCareerSim(), career.at, speed, false);
	if (!reason) return null;
	if (!armedHere && reason.id !== 'worn') return null;
	return reason;
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
	if (key && !commsState.open && !commsState.callKey &&
		!commsState.seen[key] && !commsState.dismissed[key]) {
		const second = Math.floor(game.clockSteps * GravitySim.DT);
		if (second !== commsState.lastCallSecond) {
			commsState.callKey = key;
			commsState.callReason = reason;
			commsState.seen[key] = true;
			commsState.lastCallSecond = second;
		}
	}
	if (commsState.open && commsState.snapshotDirty) {
		const snapshot = commsBuildSnapshot();
		if (commsState.exchanges.length) {
			commsState.exchanges[commsState.exchanges.length - 1].answer = commsAnswerText(snapshot);
		}
	}
	commsPaint();
}

function commsInvalidate() {
	commsState.snapshotDirty = true;
}

function commsSnapshotReasons(career) {
	if (!career || career.at < 0 || !careerRule() || replay.on ||
		career.ended !== GravityGame.CAREER_OPEN || activeSim().status === STATUS_FLYING) return [];
	const armedHere = armed && aimBody === career.at;
	if (!armedHere && career.ship.condition !== 0) return [];
	return GravityGame.launchReasons(career, activeCareerSim(), career.at,
		armedHere ? aimSpeed : GravitySim.SPEED_MIN, false);
}

function commsBuildSnapshot() {
	const career = careerRule() ? playerCareer() : null;
	const reasons = career ? commsSnapshotReasons(career) : [];
	const copies = [];
	for (let i = 0; i < reasons.length; i++) {
		const reason = reasons[i];
		const fact = HH_FACTS[reason.id];
		if (!fact || !fact.test({ reasons: reasons })) continue;
		copies.push(Object.freeze({ id: reason.id, need: reason.need, have: reason.have,
			repair: reason.repair === true }));
	}
	const snapshot = {
		planet: career ? career.at : -1,
		second: game.on ? Math.floor(game.clockSteps * GravitySim.DT) : 0,
		reasons: Object.freeze(copies),
		purse: career ? career.ledger.purse : 0
	};
	commsState.snapshot = Object.freeze(snapshot);
	commsState.snapshotDirty = false;
	commsStamp.textContent = 'checked ' + snapshot.second + ' s · ' +
		(snapshot.planet >= 0 ? 'P' + snapshot.planet : 'in space');
	return commsState.snapshot;
}

function commsAnswerText(snapshot) {
	if (!snapshot || snapshot.reasons.length === 0) return 'No launch blocker is active.';
	let text = '';
	for (let i = 0; i < snapshot.reasons.length; i++) {
		const reason = snapshot.reasons[i];
		const fact = HH_FACTS[reason.id];
		if (!fact) continue;
		const line = fact.why(snapshot);
		if (!line) continue;
		text += (text ? '\nAlso blocked: ' : '') + line;
	}
	return text;
}

function commsAsk() {
	if (!commsState.open) return;
	const snapshot = commsState.snapshotDirty || !commsState.snapshot
		? commsBuildSnapshot() : commsState.snapshot;
	const question = 'Why is launch blocked?';
	const answer = commsAnswerText(snapshot);
	commsState.exchanges.push({ question: question, answer: answer });
	if (commsState.exchanges.length > 3) commsState.exchanges.shift();
	commsPaint();
}

function commsOpen() {
	if (commsState.open) return;
	commsState.open = true;
	commsState.collapsed = false;
	commsState.callKey = '';
	commsState.callReason = null;
	commsBuildSnapshot();
	commsPaint();
	commsAsk();
	if (commsQuestionButton && commsQuestionButton.focus) commsQuestionButton.focus();
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

function commsPaint() {
	const called = Boolean(commsState.callKey);
	if (commsButton) {
		commsButton.classList.toggle('called', called);
		commsButton.setAttribute('aria-label', called
			? 'H calls: ' + GravityGame.formatLaunchReason(commsState.callReason)
			: 'call H');
		commsButton.title = called
			? 'H calls: ' + GravityGame.formatLaunchReason(commsState.callReason)
			: 'call H';
		commsButton.setAttribute('aria-pressed', commsState.open ? 'true' : 'false');
	}
	if (commsBadge) commsBadge.hidden = !called;
	if (commsTag) {
		commsTag.hidden = !called;
		commsTag.textContent = called
			? GravityGame.formatLaunchReason(commsState.callReason) : '';
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
	let transcript = '';
	for (let i = 0; i < commsState.exchanges.length - 1; i++) {
		const exchange = commsState.exchanges[i];
		transcript += (transcript ? '\n\n' : '') + 'You: ' + exchange.question +
			'\nH: ' + exchange.answer;
	}
	const latest = commsState.exchanges.length
		? commsState.exchanges[commsState.exchanges.length - 1] : null;
	if (latest) transcript += (transcript ? '\n\n' : '') + 'You: ' + latest.question;
	commsTranscript.textContent = transcript;
	commsAnswer.textContent = latest ? latest.answer : '';
}

if (commsButton) commsButton.addEventListener('click', commsOpen);
if (commsCloseButton) commsCloseButton.addEventListener('click', commsClose);
if (commsFoldButton) commsFoldButton.addEventListener('click', commsToggleFold);
if (commsDismissButton) commsDismissButton.addEventListener('click', commsDismiss);
if (commsQuestionButton) commsQuestionButton.addEventListener('click', commsAsk);

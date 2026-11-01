/*
 * Career with the page in charge of who flies: every scoreboard box is a live
 * switch, YOU can be handed to the bot, and a rival can be taken back by hand.
 * The probe drives a real page and reports what each company did.
 *
 *   node experiments/career_gui_bot_probe.js [SEED] [FRAMES] [RATE]
 */
'use strict';

const { loadPage } = require('./dom_stub.js');

const SEP = process.argv.indexOf('--seed');
const seed = SEP >= 0 ? Number(process.argv[SEP + 1]) : 279588;
const frames = Number(process.env.FRAMES || 900);
const rate = Number(process.env.RATE || 12);

function check(ok, message) {
	if (!ok) throw new Error(message);
}

function report(env, label) {
	const scene = env.context.GravityScene;
	const bot = scene.bot;
	const rows = [];
	rows.push('YOU f' + scene.career.flights + ' ' + scene.career.ledger.purse.toFixed(2) +
		' ' + scene.career.padCount + 'p');
	for (let i = 0; i < bot.count; i++) {
		const r = bot.rivals[i];
		if (!r.career) continue;
		rows.push('R' + (i + 1) + (bot.isRivalBot(i) ? 'b' : 'u') + ' f' +
			r.career.flights + ' ' + r.career.ledger.purse.toFixed(2) + ' ' + r.career.padCount + 'p');
	}
	console.log(label + ': ' + rows.join(' · '));
}

const env = loadPage({ search: '?rule=career&seed=' + seed + '&rate=1', clipboard: false });
env.runFrames(2 * 16.0 / 16.0, 16.0);
const scene = env.context.GravityScene;
const career = scene.career;
const bot = scene.bot;
const ui = env.elements;

check(scene.game.rule === 'career' && bot.count === 2, 'career page with two rivals');
for (const id of ['playerBot', 'rivalBot1', 'rivalBot2']) {
	check(!ui.get(id).disabled, 'the ' + id + ' box is grayed out at the start');
}
report(env, 'start');

/* YOU as a bot: the bot shops, aims and fires through the page turret */
env.setValue('tradeSpeed', String(rate));
env.toggle('playerBot');
env.runFrames(4, 16.0);
check(scene.playerType() === 'bot' && ui.get('playerBot').checked, 'YOU=bot did not stick in career');
check(!ui.get('playerBot').disabled, 'the YOU box locked itself after switching to bot');
check(!scene.careerPaused(), 'a bot-run YOU must not sit on the landing pause');
env.runFrames(frames, 16.0);
report(env, 'after ' + frames + ' frames');
if (process.env.TRACE) console.log(bot.decisionLog(scene.game.clockSteps, 'trace').trim());
const youFlights = career.flights;
check(youFlights > 0, 'the bot never flew YOUR career: flights ' + youFlights +
	' · trace ' + (bot.trace ? 'yes' : 'no'));
check(career.padCount >= 1, 'the bot never used a pad: ' + career.padCount);

/* the whole page follows the selection: clicking a rival row shows its company */
const r1 = bot.rivals[0].career;
check(r1, 'R1 has no career');
env.click('scoreRival1');
env.runFrames(2, 16.0);
check(scene.activeSlot() === 1, 'clicking R1 did not select it');
check(ui.get('scoreRival1').classList.contains('isActive'), 'R1 row is not marked active');
check(scene.activeCareer() === r1, 'the panels still read YOU after selecting R1');

/* taking R1 back by hand stops the bot launching it, but the world keeps turning */
env.toggle('rivalBot1');
env.runFrames(2, 16.0);
check(!bot.isRivalBot(0), 'unchecking R1 did not hand it back to the keyboard');
check(!ui.get('rivalBot1').disabled, 'the R1 box disabled itself');
check(career.ledger.purse > 0 || career.flights > 0, 'the career was restarted by a box tick');
const r1Flights = r1.flights;
const clockBefore = scene.game.clockSteps;
env.runFrames(120, 16.0);
check(scene.game.clockSteps > clockBefore, 'the world clock stopped after the hand-over');
check(r1.flights === r1Flights, 'the bot kept launching a player flown by hand: ' +
	r1Flights + ' -> ' + r1.flights);

/* and back: the rival resumes its own company where it stands */
env.toggle('rivalBot1');
env.runFrames(4, 16.0);
check(bot.isRivalBot(0), 're-checking R1 did not hand it back to the bot');
env.runFrames(300, 16.0);
report(env, 'final');
check(r1.flights >= r1Flights, 'R1 lost its flights on the way back to the bot');
console.log('career gui bot: OK · YOU ' + youFlights + ' flights · R1 ' + r1.flights +
	' flights · ' + career.padCount + ' pads');

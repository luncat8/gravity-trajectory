/*
 * The shared sport race: its state, announce, close, expire, hold steps,
 * and settlement.
 * not here: the board slot it occupies → game_contracts.js
 *
 * Part of GravityGame (load order: PARTS in gravity_game.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityGame.part('game_sport.js', attach)
)(function (GravityGame, inner) {
	'use strict';
	const {
		GravitySim, OrbitWorld, OrbitEcon, CAREER, COMPETE_SLOT, SPORT_LENGTH, TASK_NONE,
		TASK_COMPETE, TASK_ACCEPTED, SALT_TASK, clearTask, draw01, round2, pay, colonyInPlay
	} = inner;

	/* the shared race (0.7.41): one galaxy-wide event announced on a board
	 * refresh, `ANNOUNCE_SEC` of countdown before the starting gun, and a
	 * `COMPETE_ENTRY` stake every entrant pays into the prize pool */
	const ANNOUNCE_SEC = 45;

	/* --- the shared sport event (0.7.41) ----------------------------------- */

	/*
	 * One galaxy-wide competition lives on `galaxy.sport` and mirrors itself
	 * into every company's `COMPETE_SLOT` (the shape `MEDIC_SLOT` already uses
	 * across actors), so player and rivals see the same race. The event record
	 * owns the money (pool, entry masks); the mirror task carries the offer a
	 * shot prices against. Headless careers without a galaxy race on their own
	 * `career.sport` through `sportStateOf`.
	 */

	function sportStateOf(career) {
		return career.galaxy ? career.galaxy.sport : career.sport;
	}

	/* one draw from the event's own stream: the galaxy's, or the solo career's
	 * task stream — announce and close draws never touch the careers' own rolls */
	function sportDraw(career) {
		const galaxy = career.galaxy;
		if (!galaxy) return draw01(career, SALT_TASK);
		galaxy.sportSerial += 1;
		return OrbitWorld.hashBits(galaxy.seed, galaxy.sportSerial, SALT_TASK) / 4294967296;
	}

	/* mirror the shared event into one company's slot: the event owns kind,
	 * planet, length, window and pool; the company keeps its own entry state */
	function syncSportSlot(career, sport) {
		const task = career.tasks[COMPETE_SLOT];
		if (sport.kind === TASK_NONE) {
			clearTask(task);
			return;
		}
		task.kind = TASK_COMPETE;
		task.planet = sport.planet;
		task.minLength = sport.minLength;
		task.reward = sport.pool;
		task.startsAt = sport.startsAt;
		task.deadline = sport.deadline;
	}

	function syncSportMirrors(career) {
		const sport = sportStateOf(career);
		const galaxy = career.galaxy;
		const count = galaxy ? galaxy.actors.length : 1;
		for (let i = 0; i < count; i++) {
			syncSportSlot(galaxy ? galaxy.actors[i] : career, sport);
		}
	}

	/* a rival's entry (or a fresh event) changed the shared offer behind the
	 * company's rendered board row */
	function sportMirrorStale(career) {
		const sport = sportStateOf(career);
		const task = career.tasks[COMPETE_SLOT];
		if (sport.kind !== task.kind) return true;
		return sport.kind === TASK_COMPETE &&
			(task.reward !== sport.pool || task.startsAt !== sport.startsAt ||
				task.deadline !== sport.deadline);
	}

	/* the race planet: a colonized, in-play planet with people still on it */
	function sportPlanetDraw(career, trade) {
		const colonies = trade && trade.colonies;
		const count = colonies ? colonies.length : 0;
		if (count < 1) return -1;
		const pick = Math.floor(sportDraw(career) * count);
		for (let k = 0; k < count; k++) {
			const colony = colonies[(pick + k) % count];
			if (!colonyInPlay(career, colony) || OrbitEcon.isAbandoned(colony)) continue;
			return colony.planet;
		}
		return -1;
	}

	/* announce the next event on a board refresh once the idle wait drawn at the
	 * last close has run out — a timed gate, not a per-refresh roll, so the
	 * race cadence follows the world clock and not how often companies land */
	function announceSport(career, trade, step) {
		const sport = sportStateOf(career);
		if (sport.kind !== TASK_NONE || step < sport.nextAt) return;
		const planet = sportPlanetDraw(career, trade);
		if (planet < 0) return;
		sport.kind = TASK_COMPETE;
		sport.serial += 1;
		sport.discipline = SPORT_LENGTH;
		sport.planet = planet;
		sport.minLength = Math.round((CAREER.competeMinPx +
			sportDraw(career) * CAREER.competeSpanPx) / 50) * 50;
		sport.baseReward = round2(CAREER.competeBase + sportDraw(career) * CAREER.competeSpan);
		sport.pool = sport.baseReward;
		sport.startsAt = step + Math.round(ANNOUNCE_SEC / GravitySim.DT);
		sport.deadline = sport.startsAt + Math.round(CAREER.competeSec / GravitySim.DT);
		sport.enteredMask = 0;
		sport.attemptedMask = 0;
		sport.winner = -1;
		syncSportMirrors(career);
	}

	/* every entrant settles when the race closes: the winner takes the pool, a
	 * racer who genuinely launched from the planet keeps the Capital refund,
	 * an idle no-show pays it back; forfeited stakes stay in the pool */
	function closeSport(career, sport, winner, step) {
		const galaxy = career.galaxy;
		const count = galaxy ? galaxy.actors.length : 1;
		for (let i = 0; i < count; i++) {
			const actor = galaxy ? galaxy.actors[i] : career;
			const task = actor.tasks[COMPETE_SLOT];
			if (actor === winner) {
				pay(actor, sport.pool);
				actor.competitions += 1;
				task.capitalRefund = 0;
			} else if ((sport.attemptedMask & (1 << actor.index)) === 0) {
				inner.clawbackTaskRefund(actor, task);
			} else {
				task.capitalRefund = 0;
			}
			clearTask(task);
		}
		sport.kind = TASK_NONE;
		sport.planet = -1;
		sport.pool = 0;
		sport.enteredMask = 0;
		sport.attemptedMask = 0;
		sport.winner = winner ? winner.index : -1;
		/* the next event waits a few competition windows before it announces */
		sport.nextAt = step + Math.round(CAREER.competeEvery * CAREER.competeSec *
			(0.5 + sportDraw(career)) / GravitySim.DT);
	}

	/* the race expires at its deadline: no winner, the stakes stay forfeited */
	function expireSport(career, step) {
		const sport = sportStateOf(career);
		if (sport.kind === TASK_NONE || step <= sport.deadline) return;
		closeSport(career, sport, null, step);
	}

	/* the barrel hold: an entered company queued on the race planet before the
	 * gun waits for it — the first barrel alignment at or after `startsAt` */
	function sportHoldStep(career, planet, step) {
		const sport = sportStateOf(career);
		if (sport.kind === TASK_COMPETE && planet === sport.planet &&
			career.tasks[COMPETE_SLOT].state === TASK_ACCEPTED && step < sport.startsAt) {
			return sport.startsAt;
		}
		return step;
	}

	/* the race judged at a landing: an entered company that launched from the
	 * race planet at or after the gun, flew the discipline length and lands
	 * inside the window takes the pool and closes the event for every actor */
	function settleSport(career, sim, step) {
		const sport = sportStateOf(career);
		if (sport.kind !== TASK_COMPETE) return;
		if (career.tasks[COMPETE_SLOT].state !== TASK_ACCEPTED) return;
		if (sim.origin !== sport.planet || career.flightStartStep < sport.startsAt ||
			sim.flightLength < sport.minLength || step > sport.deadline) return;
		closeSport(career, sport, career, step);
	}

	Object.assign(GravityGame, {
		ANNOUNCE_SEC, sportStateOf, sportHoldStep, sportMirrorStale
	});
	Object.assign(inner, {
		sportStateOf, syncSportSlot, syncSportMirrors, announceSport, expireSport, settleSport
	});
});

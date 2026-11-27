/*
 * What the bots say: the decision log, status lines, refusal reasons, career
 * trace lines, and the shared text helpers.
 * not here: the decisions themselves → the bot_career_*.js parts
 *
 * Part of GravityBot (load order: PARTS in gravity_bot.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.GravityBot.part('bot_trace.js', attach)
)(function (GravityBot, inner) {
	'use strict';
	const {
		GravitySim, GravityGame, MAX_RIVALS, PLAYER_INDEX, MAX_BOT_SHOTS, STATUS_FLYING, MONEY,
		CAREER_SIT_TRIES
	} = inner;

	/* decisions are rare, so the trace keeps whole lines and stays bounded */
	const TRACE_MAX = 240;

	/* --- decision trace ------------------------------------------------- */

	function worldClock(step) {
		return 't+ ' + (step * GravitySim.DT).toFixed(1);
	}

	function signed(value) {
		if (!Number.isFinite(value)) return String(value);
		return (value >= 0 ? '+' : '') + value.toFixed(2);
	}

	function burnNote(plan) {
		return plan.burnGain > 0 ? ' · burn ' + signed(plan.burnGain) +
			' → P' + plan.burnBody : '';
	}

	function actorLabel(index) {
		if (index < 0) return 'page';
		return index === PLAYER_INDEX ? 'YOU' : 'R' + (index + 1);
	}

	/* Galaxy career indices include YOU at 0; bot trace indices put YOU last. */
	function careerTraceIndex(career) {
		return career.index === 0 ? PLAYER_INDEX : career.index - 1;
	}

	/* flat fees are numbers; `careerPrice` reads item.buildCost and must not be
	 * handed one (an undefined price made every evacuation unaffordable) */
	function careerFee(career, value) {
		return career.cheat === GravityGame.CHEAT_COMMUNISM ? 0 : value;
	}

	GravityBot.prototype.traceAdd = function (index, decision, detail, step, move) {
		const fleet = this.fleetOwner && this.fleetOwner.fleetShip;
		if (fleet) detail = 'ship ' + fleet.id + (detail ? ' · ' + detail : '');
		const line = '[' + worldClock(step) + '] ' + actorLabel(index) + ' ' + decision +
			(detail ? ' · ' + detail : '');
		if (fleet) {
			fleet.log.push(line);
			if (fleet.log.length > TRACE_MAX) fleet.log.shift();
		}
		this.trace.push(line);
		this.traceRevision += 1;
		if (this.trace.length > TRACE_MAX) this.trace.shift();
		const bucket = this.traceByActor[index < 0 ? MAX_RIVALS + 1 : index];
		if (bucket) {
			bucket.push({ order: this.traceRevision, line: line });
			if (bucket.length > TRACE_MAX) bucket.shift();
		}
		if (index >= 0 && index < this.lastDecision.length) this.lastDecision[index] = line;
		if (this.onCareerTrace && this.rule === GravityGame.RULE_CAREER && index >= 0) {
			this.onCareerTrace(index, fleet ? 'fleet' : decision, detail, step, fleet ? undefined : move);
		}
	};

	GravityBot.prototype.traceReset = function () {
		this.trace.length = 0;
		for (const bucket of this.traceByActor) bucket.length = 0;
		for (let i = 0; i < this.lastDecision.length; i++) this.lastDecision[i] = '';
	};

	GravityBot.prototype.traceHeaders = function (step, selected) {
		const actors = [];
		for (let i = 0; i < this.count; i++) {
			if (selected ? selected.includes(i) : this.isRivalBot(i)) {
				actors.push(this.actorStatus(i, step));
			}
		}
		if (selected ? selected.includes(PLAYER_INDEX) : this.playerType === GravityGame.PLAYER_BOT) {
			if (this.rule === GravityGame.RULE_CAREER) {
				if (this.careerPlayer.career) actors.push(this.careerPlayerStatus(step));
			} else {
				actors.push(this.actorStatus(PLAYER_INDEX, step));
			}
		}
		return actors;
	};

	/* the log line for YOUR company when the page has handed it to the bot */
	GravityBot.prototype.careerPlayerStatus = function (step) {
		const p = this.careerPlayer;
		const career = p.career;
		const flying = p.sim && p.sim.status === STATUS_FLYING;
		let state = 'ready';
		if (career.ended !== GravityGame.CAREER_OPEN) {
			state = career.ended === GravityGame.CAREER_BROKE ? 'broke' : 'complete';
		} else if (flying) state = 'flying';
		else if (step < p.readyStep) {
			state = p.waitTries > 0 ? 'sitting ' + p.waitTries + '/' + CAREER_SIT_TRIES : 'gap';
		}
		return 'YOU · ' + state + ' · ' + (career.at < 0 ? 'in space' : 'P' + career.at) +
			' · purse ' + career.ledger.purse.toFixed(2) + ' · ' + career.padCount +
			' pads · ' + career.flights + ' flights\n    ' +
			GravityGame.railText(career, p.sim, career.at);
	};

	/* the copyable log: live state first, then the newest decisions */
	GravityBot.prototype.decisionLog = function (step, header, selected) {
		const lines = ['gravity cargo · bot decisions', header || '', ''];
		const states = this.traceHeaders(step, selected);
		for (let i = 0; i < states.length; i++) lines.push(states[i]);
		let decisions = this.trace;
		if (selected) {
			const entries = this.traceByActor[MAX_RIVALS + 1].slice();
			for (const actor of selected) {
				if (this.traceByActor[actor]) entries.push(...this.traceByActor[actor]);
			}
			entries.sort((a, b) => a.order - b.order);
			decisions = entries.map(entry => entry.line);
		}
		lines.push('', 'decisions (' + decisions.length + (selected ? ' · last ' + TRACE_MAX +
			' per checked bot' : ' of the last ' + TRACE_MAX) + ', newest last):');
		if (decisions.length === 0) lines.push('(none yet · the world clock may be paused)');
		else lines.push(...decisions);
		return lines.join('\n');
	};

	/* --- live state and refusal reasons --------------------------------- */

	/* candidate counts from the failed search, so "cannot fly" has a cause */
	GravityBot.prototype.careerNoPlanWhy = function (career, sim) {
		const at = career.at;
		if (at < 0) return GravityGame.railText(career, sim, at);
		if (!sim.canLaunchFrom(at)) return 'P' + at + ' cannot launch (ship not landed)';

		const block = GravityGame.railBlock(career, sim, at, GravitySim.SPEED_MIN);
		if (block !== '') {
			return 'P' + at + ' ' + block + ' · charge ' +
				GravityGame.padAt(career, at).chargeKwh.toFixed(2) + ' kWh';
		}
		const scan = this.careerScan;
		if (career.contract >= 0) {
			return 'contract wants P' + this.careerTarget(career) + ' · no fan shot lands there (' +
				scan.tried + ' traces)';
		}
		if (scan.tried > 0 && scan.impacts === 0) {
			return 'fan ' + scan.tried + ' traces · no impact · book ' + scan.book;
		}
		return 'fan ' + scan.tried + ' traces · ' + scan.impacts + ' impacts · ' +
			scan.finite + ' payable · ' + scan.bounce + ' bounces · ' +
			(scan.busy ? scan.busy + ' shared aims · ' : '') +
			scan.exit + ' nonviable exits · ' + scan.noImpact + ' no landing · book ' + scan.book;
	};

	GravityBot.prototype.rivalDoneWhy = function (r) {
		const spec = this.ruleSpec();
		if (this.rule === GravityGame.RULE_ROUTE) {
			return r.routeDone ? 'plan ready' : 'tracing one plan';
		}
		if (spec.stopOnTour && r.doneSteps >= 0) return 'tour complete';
		if (spec.maxShots > 0 && r.shots.length >= spec.maxShots) {
			return r.shots.length + '-shot cap reached';
		}
		if (r.shots.length >= MAX_BOT_SHOTS) return 'safety shot cap';
		if (r.sim.status !== STATUS_FLYING && r.ledger.purse < MONEY.cost) {
			return 'purse ' + r.ledger.purse.toFixed(2) + ' < launch fee ' + MONEY.cost.toFixed(2);
		}
		return 'active';
	};

	GravityBot.prototype.actorStateShort = function (index, runStep) {
		const r = this.actorAt(index);
		if (this.rule === GravityGame.RULE_CAREER) {
			const career = r.career;
			if (!career) return 'no company';
			if (career.ended === GravityGame.CAREER_BROKE) {
				return 'broke · career over';
			}
			if (career.ended !== GravityGame.CAREER_OPEN) return 'complete';
			if (career.evacuating) return 'evacuating · ' +
				Math.max(0, (career.evacUntilStep - runStep) * GravitySim.DT).toFixed(1) + ' s';
			if (career.at < 0) {
				const fee = careerFee(career, GravityGame.CAREER.evacFee);
				return career.ledger.purse + 1e-9 >= fee
					? 'in space · evacuating'
					: 'in space · purse ' + career.ledger.purse.toFixed(2) +
						' < evac ' + fee.toFixed(2);
			}
			if (r.sim.status === STATUS_FLYING) return 'flying';
			if (r.turret) {
				return 'queued · barrel in ' + Math.max(0, (r.turret.fireAt - runStep) * GravitySim.DT).toFixed(1) + ' s';
			}
			if (runStep < r.readyStep) {
				const why = r.waitTries > 0
					? 'sitting ' + r.waitTries + '/' + CAREER_SIT_TRIES
					: r.idleTries > 0 ? 'no shot' : 'gap';
				return why + ' · retry in ' + ((r.readyStep - runStep) * GravitySim.DT).toFixed(1) + ' s';
			}
			return 'ready';
		}
		if (r.sim.status === STATUS_FLYING) return 'flying';
		if (this.rivalDone(r)) return this.rivalDoneWhy(r);
		if (this.jobActive && this.jobRival === index) {
			return 'thinking ' + Math.round(this.progress() * 100) + '%';
		}
		if (runStep < r.readyStep) {
			return 'gap · ' + ((r.readyStep - runStep) * GravitySim.DT).toFixed(1) + ' s';
		}
		return 'ready';
	};

	/* multi-line live state: state, money, rail, saved shots, last decision */
	GravityBot.prototype.actorStatus = function (index, runStep) {
		const label = actorLabel(index);
		const r = this.actorAt(index);
		const short = this.actorStateShort(index, runStep);
		const lines = [];
		if (this.rule === GravityGame.RULE_CAREER) {
			const career = r.career;
			if (!career) return label + ' · no company';
			const place = career.at < 0 ? 'in space'
				: 'P' + career.at + (r.sim.status === STATUS_FLYING ? ' · in flight' : '');
			lines.push(label + ' · ' + short + ' · ' + place +
				' · purse ' + career.ledger.purse.toFixed(2) + ' · ' + career.padCount +
				' pads · ' + career.flights + ' flights');
			lines.push('    ' + GravityGame.railText(career, r.sim, career.at));
			let book = 0;
			for (let i = 0; i < career.launchBook.entries.length; i++) {
				if (career.launchBook.entries[i].origin === career.at) book += 1;
			}
			let extra = 'book ' + book + ' from here · sit ' + r.waitTries + '/' +
				CAREER_SIT_TRIES + ' · idle ' + r.idleTries;
			if (career.contract >= 0) {
				const task = career.tasks[career.contract];
				extra += ' · contract → P' + (task.state === GravityGame.TASK_LOADED ? task.to : task.from);
			}
			if (r.turret) extra += ' · queued v' + r.turret.speed.toFixed(0);
			lines.push('    ' + extra);
		} else {
			lines.push(label + ' · ' + short + ' · ' + r.shots.length + ' shots · purse ' +
				r.ledger.purse.toFixed(2) + ' · ' + r.sim.visitedCount + ' systems · ' +
				(r.steps * GravitySim.DT).toFixed(1) + ' s');
			lines.push('    ' + this.rivalDoneWhy(r) + ' · next in ' +
				Math.max(0, (r.readyStep - runStep) * GravitySim.DT).toFixed(1) + ' s');
		}
		if (this.lastDecision[index]) lines.push('    last: ' + this.lastDecision[index]);
		return lines.join('\n');
	};

	GravityBot.prototype.traceCareerBurn = function (career, sim, angle, dv, step, why = 'manual') {
		this.traceAdd(careerTraceIndex(career), 'burn', 'Δv ' + dv.toFixed(1) + ' · ' + why +
			' · ' + career.ship.fuelKg.toFixed(1) + ' kg left', step, [sim.liveSteps, angle, dv]);
	};

	/*
	 * Career rivals: each one is a full `GravityGame` career on the shared map —
	 * its own HQ, purse, ship, task board, EMC network and science hull — flown
	 * by the same synchronous controller the benches use. They launch from
	 * whatever EMC stands on their planet (own, a rival's, or the commercial
	 * one), so usage tax flows both ways. The career clock runs whenever it is
	 * not landing-paused, so the companies launch, fly and shop on world time
	 * whether or not your ship is in the air; after landing a rival sits out
	 * CAREER_RIVAL_GAP world seconds (plus its phase) before the next attempt.
	 */
	function careerStartTraceText(career, readySecText) {
		if (career.hq >= 0) {
			return 'HQ P' + career.hq + ' · purse ' + career.ledger.purse.toFixed(2) +
				(readySecText ? ' · first try in ' + readySecText : '');
		}
		if (career.flying) {
			return 'space · purse ' + career.ledger.purse.toFixed(2);
		}
		return 'Capital P' + career.at + ' · purse ' + career.ledger.purse.toFixed(2) +
			(readySecText ? ' · first try in ' + readySecText : '');
	}

	GravityBot.prototype.traceCareerPlan = function (who, plan, runStep) {
		this.traceAdd(who, 'plan', 'P' + plan.origin + '→P' + plan.body +
			' v' + plan.speed.toFixed(0) + ' score ' + signed(plan.score) +
			' pay ' + signed(plan.taskPay) +
			(plan.bribe > 0 ? ' (bribe ' + plan.bribe.toFixed(2) + ')' : '') +
			' pad after wear ' + signed(plan.padValue) +
			' fee ' + plan.fee.toFixed(2) + ' exit ' + (plan.exitCost || 0).toFixed(2) +
			' (' + (plan.exitSource || 'own') + ') · ' +
			(plan.fromBook ? 'book reuse' : 'fan ' + this.careerScan.tried + ' traces') +
			' · EMC build ' + (plan.builds ? 'affordable' : 'no') + burnNote(plan), runStep);
	};

	GravityBot.prototype.traceCareerQueue = function (career, origin, angle, speed, energy, fireAt, step) {
		this.traceAdd(careerTraceIndex(career), 'queue', 'P' + origin + ' angle ' + angle.toFixed(2) +
			' v' + speed.toFixed(0) + ' · ' + GravityGame.railOwnerText(career, origin) +
			' · ' + energy.toFixed(2) + ' kWh · barrel in ' + ((fireAt - step) * GravitySim.DT).toFixed(1) + ' s', step);
	};

	GravityBot.prototype.traceCareerFire = function (career, sim, step) {
		this.traceAdd(careerTraceIndex(career), 'fire', 'P' + sim.origin + ' · v' + sim.speed.toFixed(1) +
			' · purse ' + career.ledger.purse.toFixed(2), step, [sim.origin, sim.angle, sim.speed]);
	};

	GravityBot.prototype.traceCareerLanding = function (career, sim, step) {
		this.traceAdd(careerTraceIndex(career), 'land', (career.at < 0 ? 'lost in space' : 'P' + career.at) +
			' · purse ' + career.ledger.purse.toFixed(2) + ' · ' + career.padCount + ' pads',
			step, [career.at, sim.endReason, sim.liveSteps]);
	};
	GravityBot.TRACE_MAX = TRACE_MAX;

	Object.assign(inner, {
		signed, careerTraceIndex, careerFee, careerStartTraceText
	});
});

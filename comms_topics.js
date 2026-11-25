/*
 * H's authored copy: H_ACTIONS, H_STEPS, H_LOOKAHEAD and H_TOPICS. Data only.
 * not here: evaluating and rendering it → comms_render.js
 *
 * Part of CommsCopy (load order: PARTS in comms_copy.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.CommsCopy.part('comms_topics.js', attach)
)(function (CommsCopy, inner) {
	'use strict';

	/* Verified CTA metadata: gui_comms maps each id to its real page handler. */
	const H_ACTIONS = Object.freeze({
		'slower-shot': Object.freeze({
			id: 'slower-shot',
			label: 'aim {speedCap}',
			when: 'can-slower-shot',
			enabled: 'can-slower-shot',
			costly: false
		}),
		repair: Object.freeze({
			id: 'repair',
			label: 'repair · {repairCost}',
			when: 'can-offer-repair',
			enabled: 'can-repair',
			costly: true
		}),
		commercial: Object.freeze({
			id: 'commercial',
			label: 'commercial {commercialPadId} · {commercialMinFee}',
			when: 'can-offer-commercial',
			enabled: 'can-pay-commercial',
			costly: true
		}),
		'build-pad': Object.freeze({
			id: 'build-pad',
			label: 'build {nextPadId} · {nextPadCost}',
			when: 'can-offer-build',
			enabled: 'can-build-pad',
			costly: true
		}),
		wait: Object.freeze({
			id: 'wait',
			label: 'wait · {waitSec}',
			when: 'can-offer-wait',
			enabled: 'can-wait',
			costly: false
		}),
		evac: Object.freeze({
			id: 'evac',
			label: 'evacuate · {evacCost} · {evacSeconds}',
			when: 'can-offer-evac',
			enabled: 'can-evac',
			costly: true
		}),
		'produce-fuel': Object.freeze({
			id: 'produce-fuel',
			label: 'charge → fuel +{produceBtnKg} · {produceBtnKwh}',
			when: 'fuel-need',
			enabled: 'can-produce-fuel',
			costly: false
		}),
		'buy-fuel': Object.freeze({
			id: 'buy-fuel',
			label: 'buy fuel +{buyBtnKg} · {buyBtnCost}',
			when: 'fuel-need',
			enabled: 'can-buy-fuel',
			costly: true
		}),
		bribe: Object.freeze({
			id: 'bribe',
			label: 'bribe rulers · +{bribeAmount}',
			when: 'bribe-topic-open',
			enabled: 'bribe-open',
			costly: false
		}),
		/* 0.7.47 WS3/WS4: the unfair-roster and seat-search decisions */
		'fair-less-players': Object.freeze({
			id: 'fair-less-players',
			label: 'one fewer company',
			when: 'roster-unfair',
			enabled: 'can-drop-player',
			costly: false
		}),
		'fair-more-planets': Object.freeze({
			id: 'fair-more-planets',
			label: 'one more planet',
			when: 'roster-unfair',
			enabled: 'can-add-planet',
			costly: false
		}),
		'fair-play-as-is': Object.freeze({
			id: 'fair-play-as-is',
			label: 'start anyway',
			when: 'search-active',
			enabled: 'search-can-start',
			costly: false
		}),
		'fair-load-saves': Object.freeze({
			id: 'fair-load-saves',
			label: 'load a fair save',
			when: 'search-active',
			enabled: 'search-active',
			costly: false
		})
	});

	/* Replacement gates evaluated before a topic's lines (first true wins). */
	const H_STEPS = Object.freeze({
		'non-career': Object.freeze({
			id: 'non-career',
			when: { not: 'career-mode' },
			lines: Object.freeze([
				Object.freeze({ text: 'H covers career ships and pads; mode {ruleName} has no base purse or pad network.' })
			]),
			actions: Object.freeze([]),
			ref: Object.freeze([]),
			refWhen: null
		}),
		'career-ended': Object.freeze({
			id: 'career-ended',
			when: 'ended',
			lines: Object.freeze([
				Object.freeze({ text: 'Career closed ({endedTag}) · purse {purse} · pads {padCount}/{planetCount}.' })
			]),
			actions: Object.freeze([]),
			ref: Object.freeze([]),
			refWhen: null
		}),
		'at-arrest': Object.freeze({
			id: 'at-arrest',
			when: 'arrest',
			lines: Object.freeze([
				Object.freeze({ text: '{arrestWhy} ({arrestLeft} left on {planetTag}). Planning and shop actions resume when the transport releases the ship.' })
			]),
			actions: Object.freeze([]),
			ref: Object.freeze([]),
			refWhen: null
		}),
		'in-flight': Object.freeze({
			id: 'in-flight',
			when: 'flying',
			lines: Object.freeze([
				Object.freeze({ text: 'Ship is in flight · condition {conditionPct} · purse {purse}. Land before refitting, refuelling or building.' })
			]),
			actions: Object.freeze([]),
			ref: Object.freeze([]),
			refWhen: null
		}),
		'at-space': Object.freeze({
			id: 'at-space',
			when: 'space',
			lines: Object.freeze([
				Object.freeze({
					text: 'Ship is stranded in space · purse {purse}. Evacuate to HQ {hqTag} for {evacCost}; it takes {evacSeconds}.',
					note: Object.freeze({ fact: 'can-evac', invert: true })
				})
			]),
			actions: Object.freeze(['evac']),
			ref: Object.freeze(['money']),
			refWhen: 'evac-short'
		})
	});

	/* Bounded one-step arithmetic over actions present on the current planet. */
	const H_LOOKAHEAD = Object.freeze({
		'slower-fee': Object.freeze({
			when: 'step-slower-fee',
			text: 'At min speed ({speedMin}), launch fee is {minFee} (fits purse {purse}).'
		}),
		'commercial-pad': Object.freeze({
			when: 'step-commercial-pad',
			text: 'Commercial {commercialPadId} here lifts to {commercialLift} from {commercialMinFee} (fits purse {purse}).'
		}),
		'bribe-repair': Object.freeze({
			when: 'step-bribe-repair',
			text: 'Purse {purse} + rulers’ offer {bribeAmount} = {afterBribePurse}, covering repair {repairCost} (one per visit, +{bribeRot} rot).'
		}),
		'bribe-fee': Object.freeze({
			when: 'step-bribe-fee',
			text: 'Purse {purse} + rulers’ offer {bribeAmount} = {afterBribePurse}, covering launch {feeNeed} (one per visit, +{bribeRot} rot).'
		}),
		'bribe-build': Object.freeze({
			when: 'step-bribe-build',
			text: 'Purse {purse} + rulers’ offer {bribeAmount} = {afterBribePurse}, covering {nextPadId} {nextPadCost} (one per visit, +{bribeRot} rot).'
		}),
		'bribe-evac': Object.freeze({
			when: 'step-bribe-evac',
			text: 'Purse {purse} + rulers’ offer {bribeAmount} = {afterBribePurse}, covering the full evacuation fare {evacFee} (one per visit, +{bribeRot} rot).'
		}),
		'charge-fuel': Object.freeze({
			when: 'step-charge-fuel',
			text: 'Own pad holds {ownFreeKwh} unreserved: converts +{produceKg} ({produceKwh}) with no purse cost.'
		})
	});

	const H_TOPICS = Object.freeze({
		'return-tow': Object.freeze({
			id: 'return-tow',
			ask: 'tow to HQ?',
			rank: 1,
			when: 'return-tow',
			steps: Object.freeze(['non-career', 'career-ended', 'at-arrest', 'in-flight', 'at-space']),
			lines: Object.freeze([
				Object.freeze({
					text: 'Your last two flights brought you back to {planetTag}. Want a tow to HQ?',
					when: 'return-tow'
				}),
				Object.freeze({
					text: 'Evacuate to HQ {hqTag} for {evacCost}; it takes {evacSeconds} of game time.',
					when: 'can-offer-evac',
					note: Object.freeze({ fact: 'can-evac', invert: true })
				}),
				Object.freeze({
					text: 'No tow to HQ is needed here.',
					when: Object.freeze({ not: 'can-offer-evac' })
				})
			]),
			lookAhead: Object.freeze([]),
			ref: Object.freeze([]),
			refWhen: null,
			chips: Object.freeze([]),
			actions: Object.freeze(['evac'])
		}),
		leave: Object.freeze({
			id: 'leave',
			ask: 'why is launch blocked?',
			rank: 0,
			when: 'launch-blocked',
			includeReasons: true,
			steps: Object.freeze(['non-career', 'career-ended', 'in-flight']),
			lines: Object.freeze([
				Object.freeze({
					text: 'No launch blocker is active on {planetTag} ({railName}, cap {speedCap}, min fee {minFee}, purse {purse}).',
					when: Object.freeze({ not: 'launch-blocked' })
				}),
				Object.freeze({
					text: 'Transport releases in {arrestLeft} on {planetTag}.',
					when: 'arrest'
				}),
				Object.freeze({
					text: 'Evacuate to HQ {hqTag} for {evacCost}; it takes {evacSeconds}.',
					when: Object.freeze({ all: Object.freeze(['space', 'can-offer-evac']) }),
					note: Object.freeze({ fact: 'can-evac', invert: true })
				}),
				Object.freeze({
					text: 'Condition {conditionPct} · full repair {repairCost} · purse {purse}.',
					when: Object.freeze({ all: Object.freeze(['landed-open', 'worn']) }),
					note: Object.freeze({ fact: 'can-repair', invert: true })
				}),
				Object.freeze({
					text: 'Rail {railName} holds {padCharge}/{padCapacity} (lifts to {padLift} when charged).',
					when: 'pad-undercharged'
				}),
				Object.freeze({
					text: 'Wait {waitSec} adds +{waitGainKwh} solar charge.',
					when: Object.freeze({ all: Object.freeze(['pad-undercharged', 'own-pad-here']) })
				}),
				Object.freeze({
					text: 'Rail {railName} caps at {padLift} for a {shipMass} ship (min launch {speedMin}).',
					when: 'pad-underpowered'
				}),
				Object.freeze({
					text: 'Build {nextPadId}: {nextPadCost} (lifts to {nextPadCap}).',
					when: Object.freeze({ all: Object.freeze([
						Object.freeze({ any: Object.freeze(['no-rail', 'pad-underpowered']) }),
						'can-offer-build'
					]) }),
					note: Object.freeze({ fact: 'can-build-pad', invert: true })
				}),
				Object.freeze({
					text: 'Evacuate to HQ {hqTag} for {evacCost}; it takes {evacSeconds}.',
					when: Object.freeze({ all: Object.freeze([
						Object.freeze({ any: Object.freeze(['no-rail', 'pad-underpowered']) }),
						'can-offer-evac'
					]) }),
					note: Object.freeze({ fact: 'can-evac', invert: true })
				}),
				Object.freeze({
					text: 'Rail {railName} fires up to {speedCap}; lower the aimed speed to fit.',
					when: 'can-slower-shot'
				}),
				Object.freeze({
					text: 'Short {feeShort} on {railName} (purse {purse}).',
					when: Object.freeze({ all: Object.freeze(['landed-open', 'fee']) })
				})
			]),
			lookAhead: Object.freeze([
				'slower-fee', 'commercial-pad',
				Object.freeze(['bribe-repair', 'bribe-fee', 'bribe-build', 'bribe-evac'])
			]),
			ref: Object.freeze(['money']),
			refWhen: 'leave-short',
			chips: Object.freeze(['repair', 'pad', 'money']),
			actions: Object.freeze([
				'slower-shot',
				'repair',
				'commercial',
				Object.freeze({ id: 'build-pad', when: Object.freeze({ any: Object.freeze(['no-rail', 'cap', 'fee']) }) }),
				Object.freeze({ id: 'wait', when: Object.freeze({ all: Object.freeze(['own-pad-charging', Object.freeze({ any: Object.freeze(['no-rail', 'cap']) })]) }) }),
				Object.freeze({ id: 'evac', when: Object.freeze({ any: Object.freeze(['space', 'no-rail', 'cap', 'fee']) }) })
			])
		}),

		repair: Object.freeze({
			id: 'repair',
			ask: 'ship condition and repair',
			rank: 5,
			when: Object.freeze({ all: Object.freeze(['landed-open', 'ship-worn']) }),
			steps: Object.freeze(['non-career', 'career-ended', 'at-arrest', 'in-flight', 'at-space']),
			lines: Object.freeze([
				Object.freeze({ text: 'Condition {conditionPct} · ship {shipMass} · purse {purse}.' }),
				Object.freeze({
					text: '{wornWhy}. Impulse burns and {obsId} reports stay off until repaired.',
					when: 'ship-unusable'
				}),
				Object.freeze({
					text: 'Full repair on any planet: {repairCost} ({repairFullCost} for full hull).',
					when: 'ship-worn',
					note: Object.freeze({ fact: 'can-repair', invert: true })
				}),
				Object.freeze({
					text: 'Hull is as new ({repairFullCost} for full hull).',
					when: Object.freeze({ not: 'ship-worn' })
				}),
				Object.freeze({
					text: 'Wear runs at {wearSpacePct}/s in space and {wearLandingPct} per landing.'
				})
			]),
			lookAhead: Object.freeze(['bribe-repair']),
			ref: Object.freeze(['money']),
			refWhen: 'repair-short',
			chips: Object.freeze(['leave', 'money']),
			actions: Object.freeze(['repair'])
		}),

		pad: Object.freeze({
			id: 'pad',
			ask: 'pad and rail',
			rank: 6,
			when: 'pad-topic-open',
			steps: Object.freeze(['non-career', 'career-ended', 'at-arrest', 'in-flight', 'at-space']),
			lines: Object.freeze([
				Object.freeze({
					text: '{planetTag} · {railName} · cap {speedCap} (full {padLift}, min {speedMin}) · purse {purse}.'
				}),
				Object.freeze({
					text: 'The Empire owns {planetTag}: launches are free and charged; no building or claims here.',
					when: 'at-capital'
				}),
				Object.freeze({
					text: 'Own pad: {ownPadId} · {ownPanelId} · {ownBatteryId} · {padCharge}/{padCapacity}.',
					when: 'own-pad-here'
				}),
				Object.freeze({
					text: 'Wait {waitSec} adds +{waitGainKwh} solar charge.',
					when: 'own-pad-charging'
				}),
				Object.freeze({
					text: 'You own no pad on {planetTag} (pads {padCount}/{planetCount}); standing min fee is {minFee}.',
					when: Object.freeze({ all: Object.freeze([
						Object.freeze({ not: 'own-pad-here' }),
						Object.freeze({ not: 'at-capital' })
					]) })
				}),
				Object.freeze({
					text: 'Commercial {commercialPadId}: {commercialBase} + {commercialKwh}/kWh (from {commercialMinFee}, lifts to {commercialLift}).',
					when: Object.freeze({ all: Object.freeze(['commercial-available', Object.freeze({ not: 'own-pad-here' })]) })
				}),
				Object.freeze({
					text: 'Build {nextPadId} on {planetTag}: {nextPadCost} (lifts {shipMass} to {nextPadCap}).',
					when: 'can-offer-build',
					note: Object.freeze({ fact: 'can-build-pad', invert: true })
				}),
				Object.freeze({
					text: 'Next rail {lockedPadId} needs science first.',
					when: 'pad-locked-science'
				}),
				Object.freeze({
					text: 'Seized planet: no building here; commercial fee applies.',
					when: 'pad-blocked-seized'
				}),
				Object.freeze({
					text: 'Claimed by {claimOwnerTag}: no building here; use the standing rail or commercial {commercialPadId}.',
					when: 'pad-blocked-owner'
				}),
				Object.freeze({
					text: 'Guest launches on your rails pay you {taxPerKwh}/kWh × rail tier; fuel purchases pay no owner.',
					when: Object.freeze({ not: 'at-capital' })
				}),
				Object.freeze({
					text: 'Evacuate to HQ {hqTag} for {evacCost}; it takes {evacSeconds}.',
					when: 'can-offer-evac',
					note: Object.freeze({ fact: 'can-evac', invert: true })
				})
			]),
			lookAhead: Object.freeze([
				'commercial-pad',
				Object.freeze(['bribe-build', 'bribe-evac'])
			]),
			ref: Object.freeze(['money']),
			refWhen: 'pad-short',
			chips: Object.freeze(['leave', 'fuel', 'money']),
			actions: Object.freeze(['build-pad', 'wait', 'commercial', 'evac'])
		}),

		money: Object.freeze({
			id: 'money',
			ask: 'no money',
			rank: 10,
			when: 'landed-open',
			steps: Object.freeze(['non-career', 'career-ended', 'at-arrest', 'in-flight', 'at-space']),
			lines: Object.freeze([
				Object.freeze({ text: 'Money can be earned (purse {purse}):' }),
				Object.freeze({
					text: '· flying past planets with a working {obsId}',
					note: Object.freeze({ fact: 'reports-active', invert: true })
				}),
				Object.freeze({
					text: '· taking the rulers’ offer on {planetTag}: +{bribeAmount} (one per visit until you leave {planetTag}; +{bribeRot} rot)',
					when: 'bribe-open'
				}),
				Object.freeze({
					text: '· waiting on {planetTag} for visit value to grow (rulers’ offer is +{bribeAmount} now, one per visit)',
					when: 'bribe-waiting'
				}),
				Object.freeze({
					text: '· rulers’ offer on {planetTag}: already taken this visit (resets after another planet)',
					when: 'bribe-taken'
				}),
				Object.freeze({
					text: '· winning the sport slot on {sportPlanetTag}: land ≥ {sportMinLength} for +{sportReward} ({sportLeft} left)',
					when: 'sport-open'
				}),
				Object.freeze({
					text: '· winning the sport slot',
					when: Object.freeze({ not: 'sport-open' }),
					note: Object.freeze({ text: 'nothing on the board now', when: Object.freeze({ not: 'sport-open' }) })
				}),
				Object.freeze({
					text: '· guest launches on your rails ({taxPerKwh}/kWh × rail tier · pads {padCount}/{planetCount})',
					when: 'own-pad-any'
				}),
				Object.freeze({
					text: '· guest launches on your rails ({taxPerKwh}/kWh × rail tier)',
					when: Object.freeze({ not: 'own-pad-any' }),
					note: Object.freeze({ fact: 'own-pad-any', invert: true })
				}),
				Object.freeze({
					text: '· completing a contract leg ({contractSummary})'
				})
			]),
			lookAhead: Object.freeze([]),
			ref: Object.freeze([]),
			refWhen: null,
			chips: Object.freeze(['bribe', 'pad', 'repair']),
			actions: Object.freeze([])
		}),

		fuel: Object.freeze({
			id: 'fuel',
			ask: 'fuel and tank',
			rank: 12,
			when: 'landed-open',
			steps: Object.freeze(['non-career', 'career-ended', 'at-arrest', 'in-flight', 'at-space']),
			lines: Object.freeze([
				Object.freeze({
					text: 'Tank {fuelGauge} ({engineId} · {tankId} · Δv {shipDv}) · purse {purse}.',
					when: 'fuel-ready'
				}),
				Object.freeze({
					text: 'Tank {fuelGauge} ({engineId} · {tankId}) · purse {purse}. Fit an impulse engine and a fuel tank under ship refit first.',
					when: Object.freeze({ not: 'fuel-ready' })
				}),
				Object.freeze({
					text: 'Rate: {fuelPrice} on any planet ({fuelStep} = {fuelStepCost}), or {fuelKgPerKwh} from own pad charge ({fuelStep} = {fuelStepKwh}).'
				}),
				Object.freeze({
					text: 'Tanks never refill for free, and fuel purchases pay no pad owner.'
				}),
				Object.freeze({
					text: 'Tank is full.',
					when: 'fuel-full'
				}),
				Object.freeze({
					text: 'Own pad converts +{produceKg} ({produceKwh} of {ownFreeKwh} unreserved).',
					when: 'can-produce-fuel'
				}),
				Object.freeze({
					text: 'Own pad conversion',
					when: Object.freeze({ all: Object.freeze(['fuel-need', Object.freeze({ not: 'can-produce-fuel' })]) }),
					note: Object.freeze({ fact: 'can-produce-fuel', invert: true })
				}),
				Object.freeze({
					text: 'Purse buys +{buyKg} for {buyCost}.',
					when: 'can-buy-fuel'
				}),
				Object.freeze({
					text: 'Fuel purchase',
					when: Object.freeze({ all: Object.freeze(['fuel-need', Object.freeze({ not: 'can-buy-fuel' })]) }),
					note: Object.freeze({ fact: 'can-buy-fuel', invert: true })
				})
			]),
			lookAhead: Object.freeze(['charge-fuel']),
			ref: Object.freeze(['money']),
			refWhen: 'fuel-buy-short',
			chips: Object.freeze(['pad', 'money']),
			actions: Object.freeze(['produce-fuel', 'buy-fuel'])
		}),

		bribe: Object.freeze({
			id: 'bribe',
			ask: 'bribe and its rot',
			rank: 14,
			when: 'bribe-topic-open',
			steps: Object.freeze(['non-career', 'career-ended', 'at-arrest', 'in-flight', 'at-space']),
			lines: Object.freeze([
				Object.freeze({
					text: '{planetTag} corruption {corruptionPct} · purse {purse}.',
					when: 'bribe-topic-open'
				}),
				Object.freeze({
					text: 'Rulers pay visit value × {bribeCoef}, one per visit until you land on another planet.',
					when: 'bribe-topic-open'
				}),
				Object.freeze({
					text: 'Current offer: +{bribeAmount} · adds +{bribeRot} rot (to {bribeAfterPct}) and takes back this landing’s report so the world keeps rotting.',
					when: 'bribe-open'
				}),
				Object.freeze({
					text: 'Current offer: +{bribeAmount} · wait while landed for visit value to grow.',
					when: 'bribe-waiting'
				}),
				Object.freeze({
					text: 'Already taken on this visit; opens again after visiting another planet.',
					when: 'bribe-taken'
				}),
				Object.freeze({
					text: 'Rebels hold {planetTag}; rulers make no offer here.',
					when: 'bribe-rebel'
				}),
				Object.freeze({
					text: 'Above {rebelStart} rot, taking a bribe rolls arrest ({bribeArrestPct} at {bribeAfterPct}): {arrestSeconds} Capital transport and rebellion risk.',
					when: 'bribe-topic-open'
				}),
				Object.freeze({
					text: '{planetTag} makes no bribe offers.',
					when: Object.freeze({ not: 'bribe-topic-open' })
				})
			]),
			lookAhead: Object.freeze([]),
			ref: Object.freeze(['money']),
			refWhen: null,
			chips: Object.freeze(['money']),
			actions: Object.freeze(['bribe'])
		}),

		/* 0.7.47 WS3: the live roster cannot be seated fairly */
		'fair-roster': Object.freeze({
			id: 'fair-roster',
			ask: 'unfair roster?',
			rank: 2,
			when: 'roster-unfair',
			steps: Object.freeze(['non-career', 'career-ended']),
			lines: Object.freeze([
				Object.freeze({
					text: 'The {rosterPlanets}-planet map does not meet the fair-start composition for {rosterPlayers} companies.',
					when: 'roster-unfair'
				}),
				Object.freeze({
					text: '\n{rosterDetails}',
					when: null
				}),
				Object.freeze({
					text: 'The {rosterPlanets}-planet map now meets the composition requirements for {rosterPlayers} companies. This is not a guarantee of balanced openings.',
					when: { not: 'roster-unfair' }
				}),
				Object.freeze({
					text: '\nStarter-accessible: another planet is reachable with at most three quarters of the starter rail, one needed per company.\nHeavy: no planet is reachable from the starter rail; only a stronger EMC rail leaves with that margin.\nAdding a planet or removing a company does not reseat existing HQs; a new game reruns the opening search unless it uses a saved opening. Neither guarantees fairness.',
					when: null
				})
			]),
			lookAhead: Object.freeze([]),
			ref: Object.freeze([]),
			refWhen: null,
			chips: Object.freeze([]),
			actions: Object.freeze(['fair-less-players', 'fair-more-planets'])
		}),

		/* 0.7.47 WS4: the background seat search is still running */
		'fair-search': Object.freeze({
			id: 'fair-search',
			ask: 'fair opening search?',
			rank: 1,
			when: 'search-active',
			steps: Object.freeze(['non-career']),
			lines: Object.freeze([
				Object.freeze({ text: 'Preparing the map for {rosterPlayers} companies on {rosterPlanets} planets.', when: 'search-active' }),
				Object.freeze({ text: 'Search pass {searchPass}: approximately {searchProgress} complete. The game starts when a fair opening is found.', when: 'search-running' }),
				Object.freeze({ text: 'Best candidate so far: estimated first-landing rewards {searchPay}; the weakest is {searchWeakest} of the strongest.', when: 'search-best' }),
				Object.freeze({ text: 'Still missing: {searchUnmet}.', when: 'search-unmet' }),
				Object.freeze({ text: 'You can start with the best completed pass. The live candidate above may be newer.', when: 'search-has-plan' }),
				Object.freeze({ text: 'Search finished without a fair opening. Start anyway or load a saved map.', when: 'search-exhausted' }),
				Object.freeze({ text: 'You can also load a saved map.', when: 'search-active' })
			]),
			lookAhead: Object.freeze([]),
			ref: Object.freeze([]),
			refWhen: null,
			chips: Object.freeze([]),
			actions: Object.freeze(['fair-play-as-is', 'fair-load-saves'])
		})
	});

	Object.assign(CommsCopy, {
		H_ACTIONS, H_STEPS, H_LOOKAHEAD, H_TOPICS
	});
	Object.assign(inner, {
		H_ACTIONS, H_STEPS, H_LOOKAHEAD, H_TOPICS
	});
});

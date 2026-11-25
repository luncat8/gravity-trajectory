/*
 * Anchor maps for archive/0.7.53-split-tool.js. A part owns its blocks (first..last top-level
 * declaration, inclusive) and its named singles; core blocks lose to part blocks, blocks lose to
 * names. Bot methods are written `.name`. 'END' is the last movable statement.
 */
'use strict';

const CORE_HEADER_BOT = `/*
 * Deterministic rival competitors (0.3.3).
 *
 * Rivals fly in the same seeded system on the exact integer step clock and
 * harvest from the shared planet-profit market (\`GravityGame.stepHarvest\`), so
 * planets drained by a rival drop to +0.00 on the canvas and push the player
 * toward long-unvisited systems. Candidate search runs as a sliced background
 * job with zero per-candidate allocations, and drains synchronously when a
 * step boundary requires an immediate launch or replay skip.
 *
 * Career uses the separate synchronous controller in the bot_career_*.js parts:
 * it plans from the occupied catapult, values tasks and landing pads net of
 * energy recharge waits, and performs reserve-aware shopping between real
 * headless flights.
 *
 * This core holds the tuning constants more than one part reads, the rival
 * record, the constructor (the field inventory) and PARTS, the load order and
 * table of contents. Parts add GravityBot.prototype methods (shared through
 * \`this\`); constants and free helpers cross files on each part's
 * \`const { … } = inner;\` line. experiments/parts_test.js checks the wiring.
 */`;

module.exports = {
	BASE_REV: 'f786dc4',

	game: {
		core: 'gravity_game.js',
		ns: 'GravityGame',
		nsParam: true,
		publicObject: true,
		freeze: false,
		coreHeader: `/*
 * Game-mode rules shared by the page, rival bots and the node benches: the aim
 * grid, per-rule caps, replay link codec, the shared per-planet growing
 * visit-profit market, and the career rule (catapult network, pad energy,
 * contract board, evacuation, cheats).
 *
 * This core holds the rule vocabulary every part reads — the rule table,
 * mode/bot/player/cheat enums, purse presets, experiment bounds, the replay
 * link codec, the CAREER table, task/leg/owner enums, pad/task records and
 * price — plus PARTS, the load order and table of contents. Each part takes
 * names from the core and earlier parts on its \`const { … } = inner;\` line,
 * publishes its public keys onto GravityGame and its shared names onto inner,
 * and reaches a later part as \`inner.name(…)\` at call time.
 * experiments/parts_test.js checks the wiring.
 */`,
		accessors: {
			harvestMode: 'harvestModeOf',
			spaceWearScale: 'spaceWearScaleOf',
			padScale: 'padScaleOf',
			rotScale: 'rotScaleOf',
			payScale: 'payScaleOf',
			politics: 'politicsOn',
			specialPlanets: 'specialPlanetsOn'
		},
		coreBlocks: [['FORMAT', 'DEEP_BONUS'], ['CAREER', 'clearTask'], ['compareScores', 'END']],
		coreNames: ['price', 'canPay', 'draw01', 'round2', 'pay'],
		/* single-reader names that stay: the pad energy pair is one API (the bot reserves, the flight releases) */
		keep: ['releaseEnergy'],
		parts: [
			{
				file: 'game_ship.js', comment: 'ship wear, repair, fuel, evacuation fare, balance knobs',
				blocks: [['WEAR_SPACE', 'WORN_OUT_BLOCK'], ['careerShipUsable', 'buyFuel'], ['evacTarget', 'evacuationSeconds']],
				names: ['FUEL_KG_PER_KWH', 'FUEL_PRICE'],
				header: ['Ship condition and upkeep: the wear law and its forecasts, repair, fuel',
					'production and purchase, the evacuation fare, and the four balance knobs.',
					'not here: wear on landing settlement → game_flight.js; evacuation ride → game_flight.js']
			},
			{
				file: 'game_market.js', comment: 'visit-profit market, ledger, harvest, universe mask',
				blocks: [['createMarket', 'planetInPlay']],
				names: ['initSteps', 'HARVEST_ENTRY', 'HARVEST_TICK', 'harvestMode', 'colonyInPlay'],
				header: ['Visit-profit market: per-planet growing profit, the flight ledger, harvest',
					'and stay-pay, predicted harvest, the universe mask.',
					'not here: landing settlement → game_flight.js; contract payouts → game_contracts.js']
			},
			{
				file: 'game_book.js', comment: 'launch book: saved trajectories and their visit logs',
				blocks: [['launchBookTag', 'recordLaunch']],
				names: ['BOOK_MAX'],
				header: ['Launch book: field tags, visit masks, record and prune of saved trajectories.',
					'not here: the bot\'s book lookups → bot_career_plan.js']
			},
			{
				file: 'game_network.js', comment: 'galaxy, EMC pads and turrets, fees, launch gates',
				blocks: [['createGalaxy', 'syncCareerNetwork'], ['commercialFee', 'returnLandingVisit']],
				names: ['WORN_OUT_BLOCK', 'STATS_SEC', 'STATS_EVERY', 'SALT_TURRET', 'SALT_RIVAL', 'TAU', 'COMMERCIAL_BASE', 'COMMERCIAL_KWH'],
				header: ['Catapult network: the galaxy, turrets, pads and their owners, claims,',
					'commercial and guest fees, exit cost, rail text, and launch reasons.',
					'not here: building and fitting pads → game_build.js; seizure → game_politics.js']
			},
			{
				file: 'game_opening.js', comment: 'seat solver 1/5: opening fans and exit margin',
				blocks: [['HQ_GRAVITY_MAX', 'openingTracks']],
				names: ['planetInMask', 'hqMask'],
				header: ['Seat solver 1/5: single-home opening fans, the exit-speed margin, opening',
					'rows and tracks, and the fan budget counter.',
					'not here: set statistics → game_seat_stats.js']
			},
			{
				file: 'game_seat_stats.js', comment: 'seat solver 2/5: set stats and seat matching',
				blocks: [['openingStatsFromTracks', 'startCandidatePools']],
				names: ['OPENING_RATIO_FLOOR'],
				header: ['Seat solver 2/5: exact, resumable opening-set statistics, set comparison,',
					'and the bipartite seat matching.',
					'not here: ranking proposals → game_seat_rank.js']
			},
			{
				file: 'game_seat_rank.js', comment: 'seat solver 3/5: set ranking, laws, composition',
				blocks: [['OPENING_FAMILY_DEPTH', 'openingRiskOrder']],
				names: [],
				header: ['Seat solver 3/5: proposal orders, cold and pair-track ranking, the search',
					'laws, the pair-track cache, and the map composition rule.',
					'not here: the walk over one law → game_seat_walk.js']
			},
			{
				file: 'game_seat_walk.js', comment: 'seat solver 4/5: the resumable single-law walk',
				blocks: [['createHomeWalk', 'createHomeWalk']],
				names: [],
				header: ['Seat solver 4/5: createHomeWalk, the resumable walk over one search law.',
					'not here: tiers, caching and the public search → game_seat_search.js']
			},
			{
				file: 'game_seat_search.js', comment: 'seat solver 5/5: seat plans, tiered search, HQ pick',
				blocks: [['planHomeSet', 'pickHq']],
				names: ['OPENING_EXACT_BATCH', 'OPENING_EXACT_SETS', 'OPENING_EXACT_MISS', 'OPENING_LAW_FLOOR', 'OPENING_LAW_WIDE', 'OPENING_LAW_TIER1', 'OPENING_LAW_TIER2'],
				header: ['Seat solver 5/5: the seat-plan cache, prepareCareerStarts, the sliced',
					'createSeatSearch, expansion HQs, and pickHq.',
					'not here: placing a company on its seat → game_career.js']
			},
			{
				file: 'game_sport.js', comment: 'the shared sport race',
				blocks: [['sportStateOf', 'sportHoldStep']],
				names: ['ANNOUNCE_SEC', 'settleSport'],
				header: ['The shared sport race: its state, announce, close, expire, hold steps,',
					'and settlement.',
					'not here: the board slot it occupies → game_contracts.js']
			},
			{
				file: 'game_contracts.js', comment: 'deliveries, medics, task board, accept, payouts',
				blocks: [['otherActivePlanet', 'makeDelivery'], ['medicAffordable', 'careerLandingFacts']],
				names: ['FRAGILE_G', 'FRAGILE_TONS', 'FRAGILE_PAY', 'FRAGILE_CHANCE', 'DEEP_G', 'DEEP_TONS', 'DEEP_BONUS', 'CARGO_TONS', 'COMPETE_ENTRY', 'LEG_COMPETE', 'TOURIST_CHANCE', 'planetDistance'],
				header: ['Contracts: standard, deep, fragile and tourist deliveries, medics and',
					'Capital escrow, the task board, accept/drop/finish, payouts, landing facts.',
					'not here: the sport race → game_sport.js; departure solvency → game_departure.js']
			},
			{
				file: 'game_politics.js', comment: 'rot, bribes, arrest, rebellion',
				blocks: [['politics', 'politicsOn'], ['raiseCorruption', 'pacifyPlanet']],
				names: ['QUIET_MIN', 'SALT_POLITICS', 'SALT_ARREST'],
				header: ['Politics: corruption and the rot clock, rebellion and seizure, arrest,',
					'bribes, going quiet, and pacify.',
					'not here: OBS gear refusals at build time → game_build.js']
			},
			{
				file: 'game_build.js', comment: 'pad fit, building, parts, radar',
				blocks: [['RADAR_COST', 'radarShips'], ['gearKnown', 'installPart']],
				names: ['fitPad', 'ownPart'],
				header: ['Building: pad fit, known gear, buildGear and bulk upgrades, parts, and',
					'the HQ radar.',
					'not here: research and prototypes → game_science.js']
			},
			{
				file: 'game_science.js', comment: 'research hull, prototypes, start gifts',
				blocks: [['SCIENCE_FAMILIES', 'researchPoint'], ['GIFT', 'giftText']],
				names: ['SALT_GIFT'],
				header: ['Science: the research hull, prototypes, and the start-gift budget and',
					'draws (gifts grant prototypes and science points).',
					'not here: when gifts are granted → game_career.js']
			},
			{
				file: 'game_departure.js', comment: 'leg probe, arrival mass/charge, departure solvency',
				blocks: [['LEG_EXIT_ANGLES', 'legDepScratch2'], ['createLegPlan', 'careerDeparture']],
				names: [],
				header: ['Can a company leave where it lands: the shared leg probe, exit speed per',
					'field, arrival mass and charge, refund escrow, and careerDeparture, the',
					'solvency check every planner and the board share.',
					'not here: two-leg quest planning → game_legs.js']
			},
			{
				file: 'game_legs.js', comment: 'two-leg quests: impact ways, pair slots, careerLegPlan',
				blocks: [['makeLegTraceSlot', 'legPairHand'], ['storeLegWay', 'careerLegPlan']],
				names: ['speedUnits', 'LEG_PAIR_SLOTS', 'LEG_PAIR_WAYS', 'LEG_SCAN_ALL_SPEEDS', 'LEG_SCAN_CIRCLE_SPEEDS', 'LEG_SCAN_CIRCLE_ANGLES', 'LEG_SCAN_FAN_HALF', 'LEG_SCAN_FAN_STEP', 'LEG_SCAN_FINE_HALF', 'LEG_SCAN_FINE_STEP', 'LEG_SCAN_FINE_SPEEDS', 'leg1VisitScratch', 'legFactsScratch', 'legDepScratch2'],
				header: ['Two-leg quests: impact ways, pair slots, hasFeasibleLeg and careerLegPlan.',
					'not here: departure solvency → game_departure.js']
			},
			{
				file: 'game_career.js', comment: 'create/reset/start a company, placement, stats, end',
				blocks: [['careerStats', 'sampleStats'], ['fitEndgame', 'liquidateCareer']],
				names: ['createTask', 'createPad', 'START_PLANET', 'START_SPACE', 'START_CAPITAL', 'SPACE_START_FUEL_KG', 'SPACE_START_BONUS', 'CAPITAL_START_BONUS', 'SPACE_START_OFFSET_PX', 'CAREER_BROKE', 'CAREER_COMPLETE', 'fillLight', 'joinGalaxy', 'createCareer', 'resetCareer', 'topTier'],
				header: ['A company\'s life: create, reset and start (planet, space and Capital',
					'starts), join the galaxy, placement, map statistics, the endgame cheat,',
					'checkEnded and liquidation.',
					'not here: the career tables and enums → gravity_game.js']
			},
			{
				file: 'game_flight.js', comment: 'flights, landing settlement, evacuation ride',
				blocks: [['settleLanding', 'careerEndFlight']],
				names: ['ENDGAME_LIMIT_STEPS', 'evacuate', 'advanceEvacuation'],
				header: ['Career flights: begin, burn, advance and end, landing settlement, and the',
					'evacuation ride.',
					'not here: the evacuation fare → game_ship.js']
			}
		]
	},

	bot: {
		core: 'gravity_bot.js',
		ns: 'GravityBot',
		nsParam: true,
		publicObject: false,
		freeze: false,
		coreHeader: CORE_HEADER_BOT,
		accessors: {},
		coreBlocks: [['PLANETS', 'GravityBot']],
		coreNames: ['careerAimList'],
		parts: [
			{
				file: 'bot_setup.js', comment: 'world/sim binding, scales, masks, reset, levels, roster',
				blocks: [['.ensureRivals', '.planValid']],
				names: ['LEVELS'],
				header: ['Bot setup: the skill levels, world and sim binding, scales, planet masks,',
					'specs, reset, level and roster changes, plan validity.',
					'not here: the career roster → bot_career_loop.js']
			},
			{
				file: 'bot_trace.js', comment: 'decision log, status lines, refusal reasons, career trace',
				blocks: [['worldClock', '.decisionLog'], ['.careerNoPlanWhy', '.actorStatus'], ['.traceCareerPlan', '.traceCareerLanding']],
				names: ['TRACE_MAX', '.traceCareerBurn', 'careerStartTraceText'],
				header: ['What the bots say: the decision log, status lines, refusal reasons, career',
					'trace lines, and the shared text helpers.',
					'not here: the decisions themselves → the bot_career_*.js parts']
			},
			{
				file: 'bot_route.js', comment: 'the route prefix planner',
				blocks: [['.routeActorActive', '.seedPlayerRoutePlan']],
				names: ['ROUTE_REFINE_3', 'ROUTE_REFINE_2', 'ROUTE_REFINE_1', 'ROUTE_SLICE_CANDIDATES', 'ROUTE_PHI', 'ROUTE_REFINES', 'ROUTE_COARSE_START', 'ROUTE_STAGE_COUNT', 'ROUTE_SPEEDS'],
				header: ['The route rule\'s planner: one staged prefix search shared by every level,',
					'sliced per frame, plus the player\'s seeded route plan.',
					'not here: tour and money rivals → bot_rivals.js']
			},
			{
				file: 'bot_rivals.js', comment: 'tour/money candidate job, lookahead, stepping, summaries',
				blocks: [['.scoreProbe', '.rivalLink']],
				names: ['LOOKAHEAD_WEIGHT', 'LOOKAHEAD_HORIZON', 'LOOKAHEAD_SPEED', 'SLICE_CANDIDATES'],
				header: ['Tour and money rivals: the sliced candidate job, lookahead, launch and',
					'stepping, settle, summaries and rival links.',
					'not here: the route rule → bot_route.js; career rivals → bot_career_*.js']
			},
			{
				file: 'bot_career_assets.js', comment: 'career: exit probe, reach, research, site values',
				blocks: [['RESEARCH_BRIDGE_RAIL', '.careerNextPad']],
				names: ['CAREER_SITE_BONUS', 'CAREER_GRAVITY_COST', 'CAREER_STEEP_PAD_VALUE', 'CAREER_NETWORK_PAD_VALUE', 'CAREER_EXIT_SPEED_FRACTIONS', 'CAREER_EXIT_ANGLES'],
				header: ['Career assets: the exit probe and reach, gear and research choice, site and',
					'pad values, the next pad to claim.',
					'not here: buying and upgrading → bot_career_shop.js']
			},
			{
				file: 'bot_career_shop.js', comment: 'career: contracts, upgrades, repair, recovery, bribes',
				blocks: [['careerNetReward', '.careerShouldWait']],
				names: ['CAREER_REPAIR_AT', 'CAREER_LOADED_SPEED', 'CAREER_HOLD_PADS', 'CAREER_BRIBE_PRONE', 'CAREER_ACCEPT_HOLD', 'CAREER_PAD_HORIZON'],
				header: ['Career shopping between flights: contract and medic valuation and accept,',
					'upgrades, pad gear, repair, holds, recovery and evacuation, bribes.',
					'not here: fuel for a burn → bot_career_burn.js']
			},
			{
				file: 'bot_career_score.js', comment: 'career: shot score facts, radar, flight scoring',
				blocks: [['.careerEnergyWait', '.careerScoreStored']],
				names: ['CAREER_CONTESTED_COST', 'CAREER_FOREIGN_PAD_VALUE', 'CAREER_BUILT_PAD_VALUE', 'CAREER_WAIT_SECONDS'],
				header: ['Career shot scoring: score facts, radar heat and avoidance, contested pads,',
					'flight scoring and stored scores.',
					'not here: searching for the shot → bot_career_plan.js']
			},
			{
				file: 'bot_career_plan.js', comment: 'career: target, book lookup, fan and refine, careerPlan',
				blocks: [['.careerTarget', '.careerScanReset'], ['careerAimList', '.careerRefineFan'], ['.careerPlan', '.careerPlan']],
				names: ['CAREER_BOOK_MIN_NET', 'CAREER_BOOK_EXPLORE_EVERY', 'CAREER_BOOK_ENOUGH', 'CAREER_TARGET_STEP', 'CAREER_TARGET_OFFSETS', 'CAREER_SPEED_FRACTIONS', 'CAREER_REFINE_OFFSETS', 'CAREER_REFINE_HORIZON', 'CAREER_HORIZON', 'CAREER_FALLBACK_SCALE', 'CAREER_ANGLES'],
				header: ['Career shot search: target and launch-book lookup, the coarse fan and its',
					'refinement, and careerPlan.',
					'not here: impulse burns → bot_career_burn.js; scoring → bot_career_score.js']
			},
			{
				file: 'bot_career_burn.js', comment: 'career: every impulse burn, fuel, rescue',
				blocks: [['.careerBurnFacts', '.careerFlightBurn'], ['.careerBindBurnSim', '.careerRescueBurn']],
				names: ['CAREER_RESCUE_SPEED_FRACTION', 'CAREER_BURNS_MAX', 'CAREER_BURN_TAIL', 'CAREER_BURN_EVERY', '.careerBurnTopReset', '.careerBurnOffer'],
				header: ['Career impulse decisions: burn facts, score and plan, the in-flight burn,',
					'the space-start opening burn, burn launch pricing, fuel offer/commit/top-up,',
					'and the rescue burn.',
					'not here: the shot without a burn → bot_career_plan.js']
			},
			{
				file: 'bot_career_loop.js', comment: 'career: start, roster, stepCareer, player seat',
				blocks: [['.startCareers', '.careerDropQueue']],
				names: ['BOARD_TICK_STEPS', 'CAREER_RIVAL_PHASE'],
				header: ['The career loop: start careers, roster changes, stepCareer, and the',
					'player-seat autopilot.',
					'not here: choosing and firing a shot → bot_career_shot.js']
			},
			{
				file: 'bot_career_shot.js', comment: 'career: race entry, next shot, recharge, sit, launch, land',
				blocks: [['.careerReadyShot', '.careerSit'], ['.careerLaunch', '.careerReady']],
				names: ['CAREER_SIT_GAP', 'CAREER_RECHARGE_TRIES', 'CAREER_STUCK_TRIES'],
				header: ['Career shot execution: race entry, the next shot, recharge and sit, stuck',
					'handling, turret launch, and landing.',
					'not here: planning the shot → bot_career_plan.js']
			}
		]
	},

	comms: {
		core: 'comms_copy.js',
		ns: 'CommsCopy',
		nsParam: true,
		publicObject: true,
		freeze: true,
		coreHeader: `/*
 * H's pure facts, slots, topics, one-step arithmetic and copy validator.
 *
 * Reads live state and rule parameters from GravityGame, OrbitTech, OrbitEcon
 * and GravitySim into one frozen snapshot per check. No DOM, no random draws,
 * no state mutation, and no literal numbers or item ids in authored copy.
 *
 * This core holds the units, caps, launch-gate order and formatters every part
 * reads, plus PARTS, the load order; CommsCopy is frozen once the last part has
 * attached. experiments/parts_test.js checks the wiring.
 */`,
		accessors: {},
		coreBlocks: [['EPS', 'ownerLabel']],
		coreNames: [],
		/* the core is the units/caps/formatter vocabulary and the topic tables are their part's
		 * subject, so rule 2 does not apply to them */
		keep: ['CENT', 'H_META_ID', 'H_META_ASK', 'CHIP_CAP', 'RETURN_LANDINGS_FOR_TOW', 'LAUNCH_GATE_ORDER',
			'cost', 'tenths', 'trimmed', 'whole', 'planetLabel', 'ownerLabel',
			'H_ACTIONS', 'H_STEPS', 'H_LOOKAHEAD', 'H_TOPICS'],
		parts: [
			{
				file: 'comms_facts.js', comment: 'live snapshot, reasons, predicates, HH_FACTS, H_SLOTS',
				blocks: [['compositionRows', 'H_SLOTS']],
				names: [],
				header: ['H\'s facts: the composition checklist, reason lookup, board summary, the',
					'frozen snapshot (buildSnapshot), predicates, and the HH_FACTS and H_SLOTS',
					'registries — together because a new live fact touches all three.',
					'not here: authored topic copy → comms_topics.js']
			},
			{
				file: 'comms_topics.js', comment: 'authored copy: actions, steps, look-ahead, topics',
				blocks: [['H_ACTIONS', 'H_TOPICS']],
				names: [],
				header: ['H\'s authored copy: H_ACTIONS, H_STEPS, H_LOOKAHEAD and H_TOPICS. Data only.',
					'not here: evaluating and rendering it → comms_render.js']
			},
			{
				file: 'comms_render.js', comment: 'evalWhen, slot fill, topic render, copy linter',
				blocks: [['evalWhen', 'validateCopy']],
				names: [],
				header: ['H\'s engine: evalWhen, slot fill, line render, topic choice, chips,',
					'renderTopic, and the validateCopy linter.',
					'not here: the facts it reads → comms_facts.js']
			}
		]
	}
};

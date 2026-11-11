# 3 · politics and quests

Rot, bribes, arrest, rebellion, the commission that reports back to the Capital,
and the contract board around all of it. Text from `archive/draft.txt`; the
built spec is `archive/0.5.12-plan-corruption-rebellion.md`.

## 3.1 Corruption (numbers are subject to balance) ← `archive/draft.txt`

Corruption (disobedience to central laws) reduces population growth.

Corruption rises if emissaries don’t visit for a long time (balance, decide how quickly). It decreases by 0.2 per visit.

Corruption also rises when accepting bribes. Suggested formula: `1 + 0.1 × amount of money`. Bribes can be accepted while on a planet (except the Capital and A.R.F.) for twice the flyby fee. You can’t accept multiple bribes on the same planet, so its rulers don’t complain about unfairness.

→ `CORRUPTION_VISIT_DECAY 0.2`, `CORRUPTION_GRACE 120 s`, rise `0.1/s`,
growth `× (1 − C/100)`, bribe `1 + 0.1 · money`, one bribe per visit, Capital
and A.R.F. exempt.

→ the note's «twice» is met at rot `50`: `bribeValue = visit value × rot/100 × 4`,
so a half-rotten lord pays twice and a fully rotten one four times — right where
the arrest roll is at its worst (`BRIBE_VALUE_COEF = 4`, with the same sentence
in `orbit_econ.js`). §3.2 is the note that replaced the flat «twice».

**Strategy:** Take a bribe before an opponent flies by. It’s better not to accept a very small bribe. If it’s your own EMC, it’s probably better to refuse. If it’s someone else’s, decide based on the bot’s personality.

→ shipped clause by clause (`careerBribe`): a rival never takes a bribe on its
own rail; it leaves one under `BRIBE_MIN = 1`; it takes one under
`CAREER_BRIBE_PAY = 2` only where the rot is already `CAREER_BRIBE_ROT = 25` or
another company's launch is queued on that planet; and «the bot’s personality»
is one seeded yes/no per rival (`CAREER_BRIBE_PRONE = 0.5`: half of them never
take one). **open** → `../0.6.6-plan-rival-characters.md` makes that yes/no part
of a named character (`rivals-competitions.md` §5.1).

When corruption is above 50%, accepting a bribe carries a chance of arrest up to 50% at 100% of corruption. arrested player is sent to the Capital for re-education via slow transport, costing time.

→ `ARREST_SECONDS 120`, the roll is `0` at `C ≤ 50` and `0.5` at `C = 100`.

High corruption increases the chance of rebellion. Infrastructure is permanently seized, and EMCs and other assets switch to commercial status (same usage fee; upgrades are retained).

→ a rebellion seizes every rail on the planet into one commercial pad, tiers and
charge kept, no building afterwards.

Suggested rebellion chance: `1 / (20 − Corruption) − 0.5`, with zero chance below 10. Need to consider a formula that increases asymptotically without dividing by zero. maybe like this
P(rebellion)=0.25(1−e −0.0322max(0,C−50) ), C is corruption from 0 to 100

→ the second formula shipped verbatim (`REBEL_K 0.0322`, `REBEL_CAP 0.25`), one
deterministic roll per planet per `60 s` epoch, zero at `C ≤ 50`. The
`1 / (20 − C)` version is kept here only as the reason the asymptotic one exists.

A rebellious planet’s flyby fee increases 4x slowly.

→ the payout ramps to `4×` over `FLYBY_RAMP_SECONDS 240`.

When there are rebellious planets, a mission becomes available: load medics at the Capital, land on a rebellious planet, pick up patients automatically (same numbers as medics, technically half of the cargo hold), and deliver them to the Capital. Once the number of patients reaches zero (typically after 1–2 trips with a standard cargo hold), the planet loses its rebellious status. medics unloaded automatically when quest finished by any reason.

→ `TASK_MEDIC`, `MEDIC_PATIENTS 8`, `MEDIC_REWARD_PER_PATIENT 1`, pacified at the
last patient. A player can fly it.

**open** → `../0.5.23-plan-medic-capital.md`: a rival takes it once in 24 games.
Every rival now carries a hold, so the offer stands 29 % of the time, but it is
the only contract that must be accepted *on a particular planet* — the Capital —
and a rival stands there 2.7 % of the time, by accident. Naming the Capital as a
goal was measured and changes nothing (`archive/0.5.22-worklog.md` §4): the
reward is two legs away and belongs to no shot's score.

## 3.2 bribe ← `archive/draft.txt`

what is current bribe profit?
i think it should be limited by visit profit * corruption * some coefficient
visit profit is main. i mean if planet already visited and visit profit currently low this mean all info reported to Capital - then there is no interest of the planet lord to pay bribe to Emissary as Emperor already know all what he want.
but because we have automatic earn money at visit then this mean bribe is useful in case of player sit on the planet long time for example no other profitable tasks and so he can got money without fly to space

→ that is the shipped formula and the reason for it: `bribeAmount` reads the visit
value (landing payout plus what regrew since) times the rot fraction times `4`,
so a long sit on a rotten world is a parking income.

## 3.3 bribe button ← `archive/draft.txt`

it should be visible while ship landed until take bribe, then show again after visit ANOTHER planet

→ the pad block carries it from touchdown until this visit has paid one; one
landing elsewhere reopens it.

## 3.4 observation device ← `archive/draft.txt`

choose good name for device that get money for visits (decrease corruption, by story: send info to capital).
possibility to uninstall this device on a planet with high corruption level (maybe >75%). after this more easy to take bribe because bribe proportional to visit profit that will not automatically cleared without observation device.

add short help drawer on hover bribe button to explain how work bribe, corruption, observation device

→ not built (no `observation` in the code). This is the missing hinge between
§3.1 and §3.2: a device that (a) is what makes a visit report to the Capital —
i.e. what pays the visit value and decays the rot — and (b) can be given up on a
rotten planet, at which point visits stop clearing the payout and bribes become
the way to cash it. It gives the corruption numbers a reason to be a *choice*
rather than a weather report.

**open** → `../0.6.1-plan-observation-device.md`. How it answers the three
questions the note leaves:

1. **Ship part or pad device?** A ship part (`OBS-1`, `0.4 t`, in the refit
   list), plus one flag per planet: giving the device up on a world above `75 %`
   marks *that planet* quiet for every company until its rot is quelled.
2. **Does a quiet visit still pay?** No: it pays nothing and clears nothing —
   the note's «will not automatically cleared» — so the visit value keeps growing
   and the bribe, which is proportional to it, grows with it.
3. **Is `>75%` reachable?** Rot falls by `0.2` a visit and rises by `0.1` per
   world second once a planet has gone `120 s` unvisited, so 75 is `870` world
   seconds of neglect — fourteen and a half minutes at `×1`, sooner with bribes
   (each adds `1 + 0.1 × amount`): the intended «rotten world». Kept.

The help drawer on the bribe button is in the same plan (its GUI section).
**One reading to confirm before building**: «uninstall this device on a planet»
is taken as *the ship's device, removed while standing on that planet*, not as a
device that each planet owns.

## 3.5 helpers for quests ← `archive/draft.txt`

- auto-aim-helpers should count taken quests as profit
- add helper that is specialized on quest solving.

→ `quest scan` in the flight HUD: the same landing gate and the same 34 aims,
ranked by cash plus `10 ×` the leg credit, half of the aims pointed at the open
work (`careerGoalBodies`). The "count taken quests as profit" half is the leg
credit in `careerLandingFacts`.

**open** → `../0.6.5-plan-two-leg-quests.md`: a *specialised* quest helper is
more than a re-ranked money scan when a contract has two legs. `quest scan` aims
at the next body; it does not plan `load → fly → deliver` or price the second
leg. The plan prices the second leg once, in the rules layer, so the helper and
the rival both read it.

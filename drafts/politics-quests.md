# 3 · politics and quests

Rot, bribes, arrest, rebellion, the commission that reports back to the Capital,
and the contract board around all of it. Text from `archive/draft.txt`; the
`0.5.12` plan is the built spec.

## 3.1 corruption ← `archive/draft.txt`

Corruption (disobedience to central laws) reduces population growth.

Corruption rises if emissaries don’t visit for a long time (balance, decide how quickly). It decreases by 0.2 per visit.

Corruption also rises when accepting bribes. Suggested formula: `1 + 0.1 × amount of money`. Bribes can be accepted while on a planet (except the Capital and A.R.F.) for twice the flyby fee. You can’t accept multiple bribes on the same planet, so its rulers don’t complain about unfairness.

→ `CORRUPTION_VISIT_DECAY 0.2`, `CORRUPTION_GRACE 120 s`, rise `0.1/s`,
growth `× (1 − C/100)`, bribe `1 + 0.1 · money`, one bribe per visit, Capital
and A.R.F. exempt.

→ the note's «twice» is met at rot `50`: `bribeValue = visit value × rot/100 × 4`,
so a half-rotten lord pays twice and a fully rotten one four times — right where
the arrest roll is at its worst (`BRIBE_VALUE_COEF = 4`, with the same sentence
in `orbit_econ.js`). No drift; nothing to decide.

Strategy: Take a bribe before an opponent flies by. It’s better not to accept a very small bribe. If it’s your own EMC, it’s probably better to refuse. If it’s someone else’s, decide based on the bot’s personality.

→ `CAREER_BRIBE_PRONE = 0.5`, `BRIBE_MIN = 1`, `CAREER_BRIBE_PAY`,
`CAREER_BRIBE_ROT`; see §5.1 for the character work this sentence asks for.

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

→ `TASK_MEDIC`, `MEDIC_PATIENTS 8`, `MEDIC_REWARD_PER_PATIENT 0.5`, pacified at
the last patient. **open**: measured dead in the 0.5.16/0.5.21 benches — no rival
ever accepts a medical mission, because no rival stands on the Capital with a
free contract slot. The hold fix alone does not revive it
(`0.5.16-plan-rival-first-shop.md`, "the medical quest is still dead").

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

**open** — not built (no `observation` in the code). This is the missing hinge
between §3.1 and §3.2: a fitted device that (a) is what makes a visit report to
the Capital — i.e. what pays the visit value and decays the rot — and (b) can be
pulled off a rotten planet, at which point visits stop clearing the payout and
bribes become the way to cash it. It gives the corruption numbers a reason to be
a *choice* rather than a weather report.

Questions a plan must answer first, in this order:

1. Is it a part in the same list as `hold`/`engine`/`tank` (mass, a refit slot),
   or a pad-side device (a fourth gear kind)? A part makes it a per-ship choice;
   a gear makes it a per-planet one.
2. Does removing it stop the payout, or only stop the rot decay? The note says
   the bribe becomes easier, not that visits stop paying — so the smallest build
   is: visit value still collects, rot decay and the Capital's record stop.
3. A `>75%` threshold on a `0…100` value that only ever moves by `0.2` a visit
   and `0.1/s` away from a visit: it will be reachable only after ~6 minutes of
   neglect, which is the intended "rotten world" state. Keep it.

## 3.5 helpers for quests ← `archive/draft.txt`

- auto-aim-helpers should count taken quests as profit
- add helper that is specialized on quest solving.

→ `quest scan` in the flight HUD: the same landing gate and the same 34 aims,
ranked by cash plus `10 ×` the leg credit, half of the aims pointed at the open
work (`careerGoalBodies`). The "count taken quests as profit" half is the leg
credit in `careerLandingFacts`.

**open**: a *specialised* quest helper is more than a re-ranked money scan when a
contract has two legs. `quest scan` aims at the next body; it does not plan
`load → fly → deliver` as one shot or price the second leg. Decide whether that
belongs in the helper (a two-shot lookahead) or in the rival only (§5.1).

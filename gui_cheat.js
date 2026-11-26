/*
 * Cheat panel: the +10 credit button, communism (every price free) and the
 * test-mode stock-upgrade install, docked under the flight HUD.
 *
 * The two checkboxes map onto the two career cheats the seed url already knows:
 * communism prices everything 0 through the existing `career.cheat` wrappers
 * (builds, parts, research, fuel, fees — the "all free" approach, not an
 * unlimited purse, so the ledger identity and every price readout stay honest),
 * and test mode applies the endgame fit to the live career. A career record
 * holds one cheat value, so communism wins the slot and the test fit
 * re-applies itself on top whenever its box is checked.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

/* ── cheat panel ── refs, credit button, the two career cheats */

const CHEAT_CR = 10;

const cheatPanelEl = $('cheatPanel');
const cheatCrBtn = $('cheatCr');
const cheatCommunismEl = $('cheatCommunism');
const cheatTestEl = $('cheatTest');

/* the cheat value the boxes describe: communism, else the endgame flag that
 * keeps an upgrade-installed career from completing, else none */
function cheatPanelCheat() {
	return cheatCommunismEl.checked ? GravityGame.CHEAT_COMMUNISM :
		cheatTestEl.checked ? GravityGame.CHEAT_ENDGAME : null;
}

/* push the panel's intent onto YOU's career and the session: the flag applies
 * at once, the test fit also lands on a career whose reset ran without it */
function cheatPanelApply() {
	const cheat = cheatPanelCheat();
	game.career.cheat = cheat;
	game.cheat = cheat;
	if (cheatTestEl.checked) GravityGame.installStockUpgrades(game.career);
}

/* adopt a cheat the run was started with (seed url, saved map, replay link)
 * into the boxes; never clears a box, so a checked session intent survives a
 * restart whose reset carried only the single-slot value */
function cheatPanelAdopt() {
	const cheat = game.career.cheat;
	if (cheat === GravityGame.CHEAT_COMMUNISM) cheatCommunismEl.checked = true;
	if (cheat === GravityGame.CHEAT_ENDGAME) cheatTestEl.checked = true;
}

/* control locks: a replay is read-only, and the career cheats only act in a
 * career run; the credit button works in every rule */
function cheatPanelSyncUi(career) {
	const locked = replay.on || careerInputLocked();
	cheatCrBtn.disabled = locked;
	const live = career && !locked;
	cheatCommunismEl.disabled = !live;
	cheatTestEl.disabled = !live;
}

cheatCrBtn.addEventListener('click', () => {
	game.money.purse += CHEAT_CR;
	recordCareerAction('credit', { cr: CHEAT_CR });
	if (careerRule()) careerChanged();
});

function cheatToggle() {
	if (replay.on || careerInputLocked() || !careerRule()) return;
	recordCareerAction('cheat', { communism: cheatCommunismEl.checked, test: cheatTestEl.checked });
	cheatPanelApply();
	careerChanged();
	syncSeedUrl();
}
cheatCommunismEl.addEventListener('change', cheatToggle);
cheatTestEl.addEventListener('change', cheatToggle);

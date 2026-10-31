/*
 * Rule help drawer: which rule's text to show, open and pin, and the press-and-hold preview.
 *
 * Part of the gui family (0.5 plan): a flat global script, no IIFE, no build,
 * file:// friendly. Loaded by index.html; nothing here is exported per file.
 */

'use strict';

/* the flat mode row drives both the help drawer and the running rule */
function selectedHelpRule() {
	return game.on ? game.rule : PLAY_LAB;
}

function updateHelp(rule) {
	helpRule = RULE_HELP[rule] ? rule : selectedHelpRule();
	const help = RULE_HELP[helpRule];
	if (helpModeTitleEl) helpModeTitleEl.textContent = help.name;
	if (helpRuleNameEl) helpRuleNameEl.textContent = help.name;
	if (helpGoalEl) helpGoalEl.textContent = help.goal;
	if (helpScoreEl) helpScoreEl.textContent = help.score;
	if (helpDetailRowEl) helpDetailRowEl.hidden = help.detail === '';
	if (helpDetailLabelEl) helpDetailLabelEl.textContent = help.detailLabel;
	if (helpDetailEl) helpDetailEl.textContent = help.detail;
	if (helpControlsEl) helpControlsEl.textContent = COMMON_HELP;
	if (helpModeControlsEl) {
		const controls = helpRule === RULE_ROUTE && game.on && game.player === PLAYER_BOT
			? 'A bot plans your trajectory; the leader updates live.' : help.controls;
		helpModeControlsEl.textContent = controls;
		helpModeControlsEl.hidden = controls === '';
	}
}

function setHelpOpen(open, preview = false) {
	if (!preview) helpPinned = open;
	if (open && !preview) updateHelp(selectedHelpRule());
	helpOpen = open;
	if (helpDrawer) helpDrawer.classList.toggle('open', open);
	if (helpBtn) helpBtn.classList.toggle('on', open);
}

/* pressing, hovering or focusing a rule radio shows that rule at once */
function showRuleHelp(rule, pin) {
	updateHelp(rule);
	setHelpOpen(true, !pin);
}

function updateRuleHelp(rule) {
	updateHelp(rule || selectedHelpRule());
}

function beginRuleHelpHold(rule) {
	ruleHelpHold = true;
	updateRuleHelp(RULE_HELP[rule] ? rule : selectedHelpRule());
	setHelpOpen(true, true);
}

function endRuleHelpHold() {
	ruleHelpHold = false;
	updateRuleHelp(selectedHelpRule());
	if (!helpPinned) setHelpOpen(false, true);
}

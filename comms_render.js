/*
 * H's engine: evalWhen, slot fill, line render, topic choice, chips,
 * renderTopic, and the validateCopy linter.
 * not here: the facts it reads → comms_facts.js
 *
 * Part of CommsCopy (load order: PARTS in comms_copy.js).
 */
(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.CommsCopy.part('comms_render.js', attach)
)(function (CommsCopy, inner) {
	'use strict';
	const {
		GravityGame, H_META_ID, H_META_ASK, CHIP_CAP, LAUNCH_GATE_ORDER, HH_FACTS, H_SLOTS,
		H_ACTIONS, H_STEPS, H_LOOKAHEAD, H_TOPICS
	} = inner;

	function evalWhen(expr, snapshot) {
		if (expr === null || expr === undefined) return true;
		if (typeof expr === 'string') {
			const fact = HH_FACTS[expr];
			return fact ? Boolean(fact.test(snapshot)) : false;
		}
		if (expr.not !== undefined) return !evalWhen(expr.not, snapshot);
		if (expr.all) {
			for (let i = 0; i < expr.all.length; i++) {
				if (!evalWhen(expr.all[i], snapshot)) return false;
			}
			return true;
		}
		if (expr.any) {
			for (let i = 0; i < expr.any.length; i++) {
				if (evalWhen(expr.any[i], snapshot)) return true;
			}
			return false;
		}
		return false;
	}

	function fillSlots(template, snapshot) {
		return template.replace(/\{([a-zA-Z]+)\}/g, (match, name) => {
			const reader = H_SLOTS[name];
			if (!reader) throw new Error('unknown H slot: ' + name);
			return String(reader(snapshot));
		});
	}

	function renderLine(entry, snapshot) {
		if (entry.when !== undefined && !evalWhen(entry.when, snapshot)) return '';
		let text = fillSlots(entry.text, snapshot);
		const note = entry.note;
		if (!note) return text;
		if (note.fact) {
			const fact = HH_FACTS[note.fact];
			const holds = fact ? Boolean(fact.test(snapshot)) : false;
			const show = note.invert ? !holds : holds;
			if (!show) return text;
			const why = fact ? fact.why(snapshot) : '';
			return why ? text.replace(/\.$/, '') + ' — ' + why + (text.endsWith('.') ? '.' : '') : text;
		}
		if (note.when === undefined || evalWhen(note.when, snapshot)) {
			const extra = fillSlots(note.text, snapshot);
			if (extra) return text.replace(/\.$/, '') + ' — ' + extra + (text.endsWith('.') ? '.' : '');
		}
		return text;
	}

	function pushLookAhead(out, entries, snapshot) {
		if (!entries) return;
		for (let i = 0; i < entries.length; i++) {
			const item = entries[i];
			if (Array.isArray(item)) {
				for (let j = 0; j < item.length; j++) {
					const rule = H_LOOKAHEAD[item[j]];
					if (!rule || !evalWhen(rule.when, snapshot)) continue;
					out.push(fillSlots(rule.text, snapshot));
					break;
				}
				continue;
			}
			const rule = H_LOOKAHEAD[item];
			if (rule && evalWhen(rule.when, snapshot)) out.push(fillSlots(rule.text, snapshot));
		}
	}

	function appendTopicLines(out, topic, snapshot, seenRefs) {
		if (topic.includeReasons && snapshot.reasons.length > 0) {
			for (let i = 0; i < snapshot.reasons.length; i++) {
				const fact = HH_FACTS[snapshot.reasons[i].id];
				const line = fact ? fact.why(snapshot) : '';
				if (!line) continue;
				out.push(i === 0 ? line : 'Also blocked: ' + line);
			}
		}
		for (let i = 0; i < topic.lines.length; i++) {
			const line = renderLine(topic.lines[i], snapshot);
			if (line) out.push(line);
		}
		pushLookAhead(out, topic.lookAhead, snapshot);
		if (!topic.ref || !topic.ref.length) return;
		if (topic.refWhen === null || !evalWhen(topic.refWhen, snapshot)) return;
		for (let i = 0; i < topic.ref.length; i++) {
			const refId = topic.ref[i];
			if (seenRefs[refId]) continue;
			const refTopic = H_TOPICS[refId];
			if (!refTopic) continue;
			seenRefs[refId] = true;
			appendTopicLines(out, refTopic, snapshot, seenRefs);
		}
	}

	function resolveActions(entries, snapshot) {
		const out = [];
		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			const id = typeof entry === 'string' ? entry : entry.id;
			if (typeof entry === 'object' && entry.when !== undefined && !evalWhen(entry.when, snapshot)) continue;
			const spec = H_ACTIONS[id];
			if (!spec || !evalWhen(spec.when, snapshot)) continue;
			const enabled = evalWhen(spec.enabled, snapshot);
			const fact = HH_FACTS[spec.enabled];
			out.push(Object.freeze({
				id: spec.id,
				label: fillSlots(spec.label, snapshot),
				enabled: enabled,
				costly: Boolean(spec.costly && !enabled),
				why: enabled || !fact ? '' : fact.why(snapshot)
			}));
		}
		return Object.freeze(out);
	}

	/* Top live finding for `what should I do?`; bribes are never nominated. */
	function topTopicId(snapshot) {
		if (!snapshot.careerMode || snapshot.ended !== GravityGame.CAREER_OPEN || snapshot.flying) {
			return 'leave';
		}
		/* 0.7.47 WS4/WS3: the opening search and an unfair roster outrank the
		 * run's own gates while they are the live finding */
		if (snapshot.searchActive) return 'fair-search';
		if (snapshot.rosterOk === false) return 'fair-roster';
		if (snapshot.returnTow) return 'return-tow';
		if (snapshot.reasons.length > 0) return 'leave';
		if (HH_FACTS['ship-worn'].test(snapshot)) return 'repair';
		if (HH_FACTS['own-pad-charging'].test(snapshot)) return 'pad';
		if (HH_FACTS['fuel-need'].test(snapshot)) return 'fuel';
		return 'money';
	}

	function chipList(snapshot, asked) {
		const seen = asked || Object.create(null);
		const candidates = [];
		const ids = Object.keys(H_TOPICS);
		for (let i = 0; i < ids.length; i++) {
			const topic = H_TOPICS[ids[i]];
			if (!evalWhen(topic.when, snapshot)) continue;
			candidates.push(topic);
		}
		candidates.sort((a, b) => {
			if (a.rank !== b.rank) return a.rank - b.rank;
			const aSeen = seen[a.id] ? 1 : 0;
			const bSeen = seen[b.id] ? 1 : 0;
			return aSeen - bSeen;
		});
		const out = [Object.freeze({ id: H_META_ID, ask: H_META_ASK })];
		const added = Object.create(null);
		added[H_META_ID] = true;
		for (let i = 0; i < candidates.length && out.length < CHIP_CAP; i++) {
			const topic = candidates[i];
			if (added[topic.id]) continue;
			added[topic.id] = true;
			out.push(Object.freeze({ id: topic.id, ask: topic.ask }));
		}
		return Object.freeze(out);
	}

	function firstMatchingStep(stepIds, snapshot) {
		if (!stepIds) return null;
		for (let i = 0; i < stepIds.length; i++) {
			const step = H_STEPS[stepIds[i]];
			if (step && evalWhen(step.when, snapshot)) return step;
		}
		return null;
	}

	function renderTopic(id, snapshot, asked) {
		const meta = id === H_META_ID || !id;
		const resolvedId = meta ? topTopicId(snapshot) : id;
		const topic = H_TOPICS[resolvedId] || H_TOPICS.leave;
		const question = meta ? H_META_ASK : topic.ask;
		const lines = [];
		const seenRefs = Object.create(null);
		seenRefs[topic.id] = true;
		const step = firstMatchingStep(topic.steps, snapshot);
		let actionIds = topic.actions;
		if (step) {
			appendTopicLines(lines, step, snapshot, seenRefs);
			actionIds = step.actions;
		} else {
			appendTopicLines(lines, topic, snapshot, seenRefs);
		}
		return Object.freeze({
			id: meta ? H_META_ID : topic.id,
			resolvedId: topic.id,
			question: question,
			text: [...new Set(lines)].join('\n'),
			actions: resolveActions(actionIds, snapshot),
			chips: chipList(snapshot, asked)
		});
	}

	/* --- static copy & schema validator -------------------------------- */

	function checkWhen(expr, where, errors) {
		if (expr === null || expr === undefined) return;
		if (typeof expr === 'string') {
			if (!HH_FACTS[expr]) errors.push(where + ': unknown fact ' + expr);
			return;
		}
		if (typeof expr !== 'object') {
			errors.push(where + ': invalid when expression');
			return;
		}
		const keys = Object.keys(expr);
		if (keys.length !== 1) {
			errors.push(where + ': combinator must have one key');
			return;
		}
		if (expr.not !== undefined) return checkWhen(expr.not, where + '.not', errors);
		const list = expr.all || expr.any;
		if (!Array.isArray(list) || list.length === 0) {
			errors.push(where + ': unknown or empty combinator ' + keys[0]);
			return;
		}
		for (let i = 0; i < list.length; i++) checkWhen(list[i], where + '[' + i + ']', errors);
	}

	function checkTemplate(text, where, errors) {
		if (typeof text !== 'string' || text.length === 0) {
			errors.push(where + ': empty copy string');
			return;
		}
		if (/[0-9]/.test(text)) errors.push(where + ': digit literal in copy: ' + text);
		const stripped = text.replace(/\{([a-zA-Z]+)\}/g, (match, name) => {
			if (!H_SLOTS[name]) errors.push(where + ': unknown slot {' + name + '}');
			return '';
		});
		if (stripped.includes('{') || stripped.includes('}')) {
			errors.push(where + ': malformed slot brace in ' + text);
		}
	}

	function checkLines(lines, where, errors) {
		for (let i = 0; i < lines.length; i++) {
			const entry = lines[i];
			const tag = where + '.lines[' + i + ']';
			checkTemplate(entry.text, tag, errors);
			if (entry.when !== undefined) checkWhen(entry.when, tag + '.when', errors);
			if (!entry.note) continue;
			if (entry.note.fact !== undefined) {
				if (!HH_FACTS[entry.note.fact]) {
					errors.push(tag + '.note: unknown fact ' + entry.note.fact);
				}
			} else {
				checkTemplate(entry.note.text, tag + '.note', errors);
				if (entry.note.when !== undefined) checkWhen(entry.note.when, tag + '.note.when', errors);
			}
		}
	}

	function checkRefCycle(id, visiting, done, errors) {
		if (done[id]) return;
		if (visiting[id]) {
			errors.push('ref cycle through topic ' + id);
			return;
		}
		visiting[id] = true;
		const topic = H_TOPICS[id];
		const refs = topic && topic.ref ? topic.ref : [];
		for (let i = 0; i < refs.length; i++) {
			if (H_TOPICS[refs[i]]) checkRefCycle(refs[i], visiting, done, errors);
		}
		visiting[id] = false;
		done[id] = true;
	}

	function validateCopy() {
		const errors = [];
		checkTemplate(H_META_ASK, 'H_META_ASK', errors);
		for (let i = 0; i < LAUNCH_GATE_ORDER.length; i++) {
			const gate = LAUNCH_GATE_ORDER[i];
			if (!HH_FACTS[gate]) errors.push('missing launch-gate fact ' + gate);
		}
		for (const key of Object.keys(HH_FACTS)) {
			const fact = HH_FACTS[key];
			if (typeof fact.test !== 'function') errors.push('HH_FACTS.' + key + ': missing test');
			if (typeof fact.why !== 'function') errors.push('HH_FACTS.' + key + ': missing why');
			else if (/[0-9]/.test(String(fact.why))) {
				errors.push('HH_FACTS.' + key + '.why: digit literal');
			}
		}
		for (const slot of Object.keys(H_SLOTS)) {
			if (/[0-9]/.test(slot)) errors.push('H_SLOTS.' + slot + ': digit in slot name');
			if (typeof H_SLOTS[slot] !== 'function') errors.push('H_SLOTS.' + slot + ': not a function');
		}
		for (const id of Object.keys(H_ACTIONS)) {
			const act = H_ACTIONS[id];
			checkTemplate(act.label, 'H_ACTIONS.' + id + '.label', errors);
			checkWhen(act.when, 'H_ACTIONS.' + id + '.when', errors);
			checkWhen(act.enabled, 'H_ACTIONS.' + id + '.enabled', errors);
		}
		for (const id of Object.keys(H_STEPS)) {
			const step = H_STEPS[id];
			checkWhen(step.when, 'H_STEPS.' + id + '.when', errors);
			checkLines(step.lines, 'H_STEPS.' + id, errors);
			for (const act of step.actions) {
				if (!H_ACTIONS[act]) errors.push('H_STEPS.' + id + ': unknown action ' + act);
			}
			for (const ref of step.ref) {
				if (!H_TOPICS[ref]) errors.push('H_STEPS.' + id + ': unknown ref ' + ref);
			}
			if (step.refWhen !== null) checkWhen(step.refWhen, 'H_STEPS.' + id + '.refWhen', errors);
		}
		for (const id of Object.keys(H_LOOKAHEAD)) {
			const rule = H_LOOKAHEAD[id];
			checkWhen(rule.when, 'H_LOOKAHEAD.' + id + '.when', errors);
			checkTemplate(rule.text, 'H_LOOKAHEAD.' + id + '.text', errors);
		}
		const visiting = Object.create(null);
		const done = Object.create(null);
		for (const id of Object.keys(H_TOPICS)) {
			const topic = H_TOPICS[id];
			const tag = 'H_TOPICS.' + id;
			if (!Number.isInteger(topic.rank)) errors.push(tag + ': rank must be integer');
			checkTemplate(topic.ask, tag + '.ask', errors);
			checkWhen(topic.when, tag + '.when', errors);
			checkLines(topic.lines, tag, errors);
			for (const stepId of topic.steps) {
				if (!H_STEPS[stepId]) errors.push(tag + ': unknown step ' + stepId);
			}
			for (const entry of topic.lookAhead) {
				const list = Array.isArray(entry) ? entry : [entry];
				for (const key of list) {
					if (!H_LOOKAHEAD[key]) errors.push(tag + ': unknown lookAhead ' + key);
				}
			}
			for (const refId of topic.ref) {
				if (!H_TOPICS[refId]) errors.push(tag + ': unknown ref ' + refId);
			}
			if (topic.refWhen !== null) checkWhen(topic.refWhen, tag + '.refWhen', errors);
			for (const chipId of topic.chips) {
				if (!H_TOPICS[chipId]) errors.push(tag + ': unknown chip ' + chipId);
			}
			for (let a = 0; a < topic.actions.length; a++) {
				const entry = topic.actions[a];
				const actId = typeof entry === 'string' ? entry : entry.id;
				if (!H_ACTIONS[actId]) errors.push(tag + ': unknown action ' + actId);
				if (typeof entry === 'object' && entry.when !== undefined) {
					checkWhen(entry.when, tag + '.actions[' + a + '].when', errors);
				}
				if (actId === 'bribe' && id !== 'bribe') {
					errors.push(tag + ': bribe must never be ranked in another topic’s actions');
				}
			}
			checkRefCycle(id, visiting, done, errors);
		}
		return errors;
	}

	Object.assign(CommsCopy, {
		evalWhen, fillSlots, topTopicId, chipList, renderTopic, validateCopy
	});
});

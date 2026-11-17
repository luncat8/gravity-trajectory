/* Minimal player-actions log for career mode:
 * records only player inputs (launches, shop/career actions, toggles)
 * without background world snapshots, so it is small enough to paste in chat
 * to investigate bot behavior or replay from the same seed. */
'use strict';

(function (global) {
	const PREFIX = 'GRAVITY_ACTIONS:';

	function encode(payload) {
		return PREFIX + JSON.stringify(payload);
	}

	function decode(text) {
		if (typeof text !== 'string') return null;
		const trimmed = text.trim();
		if (!trimmed.startsWith(PREFIX)) return null;
		try {
			const data = JSON.parse(trimmed.slice(PREFIX.length));
			if (!data || typeof data !== 'object' || !Array.isArray(data.actions)) return null;
			return data;
		} catch (e) {
			return null;
		}
	}

	global.CareerActions = {
		PREFIX: PREFIX,
		encode: encode,
		decode: decode
	};
})(typeof window !== 'undefined' ? window : globalThis);

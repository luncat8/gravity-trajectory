/* Career opening + timed inputs + the selected player’s observed events. */
'use strict';

(function (global) {
	const PREFIX = 'GRAVITY_ACTIONS:';
	const FORMAT = 3;

	function encode(payload) {
		return PREFIX + JSON.stringify(payload);
	}

	function decode(text) {
		if (typeof text !== 'string') return null;
		const trimmed = text.trim();
		if (!trimmed.startsWith(PREFIX)) return null;
		try {
			const data = JSON.parse(trimmed.slice(PREFIX.length));
			if (!data || typeof data !== 'object' || data.v !== FORMAT || !Array.isArray(data.actions)) return null;
			return data;
		} catch (e) {
			return null;
		}
	}

	global.CareerActions = {
		PREFIX: PREFIX,
		FORMAT: FORMAT,
		encode: encode,
		decode: decode
	};
})(typeof window !== 'undefined' ? window : globalThis);

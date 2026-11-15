/* Saved maps: a start map is a proven career opening (seed, universe, seat
 * plan); a run adds an exact snapshot of the live state. Written by the game's
 * save action and by `node experiments/make_saved_maps.js` — edit by saving,
 * not by hand. Loading is just this file being present. */
(function (root) {
	'use strict';
	const MAPS = [
		{
			v: 1,
			kind: "start",
			name: "seed 1 · 13 planets · 3 seats",
			seed: 1,
			universe: 13,
			seats: [2, 3, 9],
			targetPay: 3.760532,
			rule: "career",
			bot: "normal",
			player: "user",
			cheat: null,
			rate: 1,
			gs: 1,
			fs: 1,
			ws: 1,
			ht: false,
			note: "career default",
			stats: {
				weakest: 0.88,
				sites: 2
			}
		},
		{
			v: 1,
			kind: "start",
			name: "seed 2 · 13 planets · 3 seats",
			seed: 2,
			universe: 13,
			seats: [0, 7, 6],
			targetPay: 2.173793,
			rule: "career",
			bot: "normal",
			player: "user",
			cheat: null,
			rate: 1,
			gs: 1,
			fs: 1,
			ws: 1,
			ht: false,
			note: "career default",
			stats: {
				weakest: 0.87,
				sites: 2
			}
		},
		{
			v: 1,
			kind: "start",
			name: "seed 3 · 13 planets · 2 seats",
			seed: 3,
			universe: 13,
			seats: [8, 1],
			targetPay: 1.431367,
			rule: "career",
			bot: "normal",
			player: "user",
			cheat: null,
			rate: 1,
			gs: 1,
			fs: 1,
			ws: 1,
			ht: false,
			note: "YOU + one rival",
			stats: {
				weakest: 0.97,
				sites: 1
			}
		},
		{
			v: 1,
			kind: "start",
			name: "seed 4 · 26 planets · 3 seats",
			seed: 4,
			universe: 26,
			seats: [23, 12, 6],
			targetPay: 3.129152,
			rule: "career",
			bot: "normal",
			player: "user",
			cheat: null,
			rate: 1,
			gs: 1,
			fs: 1,
			ws: 1,
			ht: false,
			note: "the old 26-world subset",
			stats: {
				weakest: 0.89,
				sites: 6
			}
		},
		{
			v: 1,
			kind: "start",
			name: "seed 2 · 8 planets · 2 seats",
			seed: 2,
			universe: 8,
			seats: [6, 0],
			targetPay: 1.79294,
			rule: "career",
			bot: "normal",
			player: "user",
			cheat: null,
			rate: 1,
			gs: 1,
			fs: 1,
			ws: 1,
			ht: false,
			note: "the small universe",
			stats: {
				weakest: 0.92,
				sites: 2
			}
		},
		{
			v: 1,
			kind: "start",
			name: "seed 5 · 26 planets · 4 seats",
			seed: 5,
			universe: 26,
			seats: [18, 23, 12, 13],
			targetPay: 1.861548,
			rule: "career",
			bot: "normal",
			player: "user",
			cheat: null,
			rate: 1,
			gs: 1,
			fs: 1,
			ws: 1,
			ht: false,
			note: "four companies on 26",
			stats: {
				weakest: 0.92,
				sites: 1
			}
		}
	];
	if (typeof module !== 'undefined' && module.exports) module.exports = MAPS;
	else root.SAVED_MAPS = MAPS;
})(typeof globalThis !== 'undefined' ? globalThis : this);

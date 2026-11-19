/* Designed planet gravity fields: the map generator helper's roster, the
 * concrete draw it made and the ship the colours were read at. Written by
 * the helper page (`map-generator-helper.htm`) — edit by designing, not by
 * hand. Loading is just this file being present beside the page. */
(function (root) {
	'use strict';
	const FIELDS = [];
	if (typeof module !== 'undefined' && module.exports) module.exports = FIELDS;
	else root.MAP_FIELDS = FIELDS;
})(typeof globalThis !== 'undefined' ? globalThis : this);

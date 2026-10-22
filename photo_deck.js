/*
 * Photo deck: a postcard popup when the cargo enters a new planet system or
 * lands on a surface. Art is optional user-made files in photos/<kind>/ keyed
 * by planet type; when a file is absent a CSS postcard of the same type stands
 * in, so the deck is complete before any art exists.
 *
 * Layout: bottom-left, aspect kept, scaled to the free space. On viewports
 * without room the card becomes a 256 px overlay above every panel.
 */
(function (root) {
	'use strict';

	/* OrbitWorld.planetType order: rock, terran, super, dwarf, mini, gas, ice */
	const SLUGS = ['rock', 'terran', 'super', 'dwarf', 'mini', 'gas', 'ice'];
	const LABELS = ['rock world', 'terran world', 'super-Earth', 'dwarf world',
		'mini world', 'gas giant', 'ice giant'];
	const SPACE_CAPTIONS = [
		'airless rock, craters sharp as new; the port lights are the only colour',
		'blue seas and white spiral storms — a good place to breathe',
		'a heavy super-Earth under a teal aurora, too much gravity by half',
		'a small grey world beneath a huge, close star',
		'a pebble of a world, barely three kilometres across',
		'banded gas with no ground anywhere below',
		'a pale ice giant and its bright rings, lit from behind'
	];
	const LANDED_CAPTIONS = [
		'a cargo pad on a dust plain, twin moons overhead',
		'grass, river haze, and a pad that has not been used in years',
		'basalt shore under crushing skies; the lander sits low',
		'a crater-rim base squeezed under a swollen sun',
		'standing on a world small enough to see both horizons',
		'air platform riding the cloud deck, engines holding station',
		'a platform on frozen methane, aurora overhead'
	];
	const KINDS = ['space', 'landed'];
	const CAPTIONS = [SPACE_CAPTIONS, LANDED_CAPTIONS];
	const VARIANTS = 3;
	const EXTS = ['jpg', 'png'];
	const HIDE_MS = 9000;
	const TOAST_MS = 2500;
	const COMPACT_W = 960;
	const COMPACT_H = 640;

	/* element refs; null until attach() finds the markup */
	const refs = { card: null, img: null, art: null, kicker: null, title: null,
		caption: null, close: null };
	let timer = 0;
	let pending = null;
	let pendingAt = 0;
	let loadingSrc = '';
	let loadedSrc = '';
	/* the money toast waiting for the open card to hide */
	let toastPending = false;
	let toastKicker = '';
	let toastTitle = '';
	let toastText = '';

	function $(doc, id) {
		return doc.getElementById(id);
	}

	function clampType(type) {
		return type >= 0 && type < SLUGS.length ? type | 0 : 0;
	}

	function slugOf(type) {
		return SLUGS[clampType(type)];
	}

	function captionFor(kind, type) {
		return CAPTIONS[kind === 'landed' ? 1 : 0][clampType(type)];
	}

	function titleFor(planet, type) {
		return 'P' + (planet | 0) + ' · ' + LABELS[clampType(type)];
	}

	/* stable variant per planet, so the same world shows the same picture */
	function variantOf(planet) {
		const p = planet | 0;
		return 1 + ((p < 0 ? -p : p) % VARIANTS);
	}

	/*
	 * Candidate files, best first: a variant for this planet, then the plain
	 * type file, each as jpg then png. Missing files fall through on error.
	 */
	function candidates(kind, type, planet) {
		const dir = 'photos/' + KINDS[kind === 'landed' ? 1 : 0] + '/';
		const slug = slugOf(type);
		const variant = slug + '-' + variantOf(planet);
		const list = [];
		for (let i = 0; i < EXTS.length; i++) list.push(dir + variant + '.' + EXTS[i]);
		for (let i = 0; i < EXTS.length; i++) list.push(dir + slug + '.' + EXTS[i]);
		return list;
	}

	function needsCompact(width, height) {
		return width < COMPACT_W || height < COMPACT_H;
	}

	function attach(doc) {
		refs.card = $(doc, 'photoCard');
		refs.img = $(doc, 'photoImg');
		refs.art = $(doc, 'photoArt');
		refs.kicker = $(doc, 'photoKicker');
		refs.title = $(doc, 'photoTitle');
		refs.caption = $(doc, 'photoCaption');
		refs.close = $(doc, 'photoClose');
		if (!refs.card || !refs.img || !refs.art) return false;
		refs.img.addEventListener('load', onLoad);
		refs.img.addEventListener('error', onError);
		if (refs.close) refs.close.addEventListener('click', dismiss);
		return true;
	}

	function onLoad() {
		loadedSrc = loadingSrc;
		if (!refs.card || refs.card.hidden) return;
		refs.img.hidden = false;
		refs.art.hidden = true;
	}

	function onError() {
		if (!refs.img) return;
		refs.img.hidden = true;
		refs.art.hidden = false;
		if (pending) tryAt(pendingAt + 1);
	}

	/* a url that already loaded is shown without a second network/file request */
	function tryAt(index) {
		if (index >= pending.length) return;
		if (pending[index] === loadedSrc) {
			refs.img.hidden = false;
			refs.art.hidden = true;
			return;
		}
		pendingAt = index;
		loadingSrc = pending[index];
		refs.img.src = loadingSrc;
	}

	/* an open card follows the viewport when the free space changes */
	function layout() {
		if (!refs.card || refs.card.hidden) return;
		refs.card.classList.toggle('compact',
			needsCompact(window.innerWidth, window.innerHeight));
	}

	function hide() {
		if (!refs.card) return;
		refs.card.hidden = true;
		if (timer) {
			clearTimeout(timer);
			timer = 0;
		}
		if (toastPending) {
			toastPending = false;
			showToast();
		}
	}

	/* the × button also drops a queued toast: a dismissal dismisses */
	function dismiss() {
		toastPending = false;
		hide();
	}

	/* the money toast: a text-only card, shorter stay, no art */
	function showToast() {
		refs.kicker.textContent = toastKicker;
		refs.title.textContent = toastTitle;
		refs.caption.textContent = toastText;
		refs.art.hidden = true;
		refs.img.hidden = true;
		pending = null;
		refs.card.hidden = false;
		refs.card.classList.toggle('compact',
			needsCompact(window.innerWidth, window.innerHeight));
		if (timer) clearTimeout(timer);
		timer = setTimeout(hide, TOAST_MS);
	}

	/*
	 * The postcard slot doubles as the money toast. An open card keeps its
	 * moment; the toast follows once it hides (a newer card then drops it).
	 */
	function toast(kicker, title, text) {
		if (!refs.card) return;
		toastKicker = kicker;
		toastTitle = title;
		toastText = text;
		if (refs.card.hidden) {
			showToast();
			return;
		}
		toastPending = true;
	}

	function show(kind, type, planet) {
		if (!refs.card) return;
		toastPending = false;
		const landed = kind === 'landed';
		const cls = slugOf(type);
		refs.kicker.textContent = landed ? 'landed · surface' : 'from space · new system';
		refs.title.textContent = titleFor(planet, type);
		refs.caption.textContent = captionFor(kind, type);
		refs.art.className = 'photoArt ' + cls + (landed ? ' landed' : '');
		refs.art.hidden = false;
		refs.img.hidden = true;
		pending = candidates(kind, type, planet);
		pendingAt = 0;
		refs.card.hidden = false;
		refs.card.classList.toggle('compact',
			needsCompact(window.innerWidth, window.innerHeight));
		tryAt(0);
		if (timer) clearTimeout(timer);
		timer = setTimeout(hide, HIDE_MS);
	}

	const PhotoDeck = {
		SLUGS, LABELS, VARIANTS, TOAST_MS,
		slugOf, captionFor, titleFor, variantOf, candidates, needsCompact,
		attach, show, layout, hide, toast,
		toastQueued: () => toastPending,
		visible: () => Boolean(refs.card) && !refs.card.hidden
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = PhotoDeck;
	else {
		root.PhotoDeck = PhotoDeck;
		PhotoDeck.attach(root.document);
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);

/*
 * The split modules (gravity_game.js, gravity_bot.js and their part files)
 * share one namespace object: a part reads earlier parts through its
 * `const { … } = NS;` line and publishes with `Object.assign(NS, { … })`.
 * A name imported before it is published is `undefined` until called, and a
 * key published twice silently overwrites, so both are checked here, with the
 * index.html load order against each core's PARTS list.
 *
 * Run: node experiments/parts_test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);

function names(list) {
	return list.split(',').map(s => s.trim()).filter(Boolean).map(s => s.split(':')[0].trim());
}

function block(src, re) {
	const m = re.exec(src);
	return m ? names(m[1]) : [];
}

function checkModule(coreFile, ns) {
	const mod = require(path.join(root, coreFile));
	const parts = mod.PARTS;
	assert(Array.isArray(parts) && parts.length > 0, `${coreFile}: PARTS`);
	const at = scripts.indexOf(coreFile);
	assert.deepStrictEqual(scripts.slice(at + 1, at + 1 + parts.length), parts,
		`${coreFile}: index.html must list PARTS right after it, in order`);
	const coreSrc = fs.readFileSync(path.join(root, coreFile), 'utf8');
	const published = new Map();
	const coreRe = new RegExp(`\\n\\t(?:const ${ns} = \\{|Object\\.assign\\(${ns}, \\{)([^}]*)\\}`);
	for (const key of block(coreSrc, coreRe)) published.set(key, coreFile);
	const importRe = new RegExp(`\\n\\tconst \\{([^}]*)\\} = ${ns};`);
	const provideRe = new RegExp(`\\n\\tObject\\.assign\\(${ns}, \\{([^}]*)\\}\\);`);
	const lateRe = new RegExp(`\\b${ns}\\.([A-Za-z_$][\\w$]*)`, 'g');
	const late = [];
	for (const file of parts) {
		const src = fs.readFileSync(path.join(root, file), 'utf8');
		for (const name of block(src, importRe)) {
			assert(published.has(name), `${file} imports ${name}, which no earlier part publishes`);
		}
		for (const key of block(src, provideRe)) {
			assert(!published.has(key), `${file} publishes ${key}, already published by ${published.get(key)}`);
			published.set(key, file);
		}
		for (const m of src.matchAll(lateRe)) late.push([file, m[1]]);
	}
	for (const [file, name] of late) {
		if (name === 'prototype') continue;
		assert(published.has(name) || name in mod, `${file} reads ${ns}.${name}, which nothing publishes`);
	}
	return parts.length;
}

const game = checkModule('gravity_game.js', 'GravityGame');
const bot = checkModule('gravity_bot.js', 'GravityBot');
console.log(`parts ok: gravity_game.js + ${game}, gravity_bot.js + ${bot}`);

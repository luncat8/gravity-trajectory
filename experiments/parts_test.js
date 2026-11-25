/*
 * Wiring of the split modules: gravity_game.js, gravity_bot.js and comms_copy.js
 * each assemble a namespace from a core and its PARTS. Checks, per core:
 *   - index.html loads the core and each part once, PARTS right after the core;
 *   - every name a part takes on its `const { … } = inner;` line is published to
 *     inner by the core or an earlier part, and every `inner.name` read by some file;
 *   - nothing is published to inner twice, inner lists are shorthand only, and no
 *     public key is published twice;
 *   - Node require and the page path (a fresh vm context, core + parts as scripts)
 *     give the same public keys and value types, no `part` left, CommsCopy frozen;
 *   - a part loaded out of order is refused.
 * Structure only, no frozen key list: later plans add API freely.
 *
 * Run: node experiments/parts_test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const CORES = [
	{ file: 'gravity_game.js', ns: 'GravityGame' },
	{ file: 'gravity_bot.js', ns: 'GravityBot' },
	{ file: 'comms_copy.js', ns: 'CommsCopy' }
];
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const pageScripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);

const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const listOf = body => body.split(',').map(s => s.trim()).filter(Boolean);
const keyOf = entry => entry.split(':')[0].trim();
function publishLists(src, target) {
	const re = new RegExp('Object\\.assign\\(' + target + ', \\{([^}]*)\\}\\);', 'g');
	return [...src.matchAll(re)].map(m => listOf(m[1]));
}

function surface(obj) {
	const out = {};
	for (const k of Object.keys(obj)) out[k] = typeof obj[k];
	if (typeof obj === 'function') {
		for (const k of Object.getOwnPropertyNames(obj.prototype)) out['prototype.' + k] = typeof obj.prototype[k];
	}
	return out;
}

/* the page path: dependencies the core reads from the page come from Node */
function pageContext(coreSrc) {
	const context = vm.createContext({ console });
	const deps = /const (\w+) = typeof module !== 'undefined' && module\.exports\s*\?\s*require\('\.\/([\w.]+)'\)/g;
	for (const m of coreSrc.matchAll(deps)) context[m[1]] = require(path.join(ROOT, m[2]));
	return context;
}

let checked = 0;
for (const { file, ns } of CORES) {
	const coreSrc = read(file);
	const partsMatch = /const PARTS = \[([\s\S]*?)\];/.exec(coreSrc);
	assert.ok(partsMatch, file + ': no PARTS');
	const parts = [...partsMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
	assert.ok(parts.length > 0, file + ': empty PARTS');

	for (const f of [file, ...parts]) {
		assert.strictEqual(pageScripts.filter(src => src === f).length, 1, 'index.html must load ' + f + ' exactly once');
	}
	const at = pageScripts.indexOf(file);
	assert.deepStrictEqual(pageScripts.slice(at + 1, at + 1 + parts.length), parts,
		'index.html: ' + file + ' must be followed by its PARTS in order');

	const innerMatch = /\n\tconst inner = \{([^}]*)\};/.exec(coreSrc);
	assert.ok(innerMatch, file + ': no inner bag');
	const published = new Map();
	const publicKeys = new Map();
	const publish = (where, list) => {
		for (const entry of list) {
			assert.ok(/^\w+$/.test(entry), `${where}: inner entry '${entry}' is not shorthand`);
			assert.ok(!published.has(entry), `${where}: ${entry} already published to inner by ${published.get(entry)}`);
			published.set(entry, where);
		}
	};
	const publishPublic = (where, keys) => {
		for (const key of keys) {
			assert.ok(!publicKeys.has(key), `${where}: public ${key} already published by ${publicKeys.get(key)}`);
			publicKeys.set(key, where);
		}
	};
	const statics = src => [...src.matchAll(new RegExp('^\\t' + ns + '\\.(\\w+) = ', 'gm'))].map(m => m[1]);
	publish(file, listOf(innerMatch[1]));
	const literal = new RegExp('\\n\\tconst ' + ns + ' = \\{([^}]*)\\};').exec(coreSrc);
	if (literal) publishPublic(file, listOf(literal[1]).map(keyOf));
	publishPublic(file, statics(coreSrc));

	const sources = new Map([[file, coreSrc]]);
	for (const part of parts) {
		const src = read(part);
		sources.set(part, src);
		assert.ok(src.includes(`globalThis.${ns}.part('${part}', attach)`), part + ': shell names another file');
		const imports = /\n\tconst \{([^}]*)\} = inner;/.exec(src);
		for (const name of imports ? listOf(imports[1]) : []) {
			assert.ok(published.has(name), `${part}: imports ${name}, not published by ${file} or an earlier part`);
		}
		for (const list of publishLists(src, 'inner')) publish(part, list);
		for (const list of publishLists(src, ns)) publishPublic(part, list.map(keyOf));
		publishPublic(part, statics(src));
	}
	for (const [where, src] of sources) {
		const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
		for (const m of code.matchAll(/\binner\.(\w+)/g)) {
			assert.ok(published.has(m[1]), `${where}: reads inner.${m[1]}, published by no file`);
		}
	}

	/* Node and page assembly agree */
	const viaNode = require(path.join(ROOT, file));
	const context = pageContext(coreSrc);
	for (const [where, src] of sources) vm.runInContext(src, context, { filename: where });
	const viaPage = context[ns];
	assert.ok(viaPage, file + ': page path left no ' + ns);
	assert.deepStrictEqual(surface(viaPage), surface(viaNode), file + ': Node and page assembly differ');
	for (const obj of [viaNode, viaPage]) {
		assert.ok(!Object.getOwnPropertyNames(obj).includes('part'), file + ': part left on ' + ns);
		if (ns === 'CommsCopy') assert.ok(Object.isFrozen(obj), 'CommsCopy is not frozen');
	}
	assert.strictEqual(Object.keys(viaNode).length, [...publicKeys.keys()].length,
		file + ': public keys outside the publish lists');

	/* out of order is refused */
	if (parts.length > 1) {
		const wrong = pageContext(coreSrc);
		vm.runInContext(coreSrc, wrong, { filename: file });
		assert.throws(() => vm.runInContext(sources.get(parts[1]), wrong, { filename: parts[1] }),
			/expected/, file + ': a part out of order loaded');
	}
	checked += parts.length;
}

console.log(`PARTS OK · ${CORES.length} cores, ${checked} parts`);

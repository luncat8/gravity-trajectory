/*
 * 0.7.53 split tool (one-shot, archived with its plan): cuts an IIFE monolith into a core plus
 * parts by an anchor map, mechanically, and audits the move. See 0.7.53-plan-js-split.md §3, §8.
 *
 *   npm i --prefix /tmp/split-tool acorn eslint-scope        (deps stay outside the repo)
 *   node archive/0.7.53-split-tool.js game|bot|comms [--rev <git rev>] [--write]
 *
 * --rev  the commit holding the monolith (default: the stage-0 commit below)
 * --write  emit the core and the parts into the working tree; otherwise report only
 *
 * The anchor maps live in 0.7.53-split-maps.js beside this file.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const DEPS = process.env.SPLIT_DEPS || '/tmp/split-tool/node_modules';
const acorn = require(path.join(DEPS, 'acorn'));
const eslintScope = require(path.join(DEPS, 'eslint-scope'));
const MAPS = require('./0.7.53-split-maps.js');

const REPO = path.join(__dirname, '..');
const args = process.argv.slice(2);
const which = args[0];
const rev = args.includes('--rev') ? args[args.indexOf('--rev') + 1] : MAPS.BASE_REV;
const write = args.includes('--write');
const map = MAPS[which];
if (!map) throw new Error('usage: game|bot|comms [--rev R] [--write]');

const fail = [];
const note = [];
const src = execFileSync('git', ['show', rev + ':' + map.core], { cwd: REPO, encoding: 'utf8' });
const comments = [];
const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', ranges: true, locations: true, onComment: comments });
const iife = ast.body[0].expression.callee;
const body = iife.body.body;
const NS = map.ns;

/* --- parents (for shorthand properties and loop detection) --------------- */

const parent = new Map();
(function walk(node, up) {
	parent.set(node, up);
	for (const key of Object.keys(node)) {
		if (key === 'loc' || key === 'range') continue;
		const v = node[key];
		if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walk(c, node); }
		else if (v && typeof v.type === 'string') walk(v, node);
	}
})(ast, null);

/* --- statements -------------------------------------------------------------- */

const isModuleTest = n => /module\.exports/.test(src.slice(n.start, n.end));
function classify(s, i) {
	if (i === 0 && s.directive) return 'prologue';
	if (s.type === 'VariableDeclaration' && s.declarations.length === 1 && s.declarations[0].init &&
		s.declarations[0].init.type === 'ConditionalExpression' && isModuleTest(s.declarations[0].init)) return 'external';
	if (s.type === 'IfStatement' && isModuleTest(s)) return 'tail';
	if (s.type === 'VariableDeclaration' && s.declarations[0].id.name === NS &&
		s.declarations[0].init.type !== 'ConditionalExpression') return 'literal';
	if (s.type === 'ExpressionStatement' && s.expression.type === 'AssignmentExpression' &&
		s.expression.left.type === 'MemberExpression' && s.expression.left.object.name === NS &&
		s.expression.left.property.name !== 'prototype') return 'static';
	if (s.type === 'ExpressionStatement' && s.expression.type === 'AssignmentExpression' &&
		s.expression.left.type === 'MemberExpression' && s.expression.left.object.type === 'MemberExpression' &&
		s.expression.left.object.property.name === 'prototype') return 'method';
	if (s.type === 'VariableDeclaration' || s.type === 'FunctionDeclaration') return 'decl';
	return 'bare';
}

const units = body.map((s, i) => ({ i, s, kind: classify(s, i), names: [], start: s.start, end: s.end }));
for (const u of units) {
	if (u.kind === 'decl' || u.kind === 'external' || u.kind === 'literal') {
		if (u.s.type === 'FunctionDeclaration') u.names.push(u.s.id.name);
		else for (const d of u.s.declarations) u.names.push(d.id.name);
	} else if (u.kind === 'method') u.names.push('.' + u.s.expression.left.property.name);
}
/* a same-line trailing comment belongs to the statement it follows; the rest of the gap
 * (blank lines, comments) leads the next statement */
for (let k = 0; k < units.length; k++) {
	const u = units[k];
	const nl = src.indexOf('\n', u.end);
	const rest = src.slice(u.end, nl);
	if (/^[ \t]*(\/\/.*|\/\*.*\*\/[ \t]*)?$/.test(rest)) u.end = nl;
}
for (let k = 0; k < units.length; k++) {
	const u = units[k];
	const prevEnd = k ? units[k - 1].end : src.indexOf('{', iife.body.start) + 1;
	u.lead = src.slice(prevEnd, u.start);
}

const byName = new Map();
for (const u of units) for (const n of u.names) {
	if (byName.has(n)) fail.push('duplicate top-level name ' + n);
	byName.set(n, u);
}
const unitOf = name => {
	const u = byName.get(name);
	if (!u) throw new Error(map.core + ': anchor not found: ' + name);
	return u;
};

/* --- assignment: core blocks < part blocks < named singles; bare follows its predecessor --- */

const files = [map.core].concat(map.parts.map(p => p.file));
const order = new Map(files.map((f, i) => [f, i]));
const lastMovable = [...units].reverse().find(u => u.kind === 'decl' || u.kind === 'method' || u.kind === 'bare');
function claim(file, blocks, names, layer) {
	for (const [a, b] of blocks || []) {
		const from = unitOf(a).i;
		const to = b === 'END' ? lastMovable.i : unitOf(b).i;
		if (to < from) fail.push(`${file}: block ${a}..${b} reversed`);
		for (let i = from; i <= to; i++) {
			const u = units[i];
			if (u.kind !== 'decl' && u.kind !== 'method' && u.kind !== 'bare') continue;
			if (u.layer === layer && u.owner !== file) fail.push(`${file}: block ${a}..${b} overlaps ${u.owner} at ${u.names[0] || 'L' + u.s.loc.start.line}`);
			u.owner = file;
			u.layer = layer;
		}
	}
	for (const n of names || []) {
		const u = unitOf(n);
		if (u.layer === 3 && u.owner !== file) fail.push(`${n} named by ${u.owner} and ${file}`);
		u.owner = file;
		u.layer = 3;
	}
}
claim(map.core, map.coreBlocks, null, 1);
for (const p of map.parts) claim(p.file, p.blocks, null, 2);
claim(map.core, null, map.coreNames, 3);
for (const p of map.parts) claim(p.file, null, p.names, 3);
for (let k = 0; k < units.length; k++) {
	const u = units[k];
	if (u.kind === 'bare') u.owner = units[k - 1].owner;
	if (u.kind === 'prologue' || u.kind === 'external') u.owner = map.core;
	if ((u.kind === 'decl' || u.kind === 'method') && !u.owner) fail.push('unassigned: ' + u.names[0] + ' L' + u.s.loc.start.line);
}

/* --- references ---------------------------------------------------------------- */

const scopeManager = eslintScope.analyze(ast, { ecmaVersion: 2022, sourceType: 'script' });
const rootScope = scopeManager.acquire(iife);
const starts = units.map(u => u.s.start);
function unitAt(pos) {
	let lo = 0, hi = units.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
	}
	return units[lo];
}
function definitionTime(ref) {
	for (let sc = ref.from; sc && sc !== rootScope; sc = sc.upper) if (sc.type === 'function') return false;
	return true;
}
function inLoop(node) {
	for (let n = parent.get(node); n; n = parent.get(n)) {
		if (/^(Function|ArrowFunction)/.test(n.type)) return false;
		if (/^(For|ForIn|ForOf|While|DoWhile)Statement$/.test(n.type)) return true;
	}
	return false;
}

const imports = new Map(files.map(f => [f, new Set()]));
const shared = new Map(files.map(f => [f, new Set()]));
const readers = new Map();
const rewrites = new Map();
const backRefs = [];
const accessorReads = [];
const publicKeys = new Map(files.map(f => [f, []]));
const statics = new Map(files.map(f => [f, []]));

const ownerOfVar = v => unitAt(v.defs[0].name.start);
for (const sc of scopeManager.scopes) {
	for (const ref of sc.references) {
		const v = ref.resolved;
		if (!v || v.scope !== rootScope || v.name === 'root') continue;
		const from = unitAt(ref.identifier.start);
		const to = ownerOfVar(v);
		if (from.kind === 'literal' || from.kind === 'static' || from.kind === 'tail') continue;
		if (v.name === NS && map.nsParam) continue;
		const fromFile = from.owner;
		if (!fromFile || !to.owner) continue;
		if (!readers.has(v.name)) readers.set(v.name, new Set());
		if (to !== from) readers.get(v.name).add(fromFile);
		if (to.owner === fromFile) continue;
		const where = `${v.name} in ${fromFile} L${ref.identifier.loc.start.line}`;
		if (ref.isWrite()) { fail.push('cross-file write: ' + where); continue; }
		const isLet = v.defs[0].parent && v.defs[0].parent.kind === 'let';
		let name = v.name;
		let call = '';
		if (isLet) {
			name = map.accessors && map.accessors[v.name];
			if (!name) { fail.push('cross-file let without accessor: ' + where); continue; }
			call = '()';
			accessorReads.push(where + ' -> ' + name + '()');
		}
		const owner = unitOf(name).owner;
		const late = order.get(owner) > order.get(fromFile);
		const id = ref.identifier;
		const prop = parent.get(id);
		const shorthand = prop && prop.type === 'Property' && prop.shorthand && prop.value === id;
		if (late) {
			if (definitionTime(ref)) { fail.push('definition-time read of a later part: ' + where); continue; }
			backRefs.push(`${fromFile} -> ${owner}: ${name}${inLoop(id) ? '  (INSIDE A LOOP)' : ''}`);
			shared.get(owner).add(name);
			addRewrite(from, id.start, id.end, (shorthand ? v.name + ': ' : '') + 'inner.' + name + call);
		} else {
			imports.get(fromFile).add(name);
			shared.get(owner).add(name);
			if (isLet) addRewrite(from, id.start, id.end, (shorthand ? v.name + ': ' : '') + name + call);
		}
	}
}
function addRewrite(u, start, end, text) {
	if (!rewrites.has(u)) rewrites.set(u, []);
	rewrites.get(u).push({ start, end, text });
}

/* public keys: the literal's properties and the bot's static statements, by owner */
for (const u of units) {
	if (u.kind === 'literal') {
		let obj = u.s.declarations[0].init;
		if (obj.type === 'CallExpression') obj = obj.arguments[0];
		for (const p of obj.properties) {
			if (p.value.type !== 'Identifier') { fail.push('non-identifier public value ' + p.key.name); continue; }
			const owner = unitOf(p.value.name).owner;
			publicKeys.get(owner).push(p.key.name === p.value.name ? p.key.name : p.key.name + ': ' + p.value.name);
		}
	}
	if (u.kind === 'static') {
		const rhs = u.s.expression.right;
		const owner = rhs.type === 'Identifier' ? unitOf(rhs.name).owner : map.core;
		u.owner = owner;
		statics.get(owner).push(u);
	}
}

/* --- emit ----------------------------------------------------------------------- */

function codeOf(u) {
	let code = src.slice(u.start, u.end);
	const list = (rewrites.get(u) || []).slice().sort((a, b) => b.start - a.start);
	for (const r of list) code = code.slice(0, r.start - u.start) + r.text + code.slice(r.end - u.start);
	return code;
}
function leadOf(u, first) {
	const lead = u.lead.replace(/^[ \t]*\n/, '');
	const m = /^\n*/.exec(lead)[0].length;
	const rest = lead.slice(m);
	return (first ? '' : m ? '\n\n' : '\n') + rest;
}
function list(names, indent, width) {
	const lines = [];
	let line = '';
	for (const n of names) {
		const piece = line ? line + ', ' + n : n;
		if ((indent + piece).replace(/\t/g, '    ').length > width && line) { lines.push(line + ','); line = n; } else line = piece;
	}
	if (line) lines.push(line);
	return lines.map(l => indent + l).join('\n');
}
function objectLines(names, indent) {
	return names.length ? '{\n' + list(names, indent + '\t', 100) + '\n' + indent + '}' : '{}';
}
function emitUnits(file) {
	let out = '';
	let first = true;
	for (const u of units) {
		if (u.owner !== file || u.kind === 'external' || u.kind === 'prologue' || u.kind === 'static') continue;
		out += leadOf(u, first) + codeOf(u);
		first = false;
	}
	for (const u of statics.get(file)) out += (out ? '\n' : '') + leadOf(u, true) + codeOf(u);
	return out;
}
const declOrder = name => unitOf(name).i;
const sortNames = set => [...set].sort((a, b) => order.get(unitOf(a).owner) - order.get(unitOf(b).owner) || declOrder(a) - declOrder(b));

const outputs = new Map();
const nsDecl = map.publicObject;
{
	const core = map.core;
	let out = map.coreHeader.trimEnd() + '\n(function (root) {\n\t\'use strict\';\n\n';
	out += '\t/* load order; index.html lists the same files right after this one */\n\tconst PARTS = [\n';
	const w = Math.max(...map.parts.map(p => p.file.length)) + 4;
	for (const p of map.parts) out += `\t\t${("'" + p.file + "',").padEnd(w)}// ${p.comment}\n`;
	out += '\t];';
	let ext = '';
	for (const u of units) if (u.kind === 'external') ext += leadOf(u, false) + codeOf(u);
	out += ext + '\n\n' + emitUnits(core) + '\n\n';
	if (nsDecl) out += `\tconst ${NS} = ${objectLines(publicKeys.get(core), '\t')};\n`;
	out += `\tconst inner = ${objectLines(sortNames(shared.get(core)), '\t')};\n\n`;
	out += `\tlet attached = 0;
	function part(file, attach) {
		if (file !== PARTS[attached]) throw new Error('${core}: expected ' + PARTS[attached] + ', got ' + file);
		attach(${NS}, inner);
		attached += 1;
		if (attached < PARTS.length) return;
		delete ${NS}.part;${map.freeze ? `\n\t\tObject.freeze(${NS});` : ''}
	}

	if (typeof module !== 'undefined' && module.exports) {
		for (const file of PARTS) part(file, require('./' + file));
		module.exports = ${NS};
	} else {
		Object.defineProperty(${NS}, 'part', { value: part, configurable: true });
		root.${NS} = ${NS};
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;
	outputs.set(core, out);
}
for (const p of map.parts) {
	let out = '/*\n' + p.header.map(l => (' * ' + l).trimEnd()).join('\n') +
		`\n *\n * Part of ${NS} (load order: PARTS in ${map.core}).\n */\n`;
	out += `(typeof module !== 'undefined' && module.exports
	? attach => { module.exports = attach; }
	: attach => globalThis.${NS}.part('${p.file}', attach)
)(function (${NS}, inner) {
	'use strict';\n`;
	const imp = sortNames(imports.get(p.file));
	if (imp.length) {
		const one = `\tconst { ${imp.join(', ')} } = inner;`;
		out += (one.replace(/\t/g, '    ').length <= 100 ? one : '\tconst {\n' + list(imp, '\t\t', 100) + '\n\t} = inner;') + '\n';
	}
	out += '\n' + emitUnits(p.file) + '\n';
	const pub = publicKeys.get(p.file);
	const sh = sortNames(shared.get(p.file));
	if (pub.length || sh.length) out += '\n';
	if (pub.length) out += `\tObject.assign(${NS}, ${objectLines(pub, '\t')});\n`;
	if (sh.length) out += `\tObject.assign(inner, ${objectLines(sh, '\t')});\n`;
	out += '});\n';
	outputs.set(p.file, out);
}

/* --- audit ------------------------------------------------------------------------ */

const all = [...outputs.values()].join('\n');
let moved = 0;
for (const u of units) {
	if (u.kind === 'literal' || u.kind === 'tail') continue;
	const code = codeOf(u);
	const hits = all.split(code).length - 1;
	if (hits !== 1 && code.length > 40) fail.push(`audit: statement ${u.names[0] || 'L' + u.s.loc.start.line} found ${hits}×`);
	moved += 1;
}
for (const c of comments) {
	const text = src.slice(c.start, c.end);
	if (c.start > iife.body.start && !all.includes(text) && !/load order/.test(text)) {
		const inLiteral = units.some(u => (u.kind === 'literal' || u.kind === 'tail') && c.start >= u.s.start && c.end <= u.s.end);
		if (!inLiteral) fail.push('audit: comment lost at L' + c.loc.start.line + ': ' + text.slice(0, 60));
	}
}
for (const [file, text] of outputs) {
	try { new vm.Script(text, { filename: file }); } catch (e) { fail.push(`syntax: ${file}: ${e.message}`); }
}
const units2 = units.filter(u => u.kind !== 'literal' && u.kind !== 'tail' && u.kind !== 'prologue' && u.kind !== 'external');
const counted = new Map(files.map(f => [f, 0]));
for (const u of units2) counted.set(u.owner, counted.get(u.owner) + 1);

/* single-reader constants and scratch: rule 2 candidates */
const single = [];
for (const u of units) {
	if (u.kind !== 'decl' || (u.s.type !== 'VariableDeclaration' && u.owner !== map.core)) continue;
	for (const n of u.names) {
		const r = readers.get(n);
		if (!r || r.size !== 1 || r.has(u.owner) || (map.keep || []).includes(n)) continue;
		const selfUse = [...scopeManager.scopes].some(sc => sc.references.some(ref =>
			ref.resolved && ref.resolved.name === n && ref.resolved.scope === rootScope &&
			unitAt(ref.identifier.start).owner === u.owner && unitAt(ref.identifier.start) !== u &&
			!['literal', 'static', 'tail'].includes(unitAt(ref.identifier.start).kind)));
		if (!selfUse) single.push(`${n}: ${u.owner} -> ${[...r][0]}`);
	}
}

console.log(`${map.core} @ ${rev}: ${units.length} statements, ${moved} moved/kept, ${files.length} files`);
for (const f of files) {
	const text = outputs.get(f);
	console.log(`  ${f.padEnd(24)} ${String(text.split('\n').length).padStart(5)} lines  ${String(counted.get(f)).padStart(4)} stmts  ` +
		`imp ${String(imports.get(f).size).padStart(3)}  shared ${String(shared.get(f).size).padStart(3)}  public ${publicKeys.get(f).length}`);
}
const sharedTotal = [...shared.values()].reduce((a, s) => a + s.size, 0);
console.log(`shared names: ${sharedTotal}; back references: ${backRefs.length}; accessor reads: ${accessorReads.length}`);
for (const b of backRefs) console.log('  back  ' + b);
for (const a of accessorReads) console.log('  acc   ' + a);
if (single.length) { console.log('single-reader constants (rule 2 candidates):'); for (const s of single) console.log('  ' + s); }
for (const n of note) console.log('note: ' + n);
if (process.env.READERS) for (const n of process.env.READERS.split(',')) console.log('readers ' + n + ': ' + unitOf(n).owner + ' -> ' + [...(readers.get(n) || [])].join(' '));
if (fail.length) {
	console.log(`\n${fail.length} problem(s):`);
	for (const f of fail) console.log('  ' + f);
	process.exitCode = 1;
} else if (write) {
	for (const [file, text] of outputs) fs.writeFileSync(path.join(REPO, file), text);
	console.log('written');
}

// Collects every Hebrew UI string of the app into i18n/keys.json.
// A key is what one DOM text node (or attribute) shows: interpolations become {}, HTML tags and newlines split fragments.
// Run: node tools/i18n-extract.mjs   (needs acorn: NODE_PATH pointing at any node_modules that has it)
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const acorn = createRequire(import.meta.url)('acorn');
const HEB = /[֐-׿]/, FILES = ['data.js', 'trip.js', 'app.js', 'extras.js', 'group.js', 'show.js', 'backup.js', 'start.js', 'trips.js', 'notes.js', 'lic.js'];
const keys = new Map();
const ent = s => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
function add(raw, file) {
  // attribute values first, then the text between tags
  for (const m of raw.matchAll(/(?:placeholder|aria-label|title|alt)="([^"]*)"/g)) frag(m[1], file);
  for (const part of raw.replace(/<[^>]*>/g, '\n').split('\n')) frag(part, file);
}
function frag(s, file) {
  s = ent(s).replace(/\s+/g, ' ').trim();
  if (!HEB.test(s.replace(/\{\}/g, ''))) return;
  if (!keys.has(s)) keys.set(s, file);
}
const flat = n => n.type === 'BinaryExpression' && n.operator === '+' ? [...flat(n.left), ...flat(n.right)] : [n];
const piece = n => n.type === 'Literal' && typeof n.value === 'string' ? n.value : n.type === 'TemplateLiteral' ? n.quasis.map(q => q.value.cooked ?? '').join('{}') : '{}';
function walk(n, file, inChain) {
  if (!n || typeof n.type !== 'string') return;
  if (n.type === 'BinaryExpression' && n.operator === '+' && !inChain) {
    const parts = flat(n);
    if (parts.some(p => (p.type === 'Literal' && typeof p.value === 'string') || p.type === 'TemplateLiteral')) add(parts.map(piece).join(''), file);
    for (const p of parts) walk(p, file, true);
    return;
  }
  if (n.type === 'TemplateLiteral') { if (!inChain) add(piece(n), file); for (const e of n.expressions) walk(e, file, false); return; }
  if (n.type === 'Literal' && typeof n.value === 'string') { if (!inChain) add(n.value, file); return; }
  for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach(x => walk(x, file, false)); else if (v && typeof v.type === 'string') walk(v, file, false); }
}
for (const f of FILES) walk(acorn.parse(readFileSync(f, 'utf8'), { ecmaVersion: 'latest' }), f, false);
const html = readFileSync('index.html', 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
for (const m of html.matchAll(/(?:placeholder|aria-label|title|alt|content)="([^"]*)"/g)) frag(m[1], 'index.html');
for (const part of html.replace(/<[^>]*>/g, '\n').split('\n')) frag(part, 'index.html');
// fragments the parser cannot see (text that ends where a nested template with tags begins)
for (const k of JSON.parse(readFileSync('i18n/extra-keys.json', 'utf8'))) frag(k, 'extra');
const out = [...keys].map(([k, f]) => ({ k, f }));
writeFileSync('i18n/keys.json', JSON.stringify(out, null, 0));
const by = {}; for (const { f, k } of out) { by[f] = by[f] || [0, 0]; by[f][0]++; by[f][1] += k.length; }
console.log(out.length, 'keys', JSON.stringify(by));

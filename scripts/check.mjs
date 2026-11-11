import { readFile } from 'node:fs/promises';
import { ROOT, makeHTML } from './content.mjs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = await makeHTML();
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assert.equal(new Set(ids).size, ids.length, 'HTML IDs must be unique');
const app = await readFile(path.join(ROOT, 'client/game-app.js'), 'utf8');
for (const match of app.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(match[1]), 'Missing DOM element: ' + match[1]);
let count = 0;
for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) { new vm.Script(script[1]); count++; }
assert.equal(count, 6);
assert.ok(html.includes('Tôi đã sẵn sàng'));
console.log(JSON.stringify({ checked: true, scripts: count, uniqueDOMIds: ids.length }));

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('combat audio distinguishes miss from confirmed impact',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes('function scheduleMiss(event)'));
  assert.ok(app.includes('function resolveAttackAudio(event)'));
  assert.ok(app.includes("} else if(e.type==='attack') scheduleMiss(e);"));
  assert.ok(app.includes("if(e.type==='block')sound('block');else resolveAttackAudio(e);"));
});

test('hit sound tiers depend on actual damage',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes('const heavy=damage>=18,medium=damage>=10'));
  assert.ok(app.includes("if(kind==='kick')"));
  assert.ok(app.includes('else if(medium)'));
  assert.ok(app.includes('Short hurt cry'));
});

test('miss sound differs for kick and peck',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes("function missSound(kind)"));
  assert.ok(app.includes("if(kind==='kick'){noiseBurst(.11"));
  assert.ok(app.includes("else{noiseBurst(.07"));
});

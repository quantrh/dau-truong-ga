import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('rapid direction taps get a short buffer so 60fps ticks cannot miss them',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes('DIRECTION_TAP_BUFFER_MS=95'));
  assert.ok(app.includes('directionTapBuffer.set(e.code,performance.now()+DIRECTION_TAP_BUFFER_MS)'));
  assert.ok(app.includes('const tapUntil=directionTapBuffer.get(code)||0'));
  assert.ok(app.includes('return keys.has(code)||repeatUntil>now||tapUntil>now'));
});

test('release cleanup clears both repeat grace and tap buffer',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes('keyRepeatGrace.clear();directionTapBuffer.clear();'));
});

test('tap buffering coexists with last-pressed direction priority',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes("directionPriority[player]=e.code===map.left?'left':'right'"));
  assert.ok(app.includes('directionTapBuffer.set(e.code'));
});

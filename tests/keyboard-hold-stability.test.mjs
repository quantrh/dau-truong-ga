import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('keyboard direction has repeat grace instead of trusting every keyup instantly',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes('const KEY_REPEAT_GRACE_MS=140'));
  assert.ok(app.includes('function codeIsHeld(code)'));
  assert.ok(app.includes('keyRepeatGrace.set(e.code,performance.now()+KEY_REPEAT_GRACE_MS)'));
  assert.ok(app.includes("controls.input(index,{has:code=>codeIsHeld(code)})"));
});

test('direction repeat events still refresh online input',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  const start=app.indexOf("document.addEventListener('keydown'");
  const end=app.indexOf("document.addEventListener('keyup'",start);
  const block=app.slice(start,end);
  assert.ok(block.includes('sendInput();'));
});

test('releaseKeys clears keyboard grace and directional priority',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes("keys.clear();keyRepeatGrace.clear();directionTapBuffer.clear();touchHeld.clear()"));
  assert.ok(app.includes("directionPriority[0]='';directionPriority[1]=''"));
});

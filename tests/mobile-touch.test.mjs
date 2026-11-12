import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('control strip exposes all seven actions as touch buttons',async()=>{
  const shell=await readFile(new URL('../client/shell.html',import.meta.url),'utf8');
  for(const action of ['left','right','jump','peck','kick','guard','dash']){
    assert.ok(shell.includes('class="touch-key" data-key-action="'+action+'"'),action+' touch button missing');
  }
  assert.ok(shell.includes('touch-action:none'));
  assert.ok(shell.includes('@media (pointer:coarse)'));
});

test('touch controls support multitouch held state and tap action counters',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes('touchPointers = new Map()'));
  assert.ok(app.includes('touchCounts = new Map()'));
  assert.ok(app.includes("if(count===1&&tapKeys.includes(action))localActions[action]++"));
  assert.ok(app.includes("for(const action of touchHeld)"));
  assert.ok(app.includes("element.addEventListener('pointerdown'"));
  assert.ok(app.includes("element.addEventListener('pointerup'"));
  assert.ok(app.includes("element.addEventListener('pointercancel'"));
});

test('releasing controls clears touch state and sends neutral input',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes('keys.clear();keyRepeatGrace.clear();touchHeld.clear();touchPointers.clear();touchCounts.clear();'));
  assert.ok(app.includes("document.querySelectorAll('.touch-key.pressed')"));
});

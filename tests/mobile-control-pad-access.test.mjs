import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('mobile control pad stays above browser chrome and remains tappable',async()=>{
  const shell=await readFile(new URL('../client/shell.html',import.meta.url),'utf8');
  assert.ok(shell.includes('.mobile-gamepad:not([hidden]){position:sticky'));
  assert.ok(shell.includes('z-index:60'));
  assert.ok(shell.includes('bottom:max(10px,env(safe-area-inset-bottom))'));
  assert.ok(shell.includes('.mobile-pad-cluster{position:relative;z-index:61;pointer-events:auto'));
});

test('starting a mobile match scrolls the control pad into view',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes("window.matchMedia('(pointer:coarse), (max-width:760px)').matches"));
  assert.ok(app.includes("target=mobileControls&&$('mobileGamepad')&&!$('mobileGamepad').hidden?$('mobileGamepad'):$('arena')"));
  assert.ok(app.includes("block:mobileControls?'end':'center'"));
});

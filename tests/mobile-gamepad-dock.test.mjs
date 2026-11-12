import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('active mobile gamepad is fixed above browser chrome',async()=>{
  const shell=await readFile(new URL('../client/shell.html',import.meta.url),'utf8');
  assert.ok(shell.includes('.combat-active .mobile-gamepad:not([hidden]){position:fixed'));
  assert.ok(shell.includes('z-index:9999'));
  assert.ok(shell.includes('bottom:max(12px,env(safe-area-inset-bottom))'));
  assert.ok(shell.includes('.mobile-gamepad[hidden]{display:none!important}'));
});

test('mobile layout reserves space for fixed gamepad',async()=>{
  const shell=await readFile(new URL('../client/shell.html',import.meta.url),'utf8');
  assert.ok(shell.includes('.combat-active .game-column{padding-bottom:156px}'));
  assert.ok(shell.includes('.combat-active .game-column{padding-bottom:148px}'));
});

test('combat-active class is added only while playing',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes("document.body.classList.add('combat-active')"));
  assert.ok(app.includes("document.body.classList.remove('combat-active')"));
});

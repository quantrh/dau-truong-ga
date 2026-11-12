import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('active mobile gamepad stays below arena instead of fixed behind browser chrome',async()=>{
  const shell=await readFile(new URL('../client/shell.html',import.meta.url),'utf8');
  assert.ok(shell.includes('.combat-active .mobile-gamepad:not([hidden]){position:relative'));
  assert.ok(!shell.includes('.combat-active .mobile-gamepad:not([hidden]){position:fixed'));
  assert.ok(shell.includes('.mobile-gamepad[hidden]{display:none!important}'));
});

test('mobile combat layout targets the real arena panel and hides lobby chrome',async()=>{
  const shell=await readFile(new URL('../client/shell.html',import.meta.url),'utf8');
  assert.ok(shell.includes('.combat-active .arena-panel{padding-bottom:'));
  assert.ok(shell.includes('.combat-active .site-header,.combat-active .intro,.combat-active .lobby,.combat-active .page-footer{display:none!important}'));
  assert.ok(!shell.includes('.combat-active .game-column'));
});

test('combat-active class is added only while playing',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes("document.body.classList.add('combat-active')"));
  assert.ok(app.includes("document.body.classList.remove('combat-active')"));
});

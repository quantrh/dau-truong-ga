import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('mobile combat pad stays fixed and visible above browser chrome',async()=>{
  const shell=await readFile(new URL('../client/shell.html',import.meta.url),'utf8');
  const arena=shell.indexOf('id="arena"');
  const pad=shell.indexOf('id="mobileGamepad"');
  assert.ok(arena>=0&&pad>arena);
  assert.ok(shell.includes('.combat-active .mobile-gamepad{position:fixed'));
  assert.ok(shell.includes('bottom:0;z-index:40'));
});

test('mobile combat hides nonessential lobby chrome while keeping arena panel',async()=>{
  const shell=await readFile(new URL('../client/shell.html',import.meta.url),'utf8');
  assert.ok(shell.includes('.combat-active .topbar,.combat-active .intro,.combat-active .lobby,.combat-active .page-footer{display:none!important}'));
  assert.ok(shell.includes('.combat-active .arena-panel{padding-bottom:'));
  assert.ok(!shell.includes('.combat-active .game-column'));
});

test('combat start scrolls the real arena panel into view',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes("document.querySelector('.arena-panel')"));
  assert.ok(app.includes("focusTarget.scrollIntoView({behavior:'auto',block:'start'})"));
});

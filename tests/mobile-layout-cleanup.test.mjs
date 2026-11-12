import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('mobile gamepad is rendered after the arena, not over the canvas',async()=>{
  const shell=await readFile(new URL('../client/shell.html',import.meta.url),'utf8');
  const arena=shell.indexOf('<div class="arena" id="arena">');
  const arenaClose=shell.indexOf('<div class="controls-strip">');
  const gamepad=shell.indexOf('id="mobileGamepad"');
  assert.ok(arena>=0&&gamepad>arena&&gamepad<arenaClose);
  const mobileCss=shell.slice(shell.indexOf('@media (pointer:coarse)'),shell.indexOf('.p2-controls'));
  assert.ok(mobileCss.includes('.mobile-gamepad{position:relative'));
  assert.ok(!mobileCss.includes('.mobile-gamepad{position:absolute'));
});

test('profile and power fields are collapsed into a settings menu',async()=>{
  const shell=await readFile(new URL('../client/shell.html',import.meta.url),'utf8');
  const menu=shell.indexOf('id="settingsMenu"');
  const profile=shell.indexOf('id="profileCard"');
  const power=shell.indexOf('id="powerChoice"');
  const modes=shell.indexOf('class="mode-list"');
  assert.ok(menu>modes);
  assert.ok(profile>menu&&power>menu);
  assert.ok(shell.includes('Chiến kê & cài đặt'));
  assert.ok(shell.includes('id="settingsSummary"'));
});

test('online display name is no longer required on the main room form',async()=>{
  const shell=await readFile(new URL('../client/shell.html',import.meta.url),'utf8');
  const roomEntry=shell.slice(shell.indexOf('id="roomEntry"'),shell.indexOf('id="roomCard"'));
  assert.ok(!roomEntry.includes('id="playerName"'));
  assert.ok(shell.includes('id="playerName"'));
});

test('saved rooster name is the online fallback and settings summary',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes("const fallback=rooster&&rooster.name?rooster.name:'Người chơi'"));
  assert.ok(app.includes("$('settingsSummary').textContent=r.name+' · P'+r.powerRating"));
});

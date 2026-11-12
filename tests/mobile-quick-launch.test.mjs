import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('mobile launcher exposes four compact mode chips and one primary action',async()=>{
  const shell=await readFile(new URL('../client/shell.html',import.meta.url),'utf8');
  assert.ok(shell.includes('id="mobileQuickLaunch"'));
  assert.ok(shell.includes('id="mobilePrimaryBtn"'));
  for(const mode of ['training','bot','local','online']){
    assert.ok(shell.includes('data-quick-mode="'+mode+'"'));
  }
  assert.ok(shell.includes('.mobile-mode-chips{display:grid;grid-template-columns:repeat(4'));
});

test('verbose mobile lobby content is hidden in favor of quick launch',async()=>{
  const shell=await readFile(new URL('../client/shell.html',import.meta.url),'utf8');
  assert.ok(shell.includes('.lobby-heading,.lobby>.mode-list{display:none}'));
  assert.ok(shell.includes('.training-coach,.match-facts,.start-caption,.online-intro,.tip-card,.network-details{display:none!important}'));
  assert.ok(shell.includes('#offlineOptions .start-btn{display:none}'));
});

test('mobile primary action changes with local and online state',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes("btn.textContent=selectedMode==='training'?'BẮT ĐẦU TẬP →':'BẮT ĐẦU TRẬN →'"));
  assert.ok(app.includes("btn.textContent='TẠO PHÒNG ONLINE →'"));
  assert.ok(app.includes("btn.textContent='TÔI ĐÃ SẴN SÀNG →'"));
  assert.ok(app.includes("btn.textContent=canStart?'BẮT ĐẦU ONLINE →':'CHỜ ĐỐI THỦ SẴN SÀNG'"));
});

test('quick launcher is hidden while playing and restored in lobby',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes("$('mobileQuickLaunch').hidden=true"));
  assert.ok(app.includes("$('mobileQuickLaunch').hidden=false"));
});

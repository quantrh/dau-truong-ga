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
  assert.ok(shell.includes('.lobby-heading{display:none}.lobby>.mode-list{display:none}'));
  assert.ok(shell.includes('.training-coach,.match-facts,.start-caption,.online-intro,.tip-card,.network-details{display:none!important}'));
  assert.ok(shell.includes('#offlineOptions .start-btn{display:none}'));
});

test('mobile primary action changes with local and online state',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes("btn.textContent=selectedMode==='training'?'BẮT ĐẦU TẬP →':'BẮT ĐẦU TRẬN →'"));
  assert.ok(app.includes("btn.textContent=onlineAutoCreating?'ĐANG TẠO PHÒNG…':'ĐANG CHUẨN BỊ PHÒNG…'"));
  assert.ok(app.includes("btn.textContent='CHIA SẺ LỜI MỜI →'"));
  assert.ok(app.includes("btn.textContent='TÔI ĐÃ SẴN SÀNG →'"));
  assert.ok(app.includes("btn.textContent=canStart?'BẮT ĐẦU ONLINE →':'CHỜ ĐỐI THỦ SẴN SÀNG'"));
});

test('quick launcher is hidden while playing and restored in lobby',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes("$('mobileQuickLaunch').hidden=true"));
  assert.ok(app.includes("$('mobileQuickLaunch').hidden=false"));
});


test('online mode auto-creates a room and exposes native sharing',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  const shell=await readFile(new URL('../client/shell.html',import.meta.url),'utf8');
  assert.ok(app.includes("if(mode==='online')maybeAutoHostOnline()"));
  assert.ok(app.includes('function maybeAutoHostOnline()'));
  assert.ok(app.includes('navigator.share'));
  assert.ok(app.includes("$('copyInviteBtn').addEventListener('click',shareInvite)"));
  assert.ok(shell.includes('id="inviteLink"'));
  assert.ok(shell.includes('Chia sẻ lời mời →'));
});


test('computer mode uses deliberately easier AI',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  const engine=await readFile(new URL('../client/game-engine.js',import.meta.url),'utf8');
  assert.ok(app.includes("game.setDifficulty(mode==='bot'?'easy':'normal')"));
  assert.ok(engine.includes("easy ? 0.34 : hard ? 0.085 : 0.13"));
  assert.ok(engine.includes("const guardChance = easy ? 0.10 : hard ? 0.83 : 0.58"));
  assert.ok(engine.includes("roll < (easy ? 0.18 : hard ? 0.6 : 0.46)"));
});


test('online room creation survives profile failures',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes('function fallbackIdentity()'));
  assert.ok(app.includes("Promise.race([ensureProfile(),timeout])"));
  assert.ok(app.includes("catch(_){\n      return fallback;"));
  assert.ok(app.includes("let current=null;\n    try{\n      const identity=await profileIdentity();"));
  assert.ok(app.includes("onlineAutoCreating=false;"));
});

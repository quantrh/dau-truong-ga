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
  assert.ok(app.includes("btn.textContent=onlineAutoCreating?'ĐANG TẠO PHÒNG…':'THỬ TẠO PHÒNG →'"));
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
  assert.ok(app.includes("const identity=fallbackIdentity();\n    const withTimeout="));
  assert.ok(app.includes("onlineAutoCreating=false;"));
});


test('online host creation bypasses profile loading entirely',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes("const identity=fallbackIdentity();\n    const withTimeout="));
  assert.ok(app.includes("let current=createNetwork();"));
  assert.ok(app.includes("current=createDirectNetwork();"));
  assert.ok(app.includes("requestTimeout:5000"));
  assert.ok(app.includes("THỬ TẠO PHÒNG →"));
});


test('online prefers direct PeerJS rooms and keeps Supabase as fallback',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  const peer=await readFile(new URL('../client/direct-peer-room.js',import.meta.url),'utf8');
  const content=await readFile(new URL('../scripts/content.mjs',import.meta.url),'utf8');
  assert.ok(content.includes("'direct-peer-room.js'"));
  assert.ok(app.includes("current=createDirectNetwork();"));
  assert.ok(app.includes("u.searchParams.set('transport','peer')"));
  assert.ok(app.includes("invitedTransport==='peer'?createDirectNetwork():createNetwork()"));
  assert.ok(peer.includes("root.DirectPeerRoom=DirectPeerRoom"));
  assert.ok(peer.includes("host:'0.peerjs.com'"));
});


test('online selection hides settings and lobby clutter',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes("$('settingsMenu').hidden=mode==='online'"));
  assert.ok(app.includes("if(lobbyTip)lobbyTip.hidden=mode==='online'"));
  assert.ok(app.includes("if(lobbyFooter)lobbyFooter.hidden=mode==='online'"));
});


test('online room creation always releases the busy state',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes("}finally{\n      onlineAutoCreating=false;"));
  assert.ok(app.includes("6500,'Máy chủ phòng không phản hồi.'"));
  assert.ok(app.includes("7500,'Kết nối trực tiếp không phản hồi.'"));
  assert.ok(app.includes("Máy chủ chậm · đang thử kết nối trực tiếp…"));
});


test('production config no longer references deprecated chatgpt.site',async()=>{
  const content=await readFile(new URL('../scripts/content.mjs',import.meta.url),'utf8');
  assert.ok(!content.includes('dau-truong-ga-quan.bidv-it-grou-8424.chatgpt.site'));
  assert.ok(content.includes("window.ROOSTER_ONLINE_API=${JSON.stringify(SUPABASE_ROOM_API)}"));
});

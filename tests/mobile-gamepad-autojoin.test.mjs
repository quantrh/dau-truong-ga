import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('mobile gamepad is a compact two-thumb overlay',async()=>{
  const shell=await readFile(new URL('../client/shell.html',import.meta.url),'utf8');
  assert.ok(shell.includes('id="mobileGamepad"'));
  assert.ok(shell.includes('mobile-pad-left'));
  assert.ok(shell.includes('mobile-pad-right'));
  assert.ok(shell.includes('.combat-active .mobile-gamepad{position:fixed'));
  assert.ok(shell.includes('.controls-strip{display:none}'));
  for(const action of ['left','right','jump','peck','kick','guard','dash']){
    assert.ok(shell.includes('mobile-pad-btn touch-key') && shell.includes('data-key-action="'+action+'"'),action+' missing from gamepad');
  }
  assert.ok(shell.includes('mobile-main" data-key-action="jump"'));
  assert.ok(shell.includes('mobile-main" data-key-action="kick"'));
});

test('mobile gamepad only shows while a match is playing',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes("if($('mobileGamepad'))$('mobileGamepad').hidden=false"));
  assert.ok(app.includes("if($('mobileGamepad'))$('mobileGamepad').hidden=true"));
});

test('invite room links auto-join without requiring the join form',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes("const inviteParams=new URLSearchParams(location.search);const invitedCode=(inviteParams.get('room')||'').trim().toUpperCase()"));
  assert.ok(app.includes('function maybeAutoJoinInvite()'));
  assert.ok(app.includes('joinRoomCode(invitedCode,true)'));
  assert.ok(app.includes("$('roomEntry').hidden=true"));
  assert.ok(app.includes("Link mời hợp lệ · đang chuẩn bị vào phòng"));
});

test('failed invite join stays simple and does not expose manual room entry',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes("if(auto)$('roomEntry').hidden=true;"));
  assert.ok(app.includes("Nhờ chủ phòng gửi link mới."));
  assert.ok(app.includes("$('roomEntry').hidden=true;$('playerName').disabled=false"));
  assert.ok(app.includes("current=createNetwork();"));
  assert.ok(app.includes("current=createDirectNetwork();"));
});


test('invite guest retry stays in join flow',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes("btn.textContent=onlineAutoJoining?'ĐANG VÀO PHÒNG…':'THỬ VÀO PHÒNG LẠI →'"));
  assert.ok(app.includes("if(RoosterNet.validCode(invitedCode)){\n        joinRoomCode(invitedCode,true);"));
  assert.ok(app.includes("document.body.classList.toggle('invite-guest',hasInviteRoom)"));
});


test('direct peer join waits for host lobby acknowledgement',async()=>{
  const peer=await readFile(new URL('../client/direct-peer-room.js',import.meta.url),'utf8');
  assert.ok(peer.includes("Đã nối tới chủ phòng · đang nhận trạng thái phòng…"));
  assert.ok(peer.includes("if(this.lobby){"));
  assert.ok(peer.includes("Chủ phòng chưa xác nhận kết nối. Hãy thử lại link mời."));
  assert.ok(peer.includes("Đã vào phòng · chờ cả hai sẵn sàng."));
});

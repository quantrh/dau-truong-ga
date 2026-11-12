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
  assert.ok(app.includes("const invitedCode=(new URLSearchParams(location.search).get('room')||'').trim().toUpperCase()"));
  assert.ok(app.includes('function maybeAutoJoinInvite()'));
  assert.ok(app.includes('joinRoomCode(invitedCode,true)'));
  assert.ok(app.includes("$('roomEntry').hidden=true"));
  assert.ok(app.includes("Link mời hợp lệ · đang chuẩn bị vào phòng"));
});

test('failed auto-join restores the manual room form',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes("if(auto){$('roomEntry').hidden=false;$('roomInput').value=code;}"));
  assert.ok(app.includes("$('roomEntry').hidden=false;$('playerName').disabled=false"));
});

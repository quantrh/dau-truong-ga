import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

await import('../client/game-engine.js');
const Game=globalThis.RoosterGame;

function fight(){
  const g=new Game({mode:'local'});
  g.state.phase='fight';
  g.state.roundTime=75;
  return g;
}

test('fighters keep a visible body gap instead of overlapping',()=>{
  const g=fight();
  const a=g.state.fighters[0],b=g.state.fighters[1];
  a.x=600;b.x=660;a.vx=0;b.vx=0;
  g.step(1/60,[{},{}]);
  assert.ok(Math.abs(b.x-a.x)>=131.9);
});

test('peck visibly pushes the target backward',()=>{
  const g=fight();
  const a=g.state.fighters[0],b=g.state.fighters[1];
  a.x=500;b.x=642;a.facing=1;b.facing=-1;
  a.attackType='peck';a.attackTimer=Game.ATTACKS.peck.start;a.attackConnected=false;
  const before=b.x;
  g.step(1/60,[{},{}]);
  assert.ok(b.x>=before+11,'peck should immediately shove the target');
  assert.ok(b.vx>180,'peck should leave backward velocity');
  assert.ok(b.hurtTimer>=0.18,'peck should create a readable flinch window');
});

test('kick creates strong knockback and a small lift reaction',()=>{
  const g=fight();
  const a=g.state.fighters[0],b=g.state.fighters[1];
  a.x=500;b.x=675;a.facing=1;b.facing=-1;
  a.attackType='kick';a.attackTimer=Game.ATTACKS.kick.start;a.attackConnected=false;
  const before=b.x;
  g.step(1/60,[{},{}]);
  assert.ok(b.x>=before+23,'kick should immediately separate fighters on contact');
  assert.ok(b.vx>390,'kick should create strong backward velocity');
  assert.ok(b.vy>=110,'kick should visibly lift the target');
  assert.ok(b.hurtTimer>=0.34,'kick should have a longer hit reaction than peck');
  g.step(1/60,[{},{}]);
  assert.ok(b.y>0,'target should visibly leave the ground after a clean kick');
});

test('host connection hold uses guest heartbeat, not guest-only state clock',async()=>{
  const source=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  const start=source.indexOf("if(onlineRole==='host')");
  const end=source.indexOf("}else{",start);
  const hostBlock=source.slice(start,end);
  assert.ok(hostBlock.includes('networkHold=now-lastRemoteInput>stallLimit'));
  assert.ok(!hostBlock.includes('networkHold=now-lastState>stallLimit'));
});

test('impact rendering has dedicated hurt recoil',async()=>{
  const source=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(source.includes("const impact=Math.min(1,Math.max(.18,f.hurtTimer/.36))"));
  assert.ok(source.includes("lunge-=Math.min(24,8+recoil*18)"));
});

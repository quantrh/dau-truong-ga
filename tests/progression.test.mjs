import test from 'node:test';
import assert from 'node:assert/strict';
await import('../client/progression.js');
await import('../client/game-engine.js');
const P=globalThis.RoosterProgression;
const Game=globalThis.RoosterGame;

test('reward score uses diminishing capped power',()=>{
  assert.equal(P.rewardScore({grain:10,grasshopper:2,hen:1}),40);
  assert.equal(P.powerRating({grain:0,grasshopper:0,hen:0}),100);
  assert.equal(P.powerRating({hen:100}),130);
});

test('balanced mode neutralizes accumulated power',()=>{
  assert.deepEqual(P.matchRules('balanced',{hen:100},{grain:1000}),{powerMode:'balanced',powerRatings:[100,100]});
});

test('progression mode increases damage but remains capped',()=>{
  const g=new Game({mode:'local'});
  g.setMatchRules({powerMode:'progression',powerRatings:[130,100]});
  g.state.phase='fight'; g.state.roundTime=75;
  const a=g.state.fighters[0],b=g.state.fighters[1];
  a.x=500;b.x=620;a.facing=1;b.facing=-1;
  a.attackType='peck';a.attackTimer=Game.ATTACKS.peck.start;a.attackConnected=false;
  const hp=b.hp;g.step(1/60,[{},{}]);
  assert.ok(b.hp<hp-Game.ATTACKS.peck.damage);
  assert.equal(a.powerRating,130);
});

test('airborne peck and kick are distinct stronger attacks',()=>{
  function damage(y,kind){
    const g=new Game({mode:'local'});g.state.phase='fight';g.state.roundTime=75;
    const a=g.state.fighters[0],b=g.state.fighters[1];
    a.x=500;b.x=620;a.facing=1;b.facing=-1;a.y=y;b.y=y;
    a.attackType=kind;a.attackTimer=Game.ATTACKS[kind].start;a.attackConnected=false;
    const hp=b.hp;g.step(1/60,[{},{}]);return hp-b.hp;
  }
  assert.ok(damage(80,'peck')>damage(0,'peck'));
  assert.ok(damage(80,'kick')>damage(0,'kick'));
});

test('training starts immediately, never times out and keeps stamina full',()=>{
  const g=new Game({mode:'training'});
  assert.equal(g.state.phase,'fight');
  assert.equal(g.state.fighters[0].x,640);
  for(let i=0;i<600;i++)g.step(1/60,[{right:true,kick:i===2,jump:i===30},{}]);
  assert.equal(g.state.mode,'training');
  assert.equal(g.state.phase,'fight');
  assert.equal(g.state.matchWinner,-1);
  assert.equal(g.state.fighters[0].stamina,100);
  assert.equal(g.state.round,1);
});

test('training movement is not blocked by hidden opponent and facing follows direction',()=>{
  const g=new Game({mode:'training'});
  for(let i=0;i<180;i++)g.step(1/60,[{right:true},{}]);
  assert.ok(g.state.fighters[0].x>900);
  assert.equal(g.state.fighters[0].facing,1);
  for(let i=0;i<180;i++)g.step(1/60,[{left:true},{}]);
  assert.ok(g.state.fighters[0].x<700);
  assert.equal(g.state.fighters[0].facing,-1);
});

test('kick startup is responsive and jump impulse is higher',()=>{
  assert.equal(Game.ATTACKS.kick.start,0.075);
  const g=new Game({mode:'training'});
  g.step(1/60,[{jump:true},{}]);
  assert.ok(g.state.fighters[0].vy>650);
});

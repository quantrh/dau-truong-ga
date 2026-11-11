import test from 'node:test';
import assert from 'node:assert/strict';
await import('../client/progression.js');
await import('../client/game-engine.js');
const P=globalThis.RoosterProgression;
const Game=globalThis.RoosterGame;

test('reward score uses diminishing capped power',()=>{
  assert.equal(P.rewardScore({grain:10,grasshopper:2,hen:1}),40);
  assert.equal(P.powerRating({grain:0,grasshopper:0,hen:0}),100);
  assert.ok(P.powerRating({hen:100})<=130);
});

test('balanced mode always neutralizes accumulated power',()=>{
  const rules=P.matchRules('balanced',{hen:100},{grain:1000});
  assert.deepEqual(rules,{powerMode:'balanced',powerRatings:[100,100]});
});

test('progression mode increases damage but remains capped',()=>{
  const g=new Game({mode:'local'});
  g.setMatchRules({powerMode:'progression',powerRatings:[130,100]});
  g.state.phase='fight'; g.state.phaseTime=0; g.state.roundTime=75;
  const a=g.state.fighters[0], b=g.state.fighters[1];
  a.x=500;b.x=620;a.facing=1;b.facing=-1;
  a.attackType='peck';a.attackTimer=Game.ATTACKS.peck.start;a.attackConnected=false;
  const hp=b.hp;
  g.step(1/60,[{},{}]);
  assert.ok(b.hp<hp-Game.ATTACKS.peck.damage);
  assert.equal(a.powerRating,130);
});

test('airborne attacks are stronger than grounded attacks',()=>{
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

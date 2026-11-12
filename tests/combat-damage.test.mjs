import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

await import('../client/game-engine.js');
const Game=globalThis.RoosterGame;

function fightingGame(){
  const g=new Game({mode:'local'});
  g.state.phase='fight';
  g.state.roundTime=75;
  return g;
}

test('peck and kick both step the attacker forward when initiated',()=>{
  for(const kind of ['peck','kick']){
    const g=fightingGame();
    const a=g.state.fighters[0],b=g.state.fighters[1];
    a.x=400;b.x=700;a.facing=1;b.facing=-1;
    const before=a.x;
    const input=kind==='kick'?{kick:true}:{peck:true};
    g.step(1/60,[input,{}]);
    assert.ok(a.x>before+(kind==='kick'?20:10),kind+' should advance the fighter');
  }
});

function directDamage(kind,distance){
  const g=fightingGame();
  const a=g.state.fighters[0],b=g.state.fighters[1];
  a.x=500;b.x=500+distance;a.facing=1;b.facing=-1;
  const hp=b.hp;
  g._hit({a,b,attack:Game.ATTACKS[kind],kind});
  return hp-b.hp;
}

test('kick deals more damage than peck at the same contact distance',()=>{
  const distance=135;
  assert.ok(directDamage('kick',distance)>directDamage('peck',distance));
});

test('close contact deals more damage than a distant grazing hit',()=>{
  assert.ok(directDamage('peck',55)>directDamage('peck',140));
  assert.ok(directDamage('kick',70)>directDamage('kick',175));
});

test('health HUD is explicitly blood and has low-health danger state',async()=>{
  const shell=await readFile(new URL('../client/shell.html',import.meta.url),'utf8');
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok((shell.match(/>MÁU</g)||[]).length>=2);
  assert.ok(shell.includes('.health-fill.danger'));
  assert.ok(app.includes("classList.toggle('danger',f.hp<=30)"));
  assert.ok(app.includes("'Máu '+names[i]+': '+Math.ceil(f.hp)+' trên 100'"));
});

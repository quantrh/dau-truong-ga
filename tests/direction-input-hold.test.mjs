import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

await import('../client/game-engine.js');
const Game=globalThis.RoosterGame;

function trainingGame(){
  const g=new Game({mode:'training'});
  g.state.phase='fight';g.state.phaseTime=0;g.state.roundTime=75;
  return g;
}
function stepFrames(g,input,frames){
  for(let i=0;i<frames;i++)g.step(1/60,[input,{}]);
}

test('last pressed horizontal direction wins while both keys overlap',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes("const directionPriority=['','']"));
  assert.ok(app.includes("if(input.left&&input.right)"));
  assert.ok(app.includes("input.left=preferred==='left';input.right=preferred==='right'"));
  assert.ok(app.includes("if(e.code===map.left||e.code===map.right){"));
  assert.ok(app.includes("directionPriority[player]=e.code===map.left?'left':'right'"));
});

test('holding right keeps movement alive for several seconds after reversal',()=>{
  const g=trainingGame(),f=g.state.fighters[0];
  f.x=640;f.vx=0;
  stepFrames(g,{left:true},24);
  const leftX=f.x;
  assert.ok(leftX<640);
  stepFrames(g,{right:true},24);
  const afterTurn=f.x;
  assert.ok(afterTurn>leftX,'fighter should reverse and move right');
  stepFrames(g,{right:true},90);
  assert.ok(f.x>afterTurn+120,'held D should continue moving, not decay to a stop');
  assert.ok(f.vx>250,'held D should settle near running speed');
  assert.equal(f.facing,1);
});

test('held movement resumes automatically after peck and kick actions',()=>{
  for(const kind of ['peck','kick']){
    const g=trainingGame(),f=g.state.fighters[0];
    f.x=420;f.stamina=100;
    stepFrames(g,{right:true},15);
    const before=f.x;
    const attack=kind==='peck'?{right:true,peck:true}:{right:true,kick:true};
    g.step(1/60,[attack,{}]);
    stepFrames(g,{right:true},60);
    assert.ok(f.x>before+100,kind+' should not cancel a held direction');
    assert.ok(f.vx>200,kind+' should return to running speed while D remains held');
  }
});

test('releasing the older direction does not cancel the newer held direction',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes("document.addEventListener('keyup',e=>{"));
  assert.ok(app.includes("for(let player=0;player<2;player++)reconcileDirectionPriority(player)"));
  assert.ok(app.includes("if(other&&directionIsHeld(index,other)){directionPriority[index]=other;return;}"));
});

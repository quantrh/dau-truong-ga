import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('dodge render uses a dedicated crouched pose',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes("}else if(f.action==='dash'){"));
  assert.ok(app.includes("squash=.26+.08*crouch"));
  assert.ok(app.includes("bob=-18-10*crouch"));
  assert.ok(app.includes("const dashCrouch=f.action==='dash'?1:0"));
  assert.ok(app.includes("1-v.squash-(dashCrouch*.10)"));
});

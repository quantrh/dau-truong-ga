import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('mobile controls have raised 3D resting state',async()=>{
  const shell=await readFile(new URL('../client/shell.html',import.meta.url),'utf8');
  assert.ok(shell.includes('border-bottom:5px solid'));
  assert.ok(shell.includes('box-shadow:0 6px 0'));
  assert.ok(shell.includes('transform:translateY(0)'));
});

test('pressed mobile controls visibly sink down',async()=>{
  const shell=await readFile(new URL('../client/shell.html',import.meta.url),'utf8');
  assert.ok(shell.includes('.mobile-pad-btn.pressed,.mobile-pad-btn:active'));
  assert.ok(shell.includes('transform:translateY(5px) scale(.985)'));
  assert.ok(shell.includes('border-bottom-width:1px'));
  assert.ok(shell.includes('box-shadow:0 1px 0'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('mobile quick menu cannot be hidden by later base CSS', async()=>{
  const shell=await readFile(new URL('../client/shell.html',import.meta.url),'utf8');
  assert.ok(shell.includes('.mobile-quick-launch{display:grid!important;'));
  assert.ok(shell.includes('.mobile-quick-launch[hidden]{display:none!important}'));
});

test('mobile still has all quick modes and primary action', async()=>{
  const shell=await readFile(new URL('../client/shell.html',import.meta.url),'utf8');
  for(const mode of ['training','bot','local','online']){
    assert.ok(shell.includes('data-quick-mode="'+mode+'"'));
  }
  assert.ok(shell.includes('id="mobilePrimaryBtn"'));
});

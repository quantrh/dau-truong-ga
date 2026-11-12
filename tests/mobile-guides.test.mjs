import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('mobile quick launcher restores play setup and invite help access',async()=>{
  const shell=await readFile(new URL('../client/shell.html',import.meta.url),'utf8');
  for(const guide of ['play','setup','invite']){
    assert.ok(shell.includes('data-mobile-guide="'+guide+'"'));
  }
  assert.ok(shell.includes('id="mobileGuideDialog"'));
  assert.ok(shell.includes('Cách chơi'));
  assert.ok(shell.includes('Setup sân'));
  assert.ok(shell.includes('Mời bạn'));
});

test('mobile guide remains compact and modal instead of expanding lobby',async()=>{
  const shell=await readFile(new URL('../client/shell.html',import.meta.url),'utf8');
  assert.ok(shell.includes('.mobile-help-row{display:grid;grid-template-columns:repeat(4'));
  assert.ok(shell.includes('class="mobile-help-link"'));
  assert.ok(shell.includes('data-guide-section="play"'));
  assert.ok(shell.includes('data-guide-section="setup"'));
  assert.ok(shell.includes('data-guide-section="invite"'));
});

test('invite guide documents automatic room entry from invite link',async()=>{
  const shell=await readFile(new URL('../client/shell.html',import.meta.url),'utf8');
  assert.ok(shell.includes('tự vào phòng'));
  assert.ok(shell.includes('không cần nhập mã'));
});

test('guide buttons open the requested section',async()=>{
  const app=await readFile(new URL('../client/game-app.js',import.meta.url),'utf8');
  assert.ok(app.includes('function showMobileGuide(section)'));
  assert.ok(app.includes("dialog.querySelectorAll('[data-guide-section]')"));
  assert.ok(app.includes("document.querySelectorAll('[data-mobile-guide]')"));
});

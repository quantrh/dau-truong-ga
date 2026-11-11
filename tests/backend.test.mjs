import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { handleRoomRequest } from '../worker/rooms.js';

const SQL = await readFile(new URL('../drizzle/0000_rooms.sql', import.meta.url), 'utf8');
const hostToken = 'a'.repeat(64), guestToken = 'b'.repeat(64), otherToken = 'c'.repeat(64);

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SQL);
  const DB = {
    prepare(query) {
      return {
        bind(...params) {
          return {
            async first() { return sqlite.prepare(query).get(...params) || null; },
            async run() { const result = sqlite.prepare(query).run(...params); return { success: true, meta: { changes: Number(result.changes) } }; },
            async all() { return { results: sqlite.prepare(query).all(...params) }; }
          };
        }
      };
    }
  };
  async function api(path, body = {}, token, method = 'POST') {
    const request = new Request('https://game.example/api/rooms' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) })
    });
    const response = await handleRoomRequest(request, { DB });
    return { status: response.status, body: await response.json() };
  }
  return { sqlite, DB, api };
}

function statePacket(seq, x = 405) {
  return { type: 'state', seq, gameId: '1', paused: false, state: { version: 1, phase: 'fight', fighters: [{ x }, { x: 875 }], wins: [0, 0] } };
}

test('create is idempotent, never leaks credentials, and preserves Vietnamese names', async () => {
  const { api, sqlite } = fixture();
  const first = await api('', { name: '  Quân  Trương\n  ', sessionToken: hostToken });
  assert.equal(first.status, 201);
  assert.match(first.body.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  assert.equal(first.body.room.host.name, 'Quân Trương');
  assert.equal(first.body.room.guest, null);
  assert.equal(first.body.room.status, 'waiting');
  assert.match(first.body.room.peerKey, /^[a-f0-9]{32}$/);
  assert.equal(JSON.stringify(first.body).includes(hostToken), false);
  assert.equal(JSON.stringify(first.body).includes('hash'), false);
  const second = await api('', { name: 'Changed name', sessionToken: hostToken });
  assert.equal(second.status, 200);
  assert.equal(second.body.code, first.body.code);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM rooms').get().n, 1);
  sqlite.close();
});

test('concurrent create retries converge on one room', async () => {
  const { api, sqlite } = fixture();
  const responses = await Promise.all(Array.from({ length: 5 }, () => api('', { sessionToken: hostToken })));
  assert.equal(new Set(responses.map(r => r.body.code)).size, 1);
  assert.ok(responses.every(r => r.status === 200 || r.status === 201));
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM rooms').get().n, 1);
  sqlite.close();
});

test('two simultaneous guests cannot claim the same second slot', async () => {
  const { api, sqlite } = fixture();
  const created = await api('', { sessionToken: hostToken });
  const path = '/' + created.body.code;
  const responses = await Promise.all([
    api(path + '/join', { sessionToken: guestToken, name: 'Lan' }),
    api(path + '/join', { sessionToken: otherToken, name: 'Mai' })
  ]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(responses.find(r => r.status === 409).body.code, 'ROOM_FULL');
  const winningToken = responses[0].status === 200 ? guestToken : otherToken;
  const retry = await api(path + '/join', { sessionToken: winningToken, name: 'Retry' });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.role, 'guest');
  sqlite.close();
});

test('only room members read peer payloads; guest cannot write state; host cannot write opponent input', async () => {
  const { api, sqlite } = fixture();
  const created = await api('', { sessionToken: hostToken });
  const path = '/' + created.body.code;
  await api(path + '/join', { sessionToken: guestToken });
  assert.equal((await api(path + '/sync', { seq: 1, payload: {} }, otherToken)).status, 401);
  assert.equal((await api(path + '/sync', { seq: 1, payload: { state: statePacket(1) } }, guestToken)).status, 403);
  assert.equal((await api(path + '/sync', { seq: 1, payload: { input: { type: 'input', seq: 1, keys: {} } } }, hostToken)).status, 403);
  sqlite.close();
});

test('stale sync cannot overwrite newer state, presence is monotonic and peer fields stay separate', async () => {
  const { api, sqlite } = fixture();
  const created = await api('', { sessionToken: hostToken });
  const path = '/' + created.body.code;
  await api(path + '/join', { sessionToken: guestToken });
  await api(path + '/sync', { seq: 12, payload: { state: statePacket(12, 780) } }, hostToken);
  await api(path + '/sync', { seq: 7, payload: { state: statePacket(7, 440) } }, hostToken);
  const response = await api(path + '/sync', { seq: 3, payload: { input: { type: 'input', seq: 3, gameId: '1', focused: true, keys: { left: true }, actions: { jump: 3 } } } }, guestToken);
  assert.equal(response.status, 200);
  assert.equal(response.body.peer.seq, 12);
  assert.equal(response.body.peer.payload.state.state.fighters[0].x, 780);
  const host = await api(path + '/sync', { seq: 12, payload: {} }, hostToken);
  assert.equal(host.body.peer.seq, 3);
  assert.equal(host.body.peer.payload.input.keys.left, true);
  assert.equal(host.body.peer.payload.input.actions.jump, 3);
  sqlite.close();
});

test('readiness/start require both players and only host can start; retry does not reset match', async () => {
  const { api, sqlite } = fixture();
  const created = await api('', { sessionToken: hostToken });
  const path = '/' + created.body.code;
  assert.equal((await api(path + '/start', {}, hostToken)).status, 409);
  await api(path + '/join', { sessionToken: guestToken });
  await api(path + '/ready', { ready: true }, hostToken);
  assert.equal((await api(path + '/start', {}, hostToken)).status, 409);
  await api(path + '/ready', { ready: true }, guestToken);
  assert.equal((await api(path + '/start', {}, guestToken)).status, 403);
  const started = await api(path + '/start', {}, hostToken);
  assert.equal(started.status, 200);
  assert.equal(started.body.room.status, 'playing');
  const again = await api(path + '/start', {}, hostToken);
  assert.equal(again.status, 200);
  assert.equal(again.body.room.matchId, started.body.room.matchId);
  assert.equal((await api(path + '/ready', { ready: false }, guestToken)).status, 409);
  sqlite.close();
});

test('ready and online are separate and stale opponent cannot start', async () => {
  const { api, sqlite } = fixture();
  const created = await api('', { sessionToken: hostToken });
  const path = '/' + created.body.code;
  await api(path + '/join', { sessionToken: guestToken });
  await api(path + '/ready', { ready: true }, hostToken);
  await api(path + '/ready', { ready: true }, guestToken);
  sqlite.prepare('UPDATE rooms SET guest_seen = ? WHERE code = ?').run(Date.now() - 10000, created.body.code);
  const host = await api(path + '/sync', { seq: 1, payload: {} }, hostToken);
  assert.equal(host.body.room.guest.online, false);
  assert.equal(host.body.room.guest.ready, true);
  assert.equal((await api(path + '/start', {}, hostToken)).status, 409);
  sqlite.close();
});

test('explicit leave immediately closes for both and is idempotent', async () => {
  const { api, sqlite } = fixture();
  const created = await api('', { sessionToken: hostToken });
  const path = '/' + created.body.code;
  await api(path + '/join', { sessionToken: guestToken });
  const left = await api(path + '/leave', {}, guestToken);
  assert.equal(left.body.room.status, 'closed');
  assert.equal((await api(path + '/sync', { seq: 1, payload: {} }, hostToken)).status, 410);
  assert.equal((await api(path + '/join', { sessionToken: otherToken })).status, 410);
  assert.equal((await api(path + '/leave', {}, guestToken)).status, 200);
  sqlite.close();
});

test('abandoned peer closes a room even when survivor keeps syncing', async () => {
  const { api, sqlite } = fixture();
  const created = await api('', { sessionToken: hostToken });
  const path = '/' + created.body.code;
  await api(path + '/join', { sessionToken: guestToken });
  sqlite.prepare('UPDATE rooms SET guest_seen = ?, expires_at = ? WHERE code = ?').run(Date.now() - 61000, Date.now() + 60000, created.body.code);
  const response = await api(path + '/sync', { seq: 1, payload: {} }, hostToken);
  assert.equal(response.status, 410);
  assert.equal(response.body.code, 'ROOM_CLOSED');
  sqlite.close();
});

test('invalid/missing rooms, malformed inputs and oversized body produce bounded structured errors', async () => {
  const { api, DB, sqlite } = fixture();
  assert.equal((await api('', { sessionToken: 'short' })).status, 401);
  assert.equal((await api('/ABCDEF/join', { sessionToken: guestToken })).status, 404);
  const created = await api('', { sessionToken: hostToken, name: 'á'.repeat(40) });
  assert.equal(Array.from(created.body.room.host.name).length, 24);
  const path = '/' + created.body.code;
  assert.equal((await api(path + '/sync', { seq: -2, payload: {} }, hostToken)).status, 400);
  assert.equal((await api(path + '/sync', { seq: 1, payload: { unknown: 'value' } }, hostToken)).status, 400);
  assert.equal((await api(path + '/sync', { seq: 1, payload: { state: statePacket(1), control: { type: 'rematch-request', id: 1, gameId: '1', text: 'x'.repeat(25000) } } }, hostToken)).status, 413);
  assert.equal((await api('', { sessionToken: hostToken, name: 'x'.repeat(40000) })).status, 413);
  const invalid = await handleRoomRequest(new Request('https://game.example/api/rooms', { method: 'POST', body: '{bad' }), { DB });
  assert.equal(invalid.status, 400);
  assert.equal((await api('', {}, undefined, 'GET')).status, 405);
  sqlite.close();
});

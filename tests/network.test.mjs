import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { handleRoomRequest } from '../worker/rooms.js';
await import('../client/rooster-net.js');
await import('../client/game-engine.js');
const RoosterNet = globalThis.RoosterNet;
const RoosterGame = globalThis.RoosterGame;
const SQL = await readFile(new URL('../drizzle/0000_rooms.sql', import.meta.url), 'utf8');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, ms = 1500) {
  const start = Date.now();
  while (!fn()) { if (Date.now() - start > ms) assert.fail('Timed out awaiting expected state'); await pause(8); }
}
const snapshot = x => ({ version: 1, phase: 'fight', fighters: [{ x }, { x: 875 }], wins: [0, 0] });
function fixture() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(SQL);
  const DB = { prepare(sql) { return { bind(...args) { return {
    async first() { return sqlite.prepare(sql).get(...args) || null; },
    async run() { return { meta: { changes: sqlite.prepare(sql).run(...args).changes } }; }
  }; } }; } };
  const clients = [], requests = [], active = new Map(), maxActive = new Map();
  const state = { latency: 0, syncFailures: 0 };
  const fetch = async (url, options) => {
    const request = new Request(url, options), path = new URL(url).pathname;
    const key = request.headers.get('Authorization');
    requests.push({ path, key, body: JSON.parse(options.body || '{}') });
    if (path.endsWith('/sync')) {
      active.set(key, (active.get(key) || 0) + 1);
      maxActive.set(key, Math.max(maxActive.get(key) || 0, active.get(key)));
    }
    try {
      if (state.latency) await pause(state.latency);
      if (path.endsWith('/sync') && state.syncFailures) { state.syncFailures--; throw new TypeError('Simulated offline'); }
      return await handleRoomRequest(request, { DB });
    } finally { if (path.endsWith('/sync')) active.set(key, active.get(key) - 1); }
  };
  const create = options => {
    const client = new RoosterNet({ baseUrl: 'https://game.example', forceRelay: true, pollInterval: 12, fetch, ...options });
    clients.push(client); return client;
  };
  return { create, requests, state, maxActive, async close() { for (const client of clients) client.close(true); await pause(state.latency + 30); sqlite.close(); } };
}

test('HTTP-only room has two named players and starts only after readiness and host action', async () => {
  const f = fixture();
  try {
    let hostConnects = 0, guestConnects = 0;
    const host = f.create({ onConnect() { hostConnects++; host.send({ type: 'start', seq: 1, state: snapshot(405) }); } });
    const guest = f.create({ onConnect() { guestConnects++; } });
    const code = await host.create('Quân');
    assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    await guest.join(code.toLowerCase(), 'Bạn của Quân');
    await until(() => host.lobby.guest);
    assert.equal(host.lobby.guest.name, 'Bạn của Quân');
    assert.equal(guest.lobby.host.name, 'Quân');
    assert.equal(host.connected, false); assert.equal(guest.connected, false);
    await assert.rejects(() => host.start(), /sẵn sàng/i);
    await host.setReady(true); await guest.setReady(true); await host.start();
    await until(() => guest.connected && guest._gameId === '1');
    assert.equal(hostConnects, 1); assert.equal(guestConnects, 1);
    assert.equal(host.transport, 'relay'); assert.equal(guest.transport, 'relay');
    await host.start(); await pause(30);
    assert.equal(hostConnects, 1); assert.equal(guestConnects, 1);
  } finally { await f.close(); }
});

test('latest snapshot synthesizes start, quick taps survive release, paused/focused fields survive relay', async () => {
  const f = fixture();
  try {
    const guestEvents = [], hostEvents = [];
    const host = f.create({ onData(packet) { hostEvents.push(packet); }, onConnect() {
      host.send({ type: 'start', seq: 1, state: snapshot(405) });
      host.send({ type: 'state', seq: 2, state: snapshot(650), paused: true });
    } });
    const guest = f.create({ onData(packet) { guestEvents.push(packet); } });
    const code = await host.create('Chủ'); await guest.join(code, 'Khách');
    await host.setReady(true); await guest.setReady(true); await host.start();
    await until(() => guestEvents.length);
    assert.equal(guestEvents[0].type, 'start');
    assert.equal(guestEvents[0].seq, 2);
    assert.equal(guestEvents[0].state.fighters[0].x, 650);
    assert.equal(guestEvents[0].paused, true);
    guest.send({ type: 'input', seq: 1, keys: { jump: true }, actions: { jump: 1, dash: 2 } });
    guest.send({ type: 'input', seq: 2, keys: {}, actions: { jump: 1, dash: 2 }, focused: false });
    await until(() => hostEvents.some(packet => packet.type === 'input'));
    const input = hostEvents.find(packet => packet.type === 'input');
    assert.equal(input.keys.jump, false);
    assert.equal(input.actions.jump, 1); assert.equal(input.actions.dash, 2);
    assert.equal(input.focused, false);
    const freshness = guest.lastPeerDataAt;
    await pause(80);
    assert.equal(guest.lastPeerDataAt, freshness, 'Repeated stale relay state must not look like a healthy stream');
    assert.equal(guestEvents.length, 1, 'Repeated latest state should be deduplicated');
  } finally { await f.close(); }
});

test('rematch messages persist once, new game resets peer, late old snapshots and inputs cannot roll back match', async () => {
  const f = fixture();
  try {
    const hostEvents = [], guestEvents = [];
    const host = f.create({ onData(packet) { hostEvents.push(packet); }, onConnect() { host.send({ type: 'start', seq: 1, state: snapshot(405) }); } });
    const guest = f.create({ onData(packet) { guestEvents.push(packet); } });
    await guest.join(await host.create('Chủ'), 'Khách');
    await host.setReady(true); await guest.setReady(true); await host.start();
    await until(() => guest._gameId === '1');
    guest.send({ type: 'rematch-request' });
    await until(() => hostEvents.some(packet => packet.type === 'rematch-request'));
    await pause(80);
    assert.equal(hostEvents.filter(packet => packet.type === 'rematch-request').length, 1);
    const oldInput = { type: 'input', gameId: '1', seq: 80, keys: { right: true } };
    host.send({ type: 'start', seq: 2, state: snapshot(405) });
    host.send({ type: 'state', seq: 3, state: snapshot(700) });
    await until(() => guest._gameId === '2');
    assert.equal(guestEvents.filter(packet => packet.type === 'start').length, 2);
    assert.equal(guestEvents.at(-1).state.fighters[0].x, 700);
    guest._acceptPayload({ state: { type: 'state', gameId: '1', seq: 999, state: snapshot(1) } });
    host._acceptPayload({ input: oldInput });
    assert.equal(guest._gameId, '2');
    assert.equal(hostEvents.some(packet => packet.type === 'input' && packet.seq === 80), false);
    guest.send({ type: 'input', seq: 1, keys: { left: true }, actions: { jump: 0 } });
    await until(() => hostEvents.some(packet => packet.type === 'input' && packet.gameId === '2'));
  } finally { await f.close(); }
});

test('full room and wrong code are actionable errors while the established players remain connected', async () => {
  const f = fixture();
  try {
    const host = f.create(), guest = f.create(), third = f.create();
    const code = await host.create('Chủ'); await guest.join(code, 'Khách');
    await assert.rejects(() => third.join(code, 'Người ba'), /đủ hai người/);
    assert.equal(third._joined, false); assert.equal(host._joined, true); assert.equal(guest._joined, true);
    await assert.rejects(() => third.join('AAAAAA', 'Sai phòng'), /Không tìm thấy phòng/);
    await assert.rejects(() => third.join('bad!', 'Sai mã'), /6 ký tự/);
  } finally { await f.close(); }
});

test('poll requests never overlap and transient fetch failure recovers without another onConnect', async () => {
  const f = fixture();
  try {
    f.state.latency = 20;
    let starts = 0;
    const host = f.create({ onConnect() { starts++; host.send({ type: 'start', seq: 1, state: snapshot(405) }); } });
    const guest = f.create();
    await guest.join(await host.create('Chủ'), 'Khách');
    await host.setReady(true); await guest.setReady(true); await host.start();
    await until(() => guest._gameId === '1');
    f.state.syncFailures = 1;
    await pause(120);
    await pause(1050);
    assert.equal(host.connected, true); assert.equal(guest.connected, true); assert.equal(starts, 1);
    assert.ok([...f.maxActive.values()].every(count => count === 1));
  } finally { await f.close(); }
});

test('leaving closes peer promptly, and cancelling an in-flight create cannot resurrect a room UI', async () => {
  const f = fixture();
  try {
    let disconnected = 0;
    const host = f.create({ onDisconnect() { disconnected++; } });
    const guest = f.create();
    await guest.join(await host.create('Chủ'), 'Khách');
    guest.close();
    await until(() => disconnected === 1);
    assert.equal(host.connected, false); assert.equal(host._joined, false);
    f.state.latency = 35;
    let lobbyCalls = 0;
    const cancelled = f.create({ onLobby() { lobbyCalls++; } });
    const pending = cancelled.create('Hủy'); cancelled.close(true);
    await assert.rejects(pending, error => error.cancelled === true);
    assert.equal(lobbyCalls, 0); assert.equal(cancelled.room, ''); assert.equal(cancelled._joined, false);
  } finally { await f.close(); }
});

test('optional direct handshake carries game data and falls back to HTTP after the channel closes', async () => {
  const previousPeer = globalThis.Peer;
  const registry = new Map(); let serial = 0;
  class Channel extends EventEmitter {
    constructor(metadata) { super(); this.metadata = metadata; this.open = false; this.closed = false; }
    send(data) {
      if (!this.open || this.closed) throw new Error('closed');
      const copy = structuredClone(data);
      setTimeout(() => { if (!this.other.closed) this.other.emit('data', copy); }, 0);
    }
    close() {
      if (this.closed) return;
      this.closed = true; this.open = false; this.emit('close');
      if (this.other && !this.other.closed) this.other.close();
    }
  }
  class Peer extends EventEmitter {
    constructor(id) {
      super(); this.id = id || 'guest-' + (++serial); this.open = false; this.destroyed = false; registry.set(this.id, this);
      setTimeout(() => { if (!this.destroyed) { this.open = true; this.emit('open', this.id); } }, 0);
    }
    connect(id, options) {
      const target = registry.get(id), a = new Channel(options.metadata), b = new Channel(options.metadata);
      a.other = b; b.other = a;
      setTimeout(() => {
        if (!target || target.destroyed) { this.emit('error', { type: 'peer-unavailable' }); return; }
        target.emit('connection', b); a.open = b.open = true; b.emit('open'); a.emit('open');
      }, 0);
      return a;
    }
    destroy() { this.destroyed = true; this.open = false; registry.delete(this.id); }
  }
  globalThis.Peer = Peer;
  const f = fixture();
  try {
    const guestEvents = [], hostEvents = [];
    const host = f.create({ forceRelay: false, onData(packet) { hostEvents.push(packet); }, onConnect() { host.send({ type: 'start', seq: 1, state: snapshot(405) }); } });
    const guest = f.create({ forceRelay: false, onData(packet) { guestEvents.push(packet); } });
    await guest.join(await host.create('Chủ'), 'Khách');
    await until(() => host.transport === 'direct' && guest.transport === 'direct');
    assert.notEqual(host.connection.metadata.key, host._token);
    assert.notEqual(host.connection.metadata.key, guest._token);
    await host.setReady(true); await guest.setReady(true); await host.start();
    await until(() => guest._gameId === '1');
    guest.send({ type: 'input', seq: 1, keys: { right: true }, actions: { jump: 1 } });
    await until(() => hostEvents.some(packet => packet.seq === 1 && packet.type === 'input'));
    host.connection.close();
    assert.equal(host.transport, 'relay'); assert.equal(guest.transport, 'relay');
    host.send({ type: 'state', seq: 2, state: snapshot(620) });
    guest.send({ type: 'input', seq: 2, keys: { left: true }, actions: { jump: 2 } });
    await until(() => guestEvents.some(packet => packet.seq === 2) && hostEvents.some(packet => packet.seq === 2));
    assert.equal(host.connected, true); assert.equal(guest.connected, true);
  } finally { await f.close(); globalThis.Peer = previousPeer; }
});

test('real game engine receives remote movement and damage, mirrors final state, and resets on rematch', async () => {
  const f = fixture();
  let simulationTimer;
  try {
    const hostGame = new RoosterGame({ mode: 'online', seed: 42 });
    const guestGame = new RoosterGame({ mode: 'online', seed: 42 });
    const idle = () => ({ left: false, right: false, jump: false, peck: false, kick: false, guard: false, dash: false });
    let remoteInput = idle(), stateSeq = 0, receivedStateSeq = 0;
    const host = f.create({
      onConnect() { hostGame.reset('online'); host.send({ type: 'start', seq: ++stateSeq, state: hostGame.snapshot() }); },
      onData(packet) { if (packet.type === 'input') remoteInput = packet.keys; }
    });
    const guest = f.create({
      onData(packet) {
        if (packet.type === 'start' || packet.type === 'state') {
          assert.equal(guestGame.loadSnapshot(packet.state), true, 'Real engine must accept the relayed full snapshot');
          receivedStateSeq = packet.seq;
        }
      }
    });
    await guest.join(await host.create('Chủ sân'), 'Bạn chơi');
    await host.setReady(true); await guest.setReady(true); await host.start();
    await until(() => guest._gameId === '1');
    const initialGuestX = hostGame.state.fighters[1].x;
    // Accelerate only simulation time; input and state still cross actual API
    // requests and the SQLite relay at a bounded 12 ms test cadence.
    simulationTimer = setInterval(() => {
      hostGame.step(0.1, [idle(), remoteInput]);
      host.send({ type: 'state', seq: ++stateSeq, state: hostGame.snapshot() });
    }, 12);
    guest.send({ type: 'input', seq: 1, keys: { left: true }, actions: {} });
    await until(() => hostGame.state.phase === 'fight' && hostGame.state.fighters[1].x - hostGame.state.fighters[0].x < 150, 1800);
    assert.ok(hostGame.state.fighters[1].x < initialGuestX - 200, 'Remote guest movement must advance its rooster toward the opponent');
    guest.send({ type: 'input', seq: 2, keys: { peck: true }, actions: { peck: 1 } });
    await until(() => hostGame.state.fighters[0].hp < 100, 600);
    clearInterval(simulationTimer); simulationTimer = null;
    assert.ok(hostGame.state.fighters[1].damageDone > 0, 'The remote attack must cause real engine damage');
    const finalState = hostGame.snapshot();
    host.send({ type: 'state', seq: ++stateSeq, state: finalState });
    const finalSequence = stateSeq;
    await until(() => receivedStateSeq === finalSequence);
    assert.deepEqual(guestGame.state.fighters.map(fighter => fighter.hp), finalState.fighters.map(fighter => fighter.hp));
    assert.deepEqual(guestGame.state.fighters.map(({ x, y }) => ({ x, y })), finalState.fighters.map(({ x, y }) => ({ x, y })));
    assert.equal(guestGame.state.round, finalState.round);
    assert.equal(guestGame.state.roundTime, finalState.roundTime);
    assert.equal(guestGame.state.phase, finalState.phase);
    assert.deepEqual(guestGame.state.wins, finalState.wins);
    // This is the same reset/start exchange used by the controller after both
    // players accept a rematch; the earlier test covers that acceptance flow.
    hostGame.reset('online');
    host.send({ type: 'start', seq: ++stateSeq, state: hostGame.snapshot() });
    await until(() => guest._gameId === '2' && receivedStateSeq === stateSeq);
    assert.deepEqual(guestGame.state.fighters.map(fighter => fighter.hp), [100, 100]);
    assert.deepEqual(guestGame.state.fighters.map(fighter => fighter.x), [405, 875]);
    assert.deepEqual(guestGame.state.wins, [0, 0]);
    assert.equal(guestGame.state.round, 1);
    assert.equal(guestGame.state.phase, 'countdown');
  } finally { if (simulationTimer) clearInterval(simulationTimer); await f.close(); }
});


test('guest can queue input immediately when room becomes playing', async () => {
  const f = fixture();
  try {
    const hostEvents = [];
    const host = f.create({ onConnect() { host.send({ type: 'start', seq: 1, state: snapshot(405) }); }, onData(packet) { if(packet.type==='input') hostEvents.push(packet); } });
    const guest = f.create();
    await guest.join(await host.create('Chủ'), 'Khách');
    await host.setReady(true); await guest.setReady(true); await host.start();
    await until(() => guest.connected);
    assert.equal(guest._gameId, '1');
    guest.send({ type: 'input', seq: 1, keys: { right: true }, actions: {} });
    await until(() => hostEvents.some(packet => packet.seq === 1 && packet.keys.right === true));
  } finally { await f.close(); }
});

test('send during in-flight poll forces an immediate follow-up sync', async () => {
  const f = fixture();
  try {
    f.state.latency = 35;
    const hostEvents = [];
    const host = f.create({ onConnect() { host.send({ type: 'start', seq: 1, state: snapshot(405) }); }, onData(packet) { if(packet.type==='input') hostEvents.push(packet); } });
    const guest = f.create();
    await guest.join(await host.create('Chủ'), 'Khách');
    await host.setReady(true); await guest.setReady(true); await host.start();
    await until(() => guest.connected);
    guest._poll();
    await pause(5);
    guest.send({ type: 'input', seq: 2, keys: { left: true }, actions: {} });
    await until(() => hostEvents.some(packet => packet.seq === 2 && packet.keys.left === true), 2000);
  } finally { await f.close(); }
});

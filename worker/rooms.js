/* Two-player room coordination and HTTPS relay. The D1 row is authoritative;
 * no correctness-sensitive state lives in a Worker isolate. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_BODY = 32768;
const MAX_PAYLOAD = 24576;
const ONLINE_MS = 5000;
const LOBBY_TTL_MS = 90000;
const GAME_TTL_MS = 60000;
const MAX_ROOM_AGE_MS = 4 * 60 * 60 * 1000;
const INPUT_KEYS = ['left', 'right', 'jump', 'peck', 'kick', 'guard', 'dash'];
const ACTION_KEYS = ['jump', 'peck', 'kick', 'dash'];

class RoomError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const fail = (status, code, message) => { throw new RoomError(status, code, message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});

function randomHex(bytes = 16) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function roomCode() {
  // Alphabet length is 32, so byte modulo has no bias.
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), byte => ALPHABET[byte % ALPHABET.length]).join('');
}

async function hashToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    fail(401, 'UNAUTHORIZED', 'Phiên kết nối không hợp lệ. Hãy tạo hoặc vào phòng lại.');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function cleanName(value, role) {
  if (value !== undefined && typeof value !== 'string') fail(400, 'INVALID_NAME', 'Tên người chơi cần là văn bản.');
  const name = (value || '').normalize('NFC').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(name).slice(0, 24).join('') || (role === 'host' ? 'Chủ phòng' : 'Bạn chơi');
}

async function readBody(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY) fail(413, 'BODY_TOO_LARGE', 'Dữ liệu kết nối quá lớn. Hãy tải lại trò chơi.');
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY) {
        await reader.cancel();
        fail(413, 'BODY_TOO_LARGE', 'Dữ liệu kết nối quá lớn. Hãy tải lại trò chơi.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = length ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) : {}; }
  catch (_) { fail(400, 'INVALID_JSON', 'Dữ liệu kết nối không hợp lệ. Hãy thử lại.'); }
  if (!object(body)) fail(400, 'INVALID_JSON', 'Dữ liệu kết nối không hợp lệ.');
  return body;
}

function validTree(value, depth = 0) {
  if (depth > 12) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 256 && value.every(item => validTree(item, depth + 1));
  if (!object(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 128 && entries.every(([key, item]) => !['__proto__', 'prototype', 'constructor'].includes(key) && validTree(item, depth + 1));
}

function validGameId(value) { return value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= 80); }

function validatePayload(payload, role) {
  if (!object(payload) || !validTree(payload)) fail(400, 'INVALID_PAYLOAD', 'Dữ liệu trận đấu không hợp lệ.');
  const allowed = ['state', 'input', 'control'];
  if (Object.keys(payload).some(key => !allowed.includes(key))) fail(400, 'INVALID_PAYLOAD', 'Dữ liệu trận đấu không hợp lệ.');
  if (role === 'guest' && payload.state !== undefined) fail(403, 'WRONG_ROLE', 'Chỉ chủ phòng có thể đồng bộ trạng thái trận đấu.');
  if (role === 'host' && payload.input !== undefined) fail(403, 'WRONG_ROLE', 'Chủ phòng không được gửi phím của đối thủ.');
  if (payload.state !== undefined) {
    const packet = payload.state;
    if (!object(packet) || !['state', 'start'].includes(packet.type) || !integer(packet.seq) || !validGameId(packet.gameId) || !object(packet.state)) {
      fail(400, 'INVALID_STATE', 'Trạng thái trận đấu không hợp lệ.');
    }
    const state = packet.state;
    if (state.version !== 1 || !['countdown', 'fight', 'roundEnd', 'matchEnd'].includes(state.phase) || !Array.isArray(state.fighters) || state.fighters.length !== 2 || !Array.isArray(state.wins) || state.wins.length !== 2) {
      fail(400, 'INVALID_STATE', 'Trạng thái trận đấu không hợp lệ.');
    }
  }
  if (payload.input !== undefined) {
    const packet = payload.input;
    if (!object(packet) || packet.type !== 'input' || !integer(packet.seq) || !validGameId(packet.gameId) || !object(packet.keys) || Object.entries(packet.keys).some(([key, value]) => !INPUT_KEYS.includes(key) || typeof value !== 'boolean')) {
      fail(400, 'INVALID_INPUT', 'Phím điều khiển không hợp lệ.');
    }
    if (packet.actions !== undefined && (!object(packet.actions) || Object.entries(packet.actions).some(([key, value]) => !ACTION_KEYS.includes(key) || !integer(value)))) {
      fail(400, 'INVALID_INPUT', 'Phím điều khiển không hợp lệ.');
    }
  }
  if (payload.control !== undefined) {
    const packet = payload.control;
    if (!object(packet) || packet.type !== 'rematch-request' || !validGameId(packet.gameId) || !(integer(packet.id) || (typeof packet.id === 'string' && packet.id.length > 0 && packet.id.length <= 80))) {
      fail(400, 'INVALID_CONTROL', 'Yêu cầu đấu lại không hợp lệ.');
    }
  }
  const serialized = JSON.stringify(payload);
  if (new TextEncoder().encode(serialized).byteLength > MAX_PAYLOAD) fail(413, 'PAYLOAD_TOO_LARGE', 'Dữ liệu trận đấu quá lớn. Hãy tải lại trò chơi.');
  return serialized;
}

function isExpired(row, now) {
  if (row.expires_at <= now || now - row.created_at > MAX_ROOM_AGE_MS) return true;
  const ttl = row.status === 'playing' ? GAME_TTL_MS : LOBBY_TTL_MS;
  if (now - row.host_seen > ttl) return true;
  return row.guest_hash && now - row.guest_seen > GAME_TTL_MS;
}

function responseData(row, role, now) {
  const other = role === 'host' ? 'guest' : 'host';
  let payload = {};
  try { payload = JSON.parse(row[other + '_payload'] || '{}'); } catch (_) {}
  return {
    code: row.code,
    role,
    room: {
      code: row.code,
      status: row.status,
      matchId: row.match_id,
      peerKey: row.peer_key,
      host: { name: row.host_name, ready: !!row.host_ready, online: row.status !== 'closed' && now - row.host_seen <= ONLINE_MS },
      guest: row.guest_hash ? { name: row.guest_name, ready: !!row.guest_ready, online: row.status !== 'closed' && now - row.guest_seen <= ONLINE_MS } : null
    },
    peer: { seq: row[other + '_seq'], payload },
    serverTime: now
  };
}

async function getRoom(db, code) {
  return db.prepare('SELECT * FROM rooms WHERE code = ?').bind(code).first();
}

async function requireActive(db, row, now) {
  if (row.status === 'closed') fail(410, 'ROOM_CLOSED', 'Phòng đã đóng. Hãy tạo phòng mới để tiếp tục.');
  if (isExpired(row, now)) {
    await db.prepare("UPDATE rooms SET status = 'closed', updated_at = ?, expires_at = ? WHERE code = ? AND status != 'closed'").bind(now, now + 60000, row.code).run();
    fail(410, 'ROOM_CLOSED', 'Phòng đã hết thời gian kết nối. Hãy tạo phòng mới.');
  }
}

async function createRoom(db, body, now, ctx) {
  const hash = await hashToken(body.sessionToken);
  const name = cleanName(body.name, 'host');
  const existing = await db.prepare('SELECT * FROM rooms WHERE host_hash = ?').bind(hash).first();
  if (existing) {
    await requireActive(db, existing, now);
    return json(responseData(existing, 'host', now));
  }
  const cleanup = () => db.prepare('DELETE FROM rooms WHERE code IN (SELECT code FROM rooms WHERE expires_at < ? ORDER BY expires_at LIMIT 50)').bind(now - 60000).run();
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(cleanup().catch(() => {}));
  else await cleanup();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = roomCode();
    // Both the code and host hash are unique; INSERT OR IGNORE makes concurrent
    // retries converge on one room without relying on an isolate-local lock.
    const created = await db.prepare("INSERT OR IGNORE INTO rooms (code, match_id, peer_key, host_hash, host_name, host_seen, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *")
      .bind(code, randomHex(), randomHex(), hash, name, now, now, now, now + LOBBY_TTL_MS).first();
    if (created) return json(responseData(created, 'host', now), 201);
    const raced = await db.prepare('SELECT * FROM rooms WHERE host_hash = ?').bind(hash).first();
    if (raced) { await requireActive(db, raced, now); return json(responseData(raced, 'host', now)); }
  }
  fail(503, 'CREATE_RETRY', 'Máy chủ đang bận. Hãy thử tạo phòng lại.');
}

async function joinRoom(db, code, body, now) {
  const hash = await hashToken(body.sessionToken);
  const name = cleanName(body.name, 'guest');
  let row = await getRoom(db, code);
  if (!row) fail(404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng. Hãy kiểm tra lại mã 6 ký tự.');
  await requireActive(db, row, now);
  if (row.host_hash === hash) fail(409, 'ALREADY_HOST', 'Bạn đang là chủ phòng này. Hãy gửi mã cho bạn của bạn.');
  if (row.guest_hash === hash) return json(responseData(row, 'guest', now));
  if (row.guest_hash || row.status !== 'waiting') fail(409, 'ROOM_FULL', 'Phòng đã đủ hai người. Hãy dùng mã phòng khác.');
  try {
    row = await db.prepare("UPDATE rooms SET guest_hash = ?, guest_name = ?, guest_seen = ?, guest_ready = 0, updated_at = ?, expires_at = ? WHERE code = ? AND status = 'waiting' AND guest_hash IS NULL AND host_seen > ? RETURNING *")
      .bind(hash, name, now, now, now + LOBBY_TTL_MS, code, now - LOBBY_TTL_MS).first();
  } catch (error) {
    if (/unique|constraint/i.test(String(error.message))) fail(409, 'SESSION_IN_USE', 'Phiên kết nối này đã ở phòng khác. Hãy thử vào phòng lại.');
    throw error;
  }
  if (!row) {
    const raced = await getRoom(db, code);
    if (raced && raced.guest_hash === hash) return json(responseData(raced, 'guest', now));
    if (raced) await requireActive(db, raced, now);
    fail(409, 'ROOM_FULL', 'Phòng đã đủ hai người. Hãy dùng mã phòng khác.');
  }
  return json(responseData(row, 'guest', now));
}

async function memberAction(db, request, code, action, body, now) {
  const authorization = request.headers.get('authorization') || '';
  const hash = await hashToken(authorization.startsWith('Bearer ') ? authorization.slice(7) : '');
  let row = await getRoom(db, code);
  if (!row) fail(404, 'ROOM_NOT_FOUND', 'Không tìm thấy phòng. Hãy kiểm tra mã hoặc tạo phòng mới.');
  const role = row.host_hash === hash ? 'host' : row.guest_hash === hash ? 'guest' : null;
  if (!role) fail(401, 'UNAUTHORIZED', 'Bạn chưa tham gia phòng này. Hãy nhập mã phòng để tham gia.');

  if (action === 'leave') {
    row = await db.prepare("UPDATE rooms SET status = 'closed', updated_at = ?, expires_at = ? WHERE code = ? RETURNING *").bind(now, now + 60000, code).first();
    return json(responseData(row, role, now));
  }
  await requireActive(db, row, now);
  const ttl = row.status === 'playing' ? GAME_TTL_MS : LOBBY_TTL_MS;

  if (action === 'sync') {
    if (!integer(body.seq)) fail(400, 'INVALID_SEQUENCE', 'Thứ tự dữ liệu kết nối không hợp lệ.');
    const payload = validatePayload(body.payload || {}, role);
    // role is selected above from two fixed strings, never supplied by caller.
    // Each assignment reads the old sequence, so a stale request can refresh
    // presence without overwriting any newer state or any opponent fields.
    row = await db.prepare(`UPDATE rooms SET ${role}_payload = CASE WHEN ? > ${role}_seq THEN ? ELSE ${role}_payload END, ${role}_seq = MAX(${role}_seq, ?), ${role}_seen = MAX(${role}_seen, ?), updated_at = MAX(updated_at, ?), expires_at = MAX(expires_at, ?) WHERE code = ? AND status != 'closed' RETURNING *`)
      .bind(body.seq, payload, body.seq, now, now, now + ttl, code).first();
    if (!row) fail(410, 'ROOM_CLOSED', 'Phòng đã đóng. Hãy tạo phòng mới.');
    return json(responseData(row, role, now));
  }
  if (action === 'ready') {
    if (typeof body.ready !== 'boolean') fail(400, 'INVALID_READY', 'Trạng thái sẵn sàng không hợp lệ.');
    if (row.status !== 'waiting') fail(409, 'ALREADY_PLAYING', 'Trận đấu đã bắt đầu.');
    row = await db.prepare(`UPDATE rooms SET ${role}_ready = ?, ${role}_seen = ?, updated_at = ?, expires_at = ? WHERE code = ? AND status = 'waiting' RETURNING *`)
      .bind(body.ready ? 1 : 0, now, now, now + LOBBY_TTL_MS, code).first();
    if (!row) fail(409, 'ALREADY_PLAYING', 'Trận đấu đã bắt đầu hoặc phòng đã đóng.');
    return json(responseData(row, role, now));
  }
  if (action === 'start') {
    if (role !== 'host') fail(403, 'HOST_ONLY', 'Chỉ chủ phòng có thể bắt đầu trận đấu.');
    if (row.status === 'playing') return json(responseData(row, role, now));
    row = await db.prepare("UPDATE rooms SET status = 'playing', host_seen = ?, updated_at = ?, expires_at = ? WHERE code = ? AND status = 'waiting' AND guest_hash IS NOT NULL AND host_ready = 1 AND guest_ready = 1 AND host_seen > ? AND guest_seen > ? RETURNING *")
      .bind(now, now, now + GAME_TTL_MS, code, now - ONLINE_MS, now - ONLINE_MS).first();
    if (!row) {
      const current = await getRoom(db, code);
      if (current && current.status === 'playing') return json(responseData(current, role, now));
      if (current) await requireActive(db, current, now);
      fail(409, 'NOT_READY', 'Cần đủ hai người đang kết nối và cùng nhấn Sẵn sàng.');
    }
    return json(responseData(row, role, now));
  }
  fail(404, 'NOT_FOUND', 'Không tìm thấy thao tác này.');
}

export async function handleRoomRequest(request, env, ctx) {
  try {
    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Thao tác này cần gửi bằng POST.', code: 'METHOD_NOT_ALLOWED' }), { status: 405, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Allow': 'POST' } });
    if (!env || !env.DB) fail(503, 'SERVICE_UNAVAILABLE', 'Máy chủ phòng đang khởi động. Vui lòng thử lại sau ít giây.');
    const pathname = new URL(request.url).pathname.replace(/\/$/, '');
    const route = /^\/api\/rooms\/([A-Z0-9]{6})\/(join|sync|ready|start|leave)$/.exec(pathname);
    if (pathname !== '/api/rooms' && !route) fail(404, 'NOT_FOUND', 'Đường dẫn phòng không hợp lệ.');
    const body = await readBody(request);
    const now = Date.now();
    if (pathname === '/api/rooms') return await createRoom(env.DB, body, now, ctx);
    if (route[2] === 'join') return await joinRoom(env.DB, route[1], body, now);
    return await memberAction(env.DB, request, route[1], route[2], body, now);
  } catch (error) {
    if (error instanceof RoomError) return json({ error: error.message, code: error.code }, error.status);
    console.error('Room API failure', error && error.message ? String(error.message).slice(0, 300) : 'Unknown server error');
    return json({ error: 'Máy chủ phòng tạm thời không phản hồi. Hãy thử lại sau ít giây.', code: 'SERVER_ERROR' }, 503);
  }
}

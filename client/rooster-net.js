/* Internet rooms: authenticated HTTPS relay, with an optional direct WebRTC
 * fast path. A room never depends on PeerJS or a particular NAT configuration. */
(function (root) {
  'use strict';
  const PROTOCOL = 'rooster-room-v3';
  const INPUT_KEYS = ['left', 'right', 'jump', 'peck', 'kick', 'guard', 'dash'];
  const ACTION_KEYS = ['jump', 'peck', 'kick', 'dash'];
  const noop = function () {};
  const cleanCode = value => String(value || '').trim().toUpperCase().replace(/[\s-]/g, '');
  const validCode = value => /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(cleanCode(value));
  const clone = value => JSON.parse(JSON.stringify(value));
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const cleanName = value => Array.from(String(value || '').normalize('NFC').trim()).slice(0, 24).join('');
  const randomToken = () => Array.from(root.crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  const gameNumber = value => typeof value === 'string' && /^[1-9][0-9]{0,8}$/.test(value) ? Number(value) : 0;

  function validTree(value, depth = 0, budget = { count: 4096 }) {
    if (depth > 12 || --budget.count < 0) return false;
    if (value === null || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string') return value.length <= 12000;
    if (Array.isArray(value)) return value.length <= 256 && value.every(item => validTree(item, depth + 1, budget));
    if (!value || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    const entries = Object.entries(value);
    return entries.length <= 128 && entries.every(([key, item]) => !['__proto__', 'prototype', 'constructor'].includes(key) && validTree(item, depth + 1, budget));
  }

  class RoosterNet {
    constructor(options = {}) {
      this.options = options;
      this.onStatus = options.onStatus || noop;
      this.onLobby = options.onLobby || noop;
      this.onConnect = options.onConnect || noop;
      this.onData = options.onData || noop;
      this.onDisconnect = options.onDisconnect || noop;
      this._fetch = options.fetch || (root.fetch && root.fetch.bind(root));
      const origin = options.baseUrl !== undefined ? options.baseUrl : (root.ROOSTER_ONLINE_API || root.ROOSTER_ONLINE_ORIGIN);
      this.baseUrl = String(origin || (root.location && /^https?:$/.test(root.location.protocol) ? root.location.origin : '')).replace(/\/$/, '');
      this.role = null;
      this.room = '';
      this.lobby = null;
      this.connected = false;
      this.ping = null;
      this.transport = 'relay';
      this.lastPeerDataAt = 0;
      this.lastServerAt = 0;
      this.peer = null;
      this.connection = null;
      this._generation = 0;
      this._controllers = new Set();
      this._timers = new Set();
      this._pollTimer = null;
      this._polling = false;
      this._pollAgain = false;
      this._token = '';
      this._joined = false;
      this._gameId = '0';
      this._payload = {};
      this._syncSeq = 0;
      this._controlSeq = 0;
      this._lastStateSeq = -1;
      this._lastInputSeq = -1;
      this._lastControlId = 0;
      this._directReady = false;
      this._directLastAt = 0;
      this._lastPeerAttempt = 0;
      this._statusSignature = '';
    }

    _emit(state, message) {
      const signature = state + ':' + message + ':' + this.room + ':' + this.transport;
      if (signature === this._statusSignature) return;
      this._statusSignature = signature;
      this.onStatus({ state, message, room: this.room, role: this.role, ping: this.ping, transport: this.transport });
    }

    _later(callback, delay) {
      const generation = this._generation;
      const timer = setTimeout(() => {
        this._timers.delete(timer);
        if (generation === this._generation) callback();
      }, delay);
      this._timers.add(timer);
      return timer;
    }

    _cancelTimer(timer) {
      clearTimeout(timer);
      this._timers.delete(timer);
    }

    async _request(path, body = {}, authenticated = true, generation = this._generation) {
      if (!this._fetch || !this.baseUrl) throw new Error('Hãy mở liên kết trò chơi online để tạo hoặc tham gia phòng.');
      const controller = new AbortController();
      this._controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), this.options.requestTimeout || 6500);
      const started = Date.now();
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (root.ROOSTER_SUPABASE_KEY) headers.apikey = root.ROOSTER_SUPABASE_KEY;
        if (authenticated) headers.Authorization = 'Bearer ' + this._token;
        const response = await this._fetch(this.baseUrl + path, {
          method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
          cache: 'no-store', credentials: 'omit'
        });
        let data;
        try { data = await response.json(); }
        catch (_) { throw new Error('Máy chủ phòng chưa phản hồi. Đang thử kết nối lại…'); }
        if (generation !== this._generation) throw Object.assign(new Error('Đã hủy kết nối.'), { cancelled: true });
        if (!response.ok) throw Object.assign(new Error(data.error || 'Không thực hiện được yêu cầu. Hãy thử lại.'), { status: response.status, code: data.code });
        this.lastServerAt = Date.now();
        if (!this._directReady) this.ping = Math.max(0, this.lastServerAt - started);
        return data;
      } catch (error) {
        if (generation !== this._generation) throw Object.assign(new Error('Đã hủy kết nối.'), { cancelled: true });
        if (error.status || error.cancelled) throw error;
        throw Object.assign(new Error('Kết nối Internet đang gián đoạn. Đang thử lại…'), { transient: true, cause: error });
      } finally {
        clearTimeout(timeout);
        this._controllers.delete(controller);
      }
    }

    async create(name, player) { return this._enter('host', '', name, player); }
    async join(code, name, player) {
      code = cleanCode(code);
      if (!validCode(code)) {
        const error = new Error('Nhập đúng mã phòng 6 ký tự do bạn của bạn gửi.');
        this._emit('error', error.message);
        throw error;
      }
      return this._enter('guest', code, name, player);
    }

    async _enter(role, code, name, player) {
      this.close(true);
      this.role = role;
      this.room = code;
      this._token = randomToken();
      this._payload = {};
      this._syncSeq = 0;
      this._controlSeq = 0;
      this._gameId = '0';
      this._lastStateSeq = this._lastInputSeq = -1;
      this._lastControlId = 0;
      this.lastPeerDataAt = this.lastServerAt = 0;
      this.ping = null;
      this._statusSignature = '';
      const generation = this._generation;
      const path = role === 'host' ? '/api/rooms' : '/api/rooms/' + code + '/join';
      const safePlayer = player && typeof player === 'object' && validTree(player) ? clone(player) : null;
      const body = { name: cleanName(name), sessionToken: this._token, player: safePlayer };
      this._emit('connecting', role === 'host' ? 'Đang tạo phòng online…' : 'Đang vào phòng ' + code + '…');
      try {
        let result;
        for (let attempt = 0; attempt < 2; attempt++) {
          try { result = await this._request(path, body, false, generation); break; }
          catch (error) { if (error.cancelled || error.status || attempt) throw error; }
        }
        if (generation !== this._generation) return null;
        if (!result || !validCode(result.code) || result.role !== role || !result.room) throw new Error('Phản hồi phòng không hợp lệ. Hãy thử lại.');
        this.room = result.code;
        this._joined = true;
        this._acceptResponse(result);
        this._ensurePeer();
        this._schedulePoll(0);
        return this.room;
      } catch (error) {
        if (generation === this._generation && !error.cancelled) this._fail(error.message, false);
        throw error;
      }
    }

    _acceptResponse(data) {
      const room = data && data.room;
      if (!room || room.code !== this.room || data.role !== this.role) throw new Error('Phản hồi phòng không hợp lệ.');
      if (room.status === 'closed') { this._fail('Đối thủ đã rời phòng hoặc phòng đã hết hạn. Hãy tạo phòng mới.', true); return; }
      // An older in-flight lobby response must not move a running game back to waiting.
      if (this.lobby && this.lobby.status === 'playing' && room.status === 'waiting') return;
      this.lobby = room;
      this.onLobby(room);
      if (room.status === 'playing' && !this.connected) {
        this.connected = true;
        this.lastPeerDataAt = Date.now();
        this.onConnect({ role: this.role, room: this.room });
      }
      if (this.connected) {
        if (data.peer && data.peer.payload) this._acceptPayload(data.peer.payload);
        if (this._pendingDirectPayload) {
          const pending = this._pendingDirectPayload;
          this._pendingDirectPayload = null;
          this._acceptPayload(pending);
        }
      }
      this._showStatus();
    }

    _showStatus() {
      if (!this._joined || !this.lobby) return;
      if (this.connected) {
        this._emit('connected', this._directReady ? 'Đang chơi online · Kết nối trực tiếp.' : 'Đang chơi online · Máy chủ chuyển tiếp.');
      } else if (!this.lobby.guest) {
        this._emit('hosting', 'Phòng đã mở. Gửi mã ' + this.room + ' cho bạn của bạn.');
      } else {
        this._emit('waiting', 'Hai người đã vào phòng. Cả hai nhấn Sẵn sàng, rồi chủ phòng bắt đầu.');
      }
    }

    _schedulePoll(delay) {
      if (!this._joined) return;
      if (this._polling) {
        if (delay === 0) this._pollAgain = true;
        return;
      }
      if (this._pollTimer !== null) this._cancelTimer(this._pollTimer);
      this._pollTimer = this._later(() => { this._pollTimer = null; this._poll(); }, delay);
    }

    async _poll() {
      if (!this._joined || this._polling) return;
      const generation = this._generation;
      this._polling = true;
      let nextDelay = 100;
      try {
        this._checkDirect();
        const result = await this._request('/api/rooms/' + this.room + '/sync', { seq: ++this._syncSeq, payload: this._payload }, true, generation);
        if (generation !== this._generation) return;
        this._acceptResponse(result);
        this._ensurePeer();
        const interval = this.connected ? (this._directReady ? 750 : 85) : 650;
        nextDelay = this.options.pollInterval === undefined ? interval : this.options.pollInterval;
      } catch (error) {
        if (generation !== this._generation || error.cancelled) return;
        if (error.status && error.status >= 400 && error.status < 500) {
          this._fail(error.message, true);
          return;
        }
        if (!this._directReady && Date.now() - this.lastServerAt > (this.options.reconnectTimeout || 16000)) {
          this._fail('Không kết nối lại được máy chủ. Kiểm tra Internet rồi tạo hoặc vào phòng mới.', true);
          return;
        }
        this._emit('reconnecting', this._directReady ? 'Hai người vẫn chơi trực tiếp. Đang nối lại máy chủ phòng…' : 'Kết nối đang gián đoạn. Trận đấu chờ kết nối lại…');
        nextDelay = 900;
      } finally {
        if (generation === this._generation) {
          this._polling = false;
          const flushNow = this._pollAgain;
          this._pollAgain = false;
          this._schedulePoll(flushNow ? 0 : nextDelay);
        }
      }
    }

    async _action(action, body) {
      if (!this._joined) throw new Error('Hãy tạo hoặc vào phòng trước.');
      const generation = this._generation;
      const result = await this._request('/api/rooms/' + this.room + '/' + action, body, true, generation);
      if (generation === this._generation) { this._acceptResponse(result); this._schedulePoll(0); }
      return this.lobby;
    }
    async setReady(ready) { return this._action('ready', { ready: !!ready }); }
    async start() { return this._action('start', {}); }

    send(packet) {
      if (!this.connected || !packet || typeof packet !== 'object') return false;
      if (this.role === 'host' && (packet.type === 'state' || packet.type === 'start')) {
        let safeState;
        try { safeState = clone(packet.state); } catch (_) { return false; }
        if (!integer(packet.seq) || !safeState) return false;
        if (packet.type === 'start') {
          this._gameId = String(gameNumber(this._gameId) + 1);
          this._lastInputSeq = -1;
          this._lastControlId = 0;
          delete this._payload.control;
        }
        if (!gameNumber(this._gameId)) return false;
        this._payload.state = { type: packet.type, seq: packet.seq, gameId: this._gameId, state: safeState, paused: !!packet.paused };
      } else if (this.role === 'guest' && packet.type === 'input') {
        if (!integer(packet.seq)) return false;
        const outboundGameId = gameNumber(this._gameId) ? this._gameId : (this.lobby && this.lobby.status === 'playing' ? '1' : '');
        if (!gameNumber(outboundGameId)) return false;
        const keys = {}, actions = {};
        for (const key of INPUT_KEYS) keys[key] = !!(packet.keys && packet.keys[key] === true);
        for (const key of ACTION_KEYS) actions[key] = packet.actions && integer(packet.actions[key]) ? packet.actions[key] : 0;
        this._payload.input = { type: 'input', seq: packet.seq, gameId: outboundGameId, keys, actions, focused: packet.focused !== false };
      } else if (packet.type === 'rematch-request' && gameNumber(this._gameId)) {
        this._payload.control = { type: 'rematch-request', id: ++this._controlSeq, gameId: this._gameId };
      } else return false;
      this._sendDirectPayload();
      this._schedulePoll(0);
      return true;
    }

    _acceptPayload(payload) {
      if (!this.connected || !payload || typeof payload !== 'object' || !validTree(payload)) return;
      if (this.role === 'guest' && payload.state) {
        const packet = payload.state;
        const generation = gameNumber(packet.gameId);
        if (generation && generation >= gameNumber(this._gameId) && integer(packet.seq) && packet.state && ['start', 'state'].includes(packet.type)) {
          const freshGame = generation > gameNumber(this._gameId);
          if (freshGame || packet.seq > this._lastStateSeq) {
            if (freshGame) {
              this._gameId = packet.gameId;
              this._lastControlId = 0;
              delete this._payload.control;
              delete this._payload.input;
            }
            this._lastStateSeq = packet.seq;
            this.lastPeerDataAt = Date.now();
            this.onData(Object.assign({}, packet, { type: freshGame ? 'start' : 'state' }));
          }
        }
      } else if (this.role === 'host' && payload.input) {
        const packet = payload.input;
        if (packet.type === 'input' && packet.gameId === this._gameId && integer(packet.seq) && packet.seq > this._lastInputSeq && packet.keys) {
          this._lastInputSeq = packet.seq;
          this.lastPeerDataAt = Date.now();
          this.onData(packet);
        }
      }
      const control = payload.control;
      if (control && control.type === 'rematch-request' && control.gameId === this._gameId && integer(control.id)) {
        if (control.id > this._lastControlId) { this._lastControlId = control.id; this.onData(control); }
      }
    }

    _peerOptions() {
      return Object.assign({ host: '0.peerjs.com', port: 443, path: '/', secure: true, debug: 0,
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] }
      }, this.options.peerOptions || {});
    }

    _ensurePeer() {
      if (!this._joined || !this.lobby || !this.lobby.peerKey || this.options.forceRelay || root.ROOSTER_FORCE_RELAY || typeof root.Peer !== 'function') return;
      if (Date.now() - this._lastPeerAttempt < 4000 || this._directReady) return;
      const generation = this._generation;
      const live = () => generation === this._generation && this._joined;
      const hostId = 'rooster-v3-' + this.room + '-' + this.lobby.peerKey.slice(0, 16);
      if (!this.peer || this.peer.destroyed) {
        this._lastPeerAttempt = Date.now();
        let peer;
        try { peer = this.peer = new root.Peer(this.role === 'host' ? hostId : undefined, this._peerOptions()); }
        catch (_) { this.peer = null; return; }
        peer.on('open', () => { if (live()) this._connectGuest(hostId); });
        peer.on('connection', connection => {
          if (!live() || this.role !== 'host' || !connection.metadata || connection.metadata.protocol !== PROTOCOL || connection.metadata.key !== this.lobby.peerKey || (this.connection && this.connection.open)) {
            try { connection.close(); } catch (_) {} return;
          }
          this._bindDirect(connection);
        });
        peer.on('call', call => call.close());
        peer.on('error', () => { if (live() && !this._directReady) this._dropDirect(); });
        peer.on('disconnected', () => {
          if (!live() || this._directReady) return;
          try { peer.destroy(); } catch (_) {}
          if (this.peer === peer) this.peer = null;
        });
      } else if (this.peer.open) {
        this._lastPeerAttempt = Date.now();
        this._connectGuest(hostId);
      }
    }

    _connectGuest(hostId) {
      if (this.role !== 'guest' || !this.peer || !this.peer.open || this._directReady || (this.connection && this.connection.open)) return;
      this._lastPeerAttempt = Date.now();
      try {
        this._bindDirect(this.peer.connect(hostId, { label: PROTOCOL, serialization: 'json', reliable: true,
          metadata: { protocol: PROTOCOL, key: this.lobby.peerKey }
        }));
      } catch (_) { this._dropDirect(); }
    }

    _bindDirect(connection) {
      if (!connection) return;
      this._dropDirect();
      this.connection = connection;
      const generation = this._generation;
      const live = () => generation === this._generation && this.connection === connection && this._joined;
      const handshake = kind => ({ v: 3, kind, protocol: PROTOCOL, key: this.lobby.peerKey });
      const timeout = this._later(() => { if (live() && !this._directReady) this._dropDirect(); }, 10000);
      connection.on('open', () => { if (live()) this._sendRaw(handshake('hello')); });
      connection.on('data', data => {
        if (!live() || !data || data.v !== 3 || !validTree(data)) return;
        let size;
        try { size = JSON.stringify(data).length; } catch (_) { return; }
        if (size > 26000) return;
        if (data.kind === 'hello' || data.kind === 'welcome') {
          if (data.protocol !== PROTOCOL || data.key !== this.lobby.peerKey) { this._dropDirect(); return; }
          this._cancelTimer(timeout);
          this._directReady = true;
          this.transport = 'direct';
          this._directLastAt = Date.now();
          if (data.kind === 'hello') this._sendRaw(handshake('welcome'));
          this._sendDirectPayload();
          this._showStatus();
          return;
        }
        if (!this._directReady) return;
        this._directLastAt = Date.now();
        if (data.kind === 'ping' && Number.isFinite(data.time)) { this._sendRaw({ v: 3, kind: 'pong', time: data.time }); return; }
        if (data.kind === 'pong' && Number.isFinite(data.time)) { this.ping = Math.max(0, Math.min(9999, Date.now() - data.time)); return; }
        if (data.kind === 'bye') { this._fail('Đối thủ đã rời phòng. Hãy tạo phòng mới để tiếp tục.', true); return; }
        if (data.kind === 'payload' && data.matchId === this.lobby.matchId) {
          if (this.connected) this._acceptPayload(data.payload);
          else this._pendingDirectPayload = data.payload;
        }
      });
      connection.on('close', () => { if (live()) this._dropDirect(); });
      connection.on('error', () => { if (live()) this._dropDirect(); });
    }

    _sendRaw(value) {
      if (!this.connection || !this.connection.open) return false;
      try { this.connection.send(value); return true; }
      catch (_) { this._dropDirect(); return false; }
    }
    _sendDirectPayload() {
      if (this._directReady && this.lobby) this._sendRaw({ v: 3, kind: 'payload', matchId: this.lobby.matchId, payload: this._payload });
    }
    _checkDirect() {
      if (!this._directReady) return;
      if (Date.now() - this._directLastAt > 2500) { this._dropDirect(); return; }
      this._sendRaw({ v: 3, kind: 'ping', time: Date.now() });
    }
    _dropDirect() {
      const connection = this.connection;
      this.connection = null;
      const wasDirect = this._directReady;
      this._directReady = false;
      this.transport = 'relay';
      if (connection) { try { connection.close(); } catch (_) {} }
      if (wasDirect) { this._showStatus(); this._schedulePoll(0); }
    }

    _shutdown() {
      ++this._generation;
      this._joined = false;
      this.connected = false;
      this._polling = false;
      this._pollAgain = false;
      for (const timer of this._timers) clearTimeout(timer);
      this._timers.clear();
      this._pollTimer = null;
      for (const controller of this._controllers) controller.abort();
      this._controllers.clear();
      this._dropDirect();
      const peer = this.peer;
      this.peer = null;
      if (peer) { try { peer.destroy(); } catch (_) {} }
      this._pendingDirectPayload = null;
      this._lastPeerAttempt = 0;
    }

    _fail(message, notifyDisconnect) {
      const wasJoined = this._joined;
      this._shutdown();
      this._emit(wasJoined ? 'disconnected' : 'error', message);
      if (notifyDisconnect && wasJoined) this.onDisconnect(message);
    }

    close(silent = false) {
      const shouldLeave = this._joined && this.room && this._token;
      const code = this.room, token = this._token;
      if (this._directReady) this._sendRaw({ v: 3, kind: 'bye' });
      this._shutdown();
      if (shouldLeave && this._fetch) {
        try {
          const result = this._fetch(this.baseUrl + '/api/rooms/' + code + '/leave', { method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, root.ROOSTER_SUPABASE_KEY ? { apikey: root.ROOSTER_SUPABASE_KEY } : {}), body: '{}',
            credentials: 'omit', cache: 'no-store', keepalive: true
          });
          if (result && result.catch) result.catch(noop);
        } catch (_) {}
      }
      this._token = '';
      this.room = '';
      this.role = null;
      this.lobby = null;
      if (!silent) this._emit('idle', 'Tạo phòng hoặc nhập mã để chơi cùng bạn.');
    }
  }
  RoosterNet.validCode = validCode;
  RoosterNet.cleanCode = cleanCode;
  root.RoosterNet = RoosterNet;
  if (typeof module === 'object' && module.exports) module.exports = RoosterNet;
})(typeof window !== 'undefined' ? window : globalThis);

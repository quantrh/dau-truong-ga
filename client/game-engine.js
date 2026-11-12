/* Rooster Arena — local/authoritative simulation. No dependencies. */
(function (root) {
  'use strict';

  const W = 1280, GROUND = 580, MIN_X = 115, MAX_X = 1165;
  const INPUT_KEYS = ['left', 'right', 'jump', 'peck', 'kick', 'guard', 'dash'];
  const PHASES = ['countdown', 'fight', 'roundEnd', 'matchEnd'];
  const ACTIONS = ['idle', 'walk', 'jump', 'peck', 'kick', 'guard', 'dash', 'hurt', 'win'];
  const ATTACKS = {
    peck: { start: 0.105, active: 0.105, total: 0.43, cost: 11, damage: 9, range: 148, height: 112, push: 215 },
    kick: { start: 0.075, active: 0.15, total: 0.70, cost: 25, damage: 21, range: 184, height: 151, push: 430 }
  };
  const DASH = { duration: 0.18, cooldown: 0.8, cost: 18, speed: 660, invulnerable: 0.1 };
  const emptyInput = () => ({ left: false, right: false, jump: false, peck: false, kick: false, guard: false, dash: false });
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
  const copy = value => JSON.parse(JSON.stringify(value));
  const cleanInput = raw => {
    const input = emptyInput();
    if (raw && typeof raw === 'object') for (const key of INPUT_KEYS) input[key] = raw[key] === true;
    return input;
  };

  function makeFighter(index) {
    return {
      id: index, x: index ? 875 : 405, y: 0, vx: 0, vy: 0,
      hp: 100, stamina: 100, facing: index ? -1 : 1,
      action: 'idle', actionTime: 0, hitFlash: 0, guarding: false,
      attackType: '', attackTimer: 0, attackConnected: false,
      hurtTimer: 0, regenLock: 0, jumpCooldown: 0,
      jumpBuffer: 0, landTimer: 0, gaitPhase: 0, moveBlend: 0,
      dashTimer: 0, dashCooldown: 0, dashDirection: index ? 1 : -1, invulnTimer: 0,
      combo: 0, comboTimer: 0, damageDone: 0, powerRating: 100
    };
  }

  class RoosterGame {
    constructor(options = {}) {
      if (typeof options === 'string') options = { mode: options };
      this.roundSeconds = clamp(finite(options.roundSeconds, 75), 15, 180);
      this.difficulty = ['easy', 'normal', 'hard'].includes(options.difficulty) ? options.difficulty : 'normal';
      this._seed = ((options.seed || Date.now()) >>> 0) || 1;
      this._eventSeq = 0;
      this._events = [];
      this._matchRules = { powerMode: 'balanced', powerRatings: [100, 100] };
      this.setMatchRules(options.matchRules || {});
      this.reset(options.mode || 'bot');
    }

    setMatchRules(rules = {}) {
      const mode = rules.powerMode === 'progression' ? 'progression' : 'balanced';
      const ratings = Array.isArray(rules.powerRatings) ? rules.powerRatings : [100,100];
      this._matchRules = { powerMode: mode, powerRatings: [0,1].map(i => clamp(Math.round(finite(ratings[i],100)),100,130)) };
      if (this.state) {
        this.state.matchRules = copy(this._matchRules);
        this.state.fighters.forEach((f,i)=>{ f.powerRating = this._matchRules.powerMode === 'progression' ? this._matchRules.powerRatings[i] : 100; });
      }
      return copy(this._matchRules);
    }

    reset(mode = this.state ? this.state.mode : 'bot') {
      if (mode && typeof mode === 'object') mode = mode.mode;
      if (!['training', 'bot', 'local', 'online'].includes(mode)) mode = 'bot';
      this.state = {
        version: 1, mode, width: W, ground: GROUND,
        phase: mode === 'training' ? 'fight' : 'countdown', phaseTime: mode === 'training' ? 0 : 3, elapsed: 0,
        round: 1, roundTime: this.roundSeconds, roundSeconds: this.roundSeconds,
        wins: [0, 0], roundWinner: -1, matchWinner: -1,
        resultReason: '', fighters: [makeFighter(0), makeFighter(1)],
        matchRules: copy(this._matchRules), eventId: this._eventSeq, recentEvents: []
      };
      this.state.fighters.forEach((f,i)=>{ f.powerRating = this._matchRules.powerMode === 'progression' ? this._matchRules.powerRatings[i] : 100; });
      this._bots = [false, mode === 'bot'];
      if (mode === 'training') {
        this.state.fighters[0].x = 640;
        this.state.fighters[0].facing = 1;
        this.state.fighters[1].x = 1165;
        this.state.fighters[1].hp = 100;
        this.state.fighters[1].stamina = 100;
      }
      this._previous = [emptyInput(), emptyInput()];
      this._botState = [this._newBot(), this._newBot()];
      this._events = [];
      this._emit('reset', { mode });
      return this.state;
    }

    setBot(index, enabled) {
      if (index === 0 || index === 1) this._bots[index] = !!enabled;
    }

    setDifficulty(level) {
      if (['easy', 'normal', 'hard'].includes(level)) this.difficulty = level;
    }

    _newBot() { return { timer: 0, input: emptyInput(), temperament: this._random() }; }
    _random() {
      let x = this._seed;
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      this._seed = x >>> 0;
      return this._seed / 4294967296;
    }

    _emit(type, data = {}) {
      const event = { id: ++this._eventSeq, type, time: this.state.elapsed, ...data };
      this._events.push(event);
      if (this._events.length > 80) this._events.shift();
      this.state.eventId = event.id;
      this.state.recentEvents.push(event);
      if (this.state.recentEvents.length > 16) this.state.recentEvents.shift();
    }

    drainEvents() {
      const result = this._events;
      this._events = [];
      return result;
    }

    snapshot() { return copy(this.state); }

    loadSnapshot(snapshot) {
      if (!snapshot || typeof snapshot !== 'object' || snapshot.version !== 1 ||
          !PHASES.includes(snapshot.phase) || !Array.isArray(snapshot.fighters) || snapshot.fighters.length !== 2 ||
          !Array.isArray(snapshot.wins) || snapshot.wins.length !== 2) return false;
      const safe = copy(snapshot);
      safe.width = W; safe.ground = GROUND;
      safe.phaseTime = clamp(finite(safe.phaseTime), 0, 10);
      safe.elapsed = Math.max(0, finite(safe.elapsed));
      safe.round = clamp(Math.floor(finite(safe.round, 1)), 1, 10000);
      safe.roundTime = clamp(finite(safe.roundTime), 0, 180);
      safe.roundSeconds = clamp(finite(safe.roundSeconds, 75), 15, 180);
      safe.wins = safe.wins.map(v => clamp(Math.floor(finite(v)), 0, 2));
      safe.roundWinner = [-1, 0, 1].includes(safe.roundWinner) ? safe.roundWinner : -1;
      safe.matchWinner = [-1, 0, 1].includes(safe.matchWinner) ? safe.matchWinner : -1;
      safe.mode = ['training', 'bot', 'local', 'online'].includes(safe.mode) ? safe.mode : 'online';
      safe.resultReason = ['knockout', 'timeout', 'draw', ''].includes(safe.resultReason) ? safe.resultReason : '';
      const incomingRules = safe.matchRules && typeof safe.matchRules === 'object' ? safe.matchRules : {};
      const powerMode = incomingRules.powerMode === 'progression' ? 'progression' : 'balanced';
      const powerRatings = Array.isArray(incomingRules.powerRatings) ? incomingRules.powerRatings : [100,100];
      safe.matchRules = { powerMode, powerRatings: [0,1].map(i=>clamp(Math.round(finite(powerRatings[i],100)),100,130)) };
      safe.eventId = Math.max(0, finite(safe.eventId));
      safe.recentEvents = Array.isArray(safe.recentEvents) ? safe.recentEvents.slice(-16) : [];
      for (let i = 0; i < 2; i++) {
        const f = safe.fighters[i];
        if (!f || typeof f !== 'object') return false;
        f.id = i;
        f.x = clamp(finite(f.x, i ? 875 : 405), MIN_X, MAX_X);
        f.y = clamp(finite(f.y), 0, 500);
        f.vx = clamp(finite(f.vx), -1200, 1200);
        f.vy = clamp(finite(f.vy), -1500, 1000);
        f.hp = clamp(finite(f.hp, 100), 0, 100);
        f.stamina = clamp(finite(f.stamina, 100), 0, 100);
        f.facing = f.facing < 0 ? -1 : 1;
        f.action = ACTIONS.includes(f.action) ? f.action : 'idle';
        f.actionTime = clamp(finite(f.actionTime), 0, 10000);
        f.hitFlash = clamp(finite(f.hitFlash), 0, 1);
        f.guarding = !!f.guarding;
        f.attackType = ATTACKS[f.attackType] ? f.attackType : '';
        f.attackTimer = clamp(finite(f.attackTimer), 0, 2);
        f.attackConnected = !!f.attackConnected;
        for (const key of ['hurtTimer', 'regenLock', 'jumpCooldown', 'comboTimer', 'jumpBuffer', 'landTimer', 'dashTimer', 'dashCooldown', 'invulnTimer']) f[key] = clamp(finite(f[key]), 0, 10);
        f.gaitPhase = ((finite(f.gaitPhase) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        f.moveBlend = clamp(finite(f.moveBlend), 0, 1);
        f.dashDirection = f.dashDirection < 0 ? -1 : 1;
        f.combo = clamp(Math.floor(finite(f.combo)), 0, 1000);
        f.damageDone = Math.max(0, finite(f.damageDone));
        f.powerRating = safe.matchRules.powerMode === 'progression' ? safe.matchRules.powerRatings[i] : 100;
      }
      this.state = safe;
      this._matchRules = copy(safe.matchRules);
      this.roundSeconds = safe.roundSeconds;
      this._eventSeq = Math.max(this._eventSeq, safe.eventId);
      return true;
    }

    step(dt, inputs = []) {
      if (!Number.isFinite(dt) || dt <= 0) return this.state;
      let left = Math.min(dt, 0.12);
      const clean = [cleanInput(inputs[0]), cleanInput(inputs[1])];
      while (left > 0.000001) {
        const sub = Math.min(left, 1 / 60);
        this._step(sub, clean);
        left -= sub;
      }
      return this.state;
    }

    _step(dt, supplied) {
      const s = this.state;
      s.elapsed += dt;
      s.recentEvents = s.recentEvents.filter(e => s.elapsed - e.time < 1.6);
      for (const f of s.fighters) {
        f.actionTime += dt;
        f.hitFlash = Math.max(0, f.hitFlash - dt);
      }

      if (s.phase === 'matchEnd') {
        this._settle(dt);
        return;
      }
      if (s.phase === 'countdown') {
        s.phaseTime = Math.max(0, s.phaseTime - dt);
        this._previous = supplied.map(cleanInput);
        if (s.phaseTime <= 0.000001) {
          s.phase = 'fight';
          this._emit('roundStart', { round: s.round });
        }
        return;
      }
      if (s.phase === 'roundEnd') {
        this._settle(dt);
        s.phaseTime = Math.max(0, s.phaseTime - dt);
        if (s.phaseTime <= 0.000001) {
          s.round++;
          s.roundTime = this.roundSeconds;
          s.phase = 'countdown'; s.phaseTime = 2.5;
          s.roundWinner = -1; s.resultReason = '';
          s.fighters = [makeFighter(0), makeFighter(1)];
          s.fighters.forEach((f,i)=>{ f.powerRating = s.matchRules.powerMode === 'progression' ? s.matchRules.powerRatings[i] : 100; });
          this._previous = [emptyInput(), emptyInput()];
          this._botState = [this._newBot(), this._newBot()];
          this._emit('newRound', { round: s.round });
        }
        return;
      }

      const inputs = supplied.map((input, index) => this._bots[index] ? this._botInput(index, dt) : input);
      if (s.mode === 'training') {
        this._moveFighter(0, inputs[0], dt);
        const trainee = s.fighters[0];
        trainee.stamina = 100;
        trainee.hp = 100;
        s.roundTime = this.roundSeconds;
        s.phase = 'fight';
        s.phaseTime = 0;
        s.roundWinner = -1;
        s.matchWinner = -1;
        s.resultReason = '';
        this._previous = inputs.map(cleanInput);
        return;
      }
      s.roundTime = Math.max(0, s.roundTime - dt);
      // Both fighters complete their movement before any hit is evaluated.
      for (let i = 0; i < 2; i++) this._moveFighter(i, inputs[i], dt);
      this._separate();
      // Capture simultaneous active hits before applying either result.
      const hits = [];
      for (let i = 0; i < 2; i++) {
        const a = s.fighters[i], b = s.fighters[1 - i];
        const attack = ATTACKS[a.attackType];
        if (!attack || a.attackConnected || a.attackTimer < attack.start || a.attackTimer > attack.start + attack.active) continue;
        if (b.invulnTimer > 0) continue;
        const dx = b.x - a.x, dy = Math.abs(b.y - a.y);
        if (dx * a.facing >= -20 && Math.abs(dx) <= attack.range && dy <= attack.height) {
          a.attackConnected = true;
          hits.push({ a, b, attack, kind: a.attackType });
        }
      }
      for (const hit of hits) this._hit(hit);
      this._previous = inputs.map(cleanInput);
      const [a, b] = s.fighters;
      if (a.hp <= 0 || b.hp <= 0) {
        this._endRound(a.hp <= 0 && b.hp <= 0 ? -1 : a.hp > 0 ? 0 : 1, a.hp <= 0 && b.hp <= 0 ? 'draw' : 'knockout');
      } else if (s.roundTime <= 0.000001) {
        const difference = a.hp - b.hp;
        this._endRound(Math.abs(difference) < 0.01 ? -1 : difference > 0 ? 0 : 1, Math.abs(difference) < 0.01 ? 'draw' : 'timeout');
      }
    }

    _setAction(f, action) {
      if (f.action !== action) { f.action = action; f.actionTime = 0; }
    }

    _moveFighter(i, input, dt) {
      const f = this.state.fighters[i], other = this.state.fighters[1 - i];
      const previousX = f.x;
      f.regenLock = Math.max(0, f.regenLock - dt);
      f.jumpCooldown = Math.max(0, f.jumpCooldown - dt);
      f.jumpBuffer = Math.max(0, f.jumpBuffer - dt);
      f.landTimer = Math.max(0, f.landTimer - dt);
      f.dashTimer = Math.max(0, f.dashTimer - dt);
      f.dashCooldown = Math.max(0, f.dashCooldown - dt);
      f.invulnTimer = Math.max(0, f.invulnTimer - dt);
      if (input.jump && !this._previous[i].jump) f.jumpBuffer = 0.11;
      f.hurtTimer = Math.max(0, f.hurtTimer - dt);
      f.comboTimer = Math.max(0, f.comboTimer - dt);
      if (f.comboTimer === 0) f.combo = 0;
      if (f.attackType) {
        f.attackTimer += dt;
        if (f.attackTimer >= ATTACKS[f.attackType].total) {
          f.attackType = ''; f.attackTimer = 0; f.attackConnected = false;
        }
      }
      const direction = Number(input.right) - Number(input.left);
      if (!f.attackType && f.hurtTimer <= 0 && f.dashTimer <= 0) {
        if (this.state.mode === 'training' && direction) f.facing = direction > 0 ? 1 : -1;
        else if (this.state.mode !== 'training') f.facing = other.x >= f.x ? 1 : -1;
      }
      f.guarding = input.guard && f.y <= 1 && !f.attackType && f.hurtTimer <= 0 && f.stamina > 3 && f.dashTimer <= 0;
      const speed = f.guarding ? 115 : f.attackType ? 80 : 310;
      if (f.hurtTimer <= 0) {
        if (input.dash && !this._previous[i].dash && f.y === 0 && f.vy === 0 &&
            f.dashTimer <= 0 && f.dashCooldown <= 0 && !f.attackType && f.stamina >= DASH.cost) {
          f.dashDirection = direction || -f.facing;
          f.dashTimer = DASH.duration; f.dashCooldown = DASH.cooldown;
          f.invulnTimer = DASH.invulnerable; f.stamina -= DASH.cost; f.regenLock = 0.6;
          f.guarding = false;
          this._setAction(f, 'dash');
          this._emit('dash', { fighter: i, x: f.x, direction: f.dashDirection });
        }
        if (f.dashTimer > 0) {
          // A short burst eases out instead of switching between two fixed speeds.
          const progress = 1 - f.dashTimer / DASH.duration;
          f.vx = f.dashDirection * DASH.speed * (1 - 0.38 * progress);
        } else {
          const desired = direction * speed;
          const reversing = direction && f.vx * direction < 0;
          const response = f.y > 0 ? 8.5 : (!direction || reversing) ? 23 : 17;
          f.vx += (desired - f.vx) * (1 - Math.exp(-response * dt));
        }
        if (f.jumpBuffer > 0 && f.y === 0 && f.jumpCooldown <= 0 && !f.guarding &&
            !f.attackType && f.dashTimer <= 0 && f.stamina >= 9) {
          f.vy = 700; f.stamina -= 9; f.regenLock = 0.45; f.jumpCooldown = 0.3;
          f.jumpBuffer = 0; f.landTimer = 0;
          this._emit('jump', { fighter: i, x: f.x });
        }
        if (!f.attackType && !f.guarding && f.dashTimer <= 0) {
          const kind = input.kick ? 'kick' : input.peck ? 'peck' : '';
          if (kind && f.stamina >= ATTACKS[kind].cost) {
            f.attackType = kind; f.attackTimer = 0; f.attackConnected = false;
            f.stamina -= ATTACKS[kind].cost; f.regenLock = 0.55;
            if (this.state.mode === 'training') {
              if (direction) f.facing = direction > 0 ? 1 : -1;
            } else f.facing = other.x >= f.x ? 1 : -1;
            const attackStep = kind === 'kick' ? 24 : 14;
            f.x = clamp(f.x + f.facing * attackStep, MIN_X, MAX_X);
            f.vx += f.facing * (kind === 'kick' ? 190 : 95);
            this._setAction(f, kind);
            this._emit('attack', { fighter: i, kind });
          }
        }
      } else f.vx *= Math.exp(-4 * dt);
      if (f.guarding) f.stamina = Math.max(0, f.stamina - 5 * dt);
      else if (f.regenLock <= 0 && !f.attackType && f.hurtTimer <= 0 && f.dashTimer <= 0) f.stamina = Math.min(100, f.stamina + 25 * dt);
      f.x = clamp(f.x + f.vx * dt, MIN_X, MAX_X);
      if ((f.x === MIN_X && f.vx < 0) || (f.x === MAX_X && f.vx > 0)) f.vx = 0;
      if (f.y > 0 || f.vy > 0) {
        f.vy -= 1800 * dt;
        f.y += f.vy * dt;
        if (f.y <= 0) {
          f.y = 0; f.vy = 0; f.landTimer = 0.16;
          this._emit('land', { fighter: i, x: f.x });
        }
      }
      const travel = Math.abs(f.x - previousX);
      if (f.y === 0) f.gaitPhase = (f.gaitPhase + travel / 130 * Math.PI * 2) % (Math.PI * 2);
      const moveTarget = f.y === 0 && !f.attackType && f.dashTimer <= 0 && f.hurtTimer <= 0 ?
        clamp(travel / dt / 310, 0, 1) : 0;
      f.moveBlend += (moveTarget - f.moveBlend) * (1 - Math.exp(-18 * dt));
      if (f.hurtTimer > 0) this._setAction(f, 'hurt');
      else if (f.dashTimer > 0) this._setAction(f, 'dash');
      else if (f.attackType) this._setAction(f, f.attackType);
      else if (f.guarding) this._setAction(f, 'guard');
      else if (f.y > 0) this._setAction(f, 'jump');
      else if (Math.abs(f.vx) > 35) this._setAction(f, 'walk');
      else this._setAction(f, 'idle');
      f.hp = clamp(f.hp, 0, 100);
      f.stamina = clamp(f.stamina, 0, 100);
    }

    _separate() {
      const [a, b] = this.state.fighters;
      if (Math.abs(a.y - b.y) > 95) return;
      const gap = 132, d = b.x - a.x;
      if (Math.abs(d) >= gap) return;
      const sign = d === 0 ? (a.facing === 1 ? 1 : -1) : Math.sign(d);
      const push = (gap - Math.abs(d)) * 0.5;
      a.x = clamp(a.x - sign * push, MIN_X, MAX_X);
      b.x = clamp(b.x + sign * push, MIN_X, MAX_X);
      // Preserve body separation when one fighter is already at the arena edge.
      if (Math.abs(b.x - a.x) < gap - 0.01) {
        if (a.x === MIN_X || a.x === MAX_X) b.x = clamp(a.x + sign * gap, MIN_X, MAX_X);
        else a.x = clamp(b.x - sign * gap, MIN_X, MAX_X);
      }
    }

    _hit({ a, b, attack, kind }) {
      const airborne = a.y > 20;
      const distance = Math.abs(b.x - a.x);
      const airBonus = airborne ? (kind === 'kick' ? 4 : 2) : 0;
      const distanceRatio = clamp(distance / attack.range, 0, 1);
      // Close contact hits harder; grazing the edge of attack range does less damage.
      const distanceMultiplier = 1.22 - 0.40 * distanceRatio;
      const powerMultiplier = this.state.matchRules && this.state.matchRules.powerMode === 'progression' ? 1 + (clamp(finite(a.powerRating,100),100,130) - 100) / 200 : 1;
      let damage = (attack.damage + airBonus) * distanceMultiplier * powerMultiplier;
      let blocked = b.guarding && (a.x - b.x) * b.facing > -10;
      let guardBreak = false;
      if (blocked) {
        const guardCost = kind === 'kick' ? 31 : 15;
        if (b.stamina >= guardCost) {
          b.stamina -= guardCost;
          damage *= 0.12;
          b.regenLock = 0.5;
        } else {
          b.stamina = 0; blocked = false; guardBreak = true;
          b.guarding = false; b.regenLock = 0.9;
        }
      }
      b.hp = Math.max(0, b.hp - damage);
      a.damageDone += damage;
      b.hitFlash = blocked ? 0.075 : 0.22;
      const contactPush = attack.push * (airborne ? (kind === 'kick' ? 1.14 : 1.08) : 1);
      b.vx = a.facing * contactPush * (blocked ? 0.34 : 1);
      if (!blocked) {
        b.hurtTimer = guardBreak ? 0.65 : kind === 'kick' ? 0.36 : 0.20;
        b.attackType = ''; b.attackTimer = 0; b.attackConnected = false;
        b.dashTimer = 0; b.invulnTimer = 0;
        this._setAction(b, 'hurt');
        // Give impact an immediate spatial result so the contact never looks like two sprites passing through.
        const shove = kind === 'kick' ? (airborne ? 30 : 24) : (airborne ? 16 : 12);
        b.x = clamp(b.x + a.facing * shove, MIN_X, MAX_X);
        a.x = clamp(a.x - a.facing * (kind === 'kick' ? 5 : 2), MIN_X, MAX_X);
        if (kind === 'kick') b.vy = Math.max(b.vy, airborne ? 165 : 115);
        else if (b.y > 0) b.vy = Math.max(b.vy, 65);
        a.vx -= a.facing * (kind === 'kick' ? 72 : 24);
        a.combo = a.comboTimer > 0 ? a.combo + 1 : 1;
        a.comboTimer = 1.35;
      }
      this._emit(guardBreak ? 'guardBreak' : blocked ? 'block' : 'hit', {
        fighter: a.id, target: b.id, kind, damage: Math.round(damage * 10) / 10,
        x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) + 95, combo: a.combo,
        aerial: airborne, powerRating: a.powerRating, distance: Math.round(distance), distanceMultiplier: Math.round(distanceMultiplier*100)/100
      });
    }

    _endRound(winner, reason) {
      const s = this.state;
      s.roundWinner = winner; s.resultReason = reason;
      if (winner >= 0) s.wins[winner]++;
      for (const f of s.fighters) {
        f.attackType = ''; f.guarding = false; f.hurtTimer = 0;
        f.dashTimer = 0; f.invulnTimer = 0; f.jumpBuffer = 0;
        this._setAction(f, f.id === winner ? 'win' : 'idle');
      }
      this._emit('roundEnd', { winner, reason, wins: [...s.wins], round: s.round });
      if (winner >= 0 && s.wins[winner] >= 2) {
        s.phase = 'matchEnd'; s.phaseTime = 0; s.matchWinner = winner;
        this._emit('matchEnd', { winner, wins: [...s.wins] });
      } else { s.phase = 'roundEnd'; s.phaseTime = 3.2; }
    }

    _settle(dt) {
      for (const f of this.state.fighters) {
        f.vx *= Math.exp(-8 * dt);
        f.moveBlend *= Math.exp(-12 * dt);
        f.landTimer = Math.max(0, f.landTimer - dt);
        f.x = clamp(f.x + f.vx * dt, MIN_X, MAX_X);
        if (f.y > 0 || f.vy > 0) {
          f.vy -= 1800 * dt; f.y = Math.max(0, f.y + f.vy * dt);
          if (f.y === 0) { f.vy = 0; f.landTimer = 0.16; }
        }
      }
    }

    _botInput(index, dt) {
      const b = this._botState[index];
      b.timer -= dt;
      if (b.timer > 0) return b.input;
      const f = this.state.fighters[index], other = this.state.fighters[1 - index];
      const d = Math.abs(other.x - f.x), direction = Math.sign(other.x - f.x) || 1;
      const input = emptyInput();
      const easy = this.difficulty === 'easy', hard = this.difficulty === 'hard';
      b.timer = (easy ? 0.22 : hard ? 0.085 : 0.13) + this._random() * (easy ? 0.24 : 0.14);
      const advance = () => { input.left = direction < 0; input.right = direction > 0; };
      const retreat = () => { input.left = direction > 0; input.right = direction < 0; };
      const threatened = other.attackType && d < 225 && Math.abs(other.y - f.y) < 150;
      const guardChance = easy ? 0.22 : hard ? 0.83 : 0.58;
      if (threatened && !easy && f.stamina > 45 && f.dashCooldown <= 0 && this._random() < (hard ? 0.12 : 0.05)) {
        retreat(); input.dash = true;
      } else if (threatened && f.stamina > 20 && this._random() < guardChance) {
        input.guard = true;
        if (d < 145 && this._random() < 0.35) retreat();
      } else if (f.stamina < 20) {
        if (d < 270) retreat();
        if (f.x < 140 || f.x > 1140) { input.left = false; input.right = false; input.jump = this._random() < 0.3; advance(); }
      } else if (d > 180) {
        advance();
        if (d < 280 && this._random() < 0.09) input.jump = true;
      } else {
        const roll = this._random();
        if (d > 151 && roll < 0.5) advance();
        if (roll < (easy ? 0.27 : hard ? 0.6 : 0.46)) {
          input.kick = f.stamina >= 25 && (d > 148 || this._random() < 0.42);
          input.peck = !input.kick && d < 154;
        } else if (roll < 0.73) input.guard = this._random() < 0.55;
        else if (roll < 0.88) retreat();
        else { input.jump = true; advance(); }
      }
      b.input = input;
      return input;
    }
  }

  RoosterGame.WIDTH = W;
  RoosterGame.GROUND = GROUND;
  RoosterGame.ATTACKS = copy(ATTACKS);
  RoosterGame.DASH = copy(DASH);
  root.RoosterGame = RoosterGame;
  if (typeof module !== 'undefined' && module.exports) module.exports = RoosterGame;
})(typeof window !== 'undefined' ? window : globalThis);

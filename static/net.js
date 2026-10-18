/* Shared networking: connection, snapshot buffer, interpolation, and -- for your own
 * car only -- client-side prediction.
 *
 * Prediction is the whole reason the car feels connected to the key. The server is
 * authoritative at 30 Hz and clients render ~70 ms in the past so other cars can be
 * interpolated smoothly; applied to your own car that would mean every input landing
 * a fifth of a second late, which reads as driving a boat. So your car is integrated
 * locally the instant you press anything, and continuously nudged back toward the
 * server's version. Everyone else stays interpolated, where the delay is invisible.
 */
'use strict';

const Net = (() => {

const RENDER_DELAY = 70;        // ms behind the newest snapshot, for OTHER cars

// must match sim.py's human car -- see the note in reconcile()
const PHYS = { A_MAX: 9.0, B_MAX: 13.0, ROLL: 1.2, DRAG: 0.0049, CAR_LEN: 4.5, MIN_GAP: 0.5 };

const state = {
  ws: null, you: null, isHost: false,
  L: 400, carLen: 4.5, params: {},
  buf: [], online: 0, lastT: 0, connected: false,
  throttle: 0,                  // current pedal, -1..1
  pred: null,                   // {s, v} predicted own car
};

const handlers = { welcome: [], state: [], params: [], reset: [], close: [], bump: [],
                   kicked: [] };
const on = (ev, fn) => handlers[ev].push(fn);
const emit = (ev, a) => { for (const fn of handlers[ev]) fn(a); };

function connect({ drive = false, name = '', pin = '' } = {}) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  state.ws = ws;
  ws.onopen = () => {
    state.connected = true;
    const token = new URLSearchParams(location.search).get('host') || '';
    send({ type: 'hello', drive, name, token, pin });
  };
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.type === 'welcome') {
      state.you = m.you; state.carLen = m.car_len; state.isHost = m.is_host;
      applyParams(m.params); emit('welcome', m);
    } else if (m.type === 'state') {
      onSnapshot(m);
    } else if (m.type === 'params') {
      applyParams(m.params); emit('params', m.params);
    } else if (m.type === 'kicked') {
      state.you = null; state.pred = null;
      emit('kicked', m);
    }
  };
  ws.onclose = () => { state.connected = false; emit('close'); };
  return ws;
}

function applyParams(p) { state.params = p; state.L = p.L; }

function onSnapshot(m) {
  if (m.t < state.lastT - 0.5) {      // somebody reset: rewind everything local too
    state.buf.length = 0; state.pred = null; emit('reset');
  }
  state.lastT = m.t;

  const cars = m.cars.map(a => ({
    id: a[0], s: a[1], v: a[2], human: a[3], name: a[4],
    color: a[5], bumped: !!a[6], lap: a[7], braking: !!a[8], crashes: a[9] || 0,
    rearEnded: !!a[10],
  }));
  state.buf.push({ t: m.t, at: performance.now(), cars, stats: m.stats });
  while (state.buf.length > 4) state.buf.shift();
  state.online = cars.filter(c => c.human).length;

  const me = cars.find(c => c.id === state.you);
  if (me) {
    // either side of a contact: you hit someone, or someone hit you
    if (me.bumped || me.rearEnded) emit('bump', me);
    reconcile(me);
  }
  emit('state', state.buf[state.buf.length - 1]);
}

/* Pull the predicted car toward the authoritative one. A hard snap would jitter on
 * every packet, so the error is bled off over a few frames -- except when it is large
 * (a collision the prediction could not know about), where snapping is correct. */
function reconcile(server) {
  if (!state.pred) { state.pred = { s: server.s, v: server.v }; return; }
  let ds = ((server.s - state.pred.s + state.L * 1.5) % state.L) - state.L / 2;
  if (Math.abs(ds) > 6) {
    state.pred.s = server.s; state.pred.v = server.v;      // snap: we were wrong
  } else {
    state.pred.s = wrap(state.pred.s + ds * 0.22);
    state.pred.v += (server.v - state.pred.v) * 0.25;
  }
}

const wrap = s => ((s % state.L) + state.L) % state.L;

/** Integrate the local car with the same rules sim.py uses for a human. */
function predict(dt, leadGap, leadV) {
  if (state.pred === null) return;
  const u = state.throttle;
  const pedal = u * (u >= 0 ? PHYS.A_MAX : PHYS.B_MAX);
  const drag = PHYS.ROLL + PHYS.DRAG * state.pred.v * state.pred.v;
  let v = Math.max(0, state.pred.v + (pedal - drag) * dt);
  let s = state.pred.s + v * dt;
  if (leadGap !== undefined && isFinite(leadGap)) {        // do not predict through anyone
    const room = leadGap - PHYS.MIN_GAP;
    if (v * dt > room) { s = state.pred.s + Math.max(0, room); v = Math.min(v, leadV); }
  }
  state.pred.v = v;
  state.pred.s = wrap(s);
}

function interp(now) {
  const b = state.buf;
  if (!b.length) return null;
  const want = now - RENDER_DELAY;
  let cars;
  if (b.length === 1 || want >= b[b.length - 1].at) {
    cars = b[b.length - 1].cars;
  } else {
    let i = b.length - 1;
    while (i > 0 && b[i - 1].at > want) i--;
    if (i === 0) { cars = b[0].cars; }
    else {
      const a = b[i - 1], c = b[i];
      const span = c.at - a.at;
      const f = span > 1e-3 ? Math.max(0, Math.min(1, (want - a.at) / span)) : 1;
      const byId = new Map(a.cars.map(x => [x.id, x]));
      cars = c.cars.map(cur => {
        const prev = byId.get(cur.id);
        if (!prev) return cur;
        // lerp the short way round, or a car streaks backwards once per lap
        const d = ((cur.s - prev.s + state.L * 1.5) % state.L) - state.L / 2;
        return { ...cur, s: wrap(prev.s + d * f), v: prev.v + (cur.v - prev.v) * f };
      });
    }
  }
  if (state.pred && state.you !== null) {       // your car comes from prediction
    cars = cars.map(c => c.id === state.you
      ? { ...c, s: state.pred.s, v: state.pred.v } : c);
  }
  return cars;
}

function gapAhead(cars, i) {
  if (cars.length < 2) return Infinity;
  return ((cars[(i + 1) % cars.length].s - cars[i].s) % state.L + state.L) % state.L - state.carLen;
}

function neighbours(cars, youId) {
  const i = cars.findIndex(c => c.id === youId);
  if (i < 0 || cars.length < 2) return null;
  const n = cars.length;
  return {
    me: cars[i], ahead: cars[(i + 1) % n], behind: cars[(i - 1 + n) % n],
    gapAhead: gapAhead(cars, i), gapBehind: gapAhead(cars, (i - 1 + n) % n),
  };
}

function send(obj) {
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(obj));
}

/** Set the pedal and tell the server immediately -- no polling delay. */
function setThrottle(u) {
  u = Math.max(-1, Math.min(1, u));
  if (u === state.throttle) return;
  state.throttle = u;
  send({ type: 'input', u: Math.round(u * 100) / 100 });
}

return { state, connect, interp, predict, neighbours, gapAhead, send, setThrottle, on, PHYS };
})();

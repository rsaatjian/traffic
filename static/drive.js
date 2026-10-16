/* The drive screen: first person, from the driver's seat.
 *
 * You see a straight road, the queue of cars in front of you, and a rear-view mirror
 * for the one behind. Your own car is predicted locally (see net.js) so the key and
 * the movement happen in the same instant.
 */
'use strict';

(() => {

const $ = id => document.getElementById(id);
const S = Net.state;

let target = 0, lastFrame = performance.now(), audioOn = false;

/* ---- input: no ramp worth speaking of, no polling. Press -> move. ------------- */
const keys = new Set();
function refresh() {
  const up = keys.has('ArrowUp') || keys.has('w') || keys.has('W');
  const dn = keys.has('ArrowDown') || keys.has('s') || keys.has('S') || keys.has(' ');
  target = up && !dn ? 1 : dn && !up ? -1 : 0;
  $('accel').classList.toggle('held', target > 0);
  $('brake').classList.toggle('held', target < 0);
}
addEventListener('keydown', e => {
  if (!$('join').classList.contains('gone')) return;
  if ([' ', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault();
  if (!keys.has(e.key)) { keys.add(e.key); refresh(); }
});
addEventListener('keyup', e => { keys.delete(e.key); refresh(); });
addEventListener('blur', () => { keys.clear(); refresh(); });

function pedal(el, value) {
  const set = v => {
    target = v;
    $('accel').classList.toggle('held', target > 0);
    $('brake').classList.toggle('held', target < 0);
  };
  el.addEventListener('pointerdown', e => { e.preventDefault(); set(value); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
    el.addEventListener(ev, e => { e.preventDefault(); set(0); });
  }
}
pedal($('accel'), 1);
pedal($('brake'), -1);

Net.on('bump', () => {
  FX.bump(1.2);
  $('flash').classList.add('on');
  setTimeout(() => $('flash').classList.remove('on'), 170);
});
Net.on('close', () => { $('join').classList.remove('gone'); $('go').textContent = 'Reconnect'; });

Net.on('welcome', m => {
  // a PIN'd ring hands back no car; show the field and say why
  if (m.pin_required) $('pin').hidden = false;
  if (m.ring_full || m.bad_pin || (m.pin_required && m.you === null)) {
    $('join').classList.remove('gone');
    $('joinerr').hidden = false;
    $('joinerr').textContent = m.ring_full ? 'Ring is full — try again shortly.'
                             : m.bad_pin ? 'Wrong PIN.' : 'This ring needs a PIN.';
    $('go').textContent = 'DRIVE';
  } else {
    $('joinerr').hidden = true;
  }
});

/* ---- render -------------------------------------------------------------------- */

function fit(canvas) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
  if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  const cur = S.throttle;
  const step = dt / 0.035;                 // 35 ms across the pedal range
  Net.setThrottle(cur < target ? Math.min(target, cur + step)
                 : cur > target ? Math.max(target, cur - step) : target);

  let cars = Net.interp(now);
  if (cars && S.you !== null) {
    const n0 = Net.neighbours(cars, S.you);
    if (n0) Net.predict(dt, n0.gapAhead, n0.ahead.v);
    cars = Net.interp(now);                // re-read with the prediction applied
  }

  const { ctx, w, h } = fit($('view'));
  Cockpit.setup(ctx, w, h);
  const me = cars ? cars.find(c => c.id === S.you) || cars[0] : null;
  if (me) FX.update(dt, me);

  const [shx, shy] = FX.shakeOffset();
  ctx.save();
  ctx.translate(shx, shy);
  Cockpit.sky(ctx);
  Cockpit.ground(ctx);
  Cockpit.road(ctx, me ? me.s : 0);

  if (cars && me) {
    const L = S.L;
    const ahead = s => ((s - me.s) % L + L) % L;          // forward distance, m
    Cockpit.skidmarks(ctx, FX.skids, ahead);

    // everything in front of us, far to near (painter's algorithm)
    const queue = cars
      .filter(c => c.id !== me.id)
      .map(c => ({ c, z: ahead(c.s) - S.carLen }))
      .filter(o => o.z > 0.4 && o.z < Cockpit.FAR)
      .sort((a, b) => b.z - a.z);
    for (const o of queue) {
      Cockpit.carRear(ctx, o.z, {
        color: o.c.color, braking: o.c.braking, name: o.c.name, human: o.c.human,
      });
    }
  }

  Cockpit.interior(ctx);
  ctx.restore();

  if (cars && me) {
    const n = Net.neighbours(cars, S.you);
    Cockpit.mirror(ctx, n ? n.behind : null, n ? n.gapBehind : Infinity);
    FX.speedVignette(ctx, w, h, Math.min(1, me.v / 36));
    updateHud(n, me);
    FX.engine(me.v, S.throttle, 40);
  }
  requestAnimationFrame(frame);
}

function updateHud(n, me) {
  // lap and driver counts used to live up here, but the rear-view mirror is drawn
  // top-centre and they crowded it. Both are on the overview screen anyway.
  $('speed').textContent = Math.round(U.mph(me.v));
  $('crashes').textContent = me.crashes;
  $('crashchip').classList.toggle('bad', me.crashes > 0);
  if (!n) return;

  const gap = n.gapAhead, closing = me.v - n.ahead.v;
  $('gap').textContent = isFinite(gap) ? Math.round(U.ft(Math.max(0, gap))) : '--';
  $('aheadwho').textContent = n.ahead.human ? (n.ahead.name || 'driver') : 'autopilot';

  const ttc = gap / Math.max(closing, 1e-6);
  const warn = $('warn');
  if (closing > 0.4 && ttc < 2.5) { warn.textContent = 'BRAKE'; warn.className = 'on danger'; }
  else if (me.v < 0.4) { warn.textContent = 'STOPPED'; warn.className = 'on'; }
  else { warn.className = ''; }

  $('gapbar').style.width = `${Math.max(0, Math.min(100, (gap / 30) * 100))}%`;
  $('gapbar').classList.toggle('tight', gap < 9);
}

/* ---- boot ------------------------------------------------------------------------ */

function start() {
  const name = ($('name').value || '').trim() || `driver${Math.floor(Math.random() * 90 + 10)}`;
  $('join').classList.add('gone');
  $('joinerr').hidden = true;
  audioOn = FX.setAudio(true);            // inside the click, so the browser allows it
  $('sound').classList.toggle('off', !audioOn);
  if (Net.state.ws && Net.state.ws.readyState === 1) {
    Net.send({ type: 'hello', drive: true, name, pin: $('pin').value || '' });
  } else {
    Net.connect({ drive: true, name, pin: $('pin').value || '' });
  }
}
$('go').addEventListener('click', start);
$('name').addEventListener('keydown', e => { if (e.key === 'Enter') start(); });
$('sound').addEventListener('click', () => {
  audioOn = FX.setAudio(!audioOn);
  $('sound').classList.toggle('off', !audioOn);
});
$('name').focus();
requestAnimationFrame(frame);

})();

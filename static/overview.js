/* The overview screen: the whole ring with every car on it, plus the diagnostics.
 *
 * Connects as a spectator -- it never takes a car, so putting this on the projector
 * does not change the density. The brake lights are the thing to point at: when the
 * jam forms you can watch a chain of them fire backwards around the ring while every
 * car is still driving forwards.
 */
'use strict';

(() => {

const $ = id => document.getElementById(id);
const S = Net.state;

const st = new Charts.SpaceTime($('spacetime'));
const sg = new Charts.Sigma($('sigma'));
const fd = new Charts.Fundamental($('fundamental'));
const ph = new Charts.Phase($('phase'));
let lastFdPush = -Infinity;

/* Clear the time-domain panels on a reset but keep the fundamental diagram: its whole
 * purpose is to accumulate across runs while the density is swept. */
Net.on('reset', () => { st.reset(); sg.reset(); ph.reset(); lastFdPush = -Infinity; });

Net.on('welcome', m => {
  if (m.join_url) {
    // The page knows its own origin for certain, including the scheme -- more
    // reliable than reconstructing it from forwarded headers on the websocket
    // upgrade. The exception is the instructor browsing on localhost, where our own
    // origin is useless to anyone else and the server's LAN guess is what we want.
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    const url = local ? m.join_url : `${location.origin}/drive`;
    $('joinurl').querySelector('b').textContent = url.replace(/^https?:\/\//, '');
    const qr = $('qr');                 // 404s if segno is missing; just stay hidden
    qr.onload = () => { qr.hidden = false; };
    qr.src = '/qr.svg';
  }
  if (m.is_host) initHostPanel();
  // A page that simply has no controls on it is impossible to diagnose while
  // standing in front of a class -- it looks completely normal. Say which case it is.
  const el = $('notice');
  if (m.host_rejected) {
    el.hidden = false;
    el.className = 'bad';
    el.innerHTML = 'That instructor link is out of date, so the controls are hidden. ' +
      'Find the current <code>HOST_TOKEN</code> in your host\'s environment settings, ' +
      'or run <code>grep instructor logs/server.log</code> locally.';
  } else if (!m.is_host) {
    el.hidden = false;
    el.className = 'muted';
    el.innerHTML = 'Spectating. For the instructor controls, open this page as ' +
      '<code>?host=TOKEN</code> &mdash; the token is printed in the server log at ' +
      'startup (and is <code>HOST_TOKEN</code> in your host\'s environment).';
    setTimeout(() => { el.hidden = true; }, 20000);   // not permanent on a projector
  } else {
    el.hidden = true;
  }
});
Net.on('params', () => syncHostInputs());

Net.on('state', snap => {
  const vRef = S.params.V0 || 30;
  st.push(snap.cars, S.L, vRef, snap.t);
  sg.push(U.mph(snap.stats.std_v));

  let slowest = snap.cars[0], idx = 0;
  snap.cars.forEach((c, i) => { if (c.v < slowest.v) { slowest = c; idx = i; } });
  if (snap.cars.length > 1) ph.push(U.ft(Math.min(Net.gapAhead(snap.cars, idx), 60)), U.mph(slowest.v));

  if (snap.t - lastFdPush >= 1.0) {
    lastFdPush = snap.t;
    fd.push(U.perMile(snap.stats.density), snap.stats.flow * 3600, snap.stats.std_v > 0.8);
  }

  $('meanv').textContent = Math.round(U.mph(snap.stats.mean_v));
  $('sigma_v').textContent = U.mph(snap.stats.std_v).toFixed(1);
  $('density').textContent = Math.round(U.perMile(snap.stats.density));
  $('online').textContent = S.online;
  $('braking').textContent = snap.cars.filter(c => c.braking).length;
  updateBoard(snap.cars);
});

/* Crashes per driver. Bots are left off: the IDM essentially never touches anybody,
 * so a list of zeroes would just push the humans off the bottom. */
function updateBoard(cars) {
  const humans = cars.filter(c => c.human)
    .sort((a, b) => b.crashes - a.crashes || (a.name || '').localeCompare(b.name || ''));
  const el = $('board');
  if (!humans.length) {
    el.innerHTML = '<li class="empty">no drivers yet</li>';
    return;
  }
  el.innerHTML = humans.map(c => {
    const cls = c.crashes === 0 ? 'clean' : c.crashes >= 3 ? 'bad' : '';
    const name = (c.name || 'driver').replace(/[<>&]/g, '');
    // a dotted leader between the name and the number, so the eye can follow the
    // row across at projector distance instead of guessing which count is whose
    return `<li class="${cls}"><span class="sw" style="background:${c.color}"></span>` +
           `<span class="nm">${name}</span><span class="dots"></span>` +
           `<span class="ct">${c.crashes}</span></li>`;
  }).join('');
}

/* ---- the ring ------------------------------------------------------------------ */

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
  const cars = Net.interp(now);
  const { ctx, w, h } = fit($('ring'));
  ctx.fillStyle = '#0c1220';
  ctx.fillRect(0, 0, w, h);

  if (cars) {
    const L = S.L;
    const R = Track.radius(L);
    const scale = Math.min(w, h) / ((R + Track.LANE_M) * 2.18);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(scale, scale);
    Track.draw(ctx, L, scale * Track.LANE_M > 14);

    const carPx = S.carLen * scale;
    for (const c of cars) {
      const [x, y, th] = Track.pos(c.s, L);
      ctx.save();
      ctx.translate(x, y);
      // Track.pos returns the ANGULAR position; the direction of travel is its
      // tangent, and Cars.draw points the nose at local -Y. Working that through
      // gives th + PI, not th + PI/2 -- the latter draws every car broadside.
      ctx.rotate(th + Math.PI);
      ctx.scale(1 / scale, 1 / scale);               // draw cars in screen pixels
      Cars.draw(ctx, Math.max(11, carPx), {
        color: c.color, braking: c.braking, bumped: c.bumped, shadow: false,
        boldBrake: true,
      });
      ctx.restore();
    }
    ctx.restore();

    // names right at the car, just clear of the kerb
    for (const c of cars) {
      if (!c.human) continue;
      const [x, y] = Track.pos(c.s, L, Track.LANE_M * 0.72);
      const px = w / 2 + x * scale, py = h / 2 + y * scale;
      ctx.font = '700 11px ui-sans-serif,system-ui';
      ctx.textAlign = x < 0 ? 'right' : 'left';
      ctx.textBaseline = 'middle';
      const label = c.name || 'driver';
      const tw = ctx.measureText(label).width;
      const bx = x < 0 ? px - tw - 6 : px - 2;
      ctx.fillStyle = 'rgba(8,11,16,.72)';     // chip, so it stays readable on asphalt
      Cars.roundRect(ctx, bx, py - 8, tw + 8, 16, 4);
      ctx.fill();
      ctx.fillStyle = c.color;
      ctx.fillText(label, x < 0 ? px - 2 : px + 2, py);
    }
  }

  st.draw(); sg.draw(); ph.draw();
  const last = S.buf[S.buf.length - 1];
  fd.draw(last ? { x: U.perMile(last.stats.density), y: last.stats.flow * 3600 } : null);
  captions(last);
  requestAnimationFrame(frame);
}

function captions(last) {
  const ws = st.waveSpeed();
  $('wavecap').textContent = ws === null
    ? 'Dark stripes are jams. Their backward tilt is the wave speed.'
    : `Jam travelling ${ws >= 0 ? 'forwards' : 'backwards'} at ${Math.abs(U.mph(ws)).toFixed(1)} mph — cars go forwards through it.`;
  if (last) {
    const s = U.mph(last.stats.std_v);
    $('sigmacap').textContent = last.stats.std_v < 0.3
      ? `σᵥ = ${s.toFixed(1)} mph — uniform flow is holding.`
      : `σᵥ = ${s.toFixed(1)} mph — stop-and-go wave.`;
  }
}

/* ---- instructor panel ------------------------------------------------------------ */

const ID = v => +v;
const KNOBS = [
  ['N', 'rN', 'oN', v => `${v} (${Math.round(U.perMile(v / S.L))} veh/mi)`, ID, ID],
  ['L', 'rL', 'oL', v => `${Math.round(v)} ft`, ft => U.mToFt(+ft), m => U.ft(m)],
  ['A', 'rA', 'oA', v => `${(+v).toFixed(2)} m/s²`, ID, ID],
  ['T', 'rT', 'oT', v => `${(+v).toFixed(2)} s`, ID, ID],
  ['SPREAD', 'rSPREAD', 'oSPREAD', v => `±${Math.round(v * 100)}%`, ID, ID],
  ['NOISE', 'rNOISE', 'oNOISE', v => (+v === 0 ? 'off' : `${(+v).toFixed(2)} m/s²`), ID, ID],
  ['SEED', 'rSEED', 'oSEED', v => `${Math.round(v * 100)}% of spacing`, ID, ID],
];

/* Values we have sent but not yet seen echoed back.
 *
 * The server broadcasts `params` to everyone after any change, and that echo used to
 * be written straight back into every slider. Locally the round trip is about a
 * millisecond so nothing is visible; over a hosted deployment it is ~100 ms, which
 * means the echo for where the slider WAS lands while you are still dragging and
 * yanks it backwards. Dragging then fights itself and the control feels stuck.
 *
 * So: ignore echoes for a control while our own newer value is still in flight, and
 * start trusting the server again as soon as it agrees with us (or after a timeout,
 * so a dropped message cannot wedge the slider forever). */
const pending = new Map();
const AGREE = (a, b) => Math.abs((+a) - (+b)) < 1e-6;

function initHostPanel() {
  $('host').hidden = false;
  syncHostInputs();
  for (const [key, rid, oid, fmt, toWire] of KNOBS) {
    const el = $(rid);
    el.addEventListener('input', () => {
      $(oid).textContent = fmt(el.value);
      const wire = toWire(el.value);
      pending.set(key, { value: wire, at: performance.now() });
      Net.send({ type: 'admin', action: 'set', key, value: wire });
    });
  }
  $('perturb').addEventListener('click', () => Net.send({ type: 'admin', action: 'perturb' }));
  $('reset').addEventListener('click', () => Net.send({ type: 'admin', action: 'reset' }));
}

function syncHostInputs() {
  if (!S.isHost) return;
  const now = performance.now();
  for (const [key, rid, oid, fmt, , fromWire] of KNOBS) {
    const v = S.params[key];
    if (v === undefined) continue;

    const p = pending.get(key);
    if (p) {
      if (AGREE(p.value, v)) pending.delete(key);      // server caught up
      else if (now - p.at < 2500) continue;            // our newer value is in flight
      else pending.delete(key);                        // gave up waiting; trust server
    }

    const shown = fromWire(v);
    $(rid).value = shown;
    $(oid).textContent = fmt(shown);
  }
  const rho = U.perMile(S.params.N / S.params.L);
  const regime = rho < 61 ? 'below critical — perturbations decay'
               : rho < 71 ? 'near critical — marginal'
               : 'above critical — jams on its own';
  $('regime').textContent =
    `${rho.toFixed(0)} veh/mi: ${regime}. Threshold is ~64 veh/mi at a = 0.6 m/s². ` +
    `Variation, noise and starting bunching only seed the instability — set them to 0 ` +
    `and the ring still jams from a tap of the brakes, just far more slowly.`;
}

Net.connect({ drive: false });
requestAnimationFrame(frame);

})();

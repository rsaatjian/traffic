/* Juice: the parts that have no physical meaning and do all the work of making the
 * car feel like an object rather than a number. Screen shake, skid marks, tyre smoke,
 * a speed vignette, and an engine note whose pitch tracks the wheels.
 */
'use strict';

const FX = (() => {

let shake = 0;
const smoke = [];
const skids = [];          // world-space marks: {s, side, life}

function bump(amount = 1) { shake = Math.min(1.4, shake + amount); }

function update(dt, car) {
  shake *= Math.pow(0.0025, dt);                 // fast decay
  for (let i = smoke.length - 1; i >= 0; i--) {
    const p = smoke[i];
    p.life -= dt; p.r += dt * 26;
    if (p.life <= 0) smoke.splice(i, 1);
  }
  for (let i = skids.length - 1; i >= 0; i--) {
    skids[i].life -= dt * 0.11;
    if (skids[i].life <= 0) skids.splice(i, 1);
  }
  // hard braking lays rubber and kicks up smoke
  if (car && car.braking && car.v > 4) {
    if (skids.length < 260) skids.push({ s: car.s, life: 1 });
    if (Math.random() < dt * 26) {
      smoke.push({ s: car.s, r: 2, life: 0.5 + Math.random() * 0.4 });
    }
  }
}

function shakeOffset() {
  if (shake < 0.01) return [0, 0];
  const m = shake * 9;
  return [(Math.random() - 0.5) * m, (Math.random() - 0.5) * m];
}

/** Dark red vignette + white streaks that grow with speed. */
function speedVignette(ctx, w, h, frac) {
  if (frac <= 0.02) return;
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.30,
                                     w / 2, h / 2, Math.max(w, h) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${0.30 + frac * 0.45})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/* ---- engine note ------------------------------------------------------------
 * Two detuned saw oscillators through a lowpass. Pitch follows road speed, and the
 * filter opens under throttle, so the car sounds like it is working rather than just
 * humming. Created lazily: browsers refuse audio before a user gesture.
 */
let actx = null, osc1, osc2, filt, gain, enabled = false;

function initAudio() {
  if (actx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  actx = new AC();
  gain = actx.createGain(); gain.gain.value = 0;
  filt = actx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 700;
  osc1 = actx.createOscillator(); osc1.type = 'sawtooth';
  osc2 = actx.createOscillator(); osc2.type = 'square';
  osc1.connect(filt); osc2.connect(filt); filt.connect(gain); gain.connect(actx.destination);
  osc1.start(); osc2.start();
  return true;
}

function setAudio(on) {
  enabled = on;
  if (on && initAudio() && actx.state === 'suspended') actx.resume();
  if (!on && gain) gain.gain.value = 0;
  return enabled;
}

function engine(speedMs, throttle, topMs) {
  if (!enabled || !actx) return;
  const f = Math.min(1, speedMs / (topMs || 40));
  const base = 42 + f * 150;                       // Hz
  const t = actx.currentTime;
  osc1.frequency.setTargetAtTime(base, t, 0.05);
  osc2.frequency.setTargetAtTime(base * 0.503, t, 0.05);
  filt.frequency.setTargetAtTime(380 + f * 1500 + Math.max(0, throttle) * 900, t, 0.06);
  gain.gain.setTargetAtTime(0.030 + f * 0.045 + Math.max(0, throttle) * 0.022, t, 0.08);
}

return { bump, update, shakeOffset, speedVignette, setAudio, engine,
         get smoke() { return smoke; }, get skids() { return skids; },
         get shake() { return shake; } };
})();

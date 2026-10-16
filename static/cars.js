/* Top-down car rendering.
 *
 * The old build drew coloured rectangles, which is why nothing on screen read as
 * traffic. A car needs a silhouette you recognise instantly: a tapered nose, a glass
 * cabin set back from it, wheels outside the body, and lights at both ends.
 *
 * The brake lights do double duty. They are the best-looking thing here AND the
 * clearest read on the phenomenon the demo exists for: when a jam forms, a chain of
 * tail lights fires backwards around the ring, car by car, while every car is still
 * driving forwards. You can watch the wave travel without reading a single plot.
 */
'use strict';

const Cars = (() => {

/** Darken/lighten a #rrggbb by `f` (-1..1). */
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c =>
    Math.max(0, Math.min(255, Math.round(f < 0 ? c * (1 + f) : c + (255 - c) * f))));
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}

/** Car body outline, nose at -Y. Tapered front, slightly boxy rear. */
function bodyPath(ctx, L, W) {
  const hl = L / 2, hw = W / 2;
  const nose = hw * 0.74;              // narrower at the front
  const tail = hw * 0.92;
  ctx.beginPath();
  ctx.moveTo(-nose, -hl + L * 0.10);
  ctx.quadraticCurveTo(-nose, -hl, -nose * 0.45, -hl);   // front-left corner
  ctx.lineTo(nose * 0.45, -hl);
  ctx.quadraticCurveTo(nose, -hl, nose, -hl + L * 0.10); // front-right
  ctx.lineTo(hw, -hl + L * 0.32);
  ctx.lineTo(hw, hl - L * 0.22);
  ctx.lineTo(tail, hl - L * 0.06);
  ctx.quadraticCurveTo(tail, hl, tail - W * 0.12, hl);   // rear-right
  ctx.lineTo(-tail + W * 0.12, hl);
  ctx.quadraticCurveTo(-tail, hl, -tail, hl - L * 0.06); // rear-left
  ctx.lineTo(-hw, hl - L * 0.22);
  ctx.lineTo(-hw, -hl + L * 0.32);
  ctx.closePath();
}

/**
 * Draw one car centred at the current origin, pointing up (-Y).
 * @param {number} L  car length in pixels; everything else scales off it
 */
function draw(ctx, L, opts) {
  const {
    color = '#4aa3ff', braking = false, isYou = false, bumped = false,
    throttle = 0, shadow = true, boldBrake = false,
  } = opts || {};
  const W = L * 0.46;
  const hl = L / 2, hw = W / 2;
  const detail = L > 22;               // skip fiddly bits when tiny (overview)

  /* On the overview a car is ~25 px long, so its tail lights are about 2 x 1.5 px --
   * too small to see, and the brake lights are the most useful thing on that screen.
   * boldBrake adds a red halo behind the car while leaving the lamps themselves
   * scale-accurate, so a queue of braking cars reads as a red chain from the back of
   * a lecture theatre without the cars themselves looking wrong. */
  if (braking && boldBrake) {
    // centred on the tail rather than the car, and small enough to stay a pool of
    // light behind the bumper -- a halo around the whole car just reads as a blob
    const cy = hl * 0.92, r = L * 0.58;
    const g = ctx.createRadialGradient(0, cy, 0, 0, cy, r);
    g.addColorStop(0, 'rgba(255,48,48,.80)');
    g.addColorStop(0.40, 'rgba(255,40,40,.34)');
    g.addColorStop(1, 'rgba(255,40,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  if (shadow && detail) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#000';
    ctx.translate(L * 0.04, L * 0.06);
    bodyPath(ctx, L, W); ctx.fill();
    ctx.restore();
  }

  if (detail) {                        // wheels, just outside the body
    ctx.fillStyle = '#15181d';
    const ww = W * 0.17, wh = L * 0.19;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        ctx.fillRect(sx * (hw - ww * 0.22) - (sx > 0 ? 0 : ww),
                     sy * (hl * 0.52) - wh / 2, ww, wh);
      }
    }
  }

  // body, with a soft top-lit gradient so it reads as a solid object
  const g = ctx.createLinearGradient(-hw, 0, hw, 0);
  g.addColorStop(0, shade(color, -0.32));
  g.addColorStop(0.42, shade(color, 0.06));
  g.addColorStop(1, shade(color, -0.42));
  ctx.fillStyle = braking && !detail ? shade(color, -0.1) : g;
  bodyPath(ctx, L, W);
  ctx.fill();

  if (detail) {
    // cabin + windshield
    ctx.fillStyle = 'rgba(12,16,22,.80)';
    roundRect(ctx, -hw * 0.76, -hl * 0.18, hw * 1.52, L * 0.42, L * 0.07);
    ctx.fill();
    ctx.fillStyle = 'rgba(150,200,240,.30)';
    ctx.beginPath();
    ctx.moveTo(-hw * 0.60, -hl * 0.16);
    ctx.lineTo(hw * 0.60, -hl * 0.16);
    ctx.lineTo(hw * 0.44, -hl * 0.40);
    ctx.lineTo(-hw * 0.44, -hl * 0.40);
    ctx.closePath(); ctx.fill();

    // headlights
    ctx.fillStyle = '#fff6d8';
    for (const sx of [-1, 1]) {
      roundRect(ctx, sx * hw * 0.62 - W * 0.09, -hl + L * 0.015, W * 0.18, L * 0.055, L * 0.02);
      ctx.fill();
    }
  }

  // tail lights -- the whole point
  const lw = detail ? W * 0.20 : W * 0.34;
  const lh = detail ? L * 0.065 : L * 0.16;
  ctx.save();
  if (braking) {
    ctx.shadowColor = '#ff2a2a';
    ctx.shadowBlur = L * (detail ? 0.55 : 0.9);
    ctx.fillStyle = '#ff3b3b';
  } else {
    ctx.fillStyle = 'rgba(150,34,34,.85)';
  }
  for (const sx of [-1, 1]) {
    roundRect(ctx, sx * hw * 0.60 - lw / 2, hl - lh - L * 0.015, lw, lh, L * 0.02);
    ctx.fill();
  }
  if (braking) {                      // second pass so the glow really blooms
    ctx.shadowBlur = L * 0.9;
    for (const sx of [-1, 1]) {
      roundRect(ctx, sx * hw * 0.60 - lw / 2, hl - lh - L * 0.015, lw, lh, L * 0.02);
      ctx.fill();
    }
  }
  ctx.restore();

  if (throttle > 0.05 && detail) {    // a hint of exhaust heat under power
    ctx.fillStyle = `rgba(255,170,90,${0.10 + throttle * 0.18})`;
    roundRect(ctx, -hw * 0.3, hl, hw * 0.6, L * 0.07, L * 0.03);
    ctx.fill();
  }

  if (bumped) {
    ctx.strokeStyle = '#ff2d2d';
    ctx.lineWidth = Math.max(1.5, L * 0.07);
    bodyPath(ctx, L, W); ctx.stroke();
  } else if (isYou) {
    ctx.strokeStyle = 'rgba(255,255,255,.92)';
    ctx.lineWidth = Math.max(1.4, L * 0.045);
    bodyPath(ctx, L, W); ctx.stroke();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

return { draw, roundRect, shade };
})();

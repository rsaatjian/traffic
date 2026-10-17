/* First-person view from the driver's seat.
 *
 * Classic pseudo-3D: a pinhole projection onto a flat road. The ring is treated as a
 * straight road ahead, which is what it looks like from inside a car anyway -- at eye
 * level you see the queue in front of you, not the geometry of the loop.
 *
 * This is the view that makes the demo land. You watch the brake lights of the car in
 * front come on, and the ones in front of that, and the ones in front of those -- the
 * wave arriving at you, car by car, before you have to lift off yourself.
 */
'use strict';

const Cockpit = (() => {

const EYE = 1.18;            // eye height above the road, m
const FOV = 62 * Math.PI / 180;
const ROAD_W = 9;            // metres, matches Track.LANE_M
const CAR_W = 1.82;
const CAR_H = 1.46;
const FAR = 220;             // draw distance, m

let W = 0, H = 0, cx = 0, horizon = 0, focal = 1;

function setup(ctx, w, h) {
  W = w; H = h; cx = w / 2;
  horizon = h * 0.455;
  focal = (h / 2) / Math.tan(FOV / 2);
}

/** World (lateral x, height y, forward z) -> screen. */
function proj(x, y, z) {
  const zz = Math.max(0.35, z);
  return [cx + (x * focal) / zz, horizon + ((EYE - y) * focal) / zz];
}

/** Scale factor at distance z: metres -> pixels. */
const sc = z => focal / Math.max(0.35, z);

/* ---- scene ------------------------------------------------------------------- */

function sky(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, '#0a1020');
  g.addColorStop(0.72, '#22304a');
  g.addColorStop(1, '#4a5a72');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, horizon + 1);
}

function ground(ctx) {
  const g = ctx.createLinearGradient(0, horizon, 0, H);
  g.addColorStop(0, '#1b2a1e');
  g.addColorStop(1, '#0e1a12');
  ctx.fillStyle = g;
  ctx.fillRect(0, horizon, W, H - horizon);
}

function road(ctx, s) {
  const nz = 0.9, fz = FAR;
  const [lnx, lny] = proj(-ROAD_W / 2, 0, nz);
  const [rnx] = proj(ROAD_W / 2, 0, nz);
  const [lfx, lfy] = proj(-ROAD_W / 2, 0, fz);
  const [rfx] = proj(ROAD_W / 2, 0, fz);

  const g = ctx.createLinearGradient(0, lfy, 0, lny);
  g.addColorStop(0, '#272d35');
  g.addColorStop(1, '#333a44');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(lnx, lny); ctx.lineTo(rnx, lny);
  ctx.lineTo(rfx, lfy); ctx.lineTo(lfx, lfy);
  ctx.closePath(); ctx.fill();

  // solid edge lines
  for (const side of [-1, 1]) {
    ctx.fillStyle = 'rgba(235,235,235,.55)';
    ctx.beginPath();
    const [ax, ay] = proj(side * (ROAD_W / 2 - 0.25), 0, nz);
    const [bx] = proj(side * (ROAD_W / 2 - 0.05), 0, nz);
    const [dx, dy] = proj(side * (ROAD_W / 2 - 0.05), 0, fz);
    const [ex] = proj(side * (ROAD_W / 2 - 0.25), 0, fz);
    ctx.moveTo(ax, ay); ctx.lineTo(bx, ay); ctx.lineTo(dx, dy); ctx.lineTo(ex, dy);
    ctx.closePath(); ctx.fill();
  }

  // centre dashes, scrolling with absolute position so speed is legible as motion
  const PITCH = 9, DASH = 4;
  const off = s % PITCH;
  ctx.fillStyle = 'rgba(255,255,255,.42)';
  for (let k = 0; k < 26; k++) {
    const z0 = k * PITCH - off + 1.2;
    const z1 = z0 + DASH;
    if (z1 < 1 || z0 > FAR) continue;
    const [ax, ay] = proj(-0.16, 0, Math.max(1, z0));
    const [bx] = proj(0.16, 0, Math.max(1, z0));
    const [dx, dy] = proj(0.16, 0, z1);
    const [ex] = proj(-0.16, 0, z1);
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(bx, ay); ctx.lineTo(dx, dy); ctx.lineTo(ex, dy);
    ctx.closePath(); ctx.fill();
  }

  // roadside posts: the main cue for how fast you are actually going
  const PP = 20, poff = s % PP;
  for (let k = 0; k < 12; k++) {
    const z = k * PP - poff + 4;
    if (z < 1.5 || z > FAR) continue;
    for (const side of [-1, 1]) {
      const x = side * (ROAD_W / 2 + 1.4);
      const [bx, by] = proj(x, 0, z);
      const [tx, ty] = proj(x, 2.3, z);
      ctx.strokeStyle = 'rgba(190,200,210,.40)';
      ctx.lineWidth = Math.max(0.7, sc(z) * 0.12);
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.fillStyle = 'rgba(255,220,120,.75)';
      const r = Math.max(0.8, sc(z) * 0.09);
      ctx.beginPath(); ctx.arc(tx, ty, r, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function skidmarks(ctx, marks, mySegment) {
  for (const m of marks) {
    const z = mySegment(m.s);
    if (z < 1.5 || z > 90) continue;
    for (const side of [-1, 1]) {
      const [x, y] = proj(side * 0.75, 0, z);
      ctx.fillStyle = `rgba(16,16,18,${0.5 * m.life})`;
      const w = Math.max(0.6, sc(z) * 0.22);
      ctx.fillRect(x - w / 2, y, w, Math.max(0.8, sc(z) * 0.5));
    }
  }
}

/* ---- the back of a car ---------------------------------------------------------
 * Seen from behind: bumper, body, rear window, and the two things that matter --
 * tail lights that bloom when that driver is on the brakes.
 */
function carRear(ctx, z, opts) {
  const { color = '#4aa3ff', braking = false, name = '', human = false } = opts;
  const [lx, by] = proj(-CAR_W / 2, 0, z);
  const [rx] = proj(CAR_W / 2, 0, z);
  const [, ty] = proj(0, CAR_H, z);
  const w = rx - lx, h = by - ty;
  if (w < 1.2) return;

  ctx.save();
  // contact shadow
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.beginPath();
  ctx.ellipse(lx + w / 2, by, w * 0.56, Math.max(1, h * 0.09), 0, 0, Math.PI * 2);
  ctx.fill();

  // body
  const g = ctx.createLinearGradient(0, ty, 0, by);
  g.addColorStop(0, Cars.shade(color, 0.12));
  g.addColorStop(0.55, color);
  g.addColorStop(1, Cars.shade(color, -0.45));
  ctx.fillStyle = g;
  Cars.roundRect(ctx, lx, ty, w, h, Math.min(w, h) * 0.17);
  ctx.fill();

  if (w > 14) {
    // rear window
    ctx.fillStyle = 'rgba(10,15,22,.80)';
    Cars.roundRect(ctx, lx + w * 0.13, ty + h * 0.10, w * 0.74, h * 0.34, h * 0.09);
    ctx.fill();
    // bumper
    ctx.fillStyle = Cars.shade(color, -0.55);
    Cars.roundRect(ctx, lx + w * 0.04, by - h * 0.20, w * 0.92, h * 0.15, h * 0.05);
    ctx.fill();
    // wheels peeking under
    ctx.fillStyle = '#0d0f12';
    ctx.fillRect(lx + w * 0.07, by - h * 0.07, w * 0.14, h * 0.08);
    ctx.fillRect(lx + w * 0.79, by - h * 0.07, w * 0.14, h * 0.08);
  }

  // tail lights
  const lw = w * 0.20, lh = h * 0.13;
  const ly = ty + h * 0.52;
  ctx.save();
  if (braking) { ctx.shadowColor = '#ff2b2b'; ctx.shadowBlur = Math.max(6, w * 0.30); ctx.fillStyle = '#ff4040'; }
  else { ctx.fillStyle = 'rgba(140,32,32,.9)'; }
  for (const side of [0, 1]) {
    const x = lx + (side ? w * 0.72 : w * 0.08);
    Cars.roundRect(ctx, x, ly, lw, lh, lh * 0.35);
    ctx.fill();
  }
  if (braking) {
    for (const side of [0, 1]) {
      const x = lx + (side ? w * 0.72 : w * 0.08);
      Cars.roundRect(ctx, x, ly, lw, lh, lh * 0.35);
      ctx.fill();
    }
  }
  ctx.restore();
  ctx.restore();

  // A person in front gets their name on the plate; bots get nothing, so "there is
  // a human ahead of me" reads at a glance. Far off it is just a pale smudge, which
  // is what a real plate looks like from a distance.
  if (human && name && w > 24) {
    plate(ctx, lx + w / 2, by - h * 0.125, w * 0.34, name);
  }
}

/** A rear licence plate centred on (cx0, cy0), `pw` wide, lettered with `text`. */
function plate(ctx, cx0, cy0, pw, text) {
  const ph = pw / 2.1;                        // roughly a real plate's proportions
  const x = cx0 - pw / 2, y = cy0 - ph / 2;

  ctx.save();
  ctx.fillStyle = '#0e1013';
  Cars.roundRect(ctx, x - ph * 0.08, y - ph * 0.08, pw + ph * 0.16, ph + ph * 0.16, ph * 0.16);
  ctx.fill();
  ctx.fillStyle = '#e9e5d7';
  Cars.roundRect(ctx, x, y, pw, ph, ph * 0.13);
  ctx.fill();

  const label = text.toUpperCase().slice(0, 10);
  // shrink to fit rather than clipping: names here can be up to 16 characters
  let size = ph * 0.70;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 8; i++) {
    ctx.font = `700 ${size}px ui-monospace,Menlo,Consolas,monospace`;
    if (ctx.measureText(label).width <= pw * 0.86) break;
    size *= 0.88;
  }
  ctx.fillStyle = '#16202e';
  ctx.fillText(label, cx0, cy0 + ph * 0.04);
  ctx.restore();
}

/* ---- interior ------------------------------------------------------------------ */

function interior(ctx) {
  // hood
  const hy = H * 0.84;
  const g = ctx.createLinearGradient(0, hy, 0, H);
  g.addColorStop(0, '#20242c');
  g.addColorStop(1, '#0e1116');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-W * 0.05, H);
  ctx.lineTo(W * 0.12, hy + H * 0.035);
  ctx.quadraticCurveTo(W * 0.5, hy - H * 0.022, W * 0.88, hy + H * 0.035);
  ctx.lineTo(W * 1.05, H);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.07)';
  ctx.lineWidth = 1.5; ctx.stroke();

  // A-pillars
  ctx.fillStyle = '#12151b';
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(W * 0.075, 0);
  ctx.lineTo(0, H * 0.78); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(W, 0); ctx.lineTo(W * 0.925, 0);
  ctx.lineTo(W, H * 0.78); ctx.closePath(); ctx.fill();
}

/** Rear-view mirror, top centre. Mirrored left-right, like a real one. */
function mirror(ctx, behind, gapBehind) {
  const mw = Math.min(330, W * 0.46), mh = mw * 0.235;
  const mx = (W - mw) / 2, my = Math.max(8, H * 0.018);

  ctx.save();
  Cars.roundRect(ctx, mx - 4, my - 4, mw + 8, mh + 8, 10);
  ctx.fillStyle = '#0a0c10'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 2; ctx.stroke();

  Cars.roundRect(ctx, mx, my, mw, mh, 7);
  ctx.clip();
  const g = ctx.createLinearGradient(0, my, 0, my + mh);
  g.addColorStop(0, '#1b2434');
  g.addColorStop(0.42, '#39414d');
  g.addColorStop(1, '#23272e');
  ctx.fillStyle = g; ctx.fillRect(mx, my, mw, mh);

  if (behind && isFinite(gapBehind)) {
    // a car at `gapBehind` metres, drawn small-to-large with the mirror's own scale
    const k = Math.max(0.10, Math.min(1, 11 / Math.max(3, gapBehind)));
    const cw = mw * 0.40 * k * 1.9, ch = cw * 0.72;
    const bx = mx + mw / 2 - cw / 2, byy = my + mh * 0.80 - ch;
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.beginPath();
    ctx.ellipse(mx + mw / 2, my + mh * 0.80, cw * 0.55, ch * 0.10, 0, 0, Math.PI * 2);
    ctx.fill();
    const cg = ctx.createLinearGradient(0, byy, 0, byy + ch);
    cg.addColorStop(0, Cars.shade(behind.color, 0.14));
    cg.addColorStop(1, Cars.shade(behind.color, -0.42));
    ctx.fillStyle = cg;
    Cars.roundRect(ctx, bx, byy, cw, ch, ch * 0.2); ctx.fill();
    if (cw > 26) {                      // windscreen + headlights of the car behind
      ctx.fillStyle = 'rgba(10,15,22,.8)';
      Cars.roundRect(ctx, bx + cw * 0.15, byy + ch * 0.12, cw * 0.70, ch * 0.34, ch * 0.1);
      ctx.fill();
      ctx.fillStyle = '#fff4d2';
      ctx.shadowColor = '#fff0c0'; ctx.shadowBlur = cw * 0.18;
      for (const side of [0, 1]) {
        Cars.roundRect(ctx, bx + (side ? cw * 0.74 : cw * 0.10), byy + ch * 0.60,
                       cw * 0.16, ch * 0.13, ch * 0.05);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }
  }
  ctx.restore();

  ctx.fillStyle = 'rgba(190,200,212,.9)';
  ctx.font = '600 10px ui-sans-serif,system-ui';
  ctx.textAlign = 'center';
  const label = behind && isFinite(gapBehind)
    ? `${Math.round(U.ft(Math.max(0, gapBehind)))} ft behind` : 'clear behind';
  ctx.fillText(label, W / 2, my + mh + 15);
}

return { setup, proj, sc, sky, ground, road, carRear, plate, interior, mirror, skidmarks,
         get horizon() { return horizon; }, FAR };
})();

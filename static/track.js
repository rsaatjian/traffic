/* The road itself, in world space.
 *
 * World coordinates are the physical ring: a circle of radius L/2pi, with arc position
 * s mapped to an angle. Both screens draw the same world through different cameras --
 * the overview sees all of it, the drive screen rides along with one car -- so the
 * geometry lives here once.
 */
'use strict';

const Track = (() => {

const radius = L => L / (2 * Math.PI);
/** Arc position -> world point. Angle 0 is the top, running clockwise. */
function pos(s, L, inset = 0) {
  const th = (s / L) * Math.PI * 2 - Math.PI / 2;
  const r = radius(L) + inset;
  return [Math.cos(th) * r, Math.sin(th) * r, th];
}

const LANE_M = 9;                 // road width in metres

/** Grass, asphalt, kerbs, centre dashes and the start line, in world units. */
function draw(ctx, L, detail = true) {
  const R = radius(L);
  const half = LANE_M / 2;

  ctx.fillStyle = '#16301d';                       // infield
  ctx.beginPath(); ctx.arc(0, 0, R - half, 0, Math.PI * 2); ctx.fill();

  ctx.strokeStyle = '#2f353d';                     // asphalt
  ctx.lineWidth = LANE_M;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();

  if (detail) {                                    // red/white kerbing
    const seg = 48;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      ctx.strokeStyle = i % 2 ? '#d8d8d8' : '#c8483f';
      ctx.lineWidth = LANE_M * 0.10;
      ctx.beginPath(); ctx.arc(0, 0, R + half, a0, a1); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, R - half, a0, a1); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,.17)';     // centre dashes
    ctx.lineWidth = LANE_M * 0.035;
    const dashes = Math.max(24, Math.round(L / 9));
    for (let i = 0; i < dashes; i++) {
      const a0 = (i / dashes) * Math.PI * 2;
      ctx.beginPath(); ctx.arc(0, 0, R, a0, a0 + (Math.PI * 2 / dashes) * 0.45); ctx.stroke();
    }
  }

  // start/finish, so laps and the space-time x-axis share an origin
  const [sx, sy] = pos(0, L, -half);
  const [ex, ey] = pos(0, L, half);
  ctx.strokeStyle = 'rgba(255,255,255,.75)';
  ctx.lineWidth = LANE_M * 0.08;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
}

/** Rubber laid down by hard braking. */
function skids(ctx, L, marks) {
  ctx.lineCap = 'round';
  for (const m of marks) {
    for (const side of [-1, 1]) {
      const [x, y] = pos(m.s, L, side * LANE_M * 0.17);
      ctx.strokeStyle = `rgba(20,20,22,${0.35 * m.life})`;
      ctx.lineWidth = LANE_M * 0.045;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.01, y + 0.01); ctx.stroke();
    }
  }
  ctx.lineCap = 'butt';
}

function smoke(ctx, L, puffs) {
  for (const p of puffs) {
    const [x, y] = pos(p.s, L);
    ctx.fillStyle = `rgba(210,210,215,${0.16 * p.life})`;
    ctx.beginPath(); ctx.arc(x, y, p.r * 0.12, 0, Math.PI * 2); ctx.fill();
  }
}

return { radius, pos, draw, skids, smoke, LANE_M };
})();

/* The four diagnostics. Plain Canvas 2D -- these are custom enough that a charting
 * library would be more code, not less.
 *
 *   1. space-time   the jam itself, and its backward propagation speed
 *   2. sigma_v(t)   the order parameter: does a kick decay or persist?
 *   3. fundamental  flow vs density, accumulated across the whole session
 *   4. phase        headway vs speed for one car: fixed point, or limit cycle?
 */
'use strict';

const Charts = (() => {

  const AXIS = '#39434f', GRID = '#1c232c', LABEL = '#8b98a9';

  function ctxOf(canvas, cssH) {
    if (cssH && canvas.clientHeight !== cssH) canvas.style.height = cssH + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  /* red -> amber -> green over 0..vRef, for the space-time diagram */
  function speedColor(v, vRef) {
    const t = Math.max(0, Math.min(1, v / (vRef || 1)));
    const stops = [[255, 62, 62], [255, 196, 61], [61, 220, 132]];
    const k = t * 2, i = Math.min(1, Math.floor(k)), f = k - i;
    const a = stops[i], b = stops[i + 1];
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
  }

  function axes(ctx, w, h, pad) {
    ctx.strokeStyle = AXIS; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, h - pad.b); ctx.lineTo(w - pad.r, h - pad.b);
    ctx.stroke();
  }

  function label(ctx, text, x, y, align = 'left', color = LABEL) {
    ctx.fillStyle = color;
    ctx.font = '9px ui-sans-serif,system-ui';
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, x, y);
  }

  /* ---- 1. space-time diagram ------------------------------------------------
   * x = position around the ring, y = time flowing downward. One row per snapshot,
   * scrolled with drawImage. A jam is a dark stripe; because the jam moves backward
   * while the cars move forward, the stripe leans the opposite way to the car tracks.
   */
  class SpaceTime {
    constructor(canvas) {
      this.canvas = canvas;
      canvas.style.height = '180px';
      this.buf = document.createElement('canvas');
      this.buf.width = 320; this.buf.height = 180;
      this.bctx = this.buf.getContext('2d');
      this.bctx.fillStyle = '#0b0e13';
      this.bctx.fillRect(0, 0, this.buf.width, this.buf.height);
      this.rows = 0;
      this.hist = [];              // {t, jamPos} for the wave-speed fit
    }

    push(cars, L, vRef, t) {
      const b = this.bctx, W = this.buf.width, H = this.buf.height;
      b.drawImage(this.buf, 0, 1);                    // scroll down by one pixel
      b.fillStyle = '#0b0e13';
      b.fillRect(0, 0, W, 1);
      for (const c of cars) {
        const x = (c.s / L) * W;
        b.fillStyle = speedColor(c.v, vRef);
        b.fillRect(x - 1, 0, 3, 1);
      }
      this.rows++;
      this.trackJam(cars, L, t);
    }

    /* Circular-mean position of "slowness", so the jam centre can be followed across
     * the 0/L seam. Only meaningful once there is a real spread in speeds. */
    trackJam(cars, L, t) {
      const vs = cars.map(c => c.v);
      const vmax = Math.max(...vs), vmin = Math.min(...vs);
      if (vmax - vmin < 1.5) { this.hist.length = 0; return; }
      let x = 0, y = 0;
      for (const c of cars) {
        const wgt = (vmax - c.v) + 0.01;
        const a = (c.s / L) * Math.PI * 2;
        x += wgt * Math.cos(a); y += wgt * Math.sin(a);
      }
      let pos = (Math.atan2(y, x) / (Math.PI * 2)) * L;
      if (pos < 0) pos += L;
      const last = this.hist[this.hist.length - 1];
      let un = pos;
      if (last) {
        let d = ((pos - last.raw + L * 1.5) % L) - L / 2;    // shortest-way delta
        un = last.un + d;
      }
      this.hist.push({ t, raw: pos, un });
      if (this.hist.length > 400) this.hist.shift();
    }

    /** Least-squares drift of the jam centre, m/s. Negative = travels backwards. */
    waveSpeed() {
      const h = this.hist;
      if (h.length < 60) return null;
      const n = h.length;
      const mt = h.reduce((a, p) => a + p.t, 0) / n;
      const mx = h.reduce((a, p) => a + p.un, 0) / n;
      let num = 0, den = 0;
      for (const p of h) { num += (p.t - mt) * (p.un - mx); den += (p.t - mt) ** 2; }
      if (den < 1e-6) return null;
      return num / den;
    }

    draw() {
      const { ctx, w, h } = ctxOf(this.canvas);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.buf, 0, 0, w, h);
      label(ctx, '0 m', 3, h - 4);
      label(ctx, 'ring', w - 3, h - 4, 'right');
      label(ctx, 'now', 3, 10);
    }

    reset() {
      this.bctx.fillStyle = '#0b0e13';
      this.bctx.fillRect(0, 0, this.buf.width, this.buf.height);
      this.hist.length = 0;
    }
  }

  /* ---- 2. sigma_v(t) --------------------------------------------------------- */
  class Sigma {
    constructor(canvas) { this.canvas = canvas; canvas.style.height = '90px'; this.d = []; }
    push(std) { this.d.push(std); if (this.d.length > 600) this.d.shift(); }
    reset() { this.d.length = 0; }

    draw() {
      const { ctx, w, h } = ctxOf(this.canvas);
      const pad = { l: 26, r: 6, t: 8, b: 14 };
      ctx.clearRect(0, 0, w, h);
      const top = Math.max(4, Math.ceil(Math.max(0, ...this.d)));
      const px = i => pad.l + (i / Math.max(1, 599)) * (w - pad.l - pad.r);
      const py = v => h - pad.b - (v / top) * (h - pad.t - pad.b);

      ctx.strokeStyle = GRID;
      for (let g = 1; g <= 2; g++) {
        const y = py(top * g / 2);
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      }
      axes(ctx, w, h, pad);
      label(ctx, top.toFixed(0), pad.l - 3, pad.t + 7, 'right');
      label(ctx, '0', pad.l - 3, h - pad.b, 'right');
      label(ctx, 'mph', pad.l - 3, h - 3, 'right');

      if (this.d.length > 1) {
        ctx.strokeStyle = '#4aa3ff'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        this.d.forEach((v, i) => i ? ctx.lineTo(px(i), py(v)) : ctx.moveTo(px(i), py(v)));
        ctx.stroke();
      }
    }
  }

  /* ---- 3. fundamental diagram -----------------------------------------------
   * Points persist across host parameter changes, so sweeping the car count up and
   * back down over a session traces the inverted-V -- and, because jams clear at a
   * lower density than they form at, a hysteresis loop.
   */
  class Fundamental {
    constructor(canvas) { this.canvas = canvas; canvas.style.height = '110px'; this.pts = []; }
    push(densityPerKm, flowPerHr, jammed) {
      this.pts.push({ x: densityPerKm, y: flowPerHr, j: jammed });
      if (this.pts.length > 3000) this.pts.shift();
    }
    reset() { this.pts.length = 0; }

    draw(cur) {
      const { ctx, w, h } = ctxOf(this.canvas);
      const pad = { l: 32, r: 8, t: 8, b: 18 };
      ctx.clearRect(0, 0, w, h);
      const maxX = 225, maxY = Math.max(1800, ...this.pts.map(p => p.y));
      const px = x => pad.l + (x / maxX) * (w - pad.l - pad.r);
      const py = y => h - pad.b - (y / maxY) * (h - pad.t - pad.b);

      axes(ctx, w, h, pad);
      label(ctx, String(Math.round(maxY)), pad.l - 3, pad.t + 7, 'right');
      label(ctx, 'veh/h', pad.l - 3, pad.t + 17, 'right');
      label(ctx, '0', pad.l, h - 4);
      label(ctx, `${maxX} veh/mi`, w - pad.r, h - 4, 'right');

      for (const p of this.pts) {
        ctx.fillStyle = p.j ? 'rgba(255,77,77,.5)' : 'rgba(61,220,132,.5)';
        ctx.fillRect(px(p.x) - 1, py(p.y) - 1, 2, 2);
      }
      if (cur) {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(px(cur.x), py(cur.y), 3, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  /* ---- 4. phase portrait ----------------------------------------------------- */
  class Phase {
    constructor(canvas) { this.canvas = canvas; canvas.style.height = '110px'; this.trail = []; }
    push(gap, v) { this.trail.push([gap, v]); if (this.trail.length > 900) this.trail.shift(); }
    reset() { this.trail.length = 0; }

    draw() {
      const { ctx, w, h } = ctxOf(this.canvas);
      const pad = { l: 30, r: 8, t: 8, b: 18 };
      ctx.clearRect(0, 0, w, h);
      const maxG = Math.max(100, ...this.trail.map(p => p[0]));   // feet
      const maxV = Math.max(30, ...this.trail.map(p => p[1]));    // mph
      const px = g => pad.l + (g / maxG) * (w - pad.l - pad.r);
      const py = v => h - pad.b - (v / maxV) * (h - pad.t - pad.b);

      axes(ctx, w, h, pad);
      label(ctx, `${Math.round(maxV)}`, pad.l - 3, pad.t + 7, 'right');
      label(ctx, 'mph', pad.l - 3, pad.t + 17, 'right');
      label(ctx, 'headway (ft) →', w - pad.r, h - 5, 'right');

      // fade the trail so the direction of travel around the loop is readable
      for (let i = 1; i < this.trail.length; i++) {
        const a = i / this.trail.length;
        ctx.strokeStyle = `rgba(185,140,255,${0.06 + a * 0.85})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(px(this.trail[i - 1][0]), py(this.trail[i - 1][1]));
        ctx.lineTo(px(this.trail[i][0]), py(this.trail[i][1]));
        ctx.stroke();
      }
      const last = this.trail[this.trail.length - 1];
      if (last) {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(px(last[0]), py(last[1]), 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  return { SpaceTime, Sigma, Fundamental, Phase };
})();

let fails = 0;
const ok = (cond, msg) => { print((cond ? '  OK      ' : '  FAIL    ') + msg); if (!cond) fails++; };

/** A ring of `n` cars; `jam` puts a slow cluster near s=100. */
function frameAt(t, { n = 22, L = 400, jam = true, youIdx = 6, youV = null,
                      bumpYou = false, hitYou = false, aheadName = null } = {}) {
    const cars = [];
    for (let i = 0; i < n; i++) {
        const s = (i * (L / n) + t * 8) % L;
        const slow = jam && Math.abs(((s - 100 + 600) % L) - 200) > 170;
        let v = slow ? 1.2 : 14.0;
        if (i === youIdx && youV !== null) v = youV;
        // the car ahead of you is index youIdx+1; name it to make it a person
        const isAhead = aheadName && i === youIdx + 1;
        cars.push([i + 1, s, v, i === youIdx || !!isAhead,
                   i === youIdx ? 'ana' : (isAhead ? aheadName : ''), '#4aa3ff',
                   (bumpYou && i === youIdx) ? 1 : 0,
                   Math.floor(t / 50), 0, i === youIdx ? 2 : 0,
                   (hitYou && i === youIdx) ? 1 : 0]);
    }
    const vs = cars.map(c => c[2]);
    const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
    const std = Math.sqrt(vs.reduce((a, v) => a + (v - mean) ** 2, 0) / vs.length);
    return { type: 'state', t, cars,
        stats: { mean_v: mean, std_v: std, flow: (n / L) * mean, density: n / L, min_v: Math.min(...vs) } };
}

function welcome(extra) {
    WS.onmessage({ data: JSON.stringify(Object.assign({
        type: 'welcome', you: null, car_len: 4.5, is_host: false,
        params: { L: 400, N: 22, A: 1.0, T: 1.5, V0: 30 }, join_url: '169.231.23.171:8888/drive',
    }, extra)) });
}

function feed(n, opts, ms = 33) {
    let t = globalThis._simT || 0;
    for (let i = 0; i < n; i++) {
        t += 1 / 30;
        WS.onmessage({ data: JSON.stringify(frameAt(t, opts)) });
        step(ms);
    }
    globalThis._simT = t;
}

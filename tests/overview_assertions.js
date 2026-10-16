/* Overview page: spectator connection, ring + four plots, instructor panel. */
registerIds(PAGE_IDS, PAGE_HIDDEN);

print('-- overview page --');
ok(MISSING.size === 0, `all element ids exist (missing: ${[...MISSING].join(',') || 'none'})`);

// connects immediately, as a SPECTATOR: it must not consume a seat on the ring
ok(OPENED === 1, 'overview connects on load without any user action');
WS.onopen();
const hello = SENT[0];
ok(hello.type === 'hello' && hello.drive === false,
   `announces itself as a spectator: ${JSON.stringify(hello)}`);

welcome({ is_host: true });
ok(ELS['host'].hidden === false, 'instructor panel revealed with a valid token');
// re-check AFTER the host panel wires itself up: its knobs are only looked up here,
// so an id added to the panel but not to the page would slip past the check above
ok(MISSING.size === 0, `instructor panel ids all exist (missing: ${[...MISSING].join(',') || 'none'})`);
ok(String(ELS['joinurl'].querySelector('b').textContent).includes('/drive'),
   `projector shows the drivers' URL: ${ELS['joinurl'].querySelector('b').textContent}`);
// on localhost the page must fall back to the server's LAN guess, not advertise
// "localhost/drive" to a room full of people
ok(String(ELS['joinurl'].querySelector('b').textContent).startsWith('169.231'),
   `localhost falls back to the LAN address the server reported: ${ELS['joinurl'].querySelector('b').textContent}`);

// ...but served from a real hostname (a tunnel), it must advertise THAT, so drivers
// off the network get a reachable address rather than the server's private IP
location.hostname = 'wild-pine-1234.trycloudflare.com';
location.origin = 'https://wild-pine-1234.trycloudflare.com';
welcome({ is_host: true });
ok(String(ELS['joinurl'].querySelector('b').textContent) === 'wild-pine-1234.trycloudflare.com/drive',
   `tunnel host advertises itself: ${ELS['joinurl'].querySelector('b').textContent}`);
location.hostname = '127.0.0.1';
location.origin = 'http://127.0.0.1:8888';
ok(String(ELS['oN'].textContent).includes('89'), `density in veh/mi: "${ELS['oN'].textContent}"`);

feed(120, { jam: true });
ok(CTX_CALLS > 1000, `ring and plots drew (${CTX_CALLS} ctx calls)`);
ok(String(ELS['meanv'].textContent) !== '0', `mean speed readout: ${ELS['meanv'].textContent} km/h`);
ok(+ELS['density'].textContent === 89, `density readout: ${ELS['density'].textContent} veh/mi`);
// 14 m/s of traffic is 31 mph, not 50 km/h -- guards against a slip back to metric
ok(+ELS['meanv'].textContent === 27, `mean speed in mph: ${ELS['meanv'].textContent} (would read 44 in km/h)`);
ok(String(ELS['oL'].textContent).includes('ft'), `ring length in feet: ${ELS['oL'].textContent}`);
ok(+ELS['online'].textContent === 1, `driver count: ${ELS['online'].textContent}`);
ok(String(ELS['sigmacap'].textContent).includes('stop-and-go'),
   `sigma caption: ${ELS['sigmacap'].textContent}`);
ok(String(ELS['sigmacap'].textContent).includes('mph'), 'sigma caption uses mph');
ok(!String(ELS['wavecap'].textContent).includes('km/h'), 'wave caption is not metric');
ok(!String(ELS['wavecap'].textContent).includes('NaN'),
   `wave caption clean: "${ELS['wavecap'].textContent}"`);

// several laps: the 0/L seam must not produce NaNs or backwards streaks
feed(400, { jam: true });
ok(!String(ELS['wavecap'].textContent).includes('NaN'), 'survived laps across the 0/L seam');

// host knobs
ELS['rA'].value = '0.5'; ELS['rA'].fire('input');
let a = SENT[SENT.length - 1];
ok(a.type === 'admin' && a.key === 'A' && a.value === 0.5, `responsiveness knob -> ${JSON.stringify(a)}`);
ELS['rNOISE'].value = '0'; ELS['rNOISE'].fire('input');
a = SENT[SENT.length - 1];
ok(a.key === 'NOISE' && a.value === 0, `noise knob -> ${JSON.stringify(a)}`);
ok(String(ELS['oNOISE'].textContent) === 'off', `noise reads "off" at zero: ${ELS['oNOISE'].textContent}`);
ELS['rSPREAD'].value = '0.2'; ELS['rSPREAD'].fire('input');
a = SENT[SENT.length - 1];
ok(a.key === 'SPREAD' && Math.abs(a.value - 0.2) < 1e-9, `variation knob -> ${JSON.stringify(a)}`);
ok(String(ELS['regime'].textContent).includes('veh/mi'), `regime hint: ${ELS['regime'].textContent.slice(0,50)}...`);
// --- a laggy link must not fight the instructor's drag.
// The server echoes `params` to everyone after each change. Written straight back
// into the slider, the echo for where it WAS arrives mid-drag over a hosted
// deployment (~100 ms) and drags it backwards -- the control feels stuck. Locally
// the round trip hides it completely, so this only ever showed up in production.
const P = () => ({ L: 400, N: 30, A: 0.6, T: 1.2, V0: 30, SPREAD: 0.12, NOISE: 0.25, SEED: 0.3 });
for (const v of [40, 45, 50]) {            // the user drags
  ELS['rN'].value = String(v);
  ELS['rN'].fire('input');
}
ok(Number(ELS['rN'].value) === 50, `slider follows the drag: ${ELS['rN'].value}`);
for (const v of [40, 45]) {                // stale echoes land afterwards
  const p = P(); p.N = v;
  WS.onmessage({ data: JSON.stringify({ type: 'params', params: p }) });
}
ok(Number(ELS['rN'].value) === 50,
   `stale echo did not stomp the slider (is ${ELS['rN'].value}, user left it at 50)`);
const pNow = P(); pNow.N = 50;
WS.onmessage({ data: JSON.stringify({ type: 'params', params: pNow }) });
ok(Number(ELS['rN'].value) === 50, 'matching echo is accepted');
// and once we agree, the server is authoritative again (e.g. another instructor)
const pOther = P(); pOther.N = 18;
WS.onmessage({ data: JSON.stringify({ type: 'params', params: pOther }) });
ok(Number(ELS['rN'].value) === 18,
   `server stays authoritative after we are in sync: ${ELS['rN'].value}`);

ELS['perturb'].fire('click');
ok(SENT[SENT.length - 1].action === 'perturb', 'perturb button');
ELS['reset'].fire('click');
ok(SENT[SENT.length - 1].action === 'reset', 'reset button');

// --- crash leaderboard
ok(String(ELS['board'].innerHTML).includes('ana'), 'leaderboard lists the human driver');
ok(String(ELS['board'].innerHTML).includes('>2<'), `leaderboard shows the crash count: ${ELS['board'].innerHTML.slice(0,120)}`);
ok(!String(ELS['board'].innerHTML).includes('autopilot'), 'bots are kept off the leaderboard');

// --- join QR
ok(String(ELS['qr'].src) === '/qr.svg', `QR points at the endpoint: ${ELS['qr'].src}`);
ok(ELS['qr'].hidden === true, 'QR stays hidden until it actually loads (segno may be absent)');
ELS['qr'].onload();
ok(ELS['qr'].hidden === false, 'QR shows once loaded');

// a stale instructor link must SAY so rather than silently hiding the controls
ELS['notice'].hidden = true;
welcome({ is_host: false, host_rejected: true });
ok(ELS['notice'].hidden === false, 'stale host token raises a visible notice');
ok(String(ELS['notice'].innerHTML).includes('logs/server.log'),
   'notice says how to recover the current link');

// a reset rewinds sim time; the overview must follow it
globalThis._simT = 0;
let threw = null;
try { feed(90, { jam: false }); } catch (e) { threw = e.message; }
ok(threw === null, `survived a mid-session reset (${threw || 'no throw'})`);
ok(String(ELS['sigmacap'].textContent).includes('uniform flow'),
   `panels followed the reset: ${ELS['sigmacap'].textContent}`);

print(fails === 0 ? 'OVERVIEW OK' : `${fails} OVERVIEW CHECK(S) FAILED`);
if (fails) imports.system.exit(1);

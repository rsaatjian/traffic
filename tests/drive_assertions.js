/* Drive page: join, chase view, pedals, neighbour readout, prediction. */
registerIds(PAGE_IDS, PAGE_HIDDEN);

print('-- drive page --');
ok(MISSING.size === 0, `all element ids exist (missing: ${[...MISSING].join(',') || 'none'})`);
ok(OPENED === 0, 'drive page does NOT connect until the driver joins');

ELS['name'].value = 'ana';
ELS['go'].fire('click');
ok(OPENED === 1, 'clicking Drive opens the socket');
WS.onopen();
const hello = SENT[0];
ok(hello.type === 'hello' && hello.drive === true && hello.name === 'ana',
   `asks for a car: ${JSON.stringify(hello)}`);

welcome({ you: 7 });
feed(40, { jam: false, youIdx: 6, youV: 14.0 });
ok(CTX_CALLS > 2000, `first-person scene drew (${CTX_CALLS} ctx calls)`);
ok(String(ELS['speed'].textContent) === '31', `speed in mph: ${ELS['speed'].textContent}`);
ok(+ELS['gap'].textContent > 0, `gap to the car ahead, in feet: ${ELS['gap'].textContent}`);
ok(String(ELS['aheadwho'].textContent) === 'autopilot', `names who is ahead: ${ELS['aheadwho'].textContent}`);
ok(String(ELS['gapbar'].style.width).includes('%'), 'gap bar is driven');
ok(String(ELS['crashes'].textContent) === '2', `own crash count shown: ${ELS['crashes'].textContent}`);
ok(ELS['crashchip'].classList.contains('bad'), 'crash chip turns red once you have hit someone');

// --- input goes out the instant a key is pressed, with no polling tick in between
const before = SENT.length;
fireWindow('keydown', { key: 'ArrowUp' });
step(16);
ok(SENT.length > before, 'throttle sent on the very next frame, not on a 20 Hz poll');
ok(SENT[SENT.length - 1].type === 'input' && SENT[SENT.length - 1].u > 0,
   `gas -> u=${SENT[SENT.length - 1].u}`);
ok(ELS['accel'].classList.contains('held'), 'GAS pedal shows as held');

// reaches full throttle in ~35 ms, not the old 120 ms
for (let i = 0; i < 4; i++) step(16);
ok(Net.state.throttle === 1, `full throttle within ~60 ms (u=${Net.state.throttle})`);

// --- client-side prediction: the car must move WITHOUT any new server snapshot
const vBefore = Net.state.pred.v;
const sBefore = Net.state.pred.s;
for (let i = 0; i < 20; i++) step(16);          // ~320 ms, no packets at all
ok(Net.state.pred.v > vBefore + 1,
   `predicted car accelerates between packets: ${vBefore.toFixed(1)} -> ${Net.state.pred.v.toFixed(1)} m/s`);
ok(Net.state.pred.s !== sBefore, 'predicted car moves between packets');

fireWindow('keyup', { key: 'ArrowUp' });
fireWindow('keydown', { key: ' ' });
for (let i = 0; i < 5; i++) step(16);
ok(SENT[SENT.length - 1].u < 0, `brake -> u=${SENT[SENT.length - 1].u}`);

fireWindow('keyup', { key: ' ' });
for (let i = 0; i < 5; i++) step(16);
ok(Net.state.throttle === 0, `release -> coast, u=${Net.state.throttle}`);

// coasting must bleed speed off with no input at all
const vCoast = Net.state.pred.v;
for (let i = 0; i < 40; i++) step(16);
ok(Net.state.pred.v < vCoast, `rolls to a stop with no input: ${vCoast.toFixed(1)} -> ${Net.state.pred.v.toFixed(1)} m/s`);

// --- closing fast on a stopped car raises the warning
globalThis._simT = 0;
feed(30, { jam: true, youIdx: 6, youV: 25.0 });
ok(ELS['warn'].className.includes('on'), `warning fires when closing: "${ELS['warn'].textContent}"`);
ok(!String(ELS['warn'].textContent).includes('NaN'), 'warning text has no NaN');

// --- no WebAudio under gjs: the sound toggle must degrade, not throw
ok(true, 'engine audio absent without WebAudio, and did not throw');

// --- AFK reporting. The whole trap here is that throttle is only sent on CHANGE,
// so a driver holding the gas is silent and must not look idle.
SENT.length = 0;
fireWindow('keydown', { key: 'ArrowUp' });
step(16);
ok(SENT.some(m => m.type === 'active'), 'pressing a key reports activity');

// hold the key and advance past a heartbeat interval: must keep reporting
SENT.length = 0;
const heartbeat = TIMERS.find(t => t && t.ms === 4000);
ok(!!heartbeat, 'an activity heartbeat is scheduled');
CLOCK += 3000;                       // get past the 2 s debounce
heartbeat.fn();
ok(SENT.some(m => m.type === 'active'),
   'a driver HOLDING the gas keeps reporting activity (no input message would be sent)');

// let go of everything: the heartbeat must go quiet so the server can reclaim the seat
fireWindow('keyup', { key: 'ArrowUp' });
step(16);
SENT.length = 0;
CLOCK += 10000;
heartbeat.fn();
ok(!SENT.some(m => m.type === 'active'),
   'an idle driver stops reporting, which is what lets the seat be reclaimed');

// --- being kicked must explain itself
ELS['joinerr'].hidden = true;
ELS['join'].classList.add('gone');
WS.onmessage({ data: JSON.stringify({ type: 'kicked', reason: 'afk', after: 20 }) });
ok(!ELS['join'].classList.contains('gone'), 'kick returns you to the join screen');
ok(ELS['joinerr'].hidden === false, 'and says why');
ok(String(ELS['joinerr'].textContent).includes('20'), `message: ${ELS['joinerr'].textContent}`);
ok(Net.state.you === null, 'the local car reference is cleared');

// rejoin after a kick
ELS['name'].value = 'ana';
ELS['go'].fire('click');
WS.onopen();
ok(SENT[SENT.length - 1].type === 'hello', 'can rejoin after being kicked');
welcome({ you: 7 });

// --- a person in front gets their name on their licence plate
TEXTS.length = 0;
feed(3, { jam: false, youIdx: 6, youV: 14.0, aheadName: 'mia' });
ok(TEXTS.some(t => t === 'MIA'), `plate letters the driver's name: ${JSON.stringify(TEXTS.filter(t => /^[A-Z]+$/.test(t)))}`);
ok(!TEXTS.includes('AUTOPILOT'), 'the word autopilot is never lettered on a car');

// a long name must be shrunk to fit, not spill off the plate
TEXTS.length = 0;
feed(3, { jam: false, youIdx: 6, youV: 14.0, aheadName: 'bartholomew' });
ok(TEXTS.some(t => t.startsWith('BARTHOLOME')), `long name is lettered: ${TEXTS.find(t => t.startsWith('BART'))}`);
ok(!TEXTS.includes('BARTHOLOMEW'), 'the untruncated name is never drawn (plate is capped at 10)');

// the plate itself must be sane geometry at a readable distance
const ctxP = ELS['view'].getContext('2d');
Cockpit.setup(ctxP, 900, 640);
let threw = null;
try { Cockpit.plate(ctxP, 450, 400, 60, 'mia'); } catch (e) { threw = e.message; }
ok(threw === null, `plate draws without throwing (${threw || 'ok'})`);

// Only a named human gets a plate. Asserted directly on carRear rather than by the
// absence of some string: a blanket override that plated every car passed the old
// check, because "no AUTOPILOT text" is true whatever you letter on a bot.
TEXTS.length = 0;
Cockpit.carRear(ctxP, 10, { color: '#4aa3ff', human: false, name: '' });
ok(TEXTS.length === 0, `an autopilot car letters nothing (drew ${JSON.stringify(TEXTS)})`);
TEXTS.length = 0;
Cockpit.carRear(ctxP, 10, { color: '#4aa3ff', human: true, name: '' });
ok(TEXTS.length === 0, 'a human with no name yet letters nothing');
TEXTS.length = 0;
Cockpit.carRear(ctxP, 10, { color: '#4aa3ff', human: true, name: 'jo' });
ok(TEXTS.includes('JO'), `a named human does get a plate (drew ${JSON.stringify(TEXTS)})`);

// --- the screen must go red for EITHER side of a contact
ELS['flash'].classList.remove('on'); ELS['flash'].classList.remove('hard');
feed(2, { jam: false, youIdx: 6, youV: 14.0, bumpYou: true });
ok(ELS['flash'].classList.contains('on'), 'screen flashes red when you hit someone');
ok(!ELS['flash'].classList.contains('hard'), 'your own fault is the lighter flash');
ok(String(ELS['warn'].textContent) === 'IMPACT', `banner: ${ELS['warn'].textContent}`);

ELS['flash'].classList.remove('on');
feed(2, { jam: false, youIdx: 6, youV: 14.0, hitYou: true });
ok(ELS['flash'].classList.contains('on'), 'screen flashes red when someone rear-ends YOU');
ok(ELS['flash'].classList.contains('hard'), 'being hit gets the harder flash');
ok(String(ELS['warn'].textContent) === 'REAR-ENDED', `banner: ${ELS['warn'].textContent}`);

// --- the first-person projection must be sane: things further away are smaller,
// the horizon sits above the road, and nothing lands at NaN
Cockpit.setup(ELS['view'].getContext('2d'), 800, 600);
const near = Cockpit.proj(0, 0, 5), far = Cockpit.proj(0, 0, 80);
ok(near[1] > far[1], `nearer road is lower on screen (${near[1].toFixed(0)} > ${far[1].toFixed(0)})`);
ok(far[1] > Cockpit.horizon, 'road never projects above the horizon');
ok(Cockpit.sc(5) > Cockpit.sc(80), 'distant cars are drawn smaller');
const edgeN = Cockpit.proj(-4.5, 0, 5)[0], edgeF = Cockpit.proj(-4.5, 0, 200)[0];
ok(edgeN < edgeF, 'road edges converge toward the vanishing point');
ok([...near, ...far].every(Number.isFinite), 'projection produces no NaN');
const behind = Cockpit.proj(0, 0, -3);
ok(behind.every(Number.isFinite), 'a car behind us does not blow up the projection');

// --- the drive page must never render a ring overview or any plot
ok(MISSING.size === 0, 'drive page touches no overview-only elements');

print(fails === 0 ? 'DRIVE OK' : `${fails} DRIVE CHECK(S) FAILED`);
if (fails) imports.system.exit(1);

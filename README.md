# Ring Road — a multiplayer phantom traffic jam

A browser game and a live demo of a Hopf bifurcation. Students join from their own
laptops and drive a car around a **single-lane circular road with no passing**. The
only controls are accelerate and brake.

Above a critical density the uniform-flow state loses stability: a stop-and-go wave
appears and travels **backwards** around the ring while every car in it drives
forwards. Nobody causes it. That is the lesson.

```
   ___________              cars →                 jam ←
  /  →C1  →C2 \        ▓▓▓▓░░░░░░░░░░░░▓▓▓▓░░░░░░░░░░░░
 |             |       the dark band drifts one way,
  \  →C4  →C3 /        the cars drift through it the other way
   -----------
```

## Run it

Needs Python 3 and `tornado` — both already in the conda `base` env. No npm, no build.

`segno` (pure Python, no transitive deps) is optional and only powers the join QR
code: `pip install segno`. Without it `/qr.svg` 404s, the QR panel stays hidden, and
the overview shows the join URL as text exactly as before.

```bash
./run.sh                      # http://<your-ip>:8700, logs to logs/server.log
./run.sh --port 9000 --cars 30
```

Default port is **8700**, not 8888 — 8888 is Jupyter's default and collides. If the
port is taken the server says so in one line and suggests another, rather than dumping
a traceback.

The startup banner prints three URLs:

```
drivers:     http://192.168.4.23:8700/drive
overview:    http://192.168.4.23:8700/
instructor:  http://192.168.4.23:8700/?host=XXXXXXXX
```

## Hosting it somewhere

The app is a **single stateful process**: the ring lives in one module-level object
stepped at 60 Hz. That rules out anything serverless or autoscaling — two instances
means two unrelated simulations and students silently split between them. Pin any
deployment to exactly one instance.

It needs very little CPU (~0.4% of a core, measured, mostly JSON) but a fair amount of
egress: a 1.7 KB frame at 30 Hz per client is **~12 Mbit/s and 5.5 GB per hour with 30
students**. That, not compute, is what a free tier will object to.

### Deploying to Render

`render.yaml` is a Blueprint, so Render can configure itself:

1. Push to GitHub (done), then in Render: **New > Blueprint**, pick this repo, Apply.
2. It reads `render.yaml`: free plan, `pip install -r requirements.txt`,
   `python server.py`, health check on `/healthz`, Python from `.python-version`.
3. **Get your instructor link from the deploy logs.** The startup banner prints it
   in full, using the real `onrender.com` address:

   ```
   instructor:  https://ring-road.onrender.com/?host=XXXXXXXX
   ```

   The token is also under the service's **Environment** tab as `HOST_TOKEN`. It is
   generated once and kept, so the link survives redeploys. Your *local* token is a
   different one and will not work here — opening the hosted overview without the
   right `?host=` gives you a spectator view with no controls, and the page now says
   so rather than just looking empty.
4. Optionally set `DRIVER_PIN` there to require a PIN to drive.

Or configure a Web Service by hand with the same build and start commands.

**The free plan sleeps after 15 minutes idle** and takes roughly a minute to wake,
during which the simulation restarts from scratch. Load the overview a couple of
minutes before class and it will be warm. Egress is the other limit: at ~5.5 GB per
hour with 30 drivers, the 100 GB/month allowance is about 18 lecture-hours.

For any other platform, the two requirements are the same:

```
build:  pip install -r requirements.txt
start:  python server.py          # binds $PORT automatically
```

**For a live class, a tunnel from your own laptop is usually better than a free host**
— no cold start, no instance limits, lower latency since you are in the room, and you
control it. A host only wins if students need a stable URL outside class.

## Drivers off your network

The ring works for anyone on the internet without changing a line of configuration:

```bash
./run.sh --pin 1234      # terminal 1 -- set a PIN before going public
./share.sh               # terminal 2 -- prints a public https URL
```

`share.sh` opens a **Cloudflare quick tunnel**: no account, no signup, WebSockets pass
through, and the URL dies when you Ctrl-C it. It downloads a single `cloudflared`
binary into the project on first run.

Then load the overview at the public URL and the QR code points there automatically —
**the join URL follows whatever host you arrived on**. On the LAN it shows your LAN
address; through a tunnel it shows the tunnel hostname; opened on `localhost` it falls
back to the LAN address, because "localhost/drive" is useless to a room full of people.
Nothing needs to be told which mode it is in.

Two things to know before you expose it:

- **Set a PIN.** `--pin 1234` gates taking a car; watching the overview stays open.
  Without one, anybody who has the link can drive into your class demo. The instructor
  panel is still behind its own separate token either way.
- **The tunnel URL is ephemeral** and changes every run, so hand it out at the start of
  the session rather than putting it on a syllabus.

Latency is fine for this: your own car is predicted locally, so remote drivers get the
same instant pedal response, and other cars are interpolated where a round trip does
not show.

## Two screens

**`/` — the overview.** Every car on the ring, a **join QR code** for the projector,
a **crash leaderboard**, and the four diagnostic plots. This is
the projector view. It connects as a *spectator*: it never takes a car, so putting the
demo on screen does not change the density. It also displays the drivers' join URL in
the top-right corner, so you can just point at it.

**`/drive` — the driver.** A chase camera that rides with your car and rotates so you
always point up the screen, so the road comes at you instead of sitting there. Speed,
the gap to the car ahead, two pedals. That is everything you get.

The split is the experiment, not just layout. A driver who could see the whole ring
would anticipate the jam, and anticipation is precisely what real drivers lack — they
know only the gap to the car ahead. Withholding the overview from the drivers is what
makes the emergent behaviour real rather than performed.

The `?host=` link adds the instructor panel to the overview. A driver's browser cannot
reach those controls even if they guess the message format.

The token is stored in `.host_token` and **survives restarts**, so an instructor
bookmark keeps working. Rotate it deliberately with `./run.sh --new-token`. If a link
does go stale the overview says so on screen rather than just quietly appearing without
controls — which is impossible to diagnose mid-lecture.

### Instructor panel

| knob | what it does |
|---|---|
| **Cars** | density — the primary bifurcation parameter. Below ~64 veh/mi perturbations decay; above it they grow |
| **Ring length** | the other half of density |
| **Driver responsiveness** (`a`) | a *pure* stability knob: it barely moves the equilibrium speed but decides whether the ring is stable. Drop it to jam a sparser ring |
| **Time headway** (`T`) | following distance. Destabilises in whichever direction moves you onto the steeper part of the equilibrium curve — at the shipped defaults that is *downward* |
| **Driver variation** | spread of desired speeds between drivers (the seed) |
| **Speed-holding noise** | how imperfectly drivers hold a speed (the other seed) |
| **Starting bunching** | how non-uniform the ring is at reset — the main control on how fast a jam appears |
| **Bot reaction time** | 0 = classic instantaneous IDM (the default). Above 0 the autopilot answers late, which makes it possible to rear-end — but moves the stability boundary, so the demo numbers below stop holding |
| **Tap the brakes** | one bot brakes hard for a second — triggers the wave on cue |
| **Reset** | uniform ring, clocks restarted |

## Controls

| | |
|---|---|
| accelerate | `↑` / `W`, or the green pedal on a phone |
| brake | `↓` / `S` / `space`, or the red pedal |
| nothing | you **roll to a stop** — there is no cruise control |

The throttle ramps over ~120 ms, so it behaves like a pedal rather than a switch. You
cannot pass, and you cannot drive through the car in front — if you hit it, the screen
flashes red and you inherit their speed.

A human car carries rolling resistance plus aero drag, so holding a steady speed takes
continuous light throttle. Flat out you reach **~84 mph against the bots' 67**, so
you can outrun traffic on open road — though with no passing, extra speed only closes
gaps sooner, it never gets you past anyone.

Drag is applied to human cars **only**. The IDM's free-flow term already plays the role
of drag for a bot — it is what makes a bot ease off near its desired speed — so adding
a second drag term would double-count, drop every equilibrium speed, and move the
density threshold that `test_sim.py` pins down. Bots keep the dynamics that were
measured.

## The four panels

| panel | what it is | what to watch for |
|---|---|---|
| **Space–time** | position across, time downward, coloured by speed | dark stripes leaning backwards — the jam. Their tilt *is* the wave speed, printed underneath |
| **σᵥ(t)** | spread of speeds — the order parameter | ≈ 0 is uniform flow. Growth after a kick means the fixed point is unstable |
| **Fundamental diagram** | flow vs density, one dot per second, kept across resets | sweep the car count up then back down to trace the inverted-V and its hysteresis loop |
| **Phase portrait** | headway vs speed for your car | a *point* = fixed point; a *closed loop* = limit cycle |

## Teaching with it

### Why the ring jams on its own

Real traffic is never uniform, and the ring instability needs something to amplify.
Two physical terms supply it, both adjustable from the instructor panel:

- **Starting bunching** (`SEED`, 30% of the mean spacing) — the ring starts as a
  plausible piece of traffic, mildly clustered with the cars inside the cluster already
  a little slower, rather than perfectly evenly spaced. This is the big one for onset
  time: a ring that starts exactly on the fixed point has to climb all the way back out
  of it.
- **Driver variation** (`SPREAD`, ±12%) — each bot has its own desired speed and
  following distance. A slower-than-average driver is a standing bottleneck.
- **Speed-holding noise** (`NOISE`, 0.25 m/s²) — nobody holds a speed perfectly.

None of them *causes* the jam. Set all three to zero and the ring still jams from a tap
of the brakes — it just takes about thirteen minutes to grow from rounding-level seeds,
which is faithful to the mathematics and useless in a lecture.
`test_noise_and_spread_are_seeds_not_causes` pins that down so the tuning can never
quietly become a cheat, and the low-density row above is the other half of the proof:
the same bunched start simply smooths out below the critical density.

### The density ladder

Measured at the shipped parameters, with **no perturbation and nobody driving**.
"Visible jam" means some car is actually crawling below 7 mph:

| density | cars / 1312 ft | visible jam | mean speed | speed swing | regime |
|---|---|---|---|---|---|
| 32 veh/mi | 8 | never | 57 mph | 0.3 mph | free flow |
| 48 veh/mi | 12 | never | 45 mph | 0.5 mph | free flow |
| 64 veh/mi | 16 | never | 30 mph | 14 mph | **marginal** |
| 80 veh/mi | 20 | 100 s | 14 mph | 32 mph | jams on its own |
| 97 veh/mi | 24 | 57 s | 11 mph | 30 mph | jams on its own |
| **121 veh/mi** | **30** | **37 s** | 7 mph | 28 mph | ← default |
| 137 veh/mi | 34 | 31 s | 6 mph | 26 mph | jams on its own |
| 161 veh/mi | 40 | 8 s | 4 mph | 20 mph | barely moves |

The "speed swing" column is the point: at the default the jam is genuinely stop-and-go,
with cars stopped in the cluster and back up to ~28 mph between clusters, not uniformly
crawling traffic. The wave itself travels **backwards at about 6 mph** while every car
drives forwards through it.

With people driving it is faster still — a single ordinary driver is a far bigger
perturbation than a bot.

A run that works:

1. **Start at 12 cars.** Ask the class to predict what happens if one driver brakes
   hard. Press *Tap the brakes*. It decays; the ring smooths back out to ~45 mph.
2. **Raise the car count to 30** and ask for the prediction again. Same kick, opposite
   outcome: the wave grows and never goes away. Nothing about any individual driver
   changed — only the density.
3. **Do not press anything.** At 30 cars the jam appears by itself in about 35 seconds.
   Nobody did anything — the disturbances present at 12 cars are exactly the ones
   present at 30; only the density decides whether they decay or grow. Step 1 is what
   makes this an experiment rather than an animation.
4. **Let the students drive.** They will try to avoid the jam and cause it anyway. The
   `Driver responsiveness` slider is the same instability in disguise: at fixed density
   it is a *pure* stability knob — dropping `a` from 2.0 to 0.6 m/s² destabilises a
   ring that alert drivers hold steady, while barely moving the equilibrium speed.
5. **Sweep the car count up and back down** and let the fundamental diagram accumulate.
   Jams clear at a lower density than they form at: bistability, drawn by the class.

Note on the `Time headway` slider: at fixed density, *raising* T destabilises. It moves
the operating point onto the steeper part of the equilibrium velocity curve, which is
the same thing raising density does. It is a second route to the same boundary, not an
independent one — worth mentioning if a student reaches for it expecting "more caution
= more stable".

## Crashes

Every rear-end is counted per driver and listed on the overview, with your own count
on the drive screen. A crash is the moment contact *begins* — one shunt is one crash.
That distinction matters more than it sounds: a car shoved against the one in front
stays clamped for as long as the queue is stopped, so counting clamped steps (or even
clamped steps past a cooldown) turned a single nose-to-tail into 19. It is a rising
edge on contact, with a short cooldown for chatter, and `test_sim.py` pins both ends
down: 30 s pinned against a parked car scores 1, and six separate run-ups score 6.

Bots are left off the board — the IDM essentially never touches anybody (0 crashes
over 180 s of jamming), so they would just be a column of zeroes.

## Who is on the ring

**A driver idle for more than 20 seconds loses their seat** (`--afk 20`, `0` disables)
and is told why, so they can rejoin. That keeps abandoned tabs from holding cars in a
class where more people want to drive than there are seats.

"Idle" deliberately does not mean "sent no messages". Throttle is only transmitted when
it *changes*, so someone holding the gas flat is silent for as long as they hold it and
would look exactly like an empty chair. The drive page reports activity explicitly
instead — debounced on real key and pedal events, plus a slow heartbeat while a control
is held. Spectators are exempt: the overview is meant to sit untouched on a projector.


A joining driver **takes over the bot in the largest gap**, so the density the
instructor set does not move. Only when every car already has a person in it does the
ring grow an extra seat — and that seat disappears again when they leave.

That matters more than it sounds: growth used to overwrite the target, so a session
where 50 people joined a 30-car ring ended with 50 bots still circulating at 201
veh/mi instead of 121, with no record that 30 was ever asked for. Overflow is now
temporary and `p.N` is never overwritten.

## Crashing into people

Brake-check the driver behind you and they will rear-end you; it lands on the crash
board and on their HUD. Contact counts only above ~10 mph of closing speed, so
shuffling nose-to-tail in a stopped queue is free.

**Both sides see it.** The screen flashes red whether you hit someone or someone hits
you — being rear-ended gets the harder flash and a `REAR-ENDED` banner, hitting
someone gets `IMPACT`. The crash itself is still charged to whoever ran into the back
of whom, so brake-checking does not pad your own score.

**A crash has no other effect — deliberately.** Cars are not immobilised, not slowed
beyond the inelastic contact that was always there, not penalised. A stopped wreck is a
*real* bottleneck with an obvious cause, and the entire point of this demo is a jam
that has none. `test_counting_a_crash_does_not_touch_the_dynamics` runs the same seed
with the threshold at zero and at infinity and asserts the trajectories are identical
to nine decimal places, so the crash board can never quietly become a cause.

One consequence worth knowing: **bots cannot be rear-ended at the default settings.**
Plain IDM reacts instantly with unlimited braking, so it always avoids you. Brake-
checking works on other *people*, who do not auto-brake. The `Bot reaction time` slider
makes the autopilot rear-endable too — measured, 0.5 s lets you wreck one from 59 ft at
45 mph — but it is off by default because it moves the stability boundary: at 0.5 s a
kick at 48 veh/mi stops decaying, and at 0.9 s free flow disappears altogether.

## Feel

The car is tuned as a go-kart, not a sedan — **0–60 mph in 4.2 s, 60–0 in 2.4 s**
(1.45 g of brake) — because the whole thing is judged on how it answers the key.

Input latency was the bigger half of the problem. The chain used to be ~200 ms: a 50 ms
input poll, a 120 ms throttle ramp, a 33 ms broadcast and a 100 ms interpolation delay.
Now:

- input goes out **the frame the key goes down**, not on a poll;
- the throttle ramp is 35 ms — enough that a tap is not a step function, short enough
  to read as instant;
- **your own car is predicted client-side** and reconciled against the server, so your
  inputs never wait for a round trip. Everyone else stays interpolated 70 ms back,
  where the delay is invisible and the smoothing is worth having.

The server is still fully authoritative — prediction only decides what *you* see
between packets, and a large disagreement snaps rather than easing.

## Brake lights

The single most useful thing on screen, and it is both the prettiest and the most
pedagogical. Every car's tail lights light when it decelerates, so a forming jam is a
chain of brake lights firing **backwards** around the ring, car by car, while every car
is still driving forwards. You can watch the wave propagate without reading a plot. The
overview counts how many cars are on the brakes.

## Units

The UI is in **mph, feet and veh/mile**. The simulation is SI internally — the IDM
literature, the physics constants and every threshold in `test_sim.py` are metric, and
converting inside the model would carry unit bugs into the dynamics. Conversion happens
at the edge, in `static/units.js`.

## How it works

The server owns the simulation; browsers only send a throttle and draw what they are
told. That is not incidental — if clients simulated their own car, the wave would be an
artifact of network lag rather than of the physics.

- `sim.py` — the physics. Pure, no I/O, importable, testable. Bots follow the
  Intelligent Driver Model; humans supply a throttle. Cars are held in ring order,
  which no-passing makes a permanent invariant and also the cheapest collision check.
- `server.py` — tornado. 60 Hz fixed-timestep loop, 30 Hz JSON broadcast.
- `static/` — vanilla JS, no framework, no build.
  `units.js` (display conversion) · `cars.js` (top-down car sprites) ·
  `track.js` (road geometry, shared by both cameras) · `fx.js` (skid marks, tyre smoke,
  screen shake, speed vignette, engine audio) · `net.js` (connection, buffer,
  interpolation, own-car prediction) · `charts.js` (the four plots) ·
  `overview.js` / `drive.js` (the two screens).
  Other cars render 70 ms in the past
  and interpolate between snapshots; deliberately never extrapolate, since
  extrapolation overshoots exactly at hard braking events and would draw collisions
  the server never simulated.

## Tests

```bash
python3 -u -m unittest test_sim -v     # physics
gjs tests/run_client_tests.js          # client, headless, real JS engine
```

`test_jam_appears_with_no_input_at_all` is the canary: it asserts the ring jams by
itself within 60 s across three seeds, and `test_the_jam_is_stop_and_go_not_just_slow_traffic`
asserts the result is a wave rather than uniformly crawling traffic. If it fails, an instructor stares at a smoothly
flowing ring and the point never lands. Run it before class.

The client tests take every element id from the real `index.html` / `drive.html`, so a
control added to the JS but not the markup (or a renamed id) fails the run.

The client tests execute the real `static/*.js` against a stub DOM and canvas under
`gjs` (SpiderMonkey), which catches syntax errors, missing element ids, bad canvas
calls and logic bugs without a browser.

## Tuning

Defaults live in `sim.py` (`Params`, and the constants above it). Density (`N`, `L`) and
driver responsiveness (`A`) are the two bifurcation knobs and are adjustable live from
the instructor panel; `--cars` and `--length` set the starting point.

"""Ring-road traffic physics.

Pure simulation: no I/O, no tornado, no networking. Everything is SI (metres,
metres/second); the UI converts to km/h for display.

The model is a single-lane circular road on which cars cannot pass. Human cars are
driven by a throttle in [-1, 1]; the rest follow the Intelligent Driver Model (IDM).
Above a critical density the uniform-flow solution loses stability and the system
settles into a travelling stop-and-go wave -- the phantom traffic jam.
"""
from __future__ import annotations

import math
import random
from collections import deque
from dataclasses import dataclass, field

# --- vehicle and road constants -------------------------------------------------
CAR_LEN = 4.5     # m, bumper to bumper
MIN_GAP = 0.5     # m, hard floor enforced by the no-pass constraint
# The human car is tuned for FEEL, not for realism: a go-kart, not a sedan. 0-60 in
# about four seconds and 1.3 g of brake, because the whole experience is judged on how
# the car answers the key. The bots are a separate model (IDM) and are untouched by
# these, so none of this moves the density threshold the demo rests on.
A_MAX = 9.0       # m/s^2, human max acceleration (~0.8 g)
B_MAX = 13.0      # m/s^2, human max braking (~1.3 g)
IDM_A = 1.0       # m/s^2, default IDM max acceleration (per-ring, see Params.A)

# Passive deceleration on a human-driven car: rolling resistance plus aero drag.
# Lift off the pedal and you roll to a stop instead of holding speed forever.
# The constant term is what guarantees the car actually reaches exactly 0; the
# quadratic term is what sets the top speed with the pedal floored: ~38 m/s, which is
# deliberately well clear of the bots' desired 30 m/s so a human can outrun traffic in
# open road. (No-passing still applies -- a faster car closes gaps sooner, it does not
# get past anyone.)
#
# This is applied to HUMAN cars only, and deliberately so: the IDM's free-flow term
# 1-(v/v0)^delta already plays the role of drag for a bot -- it is what makes a bot
# ease off as it approaches its desired speed. Adding a second drag term on top of it
# would double-count, drop every equilibrium speed, and move the density threshold
# that test_sim.py pins down. Bots keep the dynamics that were measured.
ROLL = 1.2        # m/s^2, speed-independent
DRAG = 0.0049     # 1/m, quadratic


def top_speed() -> float:
    """Where a human car stops accelerating: pedal force balances drag.

    This is derived, not imposed. There is deliberately no hard speed clamp in the
    integrator -- a car is bounded because the physics bounds it (drag grows as v^2
    for a human, and the IDM's 1-(v/v0)^delta term does the same job for a bot), not
    because a constant says so. Retune A_MAX, ROLL or DRAG and the top speed moves
    with them, which is what you want from a model; a separate hardcoded cap would
    silently start overriding the physics the moment it fell below this value.
    """
    return math.sqrt(max(0.0, (A_MAX - ROLL) / DRAG))
B_COMF = 2.0      # m/s^2, IDM comfortable deceleration
S0 = 2.0          # m, IDM jam distance
DELTA = 4         # IDM acceleration exponent

MAX_CARS = 80     # hard ceiling on the ring, however many people turn up

# An accident, as distinct from a nudge: contact made while closing faster than this
# counts on the crash board. Slow bumping in a stopped queue does not, which keeps the
# board meaningful. Deliberately NO other consequence -- cars are not immobilised. A
# stopped wreck is a real bottleneck with an obvious cause, and the entire point of
# this demo is that the jam has no cause.
CRASH_SPEED = 4.5   # m/s of closing speed (~10 mph) that counts as a crash
HIST = 150          # steps of (s, v) kept per car, enough for 2.5 s of delay at 60 Hz

PALETTE = [
    "#4aa3ff", "#ffb14a", "#5fd68a", "#ff6b8a", "#b98cff", "#ffd93d",
    "#4fd6d0", "#ff8f4a", "#8ad25f", "#e05fd6", "#5f8aff", "#d6c14f",
]


def _wrap(x: float, L: float) -> float:
    """Position modulo the ring, always in [0, L)."""
    return x % L


@dataclass
class Params:
    """Live-tunable knobs. L and N set the density; T is the tailgating knob."""
    L: float = 400.0   # ring circumference, m
    N: int = 30        # total cars (121 veh/mi -- well above critical; jams in ~35 s)
    A: float = 0.6     # IDM max acceleration, m/s^2 -- driver responsiveness
    T: float = 1.2     # IDM safe time headway, s
    V0: float = 30.0   # IDM desired speed, m/s (108 km/h)

    # Real traffic is never uniform, and that matters more than it sounds: the ring
    # instability needs something to amplify. With a single tiny nudge at reset as the
    # only seed, a jam at 55 veh/km takes ~13 minutes to become visible -- true to the
    # mathematics, useless in a classroom. These two terms supply the perturbation that
    # real roads have, so the growth starts from a realistic amplitude instead of 1e-4.
    #
    # Neither one *creates* the jam. Below the critical density they stay small and the
    # ring keeps flowing; above it they get amplified into a wave. That contrast is
    # still exactly the lesson -- it just happens on a timescale a class can watch.
    SPREAD: float = 0.12   # driver-to-driver variation in V0 and T (fraction)
    NOISE: float = 0.25    # acceleration noise, m/s^2 -- imperfect speed-holding
    SEED: float = 0.30     # initial bunching, as a fraction of the mean spacing
    # Bot reaction time. Plain IDM answers instantly with unlimited braking, so a bot
    # is physically impossible to rear-end -- brake-checking one does nothing, which
    # is both unfun and wrong. Real drivers take about a second to react. Delay also
    # destabilises the ring, which is the same direction the demo already wants.
    # Bot reaction time. Plain IDM answers instantly with unlimited braking, so a bot
    # cannot be rear-ended at all -- brake-checking one does nothing. A delay fixes
    # that, but measurably moves the stability boundary (at 0.5 s a kick at 48 veh/mi
    # no longer decays, and "responsiveness" stops being monotonic because gain times
    # delay is its own instability). The phantom jam is the point of this thing, so
    # the default is 0 and the validated dynamics are untouched. Raise it from the
    # instructor panel if you want the autopilot rear-endable too.
    #
    # Brake-checking another PLAYER works at 0, because people do not auto-brake.
    TAU: float = 0.0

    def as_dict(self) -> dict:
        return {"L": self.L, "N": self.N, "A": self.A, "T": self.T, "V0": self.V0,
                "SPREAD": self.SPREAD, "NOISE": self.NOISE, "SEED": self.SEED,
                "TAU": self.TAU}


@dataclass
class Car:
    id: int
    s: float                    # arc position along the ring, m
    v: float                    # speed, m/s
    kind: str = "bot"           # 'bot' | 'human'
    name: str = ""
    u: float = 0.0              # throttle in [-1, 1], humans only
    color: str = "#4aa3ff"
    dist: float = 0.0           # cumulative distance travelled, m (for laps)
    bumped: bool = False        # rear-ended someone on the last step
    brake_until: float = -1.0   # sim time until which a forced brake applies
    v0_f: float = 1.0           # this driver's desired speed, as a factor of V0
    t_f: float = 1.0            # this driver's following distance, as a factor of T
    accel: float = 0.0          # last step's acceleration, m/s^2 (drives brake lights)
    crashes: int = 0            # accidents by whoever is currently in this seat
    in_contact: bool = False    # was touching the car ahead on the PREVIOUS step
    last_bump_t: float = -99.0  # sim time of the last counted crash
    hist: deque = field(default_factory=lambda: deque(maxlen=HIST))  # (s, v) trail


class Ring:
    """Authoritative state of one ring road."""

    def __init__(self, params: Params | None = None, seed: int = 12345):
        self.p = params or Params()
        self.t = 0.0
        self._next_id = 1
        self._rng = random.Random(seed)
        self.cars: list[Car] = []
        self.reset()

    # -- construction -------------------------------------------------------------

    def _new_car(self, s: float, v: float) -> Car:
        car = Car(id=self._next_id, s=_wrap(s, self.p.L), v=v)
        car.color = PALETTE[self._next_id % len(PALETTE)]
        self._assign_personality(car)
        self._next_id += 1
        return car

    def _assign_personality(self, car: Car) -> None:
        """Give this driver their own desired speed and following distance.

        A slower-than-average driver is a standing bottleneck that the instability can
        grow on, which is how jams seed on a real road.
        """
        sp = self.p.SPREAD
        car.v0_f = self._rng.uniform(1.0 - sp, 1.0 + sp)
        car.t_f = self._rng.uniform(1.0 - sp, 1.0 + sp)

    def reset(self) -> None:
        """Equally spaced cars at the desired speed, plus a whisper of jitter.

        The perfectly uniform state is a genuine fixed point: with exact arithmetic it
        would persist forever even deep in the unstable regime. The jitter is what the
        instability amplifies, and is worth pointing at in class.
        """
        L, N = self.p.L, self.p.N
        spacing = L / N
        keep = {c.id: c for c in self.cars if c.kind == "human"}
        self.cars = []
        self.t = 0.0
        humans = list(keep.values())
        # Start mildly bunched rather than perfectly evenly spaced. Traffic is never
        # uniform, and a ring that starts on the fixed point has to climb all the way
        # back out of it -- from a 0.1 m nudge that takes over ten minutes, which is
        # true to the mathematics and useless in a lecture. The bunching is a single
        # cosine (one cluster), which is the shape the instability grows into anyway,
        # so the ring starts on the unstable mode instead of orthogonal to it.
        # Below the critical density this same start simply smooths out -- which is
        # what makes the low-density case worth showing.
        # Cars inside the cluster start slower, as they would on a real road: the gap
        # is tightest a quarter-wave after the position crest, so the speed dip is a
        # sine against the position cosine. Seeding the velocity as well as the spacing
        # is what makes the start a *plausible* piece of traffic rather than a uniform
        # ring with the cars nudged -- and it is what makes the wave visible in seconds
        # instead of after two minutes of watching a number creep upward.
        amp = self.p.SEED * spacing
        base = self.p.V0 * 0.8
        for i in range(N):
            theta = 2.0 * math.pi * i / N
            offset = amp * math.cos(theta)
            v = base * (1.0 - 0.9 * self.p.SEED * math.sin(theta))
            car = self._new_car(i * spacing + offset + self._rng.uniform(-0.1, 0.1),
                                max(0.5, v))
            if humans:                       # re-seat the humans already connected
                h = humans.pop()
                car.kind, car.name, car.color, car.u = "human", h.name, h.color, 0.0
                car.id = h.id
            self.cars.append(car)

    def respace(self) -> None:
        """Re-lay the current cars uniformly at the current mean speed.

        Used when the host changes N or L: it is a fresh initial condition at the new
        density, with the same drivers still in their seats.
        """
        L, N = self.p.L, len(self.cars)
        if N == 0:
            return
        vbar = sum(c.v for c in self.cars) / N
        spacing = L / N
        for i, car in enumerate(self.cars):
            car.s = _wrap(i * spacing + self._rng.uniform(-0.1, 0.1), L)
            car.v = vbar
            car.bumped = False
            car.brake_until = -1.0

    # -- population ---------------------------------------------------------------

    def gaps(self) -> list[float]:
        """Bumper-to-bumper gap ahead of each car, by index."""
        L, n = self.p.L, len(self.cars)
        out = []
        for i, car in enumerate(self.cars):
            lead = self.cars[(i + 1) % n]
            out.append((lead.s - car.s) % L - CAR_LEN if n > 1 else L - CAR_LEN)
        return out

    def add_human(self, name: str) -> Car | None:
        """Seat a player in the bot that currently has the most room ahead.

        Taking over a bot rather than inserting a car keeps N -- and therefore the
        density -- exactly constant, which matters while the plots are accumulating.
        """
        bots = [(g, i) for i, g in enumerate(self.gaps()) if self.cars[i].kind == "bot"]
        if bots:
            _, idx = max(bots, key=lambda t: t[0])
            car = self.cars[idx]
        elif len(self.cars) < MAX_CARS:       # everyone is human: grow the ring
            gs = self.gaps()
            idx = max(range(len(gs)), key=lambda i: gs[i])
            lead = self.cars[idx]
            car = self._new_car(lead.s - CAR_LEN - gs[idx] / 2.0, lead.v)
            self.cars.insert(idx, car)
            self.p.N = len(self.cars)
        else:
            # Ring full. Without this the seat count grows without bound, and since
            # every car is simulated every tick and broadcast to every client, a
            # crowd (or one client reconnecting in a loop) quietly turns into a
            # CPU and bandwidth problem. set_population already capped at MAX_CARS;
            # this path did not.
            return None
        car.kind, car.name, car.u = "human", name, 0.0
        car.brake_until = -1.0
        car.crashes = 0                   # the seat's record belongs to the driver in it
        car.last_bump_t = -99.0
        car.in_contact = False
        return car

    def drop(self, car_id: int) -> None:
        """A player left: their car keeps driving, now under IDM control."""
        for car in self.cars:
            if car.id == car_id:
                car.kind, car.name, car.u = "bot", "", 0.0
                return

    def set_population(self, n: int) -> None:
        n = max(2, min(MAX_CARS, int(n)))
        humans = [c for c in self.cars if c.kind == "human"]
        n = max(n, len(humans))
        while len(self.cars) > n:             # drop bots only, never a player
            for i in range(len(self.cars) - 1, -1, -1):
                if self.cars[i].kind == "bot":
                    del self.cars[i]
                    break
            else:
                break
        while len(self.cars) < n:
            self.cars.append(self._new_car(0.0, self.p.V0 * 0.8))
        self.p.N = len(self.cars)
        self.respace()

    def set_param(self, key: str, value: float) -> None:
        """Live-tune a driver parameter. Does not disturb the current state, so the
        class can watch a running sim cross the stability boundary in real time."""
        lo_hi = {"A": (0.2, 3.0), "T": (0.4, 3.0), "V0": (5.0, 35.0),
                 "SPREAD": (0.0, 0.4), "NOISE": (0.0, 1.0), "SEED": (0.0, 0.45),
                 "TAU": (0.0, 2.2)}
        if key in lo_hi:
            lo, hi = lo_hi[key]
            setattr(self.p, key, max(lo, min(hi, float(value))))
            if key == "SPREAD":
                for car in self.cars:
                    self._assign_personality(car)

    def set_length(self, L: float) -> None:
        self.p.L = max(80.0, min(2000.0, float(L)))
        self.respace()

    def perturb(self) -> None:
        """Make one bot brake hard for a second, to trigger a wave on cue."""
        bots = [c for c in self.cars if c.kind == "bot"]
        if bots:
            self._rng.choice(bots).brake_until = self.t + 1.0

    def set_input(self, car_id: int, u: float) -> None:
        u = max(-1.0, min(1.0, float(u)))
        for car in self.cars:
            if car.id == car_id:
                car.u = u
                return

    # -- physics ------------------------------------------------------------------

    def _delayed(self, car: Car, steps: int) -> tuple[float, float]:
        """This car's (position, speed) as it was `steps` ago, or its oldest known."""
        if steps <= 0 or not car.hist:
            return car.s, car.v
        return car.hist[-min(steps, len(car.hist))]

    def _idm_accel(self, car: Car, lead: Car, gap: float, delay: int = 0) -> float:
        """IDM, optionally evaluated on the world as it looked `delay` steps ago.

        The driver's own speed is taken as current -- you always know how fast you
        are going -- but the gap and the leader's speed are what they were when you
        last looked. That is what makes a sudden brake ahead land late.
        """
        p = self.p
        if delay > 0:
            my_s, _ = self._delayed(car, delay)
            lead_s, lead_v = self._delayed(lead, delay)
            gap = (lead_s - my_s) % p.L - CAR_LEN
        else:
            lead_v = lead.v
        gap = max(gap, 0.1)                   # keep the 1/gap^2 term finite
        dv = car.v - lead_v
        v0 = p.V0 * car.v0_f                  # this driver's own preferences
        t = p.T * car.t_f
        s_star = S0 + max(0.0, car.v * t + car.v * dv / (2.0 * math.sqrt(p.A * B_COMF)))
        return p.A * (1.0 - (car.v / v0) ** DELTA - (s_star / gap) ** 2)

    def step(self, dt: float) -> None:
        L = self.p.L
        cars = self.cars
        n = len(cars)
        if n == 0:
            return

        # Accelerations are all computed from the *same* snapshot: a synchronous
        # update. Reading half-updated neighbours would silently change the dynamics.
        gaps = self.gaps()
        delay = min(HIST - 1, int(round(self.p.TAU / dt))) if self.p.TAU > 0 else 0
        accels = [0.0] * n
        for i, car in enumerate(cars):
            lead = cars[(i + 1) % n]
            if car.brake_until > self.t:
                accels[i] = -B_MAX
            elif car.kind == "human":
                pedal = car.u * (A_MAX if car.u >= 0 else B_MAX)
                accels[i] = pedal - (ROLL + DRAG * car.v * car.v)
            else:
                accels[i] = self._idm_accel(car, lead, gaps[i], delay)
                if self.p.NOISE > 0.0:        # nobody holds a speed perfectly
                    accels[i] += self._rng.gauss(0.0, self.p.NOISE)

        new_v = [0.0] * n
        new_s = [0.0] * n
        for i, car in enumerate(cars):
            # Rectified at zero (cars do not reverse, and drag must not push one
            # backwards) but deliberately not capped above -- see top_speed().
            v = max(0.0, car.v + accels[i] * dt)
            new_v[i] = v
            new_s[i] = car.s + v * dt                            # semi-implicit Euler

        # Hard no-pass constraint. The IDM already brakes bots in time, so this is a
        # safety net against a human flooring it -- without it a player could tunnel
        # through the car ahead and destroy the ordering invariant the whole model
        # rests on. Two passes so a car shoved backwards can shove the one behind it.
        touched = [False] * n
        impact = [0.0] * n            # closing speed at the moment of contact
        for p in range(2):
            for i in range(n - 1, -1, -1):
                j = (i + 1) % n
                if j == i:
                    continue
                gap = (new_s[j] - new_s[i]) % L - CAR_LEN
                if gap < MIN_GAP:
                    if p == 0:        # first pass sees the true approach speed
                        impact[i] = max(impact[i], new_v[i] - new_v[j])
                    new_s[i] = new_s[j] - CAR_LEN - MIN_GAP
                    new_v[i] = min(new_v[i], new_v[j])           # inelastic contact
                    touched[i] = True

        # One shunt is one crash. A car shoved against the one ahead stays clamped for
        # as long as the queue is stopped, so counting every clamped step -- or even
        # every clamped step past a cooldown -- turns a single nose-to-tail into dozens.
        # The crash is the moment contact BEGINS, so it is a rising edge on contact,
        # with a short cooldown to swallow chatter if the clamp flickers.
        for i, car in enumerate(cars):
            if (touched[i] and not car.in_contact
                    and self.t - car.last_bump_t > 0.8
                    and impact[i] >= CRASH_SPEED):
                car.crashes += 1
                car.last_bump_t = self.t
            car.in_contact = touched[i]
            car.bumped = touched[i]

        for i, car in enumerate(cars):
            car.accel = (new_v[i] - car.v) / dt if dt > 0 else 0.0
            moved = (new_s[i] - car.s) % L
            if moved > L / 2:                 # a constraint pushed it backwards
                moved -= L
            car.dist += moved
            car.s = _wrap(new_s[i], L)
            car.v = new_v[i]
            car.hist.append((car.s, car.v))

        self.t += dt

    # -- reporting ----------------------------------------------------------------

    def stats(self) -> dict:
        n = len(self.cars)
        if n == 0:
            return {"mean_v": 0.0, "std_v": 0.0, "flow": 0.0, "density": 0.0, "min_v": 0.0}
        vs = [c.v for c in self.cars]
        mean = sum(vs) / n
        std = math.sqrt(sum((v - mean) ** 2 for v in vs) / n)
        density = n / self.p.L               # veh/m
        return {
            "mean_v": mean,
            "std_v": std,
            "flow": density * mean,          # veh/s, q = rho * v
            "density": density,
            "min_v": min(vs),
        }

    def snapshot(self) -> dict:
        """Wire format: positional arrays keep the 30 Hz broadcast small."""
        return {
            "t": round(self.t, 3),
            "cars": [
                [c.id, round(c.s, 2), round(c.v, 2), c.kind == "human", c.name,
                 c.color, 1 if c.bumped else 0, int(c.dist / self.p.L),
                 1 if c.accel < -0.6 else 0, c.crashes]
                for c in self.cars
            ],
            "stats": {k: round(v, 5) for k, v in self.stats().items()},
        }

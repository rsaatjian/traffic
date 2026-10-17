"""Headless checks on the ring physics.

Test 3 is the one that matters for the demo: if the jam does not form, there is
nothing to show in class. It is the canary for a bad parameter change.

    python3 -u -m unittest test_sim -v
"""
import math
import random
import unittest

import sim

DT = 1.0 / 60.0


def settle(ring, seconds):
    for _ in range(int(seconds / DT)):
        ring.step(DT)


def sustained_std(ring, observe=240.0, window=60.0):
    """Mean speed-dispersion over the last `window` seconds of the run.

    The right measure of stability is whether a kick *persists*, not how big the kick
    was: the forced brake itself briefly spikes sigma_v even in a stable ring, so a
    peak-based test would call free flow unstable. Averaging over a late window
    answers the actual question -- did the system return to the fixed point, or is it
    sitting on a limit cycle?
    """
    tail = []
    for k in range(int(observe / DT)):
        ring.step(DT)
        if (observe - k * DT) <= window:
            tail.append(ring.stats()["std_v"])
    return sum(tail) / len(tail)


def cyclic_order(ring):
    """The car ids read off in ring order, rotated to start at the smallest id.

    No-passing means this sequence is an invariant of the whole simulation.
    """
    ids = [c.id for c in ring.cars]
    k = ids.index(min(ids))
    return ids[k:] + ids[:k]


class TestNoPassing(unittest.TestCase):
    def test_random_throttles_never_produce_overlap(self):
        """30 humans mashing the pedals at random must never tunnel through anyone."""
        ring = sim.Ring(sim.Params(L=400.0, N=30))
        for car in ring.cars:
            car.kind = "human"
        rng = random.Random(7)
        order = cyclic_order(ring)
        for step in range(int(60 / DT)):
            if step % 15 == 0:
                for car in ring.cars:
                    car.u = rng.uniform(-1.0, 1.0)
            ring.step(DT)
            worst = min(ring.gaps())
            self.assertGreaterEqual(
                worst, -1e-6, f"cars overlapped by {-worst:.3f} m at t={ring.t:.2f}s"
            )
        self.assertEqual(order, cyclic_order(ring), "car ordering changed: someone passed")

    def test_flooring_it_behind_a_stopped_car_just_stops(self):
        """The pathological case: full throttle into a parked car."""
        ring = sim.Ring(sim.Params(L=200.0, N=2))
        a, b = ring.cars
        a.kind, a.u, a.v = "human", 1.0, 0.0
        b.kind, b.u, b.v = "human", -1.0, 0.0
        b.s = a.s + 20.0
        settle(ring, 30)
        self.assertGreaterEqual(min(ring.gaps()), -1e-6)
        self.assertLessEqual(a.v, b.v + 1e-6, "the chaser ended up faster than the car ahead")


class TestStability(unittest.TestCase):
    """The demo assertions. If these fail, the classroom demo shows nothing."""

    def time_to_jam(self, ring, limit=180.0, crawl=3.0):
        """Seconds until some car is actually crawling (< 3 m/s = 7 mph), or None.

        Deliberately measures a *visible* jam rather than sigma_v. The ring now starts
        mildly bunched, so sigma_v is nonzero from t=0 and a spread-based threshold
        would report the seed itself as a jam. Someone crawling is unambiguous, and it
        is what an instructor is actually waiting to point at.
        """
        t = 0.0
        while t < limit:
            ring.step(DT)
            t += DT
            if ring.stats()["min_v"] < crawl:
                return t
        return None

    def test_jam_appears_with_no_input_at_all(self):
        """THE headline behaviour: at the shipped density the ring jams by itself.

        No perturbation, no drivers, nobody misbehaving -- just driver-to-driver
        variation and imperfect speed-holding, amplified by the instability. If this
        regresses, an instructor stares at a smoothly flowing ring and the point of
        the lesson never lands.
        """
        worst = 0.0
        for seed in (1, 2, 3):
            ring = sim.Ring(sim.Params(), seed=seed)      # shipped defaults
            t = self.time_to_jam(ring)
            self.assertIsNotNone(t, f"seed {seed}: no jam formed in 3 minutes")
            worst = max(worst, t)
        # a class will not sit through more than about a minute of nothing happening
        self.assertLess(worst, 60.0,
                        f"slowest onset {worst:.0f}s -- too slow to hold a room")

    def test_the_jam_is_stop_and_go_not_just_slow_traffic(self):
        """A dense ring crawling uniformly would be congestion, not a wave.

        The demo needs cars visibly accelerating *and* stopping, so assert a real
        speed swing across the ring rather than just a low mean.
        """
        ring = sim.Ring(sim.Params())
        settle(ring, 150)
        speeds = sorted(c.v for c in ring.cars)
        swing = speeds[-1] - speeds[0]
        self.assertGreater(swing, 8.0,
                           f"only {swing:.1f} m/s between slowest and fastest -- "
                           "uniformly slow, not stop-and-go")
        self.assertLess(speeds[0], 3.0, "nobody is actually stopping")

    def test_low_density_never_jams(self):
        """The control. Same noise, same drivers, below critical density: nothing.

        This is what makes the demo an experiment rather than an animation -- the
        perturbations are present either way, and only the density decides.
        """
        for seed in (1, 2, 3):
            ring = sim.Ring(sim.Params(N=12), seed=seed)   # 48 veh/mi
            t = self.time_to_jam(ring, limit=180.0)
            self.assertIsNone(t, f"seed {seed}: free flow jammed at t={t}")
            self.assertLess(sustained_std(ring, observe=90.0, window=60.0), 0.6,
                            "the starting bunching did not smooth out")

    def test_perturbation_decays_below_critical_and_grows_above(self):
        """The bifurcation itself, with an identical kick either side of it."""
        low = sim.Ring(sim.Params(N=12))
        settle(low, 60)
        low.perturb()
        self.assertLess(sustained_std(low), 0.6, "kick should have decayed at 48 veh/mi")

        high = sim.Ring(sim.Params())
        settle(high, 60)
        high.perturb()
        self.assertGreater(sustained_std(high), 2.0, "kick should have grown at 121 veh/mi")

    def test_perturb_brings_the_jam_on_sooner(self):
        """The instructor's button should not be the *cause*, only the trigger."""
        spontaneous, triggered = [], []
        for seed in (1, 2, 3):
            r = sim.Ring(sim.Params(N=20), seed=seed)      # slow enough to see a diff
            spontaneous.append(self.time_to_jam(r) or 180.0)
            r2 = sim.Ring(sim.Params(N=20), seed=seed)
            r2.perturb()
            triggered.append(self.time_to_jam(r2) or 180.0)
        self.assertLess(sum(triggered) / 3, sum(spontaneous) / 3,
                        "perturb did not speed anything up")

    def test_responsiveness_knob_crosses_the_boundary(self):
        """Alert drivers hold a density that sluggish ones cannot."""
        def outcome(a):
            ring = sim.Ring(sim.Params(N=20, A=a))
            settle(ring, 60)
            ring.perturb()
            return sustained_std(ring)

        alert, sluggish = outcome(2.5), outcome(0.4)
        self.assertLess(alert, 0.8, "alert drivers should absorb the kick")
        self.assertGreater(sluggish, 2.0, "sluggish drivers should jam the ring")

    def test_noise_and_spread_are_seeds_not_causes(self):
        """With the perturbations switched off the ring still jams -- just slowly.

        Guards against the tuning becoming a cheat: if turning the noise off made the
        jam disappear entirely, the demo would be showing forced oscillation rather
        than an instability.
        """
        quiet = sim.Ring(sim.Params(SPREAD=0.0, NOISE=0.0, SEED=0.0))
        settle(quiet, 60)
        quiet.perturb()
        self.assertGreater(sustained_std(quiet), 2.0,
                           "without noise the instability itself vanished")


class TestCrashes(unittest.TestCase):
    """Brake-checking, and the rule that counting it changes nothing."""

    def test_counting_a_crash_does_not_touch_the_dynamics(self):
        """THE constraint: the crash board is an observer, never a cause.

        An immobilised or penalised car is a real bottleneck with an obvious cause,
        and the entire point of the demo is a jam that has none. So the same run with
        the crash threshold at zero (count everything) and at infinity (count
        nothing) must be bit-for-bit identical in position and speed.
        """
        # addCleanup, not a trailing assignment: this is a module-level global, and
        # if an assertion below fails before the restore runs it leaks into every
        # later test in the file.
        original = sim.CRASH_SPEED
        self.addCleanup(setattr, sim, "CRASH_SPEED", original)

        def run(threshold):
            """A ring of humans mashing the pedals, which reliably makes contact."""
            sim.CRASH_SPEED = threshold
            ring = sim.Ring(sim.Params(L=400.0, N=30), seed=5)
            for car in ring.cars:
                car.kind = "human"
            rng = random.Random(11)
            for step in range(int(60 / DT)):
                if step % 15 == 0:
                    for car in ring.cars:
                        car.u = rng.uniform(-1.0, 1.0)
                ring.step(DT)
            trace = [(round(c.s, 9), round(c.v, 9)) for c in ring.cars]
            return trace, sum(c.crashes for c in ring.cars)

        all_trace, all_count = run(0.0)
        none_trace, none_count = run(1e9)
        self.assertGreater(all_count, 0, "the scenario should produce contacts at all")
        self.assertEqual(none_count, 0, "an unreachable threshold should count nothing")
        self.assertEqual(all_trace, none_trace,
                         "counting crashes perturbed the simulation")

    def test_brake_checking_a_player_counts_a_crash(self):
        """A driver slamming the brakes on the car behind should register."""
        ring = sim.Ring(sim.Params(L=3000.0, N=2, SEED=0.0, NOISE=0.0, SPREAD=0.0))
        lead, follow = ring.cars[0], ring.cars[1]
        lead.s, follow.s = 1000.0, 1000.0 - sim.CAR_LEN - 12.0
        lead.v = follow.v = 20.0
        lead.kind, lead.u = "human", 0.0
        follow.kind, follow.u = "human", 0.0      # a person, who does not auto-brake
        settle(ring, 1.0)
        self.assertEqual(follow.crashes, 0)
        lead.u = -1.0                             # BRAKE CHECK
        settle(ring, 5.0)
        self.assertEqual(follow.crashes, 1, "the car behind should have rear-ended them")
        self.assertGreaterEqual(min(ring.gaps()), -1e-6, "and still not interpenetrated")

    def test_both_cars_know_about_a_rear_end(self):
        """The victim has to be told. The blame still goes to whoever ran into them."""
        ring = sim.Ring(sim.Params(L=3000.0, N=2, SEED=0.0, NOISE=0.0, SPREAD=0.0))
        lead, follow = ring.cars[0], ring.cars[1]
        lead.s, follow.s = 1000.0, 1000.0 - sim.CAR_LEN - 12.0
        lead.v = follow.v = 20.0
        lead.kind, lead.u = "human", 0.0
        follow.kind, follow.u = "human", 0.0
        settle(ring, 1.0)
        lead.u = -1.0                                   # brake-check
        saw_hit, saw_victim = False, False
        for _ in range(int(5.0 / DT)):
            ring.step(DT)
            if follow.bumped:
                saw_hit = True
                self.assertTrue(lead.rear_ended, "the car in front was not told it was hit")
            if lead.rear_ended:
                saw_victim = True
        self.assertTrue(saw_hit, "no contact happened at all")
        self.assertTrue(saw_victim, "the brake-checker never registered being hit")
        self.assertEqual(follow.crashes, 1, "blame belongs to the car behind")
        self.assertEqual(lead.crashes, 0, "the car in front should not be blamed")

    def test_crawling_contact_in_a_queue_is_not_a_crash(self):
        """Nose-to-tail shuffling in a jam must not inflate the board."""
        ring = sim.Ring(sim.Params(L=3000.0, N=2, SEED=0.0, NOISE=0.0, SPREAD=0.0))
        lead, follow = ring.cars[0], ring.cars[1]
        lead.s, follow.s = 1000.0, 1000.0 - sim.CAR_LEN - 1.0
        lead.v = follow.v = 1.2                   # 2.7 mph, bumper to bumper
        lead.kind, lead.u = "human", -1.0
        follow.kind, follow.u = "human", 0.4
        settle(ring, 30.0)
        self.assertEqual(follow.crashes, 0,
                         "slow contact in a queue should not count as a crash")


class TestIntegrity(unittest.TestCase):
    def test_motion_is_forward_and_bounded(self):
        ring = sim.Ring(sim.Params())
        # bound comes from the physics, not from a clamp
        vmax = max(sim.top_speed(), ring.p.V0) + 0.5
        prev = [c.dist for c in ring.cars]
        for _ in range(int(120 / DT)):
            ring.step(DT)
            for i, car in enumerate(ring.cars):
                moved = car.dist - prev[i]
                self.assertGreaterEqual(moved, -1e-6, "a car travelled backwards")
                self.assertLessEqual(moved, vmax * DT + 1e-6, "a car teleported")
                self.assertGreaterEqual(car.v, -1e-9)
                self.assertLessEqual(car.v, vmax, "a car exceeded what the physics allows")
                self.assertTrue(0.0 <= car.s < ring.p.L)
                prev[i] = car.dist

    def test_speed_is_bounded_by_drag_not_by_a_clamp(self):
        """Flat out on an open road, a human settles at the drag-balance speed.

        There is no hard cap in the integrator, so this is the only thing stopping a
        car accelerating forever. If it ever regresses, cars run away instead of
        topping out -- which is why it is asserted rather than assumed.
        """
        ring = sim.Ring(sim.Params(L=8000.0, N=2))
        car = ring.cars[0]
        car.kind, car.u, car.v = "human", 1.0, 0.0
        ring.cars[1].kind, ring.cars[1].u = "human", 1.0
        peak = 0.0
        for _ in range(int(300 / DT)):
            ring.step(DT)
            peak = max(peak, car.v)
        expected = sim.top_speed()
        self.assertAlmostEqual(car.v, expected, delta=0.05,
                               msg=f"settled at {car.v:.2f}, expected {expected:.2f}")
        self.assertLessEqual(peak, expected + 1e-6, "overshot the drag-balance speed")

    def test_top_speed_tracks_retuning(self):
        """Change the engine, and the top speed follows. No constant to keep in sync."""
        base = sim.top_speed()
        original = sim.A_MAX
        try:
            sim.A_MAX = original + 1.0
            self.assertGreater(sim.top_speed(), base, "top speed ignored a stronger engine")
            ring = sim.Ring(sim.Params(L=8000.0, N=2))
            car = ring.cars[0]
            car.kind, car.u, car.v = "human", 1.0, 0.0
            ring.cars[1].kind, ring.cars[1].u = "human", 1.0
            for _ in range(int(400 / DT)):
                ring.step(DT)
            self.assertAlmostEqual(car.v, sim.top_speed(), delta=0.05)
        finally:
            sim.A_MAX = original

    def test_population_changes_preserve_order_and_count(self):
        ring = sim.Ring(sim.Params(L=400.0, N=20))
        settle(ring, 10)

        a = ring.add_human("ana")
        b = ring.add_human("bo")
        self.assertEqual(len(ring.cars), 20, "seating a player must not change density")
        self.assertEqual({a.kind, b.kind}, {"human"})

        settle(ring, 10)
        self.assertGreaterEqual(min(ring.gaps()), -1e-6)

        ring.drop(a.id)
        self.assertEqual(len(ring.cars), 20, "a leaver's car should stay on the ring")
        self.assertEqual([c.kind for c in ring.cars].count("human"), 1)

        ring.set_population(35)
        self.assertEqual(len(ring.cars), 35)
        self.assertEqual(ring.p.N, 35)
        settle(ring, 20)
        self.assertGreaterEqual(min(ring.gaps()), -1e-6)

        ring.set_population(8)
        self.assertEqual(len(ring.cars), 8)
        settle(ring, 20)
        self.assertGreaterEqual(min(ring.gaps()), -1e-6)

    def test_ring_refuses_to_grow_without_bound(self):
        """A crowd must not be able to inflate the seat count indefinitely.

        Every car is integrated each tick and broadcast to every client, so an
        uncapped ring is a CPU and bandwidth problem, not just an odd-looking road.
        set_population already clamped; add_human did not.
        """
        ring = sim.Ring(sim.Params(N=30))
        seated = [ring.add_human(f"p{i}") for i in range(90)]
        self.assertEqual(len(ring.cars), sim.MAX_CARS)
        self.assertEqual(sum(1 for c in seated if c is None), 90 - sim.MAX_CARS + 0,
                         "refusals should start exactly at the cap")
        settle(ring, 10)
        self.assertGreaterEqual(min(ring.gaps()), -1e-6, "a full ring must still be sane")

    def test_set_population_never_evicts_a_player(self):
        ring = sim.Ring(sim.Params(L=400.0, N=20))
        keep = [ring.add_human(f"p{i}").id for i in range(5)]
        ring.set_population(2)
        alive = {c.id for c in ring.cars if c.kind == "human"}
        self.assertEqual(set(keep), alive, "a connected player was removed from the ring")

    def test_snapshot_is_json_serialisable(self):
        import json
        ring = sim.Ring()
        ring.add_human("ana")
        settle(ring, 1)
        blob = json.dumps(ring.snapshot())
        self.assertIn("ana", blob)
        self.assertLess(len(blob), 8000, "broadcast frame is larger than expected")


if __name__ == "__main__":
    unittest.main(verbosity=2)

#!/usr/bin/env python3
"""Tornado server for the multiplayer ring-road traffic demo.

One authoritative simulation, one process, no dependencies beyond tornado (which is
already in the conda base env). Clients send a throttle and render what they are told;
they never simulate anything themselves, so nobody can drive through anybody.

    python3 -u server.py --port 8700
"""
from __future__ import annotations

import argparse
import io
import json
import logging
import secrets
import pathlib
import re
import socket

try:
    import segno                      # pure-python, no transitive deps
except ImportError:                   # keep the app runnable without it
    segno = None

import tornado.ioloop
import tornado.web
import tornado.websocket

import sim

SIM_HZ = 60                      # physics steps per second
BROADCAST_EVERY = 2              # -> 30 Hz on the wire
DT = 1.0 / SIM_HZ

log = logging.getLogger("traffic")

RING = sim.Ring()
CLIENTS: set["SimHandler"] = set()
HOST_TOKEN = ""                  # set in main(); see load_host_token()
LAN_ADDR = ""                    # host:port on the local network, found at startup
DRIVER_PIN = ""                  # optional: drivers must supply this to get a car


def public_base(request) -> str:
    """The scheme+host the client actually reached us on.

    Derived per request rather than configured, so the join URL and the QR code are
    automatically right whether the room is on the LAN or coming in through a tunnel
    -- behind cloudflared the Host header is the public hostname and the forwarded
    proto is https, and nothing here needs to know that happened. The one case the
    request cannot answer is the instructor browsing on localhost: that host is
    useless to anybody else, so fall back to the LAN address.
    """
    host = request.headers.get("X-Forwarded-Host") or request.headers.get("Host", "")
    proto = request.headers.get("X-Forwarded-Proto") or request.protocol
    if host.split(":")[0].lower() in ("localhost", "127.0.0.1", "::1", ""):
        return f"http://{LAN_ADDR}"
    return f"{proto}://{host}"
TOKEN_FILE = pathlib.Path(__file__).with_name(".host_token")


def load_host_token(rotate: bool = False) -> str:
    """Reuse the instructor token across restarts.

    Regenerating it on every start silently breaks the instructor's bookmark, which is
    exactly the wrong failure for something used in front of a class: the page loads,
    looks completely normal, and simply has no controls on it.
    """
    if not rotate and TOKEN_FILE.exists():
        existing = TOKEN_FILE.read_text().strip()
        if existing:
            return existing
    token = secrets.token_urlsafe(8)
    TOKEN_FILE.write_text(token + "\n")
    try:
        TOKEN_FILE.chmod(0o600)
    except OSError:
        pass
    return token


class SimHandler(tornado.websocket.WebSocketHandler):
    """One connected browser. Owns at most one car."""

    def check_origin(self, origin: str) -> bool:
        return True              # a classroom LAN; not exposed to the internet

    MAX_CLIENTS = 150

    def open(self) -> None:
        if len(CLIENTS) >= self.MAX_CLIENTS:
            log.warning("refusing connection: %d clients already", len(CLIENTS))
            self.close(1013, "server full")
            return
        self.car_id: int | None = None
        self.name = ""
        self.is_host = False
        CLIENTS.add(self)
        log.info("connect (%d online)", len(CLIENTS))

    def on_close(self) -> None:
        CLIENTS.discard(self)
        if self.car_id is not None:
            RING.drop(self.car_id)   # their car keeps driving, now as a bot
            log.info("%s left; car %d handed to autopilot", self.name, self.car_id)
        log.info("disconnect (%d online)", len(CLIENTS))

    def on_message(self, raw: str) -> None:
        try:
            msg = json.loads(raw)
            kind = msg.get("type")
        except (ValueError, AttributeError):
            return

        if kind == "hello":
            self._hello(msg)
        elif kind == "input" and self.car_id is not None:
            RING.set_input(self.car_id, msg.get("u", 0.0))
        elif kind == "leave" and self.car_id is not None:
            RING.drop(self.car_id)
            self.car_id = None
        elif kind == "admin":
            self._admin(msg)

    def _hello(self, msg: dict) -> None:
        """Greet a client. `drive` decides whether they get a car or just watch.

        The overview screen is a spectator: it needs the ring parameters to draw and
        scale its axes, but it must not consume a seat -- otherwise putting the demo
        on the projector would silently change the density.
        """
        offered = str(msg.get("token", ""))
        self.is_host = bool(offered) and secrets.compare_digest(offered, HOST_TOKEN)
        rejected = bool(offered) and not self.is_host
        if rejected:
            log.warning("stale or wrong host token offered (%s...) -- no panel granted",
                        offered[:4])

        # When the ring is reachable from the open internet, a PIN is the difference
        # between "my class" and "anyone who finds the link". Off by default.
        bad_pin = False
        if msg.get("drive") and DRIVER_PIN:
            if not secrets.compare_digest(str(msg.get("pin", "")), DRIVER_PIN):
                bad_pin = True
                log.warning("driver refused: wrong PIN")

        full = False
        if msg.get("drive") and not bad_pin and self.car_id is None:
            self.name = str(msg.get("name", "") or "driver")[:16]
            car = RING.add_human(self.name)
            if car is None:
                full = True
                log.warning("ring full (%d cars) -- %s refused", len(RING.cars), self.name)
            else:
                self.car_id = car.id
                log.info("%s driving car %d%s", self.name, car.id,
                         " [HOST]" if self.is_host else "")
        elif self.is_host:
            log.info("instructor watching")
        self.send({
            "type": "welcome",
            "you": self.car_id,
            "car_len": sim.CAR_LEN,
            "params": RING.p.as_dict(),
            "is_host": self.is_host,
            "host_rejected": rejected,
            "bad_pin": bad_pin,
            "ring_full": full,
            "pin_required": bool(DRIVER_PIN),
            "join_url": f"{public_base(self.request)}/drive",
        })

    def _admin(self, msg: dict) -> None:
        """Instructor-only controls. A student's socket cannot reach these."""
        if not self.is_host:
            return
        action = msg.get("action")
        if action == "reset":
            RING.reset()
        elif action == "perturb":
            RING.perturb()
        elif action == "set":
            key, value = msg.get("key"), msg.get("value")
            if key == "N":
                RING.set_population(value)
            elif key == "L":
                RING.set_length(value)
            else:
                RING.set_param(key, value)
        else:
            return
        log.info("host %s: %s %s", self.name, action, msg.get("key", ""))
        broadcast({"type": "params", "params": RING.p.as_dict()})

    def send(self, obj: dict) -> None:
        try:
            self.write_message(json.dumps(obj))
        except tornado.websocket.WebSocketClosedError:
            CLIENTS.discard(self)


class QRHandler(tornado.web.RequestHandler):
    """The drivers' URL as a scannable SVG, for the projector.

    Optional: without segno installed this 404s and the overview just shows the URL
    as text, which is what it did before. Nothing else breaks.
    """

    def get(self) -> None:
        if segno is None:
            raise tornado.web.HTTPError(404, "segno not installed")
        buf = io.BytesIO()
        # error level M survives a projector and a phone camera at the back of a room
        # scale 10 gives the SVG a real intrinsic size (~330 px) so a browser that
        # rasterises before scaling still produces crisp modules on a projector
        segno.make(f"{public_base(self.request)}/drive", error="m").save(
            buf, kind="svg", scale=10, border=2, dark="#0b0e13", light="#ffffff")
        self.set_header("Content-Type", "image/svg+xml")
        self.set_header("Cache-Control", "no-cache")
        self.write(buf.getvalue())


class NoCacheStatic(tornado.web.StaticFileHandler):
    """Static files that the browser must revalidate every load.

    Tornado sends an Etag and Last-Modified but no Cache-Control, which leaves a
    browser free to reuse a heuristically-fresh copy from memory without asking. The
    symptom is brutal to diagnose: you edit a stylesheet, reload, and the page is
    byte-for-byte the old one with no request in the server log at all. "no-cache"
    still permits 304s, so revalidation costs one conditional request per file.
    """

    def set_extra_headers(self, path: str) -> None:
        self.set_header("Cache-Control", "no-cache")


ASSET_REF = re.compile(r'\b(src|href)="([A-Za-z0-9_.-]+\.(?:js|css))"')


class PageHandler(tornado.web.RequestHandler):
    """Serve one HTML page, stamping every local asset URL with the file's mtime.

    Two problems this solves. First, a plain StaticFileHandler with a default_filename
    301-redirects "/drive" to "/drive/", and "/drive" is the URL handed to a room full
    of people. Second and worse: a browser that has already cached style.css will keep
    using it across reloads without ever asking the server -- no request appears in the
    log, so an edit looks like it silently did nothing. Cache-Control only governs
    responses fetched *after* it is added, so it cannot rescue an entry already in the
    cache. Changing the URL can: "overview.css?v=1760..." is simply a different
    resource, and a stale entry can never be used for it.
    """

    def initialize(self, path: str, filename: str) -> None:
        self.root = pathlib.Path(path)
        self.filename = filename

    def get(self) -> None:
        html = (self.root / self.filename).read_text()

        def stamp(m: "re.Match[str]") -> str:
            attr, name = m.group(1), m.group(2)
            try:
                v = int((self.root / name).stat().st_mtime)
            except OSError:
                return m.group(0)
            return f'{attr}="{name}?v={v}"'

        self.set_header("Content-Type", "text/html; charset=utf-8")
        self.set_header("Cache-Control", "no-cache")
        self.write(ASSET_REF.sub(stamp, html))


def broadcast(obj: dict) -> None:
    payload = json.dumps(obj)
    for client in list(CLIENTS):
        try:
            client.write_message(payload)
        except tornado.websocket.WebSocketClosedError:
            CLIENTS.discard(client)


_ticks = 0


def tick() -> None:
    """Fixed-timestep physics; broadcast on every second step."""
    global _ticks
    RING.step(DT)
    _ticks += 1
    if _ticks % BROADCAST_EVERY == 0 and CLIENTS:
        frame = RING.snapshot()
        frame["type"] = "state"
        broadcast(frame)


def lan_ip() -> str:
    """Best-guess address other machines on the LAN can reach us at."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))       # no packets sent; just picks the route
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Multiplayer ring-road traffic demo")
    ap.add_argument("--port", type=int, default=8700,
                    help="8888 is avoided on purpose: it is Jupyter's default")
    ap.add_argument("--bind", default="0.0.0.0", help="0.0.0.0 lets the class join")
    ap.add_argument("--cars", type=int, default=RING.p.N, help="total cars on the ring")
    ap.add_argument("--length", type=float, default=RING.p.L, help="ring circumference, metres")
    ap.add_argument("--new-token", action="store_true",
                    help="rotate the instructor token (invalidates existing links)")
    ap.add_argument("--pin", default="",
                    help="require this PIN to drive (recommended when sharing publicly)")
    args = ap.parse_args()

    global HOST_TOKEN, DRIVER_PIN
    HOST_TOKEN = load_host_token(rotate=args.new_token)
    DRIVER_PIN = args.pin

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)-5s %(message)s",
        datefmt="%H:%M:%S",
    )

    RING.p.L = args.length
    RING.set_population(args.cars)
    RING.reset()

    static = {"path": "static"}
    app = tornado.web.Application([
        (r"/ws", SimHandler),
        (r"/qr.svg", QRHandler),
        (r"/", PageHandler, dict(filename="index.html", **static)),
        (r"/drive/?", PageHandler, dict(filename="drive.html", **static)),
        (r"/(.*)", NoCacheStatic, static),
    ], websocket_ping_interval=20)
    try:
        app.listen(args.port, address=args.bind)
    except OSError as e:
        # a bare traceback here is the last thing you want thirty seconds before class
        log.error("cannot bind port %d: %s", args.port, e)
        log.error("something else is using it -- try:  ./run.sh --port %d", args.port + 1)
        raise SystemExit(1)

    global LAN_ADDR
    ip = lan_ip()
    LAN_ADDR = f"{ip}:{args.port}"
    log.info("ring: %d cars on %.0f ft  (%.0f veh/mi)",
             RING.p.N, RING.p.L * 3.280839895, RING.p.N / RING.p.L * 1609.344)
    log.info("drivers:     http://%s/drive", LAN_ADDR)
    log.info("overview:    http://%s/", LAN_ADDR)
    log.info("instructor:  http://%s/?host=%s", LAN_ADDR, HOST_TOKEN)
    if DRIVER_PIN:
        log.info("driver PIN:  %s", DRIVER_PIN)
    log.info("off-network:  ./share.sh   (public URL via a Cloudflare tunnel)")
    tornado.ioloop.PeriodicCallback(tick, 1000.0 / SIM_HZ).start()
    tornado.ioloop.IOLoop.current().start()


if __name__ == "__main__":
    main()

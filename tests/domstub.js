/* Minimal DOM + canvas so the real client code can be executed headlessly. */
var CLOCK = 0;
var RAF = [];
var TIMERS = [];
var CTX_CALLS = 0;
var ERRORS = [];

function makeGradient() {
    return { addColorStop() {} };
}

function makeCtx() {
    const noop = () => { CTX_CALLS++; };
    return {
        setTransform: noop, clearRect: noop, fillRect: noop, beginPath: noop,
        moveTo: noop, lineTo: noop, arc: noop, arcTo: noop, closePath: noop,
        stroke: noop, fill: noop, save: noop, restore: noop, translate: noop,
        rotate: noop, scale: noop, transform: noop, drawImage: noop,
        setLineDash: noop, fillText: noop, strokeText: noop, clip: noop,
        quadraticCurveTo: noop, bezierCurveTo: noop, ellipse: noop, rect: noop,
        createLinearGradient: () => { CTX_CALLS++; return makeGradient(); },
        createRadialGradient: () => { CTX_CALLS++; return makeGradient(); },
        createPattern: () => null,
        measureText: () => ({ width: 10 }),
        fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
        textAlign: '', textBaseline: '', imageSmoothingEnabled: true,
        globalAlpha: 1, globalCompositeOperation: 'source-over',
        shadowColor: '', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
        lineCap: 'butt', lineJoin: 'miter', lineDashOffset: 0, filter: 'none',
    };
}

function makeEl(id, tag) {
    const el = {
        id, tagName: (tag || 'div').toUpperCase(),
        _listeners: {}, _ctx: null,
        textContent: '', value: '', hidden: false, style: {}, src: '', onload: null,
        width: 300, height: 150, clientWidth: 300, clientHeight: 150,
        classList: {
            _s: new Set(),
            add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
            contains(c) { return this._s.has(c); },
            toggle(c, force) {
                const want = force === undefined ? !this._s.has(c) : !!force;
                if (want) this._s.add(c); else this._s.delete(c);
                return want;
            },
        },
        innerHTML: '',
        querySelector(sel) { return (this._q ||= {})[sel] ||= makeEl(this.id + sel); },
        addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
        removeEventListener() {},
        focus() {}, getBoundingClientRect() { return { width: 300, height: 150, left: 0, top: 0 }; },
        getContext() { return (this._ctx ||= makeCtx()); },
        fire(type, ev) {
            for (const fn of (this._listeners[type] || [])) {
                fn(Object.assign({ preventDefault() {}, stopPropagation() {} }, ev || {}));
            }
        },
    };
    return el;
}

var ELS = {};
var document = {
    getElementById(id) {
        if (!ELS[id]) { ELS[id] = makeEl(id); MISSING.add(id); }
        return ELS[id];
    },
    createElement(tag) { return makeEl('_created', tag); },
    get body() { return (ELS.__body ||= makeEl('__body', 'body')); },
    addEventListener() {},
};
var MISSING = new Set();

/* Pre-register exactly the ids that index.html defines, so anything the JS asks for
 * that is NOT in this list is a real bug (typo'd id / element that does not exist). */
function registerIds(ids, hidden) {
    for (const id of ids) ELS[id] = makeEl(id);
    for (const id of (hidden || [])) ELS[id].hidden = true;   // mirrors the markup
}

var window = globalThis;
var devicePixelRatio = 1;
var performance = { now: () => CLOCK };
function requestAnimationFrame(fn) { RAF.push(fn); return RAF.length; }
function setInterval(fn, ms) { TIMERS.push({ fn, ms }); return TIMERS.length; }
function setTimeout(fn) { return 0; }
var AudioContext = undefined;   // no WebAudio under gjs: FX.setAudio must cope
function addEventListener(type, fn) { (globalThis._wl ||= {}); (globalThis._wl[type] ||= []).push(fn); }
function fireWindow(type, ev) { for (const fn of (globalThis._wl?.[type] || [])) fn(Object.assign({ preventDefault(){} }, ev)); }

var location = { protocol: 'http:', host: '127.0.0.1:8888',
                 hostname: '127.0.0.1', origin: 'http://127.0.0.1:8888',
                 search: '' };
class URLSearchParams {
    constructor(s) { this.s = s || ''; }
    get(k) { const m = this.s.match(new RegExp('[?&]?' + k + '=([^&]*)')); return m ? m[1] : null; }
}
var SENT = [];
class WebSocket {
    constructor(url) { this.url = url; this.readyState = 1; WS = this; OPENED++; }
    send(d) { SENT.push(JSON.parse(d)); }
    close() { this.readyState = 3; }
}
var WS = null;
var OPENED = 0;

function step(ms) {                       // drive one animation frame
    CLOCK += ms;
    const queue = RAF.splice(0, RAF.length);
    for (const fn of queue) fn(CLOCK);
}

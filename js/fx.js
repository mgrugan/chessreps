// Engine (evaluation bar), move sounds and confetti.

// ---------- Stockfish 17.1 lite (NNUE, WASM, single-threaded, runs in a worker) ----------
// One search at a time. When a new position comes in while a search is running we send
// "stop" and IGNORE that search's output (its bestmove included) so a stale score from the
// previous position can never be shown for the new one.
let worker = null, ready = false;
let current = null;      // { fen, resolve, last }
let queued = null;       // latest request waiting for the running search to stop
let stopping = 0;        // number of stopped searches whose bestmove we still have to swallow
function ensureWorker() {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../vendor/stockfish-17.1-lite-single.js', import.meta.url));
    worker.onmessage = e => {
      const line = typeof e.data === 'string' ? e.data : '';
      if (line === 'readyok') { ready = true; pump(); return; }
      if (line.startsWith('bestmove')) {
        if (stopping) { stopping--; pump(); return; }
        const c = current; current = null;
        if (c) c.resolve(c.last);
        pump();
        return;
      }
      if (stopping || !current) return;
      const m = line.match(/^info .*\bdepth (\d+) .*\bscore (cp|mate) (-?\d+)(?! (?:upper|lower)bound)/);
      if (m && !/ multipv [2-9]/.test(line)) current.last = { type: m[2], value: +m[3], depth: +m[1] };
    };
    worker.postMessage('uci');
    worker.postMessage('setoption name Hash value 32');
    worker.postMessage('isready');
  } catch (e) { console.warn('engine unavailable', e); worker = null; }
  return worker;
}
function pump() {
  if (!ready || current || stopping || !queued) return;
  current = queued; queued = null;
  worker.postMessage('position fen ' + current.fen);
  worker.postMessage('go depth ' + current.depth);
}

// Returns { cp, mate } from White's point of view (mate mapped to ±10000) or null.
export function evaluate(fen, depth = 16) {
  const w = ensureWorker();
  if (!w) return Promise.resolve(null);
  if (queued) { queued.resolve(null); queued = null; }
  if (current) { w.postMessage('stop'); stopping++; current.resolve(null); current = null; }
  return new Promise(resolve => {
    const whiteToMove = fen.split(' ')[1] === 'w';
    queued = { fen, depth, last: null, resolve: r => {
      if (!r) return resolve(null);
      let cp = r.type === 'mate' ? (r.value > 0 ? 10000 : -10000) : r.value;
      if (!whiteToMove) cp = -cp;
      resolve({ cp, mate: r.type === 'mate' ? (whiteToMove ? r.value : -r.value) : null });
    } };
    pump();
  });
}
export function engineReady() { return ready; }

// ---------- haptics (no sounds) ----------
// Android/Chrome: navigator.vibrate. iOS Safari 18+: toggling a <input switch>
// via its label produces a system haptic tick (only inside a user gesture).
const PATTERNS = { move: 12, capture: 18, check: [14, 40, 14], wrong: [40, 60, 40], done: [16, 50, 16, 50, 30], tap: 8 };
export function haptic(kind = 'move') {
  try {
    if (navigator.vibrate) { navigator.vibrate(PATTERNS[kind] ?? 12); return; }
    const label = document.getElementById('haptic-label');
    if (!label) return;
    const reps = Array.isArray(PATTERNS[kind]) ? Math.ceil(PATTERNS[kind].length / 2) : 1;
    for (let i = 0; i < reps; i++) setTimeout(() => label.click(), i * 90);
  } catch { /* unsupported */ }
}

// ---------- confetti ----------
export function confetti() {
  let c = document.getElementById('confetti');
  if (!c) { c = document.createElement('canvas'); c.id = 'confetti'; document.body.appendChild(c); }
  const dpr = window.devicePixelRatio || 1;
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  const colors = ['#7fa650', '#f2c94c', '#5b9bd5', '#eb5757', '#bb6bd9', '#ffffff'];
  const parts = Array.from({ length: 160 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 200, y: innerHeight * 0.55,
    vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 15 - 6,
    r: Math.random() * 6 + 4, a: Math.random() * Math.PI, va: (Math.random() - 0.5) * 0.3,
    col: colors[(Math.random() * colors.length) | 0],
  }));
  const start = performance.now();
  (function frame(now) {
    g.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.fillStyle = p.col;
      g.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); g.restore();
    }
    if (now - start < 2600) requestAnimationFrame(frame); else g.clearRect(0, 0, innerWidth, innerHeight);
  })(start);
}

export function toast(msg, ms = 2200) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

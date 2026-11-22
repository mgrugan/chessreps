// Engine (evaluation bar), move sounds and confetti.

// ---------- Stockfish (WASM, runs in a worker, fully local) ----------
let worker = null, pending = null, ready = false;
function ensureWorker() {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../vendor/stockfish.wasm.js', import.meta.url));
    worker.onmessage = e => {
      const line = typeof e.data === 'string' ? e.data : '';
      if (line === 'uciok' || line === 'readyok') ready = true;
      if (!pending) return;
      const m = line.match(/^info .*depth (\d+) .*score (cp|mate) (-?\d+)/);
      if (m) pending.last = { type: m[2], value: +m[3], depth: +m[1] };
      if (line.startsWith('bestmove')) { const p = pending; pending = null; p.resolve(p.last); }
    };
    worker.postMessage('uci');
    worker.postMessage('isready');
  } catch (e) { console.warn('engine unavailable', e); worker = null; }
  return worker;
}

// Returns { cp } from White's point of view (mate mapped to ±10000) or null.
export function evaluate(fen, depth = 12) {
  const w = ensureWorker();
  if (!w) return Promise.resolve(null);
  if (pending) { w.postMessage('stop'); pending.resolve(null); pending = null; }
  return new Promise(resolve => {
    const whiteToMove = fen.split(' ')[1] === 'w';
    pending = { resolve: r => {
      if (!r) return resolve(null);
      let cp = r.type === 'mate' ? (r.value > 0 ? 10000 : -10000) : r.value;
      if (!whiteToMove) cp = -cp;
      resolve({ cp, mate: r.type === 'mate' ? (whiteToMove ? r.value : -r.value) : null });
    }, last: null };
    w.postMessage('position fen ' + fen);
    w.postMessage('go depth ' + depth);
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

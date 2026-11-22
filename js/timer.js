// Study-time tracker. Counts seconds only while the page is visible, focused and
// not idle (no input for IDLE_MS). Totals are stored per local calendar day.
const KEY = 'openreps:time';
const IDLE_MS = 5 * 60 * 1000;

const pad = n => String(n).padStart(2, '0');
export function dayKey(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
function addSeconds(sec) {
  if (!sec) return;
  try {
    const all = load();             // re-read so several tabs never overwrite each other
    const k = dayKey();
    all[k] = (all[k] || 0) + sec;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* storage blocked */ }
}

let lastInput = Date.now();
let pending = 0;                    // seconds counted but not yet saved
let running = false;
const listeners = new Set();

function isActive() {
  return document.visibilityState === 'visible' && document.hasFocus() && Date.now() - lastInput < IDLE_MS;
}
function flush() { addSeconds(pending); pending = 0; }

export function startTimer() {
  if (running) return;
  running = true;
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove', 'scroll']) {
    addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true });
  }
  addEventListener('focus', () => { lastInput = Date.now(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') lastInput = Date.now(); else flush(); });
  addEventListener('pagehide', flush);
  addEventListener('blur', flush);
  let saveTick = 0;
  setInterval(() => {
    const active = isActive();
    if (active) pending++;
    if (++saveTick >= 5) { saveTick = 0; flush(); }
    for (const fn of listeners) fn(active);
  }, 1000);
}
export function onTimerTick(fn) { listeners.add(fn); }

// Totals in seconds, including the not-yet-saved part.
export function timeStats(now = new Date()) {
  const all = load();
  const today = dayKey(now);
  all[today] = (all[today] || 0) + pending;
  const monday = new Date(now); monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const monthPrefix = today.slice(0, 7);
  let week = 0, month = 0;
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    last7.push({ key: dayKey(d), label: d.toLocaleDateString(undefined, { weekday: 'short' }), sec: all[dayKey(d)] || 0 });
  }
  for (const [k, v] of Object.entries(all)) {
    const [y, m, dd] = k.split('-').map(Number);
    const d = new Date(y, m - 1, dd);
    if (d >= monday && d <= now) week += v;
    if (k.startsWith(monthPrefix)) month += v;
  }
  return { today: all[today], week, month, last7 };
}

export function fmtShort(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
  if (h) return `${h}h ${pad(m)}m`;
  if (m) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}
export function fmtClock(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Small HTML block with today/week/month tiles and a 7-day bar chart.
export function statsHtml() {
  const st = timeStats();
  const max = Math.max(60, ...st.last7.map(d => d.sec));
  const bars = st.last7.map((d, i) => `<div class="tbar ${i === 6 ? 'today' : ''}" title="${d.label}: ${fmtShort(d.sec)}"><i style="height:${Math.max(3, d.sec / max * 100)}%"></i><span>${d.label.slice(0, 2)}</span></div>`).join('');
  return `<div class="tstats">
    <div class="ttile"><small>Today</small><b data-t="today">${fmtShort(st.today)}</b></div>
    <div class="ttile"><small>This week</small><b data-t="week">${fmtShort(st.week)}</b></div>
    <div class="ttile"><small>This month</small><b data-t="month">${fmtShort(st.month)}</b></div>
  </div>
  <div class="tbars">${bars}</div>`;
}
export function refreshStats(root) {
  const st = timeStats();
  for (const k of ['today', 'week', 'month']) { const el = root.querySelector(`[data-t="${k}"]`); if (el) el.textContent = fmtShort(st[k]); }
}

// localStorage helpers. Everything is per-browser; nothing leaves the device.
const PREFIX = 'openreps:';

function read(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage blocked */ }
}

export const DEFAULT_SETTINGS = {
  coach: 'auto',        // auto | every | tap
  arrows: 'notes',      // off | notes | always
  evalBar: false,
  board: 'default',     // default | lichess | green | blue | darkblue
  pieces: 'cburnett',   // cburnett | staunty
  textSize: 'default',  // default | large | xl
  confetti: true,
  sound: true,
};

export function getSettings() { return { ...DEFAULT_SETTINGS, ...read('settings', {}) }; }
export function saveSettings(s) { write('settings', s); }

export function defaultProgress() {
  return {
    discovered: {},   // lineIdx -> timestamp
    srs: {},          // lineIdx -> { due, interval (days), reps, lapses }
    seen: {},         // move path -> true (move has been explained once)
    mistakes: {},     // move path -> count
    depth: 0,         // tier index
    skipStart: false,
    finishedAny: false,
    drillStreak: 0,
    drillBest: 0,
    timeBest: 0,
    puzzleRating: 1250,
    arenaRating: 1400,
  };
}
export function getProgress(courseId) { return { ...defaultProgress(), ...read('progress:' + courseId, {}) }; }
export function saveProgress(courseId, p) { write('progress:' + courseId, p); }
export function resetProgress(courseId) { try { localStorage.removeItem(PREFIX + 'progress:' + courseId); } catch {} }

export function getCustomCourses() { return read('custom-courses', []); }
export function saveCustomCourses(list) { write('custom-courses', list); }

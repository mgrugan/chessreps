import { Chessground } from '../vendor/chessground.min.js';
import { Chess } from '../vendor/chess.js';
import { loadCourse } from './courses.js';
import { getSettings, saveSettings, getProgress, saveProgress, resetProgress } from './store.js';
import { applyTheme, BOARDS, PIECE_SETS, pieceUrl } from './theme.js';
import { promptFor, autoExplain } from './explain.js';
import { evaluate, playSound, confetti, toast } from './fx.js';
import { toPgn } from './pgn.js';

const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DAY = 86400000;

// ---------------------------------------------------------------- setup
const params = new URLSearchParams(location.search);
const courseId = params.get('course') || 'italian';
let course;
try { course = await loadCourse(courseId); }
catch (e) { document.body.innerHTML = `<div class="home"><h2>Course not found</h2><p><a href="./">Back to courses</a></p></div>`; throw e; }

let settings = getSettings();
let prog = getProgress(courseId);
applyTheme(settings);
document.title = `${course.title} | OpenReps`;
$('#page-title').textContent = course.title;
$('#course-title').textContent = course.title;

const OUR = course.color === 'white' ? 'w' : 'b';
const lines = course.lines;
const commonPrefix = (() => {
  let n = 0;
  const first = lines[0].moves;
  while (n < first.length && lines.every(l => l.moves[n] === first[n])) n++;
  // never skip past the point where it's our turn for the first divergent decision
  return Math.min(n, Math.min(...lines.map(l => l.moves.length)) - 1);
})();

function tierLines() {
  const n = course.tiers[prog.depth]?.count ?? lines.length;
  return new Set(course.order.slice(0, n));
}
const isDiscovered = i => !!prog.discovered[i];
function discoveredList() { return Object.keys(prog.discovered).map(Number).filter(i => i < lines.length); }
function dueList(now = Date.now()) { return discoveredList().filter(i => (prog.srs[i]?.due ?? 0) <= now); }
const save = () => saveProgress(courseId, prog);

const MODES = [
  { id: 'learn', label: 'Learn', ic: '📖' },
  { id: 'practice', label: 'Practice', ic: '🔁' },
  { id: 'drill', label: 'Drill', ic: '⚡' },
  { id: 'time', label: 'Time', ic: '⏱' },
  { id: 'puzzles', label: 'Puzzles', ic: '🧩' },
  { id: 'arena', label: 'Arena', ic: '⚔' },
];

// ---------------------------------------------------------------- state
const S = {
  mode: 'learn', lineIdx: 0, ply: 0, startPly: 0, chess: new Chess(),
  mistakes: 0, tries: 0, done: false, view: null, token: 0, lastNote: null,
  puzzle: null, arena: null, timer: null,
};

// ---------------------------------------------------------------- board
const cg = Chessground($('#board'), {
  orientation: course.color,
  coordinates: true,
  animation: { enabled: true, duration: 220 },
  highlight: { lastMove: true, check: true },
  movable: { free: false, color: undefined, showDests: true, events: { after: onUserMove } },
  premovable: { enabled: false },
  draggable: { enabled: true, showGhost: true },
  drawable: { enabled: true, visible: true, defaultSnapToValidMove: true },
});
document.body.classList.toggle('orientation-black', course.color === 'black');
$('#evalbar').classList.toggle('flipped', course.color === 'black');
new ResizeObserver(() => cg.redrawAll()).observe($('#board-wrap'));

function dests(chess) {
  const d = new Map();
  for (const m of chess.moves({ verbose: true })) {
    if (!d.has(m.from)) d.set(m.from, []);
    d.get(m.from).push(m.to);
  }
  return d;
}
function syncBoard(opts = {}) {
  const ch = S.chess;
  const hist = ch.history({ verbose: true });
  const last = hist[hist.length - 1];
  const ourTurn = ch.turn() === OUR && !S.done && S.view === null && opts.movable !== false;
  cg.set({
    fen: ch.fen(),
    turnColor: ch.turn() === 'w' ? 'white' : 'black',
    lastMove: last ? [last.from, last.to] : undefined,
    check: ch.inCheck() ? (ch.turn() === 'w' ? 'white' : 'black') : false,
    movable: { color: ourTurn ? course.color : undefined, dests: ourTurn ? dests(ch) : new Map() },
  });
  cg.setAutoShapes(opts.shapes || []);
  updateEval(ch.fen());
}
function arrowFor(san, fen, brush = 'green') {
  const ch = new Chess(fen);
  try { const m = ch.move(san); return [{ orig: m.from, dest: m.to, brush }]; } catch { return []; }
}

let evalSeq = 0;
function updateEval(fen) {
  const bar = $('#evalbar');
  bar.classList.toggle('hidden', !settings.evalBar);
  if (!settings.evalBar) return;
  const seq = ++evalSeq;
  evaluate(fen, 12).then(r => {
    if (!r || seq !== evalSeq) return;
    const cp = Math.max(-1000, Math.min(1000, r.cp));
    const pct = 50 + 50 * (2 / (1 + Math.exp(-0.004 * cp)) - 1);
    bar.querySelector('.white').style.height = pct + '%';
    bar.querySelector('.num').textContent = r.mate ? `M${Math.abs(r.mate)}` : (Math.abs(r.cp) / 100).toFixed(1);
    bar.title = r.mate ? `Mate in ${Math.abs(r.mate)}` : `${r.cp > 0 ? '+' : ''}${(r.cp / 100).toFixed(2)}`;
  });
}

// ---------------------------------------------------------------- notes
const pathKey = (moves, n) => moves.slice(0, n).join(' ');
function noteFor(lineIdx, plyIdx) { // note explaining move at index plyIdx
  const moves = lines[lineIdx].moves;
  const key = pathKey(moves, plyIdx + 1);
  if (course.notes[key]) return { text: course.notes[key], auto: false, key };
  const fen = fenAt(moves, plyIdx);
  return { text: autoExplain(fen, moves[plyIdx]), auto: true, key };
}
function fenAt(moves, n) { const c = new Chess(); for (let i = 0; i < n; i++) c.move(moves[i]); return c.fen(); }
function moveLabel(ply, san) { return `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '...'}${san}`; }

function setCoach(who, html) {
  $('#coach-who').textContent = who;
  $('#coach-text').innerHTML = html;
}
function noteHtml(lineIdx, plyIdx) {
  const n = noteFor(lineIdx, plyIdx);
  const san = lines[lineIdx].moves[plyIdx];
  const text = n.auto ? n.text.replace(/^\S+\s/, '') : n.text;
  const body = esc(text.charAt(0).toUpperCase() + text.slice(1)).replace(/(\d+\.(?:\.\.)?\s?[KQRBNO][^\s,.;:)]*|\d+\.(?:\.\.)?\s?[a-h][x1-8][^\s,.;:)]*)/g, '<span class="move-ref">$1</span>');
  return `<p><span class="move-ref">${esc(moveLabel(plyIdx, san))}</span> — ${body}</p>`;
}
function setPrompt(text, cls = '') { const p = $('#prompt'); p.className = 'prompt ' + cls; p.innerHTML = text; }
function setActions(btns) {
  const box = $('#actions'); box.innerHTML = '';
  for (const b of btns) {
    if (!b) continue;
    const el = document.createElement('button');
    el.className = 'btn ' + (b.cls || '');
    el.innerHTML = b.label;
    el.onclick = b.onClick;
    box.appendChild(el);
  }
}

// ---------------------------------------------------------------- mode bar
function renderModes() {
  const tier = tierLines();
  const discInTier = [...tier].filter(isDiscovered).length;
  const disc = discoveredList().length;
  const vals = {
    learn: `${discInTier}/${tier.size}`,
    practice: `${dueList().length}/${disc}`,
    drill: `×${prog.drillStreak}`,
    time: `${prog.timeBest}`,
    puzzles: `${Math.round(prog.puzzleRating)}`,
    arena: `${Math.round(prog.arenaRating)}`,
  };
  const titles = {
    learn: 'lines discovered in your training depth', practice: 'lines due for review / lines discovered',
    drill: `current streak (best ×${prog.drillBest})`, time: 'best score in 3-minute mode',
    puzzles: 'puzzle rating', arena: 'arena rating',
  };
  $('#modes').innerHTML = MODES.map(m => `
    <button class="mode ${S.mode === m.id ? 'active' : ''}" data-mode="${m.id}" title="${titles[m.id]}">
      <span class="ic">${m.ic}</span><span class="lbl">${m.label}</span><span class="val">${vals[m.id]}</span>
    </button>`).join('');
  $('#modes').querySelectorAll('.mode').forEach(b => b.onclick = () => switchMode(b.dataset.mode));
  $('#mode-chip').textContent = { learn: 'Learning', practice: 'Practice', drill: 'Drill', time: 'Time trial', puzzles: 'Puzzle', arena: 'Arena' }[S.mode];
}

// ---------------------------------------------------------------- move list
function renderMoves() {
  const moves = lines[S.lineIdx].moves.slice(0, S.ply);
  const cur = S.view ?? S.ply;
  let h = '';
  moves.forEach((m, i) => {
    if (i % 2 === 0) h += `<span class="n">${i / 2 + 1}.</span>`;
    else if (i === 0) h += `<span class="n">1...</span>`;
    const mine = (i % 2 === 0 ? 'w' : 'b') === OUR;
    h += `<span class="m ${i + 1 === cur ? 'cur' : ''} ${mine ? 'mine' : ''}" data-i="${i + 1}">${esc(m)}</span> `;
  });
  $('#moves').innerHTML = h || '<span class="n">Moves appear here.</span>';
  $('#moves').querySelectorAll('.m').forEach(el => el.onclick = () => viewPly(+el.dataset.i));
  $('#moves').scrollTop = 1e6;
}
function viewPly(n) {
  if (n === S.ply) { S.view = null; syncBoard(); renderMoves(); return; }
  if (n < 0 || n > S.ply) return;
  S.view = n;
  const c = new Chess();
  const mv = lines[S.lineIdx].moves;
  let last = null;
  for (let i = 0; i < n; i++) last = c.move(mv[i]);
  cg.set({ fen: c.fen(), lastMove: last ? [last.from, last.to] : undefined, movable: { color: undefined, dests: new Map() }, check: c.inCheck() ? (c.turn() === 'w' ? 'white' : 'black') : false });
  cg.setAutoShapes([]);
  updateEval(c.fen());
  renderMoves();
  if (n > 0 && S.mode !== 'time') setCoach('Reviewing', noteHtml(S.lineIdx, n - 1) + `<p><a href="#" id="back-live">Back to the current position →</a></p>`);
  const bl = $('#back-live'); if (bl) bl.onclick = e => { e.preventDefault(); viewPly(S.ply); refreshCoachForCurrent(); };
}
document.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea') || $('#modal-root').children.length) return;
  if (e.key === 'ArrowLeft') { viewPly(Math.max(0, (S.view ?? S.ply) - 1)); e.preventDefault(); }
  if (e.key === 'ArrowRight') { const n = (S.view ?? S.ply) + 1; if (n <= S.ply) viewPly(n); if (n === S.ply) refreshCoachForCurrent(); e.preventDefault(); }
  if (e.key === 'h' || e.key === 'H') showHint();
});

// ---------------------------------------------------------------- line flow
function startLine(idx, opts = {}) {
  S.token++;
  S.lineIdx = idx;
  S.chess = new Chess();
  S.mistakes = 0; S.tries = 0; S.done = false; S.view = null; S.hinted = false;
  const skip = prog.skipStart && prog.finishedAny && S.mode !== 'puzzles';
  S.startPly = opts.startPly ?? (skip ? commonPrefix : 0);
  for (let i = 0; i < S.startPly; i++) S.chess.move(lines[idx].moves[i]);
  S.ply = S.startPly;
  const ln = lines[idx];
  $('#line-name').textContent = `Line ${idx + 1}${ln.name ? ' · ' + ln.name : ''}`;
  syncBoard();
  renderMoves();
  renderModes();
  advance(opts.firstDelay ?? 350);
}

function advance(delay = 450) {
  const token = S.token;
  const moves = lines[S.lineIdx].moves;
  if (S.ply >= moves.length) return finishLine();
  const turn = S.chess.turn();
  if (turn !== OUR) {
    syncBoard({ movable: false });
    setTimeout(() => {
      if (token !== S.token) return;
      playMove(moves[S.ply], false);
      afterOpponentMove();
      advance(450);
    }, delay);
    return;
  }
  awaitUser();
}

function playMove(san, mine) {
  const mv = S.chess.move(san);
  S.ply++;
  if (settings.sound) playSound(S.chess.inCheck() ? 'check' : mv.captured ? 'capture' : 'move');
  syncBoard();
  renderMoves();
  return mv;
}

// Should the coach explain this move before the student plays it?
function explainBefore(plyIdx) {
  if (S.mode !== 'learn') return false;
  if (settings.coach === 'every') return true;
  if (settings.coach === 'tap') return false;
  const key = pathKey(lines[S.lineIdx].moves, plyIdx + 1);
  return !prog.seen[key] || (prog.mistakes[key] || 0) > 0;
}

function awaitUser() {
  const moves = lines[S.lineIdx].moves;
  const plyIdx = S.ply;
  const expected = moves[plyIdx];
  const fen = S.chess.fen();
  const mv = new Chess(fen).move(expected);
  let shapes = [];
  const showNote = explainBefore(plyIdx);
  if (S.mode === 'learn') {
    if (settings.arrows === 'always' || (settings.arrows === 'notes' && showNote)) shapes = arrowFor(expected, fen);
    if (showNote) {
      const intro = plyIdx === 0 && S.startPly === 0 && !prog.finishedAny ? `<p>${esc(course.intro)}</p>` : '';
      setCoach('Coach', intro + noteHtml(S.lineIdx, plyIdx));
      prog.seen[pathKey(moves, plyIdx + 1)] = true; save();
      setPrompt(esc(promptFor(mv)), 'info');
    } else {
      if (plyIdx === 0 && S.startPly === 0 && !prog.finishedAny) setCoach('Coach', `<p>${esc(course.intro)}</p>`);
      else if (!S.lastNote) setCoach('Coach', `<p>${lines[S.lineIdx].name ? esc(lines[S.lineIdx].name) + '. ' : ''}You have seen this move before — what do we play here?</p>`);
      setPrompt(settings.coach === 'tap' ? 'Your move.' : 'Your move — you know this one.', '');
    }
  } else if (S.mode === 'puzzles') {
    setPrompt(`Find the best move for ${OUR === 'w' ? 'White' : 'Black'}.`, 'info');
  } else {
    setPrompt('Your move.', '');
  }
  S.lastNote = null;
  syncBoard({ shapes });
  setActions(actionButtons());
}

function actionButtons() {
  const btns = [];
  if (!S.done) btns.push({ label: '💡 Hint', onClick: showHint });
  if (!S.done && (settings.coach === 'tap' || S.mode !== 'learn')) btns.push({ label: 'Why?', onClick: showWhy });
  if (S.mode === 'time' && S.timer?.running) btns.push({ label: 'Stop', cls: 'danger', onClick: () => endTimer() });
  return btns;
}

function showHint() {
  if (S.done || S.view !== null) return;
  const moves = lines[S.lineIdx].moves;
  if (S.chess.turn() !== OUR) return;
  const exp = moves[S.ply];
  cg.setAutoShapes(arrowFor(exp, S.chess.fen(), 'blue'));
  S.hinted = true;
  if (S.mode !== 'learn') registerMistake(true);
  if (S.mode === 'learn' || S.mode === 'practice' || S.mode === 'drill') setCoach('Hint', noteHtml(S.lineIdx, S.ply));
  setPrompt(esc(promptFor(new Chess(S.chess.fen()).move(exp))), 'info');
}
function showWhy() {
  // explains the most recent move (or the move to play in learn mode)
  const idx = S.mode === 'learn' && S.chess.turn() === OUR ? S.ply : S.ply - 1;
  if (idx < 0) { setCoach('Coach', `<p>${esc(course.intro)}</p>`); return; }
  if (S.mode !== 'learn' && idx === S.ply) return;
  setCoach('Coach', noteHtml(S.lineIdx, idx));
}

function refreshCoachForCurrent() {
  if (S.ply > 0) setCoach('Coach', noteHtml(S.lineIdx, S.ply - 1));
}

function afterOpponentMove() {
  const idx = S.ply - 1;
  const key = pathKey(lines[S.lineIdx].moves, idx + 1);
  const hasNote = !!course.notes[key];
  const show = settings.coach === 'every' || (settings.coach === 'auto' && S.mode === 'learn' && hasNote && !prog.seen[key]);
  if (show && S.mode !== 'time' && S.mode !== 'arena' && S.mode !== 'puzzles') {
    setCoach('Opponent played', noteHtml(S.lineIdx, idx));
    prog.seen[key] = true; save();
    S.lastNote = key;
  }
}

function onUserMove(orig, dest) {
  if (S.done || S.view !== null) return;
  const moves = lines[S.lineIdx].moves;
  const expected = moves[S.ply];
  const test = new Chess(S.chess.fen());
  let mv;
  try { mv = test.move({ from: orig, to: dest, promotion: 'q' }); } catch { syncBoard(); return; }
  if (mv.san === expected) {
    S.tries = 0;
    const plyIdx = S.ply;
    playMove(expected, true);
    const key = pathKey(moves, plyIdx + 1);
    if (S.mode === 'time') { S.timer.score++; updateTimerUi(); }
    if (S.mode === 'learn') {
      prog.seen[key] = true; save();
      setPrompt('✓ Correct!', 'good');
      if (!explainBefore(plyIdx) && settings.coach !== 'tap') { setCoach('Coach', noteHtml(S.lineIdx, plyIdx)); S.lastNote = key; }
    } else if (S.mode === 'practice' || S.mode === 'drill') {
      setPrompt('✓ Correct', 'good');
      if (settings.coach === 'every') { setCoach('Coach', noteHtml(S.lineIdx, plyIdx)); S.lastNote = key; }
    } else if (S.mode === 'puzzles') {
      S.puzzle.solved++;
      if (S.puzzle.solved >= S.puzzle.need || S.ply >= moves.length) return finishPuzzle(true);
      setPrompt('✓ Keep going…', 'good');
    } else {
      setPrompt('✓', 'good');
    }
    advance(S.mode === 'time' ? 200 : 450);
  } else {
    // wrong move: flash and revert
    if (settings.sound) playSound('wrong');
    S.tries++;
    const key = pathKey(moves, S.ply + 1);
    registerMistake(false, key);
    const fen = S.chess.fen();
    cg.set({ fen: test.fen(), lastMove: [orig, dest] });
    setTimeout(() => {
      syncBoard({ shapes: (S.mode === 'learn' || S.tries >= 2) && S.mode !== 'arena' && S.mode !== 'puzzles' ? arrowFor(expected, fen) : [] });
    }, 380);
    if (S.mode === 'arena') return finishArena(false, mv.san);
    if (S.mode === 'puzzles') return finishPuzzle(false, mv.san);
    if (S.mode === 'time') { S.timer.end -= 5000; setPrompt(`✗ ${esc(mv.san)} isn't it (−5s)`, 'bad'); updateTimerUi(); if (S.tries >= 2) setPrompt(`✗ The move is ${esc(expected)} (−5s)`, 'bad'); return; }
    setPrompt(`✗ ${esc(mv.san)} isn't the move here. Try again.`, 'bad');
    if (settings.coach !== 'tap' || S.mode === 'learn') setCoach('Coach', noteHtml(S.lineIdx, S.ply));
  }
}

function registerMistake(isHint, key) {
  S.mistakes++;
  if (key) { prog.mistakes[key] = (prog.mistakes[key] || 0) + 1; }
  if (S.mode === 'drill' && prog.drillStreak) { prog.drillStreak = 0; }
  save(); renderModes();
}

function finishLine() {
  S.done = true;
  syncBoard();
  const idx = S.lineIdx;
  const now = Date.now();
  const lastNote = S.ply > 0 ? noteHtml(idx, S.ply - 1) : '';
  if (S.mode === 'learn') {
    const first = !isDiscovered(idx);
    prog.discovered[idx] = prog.discovered[idx] || now;
    if (first || !prog.srs[idx]) prog.srs[idx] = { due: now, interval: 0, reps: 0, lapses: 0 };
    prog.finishedAny = true;
    save();
    if (settings.confetti) confetti();
    if (settings.sound) playSound('done');
    setCoach('Line complete', lastNote + `<p>${first ? 'New line discovered! It is now in your practice queue.' : 'Nice — line reviewed.'}</p>`);
    setPrompt('🎉 Line complete!', 'good');
    const next = nextLearnLine();
    setActions([
      next !== null && { label: 'Next line →', cls: 'primary', onClick: () => startLine(next) },
      { label: 'Practice it', onClick: () => { S.mode = 'practice'; startLine(idx); } },
      { label: '↺ Replay', onClick: () => startLine(idx) },
    ]);
  } else if (S.mode === 'practice') {
    const r = prog.srs[idx] || { due: now, interval: 0, reps: 0, lapses: 0 };
    if (S.mistakes === 0) { r.interval = r.interval ? Math.min(180, r.interval * 2.5) : 1; r.reps++; r.due = now + r.interval * DAY; }
    else { r.interval = 0; r.lapses++; r.due = now + 10 * 60000; }
    prog.srs[idx] = r; prog.discovered[idx] = prog.discovered[idx] || now; prog.finishedAny = true;
    save();
    if (S.mistakes === 0 && settings.confetti) confetti();
    if (settings.sound) playSound('done');
    const when = S.mistakes === 0 ? `Perfect! Next review in ${r.interval < 2 ? '1 day' : Math.round(r.interval) + ' days'}.` : `${S.mistakes} mistake${S.mistakes > 1 ? 's' : ''} — you'll see this line again in 10 minutes.`;
    setCoach('Line complete', lastNote + `<p>${when}</p>`);
    setPrompt(S.mistakes === 0 ? '✓ Perfect line' : 'Line finished', S.mistakes === 0 ? 'good' : 'info');
    setActions([{ label: 'Next due line →', cls: 'primary', onClick: () => startPractice() }, { label: '↺ Again', onClick: () => startLine(idx) }]);
  } else if (S.mode === 'drill') {
    if (S.mistakes === 0) { prog.drillStreak++; prog.drillBest = Math.max(prog.drillBest, prog.drillStreak); }
    save(); renderModes();
    if (settings.sound) playSound('done');
    setPrompt(S.mistakes === 0 ? `✓ Streak ×${prog.drillStreak}` : 'Streak reset — keep going', S.mistakes === 0 ? 'good' : 'bad');
    const tok = S.token;
    setTimeout(() => { if (tok === S.token && S.mode === 'drill') startDrill(); }, 900);
  } else if (S.mode === 'time') {
    const tok = S.token;
    setTimeout(() => { if (tok === S.token && S.timer?.running) startLine(randomFrom(timePool()), { firstDelay: 150 }); }, 250);
  } else if (S.mode === 'arena') {
    finishArena(true);
  } else if (S.mode === 'puzzles') {
    finishPuzzle(true);
  }
  renderModes();
}

function nextLearnLine() {
  const tier = [...tierLines()].sort((a, b) => a - b);
  const n = tier.find(i => !isDiscovered(i));
  return n === undefined ? null : n;
}
function randomFrom(arr) { return arr[(Math.random() * arr.length) | 0]; }

// ---------------------------------------------------------------- modes
function stopTimer() { if (S.timer?.iv) clearInterval(S.timer.iv); S.timer = null; $('#timer-box').classList.add('hidden'); }

function switchMode(mode) {
  stopTimer();
  S.mode = mode;
  S.token++;
  renderModes();
  ({ learn: startLearn, practice: startPractice, drill: startDrill, time: introTime, puzzles: startPuzzle, arena: introArena })[mode]();
}

function needDiscovered(what) {
  S.done = true; S.chess = new Chess(); S.ply = 0; syncBoard(); renderMoves();
  setCoach('Coach', `<p>${what} uses lines you have already discovered. Finish at least one line in <b>Learn</b> first.</p>`);
  setPrompt('Nothing to train yet.', 'info');
  setActions([{ label: 'Go to Learn', cls: 'primary', onClick: () => switchMode('learn') }]);
}

function startLearn() {
  const n = nextLearnLine();
  if (n === null) {
    S.done = true;
    setCoach('Coach', `<p>You have discovered every line in <b>${esc(course.tiers[prog.depth].name)}</b>. 🎉 Keep them fresh in Practice, or raise the training depth in Settings for more lines.</p>`);
    setPrompt('All lines discovered.', 'good');
    setActions([{ label: 'Practice', cls: 'primary', onClick: () => switchMode('practice') }, { label: 'Select a line', onClick: openLines }]);
    S.chess = new Chess(); S.ply = 0; syncBoard(); renderMoves();
    return;
  }
  startLine(n);
}

function startPractice() {
  const disc = discoveredList();
  if (!disc.length) return needDiscovered('Practice');
  S.mode = 'practice'; renderModes();
  const due = dueList();
  let idx;
  if (due.length) {
    due.sort((a, b) => (prog.srs[a]?.due ?? 0) - (prog.srs[b]?.due ?? 0));
    idx = due[0];
  } else {
    disc.sort((a, b) => (prog.srs[a]?.due ?? 0) - (prog.srs[b]?.due ?? 0));
    idx = disc[0];
    toast('All caught up! Here is an extra review.');
  }
  setCoach('Practice', `<p>Play the whole line from memory. Lines you get perfect come back later; mistakes bring them back sooner.</p>`);
  startLine(idx);
}

let lastDrill = -1;
function startDrill() {
  const disc = discoveredList();
  if (!disc.length) return needDiscovered('Drill');
  S.mode = 'drill';
  let idx = randomFrom(disc);
  if (disc.length > 1) while (idx === lastDrill) idx = randomFrom(disc);
  lastDrill = idx;
  setCoach('Drill', `<p>Random lines, back to back. Every perfect line adds to your streak — one slip resets it. Best: ×${prog.drillBest}.</p>`);
  startLine(idx, { firstDelay: 200 });
}

function timePool() { const d = discoveredList(); return d.length ? d : [...tierLines()]; }
function introTime() {
  S.done = true; S.chess = new Chess(); S.ply = 0; syncBoard(); renderMoves();
  $('#line-name').textContent = '';
  if (!discoveredList().length) return needDiscovered('Time mode');
  setCoach('Time trial', `<p>Three minutes on the clock. Score a point for every correct move across random discovered lines. A wrong move costs 5 seconds.</p><p>Best score: <b>${prog.timeBest}</b></p>`);
  setPrompt('Ready?', 'info');
  setActions([{ label: '▶ Start 3:00', cls: 'primary', onClick: startTimer }]);
}
function startTimer() {
  stopTimer();
  S.timer = { end: Date.now() + 180000, score: 0, running: true };
  $('#timer-box').classList.remove('hidden');
  S.timer.iv = setInterval(() => { updateTimerUi(); if (Date.now() >= S.timer.end) endTimer(); }, 200);
  updateTimerUi();
  startLine(randomFrom(timePool()), { firstDelay: 150 });
}
function updateTimerUi() {
  if (!S.timer) return;
  const left = Math.max(0, S.timer.end - Date.now());
  $('#timer').textContent = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
  $('#timer-score').textContent = `${S.timer.score} moves`;
}
function endTimer() {
  if (!S.timer) return;
  const score = S.timer.score;
  clearInterval(S.timer.iv); S.timer.running = false;
  S.token++; S.done = true; syncBoard();
  const best = score > prog.timeBest;
  if (best) { prog.timeBest = score; save(); if (settings.confetti) confetti(); }
  renderModes();
  setCoach('Time trial', `<p>Time! You scored <b>${score}</b> correct moves.${best ? ' New personal best!' : ` Best: ${prog.timeBest}.`}</p>`);
  setPrompt(`Score: ${score}`, 'good');
  setActions([{ label: '▶ Play again', cls: 'primary', onClick: startTimer }]);
}

// Puzzles: jump into the middle of a line and find our move(s).
function puzzleDifficulty(lineIdx, ply) {
  const key = pathKey(lines[lineIdx].moves, ply + 1);
  const mis = prog.mistakes[key] || 0;
  return Math.min(2200, 850 + ply * 38 + mis * 60);
}
function startPuzzle() {
  const pool = discoveredList().length ? discoveredList() : [...tierLines()];
  // choose a position whose rating is near ours
  let best = null;
  for (let k = 0; k < 40; k++) {
    const li = randomFrom(pool);
    const ourPlies = lines[li].moves.map((_, i) => i).filter(i => (i % 2 === 0 ? 'w' : 'b') === OUR && i >= Math.max(2, commonPrefix));
    if (!ourPlies.length) continue;
    const p = randomFrom(ourPlies);
    const d = puzzleDifficulty(li, p);
    const score = Math.abs(d - prog.puzzleRating) + Math.random() * 120;
    if (!best || score < best.score) best = { li, p, d, score };
  }
  if (!best) return needDiscovered('Puzzles');
  S.mode = 'puzzles';
  S.puzzle = { rating: best.d, solved: 0, need: Math.min(2, Math.ceil((lines[best.li].moves.length - best.p) / 2)) };
  setCoach('Puzzle', `<p>Find the repertoire move${S.puzzle.need > 1 ? 's' : ''} in this position from <b>${esc(course.title)}</b>. Puzzle rating ${best.d}.</p>`);
  startLine(best.li, { startPly: best.p - 1, firstDelay: 600 });
}
function finishPuzzle(ok, wrongSan) {
  if (S.done && !ok) return;
  S.done = true; S.token++;
  const expScore = 1 / (1 + 10 ** ((S.puzzle.rating - prog.puzzleRating) / 400));
  const delta = Math.round(24 * ((ok && !S.hinted ? 1 : 0) - expScore));
  prog.puzzleRating = Math.max(400, prog.puzzleRating + delta);
  save(); renderModes();
  const idx = S.lineIdx;
  const ansIdx = ok ? S.ply - 1 : S.ply;
  setCoach(ok ? 'Solved!' : 'Not quite', noteHtml(idx, ansIdx));
  setPrompt(ok && !S.hinted ? `✓ Solved! ${delta >= 0 ? '+' : ''}${delta}` : `✗ ${wrongSan ? esc(wrongSan) + ' — the move was ' + esc(lines[idx].moves[S.ply]) + '. ' : ''}${delta}`, ok && !S.hinted ? 'good' : 'bad');
  if (ok && settings.sound) playSound('done');
  setActions([{ label: 'Next puzzle →', cls: 'primary', onClick: startPuzzle }]);
  syncBoard();
}

function introArena() {
  S.done = true; S.chess = new Chess(); S.ply = 0; syncBoard(); renderMoves();
  $('#line-name').textContent = '';
  setCoach('Arena', `<p>Face a sparring partner who picks any variation in your training depth — including lines you haven't discovered. No hints, no notes: play the whole opening without a mistake to win.</p><p>Arena rating: <b>${Math.round(prog.arenaRating)}</b></p>`);
  setPrompt('Ready for a game?', 'info');
  setActions([{ label: '⚔ Find opponent', cls: 'primary', onClick: startArena }]);
}
function startArena() {
  const opp = Math.round(prog.arenaRating + (Math.random() - 0.5) * 300);
  S.arena = { opp };
  S.mode = 'arena';
  const li = randomFrom([...tierLines()]);
  setCoach('Arena', `<p>Opponent rated <b>${opp}</b>. Good luck!</p>`);
  startLine(li, { startPly: 0 });
}
function finishArena(won, wrongSan) {
  if (!S.arena || S.arena.over) return;
  S.arena.over = true; S.done = true; S.token++;
  const exp = 1 / (1 + 10 ** ((S.arena.opp - prog.arenaRating) / 400));
  const delta = Math.round(32 * ((won && !S.hinted ? 1 : 0) - exp));
  prog.arenaRating = Math.max(400, prog.arenaRating + delta);
  save(); renderModes();
  if (won && settings.confetti) confetti();
  const idx = S.lineIdx;
  setCoach(won ? 'Victory' : 'Defeat', won ? `<p>You played the whole line perfectly. ${delta >= 0 ? '+' : ''}${delta} rating.</p>` : `<p>You played <b>${esc(wrongSan)}</b>; the repertoire move was <b>${esc(lines[idx].moves[S.ply])}</b>. ${delta} rating.</p>${noteHtml(idx, S.ply)}`);
  setPrompt(won ? `🏆 Won ${delta >= 0 ? '+' : ''}${delta}` : `Lost ${delta}`, won ? 'good' : 'bad');
  setActions([{ label: '⚔ Next opponent', cls: 'primary', onClick: startArena }, !won && { label: 'Learn this line', onClick: () => { S.mode = 'learn'; renderModes(); startLine(idx); } }]);
  syncBoard();
}

// ---------------------------------------------------------------- modals
function openModal(title, html, onMount) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-label="${esc(title)}"><header><h3>${esc(title)}</h3><button class="x" aria-label="Close">×</button></header><div class="content">${html}</div></div></div>`;
  const close = () => { root.innerHTML = ''; };
  root.querySelector('.x').onclick = close;
  root.querySelector('.modal-back').onclick = e => { if (e.target.classList.contains('modal-back')) close(); };
  document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
  onMount?.(root.querySelector('.content'), close);
}

function seg(key, options, descs) {
  return `<div class="seg" data-key="${key}">${options.map(([v, l]) => `<button data-v="${v}" class="${settings[key] === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="desc" data-desc="${key}">${descs ? esc(descs[settings[key]] || '') : ''}</div>`;
}
const COACH_DESC = {
  auto: 'Explains a move the first time and after a mistake. Moves you know, it just asks.',
  every: 'Explains every move, every time — great for a first pass through a course.',
  tap: 'Stays quiet. Tap “Why?” whenever you want the note for a move.',
};
const ARROW_DESC = {
  off: 'No arrows. You find the move yourself.',
  notes: 'Shows the move as an arrow whenever the coach explains it.',
  always: 'Always shows the move to play while learning.',
};
function toggle(key, label, desc) {
  return `<div class="set-item"><div class="label">${label}<label class="toggle"><input type="checkbox" data-toggle="${key}" ${(key in settings ? settings[key] : prog[key]) ? 'checked' : ''}><span></span></label></div><div class="desc">${desc}</div></div>`;
}

function openSettings() {
  const boards = Object.entries(BOARDS).map(([k, [l, d, name]]) => `<button class="swatch ${settings.board === k ? 'on' : ''}" data-board="${k}"><span class="sq"><i style="background:${l}"></i><i style="background:${d}"></i><i style="background:${d}"></i><i style="background:${l}"></i></span>${name}</button>`).join('');
  const pieces = Object.entries(PIECE_SETS).map(([k, name]) => `<button class="swatch ${settings.pieces === k ? 'on' : ''}" data-pieces="${k}"><span class="sq" style="display:block;background:var(--light-sq)"><img src="${pieceUrl(k, 'w', 'N')}" alt=""></span>${name}</button>`).join('');
  const sizes = [['default', 'Default', 15], ['large', 'Large', 17.5], ['xl', 'Extra large', 20]];
  const depth = course.tiers.map((t, i) => `<div class="depth-opt ${prog.depth === i ? 'on' : ''}" data-depth="${i}"><span class="r"></span><div><b>${esc(t.name)} · ${t.count} lines</b><small>${esc(t.sub || '')}</small></div></div>`).join('');
  const shared = toPgn(lines[0].moves.slice(0, commonPrefix));
  openModal('Settings', `
    <div class="set-group"><h4>Coach notes <small>Every course</small></h4>
      <div class="set-item">${seg('coach', [['auto', 'Auto'], ['every', 'Every move'], ['tap', 'On tap']], COACH_DESC)}</div>
      <div class="set-item"><div class="label">Arrows</div>${seg('arrows', [['off', 'Off'], ['notes', 'With notes'], ['always', 'Always']], ARROW_DESC)}</div>
      ${toggle('evalBar', 'Evaluation bar', "Shows who's better after each move (Stockfish, runs in your browser).")}
    </div>
    <div class="set-group"><h4>Looks <small>Every course</small></h4>
      <div class="set-item"><div class="label">Board</div><div class="swatches">${boards}</div></div>
      <div class="set-item"><div class="label">Pieces</div><div class="swatches">${pieces}</div></div>
      <div class="set-item"><div class="label">Coach text size</div><div class="swatches">${sizes.map(([k, l, px]) => `<button class="swatch ${settings.textSize === k ? 'on' : ''}" data-size="${k}"><span class="sq" style="display:grid;place-items:center;background:#171613;font-size:${px}px;color:var(--text)">Aa</span>${l}</button>`).join('')}</div></div>
    </div>
    <div class="set-group"><h4>This course <small>${esc(course.title)}</small></h4>
      <div class="set-item"><div class="label">Training depth</div>${depth}<div class="desc">Progress on all lines is kept when switching.</div></div>
      ${commonPrefix > 0 ? toggle('skipStart', 'Skip the shared start', `Every line opens ${esc(shared)}. Start each one where it branches off. Kicks in after your first finished line.`) : ''}
    </div>
    <div class="set-group"><h4>Sound and feel <small>Every course</small></h4>
      ${toggle('confetti', 'Confetti', 'Plays when you finish a line.')}
      ${toggle('sound', 'Move sounds', 'Soft clicks for moves, captures and mistakes.')}
    </div>
    <div class="set-group">
      <div class="row">
        <button class="btn" id="share-pos">🔗 Share this position</button>
        <button class="btn" id="start-over">↺ Start over</button>
        <button class="btn danger" id="reset-course">Reset course progress</button>
      </div>
    </div>`, (box, close) => {
    box.querySelectorAll('.seg').forEach(sg => sg.querySelectorAll('button').forEach(b => b.onclick = () => {
      settings[sg.dataset.key] = b.dataset.v; saveSettings(settings);
      sg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      const d = box.querySelector(`[data-desc="${sg.dataset.key}"]`);
      if (d) d.textContent = (sg.dataset.key === 'coach' ? COACH_DESC : ARROW_DESC)[b.dataset.v];
    }));
    box.querySelectorAll('[data-toggle]').forEach(inp => inp.onchange = () => {
      const k = inp.dataset.toggle;
      if (k in settings) { settings[k] = inp.checked; saveSettings(settings); if (k === 'evalBar') updateEval(S.chess.fen()); }
      else { prog[k] = inp.checked; save(); }
    });
    box.querySelectorAll('[data-board]').forEach(b => b.onclick = () => { settings.board = b.dataset.board; saveSettings(settings); applyTheme(settings); box.querySelectorAll('[data-board]').forEach(x => x.classList.toggle('on', x === b)); });
    box.querySelectorAll('[data-pieces]').forEach(b => b.onclick = () => { settings.pieces = b.dataset.pieces; saveSettings(settings); applyTheme(settings); box.querySelectorAll('[data-pieces]').forEach(x => x.classList.toggle('on', x === b)); });
    box.querySelectorAll('[data-size]').forEach(b => b.onclick = () => { settings.textSize = b.dataset.size; saveSettings(settings); applyTheme(settings); box.querySelectorAll('[data-size]').forEach(x => x.classList.toggle('on', x === b)); });
    box.querySelectorAll('[data-depth]').forEach(d => d.onclick = () => { prog.depth = +d.dataset.depth; save(); renderModes(); box.querySelectorAll('[data-depth]').forEach(x => x.classList.toggle('on', x === d)); });
    box.querySelector('#share-pos').onclick = () => {
      const url = new URL(location.href);
      url.search = new URLSearchParams({ course: courseId, line: S.lineIdx + 1, ply: S.view ?? S.ply }).toString();
      navigator.clipboard?.writeText(url.href).then(() => toast('Link copied to clipboard'), () => prompt('Copy this link', url.href));
    };
    box.querySelector('#start-over').onclick = () => { close(); stopTimer(); if (['time', 'arena'].includes(S.mode)) switchMode(S.mode); else startLine(S.lineIdx, { startPly: S.mode === 'puzzles' ? S.startPly : undefined }); };
    box.querySelector('#reset-course').onclick = () => {
      if (!confirm(`Reset all progress for ${course.title}? This cannot be undone.`)) return;
      resetProgress(courseId); prog = getProgress(courseId); close(); switchMode('learn');
    };
  });
}

function lineStatus(i) {
  const tier = tierLines();
  const chips = [];
  if (S.lineIdx === i) chips.push('<span class="chip blue">current</span>');
  if (isDiscovered(i)) {
    const due = (prog.srs[i]?.due ?? 0) <= Date.now();
    chips.push(due ? '<span class="chip red">due</span>' : '<span class="chip green">learned</span>');
  } else chips.push('<span class="chip">new</span>');
  if (!tier.has(i)) chips.push('<span class="chip">outside depth</span>');
  return chips.join('');
}
let showPgns = true;
function openLines() {
  openModal('Select Line', `
    <div class="filter-row">
      <input type="text" id="line-filter" placeholder="Search names or moves (e.g. Nxe4, Fried Liver)">
      <label class="row" style="gap:6px;font-size:13px;color:var(--muted)"><label class="toggle"><input type="checkbox" id="show-pgn" ${showPgns ? 'checked' : ''}><span></span></label>Show PGNs</label>
      <button class="btn small" id="copy-pgn">Copy all PGN</button>
    </div>
    <div class="line-list" id="line-list"></div>`, (box, close) => {
    const render = () => {
      const q = box.querySelector('#line-filter').value.trim().toLowerCase();
      box.querySelector('#line-list').innerHTML = lines.map((l, i) => {
        const pgn = toPgn(l.moves);
        if (q && !(`${i + 1} ${l.name} ${pgn}`.toLowerCase().includes(q))) return '';
        return `<button class="line-item ${S.lineIdx === i ? 'cur' : ''} ${tierLines().has(i) ? '' : 'locked'}" data-i="${i}">
          <span class="num">${i + 1}</span>
          <span class="info"><span class="nm">${esc(l.name || 'Line ' + (i + 1))} ${lineStatus(i)}</span>${showPgns ? `<span class="pgn">${esc(pgn)}</span>` : ''}</span>
        </button>`;
      }).join('') || '<p style="color:var(--muted)">No lines match.</p>';
      box.querySelectorAll('.line-item').forEach(b => b.onclick = () => {
        close(); stopTimer();
        const i = +b.dataset.i;
        S.mode = isDiscovered(i) && S.mode === 'practice' ? 'practice' : 'learn';
        renderModes(); startLine(i);
      });
    };
    box.querySelector('#line-filter').oninput = render;
    box.querySelector('#show-pgn').onchange = e => { showPgns = e.target.checked; render(); };
    box.querySelector('#copy-pgn').onclick = () => {
      const txt = lines.map((l, i) => `[Event "${course.title} - ${l.name || 'Line ' + (i + 1)}"]\n\n${toPgn(l.moves)} *\n`).join('\n');
      navigator.clipboard?.writeText(txt).then(() => toast('All lines copied as PGN'));
    };
    render();
    box.querySelector('.line-item.cur')?.scrollIntoView({ block: 'center' });
  });
}

function openHelp() {
  openModal('Help', `<div class="help">
    <h4>How training works</h4>
    <p><b>Learn</b> walks you through new lines. The coach explains each move and shows an arrow; you play the move on the board. Finishing a line "discovers" it.</p>
    <p><b>Practice</b> uses spaced repetition: play discovered lines from memory. Perfect lines come back after 1, 2.5, 6… days; a mistake brings the line back in 10 minutes.</p>
    <p><b>Drill</b> fires random discovered lines at you and counts your perfect-line streak.</p>
    <p><b>Time</b> is a 3-minute sprint — one point per correct move, wrong moves cost 5 seconds.</p>
    <p><b>Puzzles</b> drop you into the middle of a line; find the repertoire move. Your puzzle rating moves up and down like Elo.</p>
    <p><b>Arena</b> plays any line in your training depth with no help at all. Get through the opening perfectly to win rating.</p>
    <h4>Controls</h4>
    <ul><li>Drag or click pieces to move.</li><li><kbd>←</kbd> <kbd>→</kbd> step back and forward through the moves played (click a move in the list too).</li><li><kbd>H</kbd> shows a hint.</li><li>Right-click drag to draw your own arrows.</li></ul>
    <h4>Your data</h4>
    <p>Progress is saved in this browser only (localStorage). Nothing is sent anywhere. Use the same browser to keep your streaks.</p>
    <h4>About</h4>
    <p>OpenReps is free and open source. Board by chessground, rules by chess.js, evaluation by Stockfish (all open source). Coach notes are original to this project.</p>
  </div>`);
}

$('#btn-settings').onclick = openSettings;
$('#btn-lines').onclick = openLines;
$('#btn-help').onclick = openHelp;

// ---------------------------------------------------------------- boot
renderModes();
const shareLine = +params.get('line');
if (shareLine >= 1 && shareLine <= lines.length) {
  const ply = Math.max(0, Math.min(+params.get('ply') || 0, lines[shareLine - 1].moves.length - 1));
  S.mode = 'learn'; renderModes();
  startLine(shareLine - 1, { startPly: ply });
} else if (params.get('mode') && MODES.some(m => m.id === params.get('mode'))) {
  switchMode(params.get('mode'));
} else {
  setCoach('Coach', `<p>${esc(course.intro)}</p>`);
  startLearn();
}

import { Chessground } from '../vendor/chessground.min.js';
import { Chess } from '../vendor/chess.js';
import { loadCourse } from './courses.js';
import { getSettings, saveSettings, getProgress, saveProgress, resetProgress } from './store.js';
import { applyTheme, BOARDS, PIECE_SETS, pieceUrl } from './theme.js';
import { promptFor, autoExplain } from './explain.js';
import { evaluate, haptic, confetti, toast } from './fx.js';
import { toPgn } from './pgn.js';
import { startTimer as startStudyTimer, onTimerTick, timeStats, fmtClock, statsHtml, refreshStats } from './timer.js';

const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DAY = 86400000;
const isPhone = () => matchMedia('(max-width: 899px)').matches;

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
$('#course-title').textContent = course.title;

const OUR = course.color === 'white' ? 'w' : 'b';
const lines = course.lines;
const commonPrefix = (() => {
  let n = 0;
  const first = lines[0].moves;
  while (n < first.length && lines.every(l => l.moves[n] === first[n])) n++;
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
const buzz = kind => { if (settings.haptics) haptic(kind); };

const MODES = [
  { id: 'learn', label: 'Learn', ic: '📖', sub: 'discover new lines', need: 0 },
  { id: 'practice', label: 'Practice', ic: '🎯', sub: 'perfect your lines', need: 1 },
  { id: 'drill', label: 'Drill', ic: '🔥', sub: 'rounds until mastered', need: 3 },
  { id: 'time', label: 'Time', ic: '⏳', sub: '3-minute sprint', need: 3 },
  { id: 'puzzles', label: 'Puzzles', ic: '🧩', sub: 'find the move', need: 2 },
  { id: 'arena', label: 'Arena', ic: '⚔️', sub: 'no help at all', need: 2 },
];
const TIER_EMOJI = ['🌱', '🌳', '👑'];
const tierEmoji = i => course.tiers.length === 2 && i === 1 ? '👑' : TIER_EMOJI[i] || '👑';

// ---------------------------------------------------------------- state
const S = {
  mode: 'learn', lineIdx: 0, ply: 0, startPly: 0, chess: new Chess(),
  mistakes: 0, tries: 0, done: false, view: null, token: 0, lastNote: null,
  puzzle: null, arena: null, timer: null, hinted: false,
};

// ---------------------------------------------------------------- board
const cg = Chessground($('#board'), {
  orientation: course.color,
  coordinates: true,
  animation: { enabled: true, duration: 220 },
  highlight: { lastMove: true, check: true },
  movable: { free: false, color: undefined, showDests: true, events: { after: onUserMove } },
  premovable: { enabled: true, showDests: true, castle: true },
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
  // while the opponent is "thinking", let the student queue a premove
  const canPremove = settings.premove && ch.turn() !== OUR && !S.done && S.view === null;
  cg.set({
    fen: ch.fen(),
    turnColor: ch.turn() === 'w' ? 'white' : 'black',
    lastMove: last ? [last.from, last.to] : undefined,
    check: ch.inCheck() ? (ch.turn() === 'w' ? 'white' : 'black') : false,
    movable: { color: ourTurn || canPremove ? course.color : undefined, dests: ourTurn ? dests(ch) : new Map() },
    premovable: { enabled: !!settings.premove },
  });
  cg.setAutoShapes(opts.shapes || []);
  updateEval(ch.fen());
  updateProgress();
  updateNav();
}
function arrowFor(san, fen, brush = 'yellow') {
  const ch = new Chess(fen);
  try { const m = ch.move(san); return [{ orig: m.from, dest: m.to, brush }]; } catch { return []; }
}
// a warm orange arrow like a coach's marker
cg.set({ drawable: { brushes: { ...cg.state.drawable.brushes, yellow: { key: 'y', color: '#f59e0b', opacity: 0.9, lineWidth: 12 }, blue: { key: 'b', color: '#3d8bff', opacity: 0.9, lineWidth: 12 } } } });

let evalSeq = 0;
function updateEval(fen) {
  const bar = $('#evalbar');
  bar.classList.toggle('hidden', !settings.evalBar);
  if (!settings.evalBar) return;
  const seq = ++evalSeq;
  evaluate(fen, 16).then(r => {
    if (!r || seq !== evalSeq) return;
    const cp = Math.max(-1000, Math.min(1000, r.cp));
    const pct = 50 + 50 * (2 / (1 + Math.exp(-0.004 * cp)) - 1);
    const fill = bar.querySelector('.fill');
    fill.style.height = pct + '%';
    fill.style.width = pct + '%';
    const ours = OUR === 'w' ? cp : -cp;
    bar.classList.toggle('losing', ours < 0 && !isPhone());
    bar.querySelector('.num').textContent = r.mate ? `${r.mate > 0 ? '' : '-'}M${Math.abs(r.mate)}` : `${r.cp > 0 ? '+' : r.cp < 0 ? '−' : ''}${(Math.abs(r.cp) / 100).toFixed(1)}`;
    bar.title = r.mate ? `Mate in ${Math.abs(r.mate)} for ${r.mate > 0 ? 'White' : 'Black'}` : `${(r.cp / 100).toFixed(2)} (White's view)`;
  });
}

function updateProgress() {
  const len = lines[S.lineIdx]?.moves.length || 1;
  const linePct = (S.ply - S.startPly) / Math.max(1, len - S.startPly);
  const r = prog.drillRound;
  const pct = S.mode === 'time' && S.timer ? Math.max(0, (S.timer.end - Date.now()) / 180000) * 100
    : S.mode === 'drill' && r ? Math.max(4, ((Object.keys(r.done).length + (S.done ? 0 : linePct)) / r.size) * 100)
    : Math.max(4, linePct * 100);
  $('#pbar').style.width = pct + '%';
  $('#pbar-desk').style.width = pct + '%';
}
function updateNav() {
  const cur = S.view ?? S.ply;
  $('#btn-prev').disabled = cur <= 0;
  $('#btn-next').disabled = cur >= S.ply;
}

// ---------------------------------------------------------------- notes / bubble
const pathKey = (moves, n) => moves.slice(0, n).join(' ');
function fenAt(moves, n) { const c = new Chess(); for (let i = 0; i < n; i++) c.move(moves[i]); return c.fen(); }
function moveLabel(ply, san) { return `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '...'}${san}`; }
function noteFor(lineIdx, plyIdx) {
  const moves = lines[lineIdx].moves;
  const key = pathKey(moves, plyIdx + 1);
  if (course.notes[key]) return { text: course.notes[key], auto: false, key };
  return { text: autoExplain(fenAt(moves, plyIdx), moves[plyIdx]), auto: true, key };
}
function noteHtml(lineIdx, plyIdx) {
  const n = noteFor(lineIdx, plyIdx);
  const san = lines[lineIdx].moves[plyIdx];
  const text = n.auto ? n.text.replace(/^\S+\s/, '') : n.text;
  const body = esc(text.charAt(0).toUpperCase() + text.slice(1)).replace(/(?<![A-Za-z0-9.])(\d+\.(?:\.\.)?[KQRBNO][^\s,.;:)]*|\d+\.(?:\.\.)?[a-h][x1-8][^\s,.;:)]*)/g, '<span class="move-ref">$1</span>');
  const label = moveLabel(plyIdx, san);
  if (text.replace(/\.\s+/, '.').startsWith(label)) return `<p>${body}</p>`;
  return `<p><span class="move-ref">${esc(label)}</span> — ${body}</p>`;
}
function setCoach(tag, html) {
  $('#coach-text').innerHTML = (tag ? `<span class="tag">${esc(tag)}</span>` : '') + html;
  const n = $('#coach-text');
  n.scrollTop = 0;
  requestAnimationFrame(() => n.classList.toggle('fade', n.scrollHeight > n.clientHeight + 4));
}
$('#coach-text').addEventListener('scroll', e => { const n = e.target; n.classList.toggle('fade', n.scrollTop + n.clientHeight < n.scrollHeight - 4); });
function setPrompt(text, cls = '') { const p = $('#prompt'); p.className = 'prompt ' + cls; p.innerHTML = text; }
function setActions(btns) {
  const box = $('#actions'); box.innerHTML = '';
  for (const b of btns) {
    if (!b) continue;
    const el = document.createElement('button');
    el.className = 'bbtn ' + (b.cls || '');
    el.innerHTML = b.label;
    el.onclick = () => { buzz('tap'); b.onClick(); };
    box.appendChild(el);
  }
}

// ---------------------------------------------------------------- header + modes
function modeState(m) {
  const disc = discoveredList().length;
  const tier = tierLines();
  const locked = disc < m.need;
  let big = '', small = '';
  if (m.id === 'learn') { big = `${[...tier].filter(isDiscovered).length}/${tier.size}`; small = 'discovered'; }
  else if (m.id === 'practice') { const rq = (prog.practiceRetry || []).length; big = `${dueList().length}`; small = rq ? `due · ${rq} to retry` : `due of ${disc}`; }
  else if (m.id === 'drill') {
    const r = prog.drillRound;
    if (r && r.queue.length) { big = `${Object.keys(r.done).length}/${r.size}`; small = 'mastered'; }
    else { big = `×${prog.drillStreak}`; small = `best ×${prog.drillBest}`; }
  }
  else if (m.id === 'time') { big = `${prog.timeBest}`; small = 'best'; }
  else if (m.id === 'puzzles') { big = `${Math.round(prog.puzzleRating)}`; small = 'rating'; }
  else if (m.id === 'arena') { big = `${Math.round(prog.arenaRating)}`; small = 'rating'; }
  return { locked, big, small, disc };
}
function lockHtml(m, disc) {
  const left = m.need - disc;
  const dots = Array.from({ length: m.need }, (_, i) => `<i class="${i < disc ? 'on' : ''}"></i>`).join('');
  const lockSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  return `<span class="mv"><span class="lock">${lockSvg}<span class="dots">${dots}</span></span><small>${m.need === 1 ? `${left} line away` : `${disc}/${m.need} lines`}</small></span>`;
}
function modeCards(inPopover) {
  return MODES.map((m, i) => {
    const st = modeState(m);
    const wide = !inPopover && i < 2;
    const right = st.locked ? lockHtml(m, st.disc) : `<span class="mv">${st.big}<small>${st.small}</small></span>`;
    return `<button class="mcard ${wide ? 'wide' : ''} ${S.mode === m.id ? 'active' : ''} ${st.locked ? 'locked' : ''}" data-mode="${m.id}">
      <span class="mi">${m.ic}</span><span class="mt"><b>${m.label}</b><small>${m.sub}</small></span>${right}</button>`;
  }).join('') + (inPopover ? `<button class="depth-row" id="pop-depth"><span>${tierEmoji(prog.depth)}</span> Training depth <span class="v">${esc(course.tiers[prog.depth].name)} ›</span></button>` : '');
}
function bindModeCards(root, after) {
  root.querySelectorAll('.mcard').forEach(b => b.onclick = () => {
    const m = MODES.find(x => x.id === b.dataset.mode);
    if (modeState(m).locked) { buzz('wrong'); toast(m.need === 1 ? 'Finish your first line in Learn to unlock Practice' : `Discover ${m.need} lines to unlock ${m.label}`); return; }
    buzz('tap'); after?.(); switchMode(m.id);
  });
  root.querySelector('#pop-depth')?.addEventListener('click', () => { after?.(); openDepthSheet(false); });
}
function renderModes() {
  const m = MODES.find(x => x.id === S.mode);
  $('#mode-ic').textContent = m.ic;
  $('#mode-name').textContent = m.label;
  $('#line-num').textContent = `#${S.lineIdx + 1}`;
  const list = $('#mode-list');
  list.innerHTML = modeCards(false);
  bindModeCards(list);
}

// ---------------------------------------------------------------- popovers
function openPopover(anchor, html, onMount, align = 'left') {
  closePopover();
  const root = $('#popover-root');
  root.innerHTML = `<div class="pop-back"></div><div class="popover">${html}</div>`;
  const pop = root.querySelector('.popover');
  const r = anchor.getBoundingClientRect();
  const w = Math.min(isPhone() ? innerWidth - 16 : 400, 420);
  pop.style.width = w + 'px';
  const left = align === 'right' ? Math.max(8, r.right - w) : Math.min(Math.max(8, r.left - 8), innerWidth - w - 8);
  pop.style.left = left + 'px';
  if (r.top > innerHeight / 2) { pop.style.bottom = (innerHeight - r.top + 8) + 'px'; pop.style.maxHeight = (r.top - 24) + 'px'; }
  else { pop.style.top = (r.bottom + 6) + 'px'; pop.style.maxHeight = (innerHeight - r.bottom - 24) + 'px'; }
  root.querySelector('.pop-back').onclick = closePopover;
  onMount?.(pop);
}
function closePopover() { $('#popover-root').innerHTML = ''; }

function openModePopover(anchor) {
  openPopover(anchor, `<div class="mode-list">${modeCards(true)}</div>`, pop => bindModeCards(pop, closePopover), anchor.id === 'btn-mode' ? 'right' : 'left');
}
let showPgns = false;
function lineDots(i) {
  const a = isDiscovered(i), b = (prog.srs[i]?.reps || 0) > 0;
  return `<span class="dots"><i class="${a ? 'on' : ''}"></i><i class="${b ? 'on' : ''}"></i></span>`;
}
function openLinePopover(anchor) {
  const tier = tierLines();
  openPopover(anchor, `<div id="lp-list"></div>
    <div class="pop-foot"><input type="text" id="lp-q" placeholder="Search lines"></div>
    <label class="pop-foot" style="border:0;margin:0;padding-top:4px"><input type="checkbox" class="cb" id="lp-pgn" ${showPgns ? 'checked' : ''}> Show PGNs</label>`, pop => {
    const render = () => {
      const q = pop.querySelector('#lp-q').value.trim().toLowerCase();
      pop.querySelector('#lp-list').innerHTML = lines.map((l, i) => {
        const pgn = toPgn(l.moves);
        if (q && !`${i + 1} ${l.name} ${pgn}`.toLowerCase().includes(q)) return '';
        return `<button class="line-row ${i === S.lineIdx ? 'cur' : ''} ${tier.has(i) ? '' : 'outside'}" data-i="${i}">
          <span class="n">${i + 1}</span>
          <span class="t"><b>${esc(l.name || pgn)}</b><span class="${showPgns ? 'full' : ''}">${esc(pgn)}</span></span>${lineDots(i)}</button>`;
      }).join('') || '<p style="color:var(--muted);padding:10px">No lines match.</p>';
      pop.querySelectorAll('.line-row').forEach(b => b.onclick = () => {
        closePopover(); stopTimer(); buzz('tap');
        const i = +b.dataset.i;
        S.mode = S.mode === 'practice' && isDiscovered(i) ? 'practice' : 'learn';
        renderModes(); startLine(i);
      });
    };
    pop.querySelector('#lp-q').oninput = render;
    pop.querySelector('#lp-pgn').onchange = e => { showPgns = e.target.checked; render(); };
    render();
    pop.querySelector('.line-row.cur')?.scrollIntoView({ block: 'center' });
  }, 'right');
}

// ---------------------------------------------------------------- navigation
function viewPly(n) {
  if (n < 0 || n > S.ply) return;
  if (n === S.ply) { S.view = null; syncBoard({ shapes: S.liveShapes || [] }); if (S.ply > 0 && S.mode !== 'time') refreshCoachForCurrent(); return; }
  S.view = n;
  const c = new Chess();
  const mv = lines[S.lineIdx].moves;
  let last = null;
  for (let i = 0; i < n; i++) last = c.move(mv[i]);
  cg.set({ fen: c.fen(), lastMove: last ? [last.from, last.to] : undefined, movable: { color: undefined, dests: new Map() }, check: c.inCheck() ? (c.turn() === 'w' ? 'white' : 'black') : false });
  cg.setAutoShapes([]);
  updateEval(c.fen());
  updateNav();
  if (n > 0 && S.mode !== 'time' && S.mode !== 'arena') setCoach('Reviewing', noteHtml(S.lineIdx, n - 1));
}
function refreshCoachForCurrent() { if (S.ply > 0) setCoach('', noteHtml(S.lineIdx, S.ply - 1)); }
$('#btn-prev').onclick = () => { buzz('tap'); viewPly((S.view ?? S.ply) - 1); };
$('#btn-next').onclick = () => { buzz('tap'); viewPly((S.view ?? S.ply) + 1); };
document.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea') || $('#modal-root').children.length) return;
  if (e.key === 'ArrowLeft') { viewPly((S.view ?? S.ply) - 1); e.preventDefault(); }
  if (e.key === 'ArrowRight') { viewPly((S.view ?? S.ply) + 1); e.preventDefault(); }
  if (e.key === 'h' || e.key === 'H') showHint();
  if (e.key === 'Escape') closePopover();
});

// ---------------------------------------------------------------- line flow
function startLine(idx, opts = {}) {
  S.token++;
  S.lineIdx = idx;
  S.chess = new Chess();
  S.mistakes = 0; S.tries = 0; S.done = false; S.view = null; S.hinted = false; S.liveShapes = [];
  const skip = prog.skipStart && prog.finishedAny && S.mode !== 'puzzles';
  S.startPly = opts.startPly ?? (skip ? commonPrefix : 0);
  for (let i = 0; i < S.startPly; i++) S.chess.move(lines[idx].moves[i]);
  S.ply = S.startPly;
  setActions([]);
  syncBoard();
  renderModes();
  advance(opts.firstDelay ?? 350);
}

function advance(delay = 450) {
  const token = S.token;
  const moves = lines[S.lineIdx].moves;
  if (S.ply >= moves.length) return finishLine();
  if (S.chess.turn() !== OUR) {
    syncBoard({ movable: false });
    setTimeout(() => {
      if (token !== S.token) return;
      if (S.view !== null) { S.view = null; }
      const pm = cg.state.premovable.current; // [orig, dest] queued during the opponent's turn
      cg.cancelPremove();
      playMove(moves[S.ply]);
      afterOpponentMove();
      advance(450);
      if (pm && settings.premove && !S.done && S.chess.turn() === OUR) onUserMove(pm[0], pm[1]);
    }, delay);
    return;
  }
  awaitUser();
}

function playMove(san) {
  const mv = S.chess.move(san);
  S.ply++;
  syncBoard();
  return mv;
}

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
  const firstEver = plyIdx === 0 && S.startPly === 0 && !prog.finishedAny;
  if (S.mode === 'learn') {
    if (settings.arrows === 'always' || (settings.arrows === 'notes' && showNote)) shapes = arrowFor(expected, fen);
    if (showNote) {
      setCoach('', (firstEver ? `<p>${esc(course.intro)}</p>` : '') + noteHtml(S.lineIdx, plyIdx));
      prog.seen[pathKey(moves, plyIdx + 1)] = true; save();
      setPrompt(esc(promptFor(mv)), 'info');
    } else {
      if (firstEver) setCoach('', `<p>${esc(course.intro)}</p>`);
      else if (!S.lastNote) setCoach('', '');
      setPrompt(settings.coach === 'tap' ? 'Your move.' : 'You know this one — your move.', 'info');
    }
  } else if (S.mode === 'puzzles') {
    setPrompt(`Find the best move for ${OUR === 'w' ? 'White' : 'Black'}.`, 'info');
  } else {
    if (!S.lastNote && S.mode !== 'time') setCoach('', '');
    setPrompt('Your move.', 'info');
  }
  S.lastNote = null;
  S.liveShapes = shapes;
  syncBoard({ shapes });
  setActions(settings.coach === 'tap' || S.mode !== 'learn' ? [{ label: 'Why?', onClick: showWhy }] : []);
}

function showHint() {
  if (S.done || S.view !== null || S.chess.turn() !== OUR) return;
  const exp = lines[S.lineIdx].moves[S.ply];
  S.liveShapes = arrowFor(exp, S.chess.fen(), 'blue');
  cg.setAutoShapes(S.liveShapes);
  buzz('tap');
  if (!S.hinted && S.mode !== 'learn') registerMistake();
  S.hinted = true;
  if (['learn', 'practice', 'drill'].includes(S.mode)) setCoach('Hint', noteHtml(S.lineIdx, S.ply));
  setPrompt(esc(promptFor(new Chess(S.chess.fen()).move(exp))), 'info');
}
$('#btn-hint').onclick = showHint;

function showWhy() {
  const idx = S.mode === 'learn' && S.chess.turn() === OUR && !S.done ? S.ply : S.ply - 1;
  if (idx < 0) { setCoach('', `<p>${esc(course.intro)}</p>`); return; }
  if (S.mode !== 'learn' && idx === S.ply) return;
  setCoach('', noteHtml(S.lineIdx, idx));
}

function afterOpponentMove() {
  const idx = S.ply - 1;
  const key = pathKey(lines[S.lineIdx].moves, idx + 1);
  const hasNote = !!course.notes[key];
  const show = settings.coach === 'every' || (settings.coach === 'auto' && S.mode === 'learn' && hasNote && !prog.seen[key]);
  if (show && !['time', 'arena', 'puzzles'].includes(S.mode)) {
    setCoach('Opponent', noteHtml(S.lineIdx, idx));
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
  // use the repertoire move's promotion piece (e.g. c8=R#) when the squares match
  let promo = 'q';
  try { const em = new Chess(S.chess.fen()).move(expected); if (em.from === orig && em.to === dest && em.promotion) promo = em.promotion; } catch {}
  try { mv = test.move({ from: orig, to: dest, promotion: promo }); } catch { syncBoard(); return; }
  if (mv.san === expected) {
    S.tries = 0;
    const plyIdx = S.ply;
    playMove(expected);
    buzz(mv.captured ? 'capture' : S.chess.inCheck() ? 'check' : 'move');
    const key = pathKey(moves, plyIdx + 1);
    if (S.mode === 'time') { S.timer.score++; updateTimerUi(); }
    if (S.mode === 'learn') {
      prog.seen[key] = true; save();
      setPrompt('✓ Correct!', 'good');
      if (!explainBefore(plyIdx) && settings.coach !== 'tap') { setCoach('', noteHtml(S.lineIdx, plyIdx)); S.lastNote = key; }
    } else if (S.mode === 'practice' || S.mode === 'drill') {
      setPrompt('✓ Correct', 'good');
      if (settings.coach === 'every') { setCoach('', noteHtml(S.lineIdx, plyIdx)); S.lastNote = key; }
    } else if (S.mode === 'puzzles') {
      S.puzzle.solved++;
      if (S.puzzle.solved >= S.puzzle.need || S.ply >= moves.length) return finishPuzzle(true);
      setPrompt('✓ Keep going…', 'good');
    } else {
      setPrompt('✓', 'good');
    }
    advance(S.mode === 'time' ? 200 : 450);
  } else {
    buzz('wrong');
    const wrap = $('#board-wrap'); wrap.classList.remove('shake'); void wrap.offsetWidth; wrap.classList.add('shake');
    S.tries++;
    registerMistake(pathKey(moves, S.ply + 1));
    const fen = S.chess.fen();
    cg.set({ fen: test.fen(), lastMove: [orig, dest] });
    setTimeout(() => {
      S.liveShapes = (S.mode === 'learn' || S.tries >= 2) && !['arena', 'puzzles'].includes(S.mode) ? arrowFor(expected, fen) : [];
      syncBoard({ shapes: S.liveShapes });
    }, 380);
    if (S.mode === 'arena') return finishArena(false, mv.san);
    if (S.mode === 'puzzles') return finishPuzzle(false, mv.san);
    if (S.mode === 'time') { S.timer.end -= 5000; setPrompt(S.tries >= 2 ? `✗ The move is ${esc(expected)} (−5s)` : `✗ Not ${esc(mv.san)} (−5s)`, 'bad'); updateTimerUi(); return; }
    setPrompt(`✗ ${esc(mv.san)} isn't the move here. Try again.`, 'bad');
    if (settings.coach !== 'tap' || S.mode === 'learn') setCoach('', noteHtml(S.lineIdx, S.ply));
  }
}

function registerMistake(key) {
  S.mistakes++;
  if (key) prog.mistakes[key] = (prog.mistakes[key] || 0) + 1;
  if (S.mode === 'drill') prog.drillStreak = 0;
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
    buzz('done');
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
    r.last = now;
    prog.srs[idx] = r; prog.discovered[idx] = prog.discovered[idx] || now; prog.finishedAny = true;
    // session retry queue: count lines, not minutes. A miss comes back after 2 other lines.
    prog.practiceRetry = (prog.practiceRetry || []).filter(x => x.idx !== idx).map(x => ({ ...x, wait: x.wait - 1 }));
    if (S.mistakes) prog.practiceRetry.push({ idx, wait: 2 });
    prog.practiceRecent = [idx, ...(prog.practiceRecent || []).filter(i => i !== idx)].slice(0, 4);
    save();
    if (S.mistakes === 0 && settings.confetti) confetti();
    buzz('done');
    const when = S.mistakes === 0 ? `Perfect! Next review in ${r.interval < 2 ? '1 day' : Math.round(r.interval) + ' days'}.` : `${S.mistakes} mistake${S.mistakes > 1 ? 's' : ''} — this line comes back after two other lines, until you play it clean.`;
    setCoach('Line complete', lastNote + `<p>${when}</p>`);
    setPrompt(S.mistakes === 0 ? '✓ Perfect line' : 'Line finished', S.mistakes === 0 ? 'good' : 'info');
    setActions([{ label: 'Next due line →', cls: 'primary', onClick: () => startPractice() }, { label: '↺ Again', onClick: () => startLine(idx) }]);
  } else if (S.mode === 'drill') {
    finishDrillLine(idx, lastNote);
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
  setActions([]);
  renderModes();
  ({ learn: startLearn, practice: startPractice, drill: startDrill, time: introTime, puzzles: startPuzzle, arena: introArena })[mode]();
}
function resetBoardIdle() { S.done = true; S.chess = new Chess(); S.ply = 0; S.startPly = 0; S.view = null; syncBoard(); }

function startLearn() {
  const n = nextLearnLine();
  if (n === null) {
    resetBoardIdle();
    setCoach('', `<p>You have discovered every line in <b>${esc(course.tiers[prog.depth].name)}</b>. 🎉 Keep them fresh in Practice, or go deeper for more lines.</p>`);
    setPrompt('All lines discovered.', 'good');
    setActions([{ label: 'Practice', cls: 'primary', onClick: () => switchMode('practice') }, course.tiers.length > prog.depth + 1 && { label: 'Go deeper', onClick: () => openDepthSheet(false) }]);
    return;
  }
  startLine(n);
}

function startPractice() {
  const disc = discoveredList();
  if (!disc.length) return switchMode('learn');
  S.mode = 'practice'; renderModes();
  const retry = (prog.practiceRetry || []).filter(x => x.idx < lines.length);
  const waiting = new Set(retry.filter(x => x.wait > 0).map(x => x.idx));
  const ready = retry.filter(x => x.wait <= 0);
  const recent = new Set((prog.practiceRecent || []).slice(0, Math.max(1, Math.min(4, discoveredList().length - 1))));
  let idx;
  // 1) a missed line whose turn has come  2) lines due by the schedule  3) extra review of weak lines
  const due = dueList().filter(i => !waiting.has(i) && !recent.has(i));
  if (ready.length) idx = ready[0].idx;
  else if (due.length) { due.sort((a, b) => (prog.srs[a]?.due ?? 0) - (prog.srs[b]?.due ?? 0)); idx = due[0]; }
  else {
    idx = drawLines('practice', 1, new Set([...waiting, ...recent]))[0] ?? drawLines('practice', 1)[0];
    if (!retry.length) toast('All caught up! Extra review — every line comes up once before repeats.');
  }
  setCoach('Practice', `<p>Play the whole line from memory. Perfect lines come back later; mistakes bring them back sooner.</p>`);
  S.lastNote = 'intro';
  startLine(idx);
}

// ---- Drill: Quizlet-Learn-style rounds -------------------------------------------
// A round holds ~8 of your weakest discovered lines. A clean line is mastered; a missed
// line comes back two lines later and must then be played clean twice in a row.
const ROUND_SIZE = 8;
// Shuffle-bag: deal every discovered line once, in random order, before any repeats.
// `key` names the cycle (drill / practice); `exclude` lines are skipped this draw.
function shuffled(arr) { const a = [...arr]; for (let k = a.length - 1; k > 0; k--) { const j = (Math.random() * (k + 1)) | 0; [a[k], a[j]] = [a[j], a[k]]; } return a; }
function drawLines(key, n, exclude = new Set()) {
  const disc = discoveredList();
  const usedKey = key + 'Used';
  let used = new Set((prog[usedKey] || []).filter(i => i < lines.length));
  const out = [];
  while (out.length < n) {
    let bag = disc.filter(i => !used.has(i) && !exclude.has(i) && !out.includes(i));
    if (!bag.length) {
      // cycle finished: start a new one (lines just dealt still can't repeat in this draw)
      if (!disc.some(i => !exclude.has(i) && !out.includes(i))) break;
      used = new Set(); bag = disc.filter(i => !exclude.has(i) && !out.includes(i));
    }
    const i = bag[(Math.random() * bag.length) | 0];
    out.push(i); used.add(i);
  }
  prog[usedKey] = [...used];
  save();
  return out;
}
function newDrillRound() {
  // A mastered round is done: the next round is dealt fresh from the shuffled cycle.
  // (Lines you missed get extra review through Practice's schedule, not by repeating here.)
  const prev = prog.lastDrillRound || { lines: [] };
  let fresh = drawLines('drill', ROUND_SIZE, new Set(prev.lines));
  if (fresh.length < Math.min(ROUND_SIZE, discoveredList().length)) {
    // small course: allow last round's lines rather than a short round
    fresh = [...fresh, ...drawLines('drill', ROUND_SIZE - fresh.length, new Set(fresh))];
  }
  const picked = shuffled(fresh);
  prog.drillRound = { queue: picked, need: Object.fromEntries(picked.map(i => [i, 1])), done: {}, missed: {}, size: picked.length };
  save();
}
function drillStatus() {
  const r = prog.drillRound;
  const done = Object.keys(r.done).length;
  const retry = r.queue.filter(i => r.need[i] > 1).length;
  return `${done}/${r.size} mastered${retry ? ` · ${retry} to retry` : ''}`;
}
function startDrill() {
  const disc = discoveredList();
  if (!disc.length) return switchMode('learn');
  S.mode = 'drill';
  if (!prog.drillRound || !prog.drillRound.queue.length || prog.drillRound.queue.some(i => i >= lines.length)) newDrillRound();
  const r = prog.drillRound;
  const idx = r.queue[0];
  const again = r.need[idx] > 1;
  setCoach(again ? 'Try again' : 'Drill', `<p>${again ? 'You missed this one earlier — play it clean to lock it in.' : 'Play the whole line from memory.'} <b>${drillStatus()}</b></p>`);
  S.lastNote = 'intro';
  startLine(idx, { firstDelay: 200 });
}
function finishDrillLine(idx, lastNote) {
  const r = prog.drillRound;
  if (!r) return;
  if (r.queue[0] === idx) r.queue.shift(); else r.queue = r.queue.filter(i => i !== idx);
  const srs = prog.srs[idx] || (prog.srs[idx] = { due: Date.now(), interval: 0, reps: 0, lapses: 0 });
  srs.last = Date.now();
  const clean = S.mistakes === 0;
  if (clean) {
    prog.drillStreak++; prog.drillBest = Math.max(prog.drillBest, prog.drillStreak);
    r.need[idx] = (r.need[idx] || 1) - 1;
    if (r.need[idx] <= 0) r.done[idx] = true;
    else r.queue.splice(Math.min(1, r.queue.length), 0, idx); // one more clean rep, after another line
  } else {
    prog.drillStreak = 0;
    r.need[idx] = 2;
    r.missed[idx] = (r.missed[idx] || 0) + 1;
    srs.drillMiss = (srs.drillMiss || 0) + 1;
    srs.interval = 0; srs.due = Math.min(srs.due ?? Infinity, Date.now() + 10 * 60000);
    r.queue.splice(Math.min(2, r.queue.length), 0, idx); // comes back after two other lines
  }
  save(); renderModes(); updateProgress();
  buzz(clean ? 'done' : 'wrong');
  if (!r.queue.length) {
    const missed = Object.keys(r.missed).map(Number);
    if (settings.confetti) confetti();
    setCoach('Round complete', `<p>All ${r.size} lines mastered! 🎉</p>` + (missed.length
      ? `<p>Tricky ones this round:</p><p>${missed.map(i => `• ${esc(lines[i].name || 'Line ' + (i + 1))}${r.missed[i] > 1 ? ` (×${r.missed[i]})` : ''}`).join('<br>')}</p>`
      : '<p>Not a single miss — perfect round.</p>'));
    setPrompt(`✓ Round done · streak ×${prog.drillStreak}`, 'good');
    prog.lastDrillRound = { lines: Object.keys(r.need).map(Number), missed };
    prog.drillRound = null; save();
    setActions([{ label: 'Next round →', cls: 'primary', onClick: () => { newDrillRound(); startDrill(); } }]);
    return;
  }
  if (clean) {
    setPrompt(r.done[idx] ? `✓ Mastered · ${drillStatus()}` : `✓ Clean · once more later · ${drillStatus()}`, 'good');
    const tok = S.token;
    setTimeout(() => { if (tok === S.token && S.mode === 'drill') startDrill(); }, 1100);
  } else {
    setCoach('Missed', lastNote + `<p>This line will come back in a moment — you'll need to play it clean twice. <b>${drillStatus()}</b></p>`);
    setPrompt('Line finished with a mistake', 'bad');
    setActions([{ label: 'Continue →', cls: 'primary', onClick: startDrill }]);
  }
}

function timePool() { const d = discoveredList(); return d.length ? d : [...tierLines()]; }
function introTime() {
  resetBoardIdle();
  setCoach('Time', `<p>Three minutes on the clock. Score a point for every correct move across random discovered lines. A wrong move costs 5 seconds.</p><p>Best score: <b>${prog.timeBest}</b></p>`);
  setPrompt('Ready?', 'info');
  setActions([{ label: '▶ Start 3:00', cls: 'primary', onClick: startTimer }]);
}
function startTimer() {
  stopTimer();
  S.timer = { end: Date.now() + 180000, score: 0, running: true };
  $('#timer-box').classList.remove('hidden');
  setCoach('', '');
  S.timer.iv = setInterval(() => { updateTimerUi(); if (Date.now() >= S.timer.end) endTimer(); }, 200);
  updateTimerUi();
  startLine(randomFrom(timePool()), { firstDelay: 150 });
}
function updateTimerUi() {
  if (!S.timer) return;
  const left = Math.max(0, S.timer.end - Date.now());
  $('#timer').textContent = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
  $('#timer-score').textContent = `${S.timer.score} moves`;
  updateProgress();
}
function endTimer() {
  if (!S.timer) return;
  const score = S.timer.score;
  clearInterval(S.timer.iv); S.timer.running = false;
  S.token++; S.done = true; syncBoard();
  const best = score > prog.timeBest;
  if (best) { prog.timeBest = score; save(); if (settings.confetti) confetti(); }
  buzz('done');
  renderModes();
  setCoach('Time', `<p>Time! You scored <b>${score}</b> correct moves.${best ? ' New personal best!' : ` Best: ${prog.timeBest}.`}</p>`);
  setPrompt(`Score: ${score}`, 'good');
  setActions([{ label: '▶ Play again', cls: 'primary', onClick: startTimer }]);
}

function puzzleDifficulty(lineIdx, ply) {
  const mis = prog.mistakes[pathKey(lines[lineIdx].moves, ply + 1)] || 0;
  return Math.min(2200, 850 + ply * 38 + mis * 60);
}
function startPuzzle() {
  const pool = discoveredList().length ? discoveredList() : [...tierLines()];
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
  if (!best) return switchMode('learn');
  S.mode = 'puzzles';
  S.puzzle = { rating: best.d, solved: 0, need: Math.min(2, Math.ceil((lines[best.li].moves.length - best.p) / 2)) };
  setCoach('Puzzle', `<p>Find the repertoire move${S.puzzle.need > 1 ? 's' : ''} in this position. Puzzle rating ${best.d}.</p>`);
  S.lastNote = 'intro';
  startLine(best.li, { startPly: best.p - 1, firstDelay: 600 });
}
function finishPuzzle(ok, wrongSan) {
  if (S.done && !ok) return;
  S.done = true; S.token++;
  const exp = 1 / (1 + 10 ** ((S.puzzle.rating - prog.puzzleRating) / 400));
  const won = ok && !S.hinted;
  const delta = Math.round(24 * ((won ? 1 : 0) - exp));
  prog.puzzleRating = Math.max(400, prog.puzzleRating + delta);
  save(); renderModes();
  const idx = S.lineIdx;
  setCoach(won ? 'Solved!' : 'Not quite', noteHtml(idx, ok ? S.ply - 1 : S.ply));
  setPrompt(won ? `✓ Solved! ${delta >= 0 ? '+' : ''}${delta}` : `✗ ${wrongSan ? esc(wrongSan) + ' — the move was ' + esc(lines[idx].moves[S.ply]) + '. ' : ''}${delta}`, won ? 'good' : 'bad');
  if (won) buzz('done');
  setActions([{ label: 'Next puzzle →', cls: 'primary', onClick: startPuzzle }]);
  syncBoard();
}

function introArena() {
  resetBoardIdle();
  setCoach('Arena', `<p>Face a sparring partner who picks any variation in your training depth — including lines you haven't discovered. No hints, no notes: play the whole opening without a mistake to win.</p><p>Arena rating: <b>${Math.round(prog.arenaRating)}</b></p>`);
  setPrompt('Ready for a game?', 'info');
  setActions([{ label: '⚔️ Find opponent', cls: 'primary', onClick: startArena }]);
}
function startArena() {
  const opp = Math.round(prog.arenaRating + (Math.random() - 0.5) * 300);
  S.arena = { opp };
  S.mode = 'arena';
  setCoach('Arena', `<p>Opponent rated <b>${opp}</b>. Good luck!</p>`);
  S.lastNote = 'intro';
  startLine(randomFrom([...tierLines()]), { startPly: 0 });
}
function finishArena(won, wrongSan) {
  if (!S.arena || S.arena.over) return;
  S.arena.over = true; S.done = true; S.token++;
  const exp = 1 / (1 + 10 ** ((S.arena.opp - prog.arenaRating) / 400));
  const delta = Math.round(32 * ((won && !S.hinted ? 1 : 0) - exp));
  prog.arenaRating = Math.max(400, prog.arenaRating + delta);
  save(); renderModes();
  if (won && settings.confetti) confetti();
  if (won) buzz('done');
  const idx = S.lineIdx;
  setCoach(won ? 'Victory' : 'Defeat', won ? `<p>You played the whole line perfectly. ${delta >= 0 ? '+' : ''}${delta} rating.</p>` : `<p>You played <b>${esc(wrongSan)}</b>; the repertoire move was <b>${esc(lines[idx].moves[S.ply])}</b>. ${delta} rating.</p>${noteHtml(idx, S.ply)}`);
  setPrompt(won ? `🏆 Won ${delta >= 0 ? '+' : ''}${delta}` : `Lost ${delta}`, won ? 'good' : 'bad');
  setActions([{ label: '⚔️ Next opponent', cls: 'primary', onClick: startArena }, !won && { label: 'Learn this line', onClick: () => { S.mode = 'learn'; renderModes(); startLine(idx); } }]);
  syncBoard();
}

// ---------------------------------------------------------------- sheets
const X_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const CHEV = '<svg class="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m9 18 6-6-6-6"/></svg>';
function openSheet(title, html, onMount, opts = {}) {
  closePopover();
  const root = $('#modal-root');
  root.innerHTML = `<div class="sheet-back"><div class="sheet" role="dialog" aria-label="${esc(title || 'Dialog')}"><div class="grab"></div>
    ${title !== null ? `<header><h3>${esc(title)}</h3>${opts.headExtra || ''}<button class="x" aria-label="Close">${X_SVG}</button></header>` : ''}
    <div class="content">${html}</div></div></div>`;
  const close = () => { root.innerHTML = ''; opts.onClose?.(); };
  root.querySelector('.x')?.addEventListener('click', close);
  root.querySelector('.sheet-back').onclick = e => { if (e.target.classList.contains('sheet-back') && !opts.modal) close(); };
  // swipe down to close
  const sheet = root.querySelector('.sheet');
  let y0 = null;
  sheet.addEventListener('touchstart', e => { if (sheet.querySelector('.content').scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
  sheet.addEventListener('touchmove', e => { if (y0 === null) return; const dy = e.touches[0].clientY - y0; if (dy > 0) sheet.style.transform = `translateY(${dy}px)`; }, { passive: true });
  sheet.addEventListener('touchend', e => { if (y0 === null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null; if (dy > 110 && !opts.modal) close(); else sheet.style.transform = ''; });
  onMount?.(root.querySelector('.content'), close);
}

function openDepthSheet(firstTime) {
  const t = course.tiers;
  openSheet(null, `
    <div class="depth-title">How deep do you want to go?</div>
    <div class="depth-sub">${esc(course.title)} · ${lines.length} lines</div>
    ${t.map((x, i) => `<button class="depth-card t${t.length === 2 && i === 1 ? 3 : i + 1} ${prog.depth === i ? 'on' : ''}" data-d="${i}">
      <span class="em">${tierEmoji(i)}</span><span class="tx"><b>${esc(x.name)}</b><small>${esc(x.sub || '')}</small></span>
      <span class="num">${x.count}<small>lines</small></span></button>`).join('')}
    <button class="big-btn" id="depth-go"></button>
    <div class="small-note">You can change this anytime. Progress on all lines is kept.</div>`, (box, close) => {
    let pick = prog.depth;
    const label = () => { box.querySelector('#depth-go').innerHTML = `${tierEmoji(pick)} Start with ${esc(t[pick].name)} ›`; };
    box.querySelectorAll('.depth-card').forEach(b => b.onclick = () => { pick = +b.dataset.d; buzz('tap'); box.querySelectorAll('.depth-card').forEach(x => x.classList.toggle('on', x === b)); label(); });
    box.querySelector('#depth-go').onclick = () => {
      const changed = pick !== prog.depth;
      prog.depth = pick; prog.depthChosen = true; save(); close(); renderModes(); buzz('tap');
      if (firstTime || (changed && S.mode === 'learn' && S.done)) startLearn();
    };
    label();
  }, { modal: firstTime });
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
const EYE_OFF = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2.6"><path d="M2 2l20 20M10.6 6.1A10 10 0 0 1 22 12a14 14 0 0 1-2.4 3.2M6.6 6.6A14 14 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/></svg>';
function coachIll(v) {
  if (v === 'auto') return '<div class="ill"><div class="ln"><i></i></div><div class="ln">?</div></div>';
  if (v === 'every') return '<div class="ill"><div class="ln"><i></i></div><div class="ln"><i></i></div></div>';
  return `<div class="ill"><div class="ln off">${EYE_OFF}<i></i></div><div class="ln off">${EYE_OFF}<i></i></div></div>`;
}
function arrowIll(v) {
  const arrow = '<svg viewBox="0 0 100 44" preserveAspectRatio="none"><path d="M22 38 L76 10" stroke="#f59e0b" stroke-width="6" stroke-linecap="round"/><path d="M68 6 L82 7 L76 19 Z" fill="#f59e0b"/></svg>';
  const note = '<svg viewBox="0 0 100 44" preserveAspectRatio="none"><rect x="54" y="4" width="40" height="30" rx="6" fill="#fff"/><rect x="60" y="12" width="28" height="4" rx="2" fill="#999"/><rect x="60" y="21" width="20" height="4" rx="2" fill="#999"/></svg>';
  return `<div class="ill board">${'<i></i>'.repeat(8)}${v === 'off' ? '' : v === 'notes' ? arrow + note : arrow}</div>`;
}
function switchHtml(key, checked) { return `<label class="switch"><input type="checkbox" data-toggle="${key}" ${checked ? 'checked' : ''}><span></span></label>`; }

function openSettings() {
  const boards = Object.entries(BOARDS).map(([k, [l, d, name]]) => `<button class="swatch ${settings.board === k ? 'on' : ''}" data-board="${k}"><span class="sq"><i style="background:${l}"></i><i style="background:${d}"></i><i style="background:${d}"></i><i style="background:${l}"></i></span>${name}</button>`).join('');
  const pieces = Object.entries(PIECE_SETS).map(([k, name]) => `<button class="swatch ${settings.pieces === k ? 'on' : ''}" data-pieces="${k}"><span class="sq" style="display:block;background:var(--light-sq)"><img src="${pieceUrl(k, 'w', 'N')}" alt=""></span>${name}</button>`).join('');
  const sizes = [['default', 'Default', 15], ['large', 'Large', 18], ['xl', 'Extra large', 21]];
  const shared = toPgn(lines[0].moves.slice(0, commonPrefix));
  const tiles = (key, opts, ill) => `<div class="tiles" data-key="${key}">${opts.map(([v, l]) => `<button class="tile ${settings[key] === v ? 'on' : ''}" data-v="${v}">${ill(v)}${l}</button>`).join('')}</div>`;
  const hapticPill = () => `<button class="chip-btn" id="hap-pill">${settings.haptics ? '📳 Haptics on' : '📴 Haptics off'}</button>`;
  openSheet('Settings', `
    <button class="nav-card" id="go-lines"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>Select Line${CHEV}</button>
    <button class="nav-card" id="go-help"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/></svg>Help${CHEV}</button>

    <div class="group-h"><b>Coach</b><span>Every course</span></div>
    <div class="group">
      <div class="gi"><div class="lbl">Coach notes</div>${tiles('coach', [['auto', 'Auto'], ['every', 'Every move'], ['tap', 'On tap']], coachIll)}<div class="desc" data-desc="coach">${COACH_DESC[settings.coach]}</div></div>
      <div class="gi"><div class="lbl">Arrows</div>${tiles('arrows', [['off', 'Off'], ['notes', 'With notes'], ['always', 'Always']], arrowIll)}<div class="desc" data-desc="arrows">${ARROW_DESC[settings.arrows]}</div></div>
      <div class="gi"><div class="lbl">Evaluation bar ${switchHtml('evalBar', settings.evalBar)}</div><div class="desc" style="margin-top:-4px">Shows who's better after each move. Stockfish runs right in your browser.</div></div>
    </div>

    <div class="group-h"><b>Looks</b><span>Every course</span></div>
    <div class="group">
      <div class="gi"><div class="lbl">Board</div><div class="swatches">${boards}</div></div>
      <div class="gi"><div class="lbl">Pieces</div><div class="swatches">${pieces}</div></div>
      <div class="gi"><div class="lbl">Coach text size</div><div class="swatches">${sizes.map(([k, l, px]) => `<button class="swatch ${settings.textSize === k ? 'on' : ''}" data-size="${k}"><span class="sq" style="display:grid;place-items:center;background:#fff;color:#111;font-weight:800;font-size:${px}px">Aa</span>${l}</button>`).join('')}</div></div>
    </div>

    <div class="group-h"><b>This course</b><span>${esc(course.title)}</span></div>
    <div class="group">
      <button class="gi" id="go-depth" style="width:100%;text-align:left"><div class="lbl" style="margin:0">Training depth <span style="color:var(--muted);font-weight:600">${tierEmoji(prog.depth)} ${esc(course.tiers[prog.depth].name)} · ${course.tiers[prog.depth].count} lines ›</span></div></button>
      ${commonPrefix > 0 ? `<div class="gi"><div class="lbl">Skip the shared start ${switchHtml('skipStart', prog.skipStart)}</div><div class="desc" style="margin-top:-4px">Every line opens ${esc(shared)}. Start each one where it branches off. Kicks in after your first finished line.</div></div>` : ''}
    </div>

    <div class="group-h"><b>Feel</b><span>Every course</span></div>
    <div class="group">
      <div class="gi"><div class="lbl">Haptics ${switchHtml('haptics', settings.haptics)}</div><div class="desc" style="margin-top:-4px">A light buzz for moves, mistakes and finished lines. No sounds, ever.</div></div>
      <div class="gi"><div class="lbl">Premoves ${switchHtml('premove', settings.premove)}</div><div class="desc" style="margin-top:-4px">Queue your next move while the opponent is moving. A wrong premove counts as a mistake.</div></div>
      <div class="gi"><div class="lbl">Confetti ${switchHtml('confetti', settings.confetti)}</div><div class="desc" style="margin-top:-4px">Plays when you finish a line.</div></div>
    </div>

    <div class="group-h"><b>Position</b><span></span></div>
    <div class="action-row">
      <button class="abtn" id="share-pos">🔗 Share this position</button>
      <button class="abtn" id="start-over">↺ Start over</button>
      <button class="abtn" id="mark-learned">✓ Mark course as learned</button>
      <button class="abtn danger" id="reset-course">Reset course progress</button>
    </div>`, (box, close) => {
    const refreshPill = () => { const p = $('#hap-pill'); if (p) p.outerHTML = hapticPill(); bindPill(); };
    const bindPill = () => { const p = $('#hap-pill'); if (p) p.onclick = () => { settings.haptics = !settings.haptics; saveSettings(settings); buzz('tap'); refreshPill(); const t = box.querySelector('[data-toggle=haptics]'); if (t) t.checked = settings.haptics; }; };
    bindPill();
    box.querySelectorAll('.tiles').forEach(g => g.querySelectorAll('.tile').forEach(b => b.onclick = () => {
      const key = g.dataset.key;
      settings[key] = b.dataset.v; saveSettings(settings); buzz('tap');
      g.querySelectorAll('.tile').forEach(x => x.classList.toggle('on', x === b));
      box.querySelector(`[data-desc="${key}"]`).textContent = (key === 'coach' ? COACH_DESC : ARROW_DESC)[b.dataset.v];
    }));
    box.querySelectorAll('[data-toggle]').forEach(inp => inp.onchange = () => {
      const k = inp.dataset.toggle;
      if (k in settings) { settings[k] = inp.checked; saveSettings(settings); if (k === 'evalBar') updateEval(S.chess.fen()); if (k === 'haptics') refreshPill(); }
      else { prog[k] = inp.checked; save(); }
      buzz('tap');
    });
    const pickSw = (attr, key) => box.querySelectorAll(`[data-${attr}]`).forEach(b => b.onclick = () => { settings[key] = b.dataset[attr]; saveSettings(settings); applyTheme(settings); buzz('tap'); box.querySelectorAll(`[data-${attr}]`).forEach(x => x.classList.toggle('on', x === b)); });
    pickSw('board', 'board'); pickSw('pieces', 'pieces'); pickSw('size', 'textSize');
    box.querySelector('#go-lines').onclick = () => { close(); openLinePopover($('#line-pick')); };
    box.querySelector('#go-help').onclick = () => { close(); openHelp(); };
    box.querySelector('#go-depth').onclick = () => { close(); openDepthSheet(false); };
    box.querySelector('#share-pos').onclick = () => {
      const url = new URL(location.href);
      url.search = new URLSearchParams({ course: courseId, line: S.lineIdx + 1, ply: S.view ?? S.ply }).toString();
      if (navigator.share && isPhone()) navigator.share({ title: course.title, url: url.href }).catch(() => {});
      else navigator.clipboard?.writeText(url.href).then(() => toast('Link copied'), () => prompt('Copy this link', url.href));
    };
    box.querySelector('#start-over').onclick = () => { close(); stopTimer(); if (['time', 'arena'].includes(S.mode)) switchMode(S.mode); else startLine(S.lineIdx, { startPly: S.mode === 'puzzles' ? S.startPly : undefined }); };
    box.querySelector('#mark-learned').onclick = () => {
      const main = lines.map((l, i) => i).filter(i => !lines[i].trap && !isDiscovered(i));
      if (!main.length) { toast('Every line is already learned'); return; }
      if (!confirm(`Mark ${main.length} lines of ${course.title} as learned? This unlocks Practice, Drill and the other modes. Trap lines stay in Learn.`)) return;
      const now = Date.now();
      for (const i of main) {
        prog.discovered[i] = now;
        // spread the first reviews over the next few days so Practice isn't flooded
        prog.srs[i] = { due: now + Math.random() * 4 * DAY, interval: 2, reps: 1, lapses: 0 };
      }
      prog.finishedAny = true; prog.depthChosen = true;
      prog.depth = course.tiers.length - 1;
      save(); renderModes(); close(); buzz('done');
      toast(`${main.length} lines marked as learned`);
      switchMode('drill');
    };
    box.querySelector('#reset-course').onclick = () => {
      if (!confirm(`Reset all progress for ${course.title}? This cannot be undone.`)) return;
      resetProgress(courseId); prog = getProgress(courseId); close(); S.mode = 'learn'; renderModes(); openDepthSheet(true);
    };
  }, { headExtra: hapticPill() });
}

function openHelp() {
  openSheet('Help', `<div class="help">
    <h4>📖 Learn</h4><p>The coach explains each move and marks it with an arrow; you play it on the board. Finishing a line "discovers" it.</p>
    <h4>🎯 Practice</h4><p>Spaced repetition: play discovered lines from memory. Perfect lines come back after 1, 2.5, 6… days; a mistake brings the line back in 10 minutes.</p>
    <h4>🔥 Drill</h4><p>Quizlet-style rounds of ~8 of your weakest lines. Get a line right and it's mastered; miss it and it comes back a couple of lines later and must be played clean twice. Finish the round when every line is mastered. Your progress in a round is saved.</p>
    <h4>⏳ Time</h4><p>A 3-minute sprint — one point per correct move, wrong moves cost 5 seconds.</p>
    <h4>🧩 Puzzles</h4><p>Drop into the middle of a line and find the repertoire move. Your puzzle rating moves like Elo.</p>
    <h4>⚔️ Arena</h4><p>Any line in your training depth, no help at all. Get through the opening perfectly to win rating.</p>
    <h4>Controls</h4><ul><li>Drag or tap pieces to move.</li><li>‹ › step back and forward through the moves played (or <b>←</b> <b>→</b>).</li><li>💡 Hint (or <b>H</b>) shows the move.</li></ul>
    <h4>Your data</h4><p>Progress is saved in this browser only. Nothing is sent anywhere.</p>
    <h4>About</h4><p>OpenReps is free and open source. Board by chessground, rules by chess.js, evaluation by Stockfish. Coach notes are original to this project.</p>
  </div>`);
}

$('#btn-settings').onclick = () => { buzz('tap'); openSettings(); };

// ---------------------------------------------------------------- study timer
startStudyTimer();
function paintTimer(active) {
  $('#time-today').textContent = fmtClock(timeStats().today);
  $('#time-pill').classList.toggle('paused', !active);
  const box = document.querySelector('#time-sheet');
  if (box) refreshStats(box);
}
onTimerTick(paintTimer);
paintTimer(true);
$('#time-pill').onclick = () => {
  buzz('tap');
  openSheet('Study time', `<div id="time-sheet">${statsHtml()}<p class="small-note">Counts only while this site is open, visible and in use. It pauses when you switch away or after 5 idle minutes.</p></div>`);
};
$('#mode-pick').onclick = e => { buzz('tap'); openModePopover(e.currentTarget); };
$('#btn-mode').onclick = e => { buzz('tap'); openModePopover(e.currentTarget); };
$('#line-pick').onclick = e => { buzz('tap'); openLinePopover(e.currentTarget); };

// ---------------------------------------------------------------- boot
renderModes();
const shareLine = +params.get('line');
if (shareLine >= 1 && shareLine <= lines.length) {
  const ply = Math.max(0, Math.min(+params.get('ply') || 0, lines[shareLine - 1].moves.length - 1));
  startLine(shareLine - 1, { startPly: ply });
} else if (params.get('mode') && MODES.some(m => m.id === params.get('mode') && !modeState(m).locked)) {
  switchMode(params.get('mode'));
} else {
  setCoach('', `<p>${esc(course.intro)}</p>`);
  if (!prog.depthChosen && course.tiers.length > 1) {
    resetBoardIdle();
    setPrompt(`Play the first move to begin.`, 'info');
    openDepthSheet(true);
  } else startLearn();
}

import { Chess } from '../vendor/chess.js';
import { listCourses, MASTERS } from './courses.js';
import { getProgress, getSettings, getCustomCourses, saveCustomCourses, resetProgress } from './store.js';
import { BOARDS, pieceUrl } from './theme.js';
import { expandPgn, toPgn } from './pgn.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const settings = getSettings();
const [light, dark] = BOARDS[settings.board] || BOARDS.default;

function miniBoard(moves, color) {
  const ch = new Chess();
  for (const m of moves) ch.move(m);
  let rows = ch.board();
  if (color === 'black') rows = rows.slice().reverse().map(r => r.slice().reverse());
  let h = '';
  rows.forEach((row, r) => row.forEach((sq, f) => {
    const isLight = (r + f) % 2 === 0;
    h += `<div style="background:${isLight ? light : dark}">${sq ? `<img src="${pieceUrl(settings.pieces, sq.color, sq.type.toUpperCase())}" alt="">` : ''}</div>`;
  }));
  return `<div class="mini-board">${h}</div>`;
}

async function card(c) {
  let lines, total;
  if (c.section === 'masters') {
    const data = (await import(`./courses/${c.id}.js`)).default;
    lines = data.lines.map(l => l.moves);
    total = lines.length;
  } else {
    lines = c.lines.map(l => expandPgn(l.pgn).lines[0]?.moves || []);
    total = lines.length;
  }
  // show the shared starting position
  let n = 0;
  while (lines.length && n < lines[0].length && lines.every(l => l[n] === lines[0][n])) n++;
  const p = getProgress(c.id);
  const disc = Object.keys(p.discovered).length;
  const due = Object.keys(p.discovered).filter(i => (p.srs[i]?.due ?? 0) <= Date.now()).length;
  const pct = total ? Math.round(disc / total * 100) : 0;
  const el = document.createElement('a');
  el.className = 'ccard';
  el.dataset.search = `${c.title} ${c.blurb || ''}`.toLowerCase();
  el.href = `train.html?course=${encodeURIComponent(c.id)}`;
  const segs = 3, filled = total ? disc / total * segs : 0;
  const bar = Array.from({ length: segs }, (_, i) => `<i><b style="width:${Math.max(0, Math.min(1, filled - i)) * 100}%"></b></i>`).join('');
  el.innerHTML = `
    <div class="thumb">${miniBoard(lines[0]?.slice(0, Math.max(1, n)) || [], c.color)}</div>
    <div class="info">
      <h3>${esc(c.title)}</h3>
      <span class="side">${c.color === 'white' ? '<b class="w">WHITE</b>' : '<b>BLACK</b>'} ${c.section === 'custom' ? 'Your course' : 'Masters course'}</span>
      <p>${esc(c.blurb || toPgn((lines[0] || []).slice(0, n)))}</p>
      <span class="count">${total} lines${disc ? ` · ${disc} discovered` : ''}${due ? ` · ${due} due` : ''}</span>
      <div class="segbar">${bar}</div>
      <span class="go">${disc ? 'Continue' : 'Try the first line'} <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
    </div>`;
  if (c.section === 'custom') {
    const del = document.createElement('button');
    del.className = 'del'; del.textContent = 'Delete';
    del.onclick = e => {
      e.preventDefault();
      if (!confirm(`Delete "${c.title}"?`)) return;
      saveCustomCourses(getCustomCourses().filter(x => x.id !== c.id));
      resetProgress(c.id);
      render();
    };
    el.appendChild(del);
  }
  return el;
}

async function render() {
  const all = listCourses();
  for (const [sec, box] of [['masters', $('#masters')], ['custom', $('#custom')]]) {
    box.innerHTML = '';
    const list = all.filter(c => c.section === sec);
    if (!list.length) box.innerHTML = '<p style="color:var(--muted);margin:0 2px">No imported courses yet — paste some PGN below.</p>';
    for (const c of list) box.appendChild(await card(c));
  }
}

$('#imp-go').onclick = () => {
  const title = $('#imp-title').value.trim() || 'My course';
  const color = $('#imp-color').value;
  const { lines, errors } = expandPgn($('#imp-pgn').value);
  const msg = $('#imp-msg');
  if (!lines.length) { msg.textContent = errors[0] || 'No moves found.'; msg.style.color = '#ff9b91'; return; }
  const course = {
    id: 'custom-' + Date.now().toString(36),
    title, color,
    lines: lines.map(l => ({ name: l.name || '', pgn: toPgn(l.moves) })),
  };
  saveCustomCourses([...getCustomCourses(), course]);
  msg.style.color = 'var(--accent-2)';
  msg.textContent = `Created "${title}" with ${lines.length} lines${errors.length ? ` (${errors.length} skipped: ${errors[0]})` : ''}.`;
  $('#imp-pgn').value = '';
  render();
};

void MASTERS;
$('#q').oninput = () => {
  const q = $('#q').value.trim().toLowerCase();
  document.querySelectorAll('.ccard').forEach(c => { c.style.display = !q || c.dataset.search.includes(q) ? '' : 'none'; });
};
render();

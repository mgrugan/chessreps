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
  el.className = 'card';
  el.href = `train.html?course=${encodeURIComponent(c.id)}`;
  el.innerHTML = `
    <div class="thumb"><span class="side">${c.color === 'white' ? '♔ White' : '♚ Black'}</span><div class="mini">${miniBoard(lines[0]?.slice(0, Math.max(1, n)) || [], c.color)}</div></div>
    <div class="body">
      <h3>${esc(c.title)}</h3>
      <p>${esc(c.blurb || toPgn((lines[0] || []).slice(0, n)))}</p>
      <div class="meta"><span>${total} lines · ${disc} discovered${due ? ` · ${due} due` : ''}</span><span>${pct}%</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
    </div>`;
  if (c.section === 'custom') {
    const del = document.createElement('button');
    del.className = 'btn small danger'; del.textContent = 'Delete';
    del.style.cssText = 'position:absolute;top:8px;right:8px';
    del.onclick = e => {
      e.preventDefault();
      if (!confirm(`Delete "${c.title}"?`)) return;
      saveCustomCourses(getCustomCourses().filter(x => x.id !== c.id));
      resetProgress(c.id);
      render();
    };
    el.querySelector('.thumb').appendChild(del);
  }
  return el;
}

async function render() {
  const all = listCourses();
  for (const [sec, box] of [['masters', $('#masters')], ['custom', $('#custom')]]) {
    box.innerHTML = '';
    const list = all.filter(c => c.section === sec);
    if (!list.length) box.innerHTML = '<p style="color:var(--muted);margin:0">No imported courses yet — paste some PGN below.</p>';
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
render();

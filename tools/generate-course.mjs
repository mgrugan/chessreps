// Builds a repertoire from the Lichess opening explorer + a local Stockfish check.
//
//   node tools/generate-course.mjs --id caro-counter --title "Counter the Caro-Kann" \
//        --color white --start "e4 c6" --reach 0.012 --maxply 22
//
// Our moves: the most-played master move whose engine eval is within --tol cp of the
// engine's best. Opponent moves: every reply that is common in master games OR in
// club games (Lichess 1600-2000), followed while the chance of reaching the position
// stays above --reach. Writes data/<id>.txt (one line per row) for build-courses.
import { Chess } from '../vendor/chess.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map(s => {
  const [k, ...v] = s.trim().split(' ');
  return [k, v.join(' ').replace(/^"|"$/g, '')];
}));
const ID = args.id, COLOR = args.color || 'white';
const START = (args.start || '').split(/\s+/).filter(Boolean);
const REACH = +(args.reach || 0.012);   // min probability (product of opponent move shares) to keep a branch
const MINSHARE = +(args.min || 0.06);   // min share for an opponent reply
const MAXPLY = +(args.maxply || 22);
const TOL = +(args.tol || 60);          // cp tolerance vs engine best for our moves
const RATINGS = args.ratings || '1600,1800,2000';
const ENGINE = args.engine || '/usr/games/stockfish';
const DEPTH = +(args.depth || 18);
const CLUB = 'club' in args;            // club data needs a Lichess token (LICHESS_TOKEN)
if (!ID) { console.error('need --id'); process.exit(1); }

// ---------------------------------------------------------------- explorer (cached, polite)
const CACHE_FILE = 'tools/.explorer-cache.json';
const cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {};
let lastReq = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// the explorer writes castling as king-takes-rook (e1h1); convert to standard UCI (e1g1)
function normalizeCastling(j) {
  for (const m of j.moves || []) {
    if (m.san === 'O-O') m.uci = m.uci.slice(0, 2) + 'g' + m.uci[1];
    else if (m.san === 'O-O-O') m.uci = m.uci.slice(0, 2) + 'c' + m.uci[1];
  }
  return j;
}
const EMPTY = { white: 0, draws: 0, black: 0, moves: [] };
async function explorer(db, uciMoves) {
  if (db === 'lichess' && !CLUB) return EMPTY;
  const play = uciMoves.join(',');
  const url = db === 'masters'
    ? `https://explorer.lichess.ovh/masters?play=${play}&moves=15&topGames=0`
    : `https://explorer.lichess.ovh/lichess?variant=standard&speeds=blitz,rapid,classical&ratings=${RATINGS}&play=${play}&moves=15&topGames=0&recentGames=0`;
  if (cache[url]) return normalizeCastling(cache[url]);
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = lastReq + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    lastReq = Date.now();
    const headers = { 'User-Agent': 'openreps-course-builder' };
    if (process.env.LICHESS_TOKEN) headers.Authorization = 'Bearer ' + process.env.LICHESS_TOKEN;
    const res = await fetch(url, { headers });
    if (res.status === 429) { console.error('rate limited, waiting 60s'); await sleep(60000); continue; }
    if (res.status === 401) { console.error('401: this database needs a Lichess token'); return EMPTY; }
    if (!res.ok) { console.error('HTTP', res.status, url); await sleep(3000); continue; }
    const j = await res.json();
    normalizeCastling(j);
    cache[url] = j;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
    return j;
  }
  throw new Error('explorer failed: ' + url);
}
const total = m => m.white + m.draws + m.black;

// ---------------------------------------------------------------- engine
const sf = spawn(ENGINE);
let out = '';
sf.stdout.on('data', d => { out += d; });
const send = s => sf.stdin.write(s + '\n');
async function waitFor(re) { while (!re.test(out)) await sleep(10); }
send('uci'); send('setoption name Threads value 2'); send('setoption name Hash value 128'); send('setoption name MultiPV value 6'); send('isready');
await waitFor(/readyok/);
// returns Map uci -> cp (side to move's perspective), best first
async function analyse(uciMoves, searchmoves) {
  out = '';
  send(`position startpos moves ${uciMoves.join(' ')}`);
  send(`go depth ${DEPTH}${searchmoves ? ' searchmoves ' + searchmoves.join(' ') : ''}`);
  await waitFor(/bestmove/);
  const res = new Map();
  for (const line of out.split('\n')) {
    const m = line.match(new RegExp(`^info depth ${DEPTH} .*multipv (\\d+) score (cp|mate) (-?\\d+).* pv (\\S+)`));
    if (m) res.set(m[4], m[2] === 'mate' ? (+m[3] > 0 ? 10000 : -10000) : +m[3]);
  }
  return res;
}

// ---------------------------------------------------------------- tree walk
const OURS = COLOR === 'white' ? 0 : 1;
const lines = [];
const log = (...a) => console.error(...a);

function sanLine(uci) {
  const ch = new Chess();
  return uci.map(u => ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
}
function toUci(sans) {
  const ch = new Chess();
  return sans.map(s => { const m = ch.move(s); return m.from + m.to + (m.promotion || ''); });
}

async function ourMove(uci) {
  const [ma, li] = [await explorer('masters', uci), await explorer('lichess', uci)];
  const base = total(ma) >= 40 ? ma : li;
  const cands = base.moves.filter(m => total(m) >= Math.max(5, total(base) * 0.03)).sort((a, b) => total(b) - total(a));
  const ev = await analyse(uci);
  const best = Math.max(...ev.values());
  for (const c of cands.slice(0, 6)) {
    let cp = ev.get(c.uci);
    if (cp === undefined) cp = (await analyse(uci, [c.uci])).get(c.uci);
    if (cp !== undefined && cp >= best - TOL) return { uci: c.uci, why: `${total(c)} games, eval ${cp}` };
  }
  const top = [...ev.keys()][0];
  return { uci: top, why: 'engine choice' };
}

async function walk(uci, reach) {
  const ply = uci.length;
  if ((ply % 2) === OURS) {
    const mv = await ourMove(uci);
    if (ply >= MAXPLY) { lines.push([...uci, mv.uci]); return; }
    log(`${'  '.repeat(ply / 2)}${sanLine([...uci, mv.uci]).slice(-1)[0]}  (${mv.why})`);
    return walk([...uci, mv.uci], reach);
  }
  // opponent to move: collect common replies from both databases
  const [ma, li] = [await explorer('masters', uci), await explorer('lichess', uci)];
  const tm = total(ma), tl = total(li);
  if (ply >= MAXPLY || (tm < 15 && tl < 150)) { lines.push(uci); return; }
  const share = new Map();
  for (const [db, t] of [[ma, tm], [li, tl]]) {
    if (t < 15) continue;
    for (const m of db.moves) share.set(m.uci, Math.max(share.get(m.uci) || 0, total(m) / t));
  }
  const replies = [...share].filter(([, s]) => s >= MINSHARE && reach * s >= REACH).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!replies.length) { lines.push(uci); return; }
  for (const [r, s] of replies) {
    log(`${'  '.repeat(ply / 2)}..${sanLine([...uci, r]).slice(-1)[0]}  ${(s * 100).toFixed(0)}%`);
    await walk([...uci, r], reach * s);
  }
}

await walk(toUci(START), 1);
send('quit');

// write data file (PGN per row)
const rows = lines.map(u => {
  const sans = sanLine(u);
  return sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + s).join(' ');
});
fs.writeFileSync(`data/${ID}.txt`, rows.join('\n') + '\n');
console.log(`wrote data/${ID}.txt with ${rows.length} lines`);

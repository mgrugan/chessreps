// Small PGN helpers: parse movetext (with nested variations) into a list of lines.
import { Chess } from '../vendor/chess.js';

function tokenize(text) {
  const clean = text
    .replace(/\{[^}]*\}/g, ' ')         // comments
    .replace(/;[^\n]*/g, ' ')           // line comments
    .replace(/\$\d+/g, ' ')             // NAGs
    .replace(/\[[^\]]*\]/g, ' ');       // headers
  const toks = [];
  const re = /(\()|(\))|([^\s()]+)/g;
  let m;
  while ((m = re.exec(clean))) {
    if (m[1]) toks.push('(');
    else if (m[2]) toks.push(')');
    else {
      let t = m[3];
      if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) continue;
      t = t.replace(/^\d+\.+/, '').replace(/[!?]+$/, '');
      if (!t || /^\d+\.*$/.test(t)) continue;
      toks.push(t);
    }
  }
  return toks;
}

// Parses simple movetext (no variations). Returns { moves: SAN[], error }.
export function parseMoves(text) {
  const ch = new Chess();
  const moves = [];
  for (const t of tokenize(text)) {
    if (t === '(' || t === ')') return { moves, error: 'Variations not allowed here' };
    try { moves.push(ch.move(t.replace(/0/g, 'O')).san); }
    catch { return { moves, error: `Illegal move "${t}" after ${moves.length} plies` }; }
  }
  return { moves, error: null };
}

// Expands PGN text (one or many games, optional nested variations) into every
// root-to-leaf line. Returns { lines: [{name, moves}], errors: [] }.
export function expandPgn(text) {
  const games = text.split(/\n\s*\n(?=\s*\[)|\n(?=\[Event )/).map(s => s.trim()).filter(Boolean);
  const out = [], errors = [];
  for (const g of games.length ? games : [text]) {
    const nameMatch = g.match(/\[(?:ChapterName|Event|White)\s+"([^"]*)"\]/);
    const baseName = nameMatch && !/^\?+$/.test(nameMatch[1]) ? nameMatch[1] : '';
    const movetext = g.replace(/\[[^\]]*\]/g, ' ');
    // a block of plain lines (one line per row, no headers) — treat each row separately
    const rows = movetext.split('\n').map(r => r.trim()).filter(Boolean);
    const plain = !/\[/.test(g) && rows.length > 1 && rows.every(r => !/[()]/.test(r));
    const chunks = plain ? rows : [movetext];
    for (const chunk of chunks) {
      let name = baseName;
      let body = chunk;
      const pipe = chunk.indexOf('|');
      if (pipe > -1) { name = chunk.slice(0, pipe).trim(); body = chunk.slice(pipe + 1); }
      const toks = tokenize(body);
      const leaves = [];
      // recursive walk; each frame keeps the move list up to the current point
      const walk = (start, prefix) => {
        const ch = new Chess();
        for (const m of prefix) ch.move(m);
        let line = [...prefix];
        let i = start;
        let lastBefore = null; // prefix before the last move, for variations
        while (i < toks.length) {
          const t = toks[i];
          if (t === '(') {
            // find matching ')'
            let depth = 1, j = i + 1;
            while (j < toks.length && depth) { if (toks[j] === '(') depth++; else if (toks[j] === ')') depth--; j++; }
            if (lastBefore) walkTokens(toks.slice(i + 1, j - 1), lastBefore);
            i = j;
            continue;
          }
          if (t === ')') { i++; continue; }
          try {
            lastBefore = [...line];
            line.push(ch.move(t.replace(/0/g, 'O')).san);
          } catch {
            errors.push(`Illegal move "${t}" after ${line.join(' ') || 'start'}`);
            break;
          }
          i++;
        }
        if (line.length) leaves.push({ name, moves: line });
      };
      const walkTokens = (sub, prefix) => {
        const saved = toks.splice(0, toks.length, ...sub);
        walk(0, prefix);
        toks.splice(0, toks.length, ...saved);
      };
      walk(0, []);
      out.push(...leaves);
    }
  }
  // drop duplicates and lines that are strict prefixes of other lines
  const keys = out.map(l => l.moves.join(' '));
  const lines = out.filter((l, i) => {
    const k = keys[i];
    if (keys.indexOf(k) !== i) return false;
    return !keys.some((o, j) => j !== i && o.length > k.length && o.startsWith(k + ' '));
  });
  return { lines, errors };
}

export function toPgn(moves, startPly = 0) {
  let s = '';
  moves.forEach((m, i) => {
    const ply = startPly + i;
    if (ply % 2 === 0) s += `${ply / 2 + 1}. `;
    else if (i === 0) s += `${Math.floor(ply / 2) + 1}... `;
    s += m + ' ';
  });
  return s.trim();
}

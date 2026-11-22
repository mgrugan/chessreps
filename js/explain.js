// Generates a plain-language description of a move, used for the prompt
// ("Play knight to f3.") and as a fallback note when a move has no coach note.
import { Chess } from '../vendor/chess.js';

const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

export function promptFor(move) {
  if (move.san.startsWith('O-O-O')) return 'Castle queenside.';
  if (move.san.startsWith('O-O')) return 'Castle kingside.';
  const p = NAMES[move.piece];
  if (move.captured) return `Take the ${NAMES[move.captured]} on ${move.to} with your ${p}.`;
  return `Play ${p} to ${move.to}.`;
}

function attackedBy(ch, square, color) {
  try { return ch.attackers(square, color); } catch { return []; }
}

// fen: position BEFORE the move. Returns a sentence or two.
export function autoExplain(fen, san) {
  const ch = new Chess(fen);
  const mover = ch.turn();
  const enemy = mover === 'w' ? 'b' : 'w';
  let mv;
  try { mv = ch.move(san); } catch { return ''; }
  const bits = [];
  const piece = NAMES[mv.piece];
  const moveNo = `${ch.moveNumber() - (mover === 'b' ? 1 : 0)}${mover === 'w' ? '.' : '...'}${mv.san}`;

  if (mv.san.startsWith('O-O')) {
    bits.push(`${moveNo} castles, tucking the king into safety and bringing the rook toward the centre.`);
  } else if (mv.captured) {
    bits.push(`${moveNo} captures the ${NAMES[mv.captured]} on ${mv.to}.`);
    const defenders = attackedBy(ch, mv.to, enemy);
    if (!defenders.length && VALUE[mv.captured] < 100) bits.push('The capturing piece cannot be taken back, so this wins material or restores the balance.');
  } else if (mv.piece === 'p' && ['d', 'e'].includes(mv.to[0])) {
    bits.push(`${moveNo} claims space in the centre with the ${mv.to[0]}-pawn.`);
  } else if (mv.piece === 'p' && ['c', 'f'].includes(mv.to[0])) {
    bits.push(`${moveNo} uses the ${mv.to[0]}-pawn to fight for the central squares.`);
  } else if (mv.piece === 'p' && ['h', 'g', 'a', 'b'].includes(mv.to[0])) {
    bits.push(`${moveNo} is a flank pawn move — it gains space or takes squares away from enemy pieces.`);
  } else if (['n', 'b'].includes(mv.piece) && (mv.from[1] === '1' || mv.from[1] === '8')) {
    bits.push(`${moveNo} develops the ${piece} to an active square.`);
  } else {
    bits.push(`${moveNo} repositions the ${piece} to ${mv.to}.`);
  }

  if (ch.isCheckmate()) bits.push('It is checkmate!');
  else if (ch.isCheck()) bits.push('It comes with check, so the opponent must respond to the threat to the king.');

  // threats: enemy pieces the moved piece now attacks that are undefended or worth more
  const targets = [];
  const board = ch.board();
  for (const row of board) for (const sq of row) {
    if (!sq || sq.color !== enemy || sq.type === 'k') continue;
    const att = attackedBy(ch, sq.square, mover);
    if (!att.includes(mv.to)) continue;
    const def = attackedBy(ch, sq.square, enemy);
    if (VALUE[sq.type] > VALUE[mv.piece] || def.length === 0) targets.push(sq);
  }
  if (targets.length && !ch.isCheckmate()) {
    const t = targets.sort((a, b) => VALUE[b.type] - VALUE[a.type]).slice(0, 2).map(s => `the ${NAMES[s.type]} on ${s.square}`);
    bits.push(`It also attacks ${t.join(' and ')}.`);
  }
  return bits.join(' ');
}

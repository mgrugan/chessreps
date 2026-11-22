// Course registry: built-in "Masters" courses plus courses the user imports from PGN.
import { getCustomCourses } from './store.js';
import { parseMoves } from './pgn.js';

export const MASTERS = [
  {
    id: 'italian', title: 'The Italian Game', color: 'white', noteParts: ['italian-a', 'italian-b'],
    blurb: '1.e4 e5 2.Nf3 Nc6 3.Bc4 — the Giuoco Piano with 4.c3 & d4, the Two Knights with 4.Ng5, and every Black sideline.',
    fallbackIntro: 'We play the Italian Game as White, aiming our bishop at f7 and building a big centre with c3 and d4.',
  },
  {
    id: 'caro-kann', title: 'The Caro-Kann', color: 'black', noteParts: ['caro-kann'],
    blurb: '1.e4 c6 — a rock-solid repertoire for Black against the Advance, Exchange, Classical, Panov, Fantasy and all the sidelines.',
    fallbackIntro: 'We answer 1.e4 with the Caro-Kann: support ...d5 with ...c6 and get a solid, healthy position.',
  },
  {
    id: 'alapin', title: 'Alapin Sicilian', color: 'white', noteParts: ['alapin-a', 'alapin-b'],
    blurb: '1.e4 c5 2.c3 — skip the open Sicilian jungle, build a full pawn centre and gain space against every Black setup.',
    fallbackIntro: 'Against the Sicilian we play 2.c3, preparing d4 so we can recapture with a pawn and keep a strong centre.',
  },
  {
    id: 'scandinavian', title: 'Counter the Scandinavian', color: 'white', noteParts: ['scandinavian'],
    blurb: '1.e4 d5 2.exd5 — punish the early queen with fast development, and beat 2...Nf6 and the 2...c6 gambit.',
    fallbackIntro: 'Against the Scandinavian we take on d5 and use the time Black spends with the queen to develop quickly.',
  },
  {
    id: 'french', title: 'Counter the French', color: 'white', noteParts: ['french'],
    blurb: '1.e4 e6 2.d4 d5 3.Nc3 — the Steinitz with 5.f4, the Winawer with Qg4, and answers to every Rubinstein and sideline.',
    fallbackIntro: 'Against the French we play 3.Nc3 and grab space, aiming our pieces at Black\'s kingside.',
  },
];

export function listCourses() {
  return [
    ...MASTERS.map(m => ({ ...m, section: 'masters' })),
    ...getCustomCourses().map(c => ({ ...c, section: 'custom' })),
  ];
}

// Breadth-first round-robin ordering so the first N lines cover as many different
// opponent replies as possible (used for the "training depth" tiers).
function spreadOrder(idxs, lines, depth = 0) {
  if (idxs.length <= 1) return idxs;
  const groups = new Map();
  for (const i of idxs) {
    const key = lines[i].moves[depth] ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  if (groups.size === 1) {
    const only = [...groups.values()][0];
    if (only.every(i => lines[i].moves.length <= depth)) return only;
    return spreadOrder(only, lines, depth + 1);
  }
  const ordered = [...groups.values()].map(g => spreadOrder(g, lines, depth + 1));
  const out = [];
  for (let k = 0; out.length < idxs.length; k++) for (const g of ordered) if (k < g.length) out.push(g[k]);
  return out;
}

async function loadNotes(parts) {
  const merged = { intro: '', lineNames: {}, notes: {} };
  for (const p of parts) {
    try {
      const mod = (await import(`./notes/${p}.js`)).default;
      if (mod.intro && !merged.intro) merged.intro = mod.intro;
      Object.assign(merged.lineNames, mod.lineNames || {});
      Object.assign(merged.notes, mod.notes || {});
    } catch (e) { console.warn('notes missing', p, e); }
  }
  return merged;
}

export async function loadCourse(id) {
  const master = MASTERS.find(m => m.id === id);
  let base, notes;
  if (master) {
    base = (await import(`./courses/${id}.js`)).default;
    notes = await loadNotes(master.noteParts);
    base = { ...base, blurb: master.blurb, intro: notes.intro || master.fallbackIntro, section: 'masters' };
  } else {
    const c = getCustomCourses().find(x => x.id === id);
    if (!c) throw new Error('Course not found');
    base = {
      ...c,
      lines: c.lines.map(l => ({ name: l.name, moves: parseMoves(l.pgn).moves })),
      tiers: [{ name: 'Full course', count: c.lines.length, sub: 'Every line' }],
      intro: c.intro || 'Your own imported course.',
      section: 'custom',
    };
    notes = { lineNames: {}, notes: c.notes || {} };
  }
  base.lines = base.lines.map((l, i) => ({
    ...l,
    name: l.name || notes.lineNames[String(i + 1)] || '',
  }));
  base.notes = notes.notes;
  base.order = spreadOrder(base.lines.map((_, i) => i), base.lines);
  return base;
}

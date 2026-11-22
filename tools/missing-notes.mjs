// Lists tree nodes of a course that have no coach note yet.
//   node tools/missing-notes.mjs italian            -> all nodes without a note
//   node tools/missing-notes.mjs italian --traps    -> only nodes on trap lines
import { pathToFileURL } from 'node:url';
import { MASTERS } from '../js/courses.js';
const id = process.argv[2], onlyTraps = process.argv.includes('--traps');
const c = (await import(pathToFileURL(`js/courses/${id}.js`))).default;
const m = MASTERS.find(x => x.id === id);
const notes = {};
for (const p of [...(m?.noteParts || []), `${id}-traps`]) {
  try { Object.assign(notes, (await import(pathToFileURL(`js/notes/${p}.js`))).default.notes); } catch {}
}
const ours = c.color === 'white' ? 0 : 1, kids = new Map(), seen = new Set();
c.lines.forEach(l => l.moves.forEach((_, i) => { const p = l.moves.slice(0, i).join(' '); if (!kids.has(p)) kids.set(p, new Set()); kids.get(p).add(l.moves[i]); }));
c.lines.forEach((l, li) => {
  if (onlyTraps && !l.trap) return;
  l.moves.forEach((mv, i) => {
    const k = l.moves.slice(0, i + 1).join(' ');
    if (seen.has(k) || notes[k]) return; seen.add(k);
    const tag = i % 2 === ours ? 'OURS' : kids.get(l.moves.slice(0, i).join(' ')).size > 1 ? 'THEIR-BRANCH' : 'THEIRS';
    console.log(`${tag}\tline ${li + 1}\t${k}`);
  });
});

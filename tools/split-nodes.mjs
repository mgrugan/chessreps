import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const parts = {
  'italian-a': ['italian', l => l >= 2 && l <= 44],
  'italian-b': ['italian', l => !(l >= 2 && l <= 44)],
  'alapin-a': ['alapin', l => (l <= 13) || (l >= 25 && l <= 33) || l >= 44],
  'alapin-b': ['alapin', l => (l >= 14 && l <= 24) || (l >= 34 && l <= 43)],
  'caro-kann': ['caro-kann', () => true],
};
const assigned = new Set();
for (const [part, [cid, pred]] of Object.entries(parts)) {
  const c = (await import(pathToFileURL(`js/courses/${cid}.js`))).default;
  const ours = c.color === 'white' ? 0 : 1;
  const kids = new Map(), rows = [];
  const all = new Set();
  c.lines.forEach(l => l.moves.forEach((m, i) => all.add(l.moves.slice(0, i + 1).join(' '))));
  for (const k of all) { const p = k.split(' ').slice(0, -1).join(' '); kids.set(p, (kids.get(p) || 0) + 1); }
  const seen = new Set();
  c.lines.forEach((l, li) => {
    if (!pred(li + 1)) return;
    l.moves.forEach((m, i) => {
      const k = l.moves.slice(0, i + 1).join(' ');
      if (seen.has(k) || assigned.has(cid + k)) return;
      seen.add(k); assigned.add(cid + k);
      const p = k.split(' ').slice(0, -1).join(' ');
      const tag = i % 2 === ours ? 'OURS' : kids.get(p) > 1 ? 'THEIR-BRANCH' : 'THEIRS';
      rows.push(`${tag}\t${k}`);
    });
  });
  const lineList = c.lines.map((l, i) => pred(i + 1) ? `${i + 1}\t${l.moves.join(' ')}` : null).filter(Boolean);
  fs.writeFileSync(`tools/nodes/${part}.txt`, `# Course: ${c.title} (we play ${c.color})\n# LINES\n${lineList.join('\n')}\n# NODES (tag<TAB>space-separated SAN path from the start; the note explains the LAST move)\n${rows.join('\n')}\n`);
  console.log(part, rows.length, rows.filter(r => r.startsWith('OURS')).length);
}

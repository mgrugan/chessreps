# OpenReps: a free chess opening trainer

A static site you can host on GitHub Pages. You learn an opening repertoire move by move with a coach note for every move, then keep it in memory with spaced-repetition practice.

## Courses ("Masters")

| Course | Side | Lines | Training depths |
| --- | --- | --- | --- |
| The Italian Game | White | 122 | Essentials 30 · Advanced 60 · Full Mastery 122 |
| The Caro-Kann | Black | 30 | Essentials 19 · Full Mastery 30 |
| Alapin Sicilian | White | 57 | Essentials 20 · Full Mastery 57 |
| Counter the Scandinavian | White | 38 | Essentials 12 · Full Mastery 38 |
| Counter the French | White | 30 | Essentials 12 · Full Mastery 30 |
| O'Kelly Sicilian | Black | 30 | Essentials 16 · Full Mastery 30 |
| Sicilian Kan | Black | 52 | Essentials 25 · Full Mastery 52 |
| Counter the Caro-Kann (generated) | White | 27 + 8 traps | Essentials 12 · Full Mastery 27 |
| Counter the Sicilian: Open (generated) | White | 28 + 10 traps | Essentials 12 · Full Mastery 28 |

The Italian (9), Alapin (10), Scandinavian (8) and French (10) courses also have **trap lines**: a natural opponent mistake and the winning punishment, each checked with Stockfish. Traps are part of every training depth.

## Generating new courses

`tools/generate-course.mjs` builds a repertoire from the Lichess masters explorer and checks it with Stockfish (`apt install stockfish`):

```bash
node tools/generate-course.mjs --id caro-counter --color white --start "e4 c6" --reach 0.012 --maxply 22
```

For your moves it picks the most-played master move within 0.6 pawns of the engine's best. For the opponent it follows every reply with at least a 6% share while the chance of reaching that position stays above `--reach`. Add `--club` with a `LICHESS_TOKEN` to also include replies common in 1600–2000 Lichess games.

You can also **import your own course** from the home page. It accepts one line per row, a multi-game PGN, or a study with nested variations. Imported courses are saved in your browser.

## Training modes

- **Learn**: the coach explains each move, an arrow shows it, and you play it on the board. Finishing a line "discovers" it.
- **Practice**: spaced repetition. A line you play perfectly comes back after 1, 2.5, 6… days. A mistake brings it back in 10 minutes.
- **Drill**: random discovered lines, counting a streak of perfect lines.
- **Time**: a 3-minute sprint. Each correct move scores a point, and each wrong move costs 5 seconds.
- **Puzzles**: you start in the middle of a line and find the repertoire move. You get an Elo-style rating.
- **Arena**: you play any line in your depth with no help. A perfect opening wins rating.

The settings match the original layout: coach notes (Auto / Every move / On tap), arrows (Off / With notes / Always), a Stockfish evaluation bar that runs locally, 5 board colours, 2 piece sets, coach text size, training depth, "skip the shared start", confetti and haptics (vibration on Android, the system haptic tick on iOS 18+). The app makes no sounds. They also include share position, start over and reset course progress. The **Select Line** dialog lists every line with its name, its status and the full PGN, and it can copy all lines as PGN.

## Run locally

Any static server works, for example:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Deploy to GitHub Pages

1. Go to the repository's **Settings → Pages**.
2. Under *Build and deployment*, choose **Deploy from a branch**.
3. Pick the branch and the `/ (root)` folder, then click Save.
4. The site will be at `https://<user>.github.io/chessreps/` in about a minute.

## Editing course content

- Lines live in `data/*.txt`, one line per row (`Name|1. e4 ...` sets a name). After editing them, run `node tools/build-courses.mjs` to validate the lines and regenerate `js/courses/*.js`.
- Coach notes live in `js/notes/*.js`. Each note is keyed by the move path from the start, for example `"e4 e5 Nf3 Nc6 Bc4"` explains 3.Bc4. A move with no note gets a generated explanation instead.

## Credits and licences

- Board: [chessground](https://github.com/lichess-org/chessground) (GPL-3.0)
- Move rules: [chess.js](https://github.com/jhlywa/chess.js) (BSD-2)
- Engine: [stockfish.js](https://github.com/nmrugg/stockfish.js) (GPL-3.0)
- Pieces: cburnett (GPL-2+) and Staunty by sadsnake1 (CC BY-NC-SA 4.0), both taken from Lichess.

The coach notes were written for this project.

Because it bundles GPL components, this project is distributed under the GPL-3.0.

// Board colours and piece sets.
export const BOARDS = {
  default: ['#ecd8b4', '#c6a174', 'Default'],
  lichess: ['#f0d9b5', '#b58863', 'Lichess'],
  green: ['#eeeed2', '#769656', 'Green'],
  blue: ['#dee3e6', '#8ca2ad', 'Blue'],
  darkblue: ['#c5d1dc', '#4a6a8a', 'Dark Blue'],
};
export const PIECE_SETS = { cburnett: 'Lichess', staunty: 'Staunty' };

const ROLE = { king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N', pawn: 'P' };
export function pieceUrl(set, color, role) { // color: 'w'|'b', role letter
  return new URL(`../vendor/pieces/${set}/${color}${role}.svg`, import.meta.url).href;
}

export function applyTheme(settings) {
  const [light, dark] = BOARDS[settings.board] || BOARDS.default;
  const root = document.documentElement.style;
  root.setProperty('--light-sq', light);
  root.setProperty('--dark-sq', dark);
  root.setProperty('--coach-size', { default: '16px', large: '18.5px', xl: '21px' }[settings.textSize] || '16px');
  let style = document.getElementById('piece-css');
  if (!style) { style = document.createElement('style'); style.id = 'piece-css'; document.head.appendChild(style); }
  let css = '';
  for (const [role, letter] of Object.entries(ROLE)) {
    for (const [color, c] of [['white', 'w'], ['black', 'b']]) {
      css += `.cg-wrap piece.${role}.${color}{background-image:url("${pieceUrl(settings.pieces, c, letter)}")}\n`;
    }
  }
  style.textContent = css;
}

export default {
  lineNames: {},
  notes: {
    // Steinitz 7...Qb6: 14...Re8??
    "e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4 c5 Nf3 Nc6 Be3 Qb6 Na4 Qa5+ c3 cxd4 b4 Qc7 Nxd4 Nxd4 Bxd4 Be7 Bd3 O-O Qh5 Re8": "14...Re8?? looks like a sensible defence, freeing f8 so the knight can come to f8 and guard h7. But it is far too slow: h7 is attacked twice right now and Black had to play 14...g6. With the rook gone from f8, the king also loses its last flight square.",
    "e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4 c5 Nf3 Nc6 Be3 Qb6 Na4 Qa5+ c3 cxd4 b4 Qc7 Nxd4 Nxd4 Bxd4 Be7 Bd3 O-O Qh5 Re8 Qxh7+": "15.Qxh7+ takes the pawn with check, backed by the bishop on d3. The king has only one square to go to.",
    "e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4 c5 Nf3 Nc6 Be3 Qb6 Na4 Qa5+ c3 cxd4 b4 Qc7 Nxd4 Nxd4 Bxd4 Be7 Bd3 O-O Qh5 Re8 Qxh7+ Kf8 Qh8#": "16.Qh8# is mate. The king on f8 is boxed in by its own rook on e8, bishop on e7 and the f7 and g7 pawns, while the queen covers g8.",

    // Steinitz 6...cxd4: 10...b6?
    "e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4 c5 Nf3 cxd4 Nxd4 Nc6 Be3 Bc5 Qd2 O-O O-O-O b6": "10...b6? is a natural plan, getting ready to develop the bishop to b7 and support the c5 bishop. The problem is that the b7 pawn was the only defender of the knight on c6, which sits right in front of our d4 knight.",
    "e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4 c5 Nf3 cxd4 Nxd4 Nc6 Be3 Bc5 Qd2 O-O O-O-O b6 Nxc6": "11.Nxc6 simply wins a knight, and it does so with an attack on the queen on d8, so Black has no time to make threats of his own.",
    "e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4 c5 Nf3 cxd4 Nxd4 Nc6 Be3 Bc5 Qd2 O-O O-O-O b6 Nxc6 Qc7 Nd4": "12.Nd4 brings the knight safely back to its strong central square. White is a clean piece up and keeps the usual kingside space advantage.",

    // Steinitz 7...Be7: 13...Bb7? Greek gift
    "e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4 c5 Nf3 Nc6 Be3 Be7 Qd2 O-O dxc5 Nxc5 O-O-O a6 Kb1 b5 Bxc5 Bxc5 Bd3 Bb7": "13...Bb7? is ordinary development, and it is exactly what Black would like to play in a calmer position. But with our bishop on d3, knight on f3 and pawn on e5, the h7 pawn is ripe for the classic Greek gift sacrifice, and Black has done nothing to stop it.",
    "e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4 c5 Nf3 Nc6 Be3 Be7 Qd2 O-O dxc5 Nxc5 O-O-O a6 Kb1 b5 Bxc5 Bxc5 Bd3 Bb7 Bxh7+": "14.Bxh7+ is the Greek gift. The e5 pawn keeps the f6 knight square out of Black's reach, so there is no defender that can come back to the king.",
    "e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4 c5 Nf3 Nc6 Be3 Be7 Qd2 O-O dxc5 Nxc5 O-O-O a6 Kb1 b5 Bxc5 Bxc5 Bd3 Bb7 Bxh7+ Kxh7 Ng5+": "15.Ng5+ follows up with check, and the knight now controls h7 for the queen.",
    "e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4 c5 Nf3 Nc6 Be3 Be7 Qd2 O-O dxc5 Nxc5 O-O-O a6 Kb1 b5 Bxc5 Bxc5 Bd3 Bb7 Bxh7+ Kxh7 Ng5+ Kg8 Qd3": "16.Qd3 swings the queen onto the b1-h7 diagonal, threatening Qh7+ with a crushing attack. Black's best defence is to give up the queen for the g5 knight.",
    "e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4 c5 Nf3 Nc6 Be3 Be7 Qd2 O-O dxc5 Nxc5 O-O-O a6 Kb1 b5 Bxc5 Bxc5 Bd3 Bb7 Bxh7+ Kxh7 Ng5+ Kg8 Qd3 Qxg5 fxg5": "17.fxg5 and White has queen and pawn against two minor pieces, a winning material edge. The half-open f-file and the advanced g5 pawn also keep Black's king under pressure.",

    // 4...Ne4: 8...Nc6??
    "e4 e6 d4 d5 Nc3 Nf6 e5 Ne4 Nxe4 dxe4 Bc4 c5 d5 exd5 Qxd5 Nc6": "8...Nc6?? develops with a hit on e5, and it is easy to play on autopilot. But our queen on d5 and bishop on c4 are both aimed at f7, and only the king guards it. Black had to trade queens with 8...Qxd5.",
    "e4 e6 d4 d5 Nc3 Nf6 e5 Ne4 Nxe4 dxe4 Bc4 c5 d5 exd5 Qxd5 Nc6 Qxf7#": "9.Qxf7# is mate. The bishop protects the queen, d8 is blocked by Black's own queen, and d7 and e7 are covered along the seventh rank.",

    // Winawer 7...O-O: 11...Nbc6??
    "e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7 Qg4 O-O Bd3 f5 exf6 Rxf6 Bg5 Rf7 Qh5 Nbc6": "11...Nbc6?? is a normal developing move, but it ignores the threat on h7. Black had to play 11...g6, because now the queen and bishop on d3 take h7 with check, and the check on h8 will force the e7 knight away from guarding the queen.",
    "e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7 Qg4 O-O Bd3 f5 exf6 Rxf6 Bg5 Rf7 Qh5 Nbc6 Qxh7+": "12.Qxh7+ wins a pawn with check, supported by the d3 bishop. The king has to step to f8.",
    "e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7 Qg4 O-O Bd3 f5 exf6 Rxf6 Bg5 Rf7 Qh5 Nbc6 Qxh7+ Kf8 Qh8+": "13.Qh8+ forces 13...Ng8 as the only block. That knight was the piece standing between our g5 bishop and Black's queen on d8.",
    "e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7 Qg4 O-O Bd3 f5 exf6 Rxf6 Bg5 Rf7 Qh5 Nbc6 Qxh7+ Kf8 Qh8+ Ng8 Bxd8": "14.Bxd8 wins the queen for a bishop. White is completely winning, and the queen on h8 still keeps Black's king pinned down.",

    // Poisoned Pawn: 9...Nf5??
    "e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7 Qg4 Qc7 Qxg7 Rg8 Qxh7 Nf5": "9...Nf5?? looks active, since the knight heads for the centre and blocks the h-file. But the e7 knight was the only defender of the rook on g8, which stands right in front of our queen.",
    "e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7 Qg4 Qc7 Qxg7 Rg8 Qxh7 Nf5 Qxg8+": "10.Qxg8+ wins a whole rook with check. White is a rook and two pawns up and should simply consolidate.",

    // Rubinstein 6...h6: 9...Nd7??
    "e4 e6 d4 d5 Nc3 dxe4 Nxe4 Nf6 Nxf6+ Qxf6 Nf3 h6 Bd3 Bd6 Qe2 O-O Qe4 Nd7": "9...Nd7?? is a natural developing move, but it misses that our queen and d3 bishop are lined up on h7. The h6 pawn no longer guards that square, so Black had to answer the threat with 9...g6.",
    "e4 e6 d4 d5 Nc3 dxe4 Nxe4 Nf6 Nxf6+ Qxf6 Nf3 h6 Bd3 Bd6 Qe2 O-O Qe4 Nd7 Qh7#": "10.Qh7# is mate. The bishop guards the queen, the rook on f8 and the f7 and g7 pawns leave the king no flight square.",

    // Rubinstein 4...Nd7: 10...Nd7?
    "e4 e6 d4 d5 Nc3 dxe4 Nxe4 Nd7 Nf3 Ngf6 Nxf6+ Nxf6 c3 Be7 Bd3 O-O Bf4 b6 Qe2 Nd7": "10...Nd7? wants to reroute the knight or prepare ...f5, but it takes away the f6 knight, the main defender of h7. And since ...b6 was played before ...Bb7, the rook on a8 is also open on the long diagonal.",
    "e4 e6 d4 d5 Nc3 dxe4 Nxe4 Nd7 Nf3 Ngf6 Nxf6+ Nxf6 c3 Be7 Bd3 O-O Bf4 b6 Qe2 Nd7 Qe4": "11.Qe4 is a double attack: it threatens Qh7# and also hits the rook on a8 along the long diagonal. Black cannot meet both threats.",
    "e4 e6 d4 d5 Nc3 dxe4 Nxe4 Nd7 Nf3 Ngf6 Nxf6+ Nxf6 c3 Be7 Bd3 O-O Bf4 b6 Qe2 Nd7 Qe4 f5 Qxa8": "12.Qxa8 takes the whole rook. Black stopped the mate with 11...f5, but now White is a whole rook up for nothing.",

    // 3...c5: 7...Be6?
    "e4 e6 d4 d5 Nc3 c5 exd5 exd5 Bb5+ Nc6 dxc5 Bxc5 Qxd5 Be6": "7...Be6? develops with gain of time against the queen, so it looks very natural. But the c6 knight is pinned and weak, and the bishop on c5 is loose: the queen-trade 7...Qxd5 was necessary.",
    "e4 e6 d4 d5 Nc3 c5 exd5 exd5 Bb5+ Nc6 dxc5 Bxc5 Qxd5 Be6 Bxc6+": "8.Bxc6+ removes the knight that was covering Black's queenside, with check. After the recapture the c6 square becomes a forking square for our queen.",
    "e4 e6 d4 d5 Nc3 c5 exd5 exd5 Bb5+ Nc6 dxc5 Bxc5 Qxd5 Be6 Bxc6+ bxc6 Qxc6+": "9.Qxc6+ forks the king, the rook on a8 and the bishop on c5. Black can only block the check and lose one of them.",
    "e4 e6 d4 d5 Nc3 c5 exd5 exd5 Bb5+ Nc6 dxc5 Bxc5 Qxd5 Be6 Bxc6+ bxc6 Qxc6+ Bd7 Qxc5": "10.Qxc5 picks up the bishop. White is a piece and two pawns up and Black's king is still in the centre.",

    // 3...c6: 7...O-O?
    "e4 e6 d4 d5 Nc3 c6 Nf3 Nf6 e5 Nfd7 Ng5 Be7 h4 O-O": "7...O-O? is the reflex move to get the king safe, but here it castles straight into the attack: our knight on g5 already hits h7 and the h4 pawn has the h-file ready to open. Black should keep the king flexible with 7...h6 or 7...c5.",
    "e4 e6 d4 d5 Nc3 c6 Nf3 Nf6 e5 Nfd7 Ng5 Be7 h4 O-O Qh5": "8.Qh5 threatens Qxh7# straight away, with knight and queen both hitting h7. Black has to find 8...h6 and even then faces a strong attack with Rh3.",
    "e4 e6 d4 d5 Nc3 c6 Nf3 Nf6 e5 Nfd7 Ng5 Be7 h4 O-O Qh5 Bxg5": "8...Bxg5? removes the attacking knight and seems to solve the problem, but it opens the h-file for our rook. The queen on h5 now has the h1 rook behind it.",
    "e4 e6 d4 d5 Nc3 c6 Nf3 Nf6 e5 Nfd7 Ng5 Be7 h4 O-O Qh5 Bxg5 hxg5": "9.hxg5 opens the h-file, and Qxh7# is threatened again, now backed by the rook. Black can only delay with moves like 9...h6, but after 10.gxh6 the attack on the open file is decisive."
  }
};

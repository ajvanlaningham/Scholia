import { describe, expect, it } from 'vitest';
import {
  legalDests,
  normalizeFen,
  parseAnnotatedPgn,
  playPgnMainline,
  playSan,
  playSanLine,
  playUci,
  playUciLine,
  positionKey,
  sideToMove,
  STARTING_FEN,
} from './index.ts';

const lastKey = (sans: string[]) => playSanLine(STARTING_FEN, sans).at(-1)!.key;

describe('positionKey', () => {
  it('ignores halfmove and fullmove counters', () => {
    const board = 'r1bqkb1r/pppp1ppp/2n2n2/4p1N1/2B1P3/8/PPPP1PPP/RNBQK2R b KQkq -';
    expect(positionKey(`${board} 5 4`)).toBe(positionKey(`${board} 0 1`));
    expect(positionKey(`${board} 5 4`)).toBe(board);
  });

  it('gives transpositions the same key', () => {
    expect(lastKey(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])).toBe(lastKey(['e4', 'e5', 'Bc4', 'Nc6', 'Nf3']));
  });

  it('distinguishes castling rights', () => {
    const kept = lastKey(['e4', 'e5', 'Nf3', 'Nf6', 'Ng1', 'Ng8']);
    const lost = lastKey(['e4', 'e5', 'Ke2', 'Ke7', 'Ke1', 'Ke8']);
    expect(lost.split(' ').slice(0, 2)).toEqual(kept.split(' ').slice(0, 2));
    expect(kept.split(' ')[2]).toBe('KQkq');
    expect(lost.split(' ')[2]).toBe('-');
  });

  it('drops an en passant square when no capture is possible', () => {
    // After 1.e4 a naive FEN records e3, but no black pawn can capture.
    expect(lastKey(['e4']).split(' ')[3]).toBe('-');
  });

  it('keeps an en passant square when a capture is legal', () => {
    expect(lastKey(['e4', 'a6', 'e5', 'd5']).split(' ')[3]).toBe('d6');
  });

  it('distinguishes positions that differ only by a legal en passant capture', () => {
    const withEp = lastKey(['e4', 'Nf6', 'e5', 'd5']);
    const withoutEp = lastKey(['e4', 'd5', 'e5', 'Nf6', 'Nc3', 'Ng8', 'Nb1', 'Nf6']);
    expect(withEp.split(' ').slice(0, 3)).toEqual(withoutEp.split(' ').slice(0, 3));
    expect(withEp).not.toBe(withoutEp);
  });

  it('rejects invalid FENs', () => {
    expect(() => positionKey('not a fen')).toThrow(/Invalid FEN/);
  });
});

describe('moves', () => {
  it('derives SAN from UCI and UCI from SAN', () => {
    expect(playUci(STARTING_FEN, 'g1f3')).toMatchObject({ san: 'Nf3', uci: 'g1f3' });
    expect(playSan(STARTING_FEN, 'Nf3')).toMatchObject({ san: 'Nf3', uci: 'g1f3' });
  });

  it('accepts both castling encodings and emits standard UCI', () => {
    const fen = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
    expect(playUci(fen, 'e1g1')).toMatchObject({ san: 'O-O', uci: 'e1g1' });
    expect(playUci(fen, 'e1h1')).toMatchObject({ san: 'O-O', uci: 'e1g1' });
    expect(playSan(fen, 'O-O').uci).toBe('e1g1');
  });

  it('handles promotion', () => {
    const fen = '8/4P3/8/8/8/8/k7/4K3 w - - 0 1';
    expect(playUci(fen, 'e7e8q')).toMatchObject({ san: 'e8=Q', uci: 'e7e8q' });
    expect(playUci(fen, 'e7e8n').san).toBe('e8=N');
  });

  it('renders an engine PV as SAN', () => {
    const traxler = playPgnMainline('1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 Bc5').moves.at(-1)!.fen;
    const sans = playUciLine(traxler, ['g5f7', 'c5f2', 'e1f2', 'f6e4']).map((m) => m.san);
    expect(sans).toEqual(['Nxf7', 'Bxf2+', 'Kxf2', 'Nxe4+']);
  });

  it('rejects illegal moves', () => {
    expect(() => playUci(STARTING_FEN, 'e2e5')).toThrow(/Illegal move e2e5/);
    expect(() => playSan(STARTING_FEN, 'Nf6')).toThrow(/Illegal move Nf6/);
    expect(() => playUci(STARTING_FEN, 'garbage')).toThrow(/Illegal move/);
  });
});

describe('playPgnMainline', () => {
  it('plays bare movetext from the starting position', () => {
    const { startFen, moves } = playPgnMainline('1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 Bc5 5. Nxf7');
    expect(startFen).toBe(normalizeFen(STARTING_FEN));
    expect(moves.map((m) => m.uci)).toEqual([
      'e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'f3g5', 'f8c5', 'g5f7',
    ]);
    expect(sideToMove(moves.at(-1)!.fen)).toBe('black');
  });

  it('honors a FEN header', () => {
    const pgn = '[FEN "8/4P3/8/8/8/8/k7/4K3 w - - 0 1"]\n[SetUp "1"]\n\n1. e8=Q *';
    expect(playPgnMainline(pgn).moves[0]!.uci).toBe('e7e8q');
  });

  it('rejects illegal movetext', () => {
    expect(() => playPgnMainline('1. e4 e5 2. Ke3')).toThrow(/Illegal move Ke3/);
  });
});

describe('parseAnnotatedPgn', () => {
  const study = `[Event "Traxler: Main line"]
[FEN "r1bqk2r/pppp1ppp/2n2n2/2b1p1N1/2B1P3/8/PPPP1PPP/RNBQK2R w KQkq - 6 5"]
[SetUp "1"]

{ The Traxler. [%csl Gf2] }
5. Nxf7 $6 { [%anno "Guest", guest] Greedy. [%cal Gf7d8] } (5. Bxf7+ $1 { The modern choice. } Ke7) 5... Bxf2+ $1 6. Kxf2 *

[Event "Second chapter"]

1. e4 *`;

  it('walks every variation with comments and symbols', () => {
    const [chapter] = parseAnnotatedPgn(study);
    expect(chapter!.intro).toEqual(['The Traxler.']);
    expect(chapter!.moves.map((m) => [m.path.join(' '), m.symbols.join(''), m.comments.join(' ')])).toEqual([
      ['Nxf7', '?!', 'Greedy.'],
      ['Nxf7 Bxf2+', '!', ''],
      ['Nxf7 Bxf2+ Kxf2', '', ''],
      ['Bxf7+', '!', 'The modern choice.'],
      ['Bxf7+ Ke7', '', ''],
    ]);
  });

  it('marks which moves are on the main line', () => {
    const [chapter] = parseAnnotatedPgn(study);
    expect(chapter!.moves.filter((m) => m.mainline).map((m) => m.san)).toEqual(['Nxf7', 'Bxf2+', 'Kxf2']);
  });

  it('anchors each move to the position before it', () => {
    const [chapter] = parseAnnotatedPgn(study);
    const bishop = chapter!.moves.find((m) => m.san === 'Bxf7+')!;
    expect(bishop.fromKey).toBe(chapter!.startKey);
    expect(bishop.uci).toBe('c4f7');
    const reply = chapter!.moves.find((m) => m.san === 'Ke7')!;
    expect(reply.fromKey).toBe(bishop.key);
  });

  it('parses every game and keeps headers', () => {
    const chapters = parseAnnotatedPgn(study);
    expect(chapters.map((c) => c.headers.Event)).toEqual(['Traxler: Main line', 'Second chapter']);
    expect(chapters[1]!.startFen).toBe(normalizeFen(STARTING_FEN));
  });
});

describe('legalDests', () => {
  it('lists destinations per origin square', () => {
    const dests = legalDests(STARTING_FEN);
    expect(dests.get('e2')).toEqual(['e3', 'e4']);
    expect(dests.get('g1')?.sort()).toEqual(['f3', 'h3']);
    expect(dests.has('e1')).toBe(false);
  });

  it('includes both castling encodings', () => {
    const fen = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
    expect(legalDests(fen).get('e1')).toEqual(expect.arrayContaining(['f1', 'g1', 'h1']));
  });
});

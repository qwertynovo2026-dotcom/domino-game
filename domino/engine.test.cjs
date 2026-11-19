const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({ module: { exports: {} } });
vm.runInContext(fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8'), context);
const { createGame, nextRound, nextStarter, legalMoves, play, drawOrPass, chooseBotMove, openEnds, endTotal } = context.module.exports;
const asPlain = value => JSON.parse(JSON.stringify(value));

function tile(id) {
  const [a, b] = id.split(':').map(Number);
  return { id, a, b };
}

function fixture(hands, { stock = [], scores, root = null, roundNumber = 2 } = {}) {
  const game = createGame(hands.length);
  return Object.assign(game, {
    board: { root: root && tile(root), spinner: root !== null && root[0] === root[2], arms: [[], [], [], []] },
    hands: hands.map(hand => hand.map(tile)),
    stock: stock.map(tile),
    scores: scores ?? game.scores,
    turn: 0,
    starter: 0,
    roundNumber,
    forcedTileId: null
  });
}

function random(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

test('deal and opening priority in 2, 3 and 4 seats', () => {
  let sawFallbackDouble = false;
  for (const count of [2, 3, 4]) {
    const rng = random(count);
    for (let i = 0; i < 1024; i++) {
      const game = createGame(count, rng);
      assert.ok(game.hands.every(hand => hand.length === 7));
      assert.equal(game.stock.length, 28 - count * 7);
      const dealt = game.hands.flat();
      const doubles = dealt.filter(t => t.a === t.b);
      const pool = doubles.length ? doubles : dealt;
      const expected = Math.max(...pool.map(t => t.a + t.b));
      const moves = legalMoves(game);
      assert.equal(moves.length, 1);
      const opener = dealt.find(t => t.id === moves[0].tileId);
      assert.equal(opener.a + opener.b, expected);
      assert.equal(opener.a === opener.b, doubles.length > 0);
      if (doubles.length && opener.id !== '6:6') sawFallbackDouble = true;
    }
  }
  assert.ok(sawFallbackDouble);

  const doubles = [0, 7, 13, 18, 22, 25, 27];
  let last = 27;
  const onlyInStock = () => {
    const index = doubles.pop() ?? last;
    return (index + 0.5) / (last-- + 1);
  };
  const game = createGame(2, onlyInStock);
  assert.ok(game.stock.filter(t => t.a === t.b).length === 7);
  assert.equal(legalMoves(game)[0].tileId, '5:6');
});

test('late house re-centers the entire existing chain and opens the cross only on both attachments', () => {
  const game = fixture([['2:4', '6:6'], ['4:5', '5:5', '0:2'], ['2:3', '3:5', '0:5']]);
  play(game, '2:4', null);
  play(game, '4:5', 1);
  play(game, '2:3', 0);
  assert.equal(endTotal(game.board), 8);
  game.turn = 1;
  play(game, '5:5', 1);
  assert.equal(game.board.root.id, '5:5');
  assert.deepEqual(asPlain(game.board.arms[0].map(t => [t.from, t.to])), [[5, 4], [4, 2], [2, 3]]);
  assert.equal(endTotal(game.board), 13);
  assert.equal(openEnds(game.board).length, 2);
  play(game, '3:5', 1);
  assert.equal(endTotal(game.board), 6);
  assert.equal(openEnds(game.board).length, 4);
  assert.equal(openEnds(game.board)[3].pip, 5);
  assert.equal(game.phase, 'playing');
});

test('open ordinary doubles count twice and an empty cross arm has no points', () => {
  const game = fixture([['0:6', '4:6', '4:4', '5:6', '2:4'], ['1:6', '5:5', '4:5']], { root: '6:6' });
  play(game, '4:6', 0);
  assert.equal(endTotal(game.board), 16);
  play(game, '1:6', 1);
  assert.equal(endTotal(game.board), 5);
  play(game, '4:4', 0);
  assert.equal(endTotal(game.board), 9);
  game.turn = 0;
  play(game, '0:6', 2);
  assert.equal(endTotal(game.board), 9);
  assert.equal(game.board.arms[3].length, 0);
});

test('any tile may open after the first deal and a 5:5 opener is worth two except at 70', () => {
  for (const [start, after] of [[69, 71], [70, 70]]) {
    const game = fixture([['5:5', '1:2'], ['3:4']], { scores: [start, 0] });
    assert.deepEqual(asPlain(legalMoves(game)), [{ tileId: '5:5', side: null }, { tileId: '1:2', side: null }]);
    play(game, '5:5', null);
    assert.equal(game.scores[0], after);
    assert.equal(game.phase, after >= 71 ? 'match-over' : 'playing');
  }
  const game = fixture([['5:5', '1:2'], ['3:4']]);
  play(game, '1:2', null);
  assert.equal(game.board.spinner, false);
});

test('opening 4:6 or 1:4 records open ends without scoring, including at 70', () => {
  for (const [id, sum] of [['4:6', 10], ['1:4', 5]]) {
    for (const score of [0, 70]) {
      const game = fixture([[id, '0:0'], ['3:4']], { scores: [score, 0] });
      play(game, id, null);
      assert.equal(endTotal(game.board), sum);
      assert.equal(game.lastMove.points, 0);
      assert.equal(game.scores[0], score);
      assert.equal(game.phase, 'playing');
    }
  }

  const game = fixture([['4:6', '0:0'], ['1:6', '2:2']]);
  play(game, '4:6', null);
  play(game, '1:6', 1);
  assert.equal(game.lastMove.sum, 5);
  assert.equal(game.lastMove.points, 1);
  assert.deepEqual(asPlain(game.scores), [0, 1]);
});

test('an open 5:5 is protected while another branch ends in five', () => {
  const game = fixture([
    ['2:6', '2:5', '3:5', '0:0'],
    ['5:6', '5:5', '4:5', '1:1']
  ], { root: '6:6' });
  play(game, '2:6', 0);
  play(game, '5:6', 1);
  play(game, '2:5', 0);
  play(game, '5:5', 1);

  assert.equal(endTotal(game.board), 15);
  assert.equal(openEnds(game.board)[1].pip, 5);
  assert.deepEqual(asPlain(legalMoves(game)), [{ tileId: '3:5', side: 0 }]);
  assert.deepEqual(asPlain(chooseBotMove(game)), { tileId: '3:5', side: 0 });
  assert.throws(() => play(game, '3:5', 1), /нельзя/);
  play(game, '3:5', 0);
  assert.deepEqual(asPlain(legalMoves(game)), [{ tileId: '4:5', side: 1 }]);
});

test('when three branch ends are five, either ordinary end remains legal', () => {
  const game = fixture([['3:5', '2:6'], ['3:4']], { root: '6:6' });
  game.board.arms = [
    [{ ...tile('5:6'), from: 6, to: 5 }],
    [{ ...tile('4:6'), from: 6, to: 4 }, { ...tile('4:5'), from: 4, to: 5 },
      { ...tile('5:5'), from: 5, to: 5 }],
    [{ ...tile('1:6'), from: 6, to: 1 }, { ...tile('1:5'), from: 1, to: 5 }],
    []
  ];
  assert.deepEqual(asPlain(legalMoves(game)), [
    { tileId: '3:5', side: 0 }, { tileId: '3:5', side: 2 }, { tileId: '2:6', side: 3 }
  ]);
});

test('an exposed 5:5 house is protected only when there is a separate free five', () => {
  const game = fixture([['2:5', '3:4'], ['0:1']], { root: '5:5' });
  assert.deepEqual(asPlain(legalMoves(game)), [{ tileId: '2:5', side: 0 }, { tileId: '2:5', side: 1 }]);
  game.board.arms[0] = [
    { ...tile('1:5'), from: 5, to: 1 }, { ...tile('1:3'), from: 1, to: 3 },
    { ...tile('3:5'), from: 3, to: 5 }
  ];
  assert.equal(endTotal(game.board), 15);
  assert.deepEqual(asPlain(legalMoves(game)), [{ tileId: '2:5', side: 0 }]);
});

test('reaching target mid-round stops before the out bonus', () => {
  const game = fixture([['3:6'], ['0:0', '5:5']], { root: '6:6', scores: [68, 0] });
  play(game, '3:6', 0);
  assert.equal(game.scores[0], 71);
  assert.equal(game.phase, 'match-over');
  assert.equal(game.winner, 0);
  assert.equal(game.result.type, 'target');
  assert.equal(game.result.bonus, 0);
  assert.equal(game.result.bonusBase, null);
  assert.throws(() => nextRound(game));
});

test('draw continues until first eligible tile and blocks other actions until it is played', () => {
  const game = fixture([['2:2'], ['3:6']], { root: '6:6', stock: ['3:3', '4:6', '2:3', '0:0'] });
  drawOrPass(game);
  assert.equal(game.turn, 0);
  assert.equal(game.lastMove.drawn, 3);
  assert.equal(game.stock.length, 1);
  assert.deepEqual(asPlain(legalMoves(game)), [{ tileId: '4:6', side: 0 }, { tileId: '4:6', side: 1 }]);
  assert.throws(() => drawOrPass(game));
  play(game, '4:6', 0);
  assert.equal(game.turn, 1);
  assert.equal(game.forcedTileId, null);
});

test('earlier passes do not prevent winning by going out', () => {
  const game = fixture([['3:3'], ['3:6', '0:0']], { root: '6:6' });
  drawOrPass(game);
  assert.equal(game.turn, 1);
  assert.equal(game.passCount, 1);
  play(game, '3:6', 0);
  assert.equal(game.passCount, 0);
  play(game, '3:3', 0);
  assert.equal(game.result.type, 'out');
  assert.deepEqual(asPlain(game.result.remainders), [0, 10]);
  assert.equal(game.result.bonus, 2);
  nextRound(game);
  assert.equal(game.starter, 1);
});

test('2×2 credits the winner team for the other three hands including their teammate', () => {
  const game = fixture([['0:6'], ['1:1'], ['0:2', '5:5'], ['1:4']], { root: '6:6' });
  play(game, '0:6', 0);
  assert.equal(game.result.bonus, 4);
  assert.deepEqual(asPlain(game.scores), [4, 0]);
});

test('the round bonus uses one rounding after the remaining hands are added', () => {
  const game = fixture([['0:6'], ['1:1'], ['1:2'], ['2:2']], { root: '6:6' });
  play(game, '0:6', 0);
  assert.deepEqual(asPlain(game.result.remainders), [0, 2, 3, 4]);
  assert.equal(game.result.bonusBase, 9);
  assert.equal(game.result.bonus, 2);
});

test('a full circle of passes blocks play and totals all three other four-seat hands', () => {
  const game = fixture([['1:1'], ['1:2'], ['2:2'], ['2:3']], { root: '6:6' });
  for (let i = 0; i < 4; i++) drawOrPass(game);
  assert.equal(game.result.type, 'blocked');
  assert.equal(game.result.seat, 0);
  assert.equal(game.result.bonusBase, 12);
  assert.equal(game.result.bonus, 3);
  assert.deepEqual(asPlain(game.scores), [3, 0]);
});

test('a bot winning a four-player fish gets all three other hands credited to its team', () => {
  const examples = [
    {
      root: '1:1',
      hands: [['4:4', '3:4', '6:6'], ['2:3'], ['3:3'], ['2:4']],
      remainders: [27, 5, 6, 6],
      base: 39,
      bonus: 8
    },
    {
      root: '5:5',
      hands: [['1:2', '4:6', '1:3'], ['2:4', '0:2'], ['1:4', '0:4'], ['4:4', '3:4', '3:3', '1:6']],
      remainders: [17, 8, 9, 28],
      base: 54,
      bonus: 11
    }
  ];
  for (const { root, hands, remainders, base, bonus } of examples) {
    const game = fixture(hands, { root, scores: [7, 12] });
    for (let i = 0; i < 4; i++) drawOrPass(game);
    assert.equal(game.result.seat, 1);
    assert.deepEqual(asPlain(game.result.remainders), remainders);
    assert.equal(game.result.bonusBase, base);
    assert.equal(game.result.bonus, bonus);
    assert.deepEqual(asPlain(game.scores), [7, 12 + bonus]);
  }
});

test('fish in one-on-one and three-player modes still uses the difference of hands', () => {
  for (const [hands, base, bonus] of [
    [[['2:3'], ['3:4']], 2, 1],
    [[['2:3'], ['3:4'], ['4:4']], 10, 2]
  ]) {
    const game = fixture(hands, { root: '6:6' });
    for (let i = 0; i < hands.length; i++) drawOrPass(game);
    assert.equal(game.result.seat, 0);
    assert.equal(game.result.bonusBase, base);
    assert.equal(game.result.bonus, bonus);
  }
});

test('tied fish is unscored and opening still rotates clockwise', () => {
  const game = fixture([['0:0'], ['4:4'], ['3:5']], { root: '6:6' });
  for (let i = 0; i < 3; i++) drawOrPass(game);
  assert.deepEqual(asPlain(game.result), {
    type: 'blocked', seat: null, bonus: 0, bonusBase: null, tied: true, remainders: [10, 8, 8]
  });
  nextRound(game);
  assert.equal(game.turn, 1);
  assert.equal(game.starter, 1);
  assert.equal(game.forcedTileId, null);
});

test('opening rotates from the previous opener even if the next opener won by going out', () => {
  const game = fixture([['1:2'], ['3:6']], { root: '6:6' });
  game.turn = 1;
  play(game, '3:6', 0);
  assert.equal(game.result.seat, 1);
  assert.equal(nextStarter(game), 1);
  nextRound(game);
  assert.equal(game.turn, 1);
  assert.equal(legalMoves(game).length, 7);
  assert.equal(nextStarter(game), 0);
});

test('lone 0:0 keeps zero value in teams', () => {
  const game = fixture([['0:0'], ['2:3'], ['0:4'], ['1:5']], { root: '6:6' });
  for (let i = 0; i < 4; i++) drawOrPass(game);
  assert.deepEqual(asPlain(game.result.remainders), [0, 5, 4, 6]);
  assert.equal(game.result.bonus, 3);
});

test('seeded bot matches finish and preserve all 28 unique tiles in every mode', () => {
  for (const count of [2, 3, 4]) {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = random(seed);
      const game = createGame(count, rng);
      for (let step = 0; game.phase !== 'match-over'; step++) {
        assert.ok(step < 3000);
        if (game.phase === 'round-over') {
          const previousStarter = game.starter;
          nextRound(game, rng);
          assert.equal(game.starter, (previousStarter + 1) % count);
          assert.equal(game.turn, game.starter);
          assert.equal(legalMoves(game).length, 7);
        }
        else {
          const move = chooseBotMove(game);
          if (move) play(game, move.tileId, move.side);
          else drawOrPass(game);
        }
        const inPlay = [game.board.root, ...game.board.arms.flat()].filter(Boolean);
        const ids = [...game.hands.flat(), ...game.stock, ...inPlay].map(t => t.id);
        assert.equal(ids.length, 28);
        assert.equal(new Set(ids).size, 28);
      }
      assert.ok(game.scores[game.winner] >= 71);
    }
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(file) {
  const context = vm.createContext({ module: { exports: {} } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context);
  return context.module.exports;
}

const { fit } = load('layout.js');
const engine = load('engine.js');
const ends = [
  { side: 0, pip: 5 },
  { side: 1, pip: 3 },
  { side: 2, pip: 6 },
  { side: 3, pip: 2 }
];

function createBoard(lengths) {
  let id = 0;
  return {
    root: { id: '6:6', a: 6, b: 6 },
    spinner: true,
    arms: lengths.map(length => Array.from({ length }, () => {
      id++;
      return { id, a: 1, b: id % 3 ? 1 : 2, from: 1, to: id % 3 ? 1 : 2 };
    }))
  };
}

function assertVisible(layout, width, height, tileCount) {
  const { pieces, tips, unit } = layout;
  assert.equal(pieces.length, tileCount);
  assert.equal(new Set(pieces.map(piece => piece.tile.id)).size, tileCount);
  const hitboxes = [
    ...pieces.map(piece => ({ x: piece.x, y: piece.y, rx: unit * (piece.vertical ? 0.5 : 1), ry: unit * (piece.vertical ? 1 : 0.5) })),
    ...tips.map(tip => ({ x: tip.x, y: tip.y, rx: unit * 0.7, ry: unit * 0.7 }))
  ];
  for (let index = 0; index < hitboxes.length; index++) {
    const { x, y, rx, ry } = hitboxes[index];
    assert.ok(x - rx >= -0.01 && x + rx <= width + 0.01);
    assert.ok(y - ry >= -0.01 && y + ry <= height + 0.01);
    for (const other of hitboxes.slice(index + 1)) {
      assert.ok(Math.abs(x - other.x) >= rx + other.rx - 0.01 ||
        Math.abs(y - other.y) >= ry + other.ry - 0.01);
    }
  }
}

function assertConnected(layout, board) {
  const boxes = new Map(layout.pieces.map(piece => [piece.tile.id, {
    x: piece.x,
    y: piece.y,
    rx: layout.unit * (piece.vertical ? 0.5 : 1),
    ry: layout.unit * (piece.vertical ? 1 : 0.5)
  }]));
  for (const arm of board.arms) {
    let previous = boxes.get(board.root.id);
    for (const tile of arm) {
      const box = boxes.get(tile.id);
      const horizontalGap = Math.max(0, Math.abs(box.x - previous.x) - box.rx - previous.rx);
      const verticalGap = Math.max(0, Math.abs(box.y - previous.y) - box.ry - previous.ry);
      assert.ok(Math.hypot(horizontalGap, verticalGap) <= layout.unit * 0.071,
        'consecutive stones should stay face to face after resizing or bending');
      previous = box;
    }
  }
}

test('short branches stay straight and retain their directions', () => {
  const board = createBoard([1, 1, 0, 0]);
  const layout = fit(board, ends, 1150, 480);
  const root = layout.pieces[0];
  assertVisible(layout, 1150, 480, 3);
  assertConnected(layout, board);
  assert.equal(layout.unit, 40);
  assert.ok(layout.tips[0].x < root.x && layout.tips[1].x > root.x);
  assert.ok(layout.tips[2].y < root.y && layout.tips[3].y > root.y);
});

test('a long cross and an elongated branch fit without overlap on a phone', () => {
  for (const lengths of [[9, 8, 6, 4], [1, 23, 2, 1], [1, 1, 1, 24]]) {
    const board = createBoard(lengths);
    for (const [width, height] of [[375, 420], [320, 270], [1366, 530]]) {
      const layout = fit(board, ends, width, height);
      assertVisible(layout, width, height, 28);
      assert.ok(layout.unit >= 15, 'stones remain legible at supported sizes');
      assertConnected(layout, board);
      assert.deepEqual(Array.from(layout.tips, tip => [tip.side, tip.pip]), ends.map(end => [end.side, end.pip]));
    }
  }
});

test('positions and legal tips stay visible through live games in each mode', () => {
  let seed = 3;
  const rng = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (const playerCount of [2, 3, 4]) {
    const game = engine.createGame(playerCount, rng);
    while (game.phase === 'playing') {
      const move = engine.chooseBotMove(game);
      if (move) engine.play(game, move.tileId, move.side);
      else engine.drawOrPass(game);
      const open = engine.openEnds(game.board);
      const tileCount = 1 + game.board.arms.reduce((sum, arm) => sum + arm.length, 0);
      const layout = fit(game.board, open, 375, 355);
      assertVisible(layout, 375, 355, tileCount);
      assertConnected(layout, game.board);
      assert.equal(layout.tips.length, open.length);
    }
  }
});

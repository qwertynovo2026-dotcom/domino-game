(function () {
  'use strict';

  const target = 71;
  const deck = [];
  for (let a = 0; a <= 6; a++) {
    for (let b = a; b <= 6; b++) {
      deck.push(Object.freeze({ id: a + ':' + b, a, b }));
    }
  }

  function shuffle(rng) {
    const tiles = deck.slice();
    for (let last = tiles.length - 1; last > 0; last--) {
      const index = Math.floor(rng() * (last + 1));
      [tiles[index], tiles[last]] = [tiles[last], tiles[index]];
    }
    return tiles;
  }

  const emptyBoard = () => ({ root: null, spinner: false, arms: [[], [], [], []] });
  const isDouble = tile => tile.a === tile.b;
  const pips = tile => tile.a + tile.b;
  const clockwise = (game, seat) => (seat + 1) % game.playerCount;
  const scoreIndex = (game, seat) => game.playerCount === 4 ? seat % 2 : seat;
  const remainderPoints = total => Math.ceil(total / 5);

  function prepareRound(game, rng) {
    const tiles = shuffle(rng);
    game.roundNumber++;
    game.hands = Array.from({ length: game.playerCount }, (_, seat) => (
      tiles.slice(seat * 7, seat * 7 + 7)
    ));
    game.stock = tiles.slice(game.playerCount * 7);
    game.board = emptyBoard();
    game.forcedTileId = null;
    game.passCount = 0;
    game.lastMove = null;
    game.result = null;
    game.phase = 'playing';

    if (game.roundNumber === 1) {
      let openingTile;
      for (const tile of game.hands.flat()) {
        if (!openingTile || (isDouble(tile) && !isDouble(openingTile)) ||
            (isDouble(tile) === isDouble(openingTile) && pips(tile) > pips(openingTile))) {
          openingTile = tile;
        }
      }
      game.starter = game.hands.findIndex(hand => hand.includes(openingTile));
      game.forcedTileId = openingTile.id;
    }
    game.turn = game.starter;
    return game;
  }

  function createGame(playerCount = 2, rng = Math.random) {
    if (![2, 3, 4].includes(playerCount)) throw new RangeError('Нужно 2, 3 или 4 игрока.');
    return prepareRound({
      playerCount,
      scores: Array(playerCount === 4 ? 2 : playerCount).fill(0),
      roundNumber: 0,
      starter: 0,
      winner: null
    }, rng);
  }

  function nextRound(game, rng = Math.random) {
    if (game.phase !== 'round-over') throw new Error('Следующий кон пока недоступен.');
    game.starter = nextStarter(game);
    return prepareRound(game, rng);
  }

  function nextStarter(game) {
    return clockwise(game, game.starter);
  }

  function openEnds(board) {
    if (!board.root) return [];
    const { root, spinner, arms } = board;
    const values = [root.a, root.b, root.a, root.b];
    const sideCount = spinner && arms[0].length && arms[1].length ? 4 : 2;
    return values.slice(0, sideCount).map((value, side) => ({
      side,
      pip: arms[side].at(-1)?.to ?? value
    }));
  }

  function playableEnds(board) {
    const ends = openEnds(board);
    const isFiveDoubleEnd = ({ side, pip }) => {
      const tile = board.arms[side].at(-1) ?? (side < 2 ? board.root : null);
      return pip === 5 && tile?.id === '5:5';
    };
    return ends.some(end => end.pip === 5 && !isFiveDoubleEnd(end))
      ? ends.filter(end => !isFiveDoubleEnd(end))
      : ends;
  }

  function endTotal(board) {
    if (!board.root) return 0;
    const { root, spinner, arms } = board;
    let total = spinner && (!arms[0].length || !arms[1].length) ? pips(root) : 0;
    for (const { side, pip } of openEnds(board)) {
      const tip = arms[side].at(-1);
      if (tip) total += isDouble(tip) ? pips(tip) : pip;
      else if (!spinner) total += pip;
    }
    return total;
  }

  function legalMoves(game, seat = game.turn) {
    if (game.phase !== 'playing') return [];
    const forced = seat === game.turn ? game.forcedTileId : null;
    const ends = playableEnds(game.board);
    return game.hands[seat].flatMap(tile => {
      if (forced !== null && tile.id !== forced) return [];
      if (!game.board.root) return [{ tileId: tile.id, side: null }];
      return ends.filter(end => tile.a === end.pip || tile.b === end.pip)
        .map(end => ({ tileId: tile.id, side: end.side }));
    });
  }

  function place(board, tile, side) {
    if (side === null) return { ...board, root: tile, spinner: isDouble(tile) };
    const arms = board.arms.slice();
    if (isDouble(tile) && !board.spinner) {
      const opposite = 1 - side;
      const connected = arms[side].slice().reverse().map(part => ({
        ...part, from: part.to, to: part.from
      }));
      const { a, b } = board.root;
      connected.push({ ...board.root, from: side === 0 ? a : b, to: side === 0 ? b : a });
      const newBoard = { ...emptyBoard(), root: tile, spinner: true };
      newBoard.arms[opposite] = connected.concat(arms[opposite]);
      return newBoard;
    }
    const from = openEnds(board).find(end => end.side === side).pip;
    const to = tile.a === from ? tile.b : tile.a;
    arms[side] = arms[side].concat({ ...tile, from, to });
    return { ...board, arms };
  }

  function movePoints(game, tile, side, sum) {
    if (side === null) {
      return tile.id === '5:5' && game.scores[scoreIndex(game, game.turn)] < 70 ? 2 : 0;
    }
    return sum % 5 === 0 ? sum / 5 : 0;
  }

  function handValue(game, hand) {
    if (game.playerCount < 4 && hand.length === 1 && hand[0].id === '0:0') return 10;
    return hand.reduce((sum, tile) => sum + pips(tile), 0);
  }

  function finishRound(game, type, seat, remainders = game.hands.map(hand => handValue(game, hand))) {
    if (seat === null) {
      game.result = { type, seat, bonus: 0, bonusBase: null, tied: true, remainders };
      game.phase = 'round-over';
      return game;
    }
    const otherTotal = remainders.reduce((sum, value, index) => sum + (index === seat ? 0 : value), 0);
    const subtractWinner = type === 'blocked' && game.playerCount < 4;
    const bonusBase = type === 'target' ? null : otherTotal - (subtractWinner ? remainders[seat] : 0);
    const bonus = bonusBase === null ? 0 : remainderPoints(bonusBase);
    const index = scoreIndex(game, seat);
    game.scores[index] += bonus;
    game.result = { type, seat, bonus, bonusBase, tied: false, remainders };
    if (game.scores[index] >= target) {
      game.winner = index;
      game.phase = 'match-over';
    } else {
      game.phase = 'round-over';
    }
    return game;
  }

  function play(game, tileId, side) {
    if (!legalMoves(game).some(move => move.tileId === tileId && move.side === side)) {
      throw new Error('Эту кость нельзя поставить сюда.');
    }
    const seat = game.turn;
    const hand = game.hands[seat];
    const [tile] = hand.splice(hand.findIndex(candidate => candidate.id === tileId), 1);
    game.board = place(game.board, tile, side);
    const sum = endTotal(game.board);
    const points = movePoints(game, tile, side, sum);
    const index = scoreIndex(game, seat);
    game.scores[index] += points;
    game.lastMove = { kind: 'play', seat, tile, side, points, sum };
    game.forcedTileId = null;
    game.passCount = 0;

    if (game.scores[index] >= target) return finishRound(game, 'target', seat);
    if (!hand.length) return finishRound(game, 'out', seat);
    game.turn = clockwise(game, seat);
    return game;
  }

  function drawOrPass(game) {
    if (game.phase !== 'playing' || legalMoves(game).length) {
      throw new Error('При доступном ходе нужно поставить кость.');
    }
    const seat = game.turn;
    const ends = playableEnds(game.board);
    let drawn = 0;
    while (game.stock.length) {
      const tile = game.stock.pop();
      game.hands[seat].push(tile);
      drawn++;
      if (ends.some(end => end.pip === tile.a || end.pip === tile.b)) {
        game.forcedTileId = tile.id;
        game.lastMove = { kind: 'draw', seat, tile, drawn };
        return game;
      }
    }
    game.lastMove = { kind: 'pass', seat, drawn };
    game.passCount++;
    if (game.passCount === game.playerCount) {
      const remainders = game.hands.map(hand => handValue(game, hand));
      const minimum = Math.min(...remainders);
      const lowest = remainders.flatMap((value, index) => value === minimum ? [index] : []);
      return finishRound(game, 'blocked', lowest.length === 1 ? lowest[0] : null, remainders);
    }
    game.turn = clockwise(game, seat);
    return game;
  }

  function chooseBotMove(game) {
    const hand = game.hands[game.turn];
    const moves = legalMoves(game);
    const byId = new Map(hand.map(tile => [tile.id, tile]));
    let selected = null;
    let best = -Infinity;
    for (const move of moves) {
      const tile = byId.get(move.tileId);
      const board = place(game.board, tile, move.side);
      const points = movePoints(game, tile, move.side, endTotal(board));
      const ends = new Set(openEnds(board).map(end => end.pip));
      const support = hand.filter(other => other !== tile && (ends.has(other.a) || ends.has(other.b))).length;
      const value = (game.scores[scoreIndex(game, game.turn)] + points >= target ? 1000 : 0) +
        9 * points + 1.5 * support + 0.12 * pips(tile);
      if (value > best) {
        best = value;
        selected = move;
      }
    }
    return selected;
  }

  const api = {
    createGame, nextRound, nextStarter, legalMoves, play, drawOrPass, chooseBotMove,
    openEnds, endTotal, remainderPoints
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  globalThis.Domino71 = api;
})();

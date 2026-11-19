const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { WebSocket } = require('ws');

function waitFor(emitter, event, pick, timeout = 3500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, listener);
      reject(new Error('Timed out waiting for ' + event));
    }, timeout);
    function listener(value) {
      const result = pick(value);
      if (!result) return;
      clearTimeout(timer);
      emitter.off(event, listener);
      resolve(result);
    }
    emitter.on(event, listener);
  });
}

async function connect(t, address) {
  const socket = new WebSocket(address.replace('http:', 'ws:'));
  t.after(() => socket.terminate());
  await waitFor(socket, 'open', () => true);
  return socket;
}

function receive(socket, type, select = () => true) {
  return waitFor(socket, 'message', raw => {
    const message = JSON.parse(raw);
    return message.type === type && select(message) ? message : null;
  });
}

function send(socket, type, fields = {}) {
  socket.send(JSON.stringify({ type, ...fields }));
}

test('four players share a full round and reconnect without losing their hands', { timeout: 12000 }, async t => {
  await import('./engine.js');
  const engine = globalThis.Domino71;
  const processServer = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore']
  });
  t.after(() => processServer.kill());
  const address = await waitFor(processServer.stdout, 'data',
    data => data.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]);

  const sockets = await Promise.all(Array.from({ length: 4 }, () => connect(t, address)));
  const hostAck = receive(sockets[0], 'ROOM_JOINED');
  send(sockets[0], 'CREATE_ROOM', { name: 'Хост' });
  const { roomId } = await hostAck;
  for (let i = 1; i < sockets.length; i++) {
    const joined = receive(sockets[i], 'ROOM_JOINED');
    send(sockets[i], 'JOIN_ROOM', { roomId, name: 'Игрок ' + i });
    await joined;
    const ready = receive(sockets[i], 'LOBBY_UPDATE', msg => msg.lobby.seats[i].player?.isReady);
    send(sockets[i], 'TOGGLE_READY', { roomId });
    await ready;
  }

  const initial = Promise.all(sockets.map(socket => receive(socket, 'GAME_STATE')));
  send(sockets[0], 'START_GAME', { roomId });
  const opening = await initial;
  const firstSeat = opening[0].game.starter;
  const forcedTile = opening[firstSeat].game.forcedTileId;
  assert.equal(new Set(opening.flatMap(msg => msg.game.myHand.map(tile => tile.id))).size, 28);
  for (const msg of opening) {
    assert.equal(msg.game.myHand.length, 7);
    assert.equal(msg.game.stockCount, 0);
    assert.equal(msg.game.forcedTileId, msg.seat === firstSeat ? forcedTile : null);
    assert.ok(msg.game.otherHands.every(hand => hand.tiles === undefined && hand.count === 7));
  }

  const otherTable = await connect(t, address);
  const otherAck = receive(otherTable, 'ROOM_JOINED');
  send(otherTable, 'CREATE_ROOM');
  const otherRoom = await otherAck;
  const messages = [];
  const recordMessage = raw => {
    const message = JSON.parse(raw);
    if (message.type === 'QUICK_MESSAGE') messages.push(message);
  };
  sockets[0].on('message', recordMessage);
  otherTable.on('message', recordMessage);
  // Only a member of the started table can send; unknown phrases are ignored.
  send(otherTable, 'QUICK_MESSAGE', { roomId: otherRoom.roomId, messageId: 'nice' });
  send(otherTable, 'QUICK_MESSAGE', { roomId, messageId: 'nice' });
  send(sockets[1], 'QUICK_MESSAGE', { roomId, messageId: 'constructor' });
  const replies = sockets.map(socket => receive(socket, 'QUICK_MESSAGE'));
  send(sockets[1], 'QUICK_MESSAGE', { roomId, messageId: 'nice', seat: 2 });
  send(sockets[1], 'QUICK_MESSAGE', { roomId, messageId: 'wait' });
  const pong = receive(sockets[1], 'PONG');
  send(sockets[1], 'PING');
  assert.deepEqual(await Promise.all(replies), Array(4).fill({
    type: 'QUICK_MESSAGE', roomId, seat: 1, messageId: 'nice'
  }));
  await pong;

  const move = Promise.all(sockets.map(socket => receive(socket, 'GAME_STATE', msg => msg.game.moveNumber === 1)));
  send(sockets[firstSeat], 'PLAY_TILE', { roomId, tileId: forcedTile, side: null });
  const afterMove = await move;
  assert.ok(afterMove.every(msg => msg.game.board.root.id === forcedTile));
  assert.ok(afterMove.every(msg => msg.game.turn === (firstSeat + 1) % 4));
  assert.equal(messages.length, 1);

  const host = sockets[0];
  const originalSession = await hostAck;
  const disconnected = waitFor(host, 'close', () => true);
  host.close();
  await disconnected;
  const recovered = await connect(t, address);
  const resumed = receive(recovered, 'GAME_STATE');
  send(recovered, 'JOIN_ROOM', { roomId, resumeToken: originalSession.resumeToken });
  const afterResume = await resumed;
  assert.equal(afterResume.seat, 0);
  assert.equal(afterResume.game.moveNumber, 1);
  assert.deepEqual(afterResume.game.myHand, afterMove[0].game.myHand);
  sockets[0] = recovered;

  let state = afterMove[0].game;
  let snapshots = afterMove;
  for (let i = 0; state.phase === 'playing' && i < 116; i++) {
    const actor = snapshots[state.turn].game;
    const hands = Array.from({ length: 4 }, () => []);
    hands[state.turn] = actor.myHand;
    const [choice] = engine.legalMoves({ ...actor, hands });
    const next = Promise.all(sockets.map(socket => receive(socket, 'GAME_STATE',
      msg => msg.game.moveNumber === state.moveNumber + 1)));
    send(sockets[state.turn], choice ? 'PLAY_TILE' : 'DRAW_OR_PASS', {
      roomId,
      ...choice
    });
    snapshots = await next;
    state = snapshots[0].game;
  }

  assert.equal(state.phase, 'round-over');
  for (const snapshot of snapshots) {
    assert.deepEqual(snapshot.game.result, state.result);
    assert.ok(snapshot.game.otherHands.every(hand => hand.tiles.length === hand.count));
  }
  const thanks = receive(sockets[0], 'QUICK_MESSAGE');
  send(sockets[2], 'QUICK_MESSAGE', { roomId, messageId: 'thanks' });
  assert.equal((await thanks).messageId, 'thanks');
  const continued = Promise.all(sockets.map(socket => receive(socket, 'GAME_STATE',
    msg => msg.game.roundNumber === 2)));
  send(sockets[0], 'NEXT_ROUND', { roomId });
  for (const snapshot of await continued) {
    assert.equal(snapshot.game.starter, (firstSeat + 1) % 4);
    assert.equal(snapshot.game.myHand.length, 7);
    assert.ok(snapshot.game.otherHands.every(hand => hand.tiles === undefined));
  }
  assert.equal((await fetch(address + '/')).status, 200);
  assert.equal((await fetch(address + '/quick-messages.js')).status, 200);
  assert.equal((await fetch(address + '/api/rooms')).status, 404);
});

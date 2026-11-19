import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import './engine.js';
import './quick-messages.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const engine = globalThis.Domino71;

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST || '0.0.0.0';
const browserFiles = new Set(['index.html', 'style.css', 'engine.js', 'layout.js', 'quick-messages.js', 'net.js', 'app.js']);
const quickMessages = globalThis.DominoQuickMessages;
const quickMessageInterval = 1000;

// Rooms state in memory
const rooms = new Map();

function normalizeRoomCode(code) {
  if (!code || typeof code !== 'string') return '';
  const cyrillicMap = {
    'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'К': 'K',
    'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X', 'У': 'Y'
  };
  return code.trim().toUpperCase().replace(/[АВСЕНКМОРТХУ]/g, ch => cyrillicMap[ch] || ch).slice(0, 4);
}

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 4; i++) {
    id += chars[randomInt(chars.length)];
  }
  return rooms.has(id) ? generateRoomId() : id;
}

function createPlayer(socket, name, fallback, isReady) {
  const cleanName = typeof name === 'string' ? name.trim().slice(0, 24) : '';
  return {
    id: randomUUID(), resumeToken: randomBytes(24).toString('base64url'),
    name: cleanName || fallback, isReady, isBot: false, socket
  };
}

function attachPlayer(socket, room, player) {
  clearTimeout(room.cleanupTimer);
  const previous = player.socket;
  player.socket = socket;
  socket.playerId = player.id;
  socket.roomId = room.id;
  if (previous && previous !== socket) previous.close(4001, 'Место открыто в другой вкладке');
  sendTo(socket, { type: 'ROOM_JOINED', roomId: room.id, playerId: player.id, resumeToken: player.resumeToken });
}

function getSeatTitle(seatIndex) {
  switch (seatIndex) {
    case 0: return 'Юг (Команда 1)';
    case 1: return 'Запад (Команда 2)';
    case 2: return 'Север (Команда 1 - напарник)';
    case 3: return 'Восток (Команда 2)';
    default: return 'Место ' + seatIndex;
  }
}

function createRoom(roomId, hostPlayer) {
  const seats = Array.from({ length: 4 }, (_, i) => ({
    seatIndex: i,
    title: getSeatTitle(i),
    team: i % 2 === 0 ? 1 : 2,
    player: null // { id, name, isReady, isBot, socket }
  }));

  // Host takes seat 0
  seats[0].player = hostPlayer;

  const room = {
    id: roomId,
    createdAt: Date.now(),
    hostId: hostPlayer.id,
    status: 'lobby', // 'lobby' | 'playing' | 'round_over' | 'match_over'
    mode: 4, // 2x2
    seats,
    game: null,
    botTimer: null
  };

  rooms.set(roomId, room);
  return room;
}

function sanitizeLobby(room) {
  return {
    roomId: room.id,
    hostId: room.hostId,
    status: room.status,
    mode: room.mode,
    seats: room.seats.map(seat => ({
      seatIndex: seat.seatIndex,
      title: seat.title,
      team: seat.team,
      player: seat.player ? {
        id: seat.player.id,
        name: seat.player.name,
        isReady: seat.player.isReady,
        isBot: seat.player.isBot,
        isOnline: Boolean(seat.player.socket),
        isHost: seat.player.id === room.hostId
      } : null
    }))
  };
}

function sendTo(socket, payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function broadcastLobby(room) {
  const data = { type: 'LOBBY_UPDATE', lobby: sanitizeLobby(room) };
  for (const seat of room.seats) {
    if (seat.player && !seat.player.isBot && seat.player.socket) {
      sendTo(seat.player.socket, data);
    }
  }
}

function broadcastGameState(room) {
  if (!room.game) return;
  const { game } = room;

  for (const seat of room.seats) {
    if (!seat.player || seat.player.isBot || !seat.player.socket) continue;
    const seatIdx = seat.seatIndex;

    const payload = {
      type: 'GAME_STATE',
      roomId: room.id,
      seat: seatIdx,
      status: room.status,
      game: {
        roundNumber: game.roundNumber,
        playerCount: game.playerCount,
        turn: game.turn,
        moveNumber: room.moveNumber,
        matchNumber: room.matchNumber,
        phase: game.phase,
        scores: game.scores,
        starter: game.starter,
        forcedTileId: game.turn === seatIdx ? game.forcedTileId : null,
        passCount: game.passCount,
        lastMove: game.lastMove?.kind === 'draw' && game.lastMove.seat !== seatIdx
          ? { kind: 'draw', seat: game.lastMove.seat, drawn: game.lastMove.drawn }
          : game.lastMove,
        result: game.result,
        winner: game.winner,
        board: game.board,
        stockCount: game.stock.length,
        myHand: game.hands[seatIdx] || [],
        otherHands: game.hands.map((hand, idx) => ({
          seat: idx,
          count: hand.length,
          name: room.seats[idx]?.player?.name || ('Игрок ' + (idx + 1)),
          isTeammate: room.mode === 4 && (idx % 2 === seatIdx % 2) && idx !== seatIdx,
          tiles: game.phase !== 'playing' ? hand : undefined
        }))
      }
    };

    sendTo(seat.player.socket, payload);
  }
}

function checkAndTriggerBot(room) {
  if (room.status !== 'playing' || !room.game) return;
  const currentSeat = room.game.turn;
  const seatInfo = room.seats[currentSeat];

  if (seatInfo && seatInfo.player && seatInfo.player.isBot) {
    clearTimeout(room.botTimer);
    room.botTimer = setTimeout(() => {
      if (room.status !== 'playing' || !room.game || room.game.turn !== currentSeat) return;

      const move = engine.chooseBotMove(room.game);
      if (move) {
        console.log(`[BOT] Room ${room.id}: Bot at seat ${currentSeat} plays ${move.tileId} on side ${move.side}`);
        engine.play(room.game, move.tileId, move.side);
      } else {
        console.log(`[BOT] Room ${room.id}: Bot at seat ${currentSeat} draws or passes`);
        engine.drawOrPass(room.game);
      }

      if (room.game.phase === 'match-over') room.status = 'match_over';
      else if (room.game.phase === 'round-over') room.status = 'round_over';

      room.moveNumber++;
      broadcastGameState(room);
      checkAndTriggerBot(room);
    }, 850);
  }
}

function startGame(room) {
  clearTimeout(room.botTimer);
  room.status = 'playing';
  room.game = engine.createGame(room.mode);
  room.moveNumber = 0;
  room.matchNumber = (room.matchNumber ?? 0) + 1;
  console.log(`[GAME] Room ${room.id}: Started 2×2 match! Starter seat: ${room.game.starter}`);
  broadcastGameState(room);
  checkAndTriggerBot(room);
}

function handleMessage(socket, messageRaw) {
  let msg;
  try {
    msg = JSON.parse(messageRaw);
  } catch {
    return;
  }

  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
  const { type, roomId, name, seatIndex, tileId, side, resumeToken } = msg;

  if (type === 'PING') {
    sendTo(socket, { type: 'PONG' });
    return;
  }

  const normRoomId = normalizeRoomCode(roomId);

  try {
    if (type === 'CREATE_ROOM') {
      if (socket.roomId) return;
      const newId = generateRoomId();
      const player = createPlayer(socket, name, 'Хост', true);
      const room = createRoom(newId, player);
      attachPlayer(socket, room, player);
      broadcastLobby(room);
      return;
    }

    const room = rooms.get(normRoomId);
    if (!room) {
      sendTo(socket, { type: 'ERROR', code: 'ROOM_NOT_FOUND', message: 'Комната не найдена' });
      return;
    }

    if (type === 'JOIN_ROOM') {
      if (socket.roomId) return;
      if (resumeToken) {
        const existingSeat = room.seats.find(s => !s.player?.isBot && s.player?.resumeToken === resumeToken);
        if (!existingSeat) {
          sendTo(socket, { type: 'ERROR', code: 'RESUME_EXPIRED', message: 'Сохранённое место больше недоступно.' });
          return;
        }
        attachPlayer(socket, room, existingSeat.player);
        broadcastLobby(room);
        if (room.game) {
          broadcastGameState(room);
        }
        return;
      }

      if (room.status !== 'lobby') {
        sendTo(socket, { type: 'ERROR', message: 'Партия уже началась' });
        return;
      }

      // Assign to first empty seat
      const emptySeat = room.seats.find(s => !s.player);
      if (!emptySeat) {
        sendTo(socket, { type: 'ERROR', message: 'В комнате нет свободных мест' });
        return;
      }

      emptySeat.player = createPlayer(socket, name, 'Игрок ' + (emptySeat.seatIndex + 1), false);
      attachPlayer(socket, room, emptySeat.player);
      broadcastLobby(room);
      return;
    }

    const actor = room.seats.find(seat => seat.player?.socket === socket && !seat.player.isBot);
    if (!actor || socket.roomId !== room.id) return;
    const playerId = actor.player.id;

    if (type === 'QUICK_MESSAGE') {
      const { messageId } = msg;
      if (!room.game || typeof messageId !== 'string' || !Object.hasOwn(quickMessages, messageId)) return;
      const now = Date.now();
      if (now - (actor.player.lastQuickMessageAt ?? 0) < quickMessageInterval) return;
      actor.player.lastQuickMessageAt = now;
      const payload = { type, roomId: room.id, seat: actor.seatIndex, messageId };
      for (const seat of room.seats) sendTo(seat.player?.socket, payload);
      return;
    }

    if (type === 'LEAVE_ROOM') {
      if (room.status === 'lobby') {
        actor.player = null;
        if (playerId === room.hostId) {
          room.hostId = room.seats.find(seat => seat.player?.socket && !seat.player.isBot)?.player.id;
        }
        if (!room.hostId) rooms.delete(room.id);
        else broadcastLobby(room);
      }
      socket.close();
      return;
    }

    // Seat picking in lobby
    if (type === 'CHOOSE_SEAT' && room.status === 'lobby') {
      const currentSeat = room.seats.find(s => s.player && s.player.id === playerId);
      const targetSeat = room.seats[seatIndex];

      if (targetSeat && !targetSeat.player && currentSeat) {
        targetSeat.player = currentSeat.player;
        currentSeat.player = null;
        console.log(`[ROOM] Room ${roomId}: Player ${targetSeat.player.name} moved to seat ${seatIndex}`);
        broadcastLobby(room);
      }
      return;
    }

    // Toggle Bot in empty seat
    if (type === 'TOGGLE_BOT' && room.status === 'lobby' && playerId === room.hostId) {
      const targetSeat = room.seats[seatIndex];
      if (targetSeat) {
        if (!targetSeat.player) {
          targetSeat.player = {
            id: 'bot_' + seatIndex,
            name: 'Бот ' + (seatIndex + 1),
            isReady: true,
            isBot: true,
            socket: null
          };
          console.log(`[ROOM] Room ${roomId}: Added Bot to seat ${seatIndex}`);
        } else if (targetSeat.player.isBot) {
          console.log(`[ROOM] Room ${roomId}: Removed Bot from seat ${seatIndex}`);
          targetSeat.player = null;
        }
        broadcastLobby(room);
      }
      return;
    }

    // Randomize teams
    if (type === 'RANDOMIZE_TEAMS' && room.status === 'lobby' && playerId === room.hostId) {
      const currentPlayers = room.seats.map(s => s.player).filter(Boolean);
      // Shuffle
      for (let i = currentPlayers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [currentPlayers[i], currentPlayers[j]] = [currentPlayers[j], currentPlayers[i]];
      }
      for (let i = 0; i < 4; i++) {
        room.seats[i].player = currentPlayers[i] || null;
      }
      console.log(`[ROOM] Room ${roomId}: Teams randomized`);
      broadcastLobby(room);
      return;
    }

    // Toggle Ready
    if (type === 'TOGGLE_READY' && room.status === 'lobby') {
      const seat = room.seats.find(s => s.player && s.player.id === playerId);
      if (seat && !seat.player.isBot) {
        seat.player.isReady = !seat.player.isReady;
        console.log(`[ROOM] Room ${roomId}: Player ${seat.player.name} ready status: ${seat.player.isReady}`);
        broadcastLobby(room);
      }
      return;
    }

    // Start match
    if (type === 'START_GAME' && room.status === 'lobby' && playerId === room.hostId) {
      const occupied = room.seats.filter(s => s.player);
      const allReady = occupied.every(s => s.player.isReady && (s.player.isBot || s.player.socket));
      if (occupied.length === 4 && allReady) {
        console.log(`[ROOM] Room ${roomId}: Starting match with 4 ready players`);
        startGame(room);
      } else {
        sendTo(socket, { type: 'ERROR', message: 'Для старта 2×2 нужны 4 готовых игрока или бота' });
      }
      return;
    }

    // Game actions
    if (type === 'PLAY_TILE' && room.status === 'playing' && room.game) {
      const seatIdx = actor.seatIndex;
      if (seatIdx === room.game.turn) {
        engine.play(room.game, tileId, side);
        console.log(`[PLAY] Room ${roomId}: Seat ${seatIdx} played ${tileId} on side ${side}`);
        if (room.game.phase === 'match-over') room.status = 'match_over';
        else if (room.game.phase === 'round-over') room.status = 'round_over';
        room.moveNumber++;
        broadcastGameState(room);
        checkAndTriggerBot(room);
      }
      return;
    }

    if (type === 'DRAW_OR_PASS' && room.status === 'playing' && room.game) {
      const seatIdx = actor.seatIndex;
      if (seatIdx === room.game.turn) {
        engine.drawOrPass(room.game);
        console.log(`[PLAY] Room ${roomId}: Seat ${seatIdx} pass/draw`);
        if (room.game.phase === 'match-over') room.status = 'match_over';
        else if (room.game.phase === 'round-over') room.status = 'round_over';
        room.moveNumber++;
        broadcastGameState(room);
        checkAndTriggerBot(room);
      }
      return;
    }

    if (type === 'NEXT_ROUND' && (room.status === 'round_over' || room.status === 'match_over')) {
      if (room.status === 'match_over') {
        startGame(room);
        return;
      } else {
        engine.nextRound(room.game);
        room.status = 'playing';
      }
      console.log(`[GAME] Room ${roomId}: Advanced to next round ${room.game.roundNumber}`);
      broadcastGameState(room);
      checkAndTriggerBot(room);
    }
  } catch (err) {
    console.error(`[ERROR] Processing message ${type} in room ${roomId}:`, err);
    sendTo(socket, { type: 'ERROR', message: 'Ошибка сервера: ' + err.message });
  }
}

function handleDisconnect(socket) {
  const { roomId, playerId } = socket;
  if (!roomId || !playerId) return;
  const room = rooms.get(roomId);
  if (!room) return;

  const seat = room.seats.find(s => s.player && s.player.id === playerId);
  if (seat && !seat.player.isBot) {
    if (seat.player.socket === socket) {
      seat.player.socket = null;
      console.log(`[DISCONNECT] Player ${seat.player.name} socket closed in room ${roomId}`);
      broadcastLobby(room);
    }
  }

  // Grace period before cleaning up empty rooms (gives 2 minutes for refresh/reconnect)
  const hasHumans = room.seats.some(s => s.player && !s.player.isBot && s.player.socket);
  if (!hasHumans) {
    clearTimeout(room.cleanupTimer);
    console.log(`[ROOM] Room ${roomId} has no active connections; scheduled cleanup in 120s`);
    room.cleanupTimer = setTimeout(() => {
      const stillActive = room.seats.some(s => s.player && !s.player.isBot && s.player.socket);
      if (!stillActive) {
        clearTimeout(room.botTimer);
        rooms.delete(roomId);
        console.log(`[ROOM] Room ${roomId} deleted after 120s inactivity`);
      }
    }, 120000);
  }
}

// HTTP Server
const server = http.createServer((req, res) => {
  const requested = req.url.split('?')[0];
  const file = requested === '/' ? 'index.html' : requested.slice(1);
  if (!browserFiles.has(file)) {
    res.writeHead(404).end();
    return;
  }
  const ext = path.extname(file);
  const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }[ext];
  fs.readFile(path.join(__dirname, file), (err, content) => {
    if (err) {
      res.writeHead(500).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': type + '; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(content);
  });
});

// WebSocket Server
const wss = new WebSocketServer({ server, maxPayload: 4096 });

wss.on('connection', socket => {
  socket.on('message', data => handleMessage(socket, data.toString()));
  socket.on('close', () => handleDisconnect(socket));
  socket.on('error', () => handleDisconnect(socket));
});

server.listen(PORT, HOST, () => {
  console.log(`Domino 71: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${server.address().port}`);
});

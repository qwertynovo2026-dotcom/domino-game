(function () {
  'use strict';

  // Network Multiplayer Client Module for Domino 71
  const net = {
    socket: null,
    roomId: null,
    playerId: null,
    resumeToken: null,
    playerName: 'Игрок',
    mySeat: null,
    isHost: false,
    isConnected: false,
    lobbyState: null,
    gameState: null,
    listeners: {
      lobby: [],
      gameState: [],
      quickMessage: [],
      error: [],
      connected: []
    }
  };

  const resumeKey = 'domino71_net_room_session';
  try {
    const savedName = sessionStorage.getItem('domino71_net_player_name');
    if (savedName) {
      net.playerName = savedName;
    } else {
      net.playerName = 'Игрок ' + (1 + Math.floor(Math.random() * 89));
      sessionStorage.setItem('domino71_net_player_name', net.playerName);
    }
  } catch {
    net.playerName = 'Игрок ' + (1 + Math.floor(Math.random() * 89));
  }

  let heartbeatTimer = null;
  let reconnectTimer = null;
  let connecting = null;

  function forgetRoom() {
    net.roomId = null;
    net.playerId = null;
    net.resumeToken = null;
    net.mySeat = null;
    net.lobbyState = null;
    net.gameState = null;
    net.isHost = false;
    try { sessionStorage.removeItem(resumeKey); } catch {}
  }

  function startHeartbeat() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (net.socket && net.socket.readyState === WebSocket.OPEN) {
        net.socket.send(JSON.stringify({ type: 'PING' }));
      }
    }, 3500);
  }

  function stopHeartbeat() {
    clearInterval(heartbeatTimer);
  }

  function getWsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // If opened via file:// fallback to localhost:3000
    if (location.protocol === 'file:') return 'ws://localhost:3000';
    return `${proto}//${location.host}`;
  }

  function connect() {
    if (net.socket?.readyState === WebSocket.OPEN) return Promise.resolve(net.socket);
    if (connecting) return connecting;

    connecting = new Promise((resolve, reject) => {
      try {
        const wsUrl = getWsUrl();
        const ws = new WebSocket(wsUrl);
        net.socket = ws;

        ws.onopen = () => {
          if (net.socket !== ws) return;
          net.isConnected = true;
          startHeartbeat();
          emit('connected', true);
          resolve(ws);
        };

        ws.onmessage = (event) => {
          if (net.socket === ws) handleIncoming(event.data);
        };

        ws.onclose = (event) => {
          reject(new Error('Не удалось подключиться к серверу онлайн-игры.'));
          if (net.socket !== ws) return;
          net.socket = null;
          net.isConnected = false;
          stopHeartbeat();
          emit('connected', false);
          if (event.code === 4001) {
            forgetRoom();
            emit('error', 'Это место открыто в другой вкладке.');
            return;
          }
          if (net.roomId && net.resumeToken) {
            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
              if (net.roomId && net.resumeToken) {
                connect().then(() => {
                  if (net.roomId) send('JOIN_ROOM', { resumeToken: net.resumeToken });
                }).catch(() => {});
              }
            }, 1500);
          }
        };

        ws.onerror = () => {
          if (net.socket !== ws) return;
          net.isConnected = false;
          stopHeartbeat();
          emit('error', 'Не удалось подключиться к серверу онлайн-игры.');
          reject(new Error('Не удалось подключиться к серверу онлайн-игры.'));
        };
      } catch (e) {
        reject(e);
      }
    }).finally(() => { connecting = null; });
    return connecting;
  }

  function emit(type, data) {
    for (const fn of net.listeners[type] || []) {
      try { fn(data); } catch (e) { console.error(e); }
    }
  }

  function send(type, payload = {}) {
    if (!net.socket || net.socket.readyState !== WebSocket.OPEN) {
      emit('error', 'Соединение с сервером потеряно');
      return;
    }
    net.socket.send(JSON.stringify({
      type,
      roomId: net.roomId,
      ...payload
    }));
  }

  function handleIncoming(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'PONG') return;

    if (msg.type === 'ERROR') {
      if (msg.code === 'ROOM_NOT_FOUND' || msg.code === 'RESUME_EXPIRED') forgetRoom();
      emit('error', msg.message);
      return;
    }

    if (msg.type === 'ROOM_JOINED') {
      net.roomId = msg.roomId;
      net.playerId = msg.playerId;
      net.resumeToken = msg.resumeToken;
      try {
        sessionStorage.setItem(resumeKey, JSON.stringify({ roomId: msg.roomId, resumeToken: msg.resumeToken }));
      } catch {}
      return;
    }

    if (msg.type === 'LOBBY_UPDATE') {
      net.lobbyState = msg.lobby;
      net.roomId = msg.lobby.roomId;
      net.isHost = (msg.lobby.hostId === net.playerId);
      const mySeatInfo = msg.lobby.seats.find(s => s.player && s.player.id === net.playerId);
      net.mySeat = mySeatInfo ? mySeatInfo.seatIndex : null;
      emit('lobby', msg.lobby);
      return;
    }

    if (msg.type === 'GAME_STATE') {
      net.gameState = msg.game;
      net.mySeat = msg.seat;
      emit('gameState', msg);
    }
    if (msg.type === 'QUICK_MESSAGE' && msg.roomId === net.roomId) {
      emit('quickMessage', msg);
    }
  }

  net.on = function (event, callback) {
    if (net.listeners[event]) net.listeners[event].push(callback);
  };

  net.createRoom = async function (name) {
    if (name) {
      net.playerName = name.trim();
      try { sessionStorage.setItem('domino71_net_player_name', net.playerName); } catch {}
    }
    await connect();
    send('CREATE_ROOM', { name: net.playerName });
  };

  function normalizeRoomCode(code) {
    if (!code || typeof code !== 'string') return '';
    const cyrillicMap = {
      'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'К': 'K',
      'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X', 'У': 'Y'
    };
    return code.trim().toUpperCase().replace(/[АВСЕНКМОРТХУ]/g, ch => cyrillicMap[ch] || ch).slice(0, 4);
  }

  net.joinRoom = async function (roomId, name) {
    if (name) {
      net.playerName = name.trim();
      try { sessionStorage.setItem('domino71_net_player_name', net.playerName); } catch {}
    }
    await connect();
    send('JOIN_ROOM', { roomId: normalizeRoomCode(roomId), name: net.playerName });
  };

  net.resumeRoom = async function () {
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem(resumeKey) || 'null'); } catch {}
    if (!saved?.roomId || !saved?.resumeToken) return false;
    net.roomId = saved.roomId;
    net.resumeToken = saved.resumeToken;
    await connect();
    send('JOIN_ROOM', { resumeToken: saved.resumeToken });
    return true;
  };

  net.chooseSeat = function (seatIndex) {
    send('CHOOSE_SEAT', { seatIndex });
  };

  net.toggleBot = function (seatIndex) {
    send('TOGGLE_BOT', { seatIndex });
  };

  net.randomizeTeams = function () {
    send('RANDOMIZE_TEAMS');
  };

  net.toggleReady = function () {
    send('TOGGLE_READY');
  };

  net.startGame = function () {
    send('START_GAME');
  };

  net.playTile = function (tileId, side) {
    send('PLAY_TILE', { tileId, side });
  };

  net.drawOrPass = function () {
    send('DRAW_OR_PASS');
  };

  net.nextRound = function () {
    send('NEXT_ROUND');
  };

  net.sendQuickMessage = function (messageId) {
    send('QUICK_MESSAGE', { messageId });
  };

  net.leave = function () {
    stopHeartbeat();
    clearTimeout(reconnectTimer);
    const socket = net.socket;
    if (socket?.readyState === WebSocket.OPEN && net.roomId) send('LEAVE_ROOM');
    net.socket = null;
    net.isConnected = false;
    socket?.close();
    forgetRoom();
  };

  globalThis.DominoNet = net;
})();

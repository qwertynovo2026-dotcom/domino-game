(function () {
  'use strict';

  const byId = id => document.getElementById(id);
  const engine = globalThis.Domino71;
  const layout = globalThis.DominoBoardLayout;
  const turnTitle = byId('turn-title');
  const turnDetail = byId('turn-detail');
  if (!engine || !layout) {
    turnTitle.textContent = 'Стол недоступен';
    turnDetail.textContent = 'Откройте index.html из папки, где находятся остальные файлы игры.';
    return;
  }

  const boardView = byId('board-view');
  const boardLayer = byId('board-layer');
  const cueLayer = element('div', 'move-cue-layer');
  cueLayer.setAttribute('aria-hidden', 'true');
  const quickChatLayer = element('div', 'quick-chat-layer');
  quickChatLayer.setAttribute('aria-hidden', 'true');
  const quickChatAnnouncement = element('div', 'quick-chat-announcement');
  quickChatAnnouncement.setAttribute('role', 'status');
  document.body.append(cueLayer, quickChatLayer, quickChatAnnouncement);
  const hand = byId('hand');
  const selfSeat = byId('self-seat');
  const otherSeats = byId('seats');
  const roundHands = byId('round-hands');
  const roundRemainderTotal = byId('round-remainder-total');
  const drawButton = byId('draw');
  const quickChat = byId('quick-chat');
  const quickChatMenu = byId('quick-chat-menu');
  const quickMessages = globalThis.DominoQuickMessages ?? {};
  const quickBubbles = new Map();
  const continueButton = byId('continue');
  const quickEnds = byId('quick-ends');
  const modeMenu = byId('mode-menu');
  const rules = byId('rules');
  const log = byId('events-log');
  const historyText = byId('match-history');
  const historyStatus = byId('history-status');
  const historyDialog = byId('history-dialog');
  const historyOpenBtn = byId('history-open');
  const turnHistoryBtn = byId('turn-history-btn');
  const historyTabsEl = byId('history-tabs');
  const historyBodyEl = byId('history-body');
  const historyMatchInfo = byId('history-match-info');
  const historyCopyBtn = byId('history-copy-btn');
  const historyCopyStatus = byId('history-copy-status');
  const directions = ['Левая ветка', 'Правая ветка', 'Верхняя ветка', 'Нижняя ветка'];
  const pipSlots = [[], [3], [0, 6], [0, 3, 6], [0, 1, 5, 6], [0, 1, 3, 5, 6], [0, 1, 2, 4, 5, 6]];
  const wideSixSlots = [0, 7, 1, 5, 8, 6];
  const historyPrefix = 'domino71.journal.v1.';
  const historyLimit = 30;
  const memoryHistory = new Map();
  const modeLabels = { 2: '1×1', 3: 'Втроём', 4: '2×2' };
  const seatPositions = {
    2: ['bottom', 'top'],
    3: ['bottom', 'left', 'right'],
    4: ['bottom', 'left', 'top', 'right']
  };
  let historyStorage;
  try {
    historyStorage = window.localStorage;
  } catch {
    historyStorage = null;
  }

  const telemetryKey = 'domino71.telemetry.events';
  const telemetryLimit = 300;
  let anonUserId = 'anon_' + Math.random().toString(36).slice(2, 10);
  if (historyStorage) {
    try {
      const stored = historyStorage.getItem('domino71.anon_id');
      if (stored) {
        anonUserId = stored;
      } else {
        anonUserId = 'anon_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
        historyStorage.setItem('domino71.anon_id', anonUserId);
      }
    } catch {
      // Storage unavailable
    }
  }
  const sessionId = 'ses_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  let roundStartTime = Date.now();
  let matchStartTime = Date.now();
  const flightDuration = 390;
  const botDrawPause = 950;
  const turnPulseDuration = 600;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let game;
  let currentJournal;
  let matchNumber = Math.max(0, ...recentMatches().map(entry => entry.number));
  let selectedTileId = null;
  let botTimer;
  let moveCue = null;
  let seatActions = [];
  let pendingDraw = null;
  let activeFlight = null;
  let activeSeat = null;
  let activeSince = 0;

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function domino(a, b, vertical, tag = 'div') {
    const node = element(tag, vertical ? 'domino vertical' : 'domino');
    if (tag === 'button') node.type = 'button';
    else node.setAttribute('role', 'img');
    node.setAttribute('aria-label', a + '–' + b);
    for (const count of [a, b]) {
      const half = element('span', 'half');
      half.setAttribute('aria-hidden', 'true');
      for (const slot of count === 6 && !vertical ? wideSixSlots : pipSlots[count]) {
        const pip = element('span', 'pip');
        pip.dataset.slot = slot;
        half.append(pip);
      }
      node.append(half);
    }
    return node;
  }

  function tileCount(count) {
    const last = count % 10;
    const suffix = count % 100 >= 11 && count % 100 <= 14 ? 'костей'
      : last === 1 ? 'кость' : last >= 2 && last <= 4 ? 'кости' : 'костей';
    return count + ' ' + suffix;
  }

  function scorePoints(points) {
    const last = points % 10;
    const form = points % 100 >= 11 && points % 100 <= 14 ? 'очков'
      : last === 1 ? 'очко' : last >= 2 && last <= 4 ? 'очка' : 'очков';
    return points + ' ' + form;
  }

  let isNetworkMode = false;
  let netPlayerNames = ['Вы', 'Соперник', 'Напарник', 'Соперник'];
  let networkPaused = false;
  let networkSnapshot = null;

  function seatName(seat) {
    if (isNetworkMode) {
      return netPlayerNames[seat] || ('Игрок ' + (seat + 1));
    }
    if (seat === 0) return 'Вы';
    if (game.playerCount === 2) return 'Соперник';
    if (game.playerCount === 4 && seat === 2) return 'Напарник';
    return 'Бот ' + seat;
  }

  function scoreName(index) {
    if (game.playerCount < 4) return seatName(index);
    return index === 0 ? 'Ваша пара' : 'Соперники';
  }

  function recentMatches() {
    const matches = new Map();
    if (historyStorage) {
      try {
        for (const key of Object.keys(historyStorage)) {
          if (!key.startsWith(historyPrefix)) continue;
          try {
            const match = JSON.parse(historyStorage.getItem(key));
            if (Array.isArray(match?.events) && Number.isFinite(match.startedAt) && Number.isFinite(match.number)) {
              matches.set(key, match);
            }
          } catch {
            // A corrupt record does not prevent access to the other matches.
          }
        }
      } catch {
        historyStorage = null;
      }
    }
    for (const [key, match] of memoryHistory) matches.set(key, match);
    return [...matches].map(([key, match]) => ({ ...match, key }))
      .sort((first, second) => second.startedAt - first.startedAt);
  }

  function describeMatch(match) {
    const timestamp = new Date(match.startedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'medium' });
    const firstMoves = new Map(match.events.filter(entry => entry.event === 'opening_move')
      .map(entry => [entry.round, entry]));
    const lines = match.events.filter(entry => entry.event === 'round_start').map(entry => {
      const played = firstMoves.get(entry.round);
      if (!played) return 'Кон ' + entry.round + ' · Ставщик — ' + entry.starter + ' (ход ожидается)';
      const difference = played.seat === entry.starterSeat ? '' : ' · по очереди: ' + entry.starter;
      return 'Кон ' + entry.round + ' · Первый ход: ' + played.player + ' (' + played.tile + ')' + difference;
    });
    const finish = match.events.find(entry => entry.event === 'round_end' && entry.matchWinner);
    if (finish) lines.push('Итог · ' + finish.matchWinner + ' · ' + finish.scores.join(' : '));
    return ['Партия ' + match.number + ' · ' + modeLabels[match.players] + ' · ' + timestamp, ...lines].join('\n');
  }

  function refreshJournal() {
    const matches = recentMatches().slice(0, historyLimit);
    historyStatus.textContent = historyStorage
      ? 'Хранится в этом браузере. Показаны последние ' + historyLimit + ' партий.'
      : 'Браузер не сохраняет журнал. Записи доступны до закрытия вкладки.';
    historyText.value = matches.map(describeMatch).join('\n\n');
    log.value = matches.slice().reverse().flatMap(match => (
      match.events.map(entry => JSON.stringify({ ...entry, matchId: match.id }))
    )).join('\n');
  }

  function record(type, details = {}) {
    const now = Date.now();
    const event = {
      event: type,
      anonUserId,
      sessionId,
      timestamp: new Date(now).toISOString(),
      timestampMs: now,
      match: currentJournal?.number ?? 1,
      round: game?.roundNumber ?? 1,
      players: game?.playerCount ?? 2,
      ...details
    };
    if (type === 'round_start') {
      roundStartTime = now;
      if (game) {
        event.starter = seatName(game.starter);
        event.starterSeat = game.starter + 1;
      }
    }
    if (type === 'round_end' && game) {
      event.durationMs = now - roundStartTime;
      event.reason = game.result?.type || 'unknown';
      if (game.phase === 'match-over') {
        event.matchWinner = scoreName(game.winner);
        event.scores = game.scores.slice();
        event.matchDurationMs = now - matchStartTime;
      }
    }
    if (currentJournal) currentJournal.events.push(event);

    if (historyStorage) {
      if (currentJournal) {
        try {
          historyStorage.setItem(historyPrefix + currentJournal.id, JSON.stringify(currentJournal));
        } catch {
          historyStorage = null;
        }
      }
      try {
        let stream = [];
        try {
          stream = JSON.parse(historyStorage.getItem(telemetryKey) || '[]');
        } catch {}
        if (!Array.isArray(stream)) stream = [];
        stream.push(event);
        if (stream.length > telemetryLimit) stream = stream.slice(-telemetryLimit);
        historyStorage.setItem(telemetryKey, JSON.stringify(stream));
      } catch {}
    }

    try {
      window.dispatchEvent(new CustomEvent('domino:telemetry', { detail: event }));
    } catch {}

    try {
      const isMilestone = ['voluntary_replay', 'voluntary_restart', 'round_start', 'round_end', 'session_init', 'mode_switch'].includes(type);
      console.log(
        `%c[DOMINO TELEMETRY] %c${type}`,
        'color: #0b6b47; font-weight: bold;',
        isMilestone ? 'color: #d96200; font-weight: bold;' : 'color: #555;',
        event
      );
    } catch {}

    if (rules.open) refreshJournal();
  }

  // --- Move History Protocol & Viewer ---
  let matchHistoryData = {
    matchNumber: 1,
    playerCount: 2,
    startedAt: Date.now(),
    rounds: [],
    winner: null,
    finalScores: []
  };
  let activeHistoryRoundFilter = 'all';
  let tilesDrawnThisTurn = {};
  let lastLoggedNetworkMove = null;

  function initMatchHistory(players, num = 1) {
    matchHistoryData = {
      matchNumber: num,
      playerCount: players,
      startedAt: Date.now(),
      rounds: [],
      winner: null,
      finalScores: []
    };
    tilesDrawnThisTurn = {};
    lastLoggedNetworkMove = null;
    activeHistoryRoundFilter = 'all';
  }

  function ensureRoundHistory(roundNumber, starterSeat) {
    let round = matchHistoryData.rounds.find(r => r.roundNumber === roundNumber);
    if (!round) {
      round = {
        roundNumber,
        starterSeat,
        starterName: seatName(starterSeat),
        startedAt: Date.now(),
        moves: [],
        result: null
      };
      matchHistoryData.rounds.push(round);
    }
    return round;
  }

  function recordHistoryPlay(seat, tile, side, points = 0, sum = 0) {
    const round = ensureRoundHistory(game?.roundNumber ?? 1, game?.starter ?? 0);
    const drawn = tilesDrawnThisTurn[seat] || 0;
    tilesDrawnThisTurn[seat] = 0;
    const moveNum = round.moves.length + 1;
    const isMe = (isNetworkMode && net?.mySeat === seat) || (!isNetworkMode && seat === 0);
    const avatar = isNetworkMode
      ? (networkSnapshot?.seats?.find(s => s.seatIndex === seat)?.player?.isBot ? '🤖' : '👤')
      : (seat === 0 ? '👤' : '🤖');

    const sideName = side === null ? 'центр («Дом»)' : (directions[side] || `ветка ${side}`);

    round.moves.push({
      moveNum,
      seat,
      playerName: seatName(seat),
      avatar,
      isMe,
      kind: 'play',
      tile: { a: tile.a, b: tile.b },
      side,
      sideName,
      points: points || 0,
      sum,
      drawn,
      time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    });

    if (historyDialog?.open) renderHistoryDialogContent();
  }

  function recordHistoryDraw(seat, count = 1) {
    tilesDrawnThisTurn[seat] = (tilesDrawnThisTurn[seat] || 0) + count;
  }

  function recordHistoryPass(seat, drawn = 0) {
    const round = ensureRoundHistory(game?.roundNumber ?? 1, game?.starter ?? 0);
    const drawnCount = drawn || tilesDrawnThisTurn[seat] || 0;
    tilesDrawnThisTurn[seat] = 0;
    const moveNum = round.moves.length + 1;
    const isMe = (isNetworkMode && net?.mySeat === seat) || (!isNetworkMode && seat === 0);
    const avatar = isNetworkMode
      ? (networkSnapshot?.seats?.find(s => s.seatIndex === seat)?.player?.isBot ? '🤖' : '👤')
      : (seat === 0 ? '👤' : '🤖');

    round.moves.push({
      moveNum,
      seat,
      playerName: seatName(seat),
      avatar,
      isMe,
      kind: 'pass',
      drawn: drawnCount,
      time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    });

    if (historyDialog?.open) renderHistoryDialogContent();
  }

  function recordHistoryRoundEnd(result, scores) {
    if (!result) return;
    const round = ensureRoundHistory(game?.roundNumber ?? 1, game?.starter ?? 0);
    round.result = {
      type: result.type,
      tied: result.tied,
      winnerSeat: result.seat,
      winnerName: result.seat !== null
        ? (game?.playerCount === 4 && result.seat % 2 === 0 ? 'Ваша пара' : seatName(result.seat))
        : 'Ничья',
      bonus: result.bonus || 0,
      remainders: result.remainders ? result.remainders.slice() : [],
      scores: scores ? scores.slice() : []
    };
    if (historyDialog?.open) renderHistoryDialogContent();
  }

  function recordHistoryMatchEnd(winner, scores) {
    matchHistoryData.winner = winner;
    matchHistoryData.winnerName = game?.playerCount === 4
      ? (winner === 0 ? 'Ваша пара' : 'Соперники')
      : scoreName(winner);
    matchHistoryData.finalScores = scores ? scores.slice() : [];
    if (historyDialog?.open) renderHistoryDialogContent();
  }

  function buildHistoryPlainText() {
    const modeStr = modeLabels[matchHistoryData.playerCount] || '1×1';
    const lines = [
      `=== ДОМИНО «ПЯТЁРОЧКА» · ПРОТОКОЛ МАТЧА ===`,
      `Партия № ${matchHistoryData.matchNumber} · Режим: ${modeStr}`,
      `Дата: ${new Date(matchHistoryData.startedAt).toLocaleString('ru-RU')}`,
      ``
    ];

    for (const round of matchHistoryData.rounds) {
      lines.push(`--- КОН № ${round.roundNumber} (Ставщик: ${round.starterName}) ---`);
      for (const m of round.moves) {
        let actionStr = '';
        if (m.kind === 'play') {
          actionStr = `поставил [${m.tile.a}|${m.tile.b}] · ${m.sideName}`;
          if (m.points > 0) actionStr += ` -> +${m.points} очк.`;
          actionStr += ` (сумма концов: ${m.sum})`;
        } else if (m.kind === 'pass') {
          actionStr = `Пас (стук)`;
        }
        if (m.drawn > 0) actionStr = `[взял из базара: ${m.drawn} шт.] ` + actionStr;
        lines.push(`${m.moveNum}. ${m.avatar} ${m.playerName}: ${actionStr}`);
      }

      if (round.result) {
        const typeStr = round.result.type === 'blocked' ? 'Рыба' : round.result.type === 'target' ? 'Цель 71 достигнута' : 'Домино';
        if (round.result.tied) {
          lines.push(`[ИТОГ КОНА № ${round.roundNumber}] ${typeStr}! Ничья.`);
        } else {
          lines.push(`[ИТОГ КОНА № ${round.roundNumber}] ${typeStr}! Победитель: ${round.result.winnerName} (+${round.result.bonus} за остаток).`);
          if (round.result.remainders?.length) {
            lines.push(`  Остатки на руках: ` + round.result.remainders.map((pts, s) => `${seatName(s)}: ${pts}`).join(', '));
          }
        }
        lines.push(`  Счёт партии после кона: ${round.result.scores.join(' : ')}`);
      }
      lines.push(``);
    }

    if (matchHistoryData.winner !== null) {
      lines.push(`=============================================`);
      lines.push(`🏆 ИТОГ ПАРТИИ: Победитель — ${matchHistoryData.winnerName} со счётом ${matchHistoryData.finalScores.join(' : ')}!`);
      lines.push(`=============================================`);
    }

    return lines.join('\n');
  }

  function renderHistoryDialogContent() {
    if (!historyDialog || !historyBodyEl) return;

    if (historyMatchInfo) {
      const modeStr = modeLabels[matchHistoryData.playerCount] || '1×1';
      historyMatchInfo.textContent = `Партия № ${matchHistoryData.matchNumber} · ${modeStr}`;
    }

    // Render filter tabs
    if (historyTabsEl) {
      const tabs = [];
      const allBtn = element('button', 'history-tab', 'Все коны');
      allBtn.type = 'button';
      allBtn.setAttribute('aria-pressed', String(activeHistoryRoundFilter === 'all'));
      allBtn.addEventListener('click', () => {
        activeHistoryRoundFilter = 'all';
        renderHistoryDialogContent();
        if (historyBodyEl) historyBodyEl.scrollTop = 0;
      });
      tabs.push(allBtn);

      for (const round of matchHistoryData.rounds) {
        const isCurrent = round.roundNumber === (game?.roundNumber ?? 1) && game?.phase === 'playing';
        const label = `Кон № ${round.roundNumber}${isCurrent ? ' (текущий)' : ''}`;
        const tabBtn = element('button', 'history-tab', label);
        tabBtn.type = 'button';
        tabBtn.setAttribute('aria-pressed', String(activeHistoryRoundFilter === round.roundNumber));
        tabBtn.addEventListener('click', () => {
          activeHistoryRoundFilter = round.roundNumber;
          renderHistoryDialogContent();
          if (historyBodyEl) historyBodyEl.scrollTop = 0;
        });
        tabs.push(tabBtn);
      }
      historyTabsEl.replaceChildren(...tabs);
    }

    // Filter rounds to display
    const roundsToRender = activeHistoryRoundFilter === 'all'
      ? matchHistoryData.rounds
      : matchHistoryData.rounds.filter(r => r.roundNumber === activeHistoryRoundFilter);

    if (!roundsToRender.length || roundsToRender.every(r => !r.moves.length && !r.result)) {
      historyBodyEl.replaceChildren(element('div', 'history-empty-state', 'Ходов пока нет. Поставьте первую кость на стол!'));
      return;
    }

    const cards = [];
    for (const round of roundsToRender) {
      const card = element('section', 'history-round-card');

      // Head
      const head = element('header', 'history-round-head');
      const titleBox = element('div', 'history-round-title');
      titleBox.append(
        element('h3', '', `Кон № ${round.roundNumber}`),
        element('span', 'history-starter-badge', `Ставщик: ${round.starterName}`)
      );
      const meta = element('span', 'history-round-meta', `Ходов: ${round.moves.length}`);
      head.append(titleBox, meta);
      card.append(head);

      // Moves list
      const list = element('ol', 'history-moves-list');
      for (const move of round.moves) {
        const item = element('li', move.points > 0 ? 'history-move-item scoring' : 'history-move-item');
        const num = element('span', 'history-move-num', `#${move.moveNum}`);
        const player = element('span', move.isMe ? 'history-player-badge is-me' : 'history-player-badge', `${move.avatar} ${move.playerName}`);

        const content = element('div', 'history-move-content');
        if (move.drawn > 0) {
          content.append(element('span', 'history-draw-badge', `базар: +${move.drawn}`));
        }

        if (move.kind === 'play') {
          const tileChip = element('span', 'history-tile-chip', `${move.tile.a}|${move.tile.b}`);
          const sideText = element('span', 'history-side-text', move.sideName);
          content.append(tileChip, sideText);
          if (move.points > 0) {
            content.append(element('strong', 'history-points-badge', `+${move.points} ${scorePointsWord(move.points)}`));
          }
          content.append(element('span', 'history-sum-text', `концы: ${move.sum}`));
        } else if (move.kind === 'pass') {
          content.append(element('span', 'history-pass-badge', 'Пас (стук)'));
        }

        item.append(num, player, content);
        list.append(item);
      }
      card.append(list);

      // Round result if finished
      if (round.result) {
        const foot = element('footer', 'history-round-result');
        const badgeBox = element('div', 'history-result-badge');
        badgeBox.append(element('span', '', round.result.type === 'blocked' ? '🐟' : '🏁'));

        const textBox = element('div');
        const typeStr = round.result.type === 'blocked' ? 'Рыба' : round.result.type === 'target' ? 'Цель 71 достигнута' : 'Домино';
        textBox.append(element('strong', '', `Кон окончен: ${typeStr}!`));

        let detailText = '';
        if (round.result.tied) {
          detailText = 'Ничья за наименьший остаток — бонус никому не начислен.';
        } else {
          detailText = `Победитель кона: ${round.result.winnerName} (+${round.result.bonus} ${scorePointsWord(round.result.bonus)} за остатки).`;
          if (round.result.remainders?.length) {
            const rems = round.result.remainders.map((pts, s) => `${seatName(s)}: ${pts}`).join(', ');
            detailText += ` Остатки: ${rems}.`;
          }
        }
        textBox.append(element('p', '', detailText));
        badgeBox.append(textBox);

        const scoreBox = element('div', 'history-round-score');
        scoreBox.innerHTML = `Счёт: <strong>${round.result.scores.join(' : ')}</strong>`;

        foot.append(badgeBox, scoreBox);
        card.append(foot);
      }

      cards.push(card);
    }

    // Match over summary if match finished and filter is 'all'
    if (matchHistoryData.winner !== null && (activeHistoryRoundFilter === 'all' || activeHistoryRoundFilter === matchHistoryData.rounds.length)) {
      const matchSummary = element('div', 'history-match-summary');
      matchSummary.append(
        element('div', 'history-trophy', '🏆'),
        (() => {
          const box = element('div');
          box.append(
            element('h4', '', 'Партия завершена!'),
            element('p', '', `Победитель: ${matchHistoryData.winnerName} со счётом ${matchHistoryData.finalScores.join(' : ')}`),
            element('small', '', `Всего сыграно конов: ${matchHistoryData.rounds.length}`)
          );
          return box;
        })()
      );
      cards.push(matchSummary);
    }

    historyBodyEl.replaceChildren(...cards);
  }

  function openHistoryDialog(filter = null) {
    if (filter !== null) {
      activeHistoryRoundFilter = filter;
    }
    renderHistoryDialogContent();
    try {
      if (!historyDialog.open) historyDialog.showModal();
    } catch {}
    setTimeout(() => {
      if (historyBodyEl) historyBodyEl.scrollTop = 0;
    }, 40);
  }

  historyOpenBtn?.addEventListener('click', () => openHistoryDialog());
  turnHistoryBtn?.addEventListener('click', () => {
    const filter = (game?.phase === 'match-over') ? 'all' : (game?.roundNumber ?? 'all');
    openHistoryDialog(filter);
  });

  historyCopyBtn?.addEventListener('click', async () => {
    const text = buildHistoryPlainText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
    if (historyCopyStatus) {
      historyCopyStatus.hidden = false;
      setTimeout(() => { if (historyCopyStatus) historyCopyStatus.hidden = true; }, 2200);
    }
  });

  function renderScore() {
    const scores = game.scores.map((score, index) => {
      const card = element('div', index === 0 ? 'score mine' : 'score');
      card.style.setProperty('--progress', Math.min(100, score / 71 * 100) + '%');
      const value = element('span', 'score-value');
      value.append(element('strong', '', score), element('small', '', '/ 71'));
      card.append(element('span', '', scoreName(index)), value);
      return card;
    });
    byId('scoreboard').replaceChildren(...scores);
    for (const button of modeMenu.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.mode) === game.playerCount));
    }
  }

  function renderSeats() {
    const playing = game.phase === 'playing';
    const currentSeat = playing ? game.turn : null;
    const now = performance.now();
    if (currentSeat !== activeSeat) {
      activeSeat = currentSeat;
      activeSince = now;
    }
    const nextSeat = (game.turn + 1) % game.playerCount;
    const [human, ...bots] = game.hands.map((tiles, seat) => {
      const active = seat === activeSeat;
      const row = element(seat === 0 ? 'div' : 'li', 'seat seat-' + seatPositions[game.playerCount][seat]);
      row.dataset.seat = seat;
      row.classList.toggle('active', active);
      if (active) row.setAttribute('aria-current', 'true');
      const count = element('strong', 'seat-count', tiles.length);
      count.setAttribute('aria-label', tileCount(tiles.length));
      const heading = element('div', 'seat-heading');
      const avatar = element('span', 'seat-avatar');
      if (isNetworkMode) {
        const netSeat = networkSnapshot?.seats?.find(s => s.seatIndex === seat);
        if (netSeat?.player?.isBot) {
          avatar.textContent = '🤖';
          avatar.title = 'Бот';
        } else if (netSeat?.player?.isHost) {
          avatar.textContent = '👑';
          avatar.title = 'Хост';
        } else {
          avatar.textContent = '👤';
          avatar.title = 'Игрок';
        }
      } else {
        avatar.textContent = seat === 0 ? '👤' : '🤖';
        avatar.title = seat === 0 ? 'Вы' : 'Бот';
      }
      heading.append(avatar, element('span', 'seat-name', seatName(seat)), count);
      const markers = element('div', 'seat-markers');
      if (seat === game.starter) markers.append(element('span', 'seat-starter', 'Ставщик'));
      if (active) {
        const currentMarker = element('span', 'seat-current', 'Ход');
        const elapsed = now - activeSince;
        if (elapsed < turnPulseDuration) {
          currentMarker.classList.add('seat-current-pop');
          currentMarker.style.setProperty('--pulse-delay', -elapsed + 'ms');
        }
        markers.append(currentMarker);
      }
      else if (playing && seat === nextSeat) markers.append(element('span', 'seat-next', 'Далее'));
      const action = pendingDraw === seat ? { text: 'Иду на базар' } : seatActions[seat];
      const actionLine = element('p', 'seat-action', action?.text);
      if (action?.points) actionLine.append(element('strong', 'seat-move-points', '+' + action.points));
      const details = element('div', 'seat-details');
      details.append(markers, actionLine);
      row.append(heading, details);
      return row;
    });
    selfSeat.replaceChildren(human);
    selfSeat.hidden = !playing;
    otherSeats.replaceChildren(...bots);
  }

  function lastMoveText() {
    const move = game.lastMove;
    if (!move) return '';
    const name = seatName(move.seat);
    if (move.kind === 'pass') return name + ' · Стучу.';
    if (move.kind === 'draw') {
      return move.seat === 0 ? 'Подходящая кость найдена.' : name + ' нашёл кость в базаре.';
    }
    return name + ' · ' + move.tile.a + '–' + move.tile.b + (move.points ? ' · +' + move.points : '') + '.';
  }

  function renderStatus(moves) {
    const playing = game.phase === 'playing';
    const yourTurn = playing && game.turn === 0;
    const turnCard = byId('turn-card');
    turnCard.classList.toggle('is-your-turn', yourTurn);
    turnDetail.classList.toggle('sr-only', pendingDraw !== null);
    if (isNetworkMode && networkPaused) {
      byId('turn-label').textContent = 'Онлайн';
      turnTitle.textContent = 'Соединение прервано';
      turnDetail.textContent = 'Ждём подключения к вашему столу.';
      continueButton.hidden = true;
      return;
    }

    if (playing) {
      byId('turn-label').textContent = yourTurn ? 'Ваш ход' : 'Ход соперника';
      turnTitle.textContent = yourTurn
        ? (selectedTileId ? 'Куда поставить?' : moves.length ? 'Выберите кость' : game.stock.length ? 'Возьмите из базара' : 'Пасуйте')
        : seatName(game.turn) + ' ходит';
      if (!yourTurn && game.playerCount === 4 && game.turn === 2) {
        byId('turn-label').textContent = 'Ход напарника';
      }
      turnDetail.textContent = pendingDraw !== null ? 'Иду на базар.' : lastMoveText() ||
        (game.starter === 0 ? 'Вы открываете кон.' : seatName(game.starter) + ' открывает кон.');
      continueButton.hidden = true;
      if (turnHistoryBtn) turnHistoryBtn.hidden = true;
      return;
    }

    const result = game.result;
    const matchOver = game.phase === 'match-over';
    byId('turn-label').textContent = matchOver ? 'Партия окончена' : 'Кон окончен';
    let title = result.type === 'blocked' ? 'Рыба' : 'Домино';
    if (matchOver) {
      title = game.winner === 0
        ? (game.playerCount === 4 ? 'Ваша пара победила' : 'Вы победили')
        : (game.playerCount === 4 ? 'Соперники победили' : 'Победил ' + scoreName(game.winner).toLowerCase());
    }
    turnTitle.textContent = title;
    const scoredAsTheyWentOut = result.type === 'out' && game.lastMove?.points > 0;
    let summary = result.tied
      ? 'Ничья.'
      : result.type === 'target'
        ? lastMoveText() + ' Цель в 71 очко достигнута.'
        : (scoredAsTheyWentOut ? lastMoveText() + ' Бонус' : seatName(result.seat) + ' · бонус') + ' за остаток +' + result.bonus + '.';
    if (game.playerCount === 4 && result.type === 'blocked' && !result.tied) {
      const team = result.seat % 2 === 0 ? 'Ваша пара' : 'Пара соперников';
      summary = seatName(result.seat) + ' · наименьший остаток. ' + team + ' получает ' + scorePoints(result.bonus) + '.';
    }
    const next = matchOver ? null : engine.nextStarter(game);
    turnDetail.textContent = summary + (matchOver ? ''
      : next === 0 ? ' Следующий кон открываете вы.' : ' Следующий кон открывает ' + seatName(next).toLowerCase() + '.');
    continueButton.textContent = matchOver ? 'Новая партия' : 'Следующий кон';
    continueButton.hidden = false;
    if (turnHistoryBtn) {
      turnHistoryBtn.textContent = matchOver ? '📜 Протокол всей партии' : '📜 Протокол кона';
      turnHistoryBtn.hidden = false;
    }
  }

  function position(node, x, y) {
    node.style.left = x + 'px';
    node.style.top = y + 'px';
  }

  function seatLabel(seat) {
    return seat === 0
      ? (selfSeat.hidden ? byId('round-hand-title-0') : selfSeat.querySelector('.seat-name'))
      : otherSeats.querySelector('[data-seat="' + seat + '"] .seat-name');
  }

  function positionMoveCue() {
    if (!moveCue) return;
    const { node, seat } = moveCue;
    const label = seatLabel(seat);
    if (!label) return;
    const name = label.getBoundingClientRect();
    const row = (label.closest('.seat') || label).getBoundingClientRect();
    const width = cueLayer.clientWidth;
    const height = cueLayer.clientHeight;
    const halfWidth = node.offsetWidth / 2;
    const halfHeight = node.offsetHeight / 2;
    const marginX = Math.min(width / 2, halfWidth + 8);
    const marginY = Math.min(height / 2, halfHeight + 12);
    const x = name.left + name.width / 2;
    const y = seat === 0 ? row.top - halfHeight - 6 : row.bottom + halfHeight + 6;
    position(node, Math.min(width - marginX, Math.max(marginX, x)),
      Math.min(height - marginY, Math.max(marginY, y)));
  }

  function clearMoveCue() {
    moveCue = null;
    cueLayer.replaceChildren();
    positionQuickMessages();
  }

  function showMoveCue({ seat, text, points = 0 }) {
    const node = element('div', points ? 'move-cue scoring' : 'move-cue', seatName(seat) + ' · ' + text + (points ? ' ' : ''));
    if (points) node.append(element('strong', 'move-cue-points', '+' + points));
    moveCue = { node, seat };
    cueLayer.replaceChildren(node);
    positionMoveCue();
    positionQuickMessages();
    node.addEventListener('animationend', () => {
      if (moveCue?.node === node) clearMoveCue();
    }, { once: true });
  }

  function positionQuickMessages() {
    const { clientWidth: width, clientHeight: height } = quickChatLayer;
    for (const [seat, { node }] of quickBubbles) {
      const label = seatLabel(seat);
      if (!label) continue;
      const name = label.getBoundingClientRect();
      const row = (label.closest('.seat') || label).getBoundingClientRect();
      const marginX = node.offsetWidth / 2 + 6;
      const marginY = node.offsetHeight / 2 + 6;
      const x = name.left + name.width / 2;
      const gap = moveCue?.seat === seat ? 38 : 0;
      const y = seat === 0 ? row.top - marginY - gap : row.bottom + marginY + gap;
      position(node, Math.min(width - marginX, Math.max(marginX, x)),
        Math.min(height - marginY, Math.max(marginY, y)));
    }
  }

  function removeQuickMessage(seat) {
    const bubble = quickBubbles.get(seat);
    if (!bubble) return;
    clearTimeout(bubble.timer);
    bubble.node.remove();
    quickBubbles.delete(seat);
  }

  function clearQuickMessages() {
    quickChat.open = false;
    quickChatAnnouncement.textContent = '';
    for (const seat of quickBubbles.keys()) removeQuickMessage(seat);
  }

  function showQuickMessage(seat, phrase) {
    removeQuickMessage(seat);
    const node = element('div', 'quick-chat-bubble', phrase);
    quickChatLayer.append(node);
    quickBubbles.set(seat, { node, timer: setTimeout(() => removeQuickMessage(seat), 2800) });
    quickChatAnnouncement.textContent = seatName(seat) + ' · ' + phrase;
    positionQuickMessages();
  }

  function clearFlight() {
    if (!activeFlight) return;
    activeFlight.animation.cancel();
    activeFlight.node.remove();
    activeFlight = null;
    boardLayer.querySelector('.in-flight')?.classList.remove('in-flight');
  }

  let activeTileScoreBubble = null;
  let lastScoredMoveKey = null;

  function clearTileScoreBubble() {
    if (activeTileScoreBubble) {
      activeTileScoreBubble.remove();
      activeTileScoreBubble = null;
    }
  }

  function scorePointsWord(points) {
    const last = points % 10;
    return points % 100 >= 11 && points % 100 <= 14 ? 'очков'
      : last === 1 ? 'очко' : last >= 2 && last <= 4 ? 'очка' : 'очков';
  }

  function showTileScoreBubble(piece, points, unit) {
    clearTileScoreBubble();
    if (!piece || !points || points <= 0) return;

    const halfH = piece.vertical ? unit : (unit * 0.5);
    const isNearTop = (piece.y - halfH - 35) < 0;
    const bubble = element('div', isNearTop ? 'tile-score-bubble below' : 'tile-score-bubble');
    const plus = element('span', 'score-plus', '+');
    const val = element('span', 'score-val', points);
    const label = element('span', 'score-label', scorePointsWord(points));
    bubble.append(plus, val, label);

    const x = piece.x;
    const y = isNearTop ? (piece.y + halfH + 8) : (piece.y - halfH - 8);
    position(bubble, x, y);
    boardLayer.append(bubble);
    activeTileScoreBubble = bubble;

    bubble.addEventListener('animationend', () => {
      if (activeTileScoreBubble === bubble) clearTileScoreBubble();
    }, { once: true });
  }

  function finishFlight() {
    const { cue, scoringInfo } = activeFlight;
    clearFlight();
    globalThis.DominoSound?.playTilePlace();
    if (scoringInfo) {
      showTileScoreBubble(scoringInfo.piece, scoringInfo.points, scoringInfo.unit);
      setTimeout(() => globalThis.DominoSound?.playScore(scoringInfo.points), 80);
    }
    if (cue) showMoveCue(cue);
  }

  function flightOrigin(seat, tileId) {
    if (reducedMotion.matches) return;
    const rackTile = seat === 0 ? [...hand.children].find(node => node.dataset.tileId === tileId) : null;
    const source = rackTile || (seat === 0 ? selfSeat.firstElementChild
      : otherSeats.querySelector('[data-seat="' + seat + '"]'));
    if (!source) return;
    const bounds = source.getBoundingClientRect();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  }

  function playWithFlight(tileId, side) {
    if (activeFlight) finishFlight();
    const origin = flightOrigin(game.turn, tileId);
    engine.play(game, tileId, side);
    afterAction(true, origin);
  }

  function startFlight(destination, origin, unit, cue, scoringInfo) {
    const bounds = destination.getBoundingClientRect();
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    const node = destination.cloneNode(true);
    node.classList.remove('board-piece', 'in-flight');
    node.classList.add('flight-tile');
    node.removeAttribute('role');
    node.removeAttribute('aria-label');
    node.setAttribute('aria-hidden', 'true');
    node.style.setProperty('--unit', unit + 'px');
    position(node, x, y);
    document.body.append(node);
    const dx = origin.x - x;
    const dy = origin.y - y;
    const centered = 'translate(-50%, -50%)';
    const animation = node.animate([
      { offset: 0, transform: `${centered} translate(${dx}px, ${dy}px)`, easing: 'cubic-bezier(.24, .66, .32, 1)' },
      { offset: .82, transform: centered + ' scale(1.025)' },
      { offset: .91, transform: centered + ' scale(.985)' },
      { offset: 1, transform: centered }
    ], { duration: flightDuration });
    activeFlight = { node, animation, tileId: game.lastMove.tile.id, cue, scoringInfo };
    animation.onfinish = () => {
      if (activeFlight?.animation === animation) finishFlight();
    };
  }

  function renderBoard(choices = [], origin, cue) {
    if (!game) return;
    const { board } = game;
    const width = boardView.clientWidth;
    const height = boardView.clientHeight;
    if (!board.root) {
      const empty = element('div', 'board-empty');
      const marker = element('span', '', '⁙');
      marker.setAttribute('aria-hidden', 'true');
      empty.append(marker, element('p', '', game.starter === 0 ? 'Поставьте первую кость' : 'Ждём первую кость'));
      boardLayer.replaceChildren(empty);
      positionMoveCue();
      return;
    }

    const { unit, pieces, tips } = layout.fit(board, engine.openEnds(board), width, height);
    boardLayer.style.setProperty('--board-unit', unit + 'px');
    const children = [];
    let destination;
    for (const piece of pieces) {
      const node = domino(piece.a, piece.b, piece.vertical);
      node.classList.add('board-piece');
      if (board.spinner && piece.tile === board.root) {
        node.classList.add('house');
        node.setAttribute('aria-label', 'Дом, ' + piece.a + '–' + piece.b);
      }
      if (origin && piece.tile.id === game.lastMove.tile.id) destination = node;
      if (destination === node || activeFlight?.tileId === piece.tile.id) node.classList.add('in-flight');
      position(node, piece.x, piece.y);
      children.push(node);
    }
    for (const tip of tips) {
      const active = choices.some(choice => choice.side === tip.side);
      const node = element(active ? 'button' : 'span', 'board-end', tip.pip);
      const label = directions[tip.side] + ', ' + tip.pip;
      if (active) {
        node.type = 'button';
        node.dataset.side = tip.side;
        node.setAttribute('aria-label', 'Поставить кость. ' + label);
        node.addEventListener('click', () => playSelected(tip.side));
      } else {
        node.setAttribute('aria-label', 'Открытый конец. ' + label);
      }
      position(node, tip.x, tip.y);
      children.push(node);
    }
    boardLayer.replaceChildren(...children);
    const lastMove = game.lastMove;
    const isScoringMove = lastMove && lastMove.kind === 'play' && lastMove.points > 0;
    const scoringPiece = isScoringMove ? pieces.find(p => p.tile.id === lastMove.tile.id) : null;
    const moveKey = isScoringMove ? `${game.roundNumber}-${lastMove.tile.id}-${lastMove.points}-${game.board.arms.reduce((s, a) => s + a.length, 0)}` : null;

    if (destination) {
      const scoringInfo = (scoringPiece && moveKey !== lastScoredMoveKey) ? { piece: scoringPiece, points: lastMove.points, unit } : null;
      if (scoringInfo) lastScoredMoveKey = moveKey;
      startFlight(destination, origin, unit, cue, scoringInfo);
    } else {
      if (scoringPiece && moveKey && moveKey !== lastScoredMoveKey) {
        lastScoredMoveKey = moveKey;
        showTileScoreBubble(scoringPiece, lastMove.points, unit);
      }
      if (cue) showMoveCue(cue);
    }
    positionMoveCue();
  }

  function renderRack(moves, choices) {
    const playing = game.phase === 'playing';
    const yourTurn = playing && game.turn === 0 && !(isNetworkMode && networkPaused);
    const rackLabel = byId('rack-label');
    rackLabel.textContent = playing ? 'Ваша рука' : 'Остатки на руках';
    rackLabel.classList.toggle('sr-only', playing);
    hand.hidden = !playing;
    roundHands.hidden = playing;
    roundRemainderTotal.hidden = playing;
    if (!playing) {
      hand.replaceChildren();
      quickEnds.hidden = true;
      drawButton.hidden = true;
      const { bonus, bonusBase, remainders, seat, type } = game.result;
      const total = remainders.reduce((sum, value) => sum + value, 0);
      const difference = type === 'blocked' && bonusBase !== null ? ' · Разница ' + bonusBase : '';
      roundRemainderTotal.textContent = type === 'blocked' && game.playerCount === 4 && bonusBase !== null
        ? 'Три остальные руки ' + remainders.filter((_, index) => index !== seat).join(' + ') + ' = ' + bonusBase + ' → ' + scorePoints(bonus)
        : 'Общая сумма ' + total + difference + ' · За остатки ' + scorePoints(bonus);
      roundHands.replaceChildren(...game.hands.map((tiles, seat) => {
        const total = remainders[seat];
        const row = element('section', 'round-hand');
        const title = element('h3', '', seatName(seat));
        title.id = 'round-hand-title-' + seat;
        row.setAttribute('aria-labelledby', title.id);
        const header = element('header', 'round-hand-header');
        header.append(title, element('strong', 'round-hand-points',
          'Сумма ' + total + ' → ' + scorePoints(engine.remainderPoints(total))));
        const stones = element('div', 'round-hand-tiles');
        if (tiles.length) stones.append(...tiles.map(tile => domino(tile.a, tile.b, true)));
        else stones.append(element('span', 'round-hand-empty', 'Костей нет'));
        row.append(header, stones);
        return row;
      }));
      roundHands.scrollTop = 0;
      return;
    }
    roundHands.replaceChildren();

    const available = new Set(moves.map(move => move.tileId));
    const focusedId = hand.contains(document.activeElement) ? document.activeElement.dataset.tileId : null;
    const nodes = game.hands[0].map(tile => {
      const node = domino(tile.a, tile.b, true, 'button');
      node.dataset.tileId = tile.id;
      node.disabled = !available.has(tile.id);
      node.setAttribute('aria-pressed', String(tile.id === selectedTileId));
      node.addEventListener('click', () => selectFromHand(tile.id));
      return node;
    });
    hand.replaceChildren(...nodes);
    if (focusedId) nodes.find(node => node.dataset.tileId === focusedId && !node.disabled)?.focus({ preventScroll: true });
    drawButton.hidden = !yourTurn || moves.length > 0;
    drawButton.textContent = game.stock.length ? 'Добрать' : 'Пас';
    const buttons = choices.map(({ side }) => {
      const { pip } = engine.openEnds(game.board).find(end => end.side === side);
      const button = element('button', '', directions[side] + ' · ' + pip);
      button.type = 'button';
      button.addEventListener('click', () => playSelected(side));
      return button;
    });
    quickEnds.hidden = buttons.length === 0;
    quickEnds.replaceChildren(...buttons);
  }

  function yourMoves() {
    if (!game || (isNetworkMode && networkPaused)) return [];
    return game.turn === 0 ? engine.legalMoves(game) : [];
  }

  function selectedMoves(moves = yourMoves()) {
    if (!game) return [];
    return moves.filter(move => move.tileId === selectedTileId && move.side !== null);
  }

  function render(origin, cue) {
    const moves = yourMoves();
    const choices = selectedMoves(moves);
    renderScore();
    renderSeats();
    renderStatus(moves);
    const total = engine.endTotal(game.board);
    byId('round-label').textContent = 'Кон № ' + game.roundNumber;
    byId('end-total').textContent = total;
    byId('end-total').classList.toggle('scoring', game.lastMove?.kind === 'play' && game.lastMove.points > 0);
    const stockIcon = element('span', 'stock-icon');
    stockIcon.setAttribute('aria-hidden', 'true');
    byId('stock').replaceChildren(stockIcon, element('span', '', 'Базар · ' + game.stock.length));
    renderRack(moves, choices);
    quickChat.hidden = !isNetworkMode || networkPaused || !net?.isConnected;
    if (quickChat.hidden) quickChat.open = false;
    renderBoard(choices, origin, cue);
    positionQuickMessages();
  }

  function cancelBotAction() {
    clearTimeout(botTimer);
    pendingDraw = null;
  }

  function scheduleBot() {
    if (isNetworkMode) return;
    cancelBotAction();
    const match = game;
    const seat = game.turn;
    const canAct = () => game === match && game.phase === 'playing' && seat !== 0 && game.turn === seat && !rules.open;
    if (!canAct()) return;
    const drawOrPass = () => {
      if (!canAct()) return;
      pendingDraw = null;
      engine.drawOrPass(game);
      afterAction(false);
    };

    botTimer = setTimeout(() => {
      if (!canAct()) return;
      const move = engine.chooseBotMove(game);
      if (move) {
        playWithFlight(move.tileId, move.side);
      } else if (game.stock.length) {
        pendingDraw = seat;
        renderSeats();
        renderStatus([]);
        showMoveCue({ seat, text: 'Иду на базар' });
        recordHistoryDraw(seat, 1);
        botTimer = setTimeout(drawOrPass, botDrawPause);
      } else {
        drawOrPass();
      }
    }, game.lastMove?.points ? 1430 : 1020);
  }

  // Confetti celebration cannon on match win
  let confettiAnimId = null;
  function triggerConfetti(durationMs = 4200) {
    if (reducedMotion.matches) return;
    const canvas = byId('confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (confettiAnimId) {
      cancelAnimationFrame(confettiAnimId);
      confettiAnimId = null;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const colors = ['#f59e0b', '#ffd700', '#10b981', '#3b82f6', '#ec4899', '#f97316', '#ffffff', '#e0e7ff'];
    const particleCount = 140;
    const particles = [];

    for (let i = 0; i < particleCount; i++) {
      const fromLeft = i % 2 === 0;
      const x = fromLeft ? Math.random() * (width * 0.25) : width - Math.random() * (width * 0.25);
      const y = height + 10;
      const angle = fromLeft
        ? (Math.PI * 0.24) + (Math.random() * 0.32)
        : (Math.PI * 0.76) - (Math.random() * 0.32);
      const speed = 13 + Math.random() * 13;

      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed * (fromLeft ? 1 : -1),
        vy: -Math.sin(angle) * speed,
        w: 7 + Math.random() * 8,
        h: 5 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.22,
        wobble: Math.random() * 10,
        vWobble: 0.08 + Math.random() * 0.08,
        shape: Math.random() > 0.35 ? 'rect' : 'circle',
        opacity: 1
      });
    }

    const startTime = performance.now();
    const gravity = 0.42;
    const drag = 0.985;

    function frame(now) {
      const elapsed = now - startTime;
      if (elapsed >= durationMs) {
        ctx.clearRect(0, 0, width, height);
        confettiAnimId = null;
        return;
      }

      ctx.clearRect(0, 0, width, height);
      const fadeProgress = elapsed > (durationMs - 1000) ? (durationMs - elapsed) / 1000 : 1;

      for (const p of particles) {
        p.vx *= drag;
        p.vy = (p.vy + gravity) * drag;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.vRot;
        p.wobble += p.vWobble;

        const currentOpacity = Math.max(0, p.opacity * fadeProgress);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.scale(Math.cos(p.wobble), 1);
        ctx.globalAlpha = currentOpacity;
        ctx.fillStyle = p.color;

        if (p.shape === 'rect') {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.w / 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      confettiAnimId = requestAnimationFrame(frame);
    }

    confettiAnimId = requestAnimationFrame(frame);
  }

  function afterAction(played, origin) {
    selectedTileId = null;
    const move = game.lastMove;
    if (played) {
      recordHistoryPlay(move.seat, move.tile, move.side, move.points, engine.endTotal(game.board));
    } else {
      if (move.kind === 'pass') {
        recordHistoryPass(move.seat);
      } else if (move.kind === 'draw') {
        recordHistoryDraw(move.seat, 1);
      }
    }
    seatActions[move.seat] = played
      ? { text: move.tile.a + '–' + move.tile.b, points: move.points }
      : { text: move.kind === 'pass' ? 'Стучу' : 'Взял из базара' };
    if (played && game.board.arms.every(arm => arm.length === 0)) {
      const { seat, tile } = game.lastMove;
      record('opening_move', { player: seatName(seat), seat: seat + 1, tile: tile.a + '–' + tile.b });
    }
    const cue = played ? { seat: move.seat, text: seatActions[move.seat].text, points: move.points }
      : move.kind === 'pass' ? { seat: move.seat, text: 'Стучу' } : null;
    if (game.phase !== 'playing') {
      record('round_end');
      recordHistoryRoundEnd(game.result, game.scores);
      const matchOver = game.phase === 'match-over';
      if (matchOver) {
        recordHistoryMatchEnd(game.winner, game.scores);
      }
      setTimeout(() => {
        globalThis.DominoSound?.playFanfare(matchOver);
        if (matchOver) triggerConfetti();
      }, 400);
    }
    if (!played) {
      if (move.kind === 'pass') globalThis.DominoSound?.playKnock();
      else if (move.kind === 'draw') globalThis.DominoSound?.playDraw();
    }
    render(origin, cue);
    if (played && !activeFlight) {
      globalThis.DominoSound?.playTilePlace();
      if (move.points > 0) setTimeout(() => globalThis.DominoSound?.playScore(move.points), 180);
    }
    if (game.phase !== 'playing') continueButton.focus({ preventScroll: true });
    scheduleBot();
  }

  function selectFromHand(id) {
    const moves = yourMoves().filter(move => move.tileId === id);
    if (moves.length === 1) {
      if (isNetworkMode) {
        selectedTileId = null;
        globalThis.DominoNet?.playTile(id, moves[0].side);
        return;
      }
      playWithFlight(id, moves[0].side);
    } else if (moves.length > 1) {
      selectedTileId = selectedTileId === id ? null : id;
      render();
    }
  }

  function playSelected(side) {
    const move = selectedMoves().find(candidate => candidate.side === side);
    if (!move) return;
    if (isNetworkMode) {
      selectedTileId = null;
      globalThis.DominoNet?.playTile(move.tileId, move.side);
      return;
    }
    playWithFlight(move.tileId, move.side);
  }

  function startMatch(players) {
    cancelBotAction();
    clearFlight();
    clearMoveCue();
    clearQuickMessages();
    clearTileScoreBubble();
    lastScoredMoveKey = null;
    matchStartTime = Date.now();
    roundStartTime = matchStartTime;
    game = engine.createGame(players);
    initMatchHistory(players, matchNumber + 1);
    ensureRoundHistory(game.roundNumber, game.starter);
    activeSeat = null;
    const id = globalThis.crypto?.randomUUID?.() ?? Date.now() + '-' + Math.random().toString(36).slice(2);
    currentJournal = { id, number: ++matchNumber, startedAt: matchStartTime, players, events: [] };
    matchHistoryData.matchNumber = matchNumber;
    const key = historyPrefix + id;
    memoryHistory.set(key, currentJournal);
    if (memoryHistory.size > historyLimit) memoryHistory.delete(memoryHistory.keys().next().value);
    selectedTileId = null;
    seatActions = [];
    record('round_start');
    if (historyStorage) {
      const expiredMatches = recentMatches().slice(historyLimit);
      try {
        for (const expired of expiredMatches) historyStorage.removeItem(expired.key);
      } catch {
        // The latest matches remain visible even if cleanup is unavailable.
      }
    }
    render();
    scheduleBot();
  }

  drawButton.addEventListener('click', () => {
    if (game.phase !== 'playing' || game.turn !== 0 || yourMoves().length) return;
    if (isNetworkMode) {
      if (game.stock.length) globalThis.DominoSound?.playDraw();
      globalThis.DominoNet?.drawOrPass();
      return;
    }
    if (game.stock.length) {
      globalThis.DominoSound?.playDraw();
      showMoveCue({ seat: 0, text: 'Иду на базар' });
      recordHistoryDraw(0, 1);
    }
    engine.drawOrPass(game);
    const moves = yourMoves();
    if (moves.length === 1) {
      playWithFlight(moves[0].tileId, moves[0].side);
    } else {
      afterAction(false);
      if (moves.length > 1) {
        selectedTileId = moves[0].tileId;
        render();
        quickEnds.querySelector('button')?.focus({ preventScroll: true });
      }
    }
  });

  continueButton.addEventListener('click', () => {
    if (isNetworkMode) {
      globalThis.DominoNet?.nextRound();
      return;
    }
    if (game.phase === 'match-over') {
      record('voluntary_replay', {
        replayType: 'match_over_continue',
        isSecondRoundReplay: false,
        completedRounds: game.roundNumber,
        finalScores: game.scores.slice()
      });
      startMatch(game.playerCount);
    } else if (game.phase === 'round-over') {
      const isSecondRound = (game.roundNumber === 1);
      record('voluntary_replay', {
        replayType: 'round_continue',
        isSecondRoundReplay: isSecondRound,
        completedRound: game.roundNumber,
        scoresAfterRound: game.scores.slice()
      });
      clearFlight();
      clearMoveCue();
      clearTileScoreBubble();
      lastScoredMoveKey = null;
      record('round_continue');
      engine.nextRound(game);
      ensureRoundHistory(game.roundNumber, game.starter);
      record('round_start');
      selectedTileId = null;
      seatActions = [];
      render();
      scheduleBot();
    }
  });

  modeMenu.addEventListener('click', event => {
    const button = event.target.closest('button[data-mode]');
    if (button && Number(button.dataset.mode) !== game.playerCount) {
      if (isNetworkMode) {
        globalThis.DominoNet?.leave();
        isNetworkMode = false;
        const netBadge = byId('net-room-badge');
        if (netBadge) netBadge.hidden = true;
      }
      const targetMode = Number(button.dataset.mode);
      record('mode_switch', { fromMode: game.playerCount, toMode: targetMode });
      startMatch(targetMode);
    }
  });

  const soundToggle = byId('sound-toggle');
  if (soundToggle) {
    const updateSoundIcon = () => {
      const on = globalThis.DominoSound?.isEnabled() ?? true;
      soundToggle.textContent = on ? '🔊' : '🔇';
      soundToggle.setAttribute('aria-label', on ? 'Звук: Включен' : 'Звук: Выключен');
      soundToggle.title = on ? 'Звук: Вкл (нажмите, чтобы выключить)' : 'Звук: Выкл (нажмите, чтобы включить)';
      soundToggle.classList.toggle('muted', !on);
    };
    updateSoundIcon();
    soundToggle.addEventListener('click', () => {
      globalThis.DominoSound?.toggleMute();
      updateSoundIcon();
    });
  }

  byId('restart').addEventListener('click', () => {
    if (isNetworkMode) {
      globalThis.DominoNet?.leave();
      isNetworkMode = false;
      const netBadge = byId('net-room-badge');
      if (netBadge) netBadge.hidden = true;
    }
    record('voluntary_restart', {
      fromRound: game.roundNumber,
      fromPhase: game.phase,
      playerCount: game.playerCount
    });
    startMatch(game.playerCount);
  });

  byId('rules-open').addEventListener('click', () => {
    record('rules_opened', { round: game.roundNumber, phase: game.phase });
    const hadPendingDraw = pendingDraw !== null;
    cancelBotAction();
    clearFlight();
    clearMoveCue();
    if (hadPendingDraw) {
      renderSeats();
      renderStatus(yourMoves());
    }
    refreshJournal();
    rules.showModal();
  });
  rules.addEventListener('close', scheduleBot);

  const copyTelemetryBtn = byId('copy-telemetry');
  const copyStatus = byId('telemetry-copy-status');
  if (copyTelemetryBtn) {
    copyTelemetryBtn.addEventListener('click', async () => {
      const events = globalThis.DominoTelemetry?.getEvents() || [];
      const json = JSON.stringify(events, null, 2);
      try {
        await navigator.clipboard.writeText(json);
        if (copyStatus) copyStatus.textContent = 'Скопировано (' + events.length + ')';
      } catch {
        if (copyStatus) copyStatus.textContent = 'Ошибка доступа к буферу';
      }
      setTimeout(() => { if (copyStatus) copyStatus.textContent = ''; }, 3000);
    });
  }

  globalThis.DominoTelemetry = {
    getAnonUserId: () => anonUserId,
    getSessionId: () => sessionId,
    getEvents: () => {
      try {
        return JSON.parse(historyStorage?.getItem(telemetryKey) || '[]');
      } catch {
        return [];
      }
    },
    clear: () => {
      try {
        historyStorage?.removeItem(telemetryKey);
      } catch {}
    }
  };

  // Lobby Controller & DominoNet bridge
  const net = globalThis.DominoNet;
  const lobbyDialog = byId('lobby-dialog');
  const onlineOpenBtn = byId('online-open');
  const lobbyWelcome = byId('lobby-welcome');
  const lobbyRoom = byId('lobby-room');
  const playerNicknameInput = byId('player-nickname');
  const btnCreateRoom = byId('btn-create-room');
  const roomCodeInput = byId('room-code-input');
  const btnJoinRoom = byId('btn-join-room');
  const lobbyError = byId('lobby-error');
  const displayRoomCode = byId('display-room-code');
  const btnCopyLink = byId('btn-copy-link');
  const copyLinkStatus = byId('copy-link-status');
  const btnRandomTeams = byId('btn-random-teams');
  const btnToggleReady = byId('btn-toggle-ready');
  const btnStartGame = byId('btn-start-game');
  const btnLeaveRoom = byId('btn-leave-room');
  const lobbyStatusMsg = byId('lobby-status-msg');

  const quickMessageOptions = Object.entries(quickMessages).map(([id, phrase]) => {
    const button = element('button', 'quick-chat-option', phrase);
    button.type = 'button';
    button.addEventListener('click', () => {
      if (quickChat.hidden) return;
      net.sendQuickMessage(id);
      quickChat.open = false;
      quickChat.querySelector('summary').focus();
      for (const option of quickMessageOptions) option.disabled = true;
      setTimeout(() => {
        for (const option of quickMessageOptions) option.disabled = false;
      }, 1200);
    });
    return button;
  });
  quickChatMenu.replaceChildren(...quickMessageOptions);
  document.addEventListener('click', event => {
    if (quickChat.open && !quickChat.contains(event.target)) quickChat.open = false;
  });
  quickChat.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !quickChat.open) return;
    quickChat.open = false;
    quickChat.querySelector('summary').focus();
  });
  window.addEventListener('resize', positionQuickMessages);
  window.addEventListener('scroll', positionQuickMessages, { capture: true, passive: true });

  if (onlineOpenBtn && lobbyDialog) {
    onlineOpenBtn.addEventListener('click', () => {
      cancelBotAction();
      clearFlight();
      clearMoveCue();
      if (lobbyError) lobbyError.hidden = true;
      if (net?.playerName && playerNicknameInput) playerNicknameInput.value = net.playerName;
      lobbyDialog.showModal();
    });

    function normalizeRoomCode(code) {
      if (!code || typeof code !== 'string') return '';
      const cyrillicMap = {
        'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'К': 'K',
        'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X', 'У': 'Y'
      };
      return code.trim().toUpperCase().replace(/[АВСЕНКМОРТХУ]/g, ch => cyrillicMap[ch] || ch).slice(0, 4);
    }

    btnCreateRoom?.addEventListener('click', () => {
      const name = playerNicknameInput.value.trim() || 'Игрок';
      if (lobbyError) lobbyError.hidden = true;
      net?.createRoom(name).catch(err => {
        if (lobbyError) {
          lobbyError.textContent = err.message || 'Ошибка подключения к серверу';
          lobbyError.hidden = false;
        }
      });
    });

    btnJoinRoom?.addEventListener('click', () => {
      const name = playerNicknameInput.value.trim() || 'Игрок';
      const code = normalizeRoomCode(roomCodeInput.value);
      if (!code) {
        if (lobbyError) {
          lobbyError.textContent = 'Введите 4-значный код комнаты';
          lobbyError.hidden = false;
        }
        return;
      }
      roomCodeInput.value = code;
      if (lobbyError) lobbyError.hidden = true;
      net?.joinRoom(code, name).catch(err => {
        if (lobbyError) {
          lobbyError.textContent = err.message || 'Ошибка подключения к серверу';
          lobbyError.hidden = false;
        }
      });
    });

    btnCopyLink?.addEventListener('click', async () => {
      if (!net?.roomId) return;
      const url = location.origin + location.pathname + '?room=' + net.roomId;
      try {
        await navigator.clipboard.writeText(url);
        if (copyLinkStatus) {
          copyLinkStatus.textContent = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
            ? `Скопировано! Код: ${net.roomId} (для игры по интернету передайте ссылку туннеля)`
            : 'Ссылка скопирована!';
        }
      } catch {
        if (copyLinkStatus) copyLinkStatus.textContent = url;
      }
      setTimeout(() => { if (copyLinkStatus) copyLinkStatus.textContent = ''; }, 4000);
    });

    const netBadgeCopy = byId('net-badge-copy');
    const netToast = byId('net-toast');
    netBadgeCopy?.addEventListener('click', async () => {
      if (!net?.roomId) return;
      const url = location.origin + location.pathname + '?room=' + net.roomId;
      try {
        await navigator.clipboard.writeText(url);
      } catch {}
      if (netToast) {
        netToast.hidden = false;
        setTimeout(() => { netToast.hidden = true; }, 2200);
      }
    });

    btnRandomTeams?.addEventListener('click', () => {
      net?.randomizeTeams();
    });

    btnToggleReady?.addEventListener('click', () => {
      net?.toggleReady();
    });

    btnStartGame?.addEventListener('click', () => {
      btnStartGame.disabled = true;
      btnStartGame.textContent = 'Запуск...';
      net?.startGame();
    });

    btnLeaveRoom?.addEventListener('click', () => {
      net?.leave();
      isNetworkMode = false;
      const netBadge = byId('net-room-badge');
      if (netBadge) netBadge.hidden = true;
      if (lobbyRoom) lobbyRoom.hidden = true;
      if (lobbyWelcome) lobbyWelcome.hidden = false;
      startMatch(2);
    });

    for (let i = 0; i < 4; i++) {
      const card = byId('seat-card-' + i);
      if (!card) continue;
      card.querySelector('.seat-take-btn')?.addEventListener('click', () => {
        net?.chooseSeat(i);
      });
      card.querySelector('.seat-bot-btn')?.addEventListener('click', () => {
        net?.toggleBot(i);
      });
    }

    if (net) {
      net.on('quickMessage', ({ seat, messageId, roomId }) => {
        if (!isNetworkMode || networkPaused || roomId !== networkSnapshot?.room ||
            !Number.isInteger(seat) || seat < 0 || seat > 3 || !Object.hasOwn(quickMessages, messageId)) return;
        showQuickMessage((seat - net.mySeat + 4) % 4, quickMessages[messageId]);
      });

      net.on('error', (err) => {
        if (lobbyError) {
          lobbyError.textContent = typeof err === 'string' ? err : 'Ошибка сети';
          lobbyError.hidden = false;
        }
      });

      net.on('lobby', (lobby) => {
        if (lobbyWelcome) lobbyWelcome.hidden = true;
        if (lobbyRoom) lobbyRoom.hidden = false;
        if (displayRoomCode) displayRoomCode.textContent = lobby.roomId;
        if (lobbyError) lobbyError.hidden = true;

        const netBadge = byId('net-room-badge');
        const netCode = byId('net-badge-code');
        if (netBadge && netCode) {
          netCode.textContent = lobby.roomId;
          netBadge.hidden = false;
        }

        const mySeatIdx = net.mySeat;
        const isHost = net.isHost;

        let allReady = true;
        let occupiedCount = 0;

        for (let i = 0; i < 4; i++) {
          const card = byId('seat-card-' + i);
          const seatData = lobby.seats.find(s => s.seatIndex === i);
          if (!card || !seatData) continue;

          const nameEl = card.querySelector('.seat-player-name');
          const statusEl = card.querySelector('.seat-status-pill');
          const takeBtn = card.querySelector('.seat-take-btn');
          const botBtn = card.querySelector('.seat-bot-btn');

          const hasPlayer = Boolean(seatData.player);
          if (hasPlayer) {
            occupiedCount++;
            if (!seatData.player.isReady || (!seatData.player.isBot && !seatData.player.isOnline)) allReady = false;
          }

          card.classList.toggle('is-my-seat', hasPlayer && seatData.player.id === net.playerId);
          card.classList.toggle('is-ready', hasPlayer && seatData.player.isReady);

          if (hasPlayer) {
            nameEl.textContent = seatData.player.name + (seatData.player.isHost ? ' ★' : '');
            statusEl.textContent = !seatData.player.isBot && !seatData.player.isOnline
              ? 'Переподключается' : seatData.player.isReady ? '✓ Готов' : '⏳ Ожидание';
            takeBtn.hidden = true;
            if (isHost && seatData.player.isBot) {
              botBtn.hidden = false;
              botBtn.textContent = '✕ Бот';
            } else {
              botBtn.hidden = true;
            }
          } else {
            allReady = false;
            nameEl.textContent = 'Свободно';
            statusEl.textContent = 'Пустое кресло';
            takeBtn.hidden = (mySeatIdx === i);
            botBtn.hidden = !isHost;
            botBtn.textContent = '+ Бот';
          }
        }

        if (btnRandomTeams) btnRandomTeams.hidden = !isHost;
        if (btnStartGame) {
          btnStartGame.hidden = !isHost;
          btnStartGame.disabled = !(occupiedCount === 4 && allReady);
          btnStartGame.textContent = 'Начать партию';
        }
        if (lobbyStatusMsg) {
          lobbyStatusMsg.textContent = (occupiedCount === 4 && allReady)
            ? (isHost ? 'Все готовы к игре! Нажмите «Начать партию».' : 'Все готовы. Ждём старта от хоста.')
            : `Ожидание игроков: занято ${occupiedCount} из 4 мест.`;
        }

        const me = lobby.seats.find(s => s.player && s.player.id === net.playerId)?.player;
        if (btnToggleReady) {
          btnToggleReady.textContent = me?.isReady ? 'Отменить готовность' : 'Я готов!';
          btnToggleReady.classList.toggle('primary', !me?.isReady);
          btnToggleReady.classList.toggle('secondary', Boolean(me?.isReady));
        }
      });

      net.on('gameState', (msg) => {
        const sGame = msg.game;
        const sameRoom = isNetworkMode && networkSnapshot?.room === msg.roomId;
        const sameRound = sameRoom && networkSnapshot.match === sGame.matchNumber &&
          networkSnapshot.round === sGame.roundNumber;
        const newMove = sameRound && sGame.moveNumber === networkSnapshot.move + 1;
        const wasPaused = networkPaused;
        if (!sameRoom) {
          initMatchHistory(4, sGame.matchNumber);
        }
        if (!sameRound) {
          ensureRoundHistory(sGame.roundNumber, toRel(sGame.starter));
          cancelBotAction();
          clearFlight();
          clearMoveCue();
          if (!sameRoom) clearQuickMessages();
          clearTileScoreBubble();
          lastScoredMoveKey = null;
          seatActions = [];
        }
        if (!sameRound || networkSnapshot.move !== sGame.moveNumber || wasPaused) selectedTileId = null;
        networkPaused = false;
        networkSnapshot = { room: msg.roomId, match: sGame.matchNumber, round: sGame.roundNumber, move: sGame.moveNumber };
        isNetworkMode = true;
        try {
          if (lobbyDialog?.open) lobbyDialog.close();
        } catch {}

        const mySeat = msg.seat;

        const toRel = (absSeat) => (absSeat - mySeat + 4) % 4;
        const toAbs = (relSeat) => (relSeat + mySeat) % 4;

        netPlayerNames = [
          sGame.otherHands[mySeat]?.name ? `Вы (${sGame.otherHands[mySeat].name})` : 'Вы',
          sGame.otherHands[toAbs(1)]?.name || 'Соперник',
          sGame.otherHands[toAbs(2)]?.name ? `${sGame.otherHands[toAbs(2)].name} (Напарник)` : 'Напарник',
          sGame.otherHands[toAbs(3)]?.name || 'Соперник'
        ];

        const myTeam = mySeat % 2;
        const scores = myTeam === 0
          ? [sGame.scores[0], sGame.scores[1]]
          : [sGame.scores[1], sGame.scores[0]];

        const relResult = sGame.result ? {
          ...sGame.result,
          seat: sGame.result.seat !== null ? toRel(sGame.result.seat) : null,
          remainders: sGame.result.remainders ? [
            sGame.result.remainders[toAbs(0)],
            sGame.result.remainders[toAbs(1)],
            sGame.result.remainders[toAbs(2)],
            sGame.result.remainders[toAbs(3)]
          ] : []
        } : null;

        let origin;
        let cue;
        if (sGame.lastMove) {
          const relSeat = toRel(sGame.lastMove.seat);
          seatActions[relSeat] = sGame.lastMove.kind === 'play'
            ? { text: sGame.lastMove.tile.a + '–' + sGame.lastMove.tile.b, points: sGame.lastMove.points }
            : { text: sGame.lastMove.kind === 'pass' ? 'Стучу' : 'Взял из базара' };
          if (newMove && !wasPaused) {
            if (activeFlight) finishFlight();
            cue = { seat: relSeat, ...seatActions[relSeat] };
            if (sGame.lastMove.kind === 'play') {
              recordHistoryPlay(relSeat, sGame.lastMove.tile, sGame.lastMove.side, sGame.lastMove.points, engine.endTotal(sGame.board));
              origin = flightOrigin(relSeat, sGame.lastMove.tile.id);
              if (!origin) {
                globalThis.DominoSound?.playTilePlace();
                if (sGame.lastMove.points > 0) setTimeout(() => globalThis.DominoSound?.playScore(sGame.lastMove.points), 180);
              }
            } else if (sGame.lastMove.kind === 'pass') {
              recordHistoryPass(relSeat);
              globalThis.DominoSound?.playKnock();
            } else if (sGame.lastMove.kind === 'draw') {
              recordHistoryDraw(relSeat, 1);
              globalThis.DominoSound?.playDraw();
            }
          }
        }

        game = {
          roundNumber: sGame.roundNumber,
          playerCount: 4,
          turn: toRel(sGame.turn),
          starter: toRel(sGame.starter),
          phase: sGame.phase,
          scores,
          board: sGame.board,
          stock: Array(sGame.stockCount).fill({ a: 0, b: 0, id: 'dummy' }),
          forcedTileId: sGame.forcedTileId,
          passCount: sGame.passCount,
          result: relResult,
          winner: sGame.winner !== null ? (sGame.winner === myTeam ? 0 : 1) : null,
          hands: [
            sGame.myHand,
            sGame.otherHands[toAbs(1)]?.tiles || Array(sGame.otherHands[toAbs(1)]?.count || 0).fill({ a: 0, b: 0, id: 'dummy1' }),
            sGame.otherHands[toAbs(2)]?.tiles || Array(sGame.otherHands[toAbs(2)]?.count || 0).fill({ a: 0, b: 0, id: 'dummy2' }),
            sGame.otherHands[toAbs(3)]?.tiles || Array(sGame.otherHands[toAbs(3)]?.count || 0).fill({ a: 0, b: 0, id: 'dummy3' })
          ],
          lastMove: sGame.lastMove ? {
            ...sGame.lastMove,
            seat: toRel(sGame.lastMove.seat)
          } : null
        };

        render(origin, cue);
        if (!wasPaused && newMove && (sGame.phase === 'round-over' || sGame.phase === 'match-over')) {
          recordHistoryRoundEnd(relResult, scores);
          const matchOver = sGame.phase === 'match-over';
          if (matchOver) {
            recordHistoryMatchEnd(sGame.winner !== null ? (sGame.winner === myTeam ? 0 : 1) : null, scores);
          }
          setTimeout(() => {
            globalThis.DominoSound?.playFanfare(matchOver);
            if (matchOver) triggerConfetti();
          }, 400);
        }
      });

      net.on('connected', connected => {
        if (connected || !isNetworkMode) return;
        networkPaused = true;
        clearQuickMessages();
        selectedTileId = null;
        render();
      });

      // Auto-open if ?room=XYZ in URL
      const urlQuery = new URLSearchParams(window.location.search);
      const urlRoom = urlQuery.get('room');
      if (urlRoom && lobbyDialog) {
        if (roomCodeInput) roomCodeInput.value = normalizeRoomCode(urlRoom);
        try {
          if (!lobbyDialog.open) lobbyDialog.showModal();
        } catch {}
        if (net.playerName && playerNicknameInput) playerNicknameInput.value = net.playerName;
      }
    }
  }

  new ResizeObserver(() => {
    if (game) renderBoard(selectedMoves());
  }).observe(boardView);

  record('session_init', {
    userAgent: navigator.userAgent,
    language: navigator.language,
    viewport: window.innerWidth + 'x' + window.innerHeight,
    isTouch: 'ontouchstart' in window || (navigator.maxTouchPoints > 0),
    referrer: document.referrer || 'direct'
  });

  startMatch(2);
  net?.resumeRoom().then(resuming => {
    if (resuming && !isNetworkMode && !lobbyDialog.open) {
      cancelBotAction();
      lobbyDialog.showModal();
    }
  }).catch(() => {
    if (!lobbyDialog.open) lobbyDialog.showModal();
  });
})();

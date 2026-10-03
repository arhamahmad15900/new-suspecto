/**
 * Suspecto Game Logic Module
 * Handles Picto and Sketchio game state rendering and event handling
 */
const GameManager = (() => {
  let socket = null;
  let currentRoom = null;
  let currentPlayer = null;

  function init(socketInstance) {
    socket = socketInstance;
    bindGameEvents();
  }

  // ── SHARED ROOM EVENTS ─────────────────────────────────────────────
  function bindGameEvents() {

    // Room updates
    socket.on('room:playerJoined', ({ player, room }) => {
      updateRoom(room);
      appendChat(`${player.name} joined the room.`, 'Game', 'system');
    });

    socket.on('room:playerLeft', ({ playerId, room }) => {
      const leavingPlayer = currentRoom?.players.find(p => p.id === playerId);
      updateRoom(room);
      if (leavingPlayer) appendChat(`${leavingPlayer.name} left the room.`, 'Game', 'system');
    });

    socket.on('room:playerDisconnected', ({ playerId, room }) => {
      const p = room.players.find(pl => pl.id === playerId);
      updateRoom(room);
      if (p) appendChat(`${p.name} disconnected.`, 'Game', 'system');
    });

    socket.on('room:playerReconnected', ({ playerName, room }) => {
      updateRoom(room);
      appendChat(`${playerName} reconnected.`, 'Game', 'system');
    });

    socket.on('room:settingsUpdated', ({ settings }) => {
      if (currentRoom) currentRoom.settings = settings;
      appendChat('Host updated room settings.', 'Game', 'system');
    });

    socket.on('room:kicked', ({ message }) => {
      showToast(message, 'error');
      setTimeout(() => navigateTo('home'), 2000);
    });

    // Chat
    socket.on('chat:message', ({ senderId, senderName, message, type }) => {
      appendChat(message, senderName, type || 'chat');
    });

    // ── SKETCHIO EVENTS ──────────────────────────────────────────────
    socket.on('sketchio:gameStarted', ({ settings }) => {
      appendChat('Game is starting!', 'Game', 'system');
      showScreen('room');
      hideAllCenterPanels();
      show('center-canvas');
      DrawingCanvas.reset();
      DrawingCanvas.setDrawer(false);
      renderPlayerList();
    });

    socket.on('sketchio:wordChoices', ({ words }) => {
      hideAllCenterPanels();
      show('sketchio-word-choice');
      const container = document.getElementById('word-choice-buttons');
      container.innerHTML = '';
      words.forEach(word => {
        const btn = document.createElement('button');
        btn.className = 'word-choice-btn';
        btn.textContent = word;
        btn.onclick = () => {
          socket.emit('sketchio:wordChosen', { word });
          hideAllCenterPanels();
          show('center-canvas');
        };
        container.appendChild(btn);
      });
    });

    socket.on('sketchio:newTurn', ({ drawerId, drawerName, wordLength }) => {
      DrawingCanvas.reset();
      DrawingCanvas.setDrawer(socket.id === drawerId);
      hideAllCenterPanels();
      show('center-canvas');
      hide('canvas-overlay');

      const drawerInfo = document.getElementById('canvas-drawer-name');
      if (drawerInfo) drawerInfo.textContent = drawerName;
      const blanks = document.getElementById('canvas-word-blanks');
      if (blanks) {
        blanks.dataset.isRevealed = '';
        blanks.textContent = wordLength ? Array(wordLength + 1).join('_ ').trim() : '?';
      }
    });

    socket.on('sketchio:roundStart', ({ drawerId, drawerName, wordBlanks, wordLength, drawTime }) => {
      hide('canvas-overlay');
      const drawerInfo = document.getElementById('canvas-drawer-name');
      if (drawerInfo) drawerInfo.textContent = drawerName;
      const blanksEl = document.getElementById('canvas-word-blanks');
      if (blanksEl && !blanksEl.dataset.isRevealed) blanksEl.textContent = wordBlanks || '_ _ _ _';
      DrawingCanvas.requestSync();
    });

    socket.on('sketchio:yourWord', ({ word }) => {
      const blanksEl = document.getElementById('canvas-word-blanks');
      if (blanksEl) blanksEl.textContent = word.toUpperCase();
      appendChat(`Your word is: ${word}`, 'Game', 'system');
    });

    socket.on('sketchio:timer', ({ timeLeft }) => {
      updateTimer(timeLeft);
    });

    socket.on('sketchio:hint', ({ wordBlanks }) => {
      const blanksEl = document.getElementById('canvas-word-blanks');
      if (blanksEl && !blanksEl.dataset.isRevealed) {
        blanksEl.textContent = wordBlanks;
      }
    });

    socket.on('sketchio:correctGuess', ({ word, points }) => {
      showToast(`✅ Correct! +${points} points`, 'success');
      const blanksEl = document.getElementById('canvas-word-blanks');
      if (blanksEl) {
        blanksEl.textContent = word.toUpperCase();
        blanksEl.dataset.isRevealed = 'true';
      }
    });

    socket.on('sketchio:scoreUpdate', ({ players }) => {
      if (currentRoom) currentRoom.players = players;
      renderPlayerList();
    });

    socket.on('sketchio:turnEnd', ({ word, scores }) => {
      showOverlay(`<h3>The word was: <span style="color:#ffd54f">${word}</span></h3><p>Next turn starting soon...</p>`);
      if (currentRoom) {
        scores.forEach(s => {
          const p = currentRoom.players.find(pl => pl.id === s.id);
          if (p) p.score = s.score;
        });
        renderPlayerList();
      }
      DrawingCanvas.setDrawer(false);
    });

    socket.on('sketchio:gameEnd', ({ winner, rankings }) => {
      showGameEnd('sketchio', winner, rankings);
    });

    // ── PICTO EVENTS ─────────────────────────────────────────────────
    socket.on('picto:gameStarted', ({ players, rounds, round }) => {
      appendChat('Picto game is starting! Check your role...', 'Game', 'system');
      hideAllCenterPanels();
      show('center-canvas');
      DrawingCanvas.reset();
      DrawingCanvas.setDrawer(false);
      document.getElementById('bar-round-total').textContent = rounds;
      document.getElementById('bar-round-val').textContent = round;
      show('bar-round');
    });

    socket.on('picto:roleAssigned', ({ role, secretWord, hint }) => {
      const banner = document.createElement('div');
      banner.className = `role-banner ${role} fade-in`;
      if (role === 'crewmate') {
        banner.innerHTML = `You are a <strong>Crewmate</strong>! 🕵️<br><span class="role-word">${secretWord}</span><br><small>This is the secret word — remember it!</small>`;
      } else {
        banner.innerHTML = `You are the <strong>Imposter</strong>! 🔴<br><small>${hint || 'Blend in — you do NOT know the secret word!'}</small>`;
      }
      document.body.appendChild(banner);
      setTimeout(() => banner.remove(), 6000);
    });

    socket.on('picto:drawingTurn', ({ drawerId, drawerName, drawTime, round }) => {
      hideAllCenterPanels();
      show('center-canvas');
      hide('canvas-overlay');
      DrawingCanvas.reset();
      DrawingCanvas.setDrawer(socket.id === drawerId);
      document.getElementById('bar-round-val').textContent = round;
      const drawerInfo = document.getElementById('canvas-drawer-name');
      if (drawerInfo) drawerInfo.textContent = drawerName;
      const blanksEl = document.getElementById('canvas-word-blanks');
      if (blanksEl) blanksEl.textContent = socket.id === drawerId ? '(You are drawing — use the secret word as inspiration!)' : '...';
      appendChat(`${drawerName} is drawing!`, 'Game', 'system');
    });

    socket.on('picto:timer', ({ timeLeft, phase }) => {
      updateTimer(timeLeft);
      if (phase === 'voting') {
        document.getElementById('bar-timer-val').textContent = `Vote: ${timeLeft}`;
      }
    });

    socket.on('picto:votingPhase', ({ eligiblePlayers, voteTime }) => {
      hideAllCenterPanels();
      show('picto-voting-panel');
      const list = document.getElementById('voting-players-list');
      list.innerHTML = '';
      eligiblePlayers.forEach(p => {
        if (p.id === socket.id) return; // Can't vote self
        const btn = document.createElement('button');
        btn.className = 'vote-player-btn';
        btn.textContent = `👤 ${p.name}`;
        btn.onclick = () => {
          socket.emit('picto:vote', { targetId: p.id });
          list.querySelectorAll('.vote-player-btn').forEach(b => { b.disabled = true; });
          btn.classList.add('voted');
          showToast('Vote cast!', 'info');
        };
        list.appendChild(btn);
      });
      appendChat('Voting phase! Choose who you think is the Imposter.', 'Game', 'system');
    });

    socket.on('picto:voteResult', ({ eliminated, eliminatedName, eliminatedRole, isImposter, tie, votes }) => {
      hideAllCenterPanels();
      if (tie) {
        showOverlay(`<h3>🤷 No Elimination!</h3><p>The votes were tied. No one was eliminated this round.</p>`);
        show('center-canvas');
        appendChat('Tied vote — no elimination this round.', 'Game', 'system');
      } else {
        const roleLabel = eliminatedRole === 'imposter' ? '🔴 Imposter' : '🟢 Crewmate';
        showOverlay(`<h3>🗳 ${eliminatedName} was eliminated!</h3><p>They were a <strong>${roleLabel}</strong></p>`);
        show('center-canvas');
        appendChat(`${eliminatedName} was eliminated! (${roleLabel})`, 'Game', 'system');
        // Update player list
        if (currentRoom) {
          const p = currentRoom.players.find(pl => pl.id === eliminated);
          if (p) { currentRoom.eliminated = currentRoom.eliminated || []; currentRoom.eliminated.push(eliminated); }
        }
        renderPlayerList();
      }
    });

    socket.on('picto:imposterGuessing', ({ imposterId, imposterName, timeLimit }) => {
      if (socket.id !== imposterId) {
        showOverlay(`<h3>🕵️ ${escapeHtml(imposterName)} was the Imposter!</h3><p>They have ${timeLimit}s to guess the secret word and steal the win!</p>`);
        appendChat(`🕵️ ${imposterName} has 20s to guess the secret word!`, 'Game', 'system');
      }
    });

    socket.on('picto:imposterGuessChance', ({ message }) => {
      hideAllCenterPanels();
      show('picto-imposter-guess-panel');
      document.getElementById('imposter-attempts').textContent = '3 attempts remaining';
      appendChat(message, 'Game', 'system');
    });

    socket.on('picto:imposterCorrectGuess', ({ message }) => {
      appendChat(message, 'Game', 'system');
      showToast(message, 'info');
    });

    socket.on('picto:imposterWrongGuess', ({ attemptsLeft }) => {
      document.getElementById('imposter-attempts').textContent = `${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} remaining`;
      if (attemptsLeft === 0) showToast('No more attempts!', 'error');
    });

    socket.on('picto:newRound', ({ round }) => {
      document.getElementById('bar-round-val').textContent = round;
      hide('bar-timer');
      appendChat(`Round ${round} begins!`, 'Game', 'system');
    });

    socket.on('picto:gameEnd', ({ winner, secretWord, imposterName, players, victoryMedia, matchId }) => {
      showPictoGameEnd(winner, secretWord, imposterName, players, victoryMedia, matchId);
    });
  }

  // ── UI HELPERS ─────────────────────────────────────────────────────
  function show(id) { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
  function hide(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }

  function hideAllCenterPanels() {
    ['center-lobby','center-canvas','drawing-toolbar','picto-voting-panel',
     'picto-imposter-guess-panel','sketchio-word-choice','game-end-panel',
     'canvas-overlay'].forEach(hide);
    DrawingCanvas.setDrawer(false);
  }

  function showOverlay(html) {
    show('canvas-overlay');
    const content = document.getElementById('overlay-content');
    if (content) {
      content.innerHTML = html;
    }
    setTimeout(() => hide('canvas-overlay'), 3500);
  }

  function updateTimer(timeLeft) {
    show('bar-timer');
    const el = document.getElementById('bar-timer-val');
    if (el) el.textContent = timeLeft;
    if (timeLeft <= 10) {
      document.getElementById('bar-timer')?.classList.add('pulsing');
    } else {
      document.getElementById('bar-timer')?.classList.remove('pulsing');
    }
  }

  function appendChat(message, senderName, type = 'chat') {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = `chat-msg ${type}`;
    const sender = document.createElement('span');
    sender.className = 'chat-msg-sender';
    sender.textContent = (senderName || 'Player') + ': ';
    const text = document.createElement('span');
    text.className = 'chat-msg-text';
    text.textContent = message;
    div.appendChild(sender);
    div.appendChild(text);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function renderPlayerList() {
    const ul = document.getElementById('players-list');
    if (!ul || !currentRoom) return;
    const eliminated = currentRoom.eliminated || [];
    ul.innerHTML = '';
    currentRoom.players.forEach(p => {
      const li = document.createElement('li');
      const isMe = p.id === socket.id;
      const elim = eliminated.includes(p.id);
      const guessed = p.hasGuessed;
      li.className = (elim ? 'player-eliminated' : '') + (guessed ? ' player-guessed' : '');
      li.innerHTML = `
        <span class="player-icon">${p.isHost ? '👑' : (elim ? '💀' : (guessed ? '✅' : '👤'))}</span>
        <span class="player-name">${escapeHtml(p.name)}${isMe ? ' (You)' : ''}</span>
        <span class="player-score">${p.score || 0}</span>
      `;
      ul.appendChild(li);
    });
  }

  function updateRoom(room) {
    currentRoom = room;
    renderPlayerList();
  }

  function setRoom(room, player) {
    currentRoom = room;
    currentPlayer = player;
  }

  function showGameEnd(game, winner, rankings) {
    hideAllCenterPanels();
    show('game-end-panel');
    hide('bar-timer');

    const content = document.getElementById('game-end-content');
    const winnerName = winner?.name || 'Unknown';

    const rankHTML = rankings.map((r, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      return `<li><span class="rank-num">${medal}</span><span class="rank-name">${escapeHtml(r.name)}</span><span class="rank-score">${r.score} pts</span></li>`;
    }).join('');

    content.innerHTML = `
      <div class="end-winner">🏆 ${escapeHtml(winnerName)} wins!</div>
      <ul class="end-rankings">${rankHTML}</ul>
    `;

    document.getElementById('btn-play-again').onclick = () => {
      // Return to lobby
      socket.emit('room:leave');
      navigateTo(game === 'picto' ? 'picto-lobby' : 'sketchio-lobby');
    };
    document.getElementById('btn-back-lobby').onclick = () => {
      socket.emit('room:leave');
      navigateTo('home');
    };
  }

  function showPictoGameEnd(winner, secretWord, imposterName, players, victoryMedia, matchId) {
    hideAllCenterPanels();
    show('game-end-panel');
    hide('bar-timer');

    const content = document.getElementById('game-end-content');
    const winnerLabel = winner === 'crewmates' ? '🟢 Crewmates Win!' : '🔴 Imposter Wins!';
    const playersHTML = players.map((p, i) => `
      <li>
        <span class="rank-num">${p.role === 'imposter' ? '🕵️' : (p.isEliminated ? '💀' : '🟢')}</span>
        <span class="rank-name">${escapeHtml(p.name)} <span style="opacity:0.6;font-size:0.8em">(${p.role})</span></span>
        <span class="rank-score">${p.score || 0} pts</span>
      </li>
    `).join('');

    content.innerHTML = `
      <div class="end-winner">${winnerLabel}</div>
      <p class="end-secret-word">🔑 Secret Word: <strong>${escapeHtml(secretWord)}</strong></p>
      <p class="end-secret-word">🕵️ Imposter: <strong>${escapeHtml(imposterName || 'Unknown')}</strong></p>
      <ul class="end-rankings">${playersHTML}</ul>
    `;

    document.getElementById('btn-play-again').onclick = () => {
      PictoVictoryMedia.dismiss();
      socket.emit('room:leave');
      navigateTo('picto-lobby');
    };
    document.getElementById('btn-back-lobby').onclick = () => {
      PictoVictoryMedia.dismiss();
      socket.emit('room:leave');
      navigateTo('home');
    };

    // Trigger victory media celebration after a short delay
    if (victoryMedia && matchId) {
      setTimeout(() => {
        PictoVictoryMedia.show(winner, victoryMedia, matchId);
      }, 600);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
  }

  return { init, appendChat, renderPlayerList, updateRoom, setRoom, hideAllCenterPanels, show, hide };
})();

// ─────────────────────────────────────────────────────────────────────────────
//  PICTO VICTORY MEDIA MODULE
//  Reusable, self-contained meme-media celebration overlay.
//  All logic is isolated here; nothing else in game.js is duplicated.
// ─────────────────────────────────────────────────────────────────────────────
const PictoVictoryMedia = (() => {
  // Display duration: how long the overlay stays visible (ms)
  // Progress bar animates over this duration. Overlay dismisses at end.
  const DISPLAY_MS = 8000;
  // Extra grace window: if audio ends before DISPLAY_MS, dismiss STAY_EXTRA ms later
  const STAY_EXTRA = 1200;

  // Guard against duplicate playback for the same matchId
  const _seenMatchIds = new Set();

  let _audio = null;         // Active HTMLAudioElement
  let _dismissTimer = null;  // setTimeout handle for auto-dismiss
  let _playBtn = null;       // Manual play button reference

  // ── DOM references (lazy-cached) ───────────────────────────
  function _el(id) { return document.getElementById(id); }

  // ── Dismiss / cleanup ──────────────────────────────────────
  function dismiss() {
    if (_dismissTimer) { clearTimeout(_dismissTimer); _dismissTimer = null; }
    if (_audio) {
      _audio.pause();
      _audio.src = '';
      _audio = null;
    }
    if (_playBtn) {
      _playBtn.onclick = null;
      _playBtn = null;
    }
    const overlay = _el('victory-media-overlay');
    const panel   = overlay && overlay.querySelector('.victory-media-panel');
    if (!overlay || overlay.classList.contains('hidden')) return;

    // Play exit animation then hide
    if (panel) {
      panel.classList.add('exiting');
      setTimeout(() => {
        overlay.classList.add('hidden');
        panel.classList.remove('exiting');
      }, 350);
    } else {
      overlay.classList.add('hidden');
    }
  }

  // ── Show ───────────────────────────────────────────────────
  function show(winner, media, matchId) {
    // Deduplication guard — never play the same match event twice
    if (_seenMatchIds.has(matchId)) return;
    _seenMatchIds.add(matchId);

    // Discard stale matchIds if the set grows too large
    if (_seenMatchIds.size > 20) {
      const it = _seenMatchIds.values();
      _seenMatchIds.delete(it.next().value);
    }

    // Dismiss any active overlay first
    dismiss();

    // ── Populate DOM ──────────────────────────────────────────
    const overlay  = _el('victory-media-overlay');
    const imgEl    = _el('victory-media-img');
    const labelEl  = _el('victory-media-label');
    const barEl    = _el('victory-media-progress-bar');
    const playBtnEl = _el('victory-media-play-btn');

    if (!overlay || !imgEl || !labelEl) return;

    const isImposter = winner === 'imposters';
    labelEl.textContent = isImposter ? '🔴 Imposter Wins! 🔴' : '🟢 Crewmates Win! 🟢';
    imgEl.src    = media.image;
    imgEl.alt    = media.label + ' meme';
    playBtnEl.classList.add('hidden');

    // Reset progress bar
    if (barEl) {
      barEl.style.transition = 'none';
      barEl.style.width = '100%';
    }

    // Show the overlay
    overlay.classList.remove('hidden');

    // Clicking the backdrop dismisses immediately
    const backdrop = overlay.querySelector('.victory-media-backdrop');
    if (backdrop) {
      backdrop.onclick = () => dismiss();
    }

    // Start the progress bar animation immediately
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (barEl) {
          barEl.style.transition = `width ${DISPLAY_MS}ms linear`;
          barEl.style.width = '0%';
        }
      });
    });

    // ── Audio setup ───────────────────────────────────────────
    const audioEl = new Audio();
    audioEl.preload = 'auto';
    audioEl.loop    = false;
    audioEl.volume  = 1.0;

    _audio  = audioEl;
    _playBtn = playBtnEl;

    let audioDone = false;

    function scheduleDismiss(fromNow) {
      if (_dismissTimer) clearTimeout(_dismissTimer);
      _dismissTimer = setTimeout(() => dismiss(), fromNow);
    }

    audioEl.addEventListener('ended', () => {
      audioDone = true;
      // Keep image visible for STAY_EXTRA ms after audio ends,
      // but cap at the remaining DISPLAY_MS window
      scheduleDismiss(STAY_EXTRA);
    }, { once: true });

    audioEl.addEventListener('error', () => {
      // Audio failed — still show image for DISPLAY_MS
      console.warn('[VictoryMedia] Audio error, showing image only.');
    });

    audioEl.src = media.audio;

    // Attempt autoplay
    const playPromise = audioEl.play();
    if (playPromise !== undefined) {
      playPromise.then(() => {
        // Autoplay succeeded — hide the manual play button
        playBtnEl.classList.add('hidden');
      }).catch(() => {
        // Autoplay blocked — show the manual play button
        playBtnEl.classList.remove('hidden');
        playBtnEl.onclick = () => {
          audioEl.play().catch(() => {});
          playBtnEl.classList.add('hidden');
        };
      });
    }

    // Auto-dismiss after DISPLAY_MS regardless of audio state
    scheduleDismiss(DISPLAY_MS);
  }

  return { show, dismiss };
})();

/**
 * Suspecto Main App Controller
 * Navigation, socket management, and UI orchestration
 */
(function() {
  'use strict';

  // ── STATE ───────────────────────────────────────────────────────────
  let socket = null;
  let currentGame = null;   // 'picto' | 'sketchio'
  let currentRoom = null;
  let currentPlayer = null;
  let pendingAction = null; // 'create' | 'join'

  // ── SCREEN NAVIGATION ───────────────────────────────────────────────
  const screens = {
    home: 'screen-home',
    'picto-lobby': 'screen-picto-lobby',
    'sketchio-lobby': 'screen-sketchio-lobby',
    room: 'screen-room',
  };

  window.navigateTo = function(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screens[name]);
    if (target) { target.classList.add('active'); window.scrollTo(0, 0); }
  };

  // ── TOAST ───────────────────────────────────────────────────────────
  window.showToast = function(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 350);
    }, duration);
  };

  // ── SOCKET ──────────────────────────────────────────────────────────
  function connectSocket() {
    if (socket && socket.connected) return socket;
    socket = io({ transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: 10 });

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket.id);
    });

    socket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err);
    });

    socket.on('error', ({ message }) => {
      showToast(message || 'An error occurred.', 'error');
    });

    // Room responses
    socket.on('room:created', ({ code, room, player }) => {
      currentRoom = room;
      currentPlayer = player;
      GameManager.setRoom(room, player);
      enterRoom(room, player);
    });

    socket.on('room:joined', ({ code, room, player }) => {
      currentRoom = room;
      currentPlayer = player;
      GameManager.setRoom(room, player);
      enterRoom(room, player);
    });

    // Init sub-modules
    VoiceChat.init(socket);
    DrawingCanvas.init(document.getElementById('drawing-canvas'), socket);
    GameManager.init(socket);

    return socket;
  }

  // ── ROOM ENTRY ──────────────────────────────────────────────────────
  function enterRoom(room, player) {
    currentRoom = room;
    currentPlayer = player;

    // Update bar
    document.getElementById('bar-game-name').textContent = room.game === 'picto' ? '🔍 Picto' : '✏️ Sketchio';
    document.getElementById('bar-room-code').textContent = room.code;
    document.getElementById('lobby-room-code').textContent = room.code;

    // Host controls
    const hostControls = document.getElementById('host-controls');
    if (player.isHost) {
      hostControls.classList.remove('hidden');
    } else {
      hostControls.classList.add('hidden');
    }

    // Reset all game UI
    GameManager.hideAllCenterPanels();
    GameManager.show('center-lobby');
    document.getElementById('chat-messages').innerHTML = '';

    // Replay chat history
    if (room.chatHistory && room.chatHistory.length) {
      room.chatHistory.forEach(msg => GameManager.appendChat(msg.message, msg.senderName, msg.type));
    }

    GameManager.updateRoom(room);
    navigateTo('room');
  }

  // ── HOME SCREEN ─────────────────────────────────────────────────────
  document.getElementById('btn-play-picto').onclick = () => {
    navigateTo('picto-lobby');
  };
  document.getElementById('btn-play-sketchio').onclick = () => {
    navigateTo('sketchio-lobby');
  };

  // Home logo
  document.getElementById('home-logo-link').addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo('home');
  });

  // ── LOBBY SCREENS ────────────────────────────────────────────────────
  document.getElementById('btn-picto-create').onclick = () => openCreateModal('picto');
  document.getElementById('btn-picto-join').onclick   = () => openJoinModal('picto');
  document.getElementById('btn-sketchio-create').onclick = () => openCreateModal('sketchio');
  document.getElementById('btn-sketchio-join').onclick   = () => openJoinModal('sketchio');

  // Back buttons
  document.querySelectorAll('.back-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(btn.dataset.back || 'home');
    });
  });

  // ── CREATE MODAL ─────────────────────────────────────────────────────
  function openCreateModal(game) {
    currentGame = game;
    pendingAction = 'create';
    connectSocket();

    document.getElementById('modal-create-title').textContent = `Create ${game === 'picto' ? 'Picto' : 'Sketchio'} Room`;
    document.getElementById('create-settings-picto').classList.toggle('hidden', game !== 'picto');
    document.getElementById('create-settings-sketchio').classList.toggle('hidden', game !== 'sketchio');
    document.getElementById('create-name').value = localStorage.getItem('suspecto-name') || '';
    document.getElementById('modal-create').classList.remove('hidden');
  }

  document.getElementById('btn-create-confirm').onclick = () => {
    const name = document.getElementById('create-name').value.trim();
    if (!name) { showToast('Please enter your name.', 'error'); return; }
    localStorage.setItem('suspecto-name', name);

    let settings = {};
    if (currentGame === 'picto') {
      settings = {
        maxPlayers: parseInt(document.getElementById('create-maxplayers-picto').value),
        numImposters: parseInt(document.getElementById('create-imposters').value),
        rounds: parseInt(document.getElementById('create-rounds-picto').value),
        drawTime: parseInt(document.getElementById('create-drawtime-picto').value),
        voteTime: parseInt(document.getElementById('create-votetime').value),
        category: document.getElementById('create-category-picto').value
      };
    } else {
      const customRaw = document.getElementById('create-customwords').value;
      const customWords = customRaw ? customRaw.split(',').map(w => w.trim()).filter(w => w.length > 0 && w.length <= 32) : [];
      settings = {
        maxPlayers: parseInt(document.getElementById('create-maxplayers-sketchio').value),
        rounds: parseInt(document.getElementById('create-rounds-sketchio').value),
        drawTime: parseInt(document.getElementById('create-drawtime-sketchio').value),
        category: document.getElementById('create-category-sketchio').value,
        wordCount: parseInt(document.getElementById('create-wordcount').value),
        customWords
      };
    }

    closeModal('create');
    const s = connectSocket();
    s.emit('room:create', { game: currentGame, name, settings });
  };

  // ── JOIN MODAL ────────────────────────────────────────────────────────
  function openJoinModal(game) {
    currentGame = game;
    pendingAction = 'join';
    connectSocket();

    document.getElementById('join-name').value = localStorage.getItem('suspecto-name') || '';
    document.getElementById('join-code').value = '';

    // Check URL params
    const params = new URLSearchParams(window.location.search);
    if (params.get('room')) document.getElementById('join-code').value = params.get('room');

    document.getElementById('modal-join').classList.remove('hidden');
  }

  document.getElementById('btn-join-confirm').onclick = () => {
    const name = document.getElementById('join-name').value.trim();
    const code = document.getElementById('join-code').value.trim().toUpperCase();
    if (!name) { showToast('Please enter your name.', 'error'); return; }
    if (!code || code.length !== 6) { showToast('Please enter a valid 6-character room code.', 'error'); return; }
    localStorage.setItem('suspecto-name', name);
    closeModal('join');
    const s = connectSocket();
    s.emit('room:join', { code, name });
  };

  // Auto-join from URL
  window.addEventListener('load', () => {
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get('room');
    const gameParam = params.get('game');
    if (roomCode && gameParam) {
      currentGame = gameParam;
      openJoinModal(gameParam);
    }
  });

  // ── MODAL CLOSE ─────────────────────────────────────────────────────
  function closeModal(type) {
    document.getElementById(`modal-${type}`).classList.add('hidden');
  }

  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  // Close modal on backdrop click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        const id = overlay.id.replace('modal-', '');
        closeModal(id);
      }
    });
  });

  // ── ROOM CONTROLS ────────────────────────────────────────────────────
  document.getElementById('btn-start-game').onclick = () => {
    if (!currentRoom || !socket) return;
    if (currentRoom.game === 'picto') {
      socket.emit('picto:startGame');
    } else {
      socket.emit('sketchio:startGame');
    }
  };

  document.getElementById('btn-invite-room').onclick = () => {
    copyInviteLink();
  };

  document.getElementById('btn-copy-code').onclick = () => {
    if (!currentRoom) return;
    navigator.clipboard.writeText(currentRoom.code).then(() => showToast('Room code copied!', 'success'));
  };

  document.getElementById('btn-copy-invite').onclick = () => {
    copyInviteLink();
  };

  function copyInviteLink() {
    if (!currentRoom) return;
    const url = `${window.location.origin}?room=${currentRoom.code}&game=${currentRoom.game}`;
    navigator.clipboard.writeText(url).then(() => showToast('Invite link copied!', 'success'));
  }

  // Leave game
  document.getElementById('leave-game-btn').onclick = (e) => {
    e.preventDefault();
    if (socket) socket.emit('room:leave');
    VoiceChat.leave();
    currentRoom = null;
    currentPlayer = null;
    navigateTo('home');
  };

  // ── CHAT ─────────────────────────────────────────────────────────────
  document.getElementById('chat-form').onsubmit = (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg || !socket) return;
    socket.emit('chat:message', { message: msg });
    input.value = '';
  };

  // ── PICTO IMPOSTER GUESS ─────────────────────────────────────────────
  document.getElementById('btn-imposter-guess').onclick = () => {
    const guess = document.getElementById('imposter-guess-input').value.trim();
    if (!guess) return;
    socket.emit('picto:imposterGuess', { guess });
    document.getElementById('imposter-guess-input').value = '';
  };

  document.getElementById('imposter-guess-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-imposter-guess').click();
  });

  // ── VOICE BUTTON ─────────────────────────────────────────────────────
  document.getElementById('btn-voice-join').onclick = async () => {
    const result = await VoiceChat.join();
    if (result && result.error) showToast(result.error, 'error');
  };

  // ── JOIN CODE INPUT — UPPERCASE ONLY ────────────────────────────────
  document.getElementById('join-code').addEventListener('input', function() {
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  // ── KEYBOARD SHORTCUTS ────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    // Enter to submit modals
    if (e.key === 'Enter') {
      if (!document.getElementById('modal-create').classList.contains('hidden')) {
        document.getElementById('btn-create-confirm').click();
      } else if (!document.getElementById('modal-join').classList.contains('hidden')) {
        document.getElementById('btn-join-confirm').click();
      }
    }
    // Escape to close modals
    if (e.key === 'Escape') {
      closeModal('create');
      closeModal('join');
    }
  });

  // ── RESIZE HANDLER ────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    // Ensure canvas maintains proper dimensions
    const canvas = document.getElementById('drawing-canvas');
    if (canvas) {
      // Canvas element dimensions are fixed at 800x600
      // CSS handles the responsive scaling
    }
  });

  // ── PAGE VISIBILITY ──────────────────────────────────────────────────
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && socket && !socket.connected) {
      socket.connect();
    }
  });

  // ── HANDLE RECONNECT FROM STORAGE ────────────────────────────────────
  window.addEventListener('pageshow', () => {
    // If refreshed mid-game, offer reconnect
    const savedRoom = sessionStorage.getItem('suspecto-room');
    const savedName = localStorage.getItem('suspecto-name');
    if (savedRoom && savedName && socket) {
      socket.emit('room:reconnect', { code: savedRoom, name: savedName });
    }
  });

  socket = connectSocket();

  console.log('%c🎮 Suspecto loaded!', 'color:#27ae60;font-weight:bold;font-size:1.1em');
})();

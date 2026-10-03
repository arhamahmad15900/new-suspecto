const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 30000,
  pingInterval: 10000
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/mems', express.static(path.join(__dirname, 'mems')));

// Serve audio with correct MIME types.
// .mpeg files here are MP3-encoded (ID3v2 header confirmed); fix Content-Type so
// browsers can play them as audio via HTMLAudioElement without codec issues.
const audioStaticOpts = {
  setHeaders(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.mpeg' || ext === '.mp3') {
      res.setHeader('Content-Type', 'audio/mpeg');
    } else if (ext === '.aac') {
      res.setHeader('Content-Type', 'audio/aac');
    }
  }
};
app.use('/audio', express.static(path.join(__dirname, 'audio'), audioStaticOpts));
app.use(express.json());

// ─────────────────────────────────────────
//  DATA STORES
// ─────────────────────────────────────────
const rooms = new Map();   // roomCode → RoomState

// ─────────────────────────────────────────
//  WORD LISTS
// ─────────────────────────────────────────
const SKETCHIO_WORDS = {
  animals: ['cat','dog','elephant','giraffe','lion','penguin','dolphin','butterfly','eagle','shark','rabbit','turtle','monkey','bear','wolf','fox','deer','zebra','parrot','owl','frog','snake','tiger','panda','koala','horse','cow','pig','sheep','goat'],
  food: ['pizza','burger','sushi','taco','pasta','salad','cake','cookie','donut','ice cream','apple','banana','sandwich','hot dog','soup','bread','pancake','waffle','steak','lobster','mango','grape','watermelon','pineapple','coffee'],
  objects: ['umbrella','telescope','guitar','camera','compass','lantern','anchor','bicycle','balloon','trophy','crown','sword','shield','clock','globe','key','lock','book','pencil','hammer','scissors','mirror','candle','backpack','hat'],
  nature: ['rainbow','volcano','waterfall','mountain','island','forest','desert','glacier','tornado','lightning','snowflake','cloud','sun','moon','star','flower','tree','mushroom','coral','wave'],
  sports: ['basketball','football','tennis','swimming','surfing','skiing','archery','boxing','gymnastics','baseball','volleyball','soccer','golf','cycling','wrestling','skating','bowling','fencing','chess','poker'],
  misc: ['castle','spaceship','submarine','robot','wizard','pirate','ninja','mermaid','dragon','ghost','alien','knight','superhero','detective','scientist','chef','astronaut','firefighter','doctor','teacher']
};

const PICTO_WORDS = {
  general: ['adventure','mystery','celebration','danger','escape','freedom','hidden','journey','power','secret','shadow','silence','storm','strength','victory','wisdom','wonder','ancient','brave','clever','curious','gentle','honest','loyal','peaceful','rebel','swift','timid','wild','young'],
  animals: ['lion','shark','eagle','wolf','panther','cobra','falcon','jaguar','viper','hawk','bear','tiger','raven','fox','owl'],
  concepts: ['love','hate','fear','hope','justice','chaos','balance','truth','illusion','destiny','karma','time','memory','dream','reality','courage','betrayal','redemption','sacrifice','revenge']
};

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────
function generateRoomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function getUniqueRoomCode() {
  let code;
  do { code = generateRoomCode(); } while (rooms.has(code));
  return code;
}

function pickRandom(arr, n = 1) {
  if (!arr || arr.length === 0) return n === 1 ? 'mystery' : ['mystery'];
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  if (n === 1) return shuffled[0];
  return shuffled.slice(0, Math.min(n, shuffled.length));
}

function getWordList(game, category = 'general') {
  if (game === 'sketchio') {
    const list = SKETCHIO_WORDS[category] || SKETCHIO_WORDS.animals;
    return list;
  }
  const list = PICTO_WORDS[category] || PICTO_WORDS.general;
  return list;
}

// ─────────────────────────────────────────
//  ROOM FACTORY
// ─────────────────────────────────────────
function createRoom(game, hostId, hostName, settings) {
  const code = getUniqueRoomCode();
  const room = {
    code,
    game,             // 'picto' | 'sketchio'
    hostId,
    players: [],      // { id, name, score, role, isHost, connected }
    settings: {
      maxPlayers: settings.maxPlayers || 8,
      rounds: settings.rounds || 3,
      drawTime: settings.drawTime || 80,
      voteTime: settings.voteTime || 30,
      category: settings.category || 'general',
      customWords: settings.customWords || [],
      numImposters: settings.numImposters || 1,
      wordCount: settings.wordCount || 3,
      hints: settings.hints || 2
    },
    state: 'lobby',   // lobby | playing | voting | ended
    round: 0,
    currentDrawerIndex: 0,
    currentWord: null,
    wordOptions: [],
    votes: {},
    guessedCorrectly: new Set(),
    roundTimer: null,
    voteTimer: null,
    chatHistory: [],
    drawHistory: [],
    eliminated: [],
    secretWord: null,
    imposterId: null,
    imposterGuessAttempts: 0,
    scores: {}
  };
  rooms.set(code, room);
  return room;
}

function addPlayerToRoom(room, socketId, name) {
  const isHost = room.players.length === 0 || room.hostId === socketId;
  const player = {
    id: socketId,
    name: name.trim().substring(0, 20) || 'Player',
    score: 0,
    role: null,
    isHost,
    connected: true,
    hasGuessed: false,
    hasVoted: false
  };
  room.players.push(player);
  room.scores[socketId] = 0;
  return player;
}

function removePlayerFromRoom(room, socketId) {
  const idx = room.players.findIndex(p => p.id === socketId);
  if (idx === -1) return null;
  const [player] = room.players.splice(idx, 1);
  delete room.scores[socketId];

  // Transfer host if needed
  if (player.isHost && room.players.length > 0) {
    room.players[0].isHost = true;
    room.hostId = room.players[0].id;
  }
  return player;
}

function getRoomForSocket(socketId) {
  for (const [, room] of rooms) {
    if (room.players.some(p => p.id === socketId)) return room;
  }
  return null;
}

function getPublicRoom(room) {
  return {
    code: room.code,
    game: room.game,
    state: room.state,
    round: room.round,
    totalRounds: room.settings.rounds,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      isHost: p.isHost,
      connected: p.connected,
      hasGuessed: p.hasGuessed,
      isEliminated: room.eliminated.includes(p.id)
    })),
    settings: room.settings,
    drawHistory: room.state === 'playing' ? room.drawHistory : [],
    chatHistory: room.chatHistory.slice(-100),
    eliminated: room.eliminated,
    currentDrawerIndex: room.currentDrawerIndex
  };
}

function clearRoomTimers(room) {
  if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
  if (room.voteTimer) { clearTimeout(room.voteTimer); room.voteTimer = null; }
}

// ─────────────────────────────────────────
//  SKETCHIO GAME LOGIC
// ─────────────────────────────────────────
function sketchioStartRound(room) {
  clearRoomTimers(room);
  room.state = 'playing';
  room.guessedCorrectly = new Set();
  room.drawHistory = [];

  const activePlayers = room.players.filter(p => p.connected);
  if (activePlayers.length < 2) {
    sketchioEndGame(room);
    return;
  }

  // Advance drawer
  let attempts = 0;
  do {
    room.currentDrawerIndex = (room.currentDrawerIndex + 1) % room.players.length;
    attempts++;
  } while (!room.players[room.currentDrawerIndex]?.connected && attempts < room.players.length);

  const drawer = room.players[room.currentDrawerIndex];
  if (!drawer) { sketchioEndGame(room); return; }

  // Pick word options
  const allWords = room.settings.customWords.length >= 10
    ? room.settings.customWords
    : [...getWordList('sketchio', room.settings.category), ...room.settings.customWords];

  room.wordOptions = pickRandom(allWords, Math.min(room.settings.wordCount, allWords.length));
  room.currentWord = null;

  // Reset player guess states
  room.players.forEach(p => { p.hasGuessed = false; });

  // Send word choices only to drawer
  io.to(drawer.id).emit('sketchio:wordChoices', { words: room.wordOptions });
  // Tell everyone else a new turn is starting
  io.to(room.code).emit('sketchio:newTurn', {
    drawerId: drawer.id,
    drawerName: drawer.name,
    wordLength: null // Not known until drawer picks
  });

  // If drawer doesn't pick within 15s, auto-pick
  room.wordPickTimer = setTimeout(() => {
    if (!room.currentWord) {
      room.currentWord = room.wordOptions[0] || 'apple';
      startSketchioDrawTimer(room);
    }
  }, 15000);
}

function startSketchioDrawTimer(room) {
  clearRoomTimers(room);
  const drawer = room.players[room.currentDrawerIndex];
  if (!drawer) return;

  // Notify everyone of word details (length as blanks)
  const formatBlanks = (word, revealedIndices = new Set()) => {
    return word.split('').map((ch, i) => {
      if (ch === ' ') return '  ';
      if (revealedIndices.has(i)) return ch.toUpperCase();
      return '_';
    }).join(' ');
  };

  room.revealedLetterIndices = new Set();
  const blanks = formatBlanks(room.currentWord, room.revealedLetterIndices);

  io.to(room.code).emit('sketchio:roundStart', {
    drawerId: drawer.id,
    drawerName: drawer.name,
    wordBlanks: blanks,
    wordLength: room.currentWord.length,
    drawTime: room.settings.drawTime
  });
  // Drawer gets the actual word
  io.to(drawer.id).emit('sketchio:yourWord', { word: room.currentWord });

  const totalTime = room.settings.drawTime;
  let timeLeft = totalTime;
  const tick = () => {
    io.to(room.code).emit('sketchio:timer', { timeLeft });

    // Hint 1 at 50% time left
    if (timeLeft === Math.floor(totalTime * 0.5) && room.currentWord.length > 2) {
      revealRandomSketchioHint(room);
    }
    // Hint 2 at 25% time left
    if (timeLeft === Math.floor(totalTime * 0.25) && room.currentWord.length > 4) {
      revealRandomSketchioHint(room);
    }

    if (timeLeft <= 0) { sketchioEndTurn(room, false); return; }
    timeLeft--;
    room.roundTimer = setTimeout(tick, 1000);
  };
  room.roundTimer = setTimeout(tick, 0);
}

function revealRandomSketchioHint(room) {
  if (!room.currentWord) return;
  const unrevealed = [];
  for (let i = 0; i < room.currentWord.length; i++) {
    if (room.currentWord[i] !== ' ' && !room.revealedLetterIndices.has(i)) {
      unrevealed.push(i);
    }
  }
  if (unrevealed.length > 1) {
    const pickIdx = unrevealed[Math.floor(Math.random() * unrevealed.length)];
    room.revealedLetterIndices.add(pickIdx);
    const blanks = room.currentWord.split('').map((ch, i) => {
      if (ch === ' ') return '  ';
      if (room.revealedLetterIndices.has(i)) return ch.toUpperCase();
      return '_';
    }).join(' ');
    io.to(room.code).emit('sketchio:hint', { wordBlanks: blanks });
  }
}

function sketchioEndTurn(room, allGuessed) {
  clearRoomTimers(room);
  if (room.wordPickTimer) { clearTimeout(room.wordPickTimer); room.wordPickTimer = null; }

  const drawer = room.players[room.currentDrawerIndex];
  // Score drawer based on how many guessed
  const guessCount = room.guessedCorrectly.size;
  if (drawer && guessCount > 0) {
    const drawerPoints = Math.min(guessCount * 50, 250);
    drawer.score += drawerPoints;
    room.scores[drawer.id] = (room.scores[drawer.id] || 0) + drawerPoints;
  }

  io.to(room.code).emit('sketchio:turnEnd', {
    word: room.currentWord,
    scores: room.players.map(p => ({ id: p.id, name: p.name, score: p.score }))
  });

  // Check if all players have drawn this round
  const connectedCount = room.players.filter(p => p.connected).length;
  // Count turns within a round — track by a round-turn counter
  room._turnCount = (room._turnCount || 0) + 1;
  if (room._turnCount >= connectedCount) {
    room._turnCount = 0;
    room.round++;
    if (room.round >= room.settings.rounds) {
      setTimeout(() => sketchioEndGame(room), 3000);
    } else {
      setTimeout(() => sketchioStartRound(room), 3000);
    }
  } else {
    setTimeout(() => sketchioStartRound(room), 3000);
  }
}

function sketchioEndGame(room) {
  clearRoomTimers(room);
  room.state = 'ended';
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  io.to(room.code).emit('sketchio:gameEnd', {
    winner: sorted[0] || null,
    rankings: sorted.map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, score: p.score }))
  });
}

// ─────────────────────────────────────────
//  PICTO GAME LOGIC
// ─────────────────────────────────────────
function pictoStartGame(room) {
  clearRoomTimers(room);
  room.state = 'playing';
  room.round = 1;
  room.eliminated = [];
  room.votes = {};
  room._turnCount = 0;
  room.currentDrawerIndex = -1;

  // Assign roles
  const playerIds = room.players.map(p => p.id);
  const numImposters = Math.min(room.settings.numImposters, Math.floor(playerIds.length / 2));
  const imposterIds = pickRandom(playerIds, numImposters);
  const impostersArr = Array.isArray(imposterIds) ? imposterIds : [imposterIds];

  // Pick secret word
  const wordList = room.settings.customWords.length >= 5
    ? room.settings.customWords
    : getWordList('picto', room.settings.category);
  room.secretWord = pickRandom(wordList);
  room.imposterId = impostersArr[0]; // Primary imposter for win condition

  room.players.forEach(p => {
    p.role = impostersArr.includes(p.id) ? 'imposter' : 'crewmate';
    p.hasGuessed = false;
    p.hasVoted = false;
    p.score = 0;
  });

  // Send private role assignments
  room.players.forEach(p => {
    if (p.role === 'crewmate') {
      io.to(p.id).emit('picto:roleAssigned', {
        role: 'crewmate',
        secretWord: room.secretWord
      });
    } else {
      io.to(p.id).emit('picto:roleAssigned', {
        role: 'imposter',
        hint: 'You are the Imposter! Blend in with other players. You do NOT know the secret word.'
      });
    }
  });

  io.to(room.code).emit('picto:gameStarted', {
    players: room.players.map(p => ({ id: p.id, name: p.name, isEliminated: false })),
    rounds: room.settings.rounds,
    round: room.round
  });

  setTimeout(() => pictoStartDrawingTurn(room), 2000);
}

function pictoStartDrawingTurn(room) {
  clearRoomTimers(room);
  room.drawHistory = [];
  room.state = 'playing';

  const activePlayers = room.players.filter(p => p.connected && !room.eliminated.includes(p.id));
  if (activePlayers.length < 2) {
    pictoEndGame(room, 'crewmates');
    return;
  }

  // Next drawer (skip eliminated)
  let attempts = 0;
  do {
    room.currentDrawerIndex = (room.currentDrawerIndex + 1) % room.players.length;
    attempts++;
  } while (
    (room.eliminated.includes(room.players[room.currentDrawerIndex]?.id) ||
     !room.players[room.currentDrawerIndex]?.connected) &&
    attempts <= room.players.length
  );

  const drawer = room.players[room.currentDrawerIndex];
  if (!drawer) { pictoEndGame(room, 'crewmates'); return; }

  io.to(room.code).emit('picto:drawingTurn', {
    drawerId: drawer.id,
    drawerName: drawer.name,
    drawTime: room.settings.drawTime,
    round: room.round
  });

  let timeLeft = room.settings.drawTime;
  const tick = () => {
    io.to(room.code).emit('picto:timer', { timeLeft, phase: 'drawing' });
    if (timeLeft <= 0) { pictoStartVoting(room); return; }
    timeLeft--;
    room.roundTimer = setTimeout(tick, 1000);
  };
  room.roundTimer = setTimeout(tick, 0);
}

function pictoStartVoting(room) {
  clearRoomTimers(room);
  room.state = 'voting';
  room.votes = {};
  room.players.forEach(p => { p.hasVoted = false; });

  const eligible = room.players.filter(p => !room.eliminated.includes(p.id) && p.connected);
  io.to(room.code).emit('picto:votingPhase', {
    eligiblePlayers: eligible.map(p => ({ id: p.id, name: p.name })),
    voteTime: room.settings.voteTime
  });

  let timeLeft = room.settings.voteTime;
  const tick = () => {
    io.to(room.code).emit('picto:timer', { timeLeft, phase: 'voting' });
    if (timeLeft <= 0) { pictoTallyVotes(room); return; }
    timeLeft--;
    room.voteTimer = setTimeout(tick, 1000);
  };
  room.voteTimer = setTimeout(tick, 0);
}

function pictoTallyVotes(room) {
  clearRoomTimers(room);
  const voteCounts = {};
  for (const targetId of Object.values(room.votes)) {
    voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
  }

  let maxVotes = 0;
  let eliminated = null;
  let tied = false;

  for (const [id, count] of Object.entries(voteCounts)) {
    if (count > maxVotes) { maxVotes = count; eliminated = id; tied = false; }
    else if (count === maxVotes) { tied = true; }
  }

  if (tied || !eliminated) {
    // No elimination on tie
    io.to(room.code).emit('picto:voteResult', {
      eliminated: null,
      tie: true,
      votes: voteCounts
    });
    setTimeout(() => pictoNextRoundOrEnd(room), 3000);
    return;
  }

  room.eliminated.push(eliminated);
  const eliminatedPlayer = room.players.find(p => p.id === eliminated);
  const isImposter = eliminatedPlayer?.role === 'imposter';

  io.to(room.code).emit('picto:voteResult', {
    eliminated: eliminated,
    eliminatedName: eliminatedPlayer?.name,
    eliminatedRole: eliminatedPlayer?.role,
    isImposter,
    tie: false,
    votes: voteCounts
  });

  if (isImposter) {
    // Notify all players that imposter has a final chance to guess
    io.to(room.code).emit('picto:imposterGuessing', {
      imposterId: eliminated,
      imposterName: eliminatedPlayer?.name || 'Imposter',
      timeLimit: 20
    });

    // Imposter gets a chance to guess the secret word
    io.to(eliminated).emit('picto:imposterGuessChance', {
      message: 'You have been eliminated! You are the Imposter. Guess the secret word to still win!'
    });
    room.state = 'imposterGuess';
    room.imposterGuessAttempts = 0;
    // 20 second window to guess
    room.imposterGuessTimer = setTimeout(() => {
      if (room.state === 'imposterGuess') {
        pictoEndGame(room, 'crewmates');
      }
    }, 20000);
  } else {
    // Check if enough crewmates are eliminated
    const activePlayers = room.players.filter(p => !room.eliminated.includes(p.id) && p.connected);
    const activeImposters = activePlayers.filter(p => p.role === 'imposter');
    if (activeImposters.length >= activePlayers.length - activeImposters.length) {
      pictoEndGame(room, 'imposters');
    } else {
      setTimeout(() => pictoNextRoundOrEnd(room), 3000);
    }
  }
}

function pictoNextRoundOrEnd(room) {
  room._turnCount = (room._turnCount || 0) + 1;
  const activePlayers = room.players.filter(p => !room.eliminated.includes(p.id) && p.connected);

  if (room._turnCount >= room.settings.rounds || activePlayers.length < 2) {
    // Game over without imposter found — imposter wins by default
    const imposter = room.players.find(p => p.role === 'imposter');
    if (imposter && !room.eliminated.includes(imposter.id)) {
      pictoEndGame(room, 'imposters');
    } else {
      pictoEndGame(room, 'crewmates');
    }
  } else {
    room.round++;
    io.to(room.code).emit('picto:newRound', { round: room.round });
    setTimeout(() => pictoStartDrawingTurn(room), 2000);
  }
}

// ─────────────────────────────────────────
//  PICTO VICTORY MEDIA CONFIG
// ─────────────────────────────────────────
const PICTO_VICTORY_MEDIA = {
  imposters: [
    { image: '/mems/ye kaise.png', audio: '/audio/ye kaise.aac', label: 'ye kaise' },
    { image: '/mems/muhehe.png',   audio: '/audio/muhehe.mpeg',  label: 'muhehe'   },
    { image: '/mems/rizz.jpg',     audio: '/audio/rizz.mpeg',    label: 'rizz'     }
  ],
  crewmates: [
    { image: '/mems/sad.png',      audio: '/audio/sad.mpeg',     label: 'sad'      },
    { image: '/mems/laugh.jpeg',   audio: '/audio/laugh.aac',    label: 'laugh'    }
  ]
};

function pictoEndGame(room, winner) {
  clearRoomTimers(room);
  if (room.imposterGuessTimer) { clearTimeout(room.imposterGuessTimer); room.imposterGuessTimer = null; }
  room.state = 'ended';
  const imposter = room.players.find(p => p.role === 'imposter');

  // Select victory media combination once per match, server-side, avoiding repeat
  const mediaPool = PICTO_VICTORY_MEDIA[winner] || PICTO_VICTORY_MEDIA.crewmates;
  let mediaIndex = Math.floor(Math.random() * mediaPool.length);
  // Avoid repeating the same combo as last match in this room
  if (mediaPool.length > 1 && room._lastVictoryMediaIndex === mediaIndex) {
    mediaIndex = (mediaIndex + 1) % mediaPool.length;
  }
  room._lastVictoryMediaIndex = mediaIndex;
  const selectedMedia = mediaPool[mediaIndex];
  // Unique match ID to prevent duplicate playback on re-render / reconnect
  const matchId = uuidv4();

  io.to(room.code).emit('picto:gameEnd', {
    winner,        // 'crewmates' | 'imposters'
    secretWord: room.secretWord,
    imposterName: imposter?.name,
    imposterId: imposter?.id,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      role: p.role,
      score: p.score,
      isEliminated: room.eliminated.includes(p.id)
    })),
    victoryMedia: selectedMedia,
    matchId
  });
}

// ─────────────────────────────────────────
//  SOCKET.IO HANDLERS
// ─────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} connected`);

  // ── Room Management ─────────────────────
  socket.on('room:create', ({ game, name, settings = {} }) => {
    if (!game || !name) return socket.emit('error', { message: 'Missing game or name' });
    name = String(name).trim().substring(0, 20);
    if (!name) return socket.emit('error', { message: 'Invalid name' });

    const room = createRoom(game, socket.id, name, settings);
    const player = addPlayerToRoom(room, socket.id, name);
    player.isHost = true;
    socket.join(room.code);
    socket.emit('room:created', { code: room.code, room: getPublicRoom(room), player });
    console.log(`[ROOM] ${name} created room ${room.code} (${game})`);
  });

  socket.on('room:join', ({ code, name }) => {
    code = String(code || '').toUpperCase().trim();
    name = String(name || '').trim().substring(0, 20);
    if (!code || !name) return socket.emit('error', { message: 'Missing room code or name' });

    const room = rooms.get(code);
    if (!room) return socket.emit('error', { message: 'Room not found. Check the code and try again.' });
    if (room.state !== 'lobby') return socket.emit('error', { message: 'Game already in progress.' });
    if (room.players.filter(p => p.connected).length >= room.settings.maxPlayers) {
      return socket.emit('error', { message: 'Room is full.' });
    }

    const player = addPlayerToRoom(room, socket.id, name);
    socket.join(code);
    socket.emit('room:joined', { code, room: getPublicRoom(room), player });
    socket.to(code).emit('room:playerJoined', { player: { id: player.id, name: player.name, score: 0 }, room: getPublicRoom(room) });
    console.log(`[ROOM] ${name} joined ${code}`);
  });

  socket.on('room:leave', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    const player = removePlayerFromRoom(room, socket.id);
    socket.leave(room.code);
    if (room.players.length === 0) {
      clearRoomTimers(room);
      rooms.delete(room.code);
      console.log(`[ROOM] ${room.code} deleted (empty)`);
    } else {
      io.to(room.code).emit('room:playerLeft', { playerId: socket.id, room: getPublicRoom(room) });
    }
  });

  socket.on('room:kick', ({ targetId }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.hostId !== socket.id) return;
    const target = room.players.find(p => p.id === targetId);
    if (!target) return;
    removePlayerFromRoom(room, targetId);
    io.to(targetId).emit('room:kicked', { message: 'You were kicked by the host.' });
    io.to(room.code).emit('room:playerLeft', { playerId: targetId, room: getPublicRoom(room) });
  });

  socket.on('room:updateSettings', (settings) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.hostId !== socket.id || room.state !== 'lobby') return;
    Object.assign(room.settings, settings);
    io.to(room.code).emit('room:settingsUpdated', { settings: room.settings });
  });

  // ── Chat ────────────────────────────────
  socket.on('chat:message', ({ message }) => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    message = String(message || '').trim().substring(0, 200);
    if (!message) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    // Sketchio guess handling
    if (room.game === 'sketchio' && room.state === 'playing' && room.currentWord) {
      const drawer = room.players[room.currentDrawerIndex];
      if (socket.id !== drawer?.id && !room.guessedCorrectly.has(socket.id)) {
        const normalizedGuess = message.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
        const normalizedWord = room.currentWord.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
        if (normalizedGuess === normalizedWord) {
          room.guessedCorrectly.add(socket.id);
          player.hasGuessed = true;
          // Score based on time remaining — get from last timer tick
          const guessScore = Math.max(100, 300 - (room.guessedCorrectly.size - 1) * 50);
          player.score += guessScore;
          room.scores[socket.id] = (room.scores[socket.id] || 0) + guessScore;

          io.to(socket.id).emit('sketchio:correctGuess', { word: room.currentWord, points: guessScore });
          io.to(room.code).emit('chat:message', {
            senderId: 'system',
            senderName: 'Game',
            message: `🎉 ${player.name} guessed the word!`,
            type: 'system',
            timestamp: Date.now()
          });
          io.to(room.code).emit('sketchio:scoreUpdate', {
            players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score, hasGuessed: p.hasGuessed }))
          });

          // Check if all non-drawers guessed
          const nonDrawers = room.players.filter(p => p.connected && p.id !== drawer?.id);
          if (room.guessedCorrectly.size >= nonDrawers.length) {
            clearTimeout(room.roundTimer);
            sketchioEndTurn(room, true);
          }
          return;
        } else {
          // Check if guess is very close (1 letter off)
          const isCloseWord = (a, b) => {
            if (Math.abs(a.length - b.length) > 1) return false;
            let diff = 0;
            let i = 0, j = 0;
            while (i < a.length && j < b.length) {
              if (a[i] !== b[j]) {
                diff++;
                if (diff > 1) return false;
                if (a.length > b.length) i++;
                else if (b.length > a.length) j++;
                else { i++; j++; }
              } else {
                i++; j++;
              }
            }
            return true;
          };

          if (normalizedGuess.length > 2 && isCloseWord(normalizedGuess, normalizedWord)) {
            socket.emit('chat:message', {
              senderId: 'system',
              senderName: 'Game',
              message: `💡 "${message}" is very close!`,
              type: 'system',
              timestamp: Date.now()
            });
          }

          const chatMsg = {
            senderId: socket.id,
            senderName: player.name,
            message,
            type: 'chat',
            timestamp: Date.now()
          };
          room.chatHistory.push(chatMsg);
          io.to(room.code).emit('chat:message', chatMsg);
          return;
        }
      }
    }

    const chatMsg = {
      senderId: socket.id,
      senderName: player.name,
      message,
      type: 'chat',
      timestamp: Date.now()
    };
    room.chatHistory.push(chatMsg);
    if (room.chatHistory.length > 200) room.chatHistory.shift();
    io.to(room.code).emit('chat:message', chatMsg);
  });

  // ── Drawing ─────────────────────────────
  socket.on('draw:event', (data) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.state !== 'playing') return;
    const drawer = room.players[room.currentDrawerIndex];
    if (!drawer || drawer.id !== socket.id) return;

    const event = {
      type: data.type,
      x: data.x, y: data.y,
      x2: data.x2, y2: data.y2,
      color: data.color || '#000000',
      size: Math.min(Math.max(parseInt(data.size) || 4, 1), 50),
      tool: data.tool || 'pen'
    };

    room.drawHistory.push(event);
    if (room.drawHistory.length > 5000) room.drawHistory.shift();
    socket.to(room.code).emit('draw:event', event);
  });

  socket.on('draw:clear', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    const drawer = room.players[room.currentDrawerIndex];
    if (!drawer || drawer.id !== socket.id) return;
    room.drawHistory = [];
    io.to(room.code).emit('draw:clear');
  });

  socket.on('draw:undo', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    const drawer = room.players[room.currentDrawerIndex];
    if (!drawer || drawer.id !== socket.id) return;

    // Find the last stroke start or fill event
    let lastStrokeStart = -1;
    for (let i = room.drawHistory.length - 1; i >= 0; i--) {
      if (room.drawHistory[i].type === 'start' || room.drawHistory[i].type === 'fill') {
        lastStrokeStart = i;
        break;
      }
    }
    if (lastStrokeStart !== -1) {
      room.drawHistory = room.drawHistory.slice(0, lastStrokeStart);
    } else {
      room.drawHistory = [];
    }
    io.to(room.code).emit('draw:sync', { history: room.drawHistory });
  });

  socket.on('draw:requestSync', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    socket.emit('draw:sync', { history: room.drawHistory });
  });

  // ── Sketchio-specific ───────────────────
  socket.on('sketchio:startGame', () => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.hostId !== socket.id || room.game !== 'sketchio') return;
    if (room.players.filter(p => p.connected).length < 2) {
      return socket.emit('error', { message: 'Need at least 2 players to start.' });
    }
    room.round = 0;
    room._turnCount = 0;
    room.currentDrawerIndex = -1;
    io.to(room.code).emit('sketchio:gameStarted', { settings: room.settings });
    setTimeout(() => sketchioStartRound(room), 1000);
  });

  socket.on('sketchio:wordChosen', ({ word }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.game !== 'sketchio') return;
    const drawer = room.players[room.currentDrawerIndex];
    if (!drawer || drawer.id !== socket.id || room.currentWord) return;
    if (!room.wordOptions.includes(word)) return;
    if (room.wordPickTimer) { clearTimeout(room.wordPickTimer); room.wordPickTimer = null; }
    room.currentWord = word;
    startSketchioDrawTimer(room);
  });

  // ── Picto-specific ──────────────────────
  socket.on('picto:startGame', () => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.hostId !== socket.id || room.game !== 'picto') return;
    if (room.players.filter(p => p.connected).length < 2) {
      return socket.emit('error', { message: 'Need at least 2 players to start Picto.' });
    }
    pictoStartGame(room);
  });

  socket.on('picto:vote', ({ targetId }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.game !== 'picto' || room.state !== 'voting') return;
    const voter = room.players.find(p => p.id === socket.id);
    if (!voter || voter.hasVoted) return;
    if (targetId === socket.id) return; // Can't vote self
    if (room.eliminated.includes(targetId)) return;

    voter.hasVoted = true;
    room.votes[socket.id] = targetId;

    // Check if all voted
    const eligible = room.players.filter(p => !room.eliminated.includes(p.id) && p.connected);
    const allVoted = eligible.every(p => p.hasVoted);
    if (allVoted) pictoTallyVotes(room);
  });

  socket.on('picto:imposterGuess', ({ guess }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.state !== 'imposterGuess') return;
    if (socket.id !== room.imposterId) return;
    guess = String(guess || '').trim().toLowerCase();
    const secret = room.secretWord.toLowerCase().trim();

    if (guess === secret) {
      if (room.imposterGuessTimer) { clearTimeout(room.imposterGuessTimer); room.imposterGuessTimer = null; }
      io.to(room.code).emit('picto:imposterCorrectGuess', { message: 'The Imposter guessed the secret word correctly!' });
      pictoEndGame(room, 'imposters');
    } else {
      room.imposterGuessAttempts++;
      io.to(socket.id).emit('picto:imposterWrongGuess', { attemptsLeft: Math.max(0, 3 - room.imposterGuessAttempts) });
      if (room.imposterGuessAttempts >= 3) {
        if (room.imposterGuessTimer) { clearTimeout(room.imposterGuessTimer); room.imposterGuessTimer = null; }
        pictoEndGame(room, 'crewmates');
      }
    }
  });

  // ── WebRTC Voice Signaling ──────────────
  socket.on('voice:offer', ({ targetId, offer }) => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    io.to(targetId).emit('voice:offer', { fromId: socket.id, offer });
  });

  socket.on('voice:answer', ({ targetId, answer }) => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    io.to(targetId).emit('voice:answer', { fromId: socket.id, answer });
  });

  socket.on('voice:ice', ({ targetId, candidate }) => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    io.to(targetId).emit('voice:ice', { fromId: socket.id, candidate });
  });

  socket.on('voice:join', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    socket.to(room.code).emit('voice:peerJoined', { peerId: socket.id, peerName: player?.name });
  });

  socket.on('voice:leave', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    socket.to(room.code).emit('voice:peerLeft', { peerId: socket.id });
  });

  socket.on('voice:speaking', ({ speaking }) => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    socket.to(room.code).emit('voice:speaking', { peerId: socket.id, speaking });
  });

  // ── Disconnect ──────────────────────────
  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id} disconnected`);
    const room = getRoomForSocket(socket.id);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (player) player.connected = false;

    const connected = room.players.filter(p => p.connected);
    if (connected.length === 0) {
      clearRoomTimers(room);
      setTimeout(() => {
        if (rooms.has(room.code) && room.players.filter(p => p.connected).length === 0) {
          rooms.delete(room.code);
          console.log(`[ROOM] ${room.code} cleaned up`);
        }
      }, 60000);
    } else {
      io.to(room.code).emit('room:playerDisconnected', {
        playerId: socket.id,
        room: getPublicRoom(room)
      });
    }

    socket.to(room.code).emit('voice:peerLeft', { peerId: socket.id });
  });

  // ── Reconnect ───────────────────────────
  socket.on('room:reconnect', ({ code, name }) => {
    code = String(code || '').toUpperCase().trim();
    name = String(name || '').trim();
    const room = rooms.get(code);
    if (!room) return socket.emit('error', { message: 'Room no longer exists.' });

    const existing = room.players.find(p => p.name === name && !p.connected);
    if (existing) {
      existing.id = socket.id;
      existing.connected = true;
      socket.join(code);
      socket.emit('room:reconnected', { room: getPublicRoom(room), player: existing });
      io.to(code).emit('room:playerReconnected', { playerId: socket.id, playerName: name, room: getPublicRoom(room) });
    } else {
      socket.emit('error', { message: 'Could not reconnect. Name not found in room.' });
    }
  });
});

// ─────────────────────────────────────────
//  REST API
// ─────────────────────────────────────────
app.get('/api/room/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ exists: true, state: room.state, players: room.players.length, maxPlayers: room.settings.maxPlayers, game: room.game });
});

// Fallback to index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────────────────────────────
//  START
// ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎮 Suspecto server running at http://localhost:${PORT}\n`);
});

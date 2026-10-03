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
//  WORD LISTS — Sketchio with difficulty
// ─────────────────────────────────────────
// Each word object: { word, difficulty }
// difficulty: 'easy' | 'medium' | 'hard'

const SKETCHIO_WORDS_BY_CATEGORY = {
  animals: [
    // Easy
    { word: 'cat', difficulty: 'easy' },
    { word: 'dog', difficulty: 'easy' },
    { word: 'fish', difficulty: 'easy' },
    { word: 'bird', difficulty: 'easy' },
    { word: 'cow', difficulty: 'easy' },
    { word: 'pig', difficulty: 'easy' },
    { word: 'duck', difficulty: 'easy' },
    { word: 'frog', difficulty: 'easy' },
    { word: 'bee', difficulty: 'easy' },
    { word: 'ant', difficulty: 'easy' },
    // Medium
    { word: 'elephant', difficulty: 'medium' },
    { word: 'giraffe', difficulty: 'medium' },
    { word: 'penguin', difficulty: 'medium' },
    { word: 'dolphin', difficulty: 'medium' },
    { word: 'rabbit', difficulty: 'medium' },
    { word: 'turtle', difficulty: 'medium' },
    { word: 'monkey', difficulty: 'medium' },
    { word: 'parrot', difficulty: 'medium' },
    { word: 'butterfly', difficulty: 'medium' },
    { word: 'kangaroo', difficulty: 'medium' },
    { word: 'panda', difficulty: 'medium' },
    { word: 'koala', difficulty: 'medium' },
    { word: 'octopus', difficulty: 'medium' },
    { word: 'flamingo', difficulty: 'medium' },
    // Hard
    { word: 'chameleon', difficulty: 'hard' },
    { word: 'platypus', difficulty: 'hard' },
    { word: 'axolotl', difficulty: 'hard' },
    { word: 'narwhal', difficulty: 'hard' },
    { word: 'pangolin', difficulty: 'hard' },
    { word: 'wombat', difficulty: 'hard' },
  ],
  food: [
    { word: 'apple', difficulty: 'easy' },
    { word: 'banana', difficulty: 'easy' },
    { word: 'pizza', difficulty: 'easy' },
    { word: 'cake', difficulty: 'easy' },
    { word: 'cookie', difficulty: 'easy' },
    { word: 'bread', difficulty: 'easy' },
    { word: 'egg', difficulty: 'easy' },
    { word: 'corn', difficulty: 'easy' },
    { word: 'grape', difficulty: 'easy' },
    { word: 'milk', difficulty: 'easy' },
    { word: 'burger', difficulty: 'medium' },
    { word: 'sushi', difficulty: 'medium' },
    { word: 'taco', difficulty: 'medium' },
    { word: 'pasta', difficulty: 'medium' },
    { word: 'donut', difficulty: 'medium' },
    { word: 'sandwich', difficulty: 'medium' },
    { word: 'hot dog', difficulty: 'medium' },
    { word: 'pancake', difficulty: 'medium' },
    { word: 'waffle', difficulty: 'medium' },
    { word: 'mango', difficulty: 'medium' },
    { word: 'pineapple', difficulty: 'medium' },
    { word: 'watermelon', difficulty: 'medium' },
    { word: 'lobster', difficulty: 'hard' },
    { word: 'spaghetti', difficulty: 'hard' },
    { word: 'soufflé', difficulty: 'hard' },
    { word: 'bruschetta', difficulty: 'hard' },
    { word: 'quiche', difficulty: 'hard' },
    { word: 'croissant', difficulty: 'hard' },
  ],
  objects: [
    { word: 'umbrella', difficulty: 'easy' },
    { word: 'key', difficulty: 'easy' },
    { word: 'book', difficulty: 'easy' },
    { word: 'clock', difficulty: 'easy' },
    { word: 'hat', difficulty: 'easy' },
    { word: 'sock', difficulty: 'easy' },
    { word: 'cup', difficulty: 'easy' },
    { word: 'chair', difficulty: 'easy' },
    { word: 'table', difficulty: 'easy' },
    { word: 'phone', difficulty: 'easy' },
    { word: 'guitar', difficulty: 'medium' },
    { word: 'camera', difficulty: 'medium' },
    { word: 'compass', difficulty: 'medium' },
    { word: 'lantern', difficulty: 'medium' },
    { word: 'anchor', difficulty: 'medium' },
    { word: 'bicycle', difficulty: 'medium' },
    { word: 'balloon', difficulty: 'medium' },
    { word: 'trophy', difficulty: 'medium' },
    { word: 'telescope', difficulty: 'medium' },
    { word: 'backpack', difficulty: 'medium' },
    { word: 'microscope', difficulty: 'hard' },
    { word: 'hourglass', difficulty: 'hard' },
    { word: 'periscope', difficulty: 'hard' },
    { word: 'thermometer', difficulty: 'hard' },
    { word: 'kaleidoscope', difficulty: 'hard' },
    { word: 'metronome', difficulty: 'hard' },
  ],
  nature: [
    { word: 'sun', difficulty: 'easy' },
    { word: 'moon', difficulty: 'easy' },
    { word: 'star', difficulty: 'easy' },
    { word: 'tree', difficulty: 'easy' },
    { word: 'flower', difficulty: 'easy' },
    { word: 'cloud', difficulty: 'easy' },
    { word: 'rain', difficulty: 'easy' },
    { word: 'wave', difficulty: 'easy' },
    { word: 'leaf', difficulty: 'easy' },
    { word: 'rainbow', difficulty: 'medium' },
    { word: 'waterfall', difficulty: 'medium' },
    { word: 'mountain', difficulty: 'medium' },
    { word: 'island', difficulty: 'medium' },
    { word: 'forest', difficulty: 'medium' },
    { word: 'desert', difficulty: 'medium' },
    { word: 'snowflake', difficulty: 'medium' },
    { word: 'mushroom', difficulty: 'medium' },
    { word: 'coral', difficulty: 'medium' },
    { word: 'volcano', difficulty: 'medium' },
    { word: 'glacier', difficulty: 'hard' },
    { word: 'tornado', difficulty: 'hard' },
    { word: 'aurora', difficulty: 'hard' },
    { word: 'stalactite', difficulty: 'hard' },
    { word: 'geyser', difficulty: 'hard' },
  ],
  sports: [
    { word: 'swimming', difficulty: 'easy' },
    { word: 'running', difficulty: 'easy' },
    { word: 'jumping', difficulty: 'easy' },
    { word: 'soccer', difficulty: 'easy' },
    { word: 'tennis', difficulty: 'easy' },
    { word: 'golf', difficulty: 'easy' },
    { word: 'boxing', difficulty: 'medium' },
    { word: 'basketball', difficulty: 'medium' },
    { word: 'football', difficulty: 'medium' },
    { word: 'surfing', difficulty: 'medium' },
    { word: 'skiing', difficulty: 'medium' },
    { word: 'archery', difficulty: 'medium' },
    { word: 'gymnastics', difficulty: 'medium' },
    { word: 'baseball', difficulty: 'medium' },
    { word: 'volleyball', difficulty: 'medium' },
    { word: 'cycling', difficulty: 'medium' },
    { word: 'wrestling', difficulty: 'hard' },
    { word: 'fencing', difficulty: 'hard' },
    { word: 'bobsled', difficulty: 'hard' },
    { word: 'discus throw', difficulty: 'hard' },
    { word: 'pole vault', difficulty: 'hard' },
  ],
  misc: [
    { word: 'castle', difficulty: 'easy' },
    { word: 'ghost', difficulty: 'easy' },
    { word: 'crown', difficulty: 'easy' },
    { word: 'sword', difficulty: 'easy' },
    { word: 'shield', difficulty: 'easy' },
    { word: 'pirate', difficulty: 'medium' },
    { word: 'ninja', difficulty: 'medium' },
    { word: 'robot', difficulty: 'medium' },
    { word: 'wizard', difficulty: 'medium' },
    { word: 'mermaid', difficulty: 'medium' },
    { word: 'dragon', difficulty: 'medium' },
    { word: 'alien', difficulty: 'medium' },
    { word: 'knight', difficulty: 'medium' },
    { word: 'superhero', difficulty: 'medium' },
    { word: 'spaceship', difficulty: 'hard' },
    { word: 'submarine', difficulty: 'hard' },
    { word: 'detective', difficulty: 'hard' },
    { word: 'astronaut', difficulty: 'hard' },
    { word: 'archaeologist', difficulty: 'hard' },
  ],
  twoword: [
    // Easy two-word phrases
    { word: 'fire truck', difficulty: 'easy' },
    { word: 'hot dog', difficulty: 'easy' },
    { word: 'sun glasses', difficulty: 'easy' },
    { word: 'rain bow', difficulty: 'easy' },
    { word: 'door bell', difficulty: 'easy' },
    { word: 'book shelf', difficulty: 'easy' },
    { word: 'foot ball', difficulty: 'easy' },
    { word: 'snow man', difficulty: 'easy' },
    { word: 'sea horse', difficulty: 'easy' },
    { word: 'butter fly', difficulty: 'easy' },
    // Medium two-word phrases
    { word: 'water tank', difficulty: 'medium' },
    { word: 'hand wash', difficulty: 'medium' },
    { word: 'tooth brush', difficulty: 'medium' },
    { word: 'swimming pool', difficulty: 'medium' },
    { word: 'coffee cup', difficulty: 'medium' },
    { word: 'life guard', difficulty: 'medium' },
    { word: 'sand castle', difficulty: 'medium' },
    { word: 'treasure map', difficulty: 'medium' },
    { word: 'roller coaster', difficulty: 'medium' },
    { word: 'shooting star', difficulty: 'medium' },
    { word: 'lemon tree', difficulty: 'medium' },
    { word: 'wind mill', difficulty: 'medium' },
    { word: 'light house', difficulty: 'medium' },
    { word: 'basket ball', difficulty: 'medium' },
    { word: 'flower pot', difficulty: 'medium' },
    // Hard two-word phrases
    { word: 'solar panel', difficulty: 'hard' },
    { word: 'time machine', difficulty: 'hard' },
    { word: 'black hole', difficulty: 'hard' },
    { word: 'steam engine', difficulty: 'hard' },
    { word: 'escape route', difficulty: 'hard' },
    { word: 'grand canyon', difficulty: 'hard' },
    { word: 'brain storm', difficulty: 'hard' },
    { word: 'chain reaction', difficulty: 'hard' },
    { word: 'double agent', difficulty: 'hard' },
    { word: 'fast forward', difficulty: 'hard' },
  ],
};

// Legacy flat word lists for Picto (unchanged)
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

/**
 * Get Sketchio word list filtered by category and difficulty.
 * category: 'random' | 'twoword' | 'animals' | 'food' | 'objects' | 'nature' | 'sports' | 'misc'
 * difficulty: 'easy' | 'medium' | 'hard' | '' (any)
 * Returns array of word strings.
 */
function getSketchioWordList(category, difficulty) {
  let wordObjs = [];

  if (category === 'random') {
    // Combine all non-twoword categories
    for (const [cat, words] of Object.entries(SKETCHIO_WORDS_BY_CATEGORY)) {
      if (cat !== 'twoword') wordObjs.push(...words);
    }
  } else if (SKETCHIO_WORDS_BY_CATEGORY[category]) {
    wordObjs = SKETCHIO_WORDS_BY_CATEGORY[category];
  } else {
    // Fallback: all animals
    wordObjs = SKETCHIO_WORDS_BY_CATEGORY.animals;
  }

  // Filter by difficulty if specified
  if (difficulty && difficulty !== 'any') {
    const filtered = wordObjs.filter(w => w.difficulty === difficulty);
    // Only use filtered if we have enough words; otherwise use all
    if (filtered.length >= 3) wordObjs = filtered;
  }

  return wordObjs.map(w => w.word);
}

function getPictoWordList(category) {
  return PICTO_WORDS[category] || PICTO_WORDS.general;
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
      difficulty: settings.difficulty || 'any',
      customWords: settings.customWords || [],
      numImposters: settings.numImposters || 1,
      wordCount: 3,  // Always 3 choices for Sketchio
      hints: settings.hints || 2,
      // Picto-specific: per-player draw time (15–20s default)
      playerDrawTime: settings.playerDrawTime || 20,
    },
    state: 'lobby',   // lobby | playing | voting | ended | imposterGuess
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
    scores: {},

    // Picto sequential drawing state
    pictoDrawOrder: [],          // ordered list of player IDs for the current drawing round
    pictoDrawOrderIndex: -1,     // index into pictoDrawOrder for current drawer
    pictoHasDrawn: new Set(),    // IDs of players who have drawn in current round
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
  if (room.wordPickTimer) { clearTimeout(room.wordPickTimer); room.wordPickTimer = null; }
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

  // Advance drawer (cycle through connected players)
  let attempts = 0;
  do {
    room.currentDrawerIndex = (room.currentDrawerIndex + 1) % room.players.length;
    attempts++;
  } while (!room.players[room.currentDrawerIndex]?.connected && attempts < room.players.length);

  const drawer = room.players[room.currentDrawerIndex];
  if (!drawer) { sketchioEndGame(room); return; }

  // Pick word options (always 3, respecting category+difficulty)
  const category = room.settings.category || 'animals';
  const difficulty = room.settings.difficulty || 'any';

  let wordPool;
  if (room.settings.customWords && room.settings.customWords.length >= 10) {
    wordPool = room.settings.customWords;
  } else {
    wordPool = getSketchioWordList(category, difficulty);
    if (room.settings.customWords && room.settings.customWords.length > 0) {
      wordPool = [...wordPool, ...room.settings.customWords];
    }
  }

  // Deduplicate
  wordPool = [...new Set(wordPool)];

  room.wordOptions = pickRandom(wordPool, Math.min(3, wordPool.length));
  // Ensure exactly 3 (pad with alternatives if not enough)
  while (room.wordOptions.length < 3 && wordPool.length > 0) {
    const extra = pickRandom(wordPool, 1);
    if (!room.wordOptions.includes(extra)) room.wordOptions.push(extra);
  }

  room.currentWord = null;

  // Reset player guess states
  room.players.forEach(p => { p.hasGuessed = false; });

  // Send word choices only to drawer (always exactly 3)
  io.to(drawer.id).emit('sketchio:wordChoices', { words: room.wordOptions });
  // Tell everyone else a new turn is starting
  io.to(room.code).emit('sketchio:newTurn', {
    drawerId: drawer.id,
    drawerName: drawer.name,
    wordLength: null // Not known until drawer picks
  });

  // Sound: new turn
  io.to(room.code).emit('game:sound', { sound: 'newTurn' });

  // If drawer doesn't pick within 20s, auto-pick first option
  room.wordPickTimer = setTimeout(() => {
    if (!room.currentWord && room.state === 'playing') {
      room.currentWord = room.wordOptions[0] || 'apple';
      startSketchioDrawTimer(room);
    }
  }, 20000);
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

  const startTime = Date.now();
  const totalTime = room.settings.drawTime;

  io.to(room.code).emit('sketchio:roundStart', {
    drawerId: drawer.id,
    drawerName: drawer.name,
    wordBlanks: blanks,
    wordLength: room.currentWord.length,
    drawTime: totalTime,
    startTime   // Server timestamp for client synchronization
  });
  // Drawer gets the actual word
  io.to(drawer.id).emit('sketchio:yourWord', { word: room.currentWord });

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
    // Countdown warning at 10s
    if (timeLeft === 10) {
      io.to(room.code).emit('game:sound', { sound: 'countdownWarning' });
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

  // Sound: turn end
  io.to(room.code).emit('game:sound', { sound: 'timerEnd' });

  // Check if all players have drawn this round
  const connectedCount = room.players.filter(p => p.connected).length;
  room._turnCount = (room._turnCount || 0) + 1;
  if (room._turnCount >= connectedCount) {
    room._turnCount = 0;
    room.round++;
    if (room.round >= room.settings.rounds) {
      setTimeout(() => sketchioEndGame(room), 3000);
    } else {
      io.to(room.code).emit('game:sound', { sound: 'newRound' });
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
  io.to(room.code).emit('game:sound', { sound: 'gameEnd' });
}

// ─────────────────────────────────────────
//  PICTO GAME LOGIC — Sequential Drawing
// ─────────────────────────────────────────
/*
  Picto round flow:
  1. All connected, non-eliminated players draw in sequence (one at a time).
     Canvas PERSISTS between drawers (do NOT clear).
  2. After all players draw, voting begins.
  3. Votes tally → elimination → possibly imposter guess → next round or end.
*/

function pictoStartGame(room) {
  clearRoomTimers(room);
  room.state = 'playing';
  room.round = 1;
  room.eliminated = [];
  room.votes = {};
  room._turnCount = 0;
  room.currentDrawerIndex = -1;
  room.pictoDrawOrder = [];
  room.pictoDrawOrderIndex = -1;
  room.pictoHasDrawn = new Set();

  // Assign roles
  const playerIds = room.players.map(p => p.id);
  const numImposters = Math.min(room.settings.numImposters, Math.floor(playerIds.length / 2));
  const imposterIds = pickRandom(playerIds, numImposters);
  const impostersArr = Array.isArray(imposterIds) ? imposterIds : [imposterIds];

  // Pick secret word
  const wordList = room.settings.customWords.length >= 5
    ? room.settings.customWords
    : getPictoWordList(room.settings.category);
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

  io.to(room.code).emit('game:sound', { sound: 'newRound' });

  setTimeout(() => pictoStartDrawingPhase(room), 2000);
}

/**
 * Start the sequential drawing phase for the current round.
 * Builds an ordered draw list from all connected, non-eliminated players.
 */
function pictoStartDrawingPhase(room) {
  clearRoomTimers(room);

  const eligible = room.players.filter(
    p => p.connected && !room.eliminated.includes(p.id)
  );

  if (eligible.length < 2) {
    pictoEndGame(room, 'crewmates');
    return;
  }

  // Build the draw order for this round
  room.pictoDrawOrder = eligible.map(p => p.id);
  room.pictoDrawOrderIndex = -1;
  room.pictoHasDrawn = new Set();
  room.drawHistory = []; // Fresh canvas for each round

  io.to(room.code).emit('picto:drawPhaseStart', {
    totalDrawers: room.pictoDrawOrder.length,
    round: room.round
  });

  // Clear canvas for all clients at start of draw phase
  io.to(room.code).emit('draw:clear');

  setTimeout(() => pictoNextDrawer(room), 1500);
}

/**
 * Advance to the next drawer in the sequential draw order.
 */
function pictoNextDrawer(room) {
  clearRoomTimers(room);

  // Move to next in sequence
  room.pictoDrawOrderIndex++;

  // Skip disconnected players
  while (
    room.pictoDrawOrderIndex < room.pictoDrawOrder.length &&
    !room.players.find(p => p.id === room.pictoDrawOrder[room.pictoDrawOrderIndex])?.connected
  ) {
    room.pictoDrawOrderIndex++;
  }

  // If we've exhausted the draw order, start voting
  if (room.pictoDrawOrderIndex >= room.pictoDrawOrder.length) {
    pictoStartVoting(room);
    return;
  }

  const drawerId = room.pictoDrawOrder[room.pictoDrawOrderIndex];
  const drawer = room.players.find(p => p.id === drawerId);
  if (!drawer) {
    pictoNextDrawer(room); // skip missing player
    return;
  }

  // Update currentDrawerIndex to match for draw:event validation
  room.currentDrawerIndex = room.players.findIndex(p => p.id === drawerId);

  const drawTime = room.settings.playerDrawTime || 20;
  const startTime = Date.now();
  const isLastDrawer = room.pictoDrawOrderIndex === room.pictoDrawOrder.length - 1;

  io.to(room.code).emit('picto:drawingTurn', {
    drawerId: drawer.id,
    drawerName: drawer.name,
    drawTime,
    round: room.round,
    drawerNumber: room.pictoDrawOrderIndex + 1,
    totalDrawers: room.pictoDrawOrder.length,
    startTime,
    isLastDrawer
  });

  io.to(room.code).emit('game:sound', { sound: 'newTurn' });

  let timeLeft = drawTime;
  const tick = () => {
    io.to(room.code).emit('picto:timer', { timeLeft, phase: 'drawing' });
    if (timeLeft === 10) {
      io.to(room.code).emit('game:sound', { sound: 'countdownWarning' });
    }
    if (timeLeft <= 0) {
      // Auto-advance when timer expires
      pictoNextDrawer(room);
      return;
    }
    timeLeft--;
    room.roundTimer = setTimeout(tick, 1000);
  };
  room.roundTimer = setTimeout(tick, 0);
}

/**
 * Handle "Next Person" request from the current active drawer.
 * Server validates: only the current authorized drawer can advance.
 */
function pictoSkipToNextDrawer(room, requestingSocketId) {
  if (!room || room.state !== 'playing') return false;

  // Validate: must be the current drawer
  const drawerId = room.pictoDrawOrder[room.pictoDrawOrderIndex];
  if (requestingSocketId !== drawerId) return false;

  clearRoomTimers(room);
  pictoNextDrawer(room);
  return true;
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

  io.to(room.code).emit('game:sound', { sound: 'votingPhase' });

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
    // Imposter gets ONE chance to guess the secret word
    io.to(room.code).emit('picto:imposterGuessing', {
      imposterId: eliminated,
      imposterName: eliminatedPlayer?.name || 'Imposter',
      timeLimit: 30
    });

    io.to(eliminated).emit('picto:imposterGuessChance', {
      message: 'You have been eliminated! You are the Imposter. Guess the secret word to still win!'
    });

    room.state = 'imposterGuess';
    room.imposterGuessAttempts = 0;
    room.imposterGuessSubmitted = false;

    // 30-second window to guess
    room.imposterGuessTimer = setTimeout(() => {
      if (room.state === 'imposterGuess') {
        pictoEndGame(room, 'crewmates');
      }
    }, 30000);
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
    const imposter = room.players.find(p => p.role === 'imposter');
    if (imposter && !room.eliminated.includes(imposter.id)) {
      pictoEndGame(room, 'imposters');
    } else {
      pictoEndGame(room, 'crewmates');
    }
  } else {
    room.round++;
    io.to(room.code).emit('picto:newRound', { round: room.round });
    io.to(room.code).emit('game:sound', { sound: 'newRound' });
    setTimeout(() => pictoStartDrawingPhase(room), 2000);
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

  const mediaPool = PICTO_VICTORY_MEDIA[winner] || PICTO_VICTORY_MEDIA.crewmates;
  let mediaIndex = Math.floor(Math.random() * mediaPool.length);
  if (mediaPool.length > 1 && room._lastVictoryMediaIndex === mediaIndex) {
    mediaIndex = (mediaIndex + 1) % mediaPool.length;
  }
  room._lastVictoryMediaIndex = mediaIndex;
  const selectedMedia = mediaPool[mediaIndex];
  const matchId = uuidv4();

  io.to(room.code).emit('picto:gameEnd', {
    winner,
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

  io.to(room.code).emit('game:sound', { sound: winner === 'imposters' ? 'imposterWin' : 'crewmatesWin' });
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
    io.to(room.code).emit('game:sound', { sound: 'playerJoin' });
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
      io.to(room.code).emit('game:sound', { sound: 'playerLeave' });
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
    // wordCount is always 3 for Sketchio; ignore client override
    if (settings.wordCount !== undefined) delete settings.wordCount;
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
          const guessScore = Math.max(100, 300 - (room.guessedCorrectly.size - 1) * 50);
          player.score += guessScore;
          room.scores[socket.id] = (room.scores[socket.id] || 0) + guessScore;

          io.to(socket.id).emit('sketchio:correctGuess', { word: room.currentWord, points: guessScore });
          io.to(socket.id).emit('game:sound', { sound: 'correctGuess' });
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
          // Close guess detection
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

    // Validate: only the current authorized drawer may send draw events
    let authorizedDrawerId = null;
    if (room.game === 'picto') {
      // In Picto, the authorized drawer is the one at pictoDrawOrder[pictoDrawOrderIndex]
      authorizedDrawerId = room.pictoDrawOrder?.[room.pictoDrawOrderIndex];
    } else {
      const drawer = room.players[room.currentDrawerIndex];
      authorizedDrawerId = drawer?.id;
    }
    if (!authorizedDrawerId || socket.id !== authorizedDrawerId) return;

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
    // Only authorized drawer can clear
    let authorizedDrawerId = null;
    if (room.game === 'picto') {
      authorizedDrawerId = room.pictoDrawOrder?.[room.pictoDrawOrderIndex];
    } else {
      const drawer = room.players[room.currentDrawerIndex];
      authorizedDrawerId = drawer?.id;
    }
    if (!authorizedDrawerId || socket.id !== authorizedDrawerId) return;
    room.drawHistory = [];
    io.to(room.code).emit('draw:clear');
  });

  socket.on('draw:undo', () => {
    const room = getRoomForSocket(socket.id);
    if (!room) return;
    let authorizedDrawerId = null;
    if (room.game === 'picto') {
      authorizedDrawerId = room.pictoDrawOrder?.[room.pictoDrawOrderIndex];
    } else {
      const drawer = room.players[room.currentDrawerIndex];
      authorizedDrawerId = drawer?.id;
    }
    if (!authorizedDrawerId || socket.id !== authorizedDrawerId) return;

    // Find the last stroke start or fill event and remove from there
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

  // "Next Person" — only current active drawer can trigger
  socket.on('picto:nextPerson', () => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.game !== 'picto' || room.state !== 'playing') return;
    const success = pictoSkipToNextDrawer(room, socket.id);
    if (!success) {
      socket.emit('error', { message: 'You are not the current drawer.' });
    }
  });

  socket.on('picto:vote', ({ targetId }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.game !== 'picto' || room.state !== 'voting') return;
    const voter = room.players.find(p => p.id === socket.id);
    if (!voter || voter.hasVoted) return;
    if (targetId === socket.id) return;
    if (room.eliminated.includes(targetId)) return;

    voter.hasVoted = true;
    room.votes[socket.id] = targetId;

    const eligible = room.players.filter(p => !room.eliminated.includes(p.id) && p.connected);
    const allVoted = eligible.every(p => p.hasVoted);
    if (allVoted) pictoTallyVotes(room);
  });

  /**
   * Imposter guess — exactly ONE attempt allowed.
   * Server is authoritative: validates against secret word, locks out after first submission.
   */
  socket.on('picto:imposterGuess', ({ guess }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.state !== 'imposterGuess') return;
    if (socket.id !== room.imposterId) return;

    // Lock out: only one guess allowed
    if (room.imposterGuessSubmitted) {
      socket.emit('picto:imposterGuessLocked', { message: 'You have already submitted your guess.' });
      return;
    }
    room.imposterGuessSubmitted = true;

    guess = String(guess || '').trim().toLowerCase();
    const secret = room.secretWord.toLowerCase().trim();

    // Lock the input on client side immediately
    io.to(socket.id).emit('picto:imposterGuessFeedback', { submitted: true });

    if (room.imposterGuessTimer) { clearTimeout(room.imposterGuessTimer); room.imposterGuessTimer = null; }

    if (guess === secret) {
      io.to(room.code).emit('picto:imposterCorrectGuess', { message: 'The Imposter guessed the secret word correctly!' });
      io.to(room.code).emit('game:sound', { sound: 'imposterWin' });
      pictoEndGame(room, 'imposters');
    } else {
      io.to(room.code).emit('picto:imposterWrongGuess', {
        imposterName: room.players.find(p => p.id === socket.id)?.name,
        guess
      });
      io.to(room.code).emit('game:sound', { sound: 'crewmatesWin' });
      pictoEndGame(room, 'crewmates');
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
      io.to(room.code).emit('game:sound', { sound: 'playerLeave' });

      // Handle disconnect during Picto drawing turn
      if (room.game === 'picto' && room.state === 'playing') {
        const activePictoDrawer = room.pictoDrawOrder?.[room.pictoDrawOrderIndex];
        if (activePictoDrawer === socket.id) {
          // Current drawer disconnected — auto-advance
          clearRoomTimers(room);
          setTimeout(() => pictoNextDrawer(room), 1500);
        }
      }

      // Handle disconnect during Sketchio drawing turn
      if (room.game === 'sketchio' && room.state === 'playing') {
        const drawer = room.players[room.currentDrawerIndex];
        if (drawer?.id === socket.id) {
          clearRoomTimers(room);
          setTimeout(() => sketchioEndTurn(room, false), 1500);
        }
      }

      // Handle disconnect during imposter guess phase
      if (room.game === 'picto' && room.state === 'imposterGuess' && socket.id === room.imposterId) {
        if (room.imposterGuessTimer) { clearTimeout(room.imposterGuessTimer); room.imposterGuessTimer = null; }
        setTimeout(() => pictoEndGame(room, 'crewmates'), 1500);
      }
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
      // Send current draw state
      if (room.drawHistory && room.drawHistory.length > 0) {
        socket.emit('draw:sync', { history: room.drawHistory });
      }
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

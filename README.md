# Suspecto — Multiplayer Gaming Platform

**Developed by Arham Ahmad Khan**

A browser-based multiplayer gaming platform featuring two games:
- **Picto** — Drawing & Social Deduction
- **Sketchio** — Drawing & Guessing (skribbl-style)

---

## Quick Start

### Prerequisites
- Node.js 18+ (tested on v24)
- npm 8+

### Install & Run

```bash
# Install dependencies
npm install

# Start the server
npm start

# Server runs at http://localhost:3000
```

### Development mode

```bash
npm run dev
```

---

## Architecture

```
suspecto/
├── server.js              # Express + Socket.io backend
├── public/
│   ├── index.html         # Main SPA (all screens)
│   ├── css/
│   │   └── style.css      # Skribbl.io-inspired blue theme
│   ├── js/
│   │   ├── app.js         # Navigation & socket orchestration
│   │   ├── game.js        # Game logic & event handlers
│   │   ├── canvas.js      # Drawing engine (flood fill, touch)
│   │   └── voice.js       # WebRTC voice chat
│   └── img/
│       ├── logo.jpg       # Suspecto colorful logo
│       ├── bg_pattern.jpg # Blue doodle tile background
│       ├── picto_icon.jpg # Picto game card icon
│       └── sketchio_icon.jpg
└── package.json
```

---

## Features

### Both Games
- Private rooms with unique 6-character codes
- Shareable invite links
- Real-time multiplayer (Socket.io)
- Live text chat
- WebRTC voice chat (Join Voice / Mute / Leave)
- Speaking indicators
- Host controls
- Room settings (players, rounds, draw time)
- Reconnection support

### Picto (Social Deduction)
- Server assigns secret word to Crewmates only
- Imposter does NOT receive the word
- Turn-based drawing rounds
- Voting phase to eliminate suspects
- Eliminated Imposter gets 3 chances to guess the word
- Win conditions: Crewmates eliminate Imposter / Imposter guesses word

### Sketchio (Drawing & Guessing)
- Word choice (2–5 options) for the drawer
- Word appears as blanks to guessers
- Score based on guess speed
- Multi-round progression
- Custom word lists supported
- Final leaderboard

---

## Multiplayer Architecture

All critical game logic runs **server-side**:
- Room creation / joining / cleanup
- Role assignment (Picto)
- Word selection
- Turn order and timers
- Vote tallying
- Score calculation
- Win condition evaluation

Clients receive state updates and render accordingly.

---

## Voice Chat

Uses WebRTC (peer-to-peer) with STUN servers from Google.
No TURN server configured by default — works on local networks and most home connections.

For production with NAT traversal, set `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` environment variables and update `ICE_SERVERS` in `voice.js`.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |

---

## Responsive Support

Tested layouts:
- 360×800 (mobile portrait)
- 390×844 (iPhone)
- 768×1024 (tablet)
- 1024×768 (tablet landscape)
- 1366×768 (laptop)
- 1920×1080 (desktop)

---

## Known Limitations

- Voice chat requires HTTPS in production (or localhost for dev)
- No persistent database — rooms exist in memory only
- Room state is lost on server restart
- No TURN server configured — voice may fail on strict corporate NATs

---

## Credits

Designed and developed by **Arham Ahmad Khan**  
Visual style inspired by [skribbl.io](https://skribbl.io)

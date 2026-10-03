/**
 * Suspecto Voice Chat Module (WebRTC)
 * Manages peer-to-peer voice connections within a room
 */
const VoiceChat = (() => {
  const peers = new Map();  // peerId → RTCPeerConnection
  let localStream = null;
  let isInVoice = false;
  let isMuted = false;
  let socket = null;
  let speakingTimer = null;

  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];

  function init(socketInstance) {
    socket = socketInstance;

    socket.on('voice:peerJoined', async ({ peerId, peerName }) => {
      if (!isInVoice || peerId === socket.id) return;
      console.log('[Voice] Peer joined, creating offer for', peerId);
      await createPeerConnection(peerId, peerName, true);
    });

    socket.on('voice:peerLeft', ({ peerId }) => {
      removePeer(peerId);
    });

    socket.on('voice:offer', async ({ fromId, offer }) => {
      if (!isInVoice) return;
      console.log('[Voice] Received offer from', fromId);
      let pc = peers.get(fromId)?.pc;
      if (!pc) {
        const conn = await createPeerConnection(fromId, null, false);
        pc = conn;
      }
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('voice:answer', { targetId: fromId, answer });
    });

    socket.on('voice:answer', async ({ fromId, answer }) => {
      const entry = peers.get(fromId);
      if (!entry) return;
      await entry.pc.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on('voice:ice', async ({ fromId, candidate }) => {
      const entry = peers.get(fromId);
      if (!entry) return;
      try {
        await entry.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) { /* ignore */ }
    });

    socket.on('voice:speaking', ({ peerId, speaking }) => {
      updateSpeakingIndicator(peerId, speaking);
    });
  }

  async function createPeerConnection(peerId, peerName, isInitiator) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peers.set(peerId, { pc, peerName });

    // Add local tracks
    if (localStream) {
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    // Remote audio
    pc.ontrack = (event) => {
      const audio = document.getElementById(`voice-audio-${peerId}`) || document.createElement('audio');
      audio.id = `voice-audio-${peerId}`;
      audio.autoplay = true;
      audio.srcObject = event.streams[0];
      document.body.appendChild(audio);
      addVoiceParticipantUI(peerId, peerName);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('voice:ice', { targetId: peerId, candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        removePeer(peerId);
      }
    };

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('voice:offer', { targetId: peerId, offer });
    }

    return pc;
  }

  function removePeer(peerId) {
    const entry = peers.get(peerId);
    if (entry) {
      entry.pc.close();
      peers.delete(peerId);
    }
    const audio = document.getElementById(`voice-audio-${peerId}`);
    if (audio) audio.remove();
    removeVoiceParticipantUI(peerId);
  }

  async function join() {
    if (isInVoice) return;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      isInVoice = true;
      isMuted = false;
      socket.emit('voice:join');
      updateVoiceUI();
      startSpeakingDetection();
      return true;
    } catch (e) {
      let msg = 'Could not access microphone.';
      if (e.name === 'NotAllowedError') msg = 'Microphone permission denied. Please allow microphone access.';
      else if (e.name === 'NotFoundError') msg = 'No microphone found.';
      return { error: msg };
    }
  }

  function leave() {
    if (!isInVoice) return;
    socket.emit('voice:leave');
    stopSpeakingDetection();
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }
    peers.forEach((_, id) => removePeer(id));
    peers.clear();
    isInVoice = false;
    isMuted = false;
    updateVoiceUI();
  }

  function toggleMute() {
    if (!isInVoice || !localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
    updateVoiceUI();
  }

  let audioContext = null;
  let analyser = null;
  let speakingNow = false;

  function startSpeakingDetection() {
    if (!localStream) return;
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      const source = audioContext.createMediaStreamSource(localStream);
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const check = () => {
        if (!isInVoice) return;
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        const speaking = avg > 15;
        if (speaking !== speakingNow) {
          speakingNow = speaking;
          socket.emit('voice:speaking', { speaking });
          updateSpeakingIndicator(socket.id, speaking);
        }
        speakingTimer = requestAnimationFrame(check);
      };
      check();
    } catch (e) { /* audio analysis not available */ }
  }

  function stopSpeakingDetection() {
    if (speakingTimer) { cancelAnimationFrame(speakingTimer); speakingTimer = null; }
    if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
    speakingNow = false;
  }

  function updateVoiceUI() {
    const joinBtn = document.getElementById('btn-voice-join');
    if (!joinBtn) return;
    if (isInVoice) {
      joinBtn.textContent = isMuted ? '🔇 Unmute' : '🎤 Mute';
      joinBtn.onclick = toggleMute;
      joinBtn.classList.remove('btn-blue');
      joinBtn.classList.add(isMuted ? 'btn-red' : 'btn-gray');
      // Add leave button
      let leaveBtn = document.getElementById('btn-voice-leave');
      if (!leaveBtn) {
        leaveBtn = document.createElement('button');
        leaveBtn.id = 'btn-voice-leave';
        leaveBtn.className = 'btn btn-red btn-sm btn-full';
        leaveBtn.style.marginTop = '4px';
        leaveBtn.textContent = '📵 Leave Voice';
        leaveBtn.onclick = leave;
        joinBtn.parentNode.insertBefore(leaveBtn, joinBtn.nextSibling);
      }
    } else {
      joinBtn.textContent = '🎤 Join Voice';
      joinBtn.onclick = async () => {
        const result = await join();
        if (result && result.error) {
          window.showToast && window.showToast(result.error, 'error');
        }
      };
      joinBtn.className = 'btn btn-blue btn-sm btn-full';
      const leaveBtn = document.getElementById('btn-voice-leave');
      if (leaveBtn) leaveBtn.remove();
    }
  }

  function addVoiceParticipantUI(peerId, name) {
    const container = document.getElementById('voice-participants');
    if (!container) return;
    if (document.getElementById(`vp-${peerId}`)) return;
    const div = document.createElement('div');
    div.className = 'voice-participant';
    div.id = `vp-${peerId}`;
    div.innerHTML = `<span class="vp-icon">🎤</span><span class="vp-name">${name || 'Player'}</span>`;
    container.appendChild(div);
  }

  function removeVoiceParticipantUI(peerId) {
    const el = document.getElementById(`vp-${peerId}`);
    if (el) el.remove();
  }

  function updateSpeakingIndicator(peerId, speaking) {
    const el = document.getElementById(`vp-${peerId}`);
    if (!el) return;
    el.classList.toggle('voice-speaking', speaking);
    el.querySelector('.vp-icon').textContent = speaking ? '🔊' : '🎤';
  }

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => { if (isInVoice) leave(); });

  return { init, join, leave, toggleMute, updateVoiceUI };
})();

/**
 * Suspecto Canvas Drawing Module
 * Handles drawing, replaying, and synchronizing canvas events
 */
const DrawingCanvas = (() => {
  let canvas = null;
  let ctx = null;
  let isDrawing = false;
  let isDrawer = false;
  let tool = 'pen';
  let brushSize = 6;
  let color = '#000000';
  let lastX = 0;
  let lastY = 0;

  // Throttle drawing events
  let lastEmit = 0;
  const EMIT_INTERVAL = 16; // ~60fps max

  const COLORS = [
    '#000000','#ffffff','#7f7f7f','#c0c0c0',
    '#4AC7A8','#B8F2E6','#1abc9c','#164e43',
    '#c00000','#ff0000','#ff6600','#ffff00',
    '#00c000','#00ff00','#00c0c0','#00ffff',
    '#0000c0','#0000ff','#7f00ff','#ff00ff',
    '#9b59b6','#e67e22','#f39c12','#d35400',
    '#27ae60','#2980b9','#2c3e50','#e74c3c'
  ];

  let socket = null;
  let onDraw = null; // callback when we emit

  function init(canvasEl, socketInstance) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    socket = socketInstance;

    initColorPalette();
    bindEvents();
    bindSocketEvents();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function initColorPalette() {
    const palette = document.getElementById('color-palette');
    if (!palette) return;
    COLORS.forEach(c => {
      const swatch = document.createElement('div');
      swatch.className = 'color-swatch' + (c === color ? ' active' : '');
      swatch.style.background = c;
      swatch.style.border = c === '#ffffff' ? '2px solid rgba(255,255,255,0.4)' : '2px solid transparent';
      swatch.title = c;
      swatch.addEventListener('click', () => selectColor(c));
      palette.appendChild(swatch);
    });

    // Tool buttons
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        tool = btn.dataset.tool;
        updateCursor();
      });
    });

    // Size buttons
    document.querySelectorAll('.size-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        brushSize = parseInt(btn.dataset.size);
      });
    });

    // Undo and clear
    const undoBtn = document.getElementById('btn-undo');
    if (undoBtn) undoBtn.addEventListener('click', () => {
      socket.emit('draw:undo');
    });
    const clearBtn = document.getElementById('btn-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      clearCanvas();
      socket.emit('draw:clear');
    });
  }

  function selectColor(c) {
    color = c;
    tool = 'pen';
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === 'pen'));
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.toggle('active', s.style.background === c || s.style.backgroundColor === c));
  }

  function updateCursor() {
    canvas.style.cursor = tool === 'eraser' ? 'cell' : tool === 'fill' ? 'crosshair' : 'crosshair';
  }

  function getCanvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }

  function bindEvents() {
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', moveDraw);
    canvas.addEventListener('mouseup', endDraw);
    canvas.addEventListener('mouseleave', endDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', moveDraw, { passive: false });
    canvas.addEventListener('touchend', endDraw);
    canvas.addEventListener('touchcancel', endDraw);
  }

  function startDraw(e) {
    if (!isDrawer) return;
    e.preventDefault();
    isDrawing = true;
    const pos = getCanvasPos(e);
    lastX = pos.x;
    lastY = pos.y;

    if (tool === 'fill') {
      floodFill(Math.round(pos.x), Math.round(pos.y), color);
      emitEvent({ type: 'fill', x: pos.x, y: pos.y, color });
      isDrawing = false;
      return;
    }

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, brushSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = tool === 'eraser' ? '#ffffff' : color;
    ctx.fill();

    emitEvent({ type: 'start', x: pos.x, y: pos.y });
  }

  function moveDraw(e) {
    if (!isDrawer || !isDrawing) return;
    e.preventDefault();
    const pos = getCanvasPos(e);
    const now = Date.now();

    drawLine(lastX, lastY, pos.x, pos.y, tool === 'eraser' ? '#ffffff' : color, brushSize);

    if (now - lastEmit >= EMIT_INTERVAL) {
      emitEvent({ type: 'move', x: lastX, y: lastY, x2: pos.x, y2: pos.y });
      lastEmit = now;
    }

    lastX = pos.x;
    lastY = pos.y;
  }

  function endDraw(e) {
    if (!isDrawer || !isDrawing) return;
    isDrawing = false;
    emitEvent({ type: 'end', x: lastX, y: lastY });
  }

  function drawLine(x1, y1, x2, y2, c, size) {
    ctx.save();
    ctx.strokeStyle = c;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  function clearCanvas(fill = '#ffffff') {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function floodFill(startX, startY, fillColor) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const targetColor = getPixelColor(data, startX, startY, canvas.width);
    const fillRGB = hexToRgb(fillColor);
    if (!fillRGB) return;
    if (colorsMatch(targetColor, fillRGB)) return;

    const stack = [[startX, startY]];
    const visited = new Uint8Array(canvas.width * canvas.height);

    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) continue;
      const idx = y * canvas.width + x;
      if (visited[idx]) continue;
      const pixelColor = getPixelColor(data, x, y, canvas.width);
      if (!colorsMatch(pixelColor, targetColor)) continue;

      visited[idx] = 1;
      setPixelColor(data, x, y, canvas.width, fillRGB);
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    ctx.putImageData(imageData, 0, 0);
  }

  function getPixelColor(data, x, y, w) {
    const i = (y * w + x) * 4;
    return { r: data[i], g: data[i+1], b: data[i+2], a: data[i+3] };
  }
  function setPixelColor(data, x, y, w, c) {
    const i = (y * w + x) * 4;
    data[i] = c.r; data[i+1] = c.g; data[i+2] = c.b; data[i+3] = 255;
  }
  function colorsMatch(a, b, tol = 30) {
    return Math.abs(a.r - b.r) <= tol && Math.abs(a.g - b.g) <= tol && Math.abs(a.b - b.b) <= tol;
  }
  function hexToRgb(hex) {
    const res = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return res ? { r: parseInt(res[1], 16), g: parseInt(res[2], 16), b: parseInt(res[3], 16) } : null;
  }

  function emitEvent(data) {
    if (!socket) return;
    socket.emit('draw:event', {
      ...data,
      color: tool === 'eraser' ? '#ffffff' : color,
      size: tool === 'eraser' ? brushSize * 2 : brushSize,
      tool
    });
  }

  function bindSocketEvents() {
    socket.on('draw:event', (data) => {
      replayEvent(data);
    });

    socket.on('draw:clear', () => {
      clearCanvas();
    });

    socket.on('draw:sync', ({ history }) => {
      clearCanvas();
      if (history) history.forEach(evt => replayEvent(evt));
    });
  }

  function replayEvent(data) {
    if (!ctx) return;
    const c = data.color || '#000000';
    const s = data.size || 4;
    const t = data.tool || 'pen';

    if (data.type === 'fill') {
      floodFill(Math.round(data.x), Math.round(data.y), c);
    } else if (data.type === 'start') {
      ctx.beginPath();
      ctx.arc(data.x, data.y, s / 2, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
    } else if (data.type === 'move') {
      drawLine(data.x, data.y, data.x2, data.y2, c, s);
    }
    // end type — nothing to do visually
  }

  function setDrawer(val) {
    isDrawer = val;
    const toolbar = document.getElementById('drawing-toolbar');
    if (toolbar) toolbar.classList.toggle('hidden', !val);
    canvas.style.cursor = val ? 'crosshair' : 'default';
    updateCursor();
  }

  function requestSync() {
    socket.emit('draw:requestSync');
  }

  function reset() {
    clearCanvas();
    isDrawing = false;
  }

  return { init, setDrawer, reset, clearCanvas, requestSync };
})();

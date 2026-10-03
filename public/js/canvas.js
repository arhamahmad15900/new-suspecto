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

  // Throttle drawing events — ~60fps max
  let lastEmit = 0;
  const EMIT_INTERVAL = 16;

  const COLORS = [
    '#000000','#ffffff','#808080','#c0c0c0',
    '#8B0000','#FF0000','#FF6347','#FF4500',
    '#FF8C00','#FFA500','#FFD700','#FFFF00',
    '#006400','#00C000','#00FF00','#90EE90',
    '#00008B','#0000FF','#1E90FF','#87CEEB',
    '#4B0082','#8A2BE2','#DA70D6','#FF00FF',
    '#5D4037','#A0522D','#4AC7A8','#20B2AA',
  ];

  let socket = null;

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

    palette.innerHTML = ''; // Clear before re-init

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

    // Undo
    const undoBtn = document.getElementById('btn-undo');
    if (undoBtn) undoBtn.addEventListener('click', () => {
      if (!isDrawer) return;
      socket.emit('draw:undo');
    });

    // Clear
    const clearBtn = document.getElementById('btn-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      if (!isDrawer) return;
      clearCanvas();
      socket.emit('draw:clear');
    });

    // Custom color picker
    const colorPicker = document.getElementById('custom-color-picker');
    if (colorPicker) {
      colorPicker.addEventListener('input', (e) => {
        selectColor(e.target.value, false); // false = don't update picker value itself
      });
      colorPicker.addEventListener('change', (e) => {
        selectColor(e.target.value, false);
      });
    }

    // Keyboard shortcuts (Ctrl+Z for undo)
    document.addEventListener('keydown', (e) => {
      if (!isDrawer) return;
      // Only when not focused on an input
      if (document.activeElement && ['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        socket.emit('draw:undo');
      }
      // Shortcut keys for tools
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'p' || e.key === 'P') activateTool('pen');
        if (e.key === 'e' || e.key === 'E') activateTool('eraser');
        if (e.key === 'f' || e.key === 'F') activateTool('fill');
      }
    });
  }

  function activateTool(t) {
    tool = t;
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === t);
    });
    updateCursor();
  }

  function selectColor(c, updatePickerEl = true) {
    color = c;
    // Switch to pen when a color is selected
    if (tool !== 'fill') activateTool('pen');
    document.querySelectorAll('.color-swatch').forEach(s => {
      const bg = s.style.backgroundColor || s.style.background;
      s.classList.toggle('active', bg === c || s.style.background === c || rgbToHex(bg) === c.toLowerCase());
    });
    // Update custom picker value to reflect new color
    if (updatePickerEl) {
      const picker = document.getElementById('custom-color-picker');
      if (picker) picker.value = c;
    }
  }

  function rgbToHex(rgb) {
    if (!rgb || rgb.startsWith('#')) return (rgb || '').toLowerCase();
    const result = rgb.match(/\d+/g);
    if (!result || result.length < 3) return rgb;
    return '#' + result.slice(0,3).map(n => parseInt(n).toString(16).padStart(2,'0')).join('');
  }

  function updateCursor() {
    if (!canvas) return;
    if (tool === 'eraser') canvas.style.cursor = 'cell';
    else if (tool === 'fill') canvas.style.cursor = 'crosshair';
    else canvas.style.cursor = 'crosshair';
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

    const drawColor = tool === 'eraser' ? '#ffffff' : color;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, brushSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = drawColor;
    ctx.fill();

    emitEvent({ type: 'start', x: pos.x, y: pos.y });
  }

  function moveDraw(e) {
    if (!isDrawer || !isDrawing) return;
    e.preventDefault();
    const pos = getCanvasPos(e);
    const now = Date.now();

    const drawColor = tool === 'eraser' ? '#ffffff' : color;
    drawLine(lastX, lastY, pos.x, pos.y, drawColor, brushSize);

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

  /**
   * Optimized flood fill using scanline algorithm.
   * Falls back gracefully on very large areas.
   */
  function floodFill(startX, startY, fillColor) {
    startX = Math.max(0, Math.min(canvas.width - 1, startX));
    startY = Math.max(0, Math.min(canvas.height - 1, startY));

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const targetColor = getPixelColor(data, startX, startY, canvas.width);
    const fillRGB = hexToRgb(fillColor);
    if (!fillRGB) return;
    if (colorsMatch(targetColor, fillRGB)) return;

    // Scanline flood fill — much faster than stack-based for large areas
    const width = canvas.width;
    const height = canvas.height;
    const visited = new Uint8Array(width * height);

    const stack = [[startX, startY]];

    while (stack.length > 0 && stack.length < 500000) {
      const [px, py] = stack.pop();
      if (px < 0 || px >= width || py < 0 || py >= height) continue;

      // Scan left
      let lx = px;
      while (lx >= 0 && !visited[py * width + lx] && colorsMatch(getPixelColor(data, lx, py, width), targetColor)) {
        lx--;
      }
      lx++;

      // Scan right
      let rx = px;
      while (rx < width && !visited[py * width + rx] && colorsMatch(getPixelColor(data, rx, py, width), targetColor)) {
        rx++;
      }
      rx--;

      // Fill the span and check above/below
      for (let x = lx; x <= rx; x++) {
        const idx = py * width + x;
        if (!visited[idx]) {
          visited[idx] = 1;
          setPixelColor(data, x, py, width, fillRGB);
          if (py > 0 && !visited[(py - 1) * width + x] && colorsMatch(getPixelColor(data, x, py - 1, width), targetColor)) {
            stack.push([x, py - 1]);
          }
          if (py < height - 1 && !visited[(py + 1) * width + x] && colorsMatch(getPixelColor(data, x, py + 1, width), targetColor)) {
            stack.push([x, py + 1]);
          }
        }
      }
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
    // end type — nothing to draw
  }

  function setDrawer(val) {
    isDrawer = val;
    const toolbar = document.getElementById('drawing-toolbar');
    if (toolbar) toolbar.classList.toggle('hidden', !val);

    // Re-enable Next Person button when a new drawing turn starts
    if (val) {
      const nextBtn = document.getElementById('btn-picto-next-person');
      if (nextBtn) nextBtn.disabled = false;
    }

    if (canvas) {
      canvas.style.cursor = val ? 'crosshair' : 'default';
      updateCursor();
    }
  }

  function requestSync() {
    if (socket) socket.emit('draw:requestSync');
  }

  function reset() {
    clearCanvas();
    isDrawing = false;
  }

  return { init, setDrawer, reset, clearCanvas, requestSync };
})();

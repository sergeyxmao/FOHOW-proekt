document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('canvas');
  const svgLayer = document.getElementById('svg-layer');
  const addCardBtn = document.getElementById('add-card-btn');
  const colorPalette = document.getElementById('color-palette');
  const thicknessSlider = document.getElementById('thickness-slider');
  const thicknessValue = document.getElementById('thickness-value');
  const gradientSelector = document.getElementById('gradient-selector');
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  const screenshotBtn = document.getElementById('screenshot-btn');

  const GRID_SIZE = 70;
  const MARKER_OFFSET = 12;
  const HISTORY_LIMIT = 50;

  let canvasState = { x: 0, y: 0, scale: 1, isPanning: false, lastMouseX: 0, lastMouseY: 0 };
  let activeState = {
    currentColor: '#3d85c6',
    currentThickness: 3,
    selectedLine: null,
    selectedCards: new Set(),
    isDrawingLine: false,
    isSelecting: false,
    lineStart: null,
    previewLine: null
  };
  let cards = [];
  let lines = [];
  const cardColors = ['#3d85c6', '#6aa84f', '#888888', '#ffd700'];

  // История действий
  let undoStack = [];
  let redoStack = [];
  let clipboard = null; // для Ctrl+C / Ctrl+V

  addCardBtn.addEventListener('click', () => { createCard(); saveState(); });
  setupPalette();
  setupThicknessSlider();
  setupGlobalEventListeners();
  setupGradientSelector();
  setupHistoryButtons();
  setupScreenshot();

  // ==== Global listeners ====
  function setupGlobalEventListeners() {
    window.addEventListener('mousedown', (e) => {
      if (e.target.closest('.ui-panel')) return;

      if (e.target === canvas || e.target === svgLayer) {
        if (activeState.selectedLine) {
          activeState.selectedLine.element.classList.remove('selected');
          activeState.selectedLine = null;
        }
        if (e.button === 0) startMarqueeSelection(e);
      }
      if (e.button === 1) { // middle mouse — panning
        e.preventDefault();
        canvasState.isPanning = true;
        canvasState.lastMouseX = e.clientX;
        canvasState.lastMouseY = e.clientY;
        document.body.style.cursor = 'move';
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (canvasState.isPanning) {
        const dx = e.clientX - canvasState.lastMouseX;
        const dy = e.clientY - canvasState.lastMouseY;
        canvasState.x += dx;
        canvasState.y += dy;
        canvasState.lastMouseX = e.clientX;
        canvasState.lastMouseY = e.clientY;
        updateCanvasTransform();
      } else if (activeState.isDrawingLine) {
        const coords = getCanvasCoordinates(e.clientX, e.clientY);
        const startPoint = getPointCoords(activeState.lineStart.card, activeState.lineStart.side);
        updateLinePath(activeState.previewLine, startPoint, coords, activeState.lineStart.side, null);
      } else if (activeState.isSelecting) {
        updateMarqueeSelection(e);
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 1) {
        canvasState.isPanning = false;
        document.body.style.cursor = 'default';
      }
      if (e.button === 0 && activeState.isSelecting) endMarqueeSelection(e);
    });

    window.addEventListener('wheel', (e) => {
      if (e.target.closest('.ui-panel')) return;
      e.preventDefault();
      const scaleAmount = -e.deltaY * 0.001;
      const newScale = Math.max(0.2, Math.min(3, canvasState.scale + scaleAmount));
      const mouseX = e.clientX;
      const mouseY = e.clientY;
      canvasState.x = mouseX - (mouseX - canvasState.x) * (newScale / canvasState.scale);
      canvasState.y = mouseY - (mouseY - canvasState.y) * (newScale / canvasState.scale);
      canvasState.scale = newScale;
      updateCanvasTransform();
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      // отмена отрисовки линии
      if (e.key === 'Escape' && activeState.isDrawingLine) cancelDrawing();

      // Undo / Redo
      if (e.ctrlKey && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z') || (e.ctrlKey && e.key.toLowerCase() === 'y')) {
        e.preventDefault(); redo();
      }

      // Copy / Paste
      if (e.ctrlKey && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); }
      if (e.ctrlKey && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteSelection(); }
    });
  }

  function updateCanvasTransform() {
    canvas.style.transform = `translate(${canvasState.x}px, ${canvasState.y}px) scale(${canvasState.scale})`;
  }

  // ==== Create card ====
  function createCard(opts = {}) {
    const cardId = `card_${Date.now()}_${Math.floor(Math.random()*1000)}`;
    const card = document.createElement('div');
    card.className = 'card'; card.id = cardId;

    const initialX = opts.x != null
      ? opts.x
      : (window.innerWidth / 2 - 140) / canvasState.scale - (canvasState.x / canvasState.scale);
    const initialY = opts.y != null
      ? opts.y
      : (window.innerHeight / 2 - 150) / canvasState.scale - (canvasState.y / canvasState.scale);
    card.style.left = `${Math.round(initialX / GRID_SIZE) * GRID_SIZE}px`;
    card.style.top  = `${Math.round(initialY / GRID_SIZE) * GRID_SIZE}px`;

    const titleText = opts.title ?? 'RUY1234567890';
    const bodyHTML = opts.bodyHTML ?? `
        <div class="card-row">
          <svg class="coin-icon" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="45" fill="#ffd700" stroke="#DAA520" stroke-width="5"/>
          </svg>
          <span class="value" contenteditable="true">330/330pv</span>
        </div>
        <div class="card-row"><span class="label">Статус VIP:</span><span class="value" contenteditable="true">НЕТ</span></div>
        <div class="card-row"><span class="label">Лево/Право</span></div>
        <div class="card-row"><span class="label">Баланс:</span><span class="value" contenteditable="true">1 / 1</span></div>
        <div class="card-row"><span class="label">Актив-заказы PV:</span><span class="value" contenteditable="true">0 / 0</span></div>
        <div class="card-row"><span class="label">Цикл:</span><span class="value" contenteditable="true">0</span></div>
    `;

    card.innerHTML = `
      <div class="card-header" style="${opts.headerBg ? `background:${opts.headerBg}` : ''}">
        <span class="lock-btn" title="Заблокировать / Разблокировать">🔓</span>
        <span class="card-title" contenteditable="true">${titleText}</span>
        <span class="close-btn" title="Удалить">×</span>
      </div>
      <div class="card-body">${bodyHTML}</div>
      <div class="connection-point top" data-side="top"></div>
      <div class="connection-point right" data-side="right"></div>
      <div class="connection-point bottom" data-side="bottom"></div>
      <div class="connection-point left" data-side="left"></div>
      <div class="color-changer" data-color-index="${opts.colorIndex ?? 0}"></div>
    `;

    canvas.appendChild(card);
    const cardData = { id: cardId, element: card, locked: !!opts.locked };
    if (cardData.locked) card.classList.add('locked');

    cards.push(cardData);

    // click/close/drag
    card.addEventListener('mousedown', (e) => {
      if (e.ctrlKey) { e.stopPropagation(); toggleCardSelection(cardData); }
    });
    card.querySelector('.close-btn').addEventListener('click', (e) => {
      e.stopPropagation(); deleteCard(cardData); saveState();
    });
    makeDraggable(card, cardData);

    // lock toggle
    const lockBtn = card.querySelector('.lock-btn');
    lockBtn.textContent = cardData.locked ? '🔒' : '🔓';
    lockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      cardData.locked = !cardData.locked;
      lockBtn.textContent = cardData.locked ? '🔒' : '🔓';
      card.classList.toggle('locked', cardData.locked);
      card.querySelectorAll('[contenteditable]').forEach(el => {
        el.setAttribute('contenteditable', cardData.locked ? 'false' : 'true');
      });
      saveState();
    });

    // coin click
    const coin = card.querySelector('.coin-icon circle');
    if (coin) {
      coin.addEventListener('click', () => {
        coin.setAttribute('fill', coin.getAttribute('fill') === '#ffd700' ? '#3d85c6' : '#ffd700');
        saveState();
      });
    }

    // color changer — меняем background заголовка
    const colorChanger = card.querySelector('.color-changer');
    const setHeaderColorByIndex = (idx) => {
      const newColor = cardColors[idx % cardColors.length];
      colorChanger.style.backgroundColor = newColor;
      card.querySelector('.card-header').style.background = newColor;
    };
    const startIndex = parseInt(colorChanger.dataset.colorIndex || '0', 10);
    setHeaderColorByIndex(startIndex);
    colorChanger.addEventListener('click', () => {
      let currentIndex = parseInt(colorChanger.dataset.colorIndex || '0', 10);
      let nextIndex = (currentIndex + 1) % cardColors.length;
      colorChanger.dataset.colorIndex = String(nextIndex);
      setHeaderColorByIndex(nextIndex);
      saveState();
    });

    // content changes -> history (по blur, чтобы не спамить)
    card.querySelectorAll('[contenteditable="true"]').forEach(el => {
      el.addEventListener('blur', () => saveState());
    });

    // connection points
    card.querySelectorAll('.connection-point').forEach(point => {
      point.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (cardData.locked) return;
        if (!activeState.isDrawingLine) {
          startDrawingLine(cardData, point.dataset.side);
        } else {
          endDrawingLine(cardData, point.dataset.side);
          saveState();
        }
      });
    });

    return cardData;
  }

  // ==== Dragging ====
  function makeDraggable(element, cardData) {
    const header = element.querySelector('.card-header');
    header.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.ctrlKey) return;
      if (cardData.locked) return;
      e.stopPropagation();

      if (!activeState.selectedCards.has(cardData)) {
        clearSelection();
        toggleCardSelection(cardData);
      }

      const draggedCards = [];
      activeState.selectedCards.forEach(selectedCard => {
        if (selectedCard.locked) return;
        draggedCards.push({
          element: selectedCard.element,
          startX: parseFloat(selectedCard.element.style.left),
          startY: parseFloat(selectedCard.element.style.top)
        });
      });

      const startMouseX = e.clientX;
      const startMouseY = e.clientY;

      function onMouseMove(e2) {
        const dx = (e2.clientX - startMouseX) / canvasState.scale;
        const dy = (e2.clientY - startMouseY) / canvasState.scale;
        draggedCards.forEach(dragged => {
          const newX = dragged.startX + dx;
          const newY = dragged.startY + dy;
          const snappedX = Math.round(newX / GRID_SIZE) * GRID_SIZE;
          const snappedY = Math.round(newY / GRID_SIZE) * GRID_SIZE;
          dragged.element.style.left = `${snappedX}px`;
          dragged.element.style.top = `${snappedY}px`;
          updateLinesForCard(dragged.element.id);
        });
      }

      function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        saveState();
      }
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  // ==== Lines ====
  function startDrawingLine(card, side) {
    activeState.isDrawingLine = true;
    activeState.lineStart = { card, side };
    activeState.previewLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    activeState.previewLine.setAttribute('class', 'line');
    activeState.previewLine.setAttribute('stroke', activeState.currentColor);
    activeState.previewLine.setAttribute('stroke-dasharray', '5,5');
    activeState.previewLine.setAttribute('stroke-width', activeState.currentThickness);
    activeState.previewLine.style.setProperty('--line-color', activeState.currentColor);
    activeState.previewLine.setAttribute('marker-start', 'url(#marker-dot)');
    activeState.previewLine.setAttribute('marker-end', 'url(#marker-dot)'); // кружок в конце
    svgLayer.appendChild(activeState.previewLine);
  }

  function endDrawingLine(card, side) {
    if (!activeState.lineStart || activeState.lineStart.card.id === card.id) { cancelDrawing(); return; }

    const lineElement = activeState.previewLine;
    lineElement.removeAttribute('stroke-dasharray');

    const lineData = {
      id: `line_${Date.now()}_${Math.floor(Math.random()*1000)}`,
      startCard: activeState.lineStart.card,
      startSide: activeState.lineStart.side,
      endCard: card,
      endSide: side,
      color: activeState.currentColor,
      element: lineElement
    };
    lines.push(lineData);
    lineElement.addEventListener('click', (e) => { e.stopPropagation(); selectLine(lineData); });
    updateAllLines();

    activeState.isDrawingLine = false;
    activeState.lineStart = null;
    activeState.previewLine = null;
  }

  function cancelDrawing() {
    if (activeState.previewLine) activeState.previewLine.remove();
    activeState.isDrawingLine = false;
    activeState.lineStart = null;
    activeState.previewLine = null;
  }

  // маршрутизация линии
  function updateLinePath(pathElement, p1, p2, side1, side2) {
    let finalP2 = { ...p2 };
    let midP1 = { ...p1 };

    if (side1 === 'left' || side1 === 'right') { // H -> V
      midP1 = { x: p2.x, y: p1.y };
      if (side2) finalP2.y = p2.y + (p2.y > p1.y ? -MARKER_OFFSET : MARKER_OFFSET);
    } else { // V -> H
      midP1 = { x: p1.x, y: p2.y };
      if (side2) finalP2.x = p2.x + (p2.x > p1.x ? -MARKER_OFFSET : MARKER_OFFSET);
    }
    pathElement.setAttribute('d', `M ${p1.x} ${p1.y} L ${midP1.x} ${midP1.y} L ${finalP2.x} ${finalP2.y}`);
  }

  // ==== Slider ====
  function setupThicknessSlider() {
    const updateTrack = (val) => {
      const min = Number(thicknessSlider.min);
      const max = Number(thicknessSlider.max);
      const percent = Math.round(((val - min) / (max - min)) * 100);
      thicknessSlider.style.background = `linear-gradient(90deg,#42e695 0%, #3bb2b8 ${percent}%, #e0e0e0 ${percent}%)`;
    };

    thicknessValue.textContent = thicknessSlider.value;
    updateTrack(thicknessSlider.value);

    thicknessSlider.addEventListener('input', (e) => {
      const newThickness = Number(e.target.value);
      activeState.currentThickness = newThickness;
      thicknessValue.textContent = String(newThickness);
      updateTrack(newThickness);

      lines.forEach(line => line.element.setAttribute('stroke-width', newThickness));
      if (activeState.previewLine) {
        activeState.previewLine.setAttribute('stroke-width', newThickness);
      }
      saveState();
    });
  }

  // ==== Palette ====
  function setupPalette() {
    colorPalette.querySelectorAll('.color-option').forEach(option => {
      option.addEventListener('click', () => {
        const prev = colorPalette.querySelector('.active');
        if (prev) prev.classList.remove('active');
        option.classList.add('active');
        activeState.currentColor = option.dataset.color;
        if (activeState.selectedLine) {
          activeState.selectedLine.color = activeState.currentColor;
          activeState.selectedLine.element.setAttribute('stroke', activeState.currentColor);
          activeState.selectedLine.element.style.setProperty('--line-color', activeState.currentColor);
          saveState();
        }
      });
    });
  }

  // ==== Gradient background ====
  function setupGradientSelector() {
    gradientSelector.querySelectorAll('.grad-btn').forEach(btn => {
      if (btn.dataset.gradient && btn.dataset.gradient !== '#ffffff') {
        btn.style.background = btn.dataset.gradient;
      } else {
        btn.style.background = '#ffffff';
        btn.style.border = '1px solid #ddd';
      }
      btn.addEventListener('click', () => {
        const g = btn.dataset.gradient;
        if (g === '#ffffff') document.body.style.background = '#ffffff';
        else document.body.style.background = g;
      });
    });
  }

  // ==== Selection & utils ====
  function deleteCard(cardData) {
    lines = lines.filter(line => {
      if (line.startCard.id === cardData.id || line.endCard.id === cardData.id) {
        line.element.remove(); return false;
      }
      return true;
    });
    cardData.element.remove();
    cards = cards.filter(c => c.id !== cardData.id);
    activeState.selectedCards.delete(cardData);
  }

  function updateLinesForCard(cardId) {
    lines.forEach(line => {
      if (line.startCard.id === cardId || line.endCard.id === cardId) {
        const startPoint = getPointCoords(line.startCard, line.startSide);
        const endPoint   = getPointCoords(line.endCard, line.endSide);
        updateLinePath(line.element, startPoint, endPoint, line.startSide, line.endSide);
      }
    });
  }

  function updateAllLines() { lines.forEach(line => updateLinesForCard(line.startCard.id)); }

  function getPointCoords(cardData, side) {
    const card = cardData.element;
    const x = parseFloat(card.style.left);
    const y = parseFloat(card.style.top);
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    switch (side) {
      case 'top': return { x: x + width / 2, y: y };
      case 'bottom': return { x: x + width / 2, y: y + height };
      case 'left': return { x: x, y: y + height / 2 };
      case 'right': return { x: x + width, y: y + height / 2 };
    }
  }

  function selectLine(lineData) {
    if (activeState.selectedLine) activeState.selectedLine.element.classList.remove('selected');
    activeState.selectedLine = lineData;
    lineData.element.classList.add('selected');
  }

  function toggleCardSelection(cardData) {
    if (activeState.selectedCards.has(cardData)) {
      activeState.selectedCards.delete(cardData);
      cardData.element.classList.remove('selected');
    } else {
      activeState.selectedCards.add(cardData);
      cardData.element.classList.add('selected');
    }
  }

  function setSelectionSet(newSet) {
    // снимаем выделение со всех
    activeState.selectedCards.forEach(card => card.element.classList.remove('selected'));
    activeState.selectedCards.clear();
    // ставим новое
    newSet.forEach(cd => {
      activeState.selectedCards.add(cd);
      cd.element.classList.add('selected');
    });
  }

  function clearSelection() {
    activeState.selectedCards.forEach(card => card.element.classList.remove('selected'));
    activeState.selectedCards.clear();
  }

  // ==== Marquee selection (исправлено) ====
  let selectionBox = null;
  let marqueeStart = { x: 0, y: 0 };
  let baseSelection = null; // для добавления при Ctrl

  function startMarqueeSelection(e) {
    if (!e.ctrlKey) clearSelection();
    activeState.isSelecting = true;
    marqueeStart.x = e.clientX; marqueeStart.y = e.clientY;
    baseSelection = e.ctrlKey ? new Set(activeState.selectedCards) : new Set();

    if (!selectionBox) {
      selectionBox = document.createElement('div');
      selectionBox.className = 'selection-box';
      document.body.appendChild(selectionBox);
    }
    selectionBox.style.left = `${marqueeStart.x}px`;
    selectionBox.style.top = `${marqueeStart.y}px`;
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
  }

  function updateMarqueeSelection(e) {
    if (!activeState.isSelecting) return;
    const x = Math.min(e.clientX, marqueeStart.x);
    const y = Math.min(e.clientY, marqueeStart.y);
    const width  = Math.abs(e.clientX - marqueeStart.x);
    const height = Math.abs(e.clientY - marqueeStart.y);
    selectionBox.style.left   = `${x}px`;
    selectionBox.style.top    = `${y}px`;
    selectionBox.style.width  = `${width}px`;
    selectionBox.style.height = `${height}px`;

    const selectionRect = selectionBox.getBoundingClientRect();
    const newSet = new Set(baseSelection);
    cards.forEach(cardData => {
      const rect = cardData.element.getBoundingClientRect();
      const intersect = rect.left < selectionRect.right && rect.right > selectionRect.left &&
                        rect.top  < selectionRect.bottom && rect.bottom > selectionRect.top;
      if (intersect) newSet.add(cardData);
    });
    setSelectionSet(newSet);
  }

  function endMarqueeSelection() {
    activeState.isSelecting = false;
    if (selectionBox) {
      selectionBox.style.width = '0px';
      selectionBox.style.height = '0px';
    }
  }

  function getCanvasCoordinates(clientX, clientY) {
    return {
      x: (clientX - canvasState.x) / canvasState.scale,
      y: (clientY - canvasState.y) / canvasState.scale
    };
  }

  // ==== История (Undo/Redo) ====
  function setupHistoryButtons() {
    undoBtn.addEventListener('click', undo);
    redoBtn.addEventListener('click', redo);
  }

  function serializeState() {
    return {
      cards: cards.map(c => ({
        id: c.id,
        x: parseFloat(c.element.style.left),
        y: parseFloat(c.element.style.top),
        locked: c.locked,
        title: c.element.querySelector('.card-title')?.innerText ?? '',
        bodyHTML: c.element.querySelector('.card-body')?.innerHTML ?? '',
        headerBg: c.element.querySelector('.card-header')?.style.background ?? '',
        colorIndex: parseInt(c.element.querySelector('.color-changer')?.dataset.colorIndex || '0', 10)
      })),
      lines: lines.map(l => ({
        startId: l.startCard.id,
        startSide: l.startSide,
        endId: l.endCard.id,
        endSide: l.endSide,
        color: l.color
      })),
      thickness: activeState.currentThickness
    };
  }

  function loadState(state, pushHistory = false) {
    // очистка
    lines.forEach(l => l.element.remove());
    lines = [];
    cards.forEach(c => c.element.remove());
    cards = [];
    activeState.selectedCards.clear();
    activeState.selectedLine = null;

    // восстановление карточек
    const idMap = new Map(); // oldId -> newCardData
    state.cards.forEach(cd => {
      const cardData = createCard({
        x: cd.x, y: cd.y, locked: cd.locked,
        title: cd.title, bodyHTML: cd.bodyHTML,
        headerBg: cd.headerBg, colorIndex: cd.colorIndex
      });
      // сохранить оригинальный id для ссылок линий
      idMap.set(cd.id, cardData);
    });

    // восстановление линий
    state.lines.forEach(ld => {
      const startCard = idMap.get(ld.startId);
      const endCard = idMap.get(ld.endId);
      if (!startCard || !endCard) return;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'line');
      path.setAttribute('stroke', ld.color);
      path.setAttribute('stroke-width', state.thickness ?? activeState.currentThickness);
      path.style.setProperty('--line-color', ld.color);
      path.setAttribute('marker-start', 'url(#marker-dot)');
      path.setAttribute('marker-end', 'url(#marker-dot)');
      svgLayer.appendChild(path);

      const lineData = {
        id: `line_${Date.now()}_${Math.floor(Math.random()*1000)}`,
        startCard, startSide: ld.startSide,
        endCard,   endSide: ld.endSide,
        color: ld.color, element: path
      };
      lines.push(lineData);
      path.addEventListener('click', (e) => { e.stopPropagation(); selectLine(lineData); });
      const p1 = getPointCoords(startCard, ld.startSide);
      const p2 = getPointCoords(endCard, ld.endSide);
      updateLinePath(path, p1, p2, ld.startSide, ld.endSide);
    });

    // толщина
    if (state.thickness != null) {
      activeState.currentThickness = state.thickness;
      thicknessSlider.value = state.thickness;
      thicknessValue.textContent = String(state.thickness);
      lines.forEach(l => l.element.setAttribute('stroke-width', state.thickness));
    }

    if (pushHistory) saveState();
  }

  function saveState() {
    const snapshot = serializeState();
    undoStack.push(JSON.stringify(snapshot));
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack = [];
  }

    function undo() {
    if (undoStack.length < 2) return; // текущий + нечего откатывать
    const current = undoStack.pop();
    redoStack.push(current);
    const prev = JSON.parse(undoStack[undoStack.length - 1]);
    loadState(prev, false);
  }

  function redo() {
    if (redoStack.length === 0) return;
    const snapshot = redoStack.pop();
    // Текущий в undo
    const current = JSON.stringify(serializeState());
    undoStack.push(current);
    loadState(JSON.parse(snapshot), false);
  }

  // ==== Copy / Paste ====
  function copySelection() {
    if (activeState.selectedCards.size === 0) return;
    const selectedIds = new Set([...activeState.selectedCards].map(c => c.id));

    const copiedCards = [];
    activeState.selectedCards.forEach(cd => {
      copiedCards.push({
        id: cd.id,
        x: parseFloat(cd.element.style.left),
        y: parseFloat(cd.element.style.top),
        locked: cd.locked,
        title: cd.element.querySelector('.card-title')?.innerText ?? '',
        bodyHTML: cd.element.querySelector('.card-body')?.innerHTML ?? '',
        headerBg: cd.element.querySelector('.card-header')?.style.background ?? '',
        colorIndex: parseInt(cd.element.querySelector('.color-changer')?.dataset.colorIndex || '0', 10),
      });
    });

    const copiedLines = [];
    lines.forEach(l => {
      if (selectedIds.has(l.startCard.id) && selectedIds.has(l.endCard.id)) {
        copiedLines.push({
          startId: l.startCard.id,
          startSide: l.startSide,
          endId: l.endCard.id,
          endSide: l.endSide,
          color: l.color
        });
      }
    });

    clipboard = { cards: copiedCards, lines: copiedLines };
  }

  function pasteSelection() {
    if (!clipboard || !clipboard.cards || clipboard.cards.length === 0) return;

    const OFFSET = 40;
    const idMap = new Map(); // oldId -> newCardData
    const newSelection = new Set();

    // создаём карточки со смещением
    clipboard.cards.forEach(cd => {
      const newCard = createCard({
        x: cd.x + OFFSET,
        y: cd.y + OFFSET,
        locked: cd.locked,
        title: cd.title,
        bodyHTML: cd.bodyHTML,
        headerBg: cd.headerBg,
        colorIndex: cd.colorIndex
      });
      idMap.set(cd.id, newCard);
      newSelection.add(newCard);
    });

    // выделяем вставленную группу для дальнейшего перемещения
    setSelectionSet(newSelection);

    // ИСПРАВЛЕНИЕ: Даем браузеру время на рендеринг перед созданием линий
    setTimeout(() => {
        // создаём линии между новыми карточками
        clipboard.lines.forEach(ld => {
            const startCard = idMap.get(ld.startId);
            const endCard = idMap.get(ld.endId);
            if (!startCard || !endCard) return;
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('class', 'line');
            path.setAttribute('stroke', ld.color);
            path.setAttribute('stroke-width', activeState.currentThickness);
            path.style.setProperty('--line-color', ld.color);
            path.setAttribute('marker-start', 'url(#marker-dot)');
            path.setAttribute('marker-end', 'url(#marker-dot)');
            svgLayer.appendChild(path);

            const lineData = {
                id: `line_${Date.now()}_${Math.floor(Math.random()*1000)}`,
                startCard, startSide: ld.startSide,
                endCard,   endSide: ld.endSide,
                color: ld.color, element: path
            };
            lines.push(lineData);
            path.addEventListener('click', (e) => { e.stopPropagation(); selectLine(lineData); });
            const p1 = getPointCoords(startCard, ld.startSide);
            const p2 = getPointCoords(endCard, ld.endSide);
            updateLinePath(path, p1, p2, ld.startSide, ld.endSide);
        });
        
        // Сохраняем состояние ПОСЛЕ того, как линии были добавлены
        saveState();
    }, 0);
  }

  // ==== Скриншот всей схемы (включая невидимое) ====
  function setupScreenshot() {
    screenshotBtn.addEventListener('click', async () => {
      try {
        const bbox = computeFullBoundingBox();
        if (!bbox) return;

        const { minX, minY, maxX, maxY } = bbox;
        const padding = 40;
        const width = Math.ceil(maxX - minX + padding * 2);
        const height = Math.ceil(maxY - minY + padding * 2);

        // Клонируем canvas и убираем лишнее (точки соединения, кнопки, ховеры)
        const clone = canvas.cloneNode(true);
        // Скрыть элементы, которые не нужны на скриншоте
        clone.querySelectorAll('.connection-point, .color-changer, .close-btn, .lock-btn').forEach(el => el.remove());

        // Сдвигаем контент так, чтобы минимальная точка оказалась в (padding, padding)
        clone.style.transform = `translate(${-minX + padding}px, ${-minY + padding}px) scale(1)`;
        clone.style.transformOrigin = '0 0';
        clone.style.width = `${width}px`;
        clone.style.height = `${height}px`;

        // ИСПРАВЛЕНИЕ: Динамически собираем все стили со страницы для полной точности
        const styles = Array.from(document.styleSheets)
          .map(sheet => {
              try {
                  return Array.from(sheet.cssRules).map(rule => rule.cssText).join(' ');
              } catch (e) {
                  // Игнорируем ошибки для внешних стилей (CORS)
                  console.warn('Could not read stylesheet rules:', e);
                  return '';
              }
          })
          .join(' ');
        const embeddedCSS = `<style>${styles}</style>`;

        // Создаём новый внешней SVG со foreignObject
        const svgNS = 'http://www.w3.org/2000/svg';
        const xhtmlNS = 'http://www.w3.org/1999/xhtml';

        const bigSvg = document.createElementNS(svgNS, 'svg');
        bigSvg.setAttribute('xmlns', svgNS);
        bigSvg.setAttribute('width', String(width));
        bigSvg.setAttribute('height', String(height));
        bigSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);

        // Фон (пытаемся угадать фоновый цвет)
        const bodyBg = getComputedStyle(document.body).backgroundImage === 'none'
          ? getComputedStyle(document.body).backgroundColor || '#ffffff'
          : '#ffffff'; // если градиент — ставим белый фон
        const bgRect = document.createElementNS(svgNS, 'rect');
        bgRect.setAttribute('x', '0'); bgRect.setAttribute('y', '0');
        bgRect.setAttribute('width', String(width)); bgRect.setAttribute('height', String(height));
        bgRect.setAttribute('fill', bodyBg || '#ffffff');
        bigSvg.appendChild(bgRect);

        // Пересобираем <defs> с маркером-кружком для линий
        const defs = document.createElementNS(svgNS, 'defs');
        const marker = document.createElementNS(svgNS, 'marker');
        marker.setAttribute('id', 'marker-dot');
        marker.setAttribute('viewBox', '0 0 10 10');
        marker.setAttribute('refX', '5');
        marker.setAttribute('refY', '5');
        marker.setAttribute('markerWidth', '6');
        marker.setAttribute('markerHeight', '6');
        const dot = document.createElementNS(svgNS, 'circle');
        dot.setAttribute('cx', '5'); dot.setAttribute('cy', '5'); dot.setAttribute('r', '4');
        dot.setAttribute('fill', 'currentColor');
        marker.appendChild(dot);
        defs.appendChild(marker);
        bigSvg.appendChild(defs);

        // foreignObject с HTML-контентом
        const fo = document.createElementNS(svgNS, 'foreignObject');
        fo.setAttribute('x', '0'); fo.setAttribute('y', '0');
        fo.setAttribute('width', String(width)); fo.setAttribute('height', String(height));

        const wrapper = document.createElementNS(xhtmlNS, 'div');
        wrapper.setAttribute('xmlns', xhtmlNS);
        wrapper.style.fontFamily = getComputedStyle(document.body).fontFamily; // Наследуем шрифт
        wrapper.style.width = `${width}px`;
        wrapper.style.height = `${height}px`;
        wrapper.innerHTML = embeddedCSS + clone.outerHTML;

        fo.appendChild(wrapper);
        bigSvg.appendChild(fo);

        // ВАЖНО: переместим svg линии наружу (поверх) и сдвинем их, чтобы совпали координаты
        // Берём оригинальные path и копируем с учетом смещения и текущей толщины/цвета
        const overlaySVG = document.createElementNS(svgNS, 'g');
        lines.forEach(l => {
          const src = l.element;
          const path = document.createElementNS(svgNS, 'path');
          path.setAttribute('class', 'line');
          path.setAttribute('d', translatePathD(src.getAttribute('d'), -minX + padding, -minY + padding));
          path.setAttribute('stroke', src.getAttribute('stroke') || l.color || '#000');
          path.setAttribute('stroke-width', src.getAttribute('stroke-width') || String(activeState.currentThickness));
          path.setAttribute('fill', 'none');
          path.setAttribute('marker-start', 'url(#marker-dot)');
          path.setAttribute('marker-end', 'url(#marker-dot)');
          overlaySVG.appendChild(path);
        });
        bigSvg.appendChild(overlaySVG);

        // Сериализуем в PNG
        const svgData = new XMLSerializer().serializeToString(bigSvg);
        const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const img = new Image();
        img.onload = () => {
          const canvasEl = document.createElement('canvas');
          canvasEl.width = width;
          canvasEl.height = height;
          const ctx = canvasEl.getContext('2d');
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          canvasEl.toBlob((pngBlob) => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(pngBlob);
            a.download = `board-screenshot-${Date.now()}.png`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          });
        };
        img.src = url;
      } catch (err) {
        console.error('Screenshot error:', err);
      }
    });
  }

  // Вспомогательная: смещение path d на dx,dy (работает для простых M/L абсолютных путей)
  function translatePathD(d, dx, dy) {
    if (!d) return '';
    // Простейший парсер для "M x y L x y L x y"
    return d.replace(/([ML])\s*([\-0-9.]+)\s*([\-0-9.]+)/gi, (m, cmd, x, y) => {
      const nx = parseFloat(x) + dx;
      const ny = parseFloat(y) + dy;
      return `${cmd} ${nx} ${ny}`;
    });
  }

  // Границы всей схемы
  function computeFullBoundingBox() {
    if (cards.length === 0 && lines.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    // карточки
    cards.forEach(c => {
      const el = c.element;
      const left = parseFloat(el.style.left);
      const top = parseFloat(el.style.top);
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      minX = Math.min(minX, left);
      minY = Math.min(minY, top);
      maxX = Math.max(maxX, left + w);
      maxY = Math.max(maxY, top + h);
    });

    // линии
    lines.forEach(l => {
      const bb = l.element.getBBox();
      minX = Math.min(minX, bb.x);
      minY = Math.min(minY, bb.y);
      maxX = Math.max(maxX, bb.x + bb.width);
      maxY = Math.max(maxY, bb.y + bb.height);
    });

    return { minX, minY, maxX, maxY };
  }

  // ===== Инициируем стартовое состояние =====
  if (cards.length === 0) {
    createCard({ x: 0, y: 0, title: 'RUY1234567890' });
    saveState();
  }
});
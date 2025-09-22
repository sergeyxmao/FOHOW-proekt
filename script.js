document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('canvas');
  const svgLayer = document.getElementById('svg-layer');
  const addCardBtn = document.getElementById('add-card-btn');
  const addTemplateBtn = document.getElementById('add-template-btn');
  const lineColorPicker = document.getElementById('line-color-picker');
  const thicknessSlider = document.getElementById('thickness-slider');
  const thicknessValue = document.getElementById('thickness-value');
  const gradientSelector = document.getElementById('gradient-selector');
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  const loadProjectBtn = document.getElementById('load-project-btn');
  const loadProjectInput = document.getElementById('load-project-input');

  // Новые элементы UI
  const selectionModeBtn = document.getElementById('selection-mode-btn');
  const globalThicknessSlider = document.getElementById('global-thickness-slider');
  const globalThicknessValue = document.getElementById('global-thickness-value');
  const saveProjectBtn = document.getElementById('save-project-btn');
  const exportHtmlBtn = document.getElementById('export-html-btn');

  const GRID_SIZE = 70;
  const MARKER_OFFSET = 12;
  const HISTORY_LIMIT = 50;

  let canvasState = { x: 0, y: 0, scale: 1, isPanning: false, lastMouseX: 0, lastMouseY: 0 };
  let activeState = {
    currentColor: '#3d85c6',
    currentThickness: 5,
    selectedLine: null,
    selectedCards: new Set(),
    isDrawingLine: false,
    isSelecting: false, 
    isSelectionMode: false,
    lineStart: null,
    previewLine: null
  };
  let cards = [];
  let lines = [];
  const cardColors = ['#5D8BF4', '#38A3A5', '#E87A5D', '#595959'];

  let undoStack = [];
  let redoStack = [];
  let clipboard = null;

  if (!canvas || !svgLayer) {
    console.error('Required containers not found (canvas/svg-layer). Check IDs in HTML.');
    return;
  }

  if (addCardBtn) addCardBtn.addEventListener('click', () => { createCard(); saveState(); });
  if (addTemplateBtn) addTemplateBtn.addEventListener('click', loadTemplate);

  setupPalette();
  setupThicknessSlider();
  setupGlobalEventListeners();
  setupGradientSelector();
  setupHistoryButtons();
  setupSelectionMode();
  setupGlobalThicknessSlider();
  setupSaveButtons();

  // ==== Global listeners ====
  function setupGlobalEventListeners() {
    window.addEventListener('mousedown', (e) => {
      if (e.target.closest('.ui-panel') || e.target.closest('.note-window')) return;

      if (e.button === 1) { 
        e.preventDefault();
        canvasState.isPanning = true;
        canvasState.lastMouseX = e.clientX;
        canvasState.lastMouseY = e.clientY;
        document.body.style.cursor = 'move';
        return; 
      }

      if (e.button === 0) {
        if (e.target.closest('.card')) {
          if (activeState.selectedLine) {
            activeState.selectedLine.element.classList.remove('selected');
            activeState.selectedLine = null;
          }
          return;
        }

        if (activeState.selectedLine) {
          activeState.selectedLine.element.classList.remove('selected');
          activeState.selectedLine = null;
        }
        
        if (activeState.isSelectionMode) {
          startMarqueeSelection(e);
        }
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
      if (e.target.isContentEditable || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
        
      if (e.key === 'Escape') {
        if (activeState.isDrawingLine) cancelDrawing();
        if (activeState.isSelectionMode) {
          activeState.isSelectionMode = false;
          if (selectionModeBtn) selectionModeBtn.classList.remove('active');
          document.body.style.cursor = 'default';
        }
      }

      if (e.key === 'Delete') deleteSelection();

      if (e.ctrlKey && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z') || (e.ctrlKey && e.key.toLowerCase() === 'y')) {
        e.preventDefault(); redo();
      }

      if (e.ctrlKey && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); }
      if (e.ctrlKey && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteSelection(); }
    });
  }
  
  // ==== Режим выделения ====
  function setupSelectionMode() {
    if (!selectionModeBtn) return;
    selectionModeBtn.addEventListener('click', () => {
      activeState.isSelectionMode = !activeState.isSelectionMode;
      selectionModeBtn.classList.toggle('active', activeState.isSelectionMode);
      document.body.style.cursor = activeState.isSelectionMode ? 'crosshair' : 'default';
    });
  }

  // ==== Слайдер общей толщины ====
  function setupGlobalThicknessSlider() {
    if (!globalThicknessSlider || !globalThicknessValue) return;

    const updateTrack = (val, slider) => {
      const min = Number(slider.min || 0);
      const max = Number(slider.max || 100);
      const percent = Math.round(((val - min) / (max - min)) * 100);
      slider.style.background = `linear-gradient(90deg,#42e695 0%, #3bb2b8 ${percent}%, #e0e0e0 ${percent}%)`;
    };

    globalThicknessValue.textContent = globalThicknessSlider.value;
    updateTrack(globalThicknessSlider.value, globalThicknessSlider);

    globalThicknessSlider.addEventListener('input', (e) => {
      const newThickness = Number(e.target.value);
      globalThicknessValue.textContent = String(newThickness);
      updateTrack(newThickness, globalThicknessSlider);
      
      lines.forEach(line => {
        line.thickness = newThickness;
        line.element.setAttribute('stroke-width', newThickness);
      });

      if (activeState.selectedLine) activeState.selectedLine.thickness = newThickness;
      activeState.currentThickness = newThickness;
      if (thicknessSlider) thicknessSlider.value = newThickness;
      if (thicknessValue) thicknessValue.textContent = newThickness;
      if (thicknessSlider) updateTrack(newThickness, thicknessSlider);
    });

    globalThicknessSlider.addEventListener('change', saveState);
  }

  function updateCanvasTransform() {
    canvas.style.transform = `translate(${canvasState.x}px, ${canvasState.y}px) scale(${canvasState.scale})`;
  }

  // ==== Create card ====
  function createCard(opts = {}) {
    const cardId = `card_${Date.now()}_${Math.floor(Math.random()*1000)}`;
    const card = document.createElement('div');
    card.className = 'card'; card.id = cardId;

    if (opts.isDarkMode) card.classList.add('dark-mode');
    
    const CARD_WIDTH = 380;
    const CARD_HEIGHT = 280;
    const PADDING = 50;

    let initialX, initialY;

    if (opts.x != null) {
      initialX = opts.x;
      initialY = opts.y;
    } else {
      const canvasViewLeft = -canvasState.x / canvasState.scale;
      const canvasViewTop = -canvasState.y / canvasState.scale;
      const canvasViewRight = (window.innerWidth - canvasState.x) / canvasState.scale;
      const canvasViewBottom = (window.innerHeight - canvasState.y) / canvasState.scale;
      
      const desiredX = canvasViewRight - CARD_WIDTH - PADDING;
      const desiredY = canvasViewBottom - CARD_HEIGHT - PADDING;

      initialX = Math.max(canvasViewLeft + PADDING, desiredX);
      initialY = Math.max(canvasViewTop + PADDING, desiredY);
    }
    
    if (opts.isTemplate) {
      card.style.left = `${initialX}px`;
      card.style.top  = `${initialY}px`;
    } else {
      card.style.left = `${Math.round(initialX / GRID_SIZE) * GRID_SIZE}px`;
      card.style.top  = `${Math.round(initialY / GRID_SIZE) * GRID_SIZE}px`;
    }

    const titleText = opts.title ?? 'RUY1234567890';
    const bodyHTML = opts.bodyHTML ?? `
        <div class="card-row">
          <svg class="coin-icon" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="45" fill="#ffd700" stroke="#DAA520" stroke-width="5"/>
          </svg>
          <span class="value" contenteditable="true">330/330pv</span>
        </div>
        <div class="card-row"><span class="label">Баланс:</span><span class="value" contenteditable="true">0 / 0</span></div>
        <div class="card-row"><span class="label">Актив-заказы PV:</span><span class="value" contenteditable="true">0 / 0</span></div>
        <div class="card-row"><span class="label">Цикл:</span><span class="value" contenteditable="true">0</span></div>
    `;

    card.innerHTML = `
      <div class="card-header" style="${opts.headerBg ? `background:${opts.headerBg}` : ''}">
        <span class="lock-btn" title="Заблокировать">🔓</span>
        <button class="header-color-picker-btn" title="Выбрать цвет заголовка"></button>
        <span class="card-title" contenteditable="true">${titleText}</span>
        <span class="close-btn" title="Удалить">×</span>
      </div>
      <div class="card-body ${opts.bodyClass || ''}">${bodyHTML}</div>
      <div class="connection-point top" data-side="top"></div>
      <div class="connection-point right" data-side="right"></div>
      <div class="connection-point bottom" data-side="bottom"></div>
      <div class="connection-point left" data-side="left"></div>
      
      <button class="card-control-btn body-color-changer" title="Сменить фон">🖌️</button>
      <div class="card-controls">
        <button class="card-control-btn note-btn" title="Заметка">📝</button>
        <div class="card-control-btn color-changer" data-color-index="${opts.colorIndex ?? 0}"></div>
      </div>
    `;

    canvas.appendChild(card);
    const cardData = { id: cardId, element: card, locked: !!opts.locked, note: opts.note || null };
    if (cardData.locked) card.classList.add('locked');

    cards.push(cardData);

    card.addEventListener('mousedown', (e) => {
      if (e.ctrlKey) { e.stopPropagation(); toggleCardSelection(cardData); }
    });
    card.querySelector('.close-btn').addEventListener('click', (e) => {
      e.stopPropagation(); deleteCard(cardData); saveState();
    });
    makeDraggable(card, cardData);

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
    
    const headerColorBtn = card.querySelector('.header-color-picker-btn');
    const header = card.querySelector('.card-header');

    headerColorBtn.style.background = getComputedStyle(header).background;

    const hiddenColorInput = document.createElement('input');
    hiddenColorInput.type = 'color';
    hiddenColorInput.style.display = 'none';
    card.appendChild(hiddenColorInput);
    
    headerColorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      hiddenColorInput.click();
    });
    hiddenColorInput.addEventListener('input', (e) => {
      const newColor = e.target.value;
      header.style.background = newColor;
      headerColorBtn.style.background = newColor;
      saveState();
    });

    const coin = card.querySelector('.coin-icon circle');
    if (coin) {
      coin.addEventListener('click', () => {
        coin.setAttribute('fill', coin.getAttribute('fill') === '#ffd700' ? '#3d85c6' : '#ffd700');
        saveState();
      });
    }

    const colorChanger = card.querySelector('.color-changer');
    const setHeaderColorByIndex = (idx) => {
      const newColor = cardColors[idx % cardColors.length];
      colorChanger.style.backgroundColor = newColor;
      header.style.background = newColor;
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
    
    const bodyColorChanger = card.querySelector('.body-color-changer');
    bodyColorChanger.addEventListener('click', (e) => {
      e.stopPropagation();
      card.classList.toggle('dark-mode');
      saveState();
    });
    const noteBtn = card.querySelector('.note-btn');
    if (cardData.note && cardData.note.text) {
      noteBtn.classList.add('has-text');
      noteBtn.textContent = '❗';
    }
    noteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleNote(cardData);
    });
    if (cardData.note && cardData.note.visible) {
      createNoteWindow(cardData);
    }

    card.querySelectorAll('[contenteditable="true"]').forEach(el => {
      el.addEventListener('blur', () => saveState());
    });

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
      if (e.button !== 0 || e.ctrlKey || activeState.isSelectionMode) return;
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
          card: selectedCard,
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

          if (dragged.card.note && dragged.card.note.window) {
            const noteDx = (snappedX - dragged.startX);
            const noteDy = (snappedY - dragged.startY);
            dragged.card.note.x += noteDx;
            dragged.card.note.y += noteDy;
            dragged.card.note.window.style.left = `${dragged.card.note.x}px`;
            dragged.card.note.window.style.top = `${dragged.card.note.y}px`;
          }
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
    activeState.previewLine.setAttribute('marker-end', 'url(#marker-dot)'); 
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
      thickness: activeState.currentThickness,
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
    if (!thicknessSlider || !thicknessValue) return;

    const updateTrack = (val, slider) => {
      const min = Number(slider.min || 0);
      const max = Number(slider.max || 100);
      const percent = Math.round(((val - min) / (max - min)) * 100);
      slider.style.background = `linear-gradient(90deg,#42e695 0%, #3bb2b8 ${percent}%, #e0e0e0 ${percent}%)`;
    };

    thicknessValue.textContent = thicknessSlider.value;
    updateTrack(thicknessSlider.value, thicknessSlider);

    thicknessSlider.addEventListener('input', (e) => {
      const newThickness = Number(e.target.value);
      activeState.currentThickness = newThickness;
      thicknessValue.textContent = String(newThickness);
      updateTrack(newThickness, thicknessSlider);

      if (activeState.selectedLine) {
        activeState.selectedLine.thickness = newThickness;
        activeState.selectedLine.element.setAttribute('stroke-width', newThickness);
        saveState();
      }
    });
  }

  // ==== Palette ====
  function setupPalette() {
    if (!lineColorPicker) return;
    lineColorPicker.addEventListener('input', (e) => {
      activeState.currentColor = e.target.value;
      if (activeState.selectedLine) {
        activeState.selectedLine.color = activeState.currentColor;
        activeState.selectedLine.element.setAttribute('stroke', activeState.currentColor);
        activeState.selectedLine.element.style.setProperty('--line-color', activeState.currentColor);
        saveState();
      }
    });
  }

  // ==== Gradient background ====
  function setupGradientSelector() {
    if (!gradientSelector) return;
    gradientSelector.querySelectorAll('.grad-btn').forEach(btn => {
      if (btn.dataset.gradient && btn.dataset.gradient !== '#ffffff') {
        btn.style.background = btn.dataset.gradient;
      } else {
        btn.style.background = '#ffffff';
        btn.style.border = '1px solid #ddd';
      }
      btn.addEventListener('click', () => {
        document.body.style.background = btn.dataset.gradient;
      });
    });
  }

  // ==== Notes ====
  function toggleNote(cardData) {
    if (cardData.note && cardData.note.window) {
      cardData.note.window.remove();
      cardData.note.window = null;
      cardData.note.visible = false;
    } else {
      if (!cardData.note) {
        const cardRect = cardData.element.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        cardData.note = {
          text: '',
          x: (cardRect.right - canvasRect.left) / canvasState.scale + 20,
          y: (cardRect.top - canvasRect.top) / canvasState.scale,
          width: 220,
          height: 150,
          visible: false,
          window: null
        };
      }
      cardData.note.visible = true;
      createNoteWindow(cardData);
    }
    saveState();
  }

  function createNoteWindow(cardData) {
    const note = cardData.note;
    const noteWindow = document.createElement('div');
    noteWindow.className = 'note-window';
    noteWindow.style.left = `${note.x}px`;
    noteWindow.style.top = `${note.y}px`;
    noteWindow.style.width = `${note.width}px`;
    noteWindow.style.height = `${note.height}px`;

    noteWindow.innerHTML = `
        <div class="note-header">
            <span class="note-close-btn">×</span>
        </div>
        <textarea class="note-textarea" placeholder="Введите текст..."></textarea>
        <div class="note-resize-handle"></div>
    `;
    canvas.appendChild(noteWindow);
    note.window = noteWindow;

    const textarea = noteWindow.querySelector('.note-textarea');
    textarea.value = note.text;
    const noteBtn = cardData.element.querySelector('.note-btn');

    textarea.addEventListener('input', () => {
      note.text = textarea.value;
      if (note.text) {
        noteBtn.classList.add('has-text');
        noteBtn.textContent = '❗';
      } else {
        noteBtn.classList.remove('has-text');
        noteBtn.textContent = '📝';
      }
    });
    textarea.addEventListener('blur', saveState);

    noteWindow.querySelector('.note-close-btn').addEventListener('click', () => {
      note.visible = false;
      noteWindow.remove();
      note.window = null;
      saveState();
    });

    makeMovable(noteWindow, note);
    makeResizable(noteWindow, note);
    return noteWindow;
  }
  
  function makeMovable(element, data) {
    const header = element.querySelector('.note-header');
    header.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      
      function onMove(e2) {
        const dx = (e2.clientX - startX) / canvasState.scale;
        const dy = (e2.clientY - startY) / canvasState.scale;
        data.x += dx;
        data.y += dy;
        element.style.left = `${data.x}px`;
        element.style.top = `${data.y}px`;
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        saveState();
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function makeResizable(element, data) {
    const handle = element.querySelector('.note-resize-handle');
    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = data.width;
      const startH = data.height;

      function onMove(e2) {
        const dw = (e2.clientX - startX) / canvasState.scale;
        const dh = (e2.clientY - startY) / canvasState.scale;
        data.width = Math.max(150, startW + dw);
        data.height = Math.max(100, startH + dh);
        element.style.width = `${data.width}px`;
        element.style.height = `${data.height}px`;
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        saveState();
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
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
    if (cardData.note && cardData.note.window) cardData.note.window.remove();
    cardData.element.remove();
    cards = cards.filter(c => c.id !== cardData.id);
    activeState.selectedCards.delete(cardData);
  }

  function deleteLine(lineData) {
    lineData.element.remove();
    lines = lines.filter(l => l.id !== lineData.id);
    if (activeState.selectedLine && activeState.selectedLine.id === lineData.id) {
      activeState.selectedLine = null;
    }
  }

  function deleteSelection() {
    let changed = false;
    if (activeState.selectedCards.size > 0) {
      activeState.selectedCards.forEach(cardData => deleteCard(cardData));
      changed = true;
    }
    if (activeState.selectedLine) {
      deleteLine(activeState.selectedLine);
      changed = true;
    }
    if (changed) saveState();
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
    clearSelection();
    activeState.selectedLine = lineData;
    lineData.element.classList.add('selected');
    if (lineColorPicker) lineColorPicker.value = lineData.color;
    if (thicknessSlider) thicknessSlider.value = lineData.thickness;
    if (thicknessValue) thicknessValue.textContent = lineData.thickness;
  }

  function toggleCardSelection(cardData) {
    if (activeState.selectedCards.has(cardData)) {
      activeState.selectedCards.delete(cardData);
      cardData.element.classList.remove('selected');
    } else {
      if (activeState.selectedLine) {
        activeState.selectedLine.element.classList.remove('selected');
        activeState.selectedLine = null;
      }
      activeState.selectedCards.add(cardData);
      cardData.element.classList.add('selected');
    }
  }

  function setSelectionSet(newSet) {
    activeState.selectedCards.forEach(card => card.element.classList.remove('selected'));
    activeState.selectedCards.clear();
    newSet.forEach(cd => {
      activeState.selectedCards.add(cd);
      cd.element.classList.add('selected');
    });
  }

  function clearSelection() {
    activeState.selectedCards.forEach(card => card.element.classList.remove('selected'));
    activeState.selectedCards.clear();
  }

  // ==== Marquee selection ====
  let selectionBox = null;
  let marqueeStart = { x: 0, y: 0 };
  let baseSelection = null; 

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
    selectionBox.style.display = 'block';
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
      selectionBox.style.display = 'none';
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
  
  // ==== Загрузка шаблона ====
  function loadTemplate() {
    const templateCards = [
      { key: 'lena', x: 1050, y: -140, title: 'ЛЕНА', pv: '330/330pv', coinFill: '#ffd700' },
      { key: 'a', x: 630, y: 210, title: 'A', pv: '30/30pv', coinFill: '#3d85c6' },
      { key: 'b', x: 1470, y: 210, title: 'B', pv: '30/30pv', coinFill: '#3d85c6' },
      { key: 'c', x: 420, y: 560, title: 'C', pv: '30/30pv', coinFill: '#3d85c6' },
      { key: 'd', x: 840, y: 560, title: 'D', pv: '30/30pv', coinFill: '#3d85c6' },
      { key: 'e', x: 1260, y: 560, title: 'E', pv: '30/30pv', coinFill: '#3d85c6' },
      { key: 'f', x: 1680, y: 560, title: 'F', pv: '30/30pv', coinFill: '#3d85c6' },
    ];

    const templateLines = [
      { startKey: 'lena', startSide: 'left', endKey: 'a', endSide: 'top', thickness: 5 },
      { startKey: 'lena', startSide: 'right', endKey: 'b', endSide: 'top', thickness: 5 },
      { startKey: 'a', startSide: 'left', endKey: 'c', endSide: 'top', thickness: 3 },
      { startKey: 'a', startSide: 'right', endKey: 'd', endSide: 'top', thickness: 3 },
      { startKey: 'b', startSide: 'left', endKey: 'e', endSide: 'top', thickness: 3 },
      { startKey: 'b', startSide: 'right', endKey: 'f', endSide: 'top', thickness: 3 },
    ];
      
    const CARD_WIDTH = 380;
    const CARD_HEIGHT = 280;
    const PADDING = 50;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    templateCards.forEach(c => {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + CARD_WIDTH);
      maxY = Math.max(maxY, c.y + CARD_HEIGHT);
    });
    const templateWidth = maxX - minX;
    const templateHeight = maxY - minY;

    const canvasViewLeft = -canvasState.x / canvasState.scale;
    const canvasViewTop = -canvasState.y / canvasState.scale;
    const canvasViewRight = (window.innerWidth - canvasState.x) / canvasState.scale;
    const canvasViewBottom = (window.innerHeight - canvasState.y) / canvasState.scale;

    const desiredTargetX = canvasViewRight - templateWidth - PADDING;
    const desiredTargetY = canvasViewBottom - templateHeight - PADDING;

    const targetX = Math.max(canvasViewLeft + PADDING, desiredTargetX);
    const targetY = Math.max(canvasViewTop + PADDING, desiredTargetY);

    const offsetX = targetX - minX;
    const offsetY = targetY - minY;

    const createdCardsMap = new Map();

    templateCards.forEach(cardDef => {
      const bodyHTML = `
        <div class="card-row">
          <svg class="coin-icon" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="45" fill="${cardDef.coinFill}" stroke="#DAA520" stroke-width="5"/>
          </svg>
          <span class="value" contenteditable="true">${cardDef.pv}</span>
        </div>
        <div class="card-row"><span class="label">Баланс:</span><span class="value" contenteditable="true">0 / 0</span></div>
        <div class="card-row"><span class="label">Актив-заказы PV:</span><span class="value" contenteditable="true">0 / 0</span></div>
        <div class="card-row"><span class="label">Цикл:</span><span class="value" contenteditable="true">0</span></div>
      `;
      const cardData = createCard({
        x: cardDef.x + offsetX,
        y: cardDef.y + offsetY,
        title: cardDef.title,
        bodyHTML: bodyHTML,
        headerBg: 'rgb(93, 139, 244)',
        colorIndex: 0,
        isTemplate: true
      });
      createdCardsMap.set(cardDef.key, cardData);
    });

    templateLines.forEach(lineDef => {
      const startCard = createdCardsMap.get(lineDef.startKey);
      const endCard = createdCardsMap.get(lineDef.endKey);
      if (!startCard || !endCard) return;

      const lineElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      lineElement.setAttribute('class', 'line');
      const color = '#3d85c6';
      const thickness = lineDef.thickness;
      lineElement.setAttribute('stroke', color);
      lineElement.setAttribute('stroke-width', thickness);
      lineElement.style.setProperty('--line-color', color);
      lineElement.setAttribute('marker-start', 'url(#marker-dot)');
      lineElement.setAttribute('marker-end', 'url(#marker-dot)');
      svgLayer.appendChild(lineElement);

      const lineData = {
        id: `line_${Date.now()}_${Math.floor(Math.random()*1000)}`,
        startCard: startCard,
        startSide: lineDef.startSide,
        endCard: endCard,
        endSide: lineDef.endSide,
        color: color,
        thickness: thickness,
        element: lineElement
      };
      lines.push(lineData);
      lineElement.addEventListener('click', (e) => { e.stopPropagation(); selectLine(lineData); });
    });

    updateAllLines();
    saveState();
  }

  // ==== История (Undo/Redo) ====
  function setupHistoryButtons() {
    if (undoBtn) undoBtn.addEventListener('click', undo);
    if (redoBtn) redoBtn.addEventListener('click', redo);
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
        isDarkMode: c.element.classList.contains('dark-mode'),
        bodyClass: c.element.querySelector('.card-body')?.className.replace('card-body', '').trim() ?? '',
        headerBg: c.element.querySelector('.card-header')?.style.background ?? '',
        colorIndex: parseInt(c.element.querySelector('.color-changer')?.dataset.colorIndex || '0', 10),
        note: c.note ? { ...c.note, window: null } : null
      })),
      lines: lines.map(l => ({
        startId: l.startCard.id,
        startSide: l.startSide,
        endId: l.endCard.id,
        endSide: l.endSide,
        color: l.color,
        thickness: l.thickness
      }))
    };
  }

  function loadState(state, pushHistory = false) {
    lines.forEach(l => l.element.remove());
    lines = [];
    cards.forEach(c => {
      if (c.note && c.note.window) c.note.window.remove();
      c.element.remove();
    });
    cards = [];
    activeState.selectedCards.clear();
    activeState.selectedLine = null;

    const idMap = new Map();
    state.cards.forEach(cd => {
      const cardData = createCard({
        x: cd.x, y: cd.y, locked: cd.locked,
        title: cd.title, bodyHTML: cd.bodyHTML,
        headerBg: cd.headerBg, colorIndex: cd.colorIndex,
        bodyClass: cd.bodyClass, note: cd.note,
        isDarkMode: cd.isDarkMode,
        isTemplate: true
      });
      idMap.set(cd.id, cardData);
    });

    state.lines.forEach(ld => {
      const startCard = idMap.get(ld.startId);
      const endCard = idMap.get(ld.endId);
      if (!startCard || !endCard) return;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'line');
      path.setAttribute('stroke', ld.color);
      path.setAttribute('stroke-width', ld.thickness);
      path.style.setProperty('--line-color', ld.color);
      path.setAttribute('marker-start', 'url(#marker-dot)');
      path.setAttribute('marker-end', 'url(#marker-dot)');
      svgLayer.appendChild(path);

      const lineData = {
        id: `line_${Date.now()}_${Math.floor(Math.random()*1000)}`,
        startCard, startSide: ld.startSide,
        endCard,   endSide: ld.endSide,
        color: ld.color, thickness: ld.thickness, element: path
      };
      lines.push(lineData);
      path.addEventListener('click', (e) => { e.stopPropagation(); selectLine(lineData); });
      const p1 = getPointCoords(startCard, ld.startSide);
      const p2 = getPointCoords(endCard, ld.endSide);
      updateLinePath(path, p1, p2, ld.startSide, ld.endSide);
    });

    if (pushHistory) saveState();
  }

  function saveState() {
    const snapshot = serializeState();
    if (undoStack.length === 0 && cards.length === 0 && lines.length === 0) return;
    undoStack.push(JSON.stringify(snapshot));
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack = [];
  }

  function undo() {
    if (undoStack.length < 2) return;
    const current = undoStack.pop();
    redoStack.push(current);
    const prev = JSON.parse(undoStack[undoStack.length - 1]);
    loadState(prev, false);
  }

  function redo() {
    if (redoStack.length === 0) return;
    const snapshot = redoStack.pop();
    undoStack.push(snapshot);
    loadState(JSON.parse(snapshot), false);
  }

  // ==== Copy / Paste ====
  function copySelection() {
    if (activeState.selectedCards.size === 0) return;
    const selectedIds = new Set([...activeState.selectedCards].map(c => c.id));

    const copiedCards = [];
    activeState.selectedCards.forEach(cd => {
      const state = serializeState().cards.find(c => c.id === cd.id);
      if (state) copiedCards.push(state);
    });

    const copiedLines = [];
    lines.forEach(l => {
      if (selectedIds.has(l.startCard.id) && selectedIds.has(l.endCard.id)) {
        copiedLines.push({
          startId: l.startCard.id, startSide: l.startSide,
          endId: l.endCard.id, endSide: l.endSide,
          color: l.color, thickness: l.thickness
        });
      }
    });
    clipboard = { cards: copiedCards, lines: copiedLines };
  }

  function pasteSelection() {
    if (!clipboard || !clipboard.cards || clipboard.cards.length === 0) return;

    const OFFSET = 40;
    const idMap = new Map();
    const newSelection = new Set();
    
    clipboard.cards.forEach(cd => {
      const newCard = createCard({
        ...cd,
        x: cd.x + OFFSET,
        y: cd.y + OFFSET,
        note: cd.note ? { ...cd.note, x: cd.note.x + OFFSET, y: cd.note.y + OFFSET, visible: false } : null,
      });
      idMap.set(cd.id, newCard);
      newSelection.add(newCard);
    });
    setSelectionSet(newSelection);

    setTimeout(() => {
      clipboard.lines.forEach(ld => {
        const startCard = idMap.get(ld.startId);
        const endCard = idMap.get(ld.endId);
        if (!startCard || !endCard) return;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'line');
        path.setAttribute('stroke', ld.color);
        path.setAttribute('stroke-width', ld.thickness);
        path.style.setProperty('--line-color', ld.color);
        path.setAttribute('marker-start', 'url(#marker-dot)');
        path.setAttribute('marker-end', 'url(#marker-dot)');
        svgLayer.appendChild(path);

        const lineData = {
          id: `line_${Date.now()}_${Math.floor(Math.random()*1000)}`,
          startCard, startSide: ld.startSide,
          endCard,   endSide: ld.endSide,
          color: ld.color, thickness: ld.thickness, element: path
        };
        lines.push(lineData);
        path.addEventListener('click', (e) => { e.stopPropagation(); selectLine(lineData); });
        const p1 = getPointCoords(startCard, ld.startSide);
        const p2 = getPointCoords(endCard, ld.endSide);
        updateLinePath(path, p1, p2, ld.startSide, ld.endSide);
      });
      saveState();
    }, 0);
  }
  
  // ==== Сохранение и Экспорт ====
  function setupSaveButtons() {
    if (saveProjectBtn) {
      saveProjectBtn.addEventListener('click', () => {
        const data = serializeState();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `project-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    // Загрузка JSON
    if (loadProjectBtn && loadProjectInput) {
      loadProjectBtn.addEventListener('click', () => loadProjectInput.click());
      loadProjectInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const state = JSON.parse(text);
          loadState(state, true);
        } catch (err) {
          console.error('Не удалось загрузить JSON:', err);
          alert('Файл повреждён или имеет неверный формат JSON.');
        } finally {
          loadProjectInput.value = '';
        }
      });
    }

    // Экспорт HTML с fallback
if (exportHtmlBtn) {
  exportHtmlBtn.addEventListener('click', () => {
    const bodyStyle = getComputedStyle(document.body);

    const viewOnlyScript = `
      <script>
      document.addEventListener('DOMContentLoaded', () => {
        const canvas = document.getElementById('canvas');
        let isPanning=false,lastMouseX=0,lastMouseY=0;
        let x=${canvasState.x},y=${canvasState.y},scale=${canvasState.scale};
        function updateTransform(){canvas.style.transform=\`translate(\${x}px,\${y}px) scale(\${scale})\`;}
        window.addEventListener('mousedown',e=>{if(e.button===1){isPanning=true;lastMouseX=e.clientX;lastMouseY=e.clientY;document.body.style.cursor='move';}});
        window.addEventListener('mousemove',e=>{if(isPanning){const dx=e.clientX-lastMouseX,dy=e.clientY-lastMouseY;x+=dx;y+=dy;lastMouseX=e.clientX;lastMouseY=e.clientY;updateTransform();}});
        window.addEventListener('mouseup',e=>{if(e.button===1){isPanning=false;document.body.style.cursor='default';}});
        window.addEventListener('wheel',e=>{e.preventDefault();const s=-e.deltaY*0.001;const ns=Math.max(0.1,Math.min(5,scale+s));const mx=e.clientX,my=e.clientY;x=mx-(mx-x)*(ns/scale);y=my-(my-y)*(ns/scale);scale=ns;updateTransform();},{passive:false});
        updateTransform();
      });
      <\/script>
    `;

    const canvasClone = canvas.cloneNode(true);

    // 1) НЕ удаляем элементы шапки/низов, иначе ломается сетка.
    // Удаляем только элементы окна заметок:
    // удаляем ТОЛЬКО элементы окна заметок
canvasClone.querySelectorAll('.note-resize-handle, .note-close-btn').forEach(el => el.remove());

// отключаем клики у UI-элементов (чтобы сохранить верстку, но сделать «только просмотр»)
canvasClone
  .querySelectorAll('[contenteditable], .card-controls, .close-btn, .lock-btn, .header-color-picker-btn, .body-color-changer, .connection-point')
  .forEach(el => {
    if (el.hasAttribute('contenteditable')) el.setAttribute('contenteditable','false');
    el.style.pointerEvents = 'none';
  });


    // 2) Отключаем взаимодействие с UI-элементами в просмотре:
    canvasClone.querySelectorAll('[contenteditable]').forEach(el => el.setAttribute('contenteditable','false'));
    canvasClone
      .querySelectorAll('.card-controls, .close-btn, .lock-btn, .header-color-picker-btn, .body-color-changer, .connection-point')
      .forEach(el => { el.style.pointerEvents = 'none'; });

    const buildAndDownload = (cssText) => {
      const htmlContent = `
        <!DOCTYPE html>
        <html lang="ru">
        <head>
          <meta charset="UTF-8">
          <title>Просмотр Схемы</title>
          <style>
            ${cssText}
            body{overflow:hidden}
            .card:hover{transform:none;box-shadow:0 8px 20px rgba(0,0,0,.15)}
            .card.selected{box-shadow:0 8px 20px rgba(0,0,0,.15)}
          </style>
        </head>
        <body style="background:${bodyStyle.background};">
          ${canvasClone.outerHTML}
          ${viewOnlyScript}
        </body>
        </html>`;
      const blob = new Blob([htmlContent], {type:'text/html'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `scheme-${Date.now()}.html`; a.click();
      URL.revokeObjectURL(url);
    };

    // Пробуем подтянуть реальный style.css. Если не вышло (file://) — включаем fallback.
    fetch('style.css')
      .then(r => r.ok ? r.text() : Promise.reject())
      .then(cssText => buildAndDownload(cssText))
      .catch(() => {
        const minimalCss = `
  /* База */
  html,body{margin:0;height:100%}
  body{font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;}
  #canvas{position:relative;width:100%;height:100%;transform-origin:0 0}
  #svg-layer{position:absolute;inset:0;pointer-events:none;overflow:visible}

  /* Линии */
  .line{fill:none;pointer-events:auto;cursor:pointer;color:var(--line-color,#3d85c6);
        stroke:currentColor;stroke-linecap:round}

  /* Карточка */
  .card{position:absolute;width:380px;background:#fff;border-radius:20px;
        box-shadow:0 8px 20px rgba(0,0,0,.15);overflow:hidden}
  .card-header{background:#4facfe;color:#fff;height:52px;padding:10px 12px;
               display:grid;grid-template-columns:28px 28px 1fr 28px 28px;
               align-items:center;gap:6px;border-radius:20px 20px 0 0}
  .card-title{
    grid-column:3/4;
    display:flex;align-items:center;justify-content:center;
    font-weight:700;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis
  }
  .card-body{padding:14px 16px;background:#fff;border-radius:0 0 20px 20px}

  /* Ряды */
  .card-row{display:flex;align-items:center;gap:10px;margin:8px 0}
  .label{color:#6b7280;font-weight:600;margin-right:6px}
  .value{color:#111827;display:inline-flex;align-items:center;line-height:1.2}

  /* Монетка (можешь уменьшить до 72px при желании) */
  .coin-icon{width:80px;height:80px;flex:0 0 auto;display:block}
  .coin-icon circle{vector-effect:non-scaling-stroke}

  /* Кнопки — вид сохраняем, клики отключили выше */
  .header-color-picker-btn{width:20px;height:20px;border:none;border-radius:6px;
                           box-shadow:inset 0 0 0 2px rgba(255,255,255,.65)}
  .lock-btn,.close-btn{font-size:16px;line-height:1;text-align:center}
  .card-controls{position:absolute;right:10px;bottom:10px;display:flex;gap:8px}
  .card-control-btn{width:26px;height:26px;border-radius:10px;border:none;
                    box-shadow:0 2px 6px rgba(0,0,0,.15);display:inline-flex;
                    align-items:center;justify-content:center}

  /* Точки соединения — «как в приложении», меньше и с белой обводкой */
  .connection-point{
    position:absolute;width:12px;height:12px;          /* было 16px */
    background:#000;border-radius:50%;
    border:2px solid #fff;                             /* было 3px */
    transform:translate(-50%,-50%);
    box-shadow:0 2px 6px rgba(0,0,0,.25)
  }
  .connection-point.top{left:50%;top:0}
  .connection-point.bottom{left:50%;top:100%}
  .connection-point.left{left:0;top:50%}
  .connection-point.right{left:100%;top:50%}
`;


        buildAndDownload(minimalCss);
      });
  });
}

  }

  saveState();
});

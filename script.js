// ============== НАЧАЛО ФИНАЛЬНОЙ ВЕРСИИ SCRIPT.JS ==============
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('canvas');
  const svgLayer = document.getElementById('svg-layer');
  const addCardBtn = document.getElementById('add-card-btn');
  const addLargeCardBtn = document.getElementById('add-large-card-btn');
  const addTemplateBtn = document.getElementById('add-template-btn');
  const gradientSelector = document.getElementById('gradient-selector');
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  const loadProjectBtn = document.getElementById('load-project-btn');
  const loadProjectInput = document.getElementById('load-project-input');
  const selectionModeBtn = document.getElementById('selection-mode-btn');
  const saveProjectBtn = document.getElementById('save-project-btn');
  const exportHtmlBtn = document.getElementById('export-html-btn');
  const notesListBtn = document.getElementById('notes-list-btn');
  const preparePrintBtn = document.getElementById('prepare-print-btn');

  const thicknessSlider = document.getElementById('thickness-slider');
  const thicknessValue = document.getElementById('thickness-value');
  const lineColorTrigger = document.getElementById('line-color-trigger');
  const hiddenLineColorPicker = document.getElementById('hidden-line-color-picker');
  const applyAllToggle = document.getElementById('apply-all-toggle');

  const GRID_SIZE = 70;
  const MARKER_OFFSET = 12;
  const HISTORY_LIMIT = 50;

  let canvasState = { x: 0, y: 0, scale: 1, isPanning: false, lastMouseX: 0, lastMouseY: 0 };
  let activeState = {
    currentColor: '#0f62fe',
    currentThickness: 5,
    selectedLine: null,
    selectedCards: new Set(),
    isDrawingLine: false,
    isSelecting: false,
    isSelectionMode: false,
    isGlobalLineMode: false,
    lineStart: null,
    previewLine: null
  };
  let cards = [];
  let lines = [];
  const cardColors = ['#5D8BF4', '#38A3A5', '#E87A5D', '#595959'];

  let undoStack = [];
  let redoStack = [];
  let clipboard = null;

  if (!canvas || !svgLayer) return;

  if (addCardBtn) addCardBtn.addEventListener('click', () => { createCard(); saveState(); });
  if (addLargeCardBtn) addLargeCardBtn.addEventListener('click', () => { createCard({ isLarge: true }); saveState(); });
  if (addTemplateBtn) addTemplateBtn.addEventListener('click', loadTemplate);
  if (preparePrintBtn) preparePrintBtn.addEventListener('click', prepareForPrint);

  setupLineControls();
  setupGlobalEventListeners();
  setupGradientSelector();
  setupHistoryButtons();
  setupSelectionMode();
  setupSaveButtons();
  setupNotesDropdown();
  setupNoteAutoClose();

  const numPop = document.createElement('div');
  numPop.className = 'num-color-pop';
  numPop.innerHTML = `
    <div class="dot red"    data-color="#e53935" title="Красный"></div>
    <div class="dot yellow" data-color="#ffeb3b" title="Жёлтый"></div>
    <div class="dot green"  data-color="#43a047" title="Зелёный"></div>
  `;
  document.body.appendChild(numPop);
  let lastRange = null;

  function showNumPop() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return hideNumPop();
    const range = sel.getRangeAt(0);
    const common = range.commonAncestorContainer;
    const valueEl = (common.nodeType === 1 ? common : common.parentElement)?.closest('.value[contenteditable="true"]');
    if (!valueEl || sel.isCollapsed) { hideNumPop(); return; }
    const rect = range.getBoundingClientRect();
    numPop.style.left = `${Math.max(8, rect.left)}px`;
    numPop.style.top  = `${rect.bottom + 6}px`;
    numPop.style.display = 'flex';
    lastRange = range;
  }
  function hideNumPop(){ numPop.style.display='none'; lastRange = null; }
  document.addEventListener('selectionchange', () => requestAnimationFrame(showNumPop));
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.num-color-pop') && !e.target.closest('.value[contenteditable="true"]')) hideNumPop();
  });
  numPop.addEventListener('click', (e) => {
    const btn = e.target.closest('.dot');
    if (!btn || !lastRange) return;
    const color = btn.dataset.color;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(lastRange);
    const span = document.createElement('span');
    span.setAttribute('data-num-color', color);
    span.style.color = color;
    try { lastRange.surroundContents(span); }
    catch(_) { const frag = lastRange.extractContents(); span.appendChild(frag); lastRange.insertNode(span); }
    hideNumPop(); saveState();
  });

  function setupGlobalEventListeners() {
    window.addEventListener('mousedown', (e) => {
      if (
        e.target.closest('.ui-panel-left') ||
        e.target.closest('.ui-panel-right') ||
        e.target.closest('.note-window')
      ) return;

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
        if (activeState.isSelectionMode) startMarqueeSelection(e);
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (canvasState.isPanning) {
        const dx = e.clientX - canvasState.lastMouseX;
        const dy = e.clientY - canvasState.lastMouseY;
        canvasState.x += dx; canvasState.y += dy;
        canvasState.lastMouseX = e.clientX; canvasState.lastMouseY = e.clientY;
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
      if (e.button === 1) { canvasState.isPanning = false; document.body.style.cursor = 'default'; }
      if (e.button === 0 && activeState.isSelecting) endMarqueeSelection(e);
    });

    window.addEventListener('wheel', (e) => {
      if (e.target.closest('.ui-panel-left') || e.target.closest('.ui-panel-right')) return;
      e.preventDefault();
      const scaleAmount = -e.deltaY * 0.001;
      const newScale = Math.max(0.1, Math.min(3, canvasState.scale + scaleAmount));
      const mouseX = e.clientX, mouseY = e.clientY;
      canvasState.x = mouseX - (mouseX - canvasState.x) * (newScale / canvasState.scale);
      canvasState.y = mouseY - (mouseY - canvasState.y) * (newScale / canvasState.scale);
      canvasState.scale = newScale;
      updateCanvasTransform();
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.target.isContentEditable || ['TEXTAREA','INPUT'].includes(e.target.tagName)) return;

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
      else if ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z') || (e.ctrlKey && e.key.toLowerCase() === 'y')) { e.preventDefault(); redo(); }

      if (e.ctrlKey && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); }
      if (e.ctrlKey && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteSelection(); }
    });
  }

  function setupSelectionMode() {
    if (!selectionModeBtn) return;
    selectionModeBtn.addEventListener('click', () => {
      activeState.isSelectionMode = !activeState.isSelectionMode;
      selectionModeBtn.classList.toggle('active', activeState.isSelectionMode);
      document.body.style.cursor = activeState.isSelectionMode ? 'crosshair' : 'default';
    });
  }

  function setupLineControls() {
    if (!thicknessSlider || !lineColorTrigger || !hiddenLineColorPicker || !applyAllToggle) return;
    
    lineColorTrigger.style.backgroundColor = activeState.currentColor;
    hiddenLineColorPicker.value = activeState.currentColor;
    thicknessValue.textContent = activeState.currentThickness;
    thicknessSlider.value = activeState.currentThickness;

    const updateSliderTrack = (val) => {
        const min = Number(thicknessSlider.min), max = Number(thicknessSlider.max);
        const percent = Math.round(((val - min) / (max - min)) * 100);
        thicknessSlider.style.background = `linear-gradient(90deg, ${activeState.currentColor} 0%, ${activeState.currentColor} ${percent}%, #e5e7eb ${percent}%)`;
        thicknessSlider.style.setProperty('--brand', activeState.currentColor);
    };
    updateSliderTrack(activeState.currentThickness);

    applyAllToggle.addEventListener('click', () => {
      activeState.isGlobalLineMode = !activeState.isGlobalLineMode;
      applyAllToggle.classList.toggle('active', activeState.isGlobalLineMode);
    });

    lineColorTrigger.addEventListener('click', () => hiddenLineColorPicker.click());
    hiddenLineColorPicker.addEventListener('input', (e) => {
      const newColor = e.target.value;
      activeState.currentColor = newColor;
      lineColorTrigger.style.backgroundColor = newColor;
      updateSliderTrack(thicknessSlider.value);

      if (activeState.isGlobalLineMode) {
        lines.forEach(line => {
          line.color = newColor;
          line.element.setAttribute('stroke', newColor);
          line.element.style.setProperty('--line-color', newColor);
        });
      } else if (activeState.selectedLine) {
        activeState.selectedLine.color = newColor;
        activeState.selectedLine.element.setAttribute('stroke', newColor);
        activeState.selectedLine.element.style.setProperty('--line-color', newColor);
      }
      saveState();
    });

    thicknessSlider.addEventListener('input', (e) => {
      const newThickness = Number(e.target.value);
      activeState.currentThickness = newThickness;
      thicknessValue.textContent = newThickness;
      updateSliderTrack(newThickness);

      if (activeState.isGlobalLineMode) {
        lines.forEach(line => {
          line.thickness = newThickness;
          line.element.setAttribute('stroke-width', newThickness);
        });
      } else if (activeState.selectedLine) {
        activeState.selectedLine.thickness = newThickness;
        activeState.selectedLine.element.setAttribute('stroke-width', newThickness);
      }
    });
    thicknessSlider.addEventListener('change', saveState);
  }

  function updateCanvasTransform() {
    canvas.style.transform = `translate(${canvasState.x}px, ${canvasState.y}px) scale(${canvasState.scale})`;
  }

  function createCard(opts = {}) {
    const cardId = `card_${Date.now()}_${Math.floor(Math.random()*1000)}`;
    const card = document.createElement('div');
    card.className = 'card'; card.id = cardId;
    if (opts.isDarkMode) card.classList.add('dark-mode');

    if (opts.isLarge) {
        card.style.width = '475px';
    } else if (opts.width) {
        card.style.width = opts.width;
    }

    const CARD_WIDTH = card.offsetWidth || 380, CARD_HEIGHT = 280, PADDING = 50;
    let initialX, initialY;

    if (opts.x != null) { initialX = opts.x; initialY = opts.y; }
    else {
      const viewL = -canvasState.x / canvasState.scale;
      const viewT = -canvasState.y / canvasState.scale;
      const viewR = (window.innerWidth - canvasState.x) / canvasState.scale;
      const viewB = (window.innerHeight - canvasState.y) / canvasState.scale;
      initialX = Math.max(viewL + PADDING, viewR - CARD_WIDTH  - PADDING);
      initialY = Math.max(viewT + PADDING, viewB - CARD_HEIGHT - PADDING);
    }

    if (opts.isTemplate) { card.style.left = `${initialX}px`; card.style.top = `${initialY}px`; }
    else { card.style.left = `${Math.round(initialX / GRID_SIZE) * GRID_SIZE}px`; card.style.top = `${Math.round(initialY / GRID_SIZE) * GRID_SIZE}px`; }

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

    card.addEventListener('mousedown', (e) => { if (e.ctrlKey) { e.stopPropagation(); toggleCardSelection(cardData); } });
    card.querySelector('.close-btn').addEventListener('click', (e) => { e.stopPropagation(); deleteCard(cardData); saveState(); });
    makeDraggable(card, cardData);

    const lockBtn = card.querySelector('.lock-btn');
    lockBtn.textContent = cardData.locked ? '🔒' : '🔓';
    lockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      cardData.locked = !cardData.locked;
      lockBtn.textContent = cardData.locked ? '🔒' : '🔓';
      card.classList.toggle('locked', cardData.locked);
      card.querySelectorAll('[contenteditable]').forEach(el => el.setAttribute('contenteditable', cardData.locked ? 'false' : 'true'));
      saveState();
    });

    const headerColorBtn = card.querySelector('.header-color-picker-btn');
    const header = card.querySelector('.card-header');
    headerColorBtn.style.background = getComputedStyle(header).background;
    const hiddenColorInput = document.createElement('input');
    hiddenColorInput.type = 'color'; hiddenColorInput.style.display = 'none';
    card.appendChild(hiddenColorInput);
    headerColorBtn.addEventListener('click', (e) => { e.stopPropagation(); hiddenColorInput.click(); });
    hiddenColorInput.addEventListener('input', (e) => { const c = e.target.value; header.style.background = c; headerColorBtn.style.background = c; saveState(); });

    const coin = card.querySelector('.coin-icon circle');
    if (coin) coin.addEventListener('click', () => { coin.setAttribute('fill', coin.getAttribute('fill') === '#ffd700' ? '#3d85c6' : '#ffd700'); saveState(); });

    const colorChanger = card.querySelector('.color-changer');
    const setHeaderColorByIndex = (idx) => { const c = cardColors[idx % cardColors.length]; colorChanger.style.backgroundColor = c; header.style.background = c; };
    const startIndex = parseInt(colorChanger.dataset.colorIndex || '0', 10);
    setHeaderColorByIndex(startIndex);
    colorChanger.addEventListener('click', () => { let i = parseInt(colorChanger.dataset.colorIndex || '0', 10); i = (i + 1) % cardColors.length; colorChanger.dataset.colorIndex = String(i); setHeaderColorByIndex(i); saveState(); });

    const bodyColorChanger = card.querySelector('.body-color-changer');
    bodyColorChanger.addEventListener('click', (e) => { e.stopPropagation(); card.classList.toggle('dark-mode'); saveState(); });

    const noteBtn = card.querySelector('.note-btn');
    if (cardData.note && hasAnyEntry(cardData.note)) { noteBtn.classList.add('has-text'); noteBtn.textContent = '❗'; }
    noteBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleNote(cardData); updateNotesButtonState(); });
    if (cardData.note && cardData.note.visible) createNoteWindow(cardData);

    card.querySelectorAll('[contenteditable="true"]').forEach(el => el.addEventListener('blur', () => saveState()));

    card.querySelectorAll('.connection-point').forEach(point => {
      point.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (cardData.locked) return;
        if (!activeState.isDrawingLine) startDrawingLine(cardData, point.dataset.side);
        else { endDrawingLine(cardData, point.dataset.side); saveState(); }
      });
    });

    updateNotesButtonState();
    return cardData;
  }

  function makeDraggable(element, cardData) {
    const header = element.querySelector('.card-header');
    header.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.ctrlKey || activeState.isSelectionMode) return;
      if (cardData.locked) return;
      e.stopPropagation();

      if (!activeState.selectedCards.has(cardData)) { clearSelection(); toggleCardSelection(cardData); }

      const draggedCards = [];
      activeState.selectedCards.forEach(selectedCard => {
        if (selectedCard.locked) return;
        draggedCards.push({
          card: selectedCard,
          element: selectedCard.element,
          startX: parseFloat(selectedCard.element.style.left),
          startY: parseFloat(selectedCard.element.style.top),
          noteStartX: selectedCard.note ? selectedCard.note.x : 0,
          noteStartY: selectedCard.note ? selectedCard.note.y : 0
        });
      });

      const startMouseX = e.clientX, startMouseY = e.clientY;

      function onMouseMove(e2) {
        const dx = (e2.clientX - startMouseX) / canvasState.scale;
        const dy = (e2.clientY - startMouseY) / canvasState.scale;

        draggedCards.forEach(dragged => {
          const newX = dragged.startX + dx;
          const newY = dragged.startY + dy;
          const snappedX = Math.round(newX / GRID_SIZE) * GRID_SIZE;
          const snappedY = Math.round(newY / GRID_SIZE) * GRID_SIZE;

          dragged.element.style.left = `${snappedX}px`;
          dragged.element.style.top  = `${snappedY}px`;
          updateLinesForCard(dragged.element.id);

          if (dragged.card.note && dragged.card.note.window) {
            dragged.card.note.x = dragged.noteStartX + (snappedX - dragged.startX);
            dragged.card.note.y = dragged.noteStartY + (snappedY - dragged.startY);
            dragged.card.note.window.style.left = `${dragged.card.note.x}px`;
            dragged.card.note.window.style.top  = `${dragged.card.note.y}px`;
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

  function cancelDrawing() { if (activeState.previewLine) activeState.previewLine.remove(); activeState.isDrawingLine = false; activeState.lineStart = null; activeState.previewLine = null; }

  function updateLinePath(pathElement, p1, p2, side1, side2) {
    let finalP2 = { ...p2 }, midP1 = { ...p1 };
    if (side1 === 'left' || side1 === 'right') { midP1 = { x: p2.x, y: p1.y }; if (side2) finalP2.y = p2.y + (p2.y > p1.y ? -MARKER_OFFSET : MARKER_OFFSET); }
    else { midP1 = { x: p1.x, y: p2.y }; if (side2) finalP2.x = p2.x + (p2.x > p1.x ? -MARKER_OFFSET : MARKER_OFFSET); }
    pathElement.setAttribute('d', `M ${p1.x} ${p1.y} L ${midP1.x} ${midP1.y} L ${finalP2.x} ${finalP2.y}`);
  }

  function setupGradientSelector() {
    if (!gradientSelector) return;
    gradientSelector.querySelectorAll('.grad-btn').forEach(btn => {
      if (btn.dataset.gradient && btn.dataset.gradient !== '#ffffff') btn.style.background = btn.dataset.gradient;
      else { btn.style.background = '#ffffff'; btn.style.border = '1px solid #ddd'; }
      btn.addEventListener('click', () => { document.body.style.background = btn.dataset.gradient; });
    });
  }
  
  // Здесь должны быть все ваши функции для работы с заметками,
  // я их сократил, но они должны быть в вашем файле
  function hasAnyEntry(note) { return false; }
  function toggleNote(cardData) {}
  function createNoteWindow(cardData) {}
  function setupNoteAutoClose() {}
  function setupNotesDropdown() {}
  function updateNotesButtonState() {}


  function deleteCard(cardData) {
    lines = lines.filter(line => {
      if (line.startCard.id === cardData.id || line.endCard.id === cardData.id) { line.element.remove(); return false; }
      return true;
    });
    if (cardData.note && cardData.note.window) cardData.note.window.remove();
    cardData.element.remove();
    cards = cards.filter(c => c.id !== cardData.id);
    activeState.selectedCards.delete(cardData);
    updateNotesButtonState();
  }

  function deleteLine(lineData) {
    lineData.element.remove();
    lines = lines.filter(l => l.id !== lineData.id);
    if (activeState.selectedLine && activeState.selectedLine.id === lineData.id) activeState.selectedLine = null;
  }

  function deleteSelection() {
    let changed = false;
    if (activeState.selectedCards.size > 0) { activeState.selectedCards.forEach(cardData => deleteCard(cardData)); changed = true; }
    if (activeState.selectedLine) { deleteLine(activeState.selectedLine); changed = true; }
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
    const x = parseFloat(card.style.left), y = parseFloat(card.style.top);
    const width = card.offsetWidth, height = card.offsetHeight;
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

    thicknessSlider.value = lineData.thickness;
    thicknessValue.textContent = lineData.thickness;
    hiddenLineColorPicker.value = lineData.color;
    lineColorTrigger.style.backgroundColor = lineData.color;
    activeState.currentThickness = lineData.thickness;
    activeState.currentColor = lineData.color;
    setupLineControls();
  }

  function toggleCardSelection(cardData) {
    if (activeState.selectedCards.has(cardData)) { activeState.selectedCards.delete(cardData); cardData.element.classList.remove('selected'); }
    else {
      if (activeState.selectedLine) { activeState.selectedLine.element.classList.remove('selected'); activeState.selectedLine = null; }
      activeState.selectedCards.add(cardData); cardData.element.classList.add('selected');
    }
  }

  function setSelectionSet(newSet) {
    activeState.selectedCards.forEach(card => card.element.classList.remove('selected'));
    activeState.selectedCards.clear();
    newSet.forEach(cd => { activeState.selectedCards.add(cd); cd.element.classList.add('selected'); });
  }

  function clearSelection() { activeState.selectedCards.forEach(card => card.element.classList.remove('selected')); activeState.selectedCards.clear(); }

  let selectionBox = null;
  let marqueeStart = { x: 0, y: 0 };
  let baseSelection = null;

  function startMarqueeSelection(e) {
    if (!e.ctrlKey) clearSelection();
    activeState.isSelecting = true;
    marqueeStart.x = e.clientX; marqueeStart.y = e.clientY;
    baseSelection = e.ctrlKey ? new Set(activeState.selectedCards) : new Set();

    if (!selectionBox) { selectionBox = document.createElement('div'); selectionBox.className = 'selection-box'; document.body.appendChild(selectionBox); }
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
    if (selectionBox) { selectionBox.style.display = 'none'; selectionBox.style.width = '0px'; selectionBox.style.height = '0px'; }
  }

  function getCanvasCoordinates(clientX, clientY) {
    return { x: (clientX - canvasState.x) / canvasState.scale, y: (clientY - canvasState.y) / canvasState.scale };
  }

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

    const CARD_WIDTH = 380, CARD_HEIGHT = 280, PADDING = 50;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    templateCards.forEach(c => { minX = Math.min(minX, c.x); minY = Math.min(minY, c.y); maxX = Math.max(maxX, c.x + CARD_WIDTH); maxY = Math.max(maxY, c.y + CARD_HEIGHT); });
    const templateWidth = maxX - minX, templateHeight = maxY - minY;

    const canvasViewLeft = -canvasState.x / canvasState.scale;
    const canvasViewTop  = -canvasState.y / canvasState.scale;
    const canvasViewRight = (window.innerWidth - canvasState.x) / canvasState.scale;
    const canvasViewBottom = (window.innerHeight - canvasState.y) / canvasState.scale;

    const targetX = Math.max(canvasViewLeft + PADDING,  canvasViewRight  - templateWidth  - PADDING);
    const targetY = Math.max(canvasViewTop  + PADDING,  canvasViewBottom - templateHeight - PADDING);

    const offsetX = targetX - minX, offsetY = targetY - minY;

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
        x: cardDef.x + offsetX, y: cardDef.y + offsetY, title: cardDef.title,
        bodyHTML, headerBg: 'rgb(93, 139, 244)', colorIndex: 0, isTemplate: true
      });
      createdCardsMap.set(cardDef.key, cardData);
    });

    templateLines.forEach(lineDef => {
      const startCard = createdCardsMap.get(lineDef.startKey);
      const endCard   = createdCardsMap.get(lineDef.endKey);
      if (!startCard || !endCard) return;

      const lineElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      lineElement.setAttribute('class', 'line');
      const color = '#3d85c6', thickness = lineDef.thickness;
      lineElement.setAttribute('stroke', color);
      lineElement.setAttribute('stroke-width', thickness);
      lineElement.style.setProperty('--line-color', color);
      lineElement.setAttribute('marker-start', 'url(#marker-dot)');
      lineElement.setAttribute('marker-end', 'url(#marker-dot)');
      svgLayer.appendChild(lineElement);

      const lineData = {
        id: `line_${Date.now()}_${Math.floor(Math.random()*1000)}`,
        startCard, startSide: lineDef.startSide,
        endCard,   endSide: lineDef.endSide,
        color, thickness, element: lineElement
      };
      lines.push(lineData);
      lineElement.addEventListener('click', (e) => { e.stopPropagation(); selectLine(lineData); });
    });

    updateAllLines();
    saveState();
  }

  function setupHistoryButtons() { if (undoBtn) undoBtn.addEventListener('click', undo); if (redoBtn) redoBtn.addEventListener('click', redo); }

  function serializeState() {
    return {
      cards: cards.map(c => ({
        id: c.id,
        x: parseFloat(c.element.style.left),
        y: parseFloat(c.element.style.top),
        width: c.element.style.width || null,
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
    lines.forEach(l => l.element.remove()); lines = [];
    cards.forEach(c => { if (c.note && c.note.window) c.note.window.remove(); c.element.remove(); });
    cards = [];
    activeState.selectedCards.clear(); activeState.selectedLine = null;

    const idMap = new Map();
    state.cards.forEach(cd => {
      const cardData = createCard({
        ...cd,
        isTemplate: true
      });
      idMap.set(cd.id, cardData);
    });

    state.lines.forEach(ld => {
      const startCard = idMap.get(ld.startId);
      const endCard   = idMap.get(ld.endId);
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

    updateNotesButtonState();
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
    const current = undoStack.pop(); redoStack.push(current);
    const prev = JSON.parse(undoStack[undoStack.length - 1]);
    loadState(prev, false);
  }

  function redo() {
    if (redoStack.length === 0) return;
    const snapshot = redoStack.pop();
    undoStack.push(snapshot);
    loadState(JSON.parse(snapshot), false);
  }

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
        copiedLines.push({ startId: l.startCard.id, startSide: l.startSide, endId: l.endCard.id, endSide: l.endSide, color: l.color, thickness: l.thickness });
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

    if (loadProjectBtn && loadProjectInput) {
      loadProjectBtn.addEventListener('click', () => loadProjectInput.click());
      loadProjectInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        try {
          const text = await file.text();
          const isHtml = /^\s*<!doctype html|<html[\s>]/i.test(text);
          if (isHtml) throw new Error('html-file');
          const state = JSON.parse(text);
          const ok = state && typeof state === 'object' && Array.isArray(state.cards) && Array.isArray(state.lines);
          if (!ok) throw new Error('bad-structure');
          loadState(state, true);
        } catch (err) {
          console.error('Не удалось загрузить проект:', err);
          if (String(err.message) === 'html-file') {
            alert('Вы выбрали HTML-файл из «Экспорт HTML». Для продолжения выберите JSON, сохранённый кнопкой «💾 Сохранить проект».');
          } else if (String(err.message) === 'bad-structure') {
            alert('Файл прочитан, но структура не похожа на проект (нет полей cards/lines). Проверьте, что это JSON из «💾 Сохранить проект».');
          } else {
            alert('Файл повреждён или имеет неверный формат JSON.');
          }
        } finally {
          loadProjectInput.value = '';
        }
      });
    }

    if (exportHtmlBtn) {
      exportHtmlBtn.addEventListener('click', () => {
        const bodyStyle = getComputedStyle(document.body);
        const viewOnlyScript = `<script>document.addEventListener('DOMContentLoaded',()=>{const c=document.getElementById('canvas');let p=!1,lx=0,ly=0,x=${canvasState.x},y=${canvasState.y},s=${canvasState.scale};function u(){c.style.transform=\`translate(\${x}px,\${y}px) scale(\${s})\`}window.addEventListener('mousedown',e=>{if(e.button===1){p=!0;lx=e.clientX;ly=e.clientY;document.body.style.cursor='move'}}),window.addEventListener('mousemove',e=>{if(p){const d=e.clientX-lx,t=e.clientY-ly;x+=d,y+=t,lx=e.clientX,ly=e.clientY,u()}}),window.addEventListener('mouseup',e=>{e.button===1&&(p=!1,document.body.style.cursor='default')}),window.addEventListener('wheel',e=>{e.preventDefault();const a=-.001*e.deltaY,n=Math.max(.1,Math.min(5,s+a)),m=e.clientX,w=e.clientY;x=m-(m-x)*(n/s),y=w-(w-y)*(n/s),s=n,u()},{passive:!1}),u()});<\/script>`;
        const canvasClone = canvas.cloneNode(true);
        canvasClone.querySelectorAll('.note-resize-handle, .note-close-btn').forEach(el => el.remove());
        canvasClone.querySelectorAll('[contenteditable], .card-controls, .close-btn, .lock-btn, .header-color-picker-btn, .body-color-changer, .connection-point').forEach(el => {
            if (el.hasAttribute('contenteditable')) el.setAttribute('contenteditable','false');
            el.style.pointerEvents = 'none';
        });
        const buildAndDownload = (cssText) => {
          const htmlContent = `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>Просмотр Схемы</title><style>${cssText}body{overflow:hidden}.card:hover{transform:none;box-shadow:0 8px 20px rgba(0,0,0,.15)}.card.selected{box-shadow:0 8px 20px rgba(0,0,0,.15)}</style></head><body style="background:${bodyStyle.background};">${canvasClone.outerHTML}${viewOnlyScript}</body></html>`;
          const blob = new Blob([htmlContent], {type:'text/html'});
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = `scheme-${Date.now()}.html`; a.click();
          URL.revokeObjectURL(url);
        };
        fetch('style.css').then(r => r.ok ? r.text() : Promise.reject()).then(cssText => buildAndDownload(cssText)).catch(() => {
            const minimalCss = `html,body{margin:0;height:100%}body{font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;}#canvas{position:relative;width:100%;height:100%;transform-origin:0 0}#svg-layer{position:absolute;inset:0;pointer-events:none;overflow:visible}.line{fill:none;stroke:currentColor;stroke-linecap:round}.card{position:absolute;width:var(--card-width, 380px);background:#fff;border-radius:16px;box-shadow:0 8px 20px rgba(0,0,0,.15);overflow:hidden}.card-header{background:#4facfe;color:#fff;height:52px;padding:10px 12px;display:grid;grid-template-columns:28px 28px 1fr 28px 28px;align-items:center;gap:6px;border-radius:16px 16px 0 0}.card-title{grid-column:3/4;text-align:center;font-weight:700;font-size:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.card-body{padding:14px 16px;}.card-row{display:flex;align-items:center;gap:10px;margin:8px 0}.label{color:#6b7280;font-weight:600;}.value{color:#111827;}.coin-icon{width:28px;height:28px;}`;
            buildAndDownload(minimalCss);
        });
      });
    }
  }

// ============== НАЧАЛО ИСПРАВЛЕННОЙ ФУНКЦИИ (ЗАМЕНИТЬ В SCRIPT.JS) ==============
async function prepareForPrint() {
  if (cards.length === 0) {
    alert("На доске нет элементов для печати.");
    return;
  }

  const state = serializeState();
  const PADDING = 100;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  state.cards.forEach(card => {
    const cardWidth = parseInt(card.width, 10) || 380;
    const cardHeight = 280;
    minX = Math.min(minX, card.x);
    minY = Math.min(minY, card.y);
    maxX = Math.max(maxX, card.x + cardWidth);
    maxY = Math.max(maxY, card.y + cardHeight);
  });

  const contentWidth = maxX - minX;
  const contentHeight = maxY - minY;
  const bodyStyle = getComputedStyle(document.body);

  // Скрипт, который навешивает обработчики на кнопки и работает ТОЛЬКО после загрузки библиотек
  const screenshotScript = `
    function waitLibs(cb){
      const ok = !!window.html2canvas && !!(window.jspdf && window.jspdf.jsPDF);
      if(ok) return cb();
      setTimeout(()=>waitLibs(cb), 60);
    }
    waitLibs(function init(){
      const { jsPDF } = window.jspdf;
      const pngBtn = document.getElementById('do-screenshot-btn');
      const pdfBtn = document.getElementById('do-pdf-btn');
      const target = document.getElementById('canvas');

      pngBtn.disabled = false;
      pdfBtn.disabled = false;

      pngBtn.addEventListener('click', () => {
        pngBtn.textContent = 'Создание PNG...';
        pngBtn.disabled = true; pdfBtn.disabled = true;
        html2canvas(target, { scale: 2 }).then(canvas => {
          const link = document.createElement('a');
          link.download = 'scheme-screenshot.png';
          link.href = canvas.toDataURL('image/png');
          link.click();
          pngBtn.textContent = 'Готово!';
        }).catch(err => {
          console.error('Ошибка PNG:', err);
          pngBtn.textContent = 'Ошибка! Попробуйте снова';
        }).finally(()=>{ pngBtn.disabled = false; pdfBtn.disabled = false; });
      });

      pdfBtn.addEventListener('click', () => {
        const input = prompt("Введите размеры печати в см (ШиринаxВысота), например 150x120, или 'оригинал'.", "оригинал");
        if (input === null) return;

        pdfBtn.textContent = 'Подготовка PDF...';
        pdfBtn.disabled = true; pngBtn.disabled = true;

        const DPI = 150, CM_PER_INCH = 2.54;

        html2canvas(target, { scale: 2 }).then(canvas => {
          let targetWidthPx = canvas.width;
          let targetHeightPx = canvas.height;

          if (input.toLowerCase() !== 'оригинал') {
            const parts = input.split('x');
            if (parts.length !== 2) throw new Error('bad-format');
            const wcm = parseFloat(parts[0]), hcm = parseFloat(parts[1]);
            if (!(wcm > 0 && hcm > 0)) throw new Error('bad-format');
            targetWidthPx = Math.round((wcm / CM_PER_INCH) * DPI);
            targetHeightPx = Math.round((hcm / CM_PER_INCH) * DPI);
          }

          const doc = new jsPDF({ orientation:'p', unit:'pt', format:'a4' });
          const pageWidth = doc.internal.pageSize.getWidth();
          const pageHeight = doc.internal.pageSize.getHeight();

          // Масштабируем исходный снимок на нужный конечный размер
          const scaled = document.createElement('canvas');
          scaled.width = targetWidthPx; scaled.height = targetHeightPx;
          scaled.getContext('2d').drawImage(canvas, 0, 0, targetWidthPx, targetHeightPx);

          const pagesX = Math.ceil(targetWidthPx / pageWidth);
          const pagesY = Math.ceil(targetHeightPx / pageHeight);
          const totalPages = pagesX * pagesY;
          let n = 0;

          for (let y = 0; y < targetHeightPx; y += pageHeight) {
            for (let x = 0; x < targetWidthPx; x += pageWidth) {
              n++;
              pdfBtn.textContent = 'Стр. ' + n + ' / ' + totalPages + '...';
              if (x > 0 || y > 0) doc.addPage();

              const sliceW = Math.min(pageWidth,  targetWidthPx - x);
              const sliceH = Math.min(pageHeight, targetHeightPx - y);

              const part = document.createElement('canvas');
              part.width = sliceW; part.height = sliceH;
              part.getContext('2d').drawImage(scaled, x, y, sliceW, sliceH, 0, 0, sliceW, sliceH);

              doc.addImage(part.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, sliceW, sliceH);
            }
          }

          pdfBtn.textContent = 'Сохранение PDF...';
          doc.save('FOHOW-scheme.pdf');
          pdfBtn.textContent = 'Готово!';
        }).catch(err => {
          console.error('Ошибка PDF:', err);
          if (err && err.message === 'bad-format') alert("Неверный формат. Пример: 150x120 или 'оригинал'.");
          pdfBtn.textContent = 'Ошибка! Попробуйте снова';
        }).finally(()=>{ pngBtn.disabled = false; pdfBtn.disabled = false; });
      });
    });
  `;

  const createPrintWindow = (cssText) => {
    // Подключаем библиотеки в НОВОЕ окно (это и чинит кнопки)
    const html = `
      <!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>Версия для печати</title>
      <style>
        ${cssText}
        html, body {
          overflow: auto !important; margin: 0; padding: 0;
          width: ${contentWidth + PADDING * 2}px;
          height: ${contentHeight + PADDING * 2}px;
        }
        #canvas { transform: none !important; position: relative; width: 100%; height: 100%; }
        .card:hover { transform: none !important; box-shadow: 0 8px 20px rgba(0,0,0,.12) !important; }
        #controls {
          position: fixed; top: 20px; left: 20px; z-index: 9999;
          display: flex; flex-direction: column; gap: 10px;
        }
        .control-btn {
          padding: 12px 20px; font-size: 16px; font-weight: bold;
          background-color: #0f62fe; color: white; border: none;
          border-radius: 10px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,.2);
          transition: background-color .2s;
        }
        .control-btn:hover:not(:disabled) { background-color: #0042d6; }
        .control-btn:disabled { background-color: #6b7280; cursor: not-allowed; }
      </style>
      <!-- Библиотеки нужны именно здесь -->
      <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
      </head>
      <body style="background: ${bodyStyle.background};">
        <div id="controls">
          <button id="do-screenshot-btn" class="control-btn" disabled>Сохранить как картинку (PNG)</button>
          <button id="do-pdf-btn" class="control-btn" disabled>Сохранить для печати (PDF)</button>
        </div>
        <div id="canvas">
          <svg id="svg-layer" style="width:100%; height:100%;">
            <defs>
              <marker id="marker-dot" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6">
                <circle cx="5" cy="5" r="4" fill="currentColor"/>
              </marker>
            </defs>
          </svg>
        </div>
        <script>${screenshotScript}<\/script>
      </body></html>
    `;

    const w = window.open('', '_blank');
    if (!w) { alert("Разрешите всплывающие окна для этого сайта."); return; }
    w.document.open(); w.document.write(html); w.document.close();

    w.onload = () => {
      setTimeout(() => {
        const printCanvas = w.document.getElementById('canvas');
        const printSvgLayer = w.document.getElementById('svg-layer');
        const map = new Map();

        // Рисуем карточки
        state.cards.forEach(cd => {
          const el = w.document.createElement('div');
          el.className = 'card';
          if (cd.isDarkMode) el.classList.add('dark-mode');
          el.style.width = cd.width || '380px';
          el.style.left = (cd.x - minX + PADDING) + 'px';
          el.style.top  = (cd.y - minY + PADDING) + 'px';
          el.innerHTML = \`
            <div class="card-header" style="background:\${cd.headerBg};">
              <span class="card-title">\${cd.title}</span>
            </div>
            <div class="card-body \${cd.bodyClass}">\${cd.bodyHTML}</div>\`;
          printCanvas.appendChild(el);
          map.set(cd.id, el);
        });

        // Рисуем линии
        state.lines.forEach(ld => {
          const s = map.get(ld.startId), e = map.get(ld.endId);
          if (!s || !e) return;
          const getXY = (el, side) => {
            const x = parseFloat(el.style.left), y = parseFloat(el.style.top);
            const wdt = parseInt(el.style.width,10) || 380, h = 280;
            return side==='top'   ? {x:x+wdt/2, y:y}
                 : side==='bottom'? {x:x+wdt/2, y:y+h}
                 : side==='left'  ? {x:x, y:y+h/2}
                 :                   {x:x+wdt, y:y+h/2};
          };
          const p1 = getXY(s, ld.startSide), p2 = getXY(e, ld.endSide);
          const path = w.document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('class','line');
          path.setAttribute('stroke', ld.color);
          path.setAttribute('stroke-width', ld.thickness);
          path.style.setProperty('--line-color', ld.color);
          path.setAttribute('marker-start','url(#marker-dot)');
          path.setAttribute('marker-end','url(#marker-dot)');
          const mid = (ld.startSide==='left'||ld.startSide==='right') ? {x:p2.x, y:p1.y} : {x:p1.x, y:p2.y};
          path.setAttribute('d', \`M \${p1.x} \${p1.y} L \${mid.x} \${mid.y} L \${p2.x} \${p2.y}\`);
          printSvgLayer.appendChild(path);
        });
      }, 100);
    };
  };

  fetch('style.css')
    .then(r => r.ok ? r.text() : Promise.reject())
    .then(css => createPrintWindow(css))
    .catch(() => createPrintWindow(`:root{--card-width:380px;--brand:#0f62fe;}`));
}
// ============== КОНЕЦ ОБНОВЛЕННОЙ ФУНКЦИИ ==============

    saveState();
});
// ============== КОНЕЦ ФИНАЛЬНОЙ ВЕРСИИ SCRIPT.JS ==============



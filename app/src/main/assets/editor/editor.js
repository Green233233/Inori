// ==================== 编辑器核心 ====================

const Atrament = window.Atrament;
const MODE_DISABLED = window.ATRAMENT_MODE_DISABLED || 'disabled';
const MODE_DRAW = window.ATRAMENT_MODE_DRAW || 'draw';
const MODE_ERASE = window.ATRAMENT_MODE_ERASE || 'erase';
const DOODLE_NODE_CLASS = 'doodle-data';
const DOODLE_NODE_SELECTOR = `.${DOODLE_NODE_CLASS}`;
const DOODLE_SCHEMA_VERSION = 1;
const HISTORY_LIMIT = 40;
const BRUSH_PRESETS = {
    pencil: { roughness: 0.35, minSize: 0, maxSize: 5, defaultSize: 2 },
    pen: { roughness: 0.5, minSize: 0, maxSize: 5, defaultSize: 2 },
    watercolor: { roughness: 0.25, minSize: 5, maxSize: 25, defaultSize: 12 },
    marker: { roughness: 0.25, minSize: 5, maxSize: 25, defaultSize: 12 },
    highlighter: { roughness: 0.25, minSize: 5, maxSize: 25, defaultSize: 12 },
    eraser: { roughness: 0, minSize: 1, maxSize: 30, defaultSize: 12 }
};

let savedSelectionRange = null;
let caretScrollScheduled = false;
let caretScrollTimer = null;
let paper;

const scheduleIdle = window.requestIdleCallback
    ? (callback) => window.requestIdleCallback(callback, { timeout: 120 })
    : (callback) => window.setTimeout(callback, 16);

const doodle = {
    canvas: null,
    atrament: null,
    roughCanvas: null,
    active: false,
    renderQueued: false,
    currentTool: 'pencil',
    brush: {
        color: '#000000',
        size: BRUSH_PRESETS.pencil.defaultSize,
        roughness: BRUSH_PRESETS.pencil.roughness,
        smoothing: 0.85,
        adaptiveStroke: true
    },
    strokes: [],
    bitmapLayers: [],
    undoStack: [],
    redoStack: [],
    lastStateJson: ''
};

document.addEventListener('DOMContentLoaded', () => {
    paper = document.getElementById('paper');
    initialiseDoodle();
    bindEditorEvents();
    updateVisibleViewport();
});

function bindEditorEvents() {
    window.addEventListener('resize', () => {
        resizeDoodleCanvas();
        updateVisibleViewport();
    });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', updateVisibleViewport);
        window.visualViewport.addEventListener('scroll', updateVisibleViewport);
    }

    paper.addEventListener('input', () => {
        resizeDoodleCanvas();
        notifyContentChanged();
        scheduleCaretVisibility();
    });
    paper.addEventListener('scroll', syncDoodleCanvasScroll);
    paper.addEventListener('compositionupdate', scheduleCaretVisibility);
    paper.addEventListener('compositionend', scheduleCaretVisibility);
    paper.addEventListener('beforeinput', scheduleCaretVisibility);
    paper.addEventListener('keyup', scheduleCaretVisibility);
    paper.addEventListener('focus', scheduleCaretVisibility);

    document.addEventListener('selectionchange', () => {
        const selection = window.getSelection();
        if (selection.rangeCount <= 0) return;
        const range = selection.getRangeAt(0);
        if (paper.contains(range.commonAncestorContainer)) {
            savedSelectionRange = range.cloneRange();
            if (range.collapsed && document.activeElement === paper) {
                scheduleCaretVisibility();
            }
        }
    });
}

// ==================== 软键盘与光标可见性 ====================

function updateVisibleViewport() {
    const viewport = window.visualViewport;
    const visibleBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    const layoutHeight = Math.max(document.documentElement.clientHeight, window.innerHeight);
    const keyboardInset = Math.max(0, Math.round(layoutHeight - visibleBottom));
    document.documentElement.style.setProperty('--keyboard-inset', `${keyboardInset}px`);
    scheduleCaretVisibility();
}

function scheduleCaretVisibility() {
    window.clearTimeout(caretScrollTimer);
    caretScrollTimer = window.setTimeout(keepCaretVisible, 120);
    if (!caretScrollScheduled) {
        caretScrollScheduled = true;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                caretScrollScheduled = false;
                keepCaretVisible();
            });
        });
    }
}

function keepCaretVisible() {
    if (!paper || document.activeElement !== paper || doodle.active) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!paper.contains(range.commonAncestorContainer)) return;

    const rect = getCaretRect(range, selection);
    if (!rect) return;

    const viewport = window.visualViewport;
    const paperRect = paper.getBoundingClientRect();
    const visibleTop = Math.max(paperRect.top, viewport ? viewport.offsetTop : 0);
    const visibleBottom = Math.min(
        paperRect.bottom,
        viewport ? viewport.offsetTop + viewport.height : window.innerHeight
    );
    const lineHeight = parseFloat(getComputedStyle(paper).lineHeight);
    const margin = Math.max(40, Number.isNaN(lineHeight) ? 48 : lineHeight * 2.5);

    if (rect.bottom > visibleBottom - margin) {
        paper.scrollTop = Math.max(0, paper.scrollTop + rect.bottom - visibleBottom + margin);
    } else if (rect.top < visibleTop + margin) {
        paper.scrollTop = Math.max(0, paper.scrollTop + rect.top - visibleTop - margin);
    }
}

function getCaretRect(range, selection) {
    const rects = range.getClientRects();
    if (rects.length > 0) {
        const lastRect = rects[rects.length - 1];
        if (lastRect.height > 0) return lastRect;
    }

    const marker = document.createElement('span');
    marker.textContent = '\u200b';
    marker.style.display = 'inline-block';
    marker.style.width = '0';
    marker.style.overflow = 'hidden';
    const savedRange = range.cloneRange();
    try {
        range.insertNode(marker);
        const markerRect = marker.getBoundingClientRect();
        marker.remove();
        selection.removeAllRanges();
        selection.addRange(savedRange);
        return markerRect;
    } catch (error) {
        marker.remove();
        selection.removeAllRanges();
        selection.addRange(savedRange);
        return null;
    }
}

// ==================== 选区管理 ====================

function saveSelection() {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (paper.contains(range.commonAncestorContainer)) {
            savedSelectionRange = range.cloneRange();
        }
    }
}

function restoreSelection() {
    if (!savedSelectionRange) return;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(savedSelectionRange);
}

// ==================== 文字编辑命令 ====================

function execCmd(command, value) {
    paper.focus();
    restoreSelection();
    document.execCommand(command, false, value || null);
    saveSelection();
    notifyContentChanged();
}

function changeFont(fontName) {
    paper.focus();
    restoreSelection();
    const fontMap = {
        handwrite: 'handwrite, serif',
        serif: 'serif, Songti SC, SimSun',
        'sans-serif': 'sans-serif, PingFang SC, Microsoft YaHei'
    };
    document.execCommand('fontName', false, fontMap[fontName] || fontName);
    saveSelection();
    notifyContentChanged();
}

function changeSize(size) {
    paper.focus();
    restoreSelection();
    document.execCommand('fontSize', false, size);
    window.setTimeout(normalizeFontTags, 50);
    saveSelection();
    notifyContentChanged();
}

function normalizeFontTags() {
    const sizeMap = {
        1: '12px',
        2: '14px',
        3: '16px',
        4: '18px',
        5: '20px',
        6: '22px',
        7: '24px'
    };
    Array.from(paper.getElementsByTagName('font')).reverse().forEach((font) => {
        const span = document.createElement('span');
        span.style.fontSize = sizeMap[font.getAttribute('size')] || '16px';
        span.innerHTML = font.innerHTML;
        font.parentNode.replaceChild(span, font);
    });
    notifyContentChanged();
}

function changeColor(color) {
    paper.focus();
    restoreSelection();
    document.execCommand('foreColor', false, color);
    saveSelection();
    notifyContentChanged();
}

// ==================== Atrament + Rough 涂鸦层 ====================

function initialiseDoodle() {
    doodle.canvas = document.getElementById('doodle-canvas');
    resizeDoodleCanvas();
    createAtrament();
    applyBrushOptions();
}

function createAtrament() {
    if (doodle.atrament) {
        doodle.atrament.destroy();
    }
    doodle.atrament = new Atrament(doodle.canvas, {
        color: doodle.brush.color,
        width: doodle.canvas.width,
        height: doodle.canvas.height,
        weight: doodle.brush.size,
        smoothing: doodle.brush.smoothing,
        adaptiveStroke: doodle.brush.adaptiveStroke,
        mode: doodle.active ? atramentModeForTool(doodle.currentTool) : MODE_DISABLED,
        secondaryMouseButton: true,
        recordStrokes: true
    });
    doodle.atrament.recordStrokes = true;
    doodle.atrament.addEventListener('strokerecorded', ({ stroke }) => {
        handleRecordedStroke(stroke);
    });
    doodle.atrament.addEventListener('dirty', notifyDoodleStateChanged);
    doodle.roughCanvas = window.rough && window.rough.canvas
        ? window.rough.canvas(doodle.canvas)
        : null;
}

function resizeDoodleCanvas() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(window.innerWidth * ratio));
    const contentHeight = Math.max(
        window.innerHeight,
        paper ? paper.scrollHeight : window.innerHeight
    );
    const height = Math.max(1, Math.ceil(contentHeight * ratio));
    doodle.canvas.width = width;
    doodle.canvas.height = height;
    doodle.canvas.style.width = `${window.innerWidth}px`;
    doodle.canvas.style.height = `${contentHeight}px`;
    syncDoodleCanvasScroll();
    queueDoodleRender();
}

function syncDoodleCanvasScroll() {
    if (!paper || !doodle.canvas) return;
    doodle.canvas.style.transform = `translateY(${-paper.scrollTop}px)`;
}

function atramentModeForTool(tool) {
    return tool === 'eraser' ? MODE_ERASE : MODE_DRAW;
}

function handleRecordedStroke(stroke) {
    if (!stroke || !Array.isArray(stroke.segments) || stroke.segments.length === 0) return;

    if (stroke.mode === MODE_ERASE || doodle.currentTool === 'eraser') {
        pushDoodleHistory();
        applyStructuredErase(stroke);
        doodle.redoStack = [];
        redrawDoodle();
        persistDoodleChange();
        notifyDoodleStateChanged();
        return;
    }

    pushDoodleHistory();
    doodle.strokes.push(normalizeStroke(stroke));
    doodle.redoStack = [];
    queueDoodleRender();
    persistDoodleChange();
    notifyDoodleStateChanged();
}

function normalizeStroke(stroke) {
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: 'stroke',
        tool: doodle.currentTool === 'eraser' ? 'pencil' : doodle.currentTool,
        points: stroke.segments.map((segment) => ({
            x: round(segment.point.x),
            y: round(segment.point.y),
            time: Math.round(segment.time || 0),
            pressure: round(segment.pressure ?? 0.5)
        })),
        color: stroke.color || doodle.brush.color,
        width: round(stroke.weight || doodle.brush.size),
        roughness: round(doodle.brush.roughness),
        atramentOptions: {
            smoothing: round(stroke.smoothing ?? doodle.brush.smoothing),
            adaptiveStroke: stroke.adaptiveStroke ?? doodle.brush.adaptiveStroke
        },
        createdAt: Date.now()
    };
}

function applyStructuredErase(eraserStroke) {
    const eraserPoints = eraserStroke.segments.map((segment) => segment.point);
    const radius = Math.max(effectiveBrushSize(eraserStroke.weight || doodle.brush.size) * 1.15, 6);
    const nextStrokes = [];

    doodle.strokes.forEach((stroke) => {
        const segments = splitStrokeByEraser(stroke, eraserPoints, radius);
        nextStrokes.push(...segments);
    });
    doodle.strokes = nextStrokes;
}

function splitStrokeByEraser(stroke, eraserPoints, radius) {
    const chunks = [];
    let current = [];
    stroke.points.forEach((point) => {
        if (isPointErased(point, eraserPoints, radius)) {
            if (current.length > 1) chunks.push(current);
            current = [];
        } else {
            current.push(point);
        }
    });
    if (current.length > 1) chunks.push(current);

    if (chunks.length === 0) return [];
    if (chunks.length === 1 && chunks[0].length === stroke.points.length) return [stroke];
    return chunks.map((points, index) => ({
        ...stroke,
        id: `${stroke.id}-erase-${Date.now()}-${index}`,
        points
    }));
}

function isPointErased(point, eraserPoints, radius) {
    const radiusSq = radius * radius;
    return eraserPoints.some((eraserPoint) => {
        const dx = point.x - eraserPoint.x;
        const dy = point.y - eraserPoint.y;
        return dx * dx + dy * dy <= radiusSq;
    });
}

function queueDoodleRender() {
    if (!doodle.canvas || doodle.renderQueued) return;
    doodle.renderQueued = true;
    scheduleIdle(() => {
        doodle.renderQueued = false;
        redrawDoodle();
    });
}

function redrawDoodle() {
    const context = doodle.canvas.getContext('2d');
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.setLineDash([]);
    context.clearRect(0, 0, doodle.canvas.width, doodle.canvas.height);
    context.restore();

    const ratio = window.devicePixelRatio || 1;
    context.save();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.setLineDash([]);
    doodle.strokes.forEach((stroke) => renderStroke(stroke));
    context.restore();
    syncDoodleDataNode();
}

function renderStroke(stroke) {
    const points = simplifyPoints(stroke.points, 0.8).map((point) => [point.x, point.y]);
    if (points.length < 2) return;

    const options = {
        stroke: stroke.color,
        strokeWidth: effectiveBrushSize(stroke.width),
        roughness: stroke.roughness,
        bowing: Math.min(4, 0.8 + stroke.roughness),
        curveTightness: 0.15,
        disableMultiStroke: stroke.width < 2
    };

    if (doodle.roughCanvas && typeof doodle.roughCanvas.curve === 'function') {
        doodle.roughCanvas.curve(points, options);
    } else {
        renderCanvasFallback(points, options);
    }
}

function renderCanvasFallback(points, options) {
    const context = doodle.canvas.getContext('2d');
    context.save();
    context.strokeStyle = options.stroke;
    context.lineWidth = options.strokeWidth;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index++) {
        context.lineTo(points[index][0], points[index][1]);
    }
    context.stroke();
    context.restore();
}

function simplifyPoints(points, minDistance) {
    if (points.length <= 2) return points;
    const simplified = [points[0]];
    let previous = points[0];
    for (let index = 1; index < points.length - 1; index++) {
        const point = points[index];
        const dx = point.x - previous.x;
        const dy = point.y - previous.y;
        if (dx * dx + dy * dy >= minDistance * minDistance) {
            simplified.push(point);
            previous = point;
        }
    }
    simplified.push(points[points.length - 1]);
    return simplified;
}

function pushDoodleHistory() {
    doodle.undoStack.push(JSON.stringify({
        strokes: doodle.strokes,
        bitmapLayers: doodle.bitmapLayers
    }));
    if (doodle.undoStack.length > HISTORY_LIMIT) {
        doodle.undoStack.shift();
    }
}

function restoreDoodleSnapshot(snapshotJson) {
    try {
        const snapshot = JSON.parse(snapshotJson);
        doodle.strokes = Array.isArray(snapshot.strokes) ? snapshot.strokes : [];
        doodle.bitmapLayers = Array.isArray(snapshot.bitmapLayers) ? snapshot.bitmapLayers : [];
        queueDoodleRender();
        persistDoodleChange();
        notifyDoodleStateChanged();
    } catch (error) {
        console.error('restoreDoodleSnapshot failed', error);
    }
}

function undoDoodle() {
    if (doodle.undoStack.length === 0) return;
    doodle.redoStack.push(JSON.stringify({
        strokes: doodle.strokes,
        bitmapLayers: doodle.bitmapLayers
    }));
    restoreDoodleSnapshot(doodle.undoStack.pop());
}

function redoDoodle() {
    if (doodle.redoStack.length === 0) return;
    doodle.undoStack.push(JSON.stringify({
        strokes: doodle.strokes,
        bitmapLayers: doodle.bitmapLayers
    }));
    restoreDoodleSnapshot(doodle.redoStack.pop());
}

function clearDoodle() {
    if (doodle.strokes.length === 0 && doodle.bitmapLayers.length === 0) return;
    pushDoodleHistory();
    doodle.strokes = [];
    doodle.bitmapLayers = [];
    doodle.redoStack = [];
    queueDoodleRender();
    persistDoodleChange();
    notifyDoodleStateChanged();
}

function toggleDoodleMode(active) {
    doodle.active = active;
    doodle.canvas.classList.toggle('active', active);
    paper.contentEditable = String(!active);
    if (doodle.atrament) {
        doodle.atrament.mode = active ? atramentModeForTool(doodle.currentTool) : MODE_DISABLED;
    }
    if (active) {
        resizeDoodleCanvas();
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
    } else {
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
        syncDoodleDataNode();
        notifyContentChanged();
    }
    notifyDoodleStateChanged();
}

function setBrush(type) {
    doodle.currentTool = type === 'eraser' ? 'eraser' : type;
    const preset = brushPreset(doodle.currentTool);
    doodle.brush.roughness = preset.roughness;
    doodle.brush.size = clampBrushSize(doodle.brush.size, preset);
    applyBrushOptions();
}

function setBrushSize(size) {
    const parsed = parseFloat(size);
    doodle.brush.size = Number.isFinite(parsed)
        ? clampBrushSize(parsed, brushPreset(doodle.currentTool))
        : doodle.brush.size;
    applyBrushOptions();
}

function setBrushColor(color) {
    doodle.brush.color = color;
    applyBrushOptions();
}

function setBrushRoughness(roughness) {
    // Roughness is fixed by brush type; keep this as a no-op for bridge compatibility.
    doodle.brush.roughness = brushPreset(doodle.currentTool).roughness;
    notifyDoodleStateChanged();
}

function applyBrushOptions() {
    if (!doodle.atrament) return;
    doodle.atrament.color = doodle.brush.color;
    doodle.atrament.weight = effectiveBrushSize(doodle.brush.size);
    doodle.atrament.smoothing = doodle.brush.smoothing;
    doodle.atrament.adaptiveStroke = doodle.brush.adaptiveStroke;
    doodle.atrament.mode = doodle.active ? atramentModeForTool(doodle.currentTool) : MODE_DISABLED;
    notifyDoodleStateChanged();
}

function brushPreset(tool) {
    return BRUSH_PRESETS[tool] || BRUSH_PRESETS.pencil;
}

function clampBrushSize(size, preset) {
    return Math.max(preset.minSize, Math.min(size, preset.maxSize));
}

function effectiveBrushSize(size) {
    return Math.max(0.1, Number.isFinite(size) ? size : 1);
}

function getDoodleState() {
    return {
        canUndo: doodle.undoStack.length > 0,
        canRedo: doodle.redoStack.length > 0,
        dirty: doodle.strokes.length > 0 || doodle.bitmapLayers.length > 0,
        active: doodle.active,
        tool: doodle.currentTool,
        brush: { ...doodle.brush }
    };
}

function notifyDoodleStateChanged() {
    const stateJson = JSON.stringify(getDoodleState());
    if (stateJson === doodle.lastStateJson) return;
    doodle.lastStateJson = stateJson;
    if (window.AndroidBridge && window.AndroidBridge.onDoodleStateChanged) {
        window.AndroidBridge.onDoodleStateChanged(stateJson);
    }
}

function getDoodleJson() {
    return JSON.stringify({
        version: DOODLE_SCHEMA_VERSION,
        canvas: {
            width: window.innerWidth,
            height: window.innerHeight,
            dpr: window.devicePixelRatio || 1
        },
        strokes: doodle.strokes,
        bitmapLayers: doodle.bitmapLayers,
        updatedAt: Date.now()
    });
}

function loadDoodleJson(json) {
    if (!json || json === 'null') {
        doodle.strokes = [];
        doodle.bitmapLayers = [];
        queueDoodleRender();
        return;
    }
    try {
        const parsed = typeof json === 'string' ? JSON.parse(json) : json;
        doodle.strokes = Array.isArray(parsed.strokes) ? parsed.strokes : [];
        doodle.bitmapLayers = Array.isArray(parsed.bitmapLayers) ? parsed.bitmapLayers : [];
        doodle.undoStack = [];
        doodle.redoStack = [];
        queueDoodleRender();
        notifyDoodleStateChanged();
    } catch (error) {
        console.error('loadDoodleJson failed', error);
    }
}

function exportDoodleImage() {
    redrawDoodle();
    return doodle.canvas.toDataURL('image/png');
}

function mergeDoodle() {
    syncDoodleDataNode();
    notifyContentChanged();
}

function insertDoodleImage() {
    const image = document.createElement('img');
    image.src = exportDoodleImage();
    image.className = 'inserted-image doodle-export';
    image.style.maxWidth = '100%';
    image.style.cursor = 'pointer';
    bindImageClick(image);
    insertNodeAtSelection(image);
    notifyContentChanged();
}

function syncDoodleDataNode() {
    if (!paper) return;
    const json = getDoodleJson();
    let node = paper.querySelector(DOODLE_NODE_SELECTOR);
    const hasData = doodle.strokes.length > 0 || doodle.bitmapLayers.length > 0;
    if (!hasData) {
        node?.remove();
        return;
    }
    if (!node) {
        node = document.createElement('div');
        node.className = DOODLE_NODE_CLASS;
        node.contentEditable = 'false';
        paper.appendChild(node);
    }
    node.setAttribute('data-doodle-json', encodeURIComponent(json));
}

function persistDoodleChange() {
    syncDoodleDataNode();
    notifyContentChanged();
}

function extractDoodleDataNode() {
    const node = paper.querySelector(DOODLE_NODE_SELECTOR);
    if (!node) {
        loadDoodleJson('');
        return;
    }
    const encoded = node.getAttribute('data-doodle-json') || '';
    try {
        loadDoodleJson(decodeURIComponent(encoded));
    } catch (error) {
        loadDoodleJson('');
    }
}

// ==================== 贴纸和图片 ====================

function insertSticker(name) {
    const stickerMap = {
        heart: '❤️',
        star: '⭐',
        smile: '😊',
        flower: '🌸',
        sun: '☀️',
        moon: '🌙',
        cloud: '☁️',
        rain: '🌧️',
        snow: '❄️',
        leaf: '🍃',
        cat: '🐱',
        dog: '🐶',
        bird: '🐦',
        fish: '🐟',
        cake: '🎂',
        coffee: '☕',
        book: '📖',
        music: '🎵',
        sparkle: '✨',
        ribbon: '🎀'
    };
    const span = document.createElement('span');
    span.className = 'inserted-sticker';
    span.textContent = stickerMap[name] || stickerMap.star;
    span.contentEditable = 'false';
    insertNodeAtSelection(span);
    notifyContentChanged();
}

function insertImage(imageSrc) {
    if (!imageSrc) return;
    const image = document.createElement('img');
    image.src = imageSrc;
    image.className = 'inserted-image';
    image.style.maxWidth = '100%';
    image.style.display = 'block';
    image.style.cursor = 'pointer';
    bindImageClick(image);
    insertNodeAtSelection(image);
    notifyContentChanged();
}

function insertNodeAtSelection(node) {
    paper.focus();
    restoreSelection();
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (!paper.contains(range.commonAncestorContainer)) {
            paper.appendChild(node);
        } else {
            range.deleteContents();
            range.insertNode(node);
            range.setStartAfter(node);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
        }
    } else {
        paper.appendChild(node);
    }
    saveSelection();
    // Keep inserted media visible after picker returns focus.
    if (typeof node.scrollIntoView === 'function') {
        node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
}

function bindImageClick(image) {
    image.style.cursor = 'pointer';
    image.onclick = () => {
        try {
            if (window.AndroidBridge && window.AndroidBridge.onImageClicked) {
                window.AndroidBridge.onImageClicked(image.src);
            }
        } catch (error) {
            console.error(error);
        }
    };
}

function bindImageClickHandlers() {
    Array.from(paper.getElementsByTagName('img')).forEach(bindImageClick);
}

// ==================== 主题和内容 ====================

function applyTheme(isDark, bgColor, textColor, paperBgStart, paperBgMid, paperBgEnd, lineColor) {
    const root = document.documentElement;
    root.style.setProperty('--bg-color', bgColor);
    root.style.setProperty('--text-color', textColor);
    root.style.setProperty('--paper-bg-start', paperBgStart);
    root.style.setProperty('--paper-bg-mid', paperBgMid);
    root.style.setProperty('--paper-bg-end', paperBgEnd);
    root.style.setProperty('--line-color', lineColor);
}

function applyEditorSettings(fontSizeSp) {
    let size = parseInt(fontSizeSp, 10);
    if (Number.isNaN(size)) size = 16;
    document.documentElement.style.setProperty('--editor-font-size', `${Math.max(12, Math.min(size, 28))}px`);
}

function getContent() {
    syncDoodleDataNode();
    return paper.innerHTML;
}

function setContent(html) {
    paper.innerHTML = sanitizeEditorHtml(html || '');
    bindImageClickHandlers();
    extractDoodleDataNode();
    savedSelectionRange = null;
    requestAnimationFrame(() => {
        resizeDoodleCanvas();
        syncDoodleCanvasScroll();
    });
    // Do not notify Android here: native setContent already updates its content StateFlow.
    // Notifying would re-trigger autosave and re-migrate inline images into duplicate files.
}

function sanitizeEditorHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll(
        'script,iframe,object,embed,link,meta,base,form,input,button,textarea,select,foreignObject'
    ).forEach((node) => node.remove());
    template.content.querySelectorAll('*').forEach((node) => {
        Array.from(node.attributes).forEach((attribute) => {
            const name = attribute.name.toLowerCase();
            const value = attribute.value.trim().toLowerCase();
            const dangerousUrl = name === 'src' || name === 'href' || name === 'xlink:href';
            const unsafeFileUrl = dangerousUrl &&
                value.indexOf('file://') === 0 &&
                value.indexOf('/journal_media/') < 0;
            if (
                name.indexOf('on') === 0 ||
                name === 'srcdoc' ||
                (dangerousUrl && value.indexOf('javascript:') === 0) ||
                unsafeFileUrl ||
                (name === 'style' && (value.indexOf('url(') >= 0 || value.indexOf('expression(') >= 0))
            ) {
                node.removeAttribute(attribute.name);
            }
        });
    });
    return template.innerHTML;
}

function notifyContentChanged() {
    if (window.AndroidBridge && window.AndroidBridge.onContentChanged) {
        window.AndroidBridge.onContentChanged(paper.innerHTML);
    }
}

function round(value) {
    return Math.round(value * 100) / 100;
}

// Android evaluates these names directly, so keep them on window.
Object.assign(window, {
    applyEditorSettings,
    applyTheme,
    changeColor,
    changeFont,
    changeSize,
    clearDoodle,
    execCmd,
    exportDoodleImage,
    getContent,
    getDoodleJson,
    getDoodleState,
    insertDoodleImage,
    insertImage,
    insertSticker,
    loadDoodleJson,
    mergeDoodle,
    redoDoodle,
    setBrush,
    setBrushColor,
    setBrushRoughness,
    setBrushSize,
    setContent,
    setDoodleTool: setBrush,
    setBrushOptions: (optionsJson) => {
        const options = typeof optionsJson === 'string' ? JSON.parse(optionsJson) : optionsJson;
        if (options.color) setBrushColor(options.color);
        if (options.size || options.width) setBrushSize(options.size || options.width);
        if (options.roughness !== undefined) setBrushRoughness(options.roughness);
        if (options.tool) setBrush(options.tool);
    },
    toggleDoodleMode,
    undoDoodle
});

// ==================== editor core ====================

/*
 * 冷启动计时（v0.6.2 需求①「冷启动 ≤0.5s」）
 * -------------------------------------------------------------------------
 * window.__qiT0 在脚本开始执行的瞬间记录 performance.now()（该值本身是
 * 「从本次导航开始到现在」的毫秒数，包含 HTML/CSS/vendor 脚本解析时间）。
 * 首次绘制时把差值通过 postMessage({type:'boot', ms, navMs}) 回传给 RN，
 * EditorScreen 会打印 `[editor-boot] ...`。
 *
 * 真机测量方法（debug 包没有 Metro 也能用）：
 *   adb logcat -s ReactNativeJS:V | grep "\[editor-boot\]"
 * 其中 ms  = 脚本开始 → 首帧（editor.js 自身开销）
 *      navMs = 导航开始 → 首帧（整页冷启动，含 4 个 JS 文件解析）
 *      sinceMount = 点击进入 → 首帧（RN 侧视角，包含建 WebView 的开销）
 * 想测「点击到可见」的端到端时间，以 sinceMount 为准；目标 ≤500ms。
 */
window.__qiT0 = (window.performance && typeof window.performance.now === 'function')
    ? window.performance.now()
    : Date.now();
window.__qiBootReported = false;

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
let editorReadOnly = false;

/*
 * 文档级滚动（见 editor.css 顶部说明）。
 * 纸面不再是滚动容器，所以所有原先的 paper.scrollTop / scrollLeft 都必须
 * 走这两个 helper，否则多图页面里贴纸落点、涂鸦对齐、光标跟随都会错位。
 */
function getScrollTop() {
    if (typeof window.scrollY === 'number') {
        return Math.max(0, window.scrollY);
    }
    const scroller = document.scrollingElement || document.documentElement;
    return Math.max(0, (scroller && scroller.scrollTop) || document.body.scrollTop || 0);
}

function scrollDocumentBy(delta) {
    if (!delta) return;
    const next = Math.max(0, getScrollTop() + delta);
    window.scrollTo(0, next);
}

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

/**
 * 只读模式的稳定入口：
 * 1) URL 带 `?view=1`（或 `#view=1`，方便将来用 hash 路由）→ 直接只读；
 * 2) RN 侧再通过注入脚本调用 window.setReadOnly(true) 兜底；
 * 3) RN 也可以在运行中调用 setReadOnly(false) 退回编辑（例如「编辑」按钮）。
 */
function parseReadOnlyFromLocation() {
    const search = window.location.search || '';
    const hash = window.location.hash || '';
    return /(?:^|[?&])view=1(?:&|$)/.test(search) ||
        /(?:^|[#&])view=1(?:&|$)/.test(hash);
}

document.addEventListener('DOMContentLoaded', () => {
    paper = document.getElementById('paper');
    editorReadOnly = parseReadOnlyFromLocation();
    if (editorReadOnly) {
        enableViewMode();
    }
    initialiseDoodle();
    bindEditorEvents();
    if (editorReadOnly) {
        // The reader may still tap a picture, but stickers must never start a drag.
        bindImageClickHandlers();
    } else {
        bindStickerHandlers();
    }
    updateVisibleViewport();
    scheduleBootReport();
});

/* 首帧回传：双层 rAF 之后再读时间，基本覆盖「内容已绘制」的时刻。 */
function scheduleBootReport() {
    if (window.__qiBootReported) return;
    const raf = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 16));
    raf(() => raf(() => reportBootMetric()));
}

function reportBootMetric() {
    if (window.__qiBootReported) return;
    window.__qiBootReported = true;
    const now = (window.performance && typeof window.performance.now === 'function')
        ? window.performance.now()
        : Date.now();
    const payload = {
        type: 'boot',
        ms: Math.round(now - window.__qiT0),
        navMs: Math.round(now)
    };
    try {
        const paints = window.performance && window.performance.getEntriesByType
            ? window.performance.getEntriesByType('paint')
            : [];
        const firstPaint = paints.find((entry) => entry.name === 'first-contentful-paint') || paints[0];
        if (firstPaint) {
            payload.paintMs = Math.round(firstPaint.startTime);
        }
    } catch (error) {
        // Paint Timing API is optional.
    }
    // 页面内也打一条，便于 chrome://inspect 直接看。
    try {
        console.log(`[editor-boot] page ms=${payload.ms} navMs=${payload.navMs}`);
    } catch (error) {
        // console may be unavailable.
    }
    postToNative(payload);
}

/* 首次绘制「有正文」的帧：RN 侧据此判断用户真正看到日记的时刻。 */
function reportContentMetric() {
    if (window.__qiContentReported) return;
    window.__qiContentReported = true;
    const now = (window.performance && typeof window.performance.now === 'function')
        ? window.performance.now()
        : Date.now();
    try {
        console.log(`[editor-boot] content ms=${Math.round(now - window.__qiT0)}`);
    } catch (error) {
        // console may be unavailable.
    }
    postToNative({
        type: 'boot-content',
        ms: Math.round(now - window.__qiT0),
        navMs: Math.round(now)
    });
}


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
    // 文档滚动时同步涂鸦画布位移（纸面不再滚动，window 才是滚动源）。
    window.addEventListener('scroll', syncDoodleCanvasScroll, { passive: true });
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

// ==================== keyboard and caret ====================

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
        scrollDocumentBy(rect.bottom - visibleBottom + margin);
    } else if (rect.top < visibleTop + margin) {
        scrollDocumentBy(rect.top - visibleTop - margin);
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

// ==================== selection ====================

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

// ==================== selection ====================

function execCmd(command, value) {
    if (editorReadOnly) return;
    paper.focus();
    restoreSelection();
    document.execCommand(command, false, value || null);
    saveSelection();
    notifyContentChanged();
}

function changeFont(fontName) {
    if (editorReadOnly) return;
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
    if (editorReadOnly) return;
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
        const sizeAttr = font.getAttribute('size');
        const faceAttr = font.getAttribute('face');
        const colorAttr = font.getAttribute('color');
        if (sizeAttr) {
            span.style.fontSize = sizeMap[sizeAttr] || '16px';
        }
        if (faceAttr) {
            span.style.fontFamily = faceAttr;
        }
        if (colorAttr) {
            span.style.color = colorAttr;
        }
        // Preserve styles already present on the font tag.
        if (font.style && font.style.cssText) {
            Array.from(font.style).forEach((prop) => {
                span.style.setProperty(prop, font.style.getPropertyValue(prop));
            });
        }
        span.innerHTML = font.innerHTML;
        font.parentNode.replaceChild(span, font);
    });
    notifyContentChanged();
}

function changeColor(color) {
    if (editorReadOnly) return;
    paper.focus();
    restoreSelection();
    document.execCommand('foreColor', false, color);
    saveSelection();
    notifyContentChanged();
}

// ==================== doodle layer ====================

function hasDoodleArtwork() {
    return doodle.strokes.length > 0 || doodle.bitmapLayers.length > 0;
}

function initialiseDoodle() {
    doodle.canvas = document.getElementById('doodle-canvas');
    resizeDoodleCanvas();
    if (editorReadOnly) {
        // 只读页不需要手写引擎（Atrament/rough）：跳过初始化，冷启动更快。
        // 但画布必须保留 —— 旧日记的涂鸦（data-doodle-json）要靠它重放，
        // 见 loadDoodleJson()。画布本身 pointer-events:none，不拦截滚动。
        return;
    }
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
    // 只读页没有涂鸦时不分配大画布（全页 backing store 可达数十 MB）；
    // 有涂鸦时必须分配，否则旧笔迹无处重放。
    if (document.body.classList.contains('view-mode') && !hasDoodleArtwork()) {
        return;
    }
    const ratio = window.devicePixelRatio || 1;
    const contentHeight = Math.max(
        window.innerHeight,
        document.documentElement ? document.documentElement.scrollHeight : 0,
        paper ? paper.scrollHeight : window.innerHeight
    );
    // Cap the backing store so a long page cannot allocate an enormous bitmap.
    const maxSide = 4096;
    const width = Math.max(1, Math.min(maxSide, Math.floor(window.innerWidth * ratio)));
    const height = Math.max(1, Math.min(maxSide, Math.ceil(contentHeight * ratio)));
    doodle.canvas.width = width;
    doodle.canvas.height = height;
    doodle.canvas.style.width = `${window.innerWidth}px`;
    doodle.canvas.style.height = `${contentHeight}px`;
    syncDoodleCanvasScroll();
    queueDoodleRender();
}

function syncDoodleCanvasScroll() {
    if (!paper || !doodle.canvas) return;
    // 画布固定在视口上，用 translateY 抵消文档滚动，笔迹才和正文对齐。
    doodle.canvas.style.transform = `translateY(${-getScrollTop()}px)`;
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
    // 只读模式下涂鸦必须彻底关闭：它会把 contentEditable 改回 true 并锁死滚动。
    if (editorReadOnly) return;
    doodle.active = active;
    doodle.canvas.classList.toggle('active', active);
    paper.contentEditable = String(!active);
    if (doodle.atrament) {
        doodle.atrament.mode = active ? atramentModeForTool(doodle.currentTool) : MODE_DISABLED;
    }
    if (active) {
        deselectSticker();
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
        if (editorReadOnly && hasDoodleArtwork()) {
            // 只读：没有 Atrament 画布交互，直接按当前文档高度重放笔迹。
            resizeDoodleCanvas();
            redrawDoodle();
        } else {
            queueDoodleRender();
        }
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
    if (editorReadOnly) return;
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

// ==================== stickers and images ====================

const STICKER_CLASS = 'journal-sticker';
const STICKER_SELECTOR = `.${STICKER_CLASS}`;
const LEGACY_STICKER_SELECTOR = '.inserted-sticker';
const DEFAULT_STICKER_SIZE = 72;
const CUSTOM_STICKER_SIZE = 112;
const STICKER_MAP = {
    heart: '\u2764\uFE0F',
    star: '\u2B50',
    smile: '\uD83D\uDE0A',
    flower: '\uD83C\uDF38',
    sun: '\u2600\uFE0F',
    moon: '\uD83C\uDF19',
    cloud: '\u2601\uFE0F',
    rain: '\uD83C\uDF27\uFE0F',
    snow: '\u2744\uFE0F',
    leaf: '\uD83C\uDF43',
    cat: '\uD83D\uDC31',
    dog: '\uD83D\uDC36',
    bird: '\uD83D\uDC26',
    fish: '\uD83D\uDC1F',
    cake: '\uD83C\uDF82',
    coffee: '\u2615',
    book: '\uD83D\uDCD6',
    music: '\uD83C\uDFB5',
    sparkle: '\u2728',
    ribbon: '\uD83C\uDF80'
};

let stickerMoveable = null;
let selectedSticker = null;
let stickerDragOrigin = null;
let stickerHandlersBound = false;
/** In-memory only - never persist to HTML (data-sticker-bound broke re-bind after setContent). */
const boundStickers = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
const boundStickerFallback = boundStickers ? null : [];

function markStickerBound(sticker) {
    if (boundStickers) {
        boundStickers.add(sticker);
    } else if (boundStickerFallback && boundStickerFallback.indexOf(sticker) < 0) {
        boundStickerFallback.push(sticker);
    }
}

function isStickerBound(sticker) {
    if (boundStickers) return boundStickers.has(sticker);
    return !!(boundStickerFallback && boundStickerFallback.indexOf(sticker) >= 0);
}

function notifyStickerGesture(active) {
    try {
        if (window.AndroidBridge && window.AndroidBridge.setStickerGestureActive) {
            window.AndroidBridge.setStickerGestureActive(!!active);
        }
    } catch (error) {
        console.error(error);
    }
}

function createStickerId() {
    return `stk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseStickerRotate(target) {
    if (!target) return 0;
    const fromData = parseFloat(target.getAttribute('data-rotate') || '');
    if (!Number.isNaN(fromData)) return fromData;
    const match = String(target.style.transform || '').match(/rotate\((-?[\d.]+)deg\)/i);
    return match ? parseFloat(match[1]) : 0;
}

function applyStickerVisual(target, rotateDeg) {
    const rotate = Number.isFinite(rotateDeg) ? rotateDeg : parseStickerRotate(target);
    target.setAttribute('data-rotate', String(round(rotate)));
    target.style.transform = `rotate(${round(rotate)}deg)`;
    target.style.transformOrigin = 'center center';
}

function clearStickerDragStyles(target) {
    if (!target) return;
    target.classList.remove('is-dragging');
}

function paperLocalPoint(clientX, clientY) {
    // getBoundingClientRect 已经包含文档滚动量；再加 scrollTop 会重复计算。
    const paperRect = paper.getBoundingClientRect();
    return {
        x: clientX - paperRect.left,
        y: clientY - paperRect.top
    };
}

function clampStickerPosition(left, top, width, height) {
    const maxLeft = Math.max(0, paper.clientWidth - Math.max(24, width * 0.35));
    const minTop = 0;
    const maxTop = Math.max(minTop, Math.max(paper.scrollHeight, paper.clientHeight) + 400);
    return {
        left: Math.min(Math.max(0, left), maxLeft),
        top: Math.min(Math.max(minTop, top), maxTop)
    };
}

function commitStickerPosition(target, left, top) {
    const width = target.offsetWidth || parseFloat(target.style.width) || DEFAULT_STICKER_SIZE;
    const height = target.offsetHeight || parseFloat(target.style.height) || DEFAULT_STICKER_SIZE;
    const clamped = clampStickerPosition(left, top, width, height);
    target.style.position = 'absolute';
    target.style.left = `${round(clamped.left)}px`;
    target.style.top = `${round(clamped.top)}px`;
    target.style.float = 'none';
    target.style.margin = '0';
    target.setAttribute('data-left', String(round(clamped.left)));
    target.setAttribute('data-top', String(round(clamped.top)));
    ensurePaperFitsStickers();
}

function defaultInsertPosition(size) {
    const x = Math.max(16, (paper.clientWidth - size) / 2);
    // 文档滚动时「当前视口中心」= 滚动量 + 视口高度的一半附近。
    const y = getScrollTop() + Math.max(24, window.innerHeight * 0.28);
    return clampStickerPosition(x, y, size, size);
}

function ensurePaperFitsStickers() {
    if (!paper) return;
    let maxBottom = Math.max(window.innerHeight, paper.clientHeight);
    Array.from(paper.querySelectorAll(STICKER_SELECTOR)).forEach((node) => {
        const top = parseFloat(node.style.top || node.getAttribute('data-top') || '0');
        const height = node.offsetHeight || parseFloat(node.style.height) || DEFAULT_STICKER_SIZE;
        maxBottom = Math.max(maxBottom, top + height + 48);
    });
    const needed = Math.ceil(maxBottom);
    const current = parseFloat(paper.style.minHeight || '0') || 0;
    if (needed > current) {
        // 只增不减：贴纸永远在纸面范围内，可随文档一起滚动。
        paper.style.minHeight = `${needed}px`;
    }
    resizeDoodleCanvas();
}

function migrateStickerToAbsolute(sticker) {
    if (!sticker) return;
    sticker.style.float = 'none';
    sticker.style.margin = '0';
    sticker.style.shapeOutside = 'none';
    const hasLeft = sticker.style.left || sticker.getAttribute('data-left');
    const hasTop = sticker.style.top || sticker.getAttribute('data-top');
    if (hasLeft && hasTop) {
        const left = parseFloat(sticker.style.left || sticker.getAttribute('data-left') || '0');
        const top = parseFloat(sticker.style.top || sticker.getAttribute('data-top') || '0');
        commitStickerPosition(sticker, left, top);
        applyStickerVisual(sticker, parseStickerRotate(sticker));
        return;
    }
    // Legacy float stickers: convert current visual rect into absolute coords.
    const rect = sticker.getBoundingClientRect();
    const local = paperLocalPoint(rect.left, rect.top);
    commitStickerPosition(sticker, local.x, local.y);
    applyStickerVisual(sticker, parseStickerRotate(sticker));
}

function buildStickerShell(kind, size) {
    const shell = document.createElement('span');
    shell.className = STICKER_CLASS;
    shell.contentEditable = 'false';
    shell.setAttribute('data-sticker-id', createStickerId());
    shell.setAttribute('data-sticker-kind', kind);
    shell.setAttribute('data-rotate', '0');
    shell.style.width = `${size}px`;
    shell.style.height = `${size}px`;
    shell.style.display = 'flex';
    const pos = defaultInsertPosition(size);
    commitStickerPosition(shell, pos.left, pos.top);
    applyStickerVisual(shell, 0);
    return shell;
}

function buildEmojiSticker(emoji, size) {
    const shell = buildStickerShell('emoji', size || DEFAULT_STICKER_SIZE);
    const label = document.createElement('span');
    label.className = 'journal-sticker__emoji';
    label.textContent = emoji;
    shell.appendChild(label);
    return shell;
}

function buildImageSticker(imageSrc, size) {
    const shell = buildStickerShell('image', size || CUSTOM_STICKER_SIZE);
    const image = document.createElement('img');
    image.className = 'journal-sticker__media';
    image.src = imageSrc;
    image.alt = 'sticker';
    image.draggable = false;
    shell.appendChild(image);
    return shell;
}

function insertSticker(name) {
    if (editorReadOnly) return;
    const emoji = STICKER_MAP[name] || STICKER_MAP.star;
    const sticker = buildEmojiSticker(emoji, DEFAULT_STICKER_SIZE);
    paper.appendChild(sticker);
    bindStickerNode(sticker);
    selectSticker(sticker);
    ensurePaperFitsStickers();
    notifyContentChanged();
}

function insertCustomSticker(imageSrc) {
    if (editorReadOnly) return;
    if (!imageSrc) return;
    const sticker = buildImageSticker(imageSrc, CUSTOM_STICKER_SIZE);
    paper.appendChild(sticker);
    bindStickerNode(sticker);
    selectSticker(sticker);
    ensurePaperFitsStickers();
    notifyContentChanged();
}

function insertImage(imageSrc) {
    if (editorReadOnly) return;
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
    if (typeof node.scrollIntoView === 'function') {
        node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
}

function bindImageClick(image) {
    if (!image || image.classList.contains('journal-sticker__media') || image.closest(STICKER_SELECTOR)) {
        return;
    }
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

function getStickerDeleteButton() {
    return document.getElementById('sticker-delete-btn');
}

function updateStickerDeleteButton() {
    const btn = getStickerDeleteButton();
    if (!btn) return;
    if (!selectedSticker || doodle.active) {
        btn.style.display = 'none';
        return;
    }
    const rect = selectedSticker.getBoundingClientRect();
    btn.style.display = 'flex';
    btn.style.left = `${Math.round(rect.right - 10)}px`;
    btn.style.top = `${Math.round(rect.top - 14)}px`;
}

function ensureStickerMoveable() {
    if (stickerMoveable) return stickerMoveable;
    const MoveableExport = window.Moveable;
    const MoveableCtor = typeof MoveableExport === 'function'
        ? MoveableExport
        : (MoveableExport && typeof MoveableExport.default === 'function' ? MoveableExport.default : null);
    if (typeof MoveableCtor !== 'function') {
        console.warn('Moveable is unavailable');
        return null;
    }
    stickerMoveable = new MoveableCtor(document.body, {
        target: null,
        container: document.body,
        rootContainer: document.body,
        draggable: true,
        resizable: true,
        rotatable: true,
        keepRatio: true,
        origin: false,
        edge: false,
        throttleDrag: 0,
        throttleResize: 0,
        throttleRotate: 0,
        checkInput: true,
        pinchable: false,
        preventClickEventOnDrag: true,
        individualGroupable: false
    });

    stickerMoveable
        .on('dragStart', ({ target, set }) => {
            notifyStickerGesture(true);
            // Always single-target; never group nearby stickers.
            if (stickerMoveable) stickerMoveable.target = target;
            const left = parseFloat(target.style.left || target.getAttribute('data-left') || '0');
            const top = parseFloat(target.style.top || target.getAttribute('data-top') || '0');
            stickerDragOrigin = {
                rotate: parseStickerRotate(target),
                startLeft: left,
                startTop: top
            };
            target.classList.add('is-dragging');
            target.style.zIndex = '40';
            applyStickerVisual(target, stickerDragOrigin.rotate);
            if (typeof set === 'function') set({ translate: [0, 0] });
            updateStickerDeleteButton();
        })
        .on('drag', ({ target, beforeTranslate }) => {
            if (!stickerDragOrigin) return;
            const nextLeft = stickerDragOrigin.startLeft + beforeTranslate[0];
            const nextTop = stickerDragOrigin.startTop + beforeTranslate[1];
            commitStickerPosition(target, nextLeft, nextTop);
            target.style.transform = `rotate(${round(stickerDragOrigin.rotate)}deg)`;
            updateStickerDeleteButton();
        })
        .on('dragEnd', ({ target }) => {
            const rotate = stickerDragOrigin ? stickerDragOrigin.rotate : parseStickerRotate(target);
            clearStickerDragStyles(target);
            const left = parseFloat(target.style.left || '0');
            const top = parseFloat(target.style.top || '0');
            commitStickerPosition(target, left, top);
            applyStickerVisual(target, rotate);
            stickerDragOrigin = null;
            selectSticker(target);
            if (stickerMoveable) {
                stickerMoveable.target = target;
                stickerMoveable.updateRect();
            }
            updateStickerDeleteButton();
            notifyContentChanged();
        })
        .on('resizeStart', ({ target }) => {
            notifyStickerGesture(true);
            if (stickerMoveable) stickerMoveable.target = target;
        })
        .on('resize', ({ target, width, height, drag }) => {
            target.style.width = `${Math.max(36, Math.round(width))}px`;
            target.style.height = `${Math.max(36, Math.round(height))}px`;
            const rotate = parseStickerRotate(target);
            if (drag && drag.beforeTranslate) {
                const baseLeft = parseFloat(target.getAttribute('data-left') || target.style.left || '0');
                const baseTop = parseFloat(target.getAttribute('data-top') || target.style.top || '0');
                commitStickerPosition(
                    target,
                    baseLeft + drag.beforeTranslate[0],
                    baseTop + drag.beforeTranslate[1]
                );
            }
            applyStickerVisual(target, rotate);
            updateStickerDeleteButton();
        })
        .on('resizeEnd', ({ target }) => {
            applyStickerVisual(target, parseStickerRotate(target));
            const left = parseFloat(target.style.left || '0');
            const top = parseFloat(target.style.top || '0');
            commitStickerPosition(target, left, top);
            if (stickerMoveable) {
                stickerMoveable.target = target;
                stickerMoveable.updateRect();
            }
            updateStickerDeleteButton();
            notifyContentChanged();
            notifyStickerGesture(!!selectedSticker);
        })
        .on('rotateStart', ({ target }) => {
            notifyStickerGesture(true);
            if (stickerMoveable) stickerMoveable.target = target;
        })
        .on('rotate', ({ target, rotate, dist, delta }) => {
            let next = typeof rotate === 'number' ? rotate : NaN;
            if (Number.isNaN(next) && typeof dist === 'number') {
                next = parseStickerRotate(target) + dist;
            }
            if (Number.isNaN(next) && typeof delta === 'number') {
                next = parseStickerRotate(target) + delta;
            }
            if (Number.isNaN(next)) next = parseStickerRotate(target);
            applyStickerVisual(target, next);
            updateStickerDeleteButton();
        })
        .on('rotateEnd', ({ target }) => {
            applyStickerVisual(target, parseStickerRotate(target));
            if (stickerMoveable) {
                stickerMoveable.target = target;
                stickerMoveable.updateRect();
            }
            updateStickerDeleteButton();
            notifyContentChanged();
            notifyStickerGesture(!!selectedSticker);
        });

    return stickerMoveable;
}

function selectSticker(sticker) {
    if (editorReadOnly) return;
    if (!sticker || doodle.active) return;
    ensureStickerMoveable();
    if (selectedSticker && selectedSticker !== sticker) {
        selectedSticker.classList.remove('is-selected');
        clearStickerDragStyles(selectedSticker);
    }
    selectedSticker = sticker;
    sticker.classList.add('is-selected');
    // Bring selected sticker above siblings to avoid sticky hit-testing.
    const maxZ = Array.from(paper.querySelectorAll(STICKER_SELECTOR)).reduce((max, node) => {
        const z = parseInt(node.style.zIndex || '5', 10);
        return Number.isFinite(z) ? Math.max(max, z) : max;
    }, 5);
    sticker.style.zIndex = String(maxZ + 1);
    if (stickerMoveable) {
        // Force a single HTMLElement target (never an array / group).
        stickerMoveable.target = sticker;
        stickerMoveable.updateRect();
    }
    notifyStickerGesture(true);
    updateStickerDeleteButton();
}

function deselectSticker() {
    if (selectedSticker) {
        clearStickerDragStyles(selectedSticker);
        selectedSticker.classList.remove('is-selected');
    }
    selectedSticker = null;
    if (stickerMoveable) {
        stickerMoveable.target = null;
    }
    notifyStickerGesture(false);
    updateStickerDeleteButton();
}

function deleteSelectedSticker() {
    if (!selectedSticker) return false;
    const node = selectedSticker;
    deselectSticker();
    node.remove();
    ensurePaperFitsStickers();
    notifyContentChanged();
    return true;
}

function bindStickerNode(sticker) {
    if (!sticker) return;
    if (editorReadOnly) return;
    sticker.removeAttribute('data-sticker-bound');
    if (isStickerBound(sticker)) return;
    markStickerBound(sticker);
    sticker.addEventListener('pointerdown', (event) => {
        if (doodle.active) return;
        event.preventDefault();
        event.stopPropagation();
        notifyStickerGesture(true);
        selectSticker(sticker);
        if (stickerMoveable && typeof stickerMoveable.dragStart === 'function') {
            try {
                stickerMoveable.dragStart(event);
            } catch (error) {
                console.error(error);
            }
        }
    }, { capture: true });
}

function upgradeLegacyStickers() {
    Array.from(paper.querySelectorAll(LEGACY_STICKER_SELECTOR)).forEach((node) => {
        if (node.classList.contains(STICKER_CLASS)) {
            node.classList.remove('inserted-sticker');
            return;
        }
        const emoji = (node.textContent || '').trim() || STICKER_MAP.star;
        const upgraded = buildEmojiSticker(emoji, DEFAULT_STICKER_SIZE);
        // Preserve approximate position of legacy inline emoji if possible.
        const rect = node.getBoundingClientRect();
        if (rect.width > 0) {
            const local = paperLocalPoint(rect.left, rect.top);
            commitStickerPosition(upgraded, local.x, local.y);
        }
        node.replaceWith(upgraded);
    });
}

function isMoveableUiEvent(event) {
    const target = event.target;
    if (!target || !target.closest) return false;
    return !!(
        target.closest('.moveable-control-box') ||
        target.closest('.moveable-area') ||
        target.closest('.moveable-control') ||
        target.closest('.moveable-line') ||
        target.closest('.moveable-direction') ||
        target.closest('.moveable-rotation') ||
        target.closest('#sticker-delete-btn')
    );
}

function bindStickerHandlers() {
    if (editorReadOnly) return;
    upgradeLegacyStickers();
    Array.from(paper.querySelectorAll(STICKER_SELECTOR)).forEach((sticker) => {
        sticker.removeAttribute('data-sticker-bound');
        if (!sticker.getAttribute('data-sticker-id')) {
            sticker.setAttribute('data-sticker-id', createStickerId());
        }
        if (!sticker.getAttribute('data-sticker-kind')) {
            const kind = sticker.querySelector('.journal-sticker__media') ? 'image' : 'emoji';
            sticker.setAttribute('data-sticker-kind', kind);
        }
        migrateStickerToAbsolute(sticker);
        bindStickerNode(sticker);
    });
    ensurePaperFitsStickers();
    updateStickerDeleteButton();

    if (stickerHandlersBound) return;
    stickerHandlersBound = true;

    // 删除按钮是 position:fixed，文档滚动后必须重算位置，否则会飘在原地。
    window.addEventListener('scroll', () => {
        if (selectedSticker) {
            updateStickerDeleteButton();
        }
    }, { passive: true });

    const deleteBtn = getStickerDeleteButton();
    if (deleteBtn) {
        deleteBtn.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            deleteSelectedSticker();
        });
    }

    paper.addEventListener('pointerdown', (event) => {
        if (doodle.active) return;
        if (isMoveableUiEvent(event)) return;
        const hit = event.target && event.target.closest
            ? event.target.closest(STICKER_SELECTOR)
            : null;
        if (!hit) {
            deselectSticker();
        }
    });

    paper.addEventListener('scroll', () => {
        if (selectedSticker) updateStickerDeleteButton();
    });

    document.addEventListener('pointerdown', (event) => {
        if (doodle.active) return;
        if (isMoveableUiEvent(event)) {
            notifyStickerGesture(true);
        }
    }, true);

    document.addEventListener('pointerup', () => {
        if (!stickerDragOrigin) {
            notifyStickerGesture(!!selectedSticker);
        }
    }, true);

    document.addEventListener('keydown', (event) => {
        if (!selectedSticker || doodle.active) return;
        if (event.key === 'Backspace' || event.key === 'Delete') {
            event.preventDefault();
            deleteSelectedSticker();
        } else if (event.key === 'Escape') {
            deselectSticker();
        }
    });
}

// ==================== section ====================

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
    // Never persist ephemeral bind flags.
    Array.from(paper.querySelectorAll(STICKER_SELECTOR)).forEach((node) => {
        node.removeAttribute('data-sticker-bound');
    });
    return paper.innerHTML;
}

function setContent(html) {
    deselectSticker();
    paper.innerHTML = sanitizeEditorHtml(html || '');
    if (editorReadOnly) {
        // 旧数据可能内联 contenteditable，只读时必须清理干净（否则长按弹键盘）。
        Array.from(paper.querySelectorAll('[contenteditable]')).forEach((node) => {
            node.setAttribute('contenteditable', 'false');
        });
        paper.setAttribute('contenteditable', 'false');
    }
    bindImageClickHandlers();
    if (!document.body.classList.contains('view-mode')) {
        bindStickerHandlers();
    }
    extractDoodleDataNode();
    savedSelectionRange = null;
    requestAnimationFrame(() => {
        // 只读页也要同步：旧涂鸦需要按正文高度重放并跟随文档滚动。
        resizeDoodleCanvas();
        syncDoodleCanvasScroll();
        // 第一次真正有正文的绘制：这是用户「看到日记内容」的时刻。
        reportContentMetric();
        // Tell native the first paint is done so the loading veil can go away
        // immediately instead of waiting for a fixed timeout.
        postToNative({type: 'painted'});
    });
    // Do not notify Android here: native setContent already updates its content StateFlow.
    // Notifying would re-trigger autosave and re-migrate inline images into duplicate files.
}

function postToNative(payload) {
    try {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        }
    } catch (error) {
        // Bridge is optional (for example when the page is opened in a browser).
    }
}

/**
 * Read-only presentation mode (`editor.html?view=1`):
 * the very same document/CSS renders the journal, so images, stickers and
 * doodles look identical to the editor, but nothing is editable.
 *
 * v0.6.2：只读入口统一为 window.setReadOnly(true)，URL 的 ?view=1 只是
 * 「冷启动即只读」的快捷方式；两者最终都走这里，保证：
 *   - 所有 contenteditable 被显式设为 false（长按不弹键盘、不出光标）
 *   - 涂鸦画布/贴纸拖拽手柄/删除按钮全部隐藏
 *   - body / html 的 overflow 恢复，避免涂鸦模式遗留的 overflow:hidden 卡死滚动
 */
function enableViewMode() {
    editorReadOnly = true;
    document.body.classList.add('view-mode');
    document.documentElement.classList.remove('qi-view-pending');
    if (paper) {
        // 显式 false（不是 removeAttribute）：需求要求只读时 contenteditable
        // 全为 false；contenteditable=false 不会触发 IME，长按不弹键盘。
        paper.setAttribute('contenteditable', 'false');
        paper.blur();
    }
    // 旧数据里可能残留内联 contenteditable，一并清掉。
    Array.from(document.querySelectorAll('[contenteditable]')).forEach((node) => {
        if (node === paper) return;
        node.setAttribute('contenteditable', 'false');
    });
    if (typeof deselectSticker === 'function') {
        deselectSticker();
    }
    // 画布保留（可见）以重放旧涂鸦；只关掉交互，绝不吃滚动事件。
    const canvasEl = doodle.canvas || document.getElementById('doodle-canvas');
    if (canvasEl) {
        doodle.active = false;
        canvasEl.classList.remove('active');
        canvasEl.style.display = '';
        canvasEl.style.pointerEvents = 'none';
    }
    if (doodle.atrament) {
        doodle.atrament.mode = MODE_DISABLED;
    }
    const deleteButton = document.getElementById('sticker-delete-btn');
    if (deleteButton) {
        deleteButton.style.display = 'none';
    }
    // 涂鸦模式可能把滚动锁死；只读页必须永远可滚动。
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
}

/**
 * 退回编辑态（同一个 WebView 里由「编辑」按钮触发）。调用方需要在入口处
 * 重新加载或显式调用 window.setReadOnly(false)；这里保持页面状态不重载。
 */
function leaveViewMode() {
    editorReadOnly = false;
    document.body.classList.remove('view-mode');
    document.documentElement.classList.remove('qi-view-pending');
    if (paper) {
        paper.setAttribute('contenteditable', 'true');
    }
    if (doodle.canvas) {
        doodle.canvas.style.display = '';
    }
    if (!doodle.atrament) {
        // 只读启动时跳过了 Atrament 构造，回到编辑态时再补建。
        createAtrament();
        applyBrushOptions();
    }
    const canvasEl = document.getElementById('doodle-canvas');
    if (canvasEl) {
        canvasEl.style.display = '';
    }
    const deleteButton = document.getElementById('sticker-delete-btn');
    if (deleteButton) {
        deleteButton.style.display = '';
    }
    bindStickerHandlers();
    resizeDoodleCanvas();
    syncDoodleCanvasScroll();
}

function setReadOnly(flag) {
    if (flag) {
        enableViewMode();
    } else {
        leaveViewMode();
    }
    return editorReadOnly;
}

function isReadOnly() {
    return editorReadOnly;
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
    insertCustomSticker,
    insertSticker,
    loadDoodleJson,
    mergeDoodle,
    redoDoodle,
    setBrush,
    setBrushColor,
    setBrushRoughness,
    setBrushSize,
    setContent,
    // 只读接口：RN 侧注入脚本兜底调用，URL ?view=1 只是冷启动快捷方式。
    setReadOnly,
    isReadOnly,
    leaveViewMode,
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

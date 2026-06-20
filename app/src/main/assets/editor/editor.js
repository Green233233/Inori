// ==================== 编辑器核心 ====================
let currentMode = 'text'; // text, doodle
let isDoodleActive = false;

// 涂鸦相关
let canvas, ctx;
let drawing = false;
let brushType = 'pencil';
let brushSize = 3;
let brushColor = '#000000';
let doodleHistory = [];
let doodleRedoStack = [];
let currentPath = [];

// 选区保存（用于文字格式化）
let savedSelectionRange = null;

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    canvas = document.getElementById('doodle-canvas');
    // 使用高分辨率画布，考虑设备像素比以提升涂鸦清晰度
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    // 涂鸦触摸事件 - passive:false 以便 preventDefault
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', endDraw, { passive: false });
    canvas.addEventListener('touchcancel', endDraw, { passive: false });
    canvas.addEventListener('mousedown', startDrawMouse);
    canvas.addEventListener('mousemove', drawMouse);
    canvas.addEventListener('mouseup', endDraw);
    canvas.addEventListener('mouseleave', endDraw);

    // 启用 CSS 样式模式，使得 execCommand 使用内联 CSS 而非 <font> 等过时标签
    try { document.execCommand('styleWithCSS', false, true); } catch (e) { /* 某些 WebView 版本可能不支持 */ }

    // 内容变化监听
    var paper = document.getElementById('paper');
    paper.addEventListener('input', function() {
        notifyContentChanged();
    });
    
    // 保存选区（每次选区变化时保存）
    document.addEventListener('selectionchange', function() {
        var sel = window.getSelection();
        if (sel.rangeCount > 0) {
            var range = sel.getRangeAt(0);
            // 只保存在 paper 内的选区
            if (paper.contains(range.commonAncestorContainer)) {
                savedSelectionRange = range.cloneRange();
            }
        }
    });
});

function resizeCanvas() {
    // 保存当前涂鸦数据
    var tempHistory = doodleHistory.slice();
    // 使用 devicePixelRatio 来设置更高的像素分辨率
    var ratio = window.devicePixelRatio || 1;
    var w = window.innerWidth;
    var h = window.innerHeight;
    canvas.width = Math.floor(w * ratio);
    canvas.height = Math.floor(h * ratio);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    // 缩放上下文以便后续绘制使用 CSS 像素坐标
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    // 重绘
    doodleHistory = tempHistory;
    redrawDoodle();
}

// ==================== 选区管理 ====================
function saveSelection() {
    var sel = window.getSelection();
    if (sel.rangeCount > 0) {
        var range = sel.getRangeAt(0);
        var paper = document.getElementById('paper');
        if (paper.contains(range.commonAncestorContainer)) {
            savedSelectionRange = range.cloneRange();
        }
    }
}

function restoreSelection() {
    if (savedSelectionRange) {
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedSelectionRange);
    }
}

// ==================== 文字编辑命令 ====================
function execCmd(command, value) {
    var paper = document.getElementById('paper');
    paper.focus();
    restoreSelection();
    document.execCommand(command, false, value || null);
    saveSelection();
    notifyContentChanged();
}

function changeFont(fontName) {
    var paper = document.getElementById('paper');
    paper.focus();
    restoreSelection();
    var fontMap = {
        'handwrite': 'handwrite, serif',
        'serif': 'serif, Songti SC, SimSun',
        'sans-serif': 'sans-serif, PingFang SC, Microsoft YaHei'
    };
    // 使用 span 包裹并设置 style 字体族以避免 <font> 标签问题
    var family = fontMap[fontName] || fontName;
    document.execCommand('fontName', false, family);
    saveSelection();
    notifyContentChanged();
}

function changeSize(size) {
    var paper = document.getElementById('paper');
    paper.focus();
    restoreSelection();
    // fontSize 的返回标签可能为 <font size="N">，为保证可控性，改为使用 span 和 style
    try {
        document.execCommand('fontSize', false, size);
        // 将 font[size] 转换为 span style（延迟执行以等 execCommand 完成）
        setTimeout(function() {
            var fonts = paper.getElementsByTagName('font');
            for (var i = fonts.length - 1; i >= 0; i--) {
                var f = fonts[i];
                var sz = f.getAttribute('size');
                var px = '16px';
                // 映射常见 size 值到像素（可根据需要调整）
                if (sz === '1') px = '12px';
                else if (sz === '2') px = '14px';
                else if (sz === '3') px = '16px';
                else if (sz === '4') px = '18px';
                else if (sz === '5') px = '20px';
                else if (sz === '6') px = '22px';
                else if (sz === '7') px = '24px';
                var span = document.createElement('span');
                span.style.fontSize = px;
                span.innerHTML = f.innerHTML;
                f.parentNode.replaceChild(span, f);
            }
        }, 50);
    } catch (e) {
        document.execCommand('fontSize', false, size);
    }
    saveSelection();
    notifyContentChanged();
}

function changeColor(color) {
    var paper = document.getElementById('paper');
    paper.focus();
    restoreSelection();
    document.execCommand('foreColor', false, color);
    saveSelection();
    notifyContentChanged();
}

// ==================== 涂鸦功能 ====================
function startDraw(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!isDoodleActive) return;
    drawing = true;
    var touch = e.touches[0];
    var rect = canvas.getBoundingClientRect();
    var x = touch.clientX - rect.left;
    var y = touch.clientY - rect.top;
    currentPath = [{ x: x, y: y }];
    ctx.beginPath();
    ctx.moveTo(x, y);
}

function draw(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!drawing || !isDoodleActive) return;
    var touch = e.touches[0];
    var rect = canvas.getBoundingClientRect();
    var x = touch.clientX - rect.left;
    var y = touch.clientY - rect.top;
    currentPath.push({ x: x, y: y });
    applyBrushStyle();
    ctx.lineTo(x, y);
    ctx.stroke();
}

function startDrawMouse(e) {
    if (!isDoodleActive) return;
    e.preventDefault();
    drawing = true;
    var rect = canvas.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;
    currentPath = [{ x: x, y: y }];
    ctx.beginPath();
    ctx.moveTo(x, y);
}

function drawMouse(e) {
    if (!drawing || !isDoodleActive) return;
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;
    currentPath.push({ x: x, y: y });
    applyBrushStyle();
    ctx.lineTo(x, y);
    ctx.stroke();
}

function endDraw(e) {
    if (e) e.preventDefault();
    if (drawing && currentPath.length > 0) {
        doodleHistory.push({
            path: currentPath.slice(),
            color: brushColor,
            size: brushSize,
            type: brushType
        });
        doodleRedoStack = [];
        currentPath = [];
    }
    drawing = false;
}

function applyBrushStyle() {
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    switch (brushType) {
        case 'pencil':
            ctx.globalAlpha = 0.8;
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = brushColor;
            break;
        case 'pen':
            ctx.globalAlpha = 1.0;
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = brushColor;
            break;
        case 'marker':
            ctx.globalAlpha = 0.9;
            ctx.globalCompositeOperation = 'source-over';
            ctx.lineWidth = brushSize * 2;
            ctx.strokeStyle = brushColor;
            break;
        case 'watercolor':
            ctx.globalAlpha = 0.3;
            ctx.globalCompositeOperation = 'source-over';
            ctx.lineWidth = brushSize * 3;
            ctx.strokeStyle = brushColor;
            break;
        case 'highlighter':
            ctx.globalAlpha = 0.25;
            ctx.globalCompositeOperation = 'source-over';
            ctx.lineWidth = brushSize * 4;
            ctx.strokeStyle = brushColor;
            break;
        case 'eraser':
            ctx.globalAlpha = 1.0;
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = 'rgba(0,0,0,1)';
            ctx.lineWidth = brushSize * 3;
            break;
    }
}

function setBrush(type) {
    brushType = type;
}

function setBrushSize(size) {
    brushSize = parseInt(size);
}

function setBrushColor(color) {
    brushColor = color;
}

function undoDoodle() {
    if (doodleHistory.length === 0) return;
    doodleRedoStack.push(doodleHistory.pop());
    redrawDoodle();
}

function redoDoodle() {
    if (doodleRedoStack.length === 0) return;
    doodleHistory.push(doodleRedoStack.pop());
    redrawDoodle();
}

function clearDoodle() {
    doodleHistory = [];
    doodleRedoStack = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function redrawDoodle() {
    // 清空使用 CSS 像素坐标
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    doodleHistory.forEach(function(stroke) {
        ctx.beginPath();
        var savedType = brushType;
        var savedColor = brushColor;
        var savedSize = brushSize;

        brushType = stroke.type;
        brushColor = stroke.color;
        brushSize = stroke.size;
        applyBrushStyle();

        // 使用二次贝塞尔曲线平滑路径
        if (stroke.path.length > 0) {
            ctx.moveTo(stroke.path[0].x, stroke.path[0].y);
            for (var i = 1; i < stroke.path.length - 2; i++) {
                var cpx = (stroke.path[i].x + stroke.path[i + 1].x) / 2;
                var cpy = (stroke.path[i].y + stroke.path[i + 1].y) / 2;
                ctx.quadraticCurveTo(stroke.path[i].x, stroke.path[i].y, cpx, cpy);
            }
            // 连接最后两点
            if (stroke.path.length >= 2) {
                var last = stroke.path[stroke.path.length - 1];
                ctx.lineTo(last.x, last.y);
            }
        }
        ctx.stroke();

        brushType = savedType;
        brushColor = savedColor;
        brushSize = savedSize;
    });
    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = 'source-over';
}

function mergeDoodle() {
    // 首先尝试检测当前选区附近是否命中一张图片，若命中则将涂鸦合并到该图片上并替换其 src
    var selection = window.getSelection();
    var range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    var targetImg = null;
    if (range) {
        targetImg = findTargetImage(range);
    }

    // fallback：若未命中图片，则插入整张画布导出图（原有行为）
    function fallbackInsert() {
        var dataUrl = canvas.toDataURL('image/png');
        var img = document.createElement('img');
        img.src = dataUrl;
        img.className = 'inserted-image doodle-merged';
        img.style.maxWidth = '100%';
        img.style.display = 'block';
        img.style.pointerEvents = 'auto';

        if (selection.rangeCount > 0) {
            var r = selection.getRangeAt(0);
            r.collapse(false);
            r.insertNode(img);
        } else {
            document.getElementById('paper').appendChild(img);
        }
        // 移除已合并的涂鸦记录（全部）并退出涂鸦模式
        doodleHistory = [];
        doodleRedoStack = [];
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        toggleDoodleMode(false);
        notifyContentChanged();
    }

    if (!targetImg) {
        fallbackInsert();
        return;
    }

    var img = targetImg;
    var doMerge = function() {
        try {
            var rect = img.getBoundingClientRect();
            var ratio = window.devicePixelRatio || 1;

            // 创建离屏画布，尺寸为显示尺寸 * DPR，以获得高分辨率输出
            var offCanvas = document.createElement('canvas');
            offCanvas.width = Math.ceil(rect.width * ratio);
            offCanvas.height = Math.ceil(rect.height * ratio);
            var offCtx = offCanvas.getContext('2d');
            offCtx.scale(ratio, ratio);

            // 将原图绘制到离屏画布（按显示大小绘制）
            offCtx.drawImage(img, 0, 0, rect.width, rect.height);

            // 遍历涂鸦记录：若笔画与图片有交集，则把笔画绘制到离屏画布，并从原历史中剔除被合并的部分
            var newHistory = [];
            doodleHistory.forEach(function(stroke) {
                var path = stroke.path || [];
                var hasInside = false;
                for (var pi = 0; pi < path.length; pi++) {
                    var p = path[pi];
                    if (p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom) {
                        hasInside = true;
                        break;
                    }
                }

                if (!hasInside) {
                    // 整笔未覆盖图片，保留
                    newHistory.push(stroke);
                } else {
                    // 在离屏画布上绘制该笔画（坐标需相对于图片左上角）
                    setContextBrush(offCtx, stroke);
                    offCtx.beginPath();
                    if (path.length > 0) {
                        offCtx.moveTo(path[0].x - rect.left, path[0].y - rect.top);
                        for (var i = 1; i < path.length - 2; i++) {
                            var cpx = (path[i].x + path[i + 1].x) / 2 - rect.left;
                            var cpy = (path[i].y + path[i + 1].y) / 2 - rect.top;
                            offCtx.quadraticCurveTo(path[i].x - rect.left, path[i].y - rect.top, cpx, cpy);
                        }
                        if (path.length >= 2) {
                            var last = path[path.length - 1];
                            offCtx.lineTo(last.x - rect.left, last.y - rect.top);
                        }
                    }
                    offCtx.stroke();

                    // 将笔画中落在图片外的部分保留下来（以避免删除在图片外的痕迹）
                    var outsidePath = [];
                    for (var pi2 = 0; pi2 < path.length; pi2++) {
                        var pp = path[pi2];
                        if (!(pp.x >= rect.left && pp.x <= rect.right && pp.y >= rect.top && pp.y <= rect.bottom)) {
                            outsidePath.push(pp);
                        }
                    }
                    if (outsidePath.length > 1) {
                        newHistory.push({ path: outsidePath, color: stroke.color, size: stroke.size, type: stroke.type });
                    }
                }
            });

            // 用合并后的图片替换原图 src
            img.src = offCanvas.toDataURL('image/png');

            // 更新历史与画布
            doodleHistory = newHistory;
            doodleRedoStack = [];
            redrawDoodle();
            toggleDoodleMode(false);
            notifyContentChanged();
        } catch (e) {
            console.error('mergeDoodle error', e);
            fallbackInsert();
        }
    };

    if (img.complete) doMerge(); else img.onload = doMerge;
}

// 查找与当前选区最相关的图片元素（尝试多种策略以兼容不同光标/选区状态）
function findTargetImage(range) {
    try {
        var node = range.startContainer;
        if (node.nodeType === 3) node = node.parentNode;
        if (!node) return null;
        if (node.nodeName === 'IMG') return node;

        // 检查起始容器的子节点或相邻节点
        if (range.startContainer.nodeType === 1) {
            var possible = range.startContainer.childNodes[range.startOffset];
            if (possible && possible.nodeName === 'IMG') return possible;
            var prev = range.startContainer.childNodes[range.startOffset - 1];
            if (prev && prev.nodeName === 'IMG') return prev;
        }

        // 向上查找最近的 img 元素
        var p = node;
        while (p && p !== document.body) {
            if (p.nodeName === 'IMG') return p;
            // 查找子节点中的 img
            if (p.querySelector) {
                var found = p.querySelector('img');
                if (found) return found;
            }
            p = p.parentNode;
        }
    } catch (e) {
        console.error('findTargetImage error', e);
    }
    return null;
}

// 将笔画样式应用到指定的 CanvasRenderingContext2D 上（用于离屏合并）
function setContextBrush(targetCtx, stroke) {
    var type = stroke.type || 'pencil';
    var color = stroke.color || '#000000';
    var size = stroke.size || 3;
    switch (type) {
        case 'pencil':
            targetCtx.globalAlpha = 0.8;
            targetCtx.globalCompositeOperation = 'source-over';
            targetCtx.strokeStyle = color;
            targetCtx.lineWidth = size;
            break;
        case 'pen':
            targetCtx.globalAlpha = 1.0;
            targetCtx.globalCompositeOperation = 'source-over';
            targetCtx.strokeStyle = color;
            targetCtx.lineWidth = size;
            break;
        case 'marker':
            targetCtx.globalAlpha = 0.9;
            targetCtx.globalCompositeOperation = 'source-over';
            targetCtx.lineWidth = size * 2;
            targetCtx.strokeStyle = color;
            break;
        case 'watercolor':
            targetCtx.globalAlpha = 0.3;
            targetCtx.globalCompositeOperation = 'source-over';
            targetCtx.lineWidth = size * 3;
            targetCtx.strokeStyle = color;
            break;
        case 'highlighter':
            targetCtx.globalAlpha = 0.25;
            targetCtx.globalCompositeOperation = 'source-over';
            targetCtx.lineWidth = size * 4;
            targetCtx.strokeStyle = color;
            break;
        case 'eraser':
            targetCtx.globalAlpha = 1.0;
            targetCtx.globalCompositeOperation = 'destination-out';
            targetCtx.strokeStyle = 'rgba(0,0,0,1)';
            targetCtx.lineWidth = size * 3;
            break;
        default:
            targetCtx.globalAlpha = 1.0;
            targetCtx.globalCompositeOperation = 'source-over';
            targetCtx.strokeStyle = color;
            targetCtx.lineWidth = size;
    }
    targetCtx.lineCap = 'round';
    targetCtx.lineJoin = 'round';
}

function toggleDoodleMode(active) {
    isDoodleActive = active;
    canvas.classList.toggle('active', active);
    document.getElementById('paper').contentEditable = !active;
    if (active) {
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        // 重新调整画布大小以覆盖整个视口
        resizeCanvas();
    } else {
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
    }
}

// ==================== 贴纸功能 ====================
function insertSticker(name) {
    var paper = document.getElementById('paper');
    paper.focus();
    restoreSelection();
    
    var stickerMap = {
        'heart': '❤️', 'star': '⭐', 'smile': '😊', 'flower': '🌸',
        'sun': '☀️', 'moon': '🌙', 'cloud': '☁️', 'rain': '🌧️',
        'snow': '❄️', 'leaf': '🍃', 'cat': '🐱', 'dog': '🐶',
        'bird': '🐦', 'fish': '🐟', 'cake': '🎂', 'coffee': '☕',
        'book': '📖', 'music': '🎵', 'sparkle': '✨', 'ribbon': '🎀'
    };
    var sticker = stickerMap[name] || '⭐';
    var span = document.createElement('span');
    span.className = 'inserted-sticker';
    span.textContent = sticker;
    span.contentEditable = 'false';
    
    var selection = window.getSelection();
    if (selection.rangeCount > 0) {
        var range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(span);
        range.collapse(false);
    } else {
        paper.appendChild(span);
    }
    saveSelection();
    notifyContentChanged();
}

// ==================== 图片插入 ====================
function insertImage(base64Data) {
    var paper = document.getElementById('paper');
    paper.focus();
    restoreSelection();
    
    var img = document.createElement('img');
    img.src = 'data:image/jpeg;base64,' + base64Data;
    img.className = 'inserted-image';
    img.style.maxWidth = '100%';
    img.style.cursor = 'pointer';
    // 点击图片时通知 Android 原生层，便于打开预览
    img.addEventListener('click', function() {
        try {
            if (window.AndroidBridge && window.AndroidBridge.onImageClicked) {
                window.AndroidBridge.onImageClicked(img.src);
            }
        } catch (e) { console.error(e); }
    });
    
    var selection = window.getSelection();
    if (selection.rangeCount > 0) {
        var range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(img);
        range.collapse(false);
    } else {
        paper.appendChild(img);
    }
    saveSelection();
    notifyContentChanged();
}

// ==================== 主题切换 ====================
function applyTheme(isDark, bgColor, textColor, paperBgStart, paperBgMid, paperBgEnd, lineColor) {
    var root = document.documentElement;
    root.style.setProperty('--bg-color', bgColor);
    root.style.setProperty('--text-color', textColor);
    root.style.setProperty('--paper-bg-start', paperBgStart);
    root.style.setProperty('--paper-bg-mid', paperBgMid);
    root.style.setProperty('--paper-bg-end', paperBgEnd);
    root.style.setProperty('--line-color', lineColor);
}

function applyEditorSettings(fontSizeSp) {
    var size = parseInt(fontSizeSp, 10);
    if (isNaN(size)) size = 16;
    size = Math.max(12, Math.min(size, 28));
    document.documentElement.style.setProperty('--editor-font-size', size + 'px');
}

// ==================== 内容获取/设置 ====================
function getContent() {
    return document.getElementById('paper').innerHTML;
}

function setContent(html) {
    var paper = document.getElementById('paper');
    paper.innerHTML = html || '';
    // 重置选区
    savedSelectionRange = null;
    notifyContentChanged();
}

function notifyContentChanged() {
    if (window.AndroidBridge && window.AndroidBridge.onContentChanged) {
        window.AndroidBridge.onContentChanged(document.getElementById('paper').innerHTML);
    }
}

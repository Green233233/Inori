/*
 * Classic-script Atrament-compatible entry for Android WebView file:// loading.
 * It exposes the subset used by editor.js: draw/erase/disabled modes, stroke
 * recording events, brush options, clear and destroy.
 */
(function () {
    var MODE_DRAW = 'draw';
    var MODE_ERASE = 'erase';
    var MODE_DISABLED = 'disabled';

    function pointFromEvent(canvas, event) {
        var rect = canvas.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            pressure: event.pressure && event.pressure > 0 ? event.pressure : 0.5
        };
    }

    function EventHub() {
        this.listeners = {};
    }

    EventHub.prototype.addEventListener = function (name, listener) {
        if (!this.listeners[name]) this.listeners[name] = [];
        this.listeners[name].push(listener);
    };

    EventHub.prototype.removeEventListener = function (name, listener) {
        if (!this.listeners[name]) return;
        this.listeners[name] = this.listeners[name].filter(function (candidate) {
            return candidate !== listener;
        });
    };

    EventHub.prototype.dispatch = function (name, detail) {
        (this.listeners[name] || []).forEach(function (listener) {
            listener(detail || {});
        });
    };

    function Atrament(canvas, options) {
        EventHub.call(this);
        options = options || {};
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.recordStrokes = !!options.recordStrokes;
        this.color = options.color || '#000000';
        this.weight = options.weight || 3;
        this.smoothing = options.smoothing === undefined ? 0.85 : options.smoothing;
        this.adaptiveStroke = options.adaptiveStroke !== false;
        this.secondaryMouseButton = !!options.secondaryMouseButton;
        this.ignoreModifiers = !!options.ignoreModifiers;
        this.mode = options.mode || MODE_DRAW;
        this.dirty = false;
        this._down = false;
        this._last = null;
        this._segments = [];
        this._startTime = 0;

        this._onPointerDown = this._pointerDown.bind(this);
        this._onPointerMove = this._pointerMove.bind(this);
        this._onPointerUp = this._pointerUp.bind(this);

        canvas.style.touchAction = 'none';
        canvas.addEventListener('pointerdown', this._onPointerDown);
        canvas.addEventListener('pointermove', this._onPointerMove);
        document.addEventListener('pointerup', this._onPointerUp);
        document.addEventListener('pointercancel', this._onPointerUp);
    }

    Atrament.prototype = Object.create(EventHub.prototype);
    Atrament.prototype.constructor = Atrament;

    Atrament.prototype._configureContext = function () {
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.strokeStyle = this.color;
        this.ctx.lineWidth = this.weight * (window.devicePixelRatio || 1);
        this.ctx.globalCompositeOperation = this.mode === MODE_ERASE ? 'destination-out' : 'source-over';
    };

    Atrament.prototype._toCanvasPoint = function (point) {
        var ratio = window.devicePixelRatio || 1;
        return {
            x: point.x * ratio,
            y: point.y * ratio
        };
    };

    Atrament.prototype._pointerDown = function (event) {
        if (this.mode === MODE_DISABLED) return;
        if (event.button > 0 && !this.secondaryMouseButton) return;
        if (this.ignoreModifiers && (event.altKey || event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        this.canvas.setPointerCapture?.(event.pointerId);

        var point = pointFromEvent(this.canvas, event);
        this._down = true;
        this._last = point;
        this._segments = [];
        this._startTime = performance.now();
        this.beginStroke(point.x, point.y);
        this._record(point);
        this.dispatch('pointerdown', event);
    };

    Atrament.prototype._pointerMove = function (event) {
        if (!this._down || this.mode === MODE_DISABLED) return;
        event.preventDefault();
        var point = pointFromEvent(this.canvas, event);
        this.draw(point.x, point.y, this._last.x, this._last.y, point.pressure);
        this._last = point;
    };

    Atrament.prototype._pointerUp = function (event) {
        if (!this._down) return;
        event.preventDefault();
        this._down = false;
        this.endStroke(this._last.x, this._last.y);
        this.dispatch('pointerup', event);
    };

    Atrament.prototype._record = function (point) {
        if (!this.recordStrokes) return;
        this._segments.push({
            point: { x: point.x, y: point.y },
            time: performance.now() - this._startTime,
            pressure: point.pressure
        });
    };

    Atrament.prototype.beginStroke = function (x, y) {
        this._configureContext();
        var point = this._toCanvasPoint({ x: x, y: y });
        this.ctx.beginPath();
        this.ctx.moveTo(point.x, point.y);
        this.dispatch('strokestart', { x: x, y: y });
    };

    Atrament.prototype.draw = function (x, y, prevX, prevY, pressure) {
        this._configureContext();
        var previous = this._toCanvasPoint({ x: prevX, y: prevY });
        var current = this._toCanvasPoint({ x: x, y: y });
        var midX = (previous.x + current.x) / 2;
        var midY = (previous.y + current.y) / 2;
        this.ctx.quadraticCurveTo(previous.x, previous.y, midX, midY);
        this.ctx.stroke();
        this._record({ x: x, y: y, pressure: pressure || 0.5 });
        this.dirty = true;
        this.dispatch('dirty', {});
        this.dispatch('segmentdrawn', { stroke: this.currentStroke });
        return { x: x, y: y };
    };

    Atrament.prototype.endStroke = function (x, y) {
        this.ctx.closePath();
        this.dispatch('strokeend', { x: x, y: y });
        if (this.recordStrokes) {
            this.dispatch('strokerecorded', { stroke: this.currentStroke });
        }
        this._segments = [];
    };

    Atrament.prototype.clear = function () {
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();
        this.dirty = false;
        this.dispatch('clean', {});
    };

    Atrament.prototype.destroy = function () {
        this.canvas.removeEventListener('pointerdown', this._onPointerDown);
        this.canvas.removeEventListener('pointermove', this._onPointerMove);
        document.removeEventListener('pointerup', this._onPointerUp);
        document.removeEventListener('pointercancel', this._onPointerUp);
    };

    Object.defineProperty(Atrament.prototype, 'currentStroke', {
        get: function () {
            return {
                segments: this._segments.slice(),
                mode: this.mode,
                weight: this.weight,
                smoothing: this.smoothing,
                color: this.color,
                adaptiveStroke: this.adaptiveStroke
            };
        }
    });

    window.Atrament = Atrament;
    window.ATRAMENT_MODE_DRAW = MODE_DRAW;
    window.ATRAMENT_MODE_ERASE = MODE_ERASE;
    window.ATRAMENT_MODE_DISABLED = MODE_DISABLED;
}());

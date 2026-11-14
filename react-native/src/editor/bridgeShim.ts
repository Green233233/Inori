/**
 * JS glue injected before the editor document loads.
 * `editor.js` is reused verbatim: it only talks to `window.AndroidBridge`
 * (5 methods) and expects its command functions on `window`.
 */
export const BRIDGE_SHIM = `(function () {
  var post = function (msg) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(msg));
      }
    } catch (e) {}
  };
  window.AndroidBridge = {
    onContentChanged: function (html) { post({v: 1, type: 'content', html: html}); },
    onDoodleStateChanged: function (state) { post({v: 1, type: 'doodleState', state: state}); },
    onImageClicked: function (src) { post({v: 1, type: 'imageClick', src: src}); },
    requestImageInsert: function () { post({v: 1, type: 'requestImageInsert'}); },
    setStickerGestureActive: function (active) { post({v: 1, type: 'stickerGesture', active: !!active}); }
  };
  window.__rnInvoke = function (fn, args) {
    var f = window[fn];
    if (typeof f !== 'function') {
      post({v: 1, type: 'error', message: 'missing fn ' + fn});
      return;
    }
    try { f.apply(null, args || []); } catch (e) { post({v: 1, type: 'error', message: String(e)}); }
  };
  window.__rnCall = function (id, fn, args) {
    var f = window[fn];
    var value = null;
    try { value = typeof f === 'function' ? f.apply(null, args || []) : null; }
    catch (e) { post({v: 1, type: 'reply', id: id, error: String(e)}); return; }
    post({v: 1, type: 'reply', id: id, value: value});
  };
  window.addEventListener('load', function () { post({v: 1, type: 'ready'}); }, {once: true});
})();`;

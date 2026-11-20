/* 祈 · 账户管理后台 v0.1.0
 * 无框架、无外部依赖。令牌只放 sessionStorage，所有请求走 Bearer，
 * 不依赖 Cookie。 */
(function () {
  "use strict";

  var API = "/admin/api";
  var TOKEN_KEY = "qi.admin.token";
  var THEME_CACHE_KEY = "qi.admin.theme";
  var PAGE_SIZE = 20;

  var state = {
    token: null,
    me: null,
    view: "overview",
    overview: null,
    accounts: { items: [], total: 0, page: 1, pages: 1, q: "", status: "all" },
    theme: null,
    themeSaveSeq: 0,
    wallpaperVersion: 0,
    wallpaperKey: "",
    wallpaperUrl: null,
    busy: false,
    refreshing: false,
    autoTimer: null,
    searchTimer: null,
    lockTimer: null,
    toastTimer: null
  };

  var VIEW_META = {
    overview: ["概览", "服务器运行状态与账户概况"],
    accounts: ["账户", "浏览、创建、封禁与导出账户"],
    audit: ["操作日志", "管理员与账户相关操作记录"],
    broadcast: ["公告", "写一句话，所有客户端主页都会显示"],
    system: ["系统", "版本、登录保护与存储信息"],
    settings: ["设置", "管理员、密码与外观"]
  };

  var ACTION_LABELS = {
    admin_login: "管理员登录",
    admin_login_failed: "管理员登录失败",
    admin_locked: "IP 锁定",
    admin_logout: "管理员退出",
    admin_password_changed: "修改管理员密码",
    admin_password_failed: "改密失败",
    admin_create_account: "创建账户",
    admin_ban_account: "封禁账户",
    admin_unban_account: "解封账户",
    admin_delete_account: "删除账户",
    admin_registration: "注册开关",
    admin_create_admin: "创建管理员",
    admin_theme_updated: "更新外观",
    admin_background_upload: "上传背景",
    admin_background_deleted: "移除背景",
    login: "账户登录",
    login_failed: "账户登录失败",
    login_blocked: "封禁登录拦截",
    logout: "账户退出",
    register: "账户注册",
    device_rebind: "设备换绑",
    device_revoke: "注销设备",
    pair_create: "发起配对",
    pair_join: "加入配对",
    pair_verify: "确认配对",
    pair_unpair: "解除配对",
    invite_used: "使用邀请码"
  };

  function $(id) { return document.getElementById(id); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function num(value) {
    try { return new Intl.NumberFormat("zh-CN").format(Number(value) || 0); }
    catch (err) { return String(value || 0); }
  }

  function formatBytes(bytes) {
    var value = Number(bytes) || 0;
    if (value <= 0) return "0 B";
    var units = ["B", "KB", "MB", "GB", "TB"];
    var index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
    var scaled = value / Math.pow(1024, index);
    var digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
    return scaled.toFixed(index === 0 ? 0 : digits) + " " + units[index];
  }

  function formatRate(bytesPerSecond) {
    return formatBytes(bytesPerSecond) + "/s";
  }

  function formatDuration(seconds) {
    var total = Math.max(0, Math.floor(Number(seconds) || 0));
    var days = Math.floor(total / 86400);
    var hours = Math.floor((total % 86400) / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    if (days > 0) return days + " 天 " + hours + " 小时";
    if (hours > 0) return hours + " 小时 " + minutes + " 分";
    if (minutes > 0) return minutes + " 分钟";
    return total + " 秒";
  }

  function formatDateTime(iso) {
    if (!iso) return "–";
    var date = new Date(iso);
    if (isNaN(date.getTime())) return String(iso);
    try {
      return new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false
      }).format(date);
    } catch (err) {
      return date.toLocaleString();
    }
  }

  function relativeTime(iso) {
    if (!iso) return "–";
    var date = new Date(iso);
    if (isNaN(date.getTime())) return String(iso);
    var diff = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (diff < 60) return "刚刚";
    if (diff < 3600) return Math.floor(diff / 60) + " 分钟前";
    if (diff < 86400) return Math.floor(diff / 3600) + " 小时前";
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + " 天前";
    return formatDateTime(iso);
  }

  function actionLabel(action) {
    return ACTION_LABELS[action] || action || "未知操作";
  }

  function storageGet() {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch (err) { return null; }
  }
  function storageSet(value) {
    try { sessionStorage.setItem(TOKEN_KEY, value); } catch (err) { /* ignore */ }
  }
  function storageClear() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (err) { /* ignore */ }
  }

  function AppError(message, status, code, payload) {
    this.name = "AppError";
    this.message = message;
    this.status = status || 0;
    this.code = code || "error";
    this.payload = payload || null;
  }
  AppError.prototype = Object.create(Error.prototype);

  async function safeJson(response) {
    try { return await response.json(); } catch (err) { return null; }
  }

  async function api(path, options) {
    options = options || {};
    var method = options.method || "GET";
    var headers = {};
    if (state.token) headers.Authorization = "Bearer " + state.token;
    if (options.body !== undefined && options.body !== null) {
      headers["Content-Type"] = "application/json";
    }
    var response;
    try {
      response = await fetch(API + path, {
        method: method,
        headers: headers,
        body: options.body == null ? undefined : JSON.stringify(options.body),
        cache: "no-store",
        credentials: "same-origin"
      });
    } catch (err) {
      throw new AppError("无法连接服务器，请检查网络或服务状态", 0, "network_error");
    }
    var data = await safeJson(response);
    if (response.status === 401 && path !== "/login" && state.token) {
      sessionLost((data && data.error && data.error.message) || "登录已过期，请重新登录");
    }
    if (response.status === 403 && data && data.error &&
        data.error.code === "password_change_required") {
      if (state.me) state.me.mustChangePassword = true;
      showPasswordView();
    }
    if (!response.ok) {
      var error = (data && data.error) || {};
      throw new AppError(
        error.message || ("请求失败（HTTP " + response.status + "）"),
        response.status, error.code, error
      );
    }
    return data || {};
  }

  function toast(message, isError) {
    var node = $("toast");
    node.textContent = message;
    node.classList.toggle("is-error", !!isError);
    node.hidden = false;
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () { node.hidden = true; }, isError ? 4200 : 2600);
  }

  function showBanner(message) {
    var node = $("banner");
    if (!message) { node.hidden = true; return; }
    node.textContent = message;
    node.hidden = false;
  }

  function setText(id, value) {
    var node = $(id);
    if (node) node.textContent = value;
  }

  /* ---------------- 视图切换 ---------------- */
  function hideAllScreens() {
    $("login-view").hidden = true;
    $("password-view").hidden = true;
    $("app-view").hidden = true;
  }

  function ensureLoginWallpaper() {
    var img = $("login-wallpaper");
    if (!img || img.dataset.loaded) return;
    img.dataset.loaded = "1";
    img.addEventListener("error", function () { img.hidden = true; });
    var day = new Date().toISOString().slice(0, 10);
    img.src = "/admin/api/login-background?d=" + day;
  }

  function showLogin(message) {
    stopAutoRefresh();
    closeModal();
    hideAllScreens();
    ensureLoginWallpaper();
    $("login-view").hidden = false;
    $("login-error").hidden = !message;
    if (message) $("login-error").textContent = message;
    var password = $("login-password");
    if (password) password.value = "";
    setTimeout(function () {
      var focus = $("login-username");
      if (focus) focus.focus();
    }, 30);
  }

  function showPasswordView() {
    stopAutoRefresh();
    closeModal();
    hideAllScreens();
    $("password-view").hidden = false;
    $("password-form").reset();
    setTimeout(function () {
      var focus = $("old-password");
      if (focus) focus.focus();
    }, 30);
  }

  function sessionLost(message) {
    state.token = null;
    state.me = null;
    storageClear();
    showLogin(message || "登录已过期，请重新登录");
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    state.autoTimer = setInterval(function () {
      if (document.visibilityState !== "visible") return;
      if (state.busy || state.refreshing) return;
      if (state.view === "overview") loadOverview({ silent: true });
    }, 15000);
  }

  function stopAutoRefresh() {
    if (state.autoTimer) { clearInterval(state.autoTimer); state.autoTimer = null; }
  }

  function switchView(view) {
    if (!VIEW_META[view]) view = "overview";
    state.view = view;
    $$(".nav-item").forEach(function (item) {
      item.classList.toggle("is-active", item.dataset.view === view);
    });
    $$(".view").forEach(function (section) {
      section.hidden = section.id !== "view-" + view;
    });
    setText("view-title", VIEW_META[view][0]);
    setText("view-sub", VIEW_META[view][1]);
    showBanner("");
    if (view === "overview") loadOverview();
    if (view === "accounts") loadAccounts();
    if (view === "audit") loadAudit();
    if (view === "system") loadSystem();
    if (view === "broadcast") loadBroadcast();
    if (view === "settings") loadSettings();
  }

  function enterApp(me) {
    state.me = me || state.me;
    if (!state.me) return;
    hideAllScreens();
    state.wallpaperKey = "";
    applyTheme(state.me.theme || themeDefaults(), { cache: true });
    syncThemeControls(state.theme);
    $("app-view").hidden = false;
    setText("admin-name", state.me.username || "admin");
    var avatar = document.querySelector(".avatar");
    if (avatar) avatar.textContent = String(state.me.username || "A").slice(0, 1).toUpperCase();
    switchView("overview");
    startAutoRefresh();
  }

  /* ---------------- 主题与背景 ---------------- */
  function themeDefaults() {
    return {
      mode: "dark",
      background: "bing",
      solidColor: "#121212",
      blur: 6,
      hasCustomBackground: false
    };
  }

  function normalizeTheme(theme) {
    var base = themeDefaults();
    if (!theme || typeof theme !== "object") return base;
    if (theme.mode === "dark" || theme.mode === "light" || theme.mode === "system") base.mode = theme.mode;
    if (theme.background === "solid" || theme.background === "bing" || theme.background === "upload") {
      base.background = theme.background;
    }
    if (/^#[0-9a-fA-F]{6}$/.test(String(theme.solidColor || ""))) base.solidColor = String(theme.solidColor);
    var blur = Number(theme.blur);
    if (Number.isFinite(blur)) base.blur = Math.max(0, Math.min(30, Math.round(blur)));
    base.hasCustomBackground = !!theme.hasCustomBackground;
    return base;
  }

  function readThemeCache() {
    try {
      var raw = localStorage.getItem(THEME_CACHE_KEY);
      return raw ? normalizeTheme(JSON.parse(raw)) : null;
    } catch (err) {
      return null;
    }
  }

  function writeThemeCache(theme) {
    try { localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(theme)); } catch (err) { /* ignore */ }
  }

  function systemPrefersDark() {
    try { return window.matchMedia("(prefers-color-scheme: dark)").matches; }
    catch (err) { return true; }
  }

  function resolvedDark(theme) {
    if (theme.mode === "light") return false;
    if (theme.mode === "dark") return true;
    return systemPrefersDark();
  }

  function setThemeState(message) {
    var node = $("theme-state");
    if (node) node.textContent = message;
  }

  function releaseWallpaperUrl() {
    if (state.wallpaperUrl) {
      try { URL.revokeObjectURL(state.wallpaperUrl); } catch (err) { /* ignore */ }
      state.wallpaperUrl = null;
    }
  }

  function setWallpaperSource(src) {
    var img = $("app-wallpaper-img");
    if (!img) return;
    img.hidden = false;
    img.src = src;
  }

  async function loadCustomWallpaper(key) {
    if (!state.token) return;
    try {
      var response = await fetch(API + "/theme/background", {
        headers: { Authorization: "Bearer " + state.token },
        cache: "no-store"
      });
      if (response.status === 401) {
        sessionLost("登录已过期，请重新登录");
        return;
      }
      if (!response.ok) throw new Error("background_unavailable");
      var blob = await response.blob();
      if (state.wallpaperKey !== key) return;
      releaseWallpaperUrl();
      state.wallpaperUrl = URL.createObjectURL(blob);
      setWallpaperSource(state.wallpaperUrl);
    } catch (err) {
      var wrap = $("app-wallpaper");
      if (wrap) wrap.hidden = true;
    }
  }

  function renderWallpaper(theme) {
    var wrap = $("app-wallpaper");
    var img = $("app-wallpaper-img");
    if (!wrap || !img) return;
    if (theme.background === "solid") {
      // 纯色只在深色主题下压暗过亮的颜色；深色纯色保持原样。
      wrap.hidden = false;
      wrap.classList.add("is-solid");
      wrap.classList.toggle("is-solid-scrim", resolvedDark(theme) && solidLuminance(theme.solidColor) > 0.32);
      img.style.visibility = "hidden";
      img.removeAttribute("src");
      state.wallpaperKey = "";
      releaseWallpaperUrl();
      return;
    }
    wrap.classList.remove("is-solid", "is-solid-scrim");
    img.style.visibility = "";
    if (theme.background === "bing") {
      wrap.hidden = false;
      var day = new Date().toISOString().slice(0, 10);
      var bingKey = "bing:" + day;
      if (state.wallpaperKey !== bingKey) {
        state.wallpaperKey = bingKey;
        releaseWallpaperUrl();
        setWallpaperSource("/admin/api/login-background?d=" + day);
      }
      return;
    }
    if (theme.background === "upload") {
      if (!theme.hasCustomBackground) {
        wrap.hidden = true;
        return;
      }
      wrap.hidden = false;
      var uploadKey = "upload:" + state.wallpaperVersion;
      if (state.wallpaperKey !== uploadKey) {
        state.wallpaperKey = uploadKey;
        loadCustomWallpaper(uploadKey);
      }
      return;
    }
    wrap.hidden = true;
  }

  function solidLuminance(color) {
    var hex = String(color || "").replace("#", "");
    if (hex.length !== 6) return 0;
    var r = parseInt(hex.slice(0, 2), 16) / 255;
    var g = parseInt(hex.slice(2, 4), 16) / 255;
    var b = parseInt(hex.slice(4, 6), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function applyTheme(theme, options) {
    options = options || {};
    theme = normalizeTheme(theme);
    state.theme = theme;
    var dark = resolvedDark(theme);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.canvas = theme.background;
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#121212" : "#f4f5f7");
    if (theme.background === "solid") {
      document.documentElement.style.setProperty("--bg", theme.solidColor);
      document.documentElement.style.setProperty("--bg-deep", theme.solidColor);
    } else {
      document.documentElement.style.removeProperty("--bg");
      document.documentElement.style.removeProperty("--bg-deep");
    }
    document.documentElement.style.setProperty("--wallpaper-blur", theme.blur + "px");
    renderWallpaper(theme);
    if (options.cache) writeThemeCache(theme);
  }

  function syncThemeControls(theme) {
    theme = normalizeTheme(theme);
    $$("#theme-mode .segmented-item").forEach(function (button) {
      var active = button.dataset.mode === theme.mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    $$('#background-choices input[name="theme-background"]').forEach(function (input) {
      input.checked = input.value === theme.background;
    });
    var color = $("solid-color");
    if (color) color.value = theme.solidColor;
    var swatch = $("solid-swatch");
    if (swatch) swatch.style.background = theme.solidColor;
    var blur = $("blur-range");
    if (blur) blur.value = String(theme.blur);
    var blurValue = $("blur-value");
    if (blurValue) blurValue.textContent = theme.blur + "px";
    var remove = $("remove-background");
    if (remove) remove.disabled = !theme.hasCustomBackground;
    var fileName = $("background-file-name");
    if (fileName && !fileName.dataset.uploaded) {
      fileName.textContent = theme.hasCustomBackground ? "已上传自定义背景" : "未选择文件";
    }
  }

  async function saveTheme(patch) {
    if (!state.theme) return;
    var previous = normalizeTheme(state.theme);
    var next = normalizeTheme(Object.assign({}, previous, patch));
    var seq = ++state.themeSaveSeq;
    applyTheme(next, { cache: true });
    syncThemeControls(next);
    setThemeState("保存中…");
    try {
      var data = await api("/theme", {
        method: "PUT",
        body: {
          mode: next.mode,
          background: next.background,
          solidColor: next.solidColor,
          blur: next.blur
        }
      });
      if (seq !== state.themeSaveSeq) return;
      state.me.theme = data.theme;
      applyTheme(data.theme, { cache: true });
      syncThemeControls(data.theme);
      setThemeState("已保存");
    } catch (err) {
      if (seq !== state.themeSaveSeq) return;
      applyTheme(previous, { cache: true });
      syncThemeControls(previous);
      setThemeState("保存失败");
      toast(err.message, true);
    }
  }

  function watchSystemTheme() {
    try {
      var media = window.matchMedia("(prefers-color-scheme: dark)");
      var handler = function () {
        if (state.theme && state.theme.mode === "system") applyTheme(state.theme, {});
      };
      if (media.addEventListener) media.addEventListener("change", handler);
      else if (media.addListener) media.addListener(handler);
    } catch (err) { /* ignore */ }
  }

  function onThemeModeClick(event) {
    var button = event.target.closest(".segmented-item[data-mode]");
    if (!button) return;
    saveTheme({ mode: button.dataset.mode });
  }

  function onBackgroundChoice(event) {
    var input = event.target;
    if (!input.matches('input[name="theme-background"]')) return;
    if (input.value === "upload" && !(state.theme && state.theme.hasCustomBackground)) {
      syncThemeControls(state.theme);
      $("background-file").click();
      return;
    }
    saveTheme({ background: input.value });
  }

  function onSolidColorInput(event) {
    var color = event.target.value;
    var swatch = $("solid-swatch");
    if (swatch) swatch.style.background = color;
    if (state.theme && state.theme.background === "solid") {
      document.documentElement.style.setProperty("--bg", color);
      document.documentElement.style.setProperty("--bg-deep", color);
    }
  }

  function onSolidColorChange(event) {
    saveTheme({ solidColor: event.target.value });
  }

  function onBlurInput(event) {
    var value = Number(event.target.value);
    document.documentElement.style.setProperty("--wallpaper-blur", value + "px");
    setText("blur-value", value + "px");
  }

  function onBlurChange(event) {
    saveTheme({ blur: Number(event.target.value) });
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(new Error("读取图片失败")); };
      reader.readAsDataURL(file);
    });
  }

  async function onBackgroundFile(event) {
    var input = event.target;
    var file = input.files && input.files[0];
    if (!file) return;
    var allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.indexOf(file.type) < 0) {
      toast("仅支持 JPEG、PNG 或 WebP 图片", true);
      input.value = "";
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast("背景图片不能超过 4MB", true);
      input.value = "";
      return;
    }
    setThemeState("上传中…");
    try {
      var data = await readFileAsDataUrl(file);
      var result = await api("/theme/background", { method: "POST", body: { data: data } });
      state.wallpaperVersion += 1;
      state.me.theme = result.theme;
      applyTheme(result.theme, { cache: true });
      syncThemeControls(result.theme);
      $("background-file-name").textContent = file.name;
      $("background-file-name").dataset.uploaded = "1";
      setThemeState("已保存");
      toast("背景已更新");
    } catch (err) {
      setThemeState("上传失败");
      toast(err.message, true);
    } finally {
      input.value = "";
    }
  }

  function removeBackground() {
    if (!state.theme || !state.theme.hasCustomBackground) return;
    openModal({
      title: "移除自定义背景",
      role: "alertdialog",
      body: '<p class="modal-note">移除后背景会切回 Bing 每日壁纸，已上传的图片文件会被删除。</p>',
      actions: [
        { label: "取消", onClick: function (ctx) { ctx.close(); } },
        {
          label: "移除",
          className: "btn-danger",
          onClick: async function (ctx) {
            ctx.setBusy(true);
            try {
              var result = await api("/theme/background", { method: "DELETE" });
              state.wallpaperVersion += 1;
              state.me.theme = result.theme;
              applyTheme(result.theme, { cache: true });
              syncThemeControls(result.theme);
              delete $("background-file-name").dataset.uploaded;
              $("background-file-name").textContent = "未选择文件";
              setThemeState("已保存");
              toast("自定义背景已移除");
              ctx.close();
            } catch (err) {
              toast(err.message, true);
            } finally {
              ctx.setBusy(false);
            }
          }
        }
      ]
    });
  }

  /* ---------------- 设置页 ---------------- */
  async function loadSettings() {
    try {
      var results = await Promise.all([api("/admins"), api("/theme")]);
      renderAdmins(results[0].items || []);
      state.me.theme = results[1].theme;
      applyTheme(results[1].theme, { cache: true });
      syncThemeControls(results[1].theme);
      setThemeState("已保存");
    } catch (err) {
      if (err.status !== 401 && err.status !== 403) {
        showBanner("读取设置失败：" + err.message);
      }
    }
  }

  function renderAdmins(items) {
    var body = $("admins-body");
    if (!body) return;
    body.innerHTML = items.map(function (item) {
      var self = item.isSelf ? ' <span class="pill pill-ok">当前</span>' : "";
      var status = item.mustChangePassword
        ? '<span class="pill pill-warn">待改密</span>'
        : '<span class="pill pill-ok">正常</span>';
      var last = item.lastLoginLocal ? esc(item.lastLoginLocal) : "从未登录";
      return "<tr>" +
        '<td data-label="账号"><strong>' + esc(item.username) + "</strong>" + self + "</td>" +
        '<td data-label="创建时间" class="muted">' + esc(item.createdAtLocal || "–") + "</td>" +
        '<td data-label="最近登录" class="muted">' + last + "</td>" +
        '<td data-label="状态">' + status + "</td>" +
        "</tr>";
    }).join("");
    $("admins-empty").hidden = items.length > 0;
  }

  function openAddAdminModal() {
    openModal({
      title: "创建管理员",
      body:
        '<label class="field"><span>管理员账号</span>' +
        '<input id="new-admin-username" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="3–32 位小写字母、数字或下划线"></label>' +
        '<label class="field"><span>初始密码</span>' +
        '<input id="new-admin-password" type="password" autocomplete="new-password"></label>' +
        '<label class="field"><span>确认密码</span>' +
        '<input id="new-admin-confirm" type="password" autocomplete="new-password"></label>' +
        '<p id="new-admin-error" class="form-error" role="alert" hidden></p>' +
        '<p class="modal-note">新管理员首次登录必须修改密码；所有管理员权限相同。</p>',
      actions: [
        { label: "取消", onClick: function (ctx) { ctx.close(); } },
        {
          label: "创建",
          className: "btn-primary",
          onClick: async function (ctx) {
            var username = ctx.root.querySelector("#new-admin-username").value.trim().toLowerCase();
            var password = ctx.root.querySelector("#new-admin-password").value;
            var confirm = ctx.root.querySelector("#new-admin-confirm").value;
            var error = ctx.root.querySelector("#new-admin-error");
            var problem = "";
            if (!/^[a-z0-9_]{3,32}$/.test(username)) {
              problem = "账号需为 3–32 位小写字母、数字或下划线。";
            } else {
              problem = passwordProblem(password);
            }
            if (!problem && password !== confirm) problem = "两次输入的密码不一致。";
            if (problem) {
              error.textContent = problem;
              error.hidden = false;
              return;
            }
            error.hidden = true;
            ctx.setBusy(true);
            try {
              await api("/admins", { method: "POST", body: { username: username, password: password } });
              ctx.close();
              toast("管理员已创建，首次登录需改密");
              loadSettings();
            } catch (err) {
              error.textContent = err.message;
              error.hidden = false;
            } finally {
              ctx.setBusy(false);
            }
          }
        }
      ]
    });
  }

  async function onSettingsPassword(event) {
    event.preventDefault();
    var form = $("settings-password-form");
    var button = form.querySelector('button[type="submit"]');
    var error = $("settings-password-error");
    var oldPassword = $("settings-old-password").value;
    var newPassword = $("settings-new-password").value;
    var confirm = $("settings-confirm-password").value;
    error.hidden = true;
    var problem = passwordProblem(newPassword);
    if (problem) {
      error.textContent = problem;
      error.hidden = false;
      return;
    }
    if (newPassword !== confirm) {
      error.textContent = "两次输入的新密码不一致。";
      error.hidden = false;
      return;
    }
    if (newPassword === oldPassword) {
      error.textContent = "新密码不能与当前密码相同。";
      error.hidden = false;
      return;
    }
    button.disabled = true;
    button.textContent = "更新中…";
    try {
      await api("/change-password", {
        method: "POST",
        body: { oldPassword: oldPassword, newPassword: newPassword }
      });
      form.reset();
      toast("密码已更新");
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = "更新密码";
    }
  }

  /* ---------------- 登录 / 改密 ---------------- */
  function startLockCountdown(message, retryAfter) {
    var node = $("login-error");
    var remaining = Math.max(0, Math.floor(Number(retryAfter) || 0));
    if (state.lockTimer) { clearInterval(state.lockTimer); state.lockTimer = null; }
    var submit = $("login-form").querySelector("button[type=submit]");
    if (!remaining) {
      node.textContent = message;
      return;
    }
    submit.disabled = true;
    var render = function () {
      var minutes = Math.floor(remaining / 60);
      var seconds = remaining % 60;
      node.textContent = message + "（" + minutes + " 分 " + (seconds < 10 ? "0" : "") + seconds + " 秒后可重试）";
    };
    render();
    state.lockTimer = setInterval(function () {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(state.lockTimer);
        state.lockTimer = null;
        submit.disabled = false;
        node.textContent = "锁定已结束，可以重新登录。";
        return;
      }
      render();
    }, 1000);
  }

  async function onLogin(event) {
    event.preventDefault();
    if (state.lockTimer) return;
    var button = $("login-form").querySelector("button[type=submit]");
    var errorNode = $("login-error");
    var username = $("login-username").value.trim();
    var password = $("login-password").value;
    errorNode.hidden = true;
    if (!username || !password) {
      errorNode.textContent = "请输入管理员账号和密码。";
      errorNode.hidden = false;
      return;
    }
    button.disabled = true;
    button.textContent = "登录中…";
    try {
      var data = await api("/login", { method: "POST", body: { username: username, password: password } });
      state.token = data.token;
      storageSet(data.token);
      state.me = data;
      if (data.mustChangePassword) {
        showPasswordView();
        toast("首次登录，请先设置新密码");
      } else {
        enterApp(data);
      }
    } catch (err) {
      var payload = err.payload || {};
      if (err.code === "admin_locked") {
        startLockCountdown(err.message, payload.retryAfter || 0);
        errorNode.hidden = false;
      } else {
        var suffix = payload.attemptsLeft != null ? "（还可尝试 " + payload.attemptsLeft + " 次）" : "";
        errorNode.textContent = err.message + suffix;
        errorNode.hidden = false;
      }
      $("login-password").value = "";
      $("login-password").focus();
    } finally {
      button.disabled = false;
      button.textContent = "进入后台";
    }
  }

  async function onChangePassword(event) {
    event.preventDefault();
    var button = $("password-form").querySelector("button[type=submit]");
    var errorNode = $("password-error");
    var oldPassword = $("old-password").value;
    var newPassword = $("new-password").value;
    var confirm = $("confirm-password").value;
    errorNode.hidden = true;
    var problem = passwordProblem(newPassword);
    if (problem) {
      errorNode.textContent = problem;
      errorNode.hidden = false;
      return;
    }
    if (newPassword !== confirm) {
      errorNode.textContent = "两次输入的新密码不一致。";
      errorNode.hidden = false;
      return;
    }
    if (newPassword === oldPassword) {
      errorNode.textContent = "新密码不能与当前密码相同。";
      errorNode.hidden = false;
      return;
    }
    button.disabled = true;
    button.textContent = "保存中…";
    try {
      await api("/change-password", {
        method: "POST",
        body: { oldPassword: oldPassword, newPassword: newPassword }
      });
      var me = await api("/me");
      state.me = me;
      toast("密码已更新");
      enterApp(me);
    } catch (err) {
      errorNode.textContent = err.message;
      errorNode.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = "保存并进入后台";
    }
  }

  function passwordProblem(value) {
    if (!value || value.length < 8) return "密码至少需要 8 位。";
    if (/\s/.test(value)) return "密码不能包含空格。";
    if (!/[A-Za-z]/.test(value)) return "密码至少需要一个字母。";
    if (!/[0-9]/.test(value) && !/[^A-Za-z0-9]/.test(value)) return "密码至少需要一个数字或符号。";
    if (value === "12345678") return "不能继续使用默认密码。";
    return "";
  }

  async function onLogout() {
    var button = $("logout-btn");
    button.disabled = true;
    try { await api("/logout", { method: "POST", body: {} }); } catch (err) { /* 忽略 */ }
    button.disabled = false;
    sessionLost("已退出登录");
  }

  /* ---------------- 公告 ---------------- */
  async function loadBroadcast() {
    try {
      var data = await api("/broadcast");
      renderBroadcast(data.broadcast);
    } catch (err) {
      if (err.status !== 401 && err.status !== 403) {
        showBanner("读取公告失败：" + err.message);
      }
    }
  }

  function renderBroadcast(item) {
    var box = $("broadcast-current");
    var pill = $("broadcast-state");
    if (!item) {
      box.textContent = "当前没有公告。";
      box.className = "empty";
      pill.textContent = "未发布";
      pill.className = "pill pill-muted";
      return;
    }
    box.className = "broadcast-current";
    box.textContent = item.text + "\n· " + formatDateTime(item.expiresAt) + " 到期";
    pill.textContent = "生效中";
    pill.className = "pill pill-ok";
  }

  async function onBroadcastSubmit(event) {
    event.preventDefault();
    var text = $("broadcast-text").value.trim();
    if (!text) {
      showBanner("公告内容是空的");
      return;
    }
    var hours = Number($("broadcast-hours").value) || 72;
    var button = event.target.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await api("/broadcast", { method: "POST", body: { text: text, hours: hours } });
      $("broadcast-text").value = "";
      showBanner("公告已发布");
      await loadBroadcast();
    } catch (err) {
      showBanner("发布失败：" + err.message);
    } finally {
      button.disabled = false;
    }
  }

  async function onBroadcastClear() {
    if (!window.confirm("确定清空公告？所有客户端主页马上就不会再显示它。")) return;
    try {
      await api("/broadcast", { method: "DELETE" });
      showBanner("已清空公告");
      await loadBroadcast();
    } catch (err) {
      showBanner("清空失败：" + err.message);
    }
  }

  /* ---------------- 概览 ---------------- */
  async function loadOverview(options) {
    options = options || {};
    if (state.refreshing) return;
    state.refreshing = true;
    try {
      var data = await api("/overview");
      state.overview = data;
      renderOverview(data);
      $("refresh-hint").textContent = "刚刚更新 · 15 秒自动刷新";
      showBanner("");
    } catch (err) {
      if (err.status !== 401 && err.status !== 403) {
        if (!options.silent) showBanner("读取概览失败：" + err.message);
      }
    } finally {
      state.refreshing = false;
    }
  }

  function renderOverview(data) {
    var counts = data.counts || {};
    var today = data.today || {};
    var network = data.network || {};
    setText("stat-accounts", num(counts.accounts));
    setText("stat-created-today", "今日新增 " + num(counts.createdToday));
    setText("stat-banned", num(counts.banned));
    setText("stat-online", num(counts.onlineDevices));
    setText("stat-devices", "已绑定设备 " + num(counts.devices));
    setText("stat-requests", num(today.requests));
    setText("stat-errors", "错误 " + num(today.errors));
    setText("stat-in", formatBytes(today.bytesIn));
    setText("stat-out", formatBytes(today.bytesOut));
    setText("stat-net-in", "网卡累计 " + formatBytes(network.rxBytes) + (network.available ? " · " + formatRate(network.rxRate) : ""));
    setText("stat-net-out", "网卡累计 " + formatBytes(network.txBytes) + (network.available ? " · " + formatRate(network.txRate) : ""));
    setText("stat-uptime", formatDuration(data.server && data.server.uptimeSeconds));
    setText("stat-started", "启动于 " + formatDateTime(data.server && data.server.startedAt));
    setText("stat-db", formatBytes(data.server && data.server.dbBytes));
    setText("stat-pairs", "配对 " + num(counts.pairs));

    var registration = !!data.registration;
    $("registration-toggle").checked = registration;
    var pill = $("registration-state");
    pill.textContent = registration ? "开放注册" : "仅管理员创建";
    pill.className = "pill " + (registration ? "pill-ok" : "pill-muted");

    renderChart(data.history || [], data.today || {});
    renderTopPaths(data.topPaths || []);
    renderServerFacts(data);
    renderRecentAudit(data.recentAudit || []);
  }

  function renderChart(history, today) {
    var container = $("history-chart");
    if (!history.length) {
      container.innerHTML = '<p class="empty">暂无统计数据。</p>';
      setText("chart-total", "–");
      return;
    }
    var max = 1;
    var total = 0;
    history.forEach(function (item) {
      max = Math.max(max, Number(item.requests) || 0);
      total += Number(item.requests) || 0;
    });
    setText("chart-total", "合计 " + num(total) + " 次");
    container.innerHTML = history.map(function (item) {
      var requests = Number(item.requests) || 0;
      var height = Math.max(2, Math.round(requests / max * 100));
      var isToday = item.day === today.day;
      return '<div class="bar' + (isToday ? " is-today" : "") + '" title="' +
        esc(item.day) + "：" + num(requests) + " 次请求，入站 " + formatBytes(item.bytesIn) +
        "，出站 " + formatBytes(item.bytesOut) + '">' +
        '<div class="bar-track"><div class="bar-fill" style="height:' + height + '%"></div></div>' +
        '<span class="bar-label">' + esc(String(item.day).slice(5)) + "</span></div>";
    }).join("");
  }

  function renderTopPaths(paths) {
    var list = $("top-paths");
    if (!paths.length) {
      list.innerHTML = '<li class="empty">今天还没有请求记录。</li>';
      return;
    }
    list.innerHTML = paths.map(function (item, index) {
      return "<li><span class=\"rank-index\">" + (index + 1) + "</span>" +
        '<span class="rank-path" title="' + esc(item.path) + '">' + esc(item.path) + "</span>" +
        '<span class="rank-count">' + num(item.count) + " · " + esc(item.share) + "%</span></li>";
    }).join("");
  }

  function renderServerFacts(data) {
    var server = data.server || {};
    var counts = data.counts || {};
    var network = data.network || {};
    var facts = [
      ["服务版本", esc(server.version || "–")],
      ["管理后台", "v" + esc(server.adminVersion || "0.1.0")],
      ["运行时长", esc(formatDuration(server.uptimeSeconds))],
      ["数据库", esc(formatBytes(server.dbBytes))],
      ["在线设备", num(counts.onlineDevices) + " / " + num(counts.devices)],
      ["活跃配对", num(counts.pairs)],
      ["有效会话", num(counts.sessions)],
      ["网卡累计", network.available
        ? "↓ " + formatBytes(network.rxBytes) + " · ↑ " + formatBytes(network.txBytes)
        : "不可用"]
    ];
    $("server-facts").innerHTML = facts.map(function (pair) {
      return "<div><dt>" + pair[0] + "</dt><dd>" + pair[1] + "</dd></div>";
    }).join("");
    setText("server-version", "v" + (server.version || "–"));
  }

  function renderRecentAudit(items) {
    var list = $("recent-audit");
    if (!items.length) {
      list.innerHTML = '<li class="empty">还没有操作记录。</li>';
      return;
    }
    list.innerHTML = items.map(function (item) {
      return "<li>" +
        '<span class="t-time" title="' + esc(formatDateTime(item.at)) + '">' + esc(relativeTime(item.at)) + "</span>" +
        '<span class="t-action">' + esc(actionLabel(item.action)) + "</span>" +
        '<span class="t-detail" title="' + esc((item.detail || "") + (item.ip ? " · " + item.ip : "")) + '">' +
        esc(item.detail || "—") + (item.ip ? " · " + esc(item.ip) : "") + "</span></li>";
    }).join("");
  }

  async function onRegistrationToggle(event) {
    var toggle = event.target;
    var enabled = toggle.checked;
    toggle.disabled = true;
    try {
      await api("/settings/registration", { method: "POST", body: { enabled: enabled } });
      if (state.overview) state.overview.registration = enabled;
      var pill = $("registration-state");
      pill.textContent = enabled ? "开放注册" : "仅管理员创建";
      pill.className = "pill " + (enabled ? "pill-ok" : "pill-muted");
      toast(enabled ? "已允许新账户注册" : "已关闭新账户注册");
    } catch (err) {
      toggle.checked = !enabled;
      toast("保存失败：" + err.message, true);
    } finally {
      toggle.disabled = false;
    }
  }

  /* ---------------- 账户 ---------------- */
  async function loadAccounts(options) {
    options = options || {};
    var container = $("accounts-body");
    if (!options.silent) {
      var skeleton = "";
      for (var i = 0; i < 6; i += 1) {
        skeleton += '<tr class="skeleton-row">' +
          '<td><span class="skel skel-sm"></span></td>'.repeat(7) + "</tr>";
      }
      container.innerHTML = skeleton;
    }
    var params = new URLSearchParams({
      page: String(state.accounts.page),
      pageSize: String(PAGE_SIZE),
      q: state.accounts.q,
      status: state.accounts.status
    });
    try {
      var data = await api("/accounts?" + params.toString());
      state.accounts.items = data.items || [];
      state.accounts.total = data.total || 0;
      state.accounts.page = data.page || 1;
      state.accounts.pages = data.pages || 1;
      renderAccounts();
    } catch (err) {
      if (err.status !== 401 && err.status !== 403) {
        container.innerHTML = '<tr><td colspan="7" class="empty">加载失败：' + esc(err.message) + "</td></tr>";
      }
    }
  }

  function statusPill(account) {
    if (account.status === "disabled") {
      return '<span class="pill pill-danger" title="' + esc(account.banReason || "永久封禁") + '">永久封禁</span>';
    }
    if (account.status === "banned") {
      return '<span class="pill pill-warn" title="' + esc(account.banReason || "限时封禁") + '">封禁中</span>' +
        '<div class="mono" style="margin-top:4px">至 ' + esc(account.banUntilLocal || account.banUntil || "–") + "</div>";
    }
    return '<span class="pill pill-ok">正常</span>';
  }

  function pairLabel(account) {
    if (account.pairState === "paired") {
      var role = account.role === "MASTER" ? "主人" : "小狗";
      return '<span class="tag tag-accent">已绑定</span> ' +
        esc(account.peerName || "对方") + " · " + role;
    }
    if (account.pairState === "pending") {
      return '<span class="tag">待确认</span>';
    }
    return '<span class="tag">未绑定</span>';
  }

  function renderAccounts() {
    var body = $("accounts-body");
    var items = state.accounts.items;
    if (!items.length) {
      body.innerHTML = "";
      $("accounts-empty").hidden = false;
      var filtered = !!(state.accounts.q || state.accounts.status !== "all");
      var emptyAction = $("empty-action");
      emptyAction.textContent = filtered ? "清除筛选" : "创建账户";
      emptyAction.dataset.mode = filtered ? "reset" : "create";
    } else {
      $("accounts-empty").hidden = true;
      body.innerHTML = items.map(function (account) {
        var actions = "";
        if (account.status === "active") {
          actions += '<button class="btn btn-ghost btn-sm" data-action="ban" data-id="' + account.id + '" type="button">封禁</button>';
        } else {
          actions += '<button class="btn btn-ghost btn-sm" data-action="unban" data-id="' + account.id + '" type="button">解封</button>';
        }
        actions += '<button class="btn btn-ghost btn-sm btn-danger-quiet" data-action="delete" data-id="' + account.id + '" type="button">删除</button>';
        var online = account.online
          ? '<span style="color:#7ff0c4">● 在线</span>'
          : "离线";
        return "<tr>" +
          '<td class="mono" data-label="ID">#' + account.id + "</td>" +
          '<td data-label="用户名"><div class="cell-user"><strong>' + esc(account.username) + "</strong><span>" + online + "</span></div></td>" +
          '<td data-label="创建时间">' + esc(account.createdAtLocal || account.createdAt || "–") + "</td>" +
          '<td data-label="状态">' + statusPill(account) + "</td>" +
          '<td data-label="设备 / 绑定"><div class="cell-device"><span>' + num(account.deviceCount) + " 台 · " +
            esc(account.deviceName || "无设备") + (account.platform ? " · " + esc(account.platform) : "") +
            "</span><span>" + pairLabel(account) + "</span></div></td>" +
          '<td data-label="最近在线">' + esc(account.lastSeenLocal || "从未登录") + "</td>" +
          '<td data-label="操作"><div class="row-actions">' + actions + "</div></td></tr>";
      }).join("");
    }
    setText("page-info", "第 " + state.accounts.page + " / " + state.accounts.pages +
      " 页 · 共 " + num(state.accounts.total) + " 个账户");
    $("prev-page").disabled = state.accounts.page <= 1;
    $("next-page").disabled = state.accounts.page >= state.accounts.pages;
  }

  function findAccount(id) {
    var items = state.accounts.items;
    for (var i = 0; i < items.length; i += 1) {
      if (items[i].id === id) return items[i];
    }
    return null;
  }

  function randomPassword() {
    var letters = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
    var digits = "23456789";
    var all = letters + digits;
    var buffer = new Uint32Array(14);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(buffer);
    } else {
      for (var i = 0; i < buffer.length; i += 1) buffer[i] = Math.floor(Math.random() * 4294967296);
    }
    var out = "";
    for (var j = 0; j < buffer.length; j += 1) out += all[buffer[j] % all.length];
    // 保证字母和数字各至少一个。
    if (!/[A-Za-z]/.test(out)) out = "Q" + out.slice(1);
    if (!/[0-9]/.test(out)) out = out.slice(0, -1) + String(buffer[0] % 9 + 1);
    return out;
  }

  function openCreateModal() {
    var password = randomPassword();
    openModal({
      title: "创建账户",
      body:
        '<label class="field"><span>用户名</span>' +
        '<input id="create-username" autocomplete="off" autocapitalize="none" spellcheck="false" ' +
        'placeholder="3–32 位小写字母 / 数字 / 下划线"></label>' +
        '<label class="field"><span>初始密码</span>' +
        '<input id="create-password" autocomplete="off" spellcheck="false" value="' + esc(password) + '"></label>' +
        '<p class="modal-note">已随机生成一个符合策略的密码，也可以手动修改。创建后请把账号与密码交给对方，并提醒对方登录后自行修改。</p>' +
        '<p id="create-error" class="form-error" hidden></p>',
      actions: [
        { label: "取消", onClick: function (ctx) { ctx.close(); } },
        {
          label: "创建", className: "btn-primary",
          onClick: async function (ctx) {
            var username = ctx.root.querySelector("#create-username").value.trim().toLowerCase();
            var pwd = ctx.root.querySelector("#create-password").value;
            var error = ctx.root.querySelector("#create-error");
            error.hidden = true;
            var problem = passwordProblem(pwd);
            if (!/^[a-z0-9_]{3,32}$/.test(username)) {
              error.textContent = "用户名需为 3–32 位小写字母、数字或下划线。";
              error.hidden = false;
              return;
            }
            if (problem) {
              error.textContent = problem;
              error.hidden = false;
              return;
            }
            ctx.setBusy(true);
            try {
              await api("/accounts", { method: "POST", body: { username: username, password: pwd } });
              ctx.close();
              toast("已创建账户 " + username);
              state.accounts.page = 1;
              loadAccounts();
              loadOverview({ silent: true });
            } catch (err) {
              error.textContent = err.message;
              error.hidden = false;
              ctx.setBusy(false);
            }
          }
        }
      ]
    });
  }

  function openBanModal(account) {
    var durations = [
      ["10m", "10 分钟"], ["1h", "1 小时"], ["24h", "24 小时"],
      ["7d", "一周"], ["permanent", "永久"]
    ];
    openModal({
      title: "封禁账户",
      body:
        '<p class="modal-note">正在封禁 <strong>' + esc(account.username) + "</strong>（#" + account.id +
        "）。封禁会立即注销该账户的全部登录会话。</p>" +
        '<div class="duration-grid">' + durations.map(function (item, index) {
          return '<label class="duration-option"><input type="radio" name="ban-duration" value="' +
            item[0] + '"' + (index === 1 ? " checked" : "") + "><span>" + item[1] + "</span></label>";
        }).join("") + "</div>" +
        '<label class="field"><span>原因（可选）</span>' +
        '<input id="ban-reason" maxlength="200" placeholder="例如：违规使用 / 账号异常"></label>' +
        '<p id="ban-error" class="form-error" hidden></p>',
      actions: [
        { label: "取消", onClick: function (ctx) { ctx.close(); } },
        {
          label: "确认封禁", className: "btn-danger",
          onClick: async function (ctx) {
            var picked = ctx.root.querySelector('input[name="ban-duration"]:checked');
            var reason = ctx.root.querySelector("#ban-reason").value.trim();
            var error = ctx.root.querySelector("#ban-error");
            error.hidden = true;
            if (!picked) { error.textContent = "请选择封禁期限。"; error.hidden = false; return; }
            ctx.setBusy(true);
            try {
              await api("/accounts/" + account.id + "/ban", {
                method: "POST", body: { duration: picked.value, reason: reason }
              });
              ctx.close();
              toast("已封禁 " + account.username);
              loadAccounts({ silent: true });
              loadOverview({ silent: true });
            } catch (err) {
              error.textContent = err.message;
              error.hidden = false;
              ctx.setBusy(false);
            }
          }
        }
      ]
    });
  }

  function openUnbanModal(account) {
    openModal({
      title: "解除封禁",
      body: '<p class="modal-note">确定解除 <strong>' + esc(account.username) + "</strong>（#" + account.id +
        "）的封禁吗？解除后该账户可以立即重新登录。</p>" +
        '<p id="unban-error" class="form-error" hidden></p>',
      actions: [
        { label: "取消", onClick: function (ctx) { ctx.close(); } },
        {
          label: "确认解封", className: "btn-primary",
          onClick: async function (ctx) {
            var error = ctx.root.querySelector("#unban-error");
            error.hidden = true;
            ctx.setBusy(true);
            try {
              await api("/accounts/" + account.id + "/unban", { method: "POST", body: {} });
              ctx.close();
              toast("已解封 " + account.username);
              loadAccounts({ silent: true });
              loadOverview({ silent: true });
            } catch (err) {
              error.textContent = err.message;
              error.hidden = false;
              ctx.setBusy(false);
            }
          }
        }
      ]
    });
  }

  function openDeleteModal(account) {
    openModal({
      title: "删除账户",
      role: "alertdialog",
      body: '<p class="modal-note">确定永久删除 <strong>' + esc(account.username) + "</strong>（#" + account.id +
        "）吗？此操作不可撤销。</p>" +
        '<p class="modal-note danger-text">该账户的设备与会话会立即失效，当前配对会被解除。' +
        "端到端加密的日记与和好券属于配对双方，会被保留。</p>" +
        '<p id="delete-error" class="form-error" hidden></p>',
      actions: [
        { label: "取消", onClick: function (ctx) { ctx.close(); } },
        {
          label: "永久删除", className: "btn-danger",
          onClick: async function (ctx) {
            var error = ctx.root.querySelector("#delete-error");
            error.hidden = true;
            ctx.setBusy(true);
            try {
              await api("/accounts/" + account.id, { method: "DELETE" });
              ctx.close();
              toast("已删除 " + account.username);
              if (state.accounts.items.length === 1 && state.accounts.page > 1) {
                state.accounts.page -= 1;
              }
              loadAccounts({ silent: true });
              loadOverview({ silent: true });
            } catch (err) {
              error.textContent = err.message;
              error.hidden = false;
              ctx.setBusy(false);
            }
          }
        }
      ]
    });
  }

  async function exportAccounts() {
    var button = $("export-btn");
    button.disabled = true;
    button.textContent = "导出中…";
    try {
      var params = new URLSearchParams({
        q: state.accounts.q,
        status: state.accounts.status
      });
      var response = await fetch(API + "/accounts/export?" + params.toString(), {
        headers: { Authorization: "Bearer " + state.token },
        cache: "no-store",
        credentials: "same-origin"
      });
      if (!response.ok) {
        var data = await safeJson(response);
        if (response.status === 401) sessionLost("登录已过期，请重新登录");
        throw new AppError((data && data.error && data.error.message) || "导出失败", response.status);
      }
      var blob = await response.blob();
      var disposition = response.headers.get("Content-Disposition") || "";
      var matched = /filename="([^"]+)"/.exec(disposition);
      var name = matched ? matched[1] : "qi-accounts.xlsx";
      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      toast("已导出 " + name);
    } catch (err) {
      toast("导出失败：" + err.message, true);
    } finally {
      button.disabled = false;
      button.textContent = "导出 Excel";
    }
  }

  /* ---------------- 审计 / 系统 ---------------- */
  async function loadAudit() {
    var body = $("audit-body");
    body.innerHTML = '<tr><td colspan="4" class="empty">加载中…</td></tr>';
    try {
      var data = await api("/audit?limit=200");
      var items = data.items || [];
      if (!items.length) {
        body.innerHTML = '<tr><td colspan="4" class="empty">还没有操作记录。</td></tr>';
        return;
      }
      body.innerHTML = items.map(function (item) {
        return "<tr>" +
          "<td>" + esc(formatDateTime(item.at)) + "</td>" +
          "<td>" + esc(actionLabel(item.action)) + "</td>" +
          '<td><div class="cell-user"><strong>' + esc(item.detail || "—") +
          "</strong><span>" + esc(item.actor || "系统") + "</span></div></td>" +
          '<td class="mono">' + esc(item.ip || "–") + "</td></tr>";
      }).join("");
    } catch (err) {
      if (err.status !== 401 && err.status !== 403) {
        body.innerHTML = '<tr><td colspan="4" class="empty">加载失败：' + esc(err.message) + "</td></tr>";
      }
    }
  }

  async function loadSystem() {
    try {
      var fetched = await api("/overview");
      state.overview = fetched;
      renderOverview(fetched);
    } catch (err) {
      if (err.status !== 401 && err.status !== 403) {
        showBanner("读取系统信息失败：" + err.message);
      }
    }
    var data = state.overview || {};
    var server = data.server || {};
    var counts = data.counts || {};
    var me = state.me || {};
    var protection = me.loginProtection || {};

    $("system-versions").innerHTML = [
      ["服务版本", esc(server.version || "–")],
      ["管理后台", "v" + esc(server.adminVersion || "0.1.0")],
      ["运行时长", esc(formatDuration(server.uptimeSeconds))],
      ["启动时间", esc(formatDateTime(server.startedAt))]
    ].map(function (pair) {
      return "<div><dt>" + pair[0] + "</dt><dd>" + pair[1] + "</dd></div>";
    }).join("");

    $("system-protection").innerHTML = [
      ["失败上限", num(protection.maxFails) + " 次"],
      ["统计窗口", num(protection.windowMinutes) + " 分钟"],
      ["锁定时长", num(protection.lockMinutes) + " 分钟"],
      ["会话时长", "12 小时"]
    ].map(function (pair) {
      return "<div><dt>" + pair[0] + "</dt><dd>" + pair[1] + "</dd></div>";
    }).join("");

    $("system-storage").innerHTML = [
      ["数据库大小", esc(formatBytes(server.dbBytes))],
      ["账户", num(counts.accounts)],
      ["设备", num(counts.devices)],
      ["活跃配对", num(counts.pairs)],
      ["今日请求", num((data.today || {}).requests)],
      ["网卡累计", data.network && data.network.available
        ? "↓ " + formatBytes(data.network.rxBytes) + " · ↑ " + formatBytes(data.network.txBytes)
        : "不可用"]
    ].map(function (pair) {
      return "<div><dt>" + pair[0] + "</dt><dd>" + pair[1] + "</dd></div>";
    }).join("");
  }

  /* ---------------- 模态框 ---------------- */
  function openModal(config) {
    var modal = $("modal");
    modal.setAttribute("role", config.role || "dialog");
    setText("modal-title", config.title || "");
    var body = $("modal-body");
    var foot = $("modal-foot");
    body.innerHTML = config.body || "";
    foot.innerHTML = "";
    var ctx = {
      root: body,
      close: closeModal,
      setBusy: function (busy) {
        $$(".modal-foot button", foot).forEach(function (button) { button.disabled = !!busy; });
      }
    };
    (config.actions || []).forEach(function (action) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "btn " + (action.className || "btn-ghost");
      button.textContent = action.label;
      button.addEventListener("click", function () { action.onClick(ctx); });
      foot.appendChild(button);
    });
    if (!modal.open) modal.showModal();
    document.body.style.overflow = "hidden";
    setTimeout(function () {
      var focus = body.querySelector("input:not([type=radio]), select, textarea") ||
        foot.querySelector("button");
      if (focus) focus.focus();
    }, 30);
  }

  function cleanupModal() {
    document.body.style.overflow = "";
    $("modal-body").innerHTML = "";
    $("modal-foot").innerHTML = "";
  }

  function closeModal() {
    var modal = $("modal");
    if (!modal || !modal.open) return;
    modal.close();
  }

  /* ---------------- 绑定 ---------------- */
  function bind() {
    $("login-form").addEventListener("submit", onLogin);
    $("password-form").addEventListener("submit", onChangePassword);
    $("logout-btn").addEventListener("click", onLogout);
    $("refresh-btn").addEventListener("click", function () {
      $("refresh-hint").textContent = "正在刷新…";
      if (state.view === "overview") loadOverview();
      else if (state.view === "accounts") loadAccounts();
      else if (state.view === "audit") loadAudit();
      else if (state.view === "settings") loadSettings();
      else loadSystem();
    });

    $$(".nav-item").forEach(function (item) {
      item.addEventListener("click", function () { switchView(item.dataset.view); });
    });
    document.addEventListener("click", function (event) {
      var link = event.target.closest("[data-view-link]");
      if (link) switchView(link.dataset.viewLink);
    });

    $("registration-toggle").addEventListener("change", onRegistrationToggle);
    $("broadcast-form").addEventListener("submit", onBroadcastSubmit);
    $("broadcast-clear").addEventListener("click", onBroadcastClear);

    $("add-admin-btn").addEventListener("click", openAddAdminModal);
    $("settings-password-form").addEventListener("submit", onSettingsPassword);
    $("theme-mode").addEventListener("click", onThemeModeClick);
    $("background-choices").addEventListener("change", onBackgroundChoice);
    $("solid-color").addEventListener("input", onSolidColorInput);
    $("solid-color").addEventListener("change", onSolidColorChange);
    $("blur-range").addEventListener("input", onBlurInput);
    $("blur-range").addEventListener("change", onBlurChange);
    $("background-file").addEventListener("change", onBackgroundFile);
    $("remove-background").addEventListener("click", removeBackground);
    $("app-wallpaper-img").addEventListener("error", function () {
      $("app-wallpaper").hidden = true;
    });

    $("account-search").addEventListener("input", function (event) {
      if (state.searchTimer) clearTimeout(state.searchTimer);
      var value = event.target.value.trim();
      state.searchTimer = setTimeout(function () {
        state.accounts.q = value;
        state.accounts.page = 1;
        loadAccounts({ silent: true });
      }, 300);
    });
    $("account-status").addEventListener("change", function (event) {
      state.accounts.status = event.target.value;
      state.accounts.page = 1;
      loadAccounts({ silent: true });
    });
    $("prev-page").addEventListener("click", function () {
      if (state.accounts.page <= 1) return;
      state.accounts.page -= 1;
      loadAccounts();
    });
    $("next-page").addEventListener("click", function () {
      if (state.accounts.page >= state.accounts.pages) return;
      state.accounts.page += 1;
      loadAccounts();
    });
    $("create-btn").addEventListener("click", openCreateModal);
    $("empty-action").addEventListener("click", function () {
      if (this.dataset.mode === "create") {
        openCreateModal();
        return;
      }
      state.accounts.q = "";
      state.accounts.status = "all";
      state.accounts.page = 1;
      $("account-search").value = "";
      $("account-status").value = "all";
      loadAccounts();
    });
    $("export-btn").addEventListener("click", exportAccounts);

    $("accounts-body").addEventListener("click", function (event) {
      var button = event.target.closest("button[data-action]");
      if (!button) return;
      var account = findAccount(Number(button.dataset.id));
      if (!account) return;
      if (button.dataset.action === "ban") openBanModal(account);
      if (button.dataset.action === "unban") openUnbanModal(account);
      if (button.dataset.action === "delete") openDeleteModal(account);
    });

    $("modal").addEventListener("click", function (event) {
      if (event.target.closest("[data-close]")) {
        closeModal();
        return;
      }
      if (event.target === this) closeModal();
    });
    $("modal").addEventListener("close", cleanupModal);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && state.token && state.me &&
          !state.me.mustChangePassword && state.view === "overview") {
        loadOverview({ silent: true });
      }
    });
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    bind();
    var token = storageGet();
    state.token = token || null;
    var cachedTheme = readThemeCache();
    if (cachedTheme) applyTheme(cachedTheme, {});
    watchSystemTheme();
    if (!token) {
      showLogin("");
      return;
    }
    try {
      var me = await api("/me");
      state.me = me;
      if (me.mustChangePassword) showPasswordView();
      else enterApp(me);
    } catch (err) {
      if (state.token) {
        state.token = null;
        storageClear();
      }
      showLogin(err.status === 401 ? "登录已过期，请重新登录" : err.message);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

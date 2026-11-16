#!/usr/bin/env node
/**
 * design-extract.mjs — rendered-browser evidence collector for DESIGN.md (URL mode).
 *
 * Connects to a running headless Edge/Chromium over CDP (no puppeteer, built-ins only:
 * global fetch + global WebSocket), samples pages at given viewports / color schemes,
 * and records, per element: role, computed styles, and the matching loaded CSS
 * declaration (selector + file) for the properties that matter to a design system.
 *
 * Screenshots and raw evidence are written ONLY to a temp directory.
 *
 * Usage:
 *   node scripts/design-extract.mjs [--out DIR]
 *
 * Env:
 *   CDP_ENDPOINT   default http://127.0.0.1:9222
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CDP = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222';
const argOut = process.argv.indexOf('--out');
const OUT = argOut > -1 ? process.argv[argOut + 1] : join(tmpdir(), 'inorinal-design-evidence');

const PAGES = [
  { id: 'new', url: 'https://music.apple.com/cn/new' },
  { id: 'home', url: 'https://music.apple.com/cn/home' },
  // room is discovered from links on /cn/new
];
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 1024, mobile: false },
  { name: 'mobile', width: 390, height: 844, mobile: true },
];
const SCHEMES = ['dark', 'light'];

const PROPS = [
  'color',
  'background-color',
  'background-image',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-transform',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-bottom',
  'row-gap',
  'column-gap',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'border-top-color',
  'border-top-width',
  'border-top-style',
  'box-shadow',
  'backdrop-filter',
  'position',
  'max-width',
  'width',
  'height',
  'opacity',
];

/* ------------------------------------------------------------------ CDP ---- */

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('ws error')), { once: true });
    });
    return new Cdp(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout ${method}`));
        }
      }, 60000);
    });
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage() {
  const r = await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' });
  if (!r.ok) throw new Error(`cannot create target: ${r.status} ${await r.text()}`);
  return r.json();
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const r = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    throw new Error('evaluate failed: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 400));
  }
  return r.result.value;
}

/* -------------------------------------------------------------- sampling ---- */

function sampler(payload) {
  const { props, maxPerRole } = payload;

  /* ---- 1. index loaded CSS declarations -------------------------------- */
  const propIndex = new Map(); // prop -> [{sel,val,href,cond,varRefs}]
  const varDecls = new Map(); // custom-prop -> [{val,href,cond,sel}]
  const sheets = [];
  let rules = 0;
  let budgetHit = false;
  const MAX_RULES = 160000;
  const MAX_PER_PROP = 2600;

  function push(map, key, entry, cap) {
    const arr = map.get(key);
    if (!arr) map.set(key, [entry]);
    else if (arr.length < cap) arr.push(entry);
  }

  function indexRules(list, href, cond) {
    for (const rule of list) {
      if (rules++ > MAX_RULES) {
        budgetHit = true;
        return;
      }
      const nested = rule.cssRules;
      if (nested && nested.length) {
        const c = [cond, rule.conditionText || rule.name || ''].filter(Boolean).join(' ');
        indexRules(nested, href, c);
        continue;
      }
      const st = rule.style;
      if (!st || !rule.selectorText) continue;
      const sel = rule.selectorText;
      const varRefs = new Set();
      for (let i = 0; i < st.length; i++) {
        const p = st[i];
        const v = st.getPropertyValue(p);
        if (!v) continue;
        for (const m of v.matchAll(/var\(\s*(--[\w-]+)/g)) varRefs.add(m[1]);
        if (p.startsWith('--')) {
          push(varDecls, p, { val: v.trim(), href, cond, sel }, 12);
        } else {
          push(propIndex, p, { sel, val: v.trim(), href, cond, varRefs: [...varRefs] }, MAX_PER_PROP);
        }
      }
    }
  }

  for (const sheet of document.styleSheets) {
    let ruleList = null;
    try {
      ruleList = sheet.cssRules;
    } catch {
      sheets.push({ href: sheet.href || '(inline)', readable: false });
      continue;
    }
    sheets.push({ href: sheet.href || '(inline)', readable: true, count: ruleList.length });
    try {
      indexRules(ruleList, sheet.href || '(inline)', '');
    } catch {
      sheets.push({ href: sheet.href || '(inline)', readable: 'partial' });
    }
  }

  /* ---- 2. helpers ------------------------------------------------------ */
  const lastCompound = (sel) => {
    const parts = sel.split(',').map((s) => s.trim());
    return parts
      .map((s) => {
        const segs = s.split(/\s*[>+~]\s*/);
        return segs[segs.length - 1] || s;
      })
      .join(', ');
  };
  const stripPseudo = (sel) =>
    sel
      .replace(/::[a-zA-Z-]+(\([^)]*\))?/g, '')
      .replace(/:(hover|focus|focus-visible|focus-within|active|visited|target|before|after|first-child|last-child|first-of-type|last-of-type|nth-child\([^)]*\)|nth-of-type\([^)]*\)|not\([^)]*\)|has\([^)]*\))/g, '');

  function matches(el, sel) {
    try {
      return el.matches(sel);
    } catch {
      return false;
    }
  }

  // cheap relation pre-filter so matching thousands of rules stays fast
  function related(el, sel) {
    const tag = el.tagName.toLowerCase();
    if (sel.includes(tag)) return true;
    if (sel.includes('*')) return true;
    const cls = el.classList;
    for (let i = 0; i < cls.length; i++) if (sel.includes(cls[i])) return true;
    if (el.id && sel.includes('#' + el.id)) return true;
    return false;
  }

  function declFor(el, prop, computedValue, limit = 2) {
    const out = [];
    const literal = propIndex.get(prop) || [];
    const viaVar = [];
    for (const d of literal) {
      if (out.length >= limit) break;
      if (d.varRefs.length) viaVar.push(d);
      if (!related(el, d.sel)) continue;
      if (!(matches(el, d.sel) || matches(el, stripPseudo(d.sel)) || matches(el, lastCompound(d.sel)))) continue;
      out.push({ selector: d.sel, declaration: `${prop}: ${d.val}`, href: d.href, condition: d.cond || undefined });
    }
    // declarations that resolve through a custom property which carries the computed value
    if (out.length < limit) {
      for (const [name, decls] of varDecls) {
        if (out.length >= limit) break;
        const d = decls.find((x) => x.val === computedValue);
        if (!d) continue;
        const used = (propIndex.get(prop) || []).some(
          (x) => x.varRefs.includes(name) && (matches(el, x.sel) || matches(el, stripPseudo(x.sel)) || matches(el, lastCompound(x.sel)))
        );
        if (used) {
          out.push({
            selector: d.sel,
            declaration: `${name}: ${d.val}`,
            href: d.href,
            condition: d.cond || undefined,
            note: 'custom property referenced by the matching rule',
          });
        }
      }
    }
    return out;
  }

  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4;
  };
  const textOf = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90);

  /* ---- 3. element selection by reconstructed role ---------------------- */
  const buckets = new Map();
  const read = new Set();
  function add(role, el) {
    if (!el || !el.isConnected) return;
    if (!visible(el)) return;
    const arr = buckets.get(role) || [];
    if (arr.length >= maxPerRole) return;
    if (read.has(el) && arr.length) {
      // allow an element to appear once per role bucket, but not twice in the same one
    }
    arr.push(el);
    buckets.set(role, arr);
  }
  function addAll(role, selector, filter) {
    let els = [];
    try {
      els = [...document.querySelectorAll(selector)];
    } catch {
      return;
    }
    els = els.filter((el) => el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE' && visible(el));
    if (filter) els = els.filter(filter);
    const n = els.length;
    if (!n) return;
    const idxs = [...new Set([0, Math.floor(n * 0.15), Math.floor(n * 0.4), Math.floor(n * 0.7), n - 1])];
    for (const i of idxs) add(role, els[i]);
  }

  add('page', document.documentElement);
  add('page', document.body);

  for (const sel of ['header', '[role="banner"]', 'nav', '[role="navigation"]', 'aside'])
    addAll('chrome', sel);

  addAll('heading-1', 'h1');
  addAll('heading-2', 'h2');
  addAll('heading-3', 'h3');
  addAll('paragraph', 'p', (el) => textOf(el).length > 0);
  addAll('button', 'button, [role="button"], a[role="button"]', (el) => textOf(el).length > 0);
  addAll(
    'link',
    'a[href]',
    (el) => {
      const t = textOf(el);
      const r = el.getBoundingClientRect();
      return t.length > 0 && t.length < 70 && r.height < 140;
    }
  );
  addAll(
    'card',
    '[class*="card" i], [class*="tile" i], [class*="lockup" i], [class*="item" i], [class*="shelf" i], [class*="product" i]',
    (el) => el.getBoundingClientRect().height > 80 && el.querySelector('img, picture, a[href]')
  );
  addAll('list-item', 'li', (el) => textOf(el).length > 0 && el.getBoundingClientRect().height > 20);
  addAll(
    'section',
    'main > *, [class*="section" i]',
    (el) => el.getBoundingClientRect().height > 120
  );

  /* ---- 4. record ------------------------------------------------------- */
  const records = [];
  for (const [role, els] of buckets) {
    for (const el of els) {
      if (records.length > 220) break;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const values = {};
      for (const p of props) {
        const v = cs.getPropertyValue(p);
        if (!v) continue;
        if (p === 'background-image' && (v === 'none' || v.length > 220)) {
          if (v !== 'none') values[p] = v.slice(0, 220);
          continue;
        }
        if (p === 'box-shadow' && v.length > 200) {
          values[p] = v.slice(0, 200);
          continue;
        }
        values[p] = v;
      }
      const decls = {};
      for (const [prop, computedValue] of Object.entries(values)) {
        if (
          [
            'color',
            'background-color',
            'font-family',
            'font-size',
            'font-weight',
            'line-height',
            'letter-spacing',
            'padding-top',
            'padding-left',
            'border-top-left-radius',
            'border-top-color',
            'border-top-width',
            'box-shadow',
            'backdrop-filter',
            'max-width',
            'row-gap',
          ].includes(prop)
        ) {
          const d = declFor(el, prop, computedValue);
          if (d.length) decls[prop] = d;
        }
      }
      records.push({
        role,
        tag: el.tagName.toLowerCase(),
        selectorHint:
          el.tagName.toLowerCase() +
          (el.id ? '#' + el.id : '') +
          (el.classList.length ? '.' + [...el.classList].slice(0, 4).join('.') : ''),
        text: textOf(el),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        values,
        decls,
      });
    }
  }

  /* ---- 5. root custom properties + page facts ------------------------- */
  const varNames = [...varDecls.keys()].slice(0, 900);
  const root = getComputedStyle(document.documentElement);
  const rootVars = {};
  for (const name of varNames) {
    const v = root.getPropertyValue(name).trim();
    if (!v) continue;
    if (v.length > 160) continue;
    if (!/^#|rgba?\(|hsla?\(|color-mix|oklch|^(blur|saturate|brightness|drop-shadow)|^-?[\d.]+(px|rem|em|%)$|^(SF|\.SF)|Apple/.test(v)) continue;
    rootVars[name] = v;
  }

  const media = {
    dark: matchMedia('(prefers-color-scheme: dark)').matches,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };

  const fonts = [];
  try {
    document.fonts.forEach((f) => {
      if (f.status === 'loaded') fonts.push(`${f.family} ${f.weight} ${f.style}`);
    });
  } catch {}

  const links = {};
  try {
    links.room = [...new Set([...document.querySelectorAll('a[href*="/room/"]')].map((a) => a.href))].slice(0, 4);
    links.album = [...new Set([...document.querySelectorAll('a[href*="/album/"]')].map((a) => a.href))].slice(0, 2);
  } catch {}

  const metaTheme = [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content);

  return {
    page: {
      url: location.href,
      title: document.title,
      htmlLang: document.documentElement.lang,
      size: { w: innerWidth, h: innerHeight, scrollH: document.documentElement.scrollHeight },
      media,
      metaTheme,
      fonts: [...new Set(fonts)].slice(0, 24),
      sheets: sheets.slice(0, 40),
      stylesheetCount: sheets.length,
      ruleCount: rules,
      budgetHit,
      rootVars,
      linkSamples: links,
    },
    records,
  };
}

/* --------------------------------------------------------------- census ---- */

function censusSampler(payload) {
  const { patterns, targetColors } = payload;
  const CAP = 7000;

  const all = [...document.querySelectorAll('body *')].slice(0, CAP);
  const isVis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };

  const bump = (map, key, ex, maxKeys = 400) => {
    if (!key || key === 'none' || key === 'normal' || key === 'rgba(0, 0, 0, 0)') return;
    let e = map[key];
    if (!e) {
      if (Object.keys(map).length >= maxKeys) return;
      e = map[key] = { n: 0, ex: [] };
    }
    e.n++;
    if (e.ex.length < 5 && ex) e.ex.push(ex);
  };
  const hint = (el) => {
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 46);
    return `${el.tagName.toLowerCase()}${el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : ''}${t ? ' | ' + t : ''}`;
  };

  const typography = {};
  const colors = {};
  const backgrounds = {};
  const radius = {};
  const padding = {};
  const gaps = {};
  const shadows = {};
  const glass = [];
  const colorHits = {};
  for (const t of targetColors) colorHits[t] = [];
  let readable = 0;

  for (const el of all) {
    if (!isVis(el)) continue;
    const cs = getComputedStyle(el);
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (hasText) {
      const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      const size = cs.fontSize;
      const lh = cs.lineHeight;
      const w = cs.fontWeight;
      if (parseFloat(size) >= 9) {
        bump(typography, `${size} / ${lh} / ${w} / ${cs.letterSpacing} / ${fam}`, hint(el), 200);
      }
    }
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') bump(backgrounds, cs.backgroundColor, hint(el), 200);
    bump(colors, cs.color, hint(el), 200);
    if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') bump(colors, 'border ' + cs.borderTopColor, hint(el), 200);
    const rad = cs.borderTopLeftRadius;
    if (parseFloat(rad) > 0) bump(radius, rad, hint(el) + ' :: ' + [cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].join('/'), 120);
    if (el.children.length || hasText) bump(padding, `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`, hint(el), 160);
    if (cs.rowGap !== 'normal' || cs.columnGap !== 'normal') bump(gaps, `${cs.rowGap} / ${cs.columnGap}`, hint(el), 80);
    if (cs.boxShadow !== 'none') bump(shadows, cs.boxShadow.slice(0, 90), hint(el), 80);
    const bf = cs.backdropFilter || cs.webkitBackdropFilter;
    if (bf && bf !== 'none' && glass.length < 24) {
      glass.push({
        hint: hint(el),
        group: el.parentElement ? el.parentElement.tagName.toLowerCase() + '.' + [...(el.parentElement.classList || [])].slice(0, 2).join('.') : '',
        value: bf,
        bg: cs.backgroundColor,
        rect: (() => {
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        })(),
        position: cs.position,
        zIndex: cs.zIndex,
      });
    }
    for (const t of targetColors) {
      if (colorHits[t].length >= 5) continue;
      if (cs.color === t || cs.backgroundColor === t || cs.borderTopColor === t) {
        colorHits[t].push({ hint: hint(el), prop: cs.color === t ? 'color' : cs.backgroundColor === t ? 'background-color' : 'border-color' });
      }
    }
  }

  /* CSS declaration search over loaded rules */
  const cssMatches = {};
  for (const p of patterns) cssMatches[p] = [];
  let rules = 0;
  const walk = (list, href, cond) => {
    for (const r of list) {
      rules++;
      if (rules > 200000) return;
      if (r.cssRules && r.cssRules.length) {
        walk(r.cssRules, href, [cond, r.conditionText || r.name || ''].filter(Boolean).join(' '));
        continue;
      }
      const st = r.style;
      if (!st || !r.selectorText) continue;
      for (let i = 0; i < st.length; i++) {
        const prop = st[i];
        const val = st.getPropertyValue(prop).trim();
        if (!val) continue;
        const line = `${prop}: ${val}`;
        for (const p of patterns) {
          if (cssMatches[p].length >= 8) continue;
          if (line.includes(p) || p === val) cssMatches[p].push({ selector: r.selectorText.slice(0, 180), line, href, cond });
        }
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules, sheet.href || '(inline)', '');
    } catch {
      /* cross-origin: unreadable */
    }
  }
  for (const el of document.querySelectorAll('*')) {
    if (el.tagName.includes('-')) readable++;
  }

  return {
    url: location.href,
    size: { w: innerWidth, h: innerHeight, scrollH: document.documentElement.scrollHeight },
    counts: { elements: all.length, customElements: readable },
    typography,
    colors,
    backgrounds,
    radius,
    padding,
    gaps,
    shadows,
    glass,
    colorHits,
    cssMatches,
  };
}

/* ------------------------------------------------------------------ main ---- */

async function waitReady(cdp, url) {
  const deadline = Date.now() + 45000;
  let lastLen = 0;
  let stable = 0;
  while (Date.now() < deadline) {
    const st = await evaluate(
      cdp,
      `(() => ({ rs: document.readyState, href: location.href, len: document.body ? document.body.innerText.length : 0, imgs: document.images.length }))()`
    );
    if (st.rs === 'complete' && st.len > 1200) {
      if (Math.abs(st.len - lastLen) < 40) stable++;
      else stable = 0;
      lastLen = st.len;
      if (stable >= 2) return st;
    }
    await sleep(700);
  }
  return await evaluate(cdp, `({ rs: document.readyState, href: location.href, len: document.body ? document.body.innerText.length : 0 })`);
}

function slug(s) {
  return s.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(join(OUT, 'screens'), { recursive: true });

  const ver = await (await fetch(`${CDP}/json/version`)).json();
  console.log(`[cdp] ${ver.Browser}`);

  const target = await newPage();
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');

  const asProbe = process.argv.includes('--probe');

  // discover a room page from /cn/new
  let roomUrl = null;
  {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1024, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await cdp.send('Page.navigate', { url: PAGES[0].url });
    await waitReady(cdp, PAGES[0].url);
    const links = await evaluate(
      cdp,
      `JSON.stringify({room:[...new Set([...document.querySelectorAll('a[href*="/room/"]')].map(a=>a.href))].slice(0,5)})`,
      false
    );
    const parsed = JSON.parse(links);
    console.log('[discover] rooms:', parsed.room);
    roomUrl = parsed.room && parsed.room[0];
  }
  if (roomUrl) PAGES.push({ id: 'room', url: roomUrl });

  if (asProbe) {
    const patterns = [
      'fa2d48',
      'saturate(190%)',
      'blur(60px)',
      'backdrop-filter',
      'SF Pro',
      '#0d0d0d',
      '#141414',
      '#fafafa',
      '#e6e6e6',
      'border-radius: 18px',
      'border-radius: 6px',
      'border-radius: 8px',
      'border-radius: 1000px',
      'letter-spacing',
      'font-size: 34px',
      'font-size: 42px',
      'font-weight: 600',
      'prefers-color-scheme',
      '--brand',
    ];
    const targetColors = [
      'rgb(250, 45, 72)',
      'rgb(255, 45, 85)',
      'rgb(10, 132, 255)',
      'rgb(0, 122, 255)',
      'rgb(31, 31, 31)',
      'rgb(13, 13, 13)',
      'rgb(20, 20, 20)',
      'rgb(250, 250, 250)',
      'rgb(230, 230, 230)',
    ];
    const probeMatrix = [
      { page: 'new', vp: VIEWPORTS[0], scheme: 'dark' },
      { page: 'new', vp: VIEWPORTS[0], scheme: 'light' },
      { page: 'new', vp: VIEWPORTS[1], scheme: 'dark' },
      { page: 'home', vp: VIEWPORTS[0], scheme: 'dark' },
      { page: 'room', vp: VIEWPORTS[0], scheme: 'dark' },
    ];
    const out = { generatedAt: new Date().toISOString(), cdp: ver.Browser, samples: [] };
    for (const item of probeMatrix) {
      const page = PAGES.find((p) => p.id === item.page);
      const label = `${item.page}__${item.vp.name}__${item.scheme}`;
      try {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: item.vp.width,
          height: item.vp.height,
          deviceScaleFactor: 1,
          mobile: item.vp.mobile,
          screenWidth: item.vp.width,
          screenHeight: item.vp.height,
        });
        await cdp.send('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-color-scheme', value: item.scheme }],
        });
        await cdp.send('Page.navigate', { url: page.url });
        const ready = await waitReady(cdp, page.url);
        await sleep(1200);
        const data = await evaluate(cdp, `(${censusSampler.toString()})(${JSON.stringify({ patterns, targetColors })})`);
        out.samples.push({ page: item.page, url: page.url, ready, viewport: item.vp, scheme: item.scheme, data });
        console.log(
          `[probe] ${label} -> typo=${Object.keys(data.typography).length} bg=${Object.keys(data.backgrounds).length} radius=${Object.keys(data.radius).length} glass=${data.glass.length} hits=${targetColors.map((c) => data.colorHits[c].length).join(',')}`
        );
      } catch (err) {
        console.log(`[probe] ${label} FAILED: ${err.message}`);
      }
    }
    const p = join(OUT, 'probe.json');
    writeFileSync(p, JSON.stringify(out, null, 2));
    console.log('[out] probe:', p);
    cdp.close();
    try {
      await fetch(`${CDP}/json/close/${target.id}`);
    } catch {}
    return;
  }

  const ledger = { generatedAt: new Date().toISOString(), cdp: ver.Browser, samples: [] };

  for (const page of PAGES) {
    for (const vp of VIEWPORTS) {
      for (const scheme of SCHEMES) {
        const label = `${page.id}__${vp.name}__${scheme}`;
        try {
          await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: vp.width,
            height: vp.height,
            deviceScaleFactor: 1,
            mobile: vp.mobile,
            screenWidth: vp.width,
            screenHeight: vp.height,
          });
          await cdp.send('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-color-scheme', value: scheme }],
          });
          await cdp.send('Page.navigate', { url: page.url });
          const ready = await waitReady(cdp, page.url);
          await sleep(1200); // fonts / hydration / lazy hero media
          const data = await evaluate(cdp, `(${sampler.toString()})(${JSON.stringify({ props: PROPS, maxPerRole: 7 })})`);
          const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
          const shotPath = join(OUT, 'screens', `${label}.png`);
          writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
          ledger.samples.push({
            page: page.id,
            url: page.url,
            resolvedUrl: ready.href || page.url,
            viewport: vp,
            scheme,
            ready,
            screenshot: shotPath,
            data,
          });
          console.log(`[sample] ${label} -> ${data.records.length} records, ${Object.keys(data.page.rootVars).length} root vars, ${data.page.ruleCount} rules`);
        } catch (err) {
          console.log(`[sample] ${label} FAILED: ${err.message}`);
          ledger.samples.push({ page: page.id, url: page.url, viewport: vp, scheme, error: err.message });
        }
      }
    }
  }

  // screenshot of the room page only once in dark desktop is enough; all are captured above

  const ledgerPath = join(OUT, 'ledger.json');
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));

  /* ---- aggregate -------------------------------------------------------- */
  const agg = {};
  for (const s of ledger.samples) {
    if (!s.data) continue;
    for (const r of s.data.records) {
      const key = r.role;
      agg[key] = agg[key] || { count: 0, values: {}, samples: [] };
      agg[key].count++;
      if (agg[key].samples.length < 6) agg[key].samples.push({ where: `${s.page}/${s.viewport.name}/${s.scheme}`, text: r.text.slice(0, 40), sel: r.selectorHint });
      for (const [p, v] of Object.entries(r.values)) {
        if (!['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'padding-top', 'padding-left', 'border-top-left-radius', 'border-top-color', 'border-top-width', 'box-shadow', 'backdrop-filter', 'text-transform', 'row-gap', 'max-width'].includes(p)) continue;
        agg[key].values[p] = agg[key].values[p] || {};
        const vv = v.length > 90 ? v.slice(0, 90) : v;
        agg[key].values[p][vv] = (agg[key].values[p][vv] || 0) + 1;
      }
    }
  }
  writeFileSync(join(OUT, 'aggregate.json'), JSON.stringify(agg, null, 2));
  writeFileSync(join(OUT, 'screenshot-list.txt'), ledger.samples.filter((s) => s.screenshot).map((s) => `${s.page}\t${s.viewport.name}\t${s.scheme}\t${s.screenshot}`).join('\n'));

  console.log(`\n[out] ${OUT}`);
  console.log(`[out] ledger: ${ledgerPath}`);
  console.log(`[out] aggregate: ${join(OUT, 'aggregate.json')}`);
  cdp.close();
  try {
    await fetch(`${CDP}/json/close/${target.id}`);
  } catch {}
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});

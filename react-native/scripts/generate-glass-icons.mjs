/**
 * Rasterise the selected Nucleo Glass icons into two neutral glass variants:
 *   light/  white glass for dark backgrounds and vivid accent chips
 *   dark/   charcoal glass for light backgrounds
 * (AI made these,to be honest,I know that you`ll notice even I don`t say;) )
 *
 * We do this at build time because the source icons use SVG gradients, masks and
 * filters; rendering them at runtime would mean one filtered SVG per icon. The
 * committed PNGs keep the runtime cheap and predictable.、
 * (Because using SVG will let the little`s phone laggy,so I rasterise the icons into PNGs.)
 *
 * Requires: edge (or Chromium) + sharp, both dev-only.
 *   node scripts/generate-glass-icons.mjs
 */
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as Nucleo from 'nucleo-glass';
import sharp from 'sharp';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {GLASS_ICON_SPEC} from './glass-icon-spec.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'src', 'assets', 'glass-icons');
const EDGE =
  process.env.EDGE_PATH ||
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CELL = 96;
const COLS = 10;

const VARIANTS = {
  light: {
    '--nc-gradient-1-color-1': '#FFFFFF',
    '--nc-gradient-1-color-2': '#C9CEDD',
    '--nc-gradient-2-color-1': 'rgba(255,255,255,0.55)',
    '--nc-gradient-2-color-2': 'rgba(180,190,210,0.60)',
    '--nc-light': '#FFFFFF',
  },
  dark: {
    '--nc-gradient-1-color-1': '#3A3A44',
    '--nc-gradient-1-color-2': '#0B0B10',
    '--nc-gradient-2-color-1': 'rgba(120,125,145,0.50)',
    '--nc-gradient-2-color-2': 'rgba(28,28,36,0.50)',
    '--nc-light': '#FFFFFF',
  },
};

function buildSheet(variant, uniqueId) {
  const rows = Math.ceil(GLASS_ICON_SPEC.length / COLS);
  const cells = GLASS_ICON_SPEC.map(({key, component}) => {
    const Icon = Nucleo[component];
    if (!Icon) {
      throw new Error(`Nucleo Glass component missing: ${component}`);
    }
    const svg = renderToStaticMarkup(
      React.createElement(Icon, {
        size: CELL,
        uniqueId: `${variant}-${key}-${uniqueId}`,
        style: VARIANTS[variant],
      }),
    );
    return `<div class="cell">${svg}</div>`;
  }).join('');
  return {
    rows,
    html: `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:transparent;overflow:hidden}
      .sheet{display:grid;grid-template-columns:repeat(${COLS},${CELL}px);grid-auto-rows:${CELL}px;width:${COLS * CELL}px}
      .cell{width:${CELL}px;height:${CELL}px;display:flex;align-items:center;justify-content:center;overflow:hidden}
      .cell svg{display:block}
    </style></head><body><div class="sheet">${cells}</div></body></html>`,
  };
}

function screenshot(html, width, height) {
  return new Promise(async (resolve, reject) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inorinal-glass-'));
    const htmlPath = path.join(tmp, 'sheet.html');
    const pngPath = path.join(tmp, 'sheet.png');
    const profile = path.join(tmp, 'profile');
    fs.writeFileSync(htmlPath, html);
    try {
      execFileSync(
        EDGE,
        [
          '--headless',
          '--disable-gpu',
          '--hide-scrollbars',
          '--no-first-run',
          '--default-background-color=00000000',
          '--force-device-scale-factor=1',
          `--user-data-dir=${profile}`,
          `--window-size=${width},${height}`,
          `--screenshot=${pngPath}`,
          `file:///${htmlPath.replaceAll('\\', '/')}`,
        ],
        {stdio: 'pipe', timeout: 120000},
      );
      // Edge's screenshot writer can finalise a few milliseconds after exit.
      for (let i = 0; i < 80 && !fs.existsSync(pngPath); i += 1) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (!fs.existsSync(pngPath)) {
        throw new Error('Edge did not produce the icon sheet screenshot');
      }
      const png = fs.readFileSync(pngPath);
      resolve(png);
    } catch (error) {
      reject(error);
    } finally {
      try {
        fs.rmSync(tmp, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 150,
        });
      } catch {
        // Edge can keep the temp profile locked briefly after exit; the sheet
        // has already been read, so a leftover temp dir is harmless.
      }
    }
  });
}

async function main() {
  fs.mkdirSync(path.join(OUT, 'light'), {recursive: true});
  fs.mkdirSync(path.join(OUT, 'dark'), {recursive: true});
  const uniqueId = process.argv[2] || 'inorinal';

  for (const variant of Object.keys(VARIANTS)) {
    const {rows, html} = buildSheet(variant, uniqueId);
    const sheetPng = await screenshot(html, COLS * CELL, rows * CELL);
    const sheet = await sharp(sheetPng).png().toBuffer();
    for (let index = 0; index < GLASS_ICON_SPEC.length; index += 1) {
      const {key} = GLASS_ICON_SPEC[index];
      const left = (index % COLS) * CELL;
      const top = Math.floor(index / COLS) * CELL;
      const cell = await sharp(sheet)
        .extract({left, top, width: CELL, height: CELL})
        .png({compressionLevel: 9})
        .toBuffer();
      fs.writeFileSync(path.join(OUT, variant, `${key}.png`), cell);
    }
    console.log(`${variant}: ${GLASS_ICON_SPEC.length} icons (${rows} rows)`);
  }

  const lines = [
    '/* eslint-disable */',
    '// AUTO-GENERATED by scripts/generate-glass-icons.mjs. Do not edit by hand.',
    '// Source: Nucleo Glass Icons (https://nucleoapp.com/svg-glass-icons).',
    'export const GLASS_ICON_SOURCES = {',
  ];
  for (const {key} of GLASS_ICON_SPEC) {
    lines.push(
      `  ${key}: {light: require('../assets/glass-icons/light/${key}.png'), dark: require('../assets/glass-icons/dark/${key}.png')},`,
    );
  }
  lines.push('} as const;', '', 'export type GlassIconName = keyof typeof GLASS_ICON_SOURCES;', '');
  fs.writeFileSync(
    path.join(ROOT, 'src', 'components', 'glass-icons.generated.ts'),
    lines.join('\n'),
  );
  console.log('wrote src/components/glass-icons.generated.ts');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

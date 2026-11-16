/** Verify every Glass icon used by the app has committed light/dark PNGs. */
import fs from 'node:fs';
import path from 'node:path';
import {GLASS_ICON_SPEC} from './glass-icon-spec.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const ASSETS = path.join(ROOT, 'src', 'assets', 'glass-icons');
let failed = 0;

for (const {key} of GLASS_ICON_SPEC) {
  for (const variant of ['light', 'dark']) {
    const file = path.join(ASSETS, variant, `${key}.png`);
    if (!fs.existsSync(file)) {
      console.error(`missing ${variant}/${key}.png`);
      failed += 1;
    } else if (fs.statSync(file).size < 200) {
      console.error(`suspiciously small ${variant}/${key}.png`);
      failed += 1;
    }
  }
}

const sourceRoot = path.join(ROOT, 'src');
const forbidden = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      const text = fs.readFileSync(full, 'utf8');
      if (/MaterialIcons|material-codepoints/.test(text)) {
        forbidden.push(full);
      }
    }
  }
}
walk(sourceRoot);

if (forbidden.length) {
  console.error('Material icon references remain:', forbidden);
  failed += forbidden.length;
}

if (failed) {
  process.exit(1);
}
console.log(`glass icons ok: ${GLASS_ICON_SPEC.length} names x 2 variants`);

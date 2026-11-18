import {parseDoodle, type Doodle} from './sharedBlocks';

export type DocBlock =
  | {kind: 'text'; id: string; text: string}
  | {kind: 'image'; id: string; uri: string};

export interface DocSticker {
  id: string;
  html: string;
}

export interface RichDoc {
  blocks: DocBlock[];
  stickers: DocSticker[];
  doodle: Doodle | null;
  hasStickers: boolean;
}

const STICKER_REGEX = /<span\b[^>]*class="[^"]*journal-sticker[^"]*"[^>]*>[\s\S]*?<\/span>/gi;
const DOODLE_REGEX = /<div\b[^>]*class="[^"]*doodle-data[^"]*"[^>]*>[\s\S]*?<\/div>/gi;
const TOKEN_REGEX =
  /<img\b[^>]*\bsrc="([^"]+)"[^>]*>|<div\b[^>]*>([\s\S]*?)<\/div>|<p\b[^>]*>([\s\S]*?)<\/p>/gi;

let counter = 0;

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function encodeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function stripTags(fragment: string): string {
  return decodeEntities(
    fragment
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|li)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  );
}

export function emptyRichDoc(): RichDoc {
  return {
    blocks: [{kind: 'text', id: nextId('p'), text: ''}],
    stickers: [],
    doodle: null,
    hasStickers: false,
  };
}

/**
 * 解析编辑器 HTML：正文按文档顺序还原成段落 / 图片块，贴纸原样保留（不重写属性），
 * 涂鸦仍以隐藏 JSON 的形式存在，交给原生绘制层渲染。
 */
export function parseRichDoc(html: string): RichDoc {
  if (!html || !html.trim()) {
    return emptyRichDoc();
  }

  const withoutNoise = html
    .replace(DOODLE_REGEX, '')
    .replace(STICKER_REGEX, '');

  const stickers: DocSticker[] = [];
  STICKER_REGEX.lastIndex = 0;
  let stickerMatch = STICKER_REGEX.exec(html);
  while (stickerMatch) {
    stickers.push({id: nextId('s'), html: stickerMatch[0]});
    stickerMatch = STICKER_REGEX.exec(html);
  }

  const blocks: DocBlock[] = [];
  TOKEN_REGEX.lastIndex = 0;
  let token = TOKEN_REGEX.exec(withoutNoise);
  while (token) {
    if (token[1]) {
      blocks.push({kind: 'image', id: nextId('i'), uri: decodeEntities(token[1])});
    } else {
      const raw = token[2] ?? token[3] ?? '';
      // 每个 <div>/<p> 就是一个段落，不做合并：合并会把「空段落 + 有字」粘成一段。
      const text = stripTags(raw).replace(/\n+$/g, '');
      blocks.push({kind: 'text', id: nextId('p'), text});
    }
    token = TOKEN_REGEX.exec(withoutNoise);
  }

  if (!blocks.length) {
    blocks.push({kind: 'text', id: nextId('p'), text: stripTags(withoutNoise).trim()});
  }

  return {
    blocks,
    stickers,
    doodle: parseDoodle(html),
    hasStickers: stickers.length > 0,
  };
}

export function serializeRichDoc(doc: RichDoc): string {
  const parts: string[] = [];
  doc.blocks.forEach(block => {
    if (block.kind === 'image') {
      parts.push(
        `<img class="inserted-image" src="${block.uri}" style="max-width:100%;display:block">`,
      );
      return;
    }
    const lines = block.text.split('\n');
    lines.forEach(line => {
      parts.push(line.trim() ? `<div>${encodeText(line)}</div>` : '<div><br></div>');
    });
  });

  doc.stickers.forEach(sticker => parts.push(sticker.html));

  if (doc.doodle && doc.doodle.strokes.length) {
    const payload = {
      version: 1,
      canvas: {width: doc.doodle.width, height: doc.doodle.height, dpr: 1},
      strokes: doc.doodle.strokes.map((stroke, index) => ({
        id: `native-stroke-${index}`,
        type: 'stroke',
        tool: 'pencil',
        color: stroke.color,
        width: stroke.width,
        points: stroke.points.map(point => ({x: point.x, y: point.y})),
      })),
      bitmapLayers: [],
      updatedAt: Date.now(),
    };
    const encoded = encodeURIComponent(JSON.stringify(payload));
    parts.push(
      `<div class="doodle-data" contenteditable="false" data-doodle-json="${encoded}"></div>`,
    );
  }

  return parts.join('') || '<div><br></div>';
}

/** 只有纯文字 + 图片、没有贴纸和涂鸦的文档，可以安全地在原生页里编辑。 */
export function isNativeEditable(doc: RichDoc): boolean {
  return !doc.hasStickers;
}

export function docPreview(doc: RichDoc, limit = 80): string {
  const text = doc.blocks
    .map(block => (block.kind === 'text' ? block.text : '［图片］'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) {
    return doc.doodle ? '［涂鸦］' : '';
  }
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * 只有贴纸必须回到 WebView 编辑器：贴纸是绝对定位的可拖拽节点，
 * 原生编辑器目前不接管它的摆放。
 */
export function needsWebEditor(html: string): boolean {
  return /<span\b[^>]*class="[^"]*journal-sticker[^"]*"[^>]*>/i.test(html);
}

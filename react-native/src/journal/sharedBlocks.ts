/**
 * 把共享日记的 HTML 拆成可原生渲染的块（文字 / 图片）。
 *
 * 只读页不使用 WebView：旧版 WebView 在部分设备上会崩掉渲染进程，
 * 而这里需要的东西其实只有「文字 + 图片」两种块。
 */

export type SharedBlock =
  | {kind: 'text'; text: string; bullet: boolean}
  | {kind: 'image'; uri: string};

const IMG_TAG = /(<img\b[^>]*>)/gi;
const TAG = /<[^>]+>/g;

function unescapeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(
    `${name}\\s*=\\s*("([^"]*)"|'([^']*)')`,
    'i',
  ).exec(tag);
  return match ? (match[2] ?? match[3] ?? '') : null;
}

function isDisplayable(uri: string | null): uri is string {
  return !!uri && /^(data:|https?:|file:)/i.test(uri);
}

function pushTextBlocks(blocks: SharedBlock[], html: string) {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|ul|ol)>/gi, '\n')
    .replace(/<(p|div|h[1-6]|blockquote|ul|ol)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n\u0001');

  for (const rawLine of withBreaks.split('\n')) {
    const bullet = rawLine.includes('\u0001');
    const text = unescapeEntities(rawLine.replace(/\u0001/g, '').replace(TAG, ''))
      .replace(/[ \t]+/g, ' ')
      .trim();
    if (!text) {
      continue;
    }
    blocks.push({kind: 'text', text, bullet});
  }
}

/**
 * 顺序遍历正文，产出文字块与图片块。
 *
 * 贴纸/涂鸦在编辑器里是带 background-image 的 span，这里按图片处理，
 * 保证「图片、贴纸、涂鸦」都不会丢；对方设备上的本地 scheme 直接丢弃。
 */
export function toSharedBlocks(html: string): SharedBlock[] {
  if (!html) {
    return [];
  }

  const blocks: SharedBlock[] = [];
  const parts = html.split(IMG_TAG);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (i % 2 === 1) {
      // 捕获组：图片标签
      const src = attr(part, 'src');
      if (isDisplayable(src)) {
        blocks.push({kind: 'image', uri: src});
      }
      continue;
    }
    pushTextBlocks(blocks, part);
  }

  if (blocks.length === 0) {
    const bg = /background-image\s*:\s*url\((['"]?)([^'")]+)\1\)/i.exec(html);
    if (bg && isDisplayable(bg[2])) {
      blocks.push({kind: 'image', uri: bg[2]});
    }
  }
  return blocks;
}

export type DoodleStroke = {
  color: string;
  width: number;
  points: {x: number; y: number}[];
};

export type Doodle = {
  width: number;
  height: number;
  strokes: DoodleStroke[];
};

/**
 * 涂鸦在编辑器里是隐藏的 data-doodle-json 节点（笔迹 JSON，不是位图）。
 * 对方设备没有编辑器 WebView，只能自己把笔迹画出来，所以这里解析成折线。
 */
export function parseDoodle(html: string): Doodle | null {
  if (!html) {
    return null;
  }
  const node = /data-doodle-json\s*=\s*("([^"]*)"|'([^']*)')/i.exec(html);
  const raw = node ? (node[2] ?? node[3] ?? '') : '';
  if (!raw) {
    return null;
  }
  let json: any;
  try {
    json = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
  const canvas = json?.canvas ?? {};
  const width = Number(canvas.width) || 0;
  const height = Number(canvas.height) || 0;
  const strokes: DoodleStroke[] = [];
  for (const item of Array.isArray(json?.strokes) ? json.strokes : []) {
    const points = (Array.isArray(item?.points) ? item.points : [])
      .map((point: any) => ({x: Number(point?.x), y: Number(point?.y)}))
      .filter(
        (point: {x: number; y: number}) =>
          Number.isFinite(point.x) && Number.isFinite(point.y),
      );
    if (points.length < 2) {
      continue;
    }
    strokes.push({
      color: typeof item?.color === 'string' ? item.color : '#000000',
      width: Number(item?.width) || 2,
      points,
    });
  }
  if (!width || !height || strokes.length === 0) {
    return null;
  }
  return {width, height, strokes};
}

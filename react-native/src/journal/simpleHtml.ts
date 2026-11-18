/**
 * 原生编辑器的「简单正文」格式。
 *
 * 迁移策略（item 7）：先把最常见的纯文字日记交给 RN 原生页编辑，含图片/
 * 贴纸/涂鸦/列表等富内容的日记继续用 WebView 完整编辑器，避免半途重写
 * 破坏旧数据。因此这里的解析必须足够保守——只要发现任何富内容标记就
 * 拒绝接管（`isSimpleTextHtml` 返回 false）。
 *
 * 序列化仍写成编辑器认识的 `<div>…</div>` 段落，所以两套编辑器可以互相
 * 打开同一篇日记。
 */

const RICH_MARKERS =
  /(<img\b|journal-sticker|doodle-data|journal-media:|<canvas\b|<table\b|<ul\b|<ol\b|<li\b|<blockquote\b|<h[1-6]\b|style\s*=|class\s*=|data-[a-z-]+\s*=)/i;

function unescapeHtml(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 只有纯文字（允许空段落、`<br>`、`<div>`/`<p>` 分段）才返回 true。
 * 其它任何富内容一律交回 WebView 编辑器，保证不丢格式。
 */
export function isSimpleTextHtml(html: string): boolean {
  if (!html) {
    return true;
  }
  if (RICH_MARKERS.test(html)) {
    return false;
  }
  return true;
}

/** HTML 段落 → 纯文本行（空行保留，供 TextInput 逐段编辑）。 */
export function htmlToParagraphs(html: string): string[] {
  if (!html || html.trim() === '') {
    return [''];
  }
  const withBreaks = html
    // `<div><br></div>` 是编辑器的空段落写法，先归一成空 div，避免多出一个空行。
    .replace(/<div\b[^>]*>\s*<br\s*\/?>\s*<\/div>/gi, '<div></div>')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p)>/gi, '\n')
    .replace(/<(div|p)\b[^>]*>/gi, '');
  const lines = withBreaks.split('\n').map(line => unescapeHtml(line));
  while (lines.length > 1 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  return lines.length ? lines : [''];
}

/** 纯文本行 → 编辑器 HTML（每段一个 div；空段落写成 `<div><br></div>`）。 */
export function paragraphsToHtml(paragraphs: string[]): string {
  const body = paragraphs
    .map(text => (text.length ? `<div>${escapeHtml(text)}</div>` : '<div><br></div>'))
    .join('');
  return body;
}

/** 供列表预览：把段落折叠成一行并截断。 */
export function paragraphsPreview(paragraphs: string[], limit = 80): string {
  const joined = paragraphs.join(' ').replace(/\s+/g, ' ').trim();
  return joined.length > limit ? `${joined.slice(0, limit)}…` : joined;
}

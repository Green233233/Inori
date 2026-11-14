/** HTML helpers ported from util/HtmlText.kt and media/JournalMediaStore.kt. */

const SAFE_ENTRY_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_FILE_NAME = /^[A-Za-z0-9._-]{1,200}$/;
const MEDIA_URI_RE =
  /journal-media:\/\/local\/([^/"'<>]+)\/([^"'<>]+)/g;
const BACKUP_MEDIA_RE = /media\/([^/"'<>]+)\/([^"'<>]+)/g;

export function isSafeEntryId(id: string): boolean {
  return SAFE_ENTRY_ID.test(id);
}

export function isSafeFileName(name: string): boolean {
  return SAFE_FILE_NAME.test(name);
}

/** Remove transient editor-only state (selection handles, empty classes). */
export function stripEditorState(html: string): string {
  return html
    .replace(/\s+is-selected(?=["\s>])/g, '')
    .replace(/\s+is-editing(?=["\s>])/g, '')
    .replace(/\s+class=""/g, '');
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00A0',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  copy: '©',
  reg: '®',
  middot: '·',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code)) {
        return match;
      }
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named !== undefined ? named : match;
  });
}

/**
 * Port of HtmlText.htmlToPlainText. Step order mirrors the Kotlin pipeline:
 * strip data images / scripts / styles / img / canvas, drop broken tags,
 * approximate Html.fromHtml block separation, then collapse whitespace.
 */
export function htmlToPlainText(html: string): string {
  if (!html || html.trim() === '') {
    return '';
  }
  let s = html;
  s = s.replace(/data:image\/[^"';\\s>]+/gi, ' ');
  s = s.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<img[^>]*>/gi, ' ');
  s = s.replace(/<canvas[^>]*>[\s\S]*?<\/canvas>/gi, ' ');
  s = s.replace(/<[^>]*$/g, ' ');
  s = s.replace(/^[^<\\[]*>/, ' ');
  // Html.fromHtml(FROM_HTML_MODE_COMPACT) inserts line breaks between blocks.
  s = s.replace(
    /<\/?(?:div|p|br|h[1-6]|li|ul|ol|tr|table|section|article|blockquote|pre|hr)[^>]*>/gi,
    '\n',
  );
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/^[^<]*>/, ' ');
  s = decodeEntities(s);
  s = s.replace(/\u00A0/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

export function previewOf(content: string): string {
  if (!content) {
    return '';
  }
  // DAO list queries feed substr(content, 1, 500) into htmlToPlainText.
  return htmlToPlainText(content.slice(0, 500)).trim();
}

/** Content is "blank" only when it truly carries no text/media markers. */
export function isBlankEditorHtml(html: string): boolean {
  if (!html || html.trim() === '') {
    return true;
  }
  if (html.includes('journal-sticker')) {
    return false;
  }
  if (html.includes('<img')) {
    return false;
  }
  if (html.includes('doodle-data')) {
    return false;
  }
  if (html.includes('journal-media://')) {
    return false;
  }
  const stripped = html
    .replace(/<br\s*\/?>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\u200B/g, '');
  return stripped.trim() === '';
}

export interface MediaRef {
  entryId: string;
  fileName: string;
}

export function extractMediaRefs(html: string): MediaRef[] {
  const result: MediaRef[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  MEDIA_URI_RE.lastIndex = 0;
  while ((match = MEDIA_URI_RE.exec(html)) !== null) {
    const entryId = match[1];
    const fileName = match[2];
    if (!isSafeEntryId(entryId) || !isSafeFileName(fileName)) {
      continue;
    }
    const key = `${entryId}/${fileName}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({entryId, fileName});
    }
  }
  return result;
}

/** journal-media://local/<id>/<file> -> media/<id>/<file> (backup form). */
export function toBackupHtml(html: string): string {
  return html.replace(MEDIA_URI_RE, (match, entryId: string, fileName: string) => {
    if (!isSafeEntryId(entryId) || !isSafeFileName(fileName)) {
      return match;
    }
    return `media/${entryId}/${fileName}`;
  });
}

/** media/<id>/<file> -> journal-media://local/<id>/<file> (restore form). */
export function restoreBackupHtml(html: string): string {
  return html.replace(
    BACKUP_MEDIA_RE,
    (match, entryId: string, fileName: string) => {
      if (!isSafeEntryId(entryId) || !isSafeFileName(fileName)) {
        return match;
      }
      return `journal-media://local/${entryId}/${fileName}`;
    },
  );
}

export function mimeTypeForExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

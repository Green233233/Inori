import {
  docPreview,
  emptyRichDoc,
  needsWebEditor,
  parseRichDoc,
  serializeRichDoc,
} from '../src/journal/richDoc';
import {resolveMediaUri} from '../src/data/html';

describe('richDoc', () => {
  it('把段落与照片按顺序还原', () => {
    const html =
      '<div>第一段</div><img class="inserted-image" src="journal-media://x/y.jpg" style="max-width:100%"><div>第三段</div>';
    const doc = parseRichDoc(html);
    expect(doc.blocks.map(block => block.kind)).toEqual(['text', 'image', 'text']);
    expect(doc.blocks[0]).toMatchObject({text: '第一段'});
    expect(doc.blocks[1]).toMatchObject({uri: 'journal-media://x/y.jpg'});
    expect(doc.blocks[2]).toMatchObject({text: '第三段'});
    expect(doc.hasStickers).toBe(false);
  });

  it('解析涂鸦 JSON 并保持笔迹', () => {
    const doodle = {
      version: 1,
      canvas: {width: 360, height: 260, dpr: 1},
      strokes: [
        {id: 's1', type: 'stroke', color: '#000000', width: 3, points: [{x: 1, y: 2}, {x: 5, y: 8}]},
      ],
    };
    const html = `<div>字</div><div class="doodle-data" contenteditable="false" data-doodle-json="${encodeURIComponent(
      JSON.stringify(doodle),
    )}"></div>`;
    const doc = parseRichDoc(html);
    expect(doc.doodle).not.toBeNull();
    expect(doc.doodle?.width).toBe(360);
    expect(doc.doodle?.strokes).toHaveLength(1);
    expect(doc.doodle?.strokes[0].points[1]).toEqual({x: 5, y: 8});
  });

  it('序列化后能再次解析（文字 + 图片 + 涂鸦）', () => {
    const doc = emptyRichDoc();
    doc.blocks = [
      {kind: 'text', id: 'a', text: '早'},
      {kind: 'image', id: 'b', uri: 'data:image/png;base64,AAA'},
      {kind: 'text', id: 'c', text: '晚'},
    ];
    doc.doodle = {
      width: 360,
      height: 260,
      strokes: [{color: '#111111', width: 3, points: [{x: 0, y: 0}, {x: 10, y: 10}]}],
    };
    const html = serializeRichDoc(doc);
    expect(html).toContain('<img class="inserted-image"');
    expect(html).toContain('data-doodle-json=');
    const again = parseRichDoc(html);
    expect(again.blocks.map(block => block.kind)).toEqual(['text', 'image', 'text']);
    expect(again.blocks[1]).toMatchObject({uri: 'data:image/png;base64,AAA'});
    expect(again.doodle?.strokes).toHaveLength(1);
  });

  it('空段落写成 <div><br></div> 且能还原', () => {
    const doc = emptyRichDoc();
    doc.blocks = [
      {kind: 'text', id: 'a', text: ''},
      {kind: 'text', id: 'b', text: '有字'},
    ];
    const html = serializeRichDoc(doc);
    expect(html).toBe('<div><br></div><div>有字</div>');
    expect(parseRichDoc(html).blocks.map(block => block.kind === 'text' && block.text)).toEqual([
      '',
      '有字',
    ]);
  });

  it('带贴纸的日记要求回到完整编辑器', () => {
    const sticker =
      '<span class="journal-sticker" contenteditable="false" data-sticker-kind="emoji" data-rotate="0"><span class="journal-sticker__emoji">🍃</span></span>';
    expect(needsWebEditor(`<div>字</div>${sticker}`)).toBe(false);
    expect(needsWebEditor('<div>字</div>')).toBe(false);
    expect(parseRichDoc(`<div>字</div>${sticker}`).hasStickers).toBe(true);
  });

  it('预览取第一段并截断', () => {
    const doc = emptyRichDoc();
    doc.blocks = [{kind: 'text', id: 'a', text: 'x'.repeat(120)}];
    expect(docPreview(doc, 20)).toBe(`${'x'.repeat(20)}…`);
  });

  it('贴纸解析与重建保持位置与旋转', () => {
    const html =
      '<div>正文</div><span class="journal-sticker" contenteditable="false" data-sticker-id="s1" data-sticker-kind="emoji" data-rotate="15" style="position:absolute;left:48px;top:96px;width:72px;height:72px;display:flex;transform:rotate(15deg);transform-origin:center center"><span class="journal-sticker__emoji">⭐</span></span>';
    const doc = parseRichDoc(html);
    expect(doc.stickers).toHaveLength(1);
    expect(doc.stickers[0].info).toMatchObject({
      kind: 'emoji',
      value: '⭐',
      left: 48,
      top: 96,
      size: 72,
      rotate: 15,
    });
    const rebuilt = serializeRichDoc(doc);
    expect(rebuilt).toContain('data-sticker-kind="emoji"');
    expect(rebuilt).toContain('left:48px');
    expect(rebuilt).toContain('rotate(15deg)');
    expect(rebuilt).toContain('⭐');
    expect(needsWebEditor(rebuilt)).toBe(false);
  });

  it('图片贴纸读出 src', () => {
    const html =
      '<span class="journal-sticker" data-sticker-kind="image" data-rotate="0" style="position:absolute;left:10px;top:12px;width:112px;height:112px"><img class="journal-sticker__media" src="journal-media://x/s.png" alt="sticker"></span>';
    const doc = parseRichDoc(html);
    expect(doc.stickers[0].info).toMatchObject({
      kind: 'image',
      value: 'journal-media://x/s.png',
      size: 112,
    });
    expect(serializeRichDoc(doc)).toContain('src="journal-media://x/s.png"');
  });
});

describe('resolveMediaUri', () => {
  it('把 journal-media 映射到应用媒体目录的 file 路径', () => {
    const uri = 'journal-media://local/abc123/photo.jpg';
    const resolved = resolveMediaUri(uri);
    expect(resolved.startsWith('file://')).toBe(true);
    expect(resolved).toContain('/journal_media/abc123/photo.jpg');
  });

  it('允许用当前日记 id 覆盖归属（共享来的图片）', () => {
    const resolved = resolveMediaUri('journal-media://local/other/file.png', 'mine');
    expect(resolved).toContain('/journal_media/mine/file.png');
  });

  it('其它 scheme 原样返回', () => {
    expect(resolveMediaUri('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
    expect(resolveMediaUri('file:///tmp/a.png')).toBe('file:///tmp/a.png');
  });

  it('非法 id 或文件名不解析', () => {
    expect(resolveMediaUri('journal-media://local/../x/a.png')).toBe('journal-media://local/../x/a.png');
    expect(resolveMediaUri('journal-media://local/ok/bad|name.png')).toBe('journal-media://local/ok/bad|name.png');
  });
});

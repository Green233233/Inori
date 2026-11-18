import {toSharedBlocks} from '../src/journal/sharedBlocks';

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

describe('toSharedBlocks', () => {
  test('keeps text and inline images in source order', () => {
    const html = `第一段<img src="${PIXEL}" class="inserted-image"><p>第二段</p>`;
    const blocks = toSharedBlocks(html);

    expect(blocks.map(block => block.kind)).toEqual(['text', 'image', 'text']);
    expect(blocks[0]).toEqual({kind: 'text', text: '第一段', bullet: false});
    expect(blocks[1]).toEqual({kind: 'image', uri: PIXEL});
    expect(blocks[2]).toEqual({kind: 'text', text: '第二段', bullet: false});
  });

  test('drops images from another device local scheme', () => {
    const html = `内容测试<img src="journal-media://local/abc/def.jpg" class="inserted-image">`;
    const blocks = toSharedBlocks(html);

    expect(blocks).toEqual([{kind: 'text', text: '内容测试', bullet: false}]);
  });

  test('turns line breaks into newlines and marks list items', () => {
    const blocks = toSharedBlocks('<p>一</p><p>二</p><ul><li>要点</li></ul>');

    expect(blocks).toEqual([
      {kind: 'text', text: '一', bullet: false},
      {kind: 'text', text: '二', bullet: false},
      {kind: 'text', text: '要点', bullet: true},
    ]);
  });

  test('falls back to a sticker background image when there is no img tag', () => {
    const html = `<span class="journal-sticker" style="background-image:url('${PIXEL}')"></span>`;
    const blocks = toSharedBlocks(html);

    expect(blocks).toEqual([{kind: 'image', uri: PIXEL}]);
  });

  test('returns nothing for an empty entry', () => {
    expect(toSharedBlocks('')).toEqual([]);
  });
});

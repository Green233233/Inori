import {
  htmlToParagraphs,
  isSimpleTextHtml,
  paragraphsPreview,
  paragraphsToHtml,
} from '../src/journal/simpleHtml';

describe('isSimpleTextHtml', () => {
  it('treats empty and plain paragraphs as simple', () => {
    expect(isSimpleTextHtml('')).toBe(true);
    expect(isSimpleTextHtml('<div>今天很好</div>')).toBe(true);
    expect(isSimpleTextHtml('<div>第一段</div><div><br></div><div>第二段</div>')).toBe(
      true,
    );
  });

  it('rejects rich content', () => {
    expect(isSimpleTextHtml('<div><img src="data:image/png;base64,AA" /></div>')).toBe(
      false,
    );
    expect(isSimpleTextHtml('<div><span class="journal-sticker"></span></div>')).toBe(
      false,
    );
    expect(isSimpleTextHtml('<div class="doodle-data" data-doodle-json="x"></div>')).toBe(
      false,
    );
    expect(isSimpleTextHtml('<div>a</div><canvas></canvas>')).toBe(false);
    expect(isSimpleTextHtml('<ul><li>a</li></ul>')).toBe(false);
    expect(isSimpleTextHtml('<div style="color:red">a</div>')).toBe(false);
  });
});

describe('htmlToParagraphs', () => {
  it('splits on div and br and decodes entities', () => {
    expect(htmlToParagraphs('<div>a &amp; b</div><div><br></div><div>c</div>')).toEqual([
      'a & b',
      '',
      'c',
    ]);
    expect(htmlToParagraphs('one<br>two')).toEqual(['one', 'two']);
  });

  it('always returns at least one paragraph', () => {
    expect(htmlToParagraphs('')).toEqual(['']);
    expect(htmlToParagraphs('<div><br></div>')).toEqual(['']);
  });
});

describe('paragraphsToHtml', () => {
  it('keeps blank lines and escapes markup', () => {
    expect(paragraphsToHtml(['a < b', '', 'c & d'])).toBe(
      '<div>a &lt; b</div><div><br></div><div>c &amp; d</div>',
    );
  });

  it('round-trips simple content', () => {
    const paragraphs = ['第一段', '', '第二段 & more'];
    expect(htmlToParagraphs(paragraphsToHtml(paragraphs))).toEqual(paragraphs);
  });
});

describe('paragraphsPreview', () => {
  it('joins non-empty paragraphs and truncates', () => {
    expect(paragraphsPreview(['', '一二三', '', '四五'])).toBe('一二三 四五');
    expect(paragraphsPreview(['一二三四五六'], 4)).toBe('一二三四…');
  });
});

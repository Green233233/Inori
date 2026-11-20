import * as fs from 'fs';
import * as path from 'path';

/**
 * 编辑页 WebView 的滚动架构回归测试。
 *
 * 背景（v0.6.8）：日记条目正文里只有一张超长竖图时，Android WebView 上怎么上划
 * 都不动。原因是滚动容器不止一层 —— html 是 overflow-y:auto 的文档滚动容器，
 * body 又写了 overflow-y:auto（被 WebView 当成内层滚动节点：body 高度由内容撑开，
 * 没有可滚动溢出），再叠加 body 的 overscroll-behavior-y:contain（禁止滚动链上抛），
 * 手势在 body 那一层就被吃掉，永远链不到 html 根滚动容器。
 *
 * 这里只做静态断言，防止以后又把 body 变成内层滚动容器：
 * 1. 竖向滚动容器只能是 html；
 * 2. body 不得声明 overflow-y:auto/scroll；
 * 3. body 不得用 overscroll-behavior*: contain/none 掐断滚动链。
 */
const EDITOR_CSS_PATH = path.join(
  __dirname,
  '..',
  'android',
  'app',
  'src',
  'main',
  'assets',
  'editor',
  'editor.css',
);

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function declarationsOf(css: string, selector: string): Record<string, string> {
  const clean = stripComments(css);
  const match = new RegExp(`(?:^|\\n)\\s*${selector}\\s*\\{([^}]*)\\}`).exec(clean);
  if (!match) {
    throw new Error(`editor.css 里找不到 ${selector} 规则`);
  }
  const declarations: Record<string, string> = {};
  for (const chunk of match[1].split(';')) {
    const colon = chunk.indexOf(':');
    if (colon < 0) {
      continue;
    }
    const property = chunk.slice(0, colon).trim().toLowerCase();
    const value = chunk
      .slice(colon + 1)
      .trim()
      .toLowerCase()
      .replace(/\s*!important$/, '');
    if (property) {
      declarations[property] = value;
    }
  }
  return declarations;
}

describe('editor.css 滚动架构', () => {
  const css = fs.readFileSync(EDITOR_CSS_PATH, 'utf8');
  const html = declarationsOf(css, 'html');
  const body = declarationsOf(css, 'body');

  it('html 是唯一的竖向滚动容器', () => {
    expect(html['overflow-y']).toBe('auto');
  });

  it('body 不是内层滚动容器（否则手势会被 body 吃掉）', () => {
    expect(['auto', 'scroll']).not.toContain(body['overflow-y'] ?? 'visible');
  });

  it('body 不掐断滚动链（overscroll-behavior 不能是 contain/none）', () => {
    const overscrollValues = [
      body['overscroll-behavior'],
      body['overscroll-behavior-y'],
      body['overscroll-behavior-block'],
    ]
      .filter((value): value is string => Boolean(value))
      .flatMap(value => value.split(/\s+/));
    expect(overscrollValues.some(value => value === 'contain' || value === 'none')).toBe(
      false,
    );
  });
});

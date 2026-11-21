/**
 * 检查更新的判定只看两件事：versionCode 变大，或者版本号逐段更大。
 * 任何网络/字段异常都必须安静返回 null，不能把「查不到」当成「有新版」。
 */
import {checkForUpdate, isNewerVersion} from '../src/api/appUpdate';
import {api} from '../src/net/ApiClient';

jest.mock('../src/net/ApiClient', () => ({api: jest.fn()}));

const mockedApi = api as jest.Mock;

describe('isNewerVersion', () => {
  it('按数字段比较，v 前缀不影响', () => {
    expect(isNewerVersion('0.6.8', 'v0.6.7')).toBe(true);
    expect(isNewerVersion('v0.7.0', '0.6.9')).toBe(true);
    expect(isNewerVersion('0.6.7', 'v0.6.7')).toBe(false);
    expect(isNewerVersion('0.6.6', 'v0.6.7')).toBe(false);
  });

  it('段数不同时缺的段按 0 处理', () => {
    expect(isNewerVersion('1.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('0.6', '0.6.0')).toBe(false);
  });
});

describe('checkForUpdate', () => {
  beforeEach(() => {
    mockedApi.mockReset();
  });

  it('versionCode 更大时有更新', async () => {
    mockedApi.mockResolvedValue({
      ok: true,
      version: '0.6.9',
      versionCode: 99,
      notes: '- 新增检查更新',
      downloadUrl: 'https://example.com/qi.apk',
      force: false,
    });
    const result = await checkForUpdate();
    expect(result?.hasUpdate).toBe(true);
    expect(result?.version).toBe('0.6.9');
    expect(result?.downloadUrl).toBe('https://example.com/qi.apk');
  });

  it('没有 versionCode 时退回版本号比较', async () => {
    mockedApi.mockResolvedValue({
      ok: true,
      version: '0.6.7',
      notes: '',
      downloadUrl: '',
    });
    const result = await checkForUpdate();
    expect(result?.hasUpdate).toBe(false);
  });

  it('网络失败静默返回 null', async () => {
    mockedApi.mockRejectedValue(new Error('network_error'));
    await expect(checkForUpdate()).resolves.toBeNull();
  });
});

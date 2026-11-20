/**
 * 登录/绑定链路上最容易误导人的就是错误文案：
 * 证书指纹不匹配、超时、断网在原生层都被压成 network_error，
 * 401 又要让用户知道「回登录页」而不是「请求失败」。
 */
import {ApiError, errorMessage} from '../src/net/ApiClient';

describe('errorMessage', () => {
  it('401 时保留服务端原话（客户端据此清会话回登录页）', () => {
    const error = new ApiError(401, 'unauthorized', '登录已失效，请重新登录');
    expect(errorMessage(error)).toBe('登录已失效，请重新登录');
  });

  it('证书指纹不匹配要说清怎么修', () => {
    const error = new ApiError(0, 'network_error', '证书指纹不一致：期望 AB 实际 CD');
    expect(errorMessage(error)).toContain('证书指纹不匹配');
    expect(errorMessage(error)).toContain('SHA-256');
  });

  it('其它证书问题与超时各自有独立文案', () => {
    expect(errorMessage(new ApiError(0, 'network_error', '证书已过期'))).toContain(
      '证书不可用',
    );
    expect(
      errorMessage(new ApiError(0, 'network_error', 'connect timed out')),
    ).toContain('超时');
  });

  it('普通传输失败不暴露原生细节', () => {
    const message = errorMessage(new ApiError(0, 'network_error', 'unexpected end of stream'));
    expect(message).toBe('无法连接服务器，请检查地址与网络');
    expect(message).not.toContain('stream');
  });

  it('非 ApiError 的异常用 message，空则回退', () => {
    expect(errorMessage(new Error('本地已解除绑定，但服务器没有确认'))).toContain(
      '服务器没有确认',
    );
    expect(errorMessage(undefined, '操作失败')).toBe('操作失败');
    expect(errorMessage('字符串', '兜底')).toBe('兜底');
  });
});

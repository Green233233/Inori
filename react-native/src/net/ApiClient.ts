/**
 * Thin typed facade over the native HTTP client (证书指纹固定 + 长轮询超时)。
 * The account token never enters JS storage; it is only passed through here.
 */
import {qiApi} from '../native/QiNative';

export class ApiError extends Error {
  status: number;
  code: string;
  retryAfter?: number;

  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

let serverUrl = '';
let sessionToken: string | null = null;

export function setServerUrl(url: string): void {
  serverUrl = url.trim().replace(/\/+$/, '');
}

export function getServerUrl(): string {
  return serverUrl;
}

export function setToken(token: string | null): void {
  sessionToken = token;
}

export function getToken(): string | null {
  return sessionToken;
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
  auth?: boolean;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    timeoutMs = 15000,
    auth = true,
  } = options;
  const payload = body === undefined ? null : JSON.stringify(body);
  const response = await qiApi.request(
    method,
    path,
    payload,
    auth ? sessionToken : null,
    timeoutMs,
  );
  let parsed: any = null;
  if (response.body) {
    try {
      parsed = JSON.parse(response.body);
    } catch {
      throw new ApiError(
        response.status,
        'bad_response',
        '服务器返回了看不懂的数据呢',
      );
    }
  }
  if (response.status < 200 || response.status >= 300 || parsed?.ok === false) {
    const detail = parsed?.error ?? {};
    throw new ApiError(
      response.status,
      detail.code ?? 'request_failed',
      detail.message ?? `请求失败（HTTP ${response.status}）`,
      detail.retryAfter,
    );
  }
  return parsed as T;
}

export function errorMessage(error: unknown, fallback = '操作失败'): string {
  if (error instanceof ApiError) {
    if (error.code === 'network_error' || error.status === 0) {
      // 原生层把所有传输失败都归成 network_error；证书指纹不匹配是最常见的
      // 真机故障（模拟器装了自签证书、手机没有），必须把原因说出来，否则
      // 用户只会看到「无法连接服务器」而无从下手。
      const detail = error.message ?? '';
      if (detail.includes('证书指纹')) {
        return '服务器证书指纹不匹配：请核对服务器地址，并在「证书指纹」里填写服务器证书的 SHA-256';
      }
      if (detail.includes('证书')) {
        return '服务器证书不可用：请确认地址与端口，并填写证书指纹';
      }
      if (detail.includes('timed out') || detail.includes('timeout')) {
        return '连接服务器超时：请确认地址、端口与网络（有些网络会拦截非常用端口）';
      }
      /*
       * Android 9 起默认禁止明文 HTTP，release 包更是在 networkSecurityConfig
       * 里写死了 cleartextTrafficPermitted=false。原生层只会抛
       * "Cleartext HTTP traffic to x not permitted"，照抄给用户完全看不懂。
       */
      if (detail.toLowerCase().includes('cleartext')) {
        return '这个地址是 HTTP 明文，当前版本只允许 HTTPS：请把服务器地址改成 https://（自签证书时再填写证书指纹）';
      }
      return '无法连接服务器，请检查地址与网络';
    }
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

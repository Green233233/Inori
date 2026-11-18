/**
 * Typed wrapper around the 祈 native modules (`QiCrypto`, `QiSecureStore`,
 * `QiApiClient`). Mirrors the style of `InorinalNative`.
 */
import {NativeModules} from 'react-native';

export interface SealedValue {
  nonce: string;
  ciphertext: string;
}

export interface HttpResponse {
  status: number;
  body: string;
}

type CryptoApi = {
  createIdentity(pairId: string): Promise<string>;
  identityPublicKey(pairId: string): Promise<string | null>;
  deleteIdentity(pairId: string): Promise<boolean>;
  seal(
    pairId: string,
    peerPublicB64: string,
    saltB64: string,
    plainB64: string,
  ): Promise<SealedValue>;
  open(
    pairId: string,
    peerPublicB64: string,
    saltB64: string,
    nonceB64: string,
    ciphertextB64: string,
  ): Promise<string>;
  sha256Hex(dataB64: string): Promise<string>;
  randomBytes(size: number): Promise<string>;
  sasCode(
    publicA: string,
    publicB: string,
    pairId: string,
    codeHash: string,
  ): Promise<string>;
};

type SecretsApi = {
  setSecret(key: string, value: string): Promise<boolean>;
  getSecret(key: string): Promise<string | null>;
  deleteSecret(key: string): Promise<boolean>;
};

type ApiClientApi = {
  configure(baseUrl: string, pinShare: string): Promise<boolean>;
  getConfig(): Promise<{baseUrl: string; pin: string}>;
  request(
    method: string,
    path: string,
    body: string | null,
    token: string | null,
    timeoutMs: number,
  ): Promise<HttpResponse>;
};

const cryptoModule = NativeModules.QiCrypto as CryptoApi | undefined;
const secretsModule = NativeModules.QiSecureStore as SecretsApi | undefined;
const apiModule = NativeModules.QiApiClient as ApiClientApi | undefined;

function requireCrypto(): CryptoApi {
  if (!cryptoModule) {
    throw new Error('QiCrypto 未注册：请重新构建 Android 应用');
  }
  return cryptoModule;
}

function requireSecrets(): SecretsApi {
  if (!secretsModule) {
    throw new Error('QiSecureStore 未注册：请重新构建 Android 应用');
  }
  return secretsModule;
}

function requireApi(): ApiClientApi {
  if (!apiModule) {
    throw new Error('QiApiClient 未注册：请重新构建 Android 应用');
  }
  return apiModule;
}

export const qiNativeAvailable = !!cryptoModule && !!secretsModule && !!apiModule;

export const qiCrypto = {
  createIdentity: (pairId: string) => requireCrypto().createIdentity(pairId),
  identityPublicKey: (pairId: string) =>
    requireCrypto().identityPublicKey(pairId),
  deleteIdentity: (pairId: string) => requireCrypto().deleteIdentity(pairId),
  seal: (
    pairId: string,
    peerPublicB64: string,
    saltB64: string,
    plainB64: string,
  ) => requireCrypto().seal(pairId, peerPublicB64, saltB64, plainB64),
  open: (
    pairId: string,
    peerPublicB64: string,
    saltB64: string,
    nonceB64: string,
    ciphertextB64: string,
  ) =>
    requireCrypto().open(
      pairId,
      peerPublicB64,
      saltB64,
      nonceB64,
      ciphertextB64,
    ),
  sha256Hex: (dataB64: string) => requireCrypto().sha256Hex(dataB64),
  randomBytes: (size: number) => requireCrypto().randomBytes(size),
  sasCode: (
    publicA: string,
    publicB: string,
    pairId: string,
    codeHash: string,
  ) => requireCrypto().sasCode(publicA, publicB, pairId, codeHash),
};

export const qiSecrets = {
  set: (key: string, value: string) => requireSecrets().setSecret(key, value),
  get: (key: string) => requireSecrets().getSecret(key),
  remove: (key: string) => requireSecrets().deleteSecret(key),
};

export const qiApi = {
  configure: (baseUrl: string, pin: string) =>
    requireApi().configure(baseUrl, pin),
  getConfig: () => requireApi().getConfig(),
  request: (
    method: string,
    path: string,
    body: string | null,
    token: string | null,
    timeoutMs = 15000,
  ) => requireApi().request(method, path, body, token, timeoutMs),
};

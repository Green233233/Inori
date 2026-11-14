/**
 * Typed wrapper around the app's Kotlin native module (`InorinalNative`).
 * All calls return Promises; IO happens off the JS thread.
 */
import {NativeModules} from 'react-native';

export interface NativeConstants {
  filesDir: string;
  cacheDir: string;
  logsDir: string;
  versionName: string;
  versionCode: number;
}

export interface DirEntry {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  lastModified: number;
}

export interface PickedImage {
  dataUri: string;
  base64: string;
  mime: string;
  width: number;
  height: number;
  fileName?: string;
  id?: string;
}

export interface StickerItem {
  id: string;
  fileName: string;
  mime: string;
  path: string;
  size: number;
  lastModified: number;
}

export interface PickedDocument {
  path: string;
  name: string;
  size: number;
}

export interface StoredHtmlResult {
  html: string;
  mediaCount: number;
}

type InorinalNativeModule = {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<boolean>;
  appendText(path: string, content: string): Promise<boolean>;
  readBase64(path: string): Promise<string>;
  writeBase64(path: string, base64: string): Promise<boolean>;
  exists(path: string): Promise<boolean>;
  makeDir(path: string): Promise<boolean>;
  deletePath(path: string): Promise<boolean>;
  listDir(path: string): Promise<DirEntry[]>;
  pickImage(maxBytes: number, stickerMode: boolean): Promise<PickedImage>;
  listStickers(): Promise<StickerItem[]>;
  stickerBase64(fileName: string): Promise<string>;
  deleteSticker(fileName: string): Promise<boolean>;
  pickDocument(): Promise<PickedDocument>;
  saveDocument(base64: string, fileName: string, mime: string): Promise<string>;
  toDisplayableHtml(entryId: string, html: string): Promise<string>;
  toStoredHtml(entryId: string, html: string): Promise<StoredHtmlResult>;
  deleteEntryMedia(entryId: string): Promise<boolean>;
  clearCache(): Promise<boolean>;
  writeStickerBase64(fileName: string, base64: string): Promise<boolean>;
  readLegacyEntries?(): Promise<any[]>;
};

const Native = NativeModules.InorinalNative as
  | (InorinalNativeModule & Partial<NativeConstants>)
  | undefined;

function requireNative(): InorinalNativeModule {
  if (!Native) {
    throw new Error(
      'InorinalNative module is not registered. Rebuild the Android app.',
    );
  }
  return Native;
}

export const nativeAvailable = !!Native;

// React Native exposes getConstants() values as properties of the module.
export const CONSTANTS: NativeConstants = {
  filesDir: Native?.filesDir ?? '',
  cacheDir: Native?.cacheDir ?? '',
  logsDir: Native?.logsDir ?? '',
  versionName: Native?.versionName ?? '',
  versionCode: Native?.versionCode ?? 0,
};

export const native = {
  readText: (path: string) => requireNative().readText(path),
  writeText: (path: string, content: string) =>
    requireNative().writeText(path, content),
  appendText: (path: string, content: string) =>
    requireNative().appendText(path, content),
  readBase64: (path: string) => requireNative().readBase64(path),
  writeBase64: (path: string, base64: string) =>
    requireNative().writeBase64(path, base64),
  exists: (path: string) => requireNative().exists(path),
  makeDir: (path: string) => requireNative().makeDir(path),
  deletePath: (path: string) => requireNative().deletePath(path),
  listDir: (path: string) => requireNative().listDir(path),
  pickImage: (maxBytes: number, stickerMode: boolean) =>
    requireNative().pickImage(maxBytes, stickerMode),
  listStickers: () => requireNative().listStickers(),
  stickerBase64: (fileName: string) => requireNative().stickerBase64(fileName),
  deleteSticker: (fileName: string) => requireNative().deleteSticker(fileName),
  pickDocument: () => requireNative().pickDocument(),
  saveDocument: (
    base64: string,
    fileName: string,
    mime: string,
  ) => requireNative().saveDocument(base64, fileName, mime),
  toDisplayableHtml: (entryId: string, html: string) =>
    requireNative().toDisplayableHtml(entryId, html),
  toStoredHtml: (entryId: string, html: string) =>
    requireNative().toStoredHtml(entryId, html),
  deleteEntryMedia: (entryId: string) =>
    requireNative().deleteEntryMedia(entryId),
  clearCache: () => requireNative().clearCache(),
  writeStickerBase64: (fileName: string, base64: string) =>
    requireNative().writeStickerBase64(fileName, base64),
  readLegacyEntries: (): Promise<any[]> => {
    const module = requireNative() as any;
    if (typeof module.readLegacyEntries !== 'function') {
      return Promise.resolve([]);
    }
    return module.readLegacyEntries();
  },
};

export function joinPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/');
}

/** App-private directories (constants may be empty until the module loads). */
export const paths = {
  get files() {
    return CONSTANTS.filesDir || '';
  },
  get cache() {
    return CONSTANTS.cacheDir || '';
  },
  get logs() {
    return CONSTANTS.logsDir || '';
  },
  journal: () => joinPath(CONSTANTS.filesDir, 'journal'),
  entries: () => joinPath(CONSTANTS.filesDir, 'journal', 'entries'),
  index: () => joinPath(CONSTANTS.filesDir, 'journal', 'index.json'),
  settings: () => joinPath(CONSTANTS.filesDir, 'settings.json'),
  mediaRoot: () => joinPath(CONSTANTS.filesDir, 'journal_media'),
  entryMedia: (entryId: string) =>
    joinPath(CONSTANTS.filesDir, 'journal_media', entryId),
  stickerRoot: () => joinPath(CONSTANTS.filesDir, 'user_stickers'),
};

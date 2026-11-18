/**
 * 相册分享：把一张照片端到端加密后传到自建服务器，只有配对的另一台能解开。
 *
 * 分块：密文按 180 KB 切片，逐块 PUT 到 /sync/media/<id>/<idx>；服务器只看到
 * 密文分块。元数据（名字 / 类型 / 分块数）单独存一条 kind=shared.photo 记录。
 */
import {api} from '../net/ApiClient';
import {encodeBase64, decodeBase64} from '../crypto/base64';
import {openJson, sealJson} from '../crypto/Crypto';
import {native, joinPath, paths} from '../native/InorinalNative';
import type {PairSummary} from '../data/pairTypes';

export interface AlbumItem {
  id: string;
  name: string;
  mime: string;
  size: number;
  chunks: number;
  at: number;
  authorDeviceId: string;
}

interface AlbumState {
  cursor: number;
  items: Record<string, AlbumItem>;
}

interface RecordPage {
  items: Array<{
    recordId: string;
    kind: string;
    ciphertext: string;
    updatedAt: number;
    deleted: boolean;
  }>;
  cursor: number;
  hasMore: boolean;
}

const CHUNK_CHARS = 180_000;
const EMPTY: AlbumState = {cursor: 0, items: {}};
let cache: AlbumState | null = null;
const imageCache = new Map<string, string>();

function statePath(): string {
  return joinPath(paths.files, 'qi', 'album.json');
}

function normalize(raw: any): AlbumState {
  if (!raw || typeof raw !== 'object') {
    return {cursor: 0, items: {}};
  }
  const items: Record<string, AlbumItem> = {};
  for (const [key, value] of Object.entries<any>(raw.items ?? {})) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    items[key] = {
      id: String(value.id ?? key),
      name: String(value.name ?? '照片'),
      mime: String(value.mime ?? 'image/jpeg'),
      size: Number(value.size) || 0,
      chunks: Number(value.chunks) || 0,
      at: Number(value.at) || 0,
      authorDeviceId: String(value.authorDeviceId ?? ''),
    };
  }
  return {cursor: Number(raw.cursor) || 0, items};
}

async function loadState(): Promise<AlbumState> {
  if (cache) {
    return cache;
  }
  try {
    cache = normalize(JSON.parse(await native.readText(statePath())));
  } catch {
    cache = {...EMPTY, items: {}};
  }
  return cache;
}

async function saveState(next: AlbumState): Promise<void> {
  cache = next;
  await native.makeDir(joinPath(paths.files, 'qi')).catch(() => false);
  await native.writeText(statePath(), JSON.stringify(next));
}

export async function loadAlbum(): Promise<AlbumItem[]> {
  const state = await loadState();
  return Object.values(state.items).sort((a, b) => b.at - a.at);
}

async function putChunks(mediaId: string, ciphertextJson: string): Promise<number> {
  const total = Math.ceil(ciphertextJson.length / CHUNK_CHARS);
  for (let index = 0; index < total; index += 1) {
    const slice = ciphertextJson.slice(index * CHUNK_CHARS, (index + 1) * CHUNK_CHARS);
    await api(`/api/v1/sync/media/${mediaId}/${index}`, {
      method: 'PUT',
      body: {data: encodeBase64(slice)},
      timeoutMs: 60_000,
    });
  }
  return total;
}

export async function sharePhoto(
  pair: PairSummary,
  myDeviceId: string,
): Promise<AlbumItem> {
  if (!pair.peerPubkey) {
    throw new Error('对方公钥缺失');
  }
  const picked = await native.pickImage(700_000, false);
  if (!picked?.base64) {
    throw new Error('没有选择照片');
  }
  const at = Date.now();
  const id = `ph_${at.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const payload = {
    id,
    b64: picked.base64,
    name: picked.fileName ?? 'photo.jpg',
    mime: picked.mime ?? 'image/jpeg',
  };
  const sealed = await sealJson(pair.pairId, pair.peerPubkey, payload);
  const ciphertextJson = JSON.stringify(sealed);
  const chunks = await putChunks(id, ciphertextJson);

  const meta: AlbumItem = {
    id,
    name: payload.name,
    mime: payload.mime,
    size: picked.base64.length,
    chunks,
    at,
    authorDeviceId: myDeviceId,
  };
  const metaSealed = await sealJson(pair.pairId, pair.peerPubkey, meta);
  await api(`/api/v1/sync/records/${id}`, {
    method: 'PUT',
    body: {
      kind: 'shared.photo',
      ciphertext: JSON.stringify(metaSealed),
      revision: 1,
      updatedAt: at,
      deleted: false,
    },
  });

  const state = await loadState();
  state.items[id] = meta;
  await saveState(state);
  return meta;
}

export async function loadPhotoImage(
  pair: PairSummary,
  item: AlbumItem,
): Promise<string> {
  const cached = imageCache.get(item.id);
  if (cached) {
    return cached;
  }
  if (!pair.peerPubkey) {
    throw new Error('对方公钥缺失');
  }
  let ciphertextJson = '';
  for (let index = 0; index < item.chunks; index += 1) {
    const chunk = await api<{ok: boolean; data: string | null}>(
      `/api/v1/sync/media/${item.id}/${index}`,
      {timeoutMs: 60_000},
    );
    if (!chunk?.data) {
      throw new Error('照片分块缺失');
    }
    ciphertextJson += decodeBase64(chunk.data);
  }
  const envelope = JSON.parse(ciphertextJson) as {n: string; c: string};
  const payload = await openJson<{b64: string; mime: string}>(
    pair.pairId,
    pair.peerPubkey,
    envelope,
  );
  const uri = `data:${payload.mime || item.mime};base64,${payload.b64}`;
  imageCache.set(item.id, uri);
  return uri;
}

export async function deletePhoto(
  pair: PairSummary,
  item: AlbumItem,
): Promise<void> {
  const state = await loadState();
  delete state.items[item.id];
  await saveState(state);
  imageCache.delete(item.id);
  await api(`/api/v1/sync/records/${item.id}`, {
    method: 'PUT',
    body: {
      kind: 'shared.photo',
      ciphertext: 'deleted',
      revision: 1,
      updatedAt: Date.now(),
      deleted: true,
    },
  });
}

export async function refreshAlbum(pair: PairSummary): Promise<AlbumItem[]> {
  if (!pair.peerPubkey) {
    return loadAlbum();
  }
  let state = await loadState();
  let pages = 0;
  while (pages < 5) {
    pages += 1;
    const page = await api<RecordPage>(
      `/api/v1/sync/records?sinceSeq=${state.cursor}&limit=100`,
    );
    for (const item of page.items) {
      if (item.kind !== 'shared.photo') {
        continue;
      }
      if (item.deleted) {
        delete state.items[item.recordId];
        imageCache.delete(item.recordId);
        continue;
      }
      try {
        const envelope = JSON.parse(item.ciphertext) as {n: string; c: string};
        const meta = await openJson<AlbumItem>(
          pair.pairId,
          pair.peerPubkey,
          envelope,
        );
        if (!meta?.id) {
          continue;
        }
        state.items[meta.id] = {
          ...meta,
          at: Number(meta.at) || item.updatedAt,
        };
      } catch {
        // 历史密文解不开，跳过。
      }
    }
    state = {...state, cursor: page.cursor};
    if (!page.hasMore) {
      break;
    }
  }
  await saveState(state);
  return loadAlbum();
}

import type {
  ApiOnProgress,
  ApiParsedMedia,
  ApiPreparedMedia,
} from '../api/types';
import {
  ApiMediaFormat,
} from '../api/types';

import {
  DEBUG, MEDIA_CACHE_DISABLED, MEDIA_CACHE_NAME,
  MEDIA_CACHE_NAME_AVATARS,
} from '../config';
import { callApi, cancelApiProgress } from '../api/gramjs';
import {
  IS_OPUS_SUPPORTED, IS_PROGRESSIVE_SUPPORTED,
} from './browser/windowEnvironment';
import * as cacheApi from './cacheApi';
import { fetchBlob } from './files';
import { ACCOUNT_SLOT } from './multiaccount';
import { oggToWav } from './oggToWav';

const asCacheApiType = {
  [ApiMediaFormat.BlobUrl]: cacheApi.Type.Blob,
  [ApiMediaFormat.Text]: cacheApi.Type.Text,
  [ApiMediaFormat.DownloadUrl]: undefined,
  [ApiMediaFormat.Progressive]: undefined,
};

const PROGRESSIVE_URL_PREFIX = './progressive/';
const DOWNLOAD_URL_PREFIX = './download/';
const MAX_MEDIA_RETRIES = 5;

const memoryCache = new Map<string, ApiPreparedMedia>();
const fetchPromises = new Map<string, Promise<ApiPreparedMedia | undefined>>();
const progressCallbacks = new Map<string, Map<string, ApiOnProgress>>();
const cancellableCallbacks = new Map<string, ApiOnProgress>();

let memoryCacheGeneration = 0;

export function fetch<T extends ApiMediaFormat>(
  url: string,
  mediaFormat: T,
  isHtmlAllowed = false,
  onProgress?: ApiOnProgress,
  callbackUniqueId?: string,
): Promise<ApiPreparedMedia> {
  if (mediaFormat === ApiMediaFormat.Progressive) {
    return (
      IS_PROGRESSIVE_SUPPORTED
        ? Promise.resolve(getProgressiveUrl(url))
        : fetch(url, ApiMediaFormat.BlobUrl, isHtmlAllowed, onProgress, callbackUniqueId)
    );
  }

  if (mediaFormat === ApiMediaFormat.DownloadUrl) {
    return (
      IS_PROGRESSIVE_SUPPORTED
        ? Promise.resolve(getDownloadUrl(url))
        : fetch(url, ApiMediaFormat.BlobUrl, isHtmlAllowed, onProgress, callbackUniqueId)
    );
  }

  if (!fetchPromises.has(url)) {
    const generation = memoryCacheGeneration;
    const promise = fetchFromCacheOrRemote(url, mediaFormat, isHtmlAllowed, generation)
      .catch((err) => {
        if (DEBUG) {
          // eslint-disable-next-line no-console
          console.warn(err);
        }

        return undefined;
      })
      .finally(() => {
        if (fetchPromises.get(url) !== promise) return;
        fetchPromises.delete(url);
        progressCallbacks.delete(url);
        cancellableCallbacks.delete(url);
      });

    fetchPromises.set(url, promise);
  }

  if (onProgress && callbackUniqueId) {
    let activeCallbacks = progressCallbacks.get(url);
    if (!activeCallbacks) {
      activeCallbacks = new Map<string, ApiOnProgress>();
      progressCallbacks.set(url, activeCallbacks);
    }
    activeCallbacks.set(callbackUniqueId, onProgress);
  }

  return fetchPromises.get(url) as Promise<ApiPreparedMedia>;
}

export function getFromMemory(url: string) {
  return memoryCache.get(url) as ApiPreparedMedia;
}

export function clearMemoryCache() {
  memoryCacheGeneration += 1;
  cancellableCallbacks.forEach(cancelApiProgress);
  memoryCache.forEach((media) => {
    if (typeof media === 'string' && media.startsWith('blob:')) URL.revokeObjectURL(media);
  });
  memoryCache.clear();
  fetchPromises.clear();
  progressCallbacks.clear();
  cancellableCallbacks.clear();
  progressivePartCache.forEach((entry) => {
    if (entry.timerId) clearTimeout(entry.timerId);
  });
  progressivePartCache.clear();
}

export function cancelProgress(progressCallback: ApiOnProgress) {
  progressCallbacks.forEach((map, url) => {
    map.forEach((callback) => {
      if (callback === progressCallback) {
        const parentCallback = cancellableCallbacks.get(url);
        if (!parentCallback) return;

        cancelApiProgress(parentCallback);
        cancellableCallbacks.delete(url);
        progressCallbacks.delete(url);
        return;
      }
    });
  });
}

export function removeCallback(url: string, callbackUniqueId: string) {
  const callbacks = progressCallbacks.get(url);
  if (!callbacks) return;
  callbacks.delete(callbackUniqueId);
}

export function getProgressiveUrl(url: string) {
  const base = new URL(`${PROGRESSIVE_URL_PREFIX}${url}`, window.location.href);
  if (ACCOUNT_SLOT) base.searchParams.set('account', ACCOUNT_SLOT.toString());
  return base.href;
}

function getDownloadUrl(url: string) {
  const base = new URL(`${DOWNLOAD_URL_PREFIX}${url}`, window.location.href);
  if (ACCOUNT_SLOT) base.searchParams.set('account', ACCOUNT_SLOT.toString());
  return base.href;
}

async function fetchFromCacheOrRemote(
  url: string,
  mediaFormat: ApiMediaFormat,
  isHtmlAllowed: boolean,
  generation: number,
  retryNumber = 0,
): Promise<string> {
  ensureCurrentMemoryCacheGeneration(generation);

  if (!MEDIA_CACHE_DISABLED) {
    const cacheName = url.startsWith('avatar') ? MEDIA_CACHE_NAME_AVATARS : MEDIA_CACHE_NAME;
    const cached = await cacheApi.fetch(cacheName, url, asCacheApiType[mediaFormat]!, isHtmlAllowed);

    if (cached) {
      let media = cached;

      if (cached.type === 'audio/ogg' && !IS_OPUS_SUPPORTED) {
        media = await oggToWav(media);
      }

      const prepared = prepareMedia(media);

      ensureCurrentMemoryCacheGeneration(generation, prepared);
      memoryCache.set(url, prepared);

      return prepared;
    }
  }

  const onProgress = makeOnProgress(url, generation);
  cancellableCallbacks.set(url, onProgress);

  const remote = await callApi('downloadMedia', { url, mediaFormat, isHtmlAllowed }, onProgress);
  ensureCurrentMemoryCacheGeneration(generation);
  if (!remote) {
    if (retryNumber >= MAX_MEDIA_RETRIES) {
      throw new Error(`Failed to fetch media ${url}`);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, getRetryTimeout(retryNumber));
    });
    // eslint-disable-next-line no-console
    if (DEBUG) console.debug(`Retrying to fetch media ${url}`);
    return fetchFromCacheOrRemote(url, mediaFormat, isHtmlAllowed, generation, retryNumber + 1);
  }

  const { mimeType } = remote;
  let prepared = prepareMedia(remote.dataBlob);

  if (mimeType === 'audio/ogg' && !IS_OPUS_SUPPORTED) {
    const blob = await fetchBlob(prepared);
    URL.revokeObjectURL(prepared);
    const media = await oggToWav(blob);
    prepared = prepareMedia(media);
  }

  ensureCurrentMemoryCacheGeneration(generation, prepared);
  memoryCache.set(url, prepared);

  return prepared;
}

export async function unload(url: string) {
  memoryCache.delete(url);
  if (!MEDIA_CACHE_DISABLED) {
    const cacheName = url.startsWith('avatar') ? MEDIA_CACHE_NAME_AVATARS : MEDIA_CACHE_NAME;
    await cacheApi.remove(cacheName, url);
  }
}

function makeOnProgress(url: string, generation: number) {
  const onProgress: ApiOnProgress = (progress: number) => {
    if (generation !== memoryCacheGeneration) {
      onProgress.isCanceled = true;
      return;
    }

    progressCallbacks.get(url)?.forEach((callback) => {
      callback(progress);
      if (callback.isCanceled) {
        onProgress.isCanceled = true;
        memoryCache.delete(url);
      }
    });
  };

  return onProgress;
}

function ensureCurrentMemoryCacheGeneration(generation: number, prepared?: ApiPreparedMedia) {
  if (generation === memoryCacheGeneration) return;

  if (typeof prepared === 'string' && prepared.startsWith('blob:')) URL.revokeObjectURL(prepared);
  throw new Error('MEDIA_REQUEST_CANCELED');
}

function prepareMedia(mediaData: Exclude<ApiParsedMedia, ArrayBuffer>): ApiPreparedMedia {
  if (mediaData instanceof Blob) {
    return URL.createObjectURL(mediaData);
  }

  return mediaData;
}

// Each part is 512KB and every round trip crosses China -> proxy -> Telegram DC (often 300-600ms),
// so a deeper read-ahead window keeps enough bytes in flight to avoid buffer underruns
const PREFETCH_CHUNKS_AHEAD = 6;
const MAX_PREFETCH_CACHE_ENTRIES = 16;
const PREFETCH_TTL_MS = 30_000;
const PREFETCH_DELAY_MS = 60;

type ProgressivePartResult = {
  arrayBuffer?: ArrayBuffer;
  mimeType?: string;
  fullSize?: number;
};

const progressivePartCache = new Map<string, {
  promise: Promise<ProgressivePartResult | undefined>;
  timerId?: ReturnType<typeof setTimeout>;
}>();

const lastRequestedStartByUrl = new Map<string, number>();

async function downloadPartWithRetry(
  params: { url: string; start: number; end: number },
  isPriority = true,
  retryNumber = 0,
): Promise<ProgressivePartResult | undefined> {
  const result = await callApi('downloadMedia', {
    mediaFormat: ApiMediaFormat.Progressive,
    isPriority,
    ...params,
  });
  if (!result) {
    if (retryNumber >= MAX_MEDIA_RETRIES) {
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.warn(`Failed to download media part after ${MAX_MEDIA_RETRIES} retries:`, params.url);
      }
      return undefined;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, getRetryTimeout(retryNumber));
    });
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.debug(`Retrying to download media part ${params.url}, attempt ${retryNumber + 1}`);
    }
    return downloadPartWithRetry(params, isPriority, retryNumber + 1);
  }
  return result;
}

function getOrFetchProgressivePart(
  params: { url: string; start: number; end: number },
  consume: boolean,
): Promise<ProgressivePartResult | undefined> {
  const cacheKey = `${params.url}:${params.start}-${params.end}`;
  const existing = progressivePartCache.get(cacheKey);

  if (existing) {
    if (consume) {
      if (existing.timerId) clearTimeout(existing.timerId);
      progressivePartCache.delete(cacheKey);
    }
    return existing.promise;
  }

  const promise = downloadPartWithRetry(params, consume)
    .then((res) => {
      if (consume || !res || !res.arrayBuffer) {
        progressivePartCache.delete(cacheKey);
      }
      return res;
    })
    .catch(() => {
      progressivePartCache.delete(cacheKey);
      return undefined;
    });

  if (progressivePartCache.size >= MAX_PREFETCH_CACHE_ENTRIES) {
    const oldestKey = progressivePartCache.keys().next().value;
    if (oldestKey) {
      const oldest = progressivePartCache.get(oldestKey);
      if (oldest?.timerId) clearTimeout(oldest.timerId);
      progressivePartCache.delete(oldestKey);
    }
  }

  const timerId = setTimeout(() => {
    progressivePartCache.delete(cacheKey);
  }, PREFETCH_TTL_MS);

  progressivePartCache.set(cacheKey, { promise, timerId });

  return promise;
}

if (IS_PROGRESSIVE_SUPPORTED) {
  navigator.serviceWorker.addEventListener('message', async (e) => {
    const { type, messageId, params } = e.data as {
      type: string;
      messageId: string;
      params: { url: string; start: number; end: number };
    };

    if (type !== 'requestPart') {
      return;
    }

    lastRequestedStartByUrl.set(params.url, params.start);

    let result = await getOrFetchProgressivePart(params, true);
    if (result?.arrayBuffer && result.arrayBuffer.byteLength === 0) {
      result = await downloadPartWithRetry(params, true);
    }
    if (!result || !result.arrayBuffer || result.arrayBuffer.byteLength === 0) {
      navigator.serviceWorker.controller?.postMessage({
        type: 'partResponse',
        messageId,
        result: undefined,
      });
      return;
    }

    const { arrayBuffer, mimeType, fullSize } = result;
    const transferBuffer = arrayBuffer.slice(0);

    navigator.serviceWorker.controller?.postMessage({
      type: 'partResponse',
      messageId,
      result: {
        arrayBuffer: transferBuffer,
        mimeType,
        fullSize,
      },
    }, [transferBuffer]);

    // Prefetch upcoming sequential video chunks in the background (with low priority)
    // after a brief window so immediate `<video>` moov-atom seeks are never queued behind prefetches.
    const partLength = params.end - params.start + 1;
    if (fullSize && partLength > 0 && params.end + 1 < fullSize) {
      const requestedStartSnapshot = params.start;
      setTimeout(() => {
        const latestStart = lastRequestedStartByUrl.get(params.url);
        if (latestStart !== undefined && latestStart !== requestedStartSnapshot && latestStart !== params.end + 1) {
          // The video element sought to another offset (e.g. moov atom at end of file); skip stale prefetch
          return;
        }
        for (let step = 1; step <= PREFETCH_CHUNKS_AHEAD; step++) {
          const nextStart = params.end + 1 + (step - 1) * partLength;
          if (nextStart >= fullSize) break;
          // Must match the Service Worker's range key (`start + DEFAULT_PART_SIZE - 1`, unclamped),
          // otherwise the final prefetched part is never reused; the download layer clamps to file size
          const nextEnd = nextStart + partLength - 1;
          void getOrFetchProgressivePart({
            url: params.url,
            start: nextStart,
            end: nextEnd,
          }, false);
        }
      }, PREFETCH_DELAY_MS);
    }
  });
}

function getRetryTimeout(retryNumber: number) {
  // 250ms, 500ms, 1s, 2s, 4s
  return 250 * 2 ** retryNumber;
}

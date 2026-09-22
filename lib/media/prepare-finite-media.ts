import fs from 'node:fs';
import type { EmbeddingProvider } from '../embed/types';
import type { ProxySettings } from '../ingest/variant';
import {
  encodeAudioProxy,
  encodeVideoProxy,
  type AudioProxyMetadata,
  type VideoProxyMetadata,
} from '../video/proxy-encode';
import {
  extractThumbnail,
  type ThumbnailResult,
} from '../video/thumbnail';

/**
 * Shared finite-window media preparation (file + live).
 * Encodes proxies, optionally extracts a thumbnail, and runs embeddings.
 * Does not index Elasticsearch or emit job SSE.
 */

export interface PrepareFiniteMediaPaths {
  videoProxy: string;
  audioProxy?: string;
  thumb?: string;
}

export interface PrepareFiniteMediaDeps {
  encodeVideoProxy?: typeof encodeVideoProxy;
  encodeAudioProxy?: typeof encodeAudioProxy;
  extractThumbnail?: typeof extractThumbnail;
  readFileSync?: (path: string) => Buffer;
}

export interface PrepareFiniteMediaInput {
  inputPath: string;
  startMs: number;
  endMs: number;
  hasAudio: boolean;
  budgetBytes: number;
  proxySettings: ProxySettings;
  provider: EmbeddingProvider;
  paths: PrepareFiniteMediaPaths;
  options?: {
    /** Default false — file pipeline keeps serial embeds. Live uses true. */
    concurrentEmbed?: boolean;
    /** Default true when paths.thumb is set. */
    extractThumb?: boolean;
    signal?: AbortSignal;
  };
  /** Test seams — production omits these. */
  deps?: PrepareFiniteMediaDeps;
}

export interface PrepareFiniteMediaResult {
  videoMeta: VideoProxyMetadata;
  audioMeta: AudioProxyMetadata | null;
  thumb: ThumbnailResult | null;
  embedding_video: number[];
  embedding_audio?: number[];
  has_audio: boolean;
  proxy_duration_ms: number;
  inference_duration_ms: number;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  }
}

/**
 * Prepare one finite media window for embedding/indexing.
 * Fails atomically when a present modality (video, or audio when hasAudio
 * and an audio proxy was produced) cannot be embedded — no partial vectors.
 */
export async function prepareFiniteMedia(
  input: PrepareFiniteMediaInput,
): Promise<PrepareFiniteMediaResult> {
  const signal = input.options?.signal;
  assertNotAborted(signal);

  const encodeVideo = input.deps?.encodeVideoProxy ?? encodeVideoProxy;
  const encodeAudio = input.deps?.encodeAudioProxy ?? encodeAudioProxy;
  const makeThumb = input.deps?.extractThumbnail ?? extractThumbnail;
  const readFile = input.deps?.readFileSync ?? ((p) => fs.readFileSync(p));

  const proxyStarted = Date.now();
  const videoMeta = await encodeVideo({
    inputPath: input.inputPath,
    outputPath: input.paths.videoProxy,
    startMs: input.startMs,
    endMs: input.endMs,
    budgetBytes: input.budgetBytes,
    proxySettings: input.proxySettings,
  });
  assertNotAborted(signal);

  const audioPath =
    input.paths.audioProxy ?? `${input.paths.videoProxy}.opus`;
  const audioMeta = await encodeAudio({
    inputPath: input.inputPath,
    outputPath: audioPath,
    startMs: input.startMs,
    endMs: input.endMs,
    hasAudio: input.hasAudio,
  });
  assertNotAborted(signal);

  let thumb: ThumbnailResult | null = null;
  const wantThumb =
    input.options?.extractThumb !== false && Boolean(input.paths.thumb);
  if (wantThumb && input.paths.thumb) {
    thumb = await makeThumb({
      inputPath: input.inputPath,
      outputPath: input.paths.thumb,
      startMs: input.startMs,
      endMs: input.endMs,
    });
  }
  const proxy_duration_ms = Date.now() - proxyStarted;
  assertNotAborted(signal);

  const videoBuf = readFile(input.paths.videoProxy);
  const concurrent = input.options?.concurrentEmbed === true;
  const inferStarted = Date.now();

  let embedding_video: number[];
  let embedding_audio: number[] | undefined;

  if (concurrent && audioMeta && input.hasAudio) {
    const audioBuf = readFile(audioPath);
    const [videoEmbed, audioEmbed] = await Promise.all([
      input.provider.embedVideo(videoBuf, 'passage'),
      input.provider.embedAudio(audioBuf, 'passage'),
    ]);
    embedding_video = videoEmbed.embedding;
    embedding_audio = audioEmbed.embedding;
  } else {
    const videoEmbed = await input.provider.embedVideo(videoBuf, 'passage');
    embedding_video = videoEmbed.embedding;
    if (audioMeta && input.hasAudio) {
      assertNotAborted(signal);
      const audioBuf = readFile(audioPath);
      const audioEmbed = await input.provider.embedAudio(audioBuf, 'passage');
      embedding_audio = audioEmbed.embedding;
    }
  }

  const inference_duration_ms = Date.now() - inferStarted;

  if (!embedding_video?.length) {
    throw new Error('video embedding missing after prepare');
  }
  if (audioMeta && input.hasAudio && !embedding_audio?.length) {
    throw new Error('audio embedding missing after prepare (atomic modality)');
  }

  return {
    videoMeta,
    audioMeta,
    thumb,
    embedding_video,
    embedding_audio,
    has_audio: Boolean(audioMeta && embedding_audio),
    proxy_duration_ms,
    inference_duration_ms,
  };
}

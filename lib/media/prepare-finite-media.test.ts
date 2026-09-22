import { describe, expect, it, vi } from 'vitest';
import type { EmbeddingProvider } from '../embed/types';
import { prepareFiniteMedia } from './prepare-finite-media';
import type { ProxySettings } from '../ingest/variant';

const proxySettings: ProxySettings = {
  videoFrames: 16,
  maxLongEdge: 720,
  resolutionLadder: [720],
  crfLadder: [23, 26, 28],
};

function mockProvider(overrides?: Partial<EmbeddingProvider>): EmbeddingProvider {
  return {
    provider: 'eis',
    model: 'm',
    task: 'passage',
    dims: 4,
    normalizedBy: 'provider',
    embedText: vi.fn(),
    embedImage: vi.fn(),
    embedVideo: vi.fn(async () => ({
      embedding: [0.1, 0.2, 0.3, 0.4],
      tokens: {},
      latencyMs: 1,
    })),
    embedAudio: vi.fn(async () => ({
      embedding: [0.5, 0.6, 0.7, 0.8],
      tokens: {},
      latencyMs: 1,
    })),
    ...overrides,
  };
}

const videoMeta = {
  bytes: 100,
  width: 320,
  height: 180,
  frames: 16,
  crf: 23,
  strategy: 'ladder' as const,
  ladder_exhausted: false,
  encode_ms: 1,
  output_path: '/tmp/v.mp4',
};

describe('prepareFiniteMedia', () => {
  it('no-audio path embeds video only', async () => {
    const provider = mockProvider();
    const result = await prepareFiniteMedia({
      inputPath: '/in.mp4',
      startMs: 0,
      endMs: 8000,
      hasAudio: false,
      budgetBytes: 1_000_000,
      proxySettings,
      provider,
      paths: { videoProxy: '/tmp/v.mp4' },
      options: { extractThumb: false },
      deps: {
        encodeVideoProxy: vi.fn(async () => videoMeta),
        encodeAudioProxy: vi.fn(async () => null),
        readFileSync: () => Buffer.from('v'),
      },
    });
    expect(result.embedding_video).toHaveLength(4);
    expect(result.embedding_audio).toBeUndefined();
    expect(result.has_audio).toBe(false);
    expect(provider.embedAudio).not.toHaveBeenCalled();
  });

  it('video+audio concurrent path embeds both', async () => {
    const order: string[] = [];
    const provider = mockProvider({
      embedVideo: vi.fn(async () => {
        order.push('v-start');
        await new Promise((r) => setTimeout(r, 15));
        order.push('v-end');
        return { embedding: [1, 0, 0, 0], tokens: {}, latencyMs: 15 };
      }),
      embedAudio: vi.fn(async () => {
        order.push('a-start');
        await new Promise((r) => setTimeout(r, 5));
        order.push('a-end');
        return { embedding: [0, 1, 0, 0], tokens: {}, latencyMs: 5 };
      }),
    });

    const result = await prepareFiniteMedia({
      inputPath: '/in.mp4',
      startMs: 0,
      endMs: 8000,
      hasAudio: true,
      budgetBytes: 1_000_000,
      proxySettings,
      provider,
      paths: { videoProxy: '/tmp/v.mp4', audioProxy: '/tmp/a.opus' },
      options: { concurrentEmbed: true, extractThumb: false },
      deps: {
        encodeVideoProxy: vi.fn(async () => videoMeta),
        encodeAudioProxy: vi.fn(async () => ({
          bytes: 40,
          bitrate: '48k',
          codec: 'opus',
          encode_ms: 1,
          output_path: '/tmp/a.opus',
        })),
        readFileSync: () => Buffer.from('x'),
      },
    });

    expect(result.embedding_audio).toEqual([0, 1, 0, 0]);
    expect(order.indexOf('a-start')).toBeLessThan(order.indexOf('v-end'));
  });

  it('fails atomically when audio embedding is empty', async () => {
    const provider = mockProvider({
      embedAudio: vi.fn(async () => ({
        embedding: [],
        tokens: {},
        latencyMs: 1,
      })),
    });

    await expect(
      prepareFiniteMedia({
        inputPath: '/in.mp4',
        startMs: 0,
        endMs: 8000,
        hasAudio: true,
        budgetBytes: 1_000_000,
        proxySettings,
        provider,
        paths: { videoProxy: '/tmp/v.mp4', audioProxy: '/tmp/a.opus' },
        options: { extractThumb: false },
        deps: {
          encodeVideoProxy: vi.fn(async () => videoMeta),
          encodeAudioProxy: vi.fn(async () => ({
            bytes: 40,
            bitrate: '48k',
            codec: 'opus',
            encode_ms: 1,
            output_path: '/tmp/a.opus',
          })),
          readFileSync: () => Buffer.from('x'),
        },
      }),
    ).rejects.toThrow(/atomic modality/);
  });

  it('propagates proxy budget exhaustion', async () => {
    const { ProxyBudgetExhaustedError } = await import('../video/proxy-encode');
    await expect(
      prepareFiniteMedia({
        inputPath: '/in.mp4',
        startMs: 0,
        endMs: 8000,
        hasAudio: false,
        budgetBytes: 10,
        proxySettings,
        provider: mockProvider(),
        paths: { videoProxy: '/tmp/v.mp4' },
        options: { extractThumb: false },
        deps: {
          encodeVideoProxy: vi.fn(async () => {
            throw new ProxyBudgetExhaustedError('budget', 10, 99);
          }),
          encodeAudioProxy: vi.fn(async () => null),
        },
      }),
    ).rejects.toBeInstanceOf(ProxyBudgetExhaustedError);
  });
});

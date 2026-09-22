import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  runLiveAgeDelete,
  selectAgeDeleteTargets,
  type AgeDeleteCandidate,
} from './age-delete';
import { loadLiveConfig, resetLiveConfig } from './config';
import { createMemoryLiveEsClient } from './memory-es';
import { isTimestampProtected, mintProtectRangeId } from './protect-ranges';
import { LiveProtectRangeRepository } from './protect-range-repository';
import { ensureSessionSpoolLayout, sessionSpoolDir } from './spool-paths';
import type { LiveProtectRangeDocument } from './types';

describe('A-20 protect ranges', () => {
  it('protects inclusive UTC timestamps and respects session scope', () => {
    const ranges: LiveProtectRangeDocument[] = [
      {
        range_id: 'lpr_a',
        start_at: '2026-09-10T12:00:00.000Z',
        end_at: '2026-09-10T13:00:00.000Z',
        session_id: 'ls_keep',
        created_at: '2026-09-10T00:00:00.000Z',
        updated_at: '2026-09-10T00:00:00.000Z',
      },
      {
        range_id: 'lpr_b',
        start_at: '2026-09-11T00:00:00.000Z',
        end_at: '2026-09-11T23:59:59.000Z',
        created_at: '2026-09-10T00:00:00.000Z',
        updated_at: '2026-09-10T00:00:00.000Z',
      },
    ];
    expect(
      isTimestampProtected(
        '2026-09-10T12:30:00.000Z',
        ranges,
        'ls_keep',
      ),
    ).toBe(true);
    expect(
      isTimestampProtected(
        '2026-09-10T12:30:00.000Z',
        ranges,
        'ls_other',
      ),
    ).toBe(false);
    expect(
      isTimestampProtected('2026-09-11T12:00:00.000Z', ranges, 'ls_other'),
    ).toBe(true);
    expect(
      isTimestampProtected('2026-09-12T00:00:00.000Z', ranges, 'ls_other'),
    ).toBe(false);
  });

  it('selectAgeDeleteTargets excludes protected window_end_at', () => {
    const ranges: LiveProtectRangeDocument[] = [
      {
        range_id: 'lpr_x',
        start_at: '2026-09-01T00:00:00.000Z',
        end_at: '2026-09-01T12:00:00.000Z',
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
      },
    ];
    const candidates: AgeDeleteCandidate[] = [
      {
        id: 'c_old',
        index: 'live-video-chunks',
        session_id: 'ls_1',
        key_at: '2026-08-31T23:00:00.000Z',
      },
      {
        id: 'c_protected',
        index: 'live-video-chunks',
        session_id: 'ls_1',
        key_at: '2026-09-01T06:00:00.000Z',
      },
      {
        id: 'c_recent',
        index: 'live-video-chunks',
        session_id: 'ls_1',
        key_at: '2026-09-10T00:00:00.000Z',
      },
    ];
    const sel = selectAgeDeleteTargets(
      candidates,
      '2026-09-05T00:00:00.000Z',
      ranges,
    );
    expect(sel.matchedCount).toBe(2);
    expect(sel.protectedCount).toBe(1);
    expect(sel.toDelete.map((c) => c.id)).toEqual(['c_old']);
  });
});

describe('A-20 runLiveAgeDelete', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    resetLiveConfig();
    for (const d of tmpDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('deletes aged chunks/events and spool media while skipping protect ranges', async () => {
    const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'live-age-del-'));
    tmpDirs.push(spool);
    resetLiveConfig();
    const cfg = loadLiveConfig({
      LIVE_SPOOL_DIR: spool,
      ES_INDEX_LIVE_PROTECT_RANGES: 'live-video-protect-ranges',
      ES_DATA_STREAM_LIVE_CHUNKS: 'live-video-chunks',
      ES_DATA_STREAM_LIVE_EVENTS: 'live-video-events',
    } as NodeJS.ProcessEnv);

    const { client, store } = createMemoryLiveEsClient();
    const sessionId = 'ls_age_sess';
    const sessionDir = sessionSpoolDir(spool, sessionId);
    ensureSessionSpoolLayout(sessionDir);

    const oldId = 'ls_age_sess_1_1';
    const protectedId = 'ls_age_sess_1_2';
    const freshId = 'ls_age_sess_1_3';

    const put = (
      index: string,
      id: string,
      source: Record<string, unknown>,
    ) => {
      store.set(`${index}::${id}`, {
        source,
        _seq_no: 0,
        _primary_term: 1,
      });
    };

    put(cfg.ES_DATA_STREAM_LIVE_CHUNKS, oldId, {
      chunk_id: oldId,
      session_id: sessionId,
      window_end_at: '2026-09-01T00:00:00.000Z',
    });
    put(cfg.ES_DATA_STREAM_LIVE_CHUNKS, protectedId, {
      chunk_id: protectedId,
      session_id: sessionId,
      window_end_at: '2026-09-02T06:00:00.000Z',
    });
    put(cfg.ES_DATA_STREAM_LIVE_CHUNKS, freshId, {
      chunk_id: freshId,
      session_id: sessionId,
      window_end_at: '2026-09-12T00:00:00.000Z',
    });
    put(cfg.ES_DATA_STREAM_LIVE_EVENTS, 'ev_old', {
      event_id: 'ev_old',
      session_id: sessionId,
      '@timestamp': '2026-09-01T00:00:00.000Z',
    });
    put(cfg.ES_DATA_STREAM_LIVE_EVENTS, 'ev_protected', {
      event_id: 'ev_protected',
      session_id: sessionId,
      '@timestamp': '2026-09-02T06:00:00.000Z',
    });

    const clip = path.join(sessionDir, 'media', `${oldId}.mp4`);
    const thumb = path.join(sessionDir, 'media', `${oldId}.thumb.jpg`);
    const keepClip = path.join(sessionDir, 'media', `${protectedId}.mp4`);
    fs.writeFileSync(clip, 'old-clip');
    fs.writeFileSync(thumb, 'old-thumb');
    fs.writeFileSync(keepClip, 'keep-clip');

    const protectRepo = new LiveProtectRangeRepository(client, cfg);
    const nowIso = '2026-09-12T12:00:00.000Z';
    await protectRepo.create({
      range_id: mintProtectRangeId(),
      start_at: '2026-09-02T00:00:00.000Z',
      end_at: '2026-09-02T23:59:59.000Z',
      session_id: sessionId,
      note: 'keep incident window',
      created_at: nowIso,
      updated_at: nowIso,
    });

    const dry = await runLiveAgeDelete({
      olderThan: '7d',
      now: new Date('2026-09-12T12:00:00.000Z'),
      dryRun: true,
      client,
      cfg,
      protectRepo,
    });
    expect(dry.dry_run).toBe(true);
    expect(dry.chunks_matched).toBe(2);
    expect(dry.chunks_protected).toBe(1);
    expect(dry.chunks_planned).toBe(1);
    expect(dry.chunks_deleted).toBe(0);
    expect(dry.media_files_planned).toBe(2);
    expect(dry.media_files_deleted).toBe(0);
    expect(store.has(`${cfg.ES_DATA_STREAM_LIVE_CHUNKS}::${oldId}`)).toBe(
      true,
    );

    const exec = await runLiveAgeDelete({
      olderThan: '7d',
      now: new Date('2026-09-12T12:00:00.000Z'),
      dryRun: false,
      client,
      cfg,
      protectRepo,
    });
    expect(exec.dry_run).toBe(false);
    expect(exec.chunks_planned).toBe(1);
    expect(exec.chunks_deleted).toBe(1);
    expect(exec.chunks_protected).toBe(1);
    expect(exec.events_deleted).toBe(1);
    expect(exec.events_protected).toBe(1);
    expect(exec.media_files_deleted).toBe(2);
    expect(exec.truncated).toBe(false);
    expect(store.has(`${cfg.ES_DATA_STREAM_LIVE_CHUNKS}::${oldId}`)).toBe(
      false,
    );
    expect(
      store.has(`${cfg.ES_DATA_STREAM_LIVE_CHUNKS}::${protectedId}`),
    ).toBe(true);
    expect(store.has(`${cfg.ES_DATA_STREAM_LIVE_CHUNKS}::${freshId}`)).toBe(
      true,
    );
    expect(fs.existsSync(clip)).toBe(false);
    expect(fs.existsSync(thumb)).toBe(false);
    expect(fs.existsSync(keepClip)).toBe(true);
  });

  it('pages beyond 5000 candidates and honors protect ranges past first page', async () => {
    const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'live-age-page-'));
    tmpDirs.push(spool);
    resetLiveConfig();
    const cfg = loadLiveConfig({
      LIVE_SPOOL_DIR: spool,
      ES_INDEX_LIVE_PROTECT_RANGES: 'live-video-protect-ranges',
      ES_DATA_STREAM_LIVE_CHUNKS: 'live-video-chunks',
      ES_DATA_STREAM_LIVE_EVENTS: 'live-video-events',
    } as NodeJS.ProcessEnv);
    const { client, store } = createMemoryLiveEsClient();
    const sessionId = 'ls_page';
    const put = (
      index: string,
      id: string,
      source: Record<string, unknown>,
    ) => {
      store.set(`${index}::${id}`, {
        source,
        _seq_no: 0,
        _primary_term: 1,
      });
    };

    // 12 aged chunks across pages of size 5.
    for (let i = 0; i < 12; i++) {
      const id = `c_${String(i).padStart(2, '0')}`;
      put(cfg.ES_DATA_STREAM_LIVE_CHUNKS, id, {
        chunk_id: id,
        session_id: sessionId,
        window_end_at: `2026-09-01T00:${String(i).padStart(2, '0')}:00.000Z`,
      });
    }

    const protectRepo = new LiveProtectRangeRepository(client, cfg);
    // Create 7 protect ranges (page size 3) covering c_10 only via last range.
    for (let i = 0; i < 6; i++) {
      await protectRepo.create({
        range_id: `lpr_filler_${i}`,
        start_at: '2026-08-01T00:00:00.000Z',
        end_at: '2026-08-01T01:00:00.000Z',
        created_at: '2026-09-12T00:00:00.000Z',
        updated_at: '2026-09-12T00:00:00.000Z',
      });
    }
    await protectRepo.create({
      range_id: 'lpr_keep_c10',
      start_at: '2026-09-01T00:10:00.000Z',
      end_at: '2026-09-01T00:10:59.000Z',
      session_id: sessionId,
      created_at: '2026-09-12T00:00:00.000Z',
      updated_at: '2026-09-12T00:00:00.000Z',
    });

    const audit = await runLiveAgeDelete({
      olderThan: '1d',
      now: new Date('2026-09-12T12:00:00.000Z'),
      dryRun: false,
      client,
      cfg,
      protectRepo,
      pageSize: 5,
    });

    expect(audit.chunks_matched).toBe(12);
    expect(audit.chunks_protected).toBe(1);
    expect(audit.chunks_deleted).toBe(11);
    expect(audit.truncated).toBe(false);
    expect(store.has(`${cfg.ES_DATA_STREAM_LIVE_CHUNKS}::c_10`)).toBe(true);
    expect(store.has(`${cfg.ES_DATA_STREAM_LIVE_CHUNKS}::c_00`)).toBe(false);
  });

  it('does not unlink media when Elasticsearch delete fails', async () => {
    const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'live-age-esfail-'));
    tmpDirs.push(spool);
    resetLiveConfig();
    const cfg = loadLiveConfig({
      LIVE_SPOOL_DIR: spool,
      ES_INDEX_LIVE_PROTECT_RANGES: 'live-video-protect-ranges',
      ES_DATA_STREAM_LIVE_CHUNKS: 'live-video-chunks',
      ES_DATA_STREAM_LIVE_EVENTS: 'live-video-events',
    } as NodeJS.ProcessEnv);
    const { client, store } = createMemoryLiveEsClient();
    const sessionId = 'ls_esfail';
    const sessionDir = sessionSpoolDir(spool, sessionId);
    ensureSessionSpoolLayout(sessionDir);
    const chunkId = 'c_fail';
    store.set(`${cfg.ES_DATA_STREAM_LIVE_CHUNKS}::${chunkId}`, {
      source: {
        chunk_id: chunkId,
        session_id: sessionId,
        window_end_at: '2026-09-01T00:00:00.000Z',
      },
      _seq_no: 0,
      _primary_term: 1,
    });
    const clip = path.join(sessionDir, 'media', `${chunkId}.mp4`);
    fs.writeFileSync(clip, 'clip');

    const failing = {
      ...client,
      deleteByQuery: async () => {
        throw new Error('es down');
      },
      delete: async () => {
        throw new Error('es down');
      },
    };

    const audit = await runLiveAgeDelete({
      olderThan: '1d',
      now: new Date('2026-09-12T12:00:00.000Z'),
      dryRun: false,
      client: failing as typeof client,
      cfg,
      protectRanges: [],
    });
    expect(audit.chunks_planned).toBe(1);
    expect(audit.chunks_deleted).toBe(0);
    expect(audit.media_files_deleted).toBe(0);
    expect(audit.errors.length).toBeGreaterThan(0);
    expect(fs.existsSync(clip)).toBe(true);
  });

  it('does not unlink media for docs that survive a partial deleteByQuery', async () => {
    const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'live-age-partial-'));
    tmpDirs.push(spool);
    resetLiveConfig();
    const cfg = loadLiveConfig({
      LIVE_SPOOL_DIR: spool,
      ES_INDEX_LIVE_PROTECT_RANGES: 'live-video-protect-ranges',
      ES_DATA_STREAM_LIVE_CHUNKS: 'live-video-chunks',
      ES_DATA_STREAM_LIVE_EVENTS: 'live-video-events',
    } as NodeJS.ProcessEnv);
    const { client, store } = createMemoryLiveEsClient();
    const sessionId = 'ls_partial';
    const sessionDir = sessionSpoolDir(spool, sessionId);
    ensureSessionSpoolLayout(sessionDir);
    for (const chunkId of ['c_gone', 'c_keep']) {
      store.set(`${cfg.ES_DATA_STREAM_LIVE_CHUNKS}::${chunkId}`, {
        source: {
          chunk_id: chunkId,
          session_id: sessionId,
          window_end_at: '2026-09-01T00:00:00.000Z',
        },
        _seq_no: 0,
        _primary_term: 1,
      });
      fs.writeFileSync(
        path.join(sessionDir, 'media', `${chunkId}.mp4`),
        chunkId,
      );
    }

    const partial = {
      ...client,
      deleteByQuery: async (params: {
        index: string;
        query?: { ids?: { values?: string[] } };
      }) => {
        const ids = params.query?.ids?.values ?? [];
        // Simulate conflict: only c_gone is removed; c_keep survives.
        if (ids.includes('c_gone')) {
          store.delete(`${params.index}::c_gone`);
        }
        return { deleted: ids.includes('c_gone') ? 1 : 0 };
      },
    };

    const audit = await runLiveAgeDelete({
      olderThan: '1d',
      now: new Date('2026-09-12T12:00:00.000Z'),
      dryRun: false,
      client: partial as typeof client,
      cfg,
      protectRanges: [],
    });

    expect(audit.chunks_planned).toBe(2);
    expect(audit.chunks_deleted).toBe(1);
    expect(fs.existsSync(path.join(sessionDir, 'media', 'c_gone.mp4'))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(sessionDir, 'media', 'c_keep.mp4'))).toBe(
      true,
    );
    expect(store.has(`${cfg.ES_DATA_STREAM_LIVE_CHUNKS}::c_keep`)).toBe(true);
    expect(audit.errors.some((e) => /partial delete/i.test(e))).toBe(true);
  });

  it('refuses mutation when candidate scan is truncated', async () => {
    const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'live-age-trunc-'));
    tmpDirs.push(spool);
    resetLiveConfig();
    const cfg = loadLiveConfig({
      LIVE_SPOOL_DIR: spool,
      ES_INDEX_LIVE_PROTECT_RANGES: 'live-video-protect-ranges',
      ES_DATA_STREAM_LIVE_CHUNKS: 'live-video-chunks',
      ES_DATA_STREAM_LIVE_EVENTS: 'live-video-events',
    } as NodeJS.ProcessEnv);
    const { client, store } = createMemoryLiveEsClient();
    const sessionId = 'ls_trunc';
    for (let i = 0; i < 5; i++) {
      const id = `c_${i}`;
      store.set(`${cfg.ES_DATA_STREAM_LIVE_CHUNKS}::${id}`, {
        source: {
          chunk_id: id,
          session_id: sessionId,
          window_end_at: `2026-09-01T00:0${i}:00.000Z`,
        },
        _seq_no: 0,
        _primary_term: 1,
      });
    }

    const audit = await runLiveAgeDelete({
      olderThan: '1d',
      now: new Date('2026-09-12T12:00:00.000Z'),
      dryRun: false,
      client,
      cfg,
      protectRanges: [],
      pageSize: 2,
      maxCandidates: 2,
    });

    expect(audit.truncated).toBe(true);
    expect(audit.chunks_deleted).toBe(0);
    expect(audit.errors.some((e) => /refused mutation/i.test(e))).toBe(true);
    expect(store.size).toBe(5);
  });
});

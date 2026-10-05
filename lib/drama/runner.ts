/**
 * Follow-on drama enrichment after ingest embed reaches `ready` (plan/12 P1).
 * Node/ffmpeg path — Python submodule not required.
 */
import path from 'node:path';
import type { IngestJob } from '../ingest/job-store';
import { updateJob } from '../ingest/job-store';
import type { DramaJobState, DramaModule } from '../ingest/drama-options';
import {
  createDramaWorkspace,
  copyRetryHostSubtitles,
  isSafeDramaRunId,
  openDramaWorkspace,
  writeDramaJson,
  type DramaWorkspace,
} from './workspace';
import { resolveSubtitlesForLanguage } from './resolve-subtitles';
import { resolveEnglishChineseSubtitles } from './resolve-bilingual-subtitles';
import {
  indexDramaSubtitles,
  reconcileSubtitleLang,
  retireOldSubtitleGenerations,
} from './index-subtitles';
import { proposeStructure } from './structure';
import { persistDramaMeta, type DramaMetaPayload } from './persist-meta';
import { generateDirectorsScript } from './directors-script';
import { generateKeyActors } from './key-actors';
import { extractKeyScenes } from './key-scenes';
import { cleanupDramaFrames } from './frame-gc';

import { tryAcquireDramaRun, releaseDramaRun } from './run-lease';
export { isDramaRunActive, tryAcquireDramaRun, releaseDramaRun, clearDramaRunLeases } from './run-lease';


function patchDrama(
  job: IngestJob,
  patch: Partial<DramaJobState>,
): DramaJobState {
  const base = job.drama!;
  const next: DramaJobState = {
    ...base,
    ...patch,
    modules_done: patch.modules_done ?? base.modules_done,
  };
  job.drama = next;
  return next;
}

async function emitDramaProgress(
  job: IngestJob,
  message: string,
  drama: DramaJobState,
): Promise<void> {
  await updateJob(
    job,
    { drama, message },
    { event: 'progress', persist: false },
  );
}

/**
 * Resolve this run's workspace, reusing an ID assigned by the handoff. Each retry clears the old ID
 * before handoff so published generations remain available.
 */
function resolveDramaWorkspace(job: IngestJob): DramaWorkspace {
  const runId = job.drama?.run_id;
  if (isSafeDramaRunId(runId)) {
    return openDramaWorkspace(job.videoId, runId);
  }
  return createDramaWorkspace(job.videoId);
}

/**
 * Durable handoff for the base-`ready` transition (F3).
 * Creates (or reopens) the run workspace, records `running` on the job,
 * and persists the running marker to `meta.drama` — all BEFORE the caller
 * persists base `ready`, so a crash after ready always leaves a
 * recoverable marker. Throws on marker failure; the caller must surface
 * that visibly (failed drama, retryable) without reverting base `ready`.
 */
export async function prepareDramaHandoff(job: IngestJob, previousRunId?: string): Promise<DramaWorkspace> {
  if (!job.drama) throw new Error('prepareDramaHandoff: job has no drama request');
  const ws = resolveDramaWorkspace(job);
  copyRetryHostSubtitles(previousRunId, ws);
  patchDrama(job, {
    status: 'running',
    run_id: ws.runId,
    modules_done: [],
  });
  writeDramaJson(ws.metaPath, {
    video_id: job.videoId,
    run_id: ws.runId,
    media_path: job.mediaPath,
    modules: job.drama.modules,
    languages: job.drama.languages,
    started_at: new Date().toISOString(),
  });
  try {
    await persistDramaMeta(job.videoId, {
      run_id: ws.runId,
      enrichment_status: 'running',
      modules: job.drama.modules,
      languages: job.drama.languages,
      subtitle_source: job.drama.subtitleSource,
      source_language: job.drama.sourceLanguage,
      director_coverage: job.drama.directorCoverage,
      modules_done: [],
    });
  } catch (err) {
    throw new Error(
      `drama handoff marker failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return ws;
}

/**
 * Run selected drama modules. Never flips asset status away from `ready`.
 */
export async function runDramaEnrichment(job: IngestJob): Promise<void> {
  if (!job.drama || job.drama.status === 'succeeded') return;
  // No overlap: a second concurrent run returns without touching state.
  if (!tryAcquireDramaRun(job.videoId, job.id)) return;

  let ws: DramaWorkspace;
  try {
    const modules = job.drama.modules;
    const languages = job.drama.languages;
    // Reuse the handoff workspace when the pipeline prepared one (F3);
    // otherwise create (or reopen, on retry) it here.
    ws =
      job.drama.status === 'running' && isSafeDramaRunId(job.drama.run_id)
        ? openDramaWorkspace(job.videoId, job.drama.run_id)
        : resolveDramaWorkspace(job);
    const modulesDone: DramaModule[] = [];
    const subtitlePaths: string[] = [];
    const errors: string[] = [];

    patchDrama(job, {
      status: 'running',
      run_id: ws.runId,
      modules_done: [],
    });
    await emitDramaProgress(
      job,
      `Enrichment started (${modules.join(', ')})`,
      job.drama!,
    );

    writeDramaJson(ws.metaPath, {
      video_id: job.videoId,
      run_id: ws.runId,
      media_path: job.mediaPath,
      modules,
      languages,
      started_at: new Date().toISOString(),
    });

    // Durable run record (R7): a crash mid-run leaves a `running` marker in
    // meta.drama, which hydrate maps back to retryable `pending`.
    // Best-effort — never fail enrichment over the marker write.
    try {
      await persistDramaMeta(job.videoId, {
        run_id: ws.runId,
        enrichment_status: 'running',
        modules,
        languages,
        subtitle_source: job.drama.subtitleSource,
        source_language: job.drama.sourceLanguage,
        director_coverage: job.drama.directorCoverage,
        modules_done: [],
      });
    } catch {
      /* ignore */
    }

    let structure = undefined as
      | Awaited<ReturnType<typeof proposeStructure>>
      | undefined;
    let synopsisZh: string | undefined;
    let synopsisEn: string | undefined;
    let synopsisAudited = false;
    let directorsPaths:
      | {
          zh?: string;
          en?: string;
          raw?: string;
        }
      | undefined;
    let keyActors:
      | Awaited<ReturnType<typeof generateKeyActors>>
      | undefined;
    let keyScenes:
      | Awaited<ReturnType<typeof extractKeyScenes>>
      | undefined;

    if (modules.includes('structure')) {
      try {
        await emitDramaProgress(
          job,
          'Enrichment: detecting structure (片头/片尾/body)…',
          job.drama!,
        );
        structure = await proposeStructure({
          videoPath: job.mediaPath,
          durationMs: job.probe.duration_ms,
        });
        writeDramaJson(ws.structurePath, { structure });
        modulesDone.push('structure');
        patchDrama(job, { modules_done: [...modulesDone] });
        await emitDramaProgress(
          job,
          `Enrichment: structure ready (${structure.length} intervals)`,
          job.drama!,
        );
      } catch (err) {
        errors.push(
          `structure: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (modules.includes('subtitles')) {
      const bilingual = languages.includes('en') && languages.includes('zh')
        ? await resolveEnglishChineseSubtitles({
            videoPath: job.mediaPath,
            subtitlesDir: ws.subtitlesDir,
            audioDir: ws.audioDir,
            subtitleSource: job.drama?.subtitleSource,
            sourceLanguage: job.drama?.sourceLanguage,
          })
        : null;
      // R8: embedded matching is per-language by stream tag, so every
      // requested language probes embedded streams independently.
      for (const lang of languages) {
        try {
          await emitDramaProgress(
            job,
            `Enrichment: subtitles (${lang})…`,
            job.drama!,
          );
          const pairError = lang === 'en' || lang === 'zh' ? bilingual?.errors[lang] : undefined;
          if (pairError) throw pairError;
          const pairResolved = lang === 'en' || lang === 'zh' ? bilingual?.resolved[lang] : undefined;
          const resolved = pairResolved ?? await resolveSubtitlesForLanguage({
            videoPath: job.mediaPath,
            lang,
            subtitlesDir: ws.subtitlesDir,
            audioDir: ws.audioDir,
            // P4: per-run subtitle policy — old jobs without the field
            // fall back to the default `auto` inside the resolver.
            subtitleSource: job.drama?.subtitleSource,
          });
          subtitlePaths.push(resolved.srtPath);
          const subResult = await indexDramaSubtitles({
            videoId: job.videoId,
            runId: ws.runId,
            lang,
            cues: resolved.cues,
            source: resolved.origin,
          });
          // I2: reconcile this language generation — drop stale same-run
          // cues (shorter/retimed retry), then switch this language to the
          // current run. A failed language never reaches here, so its
          // previous generation stays intact. All best-effort.
          try {
            await reconcileSubtitleLang({
              videoId: job.videoId,
              runId: ws.runId,
              lang,
              keepSegIds: subResult.segIds,
            });
            await retireOldSubtitleGenerations({
              videoId: job.videoId,
              keepRunId: ws.runId,
              lang,
            });
          } catch {
            /* ignore */
          }
          if (!modulesDone.includes('subtitles')) {
            modulesDone.push('subtitles');
          }
          patchDrama(job, { modules_done: [...modulesDone] });
          await emitDramaProgress(
            job,
            `Enrichment: indexed ${subResult.indexed} ${lang} cues (${resolved.origin}, ${subResult.embedded} embedded)`,
            job.drama!,
          );
        } catch (err) {
          errors.push(
            `subtitles:${lang}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    if (modules.includes('directors_script')) {
      try {
        await emitDramaProgress(
          job,
          'Enrichment: directors script (EIS multimodal)…',
          job.drama!,
        );
        const result = await generateDirectorsScript({
          videoPath: job.mediaPath,
          videoId: job.videoId,
          title: job.title,
          durationMs: job.probe.duration_ms,
          workspace: ws,
          structure,
          subtitlePaths,
          onProgress: async (msg) => {
            await emitDramaProgress(job, msg, job.drama!);
          },
        });
        synopsisZh = result.synopsisZh || undefined;
        synopsisEn = result.synopsisEn || undefined;
        // F2 evidence gate: only a supported auditor verdict earns
        // `audited`; skipped/failed/unparseable persist as `provisional`.
        synopsisAudited =
          result.audit?.status === 'ok' && result.audit?.verdict === 'supported';
        directorsPaths = {
          zh: result.scriptZhPath,
          en: result.scriptEnPath,
          raw: result.scriptRawPath,
        };
        modulesDone.push('directors_script');
        patchDrama(job, { modules_done: [...modulesDone] });
        const gapNote =
          result.coverageGaps.length > 0
            ? `, gaps ${result.coverageGaps.length}`
            : '';
        await emitDramaProgress(
          job,
          `Enrichment: directors done (${result.windowsDone}/${result.windowsPlanned} windows ok, sampled ${result.coverageSec}s, ~${result.sceneCount} scenes, audit ${result.audit?.status ?? 'skipped'}${result.audit?.verdict ? `/${result.audit.verdict}` : ''}${gapNote})`,
          job.drama!,
        );
      } catch (err) {
        errors.push(
          `directors_script: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // P3: key actors (verified face cards) + key scenes (stills + summaries).
    if (modules.includes('key_actors')) {
      try {
        await emitDramaProgress(
          job,
          'Enrichment: key actors (EIS propose+verify)…',
          job.drama!,
        );
        keyActors = await generateKeyActors({
          videoPath: job.mediaPath,
          title: job.title,
          workspace: ws,
          rawScript: directorsPaths?.raw,
          structure,
          durationMs: job.probe.duration_ms,
          onProgress: async (msg) => {
            await emitDramaProgress(job, msg, job.drama!);
          },
        });
        modulesDone.push('key_actors');
        patchDrama(job, { modules_done: [...modulesDone] });
        await emitDramaProgress(
          job,
          `Enrichment: key actors done (${keyActors.actors.length} candidates, needs review — upstream face gates unimplemented)`,
          job.drama!,
        );
      } catch (err) {
        errors.push(
          `key_actors: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (modules.includes('key_scenes')) {
      try {
        await emitDramaProgress(
          job,
          'Enrichment: key scenes (stills + summaries)…',
          job.drama!,
        );
        keyScenes = await extractKeyScenes({
          videoPath: job.mediaPath,
          workspace: ws,
          rawScript: directorsPaths?.raw,
          structure,
          durationMs: job.probe.duration_ms,
          onProgress: async (msg) => {
            await emitDramaProgress(job, msg, job.drama!);
          },
        });
        modulesDone.push('key_scenes');
        patchDrama(job, { modules_done: [...modulesDone] });
        await emitDramaProgress(
          job,
          `Enrichment: key scenes done (${keyScenes.scenes.length}, ${keyScenes.selection === 'script' ? 'script-selected' : 'uniform still-only fallback — no summaries'})`,
          job.drama!,
        );
      } catch (err) {
        errors.push(
          `key_scenes: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Frame GC (OQ-2/F7): disposable intermediates deleted after all modules
    // finished. Own just-finished run bypasses the age guard (lease is held,
    // so nothing else can be using its frames); a guarded sweep reaps aged
    // orphans from crashed runs. Keeps SRT/scripts/structure/scene+face thumbs.
    if (modules.some((m) => m === 'directors_script' || m === 'key_actors')) {
      try {
        const gc = cleanupDramaFrames({
          videoId: job.videoId,
          runId: ws.runId,
          ignoreAgeGuard: true,
        });
        const sweep = cleanupDramaFrames({ videoId: job.videoId });
        const deleted = gc.deleted + sweep.deleted;
        if (deleted > 0) {
          await emitDramaProgress(
            job,
            `Enrichment: frame cleanup removed ${deleted} dir(s) (~${((gc.freedBytes + sweep.freedBytes) / 1024 / 1024).toFixed(1)} MB)`,
            job.drama!,
          );
        }
      } catch (err) {
        // GC is best-effort — never fail the enrichment over cleanup.
        errors.push(
          `frame_gc: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const wantedCore = new Set<DramaModule>(modules);
    const enrichment_status: DramaMetaPayload['enrichment_status'] =
      errors.length === 0
        ? 'succeeded'
        : modulesDone.some((m) => wantedCore.has(m))
          ? 'partial'
          : wantedCore.size === 0 && modulesDone.length === 0
            ? 'failed'
            : modulesDone.length > 0
              ? 'partial'
              : 'failed';

    const portable = (raw: string | undefined): string | undefined => {
      if (!raw) return undefined;
      const relative = path.isAbsolute(raw) ? path.relative(ws.rootDir, raw) : raw;
      if (relative.split(/[\\/]/).some((part) => part === '..' || part === '.') || path.isAbsolute(relative)) return undefined;
      return relative.split(path.sep).join('/');
    };
    const dramaMeta: DramaMetaPayload = {
      run_id: ws.runId,
      enrichment_status,
      modules,
      languages,
      subtitle_source: job.drama.subtitleSource,
      source_language: job.drama.sourceLanguage,
      director_coverage: job.drama.directorCoverage,
      modules_done: modulesDone,
      structure,
      synopsis_zh: synopsisZh,
      synopsis_en: synopsisEn,
      // F2: provisional unless the auditor returned `supported`.
      synopsis_status:
        synopsisZh || synopsisEn
          ? synopsisAudited
            ? 'audited'
            : 'provisional'
          : undefined,
      directors_script_zh_path: portable(directorsPaths?.zh),
      directors_script_en_path: portable(directorsPaths?.en),
      directors_script_raw_path: portable(directorsPaths?.raw),
      subtitle_paths: subtitlePaths.map(portable).filter((raw): raw is string => Boolean(raw)),
      key_actors: keyActors?.actors.map((actor) => ({ ...actor, thumb_path: portable(actor.thumb_path) })),
      key_scenes: keyScenes?.scenes.map((scene) => ({ ...scene, thumb_path: portable(scene.thumb_path) })),
      error:
        errors.length > 0
          ? {
              code: 'DRAMA_ENRICHMENT_ERROR',
              message: errors.join('; ').slice(0, 800),
            }
          : undefined,
    };

    try {
      await persistDramaMeta(job.videoId, dramaMeta);
    } catch (err) {
      errors.push(
        `persist: ${err instanceof Error ? err.message : String(err)}`,
      );
      dramaMeta.enrichment_status = modulesDone.length ? 'partial' : 'failed';
      dramaMeta.error = {
        code: 'DRAMA_ENRICHMENT_ERROR',
        message: errors.join('; ').slice(0, 800),
      };
    }

    writeDramaJson(ws.metaPath, {
      ...dramaMeta,
      finished_at: new Date().toISOString(),
    });

    // I2: generation switching already happened per successfully indexed
    // language above. No whole-video retirement here on purpose — on a
    // partial multilingual run it would delete the last complete
    // generation of a failed language.

    patchDrama(job, {
      status: dramaMeta.enrichment_status,
      modules_done: modulesDone,
      run_id: ws.runId,
      error: dramaMeta.error,
    });

    await updateJob(
      job,
      {
        drama: job.drama,
        message:
          dramaMeta.enrichment_status === 'succeeded'
            ? 'Enrichment complete'
            : dramaMeta.enrichment_status === 'partial'
              ? `Enrichment partial: ${dramaMeta.error?.message ?? ''}`
              : `Enrichment failed: ${dramaMeta.error?.message ?? ''}`,
      },
      { event: 'progress', persist: true },
    );
  } finally {
    releaseDramaRun(job.videoId, job.id);
  }
}

/** Fire-and-forget after embed ready. */
export function startDramaEnrichmentAsync(job: IngestJob): void {
  if (!job.drama) return;
  void runDramaEnrichment(job).catch(async (err) => {
    const message = err instanceof Error ? err.message : String(err);
    try {
      patchDrama(job, {
        status: 'failed',
        error: { code: 'DRAMA_ENRICHMENT_ERROR', message: message.slice(0, 800) },
      });
      await updateJob(
        job,
        {
          drama: job.drama,
          message: `Enrichment failed: ${message.slice(0, 200)}`,
        },
        // I4: durably record unexpected top-level failures — jobToAssetDoc
        // carries the failed drama state, so restart can still retry it.
        { event: 'progress', persist: true },
      );
    } catch {
      /* ignore */
    }
  });
}

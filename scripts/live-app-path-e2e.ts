/**
 * Application-path live E2E (Batch 3 / A-03 / A-06 / V-03 / V-04).
 *
 * Drives the public HTTP control plane + a real live-worker process against
 * the MediaMTX fixture:
 *   create source → validate → create/start session → wait searchable →
 *   text search (+ optional follow) → Range media → stop → optional reconnect.
 *
 * Usage:
 *   # MediaMTX fixture already up:
 *   docker compose -f docker-compose.live.yml up -d
 *   # Ensure .env.worker has LIVE_SOURCE_FIXTURE_URL (never commit secrets)
 *   READY_SPAWN=1 yarn live-app-path-e2e
 *
 * Env:
 *   LIVE_APP_BASE_URL=http://127.0.0.1:3010
 *   READY_SPAWN=1              # spawn `next dev` + `yarn live-worker`
 *   READY_APP_PORT=3010
 *   READY_WINDOWS=3            # searchable windows before search (default 2)
 *   READY_APP_TIMEOUT_MS=300000
 *   READY_SKIP_RECONNECT=1     # skip stop/create reconnect leg
 *   LIVE_SOURCE_REF=LIVE_SOURCE_FIXTURE_URL
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadDotenv } from './load-dotenv';
import { collectWorktreeIdentity } from './worktree-identity';

loadDotenv();

type GateStatus = 'PASS' | 'FAIL' | 'NOT RUN' | 'PASS_WITH_NOTES';

type GateRow = {
  gate: string;
  status: GateStatus;
  evidence: string;
  notes?: string;
};

const children: ChildProcess[] = [];

/** Gates that must be exactly PASS for report.ok (completion A-07). */
const MANDATORY_APP_GATES = [
  'App API reachable',
  'Create source',
  'Source validation (pending→ready)',
  'Create session',
  'Start session',
  'Capture → searchable',
  'Live text search + follow handle',
  'Playback HTTP Range',
  'Stop session',
  'Session terminal after stop',
  'Reconnect (new session after stop)',
] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function envFlag(name: string): boolean {
  const v = (process.env[name] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

async function fetchJson(
  base: string,
  pathname: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const res = await fetch(`${base}${pathname}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // keep text
  }
  return { status: res.status, body, headers: res.headers };
}

function ensureWorkerEnv(): void {
  const workerEnvPath = path.join(process.cwd(), '.env.worker');
  if (fs.existsSync(workerEnvPath)) return;
  const example = path.join(process.cwd(), '.env.worker.example');
  const fixture =
    'LIVE_SOURCE_FIXTURE_URL={"url":"rtsp://127.0.0.1:8554/fixture"}\n';
  if (fs.existsSync(example)) {
    fs.copyFileSync(example, workerEnvPath);
  }
  fs.appendFileSync(workerEnvPath, `\n${fixture}`);
  console.error(
    JSON.stringify({
      stage: 'ensure_worker_env',
      created: workerEnvPath,
      note: 'local only — do not commit .env.worker',
    }),
  );
}

async function waitForLiveApi(
  base: string,
  timeoutMs: number,
): Promise<{ ok: boolean; lastStatus: number | null; lastBody: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus: number | null = null;
  let lastBody = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/live/sources`);
      lastStatus = res.status;
      lastBody = (await res.text()).slice(0, 300);
      if (res.status === 200) return { ok: true, lastStatus, lastBody };
    } catch (err) {
      lastBody = err instanceof Error ? err.message : String(err);
    }
    await sleep(1000);
  }
  return { ok: false, lastStatus, lastBody };
}

function spawnLogged(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  label: string,
): ChildProcess {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (buf: Buffer) => {
    process.stderr.write(`[${label}] ${buf.toString()}`);
  });
  child.stderr?.on('data', (buf: Buffer) => {
    process.stderr.write(`[${label}] ${buf.toString()}`);
  });
  children.push(child);
  return child;
}

/** Web must not inherit LIVE_SOURCE_* (assertWebEnvHasNoLiveSourceSecrets). */
function webSpawnEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('LIVE_SOURCE_')) delete env[key];
  }
  // Avoid Watchpack EMFILE under low soft FD limits / leftover watchers.
  env.WATCHPACK_POLLING = env.WATCHPACK_POLLING ?? 'true';
  env.CHOKIDAR_USEPOLLING = env.CHOKIDAR_USEPOLLING ?? 'true';
  env.CHOKIDAR_INTERVAL = env.CHOKIDAR_INTERVAL ?? '1000';
  return env;
}

function killChildren(): void {
  for (const child of children.splice(0)) {
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
}

async function waitSourceReady(
  base: string,
  sourceId: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { status, body } = await fetchJson(base, `/api/live/sources/${sourceId}`);
    if (status === 200 && body && typeof body === 'object') {
      const source = (body as { source?: Record<string, unknown> }).source;
      if (source?.validation_state === 'ready') return source;
      if (source?.validation_state === 'invalid') {
        throw new Error(
          `source invalid: ${JSON.stringify(source.validation_error ?? source)}`,
        );
      }
    }
    await sleep(1500);
  }
  throw new Error(`timeout waiting for source ${sourceId} ready`);
}

async function waitSessionSearchable(
  base: string,
  sessionId: string,
  minWindows: number,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let last: Record<string, unknown> = {};
  while (Date.now() < deadline) {
    const { status, body } = await fetchJson(
      base,
      `/api/live/sessions/${sessionId}`,
    );
    if (status === 200 && body && typeof body === 'object') {
      const session =
        (body as { session?: Record<string, unknown> }).session ??
        (body as Record<string, unknown>);
      last = session;
      // publicSessionSummary exposes counters under `windows`, not nested `health`.
      const windows = (session.windows ?? {}) as Record<string, unknown>;
      const searchable = Number(
        windows.searchable ??
          (session.health as { windows_searchable?: number } | undefined)
            ?.windows_searchable ??
          0,
      );
      const observed = String(session.observed_state ?? '');
      if (searchable >= minWindows && (observed === 'live' || observed === 'degraded')) {
        return session;
      }
      if (observed === 'failed') {
        throw new Error(`session failed: ${JSON.stringify(session.current_error ?? session)}`);
      }
    }
    await sleep(2000);
  }
  throw new Error(
    `timeout waiting for ${minWindows} searchable windows; last=${JSON.stringify(last)}`,
  );
}

async function main(): Promise<void> {
  // macOS default soft FD limit can be 256 — next/watchpack then hits EMFILE.
  // Re-exec once under a raised ulimit when the current soft limit is too low.
  if (
    process.env.READY_FD_RAISED !== '1' &&
    process.platform !== 'win32'
  ) {
    const lim = spawnSync('bash', ['-c', 'ulimit -n'], { encoding: 'utf8' });
    const soft = Number((lim.stdout ?? '').trim());
    if (Number.isFinite(soft) && soft > 0 && soft < 4096) {
      console.error(
        JSON.stringify({
          stage: 'raise_fd_limit',
          soft_before: soft,
          target: 65536,
        }),
      );
      const result = spawnSync(
        'bash',
        [
          '-c',
          'ulimit -n 65536 2>/dev/null || ulimit -n 10240; exec "$0" "$@"',
          process.execPath,
          ...process.execArgv,
          ...process.argv.slice(1),
        ],
        {
          env: { ...process.env, READY_FD_RAISED: '1' },
          stdio: 'inherit',
        },
      );
      process.exit(result.status ?? 1);
    }
  }

  const runId = `appe2e${Date.now().toString(36)}`;
  const startedAt = new Date().toISOString();
  const worktree = collectWorktreeIdentity();
  const gates: GateRow[] = [];
  const port = Number(process.env.READY_APP_PORT ?? '3010') || 3010;
  const base =
    process.env.LIVE_APP_BASE_URL?.trim() || `http://127.0.0.1:${port}`;
  const sourceRef =
    process.env.LIVE_SOURCE_REF?.trim() || 'LIVE_SOURCE_FIXTURE_URL';
  const minWindows = Math.max(1, Number(process.env.READY_WINDOWS ?? '2') || 2);
  const timeoutMs = Math.max(
    60_000,
    Number(process.env.READY_APP_TIMEOUT_MS ?? '300000') || 300_000,
  );
  const spawnProcs = envFlag('READY_SPAWN');
  const skipReconnect = envFlag('READY_SKIP_RECONNECT');

  ensureWorkerEnv();
  // Do NOT loadWorkerDotenv() into this process — spawning web would inherit
  // LIVE_SOURCE_* and trip assertWebEnvHasNoLiveSourceSecrets (400).
  // Worker entrypoint loads `.env` + `.env.worker` itself.

  const report: Record<string, unknown> = {
    runId,
    started_at: startedAt,
    evidence_class: 'application_path',
    base_url: base,
    spawn: spawnProcs,
    git: {
      commit: worktree.commit,
      branch: worktree.branch,
      dirty: worktree.dirty,
      content_hash: worktree.content_hash,
    },
    gates: [] as GateRow[],
  };

  const createdSessionIds: string[] = [];
  let createdSourceId: string | null = null;

  async function cleanupCreatedResources(): Promise<void> {
    for (const sid of [...createdSessionIds].reverse()) {
      try {
        await fetchJson(base, `/api/live/sessions/${sid}/stop`, {
          method: 'POST',
          body: '{}',
        });
      } catch {
        // best-effort
      }
    }
    if (createdSourceId) {
      try {
        await fetchJson(base, `/api/live/sources/${createdSourceId}`, {
          method: 'PATCH',
          body: JSON.stringify({ enabled: false }),
        });
      } catch {
        // best-effort
      }
    }
  }

  process.on('exit', killChildren);
  process.on('SIGINT', () => {
    killChildren();
    process.exit(130);
  });

  try {
    if (spawnProcs) {
      console.error(JSON.stringify({ stage: 'spawn_web', port }));
      // Prefer production server only when a complete build exists.
      const hasBuild = fs.existsSync(
        path.join(process.cwd(), '.next', 'BUILD_ID'),
      );
      if (hasBuild) {
        spawnLogged(
          'node',
          [
            path.join(
              process.cwd(),
              'node_modules/next/dist/bin/next',
            ),
            'start',
            '-p',
            String(port),
          ],
          { ...webSpawnEnv(), PORT: String(port) },
          'web',
        );
      } else {
        spawnLogged(
          'node',
          [
            path.join(
              process.cwd(),
              'node_modules/next/dist/bin/next',
            ),
            'dev',
            '-p',
            String(port),
          ],
          { ...webSpawnEnv(), PORT: String(port) },
          'web',
        );
      }
      console.error(JSON.stringify({ stage: 'spawn_worker' }));
      // Use node --import tsx (not yarn/tsx CLI) to avoid tsx IPC pipe EPERM
      // under restricted sandboxes.
      spawnLogged(
        'node',
        ['--import', 'tsx', 'worker/live-worker.ts'],
        { ...process.env },
        'worker',
      );
    }

    const api = await waitForLiveApi(base, spawnProcs ? 120_000 : 15_000);
    gates.push({
      gate: 'App API reachable',
      status: api.ok ? 'PASS' : 'FAIL',
      evidence: `GET ${base}/api/live/sources → ${api.lastStatus ?? 'timeout'} ${api.lastBody.slice(0, 120)}`,
      notes: api.ok
        ? undefined
        : spawnProcs
          ? 'spawned next/worker but live routes never answered 200'
          : 'Set READY_SPAWN=1 or point LIVE_APP_BASE_URL at a live-capable web',
    });
    if (!api.ok) throw new Error('live API not reachable');

    // --- Create source ---
    const createSrc = await fetchJson(base, '/api/live/sources', {
      method: 'POST',
      body: JSON.stringify({
        name: `app-e2e-${runId}`,
        protocol: 'rtsp',
        connection_ref: sourceRef,
        transport: 'tcp',
        enabled: true,
      }),
    });
    const sourceId = (
      createSrc.body as { source?: { source_id?: string } }
    )?.source?.source_id;
    gates.push({
      gate: 'Create source',
      status:
        createSrc.status === 201 && sourceId ? 'PASS' : 'FAIL',
      evidence: `POST /api/live/sources → ${createSrc.status} id=${sourceId ?? 'n/a'}`,
    });
    if (!sourceId) throw new Error('create source failed');
    createdSourceId = sourceId;

    const readySource = await waitSourceReady(base, sourceId, timeoutMs);
    gates.push({
      gate: 'Source validation (pending→ready)',
      status: readySource.validation_state === 'ready' ? 'PASS' : 'FAIL',
      evidence: `validation_state=${readySource.validation_state} host=${readySource.allowed_host}:${readySource.allowed_port}`,
    });

    // --- Create + start session ---
    const idem = `appe2e-${runId}`;
    const createSess = await fetchJson(base, '/api/live/sessions', {
      method: 'POST',
      body: JSON.stringify({
        source_id: sourceId,
        idempotency_key: idem,
        window: { fragment_ms: 2000, window_ms: 8000, overlap_ms: 2000 },
      }),
    });
    const session = (createSess.body as { session?: Record<string, unknown> })
      ?.session;
    const sessionId = session?.session_id as string | undefined;
    const variantId = session?.variant_id as string | undefined;
    gates.push({
      gate: 'Create session',
      status:
        (createSess.status === 202 || createSess.status === 201) && sessionId
          ? 'PASS'
          : 'FAIL',
      evidence: `POST /api/live/sessions → ${createSess.status} id=${sessionId ?? 'n/a'}`,
      notes:
        typeof createSess.body === 'object'
          ? JSON.stringify(createSess.body).slice(0, 400)
          : undefined,
    });
    if (!sessionId || !variantId) throw new Error('create session failed');
    createdSessionIds.push(sessionId);

    const startRes = await fetchJson(
      base,
      `/api/live/sessions/${sessionId}/start`,
      { method: 'POST', body: '{}' },
    );
    gates.push({
      gate: 'Start session',
      status:
        startRes.status === 202 || startRes.status === 200 ? 'PASS' : 'FAIL',
      evidence: `POST .../start → ${startRes.status}`,
    });

    const liveSession = await waitSessionSearchable(
      base,
      sessionId,
      minWindows,
      timeoutMs,
    );
    gates.push({
      gate: 'Capture → searchable',
      status: 'PASS',
      evidence: `observed=${liveSession.observed_state} windows_searchable=${(liveSession.windows as { searchable?: number } | undefined)?.searchable ?? (liveSession.health as { windows_searchable?: number } | undefined)?.windows_searchable}`,
    });

    // --- Search ---
    const searchStarted = performance.now();
    const searchRes = await fetchJson(base, '/api/live/search', {
      method: 'POST',
      body: JSON.stringify({
        query: 'person walking',
        session_ids: [sessionId],
        variant_id: variantId,
        follow: true,
        size: 10,
      }),
    });
    const searchBody = (searchRes.body ?? {}) as {
      hits?: Array<{ chunk_id?: string }> | null;
      query_id?: string;
      error?: unknown;
    };
    const hits = Array.isArray(searchBody.hits) ? searchBody.hits : [];
    const queryId = searchBody.query_id;
    const searchMs = Math.round(performance.now() - searchStarted);
    gates.push({
      gate: 'Live text search + follow handle',
      status:
        searchRes.status === 200 && hits.length > 0 && queryId
          ? 'PASS'
          : searchRes.status === 200 && queryId
            ? 'PASS_WITH_NOTES'
            : 'FAIL',
      evidence: `status=${searchRes.status} hits=${hits.length} query_id=${queryId ?? 'n/a'} ms=${searchMs}`,
      notes:
        searchRes.status !== 200
          ? JSON.stringify(searchBody).slice(0, 400)
          : undefined,
    });
    if (searchRes.status !== 200) {
      throw new Error(
        `live search failed: status=${searchRes.status} body=${JSON.stringify(searchBody).slice(0, 400)}`,
      );
    }

    // --- Playback Range via media route ---
    const chunkId = hits[0]?.chunk_id;
    let playbackOk = false;
    let rangeStatus = 0;
    if (chunkId) {
      const mediaUrl = `${base}/api/live/chunks/${encodeURIComponent(chunkId)}/media`;
      const res = await fetch(mediaUrl, {
        headers: { Range: 'bytes=0-3' },
      });
      rangeStatus = res.status;
      const buf = Buffer.from(await res.arrayBuffer());
      playbackOk =
        res.status === 206 &&
        buf.length > 0 &&
        (res.headers.get('content-range') ?? '')
          .toLowerCase()
          .startsWith('bytes 0-');
    }
    gates.push({
      gate: 'Playback HTTP Range',
      status: playbackOk ? 'PASS' : 'FAIL',
      evidence: `GET /api/live/chunks/.../media Range → ${rangeStatus} chunk=${chunkId ?? 'n/a'}`,
    });

    // --- Stop ---
    const stopRes = await fetchJson(
      base,
      `/api/live/sessions/${sessionId}/stop`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    gates.push({
      gate: 'Stop session',
      status:
        stopRes.status === 202 || stopRes.status === 200 ? 'PASS' : 'FAIL',
      evidence: `POST .../stop → ${stopRes.status}`,
    });

    // Wait terminal
    const stopDeadline = Date.now() + 60_000;
    let terminal = false;
    while (Date.now() < stopDeadline) {
      const { body } = await fetchJson(base, `/api/live/sessions/${sessionId}`);
      const sess =
        (body as { session?: { observed_state?: string } })?.session ??
        (body as { observed_state?: string });
      const obs = sess?.observed_state;
      if (obs === 'stopped' || obs === 'failed') {
        terminal = true;
        break;
      }
      await sleep(1500);
    }
    gates.push({
      gate: 'Session terminal after stop',
      status: terminal ? 'PASS' : 'FAIL',
      evidence: `terminal=${terminal}`,
    });

    // --- Reconnect leg: new session on same source ---
    if (!skipReconnect) {
      const idem2 = `appe2e-re-${runId}`;
      const create2 = await fetchJson(base, '/api/live/sessions', {
        method: 'POST',
        body: JSON.stringify({
          source_id: sourceId,
          idempotency_key: idem2,
          force_new: true,
        }),
      });
      const sess2 = (create2.body as { session?: { session_id?: string } })
        ?.session;
      const sessionId2 = sess2?.session_id;
      if (sessionId2) {
        createdSessionIds.push(sessionId2);
        await fetchJson(base, `/api/live/sessions/${sessionId2}/start`, {
          method: 'POST',
          body: '{}',
        });
        try {
          const live2 = await waitSessionSearchable(
            base,
            sessionId2,
            1,
            Math.min(timeoutMs, 180_000),
          );
          gates.push({
            gate: 'Reconnect (new session after stop)',
            status: 'PASS',
            evidence: `session2=${sessionId2} observed=${live2.observed_state}`,
          });
          await fetchJson(base, `/api/live/sessions/${sessionId2}/stop`, {
            method: 'POST',
            body: '{}',
          });
        } catch (err) {
          gates.push({
            gate: 'Reconnect (new session after stop)',
            status: 'FAIL',
            evidence: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        gates.push({
          gate: 'Reconnect (new session after stop)',
          status: 'FAIL',
          evidence: `POST sessions → ${create2.status} body=${JSON.stringify(create2.body).slice(0, 300)}`,
          notes:
            create2.status === 409
              ? 'Replacement pending — prior session may still be draining'
              : undefined,
        });
      }
    } else {
      gates.push({
        gate: 'Reconnect (new session after stop)',
        status: 'NOT RUN',
        evidence: 'READY_SKIP_RECONNECT=1',
      });
    }

    report.source_id = sourceId;
    report.session_id = sessionId;
    report.variant_id = variantId;
    report.chunk_id = chunkId;
    report.query_id = queryId;
  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err);
    if (!gates.some((g) => g.status === 'FAIL')) {
      gates.push({
        gate: 'Application path',
        status: 'FAIL',
        evidence: String(report.error),
      });
    }
  } finally {
    await cleanupCreatedResources();
    report.cleanup = {
      sessions_stopped: createdSessionIds,
      source_disabled: createdSourceId,
    };
    killChildren();
  }

  report.gates = gates;
  report.finished_at = new Date().toISOString();
  const mandatory = MANDATORY_APP_GATES.filter(
    (name) =>
      !(skipReconnect && name === 'Reconnect (new session after stop)'),
  );
  const missingMandatory = mandatory.filter((name) => {
    const row = gates.find((g) => g.gate === name);
    return !row || row.status !== 'PASS';
  });
  const hardFail =
    gates.some((g) => g.status === 'FAIL') || missingMandatory.length > 0;
  report.ok = !hardFail;
  report.mandatory_gates = mandatory;
  report.missing_mandatory = missingMandatory;

  const outJson = path.join('reviews', `live-app-path-e2e-${runId}.json`);
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        evidence_class: 'application_path',
        report: outJson,
        gates,
      },
      null,
      2,
    ),
  );
  if (hardFail) process.exit(1);
}

main().catch((err: unknown) => {
  killChildren();
  console.error(
    JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exit(1);
});

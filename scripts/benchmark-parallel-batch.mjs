#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const args = parseArgs(process.argv.slice(2));
const baseUrl = stripTrailingSlash(args.base || process.env.TTB_BENCHMARK_BASE_URL || "http://127.0.0.1:8010");
const count = positiveInt(args.count || process.env.TTB_PARALLEL_BENCHMARK_COUNT, 6);
const parallelConcurrency = positiveInt(args.parallelConcurrency || process.env.TTB_PARALLEL_BENCHMARK_CONCURRENCY, 2);
const timeoutMs = positiveInt(args.timeoutMs || process.env.TTB_BENCHMARK_TIMEOUT_MS, 90_000);
const pollMs = positiveInt(args.pollMs || process.env.TTB_BENCHMARK_POLL_MS, 300);

const output = {
  createdAt: new Date().toISOString(),
  baseUrl,
  count,
  parallelConcurrency,
  notes: [
    "Runs sequential and bounded-parallel backend reviews against isolated benchmark sessions.",
    "Compares field statuses for the same application ids to catch accuracy regressions.",
    "Samples NVIDIA GPU memory through nvidia-smi when available."
  ],
  health: null,
  workers: [],
  gpu: {
    available: false,
    maxMemoryUsedMiB: null,
    maxUtilizationPercent: null,
    samples: []
  },
  runs: [],
  comparison: null
};

try {
  output.health = await publicRequest("/api/health");
  const admin = await login("admin", `console-parallel-benchmark-admin-${Date.now()}`);
  try {
    output.workers = await authedRequest("/api/workers", admin);
  } catch (error) {
    output.workersError = error.message;
  }

  const selected = await selectApplications(count);
  const sequential = await runReviewSet("Sequential baseline", selected, 1, "sequential");
  const parallel = await runReviewSet(`Parallel batch x${parallelConcurrency}`, selected, parallelConcurrency, "parallel");

  output.runs.push(sequential.summary, parallel.summary);
  output.comparison = compareRuns(sequential.samples, parallel.samples, sequential.summary, parallel.summary);
  finalizeGpuSummary();
  printOutput(output);
  if (output.comparison.incompleteReviewCount || output.comparison.fieldStatusMismatchCount) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}

async function selectApplications(limit) {
  const sessionId = `console-parallel-select-${Date.now()}`;
  const reviewer = await login("reviewer", sessionId);
  const applications = await authedRequest("/api/applications", reviewer);
  const selected = applications
    .filter((application) => application.status === "SUBMITTED" && application.assetCount > 0)
    .slice(0, limit);
  if (selected.length < limit) {
    throw new Error(`Only ${selected.length} submitted applications with assets were available; requested ${limit}.`);
  }
  return selected;
}

async function runReviewSet(name, selected, concurrency, suffix) {
  const sessionId = `console-parallel-benchmark-${suffix}-${Date.now()}`;
  const reviewer = await login("reviewer", sessionId);
  await authedRequest("/api/applications", reviewer);
  const started = performance.now();
  const samples = await mapWithConcurrency(selected, concurrency, (application) => runReview(application, reviewer));
  const wallMs = Math.round(performance.now() - started);
  return { samples, summary: summarizeRun(name, sessionId, samples, wallMs, concurrency) };
}

async function runReview(application, auth) {
  const started = performance.now();
  const review = await authedRequest(`/api/applications/${encodeURIComponent(application.id)}/review`, auth, {
    method: "POST",
    body: JSON.stringify({
      mode: "backend",
      priority: 100,
      ocrStrategy: "paddleocr_authoritative",
      primaryEngine: "paddleocr",
      targetLatencyMs: 5000,
      forceFreshOcr: true
    })
  });
  let latest = review;
  const pollStarted = performance.now();
  while (performance.now() - pollStarted < timeoutMs) {
    await sampleGpu();
    await sleep(pollMs);
    latest = await authedRequest(`/api/reviews/${encodeURIComponent(review.id)}`, auth);
    if (latest?.result) break;
    const status = String(latest?.runStatus || latest?.status || "").toLowerCase();
    if (["failed", "cancelled", "canceled"].includes(status)) break;
  }
  const wallMs = Math.round(performance.now() - started);
  const result = latest?.result || {};
  const fields = Array.isArray(result.fields) ? result.fields : [];
  const engines = Array.isArray(result.enginesUsed) ? result.enginesUsed : [];
  const workers = Array.isArray(result.workersUsed) ? result.workersUsed : [];
  return {
    applicationId: application.id,
    applicationNumber: application.metadata?.applicationNumber || null,
    title: application.metadata?.title || application.expectedFields?.brandName || application.id,
    completed: Boolean(latest?.result),
    status: latest?.status || null,
    runStatus: latest?.runStatus || null,
    wallMs,
    backendTimingMs: result.timings?.totalMs ?? null,
    ocrMs: result.timings?.ocrMs ?? null,
    validationMs: result.timings?.validationMs ?? null,
    fieldsEvaluated: fields.length,
    evidenceCropsGenerated: fields.reduce((count, field) => {
      const evidence = Array.isArray(field.evidence) ? field.evidence : [];
      return count + evidence.filter((item) => item && item.bbox).length;
    }, 0),
    fieldStatuses: Object.fromEntries(fields.map((field) => [field.field || field.key || field.fieldKey, field.reviewerStatus || field.status])),
    engineIds: engines.map((engine) => engine.engineId || engine.id).filter(Boolean),
    workerIds: workers.map((worker) => worker.workerId || worker.id).filter(Boolean),
    browserFallbackUsed:
      String(result.mode || latest?.mode || "").toLowerCase() === "browser" ||
      engines.some((engine) => /tesseract|browser/i.test(String(engine.engineId || engine.id || "")))
  };
}

async function mapWithConcurrency(values, concurrency, worker) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function runSlot() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, values.length)) }, runSlot));
  return results;
}

function summarizeRun(name, sessionId, samples, totalWallMs, concurrency) {
  const completed = samples.filter((sample) => sample.completed);
  const wallTimes = completed.map((sample) => sample.wallMs).sort((a, b) => a - b);
  const backendTimes = completed
    .map((sample) => sample.backendTimingMs)
    .filter((value) => typeof value === "number")
    .sort((a, b) => a - b);
  const engineIds = unique(samples.flatMap((sample) => sample.engineIds));
  const workerIds = unique(samples.flatMap((sample) => sample.workerIds));
  return {
    name,
    sessionId,
    applications: samples.length,
    completed: completed.length,
    concurrency,
    totalWallTimeSec: seconds(totalWallMs),
    medianReviewTimeSec: seconds(percentile(wallTimes, 0.5)),
    p95ReviewTimeSec: seconds(percentile(wallTimes, 0.95)),
    maxReviewTimeSec: seconds(wallTimes.at(-1) || 0),
    medianBackendProcessingSec: seconds(percentile(backendTimes, 0.5)),
    p95BackendProcessingSec: seconds(percentile(backendTimes, 0.95)),
    browserFallbackRequestCount: samples.filter((sample) => sample.browserFallbackUsed).length,
    fieldsEvaluated: samples.reduce((sum, sample) => sum + sample.fieldsEvaluated, 0),
    evidenceCropsGenerated: samples.reduce((sum, sample) => sum + sample.evidenceCropsGenerated, 0),
    engineIds,
    workerIds,
    samples
  };
}

function compareRuns(sequential, parallel, sequentialSummary, parallelSummary) {
  const sequentialById = new Map(sequential.map((sample) => [sample.applicationId, sample]));
  const mismatches = [];
  const incomplete = [];
  for (const sample of [...sequential, ...parallel]) {
    if (!sample.completed) {
      incomplete.push({
        applicationId: sample.applicationId,
        title: sample.title,
        runStatus: sample.runStatus || sample.status || "unknown"
      });
    }
  }
  for (const parallelSample of parallel) {
    const sequentialSample = sequentialById.get(parallelSample.applicationId);
    if (!sequentialSample) continue;
    const fieldKeys = unique([...Object.keys(sequentialSample.fieldStatuses), ...Object.keys(parallelSample.fieldStatuses)]);
    for (const fieldKey of fieldKeys) {
      if (sequentialSample.fieldStatuses[fieldKey] !== parallelSample.fieldStatuses[fieldKey]) {
        mismatches.push({
          applicationId: parallelSample.applicationId,
          title: parallelSample.title,
          fieldKey,
          sequential: sequentialSample.fieldStatuses[fieldKey] || null,
          parallel: parallelSample.fieldStatuses[fieldKey] || null
        });
      }
    }
  }
  const speedup = parallelSummary.totalWallTimeSec ? sequentialSummary.totalWallTimeSec / parallelSummary.totalWallTimeSec : 0;
  return {
    speedup: Math.round(speedup * 100) / 100,
    totalWallTimeDeltaSec: Math.round((sequentialSummary.totalWallTimeSec - parallelSummary.totalWallTimeSec) * 100) / 100,
    incompleteReviewCount: incomplete.length,
    incomplete,
    fieldStatusMismatchCount: mismatches.length,
    mismatches
  };
}

async function sampleGpu() {
  try {
    const { stdout } = await execFileAsync("nvidia-smi", [
      "--query-gpu=memory.used,memory.total,utilization.gpu",
      "--format=csv,noheader,nounits"
    ]);
    const [used, total, utilization] = stdout.trim().split(/\s*,\s*/).map((value) => Number.parseInt(value, 10));
    if (Number.isFinite(used)) {
      output.gpu.available = true;
      output.gpu.samples.push({ usedMiB: used, totalMiB: total, utilizationPercent: utilization, at: new Date().toISOString() });
    }
  } catch {
    output.gpu.available = false;
  }
}

function finalizeGpuSummary() {
  if (!output.gpu.samples.length) return;
  output.gpu.maxMemoryUsedMiB = Math.max(...output.gpu.samples.map((sample) => sample.usedMiB));
  output.gpu.maxUtilizationPercent = Math.max(...output.gpu.samples.map((sample) => sample.utilizationPercent));
  output.gpu.samples = output.gpu.samples.slice(-20);
}

async function login(role, sessionId) {
  const payload = await request("/api/auth/demo-login", {
    sessionId,
    method: "POST",
    body: JSON.stringify({ role })
  });
  return { role, sessionId, token: payload.token };
}

async function publicRequest(path) {
  return request(path, { sessionId: "console-parallel-benchmark-public" });
}

async function authedRequest(path, auth, init = {}) {
  return request(path, {
    ...init,
    sessionId: auth.sessionId,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      ...(init.headers || {})
    }
  });
}

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Session-Id": init.sessionId,
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${path} returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const index = Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1);
  return values[index];
}

function seconds(ms) {
  return Math.round((ms / 1000) * 100) / 100;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "1";
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function positiveInt(value, fallback) {
  const number = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function printOutput(data) {
  console.log(JSON.stringify(data, null, 2));
  console.log("\nMarkdown summary:\n");
  console.log("| Run | Apps | Completed | Concurrency | Total wall time | Median/app | p95/app | Max/app | Backend OCR path | Browser fallback | Fields | Evidence crops |");
  console.log("|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|");
  for (const run of data.runs) {
    console.log(
      `| ${run.name} | ${run.applications} | ${run.completed} | ${run.concurrency} | ${run.totalWallTimeSec.toFixed(2)} sec | ${run.medianReviewTimeSec.toFixed(2)} sec | ${run.p95ReviewTimeSec.toFixed(2)} sec | ${run.maxReviewTimeSec.toFixed(2)} sec | ${run.engineIds.join(", ") || "n/a"} / ${run.workerIds.join(", ") || "n/a"} | ${run.browserFallbackRequestCount} | ${run.fieldsEvaluated} | ${run.evidenceCropsGenerated} |`
    );
  }
  if (data.comparison) {
    console.log(
      `\nParallel speedup: ${data.comparison.speedup.toFixed(2)}x (${data.comparison.totalWallTimeDeltaSec.toFixed(2)} sec saved). Incomplete reviews: ${data.comparison.incompleteReviewCount}. Field status mismatches: ${data.comparison.fieldStatusMismatchCount}.`
    );
  }
  if (data.gpu.available) {
    console.log(`GPU peak during benchmark: ${data.gpu.maxMemoryUsedMiB} MiB used, ${data.gpu.maxUtilizationPercent}% utilization.`);
  }
}

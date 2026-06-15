#!/usr/bin/env node

const DEFAULT_BASE_URL = "https://demo.sherpa-map.com";

const args = parseArgs(process.argv.slice(2));
const baseUrl = stripTrailingSlash(args.base || process.env.TTB_BENCHMARK_BASE_URL || DEFAULT_BASE_URL);
const singleCount = positiveInt(args.singleCount || process.env.TTB_BENCHMARK_SINGLE_COUNT, 5);
const batchCount = positiveInt(args.batchCount || process.env.TTB_BENCHMARK_BATCH_COUNT, 5);
const timeoutMs = positiveInt(args.timeoutMs || process.env.TTB_BENCHMARK_TIMEOUT_MS, 45000);
const pollMs = positiveInt(args.pollMs || process.env.TTB_BENCHMARK_POLL_MS, 250);

const createdAt = new Date().toISOString();

const output = {
  createdAt,
  baseUrl,
  benchmarkType: "hosted reviewer automation",
  notes: [
    "Uses isolated console-* sessions so no destructive reset is required.",
    "Measures API wall-clock time from backend review POST until stored review result is returned.",
    "Browser fallback count is derived from engine/mode results; this script intentionally exercises backend mode."
  ],
  health: null,
  workers: [],
  runs: []
};

try {
  output.health = await publicRequest("/api/health");
  const admin = await login("admin", `console-benchmark-admin-${Date.now()}`);
  try {
    output.workers = await authedRequest("/api/workers", admin);
  } catch (error) {
    output.workersError = error.message;
  }

  if (singleCount > 0) {
    output.runs.push(await runSequentialReviewSet("Single reviewer automation", singleCount, "single"));
  }
  if (batchCount > 0) {
    output.runs.push(await runSequentialReviewSet("Batch review workflow", batchCount, "batch"));
  }
  printOutput(output);
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}

async function runSequentialReviewSet(name, count, suffix) {
  const sessionId = `console-benchmark-${suffix}-${Date.now()}`;
  const reviewer = await login("reviewer", sessionId);
  const applications = await authedRequest("/api/applications", reviewer);
  const selected = applications
    .filter((application) => application.status === "SUBMITTED" && application.assetCount > 0)
    .slice(0, count);
  if (!selected.length) throw new Error(`No submitted applications available for ${name}.`);

  const samples = [];
  for (const application of selected) {
    samples.push(await runReview(application, reviewer));
  }
  return summarizeRun(name, sessionId, samples);
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
    await sleep(pollMs);
    latest = await authedRequest(`/api/reviews/${encodeURIComponent(review.id)}`, auth);
    if (latest?.result) break;
    const status = String(latest?.runStatus || latest?.status || "").toLowerCase();
    if (["failed", "cancelled", "canceled"].includes(status)) break;
  }
  const wallMs = performance.now() - started;
  const result = latest?.result || {};
  const fields = Array.isArray(result.fields) ? result.fields : [];
  const engines = Array.isArray(result.enginesUsed) ? result.enginesUsed : [];
  const workers = Array.isArray(result.workersUsed) ? result.workersUsed : [];
  return {
    applicationId: application.id,
    applicationNumber: application.metadata?.applicationNumber || null,
    title: application.metadata?.title || application.expectedFields?.brandName || application.id,
    status: latest?.status || null,
    runStatus: latest?.runStatus || null,
    completed: Boolean(latest?.result),
    wallMs: Math.round(wallMs),
    backendTimingMs: result.timings?.totalMs ?? null,
    ocrMs: result.timings?.ocrMs ?? null,
    validationMs: result.timings?.validationMs ?? null,
    fieldsEvaluated: fields.length,
    evidenceCropsGenerated: fields.reduce((count, field) => {
      const evidence = Array.isArray(field.evidence) ? field.evidence : [];
      return count + evidence.filter((item) => item && item.bbox).length;
    }, 0),
    engineIds: engines.map((engine) => engine.engineId || engine.id).filter(Boolean),
    workerIds: workers.map((worker) => worker.workerId || worker.id).filter(Boolean),
    fieldExtractor: result.fieldExtractor || null,
    browserFallbackUsed: String(result.mode || latest?.mode || "").toLowerCase() === "browser" || engines.some((engine) => /tesseract|browser/i.test(String(engine.engineId || engine.id || "")))
  };
}

function summarizeRun(name, sessionId, samples) {
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
    backendReviewPostCount: samples.length,
    browserFallbackRequestCount: samples.filter((sample) => sample.browserFallbackUsed).length,
    medianReviewTimeSec: seconds(percentile(wallTimes, 0.5)),
    p95ReviewTimeSec: seconds(percentile(wallTimes, 0.95)),
    maxReviewTimeSec: seconds(wallTimes.at(-1) || 0),
    medianBackendProcessingSec: seconds(percentile(backendTimes, 0.5)),
    p95BackendProcessingSec: seconds(percentile(backendTimes, 0.95)),
    fieldsEvaluated: samples.reduce((sum, sample) => sum + sample.fieldsEvaluated, 0),
    evidenceCropsGenerated: samples.reduce((sum, sample) => sum + sample.evidenceCropsGenerated, 0),
    engineIds,
    workerIds,
    samples
  };
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
  return request(path, { sessionId: "console-benchmark-public" });
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
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function printOutput(data) {
  console.log(JSON.stringify(data, null, 2));
  console.log("\nMarkdown summary:\n");
  console.log("| Run mode | Applications | Median review time | p95 review time | Max review time | Backend OCR path | Browser fallback | Fields | Evidence crops |");
  console.log("|---|---:|---:|---:|---:|---|---:|---:|---:|");
  for (const run of data.runs) {
    console.log(
      `| ${run.name} | ${run.applications} | ${run.medianReviewTimeSec.toFixed(2)} sec | ${run.p95ReviewTimeSec.toFixed(2)} sec | ${run.maxReviewTimeSec.toFixed(2)} sec | ${run.engineIds.join(", ") || "n/a"} / ${run.workerIds.join(", ") || "n/a"} | ${run.browserFallbackRequestCount} | ${run.fieldsEvaluated} | ${run.evidenceCropsGenerated} |`
    );
  }
}

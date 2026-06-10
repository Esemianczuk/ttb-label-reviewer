const DEFAULT_TASK_TIMEOUT_MS = 120000;
const MAX_BROWSER_OCR_WORKERS = 3;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function browserCoreCount() {
  return globalThis.navigator?.hardwareConcurrency || 2;
}

export function getRecommendedBrowserOcrWorkerCount(taskCount = 1, { override = 'auto', hardwareConcurrency = browserCoreCount() } = {}) {
  const numericOverride = Number.parseInt(override, 10);
  if (Number.isFinite(numericOverride) && numericOverride > 0) {
    return clamp(numericOverride, 1, Math.min(MAX_BROWSER_OCR_WORKERS, Math.max(1, taskCount)));
  }
  if (taskCount <= 1) return 1;
  const cores = Number.isFinite(hardwareConcurrency) ? hardwareConcurrency : 2;
  return clamp(Math.floor(cores / 2), 1, Math.min(MAX_BROWSER_OCR_WORKERS, taskCount));
}

function createDefaultWorker() {
  return new Worker(new URL('./browser-ocr.worker.js', import.meta.url), { type: 'module' });
}

class WorkerSlot {
  constructor(index, workerFactory) {
    this.index = index;
    this.workerFactory = workerFactory;
    this.worker = null;
  }

  getWorker() {
    if (!this.worker) this.worker = this.workerFactory(this.index);
    return this.worker;
  }

  restart() {
    this.terminate();
    this.worker = this.workerFactory(this.index);
  }

  terminate() {
    this.worker?.terminate?.();
    this.worker = null;
  }
}

function makeTaskId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class BrowserOcrWorkerPool {
  constructor({ workerFactory = createDefaultWorker, taskTimeoutMs = DEFAULT_TASK_TIMEOUT_MS } = {}) {
    this.workerFactory = workerFactory;
    this.taskTimeoutMs = taskTimeoutMs;
    this.slots = [];
    this.cancelled = false;
  }

  ensureSlots(count) {
    while (this.slots.length < count) {
      this.slots.push(new WorkerSlot(this.slots.length, this.workerFactory));
    }
    while (this.slots.length > count) {
      this.slots.pop()?.terminate();
    }
  }

  cancel() {
    this.cancelled = true;
    this.slots.forEach((slot) => slot.terminate());
  }

  terminate() {
    this.cancel();
    this.slots = [];
  }

  async run(tasks, { workerCount = 1, onTaskStatus, onTaskProgress, onTaskComplete, signal } = {}) {
    this.cancelled = false;
    const count = clamp(workerCount, 1, Math.max(1, tasks.length));
    this.ensureSlots(count);
    const results = new Array(tasks.length);
    let nextIndex = 0;

    const runLoop = async (slot) => {
      while (nextIndex < tasks.length) {
        if (this.cancelled || signal?.aborted) throw new DOMException('Browser OCR cancelled.', 'AbortError');
        const taskIndex = nextIndex;
        nextIndex += 1;
        const task = tasks[taskIndex];
        onTaskStatus?.(task, 'processing', `Processing on browser worker ${slot.index + 1}`);
        try {
          const result = await this.runTask(slot, task, {
            signal,
            onProgress: (message) => onTaskProgress?.(task, message, slot.index),
          });
          results[taskIndex] = result;
          onTaskComplete?.(task, result, slot.index);
        } catch (error) {
          slot.restart();
          throw error;
        }
      }
    };

    await Promise.all(this.slots.slice(0, count).map((slot) => runLoop(slot)));
    return results;
  }

  runTask(slot, task, { signal, onProgress } = {}) {
    const taskId = makeTaskId();
    const worker = slot.getWorker();

    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        finish(new Error(`OCR timed out after ${Math.round(this.taskTimeoutMs / 1000)} seconds.`));
      }, this.taskTimeoutMs);

      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        worker.removeEventListener?.('message', onMessage);
        worker.removeEventListener?.('error', onError);
        signal?.removeEventListener?.('abort', onAbort);
        if (error) reject(error);
        else resolve(result);
      };

      const onAbort = () => finish(new DOMException('Browser OCR cancelled.', 'AbortError'));
      const onError = (event) => finish(event?.error || new Error(event?.message || 'Browser OCR worker error.'));
      const onMessage = (event) => {
        const data = event.data || {};
        if (data.taskId !== taskId) return;
        if (data.type === 'progress') onProgress?.(data.message || 'Processing...');
        if (data.type === 'result') finish(null, data.ocrResult);
        if (data.type === 'error') finish(new Error(data.error || 'Browser OCR worker failed.'));
      };

      signal?.addEventListener?.('abort', onAbort, { once: true });
      worker.addEventListener?.('message', onMessage);
      worker.addEventListener?.('error', onError);
      worker.postMessage({ type: 'recognize', taskId, file: task.file });
    });
  }
}

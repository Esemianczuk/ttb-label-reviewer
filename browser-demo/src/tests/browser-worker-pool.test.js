import { describe, expect, it } from 'vitest';
import { BrowserOcrWorkerPool, getRecommendedBrowserOcrWorkerCount } from '../workers/browser-worker-pool.js';

class FakeWorker {
  constructor({ delayMs = 1 } = {}) {
    this.delayMs = delayMs;
    this.listeners = {
      message: new Set(),
      error: new Set(),
    };
    this.terminated = false;
  }

  addEventListener(type, listener) {
    this.listeners[type]?.add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners[type]?.delete(listener);
  }

  terminate() {
    this.terminated = true;
  }

  emit(type, data) {
    for (const listener of this.listeners[type] || []) {
      listener({ data });
    }
  }

  postMessage(message) {
    setTimeout(() => {
      if (this.terminated) return;
      this.emit('message', {
        type: 'progress',
        taskId: message.taskId,
        message: `fake progress ${message.file.name}`,
      });
      this.emit('message', {
        type: 'result',
        taskId: message.taskId,
        ocrResult: {
          engine: 'fake-worker',
          rawText: message.file.name,
          blocks: [],
          processingTimeMs: this.delayMs,
        },
      });
    }, this.delayMs);
  }
}

describe('browser OCR worker pool', () => {
  it('selects a conservative worker count from batch size and cores', () => {
    expect(getRecommendedBrowserOcrWorkerCount(1, { hardwareConcurrency: 16 })).toBe(1);
    expect(getRecommendedBrowserOcrWorkerCount(2, { hardwareConcurrency: 16 })).toBe(2);
    expect(getRecommendedBrowserOcrWorkerCount(10, { hardwareConcurrency: 16 })).toBe(3);
    expect(getRecommendedBrowserOcrWorkerCount(10, { hardwareConcurrency: 2 })).toBe(1);
    expect(getRecommendedBrowserOcrWorkerCount(10, { override: '2', hardwareConcurrency: 16 })).toBe(2);
    expect(getRecommendedBrowserOcrWorkerCount(1, { override: '3', hardwareConcurrency: 16 })).toBe(1);
  });

  it('runs queued tasks with fake workers and preserves result order', async () => {
    const progress = [];
    const completed = [];
    const pool = new BrowserOcrWorkerPool({
      workerFactory: () => new FakeWorker(),
      taskTimeoutMs: 1000,
    });

    const results = await pool.run(
      [
        { id: 'a', name: 'a.png', file: { name: 'a.png' } },
        { id: 'b', name: 'b.png', file: { name: 'b.png' } },
        { id: 'c', name: 'c.png', file: { name: 'c.png' } },
      ],
      {
        workerCount: 2,
        onTaskProgress: (task, message) => progress.push(`${task.id}:${message}`),
        onTaskComplete: (task) => completed.push(task.id),
      },
    );

    expect(results.map((result) => result.rawText)).toEqual(['a.png', 'b.png', 'c.png']);
    expect(progress.length).toBe(3);
    expect(completed.sort()).toEqual(['a', 'b', 'c']);
  });

  it('cancels a running queue', async () => {
    const pool = new BrowserOcrWorkerPool({
      workerFactory: () => new FakeWorker({ delayMs: 20 }),
      taskTimeoutMs: 1000,
    });
    const controller = new AbortController();
    const promise = pool.run(
      [
        { id: 'a', name: 'a.png', file: { name: 'a.png' } },
        { id: 'b', name: 'b.png', file: { name: 'b.png' } },
      ],
      { workerCount: 1, signal: controller.signal },
    );

    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});

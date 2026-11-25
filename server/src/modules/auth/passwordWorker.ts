import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import bcrypt from 'bcryptjs';

const require = createRequire(import.meta.url);

interface PendingJob {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

const WORKER_SCRIPT = `
import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';

const req = createRequire(workerData.bcryptEntry);
const bcrypt = req(workerData.bcryptEntry);

parentPort.on('message', async (msg) => {
  try {
    if (msg.type === 'compare') {
      const ok = await bcrypt.compare(msg.password, msg.hash);
      parentPort.postMessage({ id: msg.id, result: ok });
    } else if (msg.type === 'hash') {
      const hash = await bcrypt.hash(msg.password, msg.rounds);
      parentPort.postMessage({ id: msg.id, result: hash });
    } else {
      parentPort.postMessage({ id: msg.id, error: 'Unsupported worker operation' });
    }
  } catch (err) {
    parentPort.postMessage({
      id: msg.id,
      error: err && err.message ? err.message : 'Password worker error',
    });
  }
});
`;

class PasswordWorkerClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingJob>();
  private workerBroken = false;

  private ensureWorker(): Worker | null {
    if (this.workerBroken) return null;
    if (this.worker) return this.worker;

    try {
      const bcryptEntry = require.resolve('bcryptjs');
      const w = new Worker(WORKER_SCRIPT, {
        eval: true,
        workerData: { bcryptEntry },
      });

      w.on('message', (msg: { id: number; result?: unknown; error?: string }) => {
        const job = this.pending.get(msg.id);
        if (!job) return;
        this.pending.delete(msg.id);
        if (this.pending.size === 0) {
          w.unref();
        }
        if (msg.error) {
          job.reject(new Error(msg.error));
        } else {
          job.resolve(msg.result);
        }
      });

      w.on('error', (err) => {
        this.rejectAll(err instanceof Error ? err : new Error('Password worker error'));
        this.worker = null;
      });

      w.on('exit', (code) => {
        if (this.worker === w) {
          this.worker = null;
        }
        if (code !== 0 && this.pending.size > 0) {
          this.rejectAll(new Error(`Password worker exited with code ${code}`));
        }
      });

      w.unref();
      this.worker = w;
      return w;
    } catch {
      this.workerBroken = true;
      return null;
    }
  }

  private rejectAll(err: Error) {
    for (const [, job] of this.pending) {
      job.reject(err);
    }
    this.pending.clear();
  }

  run<T>(payload: { type: 'compare'; password: string; hash: string } | { type: 'hash'; password: string; rounds: number }): Promise<T> | null {
    const w = this.ensureWorker();
    if (!w) return null;

    const id = this.nextId++;
    w.ref();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      w.postMessage({ id, ...payload });
    });
  }
}

const workerClient = new PasswordWorkerClient();

export async function comparePasswordAsync(password: string, hash: string): Promise<boolean> {
  try {
    const workerPromise = workerClient.run<boolean>({ type: 'compare', password, hash });
    if (workerPromise) {
      return await workerPromise;
    }
  } catch {
    // Fallback to local bcryptjs if worker thread cannot execute
  }
  return bcrypt.compare(password, hash);
}

export async function hashPasswordAsync(password: string, rounds = 12): Promise<string> {
  try {
    const workerPromise = workerClient.run<string>({ type: 'hash', password, rounds });
    if (workerPromise) {
      return await workerPromise;
    }
  } catch {
    // Fallback to local bcryptjs if worker thread cannot execute
  }
  return bcrypt.hash(password, rounds);
}

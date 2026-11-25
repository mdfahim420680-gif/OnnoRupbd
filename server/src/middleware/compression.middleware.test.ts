import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { compressionMiddleware, selectCompressionEncoding } from './compression.middleware';

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use(compressionMiddleware);

  app.get('/large-json', (_req, res) => {
    res.json({
      items: Array.from({ length: 60 }, (_, idx) => ({
        id: idx,
        name: `Product catalog item number ${idx} for compression benchmark`,
        active: true,
      })),
    });
  });

  app.get('/small-json', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/binary', (_req, res) => {
    res.setHeader('Content-Type', 'image/png');
    res.send(Buffer.alloc(2048, 7));
  });

  app.get('/pre-compressed', (_req, res) => {
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ already: 'x'.repeat(1500) })));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Encoding', 'gzip');
    res.send(gz);
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const addr = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

describe('compressionMiddleware', () => {
  it('selects gzip or deflate cleanly while respecting q=0 rejections', () => {
    assert.equal(selectCompressionEncoding('gzip, deflate, br'), 'gzip');
    assert.equal(selectCompressionEncoding('deflate;q=0.9, gzip;q=0'), 'deflate');
    assert.equal(selectCompressionEncoding('gzip;q=0, deflate;q=0'), null);
    assert.equal(selectCompressionEncoding(undefined), null);
  });

  it('compresses JSON payloads >= 1024 bytes and sets Vary header', async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/large-json`, {
        headers: { 'Accept-Encoding': 'gzip' },
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-encoding'), 'gzip');
      assert.match(res.headers.get('vary') || '', /Accept-Encoding/i);
      const data = (await res.json()) as { items: Array<{ id: number }> };
      assert.equal(data.items.length, 60);
    });
  });

  it('skips small, binary, and already-encoded payloads', async () => {
    await withServer(async (baseUrl) => {
      const small = await fetch(`${baseUrl}/small-json`, {
        headers: { 'Accept-Encoding': 'gzip' },
      });
      assert.equal(small.headers.get('content-encoding'), null);
      assert.deepEqual(await small.json(), { ok: true });

      const bin = await fetch(`${baseUrl}/binary`, {
        headers: { 'Accept-Encoding': 'gzip' },
      });
      assert.equal(bin.headers.get('content-encoding'), null);
      assert.equal((await bin.arrayBuffer()).byteLength, 2048);

      const pre = await fetch(`${baseUrl}/pre-compressed`, {
        headers: { 'Accept-Encoding': 'gzip' },
      });
      assert.equal(pre.headers.get('content-encoding'), 'gzip');
      const parsed = (await pre.json()) as { already: string };
      assert.equal(parsed.already.length, 1500);
    });
  });
});

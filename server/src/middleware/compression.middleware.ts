import zlib from 'node:zlib';
import type { NextFunction, Request, Response } from 'express';

const COMPRESSION_THRESHOLD_BYTES = 1024;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

const SKIP_CONTENT_TYPE_RE =
  /^(image|video|audio|font)\/|application\/(zip|gzip|x-gzip|x-brotli|pdf|octet-stream)|text\/event-stream/i;

export function selectCompressionEncoding(acceptEncodingHeader: string | string[] | undefined): 'gzip' | 'deflate' | null {
  const raw = Array.isArray(acceptEncodingHeader)
    ? acceptEncodingHeader.join(',')
    : String(acceptEncodingHeader || '');
  if (!raw.trim()) return null;

  let gzipQ = -1;
  let deflateQ = -1;

  for (const part of raw.split(',')) {
    const [tokenRaw, ...params] = part.trim().toLowerCase().split(';');
    const token = tokenRaw.trim();
    if (!token) continue;
    let q = 1;
    for (const p of params) {
      const match = /^q\s*=\s*([0-9.]+)$/.exec(p.trim());
      if (match) {
        const parsed = Number(match[1]);
        if (!Number.isNaN(parsed)) q = parsed;
      }
    }
    if (token === 'gzip' || token === 'x-gzip') {
      gzipQ = Math.max(gzipQ, q);
    } else if (token === 'deflate') {
      deflateQ = Math.max(deflateQ, q);
    }
  }

  if (gzipQ > 0) return 'gzip';
  if (deflateQ > 0) return 'deflate';
  return null;
}

function shouldSkipCompression(res: Response, bodyLength: number): boolean {
  if (res.statusCode < 200 || res.statusCode === 204 || res.statusCode === 304) {
    return true;
  }
  if (res.getHeader('Content-Encoding')) {
    return true;
  }
  const contentType = String(res.getHeader('Content-Type') || '');
  if (contentType && SKIP_CONTENT_TYPE_RE.test(contentType)) {
    return true;
  }
  if (bodyLength < COMPRESSION_THRESHOLD_BYTES || bodyLength > MAX_BUFFER_BYTES) {
    return true;
  }
  return false;
}

function toBuffer(chunk: unknown, encoding?: BufferEncoding): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk, encoding || 'utf8');
  if (chunk instanceof Uint8Array) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  return Buffer.alloc(0);
}

export function compressionMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'HEAD') {
    next();
    return;
  }

  const encoding = selectCompressionEncoding(req.headers['accept-encoding']);
  if (!res.headersSent) {
    res.vary('Accept-Encoding');
  }
  if (!encoding) {
    next();
    return;
  }

  const origWrite = res.write.bind(res) as Response['write'];
  const origEnd = res.end.bind(res) as Response['end'];

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let bypassed = false;

  const flushRawBypass = (extraChunk?: Buffer) => {
    bypassed = true;
    res.write = origWrite;
    res.end = origEnd;
    for (const c of chunks) {
      origWrite(c);
    }
    chunks.length = 0;
    if (extraChunk && extraChunk.length > 0) {
      origWrite(extraChunk);
    }
  };

  res.write = function wrappedWrite(
    chunk: unknown,
    encOrCb?: BufferEncoding | ((error?: Error | null) => void),
    cb?: (error?: Error | null) => void,
  ): boolean {
    const enc = typeof encOrCb === 'string' ? encOrCb : undefined;
    const callback = typeof encOrCb === 'function' ? encOrCb : cb;

    if (bypassed || res.headersSent) {
      return origWrite(chunk as never, enc as never, callback as never);
    }

    const buf = toBuffer(chunk, enc);
    if (totalBytes + buf.length > MAX_BUFFER_BYTES || Boolean(res.getHeader('Content-Encoding'))) {
      flushRawBypass(buf);
      if (callback) callback();
      return true;
    }

    if (buf.length > 0) {
      chunks.push(buf);
      totalBytes += buf.length;
    }
    if (callback) callback();
    return true;
  } as Response['write'];

  res.end = function wrappedEnd(
    chunk?: unknown,
    encOrCb?: BufferEncoding | (() => void),
    cb?: () => void,
  ): Response {
    const enc = typeof encOrCb === 'string' ? encOrCb : undefined;
    const callback = typeof encOrCb === 'function' ? encOrCb : cb;

    if (bypassed || res.headersSent) {
      res.write = origWrite;
      res.end = origEnd;
      return origEnd(chunk as never, enc as never, callback as never);
    }

    if (chunk !== undefined && chunk !== null && typeof chunk !== 'function') {
      const tail = toBuffer(chunk, enc);
      if (tail.length > 0) {
        chunks.push(tail);
        totalBytes += tail.length;
      }
    }

    res.write = origWrite;
    res.end = origEnd;

    const fullBody = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
    chunks.length = 0;

    if (shouldSkipCompression(res, fullBody.length)) {
      if (fullBody.length > 0 && !res.getHeader('Content-Length')) {
        res.setHeader('Content-Length', fullBody.length);
      }
      return origEnd(fullBody, callback as never);
    }

    const compressor = encoding === 'gzip' ? zlib.gzip : zlib.deflate;
    compressor(fullBody, { level: 6 }, (err, compressed) => {
      if (err || compressed.length >= fullBody.length) {
        if (fullBody.length > 0 && !res.getHeader('Content-Length')) {
          res.setHeader('Content-Length', fullBody.length);
        }
        origEnd(fullBody, callback as never);
        return;
      }
      res.removeHeader('Content-Length');
      res.setHeader('Content-Encoding', encoding);
      res.setHeader('Content-Length', compressed.length);
      origEnd(compressed, callback as never);
    });

    return res;
  } as Response['end'];

  next();
}

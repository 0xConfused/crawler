// SPDX-License-Identifier: AGPL-3.0-or-later

import express from 'express';
import path from 'path';
import tls from 'tls';
import dns from 'dns/promises';
import net from 'net';
import { createServer as createViteServer } from 'vite';
import * as cheerio from 'cheerio';
import {
  AI_ASSISTANCE_FILENAMES,
  ApiEndpointRecord,
  ApiMethod,
  ApiCategory,
  ApiQueryParameter,
  ApiPossibleQuery,
} from './src/types';

const app = express();
const PORT = 3000;

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  if (req.url && req.url.length > 4096) {
    return res.status(414).json({ error: 'Request URI exceeds safe maximum length limit (4096 bytes).' });
  }
  next();
});

app.use(express.json({ limit: '256kb' }));

function safeClampText(input: unknown, maxLen = 200): string {
  if (typeof input !== 'string') {
    if (typeof input === 'number' || typeof input === 'boolean') {
      return String(input);
    }
    return '';
  }

  let str = input;
  try {
    str = str.normalize('NFC');
  } catch {
    // Malformed sequence fallback
  }

  const codePoints = Array.from(str);
  if (codePoints.length > maxLen) {
    str = codePoints.slice(0, maxLen).join('');
  }

  if (Buffer.byteLength(str, 'utf8') > maxLen * 4) {
    const buf = Buffer.from(str, 'utf8').subarray(0, maxLen * 4);
    str = buf.toString('utf8');
  }

  return str;
}

function deepClampInputs(obj: unknown, maxLen = 200, depth = 0): unknown {
  if (depth > 5 || !obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === 'string') {
        obj[i] = safeClampText(obj[i], maxLen);
      } else if (typeof obj[i] === 'object' && obj[i] !== null) {
        deepClampInputs(obj[i], maxLen, depth + 1);
      }
    }
  } else {
    const record = obj as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      const val = record[key];
      if (typeof val === 'string') {
        record[key] = safeClampText(val, maxLen);
      } else if (typeof val === 'object' && val !== null) {
        deepClampInputs(val, maxLen, depth + 1);
      }
    }
  }
  return obj;
}

app.use((req, _res, next) => {
  if (req.query) {
    deepClampInputs(req.query, 200);
  }
  if (req.body && typeof req.body === 'object') {
    deepClampInputs(req.body, 200);
  }
  next();
});

function isPrivateOrLocalHost(hostname: string): boolean {
  if (!hostname) return true;
  let host = hostname.toLowerCase().trim();

  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1).trim();
  }

  if (host.includes(':')) {
    const colonCount = (host.match(/:/g) || []).length;
    if (colonCount === 1) {
      host = host.split(':')[0];
    }
  }

  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '::' ||
    host === '0' ||
    host === 'metadata.google.internal' ||
    host === 'instance-data'
  ) {
    return true;
  }

  if (
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan') ||
    host.endsWith('.home') ||
    host.endsWith('.corp') ||
    host.endsWith('.invalid') ||
    host.endsWith('.test') ||
    host.endsWith('.example')
  ) {
    return true;
  }

  if (/^(\d+|0x[0-9a-f]+)$/i.test(host)) {
    const num = host.startsWith('0x') || host.startsWith('0X') ? parseInt(host, 16) : parseInt(host, 10);
    if (!isNaN(num) && num >= 0 && num <= 4294967295) {
      const b1 = (num >>> 24) & 255;
      const b2 = (num >>> 16) & 255;
      const b3 = (num >>> 8) & 255;
      const b4 = num & 255;
      host = `${b1}.${b2}.${b3}.${b4}`;
    }
  }

  if (/^127\./.test(host)) return true; 
  if (/^10\./.test(host)) return true; 
  if (/^192\.168\./.test(host)) return true; 
  if (/^169\.254\./.test(host)) return true; 
  if (/^0\./.test(host)) return true; 
  if (/^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./.test(host)) return true; 

  const match172 = host.match(/^172\.(\d+)\./);
  if (match172) {
    const secondOctet = parseInt(match172[1], 10);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }

  const firstOctetMatch = host.match(/^(\d+)\./);
  if (firstOctetMatch) {
    const firstOctet = parseInt(firstOctetMatch[1], 10);
    if (firstOctet >= 224) return true;
  }

  const ipType = net.isIP(host);
  if (ipType === 6) {
    if (host === '::1' || host === '::') return true;
    if (host.startsWith('::ffff:')) {
      const mappedPart = host.slice(7);
      if (mappedPart.includes('.')) {
        return isPrivateOrLocalHost(mappedPart);
      }
    }
    if (/^f[cd][0-9a-f]{2}:/i.test(host) || /^f[cd]:/i.test(host)) return true;
    if (/^fe[89ab][0-9a-f]:/i.test(host) || /^fe[89ab]:/i.test(host)) return true;
  }

  return false;
}

interface SafeFetchOptions extends RequestInit {
  maxRedirects?: number;
  validateRedirect?: (url: URL) => boolean;
  userIdentifier?: string | express.Request;
}

function extractUserIdentifier(req?: express.Request): string {
  if (!req) return '127.0.0.1';

  if (req.ip) {
    const candidate = req.ip.replace(/^::ffff:/, '').trim();
    if (candidate) return candidate === '::1' ? '127.0.0.1' : candidate;
  }

  if (req.socket?.remoteAddress) {
    const candidate = req.socket.remoteAddress.replace(/^::ffff:/, '').trim();
    if (candidate) return candidate === '::1' ? '127.0.0.1' : candidate;
  }

  return '127.0.0.1';
}

function safeCompileRegex(rawPattern: string): RegExp | null {
  const clamped = safeClampText(rawPattern, 200).trim();
  if (!clamped) return null;

  const redosPattern = /(\+|\*|\{[0-9]+,[0-9]*\})\s*\)\s*(\+|\*|\{[0-9]+,[0-9]*\})/i;
  if (redosPattern.test(clamped)) {
    return null;
  }

  try {
    return new RegExp(clamped, 'i');
  } catch {
    return null;
  }
}

function getUserAgent(reqOrIdentifier?: express.Request | string): string {
  let id = '127.0.0.1';
  if (typeof reqOrIdentifier === 'string' && reqOrIdentifier.trim()) {
    id = reqOrIdentifier.trim();
  } else if (reqOrIdentifier && typeof reqOrIdentifier === 'object') {
    id = extractUserIdentifier(reqOrIdentifier);
  }
  return `Mozilla/5.0 (compatible; 0xCONFUSED./crawler; user: ${id})`;
}

const AUTHENTIC_BROWSER_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.86',
];

function getRandomUserAgent(): string {
  const index = Math.floor(Math.random() * AUTHENTIC_BROWSER_USER_AGENTS.length);
  return AUTHENTIC_BROWSER_USER_AGENTS[index];
}

const MIN_REQUEST_DELAY_MS = 50; 

const rateLimitStores: Record<string, Map<string, number[]>> = {
  crawlStream: new Map(),
  domainInfo: new Map(),
  crtSubdomains: new Map(),
  crtProbe: new Map(),
  apiProbe: new Map(),
};

setInterval(() => {
  const now = Date.now();
  for (const store of Object.values(rateLimitStores)) {
    for (const [key, timestamps] of store.entries()) {
      const valid = timestamps.filter((t) => now - t < 120_000);
      if (valid.length === 0) {
        store.delete(key);
      } else {
        store.set(key, valid);
      }
    }
  }
}, 120_000);

function checkRateLimit(
  bucketName: keyof typeof rateLimitStores,
  userId: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const store = rateLimitStores[bucketName];
  const timestamps = (store.get(userId) || []).filter((t) => now - t < windowMs);

  if (timestamps.length >= maxRequests) {
    const oldest = timestamps[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, retryAfterSec };
  }

  timestamps.push(now);
  store.set(userId, timestamps);
  return { allowed: true, retryAfterSec: 0 };
}

const activeCrawlsPerUser = new Set<string>();

class CircularRedirectError extends Error {
  isCircularRedirect = true;
  redirectChain: string[];
  finalUrl: string;
  statusCode: number;

  constructor(chain: string[], finalUrl: string, statusCode = 310) {
    super(`Circular redirect loop detected: ${chain.join(' -> ')} -> ${finalUrl}`);
    this.name = 'CircularRedirectError';
    this.redirectChain = [...chain, finalUrl];
    this.finalUrl = finalUrl;
    this.statusCode = statusCode;
  }
}

async function safeReadBoundedBody(
  response: Response,
  maxBytes = 2_000_000
): Promise<{ text: string; truncated: boolean; bytesRead: number }> {
  if (!response.body) {
    const text = await response.text();
    return {
      text: text.slice(0, maxBytes),
      truncated: text.length > maxBytes,
      bytesRead: text.length,
    };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        bytesRead += value.byteLength;
        if (bytesRead > maxBytes) {
          const excess = bytesRead - maxBytes;
          const keepLength = value.byteLength - excess;
          if (keepLength > 0) {
            chunks.push(value.subarray(0, keepLength));
          }
          truncated = true;
          try {
            await reader.cancel();
          } catch {}
          break;
        } else {
          chunks.push(value);
        }
      }
    }
  } catch (err: any) {
    if (chunks.length === 0) {
      throw err;
    }
  }

  const totalLength = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
  const text = decoder.decode(combined);
  return { text, truncated, bytesRead };
}

function inferFileDetailsFromMime(
  mimeType: string,
  urlPath = ''
): { extension: string; fileType: 'document' | 'image' | 'code' | 'stylesheet' | 'script' | 'media' | 'data' | 'archive' | 'other' } {
  const lower = mimeType.toLowerCase();
  if (lower.includes('application/pdf')) return { extension: 'pdf', fileType: 'document' };
  if (lower.includes('application/zip') || lower.includes('application/x-zip-compressed')) return { extension: 'zip', fileType: 'archive' };
  if (lower.includes('application/gzip') || lower.includes('application/x-gzip')) return { extension: 'gz', fileType: 'archive' };
  if (lower.includes('application/json')) return { extension: 'json', fileType: 'data' };
  if (lower.includes('application/xml') || lower.includes('text/xml')) return { extension: 'xml', fileType: 'data' };
  if (lower.includes('image/png')) return { extension: 'png', fileType: 'image' };
  if (lower.includes('image/jpeg')) return { extension: 'jpg', fileType: 'image' };
  if (lower.includes('image/gif')) return { extension: 'gif', fileType: 'image' };
  if (lower.includes('image/svg')) return { extension: 'svg', fileType: 'image' };
  if (lower.includes('image/webp')) return { extension: 'webp', fileType: 'image' };
  if (lower.includes('image/x-icon') || lower.includes('image/vnd.microsoft.icon')) return { extension: 'ico', fileType: 'image' };
  if (lower.includes('text/css')) return { extension: 'css', fileType: 'stylesheet' };
  if (lower.includes('javascript') || lower.includes('application/javascript')) return { extension: 'js', fileType: 'script' };
  if (lower.includes('audio/')) return { extension: 'mp3', fileType: 'media' };
  if (lower.includes('video/')) return { extension: 'mp4', fileType: 'media' };
  if (lower.includes('application/msword') || lower.includes('wordprocessingml')) return { extension: 'docx', fileType: 'document' };
  if (lower.includes('spreadsheetml') || lower.includes('application/vnd.ms-excel')) return { extension: 'xlsx', fileType: 'document' };
  if (lower.includes('text/plain')) return { extension: 'txt', fileType: 'document' };
  if (lower.includes('application/octet-stream')) {
    const extMatch = urlPath.match(/\.([a-zA-Z0-9]{1,8})$/);
    if (extMatch) {
      const ext = extMatch[1].toLowerCase();
      return { extension: ext, fileType: classifyFileCategory(ext) };
    }
    return { extension: 'bin', fileType: 'other' };
  }
  return { extension: 'bin', fileType: 'other' };
}

function decodeUnreservedRfc3986(str: string): string {
  return str.replace(/%([0-9a-fA-F]{2})/g, (match, hex) => {
    const code = parseInt(hex, 16);
    if (
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      code === 45 ||
      code === 95 ||
      code === 46 ||
      code === 126
    ) {
      return String.fromCharCode(code);
    }
    return match;
  });
}

async function safeFetch(
  initialUrl: string,
  options: SafeFetchOptions = {}
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 5;
  let currentUrl = initialUrl;
  let redirectsCount = 0;
  const redirectChain: string[] = [initialUrl];
  const seenHops = new Set<string>();
  seenHops.add(cleanUrl(initialUrl, undefined, false, true) || initialUrl);

  const { maxRedirects: _, validateRedirect, userIdentifier, ...fetchOpts } = options;

  const headers = new Headers(fetchOpts.headers || {});
  if (!headers.has('User-Agent') && !headers.has('user-agent')) {
    headers.set('User-Agent', getUserAgent(userIdentifier));
  }

  while (true) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      throw new Error(`Invalid URL for safeFetch: ${currentUrl}`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Blocked non-HTTP(S) protocol: ${parsed.protocol}`);
    }

    if (isPrivateOrLocalHost(parsed.hostname)) {
      throw new Error(`SSRF blocked: Attempted request to private or local host (${parsed.hostname})`);
    }

    if (validateRedirect && !validateRedirect(parsed)) {
      throw new Error(`Redirect target disallowed by security policy: ${parsed.hostname}`);
    }

    const res = await fetch(currentUrl, {
      ...fetchOpts,
      headers,
      redirect: 'manual',
    });

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) {
        try {
          Object.defineProperty(res, 'url', { value: currentUrl, configurable: true });
          (res as any).redirectChain = redirectChain;
          (res as any).finalUrl = currentUrl;
        } catch {}
        return res;
      }

      let nextUrl: string;
      try {
        nextUrl = new URL(location, currentUrl).toString();
      } catch {
        throw new Error(`Invalid redirect Location header received: ${location}`);
      }

      const nextParsed = new URL(nextUrl);

      if (nextParsed.protocol !== 'http:' && nextParsed.protocol !== 'https:') {
        throw new Error(`Blocked redirect to unsafe protocol: ${nextParsed.protocol}`);
      }

      if (isPrivateOrLocalHost(nextParsed.hostname)) {
        throw new Error(`SSRF blocked: Redirect target points to private or local host (${nextParsed.hostname})`);
      }

      const normalizedNext = cleanUrl(nextUrl, undefined, false, true) || nextUrl;
      // Fast loop breaker: abort immediately on circular redirect cycle
      if (seenHops.has(normalizedNext)) {
        throw new CircularRedirectError(redirectChain, nextUrl, res.status);
      }
      seenHops.add(normalizedNext);
      redirectChain.push(nextUrl);

      redirectsCount++;
      if (redirectsCount > maxRedirects) {
        throw new Error(`Too many redirects (exceeded limit of ${maxRedirects}): ${redirectChain.join(' -> ')}`);
      }

      if (validateRedirect && !validateRedirect(nextParsed)) {
        try {
          Object.defineProperty(res, 'url', { value: currentUrl, configurable: true });
          (res as any).redirectChain = redirectChain;
          (res as any).finalUrl = currentUrl;
        } catch {}
        return res;
      }

      currentUrl = nextUrl;

      if (res.status === 303 && fetchOpts.method && fetchOpts.method !== 'GET' && fetchOpts.method !== 'HEAD') {
        fetchOpts.method = 'GET';
        delete fetchOpts.body;
      }

      continue;
    }

    try {
      Object.defineProperty(res, 'url', { value: currentUrl, configurable: true });
      (res as any).redirectChain = redirectChain;
      (res as any).finalUrl = currentUrl;
    } catch {}

    return res;
  }
}

function cleanUrl(rawUrl: string, _baseDomain?: string, stripQuery = true, stripHash = true): string | null {
  try {
    let urlStr = rawUrl.trim();
    if (!/^https?:\/\//i.test(urlStr)) {
      urlStr = 'https://' + urlStr;
    }
    const parsed = new URL(urlStr);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    // Default port stripping (:80 / :443)
    if (parsed.protocol === 'http:' && parsed.port === '80') {
      parsed.port = '';
    } else if (parsed.protocol === 'https:' && parsed.port === '443') {
      parsed.port = '';
    }

    if (stripHash) {
      parsed.hash = '';
    }

    if (stripQuery) {
      parsed.search = '';
    } else if (parsed.search) {
      // Parameter sorting: canonical parameter ordering
      parsed.searchParams.sort();
    }

    parsed.pathname = decodeUnreservedRfc3986(parsed.pathname).replace(/\/+/g, '/');
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }

    return parsed.href;
  } catch {
    return null;
  }
}

function extractPathDirectories(pathname: string): string[] {
  let cleanPath = pathname.replace(/\/+/g, '/');
  if (!cleanPath.startsWith('/')) cleanPath = '/' + cleanPath;

  const segments = cleanPath.split('/').filter(Boolean);
  const dirs = new Set<string>();
  dirs.add('/');

  let current = '';
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    const isFile = /\.[a-zA-Z0-9]{1,8}$/.test(seg);

    if (isLast && isFile) {
      break;
    }

    current += '/' + seg;
    dirs.add(current.endsWith('/') ? current : current + '/');
  }

  return Array.from(dirs);
}

function classifyFileCategory(extension: string): 'document' | 'image' | 'code' | 'stylesheet' | 'script' | 'media' | 'data' | 'archive' | 'other' {
  const ext = extension.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'avif', 'tiff'].includes(ext)) {
    return 'image';
  }
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'odt', 'epub'].includes(ext)) {
    return 'document';
  }
  if (['css', 'scss', 'sass', 'less'].includes(ext)) {
    return 'stylesheet';
  }
  if (['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx'].includes(ext)) {
    return 'script';
  }
  if (['json', 'xml', 'csv', 'tsv', 'yaml', 'yml', 'sql', 'graphql', 'rss', 'atom'].includes(ext)) {
    return 'data';
  }
  if (['zip', 'tar', 'gz', 'bz2', '7z', 'rar', 'iso', 'dmg', 'apk'].includes(ext)) {
    return 'archive';
  }
  if (['mp4', 'webm', 'mp3', 'ogg', 'wav', 'avi', 'mov', 'flac', 'aac', 'm4a'].includes(ext)) {
    return 'media';
  }
  if (['html', 'htm', 'php', 'asp', 'aspx', 'jsp', 'wasm', 'py', 'rb', 'go', 'rs', 'c', 'cpp', 'sh'].includes(ext)) {
    return 'code';
  }
  return 'other';
}

function detectFileRecord(targetUrl: string, sourceUrl: string) {
  try {
    const parsed = new URL(targetUrl);
    const pathname = parsed.pathname.replace(/\/+/g, '/');
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length === 0) return null;

    const lastSeg = segments[segments.length - 1];
    const match = lastSeg.match(/\.([a-zA-Z0-9]{1,8})$/);
    if (!match) return null;

    const extension = match[1].toLowerCase();
    const filename = lastSeg;
    const dirSegments = segments.slice(0, -1);
    const directory = dirSegments.length === 0 ? '/' : '/' + dirSegments.join('/') + '/';
    const depth = dirSegments.length;
    const fileType = classifyFileCategory(extension);

    return {
      path: pathname,
      filename,
      extension,
      directory,
      depth,
      fileType,
      foundOnUrl: sourceUrl || targetUrl,
      foundOnUrls: [sourceUrl || targetUrl],
      firstDiscoveredAt: Date.now(),
      url: parsed.href,
      domain: parsed.hostname.toLowerCase(),
    };
  } catch {
    return null;
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/api/validate-url', (req, res) => {
  const urlParam = req.query.url as string;
  if (!urlParam) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    let testUrl = urlParam.trim();
    if (!/^https?:\/\//i.test(testUrl)) {
      testUrl = 'https://' + testUrl;
    }
    const parsed = new URL(testUrl);
    if (isPrivateOrLocalHost(parsed.hostname)) {
      return res.status(400).json({ error: 'Localhost and private IP addresses cannot be crawled.' });
    }
    res.json({
      valid: true,
      normalized: parsed.href,
      hostname: parsed.hostname,
      protocol: parsed.protocol,
      pathname: parsed.pathname,
      directories: extractPathDirectories(parsed.pathname),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Invalid URL format' });
  }
});

async function fetchDnsOverHttps(domain: string, type: string, userAgentOrReq?: string | express.Request): Promise<any[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${encodeURIComponent(type)}`, {
      headers: {
        Accept: 'application/dns-json',
        'User-Agent': getUserAgent(userAgentOrReq),
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const data = await res.json();
    return data.Answer || [];
  } catch {
    return [];
  }
}

const MULTI_PART_TLDS = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'net.uk', 'me.uk', 'ltd.uk', 'plc.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'ed.jp',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz',
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
  'com.mx', 'org.mx', 'edu.mx', 'gob.mx', 'net.mx',
  'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in', 'ind.in', 'nic.in', 'ac.in', 'edu.in', 'gov.in',
  'com.sg', 'edu.sg', 'gov.sg', 'net.sg', 'org.sg',
  'co.za', 'net.za', 'org.za', 'web.za', 'gov.za',
  'com.tr', 'net.tr', 'org.tr', 'edu.tr', 'gov.tr',
  'com.hk', 'org.hk', 'net.hk', 'edu.hk', 'gov.hk',
  'com.tw', 'org.tw', 'net.tw', 'edu.tw', 'gov.tw',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
  'gc.ca', 'qc.ca', 'ab.ca', 'bc.ca', 'on.ca',
]);

function extractApexDomain(hostname: string): string {
  const clean = hostname.toLowerCase().trim().replace(/:\d+$/, '').replace(/^\.+|\.+$/g, '');
  const parts = clean.split('.').filter(Boolean);
  if (parts.length <= 2) return clean;

  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_PART_TLDS.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

let ianaBootstrapCache: any = null;
let ianaBootstrapFetchedAt = 0;

async function getIanaBootstrap(userAgentOrReq?: string | express.Request): Promise<any> {
  const now = Date.now();
  if (ianaBootstrapCache && now - ianaBootstrapFetchedAt < 24 * 60 * 60 * 1000) {
    return ianaBootstrapCache;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch('https://data.iana.org/rdap/dns.json', {
      signal: controller.signal,
      headers: {
        'User-Agent': getUserAgent(userAgentOrReq),
        Accept: 'application/json',
      },
    });
    clearTimeout(timeout);
    if (res.ok) {
      ianaBootstrapCache = await res.json();
      ianaBootstrapFetchedAt = now;
    }
  } catch {}
  return ianaBootstrapCache;
}

async function getAuthoritativeRdapUrl(domain: string, userAgentOrReq?: string | express.Request): Promise<string | null> {
  const parts = domain.split('.');
  const tld = parts[parts.length - 1].toLowerCase();
  const bootstrap = await getIanaBootstrap(userAgentOrReq);

  if (bootstrap && Array.isArray(bootstrap.services)) {
    for (const service of bootstrap.services) {
      const tlds = service[0];
      const urls = service[1];
      if (Array.isArray(tlds) && tlds.includes(tld) && Array.isArray(urls) && urls.length > 0) {
        const base = urls[0].endsWith('/') ? urls[0] : urls[0] + '/';
        return `${base}domain/${encodeURIComponent(domain)}`;
      }
    }
  }

  const staticMap: Record<string, string> = {
    com: 'https://rdap.verisign.com/com/v1/domain/',
    net: 'https://rdap.verisign.com/net/v1/domain/',
    org: 'https://rdap.publicinterestregistry.org/rdap/domain/',
    info: 'https://rdap.identitydigital.services/rdap/domain/',
    biz: 'https://rdap.identitydigital.services/rdap/domain/',
    mobi: 'https://rdap.identitydigital.services/rdap/domain/',
    app: 'https://rdap.nic.google/domain/',
    dev: 'https://rdap.nic.google/domain/',
    page: 'https://rdap.nic.google/domain/',
    fr: 'https://rdap.nic.fr/domain/',
    uk: 'https://rdap.nominet.uk/uk/domain/',
    ca: 'https://rdap.ca.fury.ca/rdap/domain/',
    nl: 'https://rdap.sidn.nl/domain/',
    cz: 'https://rdap.nic.cz/domain/',
    se: 'https://rdap.iis.se/domain/',
    nu: 'https://rdap.iis.se/domain/',
    br: 'https://rdap.registro.br/domain/',
  };

  if (staticMap[tld]) {
    return `${staticMap[tld]}${encodeURIComponent(domain)}`;
  }
  return null;
}

function parseRdapData(rdapData: any, domain: string, rootDomain: string) {
  let registrarName = '';
  let ianaId = '';
  let abuseContact = '';
  let registrantCountry = '';

  const searchEntities = (entities: any[]) => {
    if (!Array.isArray(entities)) return;
    for (const ent of entities) {
      const roles = ent.roles || [];
      if (roles.includes('registrar') || roles.includes('sponsor')) {
        if (ent.vcardArray && ent.vcardArray[1]) {
          const fnItem = ent.vcardArray[1].find((i: any) => i[0] === 'fn');
          if (fnItem && typeof fnItem[3] === 'string') registrarName = fnItem[3];
          const orgItem = ent.vcardArray[1].find((i: any) => i[0] === 'org');
          if (!registrarName && orgItem && typeof orgItem[3] === 'string') registrarName = orgItem[3];
        }
        if (!registrarName && ent.handle) registrarName = ent.handle;
        if (ent.publicIds && Array.isArray(ent.publicIds)) {
          const ianaPublicId = ent.publicIds.find((p: any) => p.type === 'IANA Registrar ID');
          if (ianaPublicId) ianaId = String(ianaPublicId.identifier);
        }
      }
      if (roles.includes('abuse')) {
        if (ent.vcardArray && ent.vcardArray[1]) {
          const emailItem = ent.vcardArray[1].find((i: any) => i[0] === 'email');
          if (emailItem && typeof emailItem[3] === 'string') abuseContact = emailItem[3];
          const telItem = ent.vcardArray[1].find((i: any) => i[0] === 'tel');
          if (!abuseContact && telItem && typeof telItem[3] === 'string') abuseContact = telItem[3];
        }
      }
      if (roles.includes('registrant')) {
        if (ent.vcardArray && ent.vcardArray[1]) {
          const adrItem = ent.vcardArray[1].find((i: any) => i[0] === 'adr');
          if (adrItem && adrItem[3] && adrItem[3][6]) registrantCountry = String(adrItem[3][6]);
        }
      }
      if (ent.entities) searchEntities(ent.entities);
    }
  };

  if (rdapData.entities) {
    searchEntities(rdapData.entities);
  }

  let createdDate = '';
  let updatedDate = '';
  let expiresDate = '';

  if (rdapData.events && Array.isArray(rdapData.events)) {
    for (const ev of rdapData.events) {
      if (ev.eventAction === 'registration' || ev.eventAction === 'created') createdDate = ev.eventDate;
      if (ev.eventAction === 'last changed' || ev.eventAction === 'last update') updatedDate = ev.eventDate;
      if (ev.eventAction === 'expiration' || ev.eventAction === 'expiry') expiresDate = ev.eventDate;
    }
  }

  const nameservers =
    rdapData.nameservers
      ?.map((ns: any) => (typeof ns === 'string' ? ns : ns.ldhName || ns.unicodeName || ns.handle))
      .filter(Boolean) || [];

  return {
    domainName: rdapData.ldhName || rdapData.unicodeName || rootDomain || domain,
    rootDomain,
    queryDomain: domain,
    registrar: registrarName || rdapData.port43 || 'Unknown / Protected',
    ianaId: ianaId || undefined,
    createdDate: createdDate || undefined,
    updatedDate: updatedDate || undefined,
    expiresDate: expiresDate || undefined,
    status: rdapData.status || [],
    nameservers,
    whoisServer: rdapData.port43 || undefined,
    abuseContact: abuseContact || undefined,
    registrantCountry: registrantCountry || undefined,
    source: 'rdap' as const,
    rawText: JSON.stringify(rdapData, null, 2).slice(0, 2500),
  };
}

function tcpWhois(query: string, server = 'whois.iana.org', timeoutMs = 3500): Promise<string> {
  if (!server || isPrivateOrLocalHost(server)) {
    return Promise.resolve('');
  }
  return new Promise((resolve) => {
    let resolved = false;
    const socket = net.createConnection(43, server, () => {
      socket.write(query.trim() + '\r\n');
    });
    let data = '';
    socket.on('data', (chunk) => (data += chunk));
    socket.on('end', () => {
      if (!resolved) {
        resolved = true;
        resolve(data);
      }
    });
    socket.on('error', () => {
      if (!resolved) {
        resolved = true;
        resolve(data);
      }
    });
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          socket.destroy();
        } catch {}
        resolve(data);
      }
    }, timeoutMs);
  });
}

function parseWhoisText(rawText: string, domain: string, rootDomain: string) {
  if (!rawText || rawText.trim().length === 0) return null;

  const findMatch = (regex: RegExp) => {
    const m = rawText.match(regex);
    return m && m[1] ? m[1].trim() : undefined;
  };

  const findAll = (regex: RegExp) => {
    const matches: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(rawText)) !== null) {
      if (m[1]) matches.push(m[1].trim().toLowerCase());
    }
    return Array.from(new Set(matches));
  };

  const domainName = findMatch(/Domain Name:\s*([^\r\n]+)/i) || rootDomain || domain;
  const registrar = findMatch(/(?:Registrar Name|Registrar|Sponsoring Registrar|registrar-name):\s*([^\r\n]+)/i);
  const ianaId = findMatch(/(?:Registrar IANA ID|IANA ID|Registrar IANA):\s*([^\r\n]+)/i);
  const createdDate = findMatch(/(?:Creation Date|Created On|Registration Date|Registered On|Created|registered):\s*([^\r\n]+)/i);
  const updatedDate = findMatch(/(?:Updated Date|Last Updated On|Last Modified|Modified|last-update):\s*([^\r\n]+)/i);
  const expiresDate = findMatch(/(?:Registry Expiry Date|Registrar Registration Expiration Date|Expiration Date|Expires On|Expires|Expiry Date|paid-till|expire):\s*([^\r\n]+)/i);
  const whoisServer = findMatch(/(?:Registrar WHOIS Server|WHOIS Server|whois):\s*([^\r\n]+)/i);
  const abuseContact = findMatch(/(?:Registrar Abuse Contact Email|Abuse Contact Email|abuse-mailbox|Registrar Abuse Contact):\s*([^\r\n]+)/i);
  const registrantCountry = findMatch(/(?:Registrant Country|Country|registrant-country):\s*([^\r\n]+)/i);

  const nameservers = findAll(/(?:Name Server|Nameservers|nserver|nameserver):\s*([^\r\n]+)/gi);
  const status = findAll(/(?:Domain Status|Status|status):\s*([^\r\n]+)/gi);

  return {
    domainName,
    rootDomain,
    queryDomain: domain,
    registrar: registrar || 'Protected / Not Disclosed',
    ianaId,
    createdDate,
    updatedDate,
    expiresDate,
    status,
    nameservers,
    whoisServer,
    abuseContact,
    registrantCountry,
    rawText: rawText.slice(0, 2500),
    source: 'whois' as const,
  };
}

async function resolveDomainWhoisAndRdap(domain: string, userAgentOrReq?: string | express.Request) {
  const rootDomain = extractApexDomain(domain);
  const ua = getUserAgent(userAgentOrReq);

  const rdapUrl = await getAuthoritativeRdapUrl(rootDomain, ua);
  if (rdapUrl) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await safeFetch(rdapUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': ua,
          Accept: 'application/rdap+json, application/json',
        },
        maxRedirects: 3,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const rdapJson = await res.json();
        const parsed = parseRdapData(rdapJson, domain, rootDomain);
        if (parsed.registrar && parsed.registrar !== 'Unknown / Protected' || parsed.createdDate || parsed.nameservers.length > 0) {
          return parsed;
        }
      }
    } catch {}
  }

  const tld = rootDomain.split('.').pop() || '';
  const candidateServers: string[] = [];

  if (tld === 'com' || tld === 'net') candidateServers.push('whois.verisign-grs.com');
  else if (tld === 'org') candidateServers.push('whois.publicinterestregistry.org');
  else if (tld === 'uk') candidateServers.push('whois.nic.uk');
  else if (tld === 'io') candidateServers.push('whois.nic.io');
  else if (tld === 'ai') candidateServers.push('whois.nic.ai');
  else if (tld === 'ca') candidateServers.push('whois.cira.ca');
  else if (tld === 'de') candidateServers.push('whois.denic.de');
  else if (tld === 'fr') candidateServers.push('whois.nic.fr');
  else if (tld === 'me') candidateServers.push('whois.nic.me');
  else if (tld === 'co') candidateServers.push('whois.nic.co');
  else if (tld === 'au') candidateServers.push('whois.auda.org.au');

  candidateServers.push(`whois.nic.${tld}`);
  candidateServers.push(`whois.${tld}`);
  candidateServers.push('whois.iana.org');

  for (const server of candidateServers) {
    try {
      const rawWhois = await tcpWhois(rootDomain, server, 3000);
      if (rawWhois && rawWhois.trim().length > 60) {
        const referral = rawWhois.match(/(?:Registrar WHOIS Server|refer):\s*([^\r\n]+)/i)?.[1]?.trim();
        let combinedText = rawWhois;

        if (referral && !referral.toLowerCase().includes(server.toLowerCase()) && !referral.startsWith('http')) {
          try {
            const referredWhois = await tcpWhois(rootDomain, referral, 3000);
            if (referredWhois && referredWhois.trim().length > 60) {
              combinedText = referredWhois + '\n\n--- Registry WHOIS ---\n' + rawWhois;
            }
          } catch {}
        }

        const parsed = parseWhoisText(combinedText, domain, rootDomain);
        if (parsed && (parsed.registrar !== 'Protected / Not Disclosed' || parsed.createdDate || parsed.nameservers.length > 0)) {
          return parsed;
        }
      }
    } catch {}
  }

  try {
    const fallbackController = new AbortController();
    const fallbackTimeout = setTimeout(() => fallbackController.abort(), 3500);
    const fallbackRes = await safeFetch(`https://rdap-bootstrap.arin.net/bootstrap/domain/${encodeURIComponent(rootDomain)}`, {
      signal: fallbackController.signal,
      headers: {
        'User-Agent': ua,
        Accept: 'application/rdap+json, application/json',
      },
      maxRedirects: 3,
    });
    clearTimeout(fallbackTimeout);
    if (fallbackRes.ok) {
      const fallbackJson = await fallbackRes.json();
      return parseRdapData(fallbackJson, domain, rootDomain);
    }
  } catch {}

  return null;
}

const crtCache = new Map<string, { data: any; timestamp: number }>();

async function fetchCrtNameSubdomains(apexDomain: string, userAgentOrReq?: string | express.Request): Promise<any> {
  const cleanApex = apexDomain.toLowerCase().trim().replace(/:\d+$/, '').replace(/^\.+|\.+$/g, '');
  if (!cleanApex || isPrivateOrLocalHost(cleanApex)) {
    return {
      apexDomain: cleanApex,
      count: 0,
      subdomains: [],
      fetchedAt: Date.now(),
      sourceUrl: `https://crt.name/v1/search?apex=${encodeURIComponent(cleanApex)}`,
      error: 'Localhost or private networks are disallowed.',
    };
  }

  const cached = crtCache.get(cleanApex);
  if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) {
    return cached.data;
  }

  const sourceUrl = `https://crt.name/v1/search?apex=${encodeURIComponent(cleanApex)}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    const res = await safeFetch(sourceUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': getUserAgent(userAgentOrReq),
      },
      maxRedirects: 3,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errRes = {
        apexDomain: cleanApex,
        count: 0,
        subdomains: [],
        fetchedAt: Date.now(),
        sourceUrl,
        error: `crt.name service returned HTTP ${res.status}`,
      };
      crtCache.set(cleanApex, { data: errRes, timestamp: Date.now() });
      return errRes;
    }

    const text = await res.text();
    let subdomains: string[] = [];

    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        subdomains = parsed
          .map((item: any) => (item.sub || item.name || (typeof item === 'string' ? item : '')).trim())
          .filter(Boolean);
      }
    } catch {
      subdomains = text.split('\n').map((l) => l.trim()).filter(Boolean);
    }

    const set = new Set<string>();
    for (const sub of subdomains) {
      const cleanSub = sub.toLowerCase().replace(/\s+/g, '').replace(/^\.+|\.+$/g, '');
      if (cleanSub) {
        set.add(cleanSub);
      }
    }

    const sortedSubdomains = Array.from(set).sort((a, b) => {
      if (a === cleanApex) return -1;
      if (b === cleanApex) return 1;
      const depthA = a.split('.').length;
      const depthB = b.split('.').length;
      if (depthA !== depthB) return depthA - depthB;
      return a.localeCompare(b);
    });

    const data = {
      apexDomain: cleanApex,
      count: sortedSubdomains.length,
      subdomains: sortedSubdomains,
      fetchedAt: Date.now(),
      sourceUrl,
    };

    crtCache.set(cleanApex, { data, timestamp: Date.now() });
    return data;
  } catch (err: any) {
    const errData = {
      apexDomain: cleanApex,
      count: 0,
      subdomains: [],
      fetchedAt: Date.now(),
      sourceUrl,
      error: err.message || 'Failed to connect to crt.name service',
    };
    return errData;
  }
}

app.get('/api/domain-info', async (req, res) => {
  const userIdentifier = extractUserIdentifier(req);
  const rate = checkRateLimit('domainInfo', userIdentifier, 25, 60_000);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSec));
    return res.status(429).json({
      error: `Rate limit exceeded: Too many domain intelligence queries. Please wait ${rate.retryAfterSec}s before retrying.`,
      retryAfter: rate.retryAfterSec,
    });
  }

  const userAgent = getUserAgent(req);
  const rawDomain = req.query.domain as string;
  if (!rawDomain) {
    return res.status(400).json({ error: 'Domain or URL parameter is required' });
  }

  let domain = rawDomain.trim();
  try {
    if (/^https?:\/\//i.test(domain)) {
      domain = new URL(domain).hostname;
    } else if (domain.includes('/')) {
      domain = domain.split('/')[0];
    }
  } catch {
    // keep as is
  }

  domain = domain.toLowerCase().replace(/:\d+$/, '');

  if (isPrivateOrLocalHost(domain)) {
    return res.status(400).json({ error: 'Localhost and private network lookups are disallowed.' });
  }

  const result: any = {
    domain,
    fetchedAt: Date.now(),
    dns: [],
    whois: null,
    ssl: null,
    server: null,
  };

  const dnsRecords: any[] = [];
  const recordTypes = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'CAA'];

  await Promise.all(
    recordTypes.map(async (type) => {
      try {
        switch (type) {
          case 'A': {
            try {
              const records = await dns.resolve4(domain, { ttl: true });
              records.forEach((r) => {
                dnsRecords.push({ type: 'A', name: domain, value: r.address, ttl: r.ttl });
                if (!result.resolvedIp) result.resolvedIp = r.address;
              });
            } catch {
              const answers = await fetchDnsOverHttps(domain, 'A', userAgent);
              answers.forEach((ans: any) => {
                dnsRecords.push({ type: 'A', name: ans.name || domain, value: ans.data, ttl: ans.TTL });
                if (!result.resolvedIp) result.resolvedIp = ans.data;
              });
            }
            break;
          }
          case 'AAAA': {
            try {
              const records = await dns.resolve6(domain, { ttl: true });
              records.forEach((r) => {
                dnsRecords.push({ type: 'AAAA', name: domain, value: r.address, ttl: r.ttl });
              });
            } catch {
              const answers = await fetchDnsOverHttps(domain, 'AAAA', userAgent);
              answers.forEach((ans: any) => {
                dnsRecords.push({ type: 'AAAA', name: ans.name || domain, value: ans.data, ttl: ans.TTL });
              });
            }
            break;
          }
          case 'MX': {
            try {
              const records = await dns.resolveMx(domain);
              records.forEach((r) => {
                dnsRecords.push({ type: 'MX', name: domain, value: r.exchange, priority: r.priority });
              });
            } catch {
              const answers = await fetchDnsOverHttps(domain, 'MX', userAgent);
              answers.forEach((ans: any) => {
                dnsRecords.push({ type: 'MX', name: ans.name || domain, value: ans.data, ttl: ans.TTL });
              });
            }
            break;
          }
          case 'TXT': {
            try {
              const records = await dns.resolveTxt(domain);
              records.forEach((chunk) => {
                dnsRecords.push({ type: 'TXT', name: domain, value: chunk.join(' ') });
              });
            } catch {
              const answers = await fetchDnsOverHttps(domain, 'TXT', userAgent);
              answers.forEach((ans: any) => {
                dnsRecords.push({ type: 'TXT', name: ans.name || domain, value: ans.data?.replace(/^"|"$/g, ''), ttl: ans.TTL });
              });
            }
            break;
          }
          case 'NS': {
            try {
              const records = await dns.resolveNs(domain);
              records.forEach((r) => {
                dnsRecords.push({ type: 'NS', name: domain, value: r });
              });
            } catch {
              const answers = await fetchDnsOverHttps(domain, 'NS', userAgent);
              answers.forEach((ans: any) => {
                dnsRecords.push({ type: 'NS', name: ans.name || domain, value: ans.data, ttl: ans.TTL });
              });
            }
            break;
          }
          case 'CNAME': {
            try {
              const records = await dns.resolveCname(domain);
              records.forEach((r) => {
                dnsRecords.push({ type: 'CNAME', name: domain, value: r });
              });
            } catch {
              const answers = await fetchDnsOverHttps(domain, 'CNAME', userAgent);
              answers.forEach((ans: any) => {
                dnsRecords.push({ type: 'CNAME', name: ans.name || domain, value: ans.data, ttl: ans.TTL });
              });
            }
            break;
          }
          case 'SOA': {
            try {
              const record = await dns.resolveSoa(domain);
              dnsRecords.push({
                type: 'SOA',
                name: domain,
                value: `Primary NS: ${record.nsname}, Hostmaster: ${record.hostmaster}, Serial: ${record.serial}`,
              });
            } catch {
              const answers = await fetchDnsOverHttps(domain, 'SOA', userAgent);
              answers.forEach((ans: any) => {
                dnsRecords.push({ type: 'SOA', name: ans.name || domain, value: ans.data, ttl: ans.TTL });
              });
            }
            break;
          }
          case 'CAA': {
            try {
              const records = await dns.resolveCaa(domain);
              records.forEach((r) => {
                dnsRecords.push({ type: 'CAA', name: domain, value: `${r.issue || r.issuewild || r.iodef} (${r.critical})` });
              });
            } catch {
              const answers = await fetchDnsOverHttps(domain, 'CAA', userAgent);
              answers.forEach((ans: any) => {
                dnsRecords.push({ type: 'CAA', name: ans.name || domain, value: ans.data, ttl: ans.TTL });
              });
            }
            break;
          }
        }
      } catch {
        // ignore missing record type
      }
    })
  );

  result.dns = dnsRecords;

  try {
    result.whois = await resolveDomainWhoisAndRdap(domain, userAgent);
  } catch (whoisErr) {
    // WHOIS lookup fallback
  }

  try {
    await new Promise<void>((resolve) => {
      const socket = tls.connect(
        {
          host: domain,
          port: 443,
          servername: domain,
          rejectUnauthorized: false,
          timeout: 3500,
        },
        () => {
          try {
            const cert = socket.getPeerCertificate(true);
            if (cert && cert.valid_to) {
              const validToDate = new Date(cert.valid_to);
              const now = new Date();
              const diffTime = validToDate.getTime() - now.getTime();
              const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

              const san = cert.subjectaltname
                ? cert.subjectaltname.split(', ').map((s: string) => s.replace(/^DNS:/, ''))
                : [];

              result.ssl = {
                subject: cert.subject ? cert.subject.CN || cert.subject.O || '' : '',
                issuer: cert.issuer ? cert.issuer.O || cert.issuer.CN || '' : '',
                validFrom: cert.valid_from,
                validTo: cert.valid_to,
                daysRemaining,
                isExpired: daysRemaining < 0,
                san,
                fingerprint: cert.fingerprint256 || cert.fingerprint,
                serialNumber: cert.serialNumber,
                protocol: socket.getProtocol() || undefined,
              };
            }
          } catch {}
          socket.destroy();
          resolve();
        }
      );

      socket.on('error', () => {
        socket.destroy();
        resolve();
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve();
      });
    });
  } catch {
    // SSL check failure fallback
  }

  try {
    const httpController = new AbortController();
    const httpTimeout = setTimeout(() => httpController.abort(), 4000);
    const startReqTime = Date.now();

    const httpRes = await safeFetch(`https://${domain}`, {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        Accept: '*/*',
      },
      maxRedirects: 5,
      signal: httpController.signal,
    });
    const latencyMs = Date.now() - startReqTime;
    clearTimeout(httpTimeout);

    const rawHeaders: Record<string, string> = {};
    httpRes.headers.forEach((v, k) => {
      rawHeaders[k] = v;
    });

    result.server = {
      statusCode: httpRes.status,
      statusText: httpRes.statusText,
      server: httpRes.headers.get('server') || 'Unknown',
      hsts: httpRes.headers.get('strict-transport-security') || undefined,
      csp: httpRes.headers.get('content-security-policy') || undefined,
      xFrameOptions: httpRes.headers.get('x-frame-options') || undefined,
      xContentTypeOptions: httpRes.headers.get('x-content-type-options') || undefined,
      referrerPolicy: httpRes.headers.get('referrer-policy') || undefined,
      contentType: httpRes.headers.get('content-type') || undefined,
      contentLength: httpRes.headers.get('content-length') || undefined,
      latencyMs,
      rawHeaders,
    };
  } catch {
    // ignore
  }

  try {
    const robotsController = new AbortController();
    const robotsTimeout = setTimeout(() => robotsController.abort(), 3000);
    const robotsRes = await safeFetch(`https://${domain}/robots.txt`, {
      signal: robotsController.signal,
      headers: { 'User-Agent': userAgent },
      maxRedirects: 3,
    });
    clearTimeout(robotsTimeout);

    if (robotsRes.ok) {
      const robotsText = await robotsRes.text();
      if (result.server) {
        result.server.robotsTxtPresent = true;
        result.server.robotsTxtUrl = `https://${domain}/robots.txt`;
        result.server.robotsTxtContentPreview = robotsText.slice(0, 500);
      }
    }
  } catch {}

  try {
    const sitemapController = new AbortController();
    const sitemapTimeout = setTimeout(() => sitemapController.abort(), 3000);
    const sitemapRes = await safeFetch(`https://${domain}/sitemap.xml`, {
      signal: sitemapController.signal,
      headers: { 'User-Agent': userAgent },
      maxRedirects: 3,
    });
    clearTimeout(sitemapTimeout);

    if (sitemapRes.ok && result.server) {
      result.server.sitemapPresent = true;
      result.server.sitemapUrl = `https://${domain}/sitemap.xml`;
    }
  } catch {}

  try {
    const discoveredAi: Array<{ filename: string; url: string; size?: number; preview?: string }> = [];
    const probeBatch = async (filenames: readonly string[]) => {
      await Promise.all(
        filenames.map(async (fn) => {
          try {
            const c = new AbortController();
            const t = setTimeout(() => c.abort(), 2500);
            const r = await safeFetch(`https://${domain}/${fn}`, {
              signal: c.signal,
              headers: {
                'User-Agent': userAgent,
                'Accept': 'text/plain, text/markdown, application/json, text/x-markdown, */*',
              },
              maxRedirects: 3,
            });
            clearTimeout(t);
            if (r.ok) {
              const ct = (r.headers.get('content-type') || '').toLowerCase();
              const txt = await r.text();
              const trimmed = txt.trim();
              if (
                trimmed.length > 0 &&
                trimmed.length <= 2_500_000 &&
                !ct.includes('text/html') &&
                !/^(?:<!doctype|<html|<head|<body)/i.test(trimmed)
              ) {
                discoveredAi.push({
                  filename: fn,
                  url: `https://${domain}/${fn}`,
                  size: trimmed.length,
                  preview: trimmed.slice(0, 300),
                });
              }
            }
          } catch {}
        })
      );
    };

    for (let i = 0; i < AI_ASSISTANCE_FILENAMES.length; i += 6) {
      await probeBatch(AI_ASSISTANCE_FILENAMES.slice(i, i + 6));
    }

    if (result.server) {
      result.server.aiAssistancePresent = discoveredAi.length > 0;
      result.server.aiAssistanceCount = discoveredAi.length;
      result.server.aiAssistanceFiles = discoveredAi;
    }
  } catch {}

  try {
    const rootDomain = extractApexDomain(domain);
    result.crtSubdomains = await fetchCrtNameSubdomains(rootDomain, userAgent);
  } catch {
    // ignore
  }

  res.json(result);
});

app.get('/api/crt-subdomains', async (req, res) => {
  const userIdentifier = extractUserIdentifier(req);
  const rate = checkRateLimit('crtSubdomains', userIdentifier, 25, 60_000);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSec));
    return res.status(429).json({
      error: `Rate limit exceeded: Too many Certificate Transparency queries. Please wait ${rate.retryAfterSec}s before retrying.`,
      retryAfter: rate.retryAfterSec,
    });
  }

  const userAgent = getUserAgent(req);
  const rawDomain = (req.query.domain || req.query.apex) as string;
  if (!rawDomain) {
    return res.status(400).json({ error: 'domain or apex parameter is required' });
  }

  let domain = rawDomain.trim();
  try {
    if (/^https?:\/\//i.test(domain)) {
      domain = new URL(domain).hostname;
    } else if (domain.includes('/')) {
      domain = domain.split('/')[0];
    }
  } catch {}

  domain = domain.toLowerCase().replace(/:\d+$/, '');
  const apex = extractApexDomain(domain);
  const data = await fetchCrtNameSubdomains(apex, userAgent);
  res.json(data);
});

app.post('/api/crt-probe', async (req, res) => {
  const userIdentifier = extractUserIdentifier(req);
  const rate = checkRateLimit('crtProbe', userIdentifier, 15, 60_000);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSec));
    return res.status(429).json({
      error: `Rate limit exceeded: Too many subdomain probe requests. Please wait ${rate.retryAfterSec}s before retrying.`,
      retryAfter: rate.retryAfterSec,
    });
  }

  const userAgent = getUserAgent(req);
  const { subdomains } = req.body || {};
  if (!Array.isArray(subdomains) || subdomains.length === 0) {
    return res.status(400).json({ error: 'subdomains array is required' });
  }

  const batch = subdomains.slice(0, 60).map((s: unknown) => String(s).slice(0, 200));
  const results = await Promise.all(
    batch.map(async (rawHost: string) => {
      const host = String(rawHost).trim().toLowerCase();
      const cleanHost = host.replace(/^\*\./, '').replace(/:\d+$/, '');

      if (!cleanHost || isPrivateOrLocalHost(cleanHost)) {
        return {
          subdomain: host,
          isWildcard: host.startsWith('*.'),
          isLive: false,
          probed: true,
          error: 'Localhost or private network disallowed',
        };
      }

      const itemResult: {
        subdomain: string;
        isWildcard: boolean;
        isLive: boolean;
        ip?: string;
        cname?: string;
        statusCode?: number;
        latencyMs?: number;
        probed: boolean;
        error?: string;
      } = {
        subdomain: host,
        isWildcard: host.startsWith('*.'),
        isLive: false,
        probed: true,
      };

      const start = Date.now();
      try {
        let resolvedIps: string[] = [];
        try {
          resolvedIps = await dns.resolve4(cleanHost);
        } catch {
          try {
            const doh = await fetchDnsOverHttps(cleanHost, 'A', userAgent);
            resolvedIps = doh.map((d: any) => d.data).filter(Boolean);
          } catch {}
        }

        if (resolvedIps.length > 0) {
          itemResult.ip = resolvedIps[0];
          itemResult.isLive = true;
        }

        try {
          const cnames = await dns.resolveCname(cleanHost);
          if (cnames && cnames.length > 0) {
            itemResult.cname = cnames[0];
            itemResult.isLive = true;
          }
        } catch {}

        if (itemResult.isLive) {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 2800);
            const httpRes = await safeFetch(`https://${cleanHost}`, {
              method: 'GET',
              headers: { 'User-Agent': userAgent },
              signal: controller.signal,
              maxRedirects: 3,
            });
            clearTimeout(timeout);
            itemResult.statusCode = httpRes.status;
            itemResult.latencyMs = Date.now() - start;
          } catch {
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 2200);
              const httpRes = await safeFetch(`http://${cleanHost}`, {
                method: 'GET',
                headers: { 'User-Agent': userAgent },
                signal: controller.signal,
                maxRedirects: 3,
              });
              clearTimeout(timeout);
              itemResult.statusCode = httpRes.status;
              itemResult.latencyMs = Date.now() - start;
            } catch {}
          }
        }
      } catch (err: any) {
        itemResult.error = err.message || 'Probe failed';
      }

      return itemResult;
    })
  );

  res.json({ results });
});

const isCandidateApi = (_urlStr: string, pName: string, host: string) => {
  const cleanPath = pName.toLowerCase();
  const cleanHost = host.toLowerCase();
  if (
    cleanPath.startsWith('/api/') ||
    cleanPath.startsWith('/apis/') ||
    cleanPath === '/api' ||
    cleanPath === '/apis' ||
    cleanPath.includes('/v1/') ||
    cleanPath.includes('/v2/') ||
    cleanPath.includes('/v3/') ||
    cleanPath.includes('/v4/') ||
    cleanPath.includes('/v0/') ||
    cleanPath.includes('/rest/') ||
    cleanPath.includes('/graphql') ||
    cleanPath.includes('/trpc') ||
    cleanPath.includes('/rpc/') ||
    cleanPath.includes('/jsonrpc') ||
    cleanPath.includes('/_next/data/') ||
    cleanPath.includes('/wp-json/') ||
    cleanPath.includes('/webhook') ||
    cleanPath.includes('/oauth/') ||
    cleanPath.includes('/.well-known/') ||
    cleanPath.includes('/services/') ||
    cleanPath.includes('/service/') ||
    cleanPath.includes('/backend/') ||
    cleanPath.includes('/ajax/') ||
    cleanPath.includes('/swagger') ||
    cleanPath.includes('/openapi') ||
    cleanPath.endsWith('.json') ||
    cleanPath.endsWith('.jsonld') ||
    cleanPath.endsWith('.graphql') ||
    cleanHost.startsWith('api.') ||
    cleanHost.startsWith('apis.') ||
    cleanHost.startsWith('api-') ||
    cleanHost.startsWith('graphql.') ||
    cleanHost.includes('api.github.com') ||
    cleanHost.includes('api.stripe.com') ||
    cleanHost.includes('googleapis.com') ||
    cleanHost.includes('algolia.net') ||
    cleanHost.includes('supabase.co') ||
    cleanHost.includes('firebaseio.com')
  ) {
    return true;
  }
  return false;
};

const classifyCategory = (cleanUrl: string, pName: string): ApiCategory => {
  const lower = (cleanUrl + ' ' + pName).toLowerCase();
  if (lower.includes('graphql')) return 'graphql';
  if (
    lower.includes('/auth') ||
    lower.includes('/oauth') ||
    lower.includes('/token') ||
    lower.includes('/login') ||
    lower.includes('/session') ||
    lower.includes('/.well-known/')
  ) {
    return 'auth';
  }
  if (lower.includes('/trpc') || lower.includes('/rpc') || lower.includes('/jsonrpc')) {
    return 'rpc';
  }
  if (lower.includes('/webhook') || lower.includes('/hook')) return 'webhook';
  if (lower.includes('/feed') || lower.includes('/rss')) return 'feed';
  if (pName.toLowerCase().endsWith('.json') || pName.toLowerCase().endsWith('.jsonld')) return 'json';
  return 'rest';
};

function extractKeysFromJsObject(objStr: string): string[] {
  const keys: string[] = [];
  const keyRegex = /(?:['"`]([a-zA-Z0-9_$-]+)['"`]|([a-zA-Z0-9_$]+))\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = keyRegex.exec(objStr)) !== null) {
    const k = m[1] || m[2];
    if (
      k &&
      !['method', 'headers', 'url', 'mode', 'credentials', 'cache', 'redirect', 'signal', 'referrer', 'referrerPolicy'].includes(k)
    ) {
      keys.push(k);
    }
  }
  return keys;
}

function extractKnownParamsFromJsSnippet(snippet: string, method?: ApiMethod): ApiQueryParameter[] {
  const result: ApiQueryParameter[] = [];
  const seen = new Set<string>();

  const add = (name: string, location: 'query' | 'body', desc: string, type: 'string' | 'number' | 'boolean' = 'string') => {
    const clean = name.trim();
    if (clean && !seen.has(clean) && /^[a-zA-Z0-9_$-]+$/.test(clean)) {
      seen.add(clean);
      result.push({
        name: clean,
        in: location,
        type,
        sampleValue: '1',
        description: desc,
        required: false,
        source: 'observed',
      });
    }
  };

  // 1. Check for params: { ... } in fetch / axios / request options
  const paramsMatch = snippet.match(/params\s*:\s*\{([^{}]+)\}/i);
  if (paramsMatch) {
    const keys = extractKeysFromJsObject(paramsMatch[1]);
    for (const k of keys) {
      add(k, 'query', 'Known query parameter in JavaScript params configuration');
    }
  }

  // 2. Check for data: { ... } or body: JSON.stringify({ ... }) or body: { ... }
  const bodyMatch = snippet.match(/(?:body|data)\s*:\s*(?:JSON\.stringify\()?\s*\{([^{}]+)\}/i);
  if (bodyMatch) {
    const keys = extractKeysFromJsObject(bodyMatch[1]);
    for (const k of keys) {
      add(k, method === 'GET' ? 'query' : 'body', 'Known payload parameter in JavaScript request body');
    }
  }

  // 3. Check for URLSearchParams({ ... })
  const uspObjMatch = snippet.match(/URLSearchParams\(\s*\{([^{}]+)\}\s*\)/i);
  if (uspObjMatch) {
    const keys = extractKeysFromJsObject(uspObjMatch[1]);
    for (const k of keys) {
      add(k, 'query', 'Known query parameter in JavaScript URLSearchParams');
    }
  }

  // 4. Check for URLSearchParams('...') query strings
  const uspStrMatch = snippet.match(/URLSearchParams\(\s*['"`]([^'"`]+)['"`]\s*\)/i);
  if (uspStrMatch) {
    try {
      const qp = new URLSearchParams(uspStrMatch[1]);
      qp.forEach((_, key) => {
        add(key, 'query', 'Known query parameter in JavaScript URLSearchParams string');
      });
    } catch {}
  }

  // 5. Check for .searchParams.append / .set or .params.append / .set
  const appendRegex = /(?:searchParams|params)\.(?:append|set)\(\s*['"`]([a-zA-Z0-9_$-]+)['"`]/gi;
  let appMatch: RegExpExecArray | null;
  while ((appMatch = appendRegex.exec(snippet)) !== null) {
    if (appMatch[1]) {
      add(appMatch[1], 'query', 'Known query parameter set via JavaScript searchParams API');
    }
  }

  // 6. Check for template strings or query string patterns in snippet (e.g. ?foo=${val}&bar=)
  const qsRegex = /[?&]([a-zA-Z0-9_$-]+)=/g;
  let qsMatch: RegExpExecArray | null;
  while ((qsMatch = qsRegex.exec(snippet)) !== null) {
    if (qsMatch[1] && !['http', 'https', 'www'].includes(qsMatch[1].toLowerCase())) {
      add(qsMatch[1], 'query', 'Known query parameter in JavaScript URL query string');
    }
  }

  return result;
}

function extractKnownApiParametersAndQueries(
  urlStr: string,
  method: ApiMethod = 'GET',
  _category: ApiCategory = 'rest',
  observedSnippet?: string,
  existingQueryParams: string[] = [],
  passedParameters: ApiQueryParameter[] = []
): {
  possibleParameters: ApiQueryParameter[];
  possibleQueries: ApiPossibleQuery[];
  sampleQueryUrl: string;
  queryCapabilitiesSummary: string;
} {
  const possibleParameters: ApiQueryParameter[] = [];
  const paramNames = new Set<string>();

  const addParam = (p: ApiQueryParameter) => {
    if (!paramNames.has(p.name)) {
      paramNames.add(p.name);
      possibleParameters.push(p);
    }
  };

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return {
      possibleParameters: [],
      possibleQueries: [],
      sampleQueryUrl: urlStr,
      queryCapabilitiesSummary: 'Invalid URL format',
    };
  }

  // 1. Observed URL search parameters directly from the URL in page source
  parsed.searchParams.forEach((val, key) => {
    const isNum = !isNaN(Number(val)) && val.trim() !== '';
    const isBool = val === 'true' || val === 'false';
    addParam({
      name: key,
      in: 'query',
      type: isNum ? 'number' : isBool ? 'boolean' : 'string',
      sampleValue: val || '1',
      description: 'Known query parameter observed in URL',
      required: false,
      source: 'observed',
    });
  });

  // 2. Existing query parameters discovered from DOM / context
  for (const p of existingQueryParams) {
    addParam({
      name: p,
      in: 'query',
      type: 'string',
      sampleValue: '1',
      description: 'Known query parameter observed in page source context',
      required: false,
      source: 'observed',
    });
  }

  // 3. Explicit path parameter placeholders in the URL path (e.g. /users/{userId}, /posts/:id)
  const pathParts = parsed.pathname.split('/').filter(Boolean);
  for (const part of pathParts) {
    if (/^\{[a-zA-Z0-9_-]+\}$/.test(part)) {
      const pName = part.replace(/^\{|\}$/g, '');
      addParam({
        name: pName,
        in: 'path',
        type: 'string',
        sampleValue: '1',
        description: `Path variable specified in template: {${pName}}`,
        required: true,
        source: 'observed',
      });
    } else if (/^:[a-zA-Z0-9_-]+$/.test(part)) {
      const pName = part.slice(1);
      addParam({
        name: pName,
        in: 'path',
        type: 'string',
        sampleValue: '1',
        description: `Path parameter placeholder: :${pName}`,
        required: true,
        source: 'observed',
      });
    }
  }

  // 4. Any parameters passed in (from HTML forms, OpenAPI schema, or previous discovery)
  for (const p of passedParameters) {
    addParam(p);
  }

  // 5. Extract known parameters from JavaScript snippet if present
  if (observedSnippet) {
    const jsParams = extractKnownParamsFromJsSnippet(observedSnippet, method);
    for (const jp of jsParams) {
      addParam(jp);
    }
  }

  // CRITICAL: DO NOT INFER ANY PARAMETERS.
  // No guessing standard REST params (q, page, limit, sort, order, status, format).
  // No guessing OAuth params (grant_type, client_id, scope, redirect_uri).
  // No guessing numeric IDs in path segments (userId).
  // ONLY known parameters based on javascript and URLs in the source of a page.

  // 6. Build query invocations using ONLY known parameters
  const baseUrlClean = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  const possibleQueries: ApiPossibleQuery[] = [];
  const stdMethod = method === 'UNKNOWN' ? 'GET' : method;

  const queryParams = possibleParameters.filter((p) => p.in === 'query');
  const bodyParams = possibleParameters.filter((p) => p.in === 'body');

  let stdCurl = `curl -X ${stdMethod} "${parsed.href}" -H "Accept: application/json"`;
  if (stdMethod === 'POST' || stdMethod === 'PUT' || stdMethod === 'PATCH') {
    const sampleBody: Record<string, any> = {};
    for (const bp of bodyParams) {
      sampleBody[bp.name] = bp.sampleValue || 'sample';
    }
    const bodyStr = Object.keys(sampleBody).length > 0 ? JSON.stringify(sampleBody) : '{}';
    stdCurl = `curl -X ${stdMethod} "${baseUrlClean}" -H "Accept: application/json" -H "Content-Type: application/json" -d '${bodyStr}'`;
  }

  possibleQueries.push({
    title: 'Standard Fetch Query',
    method: stdMethod,
    url: parsed.href,
    description: possibleParameters.length > 0
      ? `Query using ${possibleParameters.length} known parameter${possibleParameters.length === 1 ? '' : 's'} from page source`
      : 'Direct endpoint query invocation without parameters',
    params: possibleParameters,
    curlExample: stdCurl,
  });

  // If there are known query parameters not already in the base URL, construct a parameterized query with all known parameters
  if (queryParams.length > 0) {
    try {
      const qUrl = new URL(baseUrlClean);
      for (const qp of queryParams) {
        qUrl.searchParams.set(qp.name, qp.sampleValue || '1');
      }
      if (qUrl.href !== parsed.href) {
        possibleQueries.push({
          title: 'Parameterized Query',
          method: stdMethod === 'POST' ? 'GET' : stdMethod,
          url: qUrl.href,
          description: `Executes query using known parameters: ${queryParams.map((p) => p.name).join(', ')}`,
          params: queryParams,
          curlExample: `curl -X ${stdMethod === 'POST' ? 'GET' : stdMethod} "${qUrl.href}" -H "Accept: application/json"`,
        });
      }
    } catch {}
  }

  // OPTIONS capability query
  possibleQueries.push({
    title: 'OPTIONS Capability Query',
    method: 'OPTIONS',
    url: baseUrlClean,
    description: 'Discovers allowed HTTP methods, CORS permissions, and headers',
    params: [],
    curlExample: `curl -X OPTIONS "${baseUrlClean}" -i`,
  });

  const sampleQueryUrl = possibleQueries[0]?.url || parsed.href;
  const queryCapabilitiesSummary = possibleParameters.length > 0
    ? `${possibleParameters.length} known parameter${possibleParameters.length === 1 ? '' : 's'} • ${possibleQueries.length} queries mapped`
    : `0 parameters discovered in source • ${possibleQueries.length} direct queries`;

  return {
    possibleParameters,
    possibleQueries,
    sampleQueryUrl,
    queryCapabilitiesSummary,
  };
}

// Backward-compatible alias
const inferApiEndpointQueries = extractKnownApiParametersAndQueries;

async function activeQueryAndMapApiEndpoint(
  endpointUrl: string,
  userAgent: string,
  observedSnippet?: string
): Promise<{
  statusCode: number;
  statusText: string;
  latencyMs: number;
  contentType: string;
  allowedMethods: ApiMethod[];
  possibleParameters: ApiQueryParameter[];
  possibleQueries: ApiPossibleQuery[];
  sampleQueryUrl: string;
  graphqlFields?: string[];
  responsePreview?: string;
  queryCapabilitiesSummary: string;
  authHint?: string;
}> {
  let parsed: URL;
  try {
    parsed = new URL(endpointUrl.trim());
  } catch {
    throw new Error('Invalid URL provided');
  }

  if (isPrivateOrLocalHost(parsed.hostname)) {
    throw new Error('Probing localhost or private networks is disallowed');
  }

  const category = classifyCategory(endpointUrl, parsed.pathname);
  const baseline = inferApiEndpointQueries(endpointUrl, 'GET', category, observedSnippet);
  const possibleParameters = [...baseline.possibleParameters];
  const possibleQueries = [...baseline.possibleQueries];

  const allowedMethodsSet = new Set<ApiMethod>();
  let authHint: string | undefined = undefined;
  let responsePreview: string | undefined = undefined;
  let graphqlFields: string[] | undefined = undefined;

  // 1. Probe with OPTIONS to discover allowed methods and headers
  try {
    const optCtrl = new AbortController();
    const optTimeout = setTimeout(() => optCtrl.abort(), 3500);
    const optRes = await safeFetch(parsed.href, {
      method: 'OPTIONS',
      headers: {
        'User-Agent': userAgent,
        Accept: '*/*',
      },
      signal: optCtrl.signal,
      maxRedirects: 3,
    });
    clearTimeout(optTimeout);

    const allowHeader = optRes.headers.get('allow');
    if (allowHeader) {
      const parts = allowHeader.split(',').map((m) => m.trim().toUpperCase());
      for (const m of parts) {
        if (['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(m)) {
          allowedMethodsSet.add(m as ApiMethod);
        }
      }
    }

    const corsMethods = optRes.headers.get('access-control-allow-methods');
    if (corsMethods) {
      const parts = corsMethods.split(',').map((m) => m.trim().toUpperCase());
      for (const m of parts) {
        if (['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(m)) {
          allowedMethodsSet.add(m as ApiMethod);
        }
      }
    }

    const corsHeaders = (optRes.headers.get('access-control-allow-headers') || '').toLowerCase();
    if (corsHeaders.includes('authorization') || corsHeaders.includes('bearer')) {
      authHint = 'Bearer Token';
    } else if (corsHeaders.includes('api-key') || corsHeaders.includes('apikey')) {
      authHint = 'API Key';
    }
  } catch {}

  // 2. Query endpoint via GET (or POST if GraphQL) to inspect response schema
  const start = Date.now();
  let statusCode = 0;
  let statusText = '';
  let contentType = '';
  let latencyMs = 0;

  try {
    const getCtrl = new AbortController();
    const getTimeout = setTimeout(() => getCtrl.abort(), 4500);

    const isGraphQl = category === 'graphql' || parsed.pathname.toLowerCase().includes('graphql');
    const fetchMethod = isGraphQl ? 'POST' : 'GET';
    const fetchBody = isGraphQl ? JSON.stringify({ query: '{ __typename }' }) : undefined;
    const fetchHeaders: Record<string, string> = {
      'User-Agent': userAgent,
      Accept: 'application/json, text/plain, */*',
    };
    if (isGraphQl) {
      fetchHeaders['Content-Type'] = 'application/json';
    }

    const res = await safeFetch(parsed.href, {
      method: fetchMethod,
      headers: fetchHeaders,
      body: fetchBody,
      signal: getCtrl.signal,
      maxRedirects: 3,
    });
    clearTimeout(getTimeout);

    latencyMs = Date.now() - start;
    statusCode = res.status;
    statusText = res.statusText;
    contentType = res.headers.get('content-type') || '';

    if (statusCode >= 200 && statusCode < 300) {
      allowedMethodsSet.add(isGraphQl ? 'POST' : 'GET');
    }

    const rawText = await res.text();
    if (rawText) {
      responsePreview = rawText.slice(0, 1000).trim();

      // Analyze JSON response (inspect GraphQL if applicable)
      if (contentType.includes('application/json') || rawText.trim().startsWith('{') || rawText.trim().startsWith('[')) {
        try {
          const parsedData = JSON.parse(rawText);

          // If GraphQL query response with __typename or data
          if (isGraphQl && parsedData && typeof parsedData === 'object' && parsedData.data) {
              try {
                const introCtrl = new AbortController();
                const introTimeout = setTimeout(() => introCtrl.abort(), 3500);
                const introRes = await safeFetch(parsed.href, {
                  method: 'POST',
                  headers: {
                    'User-Agent': userAgent,
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                  },
                  body: JSON.stringify({
                    query: '{ __schema { queryType { fields { name args { name } } } } }',
                  }),
                  signal: introCtrl.signal,
                });
                clearTimeout(introTimeout);

                if (introRes.ok) {
                  const introJson = await introRes.json();
                  const fields = introJson?.data?.__schema?.queryType?.fields;
                  if (Array.isArray(fields) && fields.length > 0) {
                    graphqlFields = fields.map((f: any) => String(f.name)).slice(0, 30);
                    for (const f of fields.slice(0, 10)) {
                      possibleQueries.push({
                        title: `GraphQL Query: ${f.name}`,
                        method: 'POST',
                        url: `${parsed.protocol}//${parsed.host}${parsed.pathname}`,
                        description: `Queries discovered GraphQL field '${f.name}'`,
                        params: (f.args || []).map((a: any) => ({
                          name: a.name,
                          in: 'body' as const,
                          type: 'string' as const,
                          sampleValue: 'value',
                          description: `Argument for field ${f.name}`,
                          required: false,
                          source: 'graphql' as const,
                        })),
                        curlExample: `curl -X POST "${parsed.href}" -H "Content-Type: application/json" -d '{"query":"{ ${f.name} { id } }"}'`,
                      });
                    }
                  }
                }
              } catch {}
            }
        } catch {}
      }
    }
  } catch (err: any) {
    latencyMs = Date.now() - start;
    statusCode = 0;
    statusText = err.name === 'AbortError' ? 'Timeout' : 'Network Error';
  }

  if (allowedMethodsSet.size === 0) {
    allowedMethodsSet.add(category === 'graphql' ? 'POST' : 'GET');
    allowedMethodsSet.add('OPTIONS');
  }

  const allowedMethods = Array.from(allowedMethodsSet);
  const sampleQueryUrl = possibleQueries[0]?.url || parsed.href;
  const methodsStr = allowedMethods.join(', ');
  const queriesCount = possibleQueries.length;
  const paramsCount = possibleParameters.length;
  const queryCapabilitiesSummary = `Allowed: ${methodsStr} • ${paramsCount} params • ${queriesCount} possible queries mapped`;

  return {
    statusCode,
    statusText,
    latencyMs,
    contentType,
    allowedMethods,
    possibleParameters,
    possibleQueries,
    sampleQueryUrl,
    graphqlFields,
    responsePreview,
    queryCapabilitiesSummary,
    authHint,
  };
}

app.post('/api/api-probe', async (req, res) => {
  const userIdentifier = extractUserIdentifier(req);
  const rate = checkRateLimit('apiProbe', userIdentifier, 40, 60_000);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSec));
    return res.status(429).json({
      error: `Rate limit exceeded: Please wait ${rate.retryAfterSec}s before probing again.`,
      retryAfter: rate.retryAfterSec,
    });
  }

  const userAgent = getUserAgent(req);
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url string is required' });
  }

  try {
    const result = await activeQueryAndMapApiEndpoint(url, userAgent);
    res.json({
      url,
      ...result,
    });
  } catch (err: any) {
    res.status(400).json({
      error: err.message || 'Probe request failed',
      statusCode: 0,
      latencyMs: 0,
    });
  }
});

app.post('/api/api-map', async (req, res) => {
  const userIdentifier = extractUserIdentifier(req);
  const rate = checkRateLimit('apiProbe', userIdentifier, 40, 60_000);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSec));
    return res.status(429).json({
      error: `Rate limit exceeded: Please wait ${rate.retryAfterSec}s before mapping again.`,
      retryAfter: rate.retryAfterSec,
    });
  }

  const userAgent = getUserAgent(req);
  const { urls } = req.body || {};
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'urls array is required' });
  }

  const batch = urls.slice(0, 15).map((u) => String(u).trim()).filter(Boolean);
  const results = await Promise.all(
    batch.map(async (u) => {
      try {
        const mapped = await activeQueryAndMapApiEndpoint(u, userAgent);
        return { url: u, success: true, ...mapped };
      } catch (err: any) {
        return { url: u, success: false, error: err.message || 'Mapping failed' };
      }
    })
  );

  res.json({ results });
});

app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl || typeof targetUrl !== 'string') {
    return res.status(400).json({ error: 'url query parameter is required' });
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl.trim());
  } catch {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  if (isPrivateOrLocalHost(parsed.hostname)) {
    return res.status(400).json({ error: 'Proxying to localhost or private network hosts is disallowed' });
  }

  const userAgent = getUserAgent(req);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    const upstream = await safeFetch(parsed.href, {
      headers: {
        'User-Agent': userAgent,
        Accept: (req.headers['accept'] as string) || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
      maxRedirects: 5,
    });
    clearTimeout(timeout);

    const contentType = upstream.headers.get('content-type') || 'text/plain';
    const xRobots = upstream.headers.get('x-robots-tag');
    const linkHeader = upstream.headers.get('link');

    res.status(upstream.status);
    res.setHeader('Content-Type', contentType);
    if (xRobots) res.setHeader('X-Robots-Tag', xRobots);
    if (linkHeader) res.setHeader('Link', linkHeader);
    if ((upstream as any).redirectChain) {
      res.setHeader('X-Redirect-Chain', JSON.stringify((upstream as any).redirectChain));
    }

    const bounded = await safeReadBoundedBody(upstream, 2_000_000);
    res.send(bounded.text);
  } catch (err: any) {
    if (err.isCircularRedirect) {
      return res.status(310).json({
        error: err.message,
        redirectChain: err.redirectChain,
      });
    }
    res.status(502).json({
      error: err.message || 'Upstream fetch failed',
    });
  }
});

app.get('/api/crawl/stream', async (req, res) => {
  const userIdentifier = extractUserIdentifier(req);
  const userAgent = getUserAgent(req);

  if (activeCrawlsPerUser.has(userIdentifier)) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`event: error_event\ndata: ${JSON.stringify({
      message: 'Concurrent crawl limit: An active crawl session is already in progress for your IP. Please wait or stop the ongoing crawl before starting a new one.'
    })}\n\n`);
    res.end();
    return;
  }

  const crawlRate = checkRateLimit('crawlStream', userIdentifier, 6, 60_000);
  if (!crawlRate.allowed) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Retry-After', String(crawlRate.retryAfterSec));
    res.flushHeaders?.();
    res.write(`event: error_event\ndata: ${JSON.stringify({
      message: `Rate limit exceeded: Too many crawl requests initiated. Please wait ${crawlRate.retryAfterSec}s before starting another crawl.`
    })}\n\n`);
    res.end();
    return;
  }

  const rawStartUrl = req.query.startUrl as string;
  if (!rawStartUrl) {
    res.status(400).json({ error: 'startUrl is required' });
    return;
  }

  let startUrl = rawStartUrl.trim();
  if (!/^https?:\/\//i.test(startUrl)) {
    startUrl = 'https://' + startUrl;
  }

  let parsedStartUrl: URL;
  try {
    parsedStartUrl = new URL(startUrl);
  } catch {
    res.status(400).json({ error: 'Invalid start URL provided' });
    return;
  }

  if (isPrivateOrLocalHost(parsedStartUrl.hostname)) {
    res.status(400).json({ error: 'Crawling localhost or private networks is disallowed.' });
    return;
  }

  const parsedDepth = parseInt(req.query.maxDepth as string, 10);
  const maxDepth = !isNaN(parsedDepth) && parsedDepth >= 1 ? Math.min(parsedDepth, 9999) : 3;

  const parsedPages = parseInt(req.query.maxPages as string, 10);
  const maxPages = !isNaN(parsedPages) && parsedPages >= 1 ? Math.min(parsedPages, 9999) : 50;

  const allowSubdomains = req.query.allowSubdomains === 'true';
  const queryCrtSubdomains = req.query.queryCrtSubdomains === 'true';
  const stripQueryParams = req.query.stripQueryParams === 'true';
  const stripHash = req.query.stripHash === 'true';
  const includeRobotsTxt = req.query.includeRobotsTxt === 'true';
  const includeAiAssistance = req.query.includeAiAssistance === 'true';
  const captureApiCalls = req.query.captureApiCalls === 'true';
  const autoQueryApis = req.query.autoQueryApis === 'true';
  const randomizeUserAgent = req.query.randomizeUserAgent === 'true';

  const getEffectiveUserAgent = () => (randomizeUserAgent ? getRandomUserAgent() : userAgent);

  const parsedConcurrency = parseInt(req.query.concurrency as string, 10);
  const concurrency = !isNaN(parsedConcurrency) && parsedConcurrency >= 1 ? Math.min(parsedConcurrency, 8) : 3;

  const parsedDelay = parseInt(req.query.requestDelayMs as string, 10);
  const rawDelay = !isNaN(parsedDelay) ? parsedDelay : 150;
  const requestDelayMs = Math.min(Math.max(rawDelay, MIN_REQUEST_DELAY_MS), 9999);
  const delayWasFloored = rawDelay < MIN_REQUEST_DELAY_MS;

  const pathFilter = typeof req.query.pathFilter === 'string' ? req.query.pathFilter.trim().slice(0, 200) : '';
  const excludeFilter = typeof req.query.excludeFilter === 'string' ? req.query.excludeFilter.trim().slice(0, 200) : '';

  const pathFilterRegex = safeCompileRegex(pathFilter);
  const excludeFilterRegex = safeCompileRegex(excludeFilter);

  const baseHostname = parsedStartUrl.hostname.toLowerCase();
  const originBase = `${parsedStartUrl.protocol}//${parsedStartUrl.host}`;
  const normalizedStart = cleanUrl(parsedStartUrl.href, baseHostname, stripQueryParams, stripHash) || parsedStartUrl.href;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  activeCrawlsPerUser.add(userIdentifier);

  const sendEvent = (event: string, data: any) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const sendLog = (level: 'info' | 'warn' | 'error' | 'success', message: string) => {
    sendEvent('log', { level, message, timestamp: Date.now() });
  };

  let isAborted = false;
  const abortController = new AbortController();

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    activeCrawlsPerUser.delete(userIdentifier);
    isAborted = true;
    abortController.abort();
  };

  req.on('close', cleanup);
  res.on('finish', cleanup);
  res.on('close', cleanup);

  if (delayWasFloored) {
    sendLog('warn', `[Politeness Guard] Requested delay of ${rawDelay}ms raised to enforced floor of ${MIN_REQUEST_DELAY_MS}ms to prevent aggressive server flooding.`);
  }

  if (randomizeUserAgent) {
    sendLog('info', '[Identity Engine] User-Agent randomization enabled: rotating authentic browser headers per request.');
  }

  const visitedSet = new Set<string>(); 
  const queuedSet = new Set<string>(); 
  const queue: Array<{ url: string; depth: number; parentUrl?: string }> = [];
  const canonicalTrackerMap = new Map<string, string>();

  function getUrlLookupKeys(urlStr: string): string[] {
    const keys = new Set<string>();
    try {
      const trimmed = urlStr.trim();
      if (!trimmed) return [];
      keys.add(trimmed);
      const clean = cleanUrl(trimmed, baseHostname, stripQueryParams, stripHash) || trimmed;
      keys.add(clean);
      const parsed = new URL(clean);
      keys.add(parsed.href);

      const altProto = parsed.protocol === 'https:' ? 'http:' : 'https:';
      const alt = new URL(parsed.href);
      alt.protocol = altProto;
      keys.add(alt.href);

      if (parsed.pathname === '/' || parsed.pathname.endsWith('/')) {
        const noSlash = new URL(parsed.href);
        noSlash.pathname = noSlash.pathname.replace(/\/+$/, '') || '/';
        keys.add(noSlash.href);
      } else {
        const withSlash = new URL(parsed.href);
        withSlash.pathname = withSlash.pathname + '/';
        keys.add(withSlash.href);
      }
    } catch {
      keys.add(urlStr.trim());
    }
    return Array.from(keys);
  }

  function isUrlAlreadyScanned(urlStr: string): boolean {
    const keys = getUrlLookupKeys(urlStr);
    return keys.some((k) => visitedSet.has(k));
  }

  function isUrlAlreadyScannedOrQueued(urlStr: string): boolean {
    const keys = getUrlLookupKeys(urlStr);
    return keys.some((k) => visitedSet.has(k) || queuedSet.has(k));
  }

  function markUrlAsQueued(urlStr: string) {
    for (const k of getUrlLookupKeys(urlStr)) {
      queuedSet.add(k);
    }
  }

  function markUrlAsVisited(urlStr: string) {
    for (const k of getUrlLookupKeys(urlStr)) {
      visitedSet.add(k);
      queuedSet.add(k);
    }
  }

  const directoriesMap = new Map<
    string,
    {
      path: string;
      domain: string;
      depth: number;
      parentPath: string | null;
      directPageUrls: Set<string>;
      firstDiscoveredAt: number;
      foundOnUrl: string;
      foundOnUrls: Set<string>;
    }
  >();

  const filesMap = new Map<
    string,
    {
      path: string;
      domain: string;
      filename: string;
      extension: string;
      directory: string;
      depth: number;
      fileType: 'document' | 'image' | 'code' | 'stylesheet' | 'script' | 'media' | 'data' | 'archive' | 'other';
      foundOnUrl: string;
      foundOnUrls: Set<string>;
      firstDiscoveredAt: number;
      url: string;
    }
  >();

  const externalLinksMap = new Map<
    string,
    {
      url: string;
      domain: string;
      rootDomain?: string;
      pathname: string;
      isAssetOrFile: boolean;
      fileType?: 'document' | 'image' | 'code' | 'stylesheet' | 'script' | 'media' | 'data' | 'archive' | 'other';
      extension?: string;
      foundOnUrl: string;
      foundOnUrls: Set<string>;
      firstDiscoveredAt: number;
      tagType?: 'a' | 'script' | 'link' | 'img' | 'media' | 'iframe' | 'source' | 'other';
      linkText?: string;
      htmlContext?: string;
    }
  >();

  const apiEndpointsMap = new Map<string, ApiEndpointRecord>();
  const probedApiUrls = new Set<string>();
  const apiProbeQueue: string[] = [];
  let apiProbeWorkerActive = false;

  async function triggerApiProbeWorker() {
    if (apiProbeWorkerActive || isAborted) return;
    apiProbeWorkerActive = true;

    try {
      while (apiProbeQueue.length > 0 && !isAborted) {
        const targetUrl = apiProbeQueue.shift();
        if (!targetUrl) continue;

        try {
          const mapped = await activeQueryAndMapApiEndpoint(targetUrl, getEffectiveUserAgent());
          for (const [, epRecord] of apiEndpointsMap.entries()) {
            if (epRecord.url === targetUrl) {
              if (mapped.statusCode > 0) {
                epRecord.statusCode = mapped.statusCode;
              }
              epRecord.latencyMs = mapped.latencyMs;
              if (mapped.contentType) epRecord.contentType = mapped.contentType;
              epRecord.allowedMethods = mapped.allowedMethods;
              epRecord.possibleParameters = mapped.possibleParameters;
              epRecord.possibleQueries = mapped.possibleQueries;
              epRecord.sampleQueryUrl = mapped.sampleQueryUrl;
              if (mapped.graphqlFields) epRecord.graphqlFields = mapped.graphqlFields;
              if (mapped.responsePreview) epRecord.responsePreview = mapped.responsePreview;
              epRecord.queryCapabilitiesSummary = mapped.queryCapabilitiesSummary;
              if (mapped.authHint && !epRecord.authHint) {
                epRecord.authHint = mapped.authHint;
              }
              epRecord.lastQueriedAt = Date.now();
            }
          }
        } catch {}

        await delay(60);
      }
    } finally {
      apiProbeWorkerActive = false;
    }
  }

  function canonicalizeApiEndpointUrl(rawUrl: string): { url: string; pathname: string } {
    try {
      let urlStr = rawUrl.trim();
      const isRelative = !/^https?:\/\//i.test(urlStr);
      const parsed = new URL(isRelative ? 'https://dummy.local' + (urlStr.startsWith('/') ? '' : '/') + urlStr : urlStr);

      let cleanPath = parsed.pathname.replace(/\/+/g, '/');
      if (cleanPath.length > 1 && cleanPath.endsWith('/')) {
        cleanPath = cleanPath.replace(/\/+$/, '');
      }
      parsed.pathname = cleanPath;

      if (isRelative) {
        const search = parsed.search ? parsed.search : '';
        return { url: cleanPath + search, pathname: cleanPath };
      }
      return { url: parsed.href, pathname: cleanPath };
    } catch {
      let clean = rawUrl.trim().replace(/\/+/g, '/');
      if (clean.length > 1 && clean.endsWith('/')) {
        clean = clean.replace(/\/+$/, '');
      }
      return { url: clean, pathname: clean };
    }
  }

  function registerApiEndpoint(ep: Omit<ApiEndpointRecord, 'id' | 'sourceUrls'> & { sourceUrl: string }) {
    try {
      const canonical = canonicalizeApiEndpointUrl(ep.url);
      ep.url = canonical.url;
      ep.pathname = canonical.pathname;

      const key = `${ep.method}::${ep.url}`;
      const existing = apiEndpointsMap.get(key);

      const extracted = extractKnownApiParametersAndQueries(
        ep.url,
        ep.method,
        ep.category,
        ep.snippet,
        ep.queryParams,
        ep.possibleParameters || []
      );
      ep.possibleParameters = extracted.possibleParameters;
      ep.possibleQueries = extracted.possibleQueries;
      ep.sampleQueryUrl = extracted.sampleQueryUrl;
      ep.queryCapabilitiesSummary = extracted.queryCapabilitiesSummary;

      if (existing) {
        if (existing.sourceUrls.length < 20 && !existing.sourceUrls.includes(ep.sourceUrl)) {
          existing.sourceUrls.push(ep.sourceUrl);
        }
        if (!existing.snippet && ep.snippet) existing.snippet = ep.snippet;
        if (!existing.authHint && ep.authHint) existing.authHint = ep.authHint;
        if (!existing.contentType && ep.contentType) existing.contentType = ep.contentType;
        if (!existing.statusCode && ep.statusCode) existing.statusCode = ep.statusCode;

        // Merge newly discovered known parameters from other page occurrences
        if (ep.possibleParameters && ep.possibleParameters.length > 0) {
          const existingMap = new Map((existing.possibleParameters || []).map((p) => [p.name, p]));
          for (const newP of ep.possibleParameters) {
            if (!existingMap.has(newP.name)) {
              existingMap.set(newP.name, newP);
            }
          }
          const mergedParams = Array.from(existingMap.values());
          existing.possibleParameters = mergedParams;
          existing.queryParams = mergedParams.filter((p) => p.in === 'query').map((p) => p.name);
          const recomputed = extractKnownApiParametersAndQueries(
            existing.url,
            existing.method,
            existing.category,
            existing.snippet,
            existing.queryParams,
            mergedParams
          );
          existing.possibleQueries = recomputed.possibleQueries;
          existing.sampleQueryUrl = recomputed.sampleQueryUrl;
          existing.queryCapabilitiesSummary = recomputed.queryCapabilitiesSummary;
        }
      } else {
        const id = 'api_' + (apiEndpointsMap.size + 1) + '_' + Math.random().toString(36).slice(2, 7);
        apiEndpointsMap.set(key, {
          ...ep,
          id,
          sourceUrls: [ep.sourceUrl],
        });
      }

      if (autoQueryApis && !probedApiUrls.has(ep.url) && !isAborted) {
        probedApiUrls.add(ep.url);
        apiProbeQueue.push(ep.url);
        triggerApiProbeWorker();
      }
    } catch {}
  }

  const startParsed = new URL(normalizedStart);
  const startHostname = startParsed.hostname.toLowerCase();

  const rootKey = `${startHostname}::/`;
  directoriesMap.set(rootKey, {
    path: '/',
    domain: startHostname,
    depth: 0,
    parentPath: null,
    directPageUrls: new Set<string>(),
    firstDiscoveredAt: Date.now(),
    foundOnUrl: normalizedStart,
    foundOnUrls: new Set<string>([normalizedStart]),
  });

  function registerFileForUrl(targetUrl: string, sourceUrl?: string) {
    try {
      const fileInfo = detectFileRecord(targetUrl, sourceUrl || targetUrl);
      if (!fileInfo) return;

      const fileDomain = fileInfo.domain || new URL(targetUrl).hostname.toLowerCase();
      const fileKey = `${fileDomain}::${fileInfo.path}`;
      const originSource = sourceUrl || targetUrl;
      const existing = filesMap.get(fileKey);
      if (existing) {
        if (originSource && existing.foundOnUrls.size < 10) {
          existing.foundOnUrls.add(originSource);
          if (!existing.foundOnUrl) {
            existing.foundOnUrl = originSource;
          }
        }
      } else {
        filesMap.set(fileKey, {
          path: fileInfo.path,
          domain: fileDomain,
          filename: fileInfo.filename,
          extension: fileInfo.extension,
          directory: fileInfo.directory,
          depth: fileInfo.depth,
          fileType: fileInfo.fileType,
          foundOnUrl: originSource,
          foundOnUrls: new Set<string>([originSource]),
          firstDiscoveredAt: Date.now(),
          url: fileInfo.url,
        });
      }
    } catch {
      // ignore
    }
  }

  function registerDirectoriesForUrl(targetUrl: string, sourceUrl?: string) {
    try {
      const parsed = new URL(targetUrl);
      const targetHost = parsed.hostname.toLowerCase();
      const dirs = extractPathDirectories(parsed.pathname);
      const now = Date.now();
      const originSource = sourceUrl || targetUrl;

      for (let i = 0; i < dirs.length; i++) {
        const dirPath = dirs[i];
        const dirKey = `${targetHost}::${dirPath}`;
        if (!directoriesMap.has(dirKey)) {
          const depth = dirPath === '/' ? 0 : dirPath.split('/').filter(Boolean).length;
          let parentPath: string | null = null;
          if (dirPath !== '/') {
            const segs = dirPath.split('/').filter(Boolean);
            if (segs.length === 1) {
              parentPath = '/';
            } else {
              parentPath = '/' + segs.slice(0, -1).join('/') + '/';
            }
          }

          directoriesMap.set(dirKey, {
            path: dirPath,
            domain: targetHost,
            depth,
            parentPath,
            directPageUrls: new Set<string>(),
            firstDiscoveredAt: now,
            foundOnUrl: originSource,
            foundOnUrls: new Set<string>([originSource]),
          });
        } else {
          const existing = directoriesMap.get(dirKey);
          if (existing && originSource && existing.foundOnUrls.size < 10) {
            existing.foundOnUrls.add(originSource);
            if (!existing.foundOnUrl) {
              existing.foundOnUrl = originSource;
            }
          }
        }
      }

      const directDir = dirs[dirs.length - 1] || '/';
      const directKey = `${targetHost}::${directDir}`;
      const dirRecord = directoriesMap.get(directKey);
      if (dirRecord) {
        if (dirRecord.directPageUrls.size < 50) {
          dirRecord.directPageUrls.add(targetUrl);
        }
        if (originSource && dirRecord.foundOnUrls.size < 10) {
          dirRecord.foundOnUrls.add(originSource);
        }
      }

      registerFileForUrl(targetUrl, sourceUrl);
    } catch {
      // ignore
    }
  }

  function getElementHtmlSnippet(cheerioInstance: cheerio.CheerioAPI, element: any): string {
    try {
      const $el = cheerioInstance(element);
      const rawEl: any = element;
      const tagName = (rawEl.name || rawEl.tagName || $el.prop('tagName') || 'a').toLowerCase();

      const attribs: Record<string, string> = rawEl.attribs || $el.attr() || {};
      const attrPairs: string[] = [];

      for (const [key, val] of Object.entries(attribs)) {
        if (val !== undefined && val !== null) {
          const safeVal = String(val).replace(/"/g, '&quot;');
          attrPairs.push(`${key}="${safeVal}"`);
        }
      }

      const attrStr = attrPairs.length > 0 ? ' ' + attrPairs.join(' ') : '';
      const voidTags = new Set(['img', 'link', 'meta', 'br', 'hr', 'input', 'source', 'wbr', 'embed', 'track', 'area']);

      if (voidTags.has(tagName)) {
        return `<${tagName}${attrStr} />`;
      }

      let text = $el.text().replace(/\s+/g, ' ').trim();
      if (text.length > 80) {
        text = text.slice(0, 80) + '...';
      }

      if (text) {
        return `<${tagName}${attrStr}>${text}</${tagName}>`;
      } else {
        return `<${tagName}${attrStr}></${tagName}>`;
      }
    } catch {
      return '';
    }
  }

  function registerExternalLink(
    rawUrl: string,
    sourceUrl: string,
    tagType: 'a' | 'script' | 'link' | 'img' | 'media' | 'iframe' | 'source' | 'other' = 'a',
    linkText?: string,
    htmlContext?: string
  ) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;

      const extHostname = parsed.hostname.toLowerCase();
      const extUrl = parsed.href;

      const match = parsed.pathname.match(/\.([a-zA-Z0-9]{1,8})$/);
      let isAssetOrFile = false;
      let fileType: any = undefined;
      let extension: string | undefined = undefined;

      if (match) {
        extension = match[1].toLowerCase();
        fileType = classifyFileCategory(extension);
        isAssetOrFile = true;
      } else if (['img', 'script', 'link', 'media'].includes(tagType)) {
        isAssetOrFile = true;
        if (tagType === 'img') fileType = 'image';
        else if (tagType === 'script') fileType = 'script';
        else if (tagType === 'link') fileType = 'stylesheet';
        else if (tagType === 'media') fileType = 'media';
      }

      const existing = externalLinksMap.get(extUrl);
      if (existing) {
        if (existing.foundOnUrls.size < 10) {
          existing.foundOnUrls.add(sourceUrl);
        }
        if (!existing.linkText && linkText) existing.linkText = linkText.slice(0, 80);
        if (!existing.htmlContext && htmlContext) existing.htmlContext = htmlContext;
      } else {
        const rootDomain = extractApexDomain(extHostname);

        externalLinksMap.set(extUrl, {
          url: extUrl,
          domain: extHostname,
          rootDomain,
          pathname: parsed.pathname,
          isAssetOrFile,
          fileType,
          extension,
          foundOnUrl: sourceUrl,
          foundOnUrls: new Set<string>([sourceUrl]),
          firstDiscoveredAt: Date.now(),
          tagType,
          linkText: linkText ? linkText.slice(0, 80) : undefined,
          htmlContext: htmlContext || undefined,
        });
      }
    } catch {
      // ignore
    }
  }

  function getFilesSummary() {
    const list = Array.from(filesMap.values()).map((f) => ({
      path: f.path,
      domain: f.domain,
      filename: f.filename,
      extension: f.extension,
      directory: f.directory,
      depth: f.depth,
      fileType: f.fileType,
      foundOnUrl: f.foundOnUrl,
      foundOnUrls: Array.from(f.foundOnUrls),
      firstDiscoveredAt: f.firstDiscoveredAt,
      url: f.url,
    }));

    return list.sort((a, b) => a.domain.localeCompare(b.domain) || a.path.localeCompare(b.path));
  }

  function getExternalLinksSummary() {
    const list = Array.from(externalLinksMap.values()).map((e) => ({
      url: e.url,
      domain: e.domain,
      rootDomain: e.rootDomain,
      pathname: e.pathname,
      isAssetOrFile: e.isAssetOrFile,
      fileType: e.fileType,
      extension: e.extension,
      foundOnUrl: e.foundOnUrl,
      foundOnUrls: Array.from(e.foundOnUrls),
      firstDiscoveredAt: e.firstDiscoveredAt,
      tagType: e.tagType,
      linkText: e.linkText,
      htmlContext: e.htmlContext,
    }));

    return list.sort((a, b) => a.domain.localeCompare(b.domain) || a.url.localeCompare(b.url));
  }

  function getApiEndpointsSummary(): ApiEndpointRecord[] {
    return Array.from(apiEndpointsMap.values()).sort(
      (a, b) => a.domain.localeCompare(b.domain) || a.pathname.localeCompare(b.pathname)
    );
  }

  function getDirectoriesSummary() {
    const allFiles = getFilesSummary();
    const list = Array.from(directoriesMap.values()).map((d) => {
      const subDirs: string[] = [];
      let nestedCount = d.directPageUrls.size;

      for (const [, otherRec] of directoriesMap.entries()) {
        if (otherRec.domain === d.domain && otherRec.path !== d.path && otherRec.path.startsWith(d.path)) {
          nestedCount += otherRec.directPageUrls.size;
          if (otherRec.parentPath === d.path) {
            subDirs.push(otherRec.path);
          }
        }
      }

      const directFilesInDir = allFiles.filter((f) => f.domain === d.domain && f.directory === d.path);

      return {
        path: d.path,
        domain: d.domain,
        depth: d.depth,
        parentPath: d.parentPath,
        directPageUrls: Array.from(d.directPageUrls),
        allNestedUrlsCount: nestedCount,
        subDirectories: subDirs,
        firstDiscoveredAt: d.firstDiscoveredAt,
        foundOnUrl: d.foundOnUrl || (d.directPageUrls.size > 0 ? Array.from(d.directPageUrls)[0] : normalizedStart),
        foundOnUrls: Array.from(d.foundOnUrls),
        directFiles: directFilesInDir,
      };
    });

    return list.sort((a, b) => a.domain.localeCompare(b.domain) || a.path.localeCompare(b.path));
  }

  function checkSameDomain(candidate: string): boolean {
    try {
      const candHost = new URL(candidate).hostname.toLowerCase();
      if (candHost === baseHostname) return true;
      if (allowSubdomains) {
        const apex = extractApexDomain(baseHostname);
        return (
          candHost === apex ||
          candHost.endsWith('.' + apex) ||
          candHost.endsWith('.' + baseHostname) ||
          baseHostname.endsWith('.' + candHost)
        );
      }
      return false;
    } catch {
      return false;
    }
  }

  function detectApiEndpointsFromHtml(
    $: cheerio.CheerioAPI,
    pageUrl: string,
    resolveBase: string
  ) {
    if (!captureApiCalls) return;

    const processApiUrl = (
      rawUrl: string,
      method: ApiMethod = 'GET',
      detectedIn: 'fetch-xhr' | 'script-inline' | 'script-tag' | 'link' | 'data-attr' | 'response' = 'link',
      snippet?: string,
      authHint?: string,
      knownParams?: ApiQueryParameter[]
    ) => {
      try {
        const resolved = new URL(rawUrl, resolveBase);
        if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return;

        const host = resolved.hostname.toLowerCase();
        const pName = resolved.pathname;
        if (!isCandidateApi(resolved.href, pName, host)) return;

        const isSame = checkSameDomain(resolved.href);
        const qParams = Array.from(resolved.searchParams.keys()).slice(0, 15);
        const category = classifyCategory(resolved.href, pName);

        registerApiEndpoint({
          url: resolved.href,
          pathname: pName,
          domain: host,
          isSameDomain: isSame,
          method,
          category,
          detectedIn,
          sourceUrl: pageUrl,
          queryParams: qParams,
          possibleParameters: knownParams,
          snippet: snippet ? snippet.slice(0, 300) : undefined,
          authHint: authHint || undefined,
          firstDiscoveredAt: Date.now(),
        });
      } catch {}
    };

    // 1. Scan links and script sources in DOM
    $('a[href], link[href], script[src]').each((_, el) => {
      const href = $(el).attr('href') || $(el).attr('src');
      if (href) {
        const tagName = (el as any).tagName?.toLowerCase() || '';
        const detected = tagName === 'script' ? 'script-tag' : 'link';
        processApiUrl(href.trim(), 'GET', detected);
      }
    });

    // 2. Scan forms with action and method plus form field inputs
    $('form[action]').each((_, el) => {
      const action = $(el).attr('action');
      if (action) {
        const rawMethod = ($(el).attr('method') || 'GET').toUpperCase();
        const method: ApiMethod = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(rawMethod)
          ? (rawMethod as ApiMethod)
          : 'GET';
        const snippet = getElementHtmlSnippet($, el);

        const formParams: ApiQueryParameter[] = [];
        $(el).find('input[name], select[name], textarea[name]').each((_, inputEl) => {
          const name = $(inputEl).attr('name')?.trim();
          if (name) {
            const val = $(inputEl).attr('value') || '';
            const type = ($(inputEl).attr('type') || 'text').toLowerCase();
            formParams.push({
              name,
              in: method === 'GET' ? 'query' : 'body',
              type: type === 'number' ? 'number' : type === 'checkbox' ? 'boolean' : 'string',
              sampleValue: val || '1',
              description: `Known parameter from form field <${(inputEl as any).tagName} name="${name}"> in page source`,
              required: Boolean($(inputEl).attr('required')),
              source: 'observed',
            });
          }
        });

        processApiUrl(action.trim(), method, 'fetch-xhr', snippet, undefined, formParams);
      }
    });

    // 3. Scan elements with data attributes
    $('[data-api], [data-url], [data-endpoint], [data-href]').each((_, el) => {
      const val =
        $(el).attr('data-api') ||
        $(el).attr('data-url') ||
        $(el).attr('data-endpoint') ||
        $(el).attr('data-href');
      if (val) {
        processApiUrl(val.trim(), 'GET', 'data-attr', getElementHtmlSnippet($, el));
      }
    });

    // 4. Scan JSON script tags (__NEXT_DATA__, __NUXT__, application/json, ld+json)
    $('script[type="application/json"], script[type="application/ld+json"], script#__NEXT_DATA__').each((_, el) => {
      const jsonContent = $(el).html() || '';
      if (!jsonContent || jsonContent.length > 500_000) return;
      try {
        const parsedJson = JSON.parse(jsonContent);
        const scanObj = (val: any, d = 0) => {
          if (!val || d > 6) return;
          if (typeof val === 'string') {
            const s = val.trim();
            if (s.startsWith('/api') || s.startsWith('https://') || s.startsWith('http://') || s.includes('/v1/')) {
              processApiUrl(s, 'GET', 'data-attr');
            }
          } else if (Array.isArray(val)) {
            for (const item of val.slice(0, 50)) scanObj(item, d + 1);
          } else if (typeof val === 'object') {
            for (const v of Object.values(val).slice(0, 50)) scanObj(v, d + 1);
          }
        };
        scanObj(parsedJson);
      } catch {
        const matches = jsonContent.match(/['"](https?:\/\/[^'"\s]*\/(?:api|apis|v[0-9]+|graphql|trpc)\/[^'"\s]*|\/(?:api|apis|v[0-9]+|graphql|trpc|wp-json)\/[^'"\s]+)['"]/g);
        if (matches) {
          for (const m of matches) {
            processApiUrl(m.replace(/^['"]|['"]$/g, ''), 'GET', 'data-attr');
          }
        }
      }
    });

    // 5. Scan inline script contents for known parameters in JavaScript
    $('script:not([src])').each((_, el) => {
      const scriptContent = $(el).html() || '';
      if (!scriptContent || scriptContent.length > 500_000) return;

      let authHint: string | undefined = undefined;
      if (/Bearer\s+/i.test(scriptContent)) authHint = 'Bearer Token';
      else if (/api[-_]?key/i.test(scriptContent)) authHint = 'API Key';
      else if (/credentials:\s*['"]include['"]/i.test(scriptContent)) authHint = 'Session Cookie';
      else if (/Basic\s+/i.test(scriptContent)) authHint = 'Basic Auth';

      // fetch('...')
      const fetchRegex = /fetch\(\s*['"`](https?:\/\/[^'"`\s]+|\/[a-zA-Z0-9_\-./]+|\/api\/[^'"`\s]+)['"`](?:\s*,\s*\{([^}]*)\})?/g;
      let match: RegExpExecArray | null;
      while ((match = fetchRegex.exec(scriptContent)) !== null) {
        const apiPath = match[1];
        const opts = match[2] || '';
        let method: ApiMethod = 'GET';
        const mMatch = opts.match(/method\s*:\s*['"`]([A-Z]+)['"`]/i);
        if (mMatch) {
          const parsedM = mMatch[1].toUpperCase() as ApiMethod;
          if (['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(parsedM)) {
            method = parsedM;
          }
        }
        const snippet = match[0].slice(0, 300);
        const knownParams = extractKnownParamsFromJsSnippet(opts, method);
        processApiUrl(apiPath, method, 'fetch-xhr', snippet, authHint, knownParams);
      }

      // axios.(get|post|put|delete|patch)
      const axiosRegex = /(?:axios|http|client)\.(get|post|put|delete|patch)\(\s*['"`]([^'"`\s]+)['"`](?:\s*,\s*\{?([^)]*)\}?)?/g;
      while ((match = axiosRegex.exec(scriptContent)) !== null) {
        const method = match[1].toUpperCase() as ApiMethod;
        const apiPath = match[2];
        const opts = match[3] || '';
        const snippet = match[0].slice(0, 300);
        const knownParams = extractKnownParamsFromJsSnippet(opts, method);
        processApiUrl(apiPath, method, 'fetch-xhr', snippet, authHint, knownParams);
      }

      // $.ajax({ url: '...' })
      const ajaxRegex = /\$\.ajax\(\s*\{([^}]*url\s*:\s*['"`]([^'"`\s]+)['"`][^}]*)\}/g;
      while ((match = ajaxRegex.exec(scriptContent)) !== null) {
        const block = match[1];
        const apiPath = match[2];
        let method: ApiMethod = 'GET';
        const mMatch = block.match(/(?:type|method)\s*:\s*['"`]([A-Z]+)['"`]/i);
        if (mMatch) {
          const parsedM = mMatch[1].toUpperCase() as ApiMethod;
          if (['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(parsedM)) {
            method = parsedM;
          }
        }
        const knownParams = extractKnownParamsFromJsSnippet(block, method);
        processApiUrl(apiPath, method, 'fetch-xhr', match[0].slice(0, 300), authHint, knownParams);
      }

      // general string literals matching API patterns
      const literalApiRegex = /['"`](https?:\/\/[^'"`\s]*\/(?:api|apis|v[0-9]+|graphql|trpc)\/[^'"`\s]*|\/(?:api|apis|v[0-9]+|graphql|trpc|wp-json)\/[^'"`\s]+)['"`]/g;
      while ((match = literalApiRegex.exec(scriptContent)) !== null) {
        const apiPath = match[1];
        processApiUrl(apiPath, 'GET', 'script-inline', undefined, authHint);
      }
    });
  }

  registerDirectoriesForUrl(normalizedStart);
  queue.push({ url: normalizedStart, depth: 0 });
  markUrlAsQueued(normalizedStart);

  sendEvent('init', {
    startUrl: normalizedStart,
    baseHostname,
    maxDepth,
    maxPages,
    concurrency,
    includeRobotsTxt,
    includeAiAssistance,
    captureApiCalls,
    autoQueryApis,
    queryCrtSubdomains,
    timestamp: Date.now(),
  });

  sendLog('info', `Starting crawl for domain ${baseHostname} at ${normalizedStart} (Max Depth: ${maxDepth}, Max Pages: ${maxPages})`);

  if (includeRobotsTxt) {
    const robotsUrl = `${originBase}/robots.txt`;
    sendLog('info', `Fetching & inspecting robots.txt at ${robotsUrl}...`);

    try {
      const rController = new AbortController();
      const rTimeout = setTimeout(() => rController.abort(), 4000);
      const robotsRes = await safeFetch(robotsUrl, {
        signal: rController.signal,
        headers: { 'User-Agent': getEffectiveUserAgent() },
        maxRedirects: 3,
        validateRedirect: (targetUrl) => checkSameDomain(targetUrl.href),
      });
      clearTimeout(rTimeout);

      if (robotsRes.ok) {
        const robotsContent = await robotsRes.text();
        registerFileForUrl(robotsUrl, normalizedStart);

        const lines = robotsContent.split('\n');
        let ruleCount = 0;
        let sitemapCount = 0;

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;

          const matchRule = trimmed.match(/^(?:Disallow|Allow):\s*(\S+)/i);
          if (matchRule) {
            const rawPath = matchRule[1].trim();
            if (rawPath && rawPath !== '/' && !rawPath.includes('*') && !rawPath.includes('$')) {
              try {
                const constructedUrl = new URL(rawPath, originBase).href;
                registerDirectoriesForUrl(constructedUrl, robotsUrl);
                ruleCount++;
              } catch {}
            }
          }

          const matchSitemap = trimmed.match(/^Sitemap:\s*(\S+)/i);
          if (matchSitemap) {
            const sitemapUrl = matchSitemap[1].trim();
            sitemapCount++;
            if (checkSameDomain(sitemapUrl)) {
              registerFileForUrl(sitemapUrl, robotsUrl);
              registerDirectoriesForUrl(sitemapUrl, robotsUrl);
            } else {
              registerExternalLink(sitemapUrl, robotsUrl, 'link', 'Sitemap in robots.txt');
            }
          }
        }

        sendLog('success', `Parsed ${robotsUrl}: Discovered ${ruleCount} path rules and ${sitemapCount} sitemap references`);
      } else {
        sendLog('info', `robots.txt returned HTTP ${robotsRes.status} (non-blocking)`);
      }
    } catch (err: any) {
      sendLog('info', `robots.txt probe completed (no seed rules added)`);
    }
  }

  if (includeAiAssistance) {
    sendLog('info', `Probing target domain for 36 standardized AI assistance and context manifest endpoints...`);
    let aiDiscoveredCount = 0;
    let aiLinksExtractedCount = 0;

    const probeAiFile = async (filename: string) => {
      if (isAborted) return;
      const fileUrl = `${originBase}/${filename}`;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        const res = await safeFetch(fileUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': getEffectiveUserAgent(),
            'Accept': 'text/plain, text/markdown, application/json, text/x-markdown, */*',
          },
          maxRedirects: 3,
          validateRedirect: (targetUrl) => checkSameDomain(targetUrl.href),
        });
        clearTimeout(timeout);

        if (!res.ok) return;

        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        const rawBody = await res.text();
        const trimmedBody = rawBody.trim();

        if (trimmedBody.length === 0 || trimmedBody.length > 2_500_000) return;

        if (contentType.includes('text/html') || /^(?:<!doctype|<html|<head|<body)/i.test(trimmedBody)) {
          return;
        }

        aiDiscoveredCount++;
        registerFileForUrl(fileUrl, normalizedStart);
        registerDirectoriesForUrl(fileUrl, normalizedStart);

        const extractedLinks: Array<{ url: string; title?: string }> = [];

        if (filename.endsWith('.json')) {
          try {
            const parsedJson = JSON.parse(trimmedBody);
            const collectStrings = (obj: any) => {
              if (!obj) return;
              if (typeof obj === 'string') {
                const s = obj.trim();
                if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('/')) {
                  extractedLinks.push({ url: s });
                }
              } else if (Array.isArray(obj)) {
                for (const item of obj) collectStrings(item);
              } else if (typeof obj === 'object') {
                for (const val of Object.values(obj)) collectStrings(val);
              }
            };
            collectStrings(parsedJson);
          } catch {
            const urlMatches = trimmedBody.match(/https?:\/\/[^\s"']+|\/[a-zA-Z0-9_\-./]+/g);
            if (urlMatches) {
              for (const u of urlMatches) extractedLinks.push({ url: u });
            }
          }
        } else {
          const mdLinkRegex = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
          let match: RegExpExecArray | null;
          while ((match = mdLinkRegex.exec(trimmedBody)) !== null) {
            extractedLinks.push({ title: match[1].trim(), url: match[2].trim() });
          }

          const lines = trimmedBody.split('\n');
          for (const line of lines) {
            const t = line.trim();
            if (!t || t.startsWith('#')) continue;
            const bulletMatch = t.match(/^[-*+]\s+(?:\[[^\]]+\]\(([^)\s]+)\)|(https?:\/\/\S+|\/\S+))/);
            if (bulletMatch) {
              const u = bulletMatch[1] || bulletMatch[2];
              if (u) extractedLinks.push({ url: u });
            }
          }

          const rawUrlMatches = trimmedBody.match(/https?:\/\/[^\s<>)"]+/g);
          if (rawUrlMatches) {
            for (const ru of rawUrlMatches) {
              extractedLinks.push({ url: ru });
            }
          }
        }

        let addedSeeds = 0;
        const seenInFile = new Set<string>();

        for (const item of extractedLinks) {
          const raw = item.url.trim().replace(/[.,;:]+$/, '');
          if (!raw || raw.startsWith('#') || raw.startsWith('javascript:') || raw.startsWith('mailto:')) continue;
          if (seenInFile.has(raw)) continue;
          seenInFile.add(raw);

          try {
            const resolved = new URL(raw, originBase).href;
            if (checkSameDomain(resolved)) {
              const clean = cleanUrl(resolved, baseHostname, stripQueryParams, stripHash);
              if (!clean) continue;

              registerDirectoriesForUrl(clean, fileUrl);
              const isNonHtmlAsset = /\.(pdf|zip|tar|gz|exe|dmg|iso|mp3|mp4|avi|mov|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot|css|js|mjs|json|xml|csv|tsv|yaml|yml|doc|docx|xls|xlsx|ppt|pptx)$/i.test(
                new URL(clean).pathname
              );
              if (isNonHtmlAsset) {
                registerFileForUrl(clean, fileUrl);
              } else {
                if (
                  !isUrlAlreadyScannedOrQueued(clean) &&
                  queue.length < maxPages
                ) {
                  markUrlAsQueued(clean);
                  queue.push({
                    url: clean,
                    depth: 1,
                    parentUrl: fileUrl,
                  });
                  addedSeeds++;
                }
              }
            } else {
              registerExternalLink(resolved, fileUrl, 'link', item.title, `AI Assistance: ${filename}`);
            }
          } catch {}
        }

        aiLinksExtractedCount += seenInFile.size;
        sendLog('success', `Found AI assistance page: /${filename} (${seenInFile.size} links found, ${addedSeeds} enqueued as crawl seeds)`);
      } catch {}
    };

    const batchSize = 6;
    for (let i = 0; i < AI_ASSISTANCE_FILENAMES.length; i += batchSize) {
      if (isAborted) break;
      const batch = AI_ASSISTANCE_FILENAMES.slice(i, i + batchSize);
      await Promise.all(batch.map((fn) => probeAiFile(fn)));
    }

    if (aiDiscoveredCount > 0) {
      sendLog('info', `AI assistance inspection complete: ${aiDiscoveredCount} manifest(s) discovered, ${aiLinksExtractedCount} total references parsed`);
    } else {
      sendLog('info', `AI assistance probe completed: No standard AI manifests located on ${baseHostname}`);
    }
  }

  let visitedCount = 0;
  let totalLinksFound = 0;
  let sameDomainLinksFound = 0;
  let status2xx = 0;
  let status3xx = 0;
  let status4xx = 0;
  let status5xx = 0;
  let errorsCount = 0;
  const startTime = Date.now();

  const sendCurrentStats = (currentUrl: string | null = null) => {
    const uniqueExtDomains = new Set(Array.from(externalLinksMap.values()).map((e) => e.domain)).size;

    sendEvent('stats', {
      pagesVisited: visitedCount,
      pagesQueued: queue.length,
      uniqueDirectories: directoriesMap.size,
      uniqueFiles: filesMap.size,
      externalLinksCount: externalLinksMap.size,
      externalDomainsCount: uniqueExtDomains,
      apiEndpointsCount: apiEndpointsMap.size,
      totalLinksFound,
      sameDomainLinksFound,
      errorsCount,
      status2xx,
      status3xx,
      status4xx,
      status5xx,
      startTime,
      endTime: null,
      currentUrl,
    });
  };

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function crawlPage(item: { url: string; depth: number; parentUrl?: string }) {
    if (isAborted) return;

    if (isUrlAlreadyScanned(item.url)) {
      sendLog('info', `Target ${item.url} was already scanned in this reconnaissance session - skipping duplicate.`);
      return;
    }

    visitedCount++;
    markUrlAsVisited(item.url);
    const pageStartTime = Date.now();

    sendCurrentStats(item.url);
    sendLog('info', `Crawling [Depth ${item.depth}]: ${item.url}`);

    let statusCode = 0;
    let statusText = '';
    let contentType = '';
    let title = '';
    let discoveredHere = 0;
    let sameDomainHere = 0;
    let externalHere = 0;
    let pageError: string | undefined = undefined;
    let redirectChain: string[] = [item.url];
    let finalUrl: string = item.url;
    let canonicalUrl: string | undefined = undefined;
    let canonicalStatus: 'self' | 'canonicalized' | 'cross_domain' | 'loop' | 'invalid' | undefined = undefined;
    let isNoIndex = false;
    let hasNoFollow = false;
    let robotsDirectives: string[] = [];
    let truncatedBody = false;
    let bytesRead = 0;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const cancelListener = () => controller.abort();
      abortController.signal.addEventListener('abort', cancelListener);

      let response: Response;
      try {
        response = await safeFetch(item.url, {
          signal: controller.signal,
          headers: {
            'User-Agent': getEffectiveUserAgent(),
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          },
          maxRedirects: 5,
          validateRedirect: (targetUrl) => checkSameDomain(targetUrl.href),
        });
      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        abortController.signal.removeEventListener('abort', cancelListener);
        throw fetchErr;
      }

      clearTimeout(timeoutId);
      abortController.signal.removeEventListener('abort', cancelListener);

      statusCode = response.status;
      statusText = response.statusText;
      contentType = response.headers.get('content-type') || '';
      if ((response as any).redirectChain) {
        redirectChain = (response as any).redirectChain;
      }
      if ((response as any).finalUrl) {
        finalUrl = (response as any).finalUrl;
      } else if (response.url) {
        finalUrl = response.url;
      }

      // Handle 1xx informational responses cleanly
      if (statusCode >= 100 && statusCode < 200) {
        sendLog('info', `[Informational ${statusCode}] Received informational response for ${item.url}`);
      }

      // Adaptive backoff on HTTP 429 (Too Many Requests) or HTTP 503 (Service Unavailable)
      if (statusCode === 429 || statusCode === 503) {
        const retryAfterHeader = response.headers.get('retry-after');
        let backoffSeconds = 2;
        if (retryAfterHeader) {
          const parsedSec = parseInt(retryAfterHeader, 10);
          if (!isNaN(parsedSec) && parsedSec > 0) {
            backoffSeconds = Math.min(parsedSec, 30);
          } else {
            const parsedDate = Date.parse(retryAfterHeader);
            if (!isNaN(parsedDate)) {
              backoffSeconds = Math.min(Math.max(1, Math.ceil((parsedDate - Date.now()) / 1000)), 30);
            }
          }
        }
        const jitterMs = Math.floor(Math.random() * 200) + 50;
        const totalWaitMs = backoffSeconds * 1000 + jitterMs;
        sendLog('warn', `[Rate Limit Backoff] HTTP ${statusCode} received on ${item.url}. Backing off for ${(totalWaitMs / 1000).toFixed(1)}s (Retry-After: ${retryAfterHeader || 'none'}).`);
        await delay(totalWaitMs);
      }

      if (response.url) {
        const finalClean = cleanUrl(response.url, baseHostname, stripQueryParams, stripHash) || response.url;
        if (finalClean !== item.url) {
          if (isUrlAlreadyScanned(finalClean)) {
            sendLog('info', `Target ${item.url} redirected to already scanned target ${finalClean} - skipping redundant parse.`);
            markUrlAsVisited(finalClean);
            sendEvent('page', {
              id: 'p_' + visitedCount + '_' + Date.now(),
              url: item.url,
              normalizedUrl: item.url,
              pathname: new URL(item.url).pathname,
              depth: item.depth,
              statusCode: response.status,
              statusText: `${response.statusText} (Redirect to already scanned ${finalClean})`,
              contentType,
              title: `Redirect -> ${finalClean}`,
              discoveredLinksCount: 0,
              sameDomainLinksCount: 0,
              externalLinksCount: 0,
              durationMs: Date.now() - pageStartTime,
              parentUrl: item.parentUrl,
              redirectChain,
              finalUrl,
              timestamp: Date.now(),
            });
            sendCurrentStats(null);
            return;
          }
          markUrlAsVisited(finalClean);
        }
      }

      if (statusCode >= 200 && statusCode < 300) status2xx++;
      else if (statusCode >= 300 && statusCode < 400) status3xx++;
      else if (statusCode >= 400 && statusCode < 500) status4xx++;
      else if (statusCode >= 500) status5xx++;

      if (statusCode >= 400) {
        pageError = `HTTP ${statusCode} ${statusText}`;
        errorsCount++;
      }

      registerDirectoriesForUrl(item.url, item.parentUrl);

      // MIME-first classification for non-HTML responses (extensionless or explicit MIME types)
      const isHtmlMime = contentType.includes('text/html') || contentType.includes('application/xhtml+xml');
      if (!isHtmlMime && response.ok) {
        const inferred = inferFileDetailsFromMime(contentType, item.url);
        const parsedItemUrl = new URL(item.url);
        const pathSegs = parsedItemUrl.pathname.split('/').filter(Boolean);
        const baseName = pathSegs[pathSegs.length - 1] || 'resource';
        const hasExt = /\.[a-zA-Z0-9]{1,8}$/.test(baseName);
        const effectiveFilename = hasExt ? baseName : `${baseName}.${inferred.extension}`;
        const dirSegments = pathSegs.slice(0, hasExt ? -1 : undefined);
        const fileDirectory = dirSegments.length === 0 ? '/' : '/' + dirSegments.join('/') + '/';
        const fileKey = `${parsedItemUrl.hostname.toLowerCase()}::${parsedItemUrl.pathname}`;

        if (!filesMap.has(fileKey)) {
          filesMap.set(fileKey, {
            path: parsedItemUrl.pathname,
            domain: parsedItemUrl.hostname.toLowerCase(),
            filename: effectiveFilename,
            extension: inferred.extension,
            directory: fileDirectory,
            depth: dirSegments.length,
            fileType: inferred.fileType,
            foundOnUrl: item.parentUrl || item.url,
            foundOnUrls: new Set<string>([item.parentUrl || item.url]),
            firstDiscoveredAt: Date.now(),
            url: item.url,
          });
          sendLog('info', `[MIME Classifier] Detected non-HTML file resource (${contentType}) at ${item.url} -> saved as ${inferred.fileType} (.${inferred.extension})`);
        }
      }

      if (captureApiCalls) {
        try {
          const parsedPageUrl = new URL(item.url);
          if (
            isCandidateApi(item.url, parsedPageUrl.pathname, parsedPageUrl.hostname) ||
            contentType.includes('application/json') ||
            contentType.includes('application/graphql')
          ) {
            registerApiEndpoint({
              url: item.url,
              pathname: parsedPageUrl.pathname,
              domain: parsedPageUrl.hostname.toLowerCase(),
              isSameDomain: checkSameDomain(item.url),
              method: 'GET',
              category: classifyCategory(item.url, parsedPageUrl.pathname),
              detectedIn: 'response',
              sourceUrl: item.parentUrl || item.url,
              queryParams: Array.from(parsedPageUrl.searchParams.keys()).slice(0, 15),
              contentType,
              statusCode,
              firstDiscoveredAt: Date.now(),
            });
          }
        } catch {}

        if (response.ok && contentType.includes('application/json')) {
          try {
            const boundedJson = await safeReadBoundedBody(response, 500_000);
            const rawJsonText = boundedJson.text;
            if (
              rawJsonText &&
              (rawJsonText.includes('"paths"') || rawJsonText.includes('"swagger"') || rawJsonText.includes('"openapi"'))
            ) {
              const spec = JSON.parse(rawJsonText);
              if (spec && typeof spec === 'object' && spec.paths && typeof spec.paths === 'object') {
                let specCount = 0;
                for (const [pathKey, pathItem] of Object.entries(spec.paths)) {
                  if (!pathItem || typeof pathItem !== 'object') continue;
                  for (const [rawM, op] of Object.entries(pathItem)) {
                    const mUpper = rawM.toUpperCase();
                    if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(mUpper)) continue;
                    const opObj: any = op;
                    const opParams = Array.isArray(opObj?.parameters) ? opObj.parameters : [];
                    const pathParams = Array.isArray((pathItem as any).parameters) ? (pathItem as any).parameters : [];
                    const allParams = [...pathParams, ...opParams];

                    try {
                      const epUrl = new URL(pathKey.replace(/^\//, ''), originBase).href;
                      const epParsed = new URL(epUrl);
                      const possibleParameters: ApiQueryParameter[] = allParams
                        .map((p: any) => ({
                          name: String(p.name || ''),
                          in: (p.in === 'path'
                            ? 'path'
                            : p.in === 'header'
                            ? 'header'
                            : p.in === 'body'
                            ? 'body'
                            : 'query') as any,
                          type: (p.schema?.type || p.type || 'string') as any,
                          description: p.description || '',
                          required: Boolean(p.required),
                          sampleValue: String(p.example || p.schema?.example || '1'),
                          source: 'schema' as const,
                        }))
                        .filter((p) => p.name);

                      const possibleQueries: ApiPossibleQuery[] = [
                        {
                          title: `${mUpper} Query: ${opObj.summary || pathKey}`,
                          method: mUpper as ApiMethod,
                          url: epUrl,
                          description: opObj.description || opObj.summary || `Declared in OpenAPI specification`,
                          params: possibleParameters,
                          curlExample:
                            mUpper === 'POST'
                              ? `curl -X POST "${epUrl}" -H "Accept: application/json" -H "Content-Type: application/json" -d '{}'`
                              : `curl -X ${mUpper} "${epUrl}" -H "Accept: application/json"`,
                        },
                      ];

                      registerApiEndpoint({
                        url: epUrl,
                        pathname: epParsed.pathname,
                        domain: epParsed.hostname.toLowerCase(),
                        isSameDomain: checkSameDomain(epUrl),
                        method: mUpper as ApiMethod,
                        allowedMethods: [mUpper as ApiMethod],
                        category: classifyCategory(epUrl, epParsed.pathname),
                        detectedIn: 'response',
                        sourceUrl: item.url,
                        queryParams: possibleParameters.filter((p) => p.in === 'query').map((p) => p.name),
                        possibleParameters,
                        possibleQueries,
                        sampleQueryUrl: epUrl,
                        queryCapabilitiesSummary: `OpenAPI spec • ${possibleParameters.length} parameters mapped`,
                        firstDiscoveredAt: Date.now(),
                      });
                      specCount++;
                    } catch {}
                  }
                }
                if (specCount > 0) {
                  sendLog(
                    'success',
                    `[OpenAPI / Swagger Engine] Mapped ${specCount} API endpoints with declared query parameters from ${item.url}`
                  );
                }
              }
            }
          } catch {}
        }
      }

      if (response.ok && isHtmlMime) {
        // Stream-bounded body ingestion: stops streaming once 2MB ceiling is reached
        const bounded = await safeReadBoundedBody(response, 2_000_000);
        const html = bounded.text;
        truncatedBody = bounded.truncated;
        bytesRead = bounded.bytesRead;

        if (truncatedBody) {
          sendLog('warn', `[Stream Guard] Payload for ${item.url} exceeded 2MB - stream terminated and truncated safely at 2,000,000 bytes.`);
        }

        const $ = cheerio.load(html);

        title = $('title').first().text().trim() || '';

        // Meta & Header Directive Guards (Non-robots.txt)
        const xRobotsTag = response.headers.get('x-robots-tag') || '';
        const metaRobots = $('meta[name="robots" i], meta[name="googlebot" i]')
          .map((_, el) => $(el).attr('content') || '')
          .get()
          .join(', ');

        const directivesRaw = `${xRobotsTag}, ${metaRobots}`
          .toLowerCase()
          .split(/[,;\s]+/)
          .map((d) => d.trim())
          .filter(Boolean);

        robotsDirectives = Array.from(new Set(directivesRaw));
        isNoIndex = robotsDirectives.includes('noindex') || robotsDirectives.includes('none');
        hasNoFollow = robotsDirectives.includes('nofollow') || robotsDirectives.includes('none');

        if (isNoIndex) {
          sendLog('info', `[Robots Guard] ${item.url} specifies 'noindex' directive.`);
        }
        if (hasNoFollow) {
          sendLog('info', `[Robots Guard] ${item.url} specifies 'nofollow' directive - link harvesting suppressed for child crawl queue.`);
        }

        // Canonical Tag Normalization & Cluster Resolution
        let rawCanonical = $('link[rel="canonical" i]').attr('href')?.trim();
        if (!rawCanonical) {
          const linkHeader = response.headers.get('link') || '';
          if (linkHeader) {
            const match = linkHeader.match(/<([^>]+)>;\s*rel=["']?canonical["']?/i);
            if (match) {
              rawCanonical = match[1].trim();
            }
          }
        }

        const baseHref = $('base').attr('href');
        const resolveBase = baseHref ? new URL(baseHref, item.url).href : item.url;

        if (rawCanonical) {
          try {
            const resolvedCanonical = new URL(rawCanonical, resolveBase).href;
            const cleanCanonical = cleanUrl(resolvedCanonical, baseHostname, stripQueryParams, stripHash) || resolvedCanonical;
            canonicalUrl = cleanCanonical;

            const normPage = cleanUrl(item.url, baseHostname, stripQueryParams, stripHash) || item.url;
            if (cleanCanonical.toLowerCase() === normPage.toLowerCase()) {
              canonicalStatus = 'self';
            } else {
              const canonicalHost = new URL(cleanCanonical).hostname.toLowerCase();
              if (canonicalHost === baseHostname || checkSameDomain(cleanCanonical)) {
                canonicalStatus = 'canonicalized';
              } else {
                canonicalStatus = 'cross_domain';
              }
            }

            // Check canonical loop
            if (canonicalTrackerMap.get(cleanCanonical) === normPage) {
              canonicalStatus = 'loop';
              sendLog('warn', `[Canonical Resolver] Canonical loop detected between ${normPage} <-> ${cleanCanonical}`);
            } else {
              canonicalTrackerMap.set(normPage, cleanCanonical);
            }
          } catch {
            canonicalStatus = 'invalid';
          }
        }

        if (captureApiCalls) {
          detectApiEndpointsFromHtml($, item.url, resolveBase);
        }

        const candidateLinks: Array<{
          url: string;
          tagType: 'a' | 'script' | 'link' | 'img' | 'media' | 'iframe' | 'source' | 'other';
          text?: string;
          htmlContext?: string;
        }> = [];

        $('a[href]').each((_, el) => {
          const href = $(el).attr('href');
          if (!href) return;
          const trimmed = href.trim();
          if (
            trimmed.startsWith('#') ||
            trimmed.startsWith('javascript:') ||
            trimmed.startsWith('mailto:') ||
            trimmed.startsWith('tel:') ||
            trimmed.startsWith('data:')
          ) {
            return;
          }

          try {
            const resolved = new URL(trimmed, resolveBase).href;
            const text = $(el).text().trim();
            const htmlContext = getElementHtmlSnippet($, el);
            candidateLinks.push({ url: resolved, tagType: 'a', text, htmlContext });
          } catch {
            // invalid URL
          }
        });

        $('link[href]').each((_, el) => {
          const href = $(el).attr('href');
          if (href) {
            try {
              const htmlContext = getElementHtmlSnippet($, el);
              candidateLinks.push({ url: new URL(href.trim(), resolveBase).href, tagType: 'link', htmlContext });
            } catch {}
          }
        });

        $('script[src]').each((_, el) => {
          const src = $(el).attr('src');
          if (src && !src.startsWith('data:')) {
            try {
              const htmlContext = getElementHtmlSnippet($, el);
              candidateLinks.push({ url: new URL(src.trim(), resolveBase).href, tagType: 'script', htmlContext });
            } catch {}
          }
        });

        $('img[src], img[data-src]').each((_, el) => {
          const src = $(el).attr('src') || $(el).attr('data-src');
          if (src && !src.startsWith('data:')) {
            try {
              const alt = $(el).attr('alt')?.trim();
              const htmlContext = getElementHtmlSnippet($, el);
              candidateLinks.push({ url: new URL(src.trim(), resolveBase).href, tagType: 'img', text: alt, htmlContext });
            } catch {}
          }
        });

        $('source[src], video[src], audio[src], iframe[src], embed[src], object[data]').each((_, el) => {
          const src = $(el).attr('src') || $(el).attr('data');
          if (src && !src.startsWith('data:')) {
            try {
              const htmlContext = getElementHtmlSnippet($, el);
              candidateLinks.push({ url: new URL(src.trim(), resolveBase).href, tagType: 'media', htmlContext });
            } catch {}
          }
        });

        $('img[srcset], source[srcset]').each((_, el) => {
          const srcset = $(el).attr('srcset');
          if (srcset) {
            const parts = srcset.split(',');
            for (const part of parts) {
              const urlPart = part.trim().split(/\s+/)[0];
              if (urlPart && !urlPart.startsWith('data:')) {
                try {
                  const htmlContext = getElementHtmlSnippet($, el);
                  candidateLinks.push({ url: new URL(urlPart.trim(), resolveBase).href, tagType: 'img', htmlContext });
                } catch {}
              }
            }
          }
        });

        $('meta[property="og:image"], meta[property="og:image:url"], meta[name="twitter:image"], meta[property="og:video"], meta[property="og:audio"]').each((_, el) => {
          const content = $(el).attr('content');
          if (content && !content.startsWith('data:')) {
            try {
              candidateLinks.push({ url: new URL(content.trim(), resolveBase).href, tagType: 'media' });
            } catch {}
          }
        });

        discoveredHere = candidateLinks.length;
        totalLinksFound += discoveredHere;

        for (const itemLink of candidateLinks) {
          const rawLink = itemLink.url;

          if (!checkSameDomain(rawLink)) {
            externalHere++;
            registerExternalLink(rawLink, item.url, itemLink.tagType, itemLink.text, itemLink.htmlContext);
            continue;
          }

          sameDomainHere++;
          sameDomainLinksFound++;

          const normalizedLink = cleanUrl(rawLink, baseHostname, stripQueryParams, stripHash);
          if (!normalizedLink) continue;

          try {
            const pathName = new URL(normalizedLink).pathname;
            if (pathFilterRegex && !pathFilterRegex.test(pathName)) {
              continue;
            }
            if (excludeFilterRegex && excludeFilterRegex.test(pathName)) {
              continue;
            }
          } catch {}

          registerDirectoriesForUrl(normalizedLink, item.url);

          const nextDepth = item.depth + 1;
          const isFileNonHtml = /\.(pdf|zip|tar|gz|exe|dmg|iso|mp3|mp4|avi|mov|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot|css|js|mjs|json|xml|csv|tsv|yaml|yml|doc|docx|xls|xlsx|ppt|pptx)$/i.test(
            new URL(normalizedLink).pathname
          );

          // If current page declared 'nofollow', suppress enqueueing child pages
          if (
            !hasNoFollow &&
            nextDepth <= maxDepth &&
            !isFileNonHtml &&
            !isUrlAlreadyScannedOrQueued(normalizedLink) &&
            visitedCount + queue.length < maxPages
          ) {
            markUrlAsQueued(normalizedLink);
            queue.push({
              url: normalizedLink,
              depth: nextDepth,
              parentUrl: item.url,
            });
          }
        }
      }
    } catch (err: any) {
      errorsCount++;
      if (err?.isCircularRedirect) {
        statusCode = err.statusCode || 310;
        statusText = 'ERR_TOO_MANY_REDIRECTS (Circular loop)';
        pageError = err.message;
        redirectChain = err.redirectChain || [item.url];
        finalUrl = err.finalUrl || item.url;
        sendLog('warn', `[Redirect Loop Breaker] ${err.message}`);
      } else {
        pageError = err.message || 'Fetch failed';
        statusText = err.name === 'AbortError' ? 'Timeout' : 'Network Error';
        sendLog('warn', `Failed to crawl ${item.url}: ${pageError}`);
      }
    }

    const durationMs = Date.now() - pageStartTime;

    sendEvent('page', {
      id: 'p_' + visitedCount + '_' + Date.now(),
      url: item.url,
      normalizedUrl: item.url,
      pathname: new URL(item.url).pathname,
      depth: item.depth,
      statusCode,
      statusText,
      contentType,
      title,
      discoveredLinksCount: discoveredHere,
      sameDomainLinksCount: sameDomainHere,
      externalLinksCount: externalHere,
      durationMs,
      parentUrl: item.parentUrl,
      error: pageError,
      canonicalUrl,
      canonicalStatus,
      isNoIndex,
      hasNoFollow,
      robotsDirectives,
      redirectChain,
      finalUrl,
      truncatedBody,
      bytesRead,
      timestamp: Date.now(),
    });

    sendEvent('directories_update', {
      directories: getDirectoriesSummary(),
      files: getFilesSummary(),
      externalLinks: getExternalLinksSummary(),
      apiEndpoints: getApiEndpointsSummary(),
    });

    sendCurrentStats(null);
  }

  while (queue.length > 0 && visitedCount < maxPages && !isAborted) {
    const batchSize = Math.min(concurrency, queue.length, maxPages - visitedCount);
    const batch = queue.splice(0, batchSize);

    await Promise.all(
      batch.map(async (item) => {
        if (isAborted) return;
        await crawlPage(item);
        if (requestDelayMs > 0) {
          await delay(requestDelayMs);
        }
      })
    );
  }

  if (queryCrtSubdomains && !isAborted) {
    const rootApex = extractApexDomain(baseHostname);
    sendLog('info', `[Post-Crawl Recon] Primary crawl completed. Querying Certificate Transparency (crt.name/v1/search?apex=${rootApex}) for discovered subdomains...`);

    try {
      const crtResult = await fetchCrtNameSubdomains(rootApex, getEffectiveUserAgent());
      if (crtResult && crtResult.subdomains && crtResult.subdomains.length > 0) {
        let newSubsCount = 0;

        for (const sub of crtResult.subdomains) {
          const cleanSub = sub.replace(/^\*\./, '').trim().toLowerCase();
          if (!cleanSub || isPrivateOrLocalHost(cleanSub)) continue;

          const subTargetUrl = `https://${cleanSub}/`;
          registerDirectoriesForUrl(subTargetUrl, 'crt.name (Certificate Transparency)');
          newSubsCount++;
        }

        sendLog(
          'success',
          `[Post-Crawl Recon] Certificate Transparency (crt.name) query complete: Discovered ${crtResult.subdomains.length} subdomains and registered ${newSubsCount} host directory nodes for apex ${rootApex}`
        );

        sendEvent('directories_update', {
          directories: getDirectoriesSummary(),
          files: getFilesSummary(),
          externalLinks: getExternalLinksSummary(),
          apiEndpoints: getApiEndpointsSummary(),
        });
      } else {
        sendLog('info', `[Post-Crawl Recon] crt.name query returned 0 subdomains for apex ${rootApex}`);
      }
    } catch (err: any) {
      sendLog('warn', `[Post-Crawl Recon] crt.name query encountered an issue: ${err.message || 'connection failed'}`);
    }
  }

  const finalDuration = Date.now() - startTime;
  const status = isAborted ? 'stopped' : 'completed';

  const extLinksSummary = getExternalLinksSummary();
  const uniqueExtDomains = new Set(extLinksSummary.map((e) => e.domain)).size;
  const apiSummaryList = getApiEndpointsSummary();

  sendEvent('stats', {
    pagesVisited: visitedCount,
    pagesQueued: queue.length,
    uniqueDirectories: directoriesMap.size,
    uniqueFiles: filesMap.size,
    externalLinksCount: extLinksSummary.length,
    externalDomainsCount: uniqueExtDomains,
    apiEndpointsCount: apiSummaryList.length,
    totalLinksFound,
    sameDomainLinksFound,
    errorsCount,
    status2xx,
    status3xx,
    status4xx,
    status5xx,
    startTime,
    endTime: Date.now(),
    currentUrl: null,
  });

  sendEvent('complete', {
    status,
    totalPages: visitedCount,
    totalDirectories: directoriesMap.size,
    totalFiles: filesMap.size,
    totalExternalLinks: extLinksSummary.length,
    totalApiEndpoints: apiSummaryList.length,
    totalLinks: totalLinksFound,
    sameDomainLinks: sameDomainLinksFound,
    elapsedMs: finalDuration,
    directories: getDirectoriesSummary(),
    files: getFilesSummary(),
    externalLinks: extLinksSummary,
    apiEndpoints: apiSummaryList,
  });

  const apiReport = captureApiCalls ? `, & ${apiSummaryList.length} API endpoints` : '';
  sendLog('success', `Crawl finished with ${visitedCount} pages crawled. Discovered ${directoriesMap.size} unique directories, ${filesMap.size} internal files, ${extLinksSummary.length} external links${apiReport} across ${uniqueExtDomains} external domains in ${(finalDuration / 1000).toFixed(1)}s`);

  cleanup();
  res.end();
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Site Directory Crawler server running at http://localhost:${PORT}`);
  });
}

startServer();

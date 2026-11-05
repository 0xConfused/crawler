// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CrawlConfig,
  CrawlStats,
  DirectoryRecord,
  FileRecord,
  PageRecord,
  ExternalLinkRecord,
  ApiEndpointRecord,
  ApiMethod,
  ApiQueryParameter,
  AI_ASSISTANCE_FILENAMES,
  BlockingEvent,
} from '../types';
import {
  normalizeUrl,
  isSameDomain,
  extractApexDomain,
  extractPathDirectories,
  getDirectoryForUrl,
  computeDirectoryHierarchy,
  detectFileRecord,
  classifyFileCategory,
  canonicalizeApiEndpointUrl,
  isPlatformDevArtifact,
  inferFileDetailsFromMime,
} from '../utils/urlUtils';
import {
  fetchWithProxyFallback,
  probeApiEndpointDetails,
  fetchCrtSubdomains,
  resolveDnsRecords,
} from './domainIntelligenceService';
import { ApiScannerEngine } from '../api-scanner/scannerEngine';

export interface BrowserCrawlCallbacks {
  onPage: (page: PageRecord) => void;
  onDirectory: (directory: DirectoryRecord) => void;
  onDirectoriesUpdate?: (directories: DirectoryRecord[]) => void;
  onFile: (file: FileRecord) => void;
  onFilesUpdate?: (files: FileRecord[]) => void;
  onApiEndpoint: (endpoint: ApiEndpointRecord) => void;
  onApiEndpointsUpdate?: (endpoints: ApiEndpointRecord[]) => void;
  onExternalLink: (link: ExternalLinkRecord) => void;
  onExternalLinksUpdate?: (links: ExternalLinkRecord[]) => void;
  onStats: (stats: CrawlStats) => void;
  onLog: (log: { level: 'info' | 'warn' | 'error' | 'success'; message: string; timestamp: number; isBlocking?: boolean }) => void;
  onDone: () => void;
  onError: (err: string) => void;
  onBlockingEvent?: (event: BlockingEvent) => void;
}

export function startBrowserCrawl(config: CrawlConfig, callbacks: BrowserCrawlCallbacks): { stop: () => void } {
  let isAborted = false;
  const abortController = new AbortController();

  const stop = () => {
    if (isAborted) return;
    isAborted = true;
    abortController.abort();
    callbacks.onLog({
      level: 'warn',
      message: 'Recon halted by user. Discovered directories, files, and components preserved.',
      timestamp: Date.now(),
    });
  };

  (async () => {
    let startUrl = config.startUrl.trim();
    if (!/^https?:\/\//i.test(startUrl)) {
      startUrl = 'https://' + startUrl;
    }

    let parsedStartUrl: URL;
    try {
      parsedStartUrl = new URL(startUrl);
    } catch {
      const errTimestamp = Date.now();
      callbacks.onError('Invalid target domain or URL format provided.');
      callbacks.onBlockingEvent?.({
        type: 'log',
        id: `log_${errTimestamp}`,
        message: 'Invalid target domain or URL format provided. Recon blocked.',
        timestamp: errTimestamp,
      });
      return;
    }

    const baseHostname = parsedStartUrl.hostname.toLowerCase();
    const origin = `${parsedStartUrl.protocol}//${parsedStartUrl.host}`;
    const maxDepth = Math.max(1, config.maxDepth || 3);
    const maxPages = Math.max(1, config.maxPages || 40);
    const concurrency = Math.max(1, Math.min(8, config.concurrency || 3));
    const requestDelayMs = Math.max(50, config.requestDelayMs || 150);

    const stats: CrawlStats = {
      pagesVisited: 0,
      pagesQueued: 1,
      uniqueDirectories: 0,
      uniqueFiles: 0,
      externalLinksCount: 0,
      externalDomainsCount: 0,
      totalLinksFound: 0,
      sameDomainLinksFound: 0,
      apiEndpointsCount: 0,
      errorsCount: 0,
      status2xx: 0,
      status3xx: 0,
      status4xx: 0,
      status5xx: 0,
      startTime: Date.now(),
      endTime: null,
      currentUrl: startUrl,
    };

    callbacks.onLog({
      level: 'info',
      message: `Initiating browser-native static recon against target origin ${origin}`,
      timestamp: Date.now(),
    });

    const pathFilterRegex = config.pathFilter?.trim()
      ? new RegExp(config.pathFilter.trim(), 'i')
      : null;
    const excludeFilterRegex = config.excludeFilter?.trim()
      ? new RegExp(config.excludeFilter.trim(), 'i')
      : null;

    const visitedSet = new Set<string>();
    const queuedSet = new Set<string>();
    const queue: Array<{ url: string; depth: number; parentUrl?: string }> = [];
    const canonicalTrackerMap = new Map<string, string>();

    const directoriesMap = new Map<string, DirectoryRecord>();
    const filesMap = new Map<string, FileRecord>();
    const externalLinksMap = new Map<string, ExternalLinkRecord>();
    const apiEndpointsMap = new Map<string, ApiEndpointRecord>();

    const scannerEngine = new ApiScannerEngine({
      targetHost: baseHostname,
    });

    function getLookupKeys(raw: string): string[] {
      const keys = new Set<string>();
      try {
        const clean = normalizeUrl(raw, {
          stripQueryParams: config.stripQueryParams,
          stripHash: config.stripHash,
        }) || raw;
        keys.add(clean.toLowerCase());
        const parsed = new URL(clean);
        keys.add(parsed.href.toLowerCase());
        if (parsed.pathname === '/' || parsed.pathname.endsWith('/')) {
          const noSlash = new URL(parsed.href);
          noSlash.pathname = noSlash.pathname.replace(/\/+$/, '') || '/';
          keys.add(noSlash.href.toLowerCase());
        } else {
          const withSlash = new URL(parsed.href);
          withSlash.pathname = withSlash.pathname + '/';
          keys.add(withSlash.href.toLowerCase());
        }
      } catch {
        keys.add(raw.toLowerCase().trim());
      }
      return Array.from(keys);
    }

    function isVisited(u: string): boolean {
      return getLookupKeys(u).some((k) => visitedSet.has(k));
    }

    function isQueuedOrVisited(u: string): boolean {
      return getLookupKeys(u).some((k) => visitedSet.has(k) || queuedSet.has(k));
    }

    function markQueued(u: string) {
      for (const k of getLookupKeys(u)) {
        queuedSet.add(k);
      }
    }

    function markVisited(u: string) {
      for (const k of getLookupKeys(u)) {
        visitedSet.add(k);
        queuedSet.add(k);
      }
    }

    function syncHierarchySnapshots() {
      const updatedDirs = computeDirectoryHierarchy(directoriesMap, filesMap);
      stats.uniqueDirectories = updatedDirs.length;
      stats.uniqueFiles = filesMap.size;
      stats.externalLinksCount = externalLinksMap.size;
      const uniqueDomains = new Set(Array.from(externalLinksMap.values()).map((l) => l.domain));
      stats.externalDomainsCount = uniqueDomains.size;
      stats.apiEndpointsCount = apiEndpointsMap.size;

      callbacks.onDirectoriesUpdate?.(updatedDirs);
      callbacks.onFilesUpdate?.(Array.from(filesMap.values()));
      callbacks.onApiEndpointsUpdate?.(Array.from(apiEndpointsMap.values()));
      callbacks.onExternalLinksUpdate?.(Array.from(externalLinksMap.values()));
      callbacks.onStats({ ...stats });
    }

    // Register root directory
    const rootDirKey = `${baseHostname}::/`;
    const rootDir: DirectoryRecord = {
      path: '/',
      domain: baseHostname,
      depth: 0,
      parentPath: null,
      directPageUrls: [startUrl],
      allNestedUrlsCount: 1,
      subDirectories: [],
      firstDiscoveredAt: Date.now(),
      foundOnUrl: startUrl,
      foundOnUrls: [startUrl],
      directFiles: [],
    };
    directoriesMap.set(rootDirKey, rootDir);
    callbacks.onDirectory(rootDir);
    stats.uniqueDirectories = 1;

    function registerDirectory(targetUrl: string, sourceUrl?: string) {
      try {
        if (isPlatformDevArtifact(targetUrl)) return;

        const parsed = new URL(targetUrl);
        if (isPlatformDevArtifact(parsed.pathname)) return;
        const host = parsed.hostname.toLowerCase();
        const dirs = extractPathDirectories(parsed.pathname);
        const now = Date.now();
        const originSource = sourceUrl || targetUrl;

        for (let i = 0; i < dirs.length; i++) {
          const dirPath = dirs[i];
          if (isPlatformDevArtifact(dirPath)) continue;
          const dirKey = `${host}::${dirPath}`;
          let rec = directoriesMap.get(dirKey);

          if (!rec) {
            const depth = dirPath === '/' ? 0 : dirPath.split('/').filter(Boolean).length;
            let parentPath: string | null = null;
            if (dirPath !== '/') {
              const segs = dirPath.split('/').filter(Boolean);
              parentPath = segs.length === 1 ? '/' : '/' + segs.slice(0, -1).join('/') + '/';
            }

            rec = {
              path: dirPath,
              domain: host,
              depth,
              parentPath,
              directPageUrls: [],
              allNestedUrlsCount: 0,
              subDirectories: [],
              firstDiscoveredAt: now,
              foundOnUrl: originSource,
              foundOnUrls: [originSource],
              directFiles: [],
            };
            directoriesMap.set(dirKey, rec);
            stats.uniqueDirectories = directoriesMap.size;
            callbacks.onDirectory(rec);
          } else {
            if (rec.foundOnUrls && !rec.foundOnUrls.includes(originSource)) {
              rec.foundOnUrls.push(originSource);
            }
          }
        }

        const directDir = getDirectoryForUrl(targetUrl);
        if (isPlatformDevArtifact(directDir)) return;
        const directKey = `${host}::${directDir}`;
        let dirRec = directoriesMap.get(directKey);
        if (!dirRec) {
          const depth = directDir === '/' ? 0 : directDir.split('/').filter(Boolean).length;
          let parentPath: string | null = null;
          if (directDir !== '/') {
            const segs = directDir.split('/').filter(Boolean);
            parentPath = segs.length === 1 ? '/' : '/' + segs.slice(0, -1).join('/') + '/';
          }
          dirRec = {
            path: directDir,
            domain: host,
            depth,
            parentPath,
            directPageUrls: [],
            allNestedUrlsCount: 0,
            subDirectories: [],
            firstDiscoveredAt: now,
            foundOnUrl: originSource,
            foundOnUrls: [originSource],
            directFiles: [],
          };
          directoriesMap.set(directKey, dirRec);
        }

        const isStaticFile = /\.[a-zA-Z0-9]{1,8}$/.test(parsed.pathname);
        if (!isStaticFile && !dirRec.directPageUrls.includes(targetUrl)) {
          dirRec.directPageUrls.push(targetUrl);
        }
      } catch {
        // ignore
      }
    }

    function registerFile(targetUrl: string, sourceUrl?: string) {
      try {
        if (isPlatformDevArtifact(targetUrl)) return;
        const fileRec = detectFileRecord(targetUrl, sourceUrl || targetUrl);
        if (!fileRec || isPlatformDevArtifact(fileRec.path)) return;

        const originHost = fileRec.domain || baseHostname;
        const dirKey = `${originHost}::${fileRec.directory}`;
        if (!directoriesMap.has(dirKey)) {
          registerDirectory(`https://${originHost}${fileRec.directory}`, sourceUrl);
        }

        const fileKey = `${fileRec.domain}::${fileRec.path}`;
        let existing = filesMap.get(fileKey);

        if (!existing) {
          filesMap.set(fileKey, fileRec);
          stats.uniqueFiles = filesMap.size;
          callbacks.onFile(fileRec);
        } else {
          const originSrc = sourceUrl || targetUrl;
          if (existing.foundOnUrls && !existing.foundOnUrls.includes(originSrc)) {
            existing.foundOnUrls.push(originSrc);
          }
        }
      } catch {
        // ignore
      }
    }

    function registerExternal(
      rawUrl: string,
      sourceUrl: string,
      tagType: 'a' | 'script' | 'link' | 'img' | 'media' | 'iframe' | 'source' | 'other' = 'a',
      linkText?: string,
      htmlContext?: string
    ) {
      try {
        if (isPlatformDevArtifact(rawUrl)) return;
        const parsed = new URL(rawUrl);
        if (isPlatformDevArtifact(parsed.pathname)) return;
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;

        const extHostname = parsed.hostname.toLowerCase();
        const extUrl = parsed.href;
        const existing = externalLinksMap.get(extUrl);

        if (existing) {
          if (!existing.foundOnUrls.includes(sourceUrl)) {
            existing.foundOnUrls.push(sourceUrl);
          }
        } else {
          const match = parsed.pathname.match(/\.([a-zA-Z0-9]{1,8})$/);
          let isAssetOrFile = false;
          let fileType = undefined;
          let extension = undefined;

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

          const rec: ExternalLinkRecord = {
            url: extUrl,
            domain: extHostname,
            rootDomain: extractApexDomain(extHostname),
            pathname: parsed.pathname,
            isAssetOrFile,
            fileType,
            extension,
            foundOnUrl: sourceUrl,
            foundOnUrls: [sourceUrl],
            firstDiscoveredAt: Date.now(),
            tagType,
            linkText: linkText?.slice(0, 80),
            htmlContext: htmlContext?.slice(0, 200),
          };

          externalLinksMap.set(extUrl, rec);
          stats.externalLinksCount = externalLinksMap.size;
          const uniqueDomains = new Set(Array.from(externalLinksMap.values()).map((l) => l.domain));
          stats.externalDomainsCount = uniqueDomains.size;
          callbacks.onExternalLink(rec);
        }
      } catch {
        // ignore
      }
    }

    function registerDiscoveredApi(
      routeUrl: string,
      method: ApiMethod = 'GET',
      sourceUrl: string,
      snippet?: string,
      params: ApiQueryParameter[] = [],
      detectedIn: 'fetch-xhr' | 'script-inline' | 'script-tag' | 'link' | 'data-attr' | 'response' | 'probe' = 'script-inline'
    ) {
      try {
        if (isPlatformDevArtifact(routeUrl)) return;
        const canonical = canonicalizeApiEndpointUrl(routeUrl);
        if (isPlatformDevArtifact(canonical.pathname)) return;
        const resolvedUrl = canonical.url.startsWith('/')
          ? `${origin}${canonical.url}`
          : canonical.url;
        if (isPlatformDevArtifact(resolvedUrl)) return;
        const parsedEp = new URL(resolvedUrl);
        const epDomain = parsedEp.hostname.toLowerCase();
        const sameDomain = isSameDomain(resolvedUrl, baseHostname, config.allowSubdomains);

        // Canonical base URL without query string for stable endpoint deduplication
        const canonicalBaseUrl = `${parsedEp.protocol}//${parsedEp.host}${canonical.pathname}`;
        const key = `${method}::${epDomain}::${canonical.pathname}`;

        // Ingest URL search parameters into structured query parameters
        const urlParams: ApiQueryParameter[] = [];
        parsedEp.searchParams.forEach((val, name) => {
          if (name && !urlParams.some((p) => p.name === name)) {
            let cleanVal = val;
            try {
              cleanVal = decodeURIComponent(val);
            } catch {}
            let inferredType: 'string' | 'number' | 'boolean' | 'array' = 'string';
            if (val === 'true' || val === 'false') inferredType = 'boolean';
            else if (/^-?\d+(\.\d+)?$/.test(val)) inferredType = 'number';
            else if (val.includes(',') && !val.includes('{')) inferredType = 'array';

            urlParams.push({
              name,
              in: 'query',
              type: inferredType,
              sampleValue: cleanVal || undefined,
              status: 'UNKNOWN',
              source: 'observed',
            });
          }
        });

        // Combine explicit/form params and URL search params
        const combinedParams: ApiQueryParameter[] = [...params];
        for (const up of urlParams) {
          if (!combinedParams.some((p) => p.name === up.name && p.in === up.in)) {
            combinedParams.push(up);
          }
        }

        const queryParamsFromUrl = Array.from(parsedEp.searchParams.keys());
        const paramKeys = Array.from(
          new Set([
            ...combinedParams.filter((p) => p.in === 'query').map((p) => p.name),
            ...queryParamsFromUrl,
          ])
        );

        if (apiEndpointsMap.has(key)) {
          const existing = apiEndpointsMap.get(key)!;
          if (!existing.sourceUrls.includes(sourceUrl)) {
            existing.sourceUrls.push(sourceUrl);
          }
          // Merge parameters
          const existingParams = existing.possibleParameters || [];
          const merged = [...existingParams];
          for (const cp of combinedParams) {
            const foundIdx = merged.findIndex((p) => p.name === cp.name && p.in === cp.in);
            if (foundIdx === -1) {
              merged.push(cp);
            } else {
              if (!merged[foundIdx].sampleValue && cp.sampleValue) {
                merged[foundIdx] = { ...merged[foundIdx], sampleValue: cp.sampleValue };
              }
              if (cp.status && (!merged[foundIdx].status || merged[foundIdx].status === 'UNKNOWN')) {
                merged[foundIdx] = { ...merged[foundIdx], status: cp.status, required: cp.required };
              }
            }
          }
          if (merged.length > 0) {
            existing.possibleParameters = merged;
          }
          existing.queryParams = Array.from(
            new Set([
              ...(existing.queryParams || []),
              ...paramKeys,
            ])
          );
          if (!existing.sampleQueryUrl && resolvedUrl !== canonicalBaseUrl && resolvedUrl.includes('?')) {
            existing.sampleQueryUrl = resolvedUrl;
          }
          if (!existing.snippet && snippet) {
            existing.snippet = snippet.slice(0, 300);
          }
          return;
        }

        let category: any = 'rest';
        if (resolvedUrl.includes('graphql') || (snippet && snippet.includes('query '))) {
          category = 'graphql';
        } else if (resolvedUrl.includes('/auth') || resolvedUrl.includes('/login') || resolvedUrl.includes('/oauth')) {
          category = 'auth';
        }

        const rec: ApiEndpointRecord = {
          id: 'api_' + (apiEndpointsMap.size + 1) + '_' + Math.random().toString(36).slice(2, 7),
          url: canonicalBaseUrl,
          pathname: canonical.pathname,
          domain: epDomain,
          isSameDomain: sameDomain,
          method,
          allowedMethods: [method],
          category,
          detectedIn,
          sourceUrl,
          sourceUrls: [sourceUrl],
          queryParams: paramKeys,
          possibleParameters: combinedParams.length > 0 ? combinedParams : undefined,
          sampleQueryUrl: resolvedUrl !== canonicalBaseUrl && resolvedUrl.includes('?') ? resolvedUrl : undefined,
          snippet: snippet?.slice(0, 300),
          firstDiscoveredAt: Date.now(),
        };

        apiEndpointsMap.set(key, rec);
        stats.apiEndpointsCount = apiEndpointsMap.size;
        callbacks.onApiEndpoint(rec);

        if (config.autoQueryApis && !isAborted) {
          probeApiEndpointDetails(
            canonicalBaseUrl,
            method,
            config.corsProxyMode,
            config.customProxyConfig || config.customProxyUrl
          ).then((probeResult) => {
            const current = apiEndpointsMap.get(key);
            if (current) {
              const updated = { ...current, ...probeResult };
              apiEndpointsMap.set(key, updated);
              callbacks.onApiEndpoint(updated);
            }
          });
        }
      } catch {
        // ignore
      }
    }

    // 1. Initial Robots.txt fetch
    if (config.includeRobotsTxt) {
      const robotsUrl = `${origin}/robots.txt`;
      callbacks.onLog({
        level: 'info',
        message: `Inspecting robots.txt protocol at ${robotsUrl}`,
        timestamp: Date.now(),
      });

      try {
        const robotsRes = await fetchWithProxyFallback(
          robotsUrl,
          config.corsProxyMode,
          config.customProxyConfig || config.customProxyUrl,
          config.stealthApiKey,
          { signal: abortController.signal }
        );
        if (robotsRes.ok) {
          const robotsText = await robotsRes.text();
          callbacks.onLog({
            level: 'success',
            message: `Discovered robots.txt directive (${robotsText.length} bytes)`,
            timestamp: Date.now(),
          });

          registerFile(robotsUrl, origin);

          const lines = robotsText.split('\n');
          for (const line of lines) {
            const clean = line.trim();
            if (clean.toLowerCase().startsWith('sitemap:')) {
              const smUrl = clean.slice(8).trim();
              if (smUrl && !isQueuedOrVisited(smUrl)) {
                queue.push({ url: smUrl, depth: 1, parentUrl: robotsUrl });
                markQueued(smUrl);
              }
            } else if (clean.toLowerCase().startsWith('disallow:')) {
              const path = clean.slice(9).trim();
              if (path && path !== '/') {
                registerDirectory(`${origin}${path}`, robotsUrl);
              }
            }
          }
        }
      } catch {
        // Non-fatal
      }
    }

    // 2. AI Assistance Files Discovery
    if (config.includeAiAssistance) {
      callbacks.onLog({
        level: 'info',
        message: 'Auditing LLM context & AI assistance files (llms.txt, ai.txt)',
        timestamp: Date.now(),
      });

      for (const filename of AI_ASSISTANCE_FILENAMES.slice(0, 10)) {
        if (isAborted) break;
        const targetAiUrl = `${origin}/${filename}`;
        try {
          const res = await fetchWithProxyFallback(
            targetAiUrl,
            config.corsProxyMode,
            config.customProxyConfig || config.customProxyUrl,
            config.stealthApiKey,
            { method: 'HEAD', signal: abortController.signal }
          );
          if (res.ok) {
            callbacks.onLog({
              level: 'success',
              message: `AI Manifest Located: /${filename}`,
              timestamp: Date.now(),
            });
            registerFile(targetAiUrl, origin);
          }
        } catch {
          // ignore
        }
      }
    }

    // Queue initial start URL
    queue.push({ url: startUrl, depth: 0 });
    markQueued(startUrl);

    // Concurrency worker loop
    async function processQueueItem(item: { url: string; depth: number; parentUrl?: string }) {
      if (isAborted || stats.pagesVisited >= maxPages) return;

      const pageStart = Date.now();
      stats.currentUrl = item.url;
      callbacks.onStats({ ...stats, currentUrl: item.url });

      markVisited(item.url);

      try {
        if (requestDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, requestDelayMs));
        }

        const res = await fetchWithProxyFallback(
          item.url,
          config.corsProxyMode,
          config.customProxyConfig || config.customProxyUrl,
          config.stealthApiKey,
          {
            signal: abortController.signal,
            headers: {
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
          }
        );

        const durationMs = Date.now() - pageStart;
        const statusCode = res.status;
        const contentType = res.headers.get('content-type') || 'text/html';

        if (statusCode >= 200 && statusCode < 300) stats.status2xx++;
        else if (statusCode >= 300 && statusCode < 400) stats.status3xx++;
        else if (statusCode >= 400 && statusCode < 500) {
          stats.status4xx++;
          if (item.depth === 0) {
            stats.errorsCount++;
          }
        }
        else if (statusCode >= 500) {
          stats.status5xx++;
          stats.errorsCount++;
        }

        stats.pagesVisited++;

        const responseText = await res.text();
        const capturedResponseHeaders: Record<string, string> = {};
        try {
          res.headers.forEach((val, key) => {
            capturedResponseHeaders[key] = val;
          });
        } catch {}
        let pageTitle = '';
        let discoveredCount = 0;
        let sameDomainCount = 0;
        let redirectChain: string[] = [item.url];
        const redirectHeader = res.headers.get('x-redirect-chain');
        if (redirectHeader) {
          try {
            redirectChain = JSON.parse(redirectHeader);
          } catch {}
        }
        let canonicalUrl: string | undefined = undefined;
        let canonicalStatus: 'self' | 'canonicalized' | 'cross_domain' | 'loop' | 'invalid' | undefined = undefined;
        let isNoIndex = false;
        let hasNoFollow = false;
        let robotsDirectives: string[] = [];

        registerDirectory(item.url, item.parentUrl);
        registerFile(item.url, item.parentUrl);

        // Populate API based off observed URI key-values on crawled page URL
        try {
          const itemUrlObj = new URL(item.url);
          if (itemUrlObj.searchParams.size > 0 && !isPlatformDevArtifact(itemUrlObj.pathname)) {
            registerDiscoveredApi(item.url, 'GET', item.parentUrl || item.url, undefined, [], 'response');
          }
        } catch {}

        const isHtmlLike =
          contentType.includes('html') ||
          responseText.includes('<html') ||
          responseText.includes('<body') ||
          responseText.includes('<!DOCTYPE html') ||
          responseText.includes('<head');

        // MIME-first classification for non-HTML responses
        if (!isHtmlLike && res.ok) {
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
              foundOnUrls: [item.parentUrl || item.url],
              firstDiscoveredAt: Date.now(),
              url: item.url,
            });
          }
        }

        if (isHtmlLike) {
          const doc = new DOMParser().parseFromString(responseText, 'text/html');
          pageTitle = doc.title || '';

          // Meta & Header Directive Guards (Non-robots.txt)
          const xRobots = res.headers.get('x-robots-tag') || '';
          const metaRobots = Array.from(doc.querySelectorAll('meta[name="robots" i], meta[name="googlebot" i]'))
            .map((el) => el.getAttribute('content') || '')
            .join(', ');

          robotsDirectives = Array.from(new Set(
            `${xRobots}, ${metaRobots}`
              .toLowerCase()
              .split(/[,;\s]+/)
              .map((d) => d.trim())
              .filter(Boolean)
          ));
          isNoIndex = robotsDirectives.includes('noindex') || robotsDirectives.includes('none');
          hasNoFollow = robotsDirectives.includes('nofollow') || robotsDirectives.includes('none');

          // 1. Resolve Document Base URI
          const baseEl = doc.querySelector('base[href]');
          let docBaseUrl = item.url;
          if (baseEl) {
            const bHref = baseEl.getAttribute('href');
            if (bHref) {
              try {
                docBaseUrl = new URL(bHref, item.url).href;
              } catch {}
            }
          }

          // Canonical Tag Normalization & Cluster Resolution
          const canonicalEl = doc.querySelector('link[rel="canonical" i]');
          let rawCanonical = canonicalEl?.getAttribute('href')?.trim();
          if (!rawCanonical) {
            const linkHeader = res.headers.get('link') || '';
            const match = linkHeader.match(/<([^>]+)>;\s*rel=["']?canonical["']?/i);
            if (match) rawCanonical = match[1].trim();
          }

          if (rawCanonical) {
            try {
              const resolvedCanonical = new URL(rawCanonical, docBaseUrl).href;
              const cleanCanonical = normalizeUrl(resolvedCanonical, {
                stripQueryParams: config.stripQueryParams,
                stripHash: config.stripHash,
              }) || resolvedCanonical;
              canonicalUrl = cleanCanonical;

              const normPage = normalizeUrl(item.url, {
                stripQueryParams: config.stripQueryParams,
                stripHash: config.stripHash,
              }) || item.url;

              if (cleanCanonical.toLowerCase() === normPage.toLowerCase()) {
                canonicalStatus = 'self';
              } else {
                const canonicalHost = new URL(cleanCanonical).hostname.toLowerCase();
                if (canonicalHost === baseHostname || isSameDomain(cleanCanonical, baseHostname, config.allowSubdomains)) {
                  canonicalStatus = 'canonicalized';
                } else {
                  canonicalStatus = 'cross_domain';
                }
              }

              if (canonicalTrackerMap.get(cleanCanonical) === normPage) {
                canonicalStatus = 'loop';
              } else {
                canonicalTrackerMap.set(normPage, cleanCanonical);
              }
            } catch {
              canonicalStatus = 'invalid';
            }
          }

          // 2. Extract Anchor Links (<a>, <area>)
          const anchors = Array.from(doc.querySelectorAll('a[href], area[href]'));
          discoveredCount += anchors.length;

          for (const a of anchors) {
            const rawHref = a.getAttribute('href');
            if (
              !rawHref ||
              rawHref.startsWith('#') ||
              rawHref.startsWith('javascript:') ||
              rawHref.startsWith('mailto:') ||
              rawHref.startsWith('tel:')
            ) {
              continue;
            }

            try {
              const resolvedUrl = new URL(rawHref, docBaseUrl).href;
              const linkText = (a.textContent || '').trim().replace(/\s+/g, ' ');
              const snippet = a.outerHTML.slice(0, 150);

              const sameDomain = isSameDomain(resolvedUrl, baseHostname, config.allowSubdomains);

              if (sameDomain) {
                sameDomainCount++;
                stats.sameDomainLinksFound++;

                const clean = normalizeUrl(resolvedUrl, {
                  stripQueryParams: config.stripQueryParams,
                  stripHash: config.stripHash,
                }) || resolvedUrl;

                const parsedClean = new URL(clean);
                const pathMatches = !pathFilterRegex || pathFilterRegex.test(parsedClean.pathname);
                const excludeMatches = excludeFilterRegex && excludeFilterRegex.test(parsedClean.pathname);

                registerDirectory(clean, item.url);
                registerFile(clean, item.url);

                // Populate API based off observed URI key-values on anchor links
                try {
                  const resolvedUrlObj = new URL(resolvedUrl);
                  if (resolvedUrlObj.searchParams.size > 0 && !isPlatformDevArtifact(resolvedUrlObj.pathname)) {
                    registerDiscoveredApi(
                      resolvedUrl,
                      'GET',
                      item.url,
                      snippet || undefined,
                      [],
                      'link'
                    );
                  }
                } catch {}

                // If current page declared 'nofollow', suppress enqueueing child pages
                if (!hasNoFollow && pathMatches && !excludeMatches && item.depth + 1 <= maxDepth) {
                  if (!isQueuedOrVisited(clean) && queue.length < maxPages * 3) {
                    queue.push({ url: clean, depth: item.depth + 1, parentUrl: item.url });
                    markQueued(clean);
                    stats.pagesQueued = queue.length;
                  }
                }
              } else {
                registerExternal(resolvedUrl, item.url, 'a', linkText, snippet);
              }
            } catch {
              // ignore malformed URLs
            }
          }

          // 3. Extract Form Components (<form>, <input>, <select>, <textarea>)
          const forms = Array.from(doc.querySelectorAll('form'));
          for (const form of forms) {
            const action = form.getAttribute('action');
            const method = ((form.getAttribute('method') || 'GET').toUpperCase() as ApiMethod) || 'GET';
            let formUrl = item.url;
            if (action) {
              try {
                formUrl = new URL(action, docBaseUrl).href;
              } catch {}
            }

            const controls = Array.from(form.querySelectorAll('input, select, textarea, button[name]'));
            const params: ApiQueryParameter[] = [];
            for (const ctrl of controls) {
              let name = ctrl.getAttribute('name');
              if (!name) {
                const id = ctrl.getAttribute('id');
                if (id) {
                  name = id.replace(/^(login|signup|auth|input|form|field|txt)[-_]/i, '');
                }
              }
              if (!name) continue;
              const type = ctrl.getAttribute('type') || ctrl.tagName.toLowerCase();
              const val = ctrl.getAttribute('value') || undefined;
              const isRequired = ctrl.hasAttribute('required');
              params.push({
                name,
                in: method === 'GET' ? 'query' : 'body',
                type: type === 'number' ? 'number' : type === 'checkbox' ? 'boolean' : 'string',
                sampleValue: val,
                required: isRequired,
                status: isRequired ? 'REQUIRED' : 'OPTIONAL',
                source: 'observed',
              });
            }

            const sameDomain = isSameDomain(formUrl, baseHostname, config.allowSubdomains);

            if (sameDomain) {
              registerDirectory(formUrl, item.url);
              registerFile(formUrl, item.url);

              const isApiLike =
                method !== 'GET' ||
                params.length > 0 ||
                formUrl.includes('/api/') ||
                formUrl.includes('/search') ||
                formUrl.includes('/auth') ||
                formUrl.includes('/login');

              if (isApiLike) {
                registerDiscoveredApi(
                  formUrl,
                  method,
                  item.url,
                  form.outerHTML.slice(0, 300),
                  params,
                  'data-attr'
                );
              }

              if (method === 'GET' && action && item.depth + 1 <= maxDepth) {
                const clean = normalizeUrl(formUrl, {
                  stripQueryParams: config.stripQueryParams,
                  stripHash: config.stripHash,
                }) || formUrl;
                if (!isQueuedOrVisited(clean) && queue.length < maxPages * 3) {
                  queue.push({ url: clean, depth: item.depth + 1, parentUrl: item.url });
                  markQueued(clean);
                  stats.pagesQueued = queue.length;
                }
              }
            } else {
              registerExternal(formUrl, item.url, 'other', 'Form Action', form.outerHTML.slice(0, 200));
            }
          }

          // 4. Extract Interactive Component Data Attributes (HTMX, Alpine, Custom Web Components)
          const interactiveEls = Array.from(
            doc.querySelectorAll(
              '[data-url], [data-api], [data-endpoint], [data-href], [data-action], [data-src], [hx-get], [hx-post], [hx-put], [hx-delete], [hx-patch]'
            )
          );
          for (const el of interactiveEls) {
            const targetAttrVal =
              el.getAttribute('hx-get') ||
              el.getAttribute('hx-post') ||
              el.getAttribute('hx-put') ||
              el.getAttribute('hx-delete') ||
              el.getAttribute('hx-patch') ||
              el.getAttribute('data-url') ||
              el.getAttribute('data-api') ||
              el.getAttribute('data-endpoint') ||
              el.getAttribute('data-href') ||
              el.getAttribute('data-action') ||
              el.getAttribute('data-src');

            if (!targetAttrVal || targetAttrVal.startsWith('#') || targetAttrVal.startsWith('javascript:')) {
              continue;
            }

            try {
              const resolved = new URL(targetAttrVal, docBaseUrl).href;
              let method: ApiMethod = 'GET';
              if (el.hasAttribute('hx-post')) method = 'POST';
              else if (el.hasAttribute('hx-put')) method = 'PUT';
              else if (el.hasAttribute('hx-delete')) method = 'DELETE';
              else if (el.hasAttribute('hx-patch')) method = 'PATCH';
              else if (el.getAttribute('data-method')) {
                const dm = (el.getAttribute('data-method') || '').toUpperCase();
                if (['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(dm)) method = dm as ApiMethod;
              }

              if (isSameDomain(resolved, baseHostname, config.allowSubdomains)) {
                registerDirectory(resolved, item.url);
                registerFile(resolved, item.url);
                registerDiscoveredApi(resolved, method, item.url, el.outerHTML.slice(0, 250), [], 'data-attr');
              } else {
                registerExternal(resolved, item.url, 'other', 'Data Attribute', el.outerHTML.slice(0, 150));
              }
            } catch {}
          }

          // 5. Extract JSON Hydration & State Components (Next.js, Nuxt, LD+JSON)
          const jsonScripts = Array.from(
            doc.querySelectorAll(
              'script[type="application/json"], script[type="application/ld+json"], script#__NEXT_DATA__, script#__NUXT_DATA__'
            )
          );
          for (const jsEl of jsonScripts) {
            const content = jsEl.textContent || '';
            if (!content.trim()) continue;

            const apiPathMatches = content.matchAll(/["'](\/(?:api|v[0-9]|graphql|rest|auth)[^"'\s\\]+)["']/gi);
            for (const m of apiPathMatches) {
              const pathMatch = m[1];
              try {
                const resolved = new URL(pathMatch, docBaseUrl).href;
                registerDirectory(resolved, item.url);
                registerDiscoveredApi(resolved, 'GET', item.url, `Component JSON manifest: ${pathMatch}`, [], 'script-inline');
              } catch {}
            }

            const urlMatches = content.matchAll(/https?:\/\/[a-zA-Z0-9\-\.]+(?::[0-9]+)?(?:\/[^\s"'\\]*)?/gi);
            for (const um of urlMatches) {
              const rawMatch = um[0];
              try {
                if (isSameDomain(rawMatch, baseHostname, config.allowSubdomains)) {
                  registerDirectory(rawMatch, item.url);
                  registerFile(rawMatch, item.url);
                } else {
                  registerExternal(rawMatch, item.url, 'other', 'JSON Schema URL');
                }
              } catch {}
            }
          }

          // 6. Extract <link> stylesheets, manifests, alternates
          const linkTags = Array.from(doc.querySelectorAll('link[href]'));
          for (const link of linkTags) {
            const href = link.getAttribute('href');
            if (href && !isPlatformDevArtifact(href)) {
              try {
                const resolved = new URL(href, docBaseUrl).href;
                if (isPlatformDevArtifact(resolved)) continue;
                if (isSameDomain(resolved, baseHostname, config.allowSubdomains)) {
                  registerFile(resolved, item.url);
                  registerDirectory(resolved, item.url);
                } else {
                  registerExternal(resolved, item.url, 'link');
                }
              } catch {}
            }
          }

          // 7. Extract <script> elements & run API scanner + regex
          const scripts = Array.from(doc.querySelectorAll('script'));
          for (const s of scripts) {
            const src = s.getAttribute('src');
            if (src && !isPlatformDevArtifact(src)) {
              try {
                const scriptUrl = new URL(src, docBaseUrl).href;
                if (isPlatformDevArtifact(scriptUrl)) continue;
                if (isSameDomain(scriptUrl, baseHostname, config.allowSubdomains)) {
                  registerFile(scriptUrl, item.url);
                  registerDirectory(scriptUrl, item.url);
                } else {
                  registerExternal(scriptUrl, item.url, 'script');
                }
              } catch {}
            }

            const inlineCode = s.textContent || '';
            if (inlineCode.trim().length > 10) {
              try {
                const ops = scannerEngine.ingestJavaScript(inlineCode, item.url);
                ops.forEach((op) => {
                  registerDiscoveredApi(op.normalizedPath, op.method as ApiMethod, item.url);
                });
              } catch {}

              const fetchMatches = inlineCode.matchAll(/fetch\(\s*["']([^"']+)["']/gi);
              for (const fm of fetchMatches) {
                registerDiscoveredApi(fm[1], 'GET', item.url, fm[0], [], 'script-inline');
              }
              const axiosMatches = inlineCode.matchAll(/axios\.(get|post|put|delete|patch)\(\s*["']([^"']+)["']/gi);
              for (const am of axiosMatches) {
                registerDiscoveredApi(am[2], am[1].toUpperCase() as ApiMethod, item.url, am[0], [], 'script-inline');
              }
            }
          }

          // 8. Extract <img>, <picture>, <video>, <audio>, <iframe> and srcset
          const mediaTags = Array.from(
            doc.querySelectorAll('img, video, audio, source, iframe')
          );
          for (const m of mediaTags) {
            const src = m.getAttribute('src');
            if (src) {
              try {
                const mediaUrl = new URL(src, docBaseUrl).href;
                if (isSameDomain(mediaUrl, baseHostname, config.allowSubdomains)) {
                  registerFile(mediaUrl, item.url);
                  registerDirectory(mediaUrl, item.url);
                } else {
                  registerExternal(mediaUrl, item.url, 'media');
                }
              } catch {}
            }

            const srcset = m.getAttribute('srcset');
            if (srcset) {
              const candidates = srcset.split(',').map((c) => c.trim().split(/\s+/)[0]).filter(Boolean);
              for (const cand of candidates) {
                try {
                  const mediaUrl = new URL(cand, docBaseUrl).href;
                  if (isSameDomain(mediaUrl, baseHostname, config.allowSubdomains)) {
                    registerFile(mediaUrl, item.url);
                    registerDirectory(mediaUrl, item.url);
                  } else {
                    registerExternal(mediaUrl, item.url, 'media');
                  }
                } catch {}
              }
            }
          }
        }

        stats.totalLinksFound += discoveredCount;
        syncHierarchySnapshots();

        const is4xx = statusCode >= 400 && statusCode < 500;
        const isRoot = item.depth === 0;
        const isAccessDenied = statusCode === 401 || statusCode === 403 || statusCode === 429;
        const isBlocking = (isRoot && is4xx) || isAccessDenied;
        let blockingReason: string | undefined = undefined;
        if (isBlocking) {
          if (isRoot && is4xx) {
            blockingReason = `Root seed endpoint returned HTTP ${statusCode} (${res.statusText || 'Client Error'}). Target reconnaissance blocked.`;
          } else if (isAccessDenied) {
            blockingReason = `HTTP ${statusCode} (${res.statusText || 'Access Denied/Rate Limited'}) blocked target exploration.`;
          }
        }

        const pageRecord: PageRecord = {
          id: 'page_' + stats.pagesVisited + '_' + Math.random().toString(36).slice(2, 6),
          url: item.url,
          normalizedUrl: normalizeUrl(item.url) || item.url,
          pathname: new URL(item.url).pathname,
          depth: item.depth,
          statusCode,
          statusText: res.statusText || 'OK',
          contentType,
          title: pageTitle,
          discoveredLinksCount: discoveredCount,
          sameDomainLinksCount: sameDomainCount,
          externalLinksCount: discoveredCount - sameDomainCount,
          durationMs,
          parentUrl: item.parentUrl,
          canonicalUrl,
          canonicalStatus,
          isNoIndex,
          hasNoFollow,
          robotsDirectives,
          redirectChain,
          finalUrl: item.url,
          timestamp: Date.now(),
          method: 'GET',
          httpVersion: 'HTTP/1.1',
          requestHeaders: {
            'Host': new URL(item.url).host,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            ...(item.parentUrl ? { 'Referer': item.parentUrl } : {}),
            'Connection': 'keep-alive',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': item.parentUrl ? 'same-origin' : 'none',
          },
          responseHeaders: capturedResponseHeaders,
          responseBody: responseText ? responseText.slice(0, 50000) : '',
          isBlocking,
          blockingReason,
          error: (isRoot && is4xx) ? `HTTP ${statusCode} ${res.statusText || 'Client Error'} at root` : undefined,
        };

        callbacks.onPage(pageRecord);
        callbacks.onStats({
          ...stats,
          pagesQueued: queue.length,
          currentUrl: item.url,
        });

        if (isBlocking) {
          callbacks.onLog({
            level: 'warn',
            message: `[RECON BLOCKED] ${blockingReason}`,
            timestamp: Date.now(),
            isBlocking: true,
          });
          callbacks.onBlockingEvent?.({
            type: 'page',
            id: pageRecord.id,
            url: item.url,
            statusCode,
            message: blockingReason || `HTTP ${statusCode} blocked recon`,
            timestamp: Date.now(),
          });
        } else {
          callbacks.onLog({
            level: 'success',
            message: `Scanned [${statusCode}] ${new URL(item.url).pathname} (${discoveredCount} links & components discovered)`,
            timestamp: Date.now(),
          });
        }
      } catch (err: any) {
        stats.errorsCount++;
        const isRootError = item.depth === 0 || stats.pagesVisited === 0;
        const logTimestamp = Date.now();
        const logId = `log_${logTimestamp}_${Math.random().toString(36).slice(2, 6)}`;
        const errMessage = `Network error scanning ${item.url}: ${err.message || 'Request failed'}${isRootError ? ' - Target unreachable, reconnaissance blocked' : ''}`;

        callbacks.onLog({
          level: 'error',
          message: errMessage,
          timestamp: logTimestamp,
          isBlocking: isRootError,
        });

        if (isRootError) {
          callbacks.onBlockingEvent?.({
            type: 'log',
            id: logId,
            url: item.url,
            message: errMessage,
            timestamp: logTimestamp,
          });
        }
      }
    }

    async function worker() {
      while (queue.length > 0 && !isAborted && stats.pagesVisited < maxPages) {
        const item = queue.shift();
        if (!item) break;
        await processQueueItem(item);
      }
    }

    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);

    // Passive reconnaissance fallback if active crawling was blocked by CORS/WAF or yielded low results
    if ((stats.pagesVisited === 0 || stats.uniqueFiles === 0) && !isAborted) {
      callbacks.onLog({
        level: 'warn',
        message: 'Active page fetch was restricted by origin CORS/WAF. Initiating passive DNS & Certificate Transparency reconnaissance...',
        timestamp: Date.now(),
      });

      try {
        const apex = extractApexDomain(baseHostname);

        // 1. DNS DoH Records Probe
        const dnsRes = await resolveDnsRecords(baseHostname);
        if (dnsRes.dns && dnsRes.dns.length > 0) {
          callbacks.onLog({
            level: 'success',
            message: `Discovered ${dnsRes.dns.length} DNS records via DoH (RFC 8484)`,
            timestamp: Date.now(),
          });
        }

        // 2. Certificate Transparency Logs
        const crtRes = await fetchCrtSubdomains(apex, config.corsProxyMode, config.customProxyConfig || config.customProxyUrl);
        if (crtRes.subdomains && crtRes.subdomains.length > 0) {
          callbacks.onLog({
            level: 'success',
            message: `Discovered ${crtRes.subdomains.length} subdomains in Certificate Transparency logs`,
            timestamp: Date.now(),
          });
          crtRes.subdomains.slice(0, 30).forEach((sub) => {
            const subUrl = `https://${sub}/`;
            registerDirectory(subUrl, startUrl);
          });
        }

        // 3. Register root assets
        registerFile(`${origin}/robots.txt`, startUrl);
        registerFile(`${origin}/favicon.ico`, startUrl);
        registerFile(`${origin}/sitemap.xml`, startUrl);
        registerFile(`${origin}/.well-known/security.txt`, startUrl);

        syncHierarchySnapshots();
      } catch {}
    }

    syncHierarchySnapshots();

    stats.endTime = Date.now();
    stats.currentUrl = null;
    callbacks.onStats({ ...stats });
    callbacks.onLog({
      level: 'success',
      message: `Recon sequence completed. Discovered ${directoriesMap.size} directories, ${filesMap.size} files, ${apiEndpointsMap.size} API endpoints.`,
      timestamp: Date.now(),
    });
    callbacks.onDone();
  })().catch((err: any) => {
    const errTimestamp = Date.now();
    const errMsg = err.message || 'Fatal reconnaissance engine error';
    callbacks.onError(errMsg);
    callbacks.onBlockingEvent?.({
      type: 'log',
      id: `log_${errTimestamp}`,
      message: errMsg,
      timestamp: errTimestamp,
    });
  });

  return { stop };
}

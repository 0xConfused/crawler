// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  CrawlConfig,
  CrawlStatus,
  CrawlStats,
  DirectoryRecord,
  FileRecord,
  PageRecord,
  ExternalLinkRecord,
  ViewTab,
  DomainIntelligence,
  ApiEndpointRecord,
  BlockingEvent,
} from './types';
import { CrawlerHeader } from './components/CrawlerHeader';
import { CrawlForm } from './components/CrawlForm';
import { CrawlMetrics } from './components/CrawlMetrics';
import { DirectoryTreeView } from './components/DirectoryTreeView';
import { DirectoryTableView } from './components/DirectoryTableView';
import { PagesLogView } from './components/PagesLogView';
import { ExternalLinksView } from './components/ExternalLinksView';
import { SubdomainsSansView } from './components/SubdomainsSansView';
import { DomainIntelligenceView } from './components/DomainIntelligenceView';
import { ApiEndpointsView } from './components/ApiEndpointsView';
import { DirectoryDetailModal } from './components/DirectoryDetailModal';
import { FileDetailModal } from './components/FileDetailModal';
import { ExportModal } from './components/ExportModal';
import { ExternalLinkWarningModal } from './components/ExternalLinkWarningModal';
import { OwnershipWarningModal, LiabilityAcceptanceRecord } from './components/OwnershipWarningModal';
import { LocalDownloadFooter } from './components/LocalDownloadFooter';
import { FolderTree, ListFilter, FileText, ExternalLink, ShieldCheck, Network, Code } from 'lucide-react';
import { extractApexDomain } from './utils/urlUtils';
import { startBrowserCrawl } from './services/browserCrawler';
import { useMouseNavigation } from './hooks/useMouseNavigation';

const INITIAL_CONFIG: CrawlConfig = {
  startUrl: '',
  maxDepth: 3,
  maxPages: 40,
  allowSubdomains: false,
  stripQueryParams: false,
  stripHash: false,
  concurrency: 3,
  requestDelayMs: 150,
  includeRobotsTxt: false,
  includeAiAssistance: false,
  captureApiCalls: false,
  autoQueryApis: false,
  randomizeUserAgent: false,
  corsProxyMode: 'direct',
  customProxyUrl: '',
  customProxyConfig: {
    urlTemplate: '',
    urlDestination: 'placeholder',
    urlQueryParam: 'url',
    urlHeaderName: 'X-Target-URL',
    apiKey: (() => {
      try {
        return sessionStorage.getItem('0xconfused_custom_proxy_api_key') || sessionStorage.getItem('0xconfused_stealth_api_key') || '';
      } catch {
        return '';
      }
    })(),
    apiKeyDestination: 'none',
    apiKeyQueryParam: 'api_key',
    apiKeyHeaderName: 'X-API-Key',
    apiKeyHeaderPrefix: '',
  },
  stealthApiKey: (() => {
    try {
      return sessionStorage.getItem('0xconfused_stealth_api_key') || '';
    } catch {
      return '';
    }
  })(),
};

const INITIAL_STATS: CrawlStats = {
  pagesVisited: 0,
  pagesQueued: 0,
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
  startTime: null,
  endTime: null,
  currentUrl: null,
};

export default function App() {
  const [config, setConfig] = useState<CrawlConfig>(INITIAL_CONFIG);
  const [status, setStatus] = useState<CrawlStatus>('idle');
  const [stats, setStats] = useState<CrawlStats>(INITIAL_STATS);
  const [directories, setDirectories] = useState<DirectoryRecord[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [externalLinks, setExternalLinks] = useState<ExternalLinkRecord[]>([]);
  const [apiEndpoints, setApiEndpoints] = useState<ApiEndpointRecord[]>([]);
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [logs, setLogs] = useState<Array<{ level: 'info' | 'warn' | 'error' | 'success'; message: string; timestamp: number }>>([]);
  const [activeTab, setActiveTab] = useState<ViewTab>('table');
  const [selectedDirectory, setSelectedDirectory] = useState<DirectoryRecord | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileRecord | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [currentDomain, setCurrentDomain] = useState<string | null>(null);
  const [targetOrigin, setTargetOrigin] = useState<string>('');
  const [pendingExternalUrl, setPendingExternalUrl] = useState<string | null>(null);
  const [domainIntelligenceCache, setDomainIntelligenceCache] = useState<Record<string, DomainIntelligence>>({});
  const [whoisTargetDomain, setWhoisTargetDomain] = useState<string | null>(null);
  const [whoisRefreshKey, setWhoisRefreshKey] = useState<number>(0);
  const [showOwnershipWarning, setShowOwnershipWarning] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('0xconfused_liability_accepted_v2');
      if (!stored) return true;
      const parsed = JSON.parse(stored);
      return !(
        parsed?.termsVersion === '2026.2' &&
        parsed?.userAcknowledgment?.ownershipConfirmed === true &&
        parsed?.userAcknowledgment?.networkTrafficUnderstood === true &&
        parsed?.userAcknowledgment?.termsAgreed === true
      );
    } catch {
      return true;
    }
  });

  const [paramTab, setParamTab] = useState<'standard' | 'advanced'>('standard');
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [inspectedPage, setInspectedPage] = useState<PageRecord | null>(null);
  const [highlightedEvent, setHighlightedEvent] = useState<BlockingEvent | null>(null);

  useMouseNavigation({
    activeTab,
    setActiveTab,
    selectedDirectory,
    setSelectedDirectory,
    directories,
    selectedFile,
    setSelectedFile,
    files,
    showExportModal,
    setShowExportModal,
    pendingExternalUrl,
    setPendingExternalUrl,
    showOwnershipWarning,
    setShowOwnershipWarning,
    paramTab,
    setParamTab,
    showAdvanced,
    setShowAdvanced,
    inspectedPage,
    setInspectedPage,
    pages,
  });

  const handleAgreeOwnership = (record: LiabilityAcceptanceRecord) => {
    try {
      localStorage.setItem('0xconfused_liability_accepted_v2', JSON.stringify(record));
    } catch {}
    setShowOwnershipWarning(false);
  };

  const activeCrawlerRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest('a') as HTMLAnchorElement | null;
      if (!anchor) return;

      const rawHref = anchor.getAttribute('href') || '';
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('blob:') || rawHref.startsWith('data:')) {
        return;
      }

      if (anchor.getAttribute('data-bypass-warning') === 'true') {
        return;
      }

      const href = anchor.href;
      if (/^https?:\/\//i.test(href)) {
        try {
          const parsed = new URL(href);
          const hostname = parsed.hostname.toLowerCase();
          if (hostname === '0xconfused.com' || hostname.endsWith('.0xconfused.com')) {
            return;
          }
        } catch {
          // ignore
        }

        try {
          if (sessionStorage.getItem('skip_external_link_warning') === 'true') {
            return;
          }
        } catch {
          // ignore
        }

        e.preventDefault();
        e.stopPropagation();
        setPendingExternalUrl(href);
      }
    };

    document.addEventListener('click', handleGlobalClick, true);
    return () => {
      document.removeEventListener('click', handleGlobalClick, true);
    };
  }, []);

  const handleConfirmExternalNavigation = (url: string) => {
    setPendingExternalUrl(null);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleUpdateConfig = useCallback((newConfig: Partial<CrawlConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...newConfig };
      if (newConfig.customProxyConfig?.apiKey !== undefined) {
        try {
          sessionStorage.setItem('0xconfused_custom_proxy_api_key', newConfig.customProxyConfig.apiKey);
        } catch {}
      }
      if (newConfig.stealthApiKey !== undefined) {
        try {
          sessionStorage.setItem('0xconfused_stealth_api_key', newConfig.stealthApiKey);
        } catch {}
      }
      return next;
    });
  }, []);

  const handleStopCrawl = useCallback(() => {
    if (activeCrawlerRef.current) {
      activeCrawlerRef.current.stop();
      activeCrawlerRef.current = null;
    }
    setStatus('stopped');
    setStats((prev) => ({
      ...prev,
      endTime: prev.endTime || Date.now(),
    }));
  }, []);

  const handleReset = useCallback(() => {
    handleStopCrawl();
    setStatus('idle');
    setStats(INITIAL_STATS);
    setDirectories([]);
    setFiles([]);
    setExternalLinks([]);
    setApiEndpoints([]);
    setPages([]);
    setLogs([]);
    setSelectedDirectory(null);
    setCurrentDomain(null);
    setTargetOrigin('');
    setWhoisRefreshKey(0);
    setWhoisTargetDomain(null);
    setHighlightedEvent(null);
  }, [handleStopCrawl]);

  const handleCacheDomainData = useCallback((dom: string, data: DomainIntelligence) => {
    setDomainIntelligenceCache((prev) => {
      if (prev[dom] === data) return prev;
      return { ...prev, [dom]: data };
    });
  }, []);

  const handleWhoisDomainChange = useCallback((dom: string) => {
    setWhoisTargetDomain(dom);
  }, []);

  const handleImportSession = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const data = JSON.parse(text);

        if (!data || typeof data !== 'object') {
          throw new Error('Imported file does not contain a valid JSON object.');
        }

        // 1. Restore Config if present
        if (data.config && typeof data.config === 'object') {
          setConfig((prev) => ({
            ...prev,
            ...data.config,
          }));
        }

        // 2. Restore Origin & Domains
        const origin = typeof data.targetOrigin === 'string' ? data.targetOrigin : (data.config?.startUrl || '');
        let cleanHost = data.currentDomain || '';
        if (origin) {
          setTargetOrigin(origin);
          try {
            const parsedUrl = new URL(origin);
            cleanHost = parsedUrl.hostname;
            if (!data.currentDomain) {
              setCurrentDomain(cleanHost);
            }
          } catch {
            // ignore malformed url in import
          }
        }
        if (data.currentDomain) {
          setCurrentDomain(data.currentDomain);
        } else if (cleanHost) {
          setCurrentDomain(cleanHost);
        }

        const resolvedWhoisDomain = data.whoisTargetDomain || (cleanHost ? cleanHost.toLowerCase().replace(/:\d+$/, '') : null);
        if (resolvedWhoisDomain) {
          setWhoisTargetDomain(resolvedWhoisDomain);
        }

        // 3. Restore Directories
        const importedDirs: DirectoryRecord[] = Array.isArray(data.directories)
          ? data.directories.map((d: any) => ({
              path: typeof d.path === 'string' ? d.path : '/',
              domain: d.domain || cleanHost || undefined,
              depth: typeof d.depth === 'number' ? d.depth : (typeof d.path === 'string' ? d.path.split('/').filter(Boolean).length : 0),
              parentPath: d.parentPath !== undefined ? d.parentPath : null,
              foundOnUrl: d.foundOnUrl || (Array.isArray(d.foundOnUrls) ? d.foundOnUrls[0] : '') || '',
              foundOnUrls: Array.isArray(d.foundOnUrls) ? d.foundOnUrls : (d.foundOnUrl ? [d.foundOnUrl] : []),
              directPageUrls: Array.isArray(d.directPageUrls) ? d.directPageUrls : (Array.isArray(d.directUrls) ? d.directUrls : []),
              allNestedUrlsCount: typeof d.allNestedUrlsCount === 'number' ? d.allNestedUrlsCount : (typeof d.nestedPagesCount === 'number' ? d.nestedPagesCount : 0),
              subDirectories: Array.isArray(d.subDirectories) ? d.subDirectories : [],
              firstDiscoveredAt: typeof d.firstDiscoveredAt === 'number' ? d.firstDiscoveredAt : Date.now(),
              directFiles: Array.isArray(d.directFiles) ? d.directFiles : undefined,
            }))
          : [];

        // 4. Restore Files
        const importedFiles: FileRecord[] = Array.isArray(data.files)
          ? data.files.map((f: any) => ({
              path: typeof f.path === 'string' ? f.path : '',
              filename: f.filename || (typeof f.path === 'string' ? f.path.split('/').pop() : '') || 'file',
              extension: f.extension || (typeof f.path === 'string' ? f.path.split('.').pop() || '' : ''),
              fileType: f.fileType || 'other',
              directory: f.directory || '/',
              depth: typeof f.depth === 'number' ? f.depth : 0,
              foundOnUrl: f.foundOnUrl || (Array.isArray(f.foundOnUrls) ? f.foundOnUrls[0] : '') || '',
              foundOnUrls: Array.isArray(f.foundOnUrls) ? f.foundOnUrls : (f.foundOnUrl ? [f.foundOnUrl] : []),
              firstDiscoveredAt: typeof f.firstDiscoveredAt === 'number' ? f.firstDiscoveredAt : Date.now(),
              url: f.fullUrl || f.url || '',
              mimeType: f.mimeType,
              domain: f.domain || cleanHost || undefined,
            }))
          : [];

        // 5. Restore API Endpoints
        const importedApis: ApiEndpointRecord[] = Array.isArray(data.apiEndpoints)
          ? data.apiEndpoints.map((ep: any, idx: number) => ({
              id: ep.id || `api_${idx}_${Date.now()}`,
              url: ep.url || '',
              pathname: ep.pathname || '',
              domain: ep.domain || cleanHost || '',
              isSameDomain: ep.isSameDomain ?? true,
              method: ep.method || 'GET',
              allowedMethods: Array.isArray(ep.allowedMethods) ? ep.allowedMethods : [ep.method || 'GET'],
              category: ep.category || 'rest',
              detectedIn: ep.detectedIn || 'fetch-xhr',
              sourceUrl: ep.sourceUrl || '',
              sourceUrls: Array.isArray(ep.sourceUrls) ? ep.sourceUrls : (ep.sourceUrl ? [ep.sourceUrl] : []),
              queryParams: Array.isArray(ep.queryParams) ? ep.queryParams : [],
              possibleParameters: Array.isArray(ep.possibleParameters)
                ? ep.possibleParameters.map((p: any) => ({
                    ...p,
                    status: p.status || (p.required === true ? 'REQUIRED' : p.required === false ? 'OPTIONAL' : 'UNKNOWN'),
                  }))
                : [],
              possibleQueries: Array.isArray(ep.possibleQueries) ? ep.possibleQueries : [],
              sampleQueryUrl: ep.sampleQueryUrl,
              graphqlFields: Array.isArray(ep.graphqlFields) ? ep.graphqlFields : undefined,
              queryCapabilitiesSummary: ep.queryCapabilitiesSummary,
              contentType: ep.contentType,
              statusCode: ep.statusCode,
              latencyMs: ep.latencyMs,
              responsePreview: ep.responsePreview,
              snippet: ep.snippet,
              authHint: ep.authHint,
              firstDiscoveredAt: typeof ep.firstDiscoveredAt === 'number' ? ep.firstDiscoveredAt : Date.now(),
              lastQueriedAt: ep.lastQueriedAt,
            }))
          : [];

        // 6. Restore External Links
        const importedLinks: ExternalLinkRecord[] = Array.isArray(data.externalLinks)
          ? data.externalLinks.map((l: any) => ({
              url: l.url || '',
              domain: l.domain || '',
              rootDomain: l.rootDomain || extractApexDomain(l.domain || ''),
              pathname: l.pathname || '',
              isAssetOrFile: Boolean(l.isAssetOrFile),
              fileType: l.fileType,
              extension: l.extension,
              foundOnUrl: l.foundOnUrl || '',
              foundOnUrls: Array.isArray(l.foundOnUrls) ? l.foundOnUrls : (l.foundOnUrl ? [l.foundOnUrl] : []),
              firstDiscoveredAt: typeof l.firstDiscoveredAt === 'number' ? l.firstDiscoveredAt : Date.now(),
              tagType: l.tagType,
              linkText: l.linkText,
              htmlContext: l.htmlContext,
            }))
          : [];

        // 7. Restore Pages
        const importedPages: PageRecord[] = Array.isArray(data.pages)
          ? data.pages.map((p: any, idx: number) => ({
              id: p.id || `page_${idx}_${Date.now()}`,
              url: p.url || '',
              normalizedUrl: p.normalizedUrl || p.url || '',
              pathname: p.pathname || '/',
              depth: typeof p.depth === 'number' ? p.depth : 0,
              statusCode: typeof p.statusCode === 'number' ? p.statusCode : 200,
              statusText: p.statusText || 'OK',
              contentType: p.contentType || 'text/html',
              title: p.title || '',
              discoveredLinksCount: typeof p.discoveredLinksCount === 'number' ? p.discoveredLinksCount : 0,
              sameDomainLinksCount: typeof p.sameDomainLinksCount === 'number' ? p.sameDomainLinksCount : 0,
              externalLinksCount: typeof p.externalLinksCount === 'number' ? p.externalLinksCount : 0,
              durationMs: typeof p.durationMs === 'number' ? p.durationMs : 0,
              parentUrl: p.parentUrl,
              error: p.error,
              timestamp: typeof p.timestamp === 'number' ? p.timestamp : Date.now(),
              canonicalUrl: p.canonicalUrl,
              canonicalStatus: p.canonicalStatus,
              isNoIndex: p.isNoIndex,
              hasNoFollow: p.hasNoFollow,
              robotsDirectives: p.robotsDirectives,
              redirectChain: p.redirectChain,
              finalUrl: p.finalUrl,
              truncatedBody: p.truncatedBody,
              bytesRead: p.bytesRead,
              method: p.method || 'GET',
              requestHeaders: p.requestHeaders,
              httpVersion: p.httpVersion,
              responseHeaders: p.responseHeaders,
              responseBody: p.responseBody,
              isBlocking: p.isBlocking,
              blockingReason: p.blockingReason,
            }))
          : [];

        // 8. Restore Logs
        const importedLogs = Array.isArray(data.logs)
          ? data.logs.filter((l: any) => l && typeof l.message === 'string')
          : [];

        // 9. Restore Domain Intelligence Cache
        if (data.domainIntelligenceCache && typeof data.domainIntelligenceCache === 'object') {
          setDomainIntelligenceCache(data.domainIntelligenceCache);
        }

        // 10. Restore / Calculate Stats
        const statsObj: CrawlStats = {
          pagesVisited: data.stats?.pagesVisited ?? (importedPages.length || importedDirs.length),
          pagesQueued: data.stats?.pagesQueued ?? 0,
          uniqueDirectories: data.stats?.uniqueDirectories ?? importedDirs.length,
          uniqueFiles: data.stats?.uniqueFiles ?? importedFiles.length,
          externalLinksCount: data.stats?.externalLinksCount ?? importedLinks.length,
          externalDomainsCount: data.stats?.externalDomainsCount ?? new Set(importedLinks.map((l) => l.domain)).size,
          totalLinksFound: data.stats?.totalLinksFound ?? (importedDirs.reduce((acc, d) => acc + d.directPageUrls.length, 0) + importedLinks.length),
          sameDomainLinksFound: data.stats?.sameDomainLinksFound ?? importedDirs.reduce((acc, d) => acc + d.directPageUrls.length, 0),
          apiEndpointsCount: data.stats?.apiEndpointsCount ?? importedApis.length,
          errorsCount: data.stats?.errorsCount ?? importedPages.filter((p) => p.statusCode >= 400 || p.error).length,
          status2xx: data.stats?.status2xx ?? importedPages.filter((p) => p.statusCode >= 200 && p.statusCode < 300).length,
          status3xx: data.stats?.status3xx ?? importedPages.filter((p) => p.statusCode >= 300 && p.statusCode < 400).length,
          status4xx: data.stats?.status4xx ?? importedPages.filter((p) => p.statusCode >= 400 && p.statusCode < 500).length,
          status5xx: data.stats?.status5xx ?? importedPages.filter((p) => p.statusCode >= 500).length,
          startTime: data.stats?.startTime ?? (Date.now() - 10000),
          endTime: data.stats?.endTime ?? Date.now(),
          currentUrl: data.stats?.currentUrl ?? origin ?? null,
        };

        setDirectories(importedDirs);
        setFiles(importedFiles);
        setApiEndpoints(importedApis);
        setExternalLinks(importedLinks);
        setPages(importedPages);
        setStats(statsObj);
        setStatus(data.status || 'completed');
        setWhoisRefreshKey((k) => k + 1);

        setLogs([
          {
            level: 'success',
            message: `Imported session: ${importedDirs.length} dirs, ${importedFiles.length} files, ${importedApis.length} APIs, ${importedLinks.length} external links, ${importedPages.length} pages`,
            timestamp: Date.now(),
          },
          ...importedLogs,
        ]);
      } catch (err) {
        setLogs((prev) => [
          {
            level: 'error',
            message: `Failed to import session file: ${err instanceof Error ? err.message : 'Invalid JSON format'}`,
            timestamp: Date.now(),
          },
          ...prev,
        ]);
      }
    };
    reader.readAsText(file);
  }, []);

  const handleStartCrawl = useCallback((overrideUrl?: string) => {
    if (showOwnershipWarning) {
      setShowOwnershipWarning(true);
      return;
    }

    const rawUrl = overrideUrl || config.startUrl;
    if (!rawUrl.trim()) return;

    if (activeCrawlerRef.current) {
      activeCrawlerRef.current.stop();
      activeCrawlerRef.current = null;
    }

    let start = rawUrl.trim();
    if (!/^https?:\/\//i.test(start)) {
      start = 'https://' + start;
    }

    if (overrideUrl) {
      setConfig((prev) => ({ ...prev, startUrl: start }));
    }

    try {
      const parsed = new URL(start);
      const cleanHost = parsed.hostname.toLowerCase().replace(/:\d+$/, '');
      setCurrentDomain(parsed.hostname);
      setTargetOrigin(parsed.origin);
      setWhoisTargetDomain(cleanHost);
    } catch {
      setCurrentDomain(null);
      setTargetOrigin('');
    }

    setStatus('running');

    setPages([]);
    setDirectories([]);
    setFiles([]);
    setExternalLinks([]);
    setApiEndpoints([]);
    setLogs([]);
    setHighlightedEvent(null);
    setStats({
      ...INITIAL_STATS,
      startTime: Date.now(),
      currentUrl: start,
    });

    const activeConfig: CrawlConfig = {
      ...config,
      startUrl: start,
    };

    activeCrawlerRef.current = startBrowserCrawl(activeConfig, {
      onPage: (pageData: PageRecord) => {
        setPages((prev) => [pageData, ...prev]);
      },
      onDirectory: (dirData: DirectoryRecord) => {
        setDirectories((prev) => {
          const idx = prev.findIndex((d) => d.path === dirData.path && d.domain === dirData.domain);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = dirData;
            return next;
          }
          return [...prev, dirData];
        });
      },
      onDirectoriesUpdate: (allDirs: DirectoryRecord[]) => {
        setDirectories(allDirs);
      },
      onFile: (fileData: FileRecord) => {
        setFiles((prev) => {
          const idx = prev.findIndex((f) => f.path === fileData.path && f.domain === fileData.domain);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = fileData;
            return next;
          }
          return [...prev, fileData];
        });
      },
      onFilesUpdate: (allFiles: FileRecord[]) => {
        setFiles(allFiles);
      },
      onExternalLink: (linkData: ExternalLinkRecord) => {
        setExternalLinks((prev) => {
          if (prev.some((l) => l.url === linkData.url)) return prev;
          return [...prev, linkData];
        });
      },
      onExternalLinksUpdate: (allLinks: ExternalLinkRecord[]) => {
        setExternalLinks(allLinks);
      },
      onApiEndpoint: (endpointData: ApiEndpointRecord) => {
        setApiEndpoints((prev) => {
          const idx = prev.findIndex(
            (e) =>
              e.id === endpointData.id ||
              (e.method === endpointData.method && e.domain === endpointData.domain && e.pathname === endpointData.pathname) ||
              (e.method === endpointData.method && e.url === endpointData.url)
          );
          if (idx >= 0) {
            const next = [...prev];
            const existing = next[idx];
            const mergedParams = [...(existing.possibleParameters || [])];
            for (const p of endpointData.possibleParameters || []) {
              const pIdx = mergedParams.findIndex((mp) => mp.name === p.name && mp.in === p.in);
              if (pIdx === -1) {
                mergedParams.push(p);
              } else if (!mergedParams[pIdx].sampleValue && p.sampleValue) {
                mergedParams[pIdx] = { ...mergedParams[pIdx], sampleValue: p.sampleValue };
              }
            }
            const mergedQueryParams = Array.from(
              new Set([...(existing.queryParams || []), ...(endpointData.queryParams || [])])
            );
            const mergedSources = Array.from(
              new Set([...(existing.sourceUrls || []), ...(endpointData.sourceUrls || [])])
            );
            next[idx] = {
              ...existing,
              ...endpointData,
              possibleParameters: mergedParams.length > 0 ? mergedParams : undefined,
              queryParams: mergedQueryParams,
              sourceUrls: mergedSources,
              sampleQueryUrl: existing.sampleQueryUrl || endpointData.sampleQueryUrl,
            };
            return next;
          }
          return [...prev, endpointData];
        });
      },
      onApiEndpointsUpdate: (allEndpoints: ApiEndpointRecord[]) => {
        setApiEndpoints(allEndpoints);
      },
      onStats: (statsData: CrawlStats) => {
        setStats((prev) => ({ ...prev, ...statsData }));
      },
      onLog: (logData) => {
        setLogs((prev) => [logData, ...prev]);
      },
      onDone: () => {
        setStatus('completed');
        activeCrawlerRef.current = null;
      },
      onError: (errMessage: string) => {
        setStatus('error');
        setLogs((prev) => [
          {
            level: 'error',
            message: errMessage || 'Crawl session encountered an error.',
            timestamp: Date.now(),
          },
          ...prev,
        ]);
        activeCrawlerRef.current = null;
      },
      onBlockingEvent: (blockingEvt) => {
        setActiveTab('pages');
        setHighlightedEvent({
          ...blockingEvt,
          key: Date.now(),
        });
      },
    });
  }, [config]);

  useEffect(() => {
    return () => {
      if (activeCrawlerRef.current) {
        activeCrawlerRef.current.stop();
        activeCrawlerRef.current = null;
      }
    };
  }, []);

  const subdomainsCount = useMemo(() => {
    if (!currentDomain && !config.startUrl) return 0;
    let targetHost = (currentDomain || '').toLowerCase().replace(/:\d+$/, '');
    if (!targetHost && config.startUrl) {
      try {
        let s = config.startUrl.trim();
        if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
        targetHost = new URL(s).hostname.toLowerCase().replace(/:\d+$/, '');
      } catch {}
    }
    const apex = extractApexDomain(targetHost) || targetHost;
    const subHosts = new Set<string>();
    for (const l of externalLinks) {
      const h = (l.domain || '').toLowerCase().trim().replace(/:\d+$/, '');
      const root = (l.rootDomain || extractApexDomain(h) || '').toLowerCase().trim();
      if (
        (apex && (root === apex || h === apex || h.endsWith('.' + apex))) ||
        (targetHost && (h === targetHost || h.endsWith('.' + targetHost)))
      ) {
        if (h !== targetHost) {
          subHosts.add(h);
        }
      }
    }
    return subHosts.size;
  }, [currentDomain, config.startUrl, externalLinks]);

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-[#f0f0f0] flex flex-col font-sans relative">
      {/* Ambient Horizon Diffusion */}
      <div className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-[900px] h-[350px] bg-[radial-gradient(ellipse_at_top,rgba(195,8,0,0.06),transparent_70%)] z-0" />

      {/* Header */}
      <CrawlerHeader
        status={status}
        stats={stats}
        currentDomain={currentDomain}
        hasData={pages.length > 0 || directories.length > 0 || files.length > 0 || apiEndpoints.length > 0 || externalLinks.length > 0}
        onOpenExport={() => setShowExportModal(true)}
        onReset={handleReset}
        onStop={handleStopCrawl}
        onImport={handleImportSession}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6 relative z-10">
        {/* URL Input Form & Controls */}
        <CrawlForm
          config={config}
          status={status}
          onUpdateConfig={handleUpdateConfig}
          onStartCrawl={handleStartCrawl}
          onStopCrawl={handleStopCrawl}
          paramTab={paramTab}
          onParamTabChange={setParamTab}
          showAdvanced={showAdvanced}
          onShowAdvancedChange={setShowAdvanced}
          isTermsAccepted={!showOwnershipWarning}
          onRequestTerms={() => setShowOwnershipWarning(true)}
        />

        {/* Live Metrics */}
        {(status !== 'idle' || directories.length > 0 || files.length > 0 || externalLinks.length > 0) && (
          <CrawlMetrics stats={stats} status={status} maxPages={config.maxPages} />
        )}

        {/* Views & Explorers */}
        <div className="space-y-4">
          {/* Navigation View Tabs */}
          <div className="flex items-center gap-1 border-b border-[#383838] pb-0 w-full overflow-hidden">
            <div className="flex items-center gap-1 flex-1 flex-wrap sm:flex-nowrap">
              <button
                type="button"
                id="tab-table-btn"
                onClick={() => setActiveTab('table')}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-none text-xs font-mono uppercase tracking-wider transition-all cursor-pointer border-t-2 border-x whitespace-nowrap ${
                  activeTab === 'table'
                    ? 'bg-[#141414] text-[#f0f0f0] border-t-[#c30800] border-x-[#383838] border-b-[#141414] -mb-[1px] font-bold shadow-sm'
                    : 'border-t-transparent border-x-transparent text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a]'
                }`}
              >
                <ListFilter className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'table' ? 'text-[#c30800]' : 'text-[#8c8c8c]'}`} />
                <span>Table</span>
                {(directories.length > 0 || files.length > 0) && (
                  <span className="tag tag-sm tag-accent-outline font-bold shrink-0">
                    {directories.length + files.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                id="tab-tree-btn"
                onClick={() => setActiveTab('tree')}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-none text-xs font-mono uppercase tracking-wider transition-all cursor-pointer border-t-2 border-x whitespace-nowrap ${
                  activeTab === 'tree'
                    ? 'bg-[#141414] text-[#f0f0f0] border-t-[#c30800] border-x-[#383838] border-b-[#141414] -mb-[1px] font-bold shadow-sm'
                    : 'border-t-transparent border-x-transparent text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a]'
                }`}
              >
                <FolderTree className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'tree' ? 'text-[#c30800]' : 'text-[#8c8c8c]'}`} />
                <span>Directory Tree</span>
              </button>

              <button
                type="button"
                id="tab-api-btn"
                onClick={() => setActiveTab('api')}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-none text-xs font-mono uppercase tracking-wider transition-all cursor-pointer border-t-2 border-x whitespace-nowrap ${
                  activeTab === 'api'
                    ? 'bg-[#141414] text-[#f0f0f0] border-t-[#c30800] border-x-[#383838] border-b-[#141414] -mb-[1px] font-bold shadow-sm'
                    : 'border-t-transparent border-x-transparent text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a]'
                }`}
              >
                <Code className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'api' ? 'text-[#c30800]' : 'text-[#8c8c8c]'}`} />
                <span>API Calls</span>
                {apiEndpoints.length > 0 && (
                  <span className="tag tag-sm tag-accent-outline font-bold shrink-0">
                    {apiEndpoints.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                id="tab-subdomains-sans-btn"
                onClick={() => setActiveTab('subdomains-sans')}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-none text-xs font-mono uppercase tracking-wider transition-all cursor-pointer border-t-2 border-x whitespace-nowrap ${
                  activeTab === 'subdomains-sans'
                    ? 'bg-[#141414] text-[#f0f0f0] border-t-[#c30800] border-x-[#383838] border-b-[#141414] -mb-[1px] font-bold shadow-sm'
                    : 'border-t-transparent border-x-transparent text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a]'
                }`}
              >
                <Network className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'subdomains-sans' ? 'text-[#c30800]' : 'text-[#8c8c8c]'}`} />
                <span>Subdomains &amp; SANs</span>
                {subdomainsCount > 0 && (
                  <span className="tag tag-sm tag-accent-outline font-bold shrink-0">
                    {subdomainsCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                id="tab-external-btn"
                onClick={() => setActiveTab('external')}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-none text-xs font-mono uppercase tracking-wider transition-all cursor-pointer border-t-2 border-x whitespace-nowrap ${
                  activeTab === 'external'
                    ? 'bg-[#141414] text-[#f0f0f0] border-t-[#c30800] border-x-[#383838] border-b-[#141414] -mb-[1px] font-bold shadow-sm'
                    : 'border-t-transparent border-x-transparent text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a]'
                }`}
              >
                <ExternalLink className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'external' ? 'text-[#c30800]' : 'text-[#8c8c8c]'}`} />
                <span>External Links</span>
                {externalLinks.length > 0 && (
                  <span className="tag tag-sm tag-accent-outline font-bold shrink-0">
                    {externalLinks.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                id="tab-whois-btn"
                onClick={() => setActiveTab('whois')}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-none text-xs font-mono uppercase tracking-wider transition-all cursor-pointer border-t-2 border-x whitespace-nowrap ${
                  activeTab === 'whois'
                    ? 'bg-[#141414] text-[#f0f0f0] border-t-[#c30800] border-x-[#383838] border-b-[#141414] -mb-[1px] font-bold shadow-sm'
                    : 'border-t-transparent border-x-transparent text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a]'
                }`}
              >
                <ShieldCheck className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'whois' ? 'text-[#c30800]' : 'text-[#8c8c8c]'}`} />
                <span>WHOIS &amp; DNS</span>
              </button>

              <button
                type="button"
                id="tab-pages-btn"
                onClick={() => setActiveTab('pages')}
                className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-none text-xs font-mono uppercase tracking-wider transition-all cursor-pointer border-t-2 border-x whitespace-nowrap ${
                  activeTab === 'pages'
                    ? 'bg-[#141414] text-[#f0f0f0] border-t-[#c30800] border-x-[#383838] border-b-[#141414] -mb-[1px] font-bold shadow-sm'
                    : 'border-t-transparent border-x-transparent text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a]'
                }`}
              >
                <FileText className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'pages' ? 'text-[#c30800]' : 'text-[#8c8c8c]'}`} />
                <span>LOGS</span>
                {(logs.length > 0 || pages.length > 0) && (
                  <span className="tag tag-sm tag-accent-outline font-bold shrink-0">
                    {logs.length || pages.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Active View Container */}
          <div>
            <div className={activeTab === 'table' ? 'block' : 'hidden'}>
              <DirectoryTableView
                directories={directories}
                files={files}
                targetOrigin={targetOrigin}
                onSelectDirectory={(dir) => setSelectedDirectory(dir)}
                onSelectFile={(file) => setSelectedFile(file)}
              />
            </div>

            <div className={activeTab === 'tree' ? 'block' : 'hidden'}>
              <DirectoryTreeView
                directories={directories}
                files={files}
                targetOrigin={targetOrigin}
                onSelectDirectory={(dir) => setSelectedDirectory(dir)}
                onSelectFile={(file) => setSelectedFile(file)}
              />
            </div>

            <div className={activeTab === 'api' ? 'block' : 'hidden'}>
              <ApiEndpointsView
                apiEndpoints={apiEndpoints}
                targetDomain={currentDomain}
                onOpenExternalWarning={(url) => {
                  try {
                    const parsed = new URL(url);
                    const hostname = parsed.hostname.toLowerCase();
                    if (hostname === '0xconfused.com' || hostname.endsWith('.0xconfused.com')) {
                      window.open(url, '_blank', 'noopener,noreferrer');
                      return;
                    }
                  } catch {
                    // ignore
                  }
                  setPendingExternalUrl(url);
                }}
                onUpdateEndpoint={(updated) => {
                  setApiEndpoints((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
                }}
              />
            </div>

            <div className={activeTab === 'subdomains-sans' ? 'block' : 'hidden'}>
              <SubdomainsSansView
                currentDomain={currentDomain}
                startUrl={config.startUrl}
                externalLinks={externalLinks}
                refreshKey={whoisRefreshKey}
                onOpenWhois={(dom) => {
                  setWhoisTargetDomain(dom);
                  setActiveTab('whois');
                }}
                onCrawlHost={(host) => {
                  const targetUrl = `https://${host}`;
                  setConfig((prev) => ({ ...prev, startUrl: targetUrl }));
                  setActiveTab('table');
                  handleStartCrawl(targetUrl);
                }}
              />
            </div>

            <div className={activeTab === 'external' ? 'block' : 'hidden'}>
              <ExternalLinksView
                externalLinks={externalLinks}
                targetDomain={currentDomain}
                onOpenWhois={(dom) => {
                  setWhoisTargetDomain(dom);
                  setActiveTab('whois');
                }}
              />
            </div>

            <div className={activeTab === 'whois' ? 'block' : 'hidden'}>
              <DomainIntelligenceView
                targetDomain={whoisTargetDomain || currentDomain || null}
                refreshKey={whoisRefreshKey}
                domainCacheMap={domainIntelligenceCache}
                corsProxyMode={config.corsProxyMode}
                customProxyConfig={config.customProxyConfig || config.customProxyUrl}
                onCacheData={handleCacheDomainData}
                onDomainChange={handleWhoisDomainChange}
                onCrawlHost={(host) => {
                  const targetUrl = `https://${host}`;
                  setConfig((prev) => ({ ...prev, startUrl: targetUrl }));
                  setActiveTab('table');
                  handleStartCrawl(targetUrl);
                }}
              />
            </div>

            <div className={activeTab === 'pages' ? 'block' : 'hidden'}>
              <PagesLogView
                pages={pages}
                logs={logs}
                isRunning={status === 'running'}
                inspectPage={inspectedPage}
                setInspectPage={setInspectedPage}
                highlightedEvent={highlightedEvent}
              />
            </div>
          </div>
        </div>
      </main>

      {/* Download for Local Use Footer */}
      <LocalDownloadFooter onOpenLiabilityTerms={() => setShowOwnershipWarning(true)} />

      {/* Directory Detail Inspector Modal */}
      {selectedDirectory && (
        <DirectoryDetailModal
          directory={selectedDirectory}
          files={
            selectedDirectory.directFiles && selectedDirectory.directFiles.length > 0
              ? selectedDirectory.directFiles
              : files.filter(
                  (f) =>
                    f.directory === selectedDirectory.path &&
                    (!selectedDirectory.domain || !f.domain || f.domain === selectedDirectory.domain)
                )
          }
          pages={pages}
          targetOrigin={targetOrigin}
          onClose={() => setSelectedDirectory(null)}
          onSelectSubdir={(subdirPath) => {
            const found = directories.find(
              (d) =>
                d.path === subdirPath &&
                (!selectedDirectory.domain || !d.domain || d.domain === selectedDirectory.domain)
            );
            if (found) {
              setSelectedDirectory(found);
            }
          }}
          onSelectFile={(f) => setSelectedFile(f)}
        />
      )}

      {/* File Detail Metadata Inspector Modal */}
      {selectedFile && (
        <FileDetailModal
          file={selectedFile}
          targetOrigin={targetOrigin}
          directories={directories}
          onClose={() => setSelectedFile(null)}
          onSelectDirectory={(d) => {
            setSelectedDirectory(d);
            setSelectedFile(null);
          }}
        />
      )}

      {/* Export Modal */}
      {showExportModal && (
        <ExportModal
          directories={directories}
          files={files}
          apiEndpoints={apiEndpoints}
          externalLinks={externalLinks}
          pages={pages}
          logs={logs}
          domainIntelligenceCache={domainIntelligenceCache}
          config={config}
          stats={stats}
          status={status}
          currentDomain={currentDomain}
          whoisTargetDomain={whoisTargetDomain}
          targetOrigin={targetOrigin}
          onClose={() => setShowExportModal(false)}
          onImport={handleImportSession}
        />
      )}

      {/* External Destination Warning Modal */}
      {pendingExternalUrl && (
        <ExternalLinkWarningModal
          url={pendingExternalUrl}
          isOpen={Boolean(pendingExternalUrl)}
          onClose={() => setPendingExternalUrl(null)}
          onConfirm={handleConfirmExternalNavigation}
        />
      )}

      {/* Authorized Ownership Warning Modal on Page Load */}
      <OwnershipWarningModal
        isOpen={showOwnershipWarning}
        onAgree={handleAgreeOwnership}
      />
    </div>
  );
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { PageRecord, BlockingEvent } from '../types';
import { safeClampInput } from '../utils/urlUtils';
import {
  Terminal,
  Search,
  ExternalLink,
  ArrowDown,
  ArrowUpDown,
  Lock,
  Unlock,
  Layers,
  X,
  Maximize2,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
} from 'lucide-react';

const HTTP_STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  407: 'Proxy Authentication Required',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'Length Required',
  412: 'Precondition Failed',
  413: 'Payload Too Large',
  414: 'URI Too Long',
  415: 'Unsupported Media Type',
  416: 'Range Not Satisfiable',
  417: 'Expectation Failed',
  418: "I'm a teapot",
  421: 'Misdirected Request',
  422: 'Unprocessable Entity',
  423: 'Locked',
  424: 'Failed Dependency',
  425: 'Too Early',
  426: 'Upgrade Required',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  431: 'Request Header Fields Too Large',
  451: 'Unavailable For Legal Reasons',
};

interface PagesLogViewProps {
  pages: PageRecord[];
  logs: Array<{ level: 'info' | 'warn' | 'error' | 'success'; message: string; timestamp: number; isBlocking?: boolean }>;
  isRunning?: boolean;
  inspectPage?: PageRecord | null;
  setInspectPage?: (page: PageRecord | null) => void;
  highlightedEvent?: BlockingEvent | null;
}

export const PagesLogView: React.FC<PagesLogViewProps> = ({
  pages,
  logs,
  isRunning = false,
  inspectPage: propsInspectPage,
  setInspectPage: propsSetInspectPage,
  highlightedEvent,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'pages' | 'console'>('pages');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | '2xx' | '3xx' | '4xx' | '5xx' | 'errors'>('all');
  const [sortOrder, setSortOrder] = useState<'chronological' | 'reverse'>('chronological');
  const [internalInspectPage, setInternalInspectPage] = useState<PageRecord | null>(null);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const [activeHighlightLogId, setActiveHighlightLogId] = useState<string | null>(null);
  const inspectPage = propsInspectPage !== undefined ? propsInspectPage : internalInspectPage;
  const setInspectPage = (page: PageRecord | null) => {
    if (propsSetInspectPage) {
      propsSetInspectPage(page);
    } else {
      setInternalInspectPage(page);
    }
  };
  const [copiedId, setCopiedId] = useState<string | null>(null);


  // Modal lists are minimizable and minimized by default
  const [showRedirectChain, setShowRedirectChain] = useState<boolean>(false);
  const [showRobotsDirectives, setShowRobotsDirectives] = useState<boolean>(false);
  const [showHttpRequest, setShowHttpRequest] = useState<boolean>(false);
  const [httpRequestFormat, setHttpRequestFormat] = useState<'raw' | 'curl'>('raw');
  const [showHttpResponse, setShowHttpResponse] = useState<boolean>(true);
  const [httpResponseFormat, setHttpResponseFormat] = useState<'raw' | 'headers' | 'body'>('raw');

  useEffect(() => {
    setShowRedirectChain(false);
    setShowRobotsDirectives(false);
    setShowHttpRequest(false);
    setShowHttpResponse(true);
  }, [inspectPage?.id, inspectPage?.url]);

  useEffect(() => {
    if (!highlightedEvent) return;

    if (highlightedEvent.type === 'page') {
      setActiveSubTab('pages');
      setStatusFilter((prev) => (prev !== 'all' && prev !== '4xx' && prev !== 'errors' ? 'all' : prev));
      setActiveHighlightId(highlightedEvent.id);
      if (pagesScrollRef.current && pagesScrollRef.current.scrollHeight > pagesScrollRef.current.clientHeight + 8) {
        setPagesAutoscroll(false);
      }

      const scrollTimer = setTimeout(() => {
        const el = document.getElementById(`page-row-${highlightedEvent.id}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 80);

      const fadeTimer = setTimeout(() => {
        setActiveHighlightId(null);
      }, 2100);

      return () => {
        clearTimeout(scrollTimer);
        clearTimeout(fadeTimer);
      };
    } else if (highlightedEvent.type === 'log') {
      setActiveSubTab('console');
      const targetId = highlightedEvent.id;
      setActiveHighlightLogId(targetId);
      if (consoleScrollRef.current && consoleScrollRef.current.scrollHeight > consoleScrollRef.current.clientHeight + 8) {
        setConsoleAutoscroll(false);
      }

      const scrollTimer = setTimeout(() => {
        const el = document.getElementById(`log-entry-${targetId}`) || document.querySelector(`[data-log-time="${highlightedEvent.timestamp}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 80);

      const fadeTimer = setTimeout(() => {
        setActiveHighlightLogId(null);
      }, 2100);

      return () => {
        clearTimeout(scrollTimer);
        clearTimeout(fadeTimer);
      };
    }
  }, [highlightedEvent?.key, highlightedEvent?.id, highlightedEvent?.timestamp]);

  const handleCopy = (text: string, id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const [pagesAutoscroll, setPagesAutoscroll] = useState<boolean>(true);
  const pagesAutoscrollRef = useRef<boolean>(true);
  pagesAutoscrollRef.current = pagesAutoscroll;

  const [consoleAutoscroll, setConsoleAutoscroll] = useState<boolean>(true);
  const consoleAutoscrollRef = useRef<boolean>(true);
  consoleAutoscrollRef.current = consoleAutoscroll;

  const [canScrollPages, setCanScrollPages] = useState<boolean>(false);
  const [canScrollConsole, setCanScrollConsole] = useState<boolean>(false);

  const pagesScrollRef = useRef<HTMLDivElement | null>(null);
  const pagesBottomSentinelRef = useRef<HTMLDivElement | null>(null);

  const consoleScrollRef = useRef<HTMLDivElement | null>(null);
  const consoleBottomSentinelRef = useRef<HTMLDivElement | null>(null);

  const isProgrammaticPagesScrollRef = useRef<boolean>(false);
  const isProgrammaticConsoleScrollRef = useRef<boolean>(false);

  const filteredPages = useMemo(() => {
    return pages.filter((page) => {
      if (statusFilter === '2xx' && (page.statusCode < 200 || page.statusCode >= 300)) return false;
      if (statusFilter === '3xx' && (page.statusCode < 300 || page.statusCode >= 400)) return false;
      if (statusFilter === '4xx' && (page.statusCode < 400 || page.statusCode >= 500)) return false;
      if (statusFilter === '5xx' && (page.statusCode < 500 || page.statusCode >= 600)) return false;
      if (statusFilter === 'errors' && page.statusCode < 400 && !page.error) return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          page.url.toLowerCase().includes(q) ||
          page.title.toLowerCase().includes(q) ||
          (page.statusText && page.statusText.toLowerCase().includes(q))
        );
      }

      return true;
    });
  }, [pages, search, statusFilter]);

  const displayPages = useMemo(() => {
    const list = [...filteredPages];
    if (sortOrder === 'reverse') {
      return list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }
    return list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }, [filteredPages, sortOrder]);

  const displayLogs = useMemo(() => {
    const list = [...logs];
    if (sortOrder === 'reverse') {
      return list.sort((a, b) => b.timestamp - a.timestamp);
    }
    return list.sort((a, b) => a.timestamp - b.timestamp);
  }, [logs, sortOrder]);

  const httpRequestPreview = useMemo(() => {
    if (!inspectPage) return null;
    try {
      const parsed = new URL(inspectPage.url);
      const method = (inspectPage.method || 'GET').toUpperCase();
      const path = (parsed.pathname || '/') + (parsed.search || '');
      const httpVersion = inspectPage.httpVersion || 'HTTP/1.1';

      const defaultHeaders: Record<string, string> = {
        'Host': parsed.host,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(inspectPage.parentUrl ? { 'Referer': inspectPage.parentUrl } : {}),
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': inspectPage.parentUrl ? 'same-origin' : 'none',
      };

      const headers: Record<string, string> =
        inspectPage.requestHeaders && Object.keys(inspectPage.requestHeaders).length > 0
          ? inspectPage.requestHeaders
          : defaultHeaders;

      // RFC 9112 Wire Protocol Representation
      const rawLines = [
        `${method} ${path} ${httpVersion}`,
        ...Object.entries(headers).map(([k, v]) => `${k}: ${String(v)}`),
        '',
      ];
      const rawText = rawLines.join('\r\n');

      // cURL Representation
      const curlHeaders = Object.entries(headers)
        .map(([k, v]) => `  -H '${k}: ${String(v).replace(/'/g, "'\\''")}'`)
        .join(' \\\n');
      const curlText = `curl -X ${method} '${inspectPage.url}' \\\n${curlHeaders}`;

      return {
        method,
        path,
        httpVersion,
        headers,
        rawText,
        curlText,
      };
    } catch {
      return null;
    }
  }, [inspectPage]);

  const httpResponsePreview = useMemo(() => {
    if (!inspectPage) return null;
    const statusCode = inspectPage.statusCode || 200;
    // Specifically for 4XX client error responses
    if (statusCode < 400 || statusCode >= 500) return null;

    const httpVersion = inspectPage.httpVersion || 'HTTP/1.1';
    const statusText =
      inspectPage.statusText && inspectPage.statusText !== 'OK'
        ? inspectPage.statusText
        : HTTP_STATUS_TEXT[statusCode] || 'Client Error';

    let body = inspectPage.responseBody || '';
    if (!body) {
      if (inspectPage.error) {
        body = `<!DOCTYPE html>\n<html>\n<head>\n  <title>${statusCode} ${statusText}</title>\n</head>\n<body>\n  <h1>${statusCode} ${statusText}</h1>\n  <p>${inspectPage.error}</p>\n  <hr>\n  <small>0xCONFUSED Recon Engine / RFC 9112</small>\n</body>\n</html>`;
      } else {
        body = `<!DOCTYPE html>\n<html>\n<head>\n  <title>${statusCode} ${statusText}</title>\n</head>\n<body>\n  <h1>${statusCode} ${statusText}</h1>\n  <p>The requested resource on ${new URL(inspectPage.url).hostname} returned HTTP ${statusCode} (${statusText}).</p>\n  <hr>\n  <small>0xCONFUSED Recon Engine / RFC 9112</small>\n</body>\n</html>`;
      }
    }

    const defaultHeaders: Record<string, string> = {
      'Date': new Date(inspectPage.timestamp || Date.now()).toUTCString(),
      'Server': 'nginx/1.24.0',
      'Content-Type': inspectPage.contentType || 'text/html; charset=UTF-8',
      'Content-Length': String(new TextEncoder().encode(body).length),
      'Connection': 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      ...(statusCode === 401 ? { 'WWW-Authenticate': 'Bearer realm="SecurityEnclave"' } : {}),
      ...(statusCode === 403 ? { 'X-Frame-Options': 'DENY' } : {}),
      ...(statusCode === 405 ? { 'Allow': 'GET, HEAD, OPTIONS' } : {}),
      ...(statusCode === 429 ? { 'Retry-After': '60' } : {}),
    };

    const headers: Record<string, string> =
      inspectPage.responseHeaders && Object.keys(inspectPage.responseHeaders).length > 0
        ? { ...defaultHeaders, ...inspectPage.responseHeaders }
        : defaultHeaders;

    const statusLine = `${httpVersion} ${statusCode} ${statusText}`;
    const headerLines = Object.entries(headers).map(([k, v]) => `${k}: ${String(v)}`);
    const rawText = [statusLine, ...headerLines, '', body].join('\r\n');
    const headersText = [statusLine, ...headerLines].join('\r\n');

    return {
      httpVersion,
      statusCode,
      statusText,
      headers,
      body,
      rawText,
      headersText,
    };
  }, [inspectPage]);

  const isNearBottom = (el: HTMLElement, threshold = 60) => {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
  };

  const executeScrollToBottom = useCallback((container: HTMLElement | null, isConsole = false) => {
    if (!container) return;
    if (isConsole) {
      isProgrammaticConsoleScrollRef.current = true;
    } else {
      isProgrammaticPagesScrollRef.current = true;
    }

    container.scrollTop = container.scrollHeight;

    setTimeout(() => {
      if (isConsole) {
        isProgrammaticConsoleScrollRef.current = false;
      } else {
        isProgrammaticPagesScrollRef.current = false;
      }
    }, 50);
  }, []);

  useEffect(() => {
    const updateScrollCapability = () => {
      if (pagesScrollRef.current) {
        const hasScroll = pagesScrollRef.current.scrollHeight > pagesScrollRef.current.clientHeight + 8;
        setCanScrollPages(hasScroll);
      }
      if (consoleScrollRef.current) {
        const hasScroll = consoleScrollRef.current.scrollHeight > consoleScrollRef.current.clientHeight + 8;
        setCanScrollConsole(hasScroll);
      }
    };

    updateScrollCapability();
    const timer = setTimeout(updateScrollCapability, 100);
    window.addEventListener('resize', updateScrollCapability);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateScrollCapability);
    };
  }, [displayPages.length, displayLogs.length, activeSubTab]);

  const handlePagesScroll = () => {
    if (isProgrammaticPagesScrollRef.current) return;
    const el = pagesScrollRef.current;
    if (!el) return;

    const hasScroll = el.scrollHeight > el.clientHeight + 8;
    setCanScrollPages(hasScroll);
    if (!hasScroll) return;

    const atBottom = isNearBottom(el);
    if (atBottom && !pagesAutoscrollRef.current) {
      setPagesAutoscroll(true);
    } else if (!atBottom && pagesAutoscrollRef.current) {
      setPagesAutoscroll(false);
    }
  };

  const handleConsoleScroll = () => {
    if (isProgrammaticConsoleScrollRef.current) return;
    const el = consoleScrollRef.current;
    if (!el) return;

    const hasScroll = el.scrollHeight > el.clientHeight + 8;
    setCanScrollConsole(hasScroll);
    if (!hasScroll) return;

    const atBottom = isNearBottom(el);
    if (atBottom && !consoleAutoscrollRef.current) {
      setConsoleAutoscroll(true);
    } else if (!atBottom && consoleAutoscrollRef.current) {
      setConsoleAutoscroll(false);
    }
  };

  useLayoutEffect(() => {
    if (sortOrder === 'chronological' && pagesAutoscrollRef.current && pagesScrollRef.current) {
      executeScrollToBottom(pagesScrollRef.current, false);
    }
  }, [displayPages.length, sortOrder, executeScrollToBottom]);

  useLayoutEffect(() => {
    if (sortOrder === 'chronological' && consoleAutoscrollRef.current && consoleScrollRef.current) {
      executeScrollToBottom(consoleScrollRef.current, true);
    }
  }, [displayLogs.length, sortOrder, executeScrollToBottom]);

  useEffect(() => {
    if (activeSubTab === 'pages' && pagesAutoscrollRef.current && pagesScrollRef.current) {
      executeScrollToBottom(pagesScrollRef.current, false);
    } else if (activeSubTab === 'console' && consoleAutoscrollRef.current && consoleScrollRef.current) {
      executeScrollToBottom(consoleScrollRef.current, true);
    }
  }, [activeSubTab, executeScrollToBottom]);

  useEffect(() => {
    if (isRunning) {
      setPagesAutoscroll(true);
      setConsoleAutoscroll(true);
    }
  }, [isRunning]);

  const togglePagesAutoscroll = () => {
    if (!pagesAutoscroll) {
      setPagesAutoscroll(true);
      executeScrollToBottom(pagesScrollRef.current, false);
    } else {
      setPagesAutoscroll(false);
    }
  };

  const toggleConsoleAutoscroll = () => {
    if (!consoleAutoscroll) {
      setConsoleAutoscroll(true);
      executeScrollToBottom(consoleScrollRef.current, true);
    } else {
      setConsoleAutoscroll(false);
    }
  };

  const getStatusBadge = (page: PageRecord) => {
    const code = page.statusCode || 200;
    if (code === 310 || (page.error && page.error.includes('Circular'))) {
      return (
        <span className="font-bold text-[#c3005a]">
          LOOP ({code})
        </span>
      );
    }
    if (code >= 100 && code < 200) {
      return (
        <span className="font-bold text-[#8c8c8c]">
          HTTP {code}
        </span>
      );
    }
    if (code >= 200 && code < 300) {
      return (
        <span className="font-bold text-[#bbc300]">
          HTTP {code}
        </span>
      );
    }
    if (code >= 300 && code < 400) {
      return (
        <span className="font-bold text-[#c36a00]">
          HTTP {code}
        </span>
      );
    }
    return (
      <span className="font-bold text-[#c3005a]">
        HTTP {code}
      </span>
    );
  };

  const getPageSignals = (page: PageRecord) => {
    const items: Array<{ text: string; color: string; description: string }> = [];

    if (page.isNoIndex) {
      items.push({
        text: 'NOINDEX',
        color: 'text-[#c36a00]',
        description: 'Do not index this page.',
      });
    }
    if (page.hasNoFollow) {
      items.push({
        text: 'NOFOLLOW',
        color: 'text-[#c300bb]',
        description: 'Do not follow links on this page.',
      });
    }
    if (page.canonicalStatus && page.canonicalStatus !== 'self') {
      const canonicalTarget = page.canonicalUrl ? `: ${page.canonicalUrl}` : '';
      items.push({
        text: `CANONICAL: ${page.canonicalStatus.toUpperCase()}`,
        color: 'text-[#bbc300]',
        description: `Master URL${canonicalTarget}.`,
      });
    }
    if (page.redirectChain && page.redirectChain.length > 1) {
      const hops = page.redirectChain.length - 1;
      items.push({
        text: `${hops} HOP${hops > 1 ? 'S' : ''}`,
        color: 'text-[#8c8c8c]',
        description: `Redirected ${hops} ${hops === 1 ? 'time' : 'times'}.`,
      });
    }

    if (page.statusCode >= 400 && page.statusCode < 500) {
      items.push({
        text: 'RESPONSE PREVIEW',
        color: 'text-[#c3005a]',
        description: 'HTTP 4XX client error response available.',
      });
    }

    return items;
  };

  const isCurrentAutoscrollActive = activeSubTab === 'pages' ? pagesAutoscroll : consoleAutoscroll;

  return (
    <div id="pages-log-view" className="bg-[#141414] border border-[#383838] rounded-none overflow-hidden flex flex-col shadow-md relative">
      <div className="h-[2px] w-full bg-gradient-to-r from-[#c30800] via-[#c300bb] to-[#bbc300]" />
      {/* Sub tabs & Controls */}
      <div className="px-6 py-4 bg-[#141414] backdrop-blur-sm bg-gradient-to-r from-[#c30800]/10 via-transparent to-transparent flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b border-[#383838]">
        <div className="flex items-center gap-1 bg-[#141414] p-1 rounded-none border border-[#2e2e2e] self-start" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setActiveSubTab('pages')}
            className={`px-3 py-1 rounded-none text-xs font-mono uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 ${
              activeSubTab === 'pages'
                ? 'bg-[#1a1a1a] text-[#f0f0f0] border border-[#c30800] font-semibold'
                : 'text-[#8c8c8c] hover:text-[#f0f0f0] border border-transparent'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Crawled Pages ({pages.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('console')}
            className={`px-3 py-1 rounded-none text-xs font-mono uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 ${
              activeSubTab === 'console'
                ? 'bg-[#1a1a1a] text-[#f0f0f0] border border-[#c30800] font-semibold'
                : 'text-[#8c8c8c] hover:text-[#f0f0f0] border border-transparent'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Live Recon Logs ({logs.length})</span>
          </button>
        </div>

        {/* Status indicator & order controls */}
        <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {/* Interactive Autoscroll Lock Button */}
          {(() => {
            const isScrollable = activeSubTab === 'pages' ? canScrollPages : canScrollConsole;
            const isLocked = isCurrentAutoscrollActive || !isScrollable;

            return (
              <button
                type="button"
                onClick={activeSubTab === 'pages' ? togglePagesAutoscroll : toggleConsoleAutoscroll}
                title={
                  !isScrollable
                    ? 'All content is visible (no scrollbar)'
                    : isLocked
                    ? 'Autoscroll is locked to bottom (Click to unlock)'
                    : 'Autoscroll is unlocked (Click to lock to bottom)'
                }
                className={`flex items-center gap-1.5 px-3 py-1 rounded-none border text-[11px] font-mono transition-all cursor-pointer shadow-sm ${
                  isLocked
                    ? 'bg-[#1a1a1a] border-[#383838] text-[#8c8c8c] hover:bg-[#262626] hover:text-[#f0f0f0]'
                    : 'bg-[#c30800]/20 border-[#c30800] text-[#c30800] hover:bg-[#c30800]/30 hover:text-[#f60a00]'
                }`}
              >
                {isLocked ? (
                  <>
                    <Lock className="w-3 h-3 text-[#8c8c8c]" />
                    <span className="font-semibold">{!isScrollable ? 'Autoscroll: Auto' : 'Autoscroll: Locked'}</span>
                  </>
                ) : (
                  <>
                    <Unlock className="w-3 h-3 text-[#c30800]" />
                    <span className="font-semibold">Autoscroll: Unlocked</span>
                  </>
                )}
              </button>
            );
          })()}

          {/* Sort order toggle */}
          <button
            type="button"
            onClick={() => setSortOrder((prev) => (prev === 'chronological' ? 'reverse' : 'chronological'))}
            title={sortOrder === 'chronological' ? 'Chronological (New at bottom)' : 'Reverse (New at top)'}
            className="flex items-center gap-1 px-2.5 py-1 bg-[#141414] hover:bg-[#262626] border border-[#383838] text-[#8c8c8c] hover:text-[#f0f0f0] rounded-none text-[10px] font-mono transition-colors cursor-pointer"
          >
            <ArrowUpDown className="w-3 h-3 text-[#8c8c8c]" />
            <span>{sortOrder === 'chronological' ? 'Live Stream ↓' : 'Newest First ↑'}</span>
          </button>

          {activeSubTab === 'pages' && (
            <>
              <div className="relative flex-1 sm:w-52 min-w-0">
                <Search className="w-3.5 h-3.5 text-[#8c8c8c] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  id="pages-search-input"
                  type="text"
                  maxLength={200}
                  placeholder="Search crawled targets"
                  value={search}
                  onChange={(e) => setSearch(safeClampInput(e.target.value, 200))}
                  className="w-full pl-8 pr-3 py-1 bg-[#0d0d0d] border border-[#383838] rounded-none text-xs text-[#f0f0f0] placeholder-[#737373] font-mono focus:outline-none focus:border-[#c30800]"
                />
              </div>

              <div className="flex items-center gap-1 bg-[#141414] p-1 rounded-none border border-[#2e2e2e] text-[10px] font-mono">
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className={`px-2 py-0.5 rounded-none cursor-pointer uppercase text-[10px] transition-colors ${
                    statusFilter === 'all'
                      ? 'bg-[#1a1a1a] text-[#f0f0f0] border border-[#c30800] font-semibold'
                      : 'text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a] border border-transparent'
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('2xx')}
                  className={`px-2 py-0.5 rounded-none cursor-pointer uppercase text-[10px] transition-colors ${
                    statusFilter === '2xx'
                      ? 'bg-[#1a1a1a] text-[#bbc300] border border-[#bbc300] font-semibold'
                      : 'text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a] border border-transparent'
                  }`}
                >
                  2xx
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('3xx')}
                  className={`px-2 py-0.5 rounded-none cursor-pointer uppercase text-[10px] transition-colors ${
                    statusFilter === '3xx'
                      ? 'bg-[#1a1a1a] text-[#c36a00] border border-[#c36a00] font-semibold'
                      : 'text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a] border border-transparent'
                  }`}
                >
                  3xx
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('4xx')}
                  className={`px-2 py-0.5 rounded-none cursor-pointer uppercase text-[10px] transition-colors ${
                    statusFilter === '4xx'
                      ? 'bg-[#1a1a1a] text-[#c30800] border border-[#c30800] font-semibold'
                      : 'text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a] border border-transparent'
                  }`}
                >
                  4xx
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('5xx')}
                  className={`px-2 py-0.5 rounded-none cursor-pointer uppercase text-[10px] transition-colors ${
                    statusFilter === '5xx'
                      ? 'bg-[#1a1a1a] text-[#c3005a] border border-[#c3005a] font-semibold'
                      : 'text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a] border border-transparent'
                  }`}
                >
                  5xx
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('errors')}
                  className={`px-2 py-0.5 rounded-none cursor-pointer uppercase text-[10px] transition-colors ${
                    statusFilter === 'errors'
                      ? 'bg-[#1a1a1a] text-[#c3005a] border border-[#c3005a] font-semibold'
                      : 'text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a] border border-transparent'
                  }`}
                >
                  Errors
                </button>
              </div>
            </>
          )}
        </div>
      </div>


          {/* Tab 1: Crawled Pages Table */}
      {activeSubTab === 'pages' && (
        <div className="bg-[#141414] overflow-hidden flex flex-col relative">
          <div className="grid grid-cols-[60px_90px_50px_1fr_140px_100px_75px_60px] gap-3 px-6 py-3 bg-[#141414] text-[10px] uppercase tracking-widest text-[#8c8c8c] font-mono font-bold border-b border-[#383838]">
            <div>Method</div>
            <div>Status</div>
            <div>Depth</div>
            <div>URL &amp; Page Title</div>
            <div>Signals</div>
            <div className="text-center" title="Internal / External">Links Found</div>
            <div className="text-right">Latency</div>
            <div className="text-right">Popout</div>
          </div>
          <div
            ref={pagesScrollRef}
            onScroll={handlePagesScroll}
            className="overflow-y-auto max-h-[500px] font-mono text-xs divide-y divide-[#2e2e2e] custom-scrollbar"
          >
            {displayPages.length === 0 ? (
              <div className="py-12 text-center text-[#8c8c8c] font-mono text-xs">
                {pages.length === 0 ? 'No targets crawled yet. Engage recon above.' : 'No pages match the search criteria.'}
              </div>
            ) : (
              displayPages.map((page) => {
                const signals = getPageSignals(page);
                const isHighlighted = activeHighlightId === page.id;

                return (
                  <div
                    key={page.id}
                    id={`page-row-${page.id}`}
                    className={`grid grid-cols-[60px_90px_50px_1fr_140px_100px_75px_60px] gap-3 px-6 py-2.5 hover:bg-[#1a1a1a] transition-all items-center ${
                      isHighlighted ? 'fading-event-highlight' : ''
                    }`}
                  >
                    {/* Method */}
                    <div className="font-bold text-[#f0f0f0]">
                      {page.method || 'GET'}
                    </div>

                    {/* Status */}
                    <div
                      className="cursor-pointer inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
                      onClick={() => setInspectPage(page)}
                      title={page.statusCode >= 400 && page.statusCode < 500 ? 'HTTP 4XX: Click to inspect HTTP Response Preview' : 'Click to inspect page'}
                    >
                      {getStatusBadge(page)}
                    </div>

                    {/* Depth */}
                    <div className="text-[#8c8c8c]">{page.depth}</div>

                    {/* URL & Title */}
                    <div className="min-w-0 truncate">
                      <div className="flex items-center gap-1.5 text-[#f0f0f0]">
                        <a
                          href={page.url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline hover:text-[#c30800] flex items-center gap-1 truncate font-medium max-w-md"
                        >
                          <span className="truncate">{page.url}</span>
                          <ExternalLink className="w-3 h-3 text-[#737373] shrink-0" />
                        </a>
                      </div>
                      {page.blockingReason && (
                        <p className="text-[10px] text-[#c3005a] truncate mt-0.5 font-bold">
                          {page.blockingReason}
                        </p>
                      )}
                      {page.title && !page.blockingReason && (
                        <p className="text-[10px] text-[#8c8c8c] truncate mt-0.5">{page.title}</p>
                      )}
                    </div>

                    {/* Signals */}
                    <div className="text-[10px] truncate flex flex-wrap gap-1.5 items-center font-mono">
                      {signals.length === 0 ? (
                        <span className="text-[#737373]">
                          -
                        </span>
                      ) : (
                        signals.map((d, i) => (
                          <span
                            key={i}
                            className={`font-bold transition-colors ${d.color}`}
                          >
                            {d.text}
                          </span>
                        ))
                      )}
                    </div>

                    {/* Links */}
                    <div
                      className="text-center select-none font-mono"
                      title="Internal / External"
                    >
                      <span className="text-[#f0f0f0] font-bold">
                        {page.sameDomainLinksCount}
                      </span>
                      <span className="text-[#8c8c8c] text-[10px]">
                        {' '} / {page.discoveredLinksCount}
                      </span>
                    </div>

                  {/* Response Time */}
                  <div className="text-right text-[#8c8c8c] text-[10px]">
                    {page.durationMs}ms
                  </div>

                  {/* Popout Inspection */}
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => setInspectPage(page)}
                      className="p-1 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] transition-colors cursor-pointer"
                      title="Open Pop Out Window"
                    >
                      <Maximize2 className="w-3.5 h-3.5 text-[#c30800]" />
                    </button>
                  </div>
                </div>
              );
            }))}
            <div ref={pagesBottomSentinelRef} className="h-0 w-full" />
          </div>

          {/* Jump to bottom / Resume autoscroll pill */}
          {!pagesAutoscroll && canScrollPages && displayPages.length > 0 && (
            <button
              type="button"
              onClick={togglePagesAutoscroll}
              className="absolute bottom-4 right-6 z-20 flex items-center gap-1.5 px-3.5 py-1.5 rounded-none bg-[#141414] border border-[#c30800]/60 text-[#f0f0f0] text-[11px] font-mono shadow-2xl hover:bg-[#2e2e2e] hover:border-[#c30800] transition-all cursor-pointer"
            >
              <ArrowDown className="w-3.5 h-3.5 text-[#c30800] animate-bounce" />
              <span>Autoscroll paused • Click to lock bottom</span>
            </button>
          )}
        </div>
      )}

      {/* Tab 2: Terminal Console Logs */}
      {activeSubTab === 'console' && (
        <div className="relative bg-[#141414] border-t border-[#383838]">
          <div
            ref={consoleScrollRef}
            onScroll={handleConsoleScroll}
            className="p-6 font-mono text-xs max-h-[500px] overflow-y-auto space-y-2 custom-scrollbar"
          >
            {displayLogs.length === 0 ? (
              <p className="text-[#8c8c8c]">Recon telemetry logs will stream here during execution...</p>
            ) : (
              displayLogs.map((log, i) => {
                const timeStr = new Date(log.timestamp).toLocaleTimeString();
                let color = 'text-[#f0f0f0]';
                if (log.level === 'warn') color = 'text-[#c30800] font-semibold';
                if (log.level === 'error') color = 'text-[#770500] font-bold';
                if (log.level === 'success') color = 'text-[#bbc300] font-bold';

                const logId = `log_${log.timestamp}`;
                const isHighlighted = activeHighlightLogId === logId || activeHighlightLogId === String(log.timestamp);

                return (
                  <div
                    key={i}
                    id={`log-entry-${logId}`}
                    data-log-time={log.timestamp}
                    className={`flex items-start gap-2.5 leading-relaxed p-1 transition-all ${
                      isHighlighted ? 'fading-event-highlight' : ''
                    }`}
                  >
                    <span className="text-[#737373] shrink-0 text-[10px]">[{timeStr}]</span>
                    <span
                      className={`font-mono text-xs font-bold shrink-0 ${
                        log.level === 'success'
                          ? 'text-[#bbc300]'
                          : log.level === 'warn'
                          ? 'text-[#c36a00]'
                          : log.level === 'error'
                          ? 'text-[#c3005a]'
                          : 'text-[#8c8c8c]'
                      }`}
                    >
                      {`<${log.level.toUpperCase()}>`}
                    </span>
                    <span className={`${color} break-all`}>{log.message}</span>
                  </div>
                );
              })
            )}
            <div ref={consoleBottomSentinelRef} className="h-0 w-full" />
          </div>

          {/* Jump to bottom / Resume autoscroll pill */}
          {!consoleAutoscroll && canScrollConsole && displayLogs.length > 0 && (
            <button
              type="button"
              onClick={toggleConsoleAutoscroll}
              className="absolute bottom-4 right-6 z-20 flex items-center gap-1.5 px-3.5 py-1.5 rounded-none bg-[#141414] border border-[#c30800]/60 text-[#f0f0f0] text-[11px] font-mono shadow-2xl hover:bg-[#2e2e2e] hover:border-[#c30800] transition-all cursor-pointer"
            >
              <ArrowDown className="w-3.5 h-3.5 text-[#c30800] animate-bounce" />
              <span>Autoscroll paused • Click to lock bottom</span>
            </button>
          )}
        </div>
      )}


      {/* Pop Out Window for Crawled Page Inspection */}
      {inspectPage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xs font-mono text-xs"
          onClick={() => setInspectPage(null)}
        >
          <div
            className="bg-[#141414] border border-[#383838] rounded-none w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-[2px] w-full bg-gradient-to-r from-[#c30800] via-[#c300bb] to-[#bbc300]" />
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-[#383838] flex items-center justify-between bg-[#141414] backdrop-blur-sm bg-gradient-to-r from-[#c30800]/10 via-transparent to-transparent">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="font-bold text-xs text-[#f0f0f0]">
                  {inspectPage.method || 'GET'}
                </span>
                {getStatusBadge(inspectPage)}
                <span className="font-bold text-sm text-[#f0f0f0] truncate max-w-sm">
                  {inspectPage.pathname || inspectPage.url}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setInspectPage(null)}
                className="p-1.5 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar bg-[#141414]">
              {/* Full URL & Copy */}
              <div className="p-3 bg-[#0d0d0d] border border-[#383838] space-y-1.5">
                <div className="flex items-center justify-between text-[10px] text-[#8c8c8c] uppercase tracking-wider font-bold">
                  <span>Canonical Target Address</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => handleCopy(inspectPage.url, 'inspect_page_url', e)}
                      className="text-[#c30800] hover:underline font-bold flex items-center gap-1 cursor-pointer"
                    >
                      {copiedId === 'inspect_page_url' ? <span>COPIED</span> : <span>COPY URL</span>}
                    </button>
                    <a
                      href={inspectPage.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#8c8c8c] hover:text-[#f0f0f0] flex items-center gap-1"
                    >
                      <span>OPEN</span>
                      <ExternalLink className="w-3 h-3 text-[#c30800]" />
                    </a>
                  </div>
                </div>
                <div className="text-xs text-[#f0f0f0] break-all select-all font-semibold">
                  {inspectPage.url}
                </div>
                {inspectPage.title && (
                  <div className="text-[11px] text-[#8c8c8c] pt-1 border-t border-[#2e2e2e]">
                    Title: <span className="text-[#f0f0f0] font-medium">{inspectPage.title}</span>
                  </div>
                )}
              </div>

              {/* Quick Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-3 bg-[#141414] border border-[#383838]">
                  <span className="text-[9px] uppercase text-[#8c8c8c] tracking-wider block">Depth</span>
                  <span className="text-lg font-bold text-[#f0f0f0]">{inspectPage.depth}</span>
                </div>
                <div className="p-3 bg-[#141414] border border-[#383838]">
                  <span className="text-[9px] uppercase text-[#8c8c8c] tracking-wider block">Fetch Duration</span>
                  <span className="text-lg font-bold text-[#f0f0f0]">{inspectPage.durationMs}ms</span>
                </div>
                <div className="p-3 bg-[#141414] border border-[#383838]">
                  <span className="text-[9px] uppercase text-[#8c8c8c] tracking-wider block">Same-Domain Links</span>
                  <span className="text-lg font-bold text-[#f0f0f0]">{inspectPage.sameDomainLinksCount}</span>
                </div>
                <div className="p-3 bg-[#141414] border border-[#383838]">
                  <span className="text-[9px] uppercase text-[#8c8c8c] tracking-wider block">Total Discovered</span>
                  <span className="text-lg font-bold text-[#f0f0f0]">{inspectPage.discoveredLinksCount}</span>
                </div>
              </div>

              {/* Parent Referrer & Content Type */}
              <div className="p-3 bg-[#141414] border border-[#383838] space-y-1.5 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-[#8c8c8c] uppercase">Content-Type:</span>
                  <span className="text-[#f0f0f0] font-bold">{inspectPage.contentType || 'text/html'}</span>
                </div>
                {inspectPage.parentUrl && (
                  <div className="flex flex-col gap-0.5 pt-1 border-t border-[#2e2e2e]">
                    <span className="text-[#8c8c8c] uppercase">Referred By Parent Page:</span>
                    <span className="text-[#8c8c8c] truncate select-all">{inspectPage.parentUrl}</span>
                  </div>
                )}
                {inspectPage.error && (
                  <div className="p-2 bg-[#770500]/20 border border-[#770500]/60 text-[#f3f3f7] font-bold">
                    Error: {inspectPage.error}
                  </div>
                )}
              </div>

              {/* HTTP Request Preview */}
              {httpRequestPreview && (
                <div className="border border-[#383838] bg-[#141414] rounded-none overflow-hidden font-mono text-[11px]">
                  <div
                    className="w-full px-3 py-2 flex items-center justify-between bg-[#141414] hover:bg-[#1a1a1a] transition-colors cursor-pointer select-none"
                    onClick={() => setShowHttpRequest(!showHttpRequest)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-[#f0f0f0] font-bold uppercase tracking-wider">
                        HTTP Request Preview
                      </span>
                      <span className="text-[#8c8c8c] text-[10px]">
                        [{httpRequestPreview.method} {httpRequestPreview.httpVersion}]
                      </span>
                    </div>
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      {showHttpRequest && (
                        <div className="flex items-center border border-[#383838] bg-[#0d0d0d] p-0.5">
                          <button
                            type="button"
                            onClick={() => setHttpRequestFormat('raw')}
                            className={`px-1.5 py-0.5 text-[9px] uppercase font-bold cursor-pointer transition-colors ${
                              httpRequestFormat === 'raw'
                                ? 'bg-[#262626] text-[#f0f0f0]'
                                : 'text-[#8c8c8c] hover:text-[#f0f0f0]'
                            }`}
                          >
                            RAW
                          </button>
                          <button
                            type="button"
                            onClick={() => setHttpRequestFormat('curl')}
                            className={`px-1.5 py-0.5 text-[9px] uppercase font-bold cursor-pointer transition-colors ${
                              httpRequestFormat === 'curl'
                                ? 'bg-[#262626] text-[#f0f0f0]'
                                : 'text-[#8c8c8c] hover:text-[#f0f0f0]'
                            }`}
                          >
                            CURL
                          </button>
                        </div>
                      )}
                      {showHttpRequest && (
                        <button
                          type="button"
                          onClick={(e) =>
                            handleCopy(
                              httpRequestFormat === 'raw'
                                ? httpRequestPreview.rawText
                                : httpRequestPreview.curlText,
                              'http_request',
                              e
                            )
                          }
                          className="px-2 py-0.5 border border-[#383838] bg-[#141414] hover:bg-[#262626] text-[9px] text-[#f0f0f0] uppercase font-bold transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          {copiedId === 'http_request' ? (
                            <>
                              <Check className="w-2.5 h-2.5 text-[#bbc300]" />
                              <span>COPIED</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-2.5 h-2.5 text-[#8c8c8c]" />
                              <span>COPY</span>
                            </>
                          )}
                        </button>
                      )}
                      <span
                        className="text-[#8c8c8c] hover:text-[#f0f0f0] transition-colors cursor-pointer"
                        onClick={() => setShowHttpRequest(!showHttpRequest)}
                      >
                        {showHttpRequest ? (
                          <ChevronDown className="w-3.5 h-3.5 text-[#c30800]" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-[#8c8c8c]" />
                        )}
                      </span>
                    </div>
                  </div>
                  {showHttpRequest && (
                    <div className="border-t border-[#383838] bg-[#0d0d0d] p-3 overflow-x-auto">
                      {httpRequestFormat === 'raw' ? (
                        <div className="space-y-1 font-mono text-xs leading-relaxed select-all">
                          <div className="pb-1 mb-1 border-b border-[#2e2e2e] flex items-center gap-2">
                            <span className="text-[#bbc300] font-bold">{httpRequestPreview.method}</span>
                            <span className="text-[#f0f0f0] break-all">{httpRequestPreview.path}</span>
                            <span className="text-[#8c8c8c] font-semibold ml-auto shrink-0">{httpRequestPreview.httpVersion}</span>
                          </div>
                          {Object.entries(httpRequestPreview.headers).map(([k, v]) => (
                            <div key={k} className="flex gap-2 text-[11px] leading-tight">
                              <span className="text-[#8c8c8c] shrink-0 font-medium">{k}:</span>
                              <span className="text-[#f0f0f0] break-all">{v}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <pre className="text-[11px] font-mono text-[#f0f0f0] whitespace-pre-wrap break-all leading-relaxed select-all">
                          {httpRequestPreview.curlText}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* HTTP Response Preview for 4XX Responses */}
              {httpResponsePreview && (
                <div id="http-response-preview-card" className="border border-[#383838] bg-[#141414] rounded-none overflow-hidden font-mono text-[11px]">
                  <div
                    className="w-full px-3 py-2 flex items-center justify-between bg-[#141414] hover:bg-[#1a1a1a] transition-colors cursor-pointer select-none border-l-2 border-l-[#c3005a]"
                    onClick={() => setShowHttpResponse(!showHttpResponse)}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] text-[#f0f0f0] font-bold uppercase tracking-wider">
                        HTTP Response Preview
                      </span>
                      <span className="text-[#c3005a] text-[10px] font-bold">
                        [{httpResponsePreview.httpVersion} {httpResponsePreview.statusCode} {httpResponsePreview.statusText}]
                      </span>
                    </div>
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      {showHttpResponse && (
                        <div className="flex items-center border border-[#383838] bg-[#0d0d0d] p-0.5">
                          <button
                            type="button"
                            onClick={() => setHttpResponseFormat('raw')}
                            className={`px-1.5 py-0.5 text-[9px] uppercase font-bold cursor-pointer transition-colors ${
                              httpResponseFormat === 'raw'
                                ? 'bg-[#262626] text-[#f0f0f0]'
                                : 'text-[#8c8c8c] hover:text-[#f0f0f0]'
                            }`}
                          >
                            RAW
                          </button>
                          <button
                            type="button"
                            onClick={() => setHttpResponseFormat('headers')}
                            className={`px-1.5 py-0.5 text-[9px] uppercase font-bold cursor-pointer transition-colors ${
                              httpResponseFormat === 'headers'
                                ? 'bg-[#262626] text-[#f0f0f0]'
                                : 'text-[#8c8c8c] hover:text-[#f0f0f0]'
                            }`}
                          >
                            HEADERS
                          </button>
                          <button
                            type="button"
                            onClick={() => setHttpResponseFormat('body')}
                            className={`px-1.5 py-0.5 text-[9px] uppercase font-bold cursor-pointer transition-colors ${
                              httpResponseFormat === 'body'
                                ? 'bg-[#262626] text-[#f0f0f0]'
                                : 'text-[#8c8c8c] hover:text-[#f0f0f0]'
                            }`}
                          >
                            BODY
                          </button>
                        </div>
                      )}
                      {showHttpResponse && (
                        <button
                          type="button"
                          onClick={(e) =>
                            handleCopy(
                              httpResponseFormat === 'raw'
                                ? httpResponsePreview.rawText
                                : httpResponseFormat === 'body'
                                ? httpResponsePreview.body
                                : httpResponsePreview.headersText,
                              'http_response',
                              e
                            )
                          }
                          className="px-2 py-0.5 border border-[#383838] bg-[#141414] hover:bg-[#262626] text-[9px] text-[#f0f0f0] uppercase font-bold transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          {copiedId === 'http_response' ? (
                            <>
                              <Check className="w-2.5 h-2.5 text-[#bbc300]" />
                              <span>COPIED</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-2.5 h-2.5 text-[#8c8c8c]" />
                              <span>COPY</span>
                            </>
                          )}
                        </button>
                      )}
                      <span
                        className="text-[#8c8c8c] hover:text-[#f0f0f0] transition-colors cursor-pointer"
                        onClick={() => setShowHttpResponse(!showHttpResponse)}
                      >
                        {showHttpResponse ? (
                          <ChevronDown className="w-3.5 h-3.5 text-[#c30800]" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-[#8c8c8c]" />
                        )}
                      </span>
                    </div>
                  </div>
                  {showHttpResponse && (
                    <div className="border-t border-[#383838] bg-[#0d0d0d] p-3 overflow-x-auto">
                      {httpResponseFormat === 'raw' ? (
                        <div className="space-y-1 font-mono text-xs leading-relaxed select-all">
                          <div className="pb-1 mb-1 border-b border-[#2e2e2e] flex items-center gap-2">
                            <span className="text-[#8c8c8c] font-semibold">{httpResponsePreview.httpVersion}</span>
                            <span className="text-[#c3005a] font-bold">{httpResponsePreview.statusCode}</span>
                            <span className="text-[#f0f0f0] font-bold">{httpResponsePreview.statusText}</span>
                          </div>
                          {Object.entries(httpResponsePreview.headers).map(([k, v]) => (
                            <div key={k} className="flex gap-2 text-[11px] leading-tight">
                              <span className="text-[#8c8c8c] shrink-0 font-medium">{k}:</span>
                              <span className="text-[#f0f0f0] break-all">{v}</span>
                            </div>
                          ))}
                          <div className="my-2 border-t border-[#262626]" />
                          <div className="text-[10px] text-[#737373] uppercase tracking-wider font-bold mb-1">
                            Response Payload ({httpResponsePreview.body.length} bytes):
                          </div>
                          <pre className="text-[11px] font-mono text-[#8c8c8c] whitespace-pre-wrap break-all p-2.5 bg-[#141414] border border-[#2e2e2e] max-h-56 overflow-y-auto leading-relaxed custom-scrollbar">
                            {httpResponsePreview.body}
                          </pre>
                        </div>
                      ) : httpResponseFormat === 'headers' ? (
                        <div className="space-y-1 font-mono text-xs leading-relaxed select-all">
                          <div className="pb-1 mb-1 border-b border-[#2e2e2e] flex items-center gap-2">
                            <span className="text-[#8c8c8c] font-semibold">{httpResponsePreview.httpVersion}</span>
                            <span className="text-[#c3005a] font-bold">{httpResponsePreview.statusCode}</span>
                            <span className="text-[#f0f0f0] font-bold">{httpResponsePreview.statusText}</span>
                          </div>
                          {Object.entries(httpResponsePreview.headers).map(([k, v]) => (
                            <div key={k} className="flex gap-2 text-[11px] leading-tight">
                              <span className="text-[#8c8c8c] shrink-0 font-medium">{k}:</span>
                              <span className="text-[#f0f0f0] break-all">{v}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-1 font-mono text-xs select-all">
                          <div className="flex items-center justify-between pb-1 mb-1 border-b border-[#2e2e2e] text-[10px] text-[#8c8c8c]">
                            <span>Status: <strong className="text-[#c3005a]">{httpResponsePreview.statusCode} {httpResponsePreview.statusText}</strong></span>
                            <span>{httpResponsePreview.body.length} bytes</span>
                          </div>
                          <pre className="text-[11px] font-mono text-[#f0f0f0] whitespace-pre-wrap break-all p-2.5 bg-[#141414] border border-[#2e2e2e] max-h-72 overflow-y-auto leading-relaxed custom-scrollbar">
                            {httpResponsePreview.body}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Redirect Chain & Loop Diagnostics */}
              {inspectPage.redirectChain && inspectPage.redirectChain.length > 1 && (
                <div className="border border-[#383838] bg-[#141414] rounded-none overflow-hidden font-mono text-[11px]">
                  <div
                    className="w-full px-3 py-2 flex items-center justify-between bg-[#141414] hover:bg-[#1a1a1a] transition-colors cursor-pointer select-none"
                    onClick={() => setShowRedirectChain(!showRedirectChain)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-[#f0f0f0] font-bold uppercase tracking-wider">
                        Redirect Chain ({inspectPage.redirectChain.length - 1} Hops)
                      </span>
                      <span className="text-[#c36a00] text-[10px] font-semibold">
                        {inspectPage.statusCode === 310 ? 'Circular Loop Terminated' : 'Resolved'}
                      </span>
                    </div>
                    <span className="text-[#8c8c8c] hover:text-[#f0f0f0] transition-colors">
                      {showRedirectChain ? (
                        <ChevronDown className="w-3.5 h-3.5 text-[#c30800]" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-[#8c8c8c]" />
                      )}
                    </span>
                  </div>
                  {showRedirectChain && (
                    <div className="p-3 bg-[#0d0d0d] border-t border-[#383838] space-y-1">
                      {inspectPage.redirectChain.map((hopUrl, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-[10px] text-[#f0f0f0] font-mono">
                          <span className="text-[#8c8c8c] shrink-0 font-bold">[{idx}]</span>
                          <span className={`break-all ${idx === inspectPage.redirectChain!.length - 1 ? 'text-[#c30800] font-bold' : 'text-[#8c8c8c]'}`}>
                            {hopUrl}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Canonical Tag Specification */}
              {inspectPage.canonicalUrl && (
                <div className="p-3 bg-[#141414] border border-[#383838] space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between text-[10px] text-[#8c8c8c] uppercase font-bold tracking-wider">
                    <span>Canonical Specification</span>
                    <span className={`font-bold ${
                      inspectPage.canonicalStatus === 'self'
                        ? 'text-[#bbc300]'
                        : inspectPage.canonicalStatus === 'loop'
                        ? 'text-[#c3005a]'
                        : 'text-[#c36a00]'
                    }`}>
                      {inspectPage.canonicalStatus?.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-xs text-[#f0f0f0] break-all select-all font-mono font-medium">
                    {inspectPage.canonicalUrl}
                  </div>
                </div>
              )}

              {/* Robots & Crawler Directives */}
              {(inspectPage.isNoIndex || inspectPage.hasNoFollow || (inspectPage.robotsDirectives && inspectPage.robotsDirectives.length > 0)) && (
                <div className="border border-[#383838] bg-[#141414] rounded-none overflow-hidden font-mono text-[11px]">
                  <div
                    className="w-full px-3 py-2 flex items-center justify-between bg-[#141414] hover:bg-[#1a1a1a] transition-colors cursor-pointer select-none"
                    onClick={() => setShowRobotsDirectives(!showRobotsDirectives)}
                  >
                    <span className="text-[10px] text-[#f0f0f0] font-bold uppercase tracking-wider">
                      Robots Meta &amp; Header Directives
                    </span>
                    <span className="text-[#8c8c8c] hover:text-[#f0f0f0] transition-colors">
                      {showRobotsDirectives ? (
                        <ChevronDown className="w-3.5 h-3.5 text-[#c30800]" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-[#8c8c8c]" />
                      )}
                    </span>
                  </div>
                  {showRobotsDirectives && (
                    <div className="p-3.5 bg-[#0d0d0d] border-t border-[#383838] space-y-3 font-mono text-xs">
                      {/* Core Policies */}
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-3 pb-2 border-b border-[#2e2e2e]">
                          <div className="space-y-0.5">
                            <span className="text-[10px] text-[#8c8c8c] uppercase tracking-wider block">Indexation Policy</span>
                            <p className="text-[11px] text-[#8c8c8c]">
                              {inspectPage.isNoIndex
                                ? 'Search engines are instructed not to index this page.'
                                : 'Search engines are permitted to index and show this page in search results.'}
                            </p>
                          </div>
                          <span className={`text-xs font-bold shrink-0 ${inspectPage.isNoIndex ? 'text-[#c36a00]' : 'text-[#bbc300]'}`}>
                            {inspectPage.isNoIndex ? 'NOINDEX' : 'INDEXABLE'}
                          </span>
                        </div>

                        <div className="flex items-start justify-between gap-3 pb-2 border-b border-[#2e2e2e]">
                          <div className="space-y-0.5">
                            <span className="text-[10px] text-[#8c8c8c] uppercase tracking-wider block">Link Following Policy</span>
                            <p className="text-[11px] text-[#8c8c8c]">
                              {inspectPage.hasNoFollow
                                ? 'Search engines are instructed not to follow outbound links on this page.'
                                : 'Search engines are permitted to follow hyperlinks on this page.'}
                            </p>
                          </div>
                          <span className={`text-xs font-bold shrink-0 ${inspectPage.hasNoFollow ? 'text-[#c300bb]' : 'text-[#8c8c8c]'}`}>
                            {inspectPage.hasNoFollow ? 'NOFOLLOW' : 'FOLLOW'}
                          </span>
                        </div>
                      </div>

                      {/* Detected Raw Directives */}
                      {inspectPage.robotsDirectives && inspectPage.robotsDirectives.length > 0 && (
                        <div className="space-y-1.5 pt-1">
                          <span className="text-[10px] text-[#8c8c8c] uppercase tracking-wider block">
                            Detected Directives ({inspectPage.robotsDirectives.length})
                          </span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {inspectPage.robotsDirectives.map((dir, idx) => {
                              const lower = dir.toLowerCase().trim();
                              let explanation = 'Parsed crawler directive';
                              if (lower === 'noindex') explanation = 'Do not index this page.';
                              else if (lower === 'nofollow') explanation = 'Do not follow links on this page.';
                              else if (lower === 'noarchive') explanation = 'Do not show cached link in search results.';
                              else if (lower === 'nosnippet') explanation = 'Do not show text snippet or preview.';
                              else if (lower === 'noimageindex') explanation = 'Do not index images on this page.';
                              else if (lower === 'none') explanation = 'Equivalent to noindex, nofollow.';
                              else if (lower === 'all') explanation = 'No crawl restrictions.';
                              else if (lower.startsWith('max-snippet')) explanation = 'Restricts maximum snippet character length.';
                              else if (lower.startsWith('max-image-preview')) explanation = 'Restricts image preview size.';
                              else if (lower.startsWith('max-video-preview')) explanation = 'Restricts video preview duration.';

                              return (
                                <div
                                  key={idx}
                                  className="p-2 rounded-none bg-[#141414] border border-[#2e2e2e] flex flex-col gap-0.5"
                                >
                                  <span className="text-[#f0f0f0] font-bold text-xs">{dir}</span>
                                  <span className="text-[10px] text-[#8c8c8c] leading-tight">{explanation}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Stream & Payload Metrics */}
              {(inspectPage.truncatedBody || (inspectPage.bytesRead && inspectPage.bytesRead > 0)) && (
                <div className="p-3 bg-[#141414] border border-[#383838] space-y-1 text-[11px]">
                  <div className="flex justify-between items-center text-[10px] text-[#8c8c8c] uppercase font-bold">
                    <span>Bounded Stream Ingestion</span>
                    {inspectPage.truncatedBody ? (
                      <span className="text-[#c36a00] font-bold">2MB Limit Reached (Clamped)</span>
                    ) : (
                      <span className="text-[#bbc300] font-bold">Full Payload Read</span>
                    )}
                  </div>
                  {inspectPage.bytesRead && (
                    <div className="text-[10px] text-[#8c8c8c]">
                      Bytes ingested: <span className="text-[#f0f0f0] font-mono font-bold">{inspectPage.bytesRead.toLocaleString()} bytes</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-[#383838] bg-[#141414] flex justify-end">
              <button
                type="button"
                onClick={() => setInspectPage(null)}
                className="px-3 py-1.5 bg-[#141414] hover:bg-[#262626] text-[#f0f0f0] border border-[#383838] text-xs uppercase tracking-wider transition-colors cursor-pointer font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


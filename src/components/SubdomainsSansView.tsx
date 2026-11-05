// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { safeClampInput } from '../utils/urlUtils';
import { ExternalLinkRecord, FileCategory, CrtSubdomainsData, SubdomainProbeResult } from '../types';
import {
  Network,
  Globe,
  Search,
  Copy,
  Check,
  ExternalLink,
  Layers,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  FileCode,
  FileText,
  Image,
  Code,
  Music,
  Database,
  Archive,
  File,
  Code2,
  RefreshCw,
  X,
  Activity,
  Loader2,
  Zap,
} from 'lucide-react';
import { extractApexDomain } from '../utils/urlUtils';
import { HighlightedHtmlPreview } from './HighlightedHtmlPreview';
import { fetchCrtSubdomains, probeSubdomainBatch } from '../services/domainIntelligenceService';

interface SubdomainsSansViewProps {
  currentDomain?: string | null;
  startUrl?: string;
  externalLinks: ExternalLinkRecord[];
  refreshKey?: number;
  onOpenWhois?: (domain: string) => void;
  onCrawlHost?: (host: string) => void;
}

function getCategoryIcon(isAsset: boolean, fileType?: FileCategory) {
  if (!isAsset) {
    return <Globe className="w-3.5 h-3.5 text-[#c30800] shrink-0" />;
  }

  switch (fileType) {
    case 'document':
      return <FileText className="w-3.5 h-3.5 text-[#c30800] shrink-0" />;
    case 'image':
      return <Image className="w-3.5 h-3.5 text-[#c30800] shrink-0" />;
    case 'code':
    case 'script':
      return <Code className="w-3.5 h-3.5 text-[#c30800] shrink-0" />;
    case 'stylesheet':
      return <FileCode className="w-3.5 h-3.5 text-[#c30800] shrink-0" />;
    case 'media':
      return <Music className="w-3.5 h-3.5 text-[#c30800] shrink-0" />;
    case 'data':
      return <Database className="w-3.5 h-3.5 text-[#c30800] shrink-0" />;
    case 'archive':
      return <Archive className="w-3.5 h-3.5 text-[#c30800] shrink-0" />;
    default:
      return <File className="w-3.5 h-3.5 text-[#c30800] shrink-0" />;
  }
}

function getFallbackHtmlContext(link: ExternalLinkRecord): string {
  if (link.htmlContext && link.htmlContext.trim().length > 0) {
    return link.htmlContext;
  }
  const tag = link.tagType || 'a';
  if (tag === 'img') {
    return `<img src="${link.url}" ${link.linkText ? `alt="${link.linkText}" ` : ''}loading="lazy" />`;
  }
  if (tag === 'script') {
    return `<script src="${link.url}" type="text/javascript"></script>`;
  }
  if (tag === 'link') {
    return `<link rel="${link.fileType === 'stylesheet' ? 'stylesheet' : 'preload'}" href="${link.url}" />`;
  }
  if (tag === 'media') {
    return `<source src="${link.url}" type="${link.extension ? `audio/${link.extension}` : 'video/mp4'}" />`;
  }
  if (tag === 'iframe') {
    return `<iframe src="${link.url}" frameborder="0"></iframe>`;
  }
  return `<a href="${link.url}" rel="noopener noreferrer">${link.linkText || link.url}</a>`;
}

export const HighlightedHtmlWithDomain = HighlightedHtmlPreview;

export const SubdomainsSansView: React.FC<SubdomainsSansViewProps> = ({
  currentDomain,
  startUrl,
  externalLinks,
  refreshKey: _refreshKey,
  onOpenWhois: _onOpenWhois,
  onCrawlHost: _onCrawlHost,
}) => {
  const [activeFilterTab, setActiveFilterTab] = useState<'all' | 'crt' | 'subdomains' | 'sans' | 'links'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [expandedHosts, setExpandedHosts] = useState<Record<string, boolean>>({});
  const [showAllContexts, setShowAllContexts] = useState<boolean>(false);
  const [expandedContexts, setExpandedContexts] = useState<Record<string, boolean>>({});

  const [inspectLink, setInspectLink] = useState<ExternalLinkRecord | null>(null);
  const closedInspectLinkRef = useRef<ExternalLinkRecord | null>(null);

  useEffect(() => {
    const handleMouseNav = (e: MouseEvent) => {
      if (e.button === 3) {
        if (inspectLink) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          closedInspectLinkRef.current = inspectLink;
          setInspectLink(null);
        }
      } else if (e.button === 4) {
        if (!inspectLink && closedInspectLinkRef.current) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          setInspectLink(closedInspectLinkRef.current);
          closedInspectLinkRef.current = null;
        }
      }
    };

    window.addEventListener('mouseup', handleMouseNav, { capture: true });
    return () => window.removeEventListener('mouseup', handleMouseNav, { capture: true });
  }, [inspectLink]);


  const [crtData, setCrtData] = useState<CrtSubdomainsData | null>(null);
  const [loadingCrt, setLoadingCrt] = useState<boolean>(false);
  const [crtError, setCrtError] = useState<string | null>(null);
  const [crtRefreshKey, setCrtRefreshKey] = useState<number>(0);

  const [probedHosts, setProbedHosts] = useState<Record<string, SubdomainProbeResult>>({});
  const [isBatchProbing, setIsBatchProbing] = useState<boolean>(false);

  const effectiveDomain = useMemo(() => {
    if (currentDomain) return currentDomain.toLowerCase().replace(/:\d+$/, '');
    if (startUrl) {
      try {
        let s = startUrl.trim();
        if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
        return new URL(s).hostname.toLowerCase().replace(/:\d+$/, '');
      } catch {}
    }
    return '';
  }, [currentDomain, startUrl]);

  const targetApex = useMemo(() => {
    return extractApexDomain(effectiveDomain) || effectiveDomain;
  }, [effectiveDomain]);


  useEffect(() => {
    if (!targetApex || crtRefreshKey <= 0) return;

    let isMounted = true;
    setLoadingCrt(true);
    setCrtError(null);

    fetchCrtSubdomains(targetApex)
      .then((data) => {
        if (isMounted) {
          setCrtData(data);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setCrtError(err.message || 'Failed to query Certificate Transparency logs');
        }
      })
      .finally(() => {
        if (isMounted) setLoadingCrt(false);
      });

    return () => {
      isMounted = false;
    };
  }, [targetApex, crtRefreshKey]);

  const certificateSans = useMemo<string[]>(() => [], []);

  const crtSubdomainsList = useMemo(() => {
    const list = crtData?.subdomains || [];
    return Array.from(new Set(list.map((s) => s.toLowerCase().trim().replace(/^\*\./, '')))).filter(Boolean);
  }, [crtData]);

  const handleBatchProbe = useCallback(async (hosts: string[]) => {
    if (hosts.length === 0 || isBatchProbing) return;
    setIsBatchProbing(true);

    try {
      const probeResults = await probeSubdomainBatch(hosts);
      const nextMap: Record<string, SubdomainProbeResult> = {};
      probeResults.forEach((r) => {
        nextMap[r.hostname] = r;
      });
      setProbedHosts((prev) => ({ ...prev, ...nextMap }));
    } catch {
      // ignore
    } finally {
      setIsBatchProbing(false);
    }
  }, [isBatchProbing]);

  const { crawlSubdomainsMap, sanLinksMap } = useMemo(() => {
    const subMap = new Map<string, ExternalLinkRecord[]>();
    const sanMap = new Map<string, ExternalLinkRecord[]>();
    const sanSet = new Set(certificateSans);

    for (const link of externalLinks) {
      const host = (link.domain || '').toLowerCase().trim().replace(/:\d+$/, '');
      const root = (link.rootDomain || extractApexDomain(host) || '').toLowerCase().trim();

      const isSubdomainOfOriginal =
        (targetApex && (root === targetApex || host === targetApex || host.endsWith('.' + targetApex))) ||
        (effectiveDomain && (host === effectiveDomain || host.endsWith('.' + effectiveDomain)));

      const isSan =
        sanSet.has(host) ||
        sanSet.has('*.' + root) ||
        sanSet.has('*.' + host) ||
        sanSet.has(root);

      if (isSubdomainOfOriginal && host !== effectiveDomain) {
        const list = subMap.get(host) || [];
        list.push(link);
        subMap.set(host, list);
      }

      if (isSan && host !== effectiveDomain) {
        const list = sanMap.get(host) || [];
        list.push(link);
        sanMap.set(host, list);
      }
    }

    return {
      crawlSubdomainsMap: subMap,
      sanLinksMap: sanMap,
    };
  }, [externalLinks, effectiveDomain, targetApex, certificateSans]);

  const rawGroupedItems = useMemo(() => {
    const map = new Map<
      string,
      {
        hostname: string;
        isSubdomainOfOriginal: boolean;
        isSan: boolean;
        isDirectSan: boolean;
        isWildcardSan: boolean;
        isCrt: boolean;
        links: ExternalLinkRecord[];
        assetCount: number;
        pageCount: number;
      }
    >();

    const crtSet = new Set(crtSubdomainsList);
    const directSanSet = new Set(certificateSans.map((s) => s.toLowerCase().trim()));
    const wildcardSans = certificateSans.filter((s) => s.startsWith('*.'));

    const checkIsSan = (host: string) => {
      const lower = host.toLowerCase().trim();
      const isDirect = directSanSet.has(lower) || directSanSet.has('*.' + lower);
      const isWild = wildcardSans.some((w) => {
        const root = w.slice(2).toLowerCase();
        return lower === root || lower.endsWith('.' + root);
      });
      return { isSan: isDirect || isWild, isDirectSan: isDirect, isWildcardSan: isWild };
    };

    for (const host of crtSubdomainsList) {
      if (host === effectiveDomain) continue;
      const links = crawlSubdomainsMap.get(host) || [];
      const assetCount = links.filter((l) => l.isAssetOrFile).length;
      const { isSan, isDirectSan, isWildcardSan } = checkIsSan(host);
      const isSubdomain = targetApex ? host === targetApex || host.endsWith('.' + targetApex) : false;

      map.set(host, {
        hostname: host,
        isSubdomainOfOriginal: isSubdomain,
        isSan,
        isDirectSan,
        isWildcardSan,
        isCrt: true,
        links,
        assetCount,
        pageCount: links.length - assetCount,
      });
    }

    for (const rawSan of certificateSans) {
      const cleanSan = rawSan.toLowerCase().trim();
      if (!cleanSan) continue;
      
      const hostKey = cleanSan.startsWith('*.') ? cleanSan : cleanSan;
      const strippedHost = cleanSan.replace(/^\*\./, '');
      
      const existing = map.get(cleanSan) || (cleanSan.startsWith('*.') ? map.get(strippedHost) : undefined);
      if (existing) {
        existing.isSan = true;
        existing.isDirectSan = true;
      } else {
        const links = crawlSubdomainsMap.get(cleanSan) || crawlSubdomainsMap.get(strippedHost) || sanLinksMap.get(cleanSan) || [];
        const assetCount = links.filter((l) => l.isAssetOrFile).length;
        const isSubdomain = targetApex ? strippedHost === targetApex || strippedHost.endsWith('.' + targetApex) : false;

        map.set(hostKey, {
          hostname: hostKey,
          isSubdomainOfOriginal: isSubdomain,
          isSan: true,
          isDirectSan: true,
          isWildcardSan: cleanSan.startsWith('*.'),
          isCrt: crtSet.has(cleanSan) || crtSet.has(strippedHost),
          links,
          assetCount,
          pageCount: links.length - assetCount,
        });
      }
    }

    for (const [hostname, links] of crawlSubdomainsMap.entries()) {
      if (hostname === effectiveDomain) continue;
      const existing = map.get(hostname);
      if (existing) {
        existing.links = links;
        existing.assetCount = links.filter((l) => l.isAssetOrFile).length;
        existing.pageCount = links.length - existing.assetCount;
      } else {
        const assetCount = links.filter((l) => l.isAssetOrFile).length;
        const { isSan, isDirectSan, isWildcardSan } = checkIsSan(hostname);
        const isCrt = crtSet.has(hostname);
        const isSubdomain = targetApex ? hostname === targetApex || hostname.endsWith('.' + targetApex) : false;

        map.set(hostname, {
          hostname,
          isSubdomainOfOriginal: isSubdomain,
          isSan,
          isDirectSan,
          isWildcardSan,
          isCrt,
          links,
          assetCount,
          pageCount: links.length - assetCount,
        });
      }
    }

    return Array.from(map.values());
  }, [crtSubdomainsList, certificateSans, crawlSubdomainsMap, sanLinksMap, effectiveDomain, targetApex]);

  const tabCounts = useMemo(() => {
    return {
      all: rawGroupedItems.length,
      crt: rawGroupedItems.filter((i) => i.isCrt).length,
      subdomains: rawGroupedItems.filter((i) => i.isSubdomainOfOriginal).length,
      sans: rawGroupedItems.filter((i) => i.isSan).length,
      links: rawGroupedItems.filter((i) => i.links.length > 0).length,
    };
  }, [rawGroupedItems]);

  const groupedItems = useMemo(() => {
    let list = rawGroupedItems;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((item) => {
        if (item.hostname.toLowerCase().includes(q)) return true;
        const probe = probedHosts[item.hostname];
        if (probe?.ip?.toLowerCase().includes(q) || String(probe?.statusCode || '').includes(q)) return true;
        return item.links.some(
          (l) =>
            l.url.toLowerCase().includes(q) ||
            l.foundOnUrl.toLowerCase().includes(q) ||
            l.htmlContext?.toLowerCase().includes(q) ||
            l.linkText?.toLowerCase().includes(q)
        );
      });
    }

    if (activeFilterTab === 'crt') {
      list = list.filter((i) => i.isCrt);
    } else if (activeFilterTab === 'subdomains') {
      list = list.filter((i) => i.isSubdomainOfOriginal);
    } else if (activeFilterTab === 'sans') {
      list = list.filter((i) => i.isSan);
    } else if (activeFilterTab === 'links') {
      list = list.filter((i) => i.links.length > 0);
    }

    return list.sort((a, b) => {
      if (b.links.length !== a.links.length) return b.links.length - a.links.length;
      if (b.isCrt !== a.isCrt) return b.isCrt ? 1 : -1;
      return a.hostname.localeCompare(b.hostname);
    });
  }, [rawGroupedItems, searchQuery, activeFilterTab, probedHosts]);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const toggleHostCollapse = (hostname: string) => {
    setExpandedHosts((prev) => ({ ...prev, [hostname]: !prev[hostname] }));
  };

  const allExpanded = useMemo(() => {
    if (groupedItems.length === 0) return false;
    return groupedItems.every((g) => !!expandedHosts[g.hostname]);
  }, [groupedItems, expandedHosts]);

  const toggleCollapseAll = () => {
    if (allExpanded) {
      setExpandedHosts({});
    } else {
      const next: Record<string, boolean> = {};
      groupedItems.forEach((g) => {
        next[g.hostname] = true;
      });
      setExpandedHosts(next);
    }
  };

  const toggleContextExpanded = (key: string) => {
    setExpandedContexts((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const totalLinksInTab = useMemo(() => {
    return groupedItems.reduce((acc, g) => acc + g.links.length, 0);
  }, [groupedItems]);

  const totalLiveProbed = useMemo(() => {
    return (Object.values(probedHosts) as SubdomainProbeResult[]).filter((p) => p.isLive || p.dnsResolves).length;
  }, [probedHosts]);

  return (
    <div id="subdomains-sans-view" className="space-y-4">
      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
        <div className="p-3.5 rounded-none bg-[#141414] border border-[#383838] shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider font-semibold">Total Unique Hosts</span>
            <Network className="w-3.5 h-3.5 text-[#c30800]" />
          </div>
          <p className="text-xl font-bold text-[#f0f0f0] mt-0.5">{groupedItems.length}</p>
        </div>

        <div className="p-3.5 rounded-none bg-[#141414] border border-[#383838] shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider font-semibold">crt.name Subdomains</span>
            <Globe className="w-3.5 h-3.5 text-[#c30800]" />
          </div>
          <p className="text-xl font-bold text-[#f0f0f0] mt-0.5 flex items-center gap-1.5">
            <span>{crtSubdomainsList.length}</span>
            {loadingCrt && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#8c8c8c]" />}
          </p>
        </div>

        <div className="p-3.5 rounded-none bg-[#141414] border border-[#383838] shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider font-semibold">Crawl Discovered URLs</span>
            <Layers className="w-3.5 h-3.5 text-[#c30800]" />
          </div>
          <p className="text-xl font-bold text-[#f0f0f0] mt-0.5">{totalLinksInTab}</p>
        </div>

        <div className="p-3.5 rounded-none bg-[#141414] border border-[#383838] shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider font-semibold">Live Probed Hosts</span>
            <Activity className="w-3.5 h-3.5 text-[#c30800]" />
          </div>
          <p className="text-xl font-bold text-[#f0f0f0] mt-0.5 flex items-center gap-1.5">
            <span>{totalLiveProbed}</span>
            {isBatchProbing && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#8c8c8c]" />}
          </p>
        </div>
      </div>

      {/* Main Standardized Section Card */}
      <div id="subdomains-matrix-card" className="bg-[#141414] border border-[#383838] rounded-none overflow-hidden flex flex-col shadow-md relative">
        <div className="h-[2px] w-full bg-gradient-to-r from-[#c30800] via-[#c300bb] to-[#bbc300]" />

        {/* Section Header */}
        <div className="px-6 py-3.5 bg-[#141414] backdrop-blur-sm bg-gradient-to-r from-[#c30800]/10 via-transparent to-transparent flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-[#383838]">
          <div className="flex items-center flex-wrap gap-2.5">
            <span className="w-2 h-2 bg-[#c30800] shrink-0" />
            <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-[#f0f0f0]">
              Subdomains &amp; SANs Matrix
            </h2>
          </div>

          <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
            {/* Query Subdomains & SANs - Explicit User Action */}
            <button
              type="button"
              onClick={() => setCrtRefreshKey(Date.now())}
              disabled={loadingCrt || (!targetApex && !effectiveDomain)}
              className="px-2.5 py-1 bg-[#141414] hover:bg-[#262626] border border-[#383838] rounded-none text-[#f0f0f0] text-[10px] font-mono uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shrink-0 font-semibold"
              title="Query Certificate Transparency logs"
            >
              <RefreshCw className={`w-3 h-3 ${loadingCrt ? 'animate-spin text-[#c30800]' : 'text-[#c30800]'}`} />
              <span>{crtRefreshKey === 0 ? 'Query Subdomains' : 'Refresh CT Logs'}</span>
            </button>

            {/* Batch Probe All */}
            <button
              type="button"
              onClick={() => handleBatchProbe(groupedItems.map((g) => g.hostname))}
              disabled={isBatchProbing || groupedItems.length === 0}
              className="px-2.5 py-1 bg-[#141414] hover:bg-[#262626] border border-[#383838] rounded-none text-[#f0f0f0] text-[10px] font-mono uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shrink-0 font-semibold"
              title="Resolve DNS for all listed subdomains"
            >
              {isBatchProbing ? (
                <Loader2 className="w-3 h-3 animate-spin text-[#c30800]" />
              ) : (
                <Zap className="w-3 h-3 text-[#c30800]" />
              )}
              <span>{isBatchProbing ? 'Resolving...' : 'Resolve DNS'}</span>
            </button>

            {/* Subdomains / SANs Filter Tabs */}
            <div className="flex items-center gap-1 bg-[#0d0d0d] p-0.5 rounded-none border border-[#2e2e2e] font-mono text-xs shrink-0 flex-wrap">
              <button
                type="button"
                onClick={() => setActiveFilterTab('all')}
                className={`px-2.5 py-1 rounded-none text-[10px] font-mono uppercase tracking-wider transition-colors cursor-pointer font-semibold ${
                  activeFilterTab === 'all'
                    ? 'bg-[#1a1a1a] text-[#f0f0f0] border border-[#c30800]'
                    : 'bg-[#141414] text-[#8c8c8c] hover:text-[#f0f0f0] border border-[#2e2e2e]'
                }`}
              >
                All ({tabCounts.all})
              </button>
              <button
                type="button"
                onClick={() => setActiveFilterTab('crt')}
                className={`px-2.5 py-1 rounded-none text-[10px] font-mono uppercase tracking-wider transition-colors cursor-pointer flex items-center gap-1.5 font-semibold ${
                  activeFilterTab === 'crt'
                    ? 'bg-[#1a1a1a] text-[#f0f0f0] border border-[#c30800]'
                    : 'bg-[#141414] text-[#8c8c8c] hover:text-[#f0f0f0] border border-[#2e2e2e]'
                }`}
              >
                <Globe className="w-3 h-3" />
                <span>crt.name ({tabCounts.crt})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveFilterTab('subdomains')}
                className={`px-2.5 py-1 rounded-none text-[10px] font-mono uppercase tracking-wider transition-colors cursor-pointer flex items-center gap-1.5 font-semibold ${
                  activeFilterTab === 'subdomains'
                    ? 'bg-[#1a1a1a] text-[#f0f0f0] border border-[#c30800]'
                    : 'bg-[#141414] text-[#8c8c8c] hover:text-[#f0f0f0] border border-[#2e2e2e]'
                }`}
              >
                <Network className="w-3 h-3" />
                <span>*.{targetApex || 'apex'} ({tabCounts.subdomains})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveFilterTab('links')}
                className={`px-2.5 py-1 rounded-none text-[10px] font-mono uppercase tracking-wider transition-colors cursor-pointer flex items-center gap-1.5 font-semibold ${
                  activeFilterTab === 'links'
                    ? 'bg-[#1a1a1a] text-[#f0f0f0] border border-[#c30800]'
                    : 'bg-[#141414] text-[#8c8c8c] hover:text-[#f0f0f0] border border-[#2e2e2e]'
                }`}
              >
                <Layers className="w-3 h-3" />
                <span>With Links ({tabCounts.links})</span>
              </button>
            </div>
          </div>
        </div>


            {/* Error Banner */}
        {crtError && (
          <div className="mx-4 mt-4 px-3 py-2 bg-[#c3005a]/10 border border-[#c3005a] text-[#f0f0f0] font-mono text-xs flex items-center justify-between">
            <span>{crtError}</span>
            <button
              type="button"
              onClick={() => setCrtError(null)}
              className="text-[#8c8c8c] hover:text-[#f0f0f0] cursor-pointer"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Filter and Search Bar inside card */}
        <div className="p-4 bg-[#141414] border-b border-[#383838] flex flex-col md:flex-row gap-3 items-center justify-between">
          {/* Search Box */}
          <div className="relative flex-1 w-full min-w-0">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#8c8c8c]">
              <Search className="w-3.5 h-3.5" />
            </div>
            <input
              id="subdomains-search-input"
              type="text"
              maxLength={200}
              placeholder="Search subdomain, SAN domain, IP address, status code, URL, or HTML context"
              value={searchQuery}
              onChange={(e) => setSearchQuery(safeClampInput(e.target.value, 200))}
              className="w-full pl-9 pr-3 py-1.5 bg-[#0d0d0d] border border-[#383838] rounded-none font-mono text-xs text-[#f0f0f0] placeholder-[#8c8c8c] focus:outline-none focus:border-[#c30800]"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap">
            {/* Collapse / Expand All Button */}
            <button
              type="button"
              onClick={toggleCollapseAll}
              disabled={groupedItems.length === 0}
              className={`px-2.5 py-1.5 rounded-none font-mono text-[10px] uppercase tracking-wider border transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ${
                !allExpanded
                  ? 'bg-[#141414] hover:bg-[#262626] border-[#383838] text-[#8c8c8c] hover:text-[#f0f0f0]'
                  : 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0] font-semibold'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
              title={allExpanded ? 'Collapse all subdomain & SAN groups' : 'Expand all subdomain & SAN groups'}
            >
              {allExpanded ? (
                <>
                  <ChevronsDownUp className="w-3.5 h-3.5 text-[#c30800]" />
                  <span>Collapse All</span>
                </>
              ) : (
                <>
                  <ChevronsUpDown className="w-3.5 h-3.5 text-[#c30800]" />
                  <span>Expand All</span>
                </>
              )}
            </button>

            {/* HTML Preview Global Toggle */}
            <button
              type="button"
              onClick={() => setShowAllContexts((prev) => !prev)}
              className={`px-2.5 py-1.5 rounded-none font-mono text-[10px] uppercase tracking-wider border transition-colors cursor-pointer flex items-center gap-1.5 shrink-0 ${
                showAllContexts
                  ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0] font-semibold'
                  : 'bg-[#141414] hover:bg-[#262626] border-[#383838] text-[#8c8c8c] hover:text-[#f0f0f0]'
              }`}
              title="Toggle HTML code previews with domain highlighting"
            >
              <Code2 className={`w-3.5 h-3.5 ${showAllContexts ? 'text-[#c30800]' : 'text-[#8c8c8c]'}`} />
              <span className="hidden sm:inline">HTML Previews</span>
              <span className={showAllContexts ? 'tag tag-sm tag-accent font-bold' : 'tag tag-sm tag-neutral font-bold'}>
                {showAllContexts ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>
        </div>

        {/* Main Results List */}
        {crtRefreshKey <= 0 && groupedItems.length === 0 ? (
          <div className="p-12 text-center bg-[#141414] border-t border-[#383838] rounded-none text-[#8c8c8c] font-mono text-xs shadow-sm space-y-3">
            <Network className="w-10 h-10 text-[#737373] mx-auto mb-1" />
            <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-[#f0f0f0]">Subdomain &amp; SAN Reconnaissance Idle</h3>
            <p className="max-w-md mx-auto text-xs text-[#8c8c8c] font-mono leading-relaxed">
              No subdomains, SAN certificates, or Certificate Transparency (CT) logs have been queried.
            </p>
          </div>
        ) : groupedItems.length === 0 ? (
          <div className="p-12 text-center bg-[#141414] border-t border-[#383838] rounded-none text-[#8c8c8c] font-mono text-xs shadow-sm space-y-2">
            <Network className="w-10 h-10 text-[#737373] mx-auto mb-2" />
            <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-[#f0f0f0]">No Matching Subdomains</h3>
            <p className="text-xs text-[#8c8c8c] font-mono max-w-md mx-auto">
              {loadingCrt ? 'Currently querying crt.name Certificate Transparency logs...' : `Target apex: ${targetApex || effectiveDomain}`}
            </p>
          </div>
        ) : (
          <div className="p-4 bg-[#141414] space-y-3">
          {groupedItems.map((group) => {
            const isExpanded = !!expandedHosts[group.hostname];
            const isCollapsed = !isExpanded;
            const probe = probedHosts[group.hostname];

            return (
              <div
                key={group.hostname}
                className="bg-[#141414] border border-[#383838] rounded-none overflow-hidden transition-all shadow-sm"
              >
                {/* Header for Subdomain / SAN */}
                <div
                  onClick={() => toggleHostCollapse(group.hostname)}
                  className="px-4 py-3 bg-[#141414] border-b border-[#383838] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 cursor-pointer hover:bg-[#1a1a1a] transition-colors select-none"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
                    <button type="button" className="text-[#8c8c8c]">
                      {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4 text-[#c30800]" />}
                    </button>

                    {group.isCrt ? (
                      <Globe className="w-4 h-4 text-[#c30800] shrink-0" title="Discovered via crt.name CT Logs" />
                    ) : (
                      <Network className="w-4 h-4 text-[#c30800] shrink-0" title="Subdomain of Target Domain" />
                    )}

                    <span className="font-mono text-sm font-bold text-[#f0f0f0] truncate">{group.hostname}</span>

                    {/* Discovery sources, probe status, and link counts as text separated by hyphens */}
                    {group.isCrt && (
                      <>
                        <span className="text-[#737373] text-[11px] select-none">-</span>
                        <span className="text-[11px] font-mono text-[#8c8c8c]">crt.name</span>
                      </>
                    )}

                    {probe && (
                      <>
                        <span className="text-[#737373] text-[11px] select-none">-</span>
                        <span
                          className={`text-[11px] font-mono font-semibold ${
                            probe.dnsResolves ? 'text-[#bbc300]' : 'text-[#c3005a]'
                          }`}
                          title={
                            probe.error ||
                            (probe.dnsResolves
                              ? `Resolved: ${probe.ip || (probe.cnames && probe.cnames[0]) || 'Active'} • Latency: ${probe.latencyMs}ms`
                              : 'NXDOMAIN / Unresolved')
                          }
                        >
                          {probe.dnsResolves ? 'DNS RESOLVED' : 'UNRESOLVED'}
                          {probe.latencyMs !== undefined ? ` (${probe.latencyMs}ms)` : ''}
                        </span>
                      </>
                    )}

                    <span className="text-[#737373] text-[11px] select-none">-</span>
                    <span className="text-[11px] font-mono text-[#8c8c8c] shrink-0">
                      {group.links.length} {group.links.length === 1 ? 'URL' : 'URLs'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 font-mono text-[10px] text-[#8c8c8c] shrink-0 self-end sm:self-auto flex-wrap">
                    {/* Copy URLs or Hostname */}
                    <button
                      type="button"
                      title="Copy hostname"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopy(group.hostname, `copy_host_${group.hostname}`);
                      }}
                      className="p-1 hover:text-[#f0f0f0] transition-colors"
                    >
                      {copiedKey === `copy_host_${group.hostname}` ? (
                        <Check className="w-3 h-3 text-[#c30800]" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Subdomain Content Links / CT Log Details */}
                {!isCollapsed && (
                  <div>
                    {group.links.length === 0 ? (
                      <div className="p-4 text-xs font-mono text-[#8c8c8c] bg-[#141414] border border-[#2e2e2e] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[#f0f0f0] font-bold">
                              {group.isCrt ? 'Discovered via crt.name CT logs' : 'Registered in TLS Certificate SANs'}
                            </span>
                            {probe?.ip && (
                              <span className="text-[#c30800]">
                                (Resolved IP: <code className="text-[#f0f0f0]">{probe.ip}</code>)
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-[#8c8c8c]">
                            Host is cataloged in certificate transparency logs for {targetApex || effectiveDomain}. No direct HTML links were crawled yet.
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <a
                            href={`https://${group.hostname}`}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="px-2.5 py-1 bg-[#141414] hover:bg-[#262626] text-[#c30800] hover:text-[#f0f0f0] border border-[#2e2e2e] rounded-none flex items-center gap-1 font-bold"
                          >
                            <span>Visit</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </div>
                    ) : (
                      <div className="divide-y divide-[#2e2e2e] max-h-[520px] overflow-y-auto custom-scrollbar">
                        {group.links.map((link, idx) => {
                          const itemKey = `sub_${group.hostname}_${idx}`;
                          const isContextOpen = showAllContexts || expandedContexts[itemKey];
                          const htmlSnippet = link.htmlContext || getFallbackHtmlContext(link);

                          return (
                            <div key={`${link.url}_${idx}`} className="p-3 hover:bg-[#262626] transition-colors text-xs font-mono">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  {getCategoryIcon(link.isAssetOrFile, link.fileType)}
                                  <a
                                    href={link.url}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="text-[#f0f0f0] hover:text-[#c30800] truncate font-semibold hover:underline flex items-center gap-1"
                                  >
                                    <span className="truncate">{link.url}</span>
                                    <ExternalLink className="w-3 h-3 text-[#8c8c8c] shrink-0" />
                                  </a>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  {/* Toggle HTML Context Button */}
                                  <button
                                    type="button"
                                    title="Toggle HTML Context Preview"
                                    onClick={() => toggleContextExpanded(itemKey)}
                                    className={`px-2 py-1 rounded-none text-[11px] border flex items-center gap-1 transition-colors cursor-pointer ${
                                      isContextOpen
                                        ? 'bg-[#c30800]/20 border-[#c30800] text-[#c30800]'
                                        : 'bg-[#141414] border-[#2e2e2e] text-[#8c8c8c] hover:text-[#f0f0f0]'
                                    }`}
                                  >
                                    <Code2 className="w-3 h-3" />
                                    <span>HTML</span>
                                  </button>

                                  {/* Inspect Modal Button */}
                                  <button
                                    type="button"
                                    title="Inspect Context Details"
                                    onClick={() => setInspectLink(link)}
                                    className="p-1 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] transition-colors cursor-pointer"
                                  >
                                    <Eye className="w-3 h-3" />
                                  </button>

                                  {/* Copy Link URL */}
                                  <button
                                    type="button"
                                    title="Copy URL"
                                    onClick={() => handleCopy(link.url, `copy_${group.hostname}_${idx}`)}
                                    className="p-1 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] transition-colors cursor-pointer"
                                  >
                                    {copiedKey === `copy_${group.hostname}_${idx}` ? (
                                      <Check className="w-3 h-3 text-[#c30800]" />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                </div>
                              </div>

                              {/* Source Page & Link Text Details */}
                              <div className="mt-1 text-[10px] text-[#8c8c8c] flex items-center gap-2 flex-wrap">
                                <span className="uppercase tracking-wider shrink-0 text-[#8c8c8c]">Found on:</span>
                                <a
                                  href={link.foundOnUrl}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="text-[#8c8c8c] hover:text-[#f0f0f0] truncate hover:underline max-w-sm"
                                >
                                  {link.foundOnUrl}
                                </a>

                                {link.linkText && (
                                  <span className="text-[10px] text-[#8c8c8c] font-mono truncate max-w-xs normal-case">
                                    Text: "{link.linkText}"
                                  </span>
                                )}

                                {link.foundOnUrls && link.foundOnUrls.length > 1 && (
                                  <span className="text-[#c30800] shrink-0 font-semibold">
                                    (+{link.foundOnUrls.length - 1} other {link.foundOnUrls.length - 1 === 1 ? 'page' : 'pages'})
                                  </span>
                                )}
                              </div>

                              {/* Expandable HTML Context Preview Block */}
                              {isContextOpen && (
                                <div className="mt-2.5 p-2.5 bg-[#0d0d0d] border border-[#2e2e2e] rounded-none relative group">
                                  <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-[#1a1a1a] text-[10px] text-[#8c8c8c]">
                                    <div className="flex items-center gap-1.5">
                                      <FileCode className="w-3 h-3 text-[#c30800]" />
                                      <span className="text-[#f0f0f0] font-semibold">HTML Context Preview</span>
                                      <span className="text-[#8c8c8c]">(&lt;{link.tagType || 'a'}&gt; in source DOM)</span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleCopy(htmlSnippet, `code_${group.hostname}_${idx}`)}
                                      className="flex items-center gap-1 px-1.5 py-0.5 rounded-none text-[10px] bg-[#141414] hover:bg-[#262626] text-[#8c8c8c] hover:text-[#f0f0f0] transition-colors cursor-pointer border border-[#2e2e2e]"
                                      title="Copy raw HTML snippet"
                                    >
                                      {copiedKey === `code_${group.hostname}_${idx}` ? (
                                        <>
                                          <Check className="w-2.5 h-2.5 text-[#c30800]" />
                                          <span className="text-[#c30800]">Copied</span>
                                        </>
                                      ) : (
                                        <>
                                          <Copy className="w-2.5 h-2.5" />
                                          <span>Copy HTML</span>
                                        </>
                                      )}
                                    </button>
                                  </div>
                                  <HighlightedHtmlWithDomain
                                    code={htmlSnippet}
                                    targetDomain={targetApex || effectiveDomain}
                                    highlightHost={link.domain}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      </div>

      {/* Inspect Modal */}
      {inspectLink && (
        <div className="fixed inset-0 z-50 bg-[#000000]/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#141414] border border-[#383838] rounded-none max-w-2xl w-full p-5 space-y-4 shadow-2xl font-mono text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-[#383838]">
              <div className="flex items-center gap-2">
                <Network className="w-4 h-4 text-[#c30800]" />
                <h3 className="text-sm font-bold text-[#f0f0f0]">Subdomain &amp; SAN Reference Details</h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectLink(null)}
                className="p-1 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5">
              <div className="bg-[#141414] p-3 rounded-none border border-[#2e2e2e] space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-[#8c8c8c]">Target Subdomain / Host:</span>
                  <span className="text-[#f0f0f0] font-bold">{inspectLink.domain}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8c8c8c]">Apex Root Domain:</span>
                  <span className="text-[#c30800] font-bold">{inspectLink.rootDomain || extractApexDomain(inspectLink.domain)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8c8c8c]">Category:</span>
                  <span className="text-[#f0f0f0]">{inspectLink.isAssetOrFile ? inspectLink.fileType || 'Asset' : 'Web Page'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8c8c8c]">HTML Element Tag:</span>
                  <span className="text-[#f0f0f0]">&lt;{inspectLink.tagType || 'a'}&gt;</span>
                </div>
              </div>

              <div>
                <span className="text-[#8c8c8c] text-[11px] block mb-1">Target URL:</span>
                <div className="p-2 bg-[#141414] border border-[#2e2e2e] rounded-none text-[#f0f0f0] break-all select-all">
                  {inspectLink.url}
                </div>
              </div>

              <div>
                <span className="text-[#8c8c8c] text-[11px] block mb-1">Referring Page:</span>
                <div className="p-2 bg-[#141414] border border-[#2e2e2e] rounded-none text-[#8c8c8c] break-all select-all">
                  {inspectLink.foundOnUrl}
                </div>
              </div>

              <div>
                <span className="text-[#8c8c8c] text-[11px] block mb-1 font-semibold">
                  Source HTML Snippet:
                </span>
                <div className="p-3 bg-[#0d0d0d] border border-[#2e2e2e] rounded-none max-h-48 overflow-y-auto custom-scrollbar">
                  <HighlightedHtmlWithDomain
                    code={inspectLink.htmlContext || getFallbackHtmlContext(inspectLink)}
                    targetDomain={targetApex || effectiveDomain}
                    highlightHost={inspectLink.domain}
                  />
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-[#383838] flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setInspectLink(null)}
                className="px-4 py-1.5 bg-[#141414] hover:bg-[#262626] text-[#f0f0f0] border border-[#383838] rounded-none text-xs transition-colors cursor-pointer"
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

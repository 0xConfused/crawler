// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { safeClampInput } from '../utils/urlUtils';
import { ExternalLinkRecord, FileCategory } from '../types';
import {
  ExternalLink,
  Globe,
  Search,
  Copy,
  Check,
  File,
  Image,
  Code,
  Music,
  Database,
  Archive,
  FileCode,
  FileText,
  Layers,
  Filter,
  FolderTree,
  ChevronRight,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Code2,
  Eye,
  X,
  FileTerminal,
  Network,
  GitFork,
} from 'lucide-react';
import { extractApexDomain } from '../utils/urlUtils';
import { HighlightedHtmlPreview } from './HighlightedHtmlPreview';

interface ExternalLinksViewProps {
  externalLinks: ExternalLinkRecord[];
  targetDomain?: string | null;
  onOpenWhois?: (domain: string) => void;
}

interface SubdomainSummary {
  subdomain: string; 
  subdomainPrefix: string; 
  links: ExternalLinkRecord[];
  assetCount: number;
  pageCount: number;
}

interface ApexDomainGroup {
  rootDomain: string; 
  totalLinks: number;
  assetCount: number;
  pageCount: number;
  subdomains: SubdomainSummary[];
  allLinks: ExternalLinkRecord[];
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

const HighlightedHtmlCode = HighlightedHtmlPreview;

export const ExternalLinksView: React.FC<ExternalLinksViewProps> = ({
  externalLinks,
  targetDomain,
  onOpenWhois: _onOpenWhois,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilterDomain, setSelectedFilterDomain] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'pages' | 'assets' | FileCategory>('all');
  const [viewMode, setViewMode] = useState<'grouped-apex' | 'grouped-flat' | 'table'>('grouped-apex');

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [expandedRoots, setExpandedRoots] = useState<Record<string, boolean>>({});
  const [expandedFlatHosts, setExpandedFlatHosts] = useState<Record<string, boolean>>({});
  const [activeSubdomainInCard, setActiveSubdomainInCard] = useState<Record<string, string>>({}); 
  
  const [expandedContexts, setExpandedContexts] = useState<Record<string, boolean>>({});
  const [showAllContexts, setShowAllContexts] = useState<boolean>(false);

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

  const enrichedLinks = useMemo(() => {
    return externalLinks.map((l) => {
      const root = l.rootDomain || extractApexDomain(l.domain) || l.domain;
      return {
        ...l,
        rootDomain: root,
      };
    });
  }, [externalLinks]);

  const apexGroupStats = useMemo(() => {
    const rootMap = new Map<string, {
      subdomainMap: Map<string, ExternalLinkRecord[]>;
      allLinks: ExternalLinkRecord[];
      assetCount: number;
      pageCount: number;
    }>();

    for (const link of enrichedLinks) {
      const root = link.rootDomain || link.domain;
      const exactDomain = link.domain;

      let rootEntry = rootMap.get(root);
      if (!rootEntry) {
        rootEntry = {
          subdomainMap: new Map<string, ExternalLinkRecord[]>(),
          allLinks: [],
          assetCount: 0,
          pageCount: 0,
        };
        rootMap.set(root, rootEntry);
      }

      rootEntry.allLinks.push(link);
      if (link.isAssetOrFile) {
        rootEntry.assetCount++;
      } else {
        rootEntry.pageCount++;
      }

      let subList = rootEntry.subdomainMap.get(exactDomain);
      if (!subList) {
        subList = [];
        rootEntry.subdomainMap.set(exactDomain, subList);
      }
      subList.push(link);
    }

    const apexGroups: ApexDomainGroup[] = [];
    let totalSubdomainsCount = 0;

    for (const [rootDomain, data] of rootMap.entries()) {
      const subdomains: SubdomainSummary[] = [];

      for (const [subdomain, links] of data.subdomainMap.entries()) {
        totalSubdomainsCount++;
        const assetCount = links.filter((l) => l.isAssetOrFile).length;
        const pageCount = links.length - assetCount;
        
        let prefix = subdomain;
        if (subdomain === rootDomain) {
          prefix = '@ (apex)';
        } else if (subdomain.endsWith('.' + rootDomain)) {
          prefix = subdomain.slice(0, -(rootDomain.length + 1));
        }

        subdomains.push({
          subdomain,
          subdomainPrefix: prefix,
          links,
          assetCount,
          pageCount,
        });
      }

      subdomains.sort((a, b) => {
        if (a.subdomain === rootDomain) return -1;
        if (b.subdomain === rootDomain) return 1;
        return b.links.length - a.links.length;
      });

      apexGroups.push({
        rootDomain,
        totalLinks: data.allLinks.length,
        assetCount: data.assetCount,
        pageCount: data.pageCount,
        subdomains,
        allLinks: data.allLinks,
      });
    }

    apexGroups.sort((a, b) => b.totalLinks - a.totalLinks);

    return {
      apexGroups,
      totalApexCount: apexGroups.length,
      totalSubdomainsCount,
    };
  }, [enrichedLinks]);

  const filteredLinks = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return enrichedLinks.filter((item) => {
      if (selectedFilterDomain !== 'all') {
        if (selectedFilterDomain.startsWith('root:')) {
          const rootTarget = selectedFilterDomain.replace('root:', '');
          if (item.rootDomain !== rootTarget) return false;
        } else if (selectedFilterDomain.startsWith('sub:')) {
          const subTarget = selectedFilterDomain.replace('sub:', '');
          if (item.domain !== subTarget) return false;
        } else if (item.domain !== selectedFilterDomain && item.rootDomain !== selectedFilterDomain) {
          return false;
        }
      }

      if (typeFilter === 'pages') {
        if (item.isAssetOrFile) return false;
      } else if (typeFilter === 'assets') {
        if (!item.isAssetOrFile) return false;
      } else if (typeFilter !== 'all') {
        if (item.fileType !== typeFilter) return false;
      }

      if (q) {
        const matchesUrl = item.url.toLowerCase().includes(q);
        const matchesDomain = item.domain.toLowerCase().includes(q);
        const matchesRoot = item.rootDomain?.toLowerCase().includes(q);
        const matchesSource = item.foundOnUrl.toLowerCase().includes(q);
        const matchesExt = item.extension?.toLowerCase().includes(q);
        const matchesContext = item.htmlContext?.toLowerCase().includes(q);
        const matchesText = item.linkText?.toLowerCase().includes(q);
        if (!matchesUrl && !matchesDomain && !matchesRoot && !matchesSource && !matchesExt && !matchesContext && !matchesText) {
          return false;
        }
      }

      return true;
    });
  }, [enrichedLinks, selectedFilterDomain, typeFilter, searchQuery]);

  const filteredApexGroups = useMemo(() => {
    const rootMap = new Map<string, {
      subdomainMap: Map<string, ExternalLinkRecord[]>;
      allLinks: ExternalLinkRecord[];
      assetCount: number;
      pageCount: number;
    }>();

    for (const link of filteredLinks) {
      const root = link.rootDomain || link.domain;
      const exactDomain = link.domain;

      let rootEntry = rootMap.get(root);
      if (!rootEntry) {
        rootEntry = {
          subdomainMap: new Map<string, ExternalLinkRecord[]>(),
          allLinks: [],
          assetCount: 0,
          pageCount: 0,
        };
        rootMap.set(root, rootEntry);
      }

      rootEntry.allLinks.push(link);
      if (link.isAssetOrFile) {
        rootEntry.assetCount++;
      } else {
        rootEntry.pageCount++;
      }

      let subList = rootEntry.subdomainMap.get(exactDomain);
      if (!subList) {
        subList = [];
        rootEntry.subdomainMap.set(exactDomain, subList);
      }
      subList.push(link);
    }

    const groups: ApexDomainGroup[] = [];

    for (const [rootDomain, data] of rootMap.entries()) {
      const subdomains: SubdomainSummary[] = [];

      for (const [subdomain, links] of data.subdomainMap.entries()) {
        const assetCount = links.filter((l) => l.isAssetOrFile).length;
        const pageCount = links.length - assetCount;

        let prefix = subdomain;
        if (subdomain === rootDomain) {
          prefix = '@ (apex)';
        } else if (subdomain.endsWith('.' + rootDomain)) {
          prefix = subdomain.slice(0, -(rootDomain.length + 1));
        }

        subdomains.push({
          subdomain,
          subdomainPrefix: prefix,
          links,
          assetCount,
          pageCount,
        });
      }

      subdomains.sort((a, b) => {
        if (a.subdomain === rootDomain) return -1;
        if (b.subdomain === rootDomain) return 1;
        return b.links.length - a.links.length;
      });

      groups.push({
        rootDomain,
        totalLinks: data.allLinks.length,
        assetCount: data.assetCount,
        pageCount: data.pageCount,
        subdomains,
        allLinks: data.allLinks,
      });
    }

    return groups.sort((a, b) => b.totalLinks - a.totalLinks);
  }, [filteredLinks]);

  const filteredFlatDomainGroups = useMemo(() => {
    const map = new Map<string, ExternalLinkRecord[]>();
    for (const link of filteredLinks) {
      const list = map.get(link.domain) || [];
      list.push(link);
      map.set(link.domain, list);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [filteredLinks]);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const toggleRootCollapse = (rootDomain: string) => {
    setExpandedRoots((prev) => ({ ...prev, [rootDomain]: !prev[rootDomain] }));
  };

  const toggleFlatHostCollapse = (domain: string) => {
    setExpandedFlatHosts((prev) => ({ ...prev, [domain]: !prev[domain] }));
  };

  const allExpanded = useMemo(() => {
    if (viewMode === 'grouped-apex') {
      if (filteredApexGroups.length === 0) return false;
      return filteredApexGroups.every((g) => !!expandedRoots[g.rootDomain]);
    } else if (viewMode === 'grouped-flat') {
      if (filteredFlatDomainGroups.length === 0) return false;
      return filteredFlatDomainGroups.every(([domain]) => !!expandedFlatHosts[domain]);
    }
    return false;
  }, [viewMode, filteredApexGroups, filteredFlatDomainGroups, expandedRoots, expandedFlatHosts]);

  const toggleCollapseAll = () => {
    if (viewMode === 'grouped-apex') {
      if (allExpanded) {
        setExpandedRoots({});
      } else {
        const next: Record<string, boolean> = {};
        filteredApexGroups.forEach((g) => {
          next[g.rootDomain] = true;
        });
        setExpandedRoots(next);
      }
    } else if (viewMode === 'grouped-flat') {
      if (allExpanded) {
        setExpandedFlatHosts({});
      } else {
        const next: Record<string, boolean> = {};
        filteredFlatDomainGroups.forEach(([domain]) => {
          next[domain] = true;
        });
        setExpandedFlatHosts(next);
      }
    }
  };

  const setCardSubdomainFilter = (rootDomain: string, subdomain: string) => {
    setActiveSubdomainInCard((prev) => ({
      ...prev,
      [rootDomain]: prev[rootDomain] === subdomain ? 'all' : subdomain,
    }));
  };

  const toggleContextExpanded = (key: string) => {
    setExpandedContexts((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const totalAssetsCount = externalLinks.filter((l) => l.isAssetOrFile).length;
  const totalPagesCount = externalLinks.length - totalAssetsCount;

  return (
    <div id="external-links-container" className="space-y-4">
      {/* Overview Stat Cards with Subdomain Counts */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 font-mono">
        <div className="p-3.5 rounded-none bg-[#141414] border border-[#383838] shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider font-semibold">Total Outbound Links</span>
            <ExternalLink className="w-3.5 h-3.5 text-[#c30800]" />
          </div>
          <p className="text-xl font-bold text-[#f0f0f0] mt-0.5">{externalLinks.length}</p>
        </div>
        <div className="p-3.5 rounded-none bg-[#141414] border border-[#383838] shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider font-semibold">Root Sites</span>
            <Globe className="w-3.5 h-3.5 text-[#c30800]" />
          </div>
          <p className="text-xl font-bold text-[#f0f0f0] mt-0.5">{apexGroupStats.totalApexCount}</p>
        </div>
        <div className="p-3.5 rounded-none bg-[#141414] border border-[#383838] shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider font-semibold">Subdomains</span>
            <Network className="w-3.5 h-3.5 text-[#c30800]" />
          </div>
          <p className="text-xl font-bold text-[#f0f0f0] mt-0.5">{apexGroupStats.totalSubdomainsCount}</p>
        </div>
        <div className="p-3.5 rounded-none bg-[#141414] border border-[#383838] shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider font-semibold">Files &amp; Assets</span>
            <FileCode className="w-3.5 h-3.5 text-[#c30800]" />
          </div>
          <p className="text-xl font-bold text-[#f0f0f0] mt-0.5">{totalAssetsCount}</p>
        </div>
        <div className="p-3.5 rounded-none bg-[#141414] border border-[#383838] shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider font-semibold">Web Pages</span>
            <Layers className="w-3.5 h-3.5 text-[#c30800]" />
          </div>
          <p className="text-xl font-bold text-[#f0f0f0] mt-0.5">{totalPagesCount}</p>
        </div>
      </div>

      {/* Main Standardized Section Card */}
      <div id="external-links-matrix-card" className="bg-[#141414] border border-[#383838] rounded-none overflow-visible flex flex-col shadow-md relative">
        <div className="h-[2px] w-full bg-gradient-to-r from-[#c30800] via-[#c300bb] to-[#bbc300]" />

        {/* Section Header */}
        <div className="px-6 py-4 bg-[#141414] backdrop-blur-sm bg-gradient-to-r from-[#c30800]/10 via-transparent to-transparent flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3 border-b border-[#383838]">
          <div className="flex items-center flex-wrap gap-2.5">
            <span className="w-2 h-2 bg-[#c30800] shrink-0" />
            <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-[#f0f0f0]">
              External Hyperlinks &amp; Asset Topology
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap" onClick={(e) => e.stopPropagation()}>
            {/* View Mode Toggle: Group Subdomains vs Flat vs Table */}
            <div className="flex items-center gap-1 font-mono text-xs bg-[#0d0d0d] p-0.5 rounded-none border border-[#383838] shrink-0">
              <button
                type="button"
                onClick={() => setViewMode('grouped-apex')}
                className={`px-2.5 py-1 rounded-none text-[10px] font-mono uppercase tracking-wider transition-colors cursor-pointer flex items-center gap-1.5 ${
                  viewMode === 'grouped-apex'
                    ? 'bg-[#1a1a1a] text-[#f0f0f0] font-semibold border border-[#c30800]'
                    : 'bg-[#141414] text-[#8c8c8c] hover:text-[#f0f0f0] border border-transparent'
                }`}
                title="Group external sites by parent Apex Domain with all subdomains nested together"
              >
                <Network className={`w-3.5 h-3.5 ${viewMode === 'grouped-apex' ? 'text-[#c30800]' : 'text-[#8c8c8c]'}`} />
                <span>Group Subdomains</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('grouped-flat')}
                className={`px-2.5 py-1 rounded-none text-[10px] font-mono uppercase tracking-wider transition-colors cursor-pointer flex items-center gap-1.5 ${
                  viewMode === 'grouped-flat'
                    ? 'bg-[#1a1a1a] text-[#f0f0f0] font-semibold border border-[#c30800]'
                    : 'bg-[#141414] text-[#8c8c8c] hover:text-[#f0f0f0] border border-transparent'
                }`}
                title="Show each exact host / subdomain separately"
              >
                <FolderTree className={`w-3.5 h-3.5 ${viewMode === 'grouped-flat' ? 'text-[#c30800]' : 'text-[#8c8c8c]'}`} />
                <span>Flat Hosts</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`px-2.5 py-1 rounded-none text-[10px] font-mono uppercase tracking-wider transition-colors cursor-pointer flex items-center gap-1.5 ${
                  viewMode === 'table'
                    ? 'bg-[#1a1a1a] text-[#f0f0f0] font-semibold border border-[#c30800]'
                    : 'bg-[#141414] text-[#8c8c8c] hover:text-[#f0f0f0] border border-transparent'
                }`}
              >
                <Layers className={`w-3.5 h-3.5 ${viewMode === 'table' ? 'text-[#c30800]' : 'text-[#8c8c8c]'}`} />
                <span>Table</span>
              </button>
            </div>

            {/* Collapse / Expand All Button (Grouped Views) */}
            {(viewMode === 'grouped-apex' || viewMode === 'grouped-flat') && (
              <button
                type="button"
                onClick={toggleCollapseAll}
                disabled={
                  viewMode === 'grouped-apex'
                    ? filteredApexGroups.length === 0
                    : filteredFlatDomainGroups.length === 0
                }
                className={`px-2.5 py-1 rounded-none font-mono text-[10px] uppercase tracking-wider border transition-colors cursor-pointer flex items-center gap-1.5 ${
                  !allExpanded
                    ? 'bg-[#141414] hover:bg-[#262626] border-[#383838] text-[#8c8c8c] hover:text-[#f0f0f0]'
                    : 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0] font-semibold'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
                title={allExpanded ? 'Collapse all domain groups' : 'Expand all domain groups'}
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
            )}

            {/* Toggle All HTML Contexts Button */}
            <button
              type="button"
              onClick={() => setShowAllContexts((prev) => !prev)}
              className={`px-2.5 py-1 rounded-none font-mono text-[10px] uppercase tracking-wider border transition-colors cursor-pointer flex items-center gap-1.5 ${
                showAllContexts
                  ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0] font-semibold'
                  : 'bg-[#141414] hover:bg-[#262626] border-[#383838] text-[#8c8c8c] hover:text-[#f0f0f0]'
              }`}
              title="Toggle expanded HTML context preview for all links"
            >
              <Code2 className={`w-3.5 h-3.5 ${showAllContexts ? 'text-[#c30800]' : 'text-[#8c8c8c]'}`} />
              <span className="hidden sm:inline">HTML Previews</span>
              <span className={showAllContexts ? 'tag tag-sm tag-accent-outline font-bold' : 'tag tag-sm tag-neutral font-bold'}>
                {showAllContexts ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>
        </div>


            {/* Filtering & Search Toolbar */}
        <div className="p-4 bg-[#141414] border-b border-[#383838] space-y-3">
          <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
            {/* Search Input */}
            <div className="relative flex-1 w-full min-w-0">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#8c8c8c]">
                <Search className="w-3.5 h-3.5" />
              </div>
              <input
                id="external-links-search-input"
                type="text"
                maxLength={200}
                placeholder="Search URL, root domain, subdomain, HTML snippet, or anchor text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(safeClampInput(e.target.value, 200))}
                className="w-full pl-9 pr-3 py-1.5 bg-[#0d0d0d] border border-[#383838] rounded-none font-mono text-xs text-[#f0f0f0] placeholder-[#737373] focus:outline-none focus:border-[#c30800]"
              />
            </div>

            {/* Subdomain-Aware Domain Filter Dropdown */}
            <div className="w-full md:w-72 shrink-0">
              <select
                value={selectedFilterDomain}
                onChange={(e) => setSelectedFilterDomain(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#141414] border border-[#2e2e2e] rounded-none font-mono text-xs text-[#8c8c8c] hover:border-[#383838] focus:border-[#c30800] cursor-pointer"
              >
                <option value="all">All Sites &amp; Subdomains ({externalLinks.length})</option>
                {apexGroupStats.apexGroups.map((group) => {
                  const hasMultipleSubdomains = group.subdomains.length > 1;
                  return (
                    <optgroup
                      key={group.rootDomain}
                      label={`${group.rootDomain} (${group.subdomains.length} ${group.subdomains.length === 1 ? 'host' : 'subdomains'} • ${group.totalLinks} links)`}
                    >
                      <option value={`root:${group.rootDomain}`}>
                         All {group.rootDomain} ({group.totalLinks})
                      </option>
                      {hasMultipleSubdomains &&
                        group.subdomains.map((sub) => (
                          <option key={sub.subdomain} value={`sub:${sub.subdomain}`}>
                            &nbsp;&nbsp;↳ {sub.subdomain} ({sub.links.length})
                          </option>
                        ))}
                    </optgroup>
                  );
                })}
              </select>
            </div>
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 flex-wrap font-mono text-[11px] pt-2 border-t border-[#2e2e2e]">
            <span className="text-[#8c8c8c] uppercase tracking-widest text-[10px] mr-1 flex items-center gap-1 font-bold">
              <Filter className="w-3 h-3 text-[#c30800]" /> Category:
            </span>

            <button
              type="button"
              onClick={() => setTypeFilter('all')}
              className={`px-2.5 py-0.5 rounded-none border transition-colors cursor-pointer flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${
                typeFilter === 'all'
                  ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0] font-semibold'
                  : 'bg-[#141414] border-[#2e2e2e] text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a] hover:border-[#383838]'
              }`}
            >
              <Layers className={`w-3 h-3 ${typeFilter === 'all' ? 'text-[#c30800]' : 'text-[#8c8c8c]'}`} />
              <span>All ({externalLinks.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setTypeFilter('pages')}
              className={`px-2.5 py-0.5 rounded-none border transition-colors cursor-pointer flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${
                typeFilter === 'pages'
                  ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0] font-semibold'
                  : 'bg-[#141414] border-[#2e2e2e] text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a] hover:border-[#383838]'
              }`}
            >
              <FileText className={`w-3 h-3 ${typeFilter === 'pages' ? 'text-[#c30800]' : 'text-[#8c8c8c]'}`} />
              <span>Web Pages ({totalPagesCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setTypeFilter('assets')}
              className={`px-2.5 py-0.5 rounded-none border transition-colors cursor-pointer flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${
                typeFilter === 'assets'
                  ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0] font-semibold'
                  : 'bg-[#141414] border-[#2e2e2e] text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a] hover:border-[#383838]'
              }`}
            >
              <FileCode className={`w-3 h-3 ${typeFilter === 'assets' ? 'text-[#c30800]' : 'text-[#8c8c8c]'}`} />
              <span>Files &amp; Assets ({totalAssetsCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setTypeFilter('script')}
              className={`px-2 py-0.5 rounded-none border transition-colors cursor-pointer flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider ${
                typeFilter === 'script'
                  ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0] font-semibold'
                  : 'bg-[#141414] border-[#2e2e2e] text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a] hover:border-[#383838]'
              }`}
            >
              <Code className={`w-3 h-3 ${typeFilter === 'script' ? 'text-[#c30800]' : 'text-[#8c8c8c]'}`} />
              <span>Scripts</span>
            </button>

            <button
              type="button"
              onClick={() => setTypeFilter('stylesheet')}
              className={`px-2 py-0.5 rounded-none border transition-colors cursor-pointer flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider ${
                typeFilter === 'stylesheet'
                  ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0] font-semibold'
                  : 'bg-[#141414] border-[#2e2e2e] text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a] hover:border-[#383838]'
              }`}
            >
              <FileCode className={`w-3 h-3 ${typeFilter === 'stylesheet' ? 'text-[#c30800]' : 'text-[#8c8c8c]'}`} />
              <span>Stylesheets</span>
            </button>

            <button
              type="button"
              onClick={() => setTypeFilter('image')}
              className={`px-2 py-0.5 rounded-none border transition-colors cursor-pointer flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider ${
                typeFilter === 'image'
                  ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0] font-semibold'
                  : 'bg-[#141414] border-[#2e2e2e] text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a] hover:border-[#383838]'
              }`}
            >
              <Image className={`w-3 h-3 ${typeFilter === 'image' ? 'text-[#c30800]' : 'text-[#8c8c8c]'}`} />
              <span>Images</span>
            </button>

            <button
              type="button"
              onClick={() => setTypeFilter('document')}
              className={`px-2 py-0.5 rounded-none border transition-colors cursor-pointer flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider ${
                typeFilter === 'document'
                  ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0] font-semibold'
                  : 'bg-[#141414] border-[#2e2e2e] text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a] hover:border-[#383838]'
              }`}
            >
              <FileText className={`w-3 h-3 ${typeFilter === 'document' ? 'text-[#c30800]' : 'text-[#8c8c8c]'}`} />
              <span>Documents</span>
            </button>
          </div>
        </div>

        {/* Main Results Container */}
        {filteredLinks.length === 0 ? (
          <div className="p-12 text-center bg-[#141414] border-t border-[#383838] rounded-none text-[#8c8c8c] font-mono text-xs shadow-sm space-y-2">
            {externalLinks.length === 0 ? (
              <div>
                <Globe className="w-10 h-10 text-[#737373] mx-auto mb-3" />
                <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-[#f0f0f0]">No Outbound Links Found</h3>
                <p className="text-xs text-[#8c8c8c] font-mono max-w-md mx-auto mt-1">External URLs and subdomains referenced by crawled pages will populate here automatically with subdomains grouped.</p>
              </div>
            ) : (
              <div>
                <Filter className="w-10 h-10 text-[#737373] mx-auto mb-3" />
                <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-[#f0f0f0]">No Filter Matches</h3>
                <p className="text-xs text-[#8c8c8c] font-mono max-w-md mx-auto mt-1">No external links match the current query or filter criteria.</p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedFilterDomain('all');
                    setTypeFilter('all');
                  }}
                  className="mt-3 px-3 py-1 bg-[#141414] hover:bg-[#262626] border border-[#383838] text-[#c30800] hover:text-[#f60a00] font-mono text-xs uppercase tracking-wider cursor-pointer"
                >
                  Clear all filters
                </button>
              </div>
            )}
          </div>
        ) : viewMode === 'grouped-apex' ? (
          <div className="p-4 bg-[#141414] space-y-3">
          {filteredApexGroups.map((group) => {
            const isExpanded = !!expandedRoots[group.rootDomain];
            const isCollapsed = !isExpanded;
            const activeSub = activeSubdomainInCard[group.rootDomain] || 'all';

            const displayedLinks = activeSub === 'all'
              ? group.allLinks
              : group.allLinks.filter((l) => l.domain === activeSub);

            const hasMultipleSubdomains = group.subdomains.length > 1;

            return (
              <div
                key={group.rootDomain}
                className="bg-[#141414] border border-[#383838] rounded-none overflow-hidden transition-all shadow-sm"
              >
                {/* Apex Domain Header */}
                <div
                  onClick={() => toggleRootCollapse(group.rootDomain)}
                  className="px-4 py-3 bg-[#141414] border-b border-[#383838] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 cursor-pointer hover:bg-[#1a1a1a] transition-colors select-none"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
                    <button type="button" className="text-[#8c8c8c]">
                      {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4 text-[#c30800]" />}
                    </button>
                    <Globe className="w-4 h-4 text-[#c30800] shrink-0" />
                    <span className="font-mono text-sm font-bold text-[#f0f0f0] truncate">{group.rootDomain}</span>
                    
                    {/* Subdomains Count */}
                    <span className="text-[11px] font-mono text-[#8c8c8c] flex items-center gap-1">
                      <Network className="w-3 h-3 text-[#c30800]" />
                      <span>{group.subdomains.length} {group.subdomains.length === 1 ? 'host' : 'subdomains'}</span>
                    </span>

                    {/* Total Links */}
                    <span className="text-[11px] font-mono text-[#8c8c8c] shrink-0">
                      {group.totalLinks} {group.totalLinks === 1 ? 'link' : 'links'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 font-mono text-[10px] text-[#8c8c8c] shrink-0 self-end sm:self-auto">
                    {group.pageCount > 0 && <span>{group.pageCount} pages</span>}
                    {group.pageCount > 0 && group.assetCount > 0 && <span>•</span>}
                    {group.assetCount > 0 && <span className="text-[#f0f0f0]">{group.assetCount} files/assets</span>}
                    
                    {/* Copy all URLs from this root domain */}
                    <button
                      type="button"
                      title="Copy all links in this domain"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopy(group.allLinks.map((l) => l.url).join('\n'), `copy_all_${group.rootDomain}`);
                      }}
                      className="p-1 hover:text-[#f0f0f0] transition-colors ml-1"
                    >
                      {copiedKey === `copy_all_${group.rootDomain}` ? (
                        <Check className="w-3 h-3 text-[#c30800]" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Subdomain Filter Chips & Links List */}
                {!isCollapsed && (
                  <div>
                    {/* Subdomains Bar inside card if more than 1 subdomain exists */}
                    {hasMultipleSubdomains && (
                      <div className="px-4 py-2 bg-[#141414] border-b border-[#2e2e2e] flex items-center gap-1.5 flex-wrap font-mono text-xs">
                        <span className="text-[10px] text-[#8c8c8c] uppercase tracking-wider mr-1 flex items-center gap-1">
                          <GitFork className="w-3 h-3 text-[#bbc300]" /> Subdomains:
                        </span>
                        
                        <button
                          type="button"
                          onClick={() => setCardSubdomainFilter(group.rootDomain, 'all')}
                          className={`px-2 py-0.5 rounded-none text-[10px] font-mono border transition-colors cursor-pointer ${
                            activeSub === 'all'
                              ? 'bg-[#1a1a1a] text-[#f0f0f0] font-semibold border-[#c30800]'
                              : 'bg-[#141414] text-[#8c8c8c] hover:text-[#f0f0f0] border-[#2e2e2e]'
                          }`}
                        >
                          All Subdomains ({group.totalLinks})
                        </button>

                        {group.subdomains.map((sub) => {
                          const isActive = activeSub === sub.subdomain;
                          return (
                            <button
                              key={sub.subdomain}
                              type="button"
                              onClick={() => setCardSubdomainFilter(group.rootDomain, sub.subdomain)}
                              className={`px-2 py-0.5 rounded-none text-[10px] font-mono border transition-colors cursor-pointer flex items-center gap-1 ${
                                isActive
                                  ? 'bg-[#1a1a1a] text-[#f0f0f0] font-semibold border-[#c30800]'
                                  : 'bg-[#141414] text-[#8c8c8c] hover:text-[#f0f0f0] border-[#2e2e2e]'
                              }`}
                            >
                              <span className="font-semibold">{sub.subdomain}</span>
                              <span className="text-[10px] text-[#8c8c8c] ml-1">
                                ({sub.links.length})
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Links Content */}
                    <div className="divide-y divide-[#2e2e2e] max-h-[520px] overflow-y-auto custom-scrollbar">
                      {displayedLinks.map((link, idx) => {
                        const itemKey = `item_${group.rootDomain}_${link.domain}_${idx}`;
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
                                  title="Copy Outbound URL"
                                  onClick={() => handleCopy(link.url, `copy_${group.rootDomain}_${idx}`)}
                                  className="p-1 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] transition-colors cursor-pointer"
                                >
                                  {copiedKey === `copy_${group.rootDomain}_${idx}` ? (
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

                              {link.foundOnUrls && link.foundOnUrls.length > 1 && (
                                <span className="text-[#c30800] shrink-0">
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
                                    <span className="text-[#8c8c8c]">(&lt;{link.tagType || 'a'}&gt; element in page DOM)</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleCopy(htmlSnippet, `code_${group.rootDomain}_${idx}`)}
                                    className="flex items-center gap-1 px-1.5 py-0.5 rounded-none text-[10px] bg-[#141414] hover:bg-[#262626] text-[#8c8c8c] hover:text-[#f0f0f0] transition-colors cursor-pointer border border-[#2e2e2e]"
                                    title="Copy raw HTML snippet"
                                  >
                                    {copiedKey === `code_${group.rootDomain}_${idx}` ? (
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
                                <HighlightedHtmlCode
                                  code={htmlSnippet}
                                  highlightHost={link.domain}
                                  targetDomain={targetDomain}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : viewMode === 'grouped-flat' ? (
        <div className="p-4 bg-[#141414] space-y-3">
          {filteredFlatDomainGroups.map(([domain, links]) => {
            const isExpanded = !!expandedFlatHosts[domain];
            const isCollapsed = !isExpanded;
            const assetCount = links.filter((l) => l.isAssetOrFile).length;
            const pageCount = links.length - assetCount;

            return (
              <div
                key={domain}
                className="bg-[#141414] border border-[#383838] rounded-none overflow-hidden transition-all shadow-sm"
              >
                <div
                  onClick={() => toggleFlatHostCollapse(domain)}
                  className="px-4 py-3 bg-[#141414] border-b border-[#383838] flex items-center justify-between cursor-pointer hover:bg-[#1a1a1a] transition-colors select-none"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <button type="button" className="text-[#8c8c8c]">
                      {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4 text-[#c30800]" />}
                    </button>
                    <Globe className="w-4 h-4 text-[#c30800] shrink-0" />
                    <span className="font-mono text-sm font-semibold text-[#f0f0f0] truncate">{domain}</span>
                    <span className="text-[11px] font-mono text-[#8c8c8c] shrink-0">
                      {links.length} {links.length === 1 ? 'link' : 'links'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 font-mono text-[10px] text-[#8c8c8c] shrink-0">
                    {pageCount > 0 && <span>{pageCount} pages</span>}
                    {pageCount > 0 && assetCount > 0 && <span>•</span>}
                    {assetCount > 0 && <span className="text-[#f0f0f0]">{assetCount} files/assets</span>}
                  </div>
                </div>

                {!isCollapsed && (
                  <div className="divide-y divide-[#2e2e2e] max-h-[520px] overflow-y-auto custom-scrollbar">
                    {links.map((link, idx) => {
                      const itemKey = `flat_${domain}_${idx}`;
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
                              <button
                                type="button"
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

                              <button
                                type="button"
                                onClick={() => setInspectLink(link)}
                                className="p-1 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] transition-colors cursor-pointer"
                              >
                                <Eye className="w-3 h-3" />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleCopy(link.url, `copy_flat_${domain}_${idx}`)}
                                className="p-1 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] transition-colors cursor-pointer"
                              >
                                {copiedKey === `copy_flat_${domain}_${idx}` ? (
                                  <Check className="w-3 h-3 text-[#c30800]" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                          </div>

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
                          </div>

                          {isContextOpen && (
                            <div className="mt-2.5 p-2.5 bg-[#0d0d0d] border border-[#2e2e2e] rounded-none relative group">
                              <HighlightedHtmlCode
                                code={htmlSnippet}
                                highlightHost={link.domain}
                                targetDomain={targetDomain}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-[#141414] border border-[#383838] rounded-none overflow-hidden shadow-sm relative">
          <div className="overflow-auto max-h-[calc(100vh-260px)] min-h-[460px] custom-scrollbar relative">
            <table className="w-full text-left border-collapse font-mono text-xs">
              <thead className="sticky top-0 z-20 bg-[#141414] shadow-sm">
                <tr className="border-b border-[#383838] bg-[#141414] text-[10px] text-[#8c8c8c] uppercase tracking-wider">
                  <th className="sticky top-0 z-20 bg-[#141414] border-b border-[#383838] py-2.5 px-4 font-semibold whitespace-nowrap">External Target URL</th>
                  <th className="sticky top-0 z-20 bg-[#141414] border-b border-[#383838] py-2.5 px-3 font-semibold whitespace-nowrap">Root Site</th>
                  <th className="sticky top-0 z-20 bg-[#141414] border-b border-[#383838] py-2.5 px-3 font-semibold whitespace-nowrap">Subdomain</th>
                  <th className="sticky top-0 z-20 bg-[#141414] border-b border-[#383838] py-2.5 px-3 font-semibold whitespace-nowrap">Type</th>
                  <th className="sticky top-0 z-20 bg-[#141414] border-b border-[#383838] py-2.5 px-3 font-semibold whitespace-nowrap">Tag</th>
                  <th className="sticky top-0 z-20 bg-[#141414] border-b border-[#383838] py-2.5 px-4 font-semibold whitespace-nowrap">HTML Context Preview</th>
                  <th className="sticky top-0 z-20 bg-[#141414] border-b border-[#383838] py-2.5 px-4 font-semibold whitespace-nowrap">Discovered On Page</th>
                  <th className="sticky top-0 z-20 bg-[#141414] border-b border-[#383838] py-2.5 px-3 text-right font-semibold whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2e2e2e]">
                {filteredLinks.map((link, idx) => {
                  const itemKey = `flat_${link.url}_${idx}`;
                  const isContextOpen = showAllContexts || expandedContexts[itemKey];
                  const htmlSnippet = link.htmlContext || getFallbackHtmlContext(link);


                  return (
                    <React.Fragment key={`row_${link.url}_${idx}`}>
                      <tr className="hover:bg-[#262626] transition-colors">
                        <td className="py-2.5 px-4 max-w-xs sm:max-w-sm truncate">
                          <div className="flex items-center gap-2">
                            {getCategoryIcon(link.isAssetOrFile, link.fileType)}
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="text-[#f0f0f0] hover:text-[#c30800] truncate font-medium hover:underline flex items-center gap-1"
                            >
                              <span className="truncate">{link.url}</span>
                              <ExternalLink className="w-2.5 h-2.5 text-[#8c8c8c] shrink-0" />
                            </a>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-[#f0f0f0] truncate font-semibold">
                          {link.rootDomain || link.domain}
                        </td>
                        <td className="py-2.5 px-3 text-[#c30800] truncate font-mono text-[11px] font-bold">
                          {link.domain}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="text-xs font-mono text-[#8c8c8c] lowercase">
                            {link.isAssetOrFile ? (link.fileType || 'asset').toLowerCase() : 'page'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[#8c8c8c] text-[10px]">
                          &lt;{link.tagType || 'a'}&gt;
                        </td>
                        <td className="py-2.5 px-4 max-w-xs truncate">
                          <div
                            onClick={() => setInspectLink(link)}
                            className="bg-[#0d0d0d] border border-[#2e2e2e] px-2 py-1 rounded-none text-[10px] text-[#c30800] truncate cursor-pointer hover:border-[#c30800] transition-colors flex items-center justify-between gap-1 group"
                            title="Click to view full HTML context"
                          >
                            <span className="truncate font-mono text-[#c30800]">{htmlSnippet}</span>
                            <Eye className="w-2.5 h-2.5 text-[#8c8c8c] group-hover:text-[#c30800] shrink-0" />
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-[#8c8c8c] text-[11px] max-w-xs truncate">
                          <a
                            href={link.foundOnUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="hover:text-[#f0f0f0] truncate hover:underline"
                          >
                            {link.foundOnUrl}
                          </a>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              title="Toggle Context Preview Row"
                              onClick={() => toggleContextExpanded(itemKey)}
                              className={`p-1 rounded-none transition-colors cursor-pointer ${
                                isContextOpen
                                  ? 'bg-[#c30800]/20 text-[#c30800]'
                                  : 'text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626]'
                              }`}
                            >
                              <Code2 className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              title="Inspect Full Context"
                              onClick={() => setInspectLink(link)}
                              className="p-1 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] transition-colors cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              title="Copy URL"
                              onClick={() => handleCopy(link.url, `flat_copy_${idx}`)}
                              className="p-1 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] transition-colors cursor-pointer"
                            >
                              {copiedKey === `flat_copy_${idx}` ? (
                                <Check className="w-3.5 h-3.5 text-[#c30800]" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {isContextOpen && (
                        <tr className="bg-[#141414]">
                          <td colSpan={8} className="px-4 py-2.5 border-t border-[#2e2e2e]">
                            <div className="bg-[#0d0d0d] border border-[#2e2e2e] rounded-none p-2.5">
                              <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-[#1a1a1a] text-[10px] text-[#8c8c8c]">
                                <div className="flex items-center gap-1.5">
                                  <FileCode className="w-3 h-3 text-[#c30800]" />
                                  <span className="text-[#f0f0f0] font-semibold">HTML Context Preview</span>
                                  <span>(&lt;{link.tagType || 'a'}&gt; tag found in source)</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleCopy(htmlSnippet, `flat_code_${idx}`)}
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-none text-[10px] bg-[#141414] hover:bg-[#262626] text-[#8c8c8c] hover:text-[#f0f0f0] transition-colors cursor-pointer border border-[#2e2e2e]"
                                >
                                  {copiedKey === `flat_code_${idx}` ? (
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
                              <HighlightedHtmlCode
                                code={htmlSnippet}
                                highlightHost={link.domain}
                                targetDomain={targetDomain}
                              />
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      </div>

      {/* Full Modal for HTML Context Deep Inspection */}
      {inspectLink && (
        <div
          id="context-preview-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
          onClick={() => setInspectLink(null)}
        >
          <div
            className="bg-[#141414] border border-[#383838] rounded-none shadow-2xl w-full max-w-2xl overflow-hidden font-mono text-xs flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-4 py-3 bg-[#141414] border-b border-[#383838] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileTerminal className="w-4 h-4 text-[#c30800]" />
                <span className="font-semibold text-sm text-[#f0f0f0]">HTML Context Inspector</span>
              </div>
              <button
                type="button"
                onClick={() => setInspectLink(null)}
                className="p-1 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-4 overflow-y-auto custom-scrollbar">
              {/* Target Outbound Link */}
              <div>
                <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider block mb-1">Target External URL</span>
                <div className="flex items-center justify-between p-2.5 bg-[#0d0d0d] border border-[#2e2e2e] rounded-none">
                  <span className="text-[#f0f0f0] font-semibold truncate flex-1 mr-2">{inspectLink.url}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleCopy(inspectLink.url, 'modal_url_copy')}
                      className="px-2 py-1 rounded-none text-[10px] bg-[#141414] hover:bg-[#262626] text-[#8c8c8c] hover:text-[#f0f0f0] border border-[#2e2e2e] flex items-center gap-1 cursor-pointer"
                    >
                      {copiedKey === 'modal_url_copy' ? <Check className="w-3 h-3 text-[#c30800]" /> : <Copy className="w-3 h-3" />}
                      <span>Copy</span>
                    </button>
                    <a
                      href={inspectLink.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="p-1 rounded-none text-[#8c8c8c] hover:text-[#c30800] hover:bg-[#262626]"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              </div>

              {/* Apex & Subdomain Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 bg-[#141414] border border-[#2e2e2e] rounded-none">
                  <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider block mb-1">Root / Apex Site</span>
                  <span className="text-[#f0f0f0] font-semibold text-sm">{inspectLink.rootDomain || inspectLink.domain}</span>
                </div>
                <div className="p-3 bg-[#141414] border border-[#2e2e2e] rounded-none">
                  <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider block mb-1">Subdomain / Hostname</span>
                  <span className="text-[#bbc300] font-semibold text-sm">{inspectLink.domain}</span>
                </div>
              </div>

              {/* HTML Snippet Code Display */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider">DOM HTML Snippet</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(inspectLink.htmlContext || getFallbackHtmlContext(inspectLink), 'modal_html_copy')}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-none text-[10px] bg-[#141414] hover:bg-[#262626] text-[#8c8c8c] hover:text-[#f0f0f0] border border-[#2e2e2e] cursor-pointer"
                  >
                    {copiedKey === 'modal_html_copy' ? (
                      <>
                        <Check className="w-3 h-3 text-[#c30800]" />
                        <span className="text-[#c30800]">Copied HTML</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy Snippet</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="p-3 bg-[#0d0d0d] border border-[#2e2e2e] rounded-none">
                  <HighlightedHtmlCode
                    code={inspectLink.htmlContext || getFallbackHtmlContext(inspectLink)}
                    highlightHost={inspectLink.domain}
                    targetDomain={targetDomain}
                  />
                </div>
              </div>

              {/* Source Document Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 bg-[#141414] border border-[#2e2e2e] rounded-none">
                  <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider block mb-1">Found In Document</span>
                  <a
                    href={inspectLink.foundOnUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[#f0f0f0] hover:text-[#c30800] truncate hover:underline block font-semibold text-[11px]"
                  >
                    {inspectLink.foundOnUrl}
                  </a>
                </div>

                <div className="p-3 bg-[#141414] border border-[#2e2e2e] rounded-none">
                  <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider block mb-1">Classification</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[#f0f0f0] font-semibold">
                      {inspectLink.isAssetOrFile ? `Static Asset (${inspectLink.fileType || 'Asset'})` : 'Outbound Web Page'}
                    </span>
                    {inspectLink.extension && (
                      <span className="text-xs text-[#8c8c8c] font-mono">
                        .{inspectLink.extension}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-3 bg-[#141414] border-t border-[#383838] flex justify-end">
              <button
                type="button"
                onClick={() => setInspectLink(null)}
                className="px-4 py-1.5 bg-[#c30800] hover:bg-[#f60a00] text-[#f3f3f7] font-mono font-bold rounded-none text-xs transition-colors cursor-pointer border border-[#c30800]"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  ArrowUpDown,
  Copy,
  Check,
  FileCode,
  Folder,
  FolderTree,
  ExternalLink,
  File,
  FileText,
  Image,
  Code,
  Music,
  Database,
  Archive,
  Globe,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Layers,
} from 'lucide-react';
import { DirectoryRecord, FileRecord, FileCategory } from '../types';
import { safeClampInput } from '../utils/urlUtils';

interface DirectoryTableViewProps {
  directories: DirectoryRecord[];
  files?: FileRecord[];
  targetOrigin: string;
  onSelectDirectory: (dir: DirectoryRecord) => void;
  onSelectFile?: (file: FileRecord) => void;
}

type ItemType = 'all' | 'dirs' | 'files';
type SortField = 'path' | 'type' | 'foundOn' | 'domain';
type SortOrder = 'asc' | 'desc';

interface TableUnifiedRow {
  kind: 'directory' | 'file';
  path: string;
  domain?: string;
  filename?: string;
  extension?: string;
  fileType?: FileCategory;
  depth: number;
  foundOnUrl: string;
  foundOnUrls: string[];
  fullUrl: string;
  directCount: number;
  nestedCount?: number;
  originalDir?: DirectoryRecord;
  originalFile?: FileRecord;
}

function getFileIcon(category?: FileCategory) {
  switch (category) {
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

export const DirectoryTableView: React.FC<DirectoryTableViewProps> = ({
  directories,
  files = [],
  targetOrigin,
  onSelectDirectory,
  onSelectFile,
}) => {
  const [search, setSearch] = useState('');

  const targetDomain = useMemo(() => {
    if (!targetOrigin) return '';
    try {
      let raw = targetOrigin.trim();
      if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
      return new URL(raw).hostname.toLowerCase().replace(/:\d+$/, '');
    } catch {
      return '';
    }
  }, [targetOrigin]);

  const availableSubdomains = useMemo(() => {
    const set = new Set<string>();
    directories.forEach((d) => {
      if (d.domain) set.add(d.domain);
    });
    files.forEach((f) => {
      if (f.domain) set.add(f.domain);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [directories, files]);

  const hasMultipleDomains = availableSubdomains.length > 1;

  const [selectedSubdomain, setSelectedSubdomain] = useState<string>('all');

  const prevTargetDomainRef = React.useRef(targetDomain);

  useEffect(() => {
    if (prevTargetDomainRef.current !== targetDomain) {
      prevTargetDomainRef.current = targetDomain;
      setSelectedSubdomain('all');
    }
  }, [targetDomain]);

  const [typeFilter, setTypeFilter] = useState<ItemType>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [depthFilter, setDepthFilter] = useState<number | 'all'>('all');
  const [sortField, setSortField] = useState<SortField>('path');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const availableDepths = useMemo(() => {
    const depths = new Set<number>();
    directories.forEach((d) => depths.add(d.depth));
    files.forEach((f) => depths.add(f.depth));
    return Array.from(depths).sort((a, b) => a - b);
  }, [directories, files]);

  const unifiedRows: TableUnifiedRow[] = useMemo(() => {
    const defaultOrigin = targetOrigin ? targetOrigin.replace(/\/+$/, '') : '';
    const dirRows: TableUnifiedRow[] = directories.map((d) => {
      const dirOrigin = d.domain ? `https://${d.domain}` : defaultOrigin;
      const fullUrl = dirOrigin ? `${dirOrigin}${d.path}` : d.path;
      const foundOn = d.foundOnUrl || (d.directPageUrls.length > 0 ? d.directPageUrls[0] : fullUrl);
      return {
        kind: 'directory',
        path: d.path,
        domain: d.domain,
        depth: d.depth,
        foundOnUrl: foundOn,
        foundOnUrls: d.foundOnUrls || (foundOn ? [foundOn] : []),
        fullUrl,
        directCount: d.directPageUrls.length,
        nestedCount: d.allNestedUrlsCount,
        originalDir: d,
      };
    });

    const fileRows: TableUnifiedRow[] = files.map((f) => {
      const fileOrigin = f.domain ? `https://${f.domain}` : defaultOrigin;
      const fullUrl = fileOrigin ? `${fileOrigin}${f.path}` : f.url;
      return {
        kind: 'file',
        path: f.path,
        domain: f.domain,
        filename: f.filename,
        extension: f.extension,
        fileType: f.fileType,
        depth: f.depth,
        foundOnUrl: f.foundOnUrl || fullUrl,
        foundOnUrls: f.foundOnUrls || (f.foundOnUrl ? [f.foundOnUrl] : []),
        fullUrl,
        directCount: 1,
        originalFile: f,
      };
    });

    return [...dirRows, ...fileRows];
  }, [directories, files, targetOrigin]);

  const filteredRows = useMemo(() => {
    return unifiedRows
      .filter((row) => {
        if (selectedSubdomain !== 'all') {
          const rowDomain = row.domain || targetDomain || availableSubdomains[0];
          if (rowDomain && rowDomain !== selectedSubdomain) {
            return false;
          }
        }

        if (typeFilter === 'dirs' && row.kind !== 'directory') return false;
        if (typeFilter === 'files' && row.kind !== 'file') return false;

        if (categoryFilter !== 'all') {
          if (row.kind !== 'file' || row.fileType !== categoryFilter) return false;
        }

        if (depthFilter !== 'all' && row.depth !== depthFilter) return false;

        if (search.trim()) {
          const q = search.toLowerCase();
          const matchPath = row.path.toLowerCase().includes(q);
          const matchDomain = row.domain?.toLowerCase().includes(q);
          const matchFoundOn = row.foundOnUrl?.toLowerCase().includes(q);
          const matchFoundUrls = row.foundOnUrls?.some((u) => u.toLowerCase().includes(q));
          const matchExt = row.extension?.toLowerCase().includes(q);
          const matchCategory = row.fileType?.toLowerCase().includes(q);
          return (
            matchPath ||
            Boolean(matchDomain) ||
            Boolean(matchFoundOn) ||
            Boolean(matchFoundUrls) ||
            Boolean(matchExt) ||
            Boolean(matchCategory)
          );
        }
        return true;
      })
      .sort((a, b) => {
        let diff = 0;
        if (sortField === 'path') {
          diff = a.path.localeCompare(b.path);
        } else if (sortField === 'domain') {
          diff = (a.domain || '').localeCompare(b.domain || '');
        } else if (sortField === 'type') {
          diff = a.kind.localeCompare(b.kind);
        } else if (sortField === 'foundOn') {
          diff = (a.foundOnUrl || '').localeCompare(b.foundOnUrl || '');
        }
        return sortOrder === 'asc' ? diff : -diff;
      });
  }, [unifiedRows, selectedSubdomain, availableSubdomains, search, typeFilter, categoryFilter, depthFilter, sortField, sortOrder]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const tableHorizScrollRef = React.useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkTableHorizScroll = () => {
    const el = tableHorizScrollRef.current;
    if (!el) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  };

  useEffect(() => {
    checkTableHorizScroll();
    const timeoutId = setTimeout(checkTableHorizScroll, 60);
    const el = tableHorizScrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkTableHorizScroll, { passive: true });
    window.addEventListener('resize', checkTableHorizScroll);
    return () => {
      clearTimeout(timeoutId);
      el.removeEventListener('scroll', checkTableHorizScroll);
      window.removeEventListener('resize', checkTableHorizScroll);
    };
  }, [hasMultipleDomains]);

  const handlePanLeft = () => {
    if (tableHorizScrollRef.current) {
      tableHorizScrollRef.current.scrollBy({ left: -280, behavior: 'smooth' });
    }
  };

  const handlePanRight = () => {
    if (tableHorizScrollRef.current) {
      tableHorizScrollRef.current.scrollBy({ left: 280, behavior: 'smooth' });
    }
  };

  const [pageSize, setPageSize] = useState<'50' | '100' | '250' | 'all'>('100');
  const [currentPage, setCurrentPage] = useState<number>(1);

  useEffect(() => {
    setCurrentPage(1);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    checkTableHorizScroll();
  }, [selectedSubdomain, typeFilter, categoryFilter, depthFilter, search, pageSize]);

  const totalRowCount = filteredRows.length;
  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(totalRowCount / Number(pageSize)));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const displayedRows = useMemo(() => {
    if (pageSize === 'all') {
      return filteredRows;
    }
    const size = Number(pageSize);
    const start = (safeCurrentPage - 1) * size;
    return filteredRows.slice(start, start + size);
  }, [filteredRows, pageSize, safeCurrentPage]);

  const handleCopy = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedPath(text);
    setTimeout(() => setCopiedPath(null), 1800);
  };

  const totalDirsCount = directories.length;
  const totalFilesCount = files.length;

  if (directories.length === 0 && files.length === 0) {
    return (
      <div id="table-view-empty" className="p-12 text-center bg-[#141414] border border-[#383838] rounded-none shadow-md">
        <FolderTree className="w-10 h-10 text-[#737373] mx-auto mb-3" />
        <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-[#f0f0f0]">No Data Discovered Yet</h3>
        <p className="text-xs text-[#8c8c8c] font-mono max-w-md mx-auto mt-1">
          Initiate crawl above to extract and map all unique directories and discovered files on the domain.
        </p>
      </div>
    );
  }

  return (
    <div id="directory-table-view" className="bg-[#141414] border border-[#383838] rounded-none overflow-visible flex flex-col shadow-md relative">
      <div className="h-[2px] w-full bg-gradient-to-r from-[#c30800] via-[#c300bb] to-[#bbc300]" />

      {/* Top Header - Sticky so chevrons follow down on scroll */}
      <div className="sticky top-[var(--topbar-height,65px)] z-30 px-4 sm:px-6 py-3.5 bg-[#141414]/95 backdrop-blur-md flex flex-col gap-3 border-b border-[#383838] w-full max-w-full shadow-md">
        {/* Row 1: Title & Type Filter Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 w-full min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-2 h-2 bg-[#c30800] shrink-0" />
            <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-[#f0f0f0] truncate">
              Deduplicated Recon Table
            </h2>
          </div>
          <div className="flex items-center flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setTypeFilter('all')}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] rounded-none border font-mono uppercase tracking-wider cursor-pointer transition-colors font-semibold shrink-0 ${
                typeFilter === 'all'
                  ? 'bg-[#1a1a1a] text-[#f0f0f0] border-[#c30800]'
                  : 'bg-[#141414] text-[#8c8c8c] border-[#2e2e2e] hover:text-[#f0f0f0] hover:bg-[#1a1a1a] hover:border-[#383838]'
              }`}
            >
              <Layers className={`w-3 h-3 ${typeFilter === 'all' ? 'text-[#c30800]' : 'text-[#8c8c8c]'}`} />
              <span>All ({totalDirsCount + totalFilesCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter('dirs')}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] rounded-none border font-mono uppercase tracking-wider cursor-pointer transition-colors font-semibold shrink-0 ${
                typeFilter === 'dirs'
                  ? 'bg-[#1a1a1a] text-[#f0f0f0] border-[#c30800]'
                  : 'bg-[#141414] text-[#8c8c8c] border-[#2e2e2e] hover:text-[#f0f0f0] hover:bg-[#1a1a1a] hover:border-[#383838]'
              }`}
            >
              <Folder className={`w-3 h-3 ${typeFilter === 'dirs' ? 'text-[#c30800]' : 'text-[#8c8c8c]'}`} />
              <span>Directories ({totalDirsCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter('files')}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] rounded-none border font-mono uppercase tracking-wider cursor-pointer transition-colors font-semibold shrink-0 ${
                typeFilter === 'files'
                  ? 'bg-[#1a1a1a] text-[#f0f0f0] border-[#c30800]'
                  : 'bg-[#141414] text-[#8c8c8c] border-[#2e2e2e] hover:text-[#f0f0f0] hover:bg-[#1a1a1a] hover:border-[#383838]'
              }`}
            >
              <File className={`w-3 h-3 ${typeFilter === 'files' ? 'text-[#c30800]' : 'text-[#8c8c8c]'}`} />
              <span>Files ({totalFilesCount})</span>
            </button>

            {/* Table Pan Left / Right Buttons */}
            <div className="flex items-center gap-1 font-mono shrink-0 ml-auto sm:ml-2">
              <button
                type="button"
                onClick={handlePanLeft}
                disabled={!canScrollLeft}
                title="Pan table left"
                aria-label="Pan table left"
                className="p-1.5 bg-[#141414] hover:bg-[#262626] border border-[#383838] text-[#8c8c8c] hover:text-[#f0f0f0] rounded-none transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-3.5 h-3.5 text-[#c30800]" />
              </button>
              <button
                type="button"
                onClick={handlePanRight}
                disabled={!canScrollRight}
                title="Pan table right"
                aria-label="Pan table right"
                className="p-1.5 bg-[#141414] hover:bg-[#262626] border border-[#383838] text-[#8c8c8c] hover:text-[#f0f0f0] rounded-none transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-3.5 h-3.5 text-[#c30800]" />
              </button>
            </div>
          </div>
        </div>

        {/* Row 2: Search Bar & Filters with natural multi-line wrapping */}
        <div className="flex flex-wrap items-center gap-2.5 w-full min-w-0" onClick={(e) => e.stopPropagation()}>
          {/* Search Bar - Flexes to show full placeholder text with generous room without overflowing */}
          <div className="relative flex-1 min-w-[200px] sm:min-w-[260px] max-w-md">
            <Search className="w-3.5 h-3.5 text-[#8c8c8c] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="search-table-input"
              type="text"
              maxLength={200}
              placeholder="Filter paths and files"
              value={search}
              onChange={(e) => setSearch(safeClampInput(e.target.value, 200))}
              className="w-full pl-8 pr-3 py-1 bg-[#0d0d0d] border border-[#2e2e2e] hover:border-[#383838] rounded-none text-xs text-[#f0f0f0] placeholder-[#8c8c8c] focus:outline-none focus:border-[#c30800]/60 font-mono transition-colors"
            />
          </div>

          {/* Subdomain selector if multiple subdomains exist */}
          {hasMultipleDomains && (
            <div className="flex items-center gap-1 shrink-0 max-w-full">
              <Globe className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
              <select
                id="subdomain-filter-select"
                value={selectedSubdomain}
                onChange={(e) => setSelectedSubdomain(e.target.value)}
                className="px-2.5 py-1 bg-[#141414] border border-[#2e2e2e] hover:border-[#383838] rounded-none text-[10px] text-[#8c8c8c] hover:text-[#f0f0f0] focus:text-[#f0f0f0] focus:outline-none focus:border-[#c30800]/60 font-mono cursor-pointer uppercase tracking-wider transition-colors shrink-0 max-w-xs"
              >
                <option value="all">ALL SUBDOMAINS ({availableSubdomains.length})</option>
                {availableSubdomains.map((dom) => (
                  <option key={dom} value={dom}>
                    {dom === targetDomain ? `${dom} (TARGET)` : dom}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* File category selector - Static placement maintained regardless of selected typeFilter */}
          <select
            id="category-filter-select"
            value={typeFilter === 'dirs' ? 'all' : categoryFilter}
            disabled={typeFilter === 'dirs'}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-2.5 py-1 bg-[#141414] border border-[#2e2e2e] hover:border-[#383838] rounded-none text-[10px] text-[#8c8c8c] hover:text-[#f0f0f0] focus:text-[#f0f0f0] focus:outline-none focus:border-[#c30800]/60 font-mono cursor-pointer uppercase tracking-wider transition-colors disabled:opacity-35 disabled:cursor-not-allowed shrink-0"
            title={typeFilter === 'dirs' ? 'Category filter not applicable when viewing directories only' : 'Filter by file category'}
          >
            <option value="all">ALL CATEGORIES</option>
            <option value="document">DOCUMENTS</option>
            <option value="image">IMAGES</option>
            <option value="script">SCRIPTS (JS)</option>
            <option value="stylesheet">STYLES (CSS)</option>
            <option value="data">DATA (JSON/XML)</option>
            <option value="media">MEDIA</option>
            <option value="archive">ARCHIVES</option>
            <option value="code">CODE</option>
            <option value="other">OTHER</option>
          </select>

          {/* Depth Level Filter */}
          <select
            id="depth-filter-select"
            value={depthFilter}
            onChange={(e) => setDepthFilter(e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10))}
            className="px-2.5 py-1 bg-[#141414] border border-[#2e2e2e] hover:border-[#383838] rounded-none text-[10px] text-[#8c8c8c] hover:text-[#f0f0f0] focus:text-[#f0f0f0] focus:outline-none focus:border-[#c30800]/60 font-mono cursor-pointer uppercase tracking-wider transition-colors shrink-0"
          >
            <option value="all">ALL DEPTHS</option>
            {availableDepths.map((d) => (
              <option key={d} value={d}>
                DEPTH {d}
              </option>
            ))}
          </select>
        </div>
      </div>


          {/* Table Structure */}
          <div ref={tableHorizScrollRef} className="bg-[#141414] overflow-x-auto scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden no-scrollbar flex flex-col w-full max-w-full">
        {/* Table Column Headers */}
        <div
          className={`grid ${
            hasMultipleDomains
              ? 'grid-cols-[1.2fr_250px_1.3fr_75px_60px] min-w-[750px]'
              : 'grid-cols-[1.4fr_1.5fr_80px_60px] min-w-[600px]'
          } gap-4 px-6 py-3 bg-[#141414] text-[10px] uppercase tracking-widest text-[#8c8c8c] font-mono font-bold border-b border-[#383838]`}
        >
          <div>
            <button
              type="button"
              onClick={() => handleSort('path')}
              className="flex items-center gap-1 hover:text-[#f0f0f0] transition-colors uppercase tracking-widest cursor-pointer"
            >
              <span>Path / Name</span>
              <ArrowUpDown className="w-3 h-3 text-[#c30800]" />
            </button>
          </div>
          {hasMultipleDomains && (
            <div>
              <button
                type="button"
                onClick={() => handleSort('domain')}
                className="flex items-center gap-1 hover:text-[#f0f0f0] transition-colors uppercase tracking-widest cursor-pointer"
              >
                <span>Subdomain</span>
                <ArrowUpDown className="w-3 h-3 text-[#c30800]" />
              </button>
            </div>
          )}
          <div>
            <button
              type="button"
              onClick={() => handleSort('foundOn')}
              className="flex items-center gap-1 hover:text-[#f0f0f0] transition-colors uppercase tracking-widest cursor-pointer"
            >
              <span>Where Discovered</span>
              <ArrowUpDown className="w-3 h-3 text-[#c30800]" />
            </button>
          </div>
          <div className="text-center">
            <button
              type="button"
              onClick={() => handleSort('type')}
              className="flex items-center justify-center gap-1 hover:text-[#f0f0f0] transition-colors uppercase tracking-widest cursor-pointer w-full"
            >
              <span>Type</span>
              <ArrowUpDown className="w-3 h-3 text-[#c30800]" />
            </button>
          </div>
          <div className="text-right">Action</div>
        </div>

        {/* Table Rows Container */}
        <div
          ref={scrollContainerRef}
          className="overflow-y-auto max-h-[560px] font-mono text-xs custom-scrollbar relative"
        >
          {filteredRows.length === 0 ? (
            <div className="py-12 text-center text-[#8c8c8c] font-mono text-xs">
              No items match the selected filter criteria.
            </div>
          ) : (
            <div className="divide-y divide-[#2e2e2e] w-full min-w-full">
              {displayedRows.map((row, index) => {
                  const isDir = row.kind === 'directory';
                  const otherSourcesCount = (row.foundOnUrls?.length || 0) > 1 ? row.foundOnUrls.length - 1 : 0;

                  return (
                    <div
                      key={`${row.kind}_${row.domain || ''}_${row.path}_${index}`}
                      onClick={() => {
                        if (isDir && row.originalDir) {
                          onSelectDirectory(row.originalDir);
                        } else if (!isDir && row.originalFile && onSelectFile) {
                          onSelectFile(row.originalFile);
                        } else if (row.originalFile) {
                          const parentDir = directories.find((d) => d.path === row.originalFile?.directory && d.domain === row.domain);
                          if (parentDir) {
                            onSelectDirectory(parentDir);
                          }
                        }
                      }}
                      className={`grid ${
                        hasMultipleDomains
                          ? 'grid-cols-[1.2fr_250px_1.3fr_75px_60px] min-w-[750px]'
                          : 'grid-cols-[1.4fr_1.5fr_80px_60px] min-w-[600px]'
                      } gap-4 px-6 py-3 hover:bg-[#1a1a1a] transition-colors cursor-pointer group items-center min-h-[44px]`}
                    >
                      {/* Path & Icon */}
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        {isDir ? (
                          <Folder className="w-3.5 h-3.5 text-[#c30800] shrink-0" />
                        ) : (
                          getFileIcon(row.fileType)
                        )}
                        <span
                          className={`truncate font-semibold ${
                            isDir ? 'text-[#f0f0f0] group-hover:text-white' : 'text-[#f0f0f0] group-hover:text-white'
                          }`}
                          title={row.path}
                        >
                          {row.path}
                        </span>
                      </div>

                      {/* Subdomain column if multi-domain */}
                      {hasMultipleDomains && (
                        <div className="min-w-0 truncate">
                          {row.domain ? (
                            <span
                              title={row.domain}
                              className="text-xs text-[#8c8c8c] font-mono truncate block"
                            >
                              {row.domain}
                            </span>
                          ) : (
                            <span className="text-[#737373] text-[11px]">—</span>
                          )}
                        </div>
                      )}

                      {/* Where Found */}
                      <div className="min-w-0 truncate text-[#8c8c8c]">
                        {row.foundOnUrl ? (
                          <div className="flex items-center gap-1.5 truncate">
                            <a
                              href={row.foundOnUrl}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              title={`Discovered from: ${row.foundOnUrl}`}
                              className="hover:text-[#f0f0f0] hover:underline flex items-center gap-1 truncate text-[#8c8c8c] text-xs"
                            >
                              <span className="truncate">{row.foundOnUrl}</span>
                              <ExternalLink className="w-3 h-3 text-[#737373] shrink-0" />
                            </a>
                            {otherSourcesCount > 0 && (
                              <span
                                title={`Discovered on ${row.foundOnUrls.length} total pages`}
                                className="text-[10px] text-[#8c8c8c] shrink-0 font-mono"
                              >
                                +{otherSourcesCount}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[#737373] italic text-[11px]">—</span>
                        )}
                      </div>

                      {/* Type / Category */}
                      <div className="text-center">
                        {isDir ? (
                          <span className="text-xs text-[#8c8c8c] font-mono lowercase">
                            directory
                          </span>
                        ) : (
                          <span className="text-xs text-[#8c8c8c] font-mono lowercase">
                            {(row.fileType || 'file').toLowerCase()}
                          </span>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          title="Copy Full URL"
                          onClick={(e) => handleCopy(row.fullUrl, e)}
                          className="p-1 text-[#8c8c8c] hover:text-[#f0f0f0] rounded-none hover:bg-[#262626] transition-colors cursor-pointer"
                        >
                          {copiedPath === row.fullUrl ? (
                            <Check className="w-3.5 h-3.5 text-[#c30800]" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                        {isDir ? (
                          <button
                            type="button"
                            title="Inspect Directory"
                            onClick={(e) => {
                              e.stopPropagation();
                              row.originalDir && onSelectDirectory(row.originalDir);
                            }}
                            className="p-1 text-[#8c8c8c] hover:text-[#f0f0f0] rounded-none hover:bg-[#262626] transition-colors cursor-pointer"
                          >
                            <FileCode className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            title="Inspect File Metadata"
                            onClick={(e) => {
                              e.stopPropagation();
                              row.originalFile && onSelectFile?.(row.originalFile);
                            }}
                            className="p-1 text-[#8c8c8c] hover:text-[#f0f0f0] rounded-none hover:bg-[#262626] transition-colors cursor-pointer"
                          >
                            <FileCode className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      {/* Summary & Pagination Footer */}
      <div className="px-4 sm:px-6 py-3 bg-[#141414] border-t border-[#383838] flex flex-wrap items-center justify-between gap-3 text-[10px] text-[#8c8c8c] font-mono w-full max-w-full">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <span className="truncate max-w-full">
            SHOWING {pageSize === 'all' ? filteredRows.length : `${totalRowCount === 0 ? 0 : (safeCurrentPage - 1) * Number(pageSize) + 1}–${Math.min(safeCurrentPage * Number(pageSize), totalRowCount)}`} OF {totalRowCount} RECON ITEMS ({totalFilesCount} FILES, {totalDirsCount} DIRECTORIES)
            {selectedSubdomain !== 'all' ? ` [SUBDOMAIN: ${selectedSubdomain}]` : ''}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[#737373] uppercase">Per Page:</span>
            {(['50', '100', '250', 'all'] as const).map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setPageSize(size)}
                className={`px-1.5 py-0.5 rounded-none border uppercase transition-colors cursor-pointer ${
                  pageSize === size
                    ? 'bg-[#1a1a1a] text-[#f0f0f0] border-[#c30800] font-semibold'
                    : 'bg-[#141414] text-[#8c8c8c] border-[#2e2e2e] hover:text-[#f0f0f0] hover:bg-[#1a1a1a] hover:border-[#383838]'
                }`}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {totalPages > 1 && pageSize !== 'all' && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={safeCurrentPage <= 1}
                onClick={() => setCurrentPage(1)}
                className="p-1 rounded-none bg-[#141414] border border-[#383838] text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                title="First Page"
              >
                <ChevronsLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={safeCurrentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="p-1 rounded-none bg-[#141414] border border-[#383838] text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                title="Previous Page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 text-[#f0f0f0] font-bold">
                PAGE {safeCurrentPage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safeCurrentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="p-1 rounded-none bg-[#141414] border border-[#383838] text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                title="Next Page"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={safeCurrentPage >= totalPages}
                onClick={() => setCurrentPage(totalPages)}
                className="p-1 rounded-none bg-[#141414] border border-[#383838] text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                title="Last Page"
              >
                <ChevronsRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <span className="text-[#f0f0f0] font-bold ml-2">
            TOTAL DIRECT PAGES: {directories.reduce((acc, d) => acc + d.directPageUrls.length, 0)}
          </span>
        </div>
      </div>

    </div>
  );
};

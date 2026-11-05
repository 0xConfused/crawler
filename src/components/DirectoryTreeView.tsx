// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState, useMemo } from 'react';
import { safeClampInput } from '../utils/urlUtils';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  Search,
  ChevronsDownUp,
  ChevronsUpDown,
  Info,
  File,
  FileText,
  Image,
  Code,
  Music,
  Database,
  Archive,
  FileCode,
  ExternalLink,
  Globe,
  Layers,
} from 'lucide-react';
import { DirectoryRecord, DirectoryTreeNode, FileRecord, FileCategory } from '../types';
import { buildDirectoryTree, buildSingleDomainDirectoryTree } from '../utils/urlUtils';

interface DirectoryTreeViewProps {
  directories: DirectoryRecord[];
  files?: FileRecord[];
  targetOrigin: string;
  onSelectDirectory: (dir: DirectoryRecord) => void;
  onSelectFile?: (file: FileRecord) => void;
}

interface TreeNodeItemProps {
  node: DirectoryTreeNode;
  searchFilter: string;
  showFiles: boolean;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  onSelectDirectory: (dirPath: string, domain?: string) => void;
  onSelectFile?: (file: FileRecord) => void;
  onCopyPath: (path: string, e: React.MouseEvent) => void;
  copiedPath: string | null;
  targetOrigin: string;
}

function getFileIcon(category?: FileCategory) {
  switch (category) {
    case 'document':
      return <FileText className="w-4 h-4 text-[#c30800] shrink-0" />;
    case 'image':
      return <Image className="w-4 h-4 text-[#c30800] shrink-0" />;
    case 'code':
    case 'script':
      return <Code className="w-4 h-4 text-[#c30800] shrink-0" />;
    case 'stylesheet':
      return <FileCode className="w-4 h-4 text-[#c30800] shrink-0" />;
    case 'media':
      return <Music className="w-4 h-4 text-[#c30800] shrink-0" />;
    case 'data':
      return <Database className="w-4 h-4 text-[#c30800] shrink-0" />;
    case 'archive':
      return <Archive className="w-4 h-4 text-[#c30800] shrink-0" />;
    default:
      return <File className="w-4 h-4 text-[#c30800] shrink-0" />;
  }
}

const TreeNodeItem: React.FC<TreeNodeItemProps> = React.memo(({
  node,
  searchFilter,
  showFiles,
  expandedPaths,
  onToggleExpand,
  onSelectDirectory,
  onSelectFile,
  onCopyPath,
  copiedPath,
  targetOrigin,
}) => {
  const [showAllFiles, setShowAllFiles] = useState(false);
  const childKeys = Object.keys(node.children);
  const nodeFiles = node.files || [];
  const hasFiles = showFiles && nodeFiles.length > 0;
  const isExpanded = expandedPaths.has(node.fullPath);

  const isMatch = useMemo(() => {
    if (!searchFilter.trim()) return true;
    const filter = searchFilter.toLowerCase();
    if (node.fullPath.toLowerCase().includes(filter) || node.name.toLowerCase().includes(filter)) {
      return true;
    }
    if (nodeFiles.some((f) => f.filename.toLowerCase().includes(filter) || f.path.toLowerCase().includes(filter))) {
      return true;
    }
    const checkChildren = (curr: DirectoryTreeNode): boolean => {
      if (curr.fullPath.toLowerCase().includes(filter) || curr.name.toLowerCase().includes(filter)) return true;
      if (curr.files?.some((f) => f.filename.toLowerCase().includes(filter) || f.path.toLowerCase().includes(filter))) return true;
      return Object.values(curr.children).some(checkChildren);
    };
    return checkChildren(node);
  }, [node, nodeFiles, searchFilter]);

  if (!isMatch) {
    return null;
  }

  const hasChildren = childKeys.length > 0;
  const isMultiHostRoot = node.fullPath === '::ALL_HOSTS::';
  const isDomainRoot = Boolean(node.isDomainRoot);
  const isDirRoot = node.fullPath === '/' || node.fullPath.endsWith('::/');

  let displayName = `/${node.name}/`;
  if (isMultiHostRoot) {
    displayName = `All Discovered Subdomains (${childKeys.length} Hosts)`;
  } else if (isDomainRoot) {
    displayName = `Subdomain: ${node.name}`;
  } else if (isDirRoot) {
    displayName = node.domain ? `/${node.domain}/ (Root Vector)` : '/ (Root Vector)';
  }

  const cleanCopyPath = isMultiHostRoot
    ? targetOrigin
    : isDomainRoot
    ? `https://${node.name}/`
    : node.domain
    ? `https://${node.domain}${node.fullPath.replace(/^[a-zA-Z0-9.-]+::/, '')}`
    : node.fullPath;

  const visibleFiles = isExpanded && hasFiles
    ? showAllFiles || nodeFiles.length <= 40
      ? nodeFiles
      : nodeFiles.slice(0, 40)
    : [];

  const hiddenFilesCount = isExpanded && hasFiles && !showAllFiles && nodeFiles.length > 40
    ? nodeFiles.length - 40
    : 0;

  return (
    <div className="select-none text-xs font-mono">
      <div
        className={`group flex items-center justify-between py-1.5 px-2.5 rounded-none transition-colors cursor-pointer hover:bg-[#1a1a1a] ${
          isMultiHostRoot
            ? 'bg-[#141414] font-bold border-b border-[#383838] text-[#f0f0f0]'
            : isDomainRoot
            ? 'bg-[#1a1a1a] font-semibold border-b border-[#383838] text-[#f0f0f0]'
            : isDirRoot
            ? 'bg-[#141414] font-semibold border-b border-[#383838]'
            : ''
        }`}
        onClick={() => {
          if (isMultiHostRoot || isDomainRoot) {
            onToggleExpand(node.fullPath);
          } else {
            const actualPath = node.fullPath.replace(/^[a-zA-Z0-9.-]+::/, '');
            onSelectDirectory(actualPath, node.domain);
          }
        }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0 pr-2">
          {/* Chevron expander */}
          <div className="w-5 h-5 flex items-center justify-center shrink-0">
            {hasChildren || hasFiles ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand(node.fullPath);
                }}
                className="w-5 h-5 flex items-center justify-center text-[#8c8c8c] hover:text-[#f0f0f0] rounded-none hover:bg-[#262626] cursor-pointer"
              >
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-[#c30800]" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-[#8c8c8c]" />
                )}
              </button>
            ) : null}
          </div>

          {/* Folder / Domain Icon */}
          <div className="w-4 h-4 flex items-center justify-center text-[#c30800] shrink-0">
            {isMultiHostRoot ? (
              <Layers className="w-4 h-4 text-[#c30800]" />
            ) : isDomainRoot ? (
              <Globe className="w-4 h-4 text-[#c30800]" />
            ) : isExpanded && (hasChildren || hasFiles) ? (
              <FolderOpen className="w-4 h-4 text-[#c30800]" />
            ) : (
              <Folder className="w-4 h-4 text-[#c30800]" />
            )}
          </div>

          {/* Directory / Domain Name */}
          <span
            className={`truncate transition-colors ${
              isMultiHostRoot || isDomainRoot ? 'text-[#f0f0f0] font-bold' : 'text-[#f0f0f0] font-medium group-hover:text-white'
            }`}
          >
            {displayName}
          </span>
        </div>

        {/* Right meta controls */}
        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          <span className="text-[10px] font-mono text-[#8c8c8c] shrink-0">
            {childKeys.length} Directories / {nodeFiles.length} Files
          </span>


          {/* Copy Path */}
          <button
            type="button"
            title="Copy Directory Address"
            onClick={(e) => onCopyPath(cleanCopyPath, e)}
            className="p-1 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
          >
            {copiedPath === cleanCopyPath ? (
              <Check className="w-3.5 h-3.5 text-[#c30800]" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Children tree & Discovered Files */}
      {isExpanded && (
        <div className="pl-4 ml-3 border-l border-[#2e2e2e] space-y-0.5 mt-0.5">
          {/* Subdirectories */}
          {hasChildren &&
            childKeys
              .sort((a, b) => a.localeCompare(b))
              .map((key) => (
                <TreeNodeItem
                  key={node.children[key].fullPath}
                  node={node.children[key]}
                  searchFilter={searchFilter}
                  showFiles={showFiles}
                  expandedPaths={expandedPaths}
                  onToggleExpand={onToggleExpand}
                  onSelectDirectory={onSelectDirectory}
                  onSelectFile={onSelectFile}
                  onCopyPath={onCopyPath}
                  copiedPath={copiedPath}
                  targetOrigin={targetOrigin}
                />
              ))}

          {/* Files directly under this node (lazily windowed) */}
          {hasFiles && (
            <>
              {visibleFiles.map((file, idx) => {
                const fileOrigin = file.domain ? `https://${file.domain}` : targetOrigin ? targetOrigin.replace(/\/+$/, '') : '';
                const fullFileUrl = fileOrigin ? `${fileOrigin}${file.path}` : file.url;

                return (
                  <div
                    key={`file_${file.domain || ''}_${file.path}_${idx}`}
                    onClick={() => onSelectFile?.(file)}
                    className="flex items-center justify-between py-1 px-2.5 rounded-none hover:bg-[#1a1a1a] transition-colors group/file text-xs cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                      <div className="w-5 h-5 shrink-0" />
                      <div className="w-4 h-4 flex items-center justify-center text-[#c30800] shrink-0">
                        {getFileIcon(file.fileType)}
                      </div>
                      <span className="text-[#f0f0f0] group-hover/file:text-white truncate font-mono">
                        {file.filename}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {/* Where Found link */}
                      {file.foundOnUrl && (
                        <a
                          href={file.foundOnUrl}
                          target="_blank"
                          rel="noreferrer"
                          title={`Discovered on: ${file.foundOnUrl}`}
                          className="text-[10px] text-[#8c8c8c] hover:text-[#f0f0f0] flex items-center gap-1 font-mono hover:underline truncate max-w-[140px] sm:max-w-[200px]"
                        >
                          <span className="truncate">source: {new URL(file.foundOnUrl).pathname}</span>
                          <ExternalLink className="w-2.5 h-2.5 shrink-0 text-[#737373]" />
                        </a>
                      )}

                      {/* Inspect file modal */}
                      <button
                        type="button"
                        title="Inspect File Metadata"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectFile?.(file);
                        }}
                        className="p-1 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] opacity-0 group-hover/file:opacity-100 transition-opacity cursor-pointer"
                      >
                        <FileCode className="w-3 h-3" />
                      </button>

                      {/* Copy file path */}
                      <button
                        type="button"
                        title="Copy Full File URL"
                        onClick={(e) => onCopyPath(fullFileUrl, e)}
                        className="p-1 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] opacity-0 group-hover/file:opacity-100 transition-opacity cursor-pointer"
                      >
                        {copiedPath === fullFileUrl ? (
                          <Check className="w-3 h-3 text-[#c30800]" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>

                      {/* Open file link */}
                      <a
                        href={fullFileUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="Open file in new tab"
                        className="p-1 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] opacity-0 group-hover/file:opacity-100 transition-opacity cursor-pointer"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                );
              })}

              {hiddenFilesCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllFiles(true)}
                  className="w-full text-left py-1.5 px-2.5 text-[11px] font-mono text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a] rounded-none transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <div className="w-5 h-5 shrink-0" />
                  <div className="w-4 h-4 shrink-0" />
                  <span>+ Show {hiddenFilesCount} more files in this directory...</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
});

export const DirectoryTreeView: React.FC<DirectoryTreeViewProps> = ({
  directories,
  files = [],
  targetOrigin,
  onSelectDirectory,
  onSelectFile,
}) => {
  const [searchFilter, setSearchFilter] = useState('');
  const [showFiles, setShowFiles] = useState(true);
  const [selectedDomain, setSelectedDomain] = useState<string>('all');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);


  const availableDomains = useMemo(() => {
    const set = new Set<string>();
    directories.forEach((d) => {
      if (d.domain) set.add(d.domain);
    });
    files.forEach((f) => {
      if (f.domain) set.add(f.domain);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [directories, files]);

  const hasMultipleDomains = availableDomains.length > 1;

  const { filteredDirs, filteredFiles } = useMemo(() => {
    if (selectedDomain === 'all') {
      return { filteredDirs: directories, filteredFiles: files };
    }
    return {
      filteredDirs: directories.filter((d) => d.domain === selectedDomain || (!d.domain && selectedDomain === availableDomains[0])),
      filteredFiles: files.filter((f) => f.domain === selectedDomain || (!f.domain && selectedDomain === availableDomains[0])),
    };
  }, [directories, files, selectedDomain, availableDomains]);

  const tree = useMemo(() => {
    if (selectedDomain !== 'all') {
      return buildSingleDomainDirectoryTree(filteredDirs, filteredFiles, selectedDomain);
    }
    return buildDirectoryTree(directories, files);
  }, [directories, files, filteredDirs, filteredFiles, selectedDomain]);

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    const init = new Set<string>(['/', '::ALL_HOSTS::']);
    return init;
  });

  const handleToggleExpand = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleExpandAll = () => {
    const allPaths = new Set<string>(['/', '::ALL_HOSTS::']);
    directories.forEach((d) => {
      allPaths.add(d.path);
      if (d.domain) {
        allPaths.add(`${d.domain}::/`);
        allPaths.add(`${d.domain}::${d.path}`);
      }
    });
    files.forEach((f) => {
      allPaths.add(f.directory);
      if (f.domain) {
        allPaths.add(`${f.domain}::${f.directory}`);
      }
    });
    setExpandedPaths(allPaths);
  };

  const handleCollapseAll = () => {
    setExpandedPaths(new Set(['/', '::ALL_HOSTS::']));
  };

  const isAllExpanded = useMemo(() => {
    if (directories.length === 0) return false;
    return directories.every((d) => expandedPaths.has(d.path));
  }, [directories, expandedPaths]);

  const handleToggleExpandAll = () => {
    if (isAllExpanded) {
      handleCollapseAll();
    } else {
      handleExpandAll();
    }
  };

  const handleCopyPath = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(path);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 1800);
  };

  const handleSelectByPath = (fullPath: string, domain?: string) => {
    const dir = directories.find((d) => d.path === fullPath && (!domain || !d.domain || d.domain === domain));
    if (dir) {
      onSelectDirectory(dir);
    } else {
      onSelectDirectory({
        path: fullPath,
        domain,
        depth: fullPath.split('/').filter(Boolean).length,
        parentPath: '/',
        directPageUrls: [],
        allNestedUrlsCount: 0,
        subDirectories: [],
        firstDiscoveredAt: Date.now(),
      });
    }
  };

  if (directories.length === 0 && files.length === 0) {
    return (
      <div id="tree-view-empty" className="p-12 text-center bg-[#141414] border border-[#383838] rounded-none shadow-md">
        <Folder className="w-10 h-10 text-[#737373] mx-auto mb-3" />
        <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-[#f0f0f0]">No Hierarchy Discovered Yet</h3>
        <p className="text-xs text-[#8c8c8c] font-mono max-w-md mx-auto mt-1">
          Engage recon above to construct the hierarchical directory and file tree.
        </p>
      </div>
    );
  }

  return (
    <div id="directory-tree-view" className="bg-[#141414] border border-[#383838] rounded-none overflow-hidden flex flex-col shadow-md relative">
      <div className="h-[2px] w-full bg-gradient-to-r from-[#c30800] via-[#c300bb] to-[#bbc300]" />
      {/* Header bar */}
      <div className="px-4 sm:px-6 py-3.5 bg-[#141414] backdrop-blur-sm bg-gradient-to-r from-[#c30800]/10 via-transparent to-transparent flex flex-col gap-3 border-b border-[#383838] w-full max-w-full">
        {/* Row 1: Title */}
        <div className="flex flex-wrap items-center justify-between gap-3 w-full min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-2 h-2 bg-[#c30800] shrink-0" />
            <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-[#f0f0f0] truncate">
              Hierarchical Directory &amp; File Tree
            </h2>
          </div>
        </div>

        {/* Row 2: Search Bar, Subdomain Filter, Show Files Toggle & Expand/Collapse Toggle */}
        <div className="flex flex-wrap items-center gap-2.5 w-full min-w-0" onClick={(e) => e.stopPropagation()}>
          {/* Search Bar - Flexes to show full placeholder text without overflowing */}
          <div className="relative flex-1 min-w-[200px] sm:min-w-[260px] max-w-md">
            <Search className="w-3.5 h-3.5 text-[#8c8c8c] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="search-tree-input"
              type="text"
              maxLength={200}
              placeholder="Filter paths and files"
              value={searchFilter}
              onChange={(e) => setSearchFilter(safeClampInput(e.target.value, 200))}
              className="w-full pl-8 pr-3 py-1 bg-[#0d0d0d] border border-[#2e2e2e] hover:border-[#383838] rounded-none text-xs text-[#f0f0f0] placeholder-[#8c8c8c] focus:outline-none focus:border-[#c30800]/60 font-mono transition-colors"
            />
          </div>

          {/* Subdomain selector if multiple exist */}
          {hasMultipleDomains && (
            <div className="flex items-center gap-1 shrink-0 max-w-full">
              <Globe className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
              <select
                id="subdomain-tree-filter"
                value={selectedDomain}
                onChange={(e) => setSelectedDomain(e.target.value)}
                className="px-2.5 py-1 bg-[#141414] border border-[#2e2e2e] hover:border-[#383838] rounded-none text-[10px] text-[#8c8c8c] hover:text-[#f0f0f0] focus:text-[#f0f0f0] focus:outline-none focus:border-[#c30800]/60 font-mono cursor-pointer uppercase tracking-wider transition-colors shrink-0 max-w-xs"
              >
                <option value="all">ALL SUBDOMAINS ({availableDomains.length})</option>
                {availableDomains.map((dom) => (
                  <option key={dom} value={dom}>
                    {dom}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Show Files Toggle */}
          <label className={`flex items-center gap-1.5 px-2.5 py-1 rounded-none text-[10px] font-mono uppercase tracking-wider cursor-pointer transition-colors select-none border font-semibold shrink-0 ${
            showFiles
              ? 'bg-[#1a1a1a] text-[#f0f0f0] border-[#c30800]'
              : 'bg-[#141414] text-[#8c8c8c] border-[#2e2e2e] hover:border-[#383838] hover:text-[#f0f0f0] hover:bg-[#1a1a1a]'
          }`}>
            <input
              type="checkbox"
              checked={showFiles}
              onChange={(e) => setShowFiles(e.target.checked)}
              className="accent-[#c30800] w-3 h-3 cursor-pointer"
            />
            <span>SHOW FILES</span>
          </label>

          {/* Collapse / Expand All Button matching ExternalLinksView */}
          <button
            type="button"
            onClick={handleToggleExpandAll}
            disabled={filteredDirs.length === 0}
            className={`px-2.5 py-1 rounded-none font-mono text-[10px] uppercase tracking-wider border transition-colors cursor-pointer flex items-center justify-center gap-1.5 min-w-[115px] shrink-0 ${
              !isAllExpanded
                ? 'bg-[#141414] hover:bg-[#262626] border-[#383838] text-[#8c8c8c] hover:text-[#f0f0f0]'
                : 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0] font-semibold'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
            title={isAllExpanded ? 'Collapse all directory nodes' : 'Expand all directory nodes'}
          >
            {isAllExpanded ? (
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
        </div>
      </div>


          {/* Tree Content Canvas */}
      <div className="p-4 sm:p-6 bg-[#141414]">
        <div className="space-y-1 overflow-x-auto max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
          <TreeNodeItem
            node={tree}
            searchFilter={searchFilter}
            showFiles={showFiles}
            expandedPaths={expandedPaths}
            onToggleExpand={handleToggleExpand}
            onSelectDirectory={handleSelectByPath}
            onSelectFile={onSelectFile}
            onCopyPath={handleCopyPath}
            copiedPath={copiedPath}
            targetOrigin={targetOrigin}
          />
        </div>
      </div>

      {/* Helper Footer */}
      <div className="px-4 sm:px-6 py-3 bg-[#141414] border-t border-[#383838] flex flex-wrap items-center justify-between gap-3 text-[10px] text-[#8c8c8c] font-mono w-full max-w-full">
        <span className="flex items-center gap-1.5 truncate max-w-full">
          <Info className="w-3 h-3 text-[#c30800] shrink-0" />
          Click any directory node to inspect detailed hierarchy, discovered files, and source links
        </span>
        <span className="text-[#f0f0f0] font-bold shrink-0">
          {filteredDirs.length} UNIQUE PATHS • {filteredFiles.length} FILES
          {hasMultipleDomains && selectedDomain === 'all' ? ` • ${availableDomains.length} SUBDOMAINS` : ''}
        </span>
      </div>

    </div>
  );
};

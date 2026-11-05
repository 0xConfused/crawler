// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState, useMemo, useEffect } from 'react';
import { DirectoryRecord, PageRecord, FileRecord, FileCategory } from '../types';
import {
  X,
  Folder,
  ExternalLink,
  Copy,
  Check,
  FileText,
  FolderTree,
  File,
  Image,
  Code,
  Music,
  Database,
  Archive,
  FileCode,
  Layers,
  Network,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

interface DirectoryDetailModalProps {
  directory: DirectoryRecord | null;
  files?: FileRecord[];
  pages: PageRecord[];
  targetOrigin: string;
  onClose: () => void;
  onSelectSubdir: (dirPath: string) => void;
  onSelectFile?: (file: FileRecord) => void;
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

interface CollapsibleModalSectionProps {
  id: string;
  icon: React.ReactNode;
  title: string;
  count?: number;
  isOpen: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

const CollapsibleModalSection: React.FC<CollapsibleModalSectionProps> = ({
  icon,
  title,
  count,
  isOpen,
  onToggle,
  actions,
  children,
}) => {
  return (
    <div className="border border-[#383838] bg-[#141414] rounded-none overflow-hidden font-mono">
      <div
        className="w-full px-3.5 py-2.5 flex items-center justify-between bg-[#141414] hover:bg-[#1a1a1a] transition-colors cursor-pointer select-none"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-[#c30800] shrink-0">{icon}</div>
          <span className="text-xs font-bold text-[#f0f0f0] uppercase tracking-wider truncate">
            {title}
          </span>
          {typeof count === 'number' && (
            <span className="px-1.5 py-0.5 bg-[#1a1a1a] border border-[#383838] text-[10px] text-[#8c8c8c] shrink-0 font-bold">
              {count}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {actions && (
            <div onClick={(e) => e.stopPropagation()}>
              {actions}
            </div>
          )}
          <span className="text-[#8c8c8c] hover:text-[#f0f0f0] transition-colors">
            {isOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-[#c30800]" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-[#8c8c8c]" />
            )}
          </span>
        </div>
      </div>
      {isOpen && (
        <div className="p-3 bg-[#0d0d0d] border-t border-[#383838] space-y-2">
          {children}
        </div>
      )}
    </div>
  );
};

export const DirectoryDetailModal: React.FC<DirectoryDetailModalProps> = ({
  directory,
  files = [],
  pages,
  targetOrigin,
  onClose,
  onSelectSubdir,
  onSelectFile,
}) => {
  const [copied, setCopied] = useState<string | null>(null);

  // All modal lists are minimizable and minimized by default (false)
  const [showSources, setShowSources] = useState<boolean>(false);
  const [showFiles, setShowFiles] = useState<boolean>(false);
  const [showSubdirs, setShowSubdirs] = useState<boolean>(false);
  const [showPages, setShowPages] = useState<boolean>(false);

  // Reset all lists to minimized whenever inspected directory changes
  useEffect(() => {
    setShowSources(false);
    setShowFiles(false);
    setShowSubdirs(false);
    setShowPages(false);
  }, [directory?.path, directory?.domain]);

  const allSources = useMemo(() => {
    if (!directory) return [];
    const set = new Set<string>();
    if (directory.foundOnUrl) set.add(directory.foundOnUrl);
    if (directory.foundOnUrls) {
      for (const u of directory.foundOnUrls) {
        if (u) set.add(u);
      }
    }
    return Array.from(set);
  }, [directory?.foundOnUrl, directory?.foundOnUrls]);

  if (!directory) return null;

  const dirOrigin = directory.domain ? `https://${directory.domain}` : targetOrigin ? targetOrigin.replace(/\/+$/, '') : '';
  const fullDirUrl = dirOrigin ? `${dirOrigin}${directory.path}` : directory.path;

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1800);
  };

  const directPagesInfo = directory.directPageUrls.map((url) => {
    const rec = pages.find((p) => p.url === url);
    return {
      url,
      title: rec?.title || '',
      statusCode: rec?.statusCode || 200,
      durationMs: rec?.durationMs || 0,
    };
  });

  const hasExpandableLists =
    allSources.length > 0 || files.length > 0 || directory.subDirectories.length > 0 || directPagesInfo.length > 0;
  const anyExpanded = showSources || showFiles || showSubdirs || showPages;

  const toggleAll = () => {
    const nextState = !anyExpanded;
    setShowSources(nextState);
    setShowFiles(nextState);
    setShowSubdirs(nextState);
    setShowPages(nextState);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xs">
      <div className="bg-[#141414] border border-[#383838] rounded-none w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="h-[2px] w-full bg-gradient-to-r from-[#c30800] via-[#c300bb] to-[#bbc300]" />
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#383838] flex items-center justify-between bg-[#141414] backdrop-blur-sm bg-gradient-to-r from-[#c30800]/10 via-transparent to-transparent">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-none bg-[#1a1a1a] text-[#c30800] border border-[#383838]">
              <FileCode className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-mono font-bold text-sm text-[#f0f0f0]">{directory.path}</h3>
              <p className="text-[10px] font-mono text-[#8c8c8c] uppercase">DEPTH {directory.depth}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar text-xs bg-[#141414]">
          {/* Quick Stats Grid */}
          <div className="grid grid-cols-4 gap-2.5 font-mono">
            <div className="p-3 rounded-none bg-[#141414] border border-[#383838]" title="Pages discovered directly at this path">
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase text-[#8c8c8c] tracking-wider">Pages</span>
                <Layers className="w-3.5 h-3.5 text-[#c30800]" />
              </div>
              <p className="text-xl font-bold text-[#f0f0f0] mt-0.5">{directory.directPageUrls.length}</p>
            </div>
            <div className="p-3 rounded-none bg-[#141414] border border-[#383838]" title="Immediate child directories one tier down">
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase text-[#8c8c8c] tracking-wider">Directories</span>
                <FolderTree className="w-3.5 h-3.5 text-[#c30800]" />
              </div>
              <p className="text-xl font-bold text-[#f0f0f0] mt-0.5">{directory.subDirectories.length}</p>
            </div>
            <div className="p-3 rounded-none bg-[#141414] border border-[#383838]" title="Static assets and files located directly in this directory">
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase text-[#8c8c8c] tracking-wider">Files</span>
                <FileCode className="w-3.5 h-3.5 text-[#c30800]" />
              </div>
              <p className="text-xl font-bold text-[#f0f0f0] mt-0.5">{files.length}</p>
            </div>
            <div className="p-3 rounded-none bg-[#141414] border border-[#383838]" title="Total aggregate count of all pages and files located under this directory and all its nested sub-directories">
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase text-[#8c8c8c] tracking-wider">Nested Items</span>
                <Network className="w-3.5 h-3.5 text-[#c30800]" />
              </div>
              <p className="text-xl font-bold text-[#f0f0f0] mt-0.5">{directory.allNestedUrlsCount}</p>
            </div>
          </div>

          {/* Full URL & Copy */}
          <div className="p-3 rounded-none bg-[#141414] border border-[#383838] space-y-1.5 font-mono">
            <div className="flex items-center justify-between text-[#8c8c8c] text-[10px] uppercase tracking-wider">
              <span>Canonical Directory Address</span>
              <button
                type="button"
                onClick={() => handleCopy(fullDirUrl, 'fullUrl')}
                className="flex items-center gap-1 text-[#c30800] hover:text-[#f60a00] transition-colors cursor-pointer font-bold"
              >
                {copied === 'fullUrl' ? <Check className="w-3 h-3 text-[#c30800]" /> : <Copy className="w-3 h-3" />}
                <span>{copied === 'fullUrl' ? 'COPIED' : 'COPY'}</span>
              </button>
            </div>
            <p className="font-mono text-[#f0f0f0] break-all select-all text-xs">{fullDirUrl}</p>
          </div>

          {/* List Standardization Header & Global Expand/Collapse */}
          {hasExpandableLists && (
            <div className="flex items-center justify-between font-mono text-[10px] text-[#8c8c8c] pb-1 border-b border-[#2e2e2e]">
              <span className="uppercase tracking-widest text-[#737373]">Directory Lists &amp; Artifacts</span>
              <button
                type="button"
                onClick={toggleAll}
                className="text-[#8c8c8c] hover:text-[#f0f0f0] uppercase tracking-wider font-bold transition-colors cursor-pointer"
              >
                {anyExpanded ? '[-] Minimize All' : '[+] Expand All'}
              </button>
            </div>
          )}

          {/* Section 1: Inbound Discovery Sources */}
          {allSources.length > 0 && (
            <CollapsibleModalSection
              id="section-sources"
              icon={<ExternalLink className="w-3.5 h-3.5" />}
              title="Discovery Sources"
              count={allSources.length}
              isOpen={showSources}
              onToggle={() => setShowSources(!showSources)}
              actions={
                <button
                  type="button"
                  onClick={() => handleCopy(allSources.join('\n'), 'all_sources')}
                  className="text-[10px] uppercase font-bold text-[#8c8c8c] hover:text-[#f0f0f0] flex items-center gap-1 cursor-pointer transition-colors"
                >
                  {copied === 'all_sources' ? (
                    <>
                      <Check className="w-3 h-3 text-[#c30800]" />
                      <span className="text-[#c30800]">COPIED</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>COPY ALL</span>
                    </>
                  )}
                </button>
              }
            >
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1 custom-scrollbar">
                {allSources.map((sourceUrl, idx) => (
                  <div
                    key={`source_${idx}`}
                    className="p-2 rounded-none bg-[#141414] border border-[#383838] flex items-center justify-between gap-2 font-mono"
                  >
                    <div className="min-w-0 flex-1 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-none bg-[#c30800] shrink-0" />
                      <a
                        href={sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-[#f0f0f0] hover:text-[#c30800] truncate block hover:underline font-medium"
                      >
                        {sourceUrl}
                      </a>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        title="Copy URL"
                        onClick={() => handleCopy(sourceUrl, `src_${idx}`)}
                        className="p-1 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] transition-colors cursor-pointer"
                      >
                        {copied === `src_${idx}` ? (
                          <Check className="w-3 h-3 text-[#c30800]" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                      <a
                        href={sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="Open in new tab"
                        className="p-1 rounded-none text-[#8c8c8c] hover:text-[#c30800] hover:bg-[#262626] transition-colors cursor-pointer"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleModalSection>
          )}

          {/* Section 2: Discovered Files */}
          {files.length > 0 && (
            <CollapsibleModalSection
              id="section-files"
              icon={<File className="w-3.5 h-3.5" />}
              title="Files Discovered in Directory"
              count={files.length}
              isOpen={showFiles}
              onToggle={() => setShowFiles(!showFiles)}
              actions={
                <button
                  type="button"
                  onClick={() =>
                    handleCopy(
                      files
                        .map((f) => (targetOrigin ? `${targetOrigin.replace(/\/+$/, '')}${f.path}` : f.url))
                        .join('\n'),
                      'all_files'
                    )
                  }
                  className="text-[10px] uppercase font-bold text-[#8c8c8c] hover:text-[#f0f0f0] flex items-center gap-1 cursor-pointer transition-colors"
                >
                  {copied === 'all_files' ? (
                    <>
                      <Check className="w-3 h-3 text-[#c30800]" />
                      <span className="text-[#c30800]">COPIED</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>COPY LIST</span>
                    </>
                  )}
                </button>
              }
            >
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1 custom-scrollbar">
                {files.map((file, idx) => {
                  const fullFileUrl = targetOrigin ? `${targetOrigin.replace(/\/+$/, '')}${file.path}` : file.url;

                  return (
                    <div
                      key={`file_${file.path}_${idx}`}
                      className="p-2.5 rounded-none bg-[#141414] border border-[#383838] flex flex-col gap-1.5 font-mono"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {getFileIcon(file.fileType)}
                          {onSelectFile ? (
                            <button
                              type="button"
                              onClick={() => onSelectFile(file)}
                              className="text-xs text-[#f0f0f0] hover:text-[#c30800] truncate font-semibold hover:underline text-left cursor-pointer"
                              title="Inspect File Metadata"
                            >
                              {file.filename}
                            </button>
                          ) : (
                            <a
                              href={fullFileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-[#f0f0f0] hover:text-[#c30800] truncate font-semibold hover:underline"
                            >
                              {file.filename}
                            </a>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {onSelectFile && (
                            <button
                              type="button"
                              title="Inspect File Metadata"
                              onClick={() => onSelectFile(file)}
                              className="p-1 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] transition-colors cursor-pointer"
                            >
                              <FileCode className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            title="Copy File URL"
                            onClick={() => handleCopy(fullFileUrl, `file_${idx}`)}
                            className="p-1 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] transition-colors cursor-pointer"
                          >
                            {copied === `file_${idx}` ? (
                              <Check className="w-3 h-3 text-[#c30800]" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                          <a
                            href={fullFileUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="Open file in new tab"
                            className="p-1 rounded-none text-[#8c8c8c] hover:text-[#c30800] hover:bg-[#262626] transition-colors cursor-pointer"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </div>

                      {file.foundOnUrl && (
                        <div className="text-[10px] text-[#8c8c8c] flex items-center gap-1 truncate pt-1 border-t border-[#2e2e2e]">
                          <span className="text-[#8c8c8c] uppercase tracking-widest shrink-0">Found on:</span>
                          <a
                            href={file.foundOnUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[#8c8c8c] hover:text-[#f0f0f0] truncate hover:underline flex items-center gap-1"
                          >
                            <span className="truncate">{file.foundOnUrl}</span>
                            <ExternalLink className="w-2.5 h-2.5 shrink-0 text-[#737373]" />
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CollapsibleModalSection>
          )}

          {/* Section 3: Sub-Directories */}
          {directory.subDirectories.length > 0 && (
            <CollapsibleModalSection
              id="section-subdirs"
              icon={<FolderTree className="w-3.5 h-3.5" />}
              title="Sub-Directories"
              count={directory.subDirectories.length}
              isOpen={showSubdirs}
              onToggle={() => setShowSubdirs(!showSubdirs)}
              actions={
                <button
                  type="button"
                  onClick={() => handleCopy(directory.subDirectories.join('\n'), 'all_subdirs')}
                  className="text-[10px] uppercase font-bold text-[#8c8c8c] hover:text-[#f0f0f0] flex items-center gap-1 cursor-pointer transition-colors"
                >
                  {copied === 'all_subdirs' ? (
                    <>
                      <Check className="w-3 h-3 text-[#c30800]" />
                      <span className="text-[#c30800]">COPIED</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>COPY LIST</span>
                    </>
                  )}
                </button>
              }
            >
              <div className="flex flex-wrap gap-2 max-h-52 overflow-y-auto pr-1 custom-scrollbar">
                {directory.subDirectories.map((subdir) => (
                  <button
                    key={subdir}
                    type="button"
                    onClick={() => onSelectSubdir(subdir)}
                    className="px-2.5 py-1.5 rounded-none bg-[#141414] hover:bg-[#1a1a1a] text-[#f0f0f0] text-xs border border-[#383838] transition-colors cursor-pointer flex items-center gap-1.5 font-bold hover:border-[#c30800]"
                  >
                    <Folder className="w-3 h-3 text-[#c30800]" />
                    <span>{subdir}</span>
                  </button>
                ))}
              </div>
            </CollapsibleModalSection>
          )}

          {/* Section 4: Direct Pages */}
          <CollapsibleModalSection
            id="section-pages"
            icon={<FileText className="w-3.5 h-3.5" />}
            title="Direct Pages at Path"
            count={directPagesInfo.length}
            isOpen={showPages}
            onToggle={() => setShowPages(!showPages)}
            actions={
              directPagesInfo.length > 0 ? (
                <button
                  type="button"
                  onClick={() => handleCopy(directory.directPageUrls.join('\n'), 'allUrls')}
                  className="text-[10px] uppercase font-bold text-[#8c8c8c] hover:text-[#f0f0f0] flex items-center gap-1 cursor-pointer transition-colors"
                >
                  {copied === 'allUrls' ? (
                    <>
                      <Check className="w-3 h-3 text-[#c30800]" />
                      <span className="text-[#c30800]">COPIED</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>COPY LIST</span>
                    </>
                  )}
                </button>
              ) : undefined
            }
          >
            {directPagesInfo.length === 0 ? (
              <p className="text-[#8c8c8c] font-mono text-xs py-2 text-center">
                No direct HTML targets situated strictly at this directory root level.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1 custom-scrollbar">
                {directPagesInfo.map((item, idx) => (
                  <div
                    key={`page_${idx}`}
                    className="p-2.5 rounded-none bg-[#141414] border border-[#383838] flex items-center justify-between gap-3 font-mono"
                  >
                    <div className="min-w-0 flex-1">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-[#f0f0f0] hover:text-[#c30800] truncate block hover:underline font-medium"
                      >
                        {item.url}
                      </a>
                      {item.title && <p className="text-[10px] text-[#8c8c8c] truncate mt-0.5">{item.title}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={
                          item.statusCode >= 200 && item.statusCode < 300
                            ? 'tag tag-sm tag-accent-outline font-bold'
                            : item.statusCode >= 300 && item.statusCode < 400
                            ? 'tag tag-sm tag-warning-outline font-bold'
                            : 'tag tag-sm tag-error-outline font-bold'
                        }
                      >
                        HTTP {item.statusCode}
                      </span>
                      <button
                        type="button"
                        title="Copy URL"
                        onClick={() => handleCopy(item.url, `page_url_${idx}`)}
                        className="p-1 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] transition-colors cursor-pointer"
                      >
                        {copied === `page_url_${idx}` ? (
                          <Check className="w-3 h-3 text-[#c30800]" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        title="Open URL"
                        className="p-1 rounded-none text-[#8c8c8c] hover:text-[#c30800] hover:bg-[#262626] transition-colors cursor-pointer"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CollapsibleModalSection>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#383838] bg-[#141414] flex justify-end font-mono">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-none bg-[#141414] hover:bg-[#262626] text-[#f0f0f0] border border-[#383838] text-xs uppercase tracking-wider transition-colors cursor-pointer font-bold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};


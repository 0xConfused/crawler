// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState, useMemo, useEffect } from 'react';
import { FileRecord, DirectoryRecord, FileCategory } from '../types';
import {
  X,
  FileCode,
  FileText,
  Image,
  Code,
  Music,
  Database,
  Archive,
  File,
  ExternalLink,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Layers,
} from 'lucide-react';

interface FileDetailModalProps {
  file: FileRecord | null;
  targetOrigin: string;
  directories?: DirectoryRecord[];
  onClose: () => void;
  onSelectDirectory?: (dir: DirectoryRecord) => void;
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

function inferMimeFromExtension(ext?: string): string {
  if (!ext) return 'application/octet-stream';
  const clean = ext.replace(/^\./, '').toLowerCase();
  switch (clean) {
    case 'html':
    case 'htm':
      return 'text/html';
    case 'css':
      return 'text/css';
    case 'js':
    case 'mjs':
      return 'application/javascript';
    case 'json':
      return 'application/json';
    case 'xml':
      return 'application/xml';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    case 'webp':
      return 'image/webp';
    case 'ico':
      return 'image/x-icon';
    case 'pdf':
      return 'application/pdf';
    case 'zip':
      return 'application/zip';
    case 'gz':
      return 'application/gzip';
    case 'txt':
      return 'text/plain';
    case 'mp3':
      return 'audio/mpeg';
    case 'mp4':
      return 'video/mp4';
    case 'woff':
      return 'font/woff';
    case 'woff2':
      return 'font/woff2';
    case 'ttf':
      return 'font/ttf';
    default:
      return 'application/octet-stream';
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

export const FileDetailModal: React.FC<FileDetailModalProps> = ({
  file,
  targetOrigin,
  directories = [],
  onClose,
  onSelectDirectory,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showSources, setShowSources] = useState<boolean>(false);

  // Reset collapsible section when file changes
  useEffect(() => {
    setShowSources(false);
  }, [file?.path, file?.url]);

  // Keyboard Escape listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Mouse 4 (back) navigation listener to dismiss modal
  useEffect(() => {
    const handleMouseNav = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('mouseup', handleMouseNav);
    return () => window.removeEventListener('mouseup', handleMouseNav);
  }, [onClose]);

  const handleCopy = (text: string, id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const fileOrigin = useMemo(() => {
    if (!file) return '';
    if (file.domain) return `https://${file.domain}`;
    if (targetOrigin) return targetOrigin.replace(/\/+$/, '');
    try {
      return new URL(file.url).origin;
    } catch {
      return '';
    }
  }, [file, targetOrigin]);

  const fullFileUrl = useMemo(() => {
    if (!file) return '';
    if (file.url && file.url.startsWith('http')) return file.url;
    return fileOrigin ? `${fileOrigin}${file.path}` : file.path;
  }, [file, fileOrigin]);

  const effectiveMimeType = useMemo(() => {
    if (!file) return 'application/octet-stream';
    if (file.mimeType && file.mimeType.trim()) return file.mimeType.trim();
    return inferMimeFromExtension(file.extension);
  }, [file]);

  const allSources = useMemo(() => {
    if (!file) return [];
    const set = new Set<string>();
    if (file.foundOnUrl) set.add(file.foundOnUrl);
    if (file.foundOnUrls) {
      for (const u of file.foundOnUrls) {
        if (u) set.add(u);
      }
    }
    return Array.from(set).filter(Boolean);
  }, [file]);

  const parentDirectoryRecord = useMemo(() => {
    if (!file) return null;
    return directories.find(
      (d) => d.path === file.directory && (!file.domain || !d.domain || d.domain === file.domain)
    );
  }, [file, directories]);

  const hasExpandableLists = allSources.length > 0;
  const anyExpanded = showSources;

  const toggleAll = () => {
    setShowSources((prev) => !prev);
  };

  if (!file) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xs">
      <div className="bg-[#141414] border border-[#383838] rounded-none w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden font-mono">
        {/* Accent Hairline */}
        <div className="h-[2px] w-full bg-gradient-to-r from-[#c30800] via-[#c300bb] to-[#bbc300]" />

        {/* Header */}
        <div className="px-6 py-4 border-b border-[#383838] flex items-center justify-between bg-[#141414] backdrop-blur-sm bg-gradient-to-r from-[#c30800]/10 via-transparent to-transparent">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-1.5 rounded-none bg-[#1a1a1a] text-[#c30800] border border-[#383838] shrink-0">
              {getFileIcon(file.fileType)}
            </div>
            <div className="min-w-0">
              <h3 className="font-mono font-bold text-sm text-[#f0f0f0] truncate">{file.path}</h3>
              <p className="text-[10px] font-mono text-[#8c8c8c] uppercase">
                DEPTH {file.depth} • {file.fileType.toUpperCase()}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] transition-colors cursor-pointer shrink-0"
            title="Close File Details"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar text-xs bg-[#141414]">
          {/* Quick Stats Grid */}
          <div className="grid grid-cols-4 gap-2.5 font-mono">
            <div className="p-3 rounded-none bg-[#141414] border border-[#383838]" title="Crawl depth tier relative to seed URL">
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase text-[#8c8c8c] tracking-wider">Depth</span>
                <Layers className="w-3.5 h-3.5 text-[#c30800]" />
              </div>
              <p className="text-xl font-bold text-[#f0f0f0] mt-0.5">{file.depth}</p>
            </div>

            <div className="p-3 rounded-none bg-[#141414] border border-[#383838]" title="Discovered file asset classification">
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase text-[#8c8c8c] tracking-wider">Category</span>
                <FileCode className="w-3.5 h-3.5 text-[#c30800]" />
              </div>
              <p className="text-xl font-bold text-[#f0f0f0] mt-0.5 uppercase truncate">{file.fileType}</p>
            </div>

            <div className="p-3 rounded-none bg-[#141414] border border-[#383838]" title="File system extension suffix">
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase text-[#8c8c8c] tracking-wider">Extension</span>
                <FileText className="w-3.5 h-3.5 text-[#c30800]" />
              </div>
              <p className="text-xl font-bold text-[#f0f0f0] mt-0.5 uppercase truncate">
                {file.extension ? `.${file.extension.toLowerCase().replace(/^\./, '')}` : 'NONE'}
              </p>
            </div>

            <div className="p-3 rounded-none bg-[#141414] border border-[#383838]" title="Total count of referring pages discovered linking to this file">
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase text-[#8c8c8c] tracking-wider">Sources</span>
                <ExternalLink className="w-3.5 h-3.5 text-[#c30800]" />
              </div>
              <p className="text-xl font-bold text-[#f0f0f0] mt-0.5">
                {allSources.length}
              </p>
            </div>
          </div>

          {/* Full URL & Copy */}
          <div className="p-3 rounded-none bg-[#141414] border border-[#383838] space-y-1.5 font-mono">
            <div className="flex items-center justify-between text-[#8c8c8c] text-[10px] uppercase tracking-wider">
              <span>Canonical File Address</span>
              <button
                type="button"
                onClick={() => handleCopy(fullFileUrl, 'file_url')}
                className="flex items-center gap-1 text-[#c30800] hover:text-[#f60a00] transition-colors cursor-pointer font-bold"
              >
                {copiedId === 'file_url' ? <Check className="w-3 h-3 text-[#c30800]" /> : <Copy className="w-3 h-3" />}
                <span>{copiedId === 'file_url' ? 'COPIED' : 'COPY'}</span>
              </button>
            </div>
            <p className="font-mono text-[#f0f0f0] break-all select-all text-xs">{fullFileUrl}</p>
          </div>

          {/* File Architecture & Specifications */}
          <div className="p-3 rounded-none bg-[#141414] border border-[#383838] space-y-2 text-xs font-mono">
            <div className="text-[10px] uppercase tracking-wider text-[#8c8c8c] pb-1 border-b border-[#2e2e2e] font-bold">
              File Architecture &amp; Specifications
            </div>

            {/* Parent Directory */}
            <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-[#2e2e2e]">
              <span className="text-[10px] text-[#8c8c8c] uppercase tracking-wider shrink-0 w-32">
                Parent Directory:
              </span>
              <span className="text-[#f0f0f0] font-bold truncate text-right flex-1">
                {file.directory}
              </span>
            </div>

            {/* Host / Domain */}
            <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-[#2e2e2e]">
              <span className="text-[10px] text-[#8c8c8c] uppercase tracking-wider shrink-0 w-32">
                Host / Domain:
              </span>
              <span className="text-[#f0f0f0] font-bold truncate text-right flex-1">
                {file.domain || 'Target Apex Host'}
              </span>
            </div>

            {/* Canonical Path */}
            <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-[#2e2e2e]">
              <span className="text-[10px] text-[#8c8c8c] uppercase tracking-wider shrink-0 w-32">
                Canonical Path:
              </span>
              <span className="text-[#8c8c8c] truncate select-all font-mono text-right flex-1">
                {file.path}
              </span>
            </div>

            {/* MIME Type (full width, fully legible, no truncation) */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-[#8c8c8c] uppercase tracking-wider shrink-0 w-32">
                MIME Type:
              </span>
              <span className="text-[#f0f0f0] font-mono break-all select-all font-semibold text-right flex-1">
                {effectiveMimeType}
              </span>
            </div>
          </div>

          {/* List Standardization Header & Global Expand/Collapse */}
          {hasExpandableLists && (
            <div className="flex items-center justify-between font-mono text-[10px] text-[#8c8c8c] pb-1 border-b border-[#2e2e2e]">
              <span className="uppercase tracking-widest text-[#737373]">File Lists &amp; Artifacts</span>
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
              id="section-file-sources"
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
                  {copiedId === 'all_sources' ? (
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
                        {copiedId === `src_${idx}` ? (
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
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#383838] bg-[#141414] flex justify-between items-center font-mono">
          <a
            href={fullFileUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs text-[#8c8c8c] hover:text-[#f0f0f0] transition-colors"
          >
            <span>Open File In Browser</span>
            <ExternalLink className="w-3.5 h-3.5 text-[#c30800]" />
          </a>
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

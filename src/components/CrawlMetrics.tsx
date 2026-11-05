// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from 'react';
import { Activity, FolderTree, FileCode, Layers, ExternalLink, Code } from 'lucide-react';
import { CrawlStats, CrawlStatus } from '../types';

interface CrawlMetricsProps {
  stats: CrawlStats;
  status: CrawlStatus;
  maxPages: number;
}

export const CrawlMetrics: React.FC<CrawlMetricsProps> = ({ stats, status, maxPages }) => {
  const isRunning = status === 'running';

  const getElapsedFormatted = () => {
    if (!stats.startTime) return '00:00:00';
    const end = stats.endTime || Date.now();
    const totalSec = Math.max(0, Math.floor((end - stats.startTime) / 1000));
    const hrs = Math.floor(totalSec / 3600).toString().padStart(2, '0');
    const mins = Math.floor((totalSec % 3600) / 60).toString().padStart(2, '0');
    const secs = (totalSec % 60).toString().padStart(2, '0');
    return `${hrs}:${mins}:${secs}`;
  };

  const getSpeed = () => {
    if (!stats.startTime || stats.pagesVisited === 0) return '0.0';
    const end = stats.endTime || Date.now();
    const sec = Math.max(0.1, (end - stats.startTime) / 1000);
    return (stats.pagesVisited / sec).toFixed(1);
  };


  const progressPercent = Math.min(100, Math.round((stats.pagesVisited / Math.max(1, maxPages)) * 100));

  return (
    <div id="crawl-metrics-container" className="space-y-3">
      <div className="bg-[#141414] border border-[#383838] rounded-none overflow-hidden flex flex-col shadow-md relative">
        <div className="h-[2px] w-full bg-gradient-to-r from-[#c30800] via-[#c300bb] to-[#bbc300]" />

        {/* Top Header */}
        <div className="px-6 py-4 bg-[#141414] backdrop-blur-sm bg-gradient-to-r from-[#c30800]/10 via-transparent to-transparent flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-[#383838]">
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 bg-[#c30800] shrink-0" />
            <Activity className="w-3.5 h-3.5 text-[#c30800]" />
            <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-[#f0f0f0]">
              Recon Metrics
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-[#8c8c8c]">T+ {getElapsedFormatted()}</span>
            <span className="tag tag-sm tag-accent-outline font-bold">
              RATE: {getSpeed()} REQ/S
            </span>
          </div>
        </div>


          <div className="p-5 sm:p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 sm:gap-6">
          <div className="flex items-end justify-between border-b border-[#383838] pb-2">
            <div>
              <span className="text-xs text-[#8c8c8c] font-mono flex items-center gap-1.5">
                <FolderTree className="w-3.5 h-3.5 text-[#c30800]" />
                Directories
              </span>
              <span className="text-[10px] text-[#737373] font-mono">Deduplicated</span>
            </div>
            <span id="metric-directories-count" className="text-2xl font-mono font-bold text-[#f0f0f0]">
              {stats.uniqueDirectories}
            </span>
          </div>

          <div className="flex items-end justify-between border-b border-[#383838] pb-2">
            <div>
              <span className="text-xs text-[#8c8c8c] font-mono flex items-center gap-1.5">
                <FileCode className="w-3.5 h-3.5 text-[#c30800]" />
                Files Found
              </span>
              <span className="text-[10px] text-[#737373] font-mono">Assets &amp; docs</span>
            </div>
            <span id="metric-files-count" className="text-2xl font-mono font-bold text-[#f0f0f0]">
              {stats.uniqueFiles || 0}
            </span>
          </div>

          <div className="flex items-end justify-between border-b border-[#383838] pb-2">
            <div>
              <span className="text-xs text-[#8c8c8c] font-mono flex items-center gap-1.5">
                <Code className="w-3.5 h-3.5 text-[#c30800]" />
                API Endpoints
              </span>
              <span className="text-[10px] text-[#737373] font-mono">REST / GraphQL</span>
            </div>
            <span id="metric-api-count" className="text-2xl font-mono font-bold text-[#f0f0f0]">
              {stats.apiEndpointsCount || 0}
            </span>
          </div>

          <div className="flex items-end justify-between border-b border-[#383838] pb-2">
            <div>
              <span className="text-xs text-[#8c8c8c] font-mono flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-[#c30800]" />
                Crawled Pages
              </span>
              <span className="text-[10px] text-[#737373] font-mono">Limit: {maxPages}</span>
            </div>
            <span id="metric-pages-count" className="text-2xl font-mono font-bold text-[#f0f0f0]">
              {stats.pagesVisited}
            </span>
          </div>

          <div className="flex items-end justify-between border-b border-[#383838] pb-2">
            <div>
              <span className="text-xs text-[#8c8c8c] font-mono flex items-center gap-1.5">
                <ExternalLink className="w-3.5 h-3.5 text-[#c30800]" />
                Discovered Links
              </span>
              <span className="text-[10px] text-[#737373] font-mono">{stats.sameDomainLinksFound} on-domain</span>
            </div>
            <span id="metric-links-count" className="text-2xl font-mono font-bold text-[#f0f0f0]">
              {stats.totalLinksFound}
            </span>
          </div>

          <div className="flex items-end justify-between border-b border-[#383838] pb-2">
            <div>
              <span className="text-xs text-[#8c8c8c] font-mono flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-[#c30800]" />
                Queue &amp; Health
              </span>
              <span className="text-[10px] text-[#737373] font-mono">
                {stats.status2xx} ok | <span className={stats.errorsCount > 0 ? 'text-[#c3005a] font-bold' : ''}>{stats.errorsCount} err</span>
              </span>
            </div>
            <span id="metric-queue-count" className="text-2xl font-mono font-bold text-[#8c8c8c]">
              {stats.pagesQueued}
            </span>
          </div>
        </div>

        {isRunning && (
          <div className="bg-[#1a1a1a] border border-[#383838] rounded-none p-3 space-y-2 mt-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-[#f0f0f0] flex items-center gap-2 truncate">
                <span className="w-2 h-2 rounded-none bg-[#c30800] animate-pulse shrink-0" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#8c8c8c]">FETCHING:</span>
                <span className="text-[#f0f0f0] truncate font-medium">
                  {stats.currentUrl || 'Processing queue...'}
                </span>
              </span>
              <span className="text-[#c30800] font-bold shrink-0 ml-2">{progressPercent}%</span>
            </div>
            <div className="w-full bg-[#0d0d0d] border border-[#383838] rounded-none h-1.5 overflow-hidden">
              <div
                className="bg-gradient-to-r from-[#c30800] to-[#770500] h-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
};

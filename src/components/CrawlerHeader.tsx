// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState, useEffect, useRef } from 'react';
import { Square, Download, RotateCcw, Upload } from 'lucide-react';
import { CrawlStatus, CrawlStats } from '../types';
import { SkullLogo } from './SkullLogo';

interface CrawlerHeaderProps {
  status: CrawlStatus;
  stats: CrawlStats;
  currentDomain: string | null;
  hasData?: boolean;
  onOpenExport: () => void;
  onReset: () => void;
  onStop: () => void;
  onImport?: (file: File) => void;
}

const BRAND_NAME = '0xCONFUSED';
const SCRAMBLE_CHARS = '!@#$%^&*<>[]_01';

export const CrawlerHeader: React.FC<CrawlerHeaderProps> = ({
  status,
  stats,
  currentDomain,
  hasData,
  onOpenExport,
  onReset,
  onStop,
  onImport,
}) => {
  const [scrambleText, setScrambleText] = useState<string>(BRAND_NAME);
  const lastHoverScrambleRef = useRef<number>(0);
  const scrambleIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isDataLoaded =
    typeof hasData === 'boolean'
      ? hasData
      : stats.pagesVisited > 0 ||
        stats.uniqueDirectories > 0 ||
        stats.uniqueFiles > 0 ||
        stats.apiEndpointsCount > 0 ||
        stats.externalLinksCount > 0;

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onImport) {
      onImport(file);
    }
    e.target.value = '';
  };

  const runScramble = () => {
    if (scrambleIntervalRef.current) {
      clearInterval(scrambleIntervalRef.current);
    }
    let iteration = 0;
    scrambleIntervalRef.current = setInterval(() => {
      setScrambleText(
        BRAND_NAME.split('')
          .map((_char, index) => {
            if (index < iteration) {
              return BRAND_NAME[index];
            }
            return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
          })
          .join('')
      );
      if (iteration >= BRAND_NAME.length) {
        if (scrambleIntervalRef.current) {
          clearInterval(scrambleIntervalRef.current);
          scrambleIntervalRef.current = null;
        }
        setScrambleText(BRAND_NAME);
      }
      iteration += 1 / 3;
    }, 30);
  };

  const handleMouseEnter = () => {
    const now = Date.now();
    if (now - lastHoverScrambleRef.current < 2000) {
      return;
    }
    lastHoverScrambleRef.current = now;
    runScramble();
  };

  useEffect(() => {
    runScramble();
    const updateTopBarHeight = () => {
      const headerEl = document.getElementById('crawler-header');
      if (headerEl) {
        document.documentElement.style.setProperty('--topbar-height', `${headerEl.offsetHeight}px`);
      }
    };
    updateTopBarHeight();
    window.addEventListener('resize', updateTopBarHeight);
    return () => {
      if (scrambleIntervalRef.current) {
        clearInterval(scrambleIntervalRef.current);
      }
      window.removeEventListener('resize', updateTopBarHeight);
    };
  }, []);

  return (
    <header id="crawler-header" className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <div
            className="brand-logo-slot cursor-pointer"
            onMouseEnter={handleMouseEnter}
          >
            <a
              href="https://www.0xconfused.com/"
              target="_blank"
              rel="noopener noreferrer"
              data-bypass-warning="true"
              className="brand-logo-link block w-full h-full"
              aria-label="0xCONFUSED Website"
            >
              <div className="brand-logo-inner" aria-hidden="true">
                <SkullLogo
                  size={64}
                  className="w-16 h-16 object-contain opacity-100"
                />
              </div>
            </a>
          </div>

          <div className="brand-text-wrap">
            <div className="brand-title-row">
              <h1
                className="brand-glitch-text font-glitch"
                id="brandGlitchText"
                data-text="0xCONFUSED"
                onMouseEnter={handleMouseEnter}
              >
                <a
                  href="https://www.0xconfused.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-bypass-warning="true"
                  className="no-underline text-inherit inline-block"
                  aria-label="0xCONFUSED Website"
                >
                  <span className="brand-title">{scrambleText}</span>
                </a>
              </h1>
              <span className="brand-mod font-mono">./crawler</span>
            </div>
            <p className="brand-tagline">
              {currentDomain ? (
                <span className="flex items-center gap-1.5 text-[#f0f0f0] min-w-0">
                  <span className="w-1.5 h-1.5 bg-[#c30800] shrink-0" />
                  <span className="text-[#8c8c8c]">TARGET:</span>
                  <span className="text-[#f0f0f0] font-bold underline decoration-[#c30800] truncate max-w-[200px] sm:max-w-xs md:max-w-md" title={currentDomain}>
                    {currentDomain}
                  </span>
                </span>
              ) : (
                'Web Directory Reconnaissance & Domain Intelligence Engine'
              )}
            </p>
          </div>
        </div>

        <div className="topbar-actions">
          {/* Engine Status */}
          <div className="flex flex-col items-start md:items-end">
            <span className="text-[10px] uppercase tracking-widest text-[#8c8c8c] font-mono font-semibold">Engine Status</span>
            <span
              id="crawler-status-badge"
              className={`text-xs font-mono font-bold flex items-center gap-1.5 ${
                status === 'running'
                  ? 'text-[#c30800]'
                  : status === 'completed'
                  ? 'text-[#bbc300]'
                  : status === 'stopped'
                  ? 'text-[#8c8c8c]'
                  : status === 'error'
                  ? 'text-[#c3005a]'
                  : 'text-[#8c8c8c]'
              }`}
            >
              <span
                className={`w-2 h-2 ${
                  status === 'running'
                    ? 'bg-[#c30800] animate-pulse'
                    : status === 'completed'
                    ? 'bg-[#bbc300]'
                    : status === 'stopped'
                    ? 'bg-[#8c8c8c]'
                    : status === 'error'
                    ? 'bg-[#c3005a]'
                    : 'bg-[#383838]'
                }`}
              />
              {status === 'running'
                ? 'CRAWLING'
                : status === 'completed'
                ? 'COMPLETE'
                : status === 'stopped'
                ? 'STOPPED'
                : status === 'error'
                ? 'ERROR'
                : 'READY'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {status === 'running' && (
              <button
                type="button"
                id="stop-crawler-btn"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onStop();
                }}
                className="btn flex items-center gap-1.5 px-3 py-1.5 bg-[#c3005a]/20 hover:bg-[#c3005a]/30 text-[#f3f3f7] border border-[#c3005a] text-xs font-mono font-bold transition-colors uppercase tracking-wider cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-current text-[#c3005a]" />
                <span>ABORT</span>
              </button>
            )}

            {/* Single dynamic Import/Export button: IMPORT when no data is loaded, EXPORT when data is loaded */}
            {!isDataLoaded ? (
              <button
                id="import-session-btn"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Import Recon Session (.json)"
                className="btn flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold transition-all uppercase tracking-wider bg-[#141414] hover:bg-[#262626] text-[#f0f0f0] border border-[#383838] hover:border-[#c30800] cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-[#c30800]" />
                <span>IMPORT</span>
              </button>
            ) : (
              <button
                id="export-results-btn"
                type="button"
                onClick={onOpenExport}
                title="Export Recon Data"
                className="btn flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-mono font-bold transition-all uppercase tracking-wider bg-[#141414] hover:bg-[#262626] text-[#f0f0f0] border border-[#383838] hover:border-[#c30800] cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-[#c30800]" />
                <span>
                  EXPORT{stats.uniqueDirectories > 0 || stats.uniqueFiles > 0 ? ` (${stats.uniqueDirectories + stats.uniqueFiles})` : ''}
                </span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileInputChange}
              className="hidden"
            />

            <button
              id="reset-crawler-btn"
              onClick={onReset}
              title="Reset All Recon Data"
              className="btn btn-secondary icon-btn text-[#8c8c8c] hover:text-[#f0f0f0] cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

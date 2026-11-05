// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { safeClampInput } from '../utils/urlUtils';
import { CrtSubdomainsData, CrtSubdomainItem } from '../types';
import { probeSubdomainBatch } from '../services/domainIntelligenceService';
import {
  Search,
  RefreshCw,
  Copy,
  Check,
  ShieldCheck,
  Play,
  Square,
  Activity,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface CrtSubdomainsInspectorProps {
  crtData?: CrtSubdomainsData | null;
  targetDomain: string;
  onDomainChange?: (domain: string) => void;
  onCrawlHost?: (host: string) => void;
  onRefreshCrt?: () => void;
  loadingCrt?: boolean;
}

export const CrtSubdomainsInspector: React.FC<CrtSubdomainsInspectorProps> = ({
  crtData,
  targetDomain,
  onDomainChange,
  onCrawlHost,
  onRefreshCrt,
  loadingCrt = false,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'live' | 'unresolved' | 'wildcards'>('all');
  const [probedMap, setProbedMap] = useState<Record<string, CrtSubdomainItem>>({});
  const [isProbing, setIsProbing] = useState<boolean>(false);
  const [probeProgress, setProbeProgress] = useState<{ current: number; total: number; live: number }>({
    current: 0,
    total: 0,
    live: 0,
  });

  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const abortProbeRef = useRef<boolean>(false);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter]);

  const allSubdomains = useMemo(() => {
    return crtData?.subdomains || [];
  }, [crtData]);

  const filteredSubdomains = useMemo(() => {
    let list = allSubdomains;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((sub) => sub.toLowerCase().includes(q));
    }

    if (statusFilter === 'wildcards') {
      list = list.filter((sub) => sub.startsWith('*.') || sub.includes('*'));
    } else if (statusFilter === 'live') {
      list = list.filter((sub) => {
        const probed = probedMap[sub.toLowerCase()];
        return probed && (probed.dnsResolves || probed.isLive);
      });
    } else if (statusFilter === 'unresolved') {
      list = list.filter((sub) => {
        const probed = probedMap[sub.toLowerCase()];
        return probed && probed.probed && !(probed.dnsResolves || probed.isLive);
      });
    }

    return list;
  }, [allSubdomains, searchQuery, statusFilter, probedMap]);

  const totalPages = Math.max(1, Math.ceil(filteredSubdomains.length / pageSize));
  const paginatedSubdomains = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredSubdomains.slice(start, start + pageSize);
  }, [filteredSubdomains, currentPage, pageSize]);

  const probedList = Object.values(probedMap) as CrtSubdomainItem[];
  const probedCount = probedList.length;
  const liveCount = probedList.filter((p) => p.dnsResolves || p.isLive).length;
  const unresolvedCount = probedList.filter((p) => p.probed && !(p.dnsResolves || p.isLive)).length;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };



  const handleStartProbeAll = async (targetList = filteredSubdomains) => {
    if (targetList.length === 0 || isProbing) return;

    abortProbeRef.current = false;
    setIsProbing(true);

    const cleanTargets = targetList;
    const totalToProbe = cleanTargets.length;
    let currentCompleted = 0;
    let liveFound = (Object.values(probedMap) as CrtSubdomainItem[]).filter((p) => p.dnsResolves || p.isLive).length;

    setProbeProgress({
      current: 0,
      total: totalToProbe,
      live: liveFound,
    });

    const batchSize = 12;
    for (let i = 0; i < cleanTargets.length; i += batchSize) {
      if (abortProbeRef.current) break;

      const batch = cleanTargets.slice(i, i + batchSize);
      try {
        const results = await probeSubdomainBatch(batch);
        const updates: Record<string, CrtSubdomainItem> = {};
        results.forEach((item) => {
          const isResolved = Boolean(item.dnsResolves || item.isLive || item.ip);
          updates[item.hostname.toLowerCase()] = {
            subdomain: item.hostname,
            dnsResolves: isResolved,
            isLive: isResolved,
            ip: item.ip,
            cname: item.cnames ? item.cnames[0] : undefined,
            statusCode: item.statusCode,
            latencyMs: item.latencyMs,
            probed: true,
            error: item.error,
          };
          if (isResolved) liveFound++;
        });

        setProbedMap((prev) => ({ ...prev, ...updates }));
      } catch {}

      currentCompleted = Math.min(totalToProbe, i + batch.length);
      setProbeProgress({
        current: currentCompleted,
        total: totalToProbe,
        live: liveFound,
      });

      await new Promise((r) => setTimeout(r, 40));
    }

    setIsProbing(false);
  };

  const handleStopProbe = () => {
    abortProbeRef.current = true;
    setIsProbing(false);
  };

  const lastAutoProbedKeyRef = useRef<string | null>(null);

  // Reset probe state when target domain changes
  useEffect(() => {
    setProbedMap({});
    lastAutoProbedKeyRef.current = null;
  }, [crtData?.apexDomain, targetDomain]);

  useEffect(() => {
    if (crtData?.subdomains && crtData.subdomains.length > 0 && !isProbing) {
      const probeKey = `${crtData.apexDomain || targetDomain}::${crtData.subdomains.length}`;
      if (lastAutoProbedKeyRef.current !== probeKey) {
        lastAutoProbedKeyRef.current = probeKey;
        handleStartProbeAll(crtData.subdomains);
      }
    }
  }, [crtData, targetDomain, isProbing]);

  const apexDomain = crtData?.apexDomain || targetDomain;

  return (
    <div className="bg-[#141414] border border-[#383838] rounded-none overflow-hidden shadow-sm space-y-0 font-mono text-xs relative">
      <div className="h-[2px] w-full bg-gradient-to-r from-[#c30800] via-[#c300bb] to-[#bbc300]" />
      {/* Header Bar */}
      <div className="px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-[#141414] backdrop-blur-sm bg-gradient-to-r from-[#c30800]/10 via-transparent to-transparent border-b border-[#383838]">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="w-2 h-2 bg-[#c30800] shrink-0" />
          <h3 className="font-bold text-xs uppercase tracking-wider text-[#f0f0f0] flex items-center gap-2">
            <span>Certificate Transparency Subdomains</span>
            <span className="text-xs text-[#8c8c8c] font-mono font-normal">
              ({allSubdomains.length.toLocaleString()} discovered)
            </span>
          </h3>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap" onClick={(e) => e.stopPropagation()}>
          {onRefreshCrt && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRefreshCrt();
              }}
              disabled={loadingCrt}
              className="px-2.5 py-1 rounded-none bg-[#141414] hover:bg-[#262626] text-[#f0f0f0] border border-[#383838] text-[10px] flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 uppercase tracking-wider font-mono font-semibold"
              title="Re-query Certificate Transparency Logs"
            >
              <RefreshCw className={`w-3 h-3 text-[#c30800] ${loadingCrt ? 'animate-spin' : ''}`} />
              <span>Refresh CT</span>
            </button>
          )}

        </div>
      </div>


          {/* Active Probe Progress Bar (Always scans all) */}
          {isProbing && (
            <div className="px-6 py-2.5 bg-[#141414] border-b border-[#383838] flex items-center justify-between gap-3 flex-wrap font-mono text-xs">
              <div className="flex items-center gap-2 text-[#f0f0f0]">
                <Activity className="w-3.5 h-3.5 text-[#c30800] animate-pulse" />
                <span className="font-semibold uppercase tracking-wider text-[11px]">
                  Scanning DNS: {probeProgress.current} / {probeProgress.total}
                </span>
                <span className="text-[11px] text-[#8c8c8c]">
                  • Verified Live: <strong className="text-[#bbc300]">{probeProgress.live}</strong>
                </span>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-28 sm:w-44 bg-[#1a1a1a] border border-[#383838] h-1.5 overflow-hidden">
                  <div
                    className="bg-[#c30800] h-full transition-all duration-150"
                    style={{
                      width: `${Math.min(100, (probeProgress.current / Math.max(1, probeProgress.total)) * 100)}%`,
                    }}
                  />
                </div>

                <button
                  type="button"
                  onClick={handleStopProbe}
                  className="px-2 py-0.5 bg-[#1a1a1a] hover:bg-[#770500] text-[#f3f3f7] border border-[#383838] hover:border-[#770500] rounded-none text-[10px] font-mono font-bold uppercase tracking-wider transition-colors cursor-pointer"
                  title="Stop active scan"
                >
                  <span className="flex items-center gap-1">
                    <Square className="w-2.5 h-2.5" />
                    <span>Stop</span>
                  </span>
                </button>
              </div>
            </div>
          )}

      {/* Filter and Search Bar */}
      <div className="p-3 border-b border-[#383838] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#141414] min-w-0">
        {/* Search Input */}
        <div className="relative flex-1 min-w-0">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#8c8c8c]">
            <Search className="w-3.5 h-3.5 text-[#c30800]" />
          </div>
          <input
            id="crt-search-input"
            type="text"
            maxLength={200}
            placeholder={
              allSubdomains.length > 0
                ? `Search across ${allSubdomains.length.toLocaleString()} subdomains`
                : 'Search subdomains'
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(safeClampInput(e.target.value, 200))}
            className="w-full pl-9 pr-3 py-1.5 bg-[#0d0d0d] border border-[#383838] rounded-none text-xs text-[#f0f0f0] placeholder-[#737373] focus:outline-none focus:border-[#c30800] font-mono"
          />
        </div>

        {/* Status Filter Chips */}
        <div className="flex items-center gap-1 bg-[#0d0d0d] p-0.5 rounded-none border border-[#2e2e2e] font-mono text-[10px] shrink-0 flex-wrap">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-2.5 py-1 rounded-none font-mono uppercase tracking-wider transition-colors cursor-pointer font-semibold ${
              statusFilter === 'all'
                ? 'bg-[#1a1a1a] text-[#f0f0f0] border border-[#c30800]'
                : 'bg-[#141414] text-[#8c8c8c] hover:text-[#f0f0f0] border border-transparent'
            }`}
          >
            ALL ({allSubdomains.length})
          </button>

          {probedCount > 0 && (
            <>
              <button
                type="button"
                onClick={() => setStatusFilter('live')}
                className={`px-2.5 py-1 rounded-none font-mono uppercase tracking-wider transition-colors cursor-pointer font-semibold ${
                  statusFilter === 'live'
                    ? 'bg-[#1a1a1a] text-[#f0f0f0] border border-[#c30800]'
                    : 'bg-[#141414] text-[#8c8c8c] hover:text-[#f0f0f0] border border-transparent'
                }`}
              >
                LIVE ({liveCount})
              </button>

              <button
                type="button"
                onClick={() => setStatusFilter('unresolved')}
                className={`px-2.5 py-1 rounded-none font-mono uppercase tracking-wider transition-colors cursor-pointer font-semibold ${
                  statusFilter === 'unresolved'
                    ? 'bg-[#1a1a1a] text-[#f0f0f0] border border-[#c30800]'
                    : 'bg-[#141414] text-[#8c8c8c] hover:text-[#f0f0f0] border border-transparent'
                }`}
              >
                UNRESOLVED ({unresolvedCount})
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setStatusFilter('wildcards')}
            className={`px-2.5 py-1 rounded-none font-mono uppercase tracking-wider transition-colors cursor-pointer font-semibold ${
              statusFilter === 'wildcards'
                ? 'bg-[#1a1a1a] text-[#f0f0f0] border border-[#c30800]'
                : 'bg-[#141414] text-[#8c8c8c] hover:text-[#f0f0f0] border border-transparent'
            }`}
          >
            WILDCARDS (*.)
          </button>
        </div>
      </div>

      {/* Main Subdomains Table / List */}
      {filteredSubdomains.length === 0 ? (
        <div className="p-8 text-center text-[#8c8c8c] space-y-1">
          {allSubdomains.length === 0 ? (
            loadingCrt ? (
              <div className="flex flex-col items-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-[#c30800]" />
                <p>Loading Certificate Transparency subdomains...</p>
              </div>
            ) : (
              <p>No Certificate Transparency records found for {apexDomain}.</p>
            )
          ) : (
            <p>No subdomains matched search query "{searchQuery}".</p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#383838] bg-[#141414] text-[10px] text-[#8c8c8c] uppercase tracking-wider">
                <th className="py-2.5 px-4 font-semibold">Subdomain / Host</th>
                <th className="py-2.5 px-3 font-semibold">DNS / Target</th>
                <th className="py-2.5 px-3 font-semibold w-24">DNS Latency</th>
                <th className="py-2.5 px-3 text-right font-semibold w-40">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2e2e2e]">
              {paginatedSubdomains.map((sub, idx) => {
                const subKey = sub.toLowerCase();
                const probed = probedMap[subKey];
                const isWildcard = sub.startsWith('*.') || sub.includes('*');

                return (
                  <tr key={`${sub}_${idx}`} className="hover:bg-[#1a1a1a] transition-colors">
                    {/* Subdomain Name */}
                    <td className="py-2.5 px-4 text-[#f0f0f0] font-medium font-mono break-all select-all">
                      <span>{sub}</span>
                    </td>

                    {/* DNS / Target */}
                    <td className="py-2.5 px-3 text-[#8c8c8c] font-mono text-[11px]">
                      {probed?.ip ? (
                        <span className="text-[#f0f0f0] font-semibold">{probed.ip}</span>
                      ) : probed?.cname ? (
                        <span className="text-[#8c8c8c] truncate max-w-xs block" title={probed.cname}>
                          CNAME: {probed.cname}
                        </span>
                      ) : (
                        <span>—</span>
                      )}
                    </td>

                    {/* DNS Latency */}
                    <td className="py-2.5 px-3 text-[11px] font-mono">
                      {probed?.latencyMs !== undefined ? (
                        <span className="text-[#8c8c8c] text-[10px]">({probed.latencyMs}ms)</span>
                      ) : (
                        <span className="text-[#8c8c8c]">—</span>
                      )}
                    </td>

                    {/* Action Buttons */}
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">


                        {/* Inspect Subdomain WHOIS/DNS */}
                        {onDomainChange && !isWildcard && (
                          <button
                            type="button"
                            onClick={() => onDomainChange(sub)}
                            className="p-1 rounded-none text-[#8c8c8c] hover:text-[#c30800] hover:bg-[#262626] transition-colors cursor-pointer"
                            title="Switch WHOIS / DNS Intelligence target to this subdomain"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* Crawl Host */}
                        {onCrawlHost && !isWildcard && (
                          <button
                            type="button"
                            onClick={() => onCrawlHost(sub)}
                            className="p-1 rounded-none text-[#8c8c8c] hover:text-[#c30800] hover:bg-[#262626] transition-colors cursor-pointer"
                            title="Launch Recon & Crawler on this host"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* Copy Host */}
                        <button
                          type="button"
                          onClick={() => handleCopy(sub, `copy_${idx}`)}
                          className="p-1 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] transition-colors cursor-pointer"
                          title="Copy hostname"
                        >
                          {copiedKey === `copy_${idx}` ? (
                            <Check className="w-3.5 h-3.5 text-[#c30800]" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Footer */}
      {filteredSubdomains.length > 0 && (
        <div className="p-3 border-t border-[#383838] flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#141414] text-[11px] text-[#8c8c8c]">
          <div className="flex items-center gap-2">
            <span>
              Showing {(currentPage - 1) * pageSize + 1}–
              {Math.min(currentPage * pageSize, filteredSubdomains.length)} of {filteredSubdomains.length.toLocaleString()}{' '}
              subdomains
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Page Size Selector */}
            <div className="flex items-center gap-1.5">
              <span>Per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="bg-[#141414] border border-[#2e2e2e] rounded-none px-2 py-0.5 text-xs text-[#8c8c8c] hover:border-[#383838] focus:border-[#c30800] font-mono cursor-pointer"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={250}>250</option>
              </select>
            </div>

            {/* Page Navigation */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="p-1 rounded-none bg-[#141414] border border-[#383838] text-[#f0f0f0] hover:bg-[#262626] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 font-mono">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="p-1 rounded-none bg-[#141414] border border-[#383838] text-[#f0f0f0] hover:bg-[#262626] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

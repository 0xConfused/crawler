// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState, useEffect } from 'react';
import { safeClampInput } from '../utils/urlUtils';
import { CorsProxyMode, CustomProxyConfig, DomainIntelligence } from '../types';
import { CrtSubdomainsInspector } from './CrtSubdomainsInspector';
import { fetchFullDomainIntelligence, fetchCrtSubdomains } from '../services/domainIntelligenceService';
import {
  Globe,
  Shield,
  Server,
  Search,
  RefreshCw,
  Copy,
  Check,
  AlertCircle,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Network,
} from 'lucide-react';

interface DomainIntelligenceViewProps {
  targetDomain?: string | null;
  cachedData?: DomainIntelligence | null;
  domainCacheMap?: Record<string, DomainIntelligence>;
  refreshKey?: number;
  corsProxyMode?: CorsProxyMode;
  customProxyConfig?: string | CustomProxyConfig;
  onCacheData?: (domain: string, data: DomainIntelligence) => void;
  onDomainChange?: (domain: string) => void;
  onCrawlHost?: (host: string) => void;
}

export const DomainIntelligenceView: React.FC<DomainIntelligenceViewProps> = ({
  targetDomain,
  cachedData,
  domainCacheMap,
  refreshKey: _refreshKey,
  corsProxyMode: proxyMode = 'direct',
  customProxyConfig,
  onCacheData,
  onDomainChange,
  onCrawlHost,
}) => {
  const [domainInput, setDomainInput] = useState<string>(targetDomain || '');
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingCrt, setLoadingCrt] = useState<boolean>(false);
  const [data, setData] = useState<DomainIntelligence | null>(() => {
    if (cachedData) return cachedData;
    if (targetDomain && domainCacheMap) {
      const clean = targetDomain.toLowerCase().replace(/:\d+$/, '');
      if (domainCacheMap[clean]) return domainCacheMap[clean];
    }
    return null;
  });
  const [error, setError] = useState<string | null>(null);
  const [dnsTypeFilter, setDnsTypeFilter] = useState<string>('all');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);


  const [showRawWhois, setShowRawWhois] = useState<boolean>(false);

  function formatDateSafely(dateStr?: string): string {
    if (!dateStr) return 'Unknown / Not Provided';
    try {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        return d.toUTCString();
      }
    } catch {}
    return dateStr;
  }

  useEffect(() => {
    if (targetDomain) {
      setDomainInput(targetDomain);
      const clean = targetDomain.toLowerCase().replace(/:\d+$/, '');
      if (domainCacheMap && domainCacheMap[clean]) {
        setData(domainCacheMap[clean]);
      } else if (!data && !loading) {
        fetchDomainInfo(clean, false);
      }
    }
  }, [targetDomain, domainCacheMap]);

  const fetchDomainInfo = async (domainToQuery: string, forceRefresh = false) => {
    if (!domainToQuery.trim()) return;

    let clean = domainToQuery.trim();
    try {
      if (/^https?:\/\//i.test(clean)) {
        clean = new URL(clean).hostname;
      } else if (clean.includes('/')) {
        clean = clean.split('/')[0];
      }
    } catch {}

    clean = clean.toLowerCase().replace(/:\d+$/, '');

    if (!forceRefresh && domainCacheMap && domainCacheMap[clean]) {
      setData(domainCacheMap[clean]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await fetchFullDomainIntelligence(clean, proxyMode as CorsProxyMode, customProxyConfig);
      setData(result);
      onCacheData?.(clean, result);
    } catch (err: any) {
      setError(err.message || 'Error looking up domain intelligence');
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshCrt = async () => {
    if (!data?.domain) return;
    setLoadingCrt(true);
    try {
      const crtRes = await fetchCrtSubdomains(data.domain, proxyMode as CorsProxyMode, customProxyConfig);
      const updated: DomainIntelligence = { ...data, crtSubdomains: crtRes };
      setData(updated);
      onCacheData?.(data.domain, updated);
    } catch {
      // ignore
    } finally {
      setLoadingCrt(false);
    }
  };

  const handleLookupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!domainInput.trim()) return;

    let clean = domainInput.trim();
    try {
      if (/^https?:\/\//i.test(clean)) {
        clean = new URL(clean).hostname;
      } else if (clean.includes('/')) {
        clean = clean.split('/')[0];
      }
    } catch {}

    clean = clean.toLowerCase().replace(/:\d+$/, '');
    onDomainChange?.(clean);
    fetchDomainInfo(clean, true);
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleCopyJson = () => {
    if (!data) return;
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopiedKey('all_json');
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const filteredDns = (data?.dns || []).filter((record) => {
    if (dnsTypeFilter === 'all') return true;
    return record.type.toUpperCase() === dnsTypeFilter.toUpperCase();
  });

  const availableDnsTypes = Array.from(new Set((data?.dns || []).map((r) => r.type.toUpperCase()))).sort();

  return (
    <div id="domain-intelligence-view" className="space-y-5">
      {/* Domain Lookup Card with Standardized Header */}
      <div id="domain-intelligence-card" className="bg-[#141414] border border-[#383838] rounded-none overflow-hidden flex flex-col shadow-md relative">
        <div className="h-[2px] w-full bg-gradient-to-r from-[#c30800] via-[#c300bb] to-[#bbc300]" />

        {/* Section Header */}
        <div className="px-6 py-4 bg-[#141414] backdrop-blur-sm bg-gradient-to-r from-[#c30800]/10 via-transparent to-transparent flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3 border-b border-[#383838]">
          <div className="flex items-center flex-wrap gap-2.5">
            <span className="w-2 h-2 bg-[#c30800] shrink-0" />
            <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-[#f0f0f0]">
              Domain Intelligence &amp; WHOIS Registry
            </h2>
          </div>

          {data && (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyJson();
                }}
                title="Copy Full Report as JSON"
                className="px-2.5 py-1 bg-[#141414] hover:bg-[#262626] text-[#8c8c8c] hover:text-[#f0f0f0] rounded-none text-[10px] font-mono uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer border border-[#383838]"
              >
                {copiedKey === 'all_json' ? (
                  <Check className="w-3.5 h-3.5 text-[#c30800]" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-[#8c8c8c]" />
                )}
                <span>JSON</span>
              </button>
            </div>
          )}
        </div>

        {/* Form Body */}
          <div className="p-4 sm:p-5 bg-[#141414]">
            <form onSubmit={handleLookupSubmit} className="flex flex-col sm:flex-row gap-3 min-w-0">
              <div className="relative flex-1 min-w-0">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#8c8c8c]">
                  <Globe className="w-4 h-4 text-[#c30800]" />
                </div>
                <input
                  id="domain-search-input"
                  type="text"
                  maxLength={200}
                  placeholder="Enter domain or hostname"
                  value={domainInput}
                  onChange={(e) => setDomainInput(safeClampInput(e.target.value, 200))}
                  className="w-full pl-10 pr-4 py-2 bg-[#0d0d0d] border border-[#383838] rounded-none font-mono text-xs text-[#f0f0f0] placeholder-[#737373] focus:outline-none focus:border-[#c30800]"
                />
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="submit"
                  disabled={loading || !domainInput.trim()}
                  className="px-5 py-2 bg-gradient-to-r from-[#c30800] to-[#770500] hover:from-[#f60a00] hover:to-[#770500] text-[#f3f3f7] rounded-none text-xs font-bold font-mono uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50 border border-[#c30800] shadow-sm"
                >
                  {loading ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Search className="w-3.5 h-3.5" />
                  )}
                  <span>Query Intelligence</span>
                </button>
              </div>
            </form>

            {error && (
              <div className="mt-3 bg-[#141414] border border-[#383838] border-l-2 border-l-[#c3005a] rounded-none p-3 text-xs font-mono text-[#f0f0f0] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-[#c3005a] shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
      </div>

      {loading && !data && (
        <div className="p-12 text-center bg-[#141414] border border-[#383838] rounded-none text-[#8c8c8c] font-mono text-xs shadow-md">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-[#c30800] mb-3" />
          <p>Querying DNS records, WHOIS registry &amp; HTTP headers...</p>
        </div>
      )}

      {!loading && !data && !error && (
        <div className="p-12 text-center bg-[#141414] border border-[#383838] rounded-none text-[#8c8c8c] font-mono text-xs shadow-md space-y-3">
          <Shield className="w-10 h-10 mx-auto text-[#737373] mb-2" />
          <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-[#f0f0f0]">Domain Intelligence &amp; WHOIS Idle</h3>
          <p className="max-w-md mx-auto text-xs text-[#8c8c8c] font-mono leading-relaxed">
            No DNS records, WHOIS registry data, or Certificate Transparency logs have been queried.
          </p>
        </div>
      )}

      {data && (
        <>
          {/* Quick Stat Headline Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono">
            {/* IP & Host */}
            <div className="p-3.5 rounded-none bg-[#141414] border border-[#383838] shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider font-semibold">Target Domain</span>
                <Globe className="w-3.5 h-3.5 text-[#c30800]" />
              </div>
              <p className="text-xl font-bold text-[#f0f0f0] mt-0.5 truncate">{data.domain}</p>
              <div className="text-[10px] text-[#8c8c8c] font-mono mt-1 flex items-center gap-1.5 truncate">
                <span>Resolved IP:</span>
                <span className="text-[#f0f0f0] font-semibold">{data.resolvedIp || 'N/A'}</span>
              </div>
            </div>

            {/* Certificate Transparency Subdomains */}
            <div className="p-3.5 rounded-none bg-[#141414] border border-[#383838] shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider font-semibold">CT Subdomains</span>
                <Network className="w-3.5 h-3.5 text-[#c30800]" />
              </div>
              <p className="text-xl font-bold text-[#f0f0f0] mt-0.5 truncate">
                {data.crtSubdomains?.subdomains
                  ? `${data.crtSubdomains.subdomains.length.toLocaleString()} Hosts`
                  : loadingCrt
                  ? 'Loading CT...'
                  : '0 Discovered'}
              </p>
              <div className="text-[10px] text-[#8c8c8c] font-mono mt-1 flex items-center gap-1 truncate">
                <span>Apex:</span>
                <span className="text-[#f0f0f0] font-semibold truncate">
                  {data.crtSubdomains?.apexDomain || data.domain}
                </span>
              </div>
            </div>

            {/* Registrar */}
            <div className="p-3.5 rounded-none bg-[#141414] border border-[#383838] shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider font-semibold">Registrar</span>
                <div className="flex items-center gap-1.5">
                  {data.whois?.source && (
                    <span className="text-[10px] text-[#8c8c8c] font-mono uppercase tracking-wider">
                      {data.whois.source}
                    </span>
                  )}
                  <Shield className="w-3.5 h-3.5 text-[#c30800]" />
                </div>
              </div>
              <p className="text-xl font-bold text-[#f0f0f0] mt-0.5 truncate" title={data.whois?.registrar}>
                {data.whois?.registrar || 'Unknown / Privacy Protected'}
              </p>
              <div className="text-[10px] text-[#8c8c8c] font-mono mt-1 truncate">
                Expires: {data.whois?.expiresDate ? formatDateSafely(data.whois.expiresDate) : 'N/A'}
              </div>
            </div>

            {/* Web Server & Latency */}
            <div className="p-3.5 rounded-none bg-[#141414] border border-[#383838] shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider font-semibold">Server &amp; Latency</span>
                <Server className="w-3.5 h-3.5 text-[#c30800]" />
              </div>
              <p className="text-xl font-bold text-[#f0f0f0] mt-0.5 truncate">
                {data.server?.server || 'HTTP Server'}
              </p>
              <div className="text-[10px] text-[#8c8c8c] font-mono mt-1 flex items-center gap-1.5 truncate">
                <span>Latency:</span>
                <span className="text-[#f0f0f0]">{data.server?.latencyMs ? `${data.server.latencyMs} ms` : 'N/A'}</span>
                {data.server?.statusCode ? (
                  <>
                    <span>•</span>
                    <span className="text-[#f0f0f0] font-mono font-semibold">
                      HTTP {data.server.statusCode}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          {/* DNS Records Section */}
          <div className="bg-[#141414] border border-[#383838] rounded-none overflow-hidden shadow-sm relative">
            <div className="h-[2px] w-full bg-gradient-to-r from-[#c30800] via-[#c300bb] to-[#bbc300]" />
            <div className="px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-[#141414] backdrop-blur-sm bg-gradient-to-r from-[#c30800]/10 via-transparent to-transparent border-b border-[#383838]">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-[#c30800] shrink-0" />
                <h3 className="font-mono text-xs uppercase tracking-wider text-[#f0f0f0] font-bold">
                  DNS Resource Records ({data.dns?.length || 0})
                </h3>
              </div>

              {/* DNS Filter Type Chips */}
              <div
                className="flex items-center gap-1 bg-[#0d0d0d] p-0.5 rounded-none border border-[#2e2e2e] font-mono text-[10px] shrink-0 flex-wrap"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDnsTypeFilter('all');
                  }}
                  className={`px-2 py-0.5 rounded-none font-mono uppercase tracking-wider transition-colors cursor-pointer font-semibold ${
                    dnsTypeFilter === 'all'
                      ? 'bg-[#1a1a1a] text-[#f0f0f0] border border-[#c30800]'
                      : 'bg-[#141414] text-[#8c8c8c] hover:text-[#f0f0f0] border border-transparent'
                  }`}
                >
                  ALL ({data.dns.length})
                </button>
                {availableDnsTypes.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDnsTypeFilter(t);
                    }}
                    className={`px-2 py-0.5 rounded-none font-mono uppercase tracking-wider transition-colors cursor-pointer font-semibold ${
                      dnsTypeFilter === t
                        ? 'bg-[#1a1a1a] text-[#f0f0f0] border border-[#c30800]'
                        : 'bg-[#141414] text-[#8c8c8c] hover:text-[#f0f0f0] border border-transparent'
                    }`}
                  >
                    {t} ({data.dns.filter((r) => r.type.toUpperCase() === t).length})
                  </button>
                ))}
              </div>
            </div>
            {filteredDns.length === 0 ? (
                <div className="p-6 text-center text-[#8c8c8c] font-mono text-xs">
                  No DNS records found for filter "{dnsTypeFilter}".
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse font-mono text-xs">
                    <thead>
                      <tr className="border-b border-[#383838] bg-[#141414] text-[10px] text-[#8c8c8c] uppercase tracking-wider">
                        <th className="py-2.5 px-4 font-semibold w-24">Type</th>
                        <th className="py-2.5 px-4 font-semibold w-48">Host / Name</th>
                        <th className="py-2.5 px-4 font-semibold">Value / Target</th>
                        <th className="py-2.5 px-3 font-semibold w-20">TTL</th>
                        <th className="py-2.5 px-3 text-right font-semibold w-16">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#2e2e2e]">
                      {filteredDns.map((record, idx) => {
                        return (
                          <tr key={`${record.type}_${record.value}_${idx}`} className="hover:bg-[#1a1a1a] transition-colors">
                            <td className="py-2.5 px-4">
                              <span className="font-mono text-xs font-bold text-[#f0f0f0] uppercase">
                                {record.type}
                              </span>
                            </td>
                            <td className="py-2.5 px-4 text-[#f0f0f0] font-medium truncate">
                              {record.name}
                            </td>
                            <td className="py-2.5 px-4 text-[#f0f0f0] break-all select-all font-mono">
                              {record.priority !== undefined && (
                                <span className="text-[#c30800] mr-2 font-semibold">[Priority: {record.priority}]</span>
                              )}
                              {record.value}
                            </td>
                            <td className="py-2.5 px-3 text-[#8c8c8c] text-[11px]">
                              {record.ttl ? `${record.ttl}s` : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => handleCopy(record.value, `dns_${idx}`)}
                                className="p-1 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] transition-colors cursor-pointer"
                              >
                                {copiedKey === `dns_${idx}` ? (
                                  <Check className="w-3.5 h-3.5 text-[#c30800]" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            }
          </div>

          {/* Certificate Transparency (crt.sh) Subdomains Discovery & Advanced Probe Toolkit */}
          <CrtSubdomainsInspector
            crtData={data.crtSubdomains}
            targetDomain={data.domain}
            onDomainChange={onDomainChange}
            onCrawlHost={onCrawlHost}
            onRefreshCrt={handleRefreshCrt}
            loadingCrt={loadingCrt}
          />

          {/* WHOIS / RDAP Registration Details */}
          <div>
            {/* WHOIS & Registration Info */}
            <div className="bg-[#141414] border border-[#383838] rounded-none p-4 space-y-3 font-mono text-xs shadow-sm">
              <div className="flex items-center justify-between pb-2 border-b border-[#383838]">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#c30800]" />
                  <h3 className="uppercase tracking-wider text-[#f0f0f0] font-bold text-xs">
                    WHOIS / RDAP Registration
                  </h3>
                </div>
                {data.whois && (
                  <div className="flex items-center gap-2">
                    {data.whois.source && (
                      <span className="text-[10px] text-[#8c8c8c] font-mono uppercase tracking-wider">
                        Source: {data.whois.source}
                      </span>
                    )}
                    {data.whois.rawText && (
                      <button
                        type="button"
                        onClick={() => setShowRawWhois(!showRawWhois)}
                        className="px-2 py-0.5 rounded-none bg-[#141414] hover:bg-[#262626] text-[#f0f0f0] border border-[#383838] text-[10px] font-mono transition-colors cursor-pointer"
                      >
                        {showRawWhois ? 'View Formatted' : 'View Raw'}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {data.whois ? (
                showRawWhois && data.whois.rawText ? (
                  <div className="space-y-2 pt-1 font-mono">
                    <div className="flex items-center justify-between pb-1">
                      <span className="text-[10px] text-[#8c8c8c] uppercase tracking-wider font-bold">
                        Authoritative Registry Raw Payload:
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopy(data.whois!.rawText!, 'raw_whois')}
                        className="px-2 py-0.5 rounded-none bg-[#141414] hover:bg-[#262626] text-[#f0f0f0] text-[10px] flex items-center gap-1 border border-[#383838] cursor-pointer"
                      >
                        {copiedKey === 'raw_whois' ? (
                          <Check className="w-3 h-3 text-[#c30800]" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        <span>COPY RAW</span>
                      </button>
                    </div>
                    <pre className="p-3 bg-[#0d0d0d] border border-[#2e2e2e] rounded-none text-[#f0f0f0] text-[11px] overflow-x-auto font-mono whitespace-pre-wrap max-h-96 custom-scrollbar select-all leading-relaxed">
                      {data.whois.rawText}
                    </pre>
                  </div>
                ) : (
                  <div className="space-y-2 text-[#f0f0f0]">
                  <div className="flex justify-between py-1 border-b border-[#2e2e2e]">
                    <span className="text-[#8c8c8c]">Domain Name:</span>
                    <span className="text-[#f0f0f0] font-semibold">{data.whois.domainName}</span>
                  </div>
                  {data.whois.rootDomain && data.whois.rootDomain !== data.domain && (
                    <div className="flex justify-between py-1 border-b border-[#2e2e2e]">
                      <span className="text-[#8c8c8c]">Apex Domain:</span>
                      <span className="text-[#c30800] font-semibold">{data.whois.rootDomain}</span>
                    </div>
                  )}
                  <div className="flex justify-between py-1 border-b border-[#2e2e2e]">
                    <span className="text-[#8c8c8c]">Registrar:</span>
                    <span className="text-[#f0f0f0] font-semibold truncate max-w-xs">{data.whois.registrar}</span>
                  </div>
                  {data.whois.ianaId && (
                    <div className="flex justify-between py-1 border-b border-[#2e2e2e]">
                      <span className="text-[#8c8c8c]">IANA Registrar ID:</span>
                      <span className="text-[#f0f0f0]">{data.whois.ianaId}</span>
                    </div>
                  )}
                  <div className="flex justify-between py-1 border-b border-[#2e2e2e]">
                    <span className="text-[#8c8c8c]">Registered On:</span>
                    <span className="text-[#f0f0f0]">
                      {formatDateSafely(data.whois.createdDate)}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#2e2e2e]">
                    <span className="text-[#8c8c8c]">Expires On:</span>
                    <span className="text-[#f0f0f0] font-semibold">
                      {formatDateSafely(data.whois.expiresDate)}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#2e2e2e]">
                    <span className="text-[#8c8c8c]">Last Updated:</span>
                    <span className="text-[#f0f0f0]">
                      {formatDateSafely(data.whois.updatedDate)}
                    </span>
                  </div>
                  {data.whois.abuseContact && (
                    <div className="flex justify-between py-1 border-b border-[#2e2e2e]">
                      <span className="text-[#8c8c8c]">Abuse Contact:</span>
                      <span className="text-[#f0f0f0] font-semibold truncate max-w-xs">{data.whois.abuseContact}</span>
                    </div>
                  )}
                  {data.whois.registrantCountry && (
                    <div className="flex justify-between py-1 border-b border-[#2e2e2e]">
                      <span className="text-[#8c8c8c]">Registrant Country:</span>
                      <span className="text-[#f0f0f0] uppercase">{data.whois.registrantCountry}</span>
                    </div>
                  )}

                  {((data.whois.nameservers && data.whois.nameservers.length > 0) ||
                    (data.whois.status && data.whois.status.length > 0)) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-[#2e2e2e]">
                      {/* Authoritative Nameservers */}
                      {data.whois.nameservers && data.whois.nameservers.length > 0 && (
                        <div className="py-1 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] text-[#8c8c8c] uppercase tracking-wider block font-bold">
                              Authoritative Nameservers ({data.whois.nameservers.length}):
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopy(data.whois.nameservers.join('\n'), 'all_nameservers')}
                              className="px-2 py-0.5 rounded-none bg-[#141414] hover:bg-[#262626] text-[#8c8c8c] hover:text-[#f0f0f0] border border-[#383838] text-[10px] font-mono transition-colors cursor-pointer flex items-center gap-1 shrink-0"
                              title="Copy all nameservers"
                            >
                              {copiedKey === 'all_nameservers' ? (
                                <Check className="w-3 h-3 text-[#c30800]" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              <span>COPY ALL</span>
                            </button>
                          </div>
                          <div className="border border-[#2e2e2e] rounded-none overflow-hidden">
                            <div className="bg-[#141414] px-3 py-1.5 border-b border-[#2e2e2e] text-[10px] font-mono text-[#8c8c8c] uppercase tracking-wider font-semibold">
                              <span>Nameserver Host</span>
                            </div>
                            <div className="divide-y divide-[#2e2e2e] max-h-56 overflow-y-auto custom-scrollbar bg-[#0d0d0d]">
                              {data.whois.nameservers.map((ns, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center justify-between py-2 px-3 text-xs font-mono text-[#f0f0f0] hover:bg-[#1a1a1a] transition-colors"
                                >
                                  <div className="flex items-center gap-2 truncate min-w-0 mr-2">
                                    <span className="w-1.5 h-1.5 bg-[#c30800] shrink-0" />
                                    <span className="truncate select-all text-[#f0f0f0]">{ns}</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleCopy(ns, `ns_${idx}`)}
                                    className="p-1 text-[#8c8c8c] hover:text-[#f0f0f0] rounded-none hover:bg-[#262626] transition-colors cursor-pointer shrink-0 ml-2"
                                    title="Copy nameserver"
                                  >
                                    {copiedKey === `ns_${idx}` ? (
                                      <Check className="w-3 h-3 text-[#c30800]" />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Domain Status Codes */}
                      {data.whois.status && data.whois.status.length > 0 && (
                        <div className="py-1 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] text-[#8c8c8c] uppercase tracking-wider block font-bold">
                              Domain Status Codes ({data.whois.status.length}):
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopy(data.whois.status.join('\n'), 'all_statuses')}
                              className="px-2 py-0.5 rounded-none bg-[#141414] hover:bg-[#262626] text-[#8c8c8c] hover:text-[#f0f0f0] border border-[#383838] text-[10px] font-mono transition-colors cursor-pointer flex items-center gap-1 shrink-0"
                              title="Copy all status codes"
                            >
                              {copiedKey === 'all_statuses' ? (
                                <Check className="w-3 h-3 text-[#c30800]" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              <span>COPY ALL</span>
                            </button>
                          </div>
                          <div className="border border-[#2e2e2e] rounded-none overflow-hidden">
                            <div className="bg-[#141414] px-3 py-1.5 border-b border-[#2e2e2e] text-[10px] font-mono text-[#8c8c8c] uppercase tracking-wider font-semibold">
                              <span>Status Code</span>
                            </div>
                            <div className="divide-y divide-[#2e2e2e] max-h-56 overflow-y-auto custom-scrollbar bg-[#0d0d0d]">
                              {data.whois.status.map((st, idx) => {
                                const parts = st.trim().split(/\s+/);
                                const statusCode = parts[0];
                                const eppUrl = parts.length > 1 && parts[1].startsWith('http') ? parts[1] : null;
                                const rest = !eppUrl && parts.length > 1 ? parts.slice(1).join(' ') : null;

                                return (
                                  <div
                                    key={idx}
                                    className="flex items-center justify-between gap-2 py-2 px-3 text-xs font-mono hover:bg-[#1a1a1a] transition-colors"
                                  >
                                    <div className="min-w-0 flex items-center gap-2 truncate flex-1 mr-2">
                                      <span className="w-1.5 h-1.5 bg-[#c30800] shrink-0" />
                                      <span className="text-[#f0f0f0] font-semibold truncate select-all">{statusCode}</span>
                                      {rest && <span className="text-[#8c8c8c] text-[11px] truncate">{rest}</span>}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {eppUrl && (
                                        <a
                                          href={eppUrl}
                                          target="_blank"
                                          rel="noreferrer"
                                          onClick={(e) => e.stopPropagation()}
                                          className="text-[10px] text-[#8c8c8c] hover:text-[#c30800] hover:underline flex items-center gap-1 uppercase tracking-wider"
                                          title={eppUrl}
                                        >
                                          <span>EPP</span>
                                          <ExternalLink className="w-2.5 h-2.5" />
                                        </a>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => handleCopy(st, `status_${idx}`)}
                                        className="p-1 text-[#8c8c8c] hover:text-[#f0f0f0] rounded-none hover:bg-[#262626] transition-colors cursor-pointer shrink-0"
                                        title="Copy status code"
                                      >
                                        {copiedKey === `status_${idx}` ? (
                                          <Check className="w-3 h-3 text-[#c30800]" />
                                        ) : (
                                          <Copy className="w-3 h-3" />
                                        )}
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            ) : (
              <p className="text-[#8c8c8c] py-4 text-center">WHOIS / RDAP lookup data unavailable.</p>
            )}
            </div>

          </div>

          {/* HTTP & Security Headers Card */}
          <div className="bg-[#141414] border border-[#383838] rounded-none p-4 space-y-3 font-mono text-xs shadow-sm">
            <div className="flex items-center gap-2 pb-2 border-b border-[#383838]">
              <Server className="w-4 h-4 text-[#c30800]" />
              <h3 className="uppercase tracking-wider text-[#f0f0f0] font-bold text-xs">
                Server Security Posture & Headers
              </h3>
            </div>

            {data.server ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div className="p-3 bg-[#141414] border border-[#2e2e2e] rounded-none">
                  <span className="text-[10px] text-[#8c8c8c] uppercase tracking-wider block">HSTS Strict Transport</span>
                  <div className="mt-1 flex items-center gap-1.5">
                    {data.server.hsts ? (
                      <span className="text-[#f0f0f0] font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#c30800]" /> Enabled
                      </span>
                    ) : (
                      <span className="text-[#8c8c8c] flex items-center gap-1">
                        <XCircle className="w-3.5 h-3.5 text-[#8c8c8c]" /> Not Detected
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-3 bg-[#141414] border border-[#2e2e2e] rounded-none">
                  <span className="text-[10px] text-[#8c8c8c] uppercase tracking-wider block">Content Security Policy (CSP)</span>
                  <div className="mt-1 flex items-center gap-1.5">
                    {data.server.csp ? (
                      <span className="text-[#f0f0f0] font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#c30800]" /> Present
                      </span>
                    ) : (
                      <span className="text-[#8c8c8c] flex items-center gap-1">
                        <XCircle className="w-3.5 h-3.5 text-[#8c8c8c]" /> Not Detected
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-3 bg-[#141414] border border-[#2e2e2e] rounded-none">
                  <span className="text-[10px] text-[#8c8c8c] uppercase tracking-wider block">X-Frame-Options</span>
                  <div className="mt-1 flex items-center gap-1.5">
                    {data.server.xFrameOptions ? (
                      <span className="text-[#f0f0f0] font-semibold truncate">
                        {data.server.xFrameOptions}
                      </span>
                    ) : (
                      <span className="text-[#8c8c8c] flex items-center gap-1">
                        <XCircle className="w-3.5 h-3.5 text-[#8c8c8c]" /> Not Set
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-3 bg-[#141414] border border-[#2e2e2e] rounded-none">
                  <span className="text-[10px] text-[#8c8c8c] uppercase tracking-wider block">Robots.txt Presence</span>
                  <div className="mt-1 flex items-center gap-1.5">
                    {data.server.robotsTxtPresent ? (
                      <a
                        href={data.server.robotsTxtUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-[#f0f0f0] font-semibold hover:underline flex items-center gap-1 hover:text-[#c30800]"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#c30800]" /> Available (/robots.txt)
                        <ExternalLink className="w-2.5 h-2.5 ml-0.5 text-[#8c8c8c]" />
                      </a>
                    ) : (
                      <span className="text-[#8c8c8c]">Not Found</span>
                    )}
                  </div>
                </div>

                <div className="p-3 bg-[#141414] border border-[#2e2e2e] rounded-none">
                  <span className="text-[10px] text-[#8c8c8c] uppercase tracking-wider block">XML Sitemap Presence</span>
                  <div className="mt-1 flex items-center gap-1.5">
                    {data.server.sitemapPresent ? (
                      <a
                        href={data.server.sitemapUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-[#f0f0f0] font-semibold hover:underline flex items-center gap-1 hover:text-[#c30800]"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#c30800]" /> Available (/sitemap.xml)
                        <ExternalLink className="w-2.5 h-2.5 ml-0.5 text-[#8c8c8c]" />
                      </a>
                    ) : (
                      <span className="text-[#8c8c8c]">Not Found</span>
                    )}
                  </div>
                </div>

                <div className="p-3 bg-[#141414] border border-[#2e2e2e] rounded-none">
                  <span className="text-[10px] text-[#8c8c8c] uppercase tracking-wider block">X-Content-Type-Options</span>
                  <div className="mt-1 flex items-center gap-1.5">
                    {data.server.xContentTypeOptions ? (
                      <span className="text-[#f0f0f0] font-semibold">{data.server.xContentTypeOptions}</span>
                    ) : (
                      <span className="text-[#8c8c8c]">Not Set</span>
                    )}
                  </div>
                </div>

                <div className="p-3 bg-[#141414] border border-[#2e2e2e] rounded-none">
                  <span className="text-[10px] text-[#8c8c8c] uppercase tracking-wider block">AI Assistance Manifests</span>
                  <div className="mt-1 flex items-center gap-1.5">
                    {data.server.aiAssistancePresent ? (
                      <span className="text-[#bbc300] font-semibold flex items-center gap-1 font-mono text-xs">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#bbc300]" />
                        {data.server.aiAssistanceCount} Detected
                      </span>
                    ) : (
                      <span className="text-[#8c8c8c]">None Detected</span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-[#8c8c8c] py-3 text-center">Server headers not reached.</p>
            )}

            {/* AI Assistance Discovered Manifests List & Preview */}
            {data.server?.aiAssistanceFiles && data.server.aiAssistanceFiles.length > 0 && (
              <div className="pt-2 border-t border-[#383838] space-y-2">
                <span className="text-[10px] text-[#8c8c8c] uppercase tracking-wider block">
                  Discovered AI Assistance Manifests ({data.server.aiAssistanceFiles.length}):
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {data.server.aiAssistanceFiles.map((aiFile) => (
                    <div
                      key={aiFile.filename}
                      className="p-2.5 bg-[#141414] border border-[#2e2e2e] rounded-none space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <a
                          href={aiFile.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-[#f0f0f0] font-mono text-xs font-semibold hover:underline flex items-center gap-1 hover:text-[#bbc300]"
                        >
                          <CheckCircle2 className="w-3 h-3 text-[#bbc300]" />
                          /{aiFile.filename}
                          <ExternalLink className="w-2.5 h-2.5 text-[#8c8c8c]" />
                        </a>
                        {aiFile.size && (
                          <span className="text-[10px] font-mono text-[#737373]">
                            {aiFile.size} bytes
                          </span>
                        )}
                      </div>
                      {aiFile.preview && (
                        <pre className="p-1.5 bg-[#141414] border border-[#2e2e2e] text-[#8c8c8c] text-[10px] overflow-x-auto font-mono whitespace-pre-wrap max-h-24">
                          {aiFile.preview}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Robots.txt Preview Snippet */}
            {data.server?.robotsTxtContentPreview && (
              <div className="pt-2 border-t border-[#383838]">
                <span className="text-[10px] text-[#8c8c8c] uppercase tracking-wider block mb-1.5">
                  /robots.txt Content Preview:
                </span>
                <pre className="p-3 bg-[#141414] border border-[#2e2e2e] rounded-none text-[#f0f0f0] text-[11px] overflow-x-auto font-mono whitespace-pre-wrap max-h-40">
                  {data.server.robotsTxtContentPreview}
                </pre>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

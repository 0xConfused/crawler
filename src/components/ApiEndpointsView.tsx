// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState, useMemo } from 'react';
import {
  Search,
  Copy,
  Check,
  Code,
  ArrowUpRight,
  Zap,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  Globe,
  Layers,
  ListFilter,
  Activity,
  Network,
  Server,
} from 'lucide-react';
import { ApiEndpointRecord, ApiMethod, ApiCategory, ApiPossibleQuery, ApiQueryParameter } from '../types';
import { canonicalizeApiEndpointUrl } from '../utils/urlUtils';
import { probeApiEndpointDetails } from '../services/domainIntelligenceService';

interface ApiEndpointsViewProps {
  apiEndpoints: ApiEndpointRecord[];
  targetDomain: string | null;
  onOpenExternalWarning?: (url: string) => void;
  onUpdateEndpoint?: (updated: ApiEndpointRecord) => void;
}

type SortOption =
  | 'domain-asc'
  | 'domain-desc'
  | 'path-asc'
  | 'path-desc'
  | 'status'
  | 'latency'
  | 'queries'
  | 'method';

type ViewMode = 'table' | 'grouped-domain';

export const ApiEndpointsView: React.FC<ApiEndpointsViewProps> = ({
  apiEndpoints,
  targetDomain,
  onOpenExternalWarning,
  onUpdateEndpoint,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMethod, setSelectedMethod] = useState<string>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedScope, setSelectedScope] = useState<'ALL' | 'SAME_DOMAIN' | 'EXTERNAL'>('ALL');
  const [selectedDomain, setSelectedDomain] = useState<string>('ALL');
  const [selectedResponseType, setSelectedResponseType] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<SortOption>('domain-asc');
  const [viewMode, setViewMode] = useState<ViewMode>('table');

  const [collapsedDomains, setCollapsedDomains] = useState<Record<string, boolean>>({});

  // Pagination for table view
  const [pageSize, setPageSize] = useState<'25' | '50' | '100' | 'all'>('50');
  const [currentPage, setCurrentPage] = useState<number>(1);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedCurls, setCopiedCurls] = useState(false);

  // Probe and Query execution state
  const [localEndpoints, setLocalEndpoints] = useState<Record<string, ApiEndpointRecord>>({});
  const [probingIds, setProbingIds] = useState<Record<string, boolean>>({});
  const [expandedQueryIds, setExpandedQueryIds] = useState<Record<string, boolean>>({});
  const [runningQueryKeys, setRunningQueryKeys] = useState<Record<string, boolean>>({});
  const [queryResults, setQueryResults] = useState<
    Record<string, { status: number; latencyMs: number; contentType?: string; preview?: string; error?: string }>
  >({});
  const [batchProbing, setBatchProbing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });

  // Merge parent apiEndpoints with local probe/mapping updates and deduplicate normalized URLs
  // Merge parent apiEndpoints with local probe/mapping updates and deduplicate normalized routes
  const activeEndpoints = useMemo(() => {
    const deduplicatedMap = new Map<string, ApiEndpointRecord>();

    for (const rawEp of apiEndpoints) {
      const local = localEndpoints[rawEp.id];
      const ep = local ? { ...rawEp, ...local } : rawEp;

      const canonical = canonicalizeApiEndpointUrl(ep.url);
      const host = (ep.domain || 'localhost').toLowerCase();
      const key = `${ep.method}::${host}::${canonical.pathname}`;

      // Ingest observed URI key-values from all observed URLs for this endpoint
      const urlParams: ApiQueryParameter[] = [];
      const observedUris = [ep.url, ep.sampleQueryUrl, ...(ep.sourceUrls || [])].filter(Boolean) as string[];
      for (const uriStr of observedUris) {
        try {
          const fullUrl = uriStr.startsWith('/') ? `https://${host}${uriStr}` : uriStr;
          const parsed = new URL(fullUrl);
          parsed.searchParams.forEach((val, name) => {
            if (name) {
              let cleanVal = val;
              try {
                cleanVal = decodeURIComponent(val);
              } catch {}
              let inferredType: 'string' | 'number' | 'boolean' | 'array' = 'string';
              if (val === 'true' || val === 'false') inferredType = 'boolean';
              else if (/^-?\d+(\.\d+)?$/.test(val)) inferredType = 'number';
              else if (val.includes(',') && !val.includes('{')) inferredType = 'array';

              const existingIdx = urlParams.findIndex((p) => p.name === name);
              if (existingIdx === -1) {
                urlParams.push({
                  name,
                  in: 'query',
                  type: inferredType,
                  sampleValue: cleanVal || undefined,
                  status: 'UNKNOWN',
                  source: 'observed',
                });
              } else {
                if (urlParams[existingIdx].type === 'string' && inferredType !== 'string') {
                  urlParams[existingIdx].type = inferredType;
                }
                if (!urlParams[existingIdx].sampleValue && cleanVal) {
                  urlParams[existingIdx].sampleValue = cleanVal;
                }
              }
            }
          });
        } catch {}
      }

      // Combine existing possibleParameters, URL params, and queryParams strings
      const combinedParams: ApiQueryParameter[] = [...(ep.possibleParameters || [])];
      for (const up of urlParams) {
        const foundIdx = combinedParams.findIndex((p) => p.name === up.name && p.in === up.in);
        if (foundIdx === -1) {
          combinedParams.push(up);
        } else {
          if (!combinedParams[foundIdx].sampleValue && up.sampleValue) {
            combinedParams[foundIdx].sampleValue = up.sampleValue;
          }
          if (combinedParams[foundIdx].type === 'string' && up.type && up.type !== 'string') {
            combinedParams[foundIdx].type = up.type;
          }
          if (!combinedParams[foundIdx].status && up.status) {
            combinedParams[foundIdx].status = up.status;
          }
        }
      }
      for (const q of ep.queryParams || []) {
        if (!combinedParams.some((p) => p.name === q && p.in === 'query')) {
          combinedParams.push({
            name: q,
            in: 'query',
            type: 'string',
            status: 'UNKNOWN',
            source: 'observed',
          });
        }
      }

      const canonicalBaseUrl = ep.url.startsWith('http')
        ? (() => {
            try {
              const u = new URL(ep.url);
              return `${u.protocol}//${u.host}${canonical.pathname}`;
            } catch {
              return ep.url.split('?')[0];
            }
          })()
        : canonical.pathname;

      const existing = deduplicatedMap.get(key);

      if (existing) {
        // Merge source URLs
        const mergedSources = Array.from(new Set([...existing.sourceUrls, ...ep.sourceUrls]));
        existing.sourceUrls = mergedSources;

        // Merge parameters
        const existingParams = existing.possibleParameters || [];
        const mergedParams = [...existingParams];
        for (const cp of combinedParams) {
          const idx = mergedParams.findIndex((p) => p.name === cp.name && p.in === cp.in);
          if (idx === -1) {
            mergedParams.push(cp);
          } else if (!mergedParams[idx].sampleValue && cp.sampleValue) {
            mergedParams[idx] = { ...mergedParams[idx], sampleValue: cp.sampleValue };
          }
        }
        if (mergedParams.length > 0) {
          existing.possibleParameters = mergedParams;
          existing.queryParams = Array.from(new Set([
            ...(existing.queryParams || []),
            ...mergedParams.filter((p) => p.in === 'query').map((p) => p.name),
          ]));
        }

        // Preserve and prioritize probed data
        if (!existing.statusCode && ep.statusCode) {
          existing.statusCode = ep.statusCode;
          existing.latencyMs = ep.latencyMs;
          existing.contentType = ep.contentType;
          existing.responsePreview = ep.responsePreview;
        }
        if (!existing.snippet && ep.snippet) existing.snippet = ep.snippet;
        if (!existing.authHint && ep.authHint) existing.authHint = ep.authHint;
        if (!existing.sampleQueryUrl && ep.url.includes('?')) existing.sampleQueryUrl = ep.url;
      } else {
        deduplicatedMap.set(key, {
          ...ep,
          url: canonicalBaseUrl,
          pathname: canonical.pathname,
          possibleParameters: combinedParams.length > 0 ? combinedParams : undefined,
          queryParams: Array.from(new Set([
            ...(ep.queryParams || []),
            ...combinedParams.filter((p) => p.in === 'query').map((p) => p.name),
          ])),
          sampleQueryUrl: ep.url.includes('?') ? ep.url : ep.sampleQueryUrl,
        });
      }
    }

    return Array.from(deduplicatedMap.values());
  }, [apiEndpoints, localEndpoints]);

  // Response type counts for filtering indicators
  const responseTypeCounts = useMemo(() => {
    const counts = { '2XX': 0, '3XX': 0, '4XX': 0, '5XX': 0, UNPROBED: 0, ALL: activeEndpoints.length };
    for (const ep of activeEndpoints) {
      const code = ep.statusCode || 0;
      if (code >= 200 && code < 300) counts['2XX']++;
      else if (code >= 300 && code < 400) counts['3XX']++;
      else if (code >= 400 && code < 500) counts['4XX']++;
      else if (code >= 500 && code < 600) counts['5XX']++;
      else counts.UNPROBED++;
    }
    return counts;
  }, [activeEndpoints]);

  // Unique domains list
  const uniqueDomains = useMemo(() => {
    const set = new Set<string>();
    for (const ep of activeEndpoints) {
      if (ep.domain) set.add(ep.domain);
    }
    return Array.from(set).sort();
  }, [activeEndpoints]);

  const handleCopy = (text: string, id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleCopyAllUrls = () => {
    const text = sortedEndpoints.map((ep) => ep.url).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleCopyAllCurls = () => {
    const text = sortedEndpoints
      .map((ep) => {
        if (ep.method === 'POST') {
          return `curl -X POST "${ep.url}" -H "Accept: application/json" -H "Content-Type: application/json"`;
        }
        return `curl -X ${ep.method} "${ep.url}" -H "Accept: application/json"`;
      })
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopiedCurls(true);
    setTimeout(() => setCopiedCurls(false), 2000);
  };

  // Active Query & Mapping for a single endpoint
  const handleQueryAndMapEndpoint = async (endpoint: ApiEndpointRecord, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setProbingIds((prev) => ({ ...prev, [endpoint.id]: true }));

    try {
      const probeData = await probeApiEndpointDetails(endpoint.url, endpoint.method);

      const updated: ApiEndpointRecord = {
        ...endpoint,
        statusCode: probeData.statusCode || 200,
        latencyMs: probeData.latencyMs || 0,
        contentType: probeData.contentType || endpoint.contentType,
        allowedMethods: probeData.allowedMethods || endpoint.allowedMethods || [endpoint.method],
        possibleParameters: endpoint.possibleParameters,
        possibleQueries: endpoint.possibleQueries,
        sampleQueryUrl: endpoint.sampleQueryUrl,
        graphqlFields: endpoint.graphqlFields,
        responsePreview: probeData.responsePreview || endpoint.responsePreview,
        queryCapabilitiesSummary: endpoint.queryCapabilitiesSummary,
        authHint: endpoint.authHint,
        lastQueriedAt: Date.now(),
      };

      setLocalEndpoints((prev) => ({ ...prev, [endpoint.id]: updated }));
      if (onUpdateEndpoint) onUpdateEndpoint(updated);
    } catch (err: any) {
      setLocalEndpoints((prev) => ({
        ...prev,
        [endpoint.id]: {
          ...endpoint,
          statusCode: 0,
          latencyMs: 0,
          queryCapabilitiesSummary: `Network error: ${err.message || 'Request timed out'}`,
          lastQueriedAt: Date.now(),
        },
      }));
    } finally {
      setProbingIds((prev) => ({ ...prev, [endpoint.id]: false }));
    }
  };

  // Run specific query variation live
  const handleExecuteQueryVariation = async (
    endpoint: ApiEndpointRecord,
    query: ApiPossibleQuery,
    queryIndex: number,
    e?: React.MouseEvent
  ) => {
    if (e) e.stopPropagation();
    const key = `${endpoint.id}_q_${queryIndex}`;
    setRunningQueryKeys((prev) => ({ ...prev, [key]: true }));

    const start = Date.now();
    try {
      const probeData = await probeApiEndpointDetails(query.url, query.method);

      setQueryResults((prev) => ({
        ...prev,
        [key]: {
          status: probeData.statusCode || 200,
          latencyMs: probeData.latencyMs || (Date.now() - start),
          contentType: probeData.contentType,
          preview: probeData.responsePreview,
        },
      }));
    } catch (err: any) {
      setQueryResults((prev) => ({
        ...prev,
        [key]: {
          status: 0,
          latencyMs: Date.now() - start,
          error: err.message || 'Network error executing query',
        },
      }));
    } finally {
      setRunningQueryKeys((prev) => ({ ...prev, [key]: false }));
    }
  };

  // Batch Map All Endpoints
  const handleBatchMapAll = async () => {
    if (batchProbing || activeEndpoints.length === 0) return;
    setBatchProbing(true);
    setBatchProgress({ done: 0, total: activeEndpoints.length });

    const unprobed = activeEndpoints.filter((e) => !e.statusCode || e.statusCode === 0);
    const targetList = unprobed.length > 0 ? unprobed : activeEndpoints;

    for (let i = 0; i < targetList.length; i++) {
      const ep = targetList[i];
      await handleQueryAndMapEndpoint(ep);
      setBatchProgress({ done: i + 1, total: targetList.length });
      await new Promise((r) => setTimeout(r, 50));
    }

    setBatchProbing(false);
  };

  // Filter & Sort
  const sortedEndpoints = useMemo(() => {
    const filtered = activeEndpoints.filter((ep) => {
      // Scope filter
      if (selectedScope === 'SAME_DOMAIN' && !ep.isSameDomain) return false;
      if (selectedScope === 'EXTERNAL' && ep.isSameDomain) return false;

      // Domain filter
      if (selectedDomain !== 'ALL' && ep.domain !== selectedDomain) return false;

      // Method filter
      if (selectedMethod !== 'ALL' && ep.method !== selectedMethod) return false;

      // Category filter
      if (selectedCategory !== 'ALL' && ep.category !== selectedCategory.toLowerCase()) return false;

      // Response Type filter (2XX, 3XX, 4XX, 5XX, UNPROBED)
      if (selectedResponseType !== 'ALL') {
        const code = ep.statusCode || 0;
        if (selectedResponseType === '2XX') {
          if (code < 200 || code >= 300) return false;
        } else if (selectedResponseType === '3XX') {
          if (code < 300 || code >= 400) return false;
        } else if (selectedResponseType === '4XX') {
          if (code < 400 || code >= 500) return false;
        } else if (selectedResponseType === '5XX') {
          if (code < 500 || code >= 600) return false;
        } else if (selectedResponseType === 'UNPROBED') {
          if (code > 0) return false;
        }
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesUrl = ep.url.toLowerCase().includes(q);
        const matchesPath = ep.pathname.toLowerCase().includes(q);
        const matchesDomain = ep.domain.toLowerCase().includes(q);
        const matchesParams = ep.queryParams.some((p) => p.toLowerCase().includes(q));
        const matchesPossibleParams = (ep.possibleParameters || []).some((p) => p.name.toLowerCase().includes(q));
        const matchesSnippet = ep.snippet ? ep.snippet.toLowerCase().includes(q) : false;
        if (
          !matchesUrl &&
          !matchesPath &&
          !matchesDomain &&
          !matchesParams &&
          !matchesPossibleParams &&
          !matchesSnippet
        ) {
          return false;
        }
      }

      return true;
    });

    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'domain-asc':
          return a.domain.localeCompare(b.domain) || a.pathname.localeCompare(b.pathname);
        case 'domain-desc':
          return b.domain.localeCompare(a.domain) || a.pathname.localeCompare(b.pathname);
        case 'path-asc':
          return a.pathname.localeCompare(b.pathname) || a.domain.localeCompare(b.domain);
        case 'path-desc':
          return b.pathname.localeCompare(a.pathname) || a.domain.localeCompare(b.domain);
        case 'status':
          return (b.statusCode || 0) - (a.statusCode || 0) || a.domain.localeCompare(b.domain);
        case 'latency':
          return (a.latencyMs || 99999) - (b.latencyMs || 99999);
        case 'queries':
          return (b.possibleQueries?.length || 0) - (a.possibleQueries?.length || 0);
        case 'method':
          return a.method.localeCompare(b.method) || a.domain.localeCompare(b.domain);
        default:
          return a.domain.localeCompare(b.domain);
      }
    });
  }, [activeEndpoints, selectedScope, selectedDomain, selectedMethod, selectedCategory, selectedResponseType, searchQuery, sortBy]);

  // Grouped by domain if viewMode === 'grouped-domain'
  const domainGroups = useMemo(() => {
    if (viewMode !== 'grouped-domain') return null;
    const map = new Map<string, ApiEndpointRecord[]>();
    for (const ep of sortedEndpoints) {
      if (!map.has(ep.domain)) {
        map.set(ep.domain, []);
      }
      map.get(ep.domain)!.push(ep);
    }
    return Array.from(map.entries()).map(([domain, endpoints]) => ({
      domain,
      isSameDomain: endpoints.some((e) => e.isSameDomain),
      endpoints,
    }));
  }, [viewMode, sortedEndpoints]);

  // Pagination for table view
  const totalRowCount = sortedEndpoints.length;
  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(totalRowCount / Number(pageSize)));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const displayedRows = useMemo(() => {
    if (pageSize === 'all') return sortedEndpoints;
    const size = Number(pageSize);
    const start = (safeCurrentPage - 1) * size;
    return sortedEndpoints.slice(start, start + size);
  }, [sortedEndpoints, pageSize, safeCurrentPage]);

  const toggleDomainCollapse = (domain: string) => {
    setCollapsedDomains((prev) => ({ ...prev, [domain]: !prev[domain] }));
  };

  // Standardized badge helpers matching PagesLogView styling
  const getMethodBadge = (_method: ApiMethod) => {
    return 'font-bold text-[#f0f0f0] uppercase';
  };

  const getCategoryBadge = (_cat: ApiCategory) => {
    return 'font-mono text-xs text-[#8c8c8c] uppercase shrink-0';
  };

  // Status code text matching PagesLogView
  const renderStatusBadge = (statusCode?: number, latencyMs?: number, isProbing?: boolean) => {
    if (isProbing) {
      return (
        <span className="font-bold text-[#c30800] animate-pulse">
          PROBING
        </span>
      );
    }
    if (!statusCode || statusCode === 0) {
      return (
        <span className="font-bold text-[#737373]">
          UNQUERIED
        </span>
      );
    }
    if (statusCode >= 200 && statusCode < 300) {
      return (
        <span className="font-bold text-[#bbc300]">
          HTTP {statusCode}
          {latencyMs !== undefined && latencyMs > 0 && (
            <span className="text-[#8c8c8c] font-normal text-[10px] ml-1">({latencyMs}ms)</span>
          )}
        </span>
      );
    }
    if (statusCode >= 300 && statusCode < 400) {
      return (
        <span className="font-bold text-[#c36a00]">
          HTTP {statusCode}
          {latencyMs !== undefined && latencyMs > 0 && (
            <span className="text-[#8c8c8c] font-normal text-[10px] ml-1">({latencyMs}ms)</span>
          )}
        </span>
      );
    }
    return (
      <span className="font-bold text-[#c3005a]">
        HTTP {statusCode}
        {latencyMs !== undefined && latencyMs > 0 && (
          <span className="text-[#8c8c8c] font-normal text-[10px] ml-1">({latencyMs}ms)</span>
        )}
      </span>
    );
  };

  // Stats calculation
  const totalCount = activeEndpoints.length;
  const sameDomainCount = activeEndpoints.filter((e) => e.isSameDomain).length;
  const externalCount = totalCount - sameDomainCount;
  const probedCount = activeEndpoints.filter((e) => e.statusCode !== undefined && e.statusCode > 0).length;
  const totalQueriesMapped = activeEndpoints.reduce((acc, e) => acc + (e.possibleQueries?.length || 0), 0);

  // Render individual endpoint query & parameter details drawer
  const renderEndpointDetailsDrawer = (ep: ApiEndpointRecord) => {
    const possibleParams = ep.possibleParameters || [];
    const possibleQueries = ep.possibleQueries || [];

    return (
      <div className="p-4 bg-[#0d0d0d] border-t border-[#383838] space-y-4">
        {/* Section 1: Parameters Table */}
        {possibleParams.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-[#f0f0f0] uppercase tracking-wider flex items-center gap-1.5">
                <ListFilter className="w-3.5 h-3.5 text-[#c30800]" />
                Known Query Parameters &amp; Schema ({possibleParams.length})
              </span>
            </div>

            <div className="overflow-x-auto border border-[#383838]">
              <table className="w-full table-fixed text-left font-mono text-[11px]">
                <colgroup>
                  <col className="w-[200px] sm:w-[240px]" />
                  <col className="w-[85px] sm:w-[95px]" />
                  <col className="w-[85px] sm:w-[95px]" />
                  <col className="w-[100px] sm:w-[110px]" />
                  <col />
                </colgroup>
                <thead className="bg-[#141414] text-[#8c8c8c] border-b border-[#383838]">
                  <tr>
                    <th className="py-1.5 px-3 w-[200px] sm:w-[240px]">Parameter</th>
                    <th className="py-1.5 px-2 w-[85px] sm:w-[95px]">Location</th>
                    <th className="py-1.5 px-2 w-[85px] sm:w-[95px]">Type</th>
                    <th className="py-1.5 px-2 w-[100px] sm:w-[110px]">Status</th>
                    <th className="py-1.5 px-3">Description &amp; Sample</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2e2e2e]">
                  {possibleParams.map((p, idx) => (
                    <tr key={idx} className="hover:bg-[#1a1a1a]">
                      <td className="py-1.5 px-3 text-[#f0f0f0] font-bold truncate" title={p.in === 'path' ? `:${p.name}` : `?${p.name}`}>
                        {p.in === 'path' ? `:${p.name}` : `?${p.name}`}
                      </td>
                      <td className="py-1.5 px-2 truncate">
                        <span className="font-mono text-xs text-[#8c8c8c] uppercase">
                          {p.in}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-[#f0f0f0] truncate">{p.type || 'string'}</td>
                      <td className="py-1.5 px-2 truncate">
                        {(() => {
                          const status: 'REQUIRED' | 'OPTIONAL' | 'UNKNOWN' =
                            p.status === 'REQUIRED' || p.required === true
                              ? 'REQUIRED'
                              : p.status === 'OPTIONAL' || (p.required === false && p.status !== 'UNKNOWN')
                              ? 'OPTIONAL'
                              : 'UNKNOWN';
                          const colorClass =
                            status === 'REQUIRED'
                              ? 'text-[#c30800]'
                              : status === 'OPTIONAL'
                              ? 'text-[#8c8c8c]'
                              : 'text-[#c36a00]';
                          return (
                            <span className={`font-mono text-xs font-semibold ${colorClass}`}>
                              {status}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="py-1.5 px-3 text-[#8c8c8c] break-all">
                        {p.description &&
                        !p.description.startsWith('Observed query parameter') &&
                        !p.description.startsWith('Query parameter') ? (
                          <>
                            <span>{p.description}</span>
                            {p.sampleValue && (
                              <span className="ml-2 text-[#737373]">
                                (sample: <code className="text-[#f0f0f0]">{p.sampleValue}</code>)
                              </span>
                            )}
                          </>
                        ) : p.sampleValue ? (
                          <span className="text-[#737373]">
                            sample: <code className="text-[#f0f0f0]">{p.sampleValue}</code>
                          </span>
                        ) : (
                          <span className="text-[#737373]">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}



        {/* Discovery Context */}
        <div className="flex items-center justify-between text-[11px] font-mono text-[#8c8c8c] pt-2 border-t border-[#2e2e2e]">
          <div className="flex items-center gap-2 flex-wrap">
            <span>
              Detected via: <span className="text-[#f0f0f0]">{ep.detectedIn}</span>
            </span>
            <span>•</span>
            <span className="truncate max-w-[300px] sm:max-w-md" title={ep.sourceUrl}>
              Found on: <span className="text-[#f0f0f0]">{ep.sourceUrl}</span>
            </span>
            {ep.sourceUrls.length > 1 && (
              <span className="text-[10px] text-[#737373]">
                (+{ep.sourceUrls.length - 1} other references)
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (activeEndpoints.length === 0) {
    return (
      <div id="api-endpoints-empty" className="p-12 text-center bg-[#141414] border border-[#383838] rounded-none shadow-md">
        <Code className="w-10 h-10 text-[#737373] mx-auto mb-3" />
        <h3 className="text-sm font-mono font-bold uppercase tracking-wider text-[#f0f0f0]">No API Endpoints Discovered Yet</h3>
        <p className="text-xs text-[#8c8c8c] font-mono max-w-md mx-auto mt-1">
          Initiate crawl above with &quot;Capture API calls&quot; to scan DOM links, forms, scripts, and REST/GraphQL endpoints.
        </p>
      </div>
    );
  }

  return (
    <div id="api-endpoints-container" className="space-y-4">
      {/* Overview Stat Cards Grid - Icons standardized to #c30800 matching CrawlMetrics & DomainIntelligence */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 font-mono">
        <div className="p-3.5 rounded-none bg-[#141414] border border-[#383838] shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider font-semibold">Total APIs</span>
            <Code className="w-3.5 h-3.5 text-[#c30800]" />
          </div>
          <p className="text-xl font-bold text-[#f0f0f0] mt-0.5">{totalCount}</p>
        </div>
        <div className="p-3.5 rounded-none bg-[#141414] border border-[#383838] shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider font-semibold">Same Domain</span>
            <Globe className="w-3.5 h-3.5 text-[#c30800]" />
          </div>
          <p className="text-xl font-bold text-[#f0f0f0] mt-0.5">{sameDomainCount}</p>
        </div>
        <div className="p-3.5 rounded-none bg-[#141414] border border-[#383838] shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider font-semibold">External APIs</span>
            <Network className="w-3.5 h-3.5 text-[#c30800]" />
          </div>
          <p className="text-xl font-bold text-[#f0f0f0] mt-0.5">{externalCount}</p>
        </div>
        <div className="p-3.5 rounded-none bg-[#141414] border border-[#383838] shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider font-semibold">Queried / Probed</span>
            <Activity className="w-3.5 h-3.5 text-[#c30800]" />
          </div>
          <p className="text-xl font-bold text-[#f0f0f0] mt-0.5">{probedCount}</p>
        </div>
        <div className="p-3.5 rounded-none bg-[#141414] border border-[#383838] shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider font-semibold">Mapped Queries</span>
            <Zap className="w-3.5 h-3.5 text-[#c30800]" />
          </div>
          <p className="text-xl font-bold text-[#f0f0f0] mt-0.5">{totalQueriesMapped}</p>
        </div>
        <div className="p-3.5 rounded-none bg-[#141414] border border-[#383838] shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-[#8c8c8c] tracking-wider font-semibold">Domains</span>
            <Server className="w-3.5 h-3.5 text-[#c30800]" />
          </div>
          <p className="text-xl font-bold text-[#f0f0f0] mt-0.5">{uniqueDomains.length}</p>
        </div>
      </div>

      {/* Main Standardized Section Card */}
      <div id="api-endpoints-matrix-card" className="bg-[#141414] border border-[#383838] rounded-none overflow-hidden flex flex-col shadow-md relative">
        <div className="h-[2px] w-full bg-gradient-to-r from-[#c30800] via-[#c300bb] to-[#bbc300]" />

        {/* Section Header */}
        <div className="px-6 py-3.5 bg-[#141414] backdrop-blur-sm bg-gradient-to-r from-[#c30800]/10 via-transparent to-transparent flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-[#383838]">
          <div className="flex items-center flex-wrap gap-2.5">
            <span className="w-2 h-2 bg-[#c30800] shrink-0" />
            <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-[#f0f0f0]">
              API Endpoints &amp; Query Matrix
            </h2>
          </div>

          <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
            {/* Query & Map All APIs */}
            <button
              type="button"
              onClick={handleBatchMapAll}
              disabled={batchProbing || activeEndpoints.length === 0}
              className="px-2.5 py-1 bg-[#141414] hover:bg-[#262626] border border-[#383838] rounded-none text-[#f0f0f0] text-[10px] font-mono uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shrink-0 font-semibold"
              title="Actively query all detected APIs to map allowed methods, response schemas, and possible queries"
            >
              <Zap className={`w-3.5 h-3.5 ${batchProbing ? 'animate-spin text-[#c30800]' : 'text-[#c30800]'}`} />
              <span>
                {batchProbing
                  ? `Mapping (${batchProgress.done}/${batchProgress.total})...`
                  : 'Query & Map All APIs'}
              </span>
            </button>

            {/* Copy URLs */}
            <button
              type="button"
              onClick={handleCopyAllUrls}
              disabled={sortedEndpoints.length === 0}
              className="px-2.5 py-1 bg-[#141414] hover:bg-[#262626] border border-[#383838] rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] text-[10px] font-mono uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shrink-0 font-semibold"
              title="Copy all filtered URLs to clipboard"
            >
              {copiedAll ? <Check className="w-3.5 h-3.5 text-[#c30800]" /> : <Copy className="w-3.5 h-3.5 text-[#8c8c8c]" />}
              <span>{copiedAll ? 'COPIED' : 'COPY URLS'}</span>
            </button>

            {/* Copy cURLs */}
            <button
              type="button"
              onClick={handleCopyAllCurls}
              disabled={sortedEndpoints.length === 0}
              className="px-2.5 py-1 bg-[#141414] hover:bg-[#262626] border border-[#383838] rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] text-[10px] font-mono uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shrink-0 font-semibold"
              title="Copy all endpoints as cURL commands"
            >
              {copiedCurls ? <Check className="w-3.5 h-3.5 text-[#c30800]" /> : <Code className="w-3.5 h-3.5 text-[#8c8c8c]" />}
              <span>{copiedCurls ? 'COPIED' : 'COPY CURLS'}</span>
            </button>

            {/* View Mode Toggle: [Unified Table] vs [Group Subdomains] */}
            <div className="flex items-center gap-1 font-mono text-xs bg-[#0d0d0d] p-0.5 rounded-none border border-[#2e2e2e] shrink-0">
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`px-2.5 py-1 rounded-none text-[10px] font-mono uppercase tracking-wider transition-colors cursor-pointer flex items-center gap-1.5 ${
                  viewMode === 'table'
                    ? 'bg-[#1a1a1a] text-[#f0f0f0] font-semibold border border-[#c30800]'
                    : 'bg-[#141414] text-[#8c8c8c] hover:text-[#f0f0f0] border border-[#2e2e2e]'
                }`}
                title="View all endpoints in a sortable, unified table"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Unified Table</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('grouped-domain')}
                className={`px-2.5 py-1 rounded-none text-[10px] font-mono uppercase tracking-wider transition-colors cursor-pointer flex items-center gap-1.5 ${
                  viewMode === 'grouped-domain'
                    ? 'bg-[#1a1a1a] text-[#f0f0f0] font-semibold border border-[#c30800]'
                    : 'bg-[#141414] text-[#8c8c8c] hover:text-[#f0f0f0] border border-[#2e2e2e]'
                }`}
                title="Group endpoints by domain hostnames"
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Group Subdomains</span>
              </button>
            </div>
          </div>
        </div>


            {/* Filter Controls Bar matching standard header styling */}
        <div className="p-3 bg-[#141414] border-b border-[#383838] flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            {/* Search */}
            <div className="relative flex-1 sm:w-64 min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-[#8c8c8c] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filter endpoints, params, paths"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1 bg-[#0d0d0d] border border-[#2e2e2e] rounded-none text-xs text-[#f0f0f0] placeholder-[#737373] focus:outline-none focus:border-[#c30800] font-mono"
              />
            </div>

            {/* Domain Filter Dropdown */}
            <div className="flex items-center gap-1">
              <Globe className="w-3.5 h-3.5 text-[#c30800]" />
              <select
                value={selectedDomain}
                onChange={(e) => setSelectedDomain(e.target.value)}
                className="px-2.5 py-1 bg-[#141414] border border-[#2e2e2e] rounded-none text-[10px] text-[#8c8c8c] hover:border-[#383838] focus:border-[#c30800] font-mono cursor-pointer uppercase tracking-wider"
              >
                <option value="ALL">ALL DOMAINS ({uniqueDomains.length})</option>
                {uniqueDomains.map((dom) => (
                  <option key={dom} value={dom}>
                    {dom === targetDomain ? `${dom} (TARGET)` : dom}
                  </option>
                ))}
              </select>
            </div>

            {/* Scope Selector */}
            <select
              value={selectedScope}
              onChange={(e) => setSelectedScope(e.target.value as any)}
              className="px-2.5 py-1 bg-[#141414] border border-[#2e2e2e] rounded-none text-[10px] text-[#8c8c8c] hover:border-[#383838] focus:border-[#c30800] font-mono cursor-pointer uppercase tracking-wider"
            >
              <option value="ALL">ALL SCOPE</option>
              <option value="SAME_DOMAIN">SAME DOMAIN</option>
              <option value="EXTERNAL">EXTERNAL APIS</option>
            </select>

            {/* Method Selector */}
            <select
              value={selectedMethod}
              onChange={(e) => setSelectedMethod(e.target.value)}
              className="px-2.5 py-1 bg-[#141414] border border-[#2e2e2e] rounded-none text-[10px] text-[#8c8c8c] hover:border-[#383838] focus:border-[#c30800] font-mono cursor-pointer uppercase tracking-wider"
            >
              <option value="ALL">ALL METHODS</option>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
              <option value="OPTIONS">OPTIONS</option>
            </select>

            {/* Category Selector */}
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-2.5 py-1 bg-[#141414] border border-[#2e2e2e] rounded-none text-[10px] text-[#8c8c8c] hover:border-[#383838] focus:border-[#c30800] font-mono cursor-pointer uppercase tracking-wider"
            >
              <option value="ALL">ALL CATEGORIES</option>
              <option value="REST">REST</option>
              <option value="GRAPHQL">GRAPHQL</option>
              <option value="RPC">RPC</option>
              <option value="AUTH">AUTH / OAUTH</option>
              <option value="JSON">STATIC JSON</option>
              <option value="WEBHOOK">WEBHOOK</option>
            </select>

            {/* Response Type Selector */}
            <select
              value={selectedResponseType}
              onChange={(e) => setSelectedResponseType(e.target.value)}
              className="px-2.5 py-1 bg-[#141414] border border-[#2e2e2e] rounded-none text-[10px] text-[#8c8c8c] hover:border-[#383838] focus:border-[#c30800] font-mono cursor-pointer uppercase tracking-wider"
              title="Filter by HTTP response status code class"
            >
              <option value="ALL">ALL RESPONSES ({responseTypeCounts.ALL})</option>
              <option value="2XX">2XX SUCCESS ({responseTypeCounts['2XX']})</option>
              <option value="3XX">3XX REDIRECT ({responseTypeCounts['3XX']})</option>
              <option value="4XX">4XX CLIENT ERR ({responseTypeCounts['4XX']})</option>
              <option value="5XX">5XX SERVER ERR ({responseTypeCounts['5XX']})</option>
              <option value="UNPROBED">UNPROBED ({responseTypeCounts.UNPROBED})</option>
            </select>
          </div>

          {/* Sort Controls - SORT BY DOMAIN */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] uppercase text-[#737373] flex items-center gap-1 font-semibold">
              <ArrowUpDown className="w-3 h-3 text-[#c30800]" />
              Sort:
            </span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="px-2.5 py-1 bg-[#141414] border border-[#2e2e2e] rounded-none text-[10px] text-[#8c8c8c] hover:border-[#383838] focus:border-[#c30800] font-mono cursor-pointer uppercase tracking-wider"
            >
              <option value="domain-asc">DOMAIN (A-Z)</option>
              <option value="domain-desc">DOMAIN (Z-A)</option>
              <option value="path-asc">PATH (A-Z)</option>
              <option value="path-desc">PATH (Z-A)</option>
              <option value="status">HTTP STATUS</option>
              <option value="latency">LATENCY (FASTEST)</option>
              <option value="queries">QUERIES MAPPED</option>
              <option value="method">METHOD</option>
            </select>
          </div>
        </div>

        {/* Content Area */}
        <div className="min-h-[300px]">
          {sortedEndpoints.length === 0 ? (
            <div className="p-12 text-center text-[#8c8c8c] font-mono text-xs">
              No API endpoints match the selected filters. Try adjusting your query or scope.
            </div>
          ) : viewMode === 'table' ? (
            /* Unified Table View matching DirectoryTableView */
            <div className="flex flex-col">
              {/* Table Header */}
              <div className="grid grid-cols-[80px_1fr_180px_110px_130px_110px] gap-2 px-6 py-2.5 bg-[#141414] border-b border-[#383838] text-[10px] text-[#8c8c8c] font-mono uppercase tracking-wider select-none font-bold">
                <div>Method</div>
                <div>Endpoint Path &amp; URL</div>
                <div>Domain / Host</div>
                <div>Category</div>
                <div>Live Status</div>
                <div className="text-right">Actions</div>
              </div>

              {/* Table Rows */}
              <div className="divide-y divide-[#2e2e2e]">
                {displayedRows.map((ep) => {
                  const isProbing = probingIds[ep.id] === true;
                  const isExpanded = expandedQueryIds[ep.id] === true;

                  return (
                    <React.Fragment key={ep.id}>
                      <div
                        onClick={() =>
                          setExpandedQueryIds((prev) => ({
                            ...prev,
                            [ep.id]: !prev[ep.id],
                          }))
                        }
                        className={`grid grid-cols-[80px_1fr_180px_110px_130px_110px] gap-2 px-6 py-3 items-center text-xs font-mono transition-colors cursor-pointer hover:bg-[#1a1a1a] ${
                          isExpanded ? 'bg-[#1a1a1a]' : ''
                        }`}
                      >
                        {/* Method */}
                        <div>
                          <span className={getMethodBadge(ep.method)}>
                            {ep.method}
                          </span>
                        </div>

                        {/* Endpoint Path & URL */}
                        <div className="min-w-0 pr-2">
                          <div className="flex items-center gap-1.5">
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-[#c30800] shrink-0" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
                            )}
                            <span className="font-bold text-[#f0f0f0] truncate" title={ep.pathname}>
                              {ep.pathname}
                            </span>
                            {ep.authHint && (
                              <span className="text-[10px] text-[#c30800] font-mono font-semibold shrink-0">
                                [{ep.authHint}]
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-[#737373] truncate pl-5 mt-0.5" title={ep.url}>
                            {ep.url}
                          </div>
                        </div>

                        {/* Domain / Host */}
                        <div className="min-w-0">
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedDomain(ep.domain);
                            }}
                            className="text-[11px] truncate block cursor-pointer text-[#f0f0f0] hover:text-[#c30800] hover:underline font-semibold"
                            title={`Filter by ${ep.domain}`}
                          >
                            {ep.domain}
                          </span>
                        </div>

                        {/* Category */}
                        <div>
                          <span className={getCategoryBadge(ep.category)}>
                            {ep.category}
                          </span>
                        </div>

                        {/* Live Status */}
                        <div>
                          {renderStatusBadge(ep.statusCode, ep.latencyMs, isProbing)}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          {/* Query API button */}
                          <button
                            type="button"
                            onClick={(e) => handleQueryAndMapEndpoint(ep, e)}
                            disabled={isProbing}
                            className="p-1 text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] rounded-none transition-colors cursor-pointer disabled:opacity-50"
                            title="Query endpoint to map schema"
                          >
                            <Zap className="w-3.5 h-3.5 text-[#c30800]" />
                          </button>

                          {/* Copy URL */}
                          <button
                            type="button"
                            onClick={(e) => handleCopy(ep.url, ep.id + '_url', e)}
                            className="p-1 text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] rounded-none transition-colors cursor-pointer"
                            title="Copy URL"
                          >
                            {copiedId === ep.id + '_url' ? (
                              <Check className="w-3.5 h-3.5 text-[#c30800]" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {/* Copy cURL */}
                          <button
                            type="button"
                            onClick={(e) => {
                              const curl =
                                ep.method === 'POST'
                                  ? `curl -X POST "${ep.url}" -H "Accept: application/json" -H "Content-Type: application/json"`
                                  : `curl -X ${ep.method} "${ep.url}" -H "Accept: application/json"`;
                              handleCopy(curl, ep.id + '_curl', e);
                            }}
                            className="p-1 text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] rounded-none transition-colors cursor-pointer"
                            title="Copy cURL command"
                          >
                            {copiedId === ep.id + '_curl' ? (
                              <Check className="w-3.5 h-3.5 text-[#c30800]" />
                            ) : (
                              <Code className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {/* Warning Navigation */}
                          {onOpenExternalWarning && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenExternalWarning(ep.url);
                              }}
                              className="p-1 text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] rounded-none transition-colors cursor-pointer"
                              title="Open in new window"
                            >
                              <ArrowUpRight className="w-3.5 h-3.5 text-[#737373]" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expandable Query & Parameter Drawer */}
                      {isExpanded && renderEndpointDetailsDrawer(ep)}
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Summary & Pagination Footer */}
              <div className="px-6 py-3 bg-[#141414] border-t border-[#383838] flex flex-col md:flex-row items-center justify-between gap-3 text-[10px] text-[#8c8c8c] font-mono">
                <div className="flex items-center gap-3 flex-wrap">
                  <span>
                    SHOWING {pageSize === 'all' ? sortedEndpoints.length : `${totalRowCount === 0 ? 0 : (safeCurrentPage - 1) * Number(pageSize) + 1}–${Math.min(safeCurrentPage * Number(pageSize), totalRowCount)}`} OF {totalRowCount} APIS ({probedCount} QUERIED)
                    {selectedDomain !== 'ALL' ? ` [DOMAIN: ${selectedDomain}]` : ''}
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="text-[#737373] uppercase">Per Page:</span>
                    {(['25', '50', '100', 'all'] as const).map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setPageSize(size)}
                        className={`px-1.5 py-0.5 rounded-none border uppercase transition-colors cursor-pointer ${
                          pageSize === size
                            ? 'bg-[#1a1a1a] text-[#f0f0f0] border-[#c30800] font-semibold'
                            : 'bg-[#141414] text-[#8c8c8c] border-[#2e2e2e] hover:text-[#f0f0f0] hover:bg-[#262626]'
                        }`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
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
                    TOTAL QUERIES: {totalQueriesMapped}
                  </span>
                </div>
              </div>
            </div>
          ) : domainGroups ? (
            /* Grouped by Domain View matching ExternalLinksView */
            <div className="divide-y divide-[#383838]">
              {domainGroups.map((group) => {
                const isCollapsed = collapsedDomains[group.domain] === true;

                return (
                  <div key={group.domain} className="bg-[#141414]">
                    {/* Domain Header Row */}
                    <div
                      onClick={() => toggleDomainCollapse(group.domain)}
                      className="px-6 py-3.5 flex items-center justify-between cursor-pointer select-none bg-[#141414] hover:bg-[#1a1a1a] transition-colors border-b border-[#383838]"
                    >
                      <div className="flex items-center gap-2.5 flex-wrap">
                        {isCollapsed ? (
                          <ChevronRight className="w-4 h-4 text-[#8c8c8c]" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-[#c30800]" />
                        )}
                        <Globe className="w-4 h-4 text-[#c30800]" />
                        <span className="font-mono text-sm font-bold text-[#f0f0f0]">
                          {group.domain}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            for (const ep of group.endpoints) {
                              handleQueryAndMapEndpoint(ep);
                            }
                          }}
                          className="px-2.5 py-1 border border-[#383838] bg-[#141414] hover:bg-[#262626] font-mono text-[10px] text-[#f0f0f0] transition-colors cursor-pointer uppercase"
                          title="Query all endpoints in this domain"
                        >
                          QUERY DOMAIN
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const urls = group.endpoints.map((ep) => ep.url).join('\n');
                            navigator.clipboard.writeText(urls);
                            setCopiedId(group.domain + '_urls');
                            setTimeout(() => setCopiedId(null), 1800);
                          }}
                          className="px-2.5 py-1 border border-[#383838] bg-[#141414] hover:bg-[#262626] font-mono text-[10px] text-[#f0f0f0] transition-colors cursor-pointer uppercase"
                          title="Copy all URLs in this domain"
                        >
                          {copiedId === group.domain + '_urls' ? (
                            <span className="text-[#c30800] font-bold">COPIED</span>
                          ) : (
                            'COPY ALL'
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Domain Endpoints */}
                    {!isCollapsed && (
                      <div className="bg-[#0d0d0d] divide-y divide-[#2e2e2e]">
                        {group.endpoints.map((ep) => {
                          const isProbing = probingIds[ep.id] === true;
                          const isExpanded = expandedQueryIds[ep.id] === true;

                          return (
                            <div
                              key={ep.id}
                              className="transition-colors"
                            >
                              <div
                                onClick={() =>
                                  setExpandedQueryIds((prev) => ({
                                    ...prev,
                                    [ep.id]: !prev[ep.id],
                                  }))
                                }
                                className={`grid grid-cols-[80px_1fr_110px_130px_110px] gap-2 px-6 py-3 items-center text-xs font-mono transition-colors cursor-pointer hover:bg-[#1a1a1a] ${
                                  isExpanded ? 'bg-[#1a1a1a]' : 'bg-[#0d0d0d]'
                                }`}
                              >
                                {/* Method */}
                                <div>
                                  <span className={getMethodBadge(ep.method)}>
                                    {ep.method}
                                  </span>
                                </div>

                                {/* Endpoint Path & URL */}
                                <div className="min-w-0 pr-2">
                                  <div className="flex items-center gap-1.5">
                                    {isExpanded ? (
                                      <ChevronDown className="w-3.5 h-3.5 text-[#c30800] shrink-0" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5 text-[#8c8c8c] shrink-0" />
                                    )}
                                    <span className="font-bold text-[#f0f0f0] truncate" title={ep.pathname}>
                                      {ep.pathname}
                                    </span>
                                    {ep.authHint && (
                                      <span className="text-[10px] text-[#c30800] font-mono font-semibold shrink-0">
                                        [{ep.authHint}]
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-[#737373] truncate pl-5 mt-0.5" title={ep.url}>
                                    {ep.url}
                                  </div>
                                </div>

                                {/* Category */}
                                <div>
                                  <span className={getCategoryBadge(ep.category)}>
                                    {ep.category}
                                  </span>
                                </div>

                                {/* Live Status */}
                                <div>
                                  {renderStatusBadge(ep.statusCode, ep.latencyMs, isProbing)}
                                </div>

                                {/* Actions */}
                                <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                                  {/* Query API button */}
                                  <button
                                    type="button"
                                    onClick={(e) => handleQueryAndMapEndpoint(ep, e)}
                                    disabled={isProbing}
                                    className="p-1 text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] rounded-none transition-colors cursor-pointer disabled:opacity-50"
                                    title="Query endpoint to map schema"
                                  >
                                    <Zap className="w-3.5 h-3.5 text-[#c30800]" />
                                  </button>

                                  {/* Copy URL */}
                                  <button
                                    type="button"
                                    onClick={(e) => handleCopy(ep.url, ep.id + '_url', e)}
                                    className="p-1 text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] rounded-none transition-colors cursor-pointer"
                                    title="Copy URL"
                                  >
                                    {copiedId === ep.id + '_url' ? (
                                      <Check className="w-3.5 h-3.5 text-[#c30800]" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5" />
                                    )}
                                  </button>

                                  {/* Copy cURL */}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      const curl =
                                        ep.method === 'POST'
                                          ? `curl -X POST "${ep.url}" -H "Accept: application/json" -H "Content-Type: application/json"`
                                          : `curl -X ${ep.method} "${ep.url}" -H "Accept: application/json"`;
                                      handleCopy(curl, ep.id + '_curl', e);
                                    }}
                                    className="p-1 text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] rounded-none transition-colors cursor-pointer"
                                    title="Copy cURL command"
                                  >
                                    {copiedId === ep.id + '_curl' ? (
                                      <Check className="w-3.5 h-3.5 text-[#c30800]" />
                                    ) : (
                                      <Code className="w-3.5 h-3.5" />
                                    )}
                                  </button>

                                  {/* Warning Navigation */}
                                  {onOpenExternalWarning && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onOpenExternalWarning(ep.url);
                                      }}
                                      className="p-1 text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] rounded-none transition-colors cursor-pointer"
                                      title="Open in new window"
                                    >
                                      <ArrowUpRight className="w-3.5 h-3.5 text-[#737373]" />
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Expandable Query & Parameter Drawer */}
                              {isExpanded && renderEndpointDetailsDrawer(ep)}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

      </div>
    </div>
  );
};

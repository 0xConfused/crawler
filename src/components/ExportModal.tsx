// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  X,
  Download,
  Copy,
  Check,
  FileCode,
  FileSpreadsheet,
  FileText,
  Code2,
  Layers,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  DirectoryRecord,
  FileRecord,
  ApiEndpointRecord,
  ApiQueryParameter,
  ExternalLinkRecord,
  PageRecord,
  DomainIntelligence,
  CrawlConfig,
  CrawlStats,
  CrawlStatus,
} from '../types';
import {
  exportDirectoriesAsTxt,
  exportDirectoriesAsCsv,
  exportDirectoriesAsSitemapXml,
  buildDirectoryTree,
} from '../utils/urlUtils';

export type ExportScope = 'all' | 'directories' | 'files' | 'api' | 'links' | 'subdomains' | 'pages' | 'intel';
export type ExportFormat = 'json' | 'csv' | 'markdown' | 'txt-paths' | 'txt-full' | 'sitemap-xml';

interface ExportModalProps {
  directories: DirectoryRecord[];
  files?: FileRecord[];
  apiEndpoints?: ApiEndpointRecord[];
  externalLinks?: ExternalLinkRecord[];
  pages?: PageRecord[];
  logs?: Array<{ level: 'info' | 'warn' | 'error' | 'success'; message: string; timestamp: number }>;
  domainIntelligenceCache?: Record<string, DomainIntelligence>;
  config?: CrawlConfig;
  stats?: CrawlStats;
  status?: CrawlStatus;
  currentDomain?: string | null;
  whoisTargetDomain?: string | null;
  targetOrigin: string;
  onClose: () => void;
  onImport?: (file: File) => void;
}

// Scopes and which output encoding formats are permitted
// Irrelevant formats are strictly excluded per scope
const SCOPE_FORMAT_COMPATIBILITY: Record<ExportScope, ExportFormat[]> = {
  all: ['json', 'csv', 'markdown', 'sitemap-xml', 'txt-full', 'txt-paths'],
  directories: ['txt-paths', 'txt-full', 'csv', 'json', 'sitemap-xml', 'markdown'],
  files: ['txt-paths', 'txt-full', 'csv', 'json', 'markdown'], // sitemap-xml excluded: static assets are not sitemap pages
  api: ['json', 'csv', 'markdown', 'txt-full'], // sitemap-xml & txt-paths excluded: APIs are endpoints with methods & params, not sitemap pages
  links: ['txt-full', 'csv', 'json', 'markdown'], // sitemap-xml & txt-paths excluded: 3rd-party domains cannot be in XML sitemap or local relative paths
  subdomains: ['txt-full', 'csv', 'json', 'markdown'], // Wordlist txt, CSV matrix, JSON, Markdown
  pages: ['txt-paths', 'txt-full', 'csv', 'json', 'sitemap-xml', 'markdown'],
  intel: ['json', 'markdown', 'csv'], // sitemap-xml, txt-paths, txt-full excluded: DNS/WHOIS/SSL are not URL paths
};

const FORMAT_METADATA: Record<
  ExportFormat,
  { label: string; sublabel: string; icon: React.ComponentType<{ className?: string }> }
> = {
  json: {
    label: 'JSON Schema',
    sublabel: 'Full state / graph payload',
    icon: Code2,
  },
  csv: {
    label: 'CSV Spreadsheet',
    sublabel: 'Tabular matrix format',
    icon: FileSpreadsheet,
  },
  markdown: {
    label: 'Markdown Summary',
    sublabel: 'Document formatted report',
    icon: Layers,
  },
  'txt-paths': {
    label: 'Plain Text Paths',
    sublabel: '1 relative path per line',
    icon: FileText,
  },
  'txt-full': {
    label: 'Absolute URLs',
    sublabel: 'Includes origin & protocol',
    icon: FileText,
  },
  'sitemap-xml': {
    label: 'XML Sitemap',
    sublabel: 'Standard <urlset> schema',
    icon: FileCode,
  },
};

export const ExportModal: React.FC<ExportModalProps> = ({
  directories,
  files = [],
  apiEndpoints = [],
  externalLinks = [],
  pages = [],
  logs = [],
  domainIntelligenceCache = {},
  config,
  stats,
  status = 'completed',
  currentDomain,
  whoisTargetDomain,
  targetOrigin,
  onClose,
}) => {
  const [scope, setScope] = useState<ExportScope>('all');
  const [format, setFormat] = useState<ExportFormat>('json');
  const [copied, setCopied] = useState(false);
  const scopeScrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const checkScrollState = () => {
    const el = scopeScrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  };

  useEffect(() => {
    checkScrollState();
    const timeoutId = setTimeout(checkScrollState, 60);
    const el = scopeScrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkScrollState, { passive: true });
    window.addEventListener('resize', checkScrollState);
    return () => {
      clearTimeout(timeoutId);
      el.removeEventListener('scroll', checkScrollState);
      window.removeEventListener('resize', checkScrollState);
    };
  }, []);

  const handleScrollLeft = () => {
    if (scopeScrollRef.current) {
      scopeScrollRef.current.scrollBy({ left: -200, behavior: 'smooth' });
    }
  };

  const handleScrollRight = () => {
    if (scopeScrollRef.current) {
      scopeScrollRef.current.scrollBy({ left: 200, behavior: 'smooth' });
    }
  };

  const allowedFormats = useMemo(() => {
    return SCOPE_FORMAT_COMPATIBILITY[scope] || ['json'];
  }, [scope]);

  // If selected format is not allowed for the new scope, automatically switch to first allowed format
  useEffect(() => {
    if (!allowedFormats.includes(format)) {
      setFormat(allowedFormats[0]);
    }
  }, [scope, allowedFormats, format]);

  const discoveredSubdomains = useMemo(() => {
    const set = new Set<string>();
    directories.forEach((d) => {
      if (d.domain) set.add(d.domain);
    });
    files.forEach((f) => {
      if (f.domain) set.add(f.domain);
    });
    externalLinks.forEach((l) => {
      if (l.domain) set.add(l.domain);
    });
    (Object.values(domainIntelligenceCache) as DomainIntelligence[]).forEach((intel) => {
      intel.ssl?.san?.forEach((san) => {
        const clean = san.toLowerCase().trim().replace(/^\*\./, '');
        if (clean) set.add(clean);
      });
      intel.crtSubdomains?.subdomains?.forEach((sub) => {
        const clean = sub.toLowerCase().trim().replace(/^\*\./, '');
        if (clean) set.add(clean);
      });
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [directories, files, externalLinks, domainIntelligenceCache]);

  const exportData = useMemo(() => {
    const origin = targetOrigin ? targetOrigin.replace(/\/+$/, '') : '';
    const activeDomain = currentDomain || (origin ? new URL(origin).hostname : '');

    switch (format) {
      case 'json': {
        if (scope === 'all') {
          // Omit proxy settings and API keys from exported configuration
          const sanitizedConfig = config
            ? (() => {
                const {
                  corsProxyMode: _cpm,
                  customProxyUrl: _cpu,
                  customProxyConfig: _cpc,
                  stealthApiKey: _sak,
                  ...safeConfig
                } = config;
                return safeConfig;
              })()
            : null;

          return JSON.stringify(
            {
              version: '2.0',
              generator: '0xCONFUSED/crawler',
              generatedAt: new Date().toISOString(),
              targetOrigin,
              currentDomain: activeDomain,
              whoisTargetDomain: whoisTargetDomain || activeDomain,
              status,
              config: sanitizedConfig,
              stats: stats || null,
              summary: {
                totalUniqueDirectories: directories.length,
                totalDiscoveredFiles: files.length,
                totalCapturedApiEndpoints: apiEndpoints.length,
                totalExternalLinks: externalLinks.length,
                totalDiscoveredSubdomains: discoveredSubdomains.length,
                totalPages: pages.length,
                totalLogs: logs.length,
                cachedDomainsCount: Object.keys(domainIntelligenceCache).length,
              },
              directories,
              files,
              apiEndpoints,
              externalLinks,
              subdomains: discoveredSubdomains,
              pages,
              logs,
              domainIntelligenceCache,
              tree: buildDirectoryTree(directories, files),
            },
            null,
            2
          );
        } else if (scope === 'directories') {
          return JSON.stringify(
            {
              targetOrigin,
              generatedAt: new Date().toISOString(),
              totalDirectories: directories.length,
              directories,
              tree: buildDirectoryTree(directories, []),
            },
            null,
            2
          );
        } else if (scope === 'files') {
          return JSON.stringify(
            {
              targetOrigin,
              generatedAt: new Date().toISOString(),
              totalFiles: files.length,
              files,
            },
            null,
            2
          );
        } else if (scope === 'api') {
          return JSON.stringify(
            {
              targetOrigin,
              generatedAt: new Date().toISOString(),
              totalApiEndpoints: apiEndpoints.length,
              apiEndpoints,
            },
            null,
            2
          );
        } else if (scope === 'links') {
          return JSON.stringify(
            {
              targetOrigin,
              generatedAt: new Date().toISOString(),
              totalExternalLinks: externalLinks.length,
              externalLinks,
            },
            null,
            2
          );
        } else if (scope === 'pages') {
          return JSON.stringify(
            {
              targetOrigin,
              generatedAt: new Date().toISOString(),
              totalPages: pages.length,
              pages,
            },
            null,
            2
          );
        } else if (scope === 'subdomains') {
          return JSON.stringify(
            {
              targetOrigin,
              generatedAt: new Date().toISOString(),
              totalSubdomains: discoveredSubdomains.length,
              subdomains: discoveredSubdomains,
            },
            null,
            2
          );
        } else if (scope === 'intel') {
          return JSON.stringify(
            {
              targetOrigin,
              generatedAt: new Date().toISOString(),
              cachedDomainsCount: Object.keys(domainIntelligenceCache).length,
              domainIntelligenceCache,
            },
            null,
            2
          );
        }
        return '';
      }

      case 'csv': {
        if (scope === 'directories') {
          return exportDirectoriesAsCsv(directories, targetOrigin, [], 'dirs');
        } else if (scope === 'files') {
          return exportDirectoriesAsCsv([], targetOrigin, files, 'files');
        } else if (scope === 'subdomains') {
          const rows = [['Hostname / Subdomain', 'Discovery Type'].join(',')];
          for (const s of discoveredSubdomains) {
            rows.push([`"${s.replace(/"/g, '""')}"`, '"Subdomain / TLS SAN"'].join(','));
          }
          return rows.join('\n');
        } else if (scope === 'api') {
          const rows = [
            ['Method', 'Pathname', 'Full URL', 'Domain', 'Category', 'Allowed Methods', 'Status Code', 'Latency (ms)', 'Detected In', 'Source URL'].join(','),
          ];
          for (const ep of apiEndpoints) {
            rows.push(
              [
                `"${ep.method}"`,
                `"${ep.pathname}"`,
                `"${ep.url}"`,
                `"${ep.domain}"`,
                `"${ep.category}"`,
                `"${(ep.allowedMethods || [ep.method]).join('|')}"`,
                ep.statusCode || '',
                ep.latencyMs || '',
                `"${ep.detectedIn}"`,
                `"${ep.sourceUrl}"`,
              ].join(',')
            );
          }
          return rows.join('\n');
        } else if (scope === 'links') {
          const rows = [
            ['URL', 'Domain', 'Root Domain', 'Pathname', 'Is Asset/File', 'File Type', 'Extension', 'Found On URL', 'Tag Type', 'Link Text'].join(','),
          ];
          for (const l of externalLinks) {
            rows.push(
              [
                `"${l.url}"`,
                `"${l.domain}"`,
                `"${l.rootDomain || ''}"`,
                `"${l.pathname}"`,
                l.isAssetOrFile ? 'true' : 'false',
                `"${l.fileType || ''}"`,
                `"${l.extension || ''}"`,
                `"${l.foundOnUrl}"`,
                `"${l.tagType || 'a'}"`,
                `"${(l.linkText || '').replace(/"/g, '""')}"`,
              ].join(',')
            );
          }
          return rows.join('\n');
        } else if (scope === 'pages') {
          const rows = [
            ['Status Code', 'Status Text', 'Method', 'URL', 'Pathname', 'Title', 'Content-Type', 'Duration (ms)', 'Discovered Links', 'Parent URL', 'Error'].join(','),
          ];
          for (const p of pages) {
            rows.push(
              [
                p.statusCode,
                `"${p.statusText}"`,
                `"${p.method || 'GET'}"`,
                `"${p.url}"`,
                `"${p.pathname}"`,
                `"${(p.title || '').replace(/"/g, '""')}"`,
                `"${p.contentType}"`,
                p.durationMs,
                p.discoveredLinksCount,
                `"${p.parentUrl || ''}"`,
                `"${(p.error || '').replace(/"/g, '""')}"`,
              ].join(',')
            );
          }
          return rows.join('\n');
        } else if (scope === 'intel') {
          const rows = [
            ['Domain', 'Record Type', 'Name', 'Value', 'TTL', 'Section'].join(','),
          ];
          for (const [dom, intelRaw] of Object.entries(domainIntelligenceCache)) {
            const intel = intelRaw as DomainIntelligence;
            if (intel.dns && intel.dns.length > 0) {
              for (const record of intel.dns) {
                rows.push(
                  [
                    `"${dom}"`,
                    `"${record.type}"`,
                    `"${record.name}"`,
                    `"${(record.value || '').replace(/"/g, '""')}"`,
                    record.ttl || '',
                    '"DNS"',
                  ].join(',')
                );
              }
            }
            if (intel.whois) {
              rows.push(
                [
                  `"${dom}"`,
                  '"REGISTRAR"',
                  `"${intel.whois.domainName}"`,
                  `"${intel.whois.registrar || ''}"`,
                  '',
                  '"WHOIS"',
                ].join(',')
              );
            }
            if (intel.server) {
              rows.push(
                [
                  `"${dom}"`,
                  '"SERVER_BANNER"',
                  `"${intel.server.server || ''}"`,
                  `"Status ${intel.server.statusCode || 200}"`,
                  '',
                  '"HTTP_HEADER"',
                ].join(',')
              );
            }
          }
          return rows.join('\n');
        } else {
          // 'all' scope: combined multi-type CSV
          const baseCsv = exportDirectoriesAsCsv(directories, targetOrigin, files, 'all');
          const extraRows: string[] = [];

          if (apiEndpoints.length > 0) {
            extraRows.push('\n# API Endpoints');
            extraRows.push('Type,Subdomain / Host,Path / Filename,Category,Where Found,Full URL,Depth Level,Direct Count / Ext,First Discovered');
            for (const ep of apiEndpoints) {
              extraRows.push(
                [
                  '"API"',
                  `"${ep.domain}"`,
                  `"${ep.pathname}"`,
                  `"${ep.category}"`,
                  `"${ep.sourceUrl}"`,
                  `"${ep.url}"`,
                  0,
                  `"${ep.method} ${ep.statusCode || ''}"`,
                  `"${new Date(ep.firstDiscoveredAt).toISOString()}"`,
                ].join(',')
              );
            }
          }

          if (externalLinks.length > 0) {
            extraRows.push('\n# External Links');
            extraRows.push('Type,Subdomain / Host,Path / Filename,Category,Where Found,Full URL,Depth Level,Direct Count / Ext,First Discovered');
            for (const l of externalLinks) {
              extraRows.push(
                [
                  '"ExternalLink"',
                  `"${l.domain}"`,
                  `"${l.pathname}"`,
                  `"${l.fileType || 'external'}"`,
                  `"${l.foundOnUrl}"`,
                  `"${l.url}"`,
                  0,
                  `"${l.extension || ''}"`,
                  `"${new Date(l.firstDiscoveredAt).toISOString()}"`,
                ].join(',')
              );
            }
          }

          return baseCsv + extraRows.join('\n');
        }
      }

      case 'txt-paths': {
        if (scope === 'directories') {
          return exportDirectoriesAsTxt(directories, '', [], 'dirs');
        } else if (scope === 'files') {
          return exportDirectoriesAsTxt([], '', files, 'files');
        } else if (scope === 'pages') {
          const pathSet = new Set<string>();
          for (const p of pages) {
            if (p.pathname) pathSet.add(p.pathname);
          }
          return Array.from(pathSet).sort().join('\n');
        } else {
          // 'all'
          const set = new Set<string>();
          for (const d of directories) set.add(d.path);
          for (const f of files) set.add(f.path);
          for (const p of pages) if (p.pathname) set.add(p.pathname);
          return Array.from(set).sort().join('\n');
        }
      }

      case 'txt-full': {
        if (scope === 'directories') {
          return exportDirectoriesAsTxt(directories, targetOrigin, [], 'dirs');
        } else if (scope === 'files') {
          return exportDirectoriesAsTxt([], targetOrigin, files, 'files');
        } else if (scope === 'api') {
          const urls = Array.from(new Set(apiEndpoints.map((e) => e.url))).sort();
          return urls.join('\n');
        } else if (scope === 'links') {
          const urls = Array.from(new Set(externalLinks.map((l) => l.url))).sort();
          return urls.join('\n');
        } else if (scope === 'subdomains') {
          return discoveredSubdomains.join('\n');
        } else if (scope === 'pages') {
          const urls = Array.from(new Set(pages.map((p) => p.url))).sort();
          return urls.join('\n');
        } else {
          // 'all'
          const set = new Set<string>();
          for (const d of directories) {
            const h = d.domain ? `https://${d.domain}` : origin;
            set.add(h ? `${h}${d.path}` : d.path);
          }
          for (const f of files) {
            const h = f.domain ? `https://${f.domain}` : origin;
            set.add(f.url || (h ? `${h}${f.path}` : f.path));
          }
          for (const p of pages) set.add(p.url);
          for (const e of apiEndpoints) set.add(e.url);
          return Array.from(set).sort().join('\n');
        }
      }

      case 'sitemap-xml': {
        if (scope === 'pages') {
          let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
          xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
          const dateStr = new Date().toISOString().split('T')[0];
          const sortedPages = [...pages].filter((p) => p.statusCode >= 200 && p.statusCode < 400).sort((a, b) => a.url.localeCompare(b.url));
          for (const p of sortedPages) {
            xml += `  <url>\n`;
            xml += `    <loc>${p.url.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] || c))}</loc>\n`;
            xml += `    <lastmod>${dateStr}</lastmod>\n`;
            xml += `    <changefreq>weekly</changefreq>\n`;
            xml += `    <priority>${p.depth === 0 ? '1.0' : p.depth === 1 ? '0.8' : '0.6'}</priority>\n`;
            xml += `  </url>\n`;
          }
          xml += `</urlset>`;
          return xml;
        } else {
          // 'directories' or 'all'
          return exportDirectoriesAsSitemapXml(directories, targetOrigin || 'https://example.com', scope === 'all' ? files : []);
        }
      }

      case 'markdown': {
        let md = `# Reconnaissance Dossier for ${targetOrigin || activeDomain || 'Target'}\n\n`;
        md += `Generated: ${new Date().toUTCString()}\n`;
        md += `- **Target Origin:** \`${targetOrigin || 'N/A'}\`\n`;
        md += `- **Primary Domain:** \`${activeDomain || 'N/A'}\`\n`;
        md += `- **Directories:** ${directories.length}\n`;
        md += `- **Discovered Files:** ${files.length}\n`;
        md += `- **Captured APIs:** ${apiEndpoints.length}\n`;
        md += `- **External Links:** ${externalLinks.length}\n`;
        md += `- **Crawled Pages:** ${pages.length}\n\n`;

        if ((scope === 'all' || scope === 'directories') && directories.length > 0) {
          md += `## Directories (${directories.length})\n\n`;
          const sortedDirs = [...directories].sort((a, b) => a.path.localeCompare(b.path));
          for (const d of sortedDirs) {
            const indent = '  '.repeat(d.depth);
            const source = d.foundOnUrl ? ` *(source: ${d.foundOnUrl})*` : '';
            md += `${indent}- \`${d.path}\` (${d.directPageUrls.length} direct pages)${source}\n`;
          }
          md += `\n`;
        }

        if ((scope === 'all' || scope === 'files') && files.length > 0) {
          md += `## Discovered Files (${files.length})\n\n`;
          const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));
          for (const f of sortedFiles) {
            const source = f.foundOnUrl ? ` *(found on: ${f.foundOnUrl})*` : '';
            md += `- \`${f.path}\` [${f.fileType.toUpperCase()}]${source}\n`;
          }
          md += `\n`;
        }

        if ((scope === 'all' || scope === 'api') && apiEndpoints.length > 0) {
          // Canonicalize and deduplicate endpoints by method + domain + pathname
          const dedupedApis: ApiEndpointRecord[] = [];
          for (const ep of apiEndpoints) {
            const host = (ep.domain || '').toLowerCase();
            const existing = dedupedApis.find(
              (d) => d.method === ep.method && (d.domain || '').toLowerCase() === host && d.pathname === ep.pathname
            );
            if (existing) {
              const combinedParams = [...(existing.possibleParameters || [])];
              for (const p of ep.possibleParameters || []) {
                if (!combinedParams.some((cp) => cp.name === p.name && cp.in === p.in)) {
                  combinedParams.push(p);
                }
              }
              for (const q of ep.queryParams || []) {
                if (!combinedParams.some((cp) => cp.name === q && cp.in === 'query')) {
                  combinedParams.push({
                    name: q,
                    in: 'query',
                    type: 'string',
                    status: 'UNKNOWN',
                    source: 'observed',
                  });
                }
              }
              existing.possibleParameters = combinedParams.length > 0 ? combinedParams : undefined;
              existing.queryParams = Array.from(new Set([...(existing.queryParams || []), ...(ep.queryParams || [])]));
            } else {
              dedupedApis.push({ ...ep });
            }
          }

          md += `## Captured API Endpoints (${dedupedApis.length})\n\n`;
          for (const ep of dedupedApis) {
            const auth = ep.authHint ? ` [Auth: ${ep.authHint}]` : '';
            const statusStr = ep.statusCode ? ` [HTTP ${ep.statusCode}]` : '';
            md += `- \`[${ep.method}]\` **${ep.pathname}** (${ep.category.toUpperCase()}${auth}${statusStr}) - \`${ep.url}\`\n`;
            
            const params: ApiQueryParameter[] = ep.possibleParameters && ep.possibleParameters.length > 0
              ? ep.possibleParameters
              : (ep.queryParams || []).map((q) => ({
                  name: q,
                  in: 'query' as const,
                  type: 'string' as const,
                  sampleValue: undefined,
                  status: 'UNKNOWN' as const,
                  source: 'observed' as const,
                }));

            if (params.length > 0) {
              md += `  - *Known Parameters & Schema (${params.length}):*\n`;
              for (const p of params) {
                const reqStr =
                  p.status === 'REQUIRED' || p.required === true
                    ? 'required'
                    : p.status === 'OPTIONAL' || (p.required === false && p.status !== 'UNKNOWN')
                    ? 'optional'
                    : 'unknown';
                const sampleStr = p.sampleValue ? `, sample: \`${p.sampleValue}\`` : '';
                md += `    - \`${p.in === 'path' ? ':' : '?'}${p.name}\` [${p.in.toUpperCase()}] (${p.type || 'string'}, ${reqStr}${sampleStr})\n`;
              }
            }

            if (ep.queryCapabilitiesSummary) {
              md += `  - *Capabilities:* ${ep.queryCapabilitiesSummary}\n`;
            }
            if (ep.possibleQueries && ep.possibleQueries.length > 0) {
              md += `  - *Possible Queries (${ep.possibleQueries.length}):*\n`;
              for (const q of ep.possibleQueries) {
                md += `    - \`[${q.method}]\` ${q.title}: \`${q.url}\`\n`;
              }
            }
          }
          md += `\n`;
        }

        if ((scope === 'all' || scope === 'links') && externalLinks.length > 0) {
          md += `## External Links & Hosts (${externalLinks.length})\n\n`;
          const sortedLinks = [...externalLinks].slice(0, 100);
          for (const l of sortedLinks) {
            md += `- \`${l.domain}\` : \`${l.url}\` *(found on: ${l.foundOnUrl})*\n`;
          }
          if (externalLinks.length > 100) {
            md += `\n*... and ${externalLinks.length - 100} more external links.*\n`;
          }
          md += `\n`;
        }

        if ((scope === 'all' || scope === 'subdomains') && discoveredSubdomains.length > 0) {
          md += `## Discovered Subdomains & SANs (${discoveredSubdomains.length})\n\n`;
          for (const s of discoveredSubdomains) {
            md += `- \`${s}\`\n`;
          }
          md += `\n`;
        }

        if ((scope === 'all' || scope === 'pages') && pages.length > 0) {
          md += `## Crawled Pages Log (${pages.length})\n\n`;
          for (const p of pages.slice(0, 50)) {
            md += `- \`[HTTP ${p.statusCode}]\` \`[${p.method || 'GET'}]\` **${p.title || p.pathname}** - \`${p.url}\` (${p.durationMs}ms)\n`;
          }
          if (pages.length > 50) {
            md += `\n*... and ${pages.length - 50} more pages.*\n`;
          }
          md += `\n`;
        }

        if ((scope === 'all' || scope === 'intel') && Object.keys(domainIntelligenceCache).length > 0) {
          md += `## Domain Intelligence & DNS\n\n`;
          for (const [dom, intelRaw] of Object.entries(domainIntelligenceCache)) {
            const intel = intelRaw as DomainIntelligence;
            md += `### Host: ${dom}\n`;
            if (intel.whois?.registrar) md += `- **Registrar:** ${intel.whois.registrar}\n`;
            if (intel.whois?.createdDate) md += `- **Created:** ${intel.whois.createdDate}\n`;
            if (intel.dns?.length) {
              md += `- **DNS Records (${intel.dns.length}):**\n`;
              for (const rec of intel.dns.slice(0, 20)) {
                md += `  - \`${rec.type}\` \`${rec.name}\` -> \`${rec.value}\`\n`;
              }
            }
            if (intel.server?.server) md += `- **Server Banner:** \`${intel.server.server}\`\n`;
            md += `\n`;
          }
        }

        return md;
      }

      default:
        return '';
    }
  }, [
    scope,
    format,
    directories,
    files,
    apiEndpoints,
    externalLinks,
    pages,
    logs,
    domainIntelligenceCache,
    config,
    stats,
    status,
    currentDomain,
    whoisTargetDomain,
    targetOrigin,
  ]);

  const handleCopy = () => {
    navigator.clipboard.writeText(exportData);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const cleanHost = (currentDomain || (targetOrigin ? new URL(targetOrigin).hostname : 'recon')).replace(/[^a-zA-Z0-9.-]/g, '_');
    let extension = 'txt';
    let mimeType = 'text/plain';

    if (format === 'json') {
      extension = 'json';
      mimeType = 'application/json';
    } else if (format === 'csv') {
      extension = 'csv';
      mimeType = 'text/csv';
    } else if (format === 'sitemap-xml') {
      extension = 'xml';
      mimeType = 'application/xml';
    } else if (format === 'markdown') {
      extension = 'md';
      mimeType = 'text/markdown';
    }

    const filename = `${cleanHost}-${scope}-recon.${extension}`;
    const blob = new Blob([exportData], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xs">
      <div className="bg-[#141414] border border-[#383838] rounded-none w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="h-[2px] w-full bg-gradient-to-r from-[#c30800] via-[#c300bb] to-[#bbc300]" />

        {/* Header */}
        <div className="px-6 py-4 border-b border-[#383838] bg-[#141414] flex items-center justify-between">
          <div>
            <h3 className="font-mono font-bold text-sm uppercase tracking-wider text-[#f0f0f0]">
              Export Reconnaissance Inventory
            </h3>
            <p className="text-[10px] font-mono text-[#8c8c8c] mt-0.5">
              {directories.length} dirs • {files.length} files • {apiEndpoints.length} APIs • {externalLinks.length} links • {pages.length} pages
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#262626] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar flex-1 text-xs bg-[#141414]">
          {/* Scope Selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-[10px] font-semibold text-[#8c8c8c] uppercase tracking-widest font-mono">
                Export Dataset Scope
              </label>
            </div>
            <div className="flex items-center font-mono w-full">
              <button
                type="button"
                onClick={handleScrollLeft}
                disabled={!canScrollLeft}
                aria-label="Scroll left"
                title="Scroll options left"
                className="h-8 w-8 shrink-0 flex items-center justify-center border border-[#383838] bg-[#141414] hover:bg-[#262626] text-[#8c8c8c] hover:text-[#f0f0f0] transition-colors cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              <div
                ref={scopeScrollRef}
                className="flex items-center gap-1.5 overflow-x-auto scroll-smooth flex-1 min-w-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden py-0.5"
              >
                <button
                  type="button"
                  onClick={() => setScope('all')}
                  className={`px-3 py-1.5 rounded-none text-xs border uppercase tracking-wider cursor-pointer transition-colors shrink-0 whitespace-nowrap ${
                    scope === 'all'
                      ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0] font-semibold'
                      : 'bg-[#141414] border-[#2e2e2e] text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a]'
                  }`}
                >
                  All (Full Session) ({directories.length + files.length + apiEndpoints.length + externalLinks.length + pages.length})
                </button>
                <button
                  type="button"
                  onClick={() => setScope('directories')}
                  className={`px-3 py-1.5 rounded-none text-xs border uppercase tracking-wider cursor-pointer transition-colors shrink-0 whitespace-nowrap ${
                    scope === 'directories'
                      ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0] font-semibold'
                      : 'bg-[#141414] border-[#2e2e2e] text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a]'
                  }`}
                >
                  Directories ({directories.length})
                </button>
                <button
                  type="button"
                  onClick={() => setScope('files')}
                  className={`px-3 py-1.5 rounded-none text-xs border uppercase tracking-wider cursor-pointer transition-colors shrink-0 whitespace-nowrap ${
                    scope === 'files'
                      ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0] font-semibold'
                      : 'bg-[#141414] border-[#2e2e2e] text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a]'
                  }`}
                >
                  Files ({files.length})
                </button>
                <button
                  type="button"
                  onClick={() => setScope('api')}
                  className={`px-3 py-1.5 rounded-none text-xs border uppercase tracking-wider cursor-pointer transition-colors shrink-0 whitespace-nowrap ${
                    scope === 'api'
                      ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0] font-semibold'
                      : 'bg-[#141414] border-[#2e2e2e] text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a]'
                  }`}
                >
                  API Endpoints ({apiEndpoints.length})
                </button>
                <button
                  type="button"
                  onClick={() => setScope('links')}
                  className={`px-3 py-1.5 rounded-none text-xs border uppercase tracking-wider cursor-pointer transition-colors shrink-0 whitespace-nowrap ${
                    scope === 'links'
                      ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0] font-semibold'
                      : 'bg-[#141414] border-[#2e2e2e] text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a]'
                  }`}
                >
                  External Links ({externalLinks.length})
                </button>
                <button
                  type="button"
                  onClick={() => setScope('subdomains')}
                  className={`px-3 py-1.5 rounded-none text-xs border uppercase tracking-wider cursor-pointer transition-colors shrink-0 whitespace-nowrap ${
                    scope === 'subdomains'
                      ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0] font-semibold'
                      : 'bg-[#141414] border-[#2e2e2e] text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a]'
                  }`}
                >
                  Subdomains &amp; SANs ({discoveredSubdomains.length})
                </button>
                <button
                  type="button"
                  onClick={() => setScope('pages')}
                  className={`px-3 py-1.5 rounded-none text-xs border uppercase tracking-wider cursor-pointer transition-colors shrink-0 whitespace-nowrap ${
                    scope === 'pages'
                      ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0] font-semibold'
                      : 'bg-[#141414] border-[#2e2e2e] text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a]'
                  }`}
                >
                  Pages Log ({pages.length})
                </button>
                <button
                  type="button"
                  onClick={() => setScope('intel')}
                  className={`px-3 py-1.5 rounded-none text-xs border uppercase tracking-wider cursor-pointer transition-colors shrink-0 whitespace-nowrap ${
                    scope === 'intel'
                      ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0] font-semibold'
                      : 'bg-[#141414] border-[#2e2e2e] text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a]'
                  }`}
                >
                  Domain Intel ({Object.keys(domainIntelligenceCache).length})
                </button>
              </div>

              <button
                type="button"
                onClick={handleScrollRight}
                disabled={!canScrollRight}
                aria-label="Scroll right"
                title="Scroll options right"
                className="h-8 w-8 shrink-0 flex items-center justify-center border border-[#383838] bg-[#141414] hover:bg-[#262626] text-[#8c8c8c] hover:text-[#f0f0f0] transition-colors cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Format Selector Tabs - strictly filtered so irrelevant formats for the scope are not shown */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-[10px] font-semibold text-[#8c8c8c] uppercase tracking-widest font-mono">
                Output Encoding Format
              </label>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono">
              {allowedFormats.map((fmtKey) => {
                const meta = FORMAT_METADATA[fmtKey];
                const IconComponent = meta.icon;
                const isSelected = format === fmtKey;
                return (
                  <button
                    key={fmtKey}
                    type="button"
                    onClick={() => setFormat(fmtKey)}
                    className={`p-2.5 rounded-none border text-left flex items-center gap-2 transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#1a1a1a] border-[#c30800] text-[#f0f0f0] font-semibold'
                        : 'bg-[#141414] border-[#383838] text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a]'
                    }`}
                  >
                    <IconComponent className="w-4 h-4 text-[#c30800] shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs truncate">{meta.label}</div>
                      <div className="text-[10px] text-[#8c8c8c] truncate">{meta.sublabel}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preview Canvas */}
          <div className="space-y-1.5 font-mono">
            <div className="flex items-center justify-between text-[10px] uppercase text-[#8c8c8c]">
              <span>Preview Serialization Output</span>
            </div>
            <textarea
              id="export-preview-textarea"
              readOnly
              value={exportData}
              rows={11}
              className="w-full p-3 bg-[#0d0d0d] border border-[#383838] rounded-none font-mono text-[11px] text-[#f0f0f0] overflow-x-auto max-h-64 overflow-y-auto custom-scrollbar select-all resize-none focus:outline-none"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-[#383838] bg-[#141414] flex flex-wrap items-center justify-end gap-2 font-mono">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="px-3 py-1.5 rounded-none bg-[#141414] hover:bg-[#262626] text-[#f0f0f0] text-xs uppercase tracking-wider transition-colors cursor-pointer flex items-center gap-1.5 border border-[#383838] font-bold"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-[#c30800]" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy All'}</span>
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="px-4 py-1.5 rounded-none bg-gradient-to-r from-[#c30800] to-[#770500] hover:from-[#f60a00] hover:to-[#770500] text-[#f3f3f7] border border-[#c30800] text-xs uppercase tracking-wider font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-md"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download File</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

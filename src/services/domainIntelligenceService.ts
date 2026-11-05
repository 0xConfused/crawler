// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DomainIntelligence,
  DnsRecordItem,
  WhoisRdapInfo,
  CrtSubdomainsData,
  SubdomainProbeResult,
  ApiMethod,
  CorsProxyMode,
  ApiEndpointRecord,
  CustomProxyConfig,
  PublicProxyStatus,
} from '../types';
import { extractApexDomain } from '../utils/urlUtils';

export const PUBLIC_CORS_PROXIES: Array<{
  id: string;
  name: string;
  urlTemplate: string;
  pingUrl: string;
}> = [
  {
    id: 'corsdev',
    name: 'Cors.dev',
    urlTemplate: 'https://proxy.cors.dev/{url}',
    pingUrl: 'https://proxy.cors.dev/https%3A%2F%2Fexample.com',
  },
  {
    id: 'allorigins',
    name: 'AllOrigins',
    urlTemplate: 'https://api.allorigins.win/raw?url={url}',
    pingUrl: 'https://api.allorigins.win/raw?url=https%3A%2F%2Fexample.com',
  },
  {
    id: 'codetabs',
    name: 'CodeTabs',
    urlTemplate: 'https://api.codetabs.com/v1/proxy?quest={url}',
    pingUrl: 'https://api.codetabs.com/v1/proxy?quest=https%3A%2F%2Fexample.com',
  },
  {
    id: 'corsproxy',
    name: 'CorsProxy.io',
    urlTemplate: 'https://corsproxy.io/?url={url}',
    pingUrl: 'https://corsproxy.io/?url=https%3A%2F%2Fexample.com',
  },
];

let publicProxyHealthCache: PublicProxyStatus[] = PUBLIC_CORS_PROXIES.map((p) => ({
  id: p.id,
  name: p.name,
  urlTemplate: p.urlTemplate,
  status: 'untested',
}));

const healthListeners = new Set<(statuses: PublicProxyStatus[]) => void>();

export function getPublicProxiesHealth(): PublicProxyStatus[] {
  return [...publicProxyHealthCache];
}

export function subscribePublicProxiesHealth(cb: (statuses: PublicProxyStatus[]) => void): () => void {
  healthListeners.add(cb);
  return () => healthListeners.delete(cb);
}

export async function verifyPublicProxiesHealth(): Promise<PublicProxyStatus[]> {
  const updated: PublicProxyStatus[] = await Promise.all(
    PUBLIC_CORS_PROXIES.map(async (proxy) => {
      const t0 = performance.now();
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4500);
        const res = await fetch(proxy.pingUrl, {
          signal: controller.signal,
          mode: 'cors',
          cache: 'no-cache',
        });
        clearTimeout(timeoutId);
        const latencyMs = Math.round(performance.now() - t0);

        if (res.ok) {
          return {
            id: proxy.id,
            name: proxy.name,
            urlTemplate: proxy.urlTemplate,
            status: 'online',
            latencyMs,
            lastChecked: Date.now(),
          };
        } else if (res.status === 401 || res.status === 403) {
          return {
            id: proxy.id,
            name: proxy.name,
            urlTemplate: proxy.urlTemplate,
            status: 'offline',
            latencyMs,
            lastChecked: Date.now(),
            error: res.status === 401 ? 'Requires API Key (HTTP 401)' : 'Access Forbidden (HTTP 403)',
          };
        } else if (res.status === 429) {
          return {
            id: proxy.id,
            name: proxy.name,
            urlTemplate: proxy.urlTemplate,
            status: 'degraded',
            latencyMs,
            lastChecked: Date.now(),
            error: 'Rate Limited (HTTP 429)',
          };
        } else {
          return {
            id: proxy.id,
            name: proxy.name,
            urlTemplate: proxy.urlTemplate,
            status: 'degraded',
            latencyMs,
            lastChecked: Date.now(),
            error: `HTTP ${res.status}`,
          };
        }
      } catch (err: any) {
        return {
          id: proxy.id,
          name: proxy.name,
          urlTemplate: proxy.urlTemplate,
          status: 'offline',
          latencyMs: Math.round(performance.now() - t0),
          lastChecked: Date.now(),
          error: err?.name === 'AbortError' ? 'Timeout (4.5s)' : 'Connection refused / CORS blocked',
        };
      }
    })
  );

  publicProxyHealthCache = updated;
  healthListeners.forEach((cb) => cb(updated));
  return updated;
}

export function buildCustomProxyRequest(
  targetUrl: string,
  customConfigOrUrl?: string | CustomProxyConfig,
  apiKeyFallback?: string
): { url: string; headers: Record<string, string> } {
  let config: CustomProxyConfig;
  if (!customConfigOrUrl) {
    config = {
      urlTemplate: '',
      urlDestination: 'placeholder',
      apiKeyDestination: 'none',
    };
  } else if (typeof customConfigOrUrl === 'string') {
    config = {
      urlTemplate: customConfigOrUrl,
      urlDestination: customConfigOrUrl.includes('{url}') ? 'placeholder' : 'query',
      urlQueryParam: 'url',
      apiKey: apiKeyFallback,
      apiKeyDestination: apiKeyFallback ? 'header' : 'none',
      apiKeyHeaderName: 'X-API-Key',
    };
  } else {
    config = customConfigOrUrl;
  }

  let finalUrl = (config.urlTemplate || '').trim();
  const headers: Record<string, string> = {};
  const encodedTarget = encodeURIComponent(targetUrl);

  // 1. Target URL Delivery
  if (config.urlDestination === 'header') {
    const headerName = (config.urlHeaderName || 'X-Target-URL').trim();
    if (headerName) {
      headers[headerName] = targetUrl;
    }
  } else {
    // Handled in Endpoint Template: covers placeholder, query param, and path suffix
    if (finalUrl.includes('{url}')) {
      finalUrl = finalUrl.replace(/\{url\}/g, encodedTarget);
    } else if (finalUrl.includes('{raw_url}')) {
      finalUrl = finalUrl.replace(/\{raw_url\}/g, targetUrl);
    } else if (finalUrl) {
      // If template does not contain placeholder, append as url parameter
      const sep = finalUrl.includes('?') ? '&' : '?';
      finalUrl = `${finalUrl}${sep}url=${encodedTarget}`;
    }
  }

  // 2. API Key Delivery
  const apiKey = (config.apiKey || apiKeyFallback || '').trim();
  const keyDest = config.apiKeyDestination || 'none';

  if (apiKey && keyDest !== 'none') {
    if (keyDest === 'header') {
      const headerName = (config.apiKeyHeaderName || 'X-API-Key').trim();
      const prefix = config.apiKeyHeaderPrefix || '';
      if (headerName) {
        headers[headerName] = `${prefix}${apiKey}`;
      }
    } else {
      // In template: replaces {apiKey}, {api_key}, or {key} anywhere in template query or path
      finalUrl = finalUrl
        .replace(/\{apiKey\}/g, apiKey)
        .replace(/\{api_key\}/g, apiKey)
        .replace(/\{key\}/g, apiKey);
    }
  }

  return { url: finalUrl, headers };
}

export function buildProxiedUrl(
  targetUrl: string,
  proxyMode: CorsProxyMode = 'direct',
  customProxy?: string | CustomProxyConfig,
  stealthApiKey?: string
): string {
  if (proxyMode === 'direct') {
    return targetUrl;
  }
  if (proxyMode === 'custom') {
    return buildCustomProxyRequest(targetUrl, customProxy, stealthApiKey).url;
  }
  if (proxyMode === 'corsdev') {
    return `https://proxy.cors.dev/${encodeURIComponent(targetUrl)}`;
  }
  if (proxyMode === 'allorigins') {
    return `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
  }
  if (proxyMode === 'corsproxy') {
    return `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`;
  }
  if (proxyMode === 'codetabs') {
    return `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`;
  }
  if (proxyMode === 'scrapingbee') {
    const key = (stealthApiKey || '').trim();
    return `https://app.scrapingbee.com/api/v1/?api_key=${encodeURIComponent(key)}&url=${encodeURIComponent(targetUrl)}&render_js=true&stealth_proxy=true`;
  }
  if (proxyMode === 'zenrows') {
    const key = (stealthApiKey || '').trim();
    return `https://api.zenrows.com/v1/?apikey=${encodeURIComponent(key)}&url=${encodeURIComponent(targetUrl)}&js_render=true&antibot=true&premium_proxy=true`;
  }
  if (proxyMode === 'brightdata') {
    const key = (stealthApiKey || '').trim();
    return `https://api.brightdata.com/unblocker?token=${encodeURIComponent(key)}&url=${encodeURIComponent(targetUrl)}`;
  }
  if (proxyMode === 'scraperapi') {
    const key = (stealthApiKey || '').trim();
    return `https://api.scraperapi.com/?api_key=${encodeURIComponent(key)}&url=${encodeURIComponent(targetUrl)}&render=true&ultra_premium=true`;
  }
  // Default public: cors.dev primary
  return `https://proxy.cors.dev/${encodeURIComponent(targetUrl)}`;
}

function combineSignals(timeoutMs: number, parentSignal?: AbortSignal | null): AbortSignal {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    try {
      controller.abort(new Error('Timeout'));
    } catch {}
  }, timeoutMs);

  if (parentSignal) {
    if (parentSignal.aborted) {
      clearTimeout(timeoutId);
      try {
        controller.abort(parentSignal.reason);
      } catch {}
    } else {
      parentSignal.addEventListener(
        'abort',
        () => {
          clearTimeout(timeoutId);
          try {
            controller.abort(parentSignal.reason);
          } catch {}
        },
        { once: true }
      );
    }
  }
  return controller.signal;
}

export async function fetchWithProxyFallback(
  targetUrl: string,
  proxyMode: CorsProxyMode = 'direct',
  customProxyOrConfig?: string | CustomProxyConfig,
  stealthApiKeyOrInit?: string | RequestInit,
  maybeInit?: RequestInit
): Promise<Response> {
  let stealthApiKey: string | undefined;
  let init: RequestInit | undefined;
  if (typeof stealthApiKeyOrInit === 'string') {
    stealthApiKey = stealthApiKeyOrInit;
    init = maybeInit;
  } else {
    init = stealthApiKeyOrInit;
    stealthApiKey = undefined;
  }

  const isCrt = targetUrl.includes('crt.sh');
  const customTimeout = (init as any)?.timeoutMs;

  // 1. DIRECT FETCH MODE (Default)
  if (proxyMode === 'direct') {
    const directTimeout = customTimeout || (isCrt ? 55000 : 7000);
    const directSignal = combineSignals(directTimeout, init?.signal);
    try {
      const res = await fetch(targetUrl, {
        ...init,
        mode: 'cors',
        signal: directSignal,
      });
      return res;
    } catch (err: any) {
      throw new Error(`Direct fetch to ${targetUrl} failed: ${err.message || 'CORS policy blocked access'}. Switch to Public Proxy or Custom Proxy in Recon Parameters.`);
    }
  }

  // 2. CUSTOM PROXY MODE
  if (proxyMode === 'custom') {
    const customReq = buildCustomProxyRequest(targetUrl, customProxyOrConfig, stealthApiKey);
    if (!customReq.url) {
      throw new Error('Custom proxy selected but no valid proxy URL was provided. Configure proxy URL in Recon Parameters.');
    }

    const mergedHeaders: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => {
          mergedHeaders[k] = v;
        });
      } else if (Array.isArray(init.headers)) {
        init.headers.forEach(([k, v]) => {
          mergedHeaders[k] = v;
        });
      } else {
        Object.assign(mergedHeaders, init.headers);
      }
    }
    Object.assign(mergedHeaders, customReq.headers);

    const customProxyTimeout = customTimeout || (isCrt ? 60000 : 18000);
    const signal = combineSignals(customProxyTimeout, init?.signal);
    return fetch(customReq.url, {
      ...init,
      headers: mergedHeaders,
      signal,
    });
  }

  // 3. PUBLIC PROXY MODE (Health-Verified Waterfall)
  // Sort candidate public proxies by health cache (online first, lowest latency first)
  const candidateList = [...PUBLIC_CORS_PROXIES].sort((a, b) => {
    const sa = publicProxyHealthCache.find((s) => s.id === a.id);
    const sb = publicProxyHealthCache.find((s) => s.id === b.id);
    const rank = (st?: string) => (st === 'online' ? 0 : st === 'untested' ? 1 : st === 'degraded' ? 2 : 3);
    const rDiff = rank(sa?.status) - rank(sb?.status);
    if (rDiff !== 0) return rDiff;
    return (sa?.latencyMs || 9999) - (sb?.latencyMs || 9999);
  });

  const failureDetails: string[] = [];
  const publicProxyTimeout = customTimeout || (isCrt ? 55000 : 6000);

  // For crt.sh wildcard queries (which take time to process PostgreSQL certificate logs),
  // stagger candidate proxy requests so whichever proxy receives the completed response first returns,
  // without failing prematurely or stalling behind a single blocked proxy.
  if (isCrt) {
    const activeCandidates = candidateList.filter((p) => {
      const st = publicProxyHealthCache.find((s) => s.id === p.id)?.status;
      return st !== 'offline';
    });
    const candidatesToTry = activeCandidates.length > 0 ? activeCandidates : candidateList;

    return new Promise<Response>((resolve, reject) => {
      let resolved = false;
      const errors: string[] = [];
      let pendingCount = candidatesToTry.length;

      candidatesToTry.forEach((proxy, idx) => {
        setTimeout(async () => {
          if (resolved) return;
          try {
            const proxyUrl = proxy.urlTemplate.replace('{url}', encodeURIComponent(targetUrl));
            const candidateSignal = combineSignals(publicProxyTimeout, init?.signal);
            const res = await fetch(proxyUrl, {
              ...init,
              signal: candidateSignal,
            });

            if (!res.ok) {
              throw new Error(`HTTP ${res.status}`);
            }

            if (!resolved) {
              resolved = true;
              const cached = publicProxyHealthCache.find((s) => s.id === proxy.id);
              if (cached && cached.status !== 'online') {
                cached.status = 'online';
                cached.lastChecked = Date.now();
              }
              resolve(res);
            }
          } catch (err: any) {
            errors.push(`${proxy.name}: ${err.message || 'Failed'}`);
            pendingCount--;
            if (pendingCount <= 0 && !resolved) {
              reject(new Error(`All public CORS proxies failed for ${targetUrl} (${errors.join('; ')}).`));
            }
          }
        }, idx * 2000);
      });
    });
  }

  for (const proxy of candidateList) {
    const proxyUrl = proxy.urlTemplate.replace('{url}', encodeURIComponent(targetUrl));
    try {
      const candidateSignal = combineSignals(publicProxyTimeout, init?.signal);
      const res = await fetch(proxyUrl, {
        ...init,
        signal: candidateSignal,
      });

      // 429 or 5xx gateway failures trigger immediate waterfall to next proxy
      if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
        const cached = publicProxyHealthCache.find((s) => s.id === proxy.id);
        if (cached) {
          cached.status = 'degraded';
          cached.error = `HTTP ${res.status}`;
          cached.lastChecked = Date.now();
        }
        failureDetails.push(`${proxy.name}: HTTP ${res.status}`);
        continue;
      }

      // Valid response
      const cached = publicProxyHealthCache.find((s) => s.id === proxy.id);
      if (cached && cached.status !== 'online') {
        cached.status = 'online';
        cached.lastChecked = Date.now();
      }
      return res;
    } catch (err: any) {
      const cached = publicProxyHealthCache.find((s) => s.id === proxy.id);
      if (cached) {
        cached.status = 'offline';
        cached.error = err?.name === 'AbortError' ? `Timeout (${Math.round(publicProxyTimeout / 1000)}s)` : (err.message || 'Network error');
        cached.lastChecked = Date.now();
      }
      failureDetails.push(`${proxy.name}: ${err.message || 'Connection error'}`);
    }
  }

  throw new Error(`All public CORS proxies failed for ${targetUrl} (${failureDetails.join('; ')}). Configure a Custom Proxy in Recon Parameters.`);
}

export async function resolveDnsRecords(domain: string): Promise<{ dns: DnsRecordItem[]; resolvedIp?: string }> {
  const cleanDomain = domain.toLowerCase().trim().replace(/:\d+$/, '');
  const dnsRecords: DnsRecordItem[] = [];
  let resolvedIp: string | undefined;

  const isSubdomain = cleanDomain.split('.').length > 2;
  const recordTypes = isSubdomain
    ? ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'CAA']
    : ['A', 'AAAA', 'MX', 'TXT', 'NS', 'SOA', 'CAA'];

  await Promise.all(
    recordTypes.map(async (type) => {
      try {
        // Query Cloudflare DoH (RFC 8484 with CORS enabled, unproxied)
        const cfController = new AbortController();
        const cfTimeout = setTimeout(() => cfController.abort(), 7000);
        const cfUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(cleanDomain)}&type=${encodeURIComponent(type)}`;
        const res = await fetch(cfUrl, {
          mode: 'cors',
          headers: { Accept: 'application/dns-json' },
          signal: cfController.signal,
        });
        clearTimeout(cfTimeout);

        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json.Answer)) {
            json.Answer.forEach((ans: any) => {
              const val = String(ans.data || '').trim();
              if (val) {
                dnsRecords.push({
                  type,
                  name: ans.name || cleanDomain,
                  value: val,
                  ttl: ans.TTL,
                });
                if (type === 'A' && !resolvedIp) {
                  resolvedIp = val;
                }
              }
            });
            return;
          }
        }

        // Fallback to Google DoH (RFC 8484 with CORS enabled, unproxied)
        const gController = new AbortController();
        const gTimeout = setTimeout(() => gController.abort(), 7000);
        const googleUrl = `https://dns.google/resolve?name=${encodeURIComponent(cleanDomain)}&type=${encodeURIComponent(type)}`;
        const gRes = await fetch(googleUrl, {
          mode: 'cors',
          headers: { Accept: 'application/dns-json' },
          signal: gController.signal,
        });
        clearTimeout(gTimeout);

        if (gRes.ok) {
          const gJson = await gRes.json();
          if (Array.isArray(gJson.Answer)) {
            gJson.Answer.forEach((ans: any) => {
              const val = String(ans.data || '').trim();
              if (val) {
                dnsRecords.push({
                  type,
                  name: ans.name || cleanDomain,
                  value: val,
                  ttl: ans.TTL,
                });
                if (type === 'A' && !resolvedIp) {
                  resolvedIp = val;
                }
              }
            });
          }
        }
      } catch {
        // Continue to other record types
      }
    })
  );

  return { dns: dnsRecords, resolvedIp };
}

export async function fetchRdapWhois(
  domain: string,
  _proxyMode?: CorsProxyMode,
  _customProxy?: string | CustomProxyConfig
): Promise<WhoisRdapInfo | null> {
  const clean = domain.toLowerCase().trim().replace(/:\d+$/, '');
  const rootDomain = extractApexDomain(clean);

  // WHOIS and RDAP are fetched directly without proxying (registries provide native CORS)
  const candidateUrls = [
    `https://rdap.org/domain/${encodeURIComponent(rootDomain)}`,
    `https://rdap-bootstrap.arin.net/bootstrap/domain/${encodeURIComponent(rootDomain)}`,
  ];

  for (const url of candidateUrls) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 9000);
      const res = await fetch(url, {
        mode: 'cors',
        headers: { Accept: 'application/rdap+json, application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        return parseRdapPayload(data, clean, rootDomain);
      }
    } catch {
      // Try next
    }
  }

  return null;
}

function parseRdapPayload(rdapData: any, domain: string, rootDomain: string): WhoisRdapInfo {
  let registrarName = '';
  let ianaId = '';
  let abuseContact = '';
  let registrantCountry = '';

  const searchEntities = (entities: any[]) => {
    if (!Array.isArray(entities)) return;
    for (const ent of entities) {
      const roles = ent.roles || [];
      if (roles.includes('registrar') || roles.includes('sponsor')) {
        if (ent.vcardArray && ent.vcardArray[1]) {
          const fnItem = ent.vcardArray[1].find((i: any) => i[0] === 'fn');
          if (fnItem && typeof fnItem[3] === 'string') registrarName = fnItem[3];
          const orgItem = ent.vcardArray[1].find((i: any) => i[0] === 'org');
          if (!registrarName && orgItem && typeof orgItem[3] === 'string') registrarName = orgItem[3];
        }
        if (!registrarName && ent.handle) registrarName = ent.handle;
        if (ent.publicIds && Array.isArray(ent.publicIds)) {
          const ianaPublicId = ent.publicIds.find((p: any) => p.type === 'IANA Registrar ID');
          if (ianaPublicId) ianaId = String(ianaPublicId.identifier);
        }
      }
      if (roles.includes('abuse')) {
        if (ent.vcardArray && ent.vcardArray[1]) {
          const emailItem = ent.vcardArray[1].find((i: any) => i[0] === 'email');
          if (emailItem && typeof emailItem[3] === 'string') abuseContact = emailItem[3];
        }
      }
      if (roles.includes('registrant')) {
        if (ent.vcardArray && ent.vcardArray[1]) {
          const adrItem = ent.vcardArray[1].find((i: any) => i[0] === 'adr');
          if (adrItem && adrItem[3] && Array.isArray(adrItem[3])) {
            const country = adrItem[3][6];
            if (typeof country === 'string' && country.trim()) registrantCountry = country.trim();
          }
        }
      }
      if (ent.entities) {
        searchEntities(ent.entities);
      }
    }
  };

  if (rdapData.entities) {
    searchEntities(rdapData.entities);
  }

  let createdDate = '';
  let updatedDate = '';
  let expiresDate = '';

  if (rdapData.events && Array.isArray(rdapData.events)) {
    for (const ev of rdapData.events) {
      if (ev.eventAction === 'registration' || ev.eventAction === 'created') createdDate = ev.eventDate;
      if (ev.eventAction === 'last changed' || ev.eventAction === 'last update') updatedDate = ev.eventDate;
      if (ev.eventAction === 'expiration' || ev.eventAction === 'expiry') expiresDate = ev.eventDate;
    }
  }

  const nameservers =
    rdapData.nameservers
      ?.map((ns: any) => (typeof ns === 'string' ? ns : ns.ldhName || ns.unicodeName || ns.handle))
      .filter(Boolean) || [];

  return {
    domainName: rdapData.ldhName || rdapData.unicodeName || rootDomain || domain,
    rootDomain,
    queryDomain: domain,
    registrar: registrarName || rdapData.port43 || 'Protected / Redacted',
    ianaId: ianaId || undefined,
    createdDate: createdDate || undefined,
    updatedDate: updatedDate || undefined,
    expiresDate: expiresDate || undefined,
    status: rdapData.status || [],
    nameservers,
    whoisServer: rdapData.port43 || undefined,
    abuseContact: abuseContact || undefined,
    registrantCountry: registrantCountry || undefined,
    source: 'rdap',
    rawText: JSON.stringify(rdapData, null, 2).slice(0, 3000),
  };
}

export async function fetchCrtSubdomains(
  apexDomain: string,
  proxyMode: CorsProxyMode = 'public',
  customProxy?: string | CustomProxyConfig
): Promise<CrtSubdomainsData> {
  const cleanApex = (extractApexDomain(apexDomain) || apexDomain)
    .toLowerCase()
    .trim()
    .replace(/:\d+$/, '')
    .replace(/^\.+|\.+$/g, '');

  const targetUrl = `https://crt.sh/?q=%.${encodeURIComponent(cleanApex)}&output=json`;
  const subdomainsSet = new Set<string>();
  const sourcesUsed: string[] = [];
  let failureDetails = '';

  // 1. Concurrently query Certspotter CT API, HackerTarget, and crt.sh
  const queryCertspotter = async () => {
    try {
      const csController = new AbortController();
      const csTimeout = setTimeout(() => csController.abort(), 9000);
      const csUrl = `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(cleanApex)}&include_subdomains=true&expand=dns_names`;
      const csRes = await fetch(csUrl, {
        mode: 'cors',
        headers: { Accept: 'application/json' },
        signal: csController.signal,
      });
      clearTimeout(csTimeout);

      if (csRes.ok) {
        const records = await csRes.json();
        if (Array.isArray(records)) {
          sourcesUsed.push('Certspotter CT');
          records.forEach((item: any) => {
            if (Array.isArray(item.dns_names)) {
              item.dns_names.forEach((name: string) => {
                const cleaned = String(name).toLowerCase().trim().replace(/^\.+|\.+$/g, '');
                const base = cleaned.startsWith('*.') ? cleaned.slice(2) : cleaned;
                if (base && (base === cleanApex || base.endsWith('.' + cleanApex))) {
                  subdomainsSet.add(cleaned);
                }
              });
            }
          });
        }
      }
    } catch (err: any) {
      failureDetails = `Certspotter: ${err?.message || 'failed'}`;
    }
  };

  const queryHackerTarget = async () => {
    try {
      const htController = new AbortController();
      const htTimeout = setTimeout(() => htController.abort(), 7000);
      const htUrl = `https://api.hackertarget.com/hostsearch/?q=${encodeURIComponent(cleanApex)}`;
      const htRes = await fetch(htUrl, {
        mode: 'cors',
        signal: htController.signal,
      });
      clearTimeout(htTimeout);

      if (htRes.ok) {
        const text = await htRes.text();
        if (text && !text.includes('error') && !text.includes('API count exceeded')) {
          sourcesUsed.push('HackerTarget');
          const lines = text.split('\n');
          lines.forEach((line) => {
            const host = line.split(',')[0]?.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
            if (host && (host === cleanApex || host.endsWith('.' + cleanApex))) {
              subdomainsSet.add(host);
            }
          });
        }
      }
    } catch (err: any) {
      if (!failureDetails) failureDetails = `HackerTarget: ${err?.message || 'failed'}`;
    }
  };

  const queryCrtSh = async () => {
    try {
      const crtController = new AbortController();
      const crtTimer = setTimeout(() => crtController.abort(), 6000);
      const res = await fetchWithProxyFallback(targetUrl, proxyMode, customProxy, {
        timeoutMs: 6000,
        signal: crtController.signal,
      } as any);
      clearTimeout(crtTimer);

      if (res.ok) {
        const text = await res.text();
        let data: any;
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }

        if (Array.isArray(data)) {
          sourcesUsed.push('crt.sh');
          data.forEach((entry: any) => {
            const nameVal = entry.name_value;
            const commonName = entry.common_name;

            [nameVal, commonName].forEach((val) => {
              if (typeof val === 'string') {
                val.split('\n').forEach((raw) => {
                  const cleaned = raw.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
                  const base = cleaned.startsWith('*.') ? cleaned.slice(2) : cleaned;
                  if (base && (base === cleanApex || base.endsWith('.' + cleanApex))) {
                    subdomainsSet.add(cleaned);
                  }
                });
              }
            });
          });
        }
      }
    } catch (err: any) {
      if (!failureDetails) failureDetails = `crt.sh: ${err?.message || 'proxy query failed'}`;
    }
  };

  await Promise.allSettled([queryCertspotter(), queryHackerTarget(), queryCrtSh()]);

  // 4. Well-Known Service Subdomains probe fallback if zero found
  if (subdomainsSet.size === 0) {
    const commonPrefixes = [
      'www', 'mail', 'api', 'admin', 'app', 'docs', 'cloud', 'portal',
      'dev', 'cdn', 'support', 'status', 'auth', 'login', 'ns1', 'ns2',
      'm', 'secure', 'vpn', 'remote', 'mx', 'smtp', 'beta', 'test',
    ];

    await Promise.all(
      commonPrefixes.map(async (prefix) => {
        const candidate = `${prefix}.${cleanApex}`;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 4000);
          const dohRes = await fetch(
            `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(candidate)}&type=A`,
            { headers: { Accept: 'application/dns-json' }, signal: controller.signal }
          );
          clearTimeout(timer);
          if (dohRes.ok) {
            const json = await dohRes.json();
            if (Array.isArray(json.Answer) && json.Answer.length > 0) {
              subdomainsSet.add(candidate);
            }
          }
        } catch {
          // ignore
        }
      })
    );
  }

  const subdomains = Array.from(subdomainsSet).sort((a, b) => {
    if (a === cleanApex) return -1;
    if (b === cleanApex) return 1;
    return a.localeCompare(b);
  });

  return {
    apexDomain: cleanApex,
    count: subdomains.length,
    subdomains,
    fetchedAt: Date.now(),
    sourceUrl: targetUrl,
    error: subdomains.length === 0 ? (failureDetails || 'No Certificate Transparency records found') : undefined,
  };
}

export async function probeSubdomainItem(hostname: string): Promise<SubdomainProbeResult> {
  const cleanHost = hostname.toLowerCase().trim();
  const startTime = Date.now();
  const probeHost = cleanHost.replace(/^\*+\.?/, '').replace(/^\.+/, '').trim();

  if (!probeHost) {
    return {
      hostname: cleanHost,
      dnsResolves: false,
      isLive: false,
      latencyMs: 0,
      statusText: 'Invalid Hostname',
    };
  }

  try {
    let res: Response | null = null;

    // 1. Primary: Cloudflare DoH (natively CORS enabled with Access-Control-Allow-Origin: *)
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(probeHost)}&type=A`, {
        headers: { Accept: 'application/dns-json' },
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch {}

    // 2. Secondary fallback: 1.1.1.1 DoH (also CORS enabled with Access-Control-Allow-Origin: *)
    if (!res || !res.ok) {
      try {
        const c1Controller = new AbortController();
        const c1Timer = setTimeout(() => c1Controller.abort(), 5000);
        res = await fetch(`https://1.1.1.1/dns-query?name=${encodeURIComponent(probeHost)}&type=A`, {
          headers: { Accept: 'application/dns-json' },
          signal: c1Controller.signal,
        });
        clearTimeout(c1Timer);
      } catch {}
    }

    let ip: string | undefined;
    const cnames: string[] = [];
    let dnsResolves = false;

    if (res && res.ok) {
      const json = await res.json();
      if (Array.isArray(json.Answer)) {
        json.Answer.forEach((ans: any) => {
          if (ans.type === 1 && !ip) {
            ip = ans.data;
            dnsResolves = true;
          } else if (ans.type === 28 && !ip) {
            ip = ans.data;
            dnsResolves = true;
          } else if (ans.type === 5) {
            cnames.push(ans.data);
            dnsResolves = true;
          }
        });
      }
    }

    // 3. Fallback: check AAAA if A had no answer records
    if (!dnsResolves) {
      try {
        const aaaaController = new AbortController();
        const aaaaTimer = setTimeout(() => aaaaController.abort(), 4000);
        const aaaaRes = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(probeHost)}&type=AAAA`, {
          headers: { Accept: 'application/dns-json' },
          signal: aaaaController.signal,
        });
        clearTimeout(aaaaTimer);

        if (aaaaRes.ok) {
          const aaaaJson = await aaaaRes.json();
          if (Array.isArray(aaaaJson.Answer) && aaaaJson.Answer.length > 0) {
            aaaaJson.Answer.forEach((ans: any) => {
              if (ans.type === 28 && !ip) {
                ip = ans.data;
                dnsResolves = true;
              } else if (ans.type === 5) {
                cnames.push(ans.data);
                dnsResolves = true;
              }
            });
          }
        }
      } catch {}
    }

    const latencyMs = Date.now() - startTime;

    return {
      hostname: cleanHost,
      dnsResolves,
      ip,
      cnames: cnames.length > 0 ? cnames : undefined,
      isLive: dnsResolves,
      statusText: dnsResolves ? 'DNS Resolved' : 'NXDOMAIN / Unresolved',
      latencyMs,
    };
  } catch (err: any) {
    return {
      hostname: cleanHost,
      dnsResolves: false,
      isLive: false,
      latencyMs: Date.now() - startTime,
      error: err.message || 'Resolution failed',
    };
  }
}

export async function probeSubdomainBatch(hostnames: string[]): Promise<SubdomainProbeResult[]> {
  const results: SubdomainProbeResult[] = [];
  const concurrency = 8;

  for (let i = 0; i < hostnames.length; i += concurrency) {
    const chunk = hostnames.slice(i, i + concurrency);
    const chunkResults = await Promise.all(chunk.map((host) => probeSubdomainItem(host)));
    results.push(...chunkResults);
    if (i + concurrency < hostnames.length) {
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  return results;
}

export async function probeApiEndpointDetails(
  endpointUrl: string,
  method: ApiMethod = 'GET',
  proxyMode: CorsProxyMode = 'public',
  customProxy?: string | CustomProxyConfig
): Promise<Partial<ApiEndpointRecord>> {
  const startTime = Date.now();

  try {
    const res = await fetchWithProxyFallback(endpointUrl, proxyMode, customProxy, {
      method: method === 'POST' ? 'POST' : 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*',
      },
    });

    const latencyMs = Date.now() - startTime;
    const statusCode = res.status;
    const contentType = res.headers.get('content-type') || undefined;

    let responsePreview = '';
    try {
      const text = await res.text();
      responsePreview = text.slice(0, 1000);
    } catch {
      // preview omitted
    }

    const allowHeader = res.headers.get('allow');
    const allowedMethods: ApiMethod[] = [method];
    if (allowHeader) {
      allowHeader.split(',').forEach((m) => {
        const cleanMethod = m.trim().toUpperCase() as ApiMethod;
        if (!allowedMethods.includes(cleanMethod)) {
          allowedMethods.push(cleanMethod);
        }
      });
    }

    return {
      statusCode,
      latencyMs,
      contentType,
      allowedMethods,
      responsePreview: responsePreview || undefined,
      lastQueriedAt: Date.now(),
    };
  } catch (err: any) {
    return {
      statusCode: 0,
      latencyMs: Date.now() - startTime,
      responsePreview: `Probe error: ${err.message || 'Network request failed'}`,
      lastQueriedAt: Date.now(),
    };
  }
}

export async function fetchFullDomainIntelligence(
  domain: string,
  proxyMode: CorsProxyMode = 'public',
  customProxy?: string | CustomProxyConfig
): Promise<DomainIntelligence> {
  const cleanDomain = domain.toLowerCase().trim().replace(/:\d+$/, '');
  const rootApex = extractApexDomain(cleanDomain);

  const [dnsResult, whoisResult, crtResult] = await Promise.all([
    resolveDnsRecords(cleanDomain),
    fetchRdapWhois(cleanDomain),
    fetchCrtSubdomains(rootApex, proxyMode, customProxy),
  ]);

  return {
    domain: cleanDomain,
    resolvedIp: dnsResult.resolvedIp,
    fetchedAt: Date.now(),
    dns: dnsResult.dns,
    whois: whoisResult,
    ssl: null,
    server: null,
    crtSubdomains: crtResult,
  };
}

// SPDX-License-Identifier: AGPL-3.0-or-later

export const AI_ASSISTANCE_FILENAMES = [
  'llms.txt',
  'llms-full.txt',
  'llm.txt',
  'llm-full.txt',
  'llms.md',
  'llm.md',
  'ai.txt',
  'ai.md',
  'ai-index.txt',
  'ai-index.md',
  'ai-context.txt',
  'ai-context.md',
  'ai-guide.txt',
  'ai-guide.md',
  'agents.txt',
  'agents.md',
  'ai-agents.txt',
  'ai-agents.md',
  'agent.txt',
  'agent.md',
  'model-context.txt',
  'model-context.md',
  'ai-context.json',
  'agent-manifest.json',
  'docs.txt',
  'docs.md',
  'documentation.txt',
  'documentation.md',
  'context.txt',
  'context.md',
  'site-context.txt',
  'site-context.md',
  'knowledge.txt',
  'knowledge.md',
  'knowledge-base.txt',
  'knowledge-base.md',
] as const;

export type CorsProxyMode =
  | 'direct'
  | 'public'
  | 'custom'
  | 'corsdev'
  | 'allorigins'
  | 'corsproxy'
  | 'codetabs'
  | 'scrapingbee'
  | 'zenrows'
  | 'brightdata'
  | 'scraperapi';

export type CustomProxyUrlDestination = 'template' | 'header' | 'placeholder' | 'query' | 'suffix';
export type CustomProxyApiKeyDestination = 'template' | 'header' | 'none' | 'query' | 'placeholder';

export interface CustomProxyConfig {
  urlTemplate: string;
  urlDestination: CustomProxyUrlDestination;
  urlQueryParam?: string;
  urlHeaderName?: string;
  apiKey?: string;
  apiKeyDestination: CustomProxyApiKeyDestination;
  apiKeyQueryParam?: string;
  apiKeyHeaderName?: string;
  apiKeyHeaderPrefix?: string;
}

export interface PublicProxyStatus {
  id: string;
  name: string;
  urlTemplate: string;
  status: 'online' | 'degraded' | 'offline' | 'untested';
  latencyMs?: number;
  lastChecked?: number;
  error?: string;
}

export interface CrawlConfig {
  startUrl: string;
  maxDepth: number;
  maxPages: number;
  allowSubdomains: boolean;
  stripQueryParams: boolean;
  stripHash: boolean;
  concurrency: number;
  requestDelayMs: number;
  includeRobotsTxt?: boolean;
  includeAiAssistance?: boolean;
  captureApiCalls?: boolean;
  autoQueryApis?: boolean;
  queryCrtSubdomains?: boolean;
  randomizeUserAgent?: boolean;
  pathFilter?: string;
  excludeFilter?: string;
  corsProxyMode?: CorsProxyMode;
  customProxyUrl?: string;
  customProxyConfig?: CustomProxyConfig;
  stealthApiKey?: string;
}

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'QUERY' | 'HEAD' | 'OPTIONS' | 'UNKNOWN';

export type ApiCategory =
  | 'rest'
  | 'graphql'
  | 'rpc'
  | 'json'
  | 'auth'
  | 'feed'
  | 'webhook'
  | 'other';

export type ParameterRequirementStatus = 'REQUIRED' | 'OPTIONAL' | 'UNKNOWN';

export interface ApiQueryParameter {
  name: string;
  in: 'query' | 'path' | 'header' | 'body';
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  sampleValue?: string;
  required?: boolean;
  status?: ParameterRequirementStatus;
  source: 'observed' | 'schema' | 'inferred' | 'graphql' | 'header' | 'probe';
}

export interface ApiPossibleQuery {
  title: string;
  method: ApiMethod;
  url: string;
  description?: string;
  params: ApiQueryParameter[];
  curlExample?: string;
}

export interface ApiEndpointRecord {
  id: string;
  url: string;
  pathname: string;
  domain: string;
  isSameDomain: boolean;
  method: ApiMethod;
  allowedMethods?: ApiMethod[];
  category: ApiCategory;
  detectedIn: 'fetch-xhr' | 'script-inline' | 'script-tag' | 'link' | 'data-attr' | 'response' | 'probe';
  sourceUrl: string;
  sourceUrls: string[];
  queryParams: string[];
  possibleParameters?: ApiQueryParameter[];
  possibleQueries?: ApiPossibleQuery[];
  sampleQueryUrl?: string;
  graphqlFields?: string[];
  queryCapabilitiesSummary?: string;
  contentType?: string;
  statusCode?: number;
  latencyMs?: number;
  responsePreview?: string;
  snippet?: string;
  authHint?: string;
  firstDiscoveredAt: number;
  lastQueriedAt?: number;
}

export type CrawlStatus = 'idle' | 'running' | 'paused' | 'completed' | 'stopped' | 'error';

export type FileCategory =
  | 'document'
  | 'image'
  | 'code'
  | 'stylesheet'
  | 'script'
  | 'media'
  | 'data'
  | 'archive'
  | 'other';

export interface FileRecord {
  path: string; 
  filename: string; 
  extension: string; 
  directory: string; 
  depth: number;
  fileType: FileCategory;
  foundOnUrl: string; 
  foundOnUrls?: string[]; 
  firstDiscoveredAt: number;
  url: string; 
  mimeType?: string;
  domain?: string; 
}

export interface PageRecord {
  id: string;
  url: string;
  normalizedUrl: string;
  pathname: string;
  depth: number;
  statusCode: number;
  statusText: string;
  contentType: string;
  title: string;
  discoveredLinksCount: number;
  sameDomainLinksCount: number;
  externalLinksCount?: number;
  durationMs: number;
  parentUrl?: string;
  error?: string;
  timestamp: number;
  canonicalUrl?: string;
  canonicalStatus?: 'self' | 'canonicalized' | 'cross_domain' | 'loop' | 'invalid';
  isNoIndex?: boolean;
  hasNoFollow?: boolean;
  robotsDirectives?: string[];
  redirectChain?: string[];
  finalUrl?: string;
  truncatedBody?: boolean;
  bytesRead?: number;
  method?: string;
  requestHeaders?: Record<string, string>;
  httpVersion?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  isBlocking?: boolean;
  blockingReason?: string;
}

export interface BlockingEvent {
  type: 'page' | 'log';
  id: string;
  url?: string;
  statusCode?: number;
  message?: string;
  timestamp?: number;
  key?: number;
}

export interface DirectoryRecord {
  path: string; 
  domain?: string; 
  depth: number; 
  parentPath: string | null;
  directPageUrls: string[]; 
  allNestedUrlsCount: number; 
  subDirectories: string[]; 
  firstDiscoveredAt: number;
  foundOnUrl?: string; 
  foundOnUrls?: string[]; 
  directFiles?: FileRecord[]; 
}

export interface DirectoryTreeNode {
  name: string;
  fullPath: string;
  domain?: string;
  depth: number;
  directUrls: string[];
  totalDescendantUrls: number;
  children: Record<string, DirectoryTreeNode>;
  files?: FileRecord[];
  isDomainRoot?: boolean;
}

export interface ExternalLinkRecord {
  url: string; 
  domain: string; 
  rootDomain?: string; 
  pathname: string;
  isAssetOrFile: boolean; 
  fileType?: FileCategory; 
  extension?: string;
  foundOnUrl: string; 
  foundOnUrls: string[]; 
  firstDiscoveredAt: number;
  tagType?: 'a' | 'script' | 'link' | 'img' | 'media' | 'iframe' | 'source' | 'other';
  linkText?: string;
  htmlContext?: string; 
}

export interface CrawlStats {
  pagesVisited: number;
  pagesQueued: number;
  uniqueDirectories: number;
  uniqueFiles: number;
  externalLinksCount: number;
  externalDomainsCount: number;
  totalLinksFound: number;
  sameDomainLinksFound: number;
  apiEndpointsCount?: number;
  errorsCount: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
  startTime: number | null;
  endTime: number | null;
  currentUrl: string | null;
}

export type ViewTab = 'table' | 'tree' | 'subdomains-sans' | 'external' | 'api' | 'whois' | 'pages';

export interface DnsRecordItem {
  type: string;
  name: string;
  value: string;
  ttl?: number;
  priority?: number;
}

export interface WhoisRdapInfo {
  domainName: string;
  rootDomain?: string;
  queryDomain?: string;
  registrar?: string;
  ianaId?: string;
  createdDate?: string;
  updatedDate?: string;
  expiresDate?: string;
  status?: string[];
  nameservers?: string[];
  whoisServer?: string;
  registrantCountry?: string;
  abuseContact?: string;
  source?: 'rdap' | 'whois' | 'doh';
  rawText?: string;
}

export interface SslCertInfo {
  subject?: string;
  issuer?: string;
  validFrom?: string;
  validTo?: string;
  daysRemaining?: number;
  isExpired?: boolean;
  san?: string[];
  fingerprint?: string;
  serialNumber?: string;
  protocol?: string;
}

export interface ServerHttpHeaders {
  statusCode?: number;
  statusText?: string;
  server?: string;
  hsts?: string;
  csp?: string;
  xFrameOptions?: string;
  xContentTypeOptions?: string;
  referrerPolicy?: string;
  contentType?: string;
  contentLength?: string;
  latencyMs?: number;
  ipAddress?: string;
  rawHeaders?: Record<string, string>;
  robotsTxtPresent?: boolean;
  robotsTxtUrl?: string;
  robotsTxtContentPreview?: string;
  sitemapPresent?: boolean;
  sitemapUrl?: string;
  aiAssistancePresent?: boolean;
  aiAssistanceCount?: number;
  aiAssistanceFiles?: Array<{ filename: string; url: string; size?: number; preview?: string }>;
}

export interface SubdomainProbeResult {
  hostname: string;
  dnsResolves: boolean;
  ip?: string;
  cnames?: string[];
  isLive: boolean;
  statusCode?: number;
  statusText?: string;
  latencyMs?: number;
  error?: string;
}

export interface CrtSubdomainItem {
  subdomain: string;
  isWildcard?: boolean;
  dnsResolves?: boolean;
  isLive?: boolean;
  ip?: string;
  statusCode?: number;
  cname?: string;
  latencyMs?: number;
  probed?: boolean;
  error?: string;
}

export interface CrtSubdomainsData {
  apexDomain: string;
  count: number;
  subdomains: string[];
  fetchedAt: number;
  sourceUrl: string;
  error?: string;
}

export interface DomainIntelligence {
  domain: string;
  resolvedIp?: string;
  fetchedAt: number;
  dns: DnsRecordItem[];
  whois: WhoisRdapInfo | null;
  ssl: SslCertInfo | null;
  server: ServerHttpHeaders | null;
  crtSubdomains?: CrtSubdomainsData | null;
  error?: string;
}

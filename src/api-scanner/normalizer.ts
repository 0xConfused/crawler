// SPDX-License-Identifier: AGPL-3.0-or-later

export interface NormalizedRouteResult {
  normalizedPath: string;
  pathTemplate: string;
  segments: string[];
  dynamicIndices: number[];
  paramNames: Record<number, string>;
  rawPath: string;
}

export class RouteNormalizer {
  // Static version markers and common action endpoints that must never be normalized as dynamic IDs
  private static readonly STATIC_SEGMENT_WHITELIST = new Set([
    // Versions
    'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10',
    'v1.0', 'v2.0', 'v3.0', 'beta', 'alpha', 'internal', 'public', 'latest',
    // Common top-level namespaces
    'api', 'rest', 'graphql', 'rpc', 'services', 'service', 'endpoints', 'endpoint',
    // Standard singleton actions
    'me', 'self', 'current', 'login', 'logout', 'register', 'signin', 'signup',
    'auth', 'token', 'refresh', 'callback', 'oauth', 'authorize',
    'health', 'healthz', 'status', 'ping', 'metrics', 'ready', 'live',
    'search', 'filter', 'query', 'count', 'bulk', 'batch', 'export', 'import',
    'all', 'list', 'summary', 'overview', 'details', 'metadata', 'schema',
    'profile', 'account', 'settings', 'preferences', 'config', 'configuration',
    'dashboard', 'admin', 'user', 'users', 'order', 'orders', 'item', 'items',
    'product', 'products', 'post', 'posts', 'comment', 'comments', 'file', 'files',
    'role', 'roles', 'group', 'groups', 'permission', 'permissions', 'session', 'sessions',
  ]);

  // Regex patterns identifying dynamic segments
  private static readonly UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  private static readonly NUMERIC_ID_REGEX = /^\d{1,18}$/;
  private static readonly MONGO_OBJECTID_REGEX = /^[0-9a-f]{24}$/i;
  private static readonly HEX_HASH_REGEX = /^[0-9a-f]{32,64}$/i;
  private static readonly VERSION_TAG_REGEX = /^v\d+(\.\d+)?$/i;

  /**
   * Normalizes a raw URL path into a canonical route template.
   * Conservative: only identifies dynamic segments when strong structural or pattern evidence is present.
   */
  public normalize(rawPath: string, hintParamNames?: Record<number, string>): NormalizedRouteResult {
    // Strip trailing slashes, clean query/hashes, collapse multiple consecutive slashes
    let cleanPath = rawPath.split('?')[0].split('#')[0];
    cleanPath = cleanPath.replace(/\/+/g, '/');
    if (cleanPath.length > 1 && cleanPath.endsWith('/')) {
      cleanPath = cleanPath.replace(/\/+$/, '');
    }
    if (!cleanPath.startsWith('/')) {
      cleanPath = '/' + cleanPath;
    }

    const segments = cleanPath.split('/').filter(Boolean);
    const dynamicIndices: number[] = [];
    const paramNames: Record<number, string> = {};
    const normalizedSegments: string[] = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const prevSeg = i > 0 ? segments[i - 1] : null;

      // 1. Never normalize static whitelisted tokens or version tags like /v2/, /v3/
      if (RouteNormalizer.STATIC_SEGMENT_WHITELIST.has(seg.toLowerCase()) || RouteNormalizer.VERSION_TAG_REGEX.test(seg)) {
        normalizedSegments.push(seg);
        continue;
      }

      // 2. Already normalized template segment e.g. {id} or :id
      if ((seg.startsWith('{') && seg.endsWith('}')) || seg.startsWith(':')) {
        const paramName = seg.replace(/[{}:]/g, '');
        dynamicIndices.push(i);
        paramNames[i] = paramName || this.inferParamName(prevSeg, i);
        normalizedSegments.push(`{${paramNames[i]}}`);
        continue;
      }

      // 3. Pattern Recognition for Dynamic IDs
      const isUuid = RouteNormalizer.UUID_REGEX.test(seg);
      const isNumeric = RouteNormalizer.NUMERIC_ID_REGEX.test(seg);
      const isObjectId = RouteNormalizer.MONGO_OBJECTID_REGEX.test(seg);
      const isHexHash = RouteNormalizer.HEX_HASH_REGEX.test(seg);

      if (isUuid || isNumeric || isObjectId || isHexHash) {
        dynamicIndices.push(i);
        const nameFromHint = hintParamNames ? hintParamNames[i] : undefined;
        const inferredName = nameFromHint || this.inferParamName(prevSeg, i);
        paramNames[i] = inferredName;
        normalizedSegments.push(`{${inferredName}}`);
      } else {
        // Keep literal
        normalizedSegments.push(seg);
      }
    }

    const normalizedPath = '/' + normalizedSegments.join('/');
    return {
      normalizedPath,
      pathTemplate: normalizedPath,
      segments: normalizedSegments,
      dynamicIndices,
      paramNames,
      rawPath,
    };
  }

  /**
   * Evidence-based parameter naming derived from preceding resource segment.
   * e.g., /users/{id} -> userId, /orders/{id} -> orderId, fallback -> id / p{index}
   */
  private inferParamName(precedingSegment: string | null, index: number): string {
    if (!precedingSegment) {
      return index === 0 ? 'id' : `p${index}`;
    }

    const cleaned = precedingSegment.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!cleaned) return `p${index}`;

    // Singularize plural resource names
    if (cleaned.endsWith('ies') && cleaned.length > 3) {
      return cleaned.slice(0, -3) + 'yId';
    }
    if (cleaned.endsWith('ses') && cleaned.length > 3) {
      return cleaned.slice(0, -2) + 'Id';
    }
    if (cleaned.endsWith('s') && cleaned.length > 2 && !cleaned.endsWith('ss')) {
      return cleaned.slice(0, -1) + 'Id';
    }

    return `${cleaned}Id`;
  }
}

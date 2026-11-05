// SPDX-License-Identifier: AGPL-3.0-or-later

import { HttpMethod } from './types';

export interface JsEndpointCandidate {
  rawString: string;
  normalizedPath: string;
  method: HttpMethod;
  type: 'literal' | 'template' | 'partial' | 'unresolved';
  confidence: number;
  snippet: string;
  paramNames: string[];
}

export class JsEndpointExtractor {
  // Regex to detect network client invocations
  private static readonly FETCH_AXIOS_REGEX =
    /(?:fetch|axios(?:\.(?:get|post|put|delete|patch|head|options))?|\$(?:\.ajax|\.get|\.post))\s*\(\s*([`'"][^`'"]+[`'"])/gi;

  private static readonly TEMPLATE_LITERAL_REGEX =
    /(?:fetch|axios(?:\.(?:get|post|put|delete|patch|head|options))?)\s*\(\s*`([^`]+)`/gi;

  private static readonly METHOD_CALL_REGEX =
    /axios\.(get|post|put|delete|patch|head|options)\s*\(\s*[`'"]([^`'"]+)[`'"]/gi;

  private static readonly FETCH_WITH_METHOD_REGEX =
    /fetch\s*\(\s*[`'"]([^`'"]+)[`'"]\s*,\s*\{[^}]*method\s*:\s*['"]([A-Z]+)['"]/gi;

  private static readonly XHR_OPEN_REGEX =
    /\.open\s*\(\s*['"](GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)['"]\s*,\s*[`'"]([^`'"]+)[`'"]/gi;

  private static readonly GENERIC_API_URL_REGEX =
    /['"](\/(?:api|v\d+|graphql|rest|auth)\/[a-zA-Z0-9_\-\/{}$:]+)['"]/gi;

  /**
   * Extracts API candidates from JavaScript source code.
   * Categorizes candidates into literal, template, partial, and unresolved strings.
   */
  public extract(jsCode: string, _sourceUrl?: string): JsEndpointCandidate[] {
    const results: JsEndpointCandidate[] = [];
    const seen = new Set<string>();

    if (!jsCode || jsCode.length < 5) return results;

    // 1. axios.method("url")
    let match: RegExpExecArray | null;
    const axiosMethodRe = new RegExp(JsEndpointExtractor.METHOD_CALL_REGEX.source, 'gi');
    while ((match = axiosMethodRe.exec(jsCode)) !== null) {
      const method = match[1].toUpperCase() as HttpMethod;
      const rawUrl = match[2];
      this.addCandidate(rawUrl, method, 'literal', 0.88, match[0], results, seen);
    }

    // 2. fetch("url", { method: "POST" })
    const fetchMethodRe = new RegExp(JsEndpointExtractor.FETCH_WITH_METHOD_REGEX.source, 'gi');
    while ((match = fetchMethodRe.exec(jsCode)) !== null) {
      const rawUrl = match[1];
      const method = match[2].toUpperCase() as HttpMethod;
      this.addCandidate(rawUrl, method, 'literal', 0.88, match[0], results, seen);
    }

    // 3. XHR .open("METHOD", "url")
    const xhrRe = new RegExp(JsEndpointExtractor.XHR_OPEN_REGEX.source, 'gi');
    while ((match = xhrRe.exec(jsCode)) !== null) {
      const method = match[1].toUpperCase() as HttpMethod;
      const rawUrl = match[2];
      this.addCandidate(rawUrl, method, 'literal', 0.90, match[0], results, seen);
    }

    // 4. Template literals in fetch / axios: fetch(`/api/orders/${orderId}`)
    const templateRe = new RegExp(JsEndpointExtractor.TEMPLATE_LITERAL_REGEX.source, 'gi');
    while ((match = templateRe.exec(jsCode)) !== null) {
      const templateContent = match[1];
      const converted = this.convertTemplateToPath(templateContent);
      this.addCandidate(
        templateContent,
        'GET',
        'template',
        0.85,
        match[0],
        results,
        seen,
        converted.normalizedPath,
        converted.paramNames
      );
    }

    // 5. General fetch("url")
    const fetchAxiosRe = new RegExp(JsEndpointExtractor.FETCH_AXIOS_REGEX.source, 'gi');
    while ((match = fetchAxiosRe.exec(jsCode)) !== null) {
      const rawArg = match[1].slice(1, -1);
      if (rawArg.includes('${')) {
        const converted = this.convertTemplateToPath(rawArg);
        this.addCandidate(rawArg, 'GET', 'template', 0.82, match[0], results, seen, converted.normalizedPath, converted.paramNames);
      } else if (rawArg.startsWith('/') || rawArg.startsWith('http')) {
        this.addCandidate(rawArg, 'GET', 'literal', 0.80, match[0], results, seen);
      }
    }

    // 6. Common URL paths in JS strings: "/api/users/..."
    const genericRe = new RegExp(JsEndpointExtractor.GENERIC_API_URL_REGEX.source, 'gi');
    while ((match = genericRe.exec(jsCode)) !== null) {
      const pathCandidate = match[1];
      if (pathCandidate.length > 3 && !seen.has(`GET::${pathCandidate}`)) {
        const isTemplate = pathCandidate.includes('${') || pathCandidate.includes(':');
        this.addCandidate(
          pathCandidate,
          'GET',
          isTemplate ? 'template' : 'literal',
          0.60,
          match[0],
          results,
          seen
        );
      }
    }

    // 7. Detect string concatenation patterns: baseUrl + "/users/" + user.id
    const concatRe = /(?:baseUrl|apiUrl|endpoint|apiHost|serverUrl)\s*\+\s*['"](\/[a-zA-Z0-9_\-\/]+)['"]\s*\+\s*([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)/g;
    while ((match = concatRe.exec(jsCode)) !== null) {
      const prefix = match[1];
      const fullParam = match[2];
      const paramName = fullParam.split('.').pop() || 'id';
      const path = `${prefix.replace(/\/$/, '')}/{${paramName}}`;
      this.addCandidate(match[0], 'GET', 'partial', 0.72, match[0], results, seen, path, [paramName]);
    }

    return results;
  }

  private addCandidate(
    rawString: string,
    method: HttpMethod,
    type: JsEndpointCandidate['type'],
    confidence: number,
    snippet: string,
    results: JsEndpointCandidate[],
    seen: Set<string>,
    customNormalizedPath?: string,
    paramNames: string[] = []
  ): void {
    let cleanPath = customNormalizedPath || rawString;
    // Extract path if full URL
    if (cleanPath.startsWith('http://') || cleanPath.startsWith('https://')) {
      try {
        cleanPath = new URL(cleanPath).pathname;
      } catch {
        cleanPath = '/' + cleanPath.replace(/^https?:\/\/[^\/]+/, '');
      }
    }

    if (!cleanPath.startsWith('/')) {
      cleanPath = '/' + cleanPath;
    }

    const key = `${method}::${cleanPath}`;
    if (seen.has(key)) return;
    seen.add(key);

    results.push({
      rawString,
      normalizedPath: cleanPath,
      method,
      type,
      confidence,
      snippet: snippet.slice(0, 150),
      paramNames,
    });
  }

  private convertTemplateToPath(template: string): { normalizedPath: string; paramNames: string[] } {
    const paramNames: string[] = [];
    const normalized = template.replace(/\$\{([^}]+)\}/g, (_, expression) => {
      // Clean variable expression e.g. user.id -> id, orderId -> orderId
      const cleanName = expression.split('.').pop()?.replace(/[^a-zA-Z0-9_]/g, '') || 'id';
      paramNames.push(cleanName);
      return `{${cleanName}}`;
    });

    let path = normalized;
    if (path.startsWith('http://') || path.startsWith('https://')) {
      try {
        path = new URL(path).pathname;
      } catch {
        path = '/' + path.replace(/^https?:\/\/[^\/]+/, '');
      }
    }

    if (!path.startsWith('/')) {
      path = '/' + path;
    }

    return {
      normalizedPath: path,
      paramNames,
    };
  }
}

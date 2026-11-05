// SPDX-License-Identifier: AGPL-3.0-or-later

import { CanonicalObservation, ConfidenceSignal } from './types';

const ASSET_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'avif',
  'css', 'scss', 'less', 'woff', 'woff2', 'ttf', 'eot', 'otf',
  'mp4', 'webm', 'mp3', 'wav', 'pdf', 'zip', 'tar', 'gz', 'map',
]);

const KNOWN_API_PATH_PATTERNS = [
  /^\/api(\/|$)/i,
  /^\/v\d+(\/|$)/i,
  /^\/rest(\/|$)/i,
  /^\/graphql(\/|$)/i,
  /^\/rpc(\/|$)/i,
  /^\/services?(\/|$)/i,
  /^\/o?auth(\/|$)/i,
  /^\/endpoints?(\/|$)/i,
];

export interface ClassificationResult {
  isApiCandidate: boolean;
  overallConfidence: number;
  signals: ConfidenceSignal[];
  category: 'rest' | 'graphql' | 'rpc' | 'json' | 'auth' | 'other';
}

export class ApiClassifier {
  /**
   * Classify an observation based on multi-signal evidence.
   * Preserves all signals contributing to the classification.
   */
  public classify(obs: Partial<CanonicalObservation>): ClassificationResult {
    const signals: ConfidenceSignal[] = [];
    const path = obs.path || (obs.url ? new URL(obs.url, 'http://localhost').pathname : '/');
    const pathLower = path.toLowerCase();

    // Check for obvious non-API static asset extensions
    const ext = this.extractExtension(pathLower);
    if (ext && ASSET_EXTENSIONS.has(ext)) {
      signals.push({
        name: 'STATIC_ASSET_EXTENSION',
        weight: -0.85,
        description: `URL path contains static file extension .${ext}`,
        source: 'url_path',
      });
      return {
        isApiCandidate: false,
        overallConfidence: 0.05,
        signals,
        category: 'other',
      };
    }

    // 1. Discovery Source Signals
    switch (obs.source) {
      case 'xhr_fetch':
        signals.push({
          name: 'OBSERVED_XHR_FETCH_CALL',
          weight: 0.98,
          description: 'Request originated from XHR/fetch runtime network execution',
          source: obs.source,
        });
        break;
      case 'openapi':
        signals.push({
          name: 'OPENAPI_SPECIFICATION',
          weight: 0.99,
          description: 'Endpoint formally documented in OpenAPI/Swagger definition',
          source: obs.source,
        });
        break;
      case 'graphql':
        signals.push({
          name: 'GRAPHQL_METADATA_OBSERVED',
          weight: 0.96,
          description: 'Endpoint identified through GraphQL schema or introspection query',
          source: obs.source,
        });
        break;
      case 'network':
        signals.push({
          name: 'OBSERVED_NETWORK_TRAFFIC',
          weight: 0.90,
          description: 'Observed active network request over HTTP',
          source: obs.source,
        });
        break;
      case 'javascript':
        signals.push({
          name: 'JAVASCRIPT_CLIENT_REFERENCE',
          weight: 0.85,
          description: 'Referenced inside client-side JavaScript network invocation',
          source: obs.source,
        });
        break;
      case 'json_response':
        signals.push({
          name: 'STRUCTURED_JSON_RESPONSE_LINK',
          weight: 0.88,
          description: 'Found within structured API response hypermedia payload',
          source: obs.source,
        });
        break;
      case 'html_form':
        signals.push({
          name: 'HTML_FORM_ACTION',
          weight: 0.65,
          description: 'Target of HTML form action submission',
          source: obs.source,
        });
        break;
      case 'postman':
      case 'har':
        signals.push({
          name: 'STRUCTURED_COLLECTION_IMPORT',
          weight: 0.92,
          description: `Imported from verified archive format (${obs.source})`,
          source: obs.source,
        });
        break;
      default:
        signals.push({
          name: 'GENERIC_EVIDENCE',
          weight: 0.30,
          description: 'Candidate extracted from passive document analysis',
          source: obs.source || 'unknown',
        });
    }

    // 2. Content-Type Signals
    const resContentType = obs.response_content_type?.toLowerCase() || '';
    const reqContentType = obs.request_content_type?.toLowerCase() || '';

    if (resContentType.includes('application/json') || resContentType.includes('application/problem+json')) {
      signals.push({
        name: 'JSON_API_RESPONSE_CONTENT_TYPE',
        weight: 0.95,
        description: `Server responded with ${resContentType}`,
        source: 'response_headers',
      });
    } else if (resContentType.includes('application/graphql')) {
      signals.push({
        name: 'GRAPHQL_RESPONSE_CONTENT_TYPE',
        weight: 0.98,
        description: 'Server responded with GraphQL content-type',
        source: 'response_headers',
      });
    }

    if (reqContentType.includes('application/json') || reqContentType.includes('application/graphql')) {
      signals.push({
        name: 'API_REQUEST_CONTENT_TYPE',
        weight: 0.92,
        description: `Request payload encoded as ${reqContentType}`,
        source: 'request_headers',
      });
    }

    // 3. Response Structure Signals (if response body is JSON object or array)
    if (obs.response_body && typeof obs.response_body === 'object') {
      signals.push({
        name: 'STRUCTURED_OBJECT_PAYLOAD',
        weight: 0.85,
        description: 'Response payload parsed as structured JSON object or array',
        source: 'response_body',
      });
    }

    // 4. HTTP Method Signals (POST/PUT/PATCH/DELETE are strong API indicators for data mutations)
    if (obs.method && ['POST', 'PUT', 'PATCH', 'DELETE', 'QUERY'].includes(obs.method)) {
      signals.push({
        name: 'REST_MUTATION_METHOD',
        weight: 0.75,
        description: `HTTP method ${obs.method} typically indicates programmatic API mutation`,
        source: 'http_method',
      });
    }

    // 5. Route Structure Signals (Path containing /api/ or version markers provides medium signal)
    const matchesPattern = KNOWN_API_PATH_PATTERNS.some((re) => re.test(pathLower));
    if (matchesPattern) {
      signals.push({
        name: 'API_CONVENTION_PATH_PREFIX',
        weight: 0.45,
        description: 'Route matches common API route conventions (e.g., /api, /v1, /graphql)',
        source: 'path_pattern',
      });
    }

    // 6. Auth Mechanism Signals
    if (obs.auth_mechanism && obs.auth_mechanism.type !== 'None') {
      signals.push({
        name: 'API_AUTHENTICATION_DETECTED',
        weight: 0.80,
        description: `Authenticated using ${obs.auth_mechanism.type} mechanism`,
        source: 'auth_headers',
      });
    }

    // Calculate aggregated confidence score via probabilistic OR
    // C = 1 - product(1 - w_i) for positive weights, normalized to [0, 1]
    const overallConfidence = this.calculateCompositeConfidence(signals);

    // Classification threshold: >= 0.50 considered candidate
    const isApiCandidate = overallConfidence >= 0.45;

    // Categorization
    let category: ClassificationResult['category'] = 'rest';
    if (pathLower.includes('graphql') || resContentType.includes('graphql') || reqContentType.includes('graphql')) {
      category = 'graphql';
    } else if (pathLower.includes('auth') || pathLower.includes('login') || pathLower.includes('oauth') || pathLower.includes('token')) {
      category = 'auth';
    } else if (pathLower.includes('rpc') || pathLower.includes('grpc') || pathLower.includes('jsonrpc')) {
      category = 'rpc';
    } else if (resContentType.includes('application/json') || reqContentType.includes('application/json')) {
      category = 'json';
    }

    return {
      isApiCandidate,
      overallConfidence,
      signals,
      category,
    };
  }

  private calculateCompositeConfidence(signals: ConfidenceSignal[]): number {
    if (signals.length === 0) return 0.20;

    let nonMatchProbability = 1.0;
    for (const signal of signals) {
      if (signal.weight > 0) {
        nonMatchProbability *= (1.0 - Math.min(0.99, signal.weight));
      } else {
        // Negative damping
        nonMatchProbability = Math.min(1.0, nonMatchProbability * (1.0 + Math.abs(signal.weight)));
      }
    }

    const calculated = 1.0 - nonMatchProbability;
    return Math.max(0.01, Math.min(0.99, Math.round(calculated * 100) / 100));
  }

  private extractExtension(pathname: string): string | null {
    const lastSlash = pathname.lastIndexOf('/');
    const filename = lastSlash >= 0 ? pathname.slice(lastSlash + 1) : pathname;
    const dotIndex = filename.lastIndexOf('.');
    if (dotIndex > 0 && dotIndex < filename.length - 1) {
      return filename.slice(dotIndex + 1).toLowerCase();
    }
    return null;
  }
}

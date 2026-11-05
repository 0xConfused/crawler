// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ApiRouteGraph,
  CanonicalEndpoint,
  CanonicalObservation,
  CanonicalOperation,
  DiscoverySourceType,
  EndpointState,
  HttpMethod,
  OpenApiExportOptions,
  ScannerMetrics,
} from './types';
import { ApiClassifier } from './classifier';
import { RouteNormalizer } from './normalizer';
import { ParameterInferenceEngine } from './paramInference';
import { SchemaInferenceEngine } from './schemaInference';
import { JsEndpointExtractor } from './jsExtractor';
import { AuthMapper } from './authMapper';
import { ApiRouteGraphBuilder } from './apiGraph';
import { OpenApiExporter } from './openApiExporter';

export interface ScannerEngineConfig {
  targetHost?: string;
  maxRecursiveDepth?: number;
  maxTotalCandidates?: number;
  minClassificationConfidence?: number;
}

export class ApiScannerEngine {
  private readonly config: Required<ScannerEngineConfig>;
  private readonly classifier: ApiClassifier;
  private readonly normalizer: RouteNormalizer;
  private readonly paramInference: ParameterInferenceEngine;
  private readonly schemaInference: SchemaInferenceEngine;
  private readonly jsExtractor: JsEndpointExtractor;
  private readonly authMapper: AuthMapper;
  private readonly graphBuilder: ApiRouteGraphBuilder;
  private readonly openApiExporter: OpenApiExporter;

  // Normalized Path -> CanonicalEndpoint
  private readonly endpointsMap = new Map<string, CanonicalEndpoint>();
  // Raw observed URL set for loop prevention and deduplication
  private readonly seenRawUrls = new Set<string>();
  // Ingested observation list for complete provenance
  private readonly observationsHistory: CanonicalObservation[] = [];
  private totalIngested = 0;
  private startTime = Date.now();

  constructor(config: ScannerEngineConfig = {}) {
    this.config = {
      targetHost: config.targetHost || '',
      maxRecursiveDepth: config.maxRecursiveDepth ?? 3,
      maxTotalCandidates: config.maxTotalCandidates ?? 2000,
      minClassificationConfidence: config.minClassificationConfidence ?? 0.40,
    };
    this.classifier = new ApiClassifier();
    this.normalizer = new RouteNormalizer();
    this.paramInference = new ParameterInferenceEngine();
    this.schemaInference = new SchemaInferenceEngine();
    this.jsExtractor = new JsEndpointExtractor();
    this.authMapper = new AuthMapper();
    this.graphBuilder = new ApiRouteGraphBuilder();
    this.openApiExporter = new OpenApiExporter();
  }

  /**
   * Ingest a single raw observation into the progressive pipeline.
   * Performs classification, normalization, deduplication, correlation, parameter/schema inference, and recursive link extraction.
   */
  public ingestObservation(rawObs: Partial<CanonicalObservation>, recursiveDepth = 0): CanonicalOperation | null {
    if (this.endpointsMap.size >= this.config.maxTotalCandidates) {
      return null;
    }

    this.totalIngested++;
    const now = Date.now();

    // 1. Sanitize & Redact Authentication Secrets
    const authResult = this.authMapper.detectAndRedact(rawObs.request_headers, rawObs.query_params);
    const sanitizedQueryParams = rawObs.query_params
      ? this.authMapper.sanitizeQueryParams(rawObs.query_params)
      : undefined;

    // 2. Classify Candidate Evidence
    const classification = this.classifier.classify({
      ...rawObs,
      auth_mechanism: authResult.authMechanism,
    });

    if (!classification.isApiCandidate && classification.overallConfidence < this.config.minClassificationConfidence) {
      return null;
    }

    // 3. Normalize Route
    const rawPath = rawObs.path || (rawObs.url ? new URL(rawObs.url, 'http://localhost').pathname : '/');
    const normResult = this.normalizer.normalize(rawPath);
    const normalizedPath = normResult.normalizedPath;

    const method: HttpMethod = (rawObs.method?.toUpperCase() as HttpMethod) || 'GET';
    const source: DiscoverySourceType = rawObs.source || 'network';
    const state: EndpointState = this.resolveInitialState(source, rawObs.status);

    const observation: CanonicalObservation = {
      id: `obs_${this.totalIngested}_${Math.random().toString(36).slice(2, 7)}`,
      url: rawObs.url || normalizedPath,
      scheme: rawObs.scheme || 'https',
      host: rawObs.host || this.config.targetHost || 'localhost',
      port: rawObs.port,
      path: rawPath,
      method,
      source,
      discovered_from: rawObs.discovered_from,
      status: rawObs.status,
      request_content_type: rawObs.request_content_type,
      response_content_type: rawObs.response_content_type,
      request_headers: authResult.sanitizedHeaders,
      response_headers: rawObs.response_headers,
      query_params: sanitizedQueryParams,
      request_body: rawObs.request_body,
      response_body: rawObs.response_body,
      auth_mechanism: authResult.authMechanism,
      confidence: classification.overallConfidence,
      timestamp: rawObs.timestamp || now,
    };

    this.observationsHistory.push(observation);
    if (observation.url) this.seenRawUrls.add(observation.url);

    // 4. Retrieve or Create Canonical Endpoint
    let endpoint = this.endpointsMap.get(normalizedPath);
    if (!endpoint) {
      endpoint = {
        normalizedPath,
        pathTemplate: normResult.pathTemplate,
        segments: normResult.segments,
        operations: {} as Record<HttpMethod, CanonicalOperation>,
        rawObservations: [],
        totalObservations: 0,
        firstSeen: now,
        lastSeen: now,
      };
      this.endpointsMap.set(normalizedPath, endpoint);
    }

    endpoint.totalObservations++;
    endpoint.lastSeen = now;
    if (!endpoint.rawObservations.includes(rawPath) && endpoint.rawObservations.length < 50) {
      endpoint.rawObservations.push(rawPath);
    }

    // 5. Retrieve or Correlate Operation (METHOD + NORMALIZED PATH)
    let op = endpoint.operations[method];
    if (!op) {
      op = {
        method,
        normalizedPath,
        state,
        confidence: classification.overallConfidence,
        signals: [...classification.signals],
        evidenceHistory: [],
        parameters: {},
        responseSchemasByStatus: {},
        authMechanisms: [],
        firstObserved: now,
        lastObserved: now,
        observationCount: 0,
      };
      endpoint.operations[method] = op;
    }

    op.observationCount++;
    op.lastObserved = now;

    // Upgrade state if a direct network/xhr request was observed
    if (state === 'OBSERVED' && op.state !== 'VALIDATED') {
      op.state = 'OBSERVED';
    }

    // Merge confidence probabilistically
    op.confidence = Math.max(op.confidence, classification.overallConfidence);

    // Append evidence
    op.evidenceHistory.push({
      source,
      confidence: classification.overallConfidence,
      timestamp: now,
      discoveredFrom: rawObs.discovered_from,
    });

    // Merge signals without duplicate signal names
    for (const sig of classification.signals) {
      if (!op.signals.some((s) => s.name === sig.name)) {
        op.signals.push(sig);
      }
    }

    // Record auth mechanism if present
    if (authResult.authMechanism.type !== 'None') {
      if (!op.authMechanisms.some((a) => a.type === authResult.authMechanism.type && a.name === authResult.authMechanism.name)) {
        op.authMechanisms.push(authResult.authMechanism);
      }
    }

    // 6. Infer Parameters (Path and Query)
    // Add path parameters
    for (const pName of Object.values(normResult.paramNames)) {
      if (!op.parameters[pName]) {
        op.parameters[pName] = {
          name: pName,
          in: 'path',
          observedTypes: { string: 1, integer: 0, number: 0, boolean: 0, array: 0, object: 0, null: 0, mixed: 0 },
          primaryType: 'string',
          observedValues: [],
          totalObservations: 1,
          presenceCount: 1,
          requiredLikelihood: 1.0,
          possibleEnumValues: [],
        };
      }
    }

    // Update query parameters
    if (sanitizedQueryParams) {
      op.parameters = this.paramInference.updateParameters(
        op.parameters,
        sanitizedQueryParams,
        'query',
        op.observationCount
      );
    }

    // 7. Request Schema Inference
    if (rawObs.request_body) {
      op.requestBodySchema = this.schemaInference.mergeObservation(op.requestBodySchema, rawObs.request_body);
    }

    // 8. Response Schema Inference (Partitioned by Status Code)
    const statusCode = rawObs.status || 200;
    if (rawObs.response_body) {
      op.responseSchemasByStatus[statusCode] = this.schemaInference.mergeObservation(
        op.responseSchemasByStatus[statusCode],
        rawObs.response_body
      );
    }

    // 9. Recursive API Link Extraction from Structured JSON Responses
    if (recursiveDepth < this.config.maxRecursiveDepth && rawObs.response_body) {
      this.extractRecursiveHypermedia(rawObs.response_body, rawObs.url || normalizedPath, recursiveDepth + 1);
    }

    return op;
  }

  /**
   * Ingest JavaScript source code to extract literal and dynamic template endpoints.
   */
  public ingestJavaScript(jsCode: string, scriptUrl?: string): CanonicalOperation[] {
    const candidates = this.jsExtractor.extract(jsCode, scriptUrl);
    const operations: CanonicalOperation[] = [];

    for (const cand of candidates) {
      const op = this.ingestObservation({
        url: cand.normalizedPath,
        path: cand.normalizedPath,
        method: cand.method,
        source: 'javascript',
        discovered_from: scriptUrl,
        confidence: cand.confidence,
      });
      if (op) operations.push(op);
    }

    return operations;
  }

  /**
   * Extracts recursive hypermedia links from structured JSON response bodies.
   */
  private extractRecursiveHypermedia(data: unknown, currentUrl: string, depth: number): void {
    if (!data || typeof data !== 'object') return;

    if (Array.isArray(data)) {
      for (const item of data.slice(0, 10)) {
        this.extractRecursiveHypermedia(item, currentUrl, depth);
      }
      return;
    }

    const obj = data as Record<string, unknown>;
    for (const val of Object.values(obj)) {
      if (typeof val === 'string') {
        const trimmed = val.trim();
        // Check if string looks like an API route (e.g., "/api/users/42/profile")
        if (
          (trimmed.startsWith('/api/') || trimmed.startsWith('/v1/') || trimmed.startsWith('/v2/')) &&
          !this.seenRawUrls.has(trimmed)
        ) {
          this.ingestObservation(
            {
              url: trimmed,
              path: trimmed,
              method: 'GET',
              source: 'json_response',
              discovered_from: currentUrl,
            },
            depth
          );
        }
      } else if (typeof val === 'object' && val !== null) {
        this.extractRecursiveHypermedia(val, currentUrl, depth);
      }
    }
  }

  private resolveInitialState(source: DiscoverySourceType, status?: number): EndpointState {
    if (source === 'network' || source === 'xhr_fetch' || source === 'application_traffic') {
      return status !== undefined ? 'OBSERVED' : 'OBSERVED';
    }
    if (source === 'javascript' || source === 'html_form' || source === 'api_doc') {
      return 'REFERENCED';
    }
    if (source === 'openapi' || source === 'graphql' || source === 'har' || source === 'postman') {
      return 'REFERENCED';
    }
    return 'INFERRED';
  }

  /**
   * Exports the entire discovered API surface as a structured Route Graph.
   */
  public getRouteGraph(): ApiRouteGraph {
    const endpoints = Array.from(this.endpointsMap.values());
    return this.graphBuilder.buildGraph(this.config.targetHost, endpoints);
  }

  /**
   * Exports a human-readable ASCII route tree.
   */
  public getRouteTreeText(): string {
    const graph = this.getRouteGraph();
    return this.graphBuilder.formatRouteTree(graph);
  }

  /**
   * Exports an OpenAPI 3.0.3 specification.
   */
  public getOpenApiSpec(options?: OpenApiExportOptions): Record<string, unknown> {
    const endpoints = Array.from(this.endpointsMap.values());
    return this.openApiExporter.generate(endpoints, {
      host: this.config.targetHost,
      ...options,
    });
  }

  /**
   * Returns all canonical endpoints.
   */
  public getEndpoints(): CanonicalEndpoint[] {
    return Array.from(this.endpointsMap.values()).sort((a, b) => a.normalizedPath.localeCompare(b.normalizedPath));
  }

  /**
   * Returns raw observation provenance history.
   */
  public getObservationsHistory(): CanonicalObservation[] {
    return this.observationsHistory;
  }

  /**
   * Returns runtime metrics.
   */
  public getMetrics(): ScannerMetrics {
    let operationsCount = 0;
    let schemasInferred = 0;

    for (const ep of this.endpointsMap.values()) {
      for (const op of Object.values(ep.operations)) {
        operationsCount++;
        if (op.requestBodySchema) schemasInferred++;
        schemasInferred += Object.keys(op.responseSchemasByStatus).length;
      }
    }

    return {
      totalObservationsIngested: this.totalIngested,
      uniqueRawUrls: this.seenRawUrls.size,
      normalizedEndpointsCount: this.endpointsMap.size,
      operationsCount,
      schemasInferred,
      durationMs: Date.now() - this.startTime,
    };
  }
}

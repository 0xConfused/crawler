// SPDX-License-Identifier: AGPL-3.0-or-later

export type EndpointState = 'OBSERVED' | 'REFERENCED' | 'INFERRED' | 'VALIDATED';

export type DiscoverySourceType =
  | 'network'
  | 'xhr_fetch'
  | 'javascript'
  | 'html_form'
  | 'json_response'
  | 'redirect'
  | 'openapi'
  | 'graphql'
  | 'har'
  | 'postman'
  | 'api_doc'
  | 'application_traffic';

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | 'QUERY'
  | 'TRACE';

export type PrimitiveType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'null'
  | 'mixed';

export type AuthType =
  | 'Bearer'
  | 'ApiKey'
  | 'Basic'
  | 'SessionCookie'
  | 'CustomHeader'
  | 'OAuth2'
  | 'None';

export interface AuthMechanism {
  type: AuthType;
  location: 'header' | 'query' | 'cookie';
  name: string;
  scheme?: string;
  observed: boolean;
  redactedPattern?: string;
}

export interface ConfidenceSignal {
  name: string;
  weight: number;
  description: string;
  source: string;
}

export interface CanonicalObservation {
  id: string;
  url: string;
  scheme: string;
  host: string;
  port?: number;
  path: string;
  method: HttpMethod;
  source: DiscoverySourceType;
  discovered_from?: string;
  status?: number;
  request_content_type?: string | null;
  response_content_type?: string | null;
  request_headers?: Record<string, string>;
  response_headers?: Record<string, string>;
  query_params?: Record<string, string[]>;
  request_body?: unknown;
  response_body?: unknown;
  auth_mechanism?: AuthMechanism;
  confidence: number;
  timestamp: number;
  raw_observation_ref?: string;
}

export interface InferredParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'body';
  observedTypes: Record<PrimitiveType, number>;
  primaryType: PrimitiveType;
  observedValues: string[];
  totalObservations: number;
  presenceCount: number;
  requiredLikelihood: number;
  possibleEnumValues: string[];
  possibleDefaultValue?: string;
  description?: string;
}

export interface SchemaNode {
  type: PrimitiveType;
  types: PrimitiveType[];
  nullable: boolean;
  optional: boolean;
  occurrences: number;
  totalParentObservations: number;
  properties?: Record<string, SchemaNode>;
  itemSchema?: SchemaNode;
  sampleValues?: unknown[];
}

export interface InferredSchema {
  rootType: PrimitiveType;
  schemaNode?: SchemaNode;
  rawObservationsCount: number;
  inferredAt: number;
}

export interface OperationEvidence {
  source: DiscoverySourceType;
  confidence: number;
  timestamp: number;
  discoveredFrom?: string;
  snippet?: string;
  signalName?: string;
}

export interface CanonicalOperation {
  method: HttpMethod;
  normalizedPath: string;
  state: EndpointState;
  confidence: number;
  signals: ConfidenceSignal[];
  evidenceHistory: OperationEvidence[];
  parameters: Record<string, InferredParameter>;
  requestBodySchema?: InferredSchema;
  responseSchemasByStatus: Record<number, InferredSchema>;
  authMechanisms: AuthMechanism[];
  firstObserved: number;
  lastObserved: number;
  observationCount: number;
}

export interface CanonicalEndpoint {
  normalizedPath: string;
  pathTemplate: string;
  segments: string[];
  operations: Record<HttpMethod, CanonicalOperation>;
  rawObservations: string[];
  totalObservations: number;
  firstSeen: number;
  lastSeen: number;
}

export interface RouteTreeNode {
  segment: string;
  normalizedPath: string;
  isDynamic: boolean;
  paramName?: string;
  operations: Record<HttpMethod, CanonicalOperation>;
  children: Record<string, RouteTreeNode>;
}

export interface ApiRouteGraph {
  host: string;
  root: RouteTreeNode;
  totalEndpoints: number;
  totalOperations: number;
  generatedAt: number;
}

export interface ScannerMetrics {
  totalObservationsIngested: number;
  uniqueRawUrls: number;
  normalizedEndpointsCount: number;
  operationsCount: number;
  schemasInferred: number;
  durationMs: number;
}

export interface OpenApiExportOptions {
  title?: string;
  version?: string;
  host?: string;
  basePath?: string;
  minConfidence?: number;
}

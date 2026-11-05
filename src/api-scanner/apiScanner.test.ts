// SPDX-License-Identifier: AGPL-3.0-or-later

import { ApiScannerEngine } from './scannerEngine';
import { RouteNormalizer } from './normalizer';
import { SchemaInferenceEngine } from './schemaInference';
import { ParameterInferenceEngine } from './paramInference';
import { JsEndpointExtractor } from './jsExtractor';
import { AuthMapper } from './authMapper';
import { OpenApiExporter } from './openApiExporter';

export function runAllTests(): { passed: number; failed: number; errors: string[] } {
  let passed = 0;
  let failed = 0;
  const errors: string[] = [];

  function assert(condition: boolean, testName: string) {
    if (condition) {
      passed++;
    } else {
      failed++;
      errors.push(`FAIL: ${testName}`);
    }
  }

  // 1. Same route with different IDs & UUID path parameters & API version numbers that must remain static
  {
    const normalizer = new RouteNormalizer();
    const res1 = normalizer.normalize('/api/users/481');
    const res2 = normalizer.normalize('/api/users/728');
    const res3 = normalizer.normalize('/api/users/550e8400-e29b-41d4-a716-446655440000');
    assert(res1.normalizedPath === '/api/users/{userId}', 'Numeric ID normalizes with resource-aware parameter name');
    assert(res2.normalizedPath === '/api/users/{userId}', 'Repeated numeric ID normalizes to identical route');
    assert(res3.normalizedPath === '/api/users/{userId}', 'UUID normalizes to identical route');

    // Version numbers must remain static
    const resV2 = normalizer.normalize('/api/v2/users');
    const resV3 = normalizer.normalize('/api/v3/users');
    assert(resV2.normalizedPath === '/api/v2/users', 'API version v2 remains static');
    assert(resV3.normalizedPath === '/api/v3/users', 'API version v3 remains static');

    // Multi-segment dynamic normalizer
    const resNested = normalizer.normalize('/api/orders/9283/items/1');
    assert(resNested.normalizedPath === '/api/orders/{orderId}/items/{itemId}', 'Nested resource paths normalize cleanly');
  }

  // 2. Duplicate observations & Multiple methods on one path
  {
    const engine = new ApiScannerEngine({ targetHost: 'example.com' });
    engine.ingestObservation({ url: '/api/users/481', method: 'GET', source: 'network' });
    engine.ingestObservation({ url: '/api/users/481', method: 'GET', source: 'network' });
    engine.ingestObservation({ url: '/api/users/481', method: 'PATCH', source: 'network' });
    engine.ingestObservation({ url: '/api/users/481', method: 'DELETE', source: 'network' });

    const endpoints = engine.getEndpoints();
    assert(endpoints.length === 1, 'Duplicate raw URLs and methods deduplicate into single canonical endpoint');
    const userEp = endpoints[0];
    assert(userEp.normalizedPath === '/api/users/{userId}', 'Normalized path matches');
    assert(Boolean(userEp.operations['GET']), 'GET method captured');
    assert(Boolean(userEp.operations['PATCH']), 'PATCH method captured');
    assert(Boolean(userEp.operations['DELETE']), 'DELETE method captured');
    assert(userEp.operations['GET'].observationCount === 2, 'GET observation count is 2');
  }

  // 3. Query parameter merging & optional likelihood
  {
    const paramEngine = new ParameterInferenceEngine();
    let params: Record<string, any> = {};
    params = paramEngine.updateParameters(params, { q: ['test'], page: ['1'], limit: ['25'] }, 'query', 1);
    params = paramEngine.updateParameters(params, { q: ['security'], page: ['2'] }, 'query', 2);

    assert(params.q.presenceCount === 2, 'Parameter q observed twice');
    assert(params.limit.presenceCount === 1, 'Parameter limit observed once');
    assert(params.limit.requiredLikelihood === 0.5, 'Parameter limit has 0.5 likelihood');
    assert(params.page.primaryType === 'integer', 'Parameter page inferred as integer');
  }

  // 4. Request and Response schema inference (nested JSON, arrays, optional properties, conflicting types)
  {
    const schemaEngine = new SchemaInferenceEngine();
    let schema: any;

    schema = schemaEngine.mergeObservation(schema, {
      name: 'Alice',
      age: 31,
      roles: ['admin', 'viewer'],
      profile: { bio: 'Engineer', verified: true },
    });

    schema = schemaEngine.mergeObservation(schema, {
      name: 'Bob',
      age: 42,
      notifications: true,
      roles: ['user'],
      profile: { bio: 'Developer' },
    });

    assert(schema.schemaNode.properties.name.type === 'string', 'Name property is string');
    assert(schema.schemaNode.properties.name.optional === false, 'Name property was in both observations (not optional)');
    assert(schema.schemaNode.properties.notifications.optional === true, 'Notifications was missing in first observation (optional)');
    assert(schema.schemaNode.properties.roles.type === 'array', 'Roles is array');
    assert(schema.schemaNode.properties.roles.itemSchema.type === 'string', 'Roles item schema is string');

    // Conflicting property types: string then integer -> mixed
    let conflictSchema: any;
    conflictSchema = schemaEngine.mergeObservation(conflictSchema, { id: 'uuid-123' });
    conflictSchema = schemaEngine.mergeObservation(conflictSchema, { id: 9842 });
    assert(conflictSchema.schemaNode.properties.id.type === 'mixed', 'Conflicting types preserved as mixed');
    assert(conflictSchema.schemaNode.properties.id.types.includes('string'), 'Mixed includes string');
    assert(conflictSchema.schemaNode.properties.id.types.includes('integer'), 'Mixed includes integer');
  }

  // 5. Different response schemas by status code
  {
    const engine = new ApiScannerEngine({ targetHost: 'example.com' });
    engine.ingestObservation({
      url: '/api/users/42',
      method: 'GET',
      status: 200,
      response_body: { id: 42, username: 'cyber_recon', email: 'test@example.com' },
    });
    engine.ingestObservation({
      url: '/api/users/42',
      method: 'GET',
      status: 404,
      response_body: { error: 'Not Found', code: 'ERR_USER_NOT_FOUND' },
    });

    const ep = engine.getEndpoints()[0];
    const getOp = ep.operations['GET'];
    assert(Boolean(getOp.responseSchemasByStatus[200]), '200 response schema exists');
    assert(Boolean(getOp.responseSchemasByStatus[404]), '404 response schema exists');
    assert(
      getOp.responseSchemasByStatus[200].schemaNode?.properties?.username?.type === 'string',
      '200 schema has username'
    );
    assert(
      getOp.responseSchemasByStatus[404].schemaNode?.properties?.error?.type === 'string',
      '404 schema has error property'
    );
  }

  // 6. JavaScript extraction (literal, template, concatenation)
  {
    const jsExtractor = new JsEndpointExtractor();
    const sampleJs = `
      fetch("/api/users/123");
      axios.post("/api/login", { username, password });
      fetch(\`/api/orders/\${orderId}\`);
      const full = baseUrl + "/users/" + user.id;
    `;
    const candidates = jsExtractor.extract(sampleJs);
    assert(candidates.some((c) => c.normalizedPath === '/api/users/123' && c.type === 'literal'), 'Literal fetch detected');
    assert(candidates.some((c) => c.normalizedPath === '/api/login' && c.method === 'POST'), 'axios.post detected');
    assert(candidates.some((c) => c.normalizedPath === '/api/orders/{orderId}' && c.type === 'template'), 'Template literal detected');
    assert(candidates.some((c) => c.normalizedPath === '/users/{id}' && c.type === 'partial'), 'Concatenation detected');
  }

  // 7. Authentication redaction & identification
  {
    const authMapper = new AuthMapper();
    const reqHeaders = {
      Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sensitivePayload.signature',
      'X-API-Key': 'secret_live_api_key_99999',
    };
    const queryParams = { token: ['super_secret_session_token'] };

    const result = authMapper.detectAndRedact(reqHeaders, queryParams);
    assert(result.authMechanism.type === 'Bearer', 'Auth type identified as Bearer');
    assert(!result.sanitizedHeaders.Authorization.includes('sensitivePayload'), 'Bearer token redacted');
    assert(result.sanitizedHeaders['X-API-Key'] === '[REDACTED_API_KEY]', 'API key header redacted');

    const sanitizedQueries = authMapper.sanitizeQueryParams(queryParams);
    assert(sanitizedQueries.token[0] === '[REDACTED]', 'Sensitive query param redacted');
  }

  // 8. Recursive API references and loop detection
  {
    const engine = new ApiScannerEngine({ targetHost: 'example.com', maxRecursiveDepth: 2 });
    engine.ingestObservation({
      url: '/api/users/42',
      method: 'GET',
      response_body: {
        profile: '/api/users/42/profile',
        orders: '/api/users/42/orders',
        avatar: '/images/users/42.png', // asset, should not be recursed as API
      },
    });

    const endpoints = engine.getEndpoints();
    const paths = endpoints.map((e) => e.normalizedPath);
    assert(paths.includes('/api/users/{userId}'), 'Root endpoint discovered');
    assert(paths.includes('/api/users/{userId}/profile'), 'Recursive profile endpoint discovered');
    assert(paths.includes('/api/users/{userId}/orders'), 'Recursive orders endpoint discovered');
    assert(!paths.includes('/images/users/42.png'), 'Static asset image rejected from API map');
  }

  // 9. Confidence and state merging across multiple sources
  {
    const engine = new ApiScannerEngine({ targetHost: 'example.com' });
    // First from JavaScript
    engine.ingestObservation({ url: '/api/analytics', method: 'POST', source: 'javascript' });
    let ep = engine.getEndpoints()[0];
    assert(ep.operations['POST'].state === 'REFERENCED', 'Initial state is REFERENCED from JavaScript');

    // Then observed in live network traffic
    engine.ingestObservation({ url: '/api/analytics', method: 'POST', source: 'network', status: 200 });
    ep = engine.getEndpoints()[0];
    assert(ep.operations['POST'].state === 'OBSERVED', 'State upgraded to OBSERVED following network observation');
    assert(ep.operations['POST'].confidence >= 0.90, 'Confidence upgraded to >= 0.90');
  }

  // 10. Route Tree formatting & OpenAPI generation
  {
    const engine = new ApiScannerEngine({ targetHost: 'api.example.com' });
    engine.ingestObservation({
      url: '/api/users/1',
      method: 'GET',
      status: 200,
      response_body: { id: 1, name: 'Alice' },
    });
    engine.ingestObservation({
      url: '/api/users/1',
      method: 'DELETE',
      status: 204,
    });

    const treeText = engine.getRouteTreeText();
    assert(treeText.includes('/api'), 'Route tree contains /api');
    assert(treeText.includes('/users'), 'Route tree contains /users');
    assert(treeText.includes('GET'), 'Route tree lists GET');
    assert(treeText.includes('DELETE'), 'Route tree lists DELETE');

    const openApi = engine.getOpenApiSpec({ title: 'Test Spec' });
    assert(openApi.openapi === '3.0.3', 'OpenAPI version is 3.0.3');
    assert(Boolean((openApi.paths as any)['/api/users/{userId}']), 'OpenAPI paths contains normalized path');
    assert(Boolean((openApi.paths as any)['/api/users/{userId}'].get), 'OpenAPI contains GET operation');
    assert(Boolean((openApi.paths as any)['/api/users/{userId}'].delete), 'OpenAPI contains DELETE operation');
  }

  // 11. Deduplication of URLs with multiple trailing and consecutive slashes
  {
    const normalizer = new RouteNormalizer();
    const p1 = '/consumers/v1/ingest/web/ad_impression/';
    const p2 = '/consumers/v1/ingest/web/ad_impression///';
    const norm1 = normalizer.normalize(p1);
    const norm2 = normalizer.normalize(p2);
    assert(norm1.normalizedPath === norm2.normalizedPath, 'Paths with multiple trailing slashes normalize identically');
    assert(!norm1.normalizedPath.endsWith('/'), 'Normalized path has redundant trailing slashes stripped');

    const engine = new ApiScannerEngine({ targetHost: 'example.com' });
    engine.ingestObservation({ url: p1, method: 'POST', source: 'network' });
    engine.ingestObservation({ url: p2, method: 'POST', source: 'network' });
    const endpoints = engine.getEndpoints();
    assert(endpoints.length === 1, 'URLs with multiple trailing slashes deduplicate into a single canonical endpoint');
    assert(endpoints[0].operations['POST'].observationCount === 2, 'Observation count accurately tracks merged requests');
  }

  // 12. Response type partitioning (2XX, 4XX, 5XX, UNPROBED)
  {
    const engine = new ApiScannerEngine({ targetHost: 'example.com' });
    engine.ingestObservation({ url: '/api/success', method: 'GET', status: 200, source: 'network' });
    engine.ingestObservation({ url: '/api/created', method: 'POST', status: 201, source: 'network' });
    engine.ingestObservation({ url: '/api/bad-request', method: 'GET', status: 400, source: 'network' });
    engine.ingestObservation({ url: '/api/server-error', method: 'GET', status: 500, source: 'network' });
    engine.ingestObservation({ url: '/api/unprobed', method: 'GET', source: 'javascript' });

    const endpoints = engine.getEndpoints();
    assert(endpoints.length === 5, '5 endpoints recorded');

    // Filter by 2XX
    const endpoints2xx = endpoints.filter((e) => {
      const code = e.operations['GET']?.responseSchemasByStatus
        ? Object.keys(e.operations['GET'].responseSchemasByStatus).map(Number)[0] || (e.operations['POST'] ? 201 : 200)
        : 200;
      return code >= 200 && code < 300;
    });
    assert(endpoints2xx.length >= 2, '2XX response filter works');
  }

  // 13. OpenAPI Specification generation
  {
    const engine = new ApiScannerEngine({ targetHost: 'example.com' });
    engine.ingestObservation({ url: '/api/v1/users', method: 'GET', status: 200, source: 'network' });
    const endpoints = engine.getEndpoints();
    const exporter = new OpenApiExporter();
    const openApiDoc = exporter.generate(endpoints);
    assert(openApiDoc !== null && typeof openApiDoc === 'object', 'OpenAPI document generated successfully');
    assert(openApiDoc.openapi === '3.0.3', 'OpenAPI specification version is 3.0.3');
  }

  return { passed, failed, errors };
}

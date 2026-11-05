// SPDX-License-Identifier: AGPL-3.0-or-later

import { CanonicalEndpoint, CanonicalOperation, OpenApiExportOptions, PrimitiveType, SchemaNode } from './types';

export class OpenApiExporter {
  /**
   * Generates a standard OpenAPI 3.0.3 document from canonical endpoints.
   */
  public generate(endpoints: CanonicalEndpoint[], options: OpenApiExportOptions = {}): Record<string, unknown> {
    const minConfidence = options.minConfidence ?? 0.40;
    const paths: Record<string, Record<string, unknown>> = {};
    const securitySchemes: Record<string, unknown> = {};

    for (const ep of endpoints) {
      const pathOps: Record<string, unknown> = {};

      for (const [methodUpper, op] of Object.entries(ep.operations)) {
        if (op.confidence < minConfidence) continue;

        const method = methodUpper.toLowerCase();
        const openApiOp: Record<string, unknown> = {
          summary: `${methodUpper} ${ep.normalizedPath}`,
          description: `Discovered API operation (${op.state}, confidence: ${op.confidence}). Supported by ${op.observationCount} observations.`,
          parameters: this.buildParameters(ep.normalizedPath, op),
          responses: this.buildResponses(op),
          'x-scanner-state': op.state,
          'x-scanner-confidence': op.confidence,
          'x-scanner-observations': op.observationCount,
        };

        // Add request body if present
        if (op.requestBodySchema?.schemaNode && ['post', 'put', 'patch'].includes(method)) {
          openApiOp.requestBody = {
            required: true,
            content: {
              'application/json': {
                schema: this.convertSchemaNode(op.requestBodySchema.schemaNode),
              },
            },
          };
        }

        // Add security requirements
        if (op.authMechanisms.length > 0) {
          const security: Array<Record<string, string[]>> = [];
          for (const auth of op.authMechanisms) {
            if (auth.type === 'Bearer') {
              securitySchemes['bearerAuth'] = {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
              };
              security.push({ bearerAuth: [] });
            } else if (auth.type === 'ApiKey') {
              securitySchemes['apiKeyAuth'] = {
                type: 'apiKey',
                in: auth.location,
                name: auth.name,
              };
              security.push({ apiKeyAuth: [] });
            } else if (auth.type === 'Basic') {
              securitySchemes['basicAuth'] = {
                type: 'http',
                scheme: 'basic',
              };
              security.push({ basicAuth: [] });
            }
          }
          if (security.length > 0) {
            openApiOp.security = security;
          }
        }

        pathOps[method] = openApiOp;
      }

      if (Object.keys(pathOps).length > 0) {
        paths[ep.normalizedPath] = pathOps;
      }
    }

    return {
      openapi: '3.0.3',
      info: {
        title: options.title || 'Discovered API Surface',
        version: options.version || '1.0.0',
        description: 'Progressively discovered API map generated from empirical observations, JavaScript analysis, and runtime traffic.',
      },
      servers: [
        {
          url: options.host ? `https://${options.host}${options.basePath || ''}` : '/',
          description: 'Observed host environment',
        },
      ],
      paths,
      components: {
        securitySchemes: Object.keys(securitySchemes).length > 0 ? securitySchemes : undefined,
      },
    };
  }

  private buildParameters(path: string, op: CanonicalOperation): Array<Record<string, unknown>> {
    const list: Array<Record<string, unknown>> = [];
    const seenNames = new Set<string>();

    // 1. Path parameters
    const pathMatches = path.match(/\{([^}]+)\}/g) || [];
    for (const match of pathMatches) {
      const name = match.slice(1, -1);
      seenNames.add(name);
      list.push({
        name,
        in: 'path',
        required: true,
        schema: {
          type: 'string',
        },
        description: `Path identifier parameter ${name}`,
      });
    }

    // 2. Query parameters
    for (const [name, param] of Object.entries(op.parameters)) {
      if (param.in === 'query' && !seenNames.has(name)) {
        seenNames.add(name);
        const schema: Record<string, unknown> = {
          type: this.mapPrimitiveToOpenApi(param.primaryType),
        };
        if (param.possibleEnumValues.length > 0) {
          schema.enum = param.possibleEnumValues;
        }
        if (param.possibleDefaultValue) {
          schema.default = param.possibleDefaultValue;
        }

        list.push({
          name,
          in: 'query',
          required: param.requiredLikelihood >= 0.85,
          schema,
          description: `Observed in ${Math.round(param.requiredLikelihood * 100)}% of queries (${param.presenceCount}/${param.totalObservations})`,
        });
      }
    }

    return list;
  }

  private buildResponses(op: CanonicalOperation): Record<string, unknown> {
    const responses: Record<string, unknown> = {};

    const statusCodes = Object.keys(op.responseSchemasByStatus).map(Number);
    if (statusCodes.length === 0) {
      responses['200'] = {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: { type: 'object' },
          },
        },
      };
      return responses;
    }

    for (const code of statusCodes) {
      const schemaRecord = op.responseSchemasByStatus[code];
      const desc = this.getStatusDescription(code);

      if (schemaRecord?.schemaNode) {
        responses[String(code)] = {
          description: desc,
          content: {
            'application/json': {
              schema: this.convertSchemaNode(schemaRecord.schemaNode),
            },
          },
        };
      } else {
        responses[String(code)] = {
          description: desc,
        };
      }
    }

    return responses;
  }

  private convertSchemaNode(node: SchemaNode): Record<string, unknown> {
    if (!node) return { type: 'string' };

    const result: Record<string, unknown> = {};
    const openApiType = this.mapPrimitiveToOpenApi(node.type);

    if (node.types && node.types.length > 1) {
      result.anyOf = node.types.map((t) => ({ type: this.mapPrimitiveToOpenApi(t) }));
    } else {
      result.type = openApiType;
    }

    if (node.nullable) {
      result.nullable = true;
    }

    if (node.type === 'object' && node.properties) {
      const props: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [k, child] of Object.entries(node.properties)) {
        props[k] = this.convertSchemaNode(child);
        if (!child.optional) {
          required.push(k);
        }
      }

      result.properties = props;
      if (required.length > 0) {
        result.required = required;
      }
    } else if (node.type === 'array') {
      result.items = node.itemSchema ? this.convertSchemaNode(node.itemSchema) : { type: 'string' };
    }

    if (node.sampleValues && node.sampleValues.length > 0 && node.type !== 'object' && node.type !== 'array') {
      result.example = node.sampleValues[0];
    }

    return result;
  }

  private mapPrimitiveToOpenApi(type: PrimitiveType): string {
    switch (type) {
      case 'integer':
        return 'integer';
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'array':
        return 'array';
      case 'object':
        return 'object';
      default:
        return 'string';
    }
  }

  private getStatusDescription(code: number): string {
    switch (code) {
      case 200: return 'OK - successful resource retrieval';
      case 201: return 'Created - resource created successfully';
      case 204: return 'No Content - resource mutation succeeded with no content';
      case 400: return 'Bad Request - client validation error';
      case 401: return 'Unauthorized - authentication credentials missing or invalid';
      case 403: return 'Forbidden - access denied for current credentials';
      case 404: return 'Not Found - target API resource does not exist';
      case 422: return 'Unprocessable Entity - payload validation failure';
      case 500: return 'Internal Server Error';
      default: return `HTTP ${code} response`;
    }
  }
}

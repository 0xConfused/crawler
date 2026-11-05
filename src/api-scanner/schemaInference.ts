// SPDX-License-Identifier: AGPL-3.0-or-later

import { InferredSchema, PrimitiveType, SchemaNode } from './types';

export class SchemaInferenceEngine {
  /**
   * Progressively merges a new JSON payload observation into an existing schema representation.
   * Preserves conflicting types and uncertain optionality instead of throwing away evidence.
   */
  public mergeObservation(existing: InferredSchema | undefined, payload: unknown): InferredSchema {
    const rawCount = (existing?.rawObservationsCount || 0) + 1;

    if (payload === undefined) {
      return existing || {
        rootType: 'null',
        rawObservationsCount: 1,
        inferredAt: Date.now(),
      };
    }

    const payloadType = this.detectType(payload);
    const updatedNode = this.mergeNode(existing?.schemaNode, payload, payloadType, rawCount);

    return {
      rootType: updatedNode.type,
      schemaNode: updatedNode,
      rawObservationsCount: rawCount,
      inferredAt: Date.now(),
    };
  }

  private mergeNode(
    current: SchemaNode | undefined,
    value: unknown,
    valType: PrimitiveType,
    parentObservationCount: number
  ): SchemaNode {
    if (!current) {
      const node: SchemaNode = {
        type: valType,
        types: valType === 'null' ? [] : [valType],
        nullable: valType === 'null',
        optional: false,
        occurrences: 1,
        totalParentObservations: parentObservationCount,
        sampleValues: this.captureSample(value),
      };

      if (valType === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
        node.properties = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          const childType = this.detectType(v);
          node.properties[k] = this.mergeNode(undefined, v, childType, 1);
        }
      } else if (valType === 'array' && Array.isArray(value)) {
        if (value.length > 0) {
          let itemSchema: SchemaNode | undefined = undefined;
          for (const item of value) {
            const itemType = this.detectType(item);
            itemSchema = this.mergeNode(itemSchema, item, itemType, value.length);
          }
          node.itemSchema = itemSchema;
        }
      }

      return node;
    }

    // Node already exists: merge progressive evidence
    current.occurrences += 1;
    current.totalParentObservations = parentObservationCount;

    if (valType === 'null') {
      current.nullable = true;
    } else {
      if (!current.types.includes(valType)) {
        current.types.push(valType);
      }
      // Re-evaluate primary type
      if (current.types.length === 1) {
        current.type = current.types[0];
      } else if (current.types.includes('integer') && current.types.includes('number') && current.types.length === 2) {
        current.type = 'number';
      } else {
        current.type = 'mixed';
      }
    }

    // Update samples
    const sample = this.captureSample(value);
    if (sample && current.sampleValues) {
      if (current.sampleValues.length < 5 && !current.sampleValues.some((s) => JSON.stringify(s) === JSON.stringify(sample[0]))) {
        current.sampleValues.push(sample[0]);
      }
    }

    // Merge nested object properties
    if (valType === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
      if (!current.properties) current.properties = {};
      const obj = value as Record<string, unknown>;

      for (const [k, v] of Object.entries(obj)) {
        const childType = this.detectType(v);
        current.properties[k] = this.mergeNode(current.properties[k], v, childType, current.occurrences);
      }

      // Mark properties not present in this observation as optional
      for (const [k, childNode] of Object.entries(current.properties)) {
        if (!(k in obj)) {
          childNode.optional = true;
        } else if (childNode.occurrences < current.occurrences) {
          childNode.optional = true;
        }
      }
    }

    // Merge array item schema
    if (valType === 'array' && Array.isArray(value)) {
      for (const item of value) {
        const itemType = this.detectType(item);
        current.itemSchema = this.mergeNode(current.itemSchema, item, itemType, current.occurrences);
      }
    }

    return current;
  }

  private detectType(val: unknown): PrimitiveType {
    if (val === null || val === undefined) return 'null';
    if (Array.isArray(val)) return 'array';
    if (typeof val === 'boolean') return 'boolean';
    if (typeof val === 'number') {
      return Number.isInteger(val) ? 'integer' : 'number';
    }
    if (typeof val === 'object') return 'object';
    return 'string';
  }

  private captureSample(val: unknown): unknown[] | undefined {
    if (val === undefined || val === null) return undefined;
    if (typeof val === 'object') {
      return [Array.isArray(val) ? `[Array(${val.length})]` : '[Object]'];
    }
    return [String(val).slice(0, 100)];
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import { InferredParameter, PrimitiveType } from './types';

export class ParameterInferenceEngine {
  /**
   * Progressively updates an existing parameter map with new observations.
   */
  public updateParameters(
    existing: Record<string, InferredParameter>,
    newParams: Record<string, string[]>,
    paramLocation: 'query' | 'path' | 'header',
    totalOperationObservations: number
  ): Record<string, InferredParameter> {
    const updated: Record<string, InferredParameter> = { ...existing };

    // Update totalObservations for all existing parameters even if not present in current request
    for (const param of Object.values(updated)) {
      param.totalObservations = Math.max(param.totalObservations, totalOperationObservations);
      if (param.totalObservations > 0) {
        param.requiredLikelihood = Math.round((param.presenceCount / param.totalObservations) * 100) / 100;
      }
    }

    for (const [name, rawValues] of Object.entries(newParams)) {
      if (!name || name.trim().length === 0) continue;

      let param = updated[name];
      if (!param) {
        param = {
          name,
          in: paramLocation,
          observedTypes: {
            string: 0,
            integer: 0,
            number: 0,
            boolean: 0,
            array: 0,
            object: 0,
            null: 0,
            mixed: 0,
          },
          primaryType: 'string',
          observedValues: [],
          totalObservations: totalOperationObservations,
          presenceCount: 0,
          requiredLikelihood: 0.0,
          possibleEnumValues: [],
        };
        updated[name] = param;
      }

      param.presenceCount += 1;
      param.totalObservations = Math.max(param.totalObservations, totalOperationObservations);

      // Record types and values
      for (const val of rawValues) {
        if (param.observedValues.length < 30 && !param.observedValues.includes(val)) {
          param.observedValues.push(val);
        }
        const valType = this.inferValueType(val);
        param.observedTypes[valType] = (param.observedTypes[valType] || 0) + 1;
      }

      // Compute primary type
      param.primaryType = this.resolveDominantType(param.observedTypes);

      // Compute required likelihood (fraction of observations where parameter was passed)
      if (param.totalObservations > 0) {
        param.requiredLikelihood = Math.round((param.presenceCount / param.totalObservations) * 100) / 100;
      }

      // Check for enum candidates (<= 8 unique values over at least 3 sightings)
      if (param.observedValues.length >= 2 && param.observedValues.length <= 8 && param.presenceCount >= 3) {
        param.possibleEnumValues = [...param.observedValues];
      }

      // Check for default value candidate (most frequently observed value if dominant)
      if (param.observedValues.length > 0 && !param.possibleDefaultValue) {
        param.possibleDefaultValue = param.observedValues[0];
      }
    }

    return updated;
  }

  private inferValueType(val: string): PrimitiveType {
    if (val === 'true' || val === 'false') return 'boolean';
    if (/^-?\d+$/.test(val)) return 'integer';
    if (/^-?\d+\.\d+$/.test(val)) return 'number';
    if (val.startsWith('[') && val.endsWith(']')) return 'array';
    if (val.startsWith('{') && val.endsWith('}')) return 'object';
    if (val === 'null') return 'null';
    return 'string';
  }

  private resolveDominantType(types: Record<PrimitiveType, number>): PrimitiveType {
    let dominant: PrimitiveType = 'string';
    let maxCount = -1;

    for (const [t, count] of Object.entries(types)) {
      if (count > maxCount) {
        maxCount = count;
        dominant = t as PrimitiveType;
      }
    }

    // Check if there are significant conflicting types -> mixed
    const activeTypes = Object.entries(types).filter(([_, c]) => c > 0);
    if (activeTypes.length > 1) {
      // If integer and number, favor number
      const hasInt = (types.integer || 0) > 0;
      const hasNum = (types.number || 0) > 0;
      if (activeTypes.length === 2 && hasInt && hasNum) {
        return 'number';
      }
      if (activeTypes.length >= 2 && maxCount < (types.integer || 0) + (types.string || 0)) {
        return 'mixed';
      }
    }

    return dominant;
  }
}

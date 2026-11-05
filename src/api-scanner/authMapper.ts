// SPDX-License-Identifier: AGPL-3.0-or-later

import { AuthMechanism } from './types';

export class AuthMapper {
  private static readonly SENSITIVE_PARAM_NAMES = new Set([
    'password', 'passwd', 'secret', 'token', 'access_token', 'refresh_token',
    'apikey', 'api_key', 'auth_token', 'private_key', 'client_secret',
  ]);

  /**
   * Inspects request headers and query parameters to detect authentication mechanisms.
   * Redacts all raw tokens, JWTs, and secret credentials to prevent PII/credential leaks.
   */
  public detectAndRedact(
    headers?: Record<string, string>,
    queryParams?: Record<string, string[]>
  ): {
    authMechanism: AuthMechanism;
    allMechanisms: AuthMechanism[];
    sanitizedHeaders: Record<string, string>;
  } {
    const sanitizedHeaders: Record<string, string> = {};
    const detectedList: AuthMechanism[] = [];

    if (headers) {
      for (const [rawKey, rawVal] of Object.entries(headers)) {
        const keyLower = rawKey.toLowerCase();
        let safeVal = rawVal;

        if (keyLower === 'authorization') {
          if (rawVal.toLowerCase().startsWith('bearer ')) {
            detectedList.push({
              type: 'Bearer',
              location: 'header',
              name: 'Authorization',
              scheme: 'bearer',
              observed: true,
              redactedPattern: 'Bearer [REDACTED_TOKEN]',
            });
            safeVal = 'Bearer [REDACTED_TOKEN]';
          } else if (rawVal.toLowerCase().startsWith('basic ')) {
            detectedList.push({
              type: 'Basic',
              location: 'header',
              name: 'Authorization',
              scheme: 'basic',
              observed: true,
              redactedPattern: 'Basic [REDACTED_CREDS]',
            });
            safeVal = 'Basic [REDACTED_CREDS]';
          } else {
            detectedList.push({
              type: 'CustomHeader',
              location: 'header',
              name: 'Authorization',
              observed: true,
              redactedPattern: '[REDACTED_AUTH]',
            });
            safeVal = '[REDACTED_AUTH]';
          }
        } else if (
          keyLower === 'x-api-key' ||
          keyLower === 'api-key' ||
          keyLower === 'apikey' ||
          keyLower === 'x-api-token'
        ) {
          detectedList.push({
            type: 'ApiKey',
            location: 'header',
            name: rawKey,
            observed: true,
            redactedPattern: '[REDACTED_API_KEY]',
          });
          safeVal = '[REDACTED_API_KEY]';
        } else if (keyLower === 'x-auth-token' || keyLower === 'x-access-token') {
          detectedList.push({
            type: 'CustomHeader',
            location: 'header',
            name: rawKey,
            observed: true,
            redactedPattern: '[REDACTED_TOKEN]',
          });
          safeVal = '[REDACTED_TOKEN]';
        } else if (keyLower === 'cookie') {
          if (/session|jwt|token|sid|auth/i.test(rawVal)) {
            detectedList.push({
              type: 'SessionCookie',
              location: 'cookie',
              name: 'Cookie',
              observed: true,
              redactedPattern: 'SessionCookie=[REDACTED]',
            });
            safeVal = '[REDACTED_SESSION_COOKIE]';
          }
        }

        sanitizedHeaders[rawKey] = safeVal;
      }
    }

    // Check query params for api keys if header auth wasn't found
    if (queryParams) {
      for (const [key] of Object.entries(queryParams)) {
        if (AuthMapper.SENSITIVE_PARAM_NAMES.has(key.toLowerCase())) {
          detectedList.push({
            type: 'ApiKey',
            location: 'query',
            name: key,
            observed: true,
            redactedPattern: `${key}=[REDACTED_KEY]`,
          });
          break;
        }
      }
    }

    // Sort by priority: Bearer > ApiKey > Basic > SessionCookie > CustomHeader
    const priorityOrder: Record<string, number> = {
      Bearer: 5,
      ApiKey: 4,
      Basic: 3,
      SessionCookie: 2,
      CustomHeader: 1,
      None: 0,
    };

    detectedList.sort((a, b) => (priorityOrder[b.type] || 0) - (priorityOrder[a.type] || 0));

    const primaryAuth = detectedList[0] || {
      type: 'None',
      location: 'header',
      name: '',
      observed: false,
    };

    return {
      authMechanism: primaryAuth,
      allMechanisms: detectedList,
      sanitizedHeaders,
    };
  }

  /**
   * Sanitizes query parameters by redacting secret values while retaining parameter existence.
   */
  public sanitizeQueryParams(queryParams: Record<string, string[]>): Record<string, string[]> {
    const sanitized: Record<string, string[]> = {};
    for (const [k, vals] of Object.entries(queryParams)) {
      if (AuthMapper.SENSITIVE_PARAM_NAMES.has(k.toLowerCase())) {
        sanitized[k] = ['[REDACTED]'];
      } else {
        sanitized[k] = vals;
      }
    }
    return sanitized;
  }
}

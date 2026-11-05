// SPDX-License-Identifier: AGPL-3.0-or-later

import { ApiRouteGraph, CanonicalEndpoint, CanonicalOperation, HttpMethod, RouteTreeNode } from './types';

export class ApiRouteGraphBuilder {
  /**
   * Constructs an API route graph from a collection of canonical endpoints.
   */
  public buildGraph(host: string, endpoints: CanonicalEndpoint[]): ApiRouteGraph {
    const root: RouteTreeNode = {
      segment: '/',
      normalizedPath: '/',
      isDynamic: false,
      operations: {} as Record<HttpMethod, CanonicalOperation>,
      children: {},
    };

    let totalOperations = 0;

    for (const ep of endpoints) {
      const segments = ep.normalizedPath.split('/').filter(Boolean);
      let current = root;
      let pathAccumulator = '';

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        pathAccumulator += '/' + seg;
        const isDynamic = seg.startsWith('{') && seg.endsWith('}');
        const paramName = isDynamic ? seg.slice(1, -1) : undefined;

        if (!current.children[seg]) {
          current.children[seg] = {
            segment: seg,
            normalizedPath: pathAccumulator,
            isDynamic,
            paramName,
            operations: {} as Record<HttpMethod, CanonicalOperation>,
            children: {},
          };
        }

        current = current.children[seg];

        // If at the terminal segment, attach operations
        if (i === segments.length - 1) {
          for (const [method, op] of Object.entries(ep.operations)) {
            current.operations[method as HttpMethod] = op;
            totalOperations++;
          }
        }
      }
    }

    return {
      host,
      root,
      totalEndpoints: endpoints.length,
      totalOperations,
      generatedAt: Date.now(),
    };
  }

  /**
   * Generates a clean human-readable ASCII route tree from the API route graph.
   */
  public formatRouteTree(graph: ApiRouteGraph): string {
    const lines: string[] = [graph.host || 'api-surface'];
    this.renderNode(graph.root, '', true, lines);
    return lines.join('\n');
  }

  private renderNode(node: RouteTreeNode, prefix: string, _isRoot: boolean, lines: string[]): void {
    const childrenKeys = Object.keys(node.children).sort((a, b) => {
      // Static routes first, dynamic routes after
      const aDynamic = a.startsWith('{');
      const bDynamic = b.startsWith('{');
      if (aDynamic && !bDynamic) return 1;
      if (!aDynamic && bDynamic) return -1;
      return a.localeCompare(b);
    });

    for (let i = 0; i < childrenKeys.length; i++) {
      const key = childrenKeys[i];
      const child = node.children[key];
      const isLast = i === childrenKeys.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const nextPrefix = prefix + (isLast ? '    ' : '│   ');

      lines.push(`${prefix}${connector}/${child.segment}`);

      // List operations for this node
      const methods = Object.keys(child.operations) as HttpMethod[];
      for (let m = 0; m < methods.length; m++) {
        const method = methods[m];
        const op = child.operations[method];
        const isLastMethod = m === methods.length - 1 && Object.keys(child.children).length === 0;
        const methodConnector = isLastMethod ? '└── ' : '├── ';
        const stateTag = op ? ` [${op.state}, conf: ${op.confidence}]` : '';
        lines.push(`${nextPrefix}${methodConnector}${method}${stateTag}`);
      }

      this.renderNode(child, nextPrefix, false, lines);
    }
  }
}

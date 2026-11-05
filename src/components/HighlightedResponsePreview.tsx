// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useMemo, useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface HighlightedResponsePreviewProps {
  code: string;
  contentType?: string;
  maxHeight?: string;
  className?: string;
  title?: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const HighlightedResponsePreview: React.FC<HighlightedResponsePreviewProps> = ({
  code,
  contentType,
  maxHeight = 'max-h-56',
  className = '',
  title = 'Live Response Structure Preview',
}) => {
  const [copied, setCopied] = useState(false);

  const { formattedCode, highlightedHtmlLines, byteSize } = useMemo(() => {
    if (!code || !code.trim()) {
      return {
        formattedCode: '',
        detectedFormat: 'EMPTY',
        highlightedHtmlLines: [] as string[],
        byteSize: 0,
      };
    }

    const trimmed = code.trim();
    let displayCode = trimmed;
    let format = 'TEXT';

    // Attempt JSON parsing and pretty print
    if (
      (contentType && contentType.toLowerCase().includes('json')) ||
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        displayCode = JSON.stringify(parsed, null, 2);
        format = 'JSON';
      } catch {
        format = 'JSON';
        displayCode = trimmed;
      }
    } else if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
      format = 'XML';
    }

    const byteLen = new Blob([displayCode]).size;

    // Syntax highlight based on format
    let rawHighlighted = '';

    if (format === 'JSON') {
      const escaped = escapeHtml(displayCode);
      // Regex for JSON tokens:
      // 1. Strings & Keys: "..."(:?)
      // 2. Booleans & Null: true|false|null
      // 3. Numbers: -?\d+(\.\d+)?([eE][+-]?\d+)?
      rawHighlighted = escaped.replace(
        /(&quot;(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\&"])*&quot;)(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g,
        (match, pString, pColon, pKeyword) => {
          if (pString) {
            if (pColon) {
              // Object Key
              return `<span class="text-[#f0f0f0] font-bold">${pString}</span><span class="text-[#8c8c8c]">${pColon}</span>`;
            }
            // String value
            const innerVal = pString.slice(6, -6); // remove leading and trailing &quot;
            if (/^https?:\/\//i.test(innerVal) || innerVal.startsWith('/')) {
              // URL or Endpoint path inside string
              return `&quot;<span class="text-[#c300bb] font-semibold underline decoration-[#c300bb]/40">${innerVal}</span>&quot;`;
            }
            return `<span class="text-[#bbc300]">${pString}</span>`;
          }
          if (pKeyword) {
            if (pKeyword === 'null') {
              return `<span class="text-[#737373] italic font-semibold">${pKeyword}</span>`;
            }
            return `<span class="text-[#c300bb] font-semibold">${pKeyword}</span>`;
          }
          // Number
          return `<span class="text-[#c36a00] font-semibold">${match}</span>`;
        }
      );
    } else if (format === 'XML') {
      const escaped = escapeHtml(displayCode);
      rawHighlighted = escaped.replace(
        /(&lt;\/?[a-zA-Z0-9_:-]+)(\s+[^&>]*?)?(\/?&gt;)/g,
        (_m, tagOpen, attrs, tagClose) => {
          let attrHighlighted = '';
          if (attrs) {
            attrHighlighted = attrs.replace(
              /([a-zA-Z0-9_:-]+)(=)(&quot;.*?&quot;|&#39;.*?&#39;)/g,
              (_am, aName, aEq, aVal) => {
                return `<span class="text-[#8c8c8c]">${aName}</span><span class="text-[#737373]">${aEq}</span><span class="text-[#bbc300]">${aVal}</span>`;
              }
            );
          }
          return `<span class="text-[#c30800] font-bold">${tagOpen}</span>${attrHighlighted}<span class="text-[#c30800] font-bold">${tagClose}</span>`;
        }
      );
    } else {
      // Plain text: escape and highlight URLs
      const escaped = escapeHtml(displayCode);
      rawHighlighted = escaped.replace(
        /(https?:\/\/[^\s&<>"']+)/g,
        '<span class="text-[#c300bb] font-semibold underline decoration-[#c300bb]/40">$1</span>'
      );
    }

    const lines = rawHighlighted.split('\n');
    return {
      formattedCode: displayCode,
      detectedFormat: format,
      highlightedHtmlLines: lines,
      byteSize: byteLen,
    };
  }, [code, contentType]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback
    }
  };

  if (!code || !code.trim()) return null;

  return (
    <div className={`space-y-1.5 pt-2 border-t border-[#2e2e2e] ${className}`}>
      {/* Header bar */}
      <div className="flex items-center justify-between text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 bg-[#c30800] shrink-0" />
          <span className="text-[11px] font-mono font-bold text-[#8c8c8c] uppercase tracking-wider">
            {title}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-[#737373]">
            {highlightedHtmlLines.length} {highlightedHtmlLines.length === 1 ? 'LINE' : 'LINES'} • {byteSize} B
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="px-2 py-0.5 border border-[#383838] bg-[#141414] hover:bg-[#262626] font-mono text-[10px] text-[#f0f0f0] transition-colors flex items-center gap-1 cursor-pointer"
            title="Copy response body"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-[#c30800]" />
                <span className="text-[#c30800] font-bold">COPIED</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3 text-[#8c8c8c]" />
                <span>COPY</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Code Viewer with Line Numbers */}
      <div
        className={`bg-[#0d0d0d] border border-[#383838] ${maxHeight} overflow-y-auto overflow-x-auto divide-y divide-[#1a1a1a] scrollbar-thin select-text`}
      >
        {highlightedHtmlLines.map((lineHtml, idx) => (
          <div
            key={idx}
            className="flex text-[10px] font-mono leading-relaxed hover:bg-[#141414] transition-colors"
          >
            <span className="w-10 select-none text-[#737373] text-right pr-2 py-0.5 shrink-0 border-r border-[#262626] bg-[#0d0d0d]">
              {idx + 1}
            </span>
            <span
              className="pl-2.5 pr-2 py-0.5 whitespace-pre min-w-0 font-mono text-[#f0f0f0]"
              dangerouslySetInnerHTML={{ __html: lineHtml || '&nbsp;' }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

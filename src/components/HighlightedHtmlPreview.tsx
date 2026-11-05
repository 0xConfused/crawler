// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useMemo } from 'react';

interface HighlightedHtmlPreviewProps {
  code: string;
  targetDomain?: string | null;
  highlightHost?: string | null;
  className?: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function highlightSegments(
  rawText: string,
  isAttrVal: boolean,
  highlightRegex?: RegExp | null,
  isUrlAttr?: boolean
): string {
  if (!rawText) return '';

  // If the attribute is explicitly a URL target (href, src, etc.) or starts with a URL protocol/path:
  if (
    isUrlAttr ||
    /^https?:\/\//i.test(rawText.trim()) ||
    /^\/\//.test(rawText.trim()) ||
    (isAttrVal && /^\/[a-zA-Z0-9_.~!$&'()*+,;=:@%#-]/i.test(rawText.trim()))
  ) {
    return `<span class="text-[#c300bb] font-semibold underline decoration-[#c300bb]/40">${escapeHtml(rawText)}</span>`;
  }

  // If text contains embedded URLs or domains matching highlightRegex:
  if (highlightRegex) {
    highlightRegex.lastIndex = 0;
    let result = '';
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = highlightRegex.exec(rawText)) !== null) {
      const matchIdx = match.index;
      const matchedText = match[0];

      if (matchIdx > lastIdx) {
        const nonUrlText = rawText.slice(lastIdx, matchIdx);
        const defaultCls = isAttrVal ? 'text-[#bbc300]' : 'text-[#f0f0f0]';
        result += `<span class="${defaultCls}">${escapeHtml(nonUrlText)}</span>`;
      }

      result += `<span class="text-[#c300bb] font-semibold underline decoration-[#c300bb]/40">${escapeHtml(matchedText)}</span>`;
      lastIdx = matchIdx + matchedText.length;
    }

    if (lastIdx < rawText.length) {
      const remainingText = rawText.slice(lastIdx);
      const defaultCls = isAttrVal ? 'text-[#bbc300]' : 'text-[#f0f0f0]';
      result += `<span class="${defaultCls}">${escapeHtml(remainingText)}</span>`;
    }

    return result || `<span class="${isAttrVal ? 'text-[#bbc300]' : 'text-[#f0f0f0]'}">${escapeHtml(rawText)}</span>`;
  }

  const cls = isAttrVal ? 'text-[#bbc300]' : 'text-[#f0f0f0]';
  return `<span class="${cls}">${escapeHtml(rawText)}</span>`;
}

export const HighlightedHtmlPreview: React.FC<HighlightedHtmlPreviewProps> = ({
  code,
  targetDomain,
  highlightHost,
  className = '',
}) => {
  const formattedHtml = useMemo(() => {
    if (!code) return '';

    const patterns: string[] = [];

    patterns.push('https?:\\/\\/[a-zA-Z0-9-._~:/?#[\\]@!$&\'()*+,;=%]+');

    patterns.push('\\/\\/[a-zA-Z0-9-._~:/?#[\\]@!$&\'()*+,;=%]+');

    if (highlightHost && highlightHost.trim()) {
      const cleanHost = highlightHost.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
      if (cleanHost) {
        const escaped = cleanHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        patterns.push(`\\b${escaped}(?::\\d+)?(?:\\/[a-zA-Z0-9-._~:/?#[\\]@!$&'()*+,;=%]*)?`);
      }
    }

    if (targetDomain && targetDomain.trim()) {
      const cleanTarget = targetDomain.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
      if (cleanTarget && cleanTarget !== highlightHost?.trim()) {
        const escaped = cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        patterns.push(`\\b(?:[a-zA-Z0-9_-]+\\.)*${escaped}(?::\\d+)?(?:\\/[a-zA-Z0-9-._~:/?#[\\]@!$&'()*+,;=%]*)?`);
      }
    }

    patterns.push('\\b[a-zA-Z0-9-]+\\.(?:com|org|net|io|co|app|dev|ai|edu|gov|xyz|info|biz|me|cc|tv|uk|de|jp|fr|au|ca|eu|us|ru|ch|it|nl|se|no|es|br|in|cn|top|tech|online|store|site|club|vip|live|cloud|pro|space|agency|link|click|news)\\b(?::\\d+)?(?:\\/[a-zA-Z0-9-._~:/?#[\\]@!$&\'()*+,;=%]*)?');

    const highlightRegex = patterns.length > 0 ? new RegExp(patterns.join('|'), 'gi') : null;

    let i = 0;
    const len = code.length;
    let out = '';

    while (i < len) {
      if (code.startsWith('<!--', i)) {
        const endIdx = code.indexOf('-->', i + 4);
        const commentEnd = endIdx === -1 ? len : endIdx + 3;
        const commentContent = code.slice(i, commentEnd);
        out += `<span class="text-[#737373] italic">${escapeHtml(commentContent)}</span>`;
        i = commentEnd;
        continue;
      }

      if (code[i] === '<') {
        const tagMatch = code.slice(i).match(/^<\/?([a-zA-Z0-9:-]+)/);
        if (tagMatch) {
          const fullTagPrefix = tagMatch[0];
          out += `<span class="text-[#c30800] font-bold font-mono">${escapeHtml(fullTagPrefix)}</span>`;
          i += fullTagPrefix.length;

          while (i < len && code[i] !== '>') {
            const spaceMatch = code.slice(i).match(/^\s+/);
            if (spaceMatch) {
              out += escapeHtml(spaceMatch[0]);
              i += spaceMatch[0].length;
              continue;
            }

            if (code[i] === '/' && (i + 1 >= len || code[i + 1] === '>')) {
              out += `<span class="text-[#c30800] font-bold">/</span>`;
              i++;
              continue;
            }

            const attrMatch = code.slice(i).match(/^([a-zA-Z0-9_:-]+)/);
            if (attrMatch) {
              const attrName = attrMatch[1];
              const isUrlAttr = /^(?:href|src|action|data-url|data-src|poster|formaction|cite|background)$/i.test(attrName);
              out += `<span class="text-[#8c8c8c] font-mono">${escapeHtml(attrName)}</span>`;
              i += attrMatch[0].length;

              const eqMatch = code.slice(i).match(/^(\s*=\s*)/);
              if (eqMatch) {
                out += `<span class="text-[#737373]">${escapeHtml(eqMatch[1])}</span>`;
                i += eqMatch[0].length;

                if (i < len) {
                  const quoteChar = code[i];
                  if (quoteChar === '"') {
                    i++; 
                    const closeQuoteIdx = code.indexOf('"', i);
                    const valEnd = closeQuoteIdx === -1 ? len : closeQuoteIdx;
                    const val = code.slice(i, valEnd);
                    out += `<span class="text-[#737373]">&quot;</span>`;
                    out += highlightSegments(val, true, highlightRegex, isUrlAttr);
                    if (closeQuoteIdx !== -1) {
                      out += `<span class="text-[#737373]">&quot;</span>`;
                    }
                    i = closeQuoteIdx === -1 ? len : closeQuoteIdx + 1;
                  } else if (quoteChar === "'") {
                    i++; 
                    const closeQuoteIdx = code.indexOf("'", i);
                    const valEnd = closeQuoteIdx === -1 ? len : closeQuoteIdx;
                    const val = code.slice(i, valEnd);
                    out += `<span class="text-[#737373]">&#39;</span>`;
                    out += highlightSegments(val, true, highlightRegex, isUrlAttr);
                    if (closeQuoteIdx !== -1) {
                      out += `<span class="text-[#737373]">&#39;</span>`;
                    }
                    i = closeQuoteIdx === -1 ? len : closeQuoteIdx + 1;
                  } else {
                    const unquotedMatch = code.slice(i).match(/^[^\s>]+/);
                    if (unquotedMatch) {
                      const val = unquotedMatch[0];
                      out += highlightSegments(val, true, highlightRegex, isUrlAttr);
                      i += val.length;
                    }
                  }
                }
              }
              continue;
            }

            out += escapeHtml(code[i]);
            i++;
          }

          if (i < len && code[i] === '>') {
            out += `<span class="text-[#c30800] font-bold">&gt;</span>`;
            i++;
          }
          continue;
        } else {
          out += '&lt;';
          i++;
          continue;
        }
      }

      const nextTagIdx = code.indexOf('<', i);
      const chunkEnd = nextTagIdx === -1 ? len : nextTagIdx;
      const textChunk = code.slice(i, chunkEnd);
      out += highlightSegments(textChunk, false, highlightRegex);
      i = chunkEnd;
    }

    return out;
  }, [code, targetDomain, highlightHost]);

  return (
    <div
      className={`text-[11px] font-mono text-[#f0f0f0] whitespace-pre-wrap break-all leading-relaxed ${className}`}
      dangerouslySetInnerHTML={{ __html: formattedHtml }}
    />
  );
};

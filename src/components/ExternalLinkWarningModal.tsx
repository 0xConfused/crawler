// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState, useEffect } from 'react';
import { ShieldAlert, AlertTriangle, Check, Copy, ArrowUpRight, X } from 'lucide-react';

interface ExternalLinkWarningModalProps {
  url: string | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (url: string) => void;
}

export const ExternalLinkWarningModal: React.FC<ExternalLinkWarningModalProps> = ({
  url,
  isOpen,
  onClose,
  onConfirm,
}) => {
  const [copied, setCopied] = useState(false);
  const [rememberChoice, setRememberChoice] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [url, isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !url) return null;

  let domain = '';

  try {
    const parsed = new URL(url);
    domain = parsed.hostname;
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === '0xconfused.com' || hostname.endsWith('.0xconfused.com')) {
      return null;
    }
  } catch {
    domain = url.split('/')[2] || url;
    const cleanDomain = domain.toLowerCase();
    if (cleanDomain === '0xconfused.com' || cleanDomain.endsWith('.0xconfused.com')) {
      return null;
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleProceed = () => {
    if (rememberChoice) {
      try {
        sessionStorage.setItem('skip_external_link_warning', 'true');
      } catch {
        // ignore
      }
    }
    onConfirm(url);
  };

  return (
    <div
      id="external-link-warning-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        id="external-link-warning-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="external-link-modal-title"
        className="w-full max-w-lg bg-[#141414] border border-[#770500]/60 rounded-none shadow-[0_0_35px_rgba(119,5,0,0.25)] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-[2px] w-full bg-gradient-to-r from-[#c30800] via-[#c300bb] to-[#bbc300]" />
        {/* Header Bar */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-[#141414] border-b border-[#770500]/40">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="w-4 h-4 text-[#c3005a] shrink-0" />
            <div>
              <h2 id="external-link-modal-title" className="text-xs font-mono font-bold tracking-wider uppercase text-[#f3f3f7] flex items-center gap-2">
                External Link Warning
              </h2>
              <p className="text-[10px] text-[#8c8c8c] font-mono">
                Third-Party Destination Advisory
              </p>
            </div>
          </div>
          <button
            type="button"
            id="close-external-warning-modal-btn"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-none text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#2e2e2e] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 text-xs font-mono">
          {/* Main Advisory Box */}
          <div className="p-3.5 rounded-none bg-[#141414] border border-[#383838] space-y-2">
            <div className="flex items-start gap-2.5 text-[#f0f0f0]">
              <AlertTriangle className="w-4 h-4 text-[#c36a00] shrink-0 mt-0.5" />
              <div className="text-[11px] leading-relaxed text-[#f0f0f0]">
                You are about to leave <strong className="text-[#f0f0f0]">0xCONFUSED ./crawler</strong> and navigate to an external website. External destinations are not hosted, verified, or controlled by this application.
              </div>
            </div>
          </div>

          {/* Destination URL & Domain Breakdown */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-[#8c8c8c] font-bold">
              <span>Target Destination</span>
            </div>

            <div className="p-3 rounded-none bg-[#0d0d0d] border border-[#2e2e2e] space-y-1.5">
              <div className="flex items-center gap-2 pb-1.5 border-b border-[#2e2e2e] text-[11px]">
                <span className="text-[#c30800] font-bold">Domain:</span>
                <span className="text-[#f0f0f0] font-semibold tracking-wide truncate">{domain}</span>
              </div>
              <div className="text-[10px] text-[#8c8c8c] break-all select-all font-mono py-1 max-h-24 overflow-y-auto leading-relaxed">
                {url}
              </div>
            </div>
          </div>

          {/* Safety Reminder */}
          <div className="p-3 rounded-none bg-[#141414] border border-[#2e2e2e] text-[10px] text-[#8c8c8c] space-y-1">
            <p className="font-semibold text-[#8c8c8c] uppercase tracking-wider text-[9px]">Security Notice:</p>
            <ul className="list-disc list-inside space-y-0.5 text-[#8c8c8c]">
              <li>Never enter credentials or sensitive tokens on unknown external domains.</li>
              <li>Scraped links may redirect or contain tracking parameters.</li>
            </ul>
          </div>

          {/* Session Remember Option */}
          <label className="flex items-center gap-2 cursor-pointer select-none text-[10px] text-[#8c8c8c] hover:text-[#f0f0f0] pt-1">
            <input
              type="checkbox"
              id="remember-skip-warning-checkbox"
              checked={rememberChoice}
              onChange={(e) => setRememberChoice(e.target.checked)}
              className="rounded-none bg-[#0d0d0d] border-[#383838] text-[#770500] focus:ring-[#770500] accent-[#770500]"
            />
            <span>Do not warn me again for external links during this browser session</span>
          </label>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-[#141414] border-t border-[#2e2e2e] gap-3">
          <button
            type="button"
            id="copy-external-url-btn"
            onClick={handleCopy}
            className="px-3 py-2 rounded-none bg-[#141414] border border-[#383838] text-[#f0f0f0] hover:text-[#f0f0f0] hover:bg-[#1a1a1a] text-xs font-mono font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[#c36a00]" /> : <Copy className="w-3.5 h-3.5 text-[#8c8c8c]" />}
            <span>{copied ? 'Copied Link' : 'Copy URL'}</span>
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              id="cancel-external-navigation-btn"
              onClick={onClose}
              className="px-3.5 py-2 rounded-none bg-[#141414] border border-[#383838] text-[#8c8c8c] hover:text-[#f0f0f0] hover:bg-[#1a1a1a] text-xs font-mono font-medium transition-colors cursor-pointer"
            >
              Cancel & Stay
            </button>
            <button
              type="button"
              id="proceed-external-navigation-btn"
              onClick={handleProceed}
              className="px-4 py-2 rounded-none bg-[#c30800] hover:bg-[#f60a00] active:bg-[#770500] border border-[#c30800] text-[#f3f3f7] text-xs font-mono font-bold flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
            >
              <span>Proceed to Site</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

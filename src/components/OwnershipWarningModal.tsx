// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useState, useRef } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { SkullLogo } from './SkullLogo';

const BRAND_NAME = '0xCONFUSED';
const SCRAMBLE_CHARS = '!@#$%^&*<>[]_01';
const TERMS_VERSION = '2026.2';
const SOFTWARE_VERSION = '1.0.0';

export interface LiabilityAcceptanceRecord {
  acceptedAt: string;
  termsVersion: string;
  softwareVersion: string;
  userAcknowledgment: {
    ownershipConfirmed: boolean;
    networkTrafficUnderstood: boolean;
    termsAgreed: boolean;
    status: 'accepted';
  };
}

interface OwnershipWarningModalProps {
  isOpen: boolean;
  onAgree: (record: LiabilityAcceptanceRecord) => void;
}

export const OwnershipWarningModal: React.FC<OwnershipWarningModalProps> = ({
  isOpen,
  onAgree,
}) => {
  const [scrambleText, setScrambleText] = useState<string>(BRAND_NAME);
  // All checkboxes strictly unchecked by default
  const [ownershipConfirmed, setOwnershipConfirmed] = useState<boolean>(false);
  const [networkTrafficUnderstood, setNetworkTrafficUnderstood] = useState<boolean>(false);
  const [termsAgreed, setTermsAgreed] = useState<boolean>(false);
  const hasAnimatedRef = useRef<boolean>(false);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (isOpen) {
      document.body.style.overflow = 'hidden';
      if (!hasAnimatedRef.current) {
        hasAnimatedRef.current = true;
        let iteration = 0;
        interval = setInterval(() => {
          setScrambleText(
            BRAND_NAME.split('')
              .map((_char, index) => {
                if (index < iteration) {
                  return BRAND_NAME[index];
                }
                return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
              })
              .join('')
          );
          if (iteration >= BRAND_NAME.length) {
            if (interval) clearInterval(interval);
            setScrambleText(BRAND_NAME);
          }
          iteration += 1 / 3;
        }, 30);
      }
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      if (interval) clearInterval(interval);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Must select all three checkboxes to proceed
  const canProceed = ownershipConfirmed && networkTrafficUnderstood && termsAgreed;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canProceed) return;

    const record: LiabilityAcceptanceRecord = {
      acceptedAt: new Date().toISOString(),
      termsVersion: TERMS_VERSION,
      softwareVersion: SOFTWARE_VERSION,
      userAcknowledgment: {
        ownershipConfirmed: true,
        networkTrafficUnderstood: true,
        termsAgreed: true,
        status: 'accepted',
      },
    };

    onAgree(record);
  };

  return (
    <div
      id="ownership-warning-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        className="relative w-full max-w-2xl bg-[#141414] border border-[#383838] rounded-none shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="terms-of-use-title"
      >
        <div className="h-[2px] w-full bg-gradient-to-r from-[#c30800] via-[#c300bb] to-[#bbc300]" />
        
        {/* Status Header */}
        <div className="bg-[#141414] backdrop-blur-sm bg-gradient-to-r from-[#c30800]/10 via-transparent to-transparent px-5 h-16 border-b border-[#383838] flex items-center justify-between">
          <div className="flex items-center gap-3.5 min-w-0 h-full">
            <div className="modal-logo-inner relative h-full flex items-center justify-center shrink-0 py-1 overflow-hidden">
              <SkullLogo
                size={64}
                className="h-full w-auto object-contain"
                style={{ height: '100%', width: 'auto' }}
              />
            </div>
            <div className="brand-title-row">
              <span
                className="brand-glitch-text font-glitch select-none cursor-default"
                id="modalBrandGlitchText"
                data-text="0xCONFUSED"
              >
                <span className="brand-title">{scrambleText}</span>
              </span>
              <span className="brand-mod font-mono">./crawler</span>
            </div>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-4 overflow-y-auto custom-scrollbar font-mono text-xs text-[#8c8c8c] leading-relaxed">
          {/* Legal Clauses */}
          <div className="space-y-3 bg-[#141414] p-4 rounded-none border border-[#2e2e2e]">
            <h2
              id="terms-of-use-title"
              className="text-sm font-bold font-mono uppercase tracking-widest text-[#f0f0f0] flex items-center gap-2.5 pb-2.5 border-b border-[#2e2e2e]"
            >
              <span className="w-2 h-2 bg-[#c30800] shrink-0 shadow-[0_0_8px_rgba(195,8,0,0.6)]" />
              <span>Terms of Use &amp; Scope of Authorization</span>
            </h2>
            <ul className="space-y-2.5 list-none">
              <li className="flex items-start gap-2.5">
                <span className="tag tag-sm tag-accent-outline shrink-0 font-bold mt-0.5 min-w-[22px] justify-center">01</span>
                <span className="flex-1 min-w-0">
                  <strong className="text-[#f0f0f0]">Scope of Authorization:</strong> You represent and warrant that you have permission to scan the target system. Authorization applies only to approved domains, IP addresses, and infrastructure, and does not include third-party systems unless the owner gives permission.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="tag tag-sm tag-accent-outline shrink-0 font-bold mt-0.5 min-w-[22px] justify-center">02</span>
                <span className="flex-1 min-w-0">
                  <strong className="text-[#f0f0f0]">Network Traffic:</strong> This software sends network traffic that can trigger security alerts or affect services. You accept responsibility for your use of this software.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="tag tag-sm tag-accent-outline shrink-0 font-bold mt-0.5 min-w-[22px] justify-center">03</span>
                <span className="flex-1 min-w-0">
                  <strong className="text-[#f0f0f0]">Indemnification:</strong> You agree to defend, indemnify, and hold harmless the authors, developers, maintainers, and host from any claims, liabilities, damages, and legal fees arising from your operation of the software.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="tag tag-sm tag-accent-outline shrink-0 font-bold mt-0.5 min-w-[22px] justify-center">04</span>
                <span className="flex-1 min-w-0">
                  <strong className="text-[#f0f0f0]">Warranty Disclaimer:</strong> This software is provided &quot;as is&quot; without warranty of any kind. The authors are not liable for any direct, indirect, incidental, or consequential damages.
                </span>
              </li>
            </ul>

            <div className="pt-2 border-t border-[#2e2e2e] text-[10px] text-[#737373]">
              These terms are subject to applicable law.
            </div>
          </div>

          {/* Three Mandatory Affirmative Checkboxes */}
          <div className="space-y-2 pt-1">
            <label className="flex items-start gap-2.5 p-3 bg-[#0d0d0d] border border-[#2e2e2e] hover:border-[#383838] transition-colors cursor-pointer select-none">
              <input
                type="checkbox"
                id="liability-auth-checkbox"
                checked={ownershipConfirmed}
                onChange={(e) => setOwnershipConfirmed(e.target.checked)}
                className="rounded-none bg-[#141414] border-[#383838] text-[#c30800] accent-[#c30800] mt-0.5 shrink-0"
              />
              <span className="text-[11px] text-[#f0f0f0] font-mono leading-snug">
                I confirm that I own the target system or have written permission from the system owner. I confirm that my permission covers all targets that I scan or crawl.
              </span>
            </label>

            <label className="flex items-start gap-2.5 p-3 bg-[#0d0d0d] border border-[#2e2e2e] hover:border-[#383838] transition-colors cursor-pointer select-none">
              <input
                type="checkbox"
                id="liability-traffic-checkbox"
                checked={networkTrafficUnderstood}
                onChange={(e) => setNetworkTrafficUnderstood(e.target.checked)}
                className="rounded-none bg-[#141414] border-[#383838] text-[#c30800] accent-[#c30800] mt-0.5 shrink-0"
              />
              <span className="text-[11px] text-[#f0f0f0] font-mono leading-snug">
                I understand that this software sends network traffic. This traffic can trigger security alerts or affect services. I accept responsibility for my use of this software.
              </span>
            </label>

            <label className="flex items-start gap-2.5 p-3 bg-[#0d0d0d] border border-[#2e2e2e] hover:border-[#383838] transition-colors cursor-pointer select-none">
              <input
                type="checkbox"
                id="liability-terms-checkbox"
                checked={termsAgreed}
                onChange={(e) => setTermsAgreed(e.target.checked)}
                className="rounded-none bg-[#141414] border-[#383838] text-[#c30800] accent-[#c30800] mt-0.5 shrink-0"
              />
              <span className="text-[11px] text-[#f0f0f0] font-mono leading-snug">
                I have read and agree to all Terms of Use. I agree to the indemnification terms, warranty disclaimer, and limitation of liability.
              </span>
            </label>
          </div>
        </div>

        {/* Modal Footer with Agree Button */}
        <div className="bg-[#141414] px-5 py-4 border-t border-[#383838] flex items-center justify-end">
          <button
            id="agree-ownership-button"
            type="button"
            onClick={handleSubmit}
            disabled={!canProceed}
            className={`w-full sm:w-auto px-6 py-2.5 rounded-none font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all duration-150 border ${
              canProceed
                ? 'bg-gradient-to-r from-[#c30800] to-[#770500] hover:from-[#f60a00] hover:to-[#770500] border-[#c30800] text-[#f3f3f7] cursor-pointer shadow-md active:translate-y-px'
                : 'bg-[#1a1a1a] border-[#2e2e2e] text-[#737373] cursor-not-allowed opacity-50'
            }`}
          >
            <CheckCircle2 className={`w-4 h-4 ${canProceed ? 'text-[#f3f3f7]' : 'text-[#737373]'}`} />
            <span>Agree &amp; Confirm Scope</span>
          </button>
        </div>
      </div>
    </div>
  );
};

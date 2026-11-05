// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useState, useRef } from 'react';
import { ShieldAlert, CheckCircle2 } from 'lucide-react';
import { SkullLogo } from './SkullLogo';

const BRAND_NAME = '0xCONFUSED';
const SCRAMBLE_CHARS = '!@#$%^&*<>[]_01';

interface OwnershipWarningModalProps {
  isOpen: boolean;
  onAgree: () => void;
}

export const OwnershipWarningModal: React.FC<OwnershipWarningModalProps> = ({
  isOpen,
  onAgree,
}) => {
  const [scrambleText, setScrambleText] = useState<string>(BRAND_NAME);
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

  return (
    <div
      id="ownership-warning-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        className="relative w-full max-w-xl bg-[#141414] border border-[#383838] rounded-none shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ownership-warning-title"
      >
        <div className="h-[2px] w-full bg-gradient-to-r from-[#c30800] via-[#c300bb] to-[#bbc300]" />
        {/* Status Header */}
        <div className="bg-[#141414] backdrop-blur-sm bg-gradient-to-r from-[#c30800]/10 via-transparent to-transparent px-5 py-3.5 border-b border-[#383838] flex items-center">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center shrink-0">
              <SkullLogo size={36} className="w-9 h-9 object-contain" />
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
        <div
          className="p-5 sm:p-6 space-y-4 overflow-y-auto font-mono text-xs text-[#8c8c8c] leading-relaxed"
        >
          <div className="flex items-start gap-3 p-3.5 rounded-none bg-[#141414] border border-[#383838]">
            <ShieldAlert className="w-5 h-5 text-[#c36a00] shrink-0 mt-0.5" />
            <div>
              <h2
                id="ownership-warning-title"
                className="font-bold text-sm text-[#f0f0f0] uppercase tracking-wide mb-1"
              >
                Authorized Use Only Warning
              </h2>
              <p className="text-[11px] text-[#8c8c8c]">
                Explicit permission and strict host ownership required before initiating reconnaissance.
              </p>
            </div>
          </div>

          <div className="space-y-3 bg-[#141414] p-4 rounded-none border border-[#2e2e2e]">
            <p className="text-[#f0f0f0] font-semibold text-[11px]">
              Please review and confirm compliance before operating this tool:
            </p>
            <ul className="space-y-2.5 list-none">
              <li className="flex items-start gap-2.5">
                <span className="tag tag-sm tag-accent-outline shrink-0 font-bold mt-0.5 min-w-[22px] justify-center">01</span>
                <span className="flex-1 min-w-0">
                  <strong className="text-[#f0f0f0]">System Ownership:</strong> You certify that you are the verified administrator or owner of the target domain/system, or possess documented written authorization from the owner.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="tag tag-sm tag-accent-outline shrink-0 font-bold mt-0.5 min-w-[22px] justify-center">02</span>
                <span className="flex-1 min-w-0">
                  <strong className="text-[#f0f0f0]">Legal Compliance:</strong> Unauthorized network scanning, automated crawling, or reconnaissance against third-party systems without consent is prohibited and may violate local and international cyber laws.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="tag tag-sm tag-accent-outline shrink-0 font-bold mt-0.5 min-w-[22px] justify-center">03</span>
                <span className="flex-1 min-w-0">
                  <strong className="text-[#f0f0f0]">Responsible Operation:</strong> You agree to configure responsible rate limits and politeness delays to prevent service degradation or operational impact on the target host.
                </span>
              </li>
            </ul>
          </div>

          <p className="text-[10px] text-[#737373] text-center pt-1">
            By proceeding, you assume sole responsibility for your actions and the targets you inspect.
          </p>
        </div>

        {/* Modal Footer with Agree Button */}
        <div className="bg-[#141414] px-5 py-4 border-t border-[#383838] flex flex-col sm:flex-row items-center justify-end gap-3">
          <button
            id="agree-ownership-button"
            type="button"
            onClick={onAgree}
            className="w-full sm:w-auto px-6 py-2.5 rounded-none bg-gradient-to-r from-[#c30800] to-[#770500] hover:from-[#f60a00] hover:to-[#770500] border border-[#c30800] text-[#f3f3f7] text-xs font-mono font-bold uppercase tracking-wider transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer shadow-md hover:shadow-lg active:translate-y-px"
          >
            <CheckCircle2 className="w-4 h-4 text-[#f3f3f7]" />
            I Agree &amp; Understand
          </button>
        </div>
      </div>
    </div>
  );
};

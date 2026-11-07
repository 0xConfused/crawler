// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';

const BRAND_NAME = '0xCONFUSED';

interface LocalDownloadFooterProps {
  onOpenLiabilityTerms?: () => void;
}

export const LocalDownloadFooter: React.FC<LocalDownloadFooterProps> = ({ onOpenLiabilityTerms }) => {
  return (
    <footer
      id="site-footer"
      className="no-print site-footer mt-12 w-full border-t border-[#383838] bg-[#090909] text-[#8c8c8c] font-mono text-xs relative"
    >
      <div className="wrap footer-wrap">
        <div className="footer-primary-row">
          <div className="footer-identity font-mono">
            <a
              href="https://www.0xconfused.com/"
              target="_blank"
              rel="noopener noreferrer"
              data-bypass-warning="true"
              className="no-underline text-inherit inline-block"
              title="0xCONFUSED (https://www.0xconfused.com/)"
              aria-label="0xCONFUSED Website"
            >
              <span
                className="footer-handle font-glitch font-normal cursor-pointer"
                title="0xCONFUSED"
              >
                {BRAND_NAME}
              </span>
            </a>
            <span className="footer-sep">/</span>
            <span className="footer-name font-mono text-[#f0f0f0]">./crawler</span>
            <span className="footer-sep">//</span>
            <span
              className="footer-role"
              title="Web Directory Reconnaissance & Domain Intelligence Engine"
            >
              Web Directory Reconnaissance &amp; Domain Intelligence Engine
            </span>
          </div>

          <div className="footer-links font-mono flex items-center gap-2">
            <span
              className="footer-spec hover:text-[#8c8c8c] transition-colors cursor-default"
              title="SPDX-License-Identifier: AGPL-3.0-or-later"
            >
              AGPL-3.0-or-later
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
};

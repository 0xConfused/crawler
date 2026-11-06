// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';

interface SkullLogoProps {
  className?: string;
  size?: number;
  alt?: string;
  style?: React.CSSProperties;
}

export const SkullLogo: React.FC<SkullLogoProps> = ({
  className = '',
  size = 60,
  alt = '0xCONFUSED ./crawler Logo',
  style,
}) => {
  return (
    <img
      src="./skull-logo.png"
      alt={alt}
      width={size}
      height={size}
      style={{ width: `${size}px`, height: `${size}px`, ...style }}
      referrerPolicy="no-referrer"
      className={`shrink-0 object-contain drop-shadow-md select-none ${className}`}
      loading="eager"
    />
  );
};

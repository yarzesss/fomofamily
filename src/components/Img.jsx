import React, { useState } from 'react';

// Token logo with a graceful fallback (DexScreener images sometimes 404).
export default function Img({ src, fallback = '', size = 18 }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <span className="ph" style={{ width: size, height: size, fontSize: Math.max(8, size * 0.3) }}>{fallback}</span>;
  return <img src={src} alt="" width={size} height={size} style={{ width: size, height: size }} onError={() => setBroken(true)} loading="lazy" />;
}

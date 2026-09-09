// Flipped when Privy fails to start. Kept in memory (not sessionStorage) so a
// one-off failure does not keep the tab on the fallback wallet forever — a
// reload gives Privy another chance.
export const privyState = { off: false };

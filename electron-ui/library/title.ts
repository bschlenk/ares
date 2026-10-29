/** Shared ROM-browser label fallback, independent of a game's storage identity. */
export const romDisplayTitle = (stem: string) => stem.replace(/\s*[([][^)\]]*[)\]]/g,'').trim() || stem;

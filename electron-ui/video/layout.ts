import type { VideoOptions } from './contracts.js';
/** Returns an aspect-correct CSS picture size; the containing surface clips cover. */
export function videoSize(width: number, height: number, sourceHeight: number, aspect: number, dpr: number, options: VideoOptions) {
  if (![width, height, sourceHeight, aspect, dpr].every(n => Number.isFinite(n) && n > 0)) return null;
  const logicalWidth = sourceHeight * aspect;
  let scale = (options.fit === 'cover' ? Math.max : Math.min)(width * dpr / logicalWidth, height * dpr / sourceHeight);
  if (options.integerScale && scale >= 1) scale = options.fit === 'cover' ? Math.ceil(scale) : Math.floor(scale);
  return {width: logicalWidth * scale / dpr, height: sourceHeight * scale / dpr};
}

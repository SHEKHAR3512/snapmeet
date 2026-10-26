import { CUSTOM_IMAGE_LIMITS } from './backgrounds';

/**
 * Validates and decodes a user-chosen background image: type and byte limits first,
 * then a real decode (createImageBitmap), dimension limits, and a downscale so the
 * longest side is at most CUSTOM_IMAGE_LIMITS.targetMaxSide.
 */
export async function decodeCustomImage(
  file: Blob,
): Promise<{ ok: true; bitmap: ImageBitmap } | { ok: false; error: string }> {
  if (!(CUSTOM_IMAGE_LIMITS.types as readonly string[]).includes(file.type)) {
    return { ok: false, error: 'Use a PNG, JPEG or WebP image.' };
  }
  if (file.size > CUSTOM_IMAGE_LIMITS.maxBytes) {
    return { ok: false, error: `Image is larger than ${CUSTOM_IMAGE_LIMITS.maxBytes / (1024 * 1024)} MB.` };
  }
  let decoded: ImageBitmap;
  try {
    decoded = await createImageBitmap(file);
  } catch {
    return { ok: false, error: 'That image could not be decoded.' };
  }
  const { width, height } = decoded;
  if (width < 16 || height < 16 || width > CUSTOM_IMAGE_LIMITS.maxDimension || height > CUSTOM_IMAGE_LIMITS.maxDimension) {
    decoded.close();
    return { ok: false, error: `Image must be between 16 and ${CUSTOM_IMAGE_LIMITS.maxDimension} pixels on each side.` };
  }
  const scale = Math.min(1, CUSTOM_IMAGE_LIMITS.targetMaxSide / Math.max(width, height));
  if (scale === 1) return { ok: true, bitmap: decoded };
  const bitmap = await createImageBitmap(decoded, {
    resizeWidth: Math.round(width * scale),
    resizeHeight: Math.round(height * scale),
    resizeQuality: 'high',
  });
  decoded.close();
  return { ok: true, bitmap };
}

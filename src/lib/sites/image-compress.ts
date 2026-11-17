import "server-only";

/**
 * Photos are bundled into each prototype version, so they must be small. Large photos are
 * resized to at most 1600 px wide and re-encoded as WebP (about 100-250 KB, no visible loss
 * on a website). Small images are left alone. If compression is unavailable the original is
 * kept.
 */
export const COMPRESS_ABOVE_BYTES = 300_000;

export async function compressPhoto(bytes: Uint8Array, contentType: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (bytes.byteLength <= COMPRESS_ABOVE_BYTES || !/^image\/(png|jpeg|webp)$/.test(contentType)) return { bytes, contentType };
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(Buffer.from(bytes)).rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    return out.byteLength < bytes.byteLength ? { bytes: new Uint8Array(out), contentType: "image/webp" } : { bytes, contentType };
  } catch {
    return { bytes, contentType };
  }
}

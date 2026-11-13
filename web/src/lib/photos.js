// Hunt photos: shrunk on the phone, stored in the private Supabase Storage bucket "hunt-photos" (supabase/schema.sql).
// Path = <ground id or "none">/<owner email>/<photo id>.jpg (+ "_t.jpg" thumbnail). The first two folders are what the
// storage rules check: members of that ground can see it, only the owner can add or delete.
export const BUCKET = "hunt-photos";
export const FULL_PX = 1600, THUMB_PX = 360;

export const photoPath = (groundId, email, id, thumb = false) =>
  `${groundId || "none"}/${String(email || "").trim().toLowerCase()}/${id}${thumb ? "_t" : ""}.jpg`;
export const thumbPath = (p) => p.replace(/\.jpg$/, "_t.jpg");

/** Fit (w, h) inside max px on the long side, never upscaling. */
export function fitSize(w, h, max) {
  const k = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/** Every storage path a list of photos uses (full + thumbnail) — for deleting a hunt's photos. */
export const allPaths = (photos) => (photos || []).flatMap((p) => [p.path, thumbPath(p.path)]);

/** Browser only: picture file → { full, thumb } JPEG blobs + size. Decoded through an <img> so the phone's rotation
 *  (EXIF orientation) is applied the same way Safari shows it; the re-encoded JPEG carries no EXIF (no GPS, no camera info). */
export async function shrinkPhoto(file) {
  const src = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = src;
    await img.decode().catch(() => { throw new Error("That file isn't a picture this phone can read"); });
    const W = img.naturalWidth, H = img.naturalHeight;
    const make = (max, q) => new Promise((res, rej) => {
      const [w, h] = fitSize(W, H, max);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const ctx = c.getContext("2d"); ctx.imageSmoothingQuality = "high"; ctx.drawImage(img, 0, 0, w, h);
      c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't shrink that picture"))), "image/jpeg", q);
    });
    const full = await make(FULL_PX, 0.82), thumb = await make(THUMB_PX, 0.75);
    const [w, h] = fitSize(W, H, FULL_PX);
    return { full, thumb, w, h };
  } finally { URL.revokeObjectURL(src); }
}

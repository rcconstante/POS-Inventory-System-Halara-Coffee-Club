export const DEFAULT_GCASH_QR = "/gcash-qr.png";

export function isPaymentQrImage(value: unknown): value is string {
  return typeof value === "string" && (value === DEFAULT_GCASH_QR ||
    (value.length <= 400_000 && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)));
}

export function qrCropBounds(points: ReadonlyArray<{ x: number; y: number }>, version: number): { x: number; y: number; side: number } {
  if (points.length !== 4 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || !Number.isInteger(version) || version < 1 || version > 40) throw new Error("Invalid QR coordinates.");
  const left = Math.min(...points.map((p) => p.x));
  const top = Math.min(...points.map((p) => p.y));
  const width = Math.max(...points.map((p) => p.x)) - left;
  const height = Math.max(...points.map((p) => p.y)) - top;
  const extent = Math.max(width, height);
  if (extent < 21) throw new Error("The QR is too small. Upload a clearer image.");
  const padding = Math.ceil(extent / (17 + version * 4) * 4);
  return { x: left + width / 2 - extent / 2 - padding, y: top + height / 2 - extent / 2 - padding, side: Math.ceil(extent + padding * 2) };
}

export async function cropPaymentQr(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) throw new Error("Upload a JPG, PNG or WebP image, up to 5 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("The image could not be opened.")); image.src = url; });
    if (image.naturalWidth * image.naturalHeight > 25_000_000) throw new Error("The image is too large. Use a smaller photo or screenshot.");
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Image processing is unavailable on this device.");
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { default: jsQR } = await import("jsqr");
    const decoded = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    if (!decoded?.data) throw new Error("No readable QR found. Use a clear, straight photo with the whole QR visible.");
    const location = decoded.location;
    const bounds = qrCropBounds([location.topLeftCorner, location.topRightCorner, location.bottomLeftCorner, location.bottomRightCorner], decoded.version);
    const cropped = document.createElement("canvas");
    cropped.width = cropped.height = Math.max(256, Math.min(1024, bounds.side));
    const target = cropped.getContext("2d", { willReadFrequently: true });
    if (!target) throw new Error("Image processing is unavailable on this device.");
    target.fillStyle = "white"; target.fillRect(0, 0, cropped.width, cropped.height);
    const ratio = cropped.width / bounds.side;
    target.drawImage(canvas, -bounds.x * ratio, -bounds.y * ratio, canvas.width * ratio, canvas.height * ratio);
    const verified = jsQR(target.getImageData(0, 0, cropped.width, cropped.height).data, cropped.width, cropped.height);
    if (!verified || verified.data !== decoded.data) throw new Error("The cropped QR could not be verified. Use a clearer image.");
    const result = cropped.toDataURL("image/png");
    if (!isPaymentQrImage(result)) throw new Error("The QR image is too large to save. Use a simpler screenshot.");
    return result;
  } finally { URL.revokeObjectURL(url); }
}

import { syncReceiptPrint } from "./receipt-printing";

export async function createReceiptImage(document: Document): Promise<File> {
  if (!syncReceiptPrint(document)) throw new Error("Open a receipt before printing.");
  const root = document.getElementById("print-root")!;
  const receiptNumber = root.querySelector<HTMLElement>("[data-receipt-number]")?.dataset.receiptNumber ?? "receipt";
  const filename = `halara-${receiptNumber.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;
  // Snapshot before loading the renderer so navigation cannot change the receipt.
  const receipt = root.cloneNode(true) as HTMLElement;
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(root, {
    backgroundColor: "#ffffff", scale: 2, logging: false, windowWidth: 800,
    scrollX: 0, scrollY: 0,
    onclone: (clone) => {
      const cloneRoot = clone.getElementById("print-root")!;
      cloneRoot.replaceChildren(...Array.from(receipt.childNodes));
      const style = clone.createElement("style");
      // Reuse the receipt's print layout rather than capturing the dashboard.
      style.textContent = Array.from(clone.styleSheets).flatMap((sheet) => {
        try {
          return Array.from(sheet.cssRules).flatMap((rule) =>
            rule.type === CSSRule.MEDIA_RULE && (rule as CSSMediaRule).conditionText === "print"
              ? Array.from((rule as CSSMediaRule).cssRules).map((child) => child.cssText) : []);
        } catch { return []; }
      }).join("\n");
      clone.head.append(style);
      clone.documentElement.style.setProperty("min-width", "800px", "important");
      if (cloneRoot.getBoundingClientRect().height > 10_000) {
        clone.defaultView?.frameElement?.remove();
        throw new Error("This receipt is too long to export as an image. Use browser printing instead.");
      }
    },
  });
  try {
    if (!canvas.width || !canvas.height) throw new Error("The receipt image could not be rendered.");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The receipt image could not be created.");
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const brightness = .299 * pixels.data[index]! + .587 * pixels.data[index + 1]! + .114 * pixels.data[index + 2]!;
      const value = brightness < 180 ? 0 : 255;
      pixels.data[index] = value;
      pixels.data[index + 1] = value;
      pixels.data[index + 2] = value;
    }
    context.putImageData(pixels, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error("The receipt image could not be created.")), "image/png");
    });
    return new File([blob], filename, { type: "image/png" });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function downloadReceiptImage(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function shareReceiptImage(file: File): Promise<"shared" | "downloaded" | "cancelled"> {
  if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      // Preserve the generated receipt if file sharing is blocked by the browser.
    }
  }
  downloadReceiptImage(file);
  return "downloaded";
}

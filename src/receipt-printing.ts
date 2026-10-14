const activePrintDocuments = new WeakSet<Document>();

export function syncReceiptPrint(document: Document): boolean {
  const root = document.getElementById("print-root");
  if (!root) return false;
  if (activePrintDocuments.has(document)) return root.firstElementChild !== null;
  const receipt = document.querySelector("#modal-root [data-print-receipt]")
    ?? document.querySelector("#app .success-flow [data-print-receipt]");
  if (!receipt) root.replaceChildren();
  else if (!root.firstElementChild?.isEqualNode(receipt)) root.replaceChildren(receipt.cloneNode(true));
  return receipt !== null;
}

export function beginReceiptPrint(document: Document): void {
  if (syncReceiptPrint(document)) activePrintDocuments.add(document);
}

export function endReceiptPrint(document: Document): void {
  activePrintDocuments.delete(document);
}

export function requestReceiptPrint(document: Document, window: Window): void {
  // A new user request also recovers browsers that omitted afterprint on cancel.
  endReceiptPrint(document);
  if (!syncReceiptPrint(document)) throw new Error("Open a receipt before printing.");
  if (typeof window.print !== "function") {
    throw new Error("Printing is unavailable here. Open the POS in Chrome and use Share → Print.");
  }
  beginReceiptPrint(document);
  try {
    // Keep this snapshot stable while Android re-lays out the selected paper size.
    window.print();
  } catch (error) {
    endReceiptPrint(document);
    throw error;
  }
}

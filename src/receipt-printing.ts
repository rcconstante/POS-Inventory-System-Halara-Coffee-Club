export function syncReceiptPrint(document: Document): boolean {
  const root = document.getElementById("print-root");
  if (!root) return false;
  const receipt = document.querySelector("#modal-root [data-print-receipt]")
    ?? document.querySelector("#app .success-flow [data-print-receipt]");
  if (!receipt) root.replaceChildren();
  else if (!root.firstElementChild?.isEqualNode(receipt)) root.replaceChildren(receipt.cloneNode(true));
  return receipt !== null;
}

export function requestReceiptPrint(document: Document, window: Window): void {
  if (!syncReceiptPrint(document)) throw new Error("Open a receipt before printing.");
  if (typeof window.print !== "function") {
    throw new Error("Printing is unavailable here. Open the POS in Chrome and use Share → Print.");
  }
  // Call directly from the click handler; delaying can lose browser user activation.
  window.print();
}

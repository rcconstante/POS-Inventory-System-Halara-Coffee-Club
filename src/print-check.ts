const button = document.querySelector<HTMLButtonElement>("#print-test");
const status = document.querySelector<HTMLParagraphElement>("#print-status");
const diagnostics = document.querySelector<HTMLTextAreaElement>("#diagnostics");

if (!button || !status || !diagnostics) throw new Error("Printer check could not be initialized.");

const messages = [
  "Halara printer check v1",
  `Browser: ${navigator.userAgent}`,
  `Secure context: ${window.isSecureContext}`,
  `Native print API: ${typeof window.print === "function"}`,
];
const record = (message: string): void => {
  messages.push(`${new Date().toISOString()} ${message}`);
  diagnostics.value = messages.join("\n");
};
diagnostics.value = messages.join("\n");

window.addEventListener("beforeprint", () => { record("Browser entered print preparation."); });
window.addEventListener("afterprint", () => {
  record("Browser emitted afterprint; physical delivery is not confirmed.");
  status.textContent = "Check whether paper printed. A closed preview does not confirm delivery.";
});

button.addEventListener("click", () => {
  record("Print test clicked.");
  try {
    if (typeof window.print !== "function") throw new Error("This browser does not expose printing.");
    status.textContent = "Print requested. Select the Bluetooth printer and confirm Print in Android.";
    window.print();
    record("Native print call returned.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown printing error.";
    status.textContent = message;
    record(`Print call failed: ${message}`);
  }
});

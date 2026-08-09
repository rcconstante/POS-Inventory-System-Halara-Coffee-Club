import { createApp } from "./index.js";

const port = Number(process.env.PORT ?? 4174);
const { app, context } = await createApp();
const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Halara application ready on port ${port}`);
});

function shutdown(): void {
  server.close(() => {
    context.close();
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

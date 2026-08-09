import { createServer as createViteServer } from "vite";
import { createApp } from "./index.js";

const port = Number(process.env.PORT ?? 5173);
const { app, context } = await createApp({ serveFrontend: false, skipNotFound: true });
const vite = await createViteServer({
  server: { middlewareMode: true, host: "127.0.0.1" },
  appType: "spa",
});

app.use(vite.middlewares);

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Halara development site ready at http://127.0.0.1:${port}`);
});

function shutdown(): void {
  server.close(() => {
    void vite.close().finally(() => {
      context.close();
      process.exit(0);
    });
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

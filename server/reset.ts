import { rm } from "node:fs/promises";
import path from "node:path";
import { createDatabase } from "./db.js";

const dataDir = path.resolve(process.env.HALARA_DATA_DIR ?? "data");
if (dataDir === path.parse(dataDir).root || !dataDir.endsWith(`${path.sep}data`)) {
  throw new Error(`Refusing to reset unexpected data directory: ${dataDir}`);
}
await rm(dataDir, { recursive: true, force: true });
const context = await createDatabase(dataDir);
context.close();
console.log("Local thesis database reset. Only the Admin and Staff accounts were created.");

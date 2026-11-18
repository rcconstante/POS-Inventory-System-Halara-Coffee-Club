import path from "node:path";
const mock = "C:/Users/yalza/AppData/Local/Temp/claude/b6540cc425a8e85b/00f0fc2c-4402-4b4e-8ed3-bb929f7c054b/scratchpad/demo/mock-api.ts";
export default {
  root: "D:/Client-Project/POS-InventorySystem",
  logLevel: "warn",
  build: { outDir: "C:/Users/yalza/AppData/Local/Temp/claude/b6540cc425a8e85b/00f0fc2c-4402-4b4e-8ed3-bb929f7c054b/scratchpad/demo/site", emptyOutDir: true },
  plugins: [{
    name: "demo-mock-api",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "./api" && importer && importer.replaceAll("\\", "/").endsWith("src/app.ts")) return mock;
      return null;
    },
  }],
};

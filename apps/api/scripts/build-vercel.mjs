import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsup";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(apiRoot, "../..");
const outFunc = path.join(apiRoot, ".vercel/output/functions/index.func");
const outDir = path.join(apiRoot, ".vercel/output");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outFunc, { recursive: true });

await build({
  entry: { index: path.join(apiRoot, "src/vercel.ts") },
  outDir: outFunc,
  format: ["esm"],
  target: "node22",
  platform: "node",
  splitting: false,
  sourcemap: false,
  dts: false,
  clean: false,
  // Bundle workspace + deps so Vercel doesn't need to resolve .ts exports
  noExternal: [/.*/],
  outExtension: () => ({ js: ".js" }),
  banner: {
    // Some CJS-only deps still use require()
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
});

writeFileSync(
  path.join(outFunc, "package.json"),
  JSON.stringify({ type: "module" }, null, 2),
);

writeFileSync(
  path.join(outFunc, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "index.js",
      launcherType: "Nodejs",
      shouldAddHelpers: true,
      supportsResponseStreaming: true,
    },
    null,
    2,
  ),
);

const knowledgeCandidates = [
  path.join(repoRoot, "packages/knowledge/content"),
  path.join(repoRoot, "knowledge"),
];
const knowledgeSrc = knowledgeCandidates.find((p) => existsSync(p));
if (!knowledgeSrc) {
  throw new Error("knowledge content not found; run pnpm knowledge:sync");
}
cpSync(knowledgeSrc, path.join(outFunc, "content"), { recursive: true });

writeFileSync(
  path.join(outDir, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [{ src: "/(.*)", dest: "/" }],
    },
    null,
    2,
  ),
);

console.log("vercel build output ready at", outDir);

import {spawnSync} from "node:child_process";
import {mkdirSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../public/video/blog");
mkdirSync(outDir, {recursive: true});

const ids = process.argv.slice(2);
const compositions = ids.length
  ? ids
  : ["pgbouncer-connections-remember", "pgbouncer-sequential-vs-parallel"];

for (const id of compositions) {
  for (const theme of ["dark", "light"]) {
    const out = resolve(outDir, `${id}-${theme}.mp4`);
    const result = spawnSync(
      "npx",
      [
        "remotion",
        "render",
        "src/index.ts",
        id,
        out,
        `--props=${JSON.stringify({theme})}`,
        "--codec=h264",
        "--crf=26",
        "--x264-preset=slow"
      ],
      {cwd: here, stdio: "inherit"}
    );
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

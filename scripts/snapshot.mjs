/**
 * Freezes a dated snapshot of the book to data/snapshot.json.
 *
 * This is the raw, unguarded build -- it writes whatever it fetched. For the
 * unattended path use `npm run refresh`, which validates the result before it
 * is allowed to replace a good snapshot.
 *
 *   npm run snapshot
 */
import { writeFile, mkdir } from "node:fs/promises";
import { buildSnapshot } from "../lib/build-snapshot.js";

const log = (s) => process.stderr.write(s + "\n");

const snapshot = await buildSnapshot({ log });

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../data/snapshot.json", import.meta.url),
  JSON.stringify(snapshot, null, 2)
);

log(
  `\nwrote data/snapshot.json — ${snapshot.positions.length} positions, ` +
    `${snapshot.curve.length} curve points`
);

import * as v from "valibot";
import type { InferOutput } from "valibot";
import { readFile } from "node:fs/promises";
import { parse as parseJsonc } from "jsonc-parser";

const validator = v.object({
  token: v.string(),
  prefix: v.string(),
  allowed_id: v.array(v.string()),
});

export type BotConfig = InferOutput<typeof validator>;

export async function getConfig(path: string) {
  return v.parse(
    validator,
    parseJsonc((await readFile(path)).toString("utf-8")),
  );
}

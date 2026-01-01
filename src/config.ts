import * as v from "valibot";
import { readFile } from "node:fs/promises";
import { parse as parseJsonc } from "jsonc-parser";
import { LogLevel } from "./bot.js";

const x26xPresetValidator = v.picklist([
  "ultrafast",
  "superfast",
  "veryfast",
  "faster",
  "fast",
  "medium",
  "slow",
  "slower",
  "veryslow",
  "placebo",
]);

const validator = v.object({
  token: v.string(),
  prefix: v.string(),
  allowed_id: v.array(v.string()),
  bitrate: v.number(),
  bitrate_max: v.number(),
  height: v.number(),
  encoder: v.variant("name", [
    v.object({
      name: v.literal("software"),
      x264_preset: x26xPresetValidator,
      x265_preset: x26xPresetValidator
    }),
    v.object({
      name: v.literal("nvenc"),
      preset: v.picklist(["p1", "p2", "p3", "p4", "p5", "p6", "p7"])
    }),
    v.object({
      name: v.literal("vaapi"),
      device: v.optional(v.string())
    })
  ]),
  log_level: v.optional(v.enum(LogLevel), LogLevel.NONE)
});

export type BotConfig = v.InferOutput<typeof validator>;

export async function getConfig(path: string) {
  return v.parse(
    validator,
    parseJsonc((await readFile(path)).toString("utf-8")),
  );
}

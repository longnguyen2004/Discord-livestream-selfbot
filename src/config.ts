import * as v from "valibot";
import type { InferOutput } from "valibot";
import { readFile } from "node:fs/promises";
import { parse as parseJsonc } from "jsonc-parser";

const x26xPresetValidator = v.union([
  v.literal("ultrafast"),
  v.literal("superfast"),
  v.literal("veryfast"),
  v.literal("faster"),
  v.literal("fast"),
  v.literal("medium"),
  v.literal("slow"),
  v.literal("slower"),
  v.literal("veryslow"),
  v.literal("placebo")
]);

const validator = v.object({
  token: v.string(),
  prefix: v.string(),
  allowed_id: v.array(v.string()),
  bitrate: v.number(),
  bitrate_max: v.number(),
  encoder: v.variant("name", [
    v.object({
      name: v.literal("software"),
      x264_preset: x26xPresetValidator,
      x265_preset: x26xPresetValidator
    }),
    v.object({
      name: v.literal("nvenc"),
      preset: v.union([
        v.literal("p1"),
        v.literal("p2"),
        v.literal("p3"),
        v.literal("p4"),
        v.literal("p5"),
        v.literal("p6"),
        v.literal("p7")
      ])
    })
  ])
});

export type BotConfig = InferOutput<typeof validator>;

export async function getConfig(path: string) {
  return v.parse(
    validator,
    parseJsonc((await readFile(path)).toString("utf-8")),
  );
}

import ffmpeg, { type FfmpegCommand } from "fluent-ffmpeg";
import { PassThrough } from "node:stream";
import { ffmpegPromise } from "./utils.js";

export function randomInclusive(min: number, max: number) {
  const minCeiled = Math.ceil(min);
  const maxFloored = Math.floor(max);
  return Math.floor(Math.random() * (maxFloored - minCeiled + 1) + minCeiled); // The maximum is inclusive and the minimum is inclusive
}

/**
 * Required packages: `fluent-ffmpeg`
 *
 * Required external app: `ffmpeg`
 *
 * Note: For optimal low-latency operation (<0.5s) for livestreaming, specify
 * `readrateInitialBurst: 10` in the `playStream` settings
 *
 * Required settings for streaming software:
 * - Rate control: CBR
 * - B-frames: 0
 * - Keyframe duration: 1s
 */

function addLowLatencyFlags(ffmpeg: FfmpegCommand) {
  ffmpeg.addOption(
    "-fflags",
    "nobuffer",
    "-fflags",
    "flush_packets",
    "-flags",
    "low_delay",
    "-err_detect",
    "ignore_err",
    "-thread_queue_size",
    "4096",
    "-flush_packets",
    "1",
  );
}

export function ingestRtmp(port?: number, cancelSignal?: AbortSignal) {
  cancelSignal?.throwIfAborted();
  const _port = port ?? randomInclusive(40000, 50000);
  const host = `rtmp://localhost:${_port}`;
  const output = new PassThrough();
  const command = ffmpeg(host);
  command.addOption("-stats");
  addLowLatencyFlags(command);
  command
    .inputFormat("flv")
    .addInputOption("-listen", "1", "-tcp_nodelay", "1", "-rtmp_buffer", "20")
    .output(output)
    .outputFormat("nut");

  command.addOutputOption("-map 0:v");
  command.videoCodec("copy");
  command
    .addOutputOption("-map 0:a?")
    .audioChannels(2)
    .audioFrequency(48000)
    .audioCodec("libopus")
    .audioBitrate("128k");
  cancelSignal?.addEventListener("abort", () => command.kill("SIGTERM"), { once: true });
  command.run();
  return {
    command: {
      ffmpeg: command,
    },
    promise: {
      ffmpeg: ffmpegPromise(command, cancelSignal),
    },
    output,
    host,
  };
}

export function ingestSrt(port?: number, cancelSignal?: AbortSignal) {
  const _port = port ?? randomInclusive(40000, 50000);
  const host = `srt://localhost:${_port}?transtype=live&smoother=live`;
  const output = new PassThrough();
  const command = ffmpeg(host);
  command.addOption("-stats");
  addLowLatencyFlags(command);
  command
    .inputFormat("mpegts")
    .addInputOption(
      "-mode",
      "listener",
      "-latency",
      "5000", // 5000 microseconds
      "-scan_all_pmts",
      "0",
    )
    .output(output)
    .outputFormat("nut");

  command.addOutputOption("-map 0:v");
  command.videoCodec("copy");
  command
    .addOutputOption("-map 0:a?")
    .audioChannels(2)
    .audioFrequency(48000)
    .audioCodec("libopus")
    .audioBitrate("128k");
  cancelSignal?.addEventListener("abort", () => command.kill("SIGTERM"), { once: true });
  command.run();
  return {
    command: {
      ffmpeg: command,
    },
    promise: {
      ffmpeg: ffmpegPromise(command, cancelSignal),
    },
    output,
    host,
  };
}

export function ingestRist(port?: number, cancelSignal?: AbortSignal) {
  const _port = port ?? randomInclusive(40000, 50000);
  const hostListener = `rist://@localhost:${_port}`;
  const host = `rist://localhost:${_port}`;
  const output = new PassThrough();
  const command = ffmpeg(hostListener);
  command.addOption("-stats");
  addLowLatencyFlags(command);
  command
    .inputFormat("mpegts")
    .addInputOption("-buffer_size", "20", "-scan_all_pmts", "0")
    .output(output)
    .outputFormat("nut");

  command.addOutputOption("-map 0:v");
  command.videoCodec("copy");
  command
    .addOutputOption("-map 0:a?")
    .audioChannels(2)
    .audioFrequency(48000)
    .audioCodec("libopus")
    .audioBitrate("128k");
  cancelSignal?.addEventListener("abort", () => command.kill("SIGTERM"), { once: true });
  command.run();
  return {
    command: {
      ffmpeg: command,
    },
    promise: {
      ffmpeg: ffmpegPromise(command, cancelSignal),
    },
    output,
    host,
  };
}

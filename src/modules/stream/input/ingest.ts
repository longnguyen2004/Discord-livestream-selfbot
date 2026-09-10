import { FFmpegCommand } from "fluent-ffmpeg-simplified";
import { PassThrough } from "node:stream";

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

function addLowLatencyFlags(ffmpeg: FFmpegCommand) {
  ffmpeg.inputOptions(
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

export type IngestProtocol = "rtmp" | "srt" | "rist";

export function ingest(
  protocol: IngestProtocol,
  port?: number,
  cancelSignal?: AbortSignal,
) {
  cancelSignal?.throwIfAborted();
  const _port = port ?? randomInclusive(40000, 50000);
  const output = new PassThrough();
  const command = new FFmpegCommand();

  let host: string;
  let inputUrl: string;
  let inputFormat: string;
  let inputOptions: string[];

  switch (protocol) {
    case "rtmp":
      host = `rtmp://localhost:${_port}`;
      inputUrl = host;
      inputFormat = "flv";
      inputOptions = ["-listen", "1", "-tcp_nodelay", "1", "-rtmp_buffer", "20"];
      break;
    case "srt":
      host = `srt://localhost:${_port}?transtype=live&smoother=live`;
      inputUrl = host;
      inputFormat = "mpegts";
      inputOptions = [
        "-mode",
        "listener",
        "-latency",
        "5000", // 5000 microseconds
        "-scan_all_pmts",
        "0",
      ];
      break;
    case "rist":
      host = `rist://localhost:${_port}`;
      inputUrl = `rist://@localhost:${_port}`;
      inputFormat = "mpegts";
      inputOptions = ["-buffer_size", "20", "-scan_all_pmts", "0"];
      break;
  }

  command.input(inputUrl);
  command.inputOptions("-stats");
  addLowLatencyFlags(command);
  command
    .inputFormat(inputFormat)
    .inputOptions(...inputOptions)
    .output(output)
    .format("nut");

  command.outputOptions("-map 0:v");
  command.videoCodec("copy");
  command
    .outputOptions("-map 0:a?")
    .audioChannels(2)
    .audioFrequency(48000)
    .audioCodec("libopus")
    .audioBitrate("128k");

  const promise = command.run(cancelSignal);
  return {
    command: {
      ffmpeg: command,
    },
    promise: {
      ffmpeg: promise,
    },
    output,
    host,
  };
}

import { $ } from "execa";
import { NewApi } from "@dank074/discord-video-stream";

export interface YtdlpFormat {
  format_id: string;
  ext: string;
  resolution: string | null;
  fps?: number | null;
}

export async function getFormats(link: string) {
  const result = (await $`yt-dlp --print "%(formats)+j" ${link}`).stdout;
  // Thank you execa for adding quotes to the output
  return JSON.parse(result.slice(1, result.length - 1)) as YtdlpFormat[];
}

export function ytdlp(
  link: string,
  format?: string,
  encoderOptions?: Partial<NewApi.EncoderOptions>,
  cancelSignal?: AbortSignal,
) {
  const args = [
    ...(format ? ["--format", format] : []),
    "-o",
    "-",
    "-R",
    "infinite",
    "--downloader-args", "ffmpeg_i1:-reconnect 1",
    "--downloader-args", "ffmpeg_i2:-reconnect 1",
    link,
  ];
  const ytdlpProcess = $({
    cancelSignal,
    killSignal: "SIGINT",
    buffer: { stdout: false },
  })("yt-dlp", args, { stderr: "inherit" });
  ytdlpProcess.catch(() => {});
  ytdlpProcess.stdout.on("data", () => {});
  const { command, output, promise, controller } = NewApi.prepareStream(
    ytdlpProcess.stdout,
    encoderOptions,
    cancelSignal,
  );
  return {
    output,
    command: {
      ytdlp: ytdlpProcess,
      ffmpeg: command,
    },
    promise: {
      ytdlp: ytdlpProcess,
      ffmpeg: promise,
    },
    controller
  };
}

import type Ffmpeg from "fluent-ffmpeg";

export function ffmpegPromise(
  command: Ffmpeg.FfmpegCommand,
  cancelSignal?: AbortSignal,
) {
  const promise = new Promise<void>((resolve, reject) => {
    command.on("error", (err) => {
      if (cancelSignal?.aborted) reject(cancelSignal.reason);
      else reject(err);
    });
    command.on("end", () => resolve());
  });
  return promise;
}

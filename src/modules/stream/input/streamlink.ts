import { $ } from "execa";
import { NewApi } from "@dank074/discord-video-stream";

export interface StreamlinkQualityInfo {
  name: string;
}

interface StreamlinkListResult {
  plugin?: string;
  streams?: Record<string, unknown>;
  error?: string;
}

/**
 * List the available stream qualities for a URL.
 *
 * Runs `streamlink --loglevel none --json <url>` (no STREAM argument, so
 * streamlink prints the available streams instead of opening one) and
 * returns the stream/quality names (e.g. `best`, `worst`, `1080p60`, ...).
 */
export async function getQualities(link: string): Promise<string[]> {
  const { stdout } = await $`streamlink --loglevel none --json ${link}`;
  const parsed = JSON.parse(stdout) as StreamlinkListResult;
  if (parsed.error) {
    throw new Error(parsed.error);
  }
  if (!parsed.streams) {
    throw new Error("No streams found in streamlink output");
  }
  return Object.keys(parsed.streams);
}

export interface StreamlinkLowLatencyOptions {
  /**
   * Number of segments from the live edge to begin streaming.
   * Lower = less latency but higher buffering risk.
   * Streamlink default is 3; low-latency preset uses 2.
   */
  hlsLiveEdge?: number;
  /**
   * Immediately write segment data into the output buffer while downloading.
   * Enabled by default for low latency.
   */
  hlsSegmentStreamData?: boolean;
  /**
   * Size of the thread pool used to download segments (1-10).
   * More threads = faster catch-up to the live edge.
   * Streamlink default is 1.
   */
  segmentThreads?: number;
  /**
   * Custom HLS playlist reload time (`segment`, `live-edge`, `default`,
   * or seconds). `live-edge` polls faster than the default target-duration
   * based value, reducing latency.
   */
  playlistReloadTime?: string;
  /**
   * Maximum size of the ringbuffer between streamlink and stdout
   * (e.g. "4M"). Smaller = less pre-buffered data = less latency, but
   * higher chance of player-side buffering on jittery connections.
   * Streamlink default is "16M".
   */
  ringbufferSize?: string;
  /**
   * Maximum time to wait for stream data before giving up (seconds).
   * Streamlink default is 60. Shorter values detect stalls faster.
   */
  streamTimeout?: number;
  /**
   * Maximum time to wait for each segment to start downloading (seconds).
   * Streamlink default is 10.
   */
  segmentTimeout?: number;
  /**
   * Number of attempts to open the stream before giving up.
   * Streamlink default is 1.
   */
  retryOpen?: number;
  /**
   * Streamlink log level (logs go to stderr, media goes to stdout,
   * so this doesn't affect the piped stream).
   */
  logLevel?: string;
  /**
   * Extra raw args appended to the streamlink command for power users.
   */
  extraArgs?: string[];
}

const LOW_LATENCY_DEFAULTS: Required<
  Omit<StreamlinkLowLatencyOptions, "extraArgs" | "logLevel">
> = {
  hlsLiveEdge: 2,
  hlsSegmentStreamData: true,
  segmentThreads: 3,
  playlistReloadTime: "live-edge",
  ringbufferSize: "4M",
  streamTimeout: 15,
  segmentTimeout: 5,
  retryOpen: 2,
};

/**
 * Play a URL via streamlink, piping stdout into the Discord transcoder.
 *
 * Mirrors `ytdlp()` in `./yt-dlp.js`: streamlink writes media to stdout
 * (`--stdout`), which is fed into `NewApi.prepareStream`. The default
 * streamlink flags are optimized for low-latency live playback:
 * - `--hls-live-edge 2` (vs default 3): start closer to the live edge
 * - `--hls-segment-stream-data`: flush segment data while downloading
 * - `--stream-segment-threads 3` (vs default 1): fetch segments in parallel
 * - `--hls-playlist-reload-time live-edge`: poll for new segments faster
 * - `--ringbuffer-size 4M` (vs default 16M): less pre-buffered data
 * - `--stream-timeout 15` / `--stream-segment-timeout 5`: detect stalls faster
 *
 * Note: plugin-specific flags like `--twitch-low-latency` /
 * `--kick-low-latency` are intentionally NOT passed. Per streamlink's docs
 * they only set `--hls-segment-stream-data` + `--hls-live-edge 2`, which is
 * already covered above for every plugin (and `--kick-low-latency` doesn't
 * exist on older streamlink releases, where it would abort startup with
 * "unrecognized arguments").
 *
 * The ffmpeg transcoder also gets `minimizeLatency: true`
 * (`-fflags nobuffer -flags lowdelay ...`).
 */
export function streamlink(
  link: string,
  quality = "best",
  encoderOptions?: Partial<NewApi.PrepareStreamOptions>,
  streamlinkOptions?: StreamlinkLowLatencyOptions,
  cancelSignal?: AbortSignal,
) {
  const opts: StreamlinkLowLatencyOptions = {
    hlsLiveEdge: streamlinkOptions?.hlsLiveEdge ?? LOW_LATENCY_DEFAULTS.hlsLiveEdge,
    hlsSegmentStreamData:
      streamlinkOptions?.hlsSegmentStreamData ?? LOW_LATENCY_DEFAULTS.hlsSegmentStreamData,
    segmentThreads:
      streamlinkOptions?.segmentThreads ?? LOW_LATENCY_DEFAULTS.segmentThreads,
    playlistReloadTime:
      streamlinkOptions?.playlistReloadTime ?? LOW_LATENCY_DEFAULTS.playlistReloadTime,
    ringbufferSize:
      streamlinkOptions?.ringbufferSize ?? LOW_LATENCY_DEFAULTS.ringbufferSize,
    streamTimeout:
      streamlinkOptions?.streamTimeout ?? LOW_LATENCY_DEFAULTS.streamTimeout,
    segmentTimeout:
      streamlinkOptions?.segmentTimeout ?? LOW_LATENCY_DEFAULTS.segmentTimeout,
    retryOpen: streamlinkOptions?.retryOpen ?? LOW_LATENCY_DEFAULTS.retryOpen,
    logLevel: streamlinkOptions?.logLevel ?? "warning",
    extraArgs: streamlinkOptions?.extraArgs ?? [],
  };

  const args = [
    "--stdout",
    "--loglevel",
    opts.logLevel!,
    "--hls-live-edge",
    String(opts.hlsLiveEdge),
    ...(opts.hlsSegmentStreamData ? ["--hls-segment-stream-data"] : []),
    "--stream-segment-threads",
    String(opts.segmentThreads),
    "--hls-playlist-reload-time",
    opts.playlistReloadTime!,
    "--ringbuffer-size",
    opts.ringbufferSize!,
    "--stream-timeout",
    String(opts.streamTimeout),
    "--stream-segment-timeout",
    String(opts.segmentTimeout),
    "--retry-open",
    String(opts.retryOpen),
    ...(opts.extraArgs ?? []),
    link,
    quality,
  ];
  const streamlinkProcess = $({
    cancelSignal,
    killSignal: "SIGINT",
    buffer: { stdout: false },
  })("streamlink", args, { stderr: "inherit" });
  streamlinkProcess.catch(() => {});
  // An unhandled 'error' event on a stream crashes the bot. Producer-side
  // failures are already surfaced through the promises below, so swallow
  // stream errors here (notably EPIPE when ffmpeg exits before streamlink).
  streamlinkProcess.stdout.on("error", () => {});
  streamlinkProcess.stdout.on("data", () => {});
  const { command, output, promise, controller } = NewApi.prepareStream(
    streamlinkProcess.stdout,
    {
      minimizeLatency: true,
      ...encoderOptions,
    },
    cancelSignal,
  );
  // Once the transcoder is gone, stop the producer. Otherwise streamlink
  // keeps writing into the closed ffmpeg pipe, which raises EPIPE inside
  // fluent-ffmpeg-simplified's socket handling and crashes the process
  // (happens on skip/stop, stream end, or transcoder failure).
  const stopProducer = () => {
    try {
      streamlinkProcess.stdout.destroy();
    } catch {
      /* already closed */
    }
    try {
      streamlinkProcess.kill("SIGINT");
    } catch {
      /* already exited */
    }
  };
  promise.then(stopProducer, stopProducer);
  return {
    output,
    command: {
      streamlink: streamlinkProcess,
      ffmpeg: command,
    },
    promise: {
      streamlink: streamlinkProcess,
      ffmpeg: promise,
    },
    controller,
  };
}

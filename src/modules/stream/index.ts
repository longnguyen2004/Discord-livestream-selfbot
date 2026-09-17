import { Command, Option } from "@commander-js/extra-typings";
import { prepareStream, playStream, Streamer, Encoders, type Controller } from "@dank074/discord-video-stream";

import { autoRetry } from "./input/autoRetry.js";
import * as Ingestor from "./input/ingest.js";
import * as ytdlp from "./input/yt-dlp.js";
import * as streamlink from "./input/streamlink.js";

import { createCommand } from "../index.js";
import { LogLevel } from "../../bot.js";
import { MessageFlags, StageChannel } from "@lng2004/discord.js-selfbot-v13";

import type { Module } from "../index.js";
import type { Message } from "@lng2004/discord.js-selfbot-v13";
import type { Bot } from "../../bot.js";

function parseRoom(room: string): { guildId: string; channelId: string } | null {
  const linkMatch = room.match(/https:\/\/discord\.com\/channels\/(\d+)\/(\d+)/);
  if (linkMatch) {
    return { guildId: linkMatch[1], channelId: linkMatch[2] };
  }

  const parts = room.split("/");
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { guildId: parts[0], channelId: parts[1] };
  }

  return null;
}

async function joinRoomIfNeeded(
  streamer: Streamer,
  message: Message,
  optionalRoom?: string,
) {
  let guildId: string, channelId: string;
  if (optionalRoom) {
    const parsed = parseRoom(optionalRoom);
    if (!parsed) {
      message.reply("Invalid room format. Use <guildId>/<channelId> or a Discord channel link.");
      return false;
    }
    ({ guildId, channelId } = parsed);
  } else {
    guildId = message.guildId!;
    const channelIdNullable = message.author.voice?.channel?.id;
    if (!channelIdNullable) {
      message.reply("Please join a voice channel first!");
      return false;
    }
    channelId = channelIdNullable;
  }
  if (
    !streamer.voiceConnection ||
    streamer.voiceConnection.guildId !== guildId ||
    streamer.voiceConnection.channelId !== channelId
  )
    await streamer.joinVoice(guildId, channelId);

  if (streamer.client.user?.voice?.channel instanceof StageChannel)
    await streamer.client.user.voice.setSuppressed(false);
  return true;
}

type StreamItem = {
  controller?: Controller,
  promise: Promise<unknown>
}
type QueueItem = {
  info: string,
  stream: (signal: AbortSignal) => StreamItem
}

class Playlist {
  private _items: QueueItem[] = [];
  private _current?: StreamItem;
  private _abort?: AbortController;
  private _processing = false;

  private async processQueue() {
    this._processing = true;
    let next: QueueItem | undefined;
    while (next = this._items.shift()) {
      try {
        this._abort?.abort();
        this._abort = new AbortController();
        this._current = next.stream(this._abort.signal);
        await this._current.promise
      }
      catch {}
    }
    this._processing = false;
    this._current = undefined;
  }
  queue(queueItem: QueueItem) {
    this._items.push(queueItem);
    if (!this._processing)
      this.processQueue();
  }
  skip() {
    this._abort?.abort();
  }
  stop() {
    this._items = [];
    this.skip();
  }
  get items() {
    return this._items;
  }
  get current() {
    return this._current;
  }
}

function errorHandler(err: Error, bot: Bot, message: Message) {
  if (err.name === "AbortError") return;
  bot.log(message, LogLevel.ERROR, `Oops, something bad happened
\`\`\`
${err.message}
\`\`\``);
}

function addCommonStreamOptions<
  Args extends unknown[],
  Opts extends Record<string, unknown>
>(command: Command<Args, Opts>) {
  return command
    .option(
      "--room <id>",
      "The room, specified as <guildId>/<channelId> or a Discord channel link (https://discord.com/channels/<guildId>/<channelId>). If not specified, use the current room of the caller",
    )
    .option(
      "--preview",
      "Enable stream preview"
    );
}

export default {
  name: "stream",
  register(bot) {
    const streamer = new Streamer(bot.client);
    const playlist = new Playlist();
    let encoder;
    switch (bot.config.encoder.name) {
      case "software":
        encoder = Encoders.software({
          x264: {
            preset: bot.config.encoder.x264_preset
          },
          x265: {
            preset: bot.config.encoder.x265_preset
          }
        })
        break;
      case "nvenc":
        encoder = Encoders.nvenc({
          preset: bot.config.encoder.preset
        });
        break;
      case "vaapi":
        encoder = Encoders.vaapi({
          device: bot.config.encoder.device
        });
        break;
    }
    const encoderSettings = {
      encoder,
      bitrateVideo: bot.config.bitrate,
      bitrateVideoMax: bot.config.bitrate_max
    };
    return [
      createCommand(
        addCommonStreamOptions(
          new Command("play")
            .description("Play a video file or link")
            .argument("<url...>", "The urls to play")
            .option("--copy", "Copy the stream directly instead of re-encoding")
            .option("--livestream", "Specify if the stream is a livestream")
            .option(
              "--height <height>",
              "Transcode the video to this height. Specify -1 for auto height",
              Number.parseInt,
              bot.config.height
            )
            .option(
              "--retry <count>",
              "Number of times to retry if the connection drops. Set to -1 to retry indefinitely",
              Number.parseInt,
              0
            ),
        ),
        async (message, args, opts) => {
          if (!(await joinRoomIfNeeded(streamer, message, opts.room))) return;
          let added = 0;
          for (const url of args[0])
          {
            playlist.queue({
              info: url,
              stream: (signal: AbortSignal) => {
                bot.log(message, LogLevel.INFO, {
                  content: `Now playing \`${url}\``,
                  flags: MessageFlags.FLAGS.SUPPRESS_NOTIFICATIONS
                })
                try {
                  const stream = prepareStream(
                    url,
                    {
                      noTranscoding: !!opts.copy,
                      ...encoderSettings,
                      height: opts.height === -1 ? undefined : opts.height
                    },
                    signal,
                  )

                  const promise = playStream(
                    stream.output,
                    streamer,
                    {
                      livestreamCatchup: !!opts.livestream,
                      streamPreview: opts.preview
                    },
                    signal,
                  );

                  return { get controller() { return stream.controller; }, promise }
                } catch (e) {
                  errorHandler(e as Error, bot, message);
                  throw e;
                }
              }
            });
            added++;
          }
          message.reply(`Added ${added} video${added === 1 ? "" : "s"} to the queue`);
        },
      ),

      createCommand(
        addCommonStreamOptions(
          new Command("obs")
            .description("Starts an OBS ingest server for livestreaming")
            .option(
              "-p, --port <port>",
              "Port to use, leave blank for a random port",
              Number.parseInt,
            )
            .addOption(
              new Option("--protocol <prot>", "Stream protocol to use")
                .choices(["rtmp", "srt", "rist"])
                .default("srt"),
            ),
        ),
        async (message, args, opts) => {
          if (!(await joinRoomIfNeeded(streamer, message, opts.room))) return;
          playlist.queue({
            info: "OBS stream",
            stream: (signal: AbortSignal) => {
              bot.log(message, LogLevel.INFO, {
                content: "Now playing OBS stream",
                flags: MessageFlags.FLAGS.SUPPRESS_NOTIFICATIONS
              })
              try {
                const { command, output, host } = Ingestor.ingest(
                  opts.protocol,
                  opts.port,
                  signal,
                );

                message.reply(`Please connect your OBS to \`${host}\``);
                output.once("data", () => {
                  bot.log(message, LogLevel.DEBUG, "Media stream found. Starting playback...");
                });
                const promise = playStream(
                  output,
                  streamer,
                  {
                    readrateInitialBurst: 10,
                    streamPreview: opts.preview
                  },
                  signal,
                );
                const controller = {
                  get volume() {
                    return 1;
                  },
                  async setVolume() {
                    throw new Error("Setting volume for OBS streams isn't allowed at the moment");
                  }
                }
                return { controller, promise }
              } catch (e) {
                errorHandler(e as Error, bot, message);
                throw e;
              }
            }
          });
          message.reply("Added OBS stream to the queue");
        },
      ),

      createCommand(
        addCommonStreamOptions(
          new Command("yt-dlp")
            .description("Play a video using yt-dlp")
            .argument("<url>", "The url to play")
            .option("--list-formats", "List all the formats in this video")
            .option(
              "--format <format>",
              "The format to use.",
              "bv*+ba/b"
            )
            .option(
              "--height <height>",
              "Transcode the video to this height.",
              Number.parseInt,
              bot.config.height
            ),
        ),
        async (message, args, opts) => {
          const url = args[0];
          if (opts.listFormats) {
            const formats = await ytdlp.getFormats(url);
            let reply = "";
            reply += `Formats for URL \`${url}\`\n`;
            for (const format of formats) {
              reply += `- \`${format.format_id}\`: ext ${format.ext}, res ${format.resolution}, fps ${format.fps}\n`;
            }
            message.reply(reply);
            return;
          }
          if (!(await joinRoomIfNeeded(streamer, message, opts.room))) return;

          playlist.queue({
            info: args[0],
            stream: (signal: AbortSignal) => {
              bot.log(message, LogLevel.INFO, {
                content: `Now playing \`${args[0]}\``,
                flags: MessageFlags.FLAGS.SUPPRESS_NOTIFICATIONS
              })
              try {
                const { command, output, controller } = ytdlp.ytdlp(
                  url,
                  opts.format,
                  {
                    ...encoderSettings,
                    height: opts.height === -1 ? undefined : opts.height,
                  },
                  signal,
                );
                const promise = playStream(
                  output,
                  streamer,
                  {
                    streamPreview: opts.preview
                  },
                  signal,
                );
                return { controller, promise }
              } catch (e) {
                errorHandler(e as Error, bot, message);
                throw e
              }
            }
          });
          message.reply(`Added \`${args[0]}\` to the queue`);
        },
      ),

      createCommand(
        addCommonStreamOptions(
          new Command("streamlink")
            .description("Play a video using streamlink (low-latency optimized)")
            .argument("<url>", "The url to play")
            .option("--list-qualities", "List all the available qualities for this url")
            .option(
              "--quality <quality>",
              "The quality to use (e.g. best, worst, 1080p60, 720p, audio_only). Fallbacks can be comma-separated, e.g. \"1080p60,720p,best\"",
              "best"
            )
            .option(
              "--height <height>",
              "Transcode the video to this height.",
              Number.parseInt,
              bot.config.height
            )
            .option(
              "--live-edge <segments>",
              "Number of HLS segments from the live edge to begin streaming. Lower = less latency but more buffering risk",
              Number.parseInt,
              2
            )
            .option(
              "--segment-threads <threads>",
              "Number of parallel segment downloads (1-10)",
              Number.parseInt,
              3
            )
            .option(
              "--ringbuffer-size <size>",
              "Ringbuffer size between streamlink and ffmpeg (e.g. 4M). Smaller = less latency",
              "4M"
            )
            .option(
              "--no-catchup",
              "Disable livestream catchup mode (temporarily increases FPS when falling behind)"
            ),
        ),
        async (message, args, opts) => {
          const url = args[0];
          if (opts.listQualities) {
            const qualities = await streamlink.getQualities(url);
            message.reply(
              `Qualities for URL \`${url}\`:\n${qualities.map((q) => `- \`${q}\``).join("\n")}`
            );
            return;
          }
          if (!(await joinRoomIfNeeded(streamer, message, opts.room))) return;

          playlist.queue({
            info: args[0],
            stream: (signal: AbortSignal) => {
              bot.log(message, LogLevel.INFO, {
                content: `Now playing \`${args[0]}\``,
                flags: MessageFlags.FLAGS.SUPPRESS_NOTIFICATIONS
              })
              try {
                const { command, output, controller } = streamlink.streamlink(
                  url,
                  opts.quality,
                  {
                    ...encoderSettings,
                    height: opts.height === -1 ? undefined : opts.height,
                  },
                  {
                    hlsLiveEdge: opts.liveEdge,
                    segmentThreads: opts.segmentThreads,
                    ringbufferSize: opts.ringbufferSize,
                  },
                  signal,
                );
                const promise = playStream(
                  output,
                  streamer,
                  {
                    livestreamCatchup: opts.catchup,
                    streamPreview: opts.preview
                  },
                  signal,
                );
                return { controller, promise }
              } catch (e) {
                errorHandler(e as Error, bot, message);
                throw e
              }
            }
          });
          message.reply(`Added \`${args[0]}\` to the queue`);
        },
      ),

      createCommand(
        new Command("volume")
          .description("Adjust the stream volume, or get the current volume")
          .argument("[value]", "The new stream volume (must be non-negative)"),
        async (msg, args) => {
          if (!playlist.current) {
            msg.reply("No stream is currently running");
            return;
          }
          const { controller } = playlist.current;
          if (!args[0]) {
            if (!controller)
              msg.reply("The current stream doesn't support volume adjustment");
            else
              msg.reply(`Current volume: ${controller.volume}`);
            return;
          }
          const volume = Number.parseFloat(args[0]);
          if (!Number.isFinite(volume)) {
            msg.reply("Invalid number");
            return;
          }
          try {
            if (!controller)
              msg.reply("The current stream doesn't support volume adjustment");
            else if (await controller.setVolume(volume))
              msg.reply("Set volume successful");
            else
              msg.reply("Set volume unsuccessful");
          }
          catch (e) {
            msg.reply(`Set volume unsuccessful: \`${(e as Error).message}\``)
          }
        }
      ),

      createCommand(
        new Command("queue").description("View the queue"),
        async (message) => {
          if (!playlist.items.length)
            return message.reply("There are no items in the queue");
          const { length } = playlist.items;
          let content = `There are ${length} ${length === 1 ? "item" : "items"} in the queue`;
          let i = 1;
          for (const item of playlist.items)
            content += `\n${i++}. \`${item.info}\``;
          return message.reply(content);
        }),
      createCommand(new Command("skip"), () => {
        playlist.skip();
      }),

      createCommand(new Command("stop"), () => {
        playlist.stop();
      }),

      createCommand(new Command("disconnect"), () => {
        playlist.stop();
        streamer.leaveVoice();
      }),
    ];
  },
} satisfies Module;

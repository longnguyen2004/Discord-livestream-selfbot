import { Command, Option } from "@commander-js/extra-typings";
import { prepareStream, playStream, Streamer, Encoders, type Controller } from "@dank074/discord-video-stream";
import * as Ingestor from "./input/ingest.js";
import * as ytdlp from "./input/yt-dlp.js";
import { createCommand } from "../index.js";
import { LogLevel } from "../../bot.js";
import { MessageFlags, StageChannel } from "discord.js-selfbot-v13";

import type { Module } from "../index.js";
import type { Message } from "discord.js-selfbot-v13";
import type { Bot } from "../../bot.js";

async function joinRoomIfNeeded(
  streamer: Streamer,
  message: Message,
  optionalRoom?: string,
) {
  let guildId: string, channelId: string;
  if (optionalRoom) {
    [guildId, channelId] = optionalRoom.split("/");
    if (!guildId) {
      message.reply("Guild ID is empty");
      return false;
    }
    if (!channelId) {
      message.reply("Channel ID is empty");
      return false;
    }
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
  controller: Controller,
  promise: Promise<unknown>
}
type QueueItem = {
  info: string,
  stream: (abort: AbortController) => Promise<StreamItem>
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
        this._current = await next.stream(this._abort);
        await this._current.promise;
      }
      catch {
      }
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
      "The room ID, specified as <guildId>/<channelId>. If not specified, use the current room of the caller",
    )
    .option(
      "--preview",
      "Enable stream preview"
    );
}

export default {
  name: "stream",
  register(bot) {
    const streamer = new Streamer(bot.client, {
      forceChacha20Encryption: true,
    });
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
            ),
        ),
        async (message, args, opts) => {
          if (!(await joinRoomIfNeeded(streamer, message, opts.room))) return;
          let added = 0;
          for (const url of args[0])
          {
            playlist.queue({
              info: url,
              stream: async (abort) => {
                bot.log(message, LogLevel.INFO, {
                  content: `Now playing \`${url}\``,
                  flags: MessageFlags.FLAGS.SUPPRESS_NOTIFICATIONS
                })
                try {
                  const { command, output, controller } = prepareStream(
                    url!,
                    {
                      noTranscoding: !!opts.copy,
                      ...encoderSettings,
                      height: opts.height === -1 ? undefined : opts.height
                    },
                    abort.signal,
                  );

                  command.on("stderr", (line) => console.log(line));

                  const promise = playStream(
                    output,
                    streamer,
                    {
                      readrateInitialBurst: opts.livestream ? 10 : undefined,
                      streamPreview: opts.preview
                    },
                    abort.signal,
                  );

                  return { controller, promise }
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
            stream: async (abort) => {
              bot.log(message, LogLevel.INFO, {
                content: "Now playing OBS stream",
                flags: MessageFlags.FLAGS.SUPPRESS_NOTIFICATIONS
              })
              try {
                const ingestor = {
                  srt: Ingestor.ingestSrt,
                  rtmp: Ingestor.ingestRtmp,
                  rist: Ingestor.ingestRist,
                } as const;
                const { command, output, host } = ingestor[opts.protocol](
                  opts.port,
                  abort.signal,
                );

                command.ffmpeg.on("stderr", (line) => console.log(line));

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
                  abort.signal,
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
            stream: async (abort) => {
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
                  abort.signal,
                );
                command.ffmpeg.on("stderr", (line) => console.log(line));
                const promise = playStream(
                  output,
                  streamer,
                  {
                    streamPreview: opts.preview
                  },
                  abort.signal,
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
            msg.reply(`Current volume: ${controller.volume}`);
            return;
          }
          const volume = Number.parseFloat(args[0]);
          if (!Number.isFinite(volume)) {
            msg.reply("Invalid number");
            return;
          }
          try {
            if (await controller.setVolume(volume))
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

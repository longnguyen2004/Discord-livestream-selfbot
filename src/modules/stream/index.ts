import { Command, Option } from "@commander-js/extra-typings";
import { prepareStream, playStream, Streamer, type Controller } from "@dank074/discord-video-stream";
import * as Ingestor from "./input/ffmpegIngest.js";
import * as ytdlp from "./input/yt-dlp.js";
import { createCommand } from "../index.js";
import { StageChannel } from "discord.js-selfbot-v13";

import type { Module } from "../index.js";
import type { Message } from "discord.js-selfbot-v13";

async function joinRoom(
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

function errorHandler(err: Error, message: Message) {
  if (err.name === "AbortError") return;
  message.reply(`Oops, something bad happened
\`\`\`
${err.message}
\`\`\``);
}

function addCommonStreamOptions<
  Args extends unknown[],
  Opts extends Record<string, unknown>
>(command: Command<Args, Opts>)
{
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
    let abortController: AbortController;
    let streamController: Controller | null = null;
    return [
      createCommand(
        addCommonStreamOptions(
          new Command("play")
            .description("Play a video file or link")
            .argument("<url>", "The url to play")
            .option("--copy", "Copy the stream directly instead of re-encoding")
            .option("--livestream", "Specify if the stream is a livestream")
        ),
        async (message, args, opts) => {
          const url = args[0];
          if (!(await joinRoom(streamer, message, opts.room))) return;
          abortController?.abort();
          abortController = new AbortController();
          try {
            const { command, output, controller } = prepareStream(
              url,
              {
                noTranscoding: !!opts.copy,
              },
              abortController.signal,
            );
            streamController = controller;

            await playStream(
              output,
              streamer,
              {
                readrateInitialBurst: opts.livestream ? 10 : undefined,
                streamPreview: opts.preview
              },
              abortController.signal,
            );
          } catch (e) {
            errorHandler(e as Error, message);
          } finally {
            streamController = null;
          }
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
          if (!(await joinRoom(streamer, message, opts.room))) return;
          abortController?.abort();
          abortController = new AbortController();
          try {
            const ingestor = {
              srt: Ingestor.ingestSrt,
              rtmp: Ingestor.ingestRtmp,
              rist: Ingestor.ingestRist,
            } as const;
            const { command, output, host } = ingestor[opts.protocol](
              opts.port,
              abortController.signal,
            );
            abortController?.abort();
            abortController = new AbortController();

            command.ffmpeg.on("stderr", (line) => console.log(line));

            message.reply(`Please connect your OBS to \`${host}\``);
            output.once("data", () => {
              message.reply("Media stream found. Starting playback...");
            });
            await playStream(
              output,
              streamer,
              {
                readrateInitialBurst: 10,
                streamPreview: opts.preview
              },
              abortController.signal,
            );
          } catch (e) {
            errorHandler(e as Error, message);
          }
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
          if (!(await joinRoom(streamer, message, opts.room))) return;
          abortController?.abort();
          abortController = new AbortController();

          try {
            const { command, output, controller } = ytdlp.ytdlp(
              url,
              opts.format,
              {
                h26xPreset: "superfast",
                height: opts.height,
                bitrateVideo: 5000,
                bitrateVideoMax: 7500,
              },
              abortController.signal,
            );
            streamController = controller;
            command.ffmpeg.on("stderr", (line) => console.log(line));
            await playStream(
              output,
              streamer,
              {
                streamPreview: opts.preview
              },
              abortController.signal,
            );
          } catch (e) {
            errorHandler(e as Error, message);
          }
        },
      ),

      createCommand(
        new Command("volume")
          .description("Adjust the stream volume, or get the current volume")
          .argument("[value]", "The new stream volume (must be non-negative)"),
        async (msg, args) => {
          if (!streamController)
          {
            msg.reply("No stream is currently running");
            return;
          }
          if (!args[0])
          {
            msg.reply(`Current volume: ${streamController.volume}`);
            return;
          }
          const volume = Number.parseFloat(args[0]);
          if (!Number.isFinite(volume))
          {
            msg.reply("Invalid number");
            return;
          }
          if (await streamController.setVolume(volume))
            msg.reply("Set volume successful");
          else
            msg.reply("Set volume unsuccessful");
        }
      ),

      createCommand(new Command("stop"), () => {
        abortController?.abort();
      }),

      createCommand(new Command("disconnect"), () => {
        abortController?.abort();
        streamer.leaveVoice();
      }),
    ];
  },
} satisfies Module;

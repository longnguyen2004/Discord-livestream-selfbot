import { Command } from "@commander-js/extra-typings";
import { Streamer } from "@dank074/discord-video-stream";
import { prepareStream, playStream } from "@dank074/discord-video-stream";
import { ffmpegIngest } from "./ffmpegIngest.js";
import { createCommand } from "../index.js";
import { StageChannel } from "discord.js-selfbot-v13";

import type { Module } from "../index.js";
import type Ffmpeg from "fluent-ffmpeg";

function ffmpegErrorHandler(err: Error, stdout: string, stderr: string)
{
  if (/SIG(TERM|KILL)/.test(err.message))
    return;
  console.log("FFmpeg encountered an error");
  console.log(err);
}

export default {
  name: "stream",
  register(bot) {
    const streamer = new Streamer(bot.client, {
      forceChacha20Encryption: true
    });
    let playback: Ffmpeg.FfmpegCommand;
    return [
      createCommand(
        new Command("play")
          .description("Play a video file or link")
          .argument("<url>", "The url to play")
          .option("--copy", "Copy the stream directly instead of re-encoding")
          .option("--livestream", "Specify if the stream is a livestream")
          .option("--room <id>", "The room ID, specified as <guildId>/<channelId>. If not specified, use the current room of the caller"),
        async (message, args, opts) => {
          const url = args[0];
          let guildId: string, channelId: string
          if (opts.room) {
            [guildId, channelId] = opts.room.split("/");
            if (!guildId) {
              message.reply("Guild ID is empty");
              return;
            }
            if (!channelId) {
              message.reply("Channel ID is empty");
              return;
            }
          }
          else {
            guildId = message.guildId!;
            const channelIdNullable = message.author.voice?.channel?.id;
            if (!channelIdNullable) {
              message.reply("Please join a voice channel first!");
              return;
            }
            channelId = channelIdNullable;
          }
          playback?.kill("SIGTERM");
          try {
            if (
              !streamer.voiceConnection ||
              streamer.voiceConnection.guildId !== guildId ||
              streamer.voiceConnection.channelId !== channelId
            )
              await streamer.joinVoice(guildId, channelId);

            if (streamer.client.user!.voice!.channel instanceof StageChannel)
              await streamer.client.user!.voice!.setSuppressed(false);

            const { command, output } = prepareStream(url, {
              noTranscoding: !!opts.copy
            });
            // @ts-expect-error uhhh what
            command.on("error", ffmpegErrorHandler);
            playback = command;

            await playStream(output, streamer, {
              readrateInitialBurst: opts.livestream ? 10 : undefined
            })
          }
          catch (e)
          {
            const error = e as Error;
            message.reply(
              `Oops, something bad happened
\`\`\`
${error.message}
\`\`\``
            )
          }
        }
      ),

      createCommand(
        new Command("obs")
          .description("Starts an OBS ingest server for livestreaming")
          .option("--room <id>", "The room ID, specified as <guildId>/<channelId>. If not specified, use the current room of the caller"),
        async (message, args, opts) => {
          let guildId: string, channelId: string
          if (opts.room) {
            [guildId, channelId] = opts.room.split("/");
            if (!guildId) {
              message.reply("Guild ID is empty");
              return;
            }
            if (!channelId) {
              message.reply("Channel ID is empty");
              return;
            }
          }
          else {
            guildId = message.guildId!;
            const channelIdNullable = message.author.voice?.channel?.id;
            if (!channelIdNullable) {
              message.reply("Please join a voice channel first!");
              return;
            }
            channelId = channelIdNullable;
          }
          playback?.kill("SIGTERM");
          try {
            if (
              !streamer.voiceConnection ||
              streamer.voiceConnection.guildId !== guildId ||
              streamer.voiceConnection.channelId !== channelId
            )
              await streamer.joinVoice(guildId, channelId);

            if (streamer.client.user!.voice!.channel instanceof StageChannel)
              await streamer.client.user!.voice!.setSuppressed(false);

            const { command, output, host } = ffmpegIngest();
            // @ts-expect-error uhhh what
            command.on("error", ffmpegErrorHandler);
            playback = command;

            message.reply(`Please connect your OBS to \`${host}\``);
            output.once("data", () => {
              message.reply("Media stream found. Starting playback...");
            })
            await playStream(output, streamer, {
              readrateInitialBurst: 10
            });
          }
          catch (e)
          {
            const error = e as Error;
            message.reply(
              `Oops, something bad happened
\`\`\`
${error.message}
\`\`\``
            )
          }
        }
      ),

      createCommand(
        new Command("stop"),
        () => {
          playback?.kill("SIGTERM");
        }
      ),

      createCommand(
        new Command("disconnect"),
        () => {
          playback?.kill("SIGTERM");
          streamer.leaveVoice();
        }
      )
    ]
  }
} satisfies Module;

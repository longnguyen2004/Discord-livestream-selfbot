import { Client, StageChannel } from "discord.js-selfbot-v13";
import { Command } from "@commander-js/extra-typings";
import { Streamer, type StreamOptions } from "@dank074/discord-video-stream";
import { NewApi } from "@dank074/discord-video-stream";

import { createCommand } from "../index.js";
import { prepareStream } from "./customStreamNew.js";
import type { Module } from "../index.js";
import type Ffmpeg from "fluent-ffmpeg";

export default {
  name: "stream",
  register(client: Client) {
    const streamer = new Streamer(client);
    let playback: Ffmpeg.FfmpegCommand;
    return [
      createCommand(
        new Command("play")
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
              copyCodec: !!opts.copy
            });
            playback = command;

            await NewApi.playStream(output, streamer, {
              forceChacha20Encryption: true,
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
} satisfies Module

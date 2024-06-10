import PCancelable, { CancelError } from "p-cancelable";
import { Client, StageChannel } from "discord.js-selfbot-v13";
import { Command } from "@commander-js/extra-typings";
import { Streamer, type StreamOptions } from "@dank074/discord-video-stream";
import { getVideoInfo, playVideo } from "./utils.js";

import { createCommand } from "../index.js";
import type { Module } from "../index.js";

let defaultStreamOpts: Partial<StreamOptions> = {
  width: 1920,
  height: 1080,
  fps: 60,
  bitrateKbps: 5000,
  maxBitrateKbps: 10000,
  videoCodec: "H264",
  rtcpSenderReportEnabled: true
};

export default {
  name: "stream",
  register(client: Client) {
    const streamer = new Streamer(client);
    let playback: PCancelable<string>;
    return [
      createCommand(
        new Command("play")
          .argument("<url>", "The url to play")
          .option("--copy", "Copy the stream directly instead of re-encoding")
          .option("--realtime", "Do not sleep between frames. Specify this if the stream is a livestream")
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
          playback?.cancel();

          try {
            await streamer.joinVoice(guildId, channelId);

            if (streamer.client.user!.voice!.channel instanceof StageChannel)
              await streamer.client.user!.voice!.setSuppressed(false);

            const { includeAudio, copyCodec, streamOpts } = await getVideoInfo(url, !!opts.copy);
            const udpConn = await streamer.createStream({
              ...defaultStreamOpts,
              ...streamOpts
            });
            playback = playVideo(url, udpConn, includeAudio, copyCodec, !!opts.realtime);
            await playback;
          }
          catch (e)
          {
            if (e instanceof CancelError)
              return;
            const error = e as Error;
            message.reply(
              `Oops, something bad happened
\`\`\`
${error.message}
\`\`\``
            )
          }
          finally
          {
            streamer.stopStream();
          }
        }
      ),

      createCommand(
        new Command("stop"),
        () => {
          playback?.cancel();
          streamer.stopStream();
        }
      ),

      createCommand(
        new Command("disconnect"),
        () => {
          playback?.cancel();
          streamer.leaveVoice();
        }
      )
    ]
  }
} satisfies Module

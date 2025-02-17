import { Command, Option } from "@commander-js/extra-typings";
import { Streamer } from "@dank074/discord-video-stream";
import { prepareStream, playStream } from "@dank074/discord-video-stream";
import * as Ingestor from "./ffmpegIngest.js";
import * as ytdlp from "./yt-dlp.js";
import { createCommand } from "../index.js";
import { StageChannel } from "discord.js-selfbot-v13";

import type { Module } from "../index.js";
import type Ffmpeg from "fluent-ffmpeg";
import type { Message } from "discord.js-selfbot-v13";

function ffmpegErrorHandler(
	err: Error,
	stdout: string | null,
	stderr: string | null,
) {
	if (/SIG(TERM|KILL)/.test(err.message)) return;
	console.log("FFmpeg encountered an error");
	console.log(err);
}

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

	if (streamer.client.user!.voice!.channel instanceof StageChannel)
		await streamer.client.user!.voice!.setSuppressed(false);
}

export default {
	name: "stream",
	register(bot) {
		const streamer = new Streamer(bot.client, {
			forceChacha20Encryption: true,
		});
		let playback: Ffmpeg.FfmpegCommand;
		return [
			createCommand(
				new Command("play")
					.description("Play a video file or link")
					.argument("<url>", "The url to play")
					.option("--copy", "Copy the stream directly instead of re-encoding")
					.option("--livestream", "Specify if the stream is a livestream")
					.option(
						"--room <id>",
						"The room ID, specified as <guildId>/<channelId>. If not specified, use the current room of the caller",
					),
				async (message, args, opts) => {
					const url = args[0];
					await joinRoom(streamer, message, opts.room);
					playback?.kill("SIGTERM");
					try {
						const { command, output } = prepareStream(url, {
							noTranscoding: !!opts.copy,
						});
						command.on("error", ffmpegErrorHandler);
						playback = command;

						await playStream(output, streamer, {
							readrateInitialBurst: opts.livestream ? 10 : undefined,
						});
					} catch (e) {
						const error = e as Error;
						message.reply(
							`Oops, something bad happened
\`\`\`
${error.message}
\`\`\``,
						);
					}
				},
			),

			createCommand(
				new Command("obs")
					.description("Starts an OBS ingest server for livestreaming")
					.option(
						"--room <id>",
						"The room ID, specified as <guildId>/<channelId>. If not specified, use the current room of the caller",
					)
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
				async (message, args, opts) => {
					await joinRoom(streamer, message, opts.room);
					playback?.kill("SIGTERM");
					try {
						const ingestor = {
							srt: Ingestor.ingestSrt,
							rtmp: Ingestor.ingestRtmp,
							rist: Ingestor.ingestRist,
						} as const;
						const { command, output, host } = ingestor[opts.protocol](
							opts.port,
						);

						command.on("error", ffmpegErrorHandler);
						command.on("stderr", (line) => console.log(line));
						playback = command;

						message.reply(`Please connect your OBS to \`${host}\``);
						output.once("data", () => {
							message.reply("Media stream found. Starting playback...");
						});
						await playStream(output, streamer, {
							readrateInitialBurst: 10,
						});
					} catch (e) {
						const error = e as Error;
						message.reply(
							`Oops, something bad happened
\`\`\`
${error.message}
\`\`\``,
						);
					}
				},
			),

			createCommand(
				new Command("yt-dlp")
					.description("Play a video using yt-dlp")
					.argument("<url>", "The url to play")
					.option("--list-formats", "List all the formats in this video")
					.option(
						"--format <format>",
						"The format to use. If not specified, use yt-dlp default",
					),
				async (message, args, opts) => {
					const url = args[0];
          if (opts.listFormats)
          {
            const formats = await ytdlp.getFormats(url);
            let reply = "";
            reply += `Formats for URL \`${url}\`\n`;
            for (const format of formats)
            {
              reply += `- \`${format.format_id}\`: ext ${format.ext}, res ${format.resolution}, fps ${format.fps}`;
            }
            message.reply(reply);
            return;
          }
					await joinRoom(streamer, message);
					playback?.kill("SIGTERM");

					try {
						const { command, output } = ytdlp.ytdlp(url, opts.format, {
              h26xPreset: "superfast",
              bitrateVideo: 5000,
              bitrateVideoMax: 7500
            });

						command.on("error", ffmpegErrorHandler);
						command.on("stderr", (line) => console.log(line));
						playback = command;

						await playStream(output, streamer);
					} catch (e) {
						const error = e as Error;
						message.reply(
							`Oops, something bad happened
\`\`\`
${error.message}
\`\`\``,
						);
					}
				},
			),

			createCommand(new Command("stop"), () => {
				playback?.kill("SIGTERM");
			}),

			createCommand(new Command("disconnect"), () => {
				playback?.kill("SIGTERM");
				streamer.leaveVoice();
			}),
		];
	},
} satisfies Module;

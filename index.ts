import prompts from "prompts";
import { Client, StageChannel } from "discord.js-selfbot-v13";
import {
    MediaUdp,
    getInputMetadata,
    inputHasAudio,
    Streamer,
    Utils,
    type StreamOptions
} from "@dank074/discord-video-stream";
import { streamLivestreamVideo } from "./customStream.js";
import { Command } from "commander";
import PCancelable from "p-cancelable";

let streamOpts: Partial<StreamOptions> = {}
let playback: PCancelable<string>;

async function getVideoInfo(video: string, preferCopy: boolean) {
    let includeAudio = true;
    let copyCodec = false;

    streamOpts = {
        ...streamOpts,
        videoCodec: "H264",
        width: -1,
        height: 1080
    };
    const metadata = await getInputMetadata(video);
    console.log(metadata);
    const videoStream = metadata.streams.find((value) => value.codec_type === 'video' && value.pix_fmt === 'yuv420p');
    if (videoStream)
    {
        const fps = parseInt(videoStream.r_frame_rate!.split('/')[0]) / parseInt(videoStream.r_frame_rate!.split('/')[1]);
        streamOpts = {...streamOpts, fps}
    }
    // @ts-ignore
    if (videoStream && (["h264", "hevc", "av1"] as const).includes(videoStream.codec_name) && !video.includes("ttvnw.net") && preferCopy) //only supports those profiles
    {
        // lets copy the video instead
        console.log('copying codec');
        const width = videoStream.width;
        const height = videoStream.height;
        console.log(width, height, Number(videoStream.profile));
        streamOpts = {
            ...streamOpts,
            width, height, videoCodec: Utils.normalizeVideoCodec(videoStream.codec_name!)
        };
        copyCodec = true;
    }
    //console.log(JSON.stringify(metadata.streams));
    includeAudio = inputHasAudio(metadata);

    return { includeAudio, copyCodec };
}

async function playVideo(video: string, udpConn: MediaUdp, includeAudio: boolean, copyCodec: boolean, isRealtime: boolean) {
    console.log("Started playing video");

    udpConn.mediaConnection.setSpeaking(true);
    udpConn.mediaConnection.setVideoStatus(true);
    try {
        playback = streamLivestreamVideo(video, udpConn, includeAudio, copyCodec, isRealtime);
        const res = await playback;
        console.log("Finished playing video " + res);
    } finally {
        udpConn.mediaConnection.setSpeaking(false);
        udpConn.mediaConnection.setVideoStatus(false);
    }
}

const streamer = new Streamer(new Client());

streamOpts = {
    width: 1920,
    height: 1080,
    fps: 60,
    bitrateKbps: 5000,
    maxBitrateKbps: 10000,
    videoCodec: "H264",
    rtcpSenderReportEnabled: true
};

streamer.client.on("ready", async () => {
    console.log(`--- ${streamer.client.user?.tag} is ready ---`);
});

const allowedId = ['174038066103713792'];
streamer.client.on("messageCreate", async (message) => {
    if (message.author.bot)
        return;

    if (!allowedId.includes(message.author.id))
        return;

    if (!message.content)
        return;

    if (message.content.startsWith("$$play ")) {
        const program = new Command();
        program
            .exitOverride()
            .configureOutput({
                writeOut() {},
                writeErr() {}
            });
        program
            .name("$$play")
            .argument("<url>", "The url to play")
            .option("--copy", "Copy the stream directly instead of re-encoding")
            .option("--realtime", "Do not sleep between frames. Specify this if the stream is a livestream")
        const args = [...message.content.matchAll(/([^ "]+|"(?:\\["\\]|[^"])+")+/g)]
            .slice(1).map(match => match[0]);
        
        try
        {
            program.parse(args, { from: "user" });
        }
        catch (e)
        {
            message.reply(`
Invalid arguments
\`\`\`
${program.helpInformation()}
\`\`\``)
            return;
        }
        const options = program.opts();
        const url = program.args[0];
        const guildId = message.guildId!;
        const channel = message.author.voice?.channel;
        if (!channel) {
            message.reply("Please join a voice channel first!");
            return;
        }

        playback?.cancel();
        await streamer.joinVoice(guildId, channel.id);

        if (channel instanceof StageChannel) {
            await streamer.client.user!.voice!.setSuppressed(false);
        }

        try {
            const { includeAudio, copyCodec } = await getVideoInfo(url, options.copy);
            const udpConn = await streamer.createStream(streamOpts);
            await playVideo(url, udpConn, includeAudio, copyCodec, options.realtime);
        }
        catch (e) {
            if (playback?.isCanceled)
                return;
            const error = e as Error;
            message.reply(
                `Oops, something bad happened
\`\`\`
${error.message}
\`\`\``
            )
        }
        finally {
            streamer.stopStream();
        }
    }
    else if (message.content.startsWith("$$stop")) {
        playback?.cancel();
        streamer.stopStream();
    }
    else if (message.content.startsWith("$$disconnect")) {
        playback?.cancel();
        streamer.leaveVoice();
    }
})

const { token } = await prompts({
    name: "token",
    type: "text",
    message: "Discord token"
});

await streamer.client.login(token);

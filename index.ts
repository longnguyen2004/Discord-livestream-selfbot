import prompts from "prompts";
import { Client } from "discord.js-selfbot-v13";
import {
    MediaUdp,
    setStreamOpts,
    getInputMetadata,
    inputHasAudio,
    Streamer
} from "@dank074/discord-video-stream";
import { command, streamLivestreamVideo } from "./customStream.js";

async function playVideo(video: string, udpConn: MediaUdp) {
    let includeAudio = true;
    let copyH264Codec = false;

    try {
        const metadata = await getInputMetadata(video);
        console.log(metadata);
        const videoStream = metadata.streams.find((value) => value.codec_type === 'video' && value.codec_name === "h264" && value.pix_fmt === 'yuv420p');
        // @ts-ignore
        if (videoStream) //only supports those profiles
        {
            // lets copy the video instead
            console.log('copying codec');
            copyH264Codec = true;
            const fps = parseInt(videoStream.r_frame_rate!.split('/')[0]) / parseInt(videoStream.r_frame_rate!.split('/')[1]);
            const width = videoStream.width;
            const height = videoStream.height;
            console.log(fps, width, height, Number(videoStream.profile));
            setStreamOpts({ fps, width, height });
        }
        //console.log(JSON.stringify(metadata.streams));
        includeAudio = inputHasAudio(metadata);
    } catch (e) {
        console.log(e);
        return;
    }

    console.log("Started playing video");

    udpConn.mediaConnection.setSpeaking(true);
    udpConn.mediaConnection.setVideoStatus(true);
    try {
        const res = await streamLivestreamVideo(video, udpConn, includeAudio, copyH264Codec);

        console.log("Finished playing video " + res);
    } finally {
        udpConn.mediaConnection.setSpeaking(false);
        udpConn.mediaConnection.setVideoStatus(false);
    }
    command?.kill("SIGINT");
}

const streamer = new Streamer(new Client());

setStreamOpts({
    width: 1920,
    height: 1080,
    fps: 60,
    bitrateKbps: 5000,
    maxBitrateKbps: 10000,
    video_codec: "H264"
});

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

    if (message.content.startsWith("$$play"))
    {
        const url = message.content.split(" ")[1];
        if (!url) return;
        const guildId = message.guildId!;
        const channel = message.author.voice?.channel;
        if (!channel)
        {
            message.reply("Please join a voice channel first!");
            return;
        }

        command?.kill("SIGINT")
        await streamer.joinVoice(guildId, channel.id);
        try {
            const udpConn = await streamer.createStream();
            await playVideo(url, udpConn);
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
        finally
        {
            streamer.stopStream();
        }
    }
    else if (message.content.startsWith("$$stop"))
    {
        command?.kill("SIGINT");
        streamer.stopStream();
    }
    else if (message.content.startsWith("$$disconnect"))
    {
        command?.kill("SIGINT");
        streamer.leaveVoice();
    }
})

const { token } = await prompts({
    name: "token",
    type: "text",
    message: "Discord token"
});

await streamer.client.login(token);

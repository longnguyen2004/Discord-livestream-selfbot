import ffmpeg from 'fluent-ffmpeg';
import { demux } from '@dank074/discord-video-stream';
import {
    AudioStream,
    VideoStream,
    MediaUdp,
} from "@dank074/discord-video-stream";
import { Readable, PassThrough } from 'stream';
import PCancelable from 'p-cancelable';

export function streamLivestreamVideo(
    input: string,
    mediaUdp: MediaUdp,
    includeAudio = true,
    copyCodec = false,
) {
    const streamOpts = mediaUdp.mediaConnection.streamOptions;
    return new PCancelable<string>(async (resolve, reject, onCancel) => {
        const ffmpegOutput = new PassThrough();
        let videoCodec = streamOpts.videoCodec;
        console.log(videoCodec);

        const headers: map = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.3",
            "Connection": "keep-alive"
        };

        let isHttpUrl = false;
        let isHls = false;

        if (typeof input === "string") {
            isHttpUrl = input.startsWith('http') || input.startsWith('https');
            isHls = input.includes('m3u');
        }

        try {
            let command = ffmpeg(input)
                .output(ffmpegOutput)
                .outputFormat("matroska")
                .addInputOption(
                    "-stats",
                    "-flags", "low_delay",
                    "-analyzeduration", "0",
                    "-thread_queue_size", "4096",
                    "-fflags", "flush_packets",
                    "-flush_packets", "1"
                    // "-hwaccel", "nvdec"
                )
                .on('start', function(cmd) {
                    console.log(`Command line: ${cmd}`)
                })
                .on('stderr', function(stderrLine) {
                    console.log(stderrLine)
                })
                .on('end', () => {
                    resolve("video ended");
                })
                .on("error", (err) => {
                    reject(new Error(
                        `
Cannot play video: ${err.message}
`
                    ));
                });
            let isRealTime = /(rtsp|rtmp|srt):\/\//.test(input);
                
            if (input.startsWith("rtsp://"))
                command = command.addInputOption(
                    "-buffer_size", "4194304",
                    "-err_detect", "ignore_err"
                );
            command = command.addOption(["-map 0:v"]);
            if (copyCodec) {
                command = command.videoCodec('copy')
            }
            else {
                command = command
                    .addOutputOption("-force_key_frames", "expr:gte(t,n_forced*1)")
                    .videoFilter(`scale=${streamOpts.width}:${streamOpts.height}`)
                    .fpsOutput(streamOpts.fps!)
                    .videoBitrate(`${streamOpts.bitrateKbps}k`)
                switch (videoCodec) {
                    case "H264":
                        command = command
                            .videoCodec("h264_nvenc")
                            .outputOptions([
                                '-noautoscale',
                                '-bf 0',
                                '-pix_fmt yuv420p',
                                '-preset p3',
                                '-profile:v baseline',
                                '-b:v 7000k',
                                '-maxrate:v 7000k',
                            ]);
                        break;

                    case "H265":
                        command = command
                            .videoCodec("hevc_nvenc")
                            .outputOptions([
                                '-tune zerolatency',
                                '-pix_fmt yuv420p',
                                '-preset ultrafast',
                                '-profile:v baseline',
                            ]);
                        break;

                    case "VP8":
                        command = command
                            .videoCodec("libvpx")
                            .outputOption('-deadline', 'realtime');
                        break;

                    case "AV1":
                        command = command
                            .videoCodec("libsvtav1")
                        break;
                }
            }

            command = command
                .addOption([
                    "-map 0:a?"
                ])
                .audioChannels(2)
                .audioFrequency(48000)
                .audioCodec("libopus")

            if (streamOpts.hardwareAcceleratedDecoding)
                command = command.inputOption('-hwaccel', 'auto');

            if (isHttpUrl) {
                command = command.inputOption('-headers',
                    Object.keys(headers).map(key => key + ": " + headers[key]).join("\r\n")
                );
                if (!isHls) {
                    command = command.inputOptions([
                        '-reconnect 1',
                        '-reconnect_at_eof 1',
                        '-reconnect_streamed 1',
                        '-reconnect_delay_max 4294'
                    ]);
                }
            }

            command.run();
            onCancel(() => command.kill("SIGINT"))

            const { video, audio } = await demux(ffmpegOutput);
            const videoStream = new VideoStream(mediaUdp, isRealTime);
            video!.stream.pipe(videoStream)
            if (audio && includeAudio) {
                const audioStream = new AudioStream(mediaUdp, isRealTime);
                videoStream.syncStream = audioStream;
                audioStream.syncStream = videoStream;
                audio.stream.pipe(audioStream)
            }
        } catch (e) {
            //audioStream.end();
            //videoStream.end();
            reject(new Error("cannot play video " + e.message));
        }
    });
}

export function getInputMetadata(input: string | Readable): Promise<ffmpeg.FfprobeData> {
    return new Promise((resolve, reject) => {
        const instance = ffmpeg(input).on('error', (err, stdout, stderr) => reject(err));

        instance.ffprobe((err, metadata) => {
            if (err) reject(err);
            instance.removeAllListeners();
            resolve(metadata);
            instance.kill('SIGINT');
        });
    });
}

export function inputHasAudio(metadata: ffmpeg.FfprobeData) {
    return metadata.streams.some((value) => value.codec_type === 'audio');
}

export function inputHasVideo(metadata: ffmpeg.FfprobeData) {
    return metadata.streams.some((value) => value.codec_type === 'video');
}

type map = {
    [key: string]: string;
};

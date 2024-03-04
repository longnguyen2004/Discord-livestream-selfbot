import ffmpeg from 'fluent-ffmpeg';
import prism from "prism-media";
import {
    AudioStream,
    VideoStream,
    MediaUdp,
    H264NalSplitter,
    H265NalSplitter,
    IvfTransformer,
    streamOpts
} from "@dank074/discord-video-stream";
import { StreamOutput } from '@dank074/fluent-ffmpeg-multistream-ts';
import { Readable, Transform, PassThrough } from 'stream';
import { Worker } from 'worker_threads';
import { Utils } from '@dank074/discord-video-stream';

export let command: ffmpeg.FfmpegCommand | undefined;

export function streamLivestreamVideo(input: string | Readable, mediaUdp: MediaUdp, includeAudio = true, copyCodec = false) {
    return new Promise<string>((resolve, reject) => {
        let videoOutput: Transform;
        let videoCodec = Utils.normalizeVideoCodec(streamOpts.video_codec!);
        console.log(videoCodec);

        switch (videoCodec) {
            case "H264":
                videoOutput = new H264NalSplitter();
                break;

            case "H265":
                videoOutput = new H265NalSplitter();
                break;

            case "VP8":
                videoOutput = new IvfTransformer();
                break;

            default:
                throw new Error("Not supported");
        }

        const headers: map = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.3",
            "Connection": "keep-alive"
        };

        let isHttpUrl = false;
        let isHls = false;
        let isRealtime = false;

        if (typeof input === "string") {
            isHttpUrl = input.startsWith('http') || input.startsWith('https');
            isHls = input.includes('m3u');
        }

        const videoStream = new VideoStream(mediaUdp, streamOpts.fps, true);

        try {
            command = ffmpeg(input)
                .addInputOption(
                    "-loglevel", "error",
                    "-flags", "low_delay",
                    "-analyzeduration", "0",
                    "-thread_queue_size", "10"
                )
                .on('end', () => {
                    command = undefined;
                    resolve("video ended");
                })
                .on("error", (err, stdout, stderr) => {
                    command = undefined;
                    reject(new Error(
                        `
Cannot play video: ${err.message}
`
                    ));
                })
                .on('stderr', console.error);

            if (input.startsWith("rtsp://"))
                command.addInputOption(
                    "-reorder_queue_size", "100",
                    "-buffer_size", "4194304",
                    "-err_detect", "ignore_err"
                );
            switch (videoCodec) {
                case "H264":
                    if (copyCodec) {
                        command.output(StreamOutput(videoOutput).url, { end: false })
                            .addOption(["-map 0:v"])
                            .videoCodec('copy')
                            .format('h264')
                            .outputOptions([
                                '-bsf:v h264_metadata=aud=insert'
                            ]);
                    } else {
                        command.output(StreamOutput(videoOutput).url, { end: false })
                            .addOption(["-map 0:v"])
                            .size(`${streamOpts.width}x${streamOpts.height}`)
                            .fpsOutput(streamOpts.fps!)
                            .videoBitrate(`${streamOpts.bitrateKbps}k`)
                            .format('h264')
                            .outputOptions([
                                '-tune zerolatency',
                                '-pix_fmt yuv420p',
                                '-preset ultrafast',
                                '-profile:v baseline',
                                `-g ${streamOpts.fps}`,
                                `-x264-params keyint=${streamOpts.fps}:min-keyint=${streamOpts.fps}`,
                                '-bsf:v h264_metadata=aud=insert'
                            ]);
                    }
                    break;

                case "H265":
                    if (copyCodec) {
                        command.output(StreamOutput(videoOutput).url, { end: false })
                            .addOption(["-map 0:v"])
                            .videoCodec('copy')
                            .format('hevc')
                            .outputOptions([
                                '-bsf:v hevc_metadata=aud=insert'
                            ]);
                    } else {
                        command.output(StreamOutput(videoOutput).url, { end: false })
                            .addOption(["-map 0:v"])
                            .size(`${streamOpts.width}x${streamOpts.height}`)
                            .fpsOutput(streamOpts.fps!)
                            .videoBitrate(`${streamOpts.bitrateKbps}k`)
                            .format('hevc')
                            .outputOptions([
                                '-tune zerolatency',
                                '-pix_fmt yuv420p',
                                '-preset ultrafast',
                                '-profile:v baseline',
                                `-g ${streamOpts.fps}`,
                                `-x265-params keyint=${streamOpts.fps}:min-keyint=${streamOpts.fps}`,
                                '-bsf:v hevc_metadata=aud=insert'
                            ]);
                    }
                    break;

                default:
                    command.output(StreamOutput(videoOutput).url, { end: false })
                        .addOption(["-map 0:v"])
                        .size(`${streamOpts.width}x${streamOpts.height}`)
                        .fpsOutput(streamOpts.fps!)
                        .videoBitrate(`${streamOpts.bitrateKbps}k`)
                        .format('ivf')
                        .outputOption('-deadline', 'realtime');
                    break;
            }

            videoOutput.pipe(videoStream, { end: false });

            if (includeAudio) {
                const audioStream = new AudioStream(mediaUdp, true);

                command
                    .output(StreamOutput(audioStream).url, { end: false })
                    .addOption([
                        "-map 0:a"
                    ])
                    .audioChannels(2)
                    .audioFrequency(48000)
                    .audioCodec("libopus")
                    .format("data")
            }

            if (streamOpts.hardware_acceleration) command.inputOption('-hwaccel', 'auto');

            if (isHttpUrl) {
                command.inputOption('-headers',
                    Object.keys(headers).map(key => key + ": " + headers[key]).join("\r\n")
                );
                if (!isHls) {
                    command.inputOptions([
                        '-reconnect 1',
                        '-reconnect_at_eof 1',
                        '-reconnect_streamed 1',
                        '-reconnect_delay_max 4294'
                    ]);
                }
            }

            command.run();
        } catch (e) {
            //audioStream.end();
            //videoStream.end();
            command = undefined;
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

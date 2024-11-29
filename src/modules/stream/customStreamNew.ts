import ffmpeg from "fluent-ffmpeg";
import { PassThrough } from "node:stream";
import { Utils } from "@dank074/discord-video-stream";
import type { Readable } from "node:stream";
import type { NewApi } from "@dank074/discord-video-stream";

type EncoderOptions = NewApi.EncoderOptions & {
    copyCodec: boolean
};

const { isFiniteNonZero } = Utils;

export function prepareStream(
    input: string | Readable,
    options: Partial<EncoderOptions> = {}
) {
    const defaultOptions = {
        // negative values = resize by aspect ratio, see https://trac.ffmpeg.org/wiki/Scaling
        width: -2,
        height: -2,
        frameRate: undefined,
        videoCodec: "H264",
        bitrateVideo: 5000,
        bitrateVideoMax: 7000,
        bitrateAudio: 128,
        includeAudio: true,
        hardwareAcceleratedDecoding: false,
        minimizeLatency: false,
        h26xPreset: "ultrafast",
        customHeaders: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.3",
            "Connection": "keep-alive",
        },
        copyCodec: false
    } satisfies EncoderOptions;

    function mergeOptions(opts: Partial<EncoderOptions>) {
        return {
            width:
                isFiniteNonZero(opts.width) ? Math.round(opts.width) : defaultOptions.width,
    
            height:
                isFiniteNonZero(opts.height) ? Math.round(opts.height) : defaultOptions.height,
    
            frameRate:
                isFiniteNonZero(opts.frameRate) && opts.frameRate > 0
                    ? opts.frameRate
                    : defaultOptions.frameRate,
    
            videoCodec:
                opts.videoCodec ?? defaultOptions.videoCodec,
    
            bitrateVideo:
                isFiniteNonZero(opts.bitrateVideo) && opts.bitrateVideo > 0
                    ? Math.round(opts.bitrateVideo)
                    : defaultOptions.bitrateVideo,
    
            bitrateVideoMax:
                isFiniteNonZero(opts.bitrateVideoMax) && opts.bitrateVideoMax > 0
                    ? Math.round(opts.bitrateVideoMax)
                    : defaultOptions.bitrateVideoMax,
    
            bitrateAudio:
                isFiniteNonZero(opts.bitrateAudio) && opts.bitrateAudio > 0
                    ? Math.round(opts.bitrateAudio)
                    : defaultOptions.bitrateAudio,
    
            includeAudio:
                opts.includeAudio ?? defaultOptions.includeAudio,
    
            hardwareAcceleratedDecoding:
                opts.hardwareAcceleratedDecoding ?? defaultOptions.hardwareAcceleratedDecoding,
    
            minimizeLatency:
                opts.minimizeLatency ?? defaultOptions.minimizeLatency,
    
            h26xPreset:
                opts.h26xPreset ?? defaultOptions.h26xPreset,
    
            customHeaders: {
                ...defaultOptions.customHeaders, ...opts.customHeaders
            },

            copyCodec:
                opts.copyCodec ?? defaultOptions.copyCodec
        } satisfies EncoderOptions
    }

    const mergedOptions = mergeOptions(options);

    let isHttpUrl = false;
    let isHls = false;

    if (typeof input === "string") {
        isHttpUrl = input.startsWith('http') || input.startsWith('https');
        isHls = input.includes('m3u');
    }

    const output = new PassThrough();

    // command creation
    const command = ffmpeg(input)
        .output(output)
        .addOption('-loglevel', 'error')
        .on('start', function(cmd) {
            console.log(`Command line: ${cmd}`)
        })
        .on('stderr', function(stderrLine) {
            console.log(stderrLine)
        })
        .on('end', () => {
        })
        .on("error", (err) => {
            console.log(err.message);
        });

    // input options
    let { hardwareAcceleratedDecoding, minimizeLatency, customHeaders } = mergedOptions;
    if (hardwareAcceleratedDecoding)
        command.inputOption('-hwaccel', 'auto');

    if (minimizeLatency) {
        command.addOptions([
            '-fflags nobuffer',
            '-analyzeduration 0'
        ])
    }

    command.addInputOption(
        "-stats",
        "-flags", "low_delay",
        "-analyzeduration", "0",
        "-thread_queue_size", "4096",
        "-fflags", "flush_packets",
        "-flush_packets", "1",
        "-threads", "8"
        // "-hwaccel", "nvdec"
    )

    if (typeof input === "string")
    {
        if (input.startsWith("rtsp://"))
            command.addInputOption(
                "-buffer_size", "4194304",
                "-err_detect", "ignore_err"
            );
    }
    if (isHttpUrl) {
        command.inputOption('-headers',
            Object.entries(customHeaders).map((k, v) => `${k}: ${v}`).join("\r\n")
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

    // general output options
    command.outputFormat("matroska");

    // video setup
    let {
        width, height, frameRate, bitrateVideo, bitrateVideoMax, videoCodec, h26xPreset, copyCodec
    } = mergedOptions;
    command.addOption("-map 0:v");

    if (copyCodec)
    {
        command.videoCodec("copy");
    }
    else
    {
        command.videoFilter(`scale=${width}:${height}`)

        if (frameRate)
            command.fpsOutput(frameRate);

        command.addOutputOption([
            "-b:v", `${bitrateVideo}k`,
            "-maxrate:v", `${bitrateVideoMax}k`,
            "-bf", "0",
            "-pix_fmt", "yuv420p",
            "-force_key_frames", 'expr:gte(t,n_forced*1)'
        ]);
        switch (videoCodec) {
            case 'AV1':
                command
                    .videoCodec("libsvtav1")
                break;
            case 'VP8':
                command
                    .videoCodec("libvpx")
                    .outputOption('-deadline', 'realtime');
                break;
            case 'VP9':
                command
                    .videoCodec("libvpx-vp9")
                    .outputOption('-deadline', 'realtime');
                break;
            case 'H264':
                command
                    .videoCodec("h264_nvenc")
                    .outputOptions([
                        '-forced-idr', '1',
                        '-noautoscale',
                        '-pix_fmt yuv420p',
                        '-preset p3',
                        '-profile:v baseline',
                    ]);
                break;
            case 'H265':
                command
                    .videoCodec("libx265")
                    .outputOptions([
                        '-tune zerolatency',
                        `-preset ${h26xPreset}`,
                        '-profile:v main',
                    ]);
                break;
        }
    }
    // audio setup
    let { includeAudio, bitrateAudio } = mergedOptions;
    if (includeAudio)
        command
            .addOption("-map 0:a?")
            .audioChannels(2)
            /*
             * I don't have much surround sound material to test this with,
             * if you do and you have better settings for this, feel free to
             * contribute!
             */
            .addOutputOption("-lfe_mix_level 1")
            .audioFrequency(48000)
            .audioCodec("libopus")
            .audioBitrate(`${bitrateAudio}k`);

    command.run();
    return { command, output }
}

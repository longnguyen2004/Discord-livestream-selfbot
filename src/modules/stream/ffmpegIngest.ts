import ffmpeg from "fluent-ffmpeg";
import { PassThrough } from "node:stream";

function randomInclusive(min: number, max: number) {
    const minCeiled = Math.ceil(min);
    const maxFloored = Math.floor(max);
    return Math.floor(Math.random() * (maxFloored - minCeiled + 1) + minCeiled); // The maximum is inclusive and the minimum is inclusive
}

export function ffmpegIngest(port?: number) {
    const _port = port ?? randomInclusive(30000, 40000);
    const host = `srt://localhost:${_port}?transtype=live&smoother=live`;
    const output = new PassThrough();
    const command = ffmpeg(host)
        .on("stderr", (line) => console.log(line))
        .addOption(
            '-fflags', 'nobuffer',
            "-fflags", "flush_packets",
            "-flags", "low_delay",
            "-buffer_size", "4194304",
            "-err_detect", "ignore_err",
            "-thread_queue_size", "4096",
            "-flush_packets", "1",
            "-stats",
        )
        .inputFormat("mpegts")
        .addInputOption(
            "-mode", "listener",
            "-latency", "5000", // 5000 microseconds
            "-scan_all_pmts", "0"
        )
        .output(output)
        .outputFormat("matroska");

    command.addOutputOption("-map 0:v");
    command.videoCodec("copy");

    command
        .addOutputOption("-map 0:a?")
        .audioChannels(2)
        /*
         * I don't have much surround sound material to test this with,
         * if you do and you have better settings for this, feel free to
         * contribute!
         */
        .addOutputOption("-lfe_mix_level 1")
        .audioFrequency(48000)
        .audioCodec("libopus")
        .audioBitrate("128k");
    
    command.run();
    return { command, output, host }
}

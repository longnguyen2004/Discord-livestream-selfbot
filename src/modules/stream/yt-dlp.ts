import { $ } from "execa";
import { NewApi } from "@dank074/discord-video-stream";

export interface YtdlpFormat {
    format_id: string,
    ext: string,
    resolution: string | null,
    fps?: number | null
}

export async function getFormats(link: string)
{
    const result = (await $`yt-dlp --print "%(formats)+j" ${link}`).stdout;
    return JSON.parse(result) as YtdlpFormat[];
}

export function ytdlp(link: string, format?: string, encoderOptions?: Partial<NewApi.EncoderOptions>)
{
    const stream = $`yt-dlp ${format ? "--format " + format : ""} -o - ${link}`.stdout;
    return NewApi.prepareStream(stream, encoderOptions);
}

import {
  MediaUdp,
  getInputMetadata,
  inputHasAudio,
  Utils,
  type StreamOptions
} from "@dank074/discord-video-stream";
import { streamLivestreamVideo } from "./customStream.js";

export async function getVideoInfo(video: string, preferCopy: boolean) {
  let includeAudio = true;
  let copyCodec = false;

  let streamOpts: Partial<StreamOptions> = {
    videoCodec: "H264",
    width: -1,
    height: 1080
  };
  const metadata = await getInputMetadata(video);
  console.log(metadata);
  const videoStream = metadata.streams.find((value) => value.codec_type === 'video' && value.pix_fmt === 'yuv420p');
  if (videoStream) {
    const fps = parseInt(videoStream.r_frame_rate!.split('/')[0]) / parseInt(videoStream.r_frame_rate!.split('/')[1]);
    streamOpts = { ...streamOpts, fps }
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

  return { includeAudio, copyCodec, streamOpts };
}

export function playVideo(video: string, udpConn: MediaUdp, includeAudio: boolean, copyCodec: boolean, isRealtime: boolean) {
  console.log("Started playing video");

  udpConn.mediaConnection.setSpeaking(true);
  udpConn.mediaConnection.setVideoStatus(true);

  let playback = streamLivestreamVideo(video, udpConn, includeAudio, copyCodec, isRealtime);
  playback
    .then(res => console.log("Finished playing video " + res))
    .catch(() => {})
    .finally(() => {
      udpConn.mediaConnection.setSpeaking(false);
      udpConn.mediaConnection.setVideoStatus(false);
    })
  return playback;
}

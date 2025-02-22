import ky from "ky";
import { createCommand, type Module } from "../index.js";
import { Command } from "@commander-js/extra-typings";
import { attachReactionButtons } from "../../utils/attachReactionButtons.js";

type PaginatedResponse<T> = {
  itemCount: number;
  pageCount: number;
  items: T[];
};

type PathSource = {
  type:
    | "hlsSource"
    | "redirect"
    | "rpiCameraSource"
    | "rtmpConn"
    | "rtmpSource"
    | "rtspSession"
    | "rtspSource"
    | "rtspsSession"
    | "srtConn"
    | "srtSource"
    | "udpSource"
    | "webRTCSession"
    | "webRTCSource";
  id: string;
};

type PathReader = {
  type:
    | "hlsMuxer"
    | "rtmpConn"
    | "rtspSession"
    | "rtspsSession"
    | "srtConn"
    | "webRTCSession";
  id: string;
};

type PathInfo = {
  name: string;
  confName: string;
  source: PathSource;
  ready: boolean;
  readyTime: string | null;
  tracks: string[];
  bytesReceived: number;
  bytesSent: number;
  readers: PathReader[];
};

type PathsListResponse = PaginatedResponse<PathInfo>;

export default {
  name: "mediamtx",
  register(bot) {
    const MEDIAMTX_SERVER = "http://localhost:9997/v3";
    const mediaMtx = ky.create({
      prefixUrl: MEDIAMTX_SERVER,
    });
    return [
      createCommand(
        new Command("mtx-list").description(
          "List currently active MediaMTX streams",
        ),
        async (message) => {
          const itemsPerPage = 5;
          const getPaths = (page: number) => {
            return mediaMtx("paths/list", {
              searchParams: {
                page,
                itemsPerPage,
              },
            }).json<PathsListResponse>();
          };
          const createMessageContent = (
            paths: PathsListResponse,
            currentPage: number,
          ) => {
            let message = "";
            message += "## Currently running stream\n";
            for (const path of paths.items) {
              message += `- \`${path.name}\`: \`${path.source.type}\`\n`;
              message += `  - Tracks: ${path.tracks.join(", ")}\n`;
            }
            message += "\n";
            message += `*Page ${currentPage + 1}/${paths.pageCount}*`;
            return message;
          };
          let currentPage = 0;
          let paths = await getPaths(currentPage);
          if (paths.itemCount === 0) {
            message.reply("There is no stream running at the moment");
            return;
          }
          const reply = await message.reply(
            createMessageContent(paths, currentPage),
          );
          attachReactionButtons(
            reply,
            new Map([
              [
                "◀️",
                async () => {
                  currentPage = Math.max(0, currentPage - 1);
                  paths = await getPaths(currentPage);
                  await reply.edit(createMessageContent(paths, currentPage));
                },
              ],
              [
                "▶️",
                async () => {
                  currentPage = Math.min(paths.pageCount - 1, currentPage + 1);
                  paths = await getPaths(currentPage);
                  await reply.edit(createMessageContent(paths, currentPage));
                },
              ],
            ]),
            new Set([message.author.id]),
          );
        },
      ),
    ];
  },
} satisfies Module;

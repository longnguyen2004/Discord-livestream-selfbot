import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getConfig } from "./config.js";
import { Bot } from "./bot.js";

process.on("unhandledRejection", (reason: string, p: Promise<any>) => {
  console.error("Unhandled Rejection at:", p, "reason:", reason);
});

const configPath = fileURLToPath(
  argv[2]
    ? new URL(argv[2], pathToFileURL(process.cwd()))
    : new URL("../config/default.jsonc", import.meta.url),
);
console.log(`Loading config from ${configPath}`);
const config = await getConfig(configPath);

const bot = new Bot({
  config,
  modulesPath: new URL("./modules", import.meta.url),
});

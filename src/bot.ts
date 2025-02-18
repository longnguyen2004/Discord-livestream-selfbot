import EventEmitter from "node:events";
import parseArgsStringToArgv from "string-argv";
import { CommanderError } from "@commander-js/extra-typings";
import { Client, type Message } from "discord.js-selfbot-v13";
import { glob } from "glob";
import type { BotCommand, Module } from "./modules/index.js";

export type BotSettings = {
  token: string;
  prefix: string;
  allowedId: string[];
  modulesPath: string | URL;
};

export class Bot extends EventEmitter {
  private _client = new Client();
  private _initialized = false;
  private _allowedId;
  private _allCommandsByName = new Map<string, BotCommand>();
  private _allCommandsByModule = new Map<string, BotCommand[]>();

  public prefix;

  constructor({ token, prefix, allowedId, modulesPath }: BotSettings) {
    super();
    this._allowedId = new Set(allowedId);
    this.prefix = prefix;

    (async () => {
      const modulesFile = (
        await glob("*/**/index.js", {
          cwd: modulesPath,
          dotRelative: true,
        })
      ).map((file) => new URL(file, modulesPath + "/").toString());
      const modules = await Promise.all(
        modulesFile.map((file) =>
          import(file).then((m) => m.default as Module),
        ),
      );
      for (const module of modules) {
        console.log(`Registering module ${module.name}`);
        const commands = module.register(this);
        this._allCommandsByModule.set(module.name, commands);
        for (const command of commands)
          this._allCommandsByName.set(command.parser.name(), command);
      }
      this._client.on("messageCreate", this._handleMessage.bind(this));
      this.client.on("ready", () => {
        console.log(`--- ${this._client.user?.tag} is ready ---`);
        this._initialized = true;
        this.emit("ready");
      });
      await this._client.login(token);
    })();
  }

  private async _handleMessage(message: Message) {
    if (message.author.bot) return;

    if (!this._allowedId.has(message.author.id)) return;

    if (!message.content) return;

    if (message.content.startsWith(this.prefix)) {
      const splitted = parseArgsStringToArgv(
        message.content.slice(this.prefix.length).trim(),
      );
      const command = splitted[0];
      const program = this._allCommandsByName.get(command);
      if (!program) {
        message.reply(`Invalid command \`${command}\``);
        return;
      }
      const { parser, handler } = program;
      try {
        const result = parser.parse(splitted.slice(1), { from: "user" });
        await handler(message, result.args, result.opts());
      } catch (e: unknown) {
        if (e instanceof CommanderError) {
          let reply = "";
          reply += "```\n";
          reply += e.message + "\n";
          reply += "```\n";
          reply += "```\n";
          reply += parser.helpInformation() + "\n";
          reply += "```\n";
          message.reply(reply);
        }
      }
    }
  }
  public get client() {
    return this._client;
  }

  public get initialized() {
    return this._initialized;
  }

  public get allCommandsByModule() {
    return this._allCommandsByModule;
  }

  public get allCommands() {
    return this._allCommandsByName;
  }
}

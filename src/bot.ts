import EventEmitter from "node:events";
import parseArgsStringToArgv from "string-argv";
import { CommanderError } from "@commander-js/extra-typings";
import { Client, type Message } from "discord.js-selfbot-v13";
import { glob } from "glob";
import type { BotCommand, Module } from "./modules/index.js";
import type { BotConfig } from "./config.js";

export type BotSettings = {
  config: BotConfig,
  modulesPath: string | URL;
};

export enum LogLevel {
  NONE,
  ERROR,
  WARNING,
  INFO,
  DEBUG
}

export class Bot extends EventEmitter {
  private _config: BotConfig;
  private _client = new Client();
  private _initialized = false;
  private _allowedId;
  private _allCommandsByName = new Map<string, [BotCommand, Module]>();
  private _allCommandsByModule = new Map<string, BotCommand[]>();

  public logLevel;
  public prefix;

  constructor({ config, modulesPath }: BotSettings) {
    super();
    this._config = config;
    this._allowedId = new Set(config.allowed_id);
    this.prefix = config.prefix;
    this.logLevel = config.log_level;

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
        for (const command of commands) {
          const commandName = command.parser.name();
          const existingCommand = this._allCommandsByName.get(commandName);
          if (existingCommand) {
            console.log(
              `Command "${commandName}" already exists in module "${existingCommand[1].name}"`,
            );
            continue;
          }
          this._allCommandsByName.set(command.parser.name(), [command, module]);
        }
      }
      this._client.on("messageCreate", this._handleMessage.bind(this));
      this.client.on("ready", () => {
        console.log(`--- ${this._client.user?.tag} is ready ---`);
        this._initialized = true;
        this.emit("ready");
      });
      await this._client.login(config.token);
    })();
  }

  private async _handleMessage(message: Message) {
    if (message.author.bot) return;

    if (!this._allowedId.has(message.author.id)) return;

    if (!message.content) return;

    if (message.content.startsWith(this.prefix)) {
      await this.executeCommand(
        message,
        message.content.slice(this.prefix.length).trim()
      );
    }
  }

  public async log(request: Message, level: LogLevel, ...args: Parameters<Message["channel"]["send"]>)
  {
    if (level === LogLevel.NONE)
      throw new Error("Can't use NONE as log level for log()");
    if (this.logLevel < level)
      return;
    try {
      const reply = await request.channel.send(...args);
      switch (level)
      {
        case LogLevel.ERROR:
          await reply.react("🟥");
          break;
        case LogLevel.WARNING:
          await reply.react("🟨");
          break;
        case LogLevel.INFO:
          await reply.react("🟩");
          break;
        case LogLevel.DEBUG:
          await reply.react("🟦");
          break;
      }
    }
    catch
    {
    }
  }

  public async executeCommand(message: Message, input: string)
  {
    const splitted = parseArgsStringToArgv(input);
    const command = splitted[0];
    const program = this._allCommandsByName.get(command)?.[0];
    if (!program) {
      message.reply(`Invalid command \`${command}\``);
      return;
    }
    const { parser, handler } = program;
    try {
      const result = parser.parse(splitted.slice(1), { from: "user" });
      await handler(message, result.processedArgs, result.opts());
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

  public get allowedId() {
    return this._allowedId;
  }

  public get config() {
    return this._config;
  }
}

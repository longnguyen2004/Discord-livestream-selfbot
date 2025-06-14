import type { Message } from "discord.js-selfbot-v13";
import type { Command } from "@commander-js/extra-typings";
import type { Bot } from "../bot.js";

type DumbArgs = (unknown | unknown[] | undefined)[];
type DumbOpts = Record<string, unknown>;

export function createCommand<
  Args extends DumbArgs = DumbArgs,
  Opts extends DumbOpts = DumbOpts,
>(
  parser: Command<Args, Opts>,
  handler: (message: Message, args: Args, opts: Opts) => unknown,
) {
  parser
    .helpOption(false)
    .exitOverride()
    .configureOutput({
      writeOut() {},
      writeErr() {},
    });
  return {
    parser: parser as Command<DumbArgs, DumbOpts>,
    handler: handler as (
      message: Message,
      args: DumbArgs,
      opts: DumbOpts,
    ) => unknown | Promise<unknown>,
  };
}

export type BotCommand = ReturnType<typeof createCommand>;

export type Module = {
  name: string;
  register: (bot: Bot) => BotCommand[];
};

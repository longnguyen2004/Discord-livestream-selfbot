import type { Message, Client } from "discord.js-selfbot-v13"
import type { Command } from "@commander-js/extra-typings"

export function createCommand<
  Args extends string[],
  Opts extends Record<string, string | boolean | undefined>,
  T extends Command<Args, Opts>
>(
  parser: T,
  handler: (message: Message, args: T["args"], opts: ReturnType<T["opts"]>) => unknown
)
{
  return {
    parser,
    handler
  }
}

export type BotCommand = ReturnType<typeof createCommand>;

export type Module = {
  name: string,
  register: (client: Client) => BotCommand[]
}

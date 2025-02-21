import type { Bot } from "../bot.js";
import type { Message } from "discord.js-selfbot-v13";

export type ReactionHandler = Map<string, (message: Message) => unknown>;

export async function attachReactionButtons(
  bot: Bot,
  message: Message,
  handlers: ReactionHandler,
  allowedId: Set<string>,
) {
  const emojis = new Set(handlers.keys());
  const collector = message.createReactionCollector({
    filter: (reaction, user) => {
      return (
        user.id !== bot.client.user?.id &&
        allowedId.has(user.id) &&
        !!reaction.emoji.name &&
        emojis.has(reaction.emoji.name)
      );
    },
    idle: 60000,
  });
  collector.on("collect", (collected) => {
    collected.emoji.name && handlers.get(collected.emoji.name)?.(message);
  });
  for (const emoji of handlers.keys()) {
    await message.react(emoji);
  }
}

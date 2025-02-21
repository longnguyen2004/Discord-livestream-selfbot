import type { Message } from "discord.js-selfbot-v13";

export type ReactionHandler = Map<
  string,
  (message: Message) => unknown | Promise<unknown>
>;

export async function attachReactionButtons(
  message: Message,
  handlers: ReactionHandler,
  allowedId: Set<string>,
) {
  const emojis = new Set(handlers.keys());
  const collector = message.createReactionCollector({
    filter: (reaction, user) => {
      return (
        user.id !== user.client.user?.id &&
        allowedId.has(user.id) &&
        !!reaction.emoji.name &&
        emojis.has(reaction.emoji.name)
      );
    },
    idle: 60000,
  });
  let running = false;
  collector.on("collect", async (collected) => {
    if (running) return;
    if (!collected.emoji.name) return;
    running = true;
    await handlers.get(collected.emoji.name)?.(message);
    running = false;
  });
  for (const emoji of handlers.keys()) {
    await message.react(emoji);
  }
}

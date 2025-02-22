import { Command } from "@commander-js/extra-typings";
import { createCommand } from "../index.js";
import type { Module } from "../index.js";

export default {
  name: "general",
  register(bot) {
    const { allCommandsByModule, allCommands } = bot;
    return [
      createCommand(
        new Command("help")
          .description("Get help")
          .argument("[command]", "Get help for a specific command"),
        (message, args) => {
          if (args[0]) {
            const command = allCommands.get(args[0])?.[0];
            if (!command) {
              message.reply(`Command ${args[0]} doesn't exist`);
              return;
            }
            let reply = "";
            reply += "```\n";
            reply += command.parser.helpInformation() + "\n";
            reply += "```";
            message.reply(reply);
            return;
          }
          let reply = "";
          reply += `## Loaded modules: ${[...allCommandsByModule.keys()].map((name) => `\`${name}\``).join(", ")}\n`;
          for (const [name, commands] of allCommandsByModule.entries()) {
            reply += `### Commands for \`${name}\`\n`;
            reply += `${commands.map((c) => `\`${c.parser.name()}\``).join(", ")}\n`;
          }
          message.reply(reply);
        },
      ),
    ] as const;
  },
} satisfies Module;

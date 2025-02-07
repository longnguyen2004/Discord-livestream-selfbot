import parseArgsStringToArgv from "string-argv";
import { Client } from "discord.js-selfbot-v13";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getConfig } from "./config.js";
import { CommanderError } from "commander";

process.on('unhandledRejection', (reason: string, p: Promise<any>) => {
    console.error('Unhandled Rejection at:', p, 'reason:', reason);
});

const configPath = fileURLToPath(
    argv[2]
        ? new URL(argv[2], pathToFileURL(process.cwd()))
        : new URL("../config/default.jsonc", import.meta.url)
);
console.log(`Loading config from ${configPath}`);
const config = await getConfig(configPath)

const client = new Client();

const modules = await Promise.all([
    import("./modules/stream/index.js").then(m => m.default)
]);

const programs = new Map(
    modules.flatMap(m => {
        console.log(`Registering module "${m.name}"`);
        return m.register(client).map((program) => [
            program.parser.name(),
            program
        ] as const)
    })
);

client.on("ready", async () => {
    console.log(`--- ${client.user?.tag} is ready ---`);
});

const allowedId = config.allowed_id;
client.on("messageCreate", async (message) => {
    if (message.author.bot)
        return;

    if (!allowedId.includes(message.author.id))
        return;

    if (!message.content)
        return;

    if (message.content.startsWith(config.prefix)) {
        const splitted = parseArgsStringToArgv(
            message.content.slice(config.prefix.length).trim()
        );
        const command = splitted[0];
        const program = programs.get(command);
        if (!program) {
            message.reply(`Invalid command \`${command}\``);
            return;
        }
        const { parser, handler } = program;
        try {
            const result = parser.parse(splitted.slice(1), { from: "user" });
            handler(message, result.args, result.opts());
        }
        catch (e: unknown) {
            if (e instanceof CommanderError)
            {
                message.reply(
`
\`\`\`
${e.message}
\`\`\`
\`\`\`
${parser.helpInformation()}
\`\`\`
`
);
            }
        }
    }
})

await client.login(config.token);

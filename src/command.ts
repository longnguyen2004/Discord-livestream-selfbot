import { Command } from "@commander-js/extra-typings";

export function createHandler(prefix: string) {
  const program = new Command();
  program
    .name(prefix)
    .exitOverride()
    .configureOutput({
      writeOut() { },
      writeErr() { }
    });
  return program;
}

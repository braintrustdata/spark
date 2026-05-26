export function gitignoreNote(args: {
  readonly added: boolean;
  readonly alreadyCovered: boolean;
}): string {
  if (args.added) {
    return "Added .env.braintrust to .gitignore.";
  }
  if (args.alreadyCovered) {
    return ".gitignore already covers .env.braintrust.";
  }
  return ".gitignore unchanged.";
}

export function terminalHyperlink(url: string, label: string = url): string {
  return `\x1b]8;;${url}\x07${label}\x1b]8;;\x07`;
}

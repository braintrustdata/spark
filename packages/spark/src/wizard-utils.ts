export function terminalHyperlink(url: string, label: string = url): string {
  return `\x1b]8;;${url}\x07${label}\x1b]8;;\x07`;
}

import open from "open";

export async function openUrl(url: string): Promise<void> {
  await open(url, { wait: false });
}

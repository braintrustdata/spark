import { spawn } from "node:child_process";
import { platform } from "node:os";

/**
 * Best-effort browser open. Returns true if the platform-specific opener was
 * spawned without error (we don't wait for it to exit). If we can't open a
 * browser (no display, command failure, etc.), returns false so the caller
 * can fall back to printing the URL.
 */
export function openBrowser(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let cmd: string;
    let args: string[];
    switch (platform()) {
      case "darwin":
        cmd = "open";
        args = [url];
        break;
      case "win32":
        cmd = "cmd";
        args = ["/c", "start", "", url];
        break;
      default:
        cmd = "xdg-open";
        args = [url];
    }

    let settled = false;
    const done = (ok: boolean) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };

    try {
      const child = spawn(cmd, args, {
        stdio: "ignore",
        detached: true,
      });
      child.on("error", () => done(false));
      child.on("spawn", () => {
        child.unref();
        done(true);
      });
      setTimeout(() => done(true), 250);
    } catch {
      done(false);
    }
  });
}

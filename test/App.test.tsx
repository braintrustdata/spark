import { EventEmitter } from "node:events";
import { stripVTControlCharacters } from "node:util";
import { render as inkRender, type Instance } from "ink";
import React, { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "../src/App";
import { AppRoot } from "../src/AppRoot";

class TestStdout extends EventEmitter {
  readonly isTTY = true;
  columns: number;
  rows: number;
  frames: string[] = [];
  lastFrame = "";

  constructor(columns: number, rows: number) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

  write(
    data: string | Uint8Array,
    callbackOrEncoding?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ) {
    const frame = String(data);

    if (frame.length > 0) {
      this.frames.push(frame);
      this.lastFrame = frame;
    }

    if (typeof callbackOrEncoding === "function") {
      callbackOrEncoding();
    }

    callback?.();

    return true;
  }

  resize(columns: number, rows: number) {
    this.columns = columns;
    this.rows = rows;
    this.emit("resize");
  }
}

class TestStdin extends EventEmitter {
  readonly isTTY = true;
  private data: string | Uint8Array | null = null;

  write(data: string | Uint8Array) {
    this.data = data;
    this.emit("readable");
    this.emit("data", data);

    return true;
  }

  setEncoding() {
    return this;
  }

  setRawMode() {
    return this;
  }

  resume() {
    return this;
  }

  pause() {
    return this;
  }

  ref() {
    return this;
  }

  unref() {
    return this;
  }

  read() {
    const data = this.data;
    this.data = null;

    return data;
  }
}

const cleanupCallbacks: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanupCallbacks.splice(0).reverse()) {
    cleanup();
  }
});

function stripAnsi(value: string) {
  return stripVTControlCharacters(value);
}

function frameLines(frame: string) {
  return stripAnsi(frame).split("\n");
}

function expectFrameToFit(frame: string, columns: number, rows: number) {
  const lines = frameLines(frame);

  expect(lines).toHaveLength(rows);
  expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(
    columns,
  );
}

function renderApp({
  columns = 100,
  rows = 24,
}: {
  readonly columns?: number;
  readonly rows?: number;
} = {}) {
  const stdout = new TestStdout(columns, rows);
  const stderr = new TestStdout(columns, rows);
  const stdin = new TestStdin();
  const instance = inkRender(
    <AppRoot>
      <App />
    </AppRoot>,
    {
      debug: true,
      exitOnCtrlC: false,
      interactive: true,
      patchConsole: false,
      stderr: stderr as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
    },
  );

  cleanupCallbacks.push(instance.cleanup);

  return {
    instance,
    lastFrame: () => stripAnsi(stdout.lastFrame),
    stdin,
    stdout,
  };
}

async function flushRender(instance: Instance) {
  await instance.waitUntilRenderFlush();
}

async function resizeTerminal({
  instance,
  stdout,
  columns,
  rows,
}: {
  readonly instance: Instance;
  readonly stdout: TestStdout;
  readonly columns: number;
  readonly rows: number;
}) {
  await act(async () => {
    stdout.resize(columns, rows);
    await flushRender(instance);
  });
}

describe("App", () => {
  it("renders a fullscreen account question", async () => {
    const { instance, lastFrame } = renderApp({ columns: 80, rows: 20 });

    await flushRender(instance);

    expect(lastFrame()).toContain("Braintrust Wizard");
    expect(lastFrame()).toContain(
      "Do you already have a Braintrust account? Y/n",
    );
    expect(lastFrame()).toContain("braintrust.dev");
    expectFrameToFit(lastFrame(), 80, 20);
  });

  it("records that the user has a Braintrust account", async () => {
    const { instance, lastFrame, stdin } = renderApp();

    await act(async () => {
      stdin.write("y");
      await flushRender(instance);
    });

    expect(lastFrame()).toContain("Account status: Yes");
  });

  it("records that the user does not have a Braintrust account", async () => {
    const { instance, lastFrame, stdin } = renderApp();

    await act(async () => {
      stdin.write("n");
      await flushRender(instance);
    });

    expect(lastFrame()).toContain("Account status: No");
  });

  it("renders a compact fallback in a small terminal", async () => {
    const { instance, lastFrame } = renderApp({ columns: 36, rows: 6 });

    await flushRender(instance);

    expect(lastFrame()).toContain("Braintrust Wizard");
    expect(lastFrame()).toContain("Resize terminal to continue.");
    expect(lastFrame()).toContain("36x6");
    expect(lastFrame()).not.toContain("Do you already have");
    expectFrameToFit(lastFrame(), 36, 6);
  });

  it("reacts when the terminal shrinks", async () => {
    const { instance, lastFrame, stdout } = renderApp({
      columns: 80,
      rows: 20,
    });

    await flushRender(instance);

    expect(lastFrame()).toContain("Do you already have");

    await resizeTerminal({ instance, stdout, columns: 36, rows: 6 });

    expect(lastFrame()).toContain("Resize terminal to continue.");
    expect(lastFrame()).not.toContain("Do you already have");
    expectFrameToFit(lastFrame(), 36, 6);
  });

  it("reacts when the terminal grows again", async () => {
    const { instance, lastFrame, stdout } = renderApp({
      columns: 36,
      rows: 6,
    });

    await flushRender(instance);

    expect(lastFrame()).toContain("Resize terminal to continue.");

    await resizeTerminal({ instance, stdout, columns: 80, rows: 20 });

    expect(lastFrame()).toContain(
      "Do you already have a Braintrust account? Y/n",
    );
    expect(lastFrame()).toContain("braintrust.dev");
    expectFrameToFit(lastFrame(), 80, 20);
  });
});

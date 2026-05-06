import { EventEmitter } from "node:events";
import { stripVTControlCharacters } from "node:util";
import { render as inkRender, type Instance } from "ink";
import React, { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { App, easeLayoutTransitionProgress } from "../src/beau/App";
import { AppRoot } from "../src/beau/AppRoot";
import { ACCOUNT_QUESTION } from "../src/wizard-copy";

const STRIP_PATTERN = /[▌▐]/;
const LOGO_PATTERN = /[▀▄]/;
const LOGO_BODY_SPLIT_PATTERN = /[█▀▄]{3,} +[█▀▄]{3,}/;
const MIN_STRIP_MARKS_PER_LINE = 8;
const LOGIN_BROWSER_PROMPT_START = "For the rest of the flow";
const LOGIN_BROWSER_PROMPT_END = "open the browser?";

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
  rawModeEnabled = false;
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

  setRawMode(isEnabled: boolean) {
    this.rawModeEnabled = isEnabled;


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

function contentBounds(frame: string) {
  const lines = frameLines(frame);
  const firstLine = lines.findIndex((line) => line.trim().length > 0);
  let lastLine = -1;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if ((lines[index] ?? "").trim().length > 0) {
      lastLine = index;
      break;
    }
  }

  return { firstLine, lastLine, totalLines: lines.length };
}

function expectFrameToFit(frame: string, columns: number, rows: number) {
  const lines = frameLines(frame);

  expect(lines).toHaveLength(rows);
  expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(
    columns,
  );
}

function stripLineCount(frame: string) {
  return stripLines(frame).length;
}

function stripMarkCount(line: string) {
  return [...line].filter((character) => STRIP_PATTERN.test(character)).length;
}

function stripLines(frame: string) {
  return frameLines(frame).filter(
    (line) => stripMarkCount(line) >= MIN_STRIP_MARKS_PER_LINE,
  );
}

function signalStripStartLine(frame: string) {
  return frameLines(frame).findIndex(
    (line) => stripMarkCount(line) >= MIN_STRIP_MARKS_PER_LINE,
  );
}

function signalStripEndLine(frame: string) {
  return frameLines(frame).findLastIndex(
    (line) => stripMarkCount(line) >= MIN_STRIP_MARKS_PER_LINE,
  );
}

function questionLine(frame: string) {
  return (
    frameLines(frame).find((line) => line.includes("Braintrust account")) ?? ""
  );
}

function titleLine(frame: string) {
  return (
    frameLines(frame).find((line) => line.includes("Braintrust Setup")) ?? ""
  );
}

function lastMatchIndex(value: string, pattern: RegExp) {
  let lastIndex = -1;
  const globalPattern = new RegExp(pattern.source, `${pattern.flags}g`);

  for (const match of value.matchAll(globalPattern)) {
    lastIndex = match.index;
  }

  return lastIndex;
}

function longestBlankRun(line: string) {
  return Math.max(
    ...line.split(STRIP_PATTERN).map((segment) => segment.length),
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

async function waitForLayoutTransition(instance: Instance) {
  for (let tick = 0; tick < 16; tick += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    await act(async () => {
      await flushRender(instance);
    });
  }
}

function expectLoginPrompt(frame: string) {
  expect(frame).toContain(LOGIN_BROWSER_PROMPT_START);
  expect(frame).toContain(LOGIN_BROWSER_PROMPT_END);
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
  it("eases the session layout transition out", () => {
    expect(easeLayoutTransitionProgress(0)).toBe(0);
    expect(easeLayoutTransitionProgress(0.25)).toBeGreaterThan(0.25);
    expect(easeLayoutTransitionProgress(0.75)).toBeGreaterThan(0.75);
    expect(easeLayoutTransitionProgress(1)).toBe(1);
  });


  it("renders the landing page with logo, account question, and strips", async () => {
    const { instance, lastFrame } = renderApp({ columns: 100, rows: 24 });

    await flushRender(instance);

    expect(lastFrame()).toContain("Braintrust Setup");
    expect(lastFrame()).toContain("Welcome to the Braintrust setup wizard.");
    expect(lastFrame()).toContain(ACCOUNT_QUESTION);
    expect(lastFrame()).toContain("● Yes ○ No");
    expect(questionLine(lastFrame())).toContain("● Yes ○ No");
    expect(lastFrame()).toMatch(LOGO_PATTERN);
    expect(lastFrame()).toMatch(LOGO_BODY_SPLIT_PATTERN);
    expect(lastFrame()).toMatch(STRIP_PATTERN);
    expectFrameToFit(lastFrame(), 100, 24);
  });

  it("animates the signal strips during the brand fade-in", async () => {
    const { instance, lastFrame } = renderApp({ columns: 100, rows: 24 });

    await flushRender(instance);

    const initialStrips = stripLines(lastFrame()).join("\n");

    await new Promise((resolve) => {
      setTimeout(resolve, 120);
    });
    await act(async () => {
      await flushRender(instance);
    });

    expect(stripLines(lastFrame()).join("\n")).not.toBe(initialStrips);
    expectFrameToFit(lastFrame(), 100, 24);
  });


  it("vertically centers the landing page content", async () => {
    const { instance, lastFrame } = renderApp({ columns: 100, rows: 24 });

    await flushRender(instance);

    const { firstLine, lastLine, totalLines } = contentBounds(lastFrame());
    const topSpace = firstLine;
    const bottomSpace = totalLines - lastLine - 1;

    expect(topSpace).toBeGreaterThan(0);
    expect(Math.abs(topSpace - bottomSpace)).toBeLessThanOrEqual(1);
    expectFrameToFit(lastFrame(), 100, 24);
  });

  it("centers the header container on wide terminals", async () => {
    const { instance, lastFrame } = renderApp({ columns: 120, rows: 24 });

    await flushRender(instance);

    const line = questionLine(lastFrame());
    const leftMargin = line.search(/\S/);
    const rightMargin = 120 - line.trimEnd().length;

    expect(leftMargin).toBeGreaterThanOrEqual(16);
    expect(rightMargin).toBeGreaterThanOrEqual(14);
    expectFrameToFit(lastFrame(), 120, 24);
  });

  it("keeps the prompt close to the logo inside the header", async () => {
    const { instance, lastFrame } = renderApp({ columns: 100, rows: 24 });

    await flushRender(instance);

    const line = titleLine(lastFrame());
    const titleStart = line.indexOf("Braintrust Setup");
    const logoEnd = lastMatchIndex(line.slice(0, titleStart), LOGO_PATTERN) + 1;

    expect(titleStart - logoEnd).toBeLessThanOrEqual(9);
    expectFrameToFit(lastFrame(), 100, 24);
  });

  it("leaves breathing room between the header and signal strips", async () => {
    const { instance, lastFrame } = renderApp({ columns: 100, rows: 24 });

    await flushRender(instance);

    const logoEndLine =
      frameLines(lastFrame()).findLastIndex((line) => LOGO_PATTERN.test(line)) +
      1;
    const firstStripLine = signalStripStartLine(lastFrame());

    expect(firstStripLine - logoEndLine).toBeGreaterThanOrEqual(4);
    expectFrameToFit(lastFrame(), 100, 24);
  });

  it("accepts y as a direct yes answer and advances to the login prompt", async () => {
    const { instance, lastFrame, stdin } = renderApp();

    await act(async () => {
      stdin.write("y");
      await flushRender(instance);
    });

    expectLoginPrompt(lastFrame());
    expect(lastFrame()).toContain(ACCOUNT_QUESTION);
    expect(lastFrame()).toContain("answer Yes");
  });

  it("accepts n as a direct no answer and advances to the login prompt", async () => {
    const { instance, lastFrame, stdin } = renderApp();

    await act(async () => {
      stdin.write("n");
      await flushRender(instance);
    });

    expectLoginPrompt(lastFrame());
    expect(lastFrame()).toContain(ACCOUNT_QUESTION);
    expect(lastFrame()).toContain("answer No");
  });

  it("selects no with the right arrow and confirms with enter", async () => {
    const { instance, lastFrame, stdin } = renderApp();

    await flushRender(instance);

    expect(lastFrame()).toContain("● Yes ○ No");

    await act(async () => {
      stdin.write("\u001B[C");
      await flushRender(instance);
    });

    expect(lastFrame()).toContain("○ Yes ● No");

    await act(async () => {
      stdin.write("\r");
      await flushRender(instance);
    });

    expectLoginPrompt(lastFrame());
  });

  it("moves the strips near the bottom after the account prompt is answered", async () => {
    const { instance, lastFrame, stdin } = renderApp({
      columns: 100,
      rows: 40,
    });

    await flushRender(instance);

    const initialStripStartLine = signalStripStartLine(lastFrame());

    await act(async () => {
      stdin.write("y");
      await flushRender(instance);
    });
    await waitForLayoutTransition(instance);

    const settledStripStartLine = signalStripStartLine(lastFrame());
    const settledStripEndLine = signalStripEndLine(lastFrame());
    const bottomGapLines = frameLines(lastFrame()).slice(
      settledStripEndLine + 1,
    );

    expect(settledStripStartLine).toBeGreaterThan(initialStripStartLine);
    expect(settledStripStartLine).toBe(28);
    expect(settledStripEndLine).toBe(35);
    expect(bottomGapLines.every((line) => line.trim().length === 0)).toBe(true);
    expect(bottomGapLines).toHaveLength(4);
    expectFrameToFit(lastFrame(), 100, 40);
  });

  it("moves the logo out and lets the wizard copy take its position", async () => {
    const { instance, lastFrame, stdin } = renderApp({
      columns: 100,
      rows: 24,
    });

    await flushRender(instance);

    const initialTitleStart =
      titleLine(lastFrame()).indexOf("Braintrust Setup");

    await act(async () => {
      stdin.write("y");
      await flushRender(instance);
    });
    await waitForLayoutTransition(instance);

    const settledTitleStart =
      titleLine(lastFrame()).indexOf("Braintrust Setup");
    const settledPromptLine =
      frameLines(lastFrame()).find((line) =>
        line.includes(LOGIN_BROWSER_PROMPT_START),
      ) ?? "";

    expect(lastFrame()).not.toMatch(LOGO_PATTERN);
    expect(settledTitleStart).toBeLessThan(initialTitleStart - 8);
    expect(settledPromptLine.trimEnd().length).toBeGreaterThan(80);
    expectFrameToFit(lastFrame(), 100, 24);
  });

  it("renders a compact fallback in a small terminal", async () => {
    const { instance, lastFrame, stdin } = renderApp({ columns: 36, rows: 6 });

    await flushRender(instance);

    expect(lastFrame()).toContain("Resize terminal to continue.");
    expect(lastFrame()).toContain("36x6");
    expect(lastFrame()).not.toContain("Do you already have");
    expect(stdin.rawModeEnabled).toBe(true);
    expectFrameToFit(lastFrame(), 36, 6);
  });

  it("hides the logo when there is not enough horizontal space", async () => {
    const { instance, lastFrame } = renderApp({ columns: 60, rows: 24 });

    await flushRender(instance);

    expect(lastFrame()).toContain("Braintrust Setup");
    expect(lastFrame()).toContain(ACCOUNT_QUESTION);
    expect(lastFrame()).not.toMatch(LOGO_PATTERN);
    expectFrameToFit(lastFrame(), 60, 24);
  });

  it("hides the strip animation when there is not enough vertical space", async () => {
    const { instance, lastFrame } = renderApp({ columns: 100, rows: 12 });

    await flushRender(instance);

    expect(lastFrame()).toContain(ACCOUNT_QUESTION);
    expect(stripLines(lastFrame())).toHaveLength(0);
    expectFrameToFit(lastFrame(), 100, 12);
  });

  it("caps the strip animation at eight terminal rows", async () => {
    const { instance, lastFrame } = renderApp({ columns: 100, rows: 40 });

    await flushRender(instance);

    expect(stripLineCount(lastFrame())).toBe(8);
    expectFrameToFit(lastFrame(), 100, 40);
  });

  it("keeps the first and last two strip rows sparse", async () => {
    const { instance, lastFrame } = renderApp({ columns: 120, rows: 40 });

    await flushRender(instance);

    const stripCounts = stripLines(lastFrame()).map(stripMarkCount);
    const edgeCounts = [
      stripCounts[0] ?? 0,
      stripCounts[6] ?? 0,
      stripCounts[7] ?? 0,
    ];
    const middleCounts = stripCounts.slice(1, 6);

    expect(stripCounts).toHaveLength(8);
    expect(Math.max(...edgeCounts)).toBeLessThan(Math.min(...middleCounts));
    expectFrameToFit(lastFrame(), 120, 40);
  });

  it("gives most middle strip rows larger missing blocks", async () => {
    const { instance, lastFrame } = renderApp({ columns: 140, rows: 40 });

    await flushRender(instance);

    const identityRows = stripLines(lastFrame()).slice(1, 5);
    const blankRuns = identityRows.map(longestBlankRun);
    const blockGapRuns = [
      blankRuns[0] ?? 0,
      blankRuns[1] ?? 0,
      blankRuns[3] ?? 0,
    ];
    const gaplessRun = blankRuns[2] ?? Infinity;

    expect(identityRows).toHaveLength(4);
    expect(Math.min(...blockGapRuns)).toBeGreaterThanOrEqual(8);
    expect(gaplessRun).toBeLessThan(8);
    expect(new Set(blankRuns).size).toBeGreaterThan(1);
    expectFrameToFit(lastFrame(), 140, 40);
  });

  it("reacts when the terminal shrinks", async () => {
    const { instance, lastFrame, stdin, stdout } = renderApp({
      columns: 100,
      rows: 24,
    });

    await flushRender(instance);

    expect(lastFrame()).toContain("Do you already have");
    expect(lastFrame()).toMatch(STRIP_PATTERN);
    expect(stdin.rawModeEnabled).toBe(true);

    await resizeTerminal({ instance, stdout, columns: 36, rows: 6 });

    expect(lastFrame()).toContain("Resize terminal to continue.");
    expect(lastFrame()).not.toContain("Do you already have");
    expect(stdin.rawModeEnabled).toBe(true);
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

    expect(lastFrame()).toContain(ACCOUNT_QUESTION);
    expect(lastFrame()).toMatch(LOGO_PATTERN);
    expect(lastFrame()).toMatch(STRIP_PATTERN);
    expectFrameToFit(lastFrame(), 80, 20);
  });
});

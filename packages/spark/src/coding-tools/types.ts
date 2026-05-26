export type CodingToolId = "claude" | "codex";

export type CodingToolStatus = {
  readonly id: CodingToolId;
  readonly label: string;
  readonly command: string;
  readonly installed: boolean;
  readonly usable: boolean;
  readonly unavailableReason?: string | undefined;
  readonly version?: string | undefined;
  readonly authMode?: string | undefined;
};

type CodingToolEventBase = {
  readonly message: string;
  readonly toolInput?: string | undefined;
  readonly toolName?: string | undefined;
};

export type CodingToolEvent =
  | (CodingToolEventBase & {
      readonly type: "thinking";
    })
  | (CodingToolEventBase & {
      readonly type: "reading" | "editing" | "running";
      readonly target?: string | undefined;
    })
  | (CodingToolEventBase & {
      readonly type: "completed" | "failed";
    });

export type CodingToolRunResult = {
  readonly exitCode: number;
  readonly signal: NodeJS.Signals | null;
  readonly finalText: string;
};

export type CommandSpec = {
  readonly command: string;
  readonly args: readonly string[];
  readonly stdin: string;
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv | undefined;
};

export type Adapter = {
  readonly id: CodingToolId;
  readonly label: string;
  readonly command: string;
  readonly status: (commandPath: string) => Promise<CodingToolStatus>;
  readonly smokeCommand: (args: {
    readonly commandPath: string;
    readonly cwd: string;
    readonly prompt: string;
  }) => CommandSpec;
  readonly runCommand: (args: {
    readonly commandPath: string;
    readonly cwd: string;
    readonly prompt: string;
    readonly env: NodeJS.ProcessEnv;
  }) => CommandSpec;
  readonly parseEvents: (
    value: unknown,
    cwd: string,
  ) => readonly CodingToolEvent[];
  readonly parseFinalText: (value: unknown) => string | undefined;
};

export type CaptureResult = {
  readonly exitCode: number;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
};

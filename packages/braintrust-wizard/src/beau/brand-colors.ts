export const BRAINTRUST_LOGO_BLUE = "#2c1feb";
export const BRAINTRUST_PROMPT_BLUE = "#6f67ff";
export const BRAINTRUST_FADE_START_BLUE = "#dedbff";
export const BRAINTRUST_FADE_TICKS = 18;
export const BRAINTRUST_FADE_TICK_MS = 80;

function easeOutCubic(value: number) {
  return 1 - (1 - value) ** 3;
}

function interpolateChannel(start: number, end: number, progress: number) {
  return Math.round(start + (end - start) * progress);
}

function parseHexChannel(color: string, offset: number) {
  return Number.parseInt(color.slice(offset, offset + 2), 16);
}

function colorAtFadeTick(tick: number, targetColor: string) {
  const progress = easeOutCubic(Math.min(1, tick / BRAINTRUST_FADE_TICKS));
  const red = interpolateChannel(
    parseHexChannel(BRAINTRUST_FADE_START_BLUE, 1),
    parseHexChannel(targetColor, 1),
    progress,
  );
  const green = interpolateChannel(
    parseHexChannel(BRAINTRUST_FADE_START_BLUE, 3),
    parseHexChannel(targetColor, 3),
    progress,
  );
  const blue = interpolateChannel(
    parseHexChannel(BRAINTRUST_FADE_START_BLUE, 5),
    parseHexChannel(targetColor, 5),
    progress,
  );

  return `#${red.toString(16).padStart(2, "0")}${green
    .toString(16)
    .padStart(2, "0")}${blue.toString(16).padStart(2, "0")}`;
}

export function braintrustBlueAtFadeTick(tick: number) {
  return colorAtFadeTick(tick, BRAINTRUST_LOGO_BLUE);
}

export function braintrustPromptBlueAtFadeTick(tick: number) {
  return colorAtFadeTick(tick, BRAINTRUST_PROMPT_BLUE);
}

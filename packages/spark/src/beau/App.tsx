import { useQueryClient } from "@tanstack/react-query";
import { Box, Text, useInput, useWindowSize } from "ink";
import { useEffect, useState, type ReactNode } from "react";

import { BrandLogo, brandLogoHeight, brandLogoWidth } from "./brand-logo";
import {
  BRAINTRUST_FADE_TICK_MS,
  BRAINTRUST_FADE_TICKS,
  braintrustBlueAtFadeTick,
  braintrustPromptBlueAtFadeTick,
} from "./brand-colors";
import { SignalStrips } from "./SignalStrips";
import { useTuiDispatch, useTuiState } from "./tui-state";

const MIN_TERMINAL_HEIGHT = 8;
const MIN_TERMINAL_WIDTH = 48;
const LOGO_MIN_WIDTH = 78;
const STRIPS_MIN_HEIGHT = 16;
const HEADER_MAX_WIDTH = 88;
const HEADER_GAP_WIDTH = 2;
const MAX_STRIP_ROWS = 8;
const PROMPT_MAX_WIDTH = 64;
const STRIPS_TOP_MARGIN = 4;
const SESSION_STRIP_BOTTOM_GAP = 4;
const HEADER_CONTENT_HEIGHT = 9;
const LAYOUT_TRANSITION_TICKS = 12;
const LAYOUT_TRANSITION_TICK_MS = 45;
const WIZARD_TITLE = "Braintrust Setup";
const WIZARD_DESCRIPTION =
  "Welcome to the Braintrust setup wizard. This wizard will guide you through setting up Braintrust in your project.";
const ACCOUNT_QUESTION = "Do you already have a Braintrust account?";
const LOGIN_BROWSER_PROMPT =
  "For the rest of the flow, we require you to be logged in, do you want to open the browser?";

type YesNoSelectorProps = {
  readonly color: string;
  readonly onConfirm: (value: boolean) => void;
};

type SelectorOptionProps = {
  readonly color: string;
  readonly isSelected: boolean;
  readonly label: string;
};

type TranscriptLineProps = {
  readonly children?: ReactNode;
  readonly color: string;
  readonly marker?: string;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function interpolate(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

export function easeLayoutTransitionProgress(progress: number) {
  const clampedProgress = clamp(progress, 0, 1);

  return 1 - (1 - clampedProgress) ** 3;
}

function Spacer({ height }: { readonly height: number }) {
  if (height <= 0) {
    return null;
  }

  return <Box height={height} />;
}

function SelectorOption({ color, isSelected, label }: SelectorOptionProps) {
  if (isSelected) {
    return (
      <Text bold color={color}>
        ● {label}
      </Text>
    );
  }

  return <Text>○ {label}</Text>;
}

function YesNoSelector({ color, onConfirm }: YesNoSelectorProps) {
  const [selectedValue, setSelectedValue] = useState(true);

  useInput((input, key) => {
    const normalizedInput = input.toLowerCase();

    if (normalizedInput === "y") {
      onConfirm(true);
      return;
    }

    if (normalizedInput === "n") {
      onConfirm(false);
      return;
    }

    if (key.leftArrow || key.upArrow) {
      setSelectedValue(true);
      return;
    }

    if (key.rightArrow || key.downArrow) {
      setSelectedValue(false);
      return;
    }

    if (key.return) {
      onConfirm(selectedValue);
    }
  });

  return (
    <Box>
      <SelectorOption color={color} isSelected={selectedValue} label="Yes" />
      <Text> </Text>
      <SelectorOption color={color} isSelected={!selectedValue} label="No" />
    </Box>
  );
}

function TranscriptLine({ children, color, marker }: TranscriptLineProps) {
  const prefix =
    marker === undefined
      ? children === undefined
        ? "│"
        : "│ "
      : `│ ${marker} `;

  return (
    <Box>
      <Text color={color}>{prefix}</Text>
      {children}
    </Box>
  );
}

function keepTuiInputAlive() {}

export function App() {
  useQueryClient();
  useInput(keepTuiInputAlive);

  const { columns, rows } = useWindowSize();
  const { hasBraintrustAccount, step } = useTuiState();
  const dispatch = useTuiDispatch();
  const [brandFadeTick, setBrandFadeTick] = useState(0);
  const [layoutTransitionTick, setLayoutTransitionTick] = useState(0);
  const isTerminalTooSmall =
    rows < MIN_TERMINAL_HEIGHT || columns < MIN_TERMINAL_WIDTH;
  const isTransitioningToSession = hasBraintrustAccount !== null;
  const linearTransitionProgress = isTransitioningToSession
    ? layoutTransitionTick / LAYOUT_TRANSITION_TICKS
    : 0;
  const transitionProgress = easeLayoutTransitionProgress(
    linearTransitionProgress,
  );
  const shouldRenderLogoBase = columns >= LOGO_MIN_WIDTH && rows >= 11;
  const shouldRenderStrips =
    !isTerminalTooSmall &&
    rows >= STRIPS_MIN_HEIGHT &&
    columns >= MIN_TERMINAL_WIDTH;
  const stripRows = Math.min(MAX_STRIP_ROWS, Math.max(0, rows - 12));
  const contentPaddingX = columns >= 64 ? 2 : 1;
  const landingHeaderWidth = Math.min(
    columns - contentPaddingX * 2,
    HEADER_MAX_WIDTH,
  );
  const headerWidth = shouldRenderLogoBase
    ? landingHeaderWidth
    : Math.min(columns - contentPaddingX * 2, PROMPT_MAX_WIDTH);
  const headerMarginLeft = Math.floor((columns - headerWidth) / 2);
  const logoCropColumns = shouldRenderLogoBase
    ? clamp(Math.round(brandLogoWidth * transitionProgress), 0, brandLogoWidth)
    : brandLogoWidth;
  const shouldRenderLogo =
    shouldRenderLogoBase && logoCropColumns < brandLogoWidth;
  const logoPlaceholderWidth = shouldRenderLogoBase
    ? brandLogoWidth - logoCropColumns
    : 0;
  const promptMarginLeft = shouldRenderLogoBase
    ? Math.round(HEADER_GAP_WIDTH * (1 - transitionProgress))
    : 0;
  const promptMaxWidth = shouldRenderLogoBase
    ? Math.round(interpolate(PROMPT_MAX_WIDTH, headerWidth, transitionProgress))
    : PROMPT_MAX_WIDTH;
  const promptWidth = Math.min(
    promptMaxWidth,
    Math.max(20, headerWidth - logoPlaceholderWidth - promptMarginLeft),
  );
  const headerHeight = Math.max(
    shouldRenderLogoBase ? brandLogoHeight : 0,
    HEADER_CONTENT_HEIGHT,
  );
  const stripHeight = shouldRenderStrips ? stripRows : 0;
  const landingContentHeight =
    headerHeight + (shouldRenderStrips ? STRIPS_TOP_MARGIN + stripHeight : 0);
  const landingHeaderTop = clamp(
    Math.floor((rows - landingContentHeight) / 2),
    0,
    Math.max(0, rows - headerHeight),
  );
  const sessionStripTop = shouldRenderStrips
    ? Math.max(0, rows - stripHeight - SESSION_STRIP_BOTTOM_GAP)
    : rows;
  const sessionHeaderTop = clamp(
    Math.floor((sessionStripTop - headerHeight) / 2),
    0,
    Math.max(0, sessionStripTop - headerHeight),
  );
  const headerTop = Math.round(
    interpolate(landingHeaderTop, sessionHeaderTop, transitionProgress),
  );
  const landingStripTop = shouldRenderStrips
    ? Math.min(
        rows - stripHeight,
        landingHeaderTop + headerHeight + STRIPS_TOP_MARGIN,
      )
    : rows;
  const stripTop = Math.round(
    interpolate(landingStripTop, sessionStripTop, transitionProgress),
  );
  const postHeaderSpacerHeight = shouldRenderStrips
    ? Math.max(0, stripTop - headerTop - headerHeight)
    : Math.max(0, rows - headerTop - headerHeight);
  const brandColor = braintrustBlueAtFadeTick(brandFadeTick);
  const promptColor = braintrustPromptBlueAtFadeTick(brandFadeTick);

  useEffect(() => {
    if (brandFadeTick >= BRAINTRUST_FADE_TICKS) {
      return;
    }

    const timeout = setTimeout(() => {
      setBrandFadeTick((currentTick) =>
        Math.min(BRAINTRUST_FADE_TICKS, currentTick + 1),
      );
    }, BRAINTRUST_FADE_TICK_MS);

    return () => {
      clearTimeout(timeout);
    };
  }, [brandFadeTick]);

  useEffect(() => {
    if (hasBraintrustAccount === null) {
      return;
    }

    if (layoutTransitionTick >= LAYOUT_TRANSITION_TICKS) {
      return;
    }

    const timeout = setTimeout(() => {
      setLayoutTransitionTick((currentTick) =>
        Math.min(LAYOUT_TRANSITION_TICKS, currentTick + 1),
      );
    }, LAYOUT_TRANSITION_TICK_MS);

    return () => {
      clearTimeout(timeout);
    };
  }, [hasBraintrustAccount, layoutTransitionTick]);

  return (
    <Box flexDirection="column" height={rows} width={columns}>
      {isTerminalTooSmall ? (
        <Box flexDirection="column" paddingX={contentPaddingX}>
          <Text>Resize terminal to continue.</Text>
          <Text>{`${columns}x${rows}`}</Text>
        </Box>
      ) : (
        <Box flexDirection="column" width="100%">
          <Spacer height={headerTop} />

          <Box
            height={headerHeight}
            justifyContent="flex-start"
            marginLeft={headerMarginLeft}
            width={headerWidth}
          >
            <Box width={logoPlaceholderWidth}>
              {shouldRenderLogo && (
                <BrandLogo
                  color={brandColor}
                  cropLeftColumns={logoCropColumns}
                />
              )}
            </Box>

            <Box
              flexDirection="column"
              marginLeft={promptMarginLeft}
              width={promptWidth}
            >
              <Box>
                <Text color={promptColor}>▌ </Text>
                <Text bold color={promptColor}>
                  {WIZARD_TITLE}
                </Text>
              </Box>

              <Box marginTop={1}>
                <Text dimColor>{WIZARD_DESCRIPTION}</Text>
              </Box>

              <Box flexDirection="column" marginTop={1}>
                {hasBraintrustAccount !== null && (
                  <>
                    <TranscriptLine color={promptColor} marker="01">
                      <Text>{ACCOUNT_QUESTION}</Text>
                    </TranscriptLine>
                    <TranscriptLine color={promptColor}>
                      <Text dimColor>answer </Text>
                      <Text color={promptColor}>
                        {hasBraintrustAccount ? "Yes" : "No"}
                      </Text>
                    </TranscriptLine>
                    <TranscriptLine color={promptColor} />
                  </>
                )}

                <TranscriptLine
                  color={promptColor}
                  marker={step === "account-question" ? "01" : "02"}
                >
                  <Text>
                    {step === "account-question"
                      ? ACCOUNT_QUESTION
                      : LOGIN_BROWSER_PROMPT}
                  </Text>
                  {step === "account-question" && (
                    <>
                      <Text> </Text>
                      <YesNoSelector
                        color={promptColor}
                        onConfirm={(value) => {
                          dispatch({
                            type: "set-has-braintrust-account",
                            value,
                          });
                        }}
                      />
                    </>
                  )}
                </TranscriptLine>
              </Box>
            </Box>
          </Box>

          <Spacer height={postHeaderSpacerHeight} />

          {shouldRenderStrips && (
            <Box>
              <SignalStrips
                columns={columns}
                color={brandColor}
                rows={stripRows}
              />
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

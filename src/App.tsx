import { ConfirmInput } from "@inkjs/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Box, Text, useWindowSize } from "ink";

import { useTuiDispatch, useTuiState } from "./tui-state";

const MIN_TERMINAL_HEIGHT = 8;
const MIN_TERMINAL_WIDTH = 48;

type BannerProps = {
  readonly children: string;
  readonly justifyContent?: "flex-start" | "center" | "flex-end";
  readonly width: number;
};

function Banner({
  children,
  justifyContent = "flex-start",
  width,
}: BannerProps) {
  return (
    <Box
      backgroundColor="blue"
      height={1}
      justifyContent={justifyContent}
      paddingX={1}
      width={width}
    >
      <Text bold color="white">
        {children}
      </Text>
    </Box>
  );
}

export function App() {
  useQueryClient();

  const { columns, rows } = useWindowSize();
  const { hasBraintrustAccount } = useTuiState();
  const dispatch = useTuiDispatch();
  const isTerminalTooSmall =
    rows < MIN_TERMINAL_HEIGHT || columns < MIN_TERMINAL_WIDTH;

  return (
    <Box flexDirection="column" height={rows} width={columns}>
      <Banner justifyContent="center" width={columns}>
        Braintrust Wizard
      </Banner>

      <Box
        flexDirection="column"
        flexGrow={1}
        justifyContent="center"
        paddingX={2}
      >
        {isTerminalTooSmall ? (
          <Text color="yellow">Resize terminal to continue.</Text>
        ) : (
          <>
            <Box>
              <Text>Do you already have a Braintrust account? </Text>
              <ConfirmInput
                defaultChoice="confirm"
                onCancel={() => {
                  dispatch({
                    type: "set-has-braintrust-account",
                    value: false,
                  });
                }}
                onConfirm={() => {
                  dispatch({
                    type: "set-has-braintrust-account",
                    value: true,
                  });
                }}
              />
            </Box>

            {hasBraintrustAccount !== null && (
              <Box marginTop={1}>
                <Text color="cyan">
                  Account status: {hasBraintrustAccount ? "Yes" : "No"}
                </Text>
              </Box>
            )}
          </>
        )}
      </Box>

      <Banner justifyContent="flex-end" width={columns}>
        {isTerminalTooSmall ? `${columns}x${rows}` : "braintrust.dev"}
      </Banner>
    </Box>
  );
}

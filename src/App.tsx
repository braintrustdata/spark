import { useQueryClient } from "@tanstack/react-query";
import { Box, Text, useApp, useInput } from "ink";
import { useState } from "react";

export function App() {
  useQueryClient();

  const [count, setCount] = useState(0);
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.return) {
      setCount((currentCount) => currentCount + 1);
    }

    if (input === "\u0003") {
      exit();
    }
  });

  return (
    <Box flexDirection="column">
      <Text>Enter presses: {count}</Text>
    </Box>
  );
}

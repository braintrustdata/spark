import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { createQueryClient } from "../query-client";
import { TuiStateProvider } from "./tui-state";

type AppRootProps = {
  readonly children: ReactNode;
};

export function AppRoot({ children }: AppRootProps) {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <TuiStateProvider>{children}</TuiStateProvider>
    </QueryClientProvider>
  );
}

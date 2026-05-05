import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "ink";
import React from "react";

import { App } from "./App";
import { createQueryClient } from "./query-client";

render(
  <QueryClientProvider client={createQueryClient()}>
    <App />
  </QueryClientProvider>,
);

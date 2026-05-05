import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "ink-testing-library";
import React, { act } from "react";
import { describe, expect, it } from "vitest";

import { App } from "../src/App";
import { createQueryClient } from "../src/query-client";

function renderApp() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <App />
    </QueryClientProvider>,
  );
}

describe("App", () => {
  it("renders the initial counter", () => {
    const { lastFrame } = renderApp();

    expect(lastFrame()).toContain("Enter presses: 0");
  });

  it("increments the counter when enter is pressed", async () => {
    const { lastFrame, stdin } = renderApp();

    await act(async () => {
      stdin.write("\r");
    });

    expect(lastFrame()).toContain("Enter presses: 1");
  });
});

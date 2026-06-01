import { render } from "ink";
import React from "react";

import { App } from "./App";
import { AppRoot } from "./AppRoot";

render(
  <AppRoot>
    <App />
  </AppRoot>,
  {
    alternateScreen: true,
    maxFps: 60,
  },
);

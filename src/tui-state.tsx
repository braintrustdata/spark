import { createContext, type ReactNode, useContext, useReducer } from "react";

type TuiState = {
  hasBraintrustAccount: boolean | null;
  step: "account-question" | "login-browser-question";
};

type TuiAction = {
  type: "set-has-braintrust-account";
  value: boolean;
};

const initialState: TuiState = {
  hasBraintrustAccount: null,
  step: "account-question",
};

const TuiStateContext = createContext<TuiState | undefined>(undefined);
const TuiDispatchContext = createContext<React.Dispatch<TuiAction> | undefined>(
  undefined,
);

function tuiReducer(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case "set-has-braintrust-account":
      return {
        ...state,
        hasBraintrustAccount: action.value,
        step: "login-browser-question",
      };
  }
}

type TuiStateProviderProps = {
  readonly children: ReactNode;
};

export function TuiStateProvider({ children }: TuiStateProviderProps) {
  const [state, dispatch] = useReducer(tuiReducer, initialState);

  return (
    <TuiStateContext.Provider value={state}>
      <TuiDispatchContext.Provider value={dispatch}>
        {children}
      </TuiDispatchContext.Provider>
    </TuiStateContext.Provider>
  );
}

export function useTuiState() {
  const state = useContext(TuiStateContext);

  if (state === undefined) {
    throw new Error("useTuiState must be used within TuiStateProvider");
  }

  return state;
}

export function useTuiDispatch() {
  const dispatch = useContext(TuiDispatchContext);

  if (dispatch === undefined) {
    throw new Error("useTuiDispatch must be used within TuiStateProvider");
  }

  return dispatch;
}

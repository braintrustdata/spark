import search from "@inquirer/search";

export type FuzzyChoice<T> = {
  readonly value: T;
  readonly name: string;
  readonly description?: string;
};

/**
 * Thin wrapper around @inquirer/search so callers don't have to know which
 * fuzzy library we use.
 */
export async function fuzzySelect<T>(args: {
  readonly message: string;
  readonly choices: ReadonlyArray<FuzzyChoice<T>>;
}): Promise<T> {
  if (args.choices.length === 0) {
    throw new Error("fuzzySelect called with no choices");
  }
  const value = await search<T>({
    message: args.message,
    source: (term) => {
      const q = (term ?? "").toLowerCase();
      const filtered =
        q.length === 0
          ? args.choices
          : args.choices.filter((c) => c.name.toLowerCase().includes(q));
      return filtered.map((c) => ({
        name: c.name,
        value: c.value,
        ...(c.description !== undefined ? { description: c.description } : {}),
      }));
    },
  });
  return value;
}

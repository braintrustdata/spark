import search from "@inquirer/search";
import Fuse from "fuse.js";

export type FuzzyChoice<T> = {
  readonly value: T;
  readonly name: string;
  readonly description?: string;
};

export async function fuzzySelect<T>(args: {
  readonly message: string;
  readonly choices: ReadonlyArray<FuzzyChoice<T>>;
}): Promise<T> {
  if (args.choices.length === 0) {
    throw new Error("fuzzySelect called with no choices");
  }
  const fuse = new Fuse(args.choices, { keys: ["name"], threshold: 0.4 });
  return search<T>({
    message: args.message,
    source: (term) => {
      const results = !term
        ? args.choices
        : fuse.search(term).map((r) => r.item);
      return results.map((c) => ({
        name: c.name,
        value: c.value,
        description: c.description,
      }));
    },
  });
}

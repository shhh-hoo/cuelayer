import { test as base, expect } from "@playwright/test";
export { expect };
export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      await use();
      expect(errors, "Unexpected browser errors").toEqual([]);
    },
    { auto: true },
  ],
});

/** Resolve authored fixture roles through accepted meaning, never fixed production IDs. */
export async function fixtureUnit(
  page: import("@playwright/test").Page,
  name: string,
) {
  const id = await page.evaluate(
    (name) =>
      Object.values(window.v2.session.state.units).find((u) =>
        name === "pressure"
          ? u.meaning.kind === "quantity" && Boolean(u.meaning.symbols.p_i)
          : name === "fraction"
            ? u.meaning.kind === "quantity" && Boolean(u.meaning.symbols.n_i)
            : name === "ammonia"
              ? u.meaning.kind === "reaction"
              : name === "sine"
                ? u.meaning.kind === "quantity" && Boolean(u.meaning.symbols.y)
                : u.meaning.kind === "annotation",
      )?.id,
    name,
  );
  if (!id) throw new Error(`Missing authored fixture unit: ${name}`);
  return page.locator(`[data-unit="${id}"]`);
}

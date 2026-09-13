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

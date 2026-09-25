import type { Skill } from "./index";

export const catalog: Skill = {
  name: "catalog",
  description: "Products",
  instructions: `
- Use search_products for anything about products; state only names, prices and stock it returns. No specs or opinions.
`.trim(),
};

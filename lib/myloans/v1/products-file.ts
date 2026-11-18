/**
 * D-049: myloans' product list (PR_PRODUCTS) as exported to a tab-separated file
 * (docs/incoming/myloans-round4-results/pr_products.tsv): the mock's API 5 data and the kit's product list.
 * Columns are found by their header name (several spellings accepted), so the export's column order does not matter.
 */
export interface ProductFileRow { productId: number; productCode: string; name: string; active: boolean }

export const PRODUCTS_FILE = "docs/incoming/myloans-round4-results/pr_products.tsv";

const ALIASES = {
  productId: ["productid", "product_id", "id"],
  productCode: ["productcode", "product_code", "code"],
  name: ["name", "productname", "product_name", "description"],
  active: ["isactive", "is_active", "active", "status"],
} as const;

export function parseProductsTsv(text: string): { rows: ProductFileRow[]; problem: string | null } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return { rows: [], problem: "The product file is empty." };
  const head = lines[0].split("\t").map((h) => h.trim().toLowerCase().replace(/[\s"]/g, ""));
  const col = (k: keyof typeof ALIASES) => head.findIndex((h) => (ALIASES[k] as readonly string[]).includes(h));
  const at = { productId: col("productId"), productCode: col("productCode"), name: col("name"), active: col("active") };
  const missing = (["productId", "productCode", "name"] as const).filter((k) => at[k] < 0);
  if (missing.length) return { rows: [], problem: `The product file has no ${missing.join(", ")} column (headers: ${lines[0].split("\t").join(", ")}).` };
  const rows: ProductFileRow[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split("\t").map((x) => x.trim().replace(/^"(.*)"$/, "$1"));
    const id = Number(c[at.productId]);
    if (!Number.isInteger(id)) continue;
    const a = at.active >= 0 ? (c[at.active] ?? "").toLowerCase() : "1";
    rows.push({ productId: id, productCode: c[at.productCode] ?? "", name: c[at.name] ?? "", active: !["0", "false", "no", "inactive", "n"].includes(a) });
  }
  return { rows, problem: null };
}

import { describe, expect, it } from "vitest";
import { isActive } from "./nav";

describe("D-058: the menu's current item", () => {
  it("Home matches only itself; a loan file and Find a loan sit under Loans", () => {
    expect(isActive("/dashboard", "/dashboard")).toBe(true);
    expect(isActive("/dashboard/x", "/dashboard")).toBe(false);
    expect(isActive("/loans/GD1012026901001", "/loans")).toBe(true);
    expect(isActive("/search", "/loans")).toBe(true);
    expect(isActive("/admin/settings/roles", "/admin/settings")).toBe(true);
    expect(isActive("/inboxes", "/inbox")).toBe(false);
  });
});

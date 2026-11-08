import { describe, expect, it } from "vitest";
import { computeStage, type TxnStatus } from "./stage";

const t = (status: TxnStatus, requiresDp = true) => ({ status, requiresDp });

describe("computeStage", () => {
  it("no transactions -> Opened", () => {
    expect(computeStage({ transactions: [] })).toBe("Opened");
  });
  it("new transactions -> For checklist", () => {
    expect(computeStage({ transactions: [t("FOR_CHECKLIST"), t("FOR_CHECKLIST", false)] })).toBe("For checklist");
  });
  it("all LA-only -> No DP assignment required", () => {
    expect(computeStage({ transactions: [t("READY", false)] })).toBe("No DP assignment required");
  });
  it("earliest step wins: one assigned, one still with LA -> For checklist", () => {
    expect(computeStage({ transactions: [t("ASSIGNED"), t("READY")] })).toBe("For checklist");
  });
  it("EDST done, DP txns assigned -> Assigned to DP", () => {
    expect(computeStage({ transactions: [t("ASSIGNED"), t("COMPLETED", false)] })).toBe("Assigned to DP");
  });
  it("steps backwards when a DP declines (RETURNED)", () => {
    expect(computeStage({ transactions: [t("IN_PROCESS"), t("RETURNED")] })).toBe("For checklist");
  });
  it("accepted -> In process; forwarded -> Awaiting LA acceptance", () => {
    expect(computeStage({ transactions: [t("IN_PROCESS"), t("FORWARDED")] })).toBe("In process");
    expect(computeStage({ transactions: [t("FORWARDED"), t("COMPLETED", false)] })).toBe("Awaiting LA acceptance");
  });
  it("all complete but cash advance not liquidated -> In process", () => {
    expect(computeStage({ transactions: [t("COMPLETED")], fundsOpen: true })).toBe("In process");
  });
  it("all complete and CA liquidated -> For Vault Transmittal", () => {
    expect(computeStage({ transactions: [t("COMPLETED")], fundsOpen: false })).toBe("For Vault Transmittal");
  });
  it("cancelled transactions are ignored", () => {
    expect(computeStage({ transactions: [t("COMPLETED"), t("CANCELLED")] })).toBe("For Vault Transmittal");
  });
  it("vault stages from document items", () => {
    expect(computeStage({ transactions: [t("COMPLETED")], documentStages: ["IN_TRANSIT", "AT_BRANCH"] })).toBe("In transit to Vault");
    expect(computeStage({ transactions: [t("COMPLETED")], documentStages: ["IN_SAFEKEEPING"] })).toBe("In Safekeeping");
  });
  it("lifecycle dates win", () => {
    expect(computeStage({ transactions: [t("COMPLETED")], archivedAt: new Date() })).toBe("Archived");
  });
});

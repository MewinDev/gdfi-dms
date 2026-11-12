import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { STAGES, computeStage } from "./stage";
import { STAGE_MAP, STEPS, STEP_COUNT, journeyPhaseOf, listStage, nextStepFor, ownerTooltip, stageDef, stageLabel, stepName, stepperOf } from "./stage-map";

/** The business's table (docs/workflow/13-stages-and-next-steps.md), row by row: key, label, step, next, owner, status. */
const TABLE: [string, string, number | null, string, string | null, "live" | "planned"][] = [
  ["Opened", "Check documents", 3, "System sets up the transactions", null, "live"],
  ["For checklist", "Check documents", 3, "Check documents, then assign to DP", "Loan Associate", "live"],
  ["No DP assignment required", "Check documents (LA only)", 3, "Complete the LA-only transactions", "Loan Associate", "live"],
  ["Assigned to DP", "DP Assigning", 4, "DP accepts the assignment", "Document Processor / Collateral & Mortgage", "live"],
  ["In process", "LTO Processing", 4, "DP processes the transactions", "Document Processor / Collateral & Mortgage", "live"],
  ["LTO Done", "LTO Done", 4, "DP forwards the package to the LA branch", "Document Processor", "planned"],
  ["Awaiting LA acceptance", "Forwarding to LA branch", 5, "LA accepts the package", "Loan Associate (receiving branch)", "live"],
  ["For Vault Transmittal", "For transmittal", 6, "Create the transmittal", "Loan Associate", "live"],
  ["In transit to Vault", "Receiving", 6, "Collateral receives by scan", "Collateral", "live"],
  ["Pull out", "Pull out", null, "Pull out request in progress: an approver approves, then a custodian releases", "Approver / Collateral custodian", "planned"],
  ["Prior to safekeeping", "Prior to safekeeping", 7, "QA checks the package before safekeeping", "Quality Assurance", "planned"],
  ["Thorough Checking", "Thorough checking", 7, "QA does the thorough check", "Quality Assurance", "planned"],
  ["For NTC", "For NTC", 7, "LA complies with the Notice to Comply", "Loan Associate", "planned"],
  ["For NTE (Quality Assurance)", "For NTE", 7, "QA issues the Notice to Explain (the LA can view it)", "Quality Assurance", "planned"],
  ["For NOD", "For NOD", 7, "QA issues the Notice of Decision (the LA can view it)", "Quality Assurance", "planned"],
  ["Validation", "Digital validation", 8, "Digital Records validates the digital copy", "Digital Records", "planned"],
  ["For NTE (Digital Records)", "For NTE (Digital Records)", 8, "Digital Records issues the Notice to Explain (the LA can view it)", "Digital Records", "planned"],
  ["In Safekeeping", "In safekeeping", 9, "Kept in the vault until the loan is fully paid", "Collateral", "live"],
  ["Closed", "Closed", 10, "Records archives the file", "Records", "live"],
  ["Archiving", "Archiving", 10, "Archival & Warehousing uploads the scanned ARF", "Archival & Warehousing", "planned"],
  ["Warehousing", "Warehousing", 10, "Archival & Warehousing forwards the documents to the warehouse", "Archival & Warehousing", "planned"],
  ["Warehoused", "Warehoused", 10, "No further steps", null, "planned"],
  ["Cancelled in MyLoans", "Cancelled in MyLoans", null, "No further steps", null, "live"],
  ["Archived", "Archived", null, "Kept until the retention period ends", null, "live"],
  ["Disposed", "Disposed", null, "No further steps", null, "live"],
];

describe("stage map", () => {
  it("has the 10 step names, in order", () => {
    expect(STEP_COUNT).toBe(10);
    expect(STEPS.map((s) => s.name)).toEqual([
      "Loan opened", "Classified", "Check documents", "DP Processing", "LA Acceptance",
      "Collateral", "Quality Assurance", "Digital Records", "In Safekeeping", "Closure",
    ]);
    STEPS.forEach((s, i) => { expect(s.n).toBe(i + 1); expect(s.name.length).toBeGreaterThan(0); });
  });

  it("matches the business's table row by row", () => {
    expect(STAGE_MAP.map((d) => [d.key, d.label, d.step, d.next, d.owner, d.status])).toEqual(TABLE);
  });

  it("every stored stage has an entry, and every stored key is a real stage", () => {
    // STAGES is the real list of Loan.stage values (computeStage returns only these): a new one without an entry fails here.
    for (const s of STAGES) expect(STAGE_MAP.filter((d) => d.stored === s), s).toHaveLength(1);
    for (const d of STAGE_MAP) if (d.stored) expect(STAGES as readonly string[]).toContain(d.stored);
    for (const d of STAGE_MAP) if (d.status !== "planned") expect(d.stored, d.key).toBe(d.key);
    expect(new Set(STAGE_MAP.map((d) => d.key)).size).toBe(STAGE_MAP.length);
  });

  it("planned stages have no stored key, and no loan can be in one", () => {
    const planned = STAGE_MAP.filter((d) => d.status === "planned");
    expect(planned).toHaveLength(12);
    // Removed from the earlier draft: no Masterlist, no separate Receiving stage (it is In transit to Vault).
    for (const k of ["Masterlist", "Receiving"]) expect(STAGE_MAP.some((d) => d.key === k), k).toBe(false);
    for (const d of planned) {
      expect(d.stored, d.key).toBeNull();
      expect(STAGES as readonly string[]).not.toContain(d.key);
    }
    // computeStage only returns stored stages.
    const out = [
      computeStage({ transactions: [] }),
      computeStage({ transactions: [{ requiresDp: true, status: "COMPLETED" }], documentStages: ["IN_SAFEKEEPING"] }),
      computeStage({ transactions: [{ requiresDp: true, status: "FORWARDED" }] }),
    ];
    for (const s of out) expect(stageDef(s)?.status).not.toBe("planned");
  });

  it("steps 1 and 2 are never a stage's step", () => {
    for (const d of STAGE_MAP) if (d.step !== null) expect(d.step).toBeGreaterThanOrEqual(3);
  });

  it("renders every planned stage (phase 2 only adds transitions)", () => {
    expect(stepperOf("Thorough Checking")).toEqual({ current: 7, doneThrough: 6, word: null });
    expect(stepperOf("Warehoused")).toEqual({ current: 10, doneThrough: 9, word: null });
    expect(ownerTooltip(nextStepFor("Warehoused").owner)).toBeUndefined();
    expect(stepperOf("LTO Done")).toEqual({ current: 4, doneThrough: 3, word: null });
    expect(stepperOf("Warehousing")).toEqual({ current: 10, doneThrough: 9, word: null });
    expect(stepperOf("Archiving")).toEqual({ current: 10, doneThrough: 9, word: null });
    expect(stepperOf("Pull out")).toEqual({ current: null, doneThrough: 6, word: "Pull out" });
    expect(listStage("Validation")).toEqual({ step: 8, label: "Digital validation", grey: false });
    expect(nextStepFor("For NOD")).toEqual({ label: "QA issues the Notice of Decision (the LA can view it)", owner: "Quality Assurance" });
    expect(ownerTooltip(nextStepFor("For NTC").owner)).toBe("Waiting for: Loan Associate");
    expect(ownerTooltip(nextStepFor("Pull out").owner)).toBe("Waiting for: Approver / Collateral custodian");
  });

  it("the system gives no tooltip; a person's owner gives 'Waiting for: …'", () => {
    for (const s of ["Opened", "Cancelled in MyLoans", "Archived", "Disposed", "Warehoused"]) {
      expect(nextStepFor(s).owner, s).toBeNull();
      expect(ownerTooltip(nextStepFor(s).owner), s).toBeUndefined();
    }
    expect(ownerTooltip(nextStepFor("Assigned to DP").owner)).toBe("Waiting for: Document Processor / Collateral & Mortgage");
    // Closed keeps its text and owner from today: Records.
    expect(ownerTooltip(nextStepFor("Closed").owner)).toBe("Waiting for: Records");
    // No raw role key ever reaches the tooltip.
    for (const d of STAGE_MAP) expect(d.owner ?? "").not.toMatch(/^(SYS|LA|DP|VAULT|APPR|FIN|QA|DIG)$/);
  });

  it("In Safekeeping is a live stage under step 9, and with an open exception as before", () => {
    expect(stageDef("In Safekeeping")?.status).toBe("live");
    expect(stageLabel("In Safekeeping")).toBe("In safekeeping");
    expect(stepName(9)).toBe("In Safekeeping");
    expect(stepperOf("In Safekeeping")).toEqual({ current: 9, doneThrough: 8, word: null });
    expect(nextStepFor("In Safekeeping")).toEqual({ label: "Kept in the vault until the loan is fully paid", owner: "Collateral" });
    expect(nextStepFor("In Safekeeping", { hasOpenException: true })).toEqual({ label: "Resolve open exceptions", owner: "Collateral" });
    // Only In Safekeeping changes with an open exception.
    for (const s of STAGES) if (s !== "In Safekeeping") expect(nextStepFor(s, { hasOpenException: true })).toEqual(nextStepFor(s));
    // Every stored stage is live; only phase-2 stages are planned.
    for (const d of STAGE_MAP) expect(d.status, d.key).toBe(d.stored ? "live" : "planned");
  });

  it("Archiving, Warehousing and Warehoused are planned under step 10, after Closed", () => {
    const keys = STAGE_MAP.map((d) => d.key);
    for (const k of ["Archiving", "Warehousing", "Warehoused"]) {
      expect(stageDef(k)?.status, k).toBe("planned");
      expect(stageDef(k)?.step, k).toBe(10);
      expect(keys.indexOf(k), k).toBeGreaterThan(keys.indexOf("Closed"));
    }
    expect(STEPS.map((s) => s.name)).not.toContain("Archival & Warehousing");
    // The notices in order: NTC, then NTE, then NOD.
    expect(keys.indexOf("For NTC")).toBeLessThan(keys.indexOf("For NTE (Quality Assurance)"));
    expect(keys.indexOf("For NTE (Quality Assurance)")).toBeLessThan(keys.indexOf("For NOD"));
  });

  it("the stepper for each live stage", () => {
    const want: Record<string, [number | null, number, string | null]> = {
      Opened: [3, 2, null], "For checklist": [3, 2, null], "No DP assignment required": [3, 2, null],
      "Assigned to DP": [4, 3, null], "In process": [4, 3, null], "Awaiting LA acceptance": [5, 4, null],
      "For Vault Transmittal": [6, 5, null], "In transit to Vault": [6, 5, null], "In Safekeeping": [9, 8, null], Closed: [10, 9, null],
      // No step: nothing highlighted, the word in grey (archived and disposed: every step done, as before).
      "Cancelled in MyLoans": [null, 2, "Cancelled in MyLoans"], Archived: [null, 10, "Archived"], Disposed: [null, 10, "Disposed"],
    };
    for (const s of STAGES) {
      const [current, doneThrough, word] = want[s];
      expect(stepperOf(s), s).toEqual({ current, doneThrough, word });
    }
  });

  it("the list stage: the label, grey for cancelled, archived and disposed", () => {
    for (const s of STAGES) {
      const l = listStage(s);
      expect(l.label).toBe(stageDef(s)!.label);
      expect(l.grey, s).toBe(["Cancelled in MyLoans", "Archived", "Disposed"].includes(s));
    }
  });

  it("the Journey phase of a stage stays as before", () => {
    const before: Record<string, number> = {
      Opened: 3, "For checklist": 3, "No DP assignment required": 3, "Assigned to DP": 4, "In process": 4, "Awaiting LA acceptance": 5,
      "For Vault Transmittal": 6, "In transit to Vault": 6, "In Safekeeping": 7, Closed: 10, "Cancelled in MyLoans": 3, Archived: 10, Disposed: 10,
    };
    for (const s of STAGES) expect(journeyPhaseOf(s), s).toBe(before[s]);
  });

  it("an unknown value shows as stored", () => {
    expect(stageLabel("Something old")).toBe("Something old");
    expect(nextStepFor("Something old")).toEqual({ label: "Something old", owner: null });
  });
});

// ---------------------------------------------------------------------------
// Guards over the source: the map is the one place
// ---------------------------------------------------------------------------

const ROOT = join(__dirname, "..", "..");
const MAP_FILE = "lib/workflow/stage-map.ts";

function sources(): { file: string; code: string }[] {
  const out: { file: string; code: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push({ file: relative(ROOT, p).replace(/\\/g, "/"), code: readFileSync(p, "utf8") });
    }
  };
  for (const d of ["app", "components", "lib"]) walk(join(ROOT, d));
  return out;
}

/** The code without comments (block, JSX and line comments), so only strings and code are checked. */
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

describe("stage map guards", () => {
  const files = sources();

  it("no other file defines stage labels, step names or next-step texts", () => {
    // Texts only the map may hold. Generic words that other things also use (Closed, Archived, Check documents,
    // Collateral, Quality Assurance, Digital Records, In safekeeping for a document, Receiving ...) are left out.
    const generic = new Set(["Check documents", "Closed", "Archived", "Disposed", "Cancelled in MyLoans", "Loan opened", "Classified", "Closure",
      "Collateral", "Quality Assurance", "Digital Records", "In Safekeeping", "Receiving", "Pull out", "Archiving", "Warehousing", "Warehoused", "Records archives the file", "For NTC", "For NTE", "For NOD", "In safekeeping",
      "No further steps"]);
    const own = new Set<string>([...STEPS.map((s) => s.name), ...STAGE_MAP.flatMap((d) => [d.label, d.next]), "Resolve open exceptions"].filter((t) => !generic.has(t)));
    const hits: string[] = [];
    for (const { file, code } of files) {
      if (file === MAP_FILE) continue;
      const c = stripComments(code);
      for (const t of own) if (c.includes(`"${t}"`) || c.includes(`'${t}'`) || c.includes(`>${t}<`)) hits.push(`${file}: ${t}`);
      // The old lists are gone for good.
      for (const id of ["STAGE_WORDS", "stageWords", "JOURNEY_STEPS", "JOURNEY_STEP_COUNT", "progressStep", "nextActionForStage", "NEUTRAL_STEP", "NO_STEP_STAGES"]) {
        if (new RegExp(`\\b${id}\\b`).test(c)) hits.push(`${file}: ${id}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("no old step name, 'Your acceptance' or 'Notice to Decision' in any visible string (no exception)", () => {
    const hits: string[] = [];
    for (const { file, code } of files) {
      const c = stripComments(code);
      for (const t of ["Your acceptance", "DigiCur", "Pull-out", "QA review", "Notice to Decision"]) if (c.includes(t)) hits.push(`${file}: ${t}`);
    }
    expect(hits).toEqual([]);
  });

  it("'Processing' and 'Vault' alone are never a step name: only these non-step uses remain", () => {
    // Each is not a loan-file step: the DP job's TAT chip, a Journey time-segment state, the Vault role's chip and name.
    const allowed: Record<string, string[]> = {
      Processing: ["components/jobs/chips.tsx", "lib/workflow/build-journey.ts"],
      Vault: ["lib/auth/permissions.ts", "lib/docs/permissions-doc.ts", "lib/kit/clean.ts"],
    };
    const hits: string[] = [];
    for (const { file, code } of files) {
      const c = stripComments(code);
      for (const t of Object.keys(allowed)) {
        if ((c.includes(`"${t}"`) || c.includes(`>${t}<`)) && !allowed[t].includes(file)) hits.push(`${file}: ${t}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("the guard sees the map itself (it is not empty)", () => {
    expect(files.some((f) => f.file === MAP_FILE)).toBe(true);
    expect(files.length).toBeGreaterThan(100);
  });
});

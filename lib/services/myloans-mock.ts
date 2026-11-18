import "server-only";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { refuseInProduction } from "@/lib/env";
import { getSetting, setSetting } from "@/lib/settings";
import { ENDPOINT_WORDS, FAILURE_WORDS, MOCK_ENDPOINTS, MOCK_FAILURES, type MockFailure } from "@/lib/myloans/v1/failures";
import { mockAllowed, resetMockData } from "@/lib/myloans/v1/mock-store";
import { addMockScenario, MOCK_SCENARIOS, type MockScenario } from "@/lib/myloans/v1/mock-scenarios";
import { UserError } from "./errors";

/**
 * Settings, System, "myloans mock" (piece 6, D-048): failure switches, scenarios and Reset the mock data. Needs
 * "Change system switches"; refused in production and while the mock is off; every change is audited.
 */
function need(u: CurrentUser) {
  if (!can(u, PERMISSIONS.SETTINGS_SYSTEM)) throw new UserError("Your role does not allow changing these switches.");
  refuseInProduction("The myloans mock");
  if (!mockAllowed()) throw new UserError("The myloans mock is off (MYLOANS_MODE is live).");
}
const audit = (u: CurrentUser, action: string, summary: string, after: unknown) =>
  writeAudit(prisma, { actor: { id: u.id, label: u.name }, mode: "MANUAL", action, entityType: "Setting", entityId: "myloans.mock", summary, after });

export async function addMockFailure(u: CurrentUser, raw: { endpoint: string; kind: string; once: boolean; page?: string }) {
  need(u);
  const endpoint = raw.endpoint === "all" || (MOCK_ENDPOINTS as readonly string[]).includes(raw.endpoint) ? (raw.endpoint as MockFailure["endpoint"]) : null;
  const kind = (MOCK_FAILURES as readonly string[]).includes(raw.kind) ? (raw.kind as MockFailure["kind"]) : null;
  if (!endpoint) throw new UserError("Pick which call fails.", "endpoint");
  if (!kind) throw new UserError("Pick how it fails.", "kind");
  const page = kind === "pageFails" ? Number(raw.page) : undefined;
  if (kind === "pageFails" && (!Number.isInteger(page) || page! < 1 || page! > 100)) throw new UserError("Enter the page that fails (1 to 100).", "page");
  if (kind === "pageFails" && endpoint !== "changes" && endpoint !== "pool") throw new UserError("Only API 2 and the pool mode have pages.", "endpoint");
  const f: MockFailure = { endpoint, kind, once: raw.once, ...(page ? { page } : {}), setBy: u.name, setAt: new Date().toISOString() };
  const list = await getSetting("myloans.mockFailures");
  await setSetting("myloans.mockFailures", [...list.filter((x) => !(x.endpoint === endpoint && x.kind === kind && x.page === f.page)), f]);
  const text = `${ENDPOINT_WORDS[endpoint]}: ${FAILURE_WORDS[kind]}${page ? ` (page ${page})` : ""}${raw.once ? ", next call only" : ""}`;
  await audit(u, "myloans_mock_failure_on", `myloans mock failure on: ${text}`, f);
  return `On: ${text}.`;
}

export async function clearMockFailures(u: CurrentUser) {
  need(u);
  await setSetting("myloans.mockFailures", []);
  await audit(u, "myloans_mock_failure_off", "myloans mock failures switched off", []);
  return "Every failure switch is off.";
}

export async function addScenario(u: CurrentUser, key: string) {
  need(u);
  if (!(key in MOCK_SCENARIOS)) throw new UserError("Pick a scenario.", "scenario");
  const line = await addMockScenario(key as MockScenario);
  await audit(u, "myloans_mock_scenario", `myloans mock scenario: ${MOCK_SCENARIOS[key as MockScenario]}. ${line}`, { scenario: key });
  return line;
}

export async function resetMock(u: CurrentUser) {
  need(u);
  const n = await resetMockData();
  await setSetting("myloans.mockFailures", []);
  await audit(u, "myloans_mock_reset", `myloans mock data reset: ${n} sample loans, failure switches off`, { loans: n });
  return `The mock holds the ${n} sample loans again; every failure switch is off.`;
}

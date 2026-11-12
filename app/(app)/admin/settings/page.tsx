import { ensureTypeStages } from "@/lib/services/job-stages";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { can, requirePageAny, type CurrentUser } from "@/lib/auth/current-user";
import { ALL_PERMISSIONS, AREA_PERMISSIONS, SETTINGS_PERMISSIONS } from "@/lib/auth/permissions";
import { effectivePermissions } from "@/lib/auth/access";
import { RolesList } from "@/components/admin/roles-list";
import { RoleEditor } from "@/components/admin/role-editor";
import { lastRoleChanges } from "@/lib/services/roles";
import { branchesWithoutHoldMover, holdMoverHealthText } from "@/lib/services/holds";
import { STEP_KEY, TYPE_ID, TYPE_KEYS, TYPE_TITLE, type TypeKey } from "@/lib/funds/access";
import { STEP_TITLE, fundsGaps, fundsHandlers } from "@/lib/services/funds-handlers";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getSetting } from "@/lib/settings";
import { decimalToCents, peso } from "@/lib/funds/rules";
import { OTHER, kindOptions, type AmountMode } from "@/lib/funds/kinds";
import { allKinds, kindUsage, openRequestsUsing, otherSuggestionList } from "@/lib/services/expense-kinds";
import { ExpenseKindForm, ExpenseKindsList, OtherSuggestions } from "@/components/admin/expense-kinds";
import { CaRuleForm } from "@/components/admin/ca-rule-form";
import { isTestMode } from "@/lib/test-mode";
import { appEnv } from "@/lib/env";
import { visibleSettingsGroups } from "@/lib/ui/settings-groups";
import { IMPORT_LISTS, type ImportListKey } from "@/lib/import/columns";
import { codeInUse } from "@/lib/services/admin";
import { ltoEstimate } from "@/lib/ui/lto";
import { inactiveEffect, type StatusKind } from "@/lib/services/settings-status";
import { PageHeader } from "@/components/ui/basics";
import { FundsSettingsForm, MockOverrideForm, SettingsEditForm, ToggleForm, type FieldDef } from "@/components/admin/forms";
import { TestKitPanel } from "@/components/admin/test-kit";
import { MORTGAGE_THRESHOLDS, RULE_NAMES } from "@/lib/rules";
import { pesoWhole } from "@/lib/rules/names";
import { PnFormatForm } from "@/components/admin/pn-format";
import { getPnFormat } from "@/lib/pn";
import { kitScreensAvailable } from "@/lib/kit/access";
import { kitPanelData } from "@/lib/kit/panel-data";
import { EmailEventRow, EmailMasterSwitch, EmailTemplateForm, RecentEmails, TestEmailButton } from "@/components/admin/email";
import { EMAIL_EVENTS, EMAIL_EVENT_KEYS, isEmailEvent, type EmailEventKey } from "@/lib/email/templates";
import { listOutbox, senderLine, type OutboxFilter } from "@/lib/email/outbox";
import { businessDate, fmtDate, fmtDateTime, fmtShort } from "@/lib/time";
import { defaultCapacity, openJobCounts, processors } from "@/lib/services/monitoring";
import { availability, leaveText } from "@/lib/monitoring/rules";
import { DefaultCapacityForm, DpCapacityRow } from "@/components/monitoring/capacity-forms";
import { syncStatus } from "@/lib/services/source-sync";
import { accountFeedQuality, feedQualityLine } from "@/lib/services/feed-quality";
import { MyLoansSyncForm, type SyncCardData } from "@/components/admin/myloans-sync";
import { SettingsModal } from "@/components/admin/settings-modal";
import { SettingsList, type ListRow } from "@/components/admin/settings-list";
import { StatusPanel } from "@/components/admin/status-panel";
import { ImportStep } from "@/components/admin/import-step";
import { BranchesModal, type BranchFilter } from "@/components/admin/branches/area";
import {
  AlertIcon, ArrowLeftIcon, BellIcon, PauseIcon, RefreshIcon, BuildingIcon, CalendarIcon, ChecklistIcon, ClockIcon, CoinsIcon, FileTextIcon, FlaskIcon, LayersIcon, ListIcon, MapPinIcon, SettingsIcon, TagIcon, UsersIcon,
} from "@/components/ui/icons";

export const metadata: Metadata = { title: "Settings" };

/** The Settings areas. Grouping and order on the page: lib/ui/settings-groups.ts. */
const AREAS = [
  { key: "branches", title: "Branches", desc: "Codes, areas and divisions from MyLoans.", help: "MyLoans is the source of truth for codes, names, areas, divisions and status: change them through Import from MyLoans and the Branch review. Nothing is deleted: a branch is switched off or hidden.", Icon: BuildingIcon },
  { key: "transaction-types", title: "Transaction types", desc: "Names, who does them and whether a processor is needed.", help: "The automation creates the four built-in types. Types you add here can be added to a loan file by the Loan Associate.", Icon: LayersIcon },
  { key: "document-types", title: "Document types", desc: "The kinds of paper that checklist items use.", help: "Add or change a paper type. A short code locks once a checklist item or loan file uses it.", Icon: FileTextIcon },
  { key: "checklist", title: "Checklist items", desc: "The papers for each transaction, required or optional.", help: "Changes apply to loan files opened from now on. Open loan files keep their papers and settings.", Icon: ChecklistIcon },
  { key: "processing-stages", title: "Processing stages", desc: "The stages a processor works through, with evidence.", help: "Stages run in order. LTO drop off and LTO pickup are added while a type needs LTO processing; Check and verify is always last. Changes apply to jobs not yet started.", Icon: ListIcon },
  { key: "tat", title: "Turnaround times", desc: "Target business days for each step.", help: "Business days skip weekends and holidays. 0 means the same day.", Icon: ClockIcon },
  { key: "loan-types", title: "Loan types", desc: "Display names for the MyLoans loan types.", help: `The Data Check accepts only New and Renewal. The mortgage thresholds are fixed by the rule “${RULE_NAMES.MORTGAGE_THRESHOLD.title}”: ${pesoWhole(MORTGAGE_THRESHOLDS.New)} for New, ${pesoWhole(MORTGAGE_THRESHOLDS.Renewal)} for Renewal.`, Icon: TagIcon },
  { key: "dp-capacity", title: "Processor capacity", desc: "How many open jobs a processor takes, and who is on leave.", help: "Used by the Monitoring page and the Send panel. Open jobs = assigned + in process + on hold. A processor on leave is shown disabled in the Send panel and counts as 0% available. A past \"until\" day ends the leave by itself.", Icon: UsersIcon },
  { key: "roles", title: "Roles and access", desc: "What each role may do, and which branches it sees.", help: "Who can do what. A change applies on each person's next click or page.", Icon: UsersIcon },
  { key: "lto", title: "LTO offices", desc: "LTO offices a processor can be sent to.", help: "Add an office or rename it. Nothing is deleted: make it inactive instead.", Icon: MapPinIcon },
  { key: "cash-advance", title: "Cash-advance rules", desc: "Suggested and maximum amounts, carry-over and liquidation.", help: "Used when the processor asks Finance for funds. More than the maximum needs a typed reason.", Icon: CoinsIcon },
  { key: "expense-kinds", title: "Expense kinds", desc: "What a cash advance or fund transfer can be for.", help: "Picked on every funds request line and Cash-advance rule. Other is built in and always last: the person must say what it is. A kind can have its own amount (suggested or fixed); a rule's Suggested amount comes first and the rule's maximum still applies. Nothing is deleted: make a kind inactive instead.", Icon: TagIcon },
  { key: "funds-types", title: "Funds types", desc: "Cash advance, Fund transfer: what Finance enters at release.", help: "Every type follows the same funds flow. The switches only change what Finance enters at release and whether receipts are needed. A switched-off type stays on old records; a rename never changes old records.", Icon: CoinsIcon },
  { key: "approval-bands", title: "Approval bands", desc: "Who approves a cash advance, by amount.", help: "The band with the highest \"from\" amount at or below the advance decides who approves it.", Icon: UsersIcon },
  { key: "problem-reasons", title: "Problem reasons", desc: "Why a job can be stuck.", help: "Offered when a job has a problem or an attempt was not processed. Nothing is deleted: make it inactive instead.", Icon: AlertIcon },
  { key: "hold-reasons", title: "Hold reasons", desc: "Why a job can wait (not a fault).", help: "Offered when someone puts work on hold (remarks are required for every reason). Add, rename, reorder (Order) or switch off; a switched-off reason stays on old holds, which keep the name they had. The list was seeded as \"Proposed, to be confirmed with the team\"; saving a reason confirms it. The turnaround time keeps counting.", Icon: PauseIcon },
  { key: "missing-reasons", title: "Missing paper reasons", desc: "Why a paper is missing from the file.", help: "Offered when a Loan Associate marks a paper Missing. Remarks are always required too, for every reason. Nothing is deleted: make it inactive instead.", Icon: AlertIcon },
  { key: "return-reasons", title: "Return reasons", desc: "Why a processor returns a job to the Loan Associate.", help: "Offered when a processor returns an accepted job for papers. The turnaround time keeps counting. Nothing is deleted: make it inactive instead.", Icon: ArrowLeftIcon },
  { key: "holidays", title: "Holidays", desc: "Days skipped when counting turnaround times.", help: "Add or change a holiday. An inactive holiday is no longer skipped.", Icon: CalendarIcon },
  { key: "system", title: "System and test mode", desc: "PN format, MyLoans adapter, simulator and test switches.", help: "These switches save as soon as you press them.", Icon: SettingsIcon },
  { key: "myloans-sync", title: "MyLoans sync", desc: "How often loan files are checked against MyLoans.", help: "Only the loans someone opened are checked, never the whole MyLoans. A change that matters waits for Admin to review it.", Icon: RefreshIcon },
  { key: "email", title: "Email notifications", desc: "Emails for the updates people already get in GDFI DMS.", help: "Email is another way to get the same updates. Turn it on when the system goes live.", Icon: BellIcon },
  { key: "test-data", title: "Test data", desc: "Sample PNs on Find a loan.", help: "Only in test mode.", Icon: FlaskIcon },
  { key: "test-kit", title: "Test kit", desc: "Starting state, reset, backups and the test sheet.", help: "Only on a local test setup (database gdfi_dms, test mode). Reset and Restore ask you to type RESET and take a backup first.", Icon: FlaskIcon },
] as const;
type AreaKey = (typeof AREAS)[number]["key"];

const BASE = "/admin/settings";
const listHref = (key: string) => `${BASE}?open=${key}`;
const editHref = (key: string, id: string) => `${BASE}?open=${key}&edit=${id}`;
const importHref = (key: string) => `${BASE}?open=${key}&step=import`;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ open?: string; edit?: string; tab?: string; step?: string; status?: string; from?: string; to?: string; before?: string; q?: string; area?: string; source?: string; show?: string; btype?: string }> }) {
  // Settings opens for anyone who may change at least one area; each card shows only if allowed.
  const user = await requirePageAny(SETTINGS_PERMISSIONS);
  const sp = await searchParams;
  const testMode = isTestMode();
  // The Test kit: only on a local test setup, checked on the server (lib/kit/access.ts). Elsewhere its
  // card is not listed and its address is "not found", even for Admin.
  const kit = kitScreensAvailable();
  const areas = AREAS.filter((a) => (a.key !== "test-data" || testMode) && (a.key !== "test-kit" || kit) && (AREA_PERMISSIONS[a.key] ?? []).some((p) => can(user, p)));
  // Old links (?tab=...) still open the right area.
  const openKey = sp.open ?? sp.tab;
  if (openKey === "test-kit" && !kit) notFound();
  const open = areas.find((a) => a.key === openKey);
  const status = await statusLines(testMode);
  const groups = visibleSettingsGroups(testMode, undefined, kit)
    .map((g) => ({ ...g, areas: g.cards.map((k) => areas.find((a) => a.key === k)).filter((a): a is (typeof AREAS)[number] => !!a) }))
    .filter((g) => g.areas.length > 0);

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader title="Settings" help="Pick an area to change it." />
      <nav aria-label="Jump to" className="-mt-2 hidden flex-wrap items-center gap-x-5 gap-y-2 text-sm sm:flex">
        <span className="font-semibold text-ink-2">Jump to</span>
        {groups.map((g) => (
          <a key={g.key} href={`#group-${g.key}`} className="link inline-flex min-h-11 items-center">{g.label}</a>
        ))}
      </nav>
      <div className="flex flex-col gap-10 lg:gap-12">
        {groups.map((g) => (
          <section key={g.key} id={`group-${g.key}`} aria-labelledby={`group-${g.key}-title`} className="flex scroll-mt-24 flex-col gap-4">
            <div>
              <h2 id={`group-${g.key}-title`} className="text-xs font-bold uppercase tracking-[0.1em] text-navy">{g.label}</h2>
              <p className="mt-1 text-sm text-ink-2">{g.help}</p>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
              {g.areas.map((a) => (
                <li key={a.key}>
                  <Link
                    id={`card-${a.key}`}
                    href={listHref(a.key)}
                    scroll={false}
                    aria-haspopup="dialog"
                    className="card flex h-full items-start gap-4 p-5 no-underline hover:bg-fill sm:p-6"
                  >
                    <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-fill-strong text-navy">
                      <a.Icon size={24} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[17px] font-bold text-navy">{a.title}</span>
                      <span className="mt-0.5 block text-sm text-ink-2">{a.desc}</span>
                      <span className="mt-2 block text-[13px] font-semibold text-navy">
                        {status[a.key].main}
                        {status[a.key].extra && <span className="ml-1.5 text-xs font-medium text-ink-2">{status[a.key].extra}</span>}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {open && <AreaModal area={open} edit={sp.edit} step={sp.step} testMode={testMode} user={user} filter={{ status: sp.status, from: sp.from, to: sp.to, before: sp.before }} branchFilter={{ q: sp.q, area: sp.area, source: sp.source, show: sp.show }} btype={sp.btype === "FT" ? "FT" : "CA"} />}
    </div>
  );
}

/** Card status lines: active rows only, with "+N inactive" in smaller text when any. */
async function statusLines(testMode: boolean): Promise<Record<AreaKey, { main: string; extra: string }>> {
  const pair = (m: { count(a: { where: { active: boolean } }): Promise<number> }) => Promise.all([m.count({ where: { active: true } }), m.count({ where: { active: false } })]);
  const [bands, reasons, holdReasons, returnReasons] = await Promise.all([pair(prisma.approvalBand), pair(prisma.problemReason), pair(prisma.holdReason), pair(prisma.returnReason)]);
  const missingReasons = await pair(prisma.missingPaperReason);
  const [branches, types, docs, rules, required, tats, loanTypes, lto, ca, holidays, sim, unavailable] = await Promise.all([
    Promise.all([prisma.branch.count({ where: { active: true, hidden: false } }), prisma.branch.count({ where: { active: false, hidden: false } })]), pair(prisma.transactionType), pair(prisma.documentType), pair(prisma.checklistRule),
    prisma.checklistRule.count({ where: { active: true, required: true } }), prisma.tatRule.count(), pair(prisma.loanType),
    pair(prisma.ltoOffice), pair(prisma.cashAdvanceRule), pair(prisma.holidayCalendar),
    getSetting("simulator.enabled"), getSetting("myloans.simulateUnavailable"),
  ]);
  const roles = await pair(prisma.role);
  const stages = await pair(prisma.processingStage);
  const customRoles = await prisma.role.count({ where: { active: true, builtIn: false } });
  const n = ([a, i]: number[], one: string, many: string, more = "") => ({ main: `${a} ${a === 1 ? one : many}${more}`, extra: i > 0 ? `+${i} inactive` : "" });
  return {
    branches: n(branches, "branch", "branches"),
    "transaction-types": n(types, "type", "types"),
    "document-types": n(docs, "type", "types"),
    checklist: n(rules, "item", "items", ` · ${required} required`),
    tat: { main: `${tats} target${tats === 1 ? "" : "s"}`, extra: "" },
    "loan-types": n(loanTypes, "type", "types"),
    lto: n(lto, "office", "offices"),
    "cash-advance": n(ca, "rule", "rules"),
    holidays: n(holidays, "holiday", "holidays"),
    "approval-bands": n(bands, "band", "bands"),
    "problem-reasons": n(reasons, "reason", "reasons"),
    "hold-reasons": n(holdReasons, "reason", "reasons"),
    "funds-types": n(await pair(prisma.fundsType), "type", "types"),
    "expense-kinds": n(await pair(prisma.expenseKind), "kind", "kinds"),
    "return-reasons": n(returnReasons, "reason", "reasons"),
    "missing-reasons": n(missingReasons, "reason", "reasons"),
    "processing-stages": n(stages, "stage", "stages"),
    "myloans-sync": await syncStatusLine(),
    email: { main: (await getSetting("email.active")) ? "Active" : "Not active", extra: senderLine() === "Not set up" ? "Not set up" : "" },
    system: { main: `${ENV_LABEL[appEnv()]} · ${appEnv() === "production" ? "" : `Simulator ${sim ? "On" : "Off"} · `}MyLoans ${unavailable ? "unavailable (test)" : (process.env.MYLOANS_MODE ?? "mock").toLowerCase() === "live" ? "live" : "mock"}`, extra: "" },
    "test-data": { main: testMode ? "Test mode only" : "Off", extra: "" },
    "test-kit": { main: "Local test setup only", extra: "" },
    "dp-capacity": await capacityStatusLine(),
    roles: { main: `${roles[0]} role${roles[0] === 1 ? "" : "s"} · ${customRoles} custom`, extra: roles[1] > 0 ? `+${roles[1]} inactive` : "" },
  };
}

// ---------------------------------------------------------------------------
// One modal: a list (first step), the edit form or Import / Export (second step) in the same window.
// ---------------------------------------------------------------------------

interface ListArea {
  kind: string;
  /** Lists that can be made inactive (all except Turnaround times). */
  statusKind?: StatusKind;
  noun: string;
  rows: ListRow[];
  fieldsFor: (id: string | null) => FieldDef[] | null;
  /** Shown instead of Make inactive, for rows that must stay active. */
  lockedReason?: (id: string) => string | undefined;
  addLabel?: string;
  filterLabel?: string;
}

async function AreaModal({ area, edit, step, testMode, user, filter, branchFilter, btype = "CA" }: { area: (typeof AREAS)[number]; edit?: string; step?: string; testMode: boolean; user: CurrentUser; filter: OutboxFilter; branchFilter: BranchFilter; btype?: TypeKey }) {
  const common = { id: "settings-modal", title: area.title, help: area.help, closeHref: BASE, returnFocusId: `card-${area.key}` };

  // Settings, Branches: its own list, edit, Import from MyLoans, Branch review and sync steps.
  if (area.key === "branches") return <BranchesModal common={common} edit={edit} step={step} user={user} filter={branchFilter} />;

  if (area.key === "myloans-sync") {
    return (
      <SettingsModal {...common} footer={can(user, PERMISSIONS.SOURCE_MANAGE) ? { kind: "save", formId: "myloans-sync-form", cancelHref: BASE } : { kind: "done" }}>
        <MyLoansSyncForm d={await syncCardData()} formId="myloans-sync-form" canManage={can(user, PERMISSIONS.SOURCE_MANAGE)} canRun={can(user, PERMISSIONS.MYLOANS_SYNC)} />
      </SettingsModal>
    );
  }
  if (area.key === "email") {
    if (edit && isEmailEvent(edit) && can(user, PERMISSIONS.EMAIL_MANAGE)) {
      const custom = (await getSetting("email.templates"))[edit];
      const def = EMAIL_EVENTS[edit];
      return (
        <SettingsModal {...common} title={`Edit message: ${def.label}`} help={`To: ${def.to}.`} backHref={listHref("email")} footer={{ kind: "save", formId: "email-template-form", cancelHref: listHref("email") }}>
          <EmailTemplateForm key={edit} event={edit} label={def.label} subject={custom?.subject ?? def.subject} body={custom?.body ?? def.body} defaults={{ subject: def.subject, body: def.body }} formId="email-template-form" />
        </SettingsModal>
      );
    }
    return <SettingsModal {...common} footer={{ kind: "done" }}><EmailArea user={user} testMode={testMode} filter={filter} /></SettingsModal>;
  }

  if (area.key === "roles") return <RolesArea edit={edit} common={common} />;
  if (area.key === "dp-capacity") {
    return <SettingsModal {...common} footer={{ kind: "done" }}><CapacityArea /></SettingsModal>;
  }
  if (area.key === "system") {
    return <SettingsModal {...common} footer={{ kind: "done" }}><SystemArea user={user} /></SettingsModal>;
  }
  if (area.key === "test-data") {
    return <SettingsModal {...common} footer={{ kind: "done" }}>{testMode ? <TestDataArea /> : null}</SettingsModal>;
  }
  if (area.key === "test-kit") {
    if (!kitScreensAvailable()) notFound();
    return <SettingsModal {...common} footer={{ kind: "done" }}><TestKitPanel {...(await kitPanelData())} /></SettingsModal>;
  }

  if (area.key === "expense-kinds" && step !== "import") return <ExpenseKindsArea common={common} edit={edit} user={user} />;
  if (area.key === "cash-advance" && edit) {
    const r = edit === "new" ? null : await prisma.cashAdvanceRule.findUnique({ where: { id: edit }, include: { transactionType: true, kindRef: true } });
    if (edit !== "new" && !r) return null;
    const [types, kinds] = await Promise.all([prisma.transactionType.findMany({ where: { requiresDp: true }, orderBy: { sortOrder: "asc" } }), allKinds()]);
    return (
      <SettingsModal {...common} title={r ? `${area.title}: ${r.transactionType.name} · ${r.kindRef.name}` : `${area.title}: Add rule`} backHref={listHref(area.key)} footer={{ kind: "save", formId: "settings-form", cancelHref: listHref(area.key) }}>
        <CaRuleForm key={edit} id={r?.id ?? null} formId="settings-form" listHref={listHref(area.key)}
          types={types.filter((t) => t.active || t.id === r?.transactionTypeId).map((t) => [t.id, t.name])}
          kinds={kindOptions(kinds, r?.kind).map((k) => [k.code, `${k.name}${k.active ? "" : " · Inactive"}`])}
          value={{ transactionTypeId: r?.transactionTypeId ?? types[0]?.id ?? "", kind: r?.kind ?? kindOptions(kinds)[0]?.code ?? OTHER, purpose: r?.purpose ?? "", suggestedAmount: r?.suggestedAmount == null ? "" : String(Number(r.suggestedAmount)), maxAmount: r ? String(Number(r.maxAmount)) : "" }} />
        {r && <StatusPanel kind="caRule" id={r.id} active={r.active} noun="cash-advance rule" effect={await inactiveEffect("caRule", r.id)} />}
      </SettingsModal>
    );
  }

  const importKey = area.key as ImportListKey;
  if (step === "import" && IMPORT_LISTS[importKey] && can(user, PERMISSIONS.SETTINGS_IMPORT)) {
    return (
      <SettingsModal {...common} title={`${area.title}: Import / Export`} help="Download a file, fill it in Excel, then check and import it." backHref={listHref(area.key)} footer={{ kind: "done" }}>
        <ImportStep list={importKey} />
      </SettingsModal>
    );
  }

  const list = await loadListArea(area.key, { btype });
  if (!list) return null;
  const fields = edit ? list.fieldsFor(edit === "new" ? null : edit) : null;
  if (edit && fields) {
    const row = list.rows.find((r) => r.id === edit);
    const isNew = edit === "new";
    return (
      <SettingsModal
        {...common}
        title={isNew ? `${area.title}: ${list.addLabel ?? "Add"}` : `${area.title}: ${row?.title ?? "Edit"}`}
        backHref={listHref(area.key)}
        footer={{ kind: "save", formId: "settings-form", cancelHref: listHref(area.key) }}
      >
        <SettingsEditForm key={edit} kind={list.kind} id={isNew ? null : edit} fields={fields} formId="settings-form" listHref={listHref(area.key)} />
        {!isNew && list.statusKind && row && (
          <StatusPanel
            kind={list.statusKind} id={edit} active={!row.inactive} noun={list.noun}
            effect={await inactiveEffect(list.statusKind, edit)}
            lockedReason={list.lockedReason?.(edit)}
          />
        )}
      </SettingsModal>
    );
  }
  return (
    <SettingsModal {...common} footer={{ kind: "done" }} headerLink={IMPORT_LISTS[importKey] && can(user, PERMISSIONS.SETTINGS_IMPORT) ? { href: importHref(area.key), label: "Import / Export" } : undefined}>
      {area.key === "cash-advance" && (
        <FundsSettingsForm
          carryOverLimitDays={await getSetting("funds.carryOverLimitDays")}
          liquidationDueDays={await getSetting("funds.liquidationDueDays")}
          blockLtoUntilFunded={await getSetting("funds.blockLtoUntilFunded")}
        />
      )}
      {area.key === "approval-bands" && (
        // Each funds type has its own bands (Cash advance | Fund transfer).
        <nav aria-label="Type" className="seg mb-3" data-band-type-switch>
          {TYPE_KEYS.map((k) => (
            <Link key={k} href={`${BASE}?open=approval-bands&btype=${k}`} aria-current={btype === k ? "page" : undefined} className="seg-item" data-band-type={k}>{k === "CA" ? "Cash advance" : "Fund transfer"}</Link>
          ))}
        </nav>
      )}
      {area.key === "funds-types" && <WhoHandles />}
      <SettingsList rows={list.rows} addHref={list.addLabel ? `${editHref(area.key, "new")}${area.key === "approval-bands" ? `&btype=${btype}` : ""}` : undefined} addLabel={list.addLabel} filterLabel={list.filterLabel ?? "Find"} statusKind={list.statusKind} />
    </SettingsModal>
  );
}

/** Settings, Expense kinds: the list, the "Often typed as Other" block, and the add / edit step. */
async function ExpenseKindsArea({ common, edit, user }: { common: { id: string; title: string; help: string; closeHref: string; returnFocusId: string }; edit?: string; user: CurrentUser }) {
  const manage = can(user, PERMISSIONS.FUNDS_KINDS_MANAGE);
  const key = "expense-kinds";
  const [kinds, usage] = await Promise.all([allKinds(), kindUsage()]);
  if (edit && manage) {
    const k = edit === "new" ? null : kinds.find((x) => x.id === edit);
    if (edit !== "new" && !k) return null;
    const rules = k ? await prisma.cashAdvanceRule.findMany({ where: { kind: k.code, active: true }, include: { transactionType: true } }) : [];
    const lowest = rules.map((r) => ({ cents: decimalToCents(r.maxAmount) ?? 0, text: `${peso(decimalToCents(r.maxAmount) ?? 0)} (the ${r.transactionType.name} rule's maximum)` })).sort((a, b) => a.cents - b.cents)[0] ?? null;
    return (
      <SettingsModal {...common} title={k ? `Expense kinds: ${k.name}` : "Expense kinds: Add kind"} backHref={listHref(key)} footer={{ kind: "save", formId: "settings-form", cancelHref: listHref(key) }}>
        <ExpenseKindForm key={edit} id={k?.id ?? null} formId="settings-form" listHref={listHref(key)} kind={k ? { name: k.name, builtIn: k.builtIn, amountMode: k.amountMode as AmountMode, amountCents: k.amountCents } : null}
          openRequests={k ? await openRequestsUsing(k.code) : 0} maxRule={lowest} />
        {k && <StatusPanel kind="expenseKind" id={k.id} active={k.active} noun="expense kind" effect={await inactiveEffect("expenseKind", k.id)} lockedReason={k.builtIn ? "Other is built in: it is always active, so there is always a kind for anything else." : undefined} />}
      </SettingsModal>
    );
  }
  const suggestions = manage ? await otherSuggestionList() : [];
  return (
    <SettingsModal {...common} footer={{ kind: "done" }} headerLink={manage && can(user, PERMISSIONS.SETTINGS_IMPORT) ? { href: importHref(key), label: "Import / Export" } : undefined}>
      <div className="flex flex-col gap-4">
        <OtherSuggestions items={suggestions} />
        <ExpenseKindsList canManage={manage} addHref={editHref(key, "new")} rows={kinds.map((k) => ({
          id: k.id, code: k.code, name: k.name, builtIn: k.builtIn, active: k.active, amountMode: k.amountMode as AmountMode, amountCents: k.amountCents,
          rules: usage.get(k.code)?.rules ?? 0, lines: usage.get(k.code)?.lines ?? 0, editHref: editHref(key, k.id),
        }))} />
      </div>
    </SettingsModal>
  );
}

/** "Default 10 open jobs · 1 on leave". */
async function capacityStatusLine(): Promise<{ main: string; extra: string }> {
  const today = businessDate(new Date());
  const people = await processors(today);
  const away = people.filter((p) => p.onLeave).length;
  return { main: `Default ${await defaultCapacity()} open jobs`, extra: away ? `${away} on leave` : "" };
}

/** Settings, Processor capacity: the default, then each processor (own capacity, On leave until). */
async function CapacityArea() {
  const today = businessDate(new Date());
  const [def, people, open] = await Promise.all([defaultCapacity(), processors(today), openJobCounts()]);
  return (
    <div className="flex flex-col gap-4" data-capacity-area>
      <DefaultCapacityForm value={def} />
      <h3 className="text-[15px] font-bold text-navy">Processors ({people.length})</h3>
      <ul className="flex flex-col gap-2">
        {people.map((p) => {
          const a = availability(p.capacity, open.get(p.id) ?? 0, p.onLeave);
          return (
            <DpCapacityRow key={p.id} today={today} defaultCapacity={def}
              d={{ id: p.id, name: p.name, branches: p.branchNames.join(", ") || "No branch", ownCapacity: p.ownCapacity, capacity: p.capacity, onLeave: p.onLeave, leaveUntil: p.onLeave ? p.leaveUntil : null, open: a.open, availText: p.onLeave ? leaveText(p.leaveUntil, fmtDate) : a.text }} />
          );
        })}
      </ul>
    </div>
  );
}

const ORIG_TEXT = { ORIGINAL: "Original", COPY: "Copy", EITHER: "Either" } as const;

async function loadListArea(key: AreaKey, opts: { btype?: TypeKey } = {}): Promise<ListArea | null> {
  switch (key) {
    case "transaction-types": {
      const rows = await prisma.transactionType.findMany({ orderBy: { sortOrder: "asc" }, include: { _count: { select: { rules: { where: { active: true } } } } } });
      const locked = new Map(await Promise.all(rows.map(async (r) => [r.id, await codeInUse("transactionType", r.id)] as const)));
      const f = (r?: (typeof rows)[number]): FieldDef[] => [
        { name: "name", label: "Name", type: "text", value: r?.name, width: "lg", help: "Plain words, as the Loan Associate will see it." },
        {
          name: "code", label: "Short code", type: "text", value: r?.code, width: "sm", readOnly: !!r && locked.get(r.id),
          help: r && locked.get(r.id) ? (r.builtIn ? "Built-in: the code is fixed." : "Locked: it is already used.") : "2 to 12 capital letters. Cannot change after it is first used.",
        },
        { name: "ownerRole", label: "Done by", type: "select", value: r?.ownerRole ?? "DP", options: [["DP", "DP (Document Processor)"], ["LA", "LA (Loan Associate)"]] },
        { name: "sortOrder", label: "Order", type: "number", value: r?.sortOrder ?? rows.length + 1, width: "sm" },
        { name: "requiresDp", label: "Needs a processor", type: "checkbox", value: r?.requiresDp ?? true, help: "Sent to a Document Processor before it is done." },
        {
          name: "needsLto", label: "Needs LTO processing", type: "checkbox", value: r?.needsLto ?? false, dependsOn: "requiresDp",
          help: "The Document Processor takes this to an LTO office. The LA must say which office when sending.",
          offNote: "Switched off: a type without a processor is not taken to the LTO.",
        },
        { name: "description", label: "Description (optional)", type: "text", value: r?.description ?? "", width: "lg" },
      ];
      return {
        kind: "transactionType", statusKind: "transactionType", noun: "transaction type", addLabel: "Add transaction type", filterLabel: "Find a transaction type",
        rows: rows.map((r) => ({
          id: r.id, title: r.name,
          sub: `${r.code} · done by ${r.ownerRole}${r.requiresDp ? " · needs a processor" : ""}`,
          tags: [...(r.builtIn ? [{ text: "Built-in", tone: "navy" as const }] : []), ...(r.needsLto && r.requiresDp ? [{ text: "LTO", tone: "act" as const }] : [])],
          hint: !r.builtIn && r._count.rules === 0 ? "No papers set yet. Add them in Checklist items." : undefined,
          inactive: !r.active, href: editHref(key, r.id),
        })),
        fieldsFor: (id) => (id === null ? f() : rows.find((r) => r.id === id) ? f(rows.find((r) => r.id === id)) : null),
        lockedReason: (id) => (rows.find((r) => r.id === id)?.builtIn ? "Built-in: the automation creates it, so it is always active. You can rename and re-order it." : undefined),
      };
    }
    case "document-types": {
      const rows = await prisma.documentType.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { rules: true } } } });
      const locked = new Map(await Promise.all(rows.map(async (r) => [r.id, await codeInUse("documentType", r.id)] as const)));
      const f = (r?: (typeof rows)[number]): FieldDef[] => [
        { name: "name", label: "Name", type: "text", value: r?.name, width: "lg" },
        {
          name: "code", label: "Short code", type: "text", value: r?.code, width: "sm", readOnly: !!r && locked.get(r.id),
          help: r && locked.get(r.id) ? "Locked: a checklist item or loan file uses it." : "Capital letters and numbers. Locks once used.",
        },
        { name: "defaultOriginality", label: "Original or copy (default)", type: "select", value: r?.defaultOriginality ?? "EITHER", options: [["ORIGINAL", "Original"], ["COPY", "Copy"], ["EITHER", "Either"]] },
        { name: "notes", label: "Notes (optional)", type: "text", value: r?.notes ?? "", width: "lg" },
      ];
      return {
        kind: "documentType", statusKind: "documentType", noun: "document type", addLabel: "Add document type", filterLabel: "Find a document type",
        rows: rows.map((r) => ({
          id: r.id, title: r.name,
          sub: `${r.code} · ${ORIG_TEXT[r.defaultOriginality]} · used by ${r._count.rules} checklist item${r._count.rules === 1 ? "" : "s"}`,
          inactive: !r.active, href: editHref(key, r.id),
        })),
        fieldsFor: (id) => (id === null ? f() : rows.find((r) => r.id === id) ? f(rows.find((r) => r.id === id)) : null),
      };
    }
    case "checklist": {
      const [types, docTypes] = await Promise.all([
        prisma.transactionType.findMany({ orderBy: { sortOrder: "asc" }, include: { rules: { orderBy: { sortOrder: "asc" }, include: { documentType: true } } } }),
        prisma.documentType.findMany({ orderBy: { name: "asc" } }),
      ]);
      const rules = types.flatMap((t) => t.rules.map((r) => ({ ...r, typeName: t.name })));
      // Only active document types are offered; an item that already uses an inactive one keeps it.
      const docOpts = (current?: string) =>
        docTypes.filter((d) => d.active || d.id === current).map((d) => [d.id, `${d.name} (${d.code})${d.active ? "" : " · Inactive"}`] as [string, string]);
      const firstActive = docTypes.find((d) => d.active);
      const f = (r?: (typeof rules)[number]): FieldDef[] => [
        { name: "transactionTypeId", label: "Transaction", type: "select", value: r?.transactionTypeId ?? types[0]?.id, options: types.filter((t) => t.active || t.id === r?.transactionTypeId).map((t) => [t.id, t.name]) },
        { name: "label", label: "Paper", type: "text", value: r?.label, width: "lg" },
        { name: "documentTypeId", label: "Document type", type: "select", value: r?.documentTypeId ?? firstActive?.id, options: docOpts(r?.documentTypeId) },
        { name: "originality", label: "Original or copy", type: "select", value: r?.originality ?? (firstActive?.defaultOriginality === "COPY" ? "COPY" : "ORIGINAL"), options: [["ORIGINAL", "Original"], ["COPY", "Copy"]] },
        { name: "required", label: "Required", type: "checkbox", value: r?.required ?? true, help: "Must be ticked before the transaction can be sent to a processor. Applies to loan files opened from now on." },
        { name: "reusable", label: "Belongs to the borrower (can be reused)", type: "checkbox", value: r?.reusable ?? false, help: "Valid IDs, SPA and similar: can be copied to a replacement PN. Leave off for unit papers (OR/CR, deed of sale, insurance policy, chattel mortgage, promissory note)." },
        { name: "oneOfGroup", label: "Pick-one group (optional)", type: "text", value: r?.oneOfGroup, help: "Leave blank for a single paper. Papers with the same group name: at least one must be ticked." },
        { name: "sortOrder", label: "Order", type: "number", value: r?.sortOrder ?? 99, width: "sm" },
      ];
      return {
        kind: "checklistRule", statusKind: "checklistRule", noun: "checklist item", addLabel: "Add paper", filterLabel: "Find a paper or transaction",
        rows: rules.map((r) => ({
          id: r.id,
          title: `${r.typeName} · ${r.label}`,
          sub: `${r.documentType.name} · ${r.originality === "ORIGINAL" ? "Original" : "Copy"}${r.oneOfGroup ? ` · pick one: ${r.oneOfGroup}` : ""}`,
          tags: [
            r.required ? { text: "Required", tone: "act" as const } : { text: "Optional", tone: "mute" as const },
            ...(r.documentType.active ? [] : [{ text: "Document type inactive", tone: "mute" as const }]),
          ],
          inactive: !r.active,
          href: editHref(key, r.id),
        })),
        fieldsFor: (id) => (id === null ? f() : rules.find((r) => r.id === id) ? f(rules.find((r) => r.id === id)) : null),
      };
    }
    case "tat": {
      const rows = await prisma.tatRule.findMany({ orderBy: [{ phase: "asc" }, { step: "asc" }] });
      return {
        kind: "tat", noun: "turnaround time", filterLabel: "Find a step",
        rows: rows.map((r) => ({ id: r.id, title: `${r.step} ${r.label}`, sub: `${r.businessDays === 0 ? "Same day" : `${r.businessDays} business day${r.businessDays === 1 ? "" : "s"}`}${r.note ? ` · ${r.note}` : ""}`, href: editHref(key, r.id) })),
        fieldsFor: (id) => {
          const r = rows.find((x) => x.id === id);
          if (!r) return null;
          return [
            { name: "step", label: "Step", type: "text", value: `${r.step} ${r.label}`, width: "lg", readOnly: true },
            { name: "businessDays", label: "Business days", type: "number", value: r.businessDays, width: "sm" },
            { name: "note", label: "Note", type: "text", value: r.note, help: "When set, shown instead of the number on the Journey tab." },
          ];
        },
      };
    }
    case "loan-types": {
      const rows = await prisma.loanType.findMany({ orderBy: { code: "asc" } });
      return {
        kind: "loanType", statusKind: "loanType", noun: "loan type", filterLabel: "Find a loan type",
        rows: rows.map((r) => ({ id: r.id, title: r.name, sub: `MyLoans value: ${r.code}`, inactive: !r.active, href: editHref(key, r.id) })),
        fieldsFor: (id) => {
          const r = rows.find((x) => x.id === id);
          if (!r) return null;
          return [
            { name: "code", label: "MyLoans value", type: "text", value: r.code, width: "sm", readOnly: true },
            { name: "name", label: "Display name", type: "text", value: r.name },
            { name: "description", label: "Description", type: "text", value: r.description, width: "lg" },
          ];
        },
      };
    }
    case "lto": {
      const rows = await prisma.ltoOffice.findMany({ orderBy: { name: "asc" } });
      const f = (r?: (typeof rows)[number]): FieldDef[] => [
        { name: "code", label: "Code", type: "text", value: r?.code, width: "sm" },
        { name: "name", label: "Name", type: "text", value: r?.name, width: "lg" },
        { name: "city", label: "Area or city", type: "text", value: r?.city },
        { name: "distanceKm", label: "Usual distance (km)", type: "number", value: r?.distanceKm ?? "", width: "sm", help: "Optional." },
        { name: "travelHours", label: "Usual travel time (hours, one way)", type: "number", value: r?.travelHours ?? "", width: "sm", help: "Optional." },
        {
          name: "suggestedTransport", label: "Suggested transport amount (₱)", type: "number", value: r?.suggestedTransportCents != null ? (r.suggestedTransportCents / 100).toFixed(2) : "", width: "sm",
          help: "Used only to help the approver estimate the cash advance.",
        },
      ];
      return {
        kind: "ltoOffice", statusKind: "ltoOffice", noun: "LTO office", addLabel: "Add LTO office", filterLabel: "Find an office",
        rows: rows.map((r) => ({ id: r.id, title: r.name, sub: `${r.code}${r.city ? ` · ${r.city}` : ""} · ${ltoEstimate(r) ?? "No estimate yet"}`, inactive: !r.active, href: editHref(key, r.id) })),
        fieldsFor: (id) => (id === null ? f() : rows.find((r) => r.id === id) ? f(rows.find((r) => r.id === id)) : null),
      };
    }
    case "cash-advance": {
      const [rows, types] = await Promise.all([
        prisma.cashAdvanceRule.findMany({ include: { transactionType: true, kindRef: true }, orderBy: { createdAt: "asc" } }),
        prisma.transactionType.findMany({ where: { requiresDp: true }, orderBy: { sortOrder: "asc" } }),
      ]);
      const f = (r?: (typeof rows)[number]): FieldDef[] => [
        { name: "transactionTypeId", label: "Transaction", type: "select", value: r?.transactionTypeId ?? types[0]?.id, options: types.filter((t) => t.active || t.id === r?.transactionTypeId).map((t) => [t.id, t.name]) },
        { name: "expenseKind", label: "Expense kind", type: "select", value: r?.kind ?? "OTHER", options: [[r?.kind ?? "OTHER", r?.kindRef.name ?? "Other"]] },
        { name: "purpose", label: "Purpose", type: "text", value: r?.purpose, width: "lg" },
        { name: "suggestedAmount", label: "Suggested (PHP, optional)", type: "number", value: r?.suggestedAmount == null ? "" : Number(r.suggestedAmount) },
        { name: "maxAmount", label: "Maximum per transaction (PHP)", type: "number", value: r ? Number(r.maxAmount) : "" },
      ];
      return {
        kind: "caRule", statusKind: "caRule", noun: "cash-advance rule", addLabel: "Add rule", filterLabel: "Find a rule",
        rows: rows.map((r) => ({
          id: r.id, title: `${r.transactionType.name} · ${r.kindRef.name}${r.kind === OTHER ? " (and kinds without their own rule)" : ""}`,
          sub: `${r.purpose} · ${r.suggestedAmount == null ? "No suggested amount" : `Suggested ${peso(decimalToCents(r.suggestedAmount) ?? 0)}`} · up to ${peso(decimalToCents(r.maxAmount) ?? 0)}`,
          inactive: !r.active, href: editHref(key, r.id),
        })),
        fieldsFor: (id) => (id === null ? f() : rows.find((r) => r.id === id) ? f(rows.find((r) => r.id === id)) : null),
      };
    }
    case "approval-bands": {
      // The bands of one type (the Type switch); an edited band keeps its own type.
      const btype: TypeKey = opts.btype ?? "CA";
      const [all, roles] = await Promise.all([
        prisma.approvalBand.findMany({ include: { role: true }, orderBy: { fromCents: "asc" } }),
        prisma.role.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      ]);
      const rows = all.filter((r) => r.fundsTypeId === TYPE_ID[btype]);
      const approversOf = (k: TypeKey) => roles.filter((r) => effectivePermissions(r).has(STEP_KEY[k].approve));
      const f = (r?: (typeof all)[number]): FieldDef[] => {
        const k: TypeKey = r ? (r.fundsTypeId === TYPE_ID.FT ? "FT" : "CA") : btype;
        const approvers = approversOf(k);
        return [
          { name: "fundsTypeId", label: "Type", type: "select", value: TYPE_ID[k], options: TYPE_KEYS.map((x) => [TYPE_ID[x], x === "CA" ? "Cash advance" : "Fund transfer"]), help: "Each type has its own bands." },
          { name: "fromAmount", label: "Amount from (PHP)", type: "number", value: r ? r.fromCents / 100 : "", help: "0 means any amount." },
          { name: "roleId", label: "Approving role", type: "select", value: r?.roleId ?? approvers[0]?.id, options: [...approvers, ...(r && !approvers.some((x) => x.id === r.roleId) ? [r.role] : [])].map((x) => [x.id, x.name]), help: `The role needs "${k === "CA" ? "Approve cash advances" : "Approve fund transfers"}".` },
        ];
      };
      return {
        kind: "approvalBand", statusKind: "approvalBand", noun: "approval band", addLabel: "Add band", filterLabel: "Find a band",
        rows: rows.map((r, i) => {
          // The next band up (several roles can share one amount).
          const next = rows.slice(i + 1).find((x) => x.active && x.fromCents > r.fromCents);
          return {
            id: r.id, title: r.fromCents === 0 && !next ? "Any amount" : `From ${peso(r.fromCents)}${next ? ` to below ${peso(next.fromCents)}` : " and up"}`,
            sub: `Approved by ${r.role.name}`, inactive: !r.active, href: editHref(key, r.id),
          };
        }),
        fieldsFor: (id) => (id === null ? f() : all.find((r) => r.id === id) ? f(all.find((r) => r.id === id)) : null),
      };
    }
    case "problem-reasons": {
      const rows = await prisma.problemReason.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
      const f = (r?: (typeof rows)[number]): FieldDef[] => [
        { name: "code", label: "Code", type: "text", value: r?.code, width: "sm" },
        { name: "name", label: "Reason", type: "text", value: r?.name, width: "lg" },
        { name: "sortOrder", label: "Order", type: "number", value: r?.sortOrder ?? rows.length + 1, width: "sm" },
      ];
      return {
        kind: "problemReason", statusKind: "problemReason", noun: "problem reason", addLabel: "Add reason", filterLabel: "Find a reason",
        rows: rows.map((r) => ({ id: r.id, title: r.name, sub: r.code, inactive: !r.active, href: editHref(key, r.id) })),
        fieldsFor: (id) => (id === null ? f() : rows.find((r) => r.id === id) ? f(rows.find((r) => r.id === id)) : null),
      };
    }
    case "hold-reasons": {
      const rows = await prisma.holdReason.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
      const f = (r?: (typeof rows)[number]): FieldDef[] => [
        { name: "code", label: "Code", type: "text", value: r?.code, width: "sm" },
        { name: "name", label: "Reason", type: "text", value: r?.name, width: "lg" },
        { name: "sortOrder", label: "Order", type: "number", value: r?.sortOrder ?? rows.length + 1, width: "sm" },
      ];
      return {
        kind: "holdReason", statusKind: "holdReason", noun: "hold reason", addLabel: "Add reason", filterLabel: "Find a reason",
        // Seeded defaults: "Proposed, to be confirmed with the team" until Admin saves the row.
        rows: rows.map((r) => ({ id: r.id, title: r.name, sub: r.proposed ? `${r.code} · Proposed, to be confirmed with the team` : r.code, inactive: !r.active, href: editHref(key, r.id) })),
        fieldsFor: (id) => (id === null ? f() : rows.find((r) => r.id === id) ? f(rows.find((r) => r.id === id)) : null),
      };
    }
    case "funds-types": {
      const rows = await prisma.fundsType.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
      const f = (r?: (typeof rows)[number]): FieldDef[] => [
        { name: "code", label: "Short code", type: "text", value: r?.code, width: "sm", help: "Shown on the pill, for example CA or FT." },
        { name: "name", label: "Name", type: "text", value: r?.name, width: "lg" },
        { name: "sortOrder", label: "Order", type: "number", value: r?.sortOrder ?? rows.length + 1, width: "sm" },
        { name: "needsReference", label: "Release needs a reference number", type: "checkbox", value: r?.needsReference ?? false, help: "Finance enters the transfer reference number and the transfer date at release." },
        { name: "needsAccount", label: "Release needs receiving account details", type: "checkbox", value: r?.needsAccount ?? false, help: "Bank or e-wallet, account name and the last 4 digits only (never the full number)." },
        { name: "mustLiquidate", label: "Must be liquidated with receipts", type: "checkbox", value: r?.mustLiquidate ?? true, help: "On: liquidation, the due date and the overdue notice as for every advance. Off: settled when released." },
      ];
      return {
        kind: "fundsType", statusKind: "fundsType", noun: "funds type", addLabel: "Add type", filterLabel: "Find a type",
        // Seeded defaults: "Proposed, to be confirmed with Finance" until Admin saves the row.
        rows: rows.map((r) => ({
          id: r.id, title: `${r.code} · ${r.name}`,
          sub: [r.proposed ? "Proposed, to be confirmed with Finance" : "", r.needsReference ? "reference number" : "", r.needsAccount ? "account details" : "", r.mustLiquidate ? "receipts" : "no receipts needed"].filter(Boolean).join(" · "),
          inactive: !r.active, href: editHref(key, r.id),
        })),
        fieldsFor: (id) => (id === null ? f() : rows.find((r) => r.id === id) ? f(rows.find((r) => r.id === id)) : null),
      };
    }
    case "return-reasons": {
      const rows = await prisma.returnReason.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
      const f = (r?: (typeof rows)[number]): FieldDef[] => [
        { name: "code", label: "Code", type: "text", value: r?.code, width: "sm" },
        { name: "name", label: "Reason", type: "text", value: r?.name, width: "lg" },
        { name: "sortOrder", label: "Order", type: "number", value: r?.sortOrder ?? rows.length + 1, width: "sm" },
      ];
      return {
        kind: "returnReason", statusKind: "returnReason", noun: "return reason", addLabel: "Add reason", filterLabel: "Find a reason",
        rows: rows.map((r) => ({ id: r.id, title: r.name, sub: r.code, inactive: !r.active, href: editHref(key, r.id) })),
        fieldsFor: (id) => (id === null ? f() : rows.find((r) => r.id === id) ? f(rows.find((r) => r.id === id)) : null),
      };
    }
    case "missing-reasons": {
      const rows = await prisma.missingPaperReason.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
      const f = (r?: (typeof rows)[number]): FieldDef[] => [
        { name: "code", label: "Code", type: "text", value: r?.code, width: "sm" },
        { name: "name", label: "Reason", type: "text", value: r?.name, width: "lg" },
        { name: "sortOrder", label: "Order", type: "number", value: r?.sortOrder ?? rows.length + 1, width: "sm" },
      ];
      return {
        kind: "missingReason", statusKind: "missingReason", noun: "missing paper reason", addLabel: "Add reason", filterLabel: "Find a reason",
        rows: rows.map((r) => ({ id: r.id, title: r.name, sub: r.code, inactive: !r.active, href: editHref(key, r.id) })),
        fieldsFor: (id) => (id === null ? f() : rows.find((r) => r.id === id) ? f(rows.find((r) => r.id === id)) : null),
      };
    }
    case "processing-stages": {
      // Each type with a processor, its stages in the order a job runs them (system stages last).
      const types = await prisma.transactionType.findMany({ where: { requiresDp: true }, orderBy: { sortOrder: "asc" } });
      for (const t of types) await ensureTypeStages(prisma, t);
      const all = await prisma.processingStage.findMany({ include: { type: true } });
      const rank = (s: (typeof all)[number]) => (s.kind === "OWN" ? s.sortOrder : 1000 + ["LTO_DROP", "LTO_PICKUP", "VERIFY"].indexOf(s.kind));
      const rows = types.flatMap((t) => all.filter((s) => s.typeId === t.id).sort((a, b) => rank(a) - rank(b)));
      const f = (r?: (typeof rows)[number]): FieldDef[] => {
        const system = !!r && r.kind !== "OWN";
        return [
          { name: "typeId", label: "Transaction", type: "select", value: r?.typeId ?? types[0]?.id, readOnly: !!r, options: types.filter((t) => t.active || t.id === r?.typeId).map((t) => [t.id, t.name]), help: r ? "A stage stays with its transaction type." : undefined },
          { name: "name", label: "Stage name", type: "text", value: r?.name, width: "lg" },
          { name: "code", label: "Short code", type: "text", value: r?.code, width: "sm", readOnly: system, help: system ? "Added by the system; the code is fixed." : "Capital letters, numbers and -." },
          ...(system ? [] : [{ name: "sortOrder", label: "Order", type: "number" as const, value: r?.sortOrder ?? 1, width: "sm" as const, help: "Smaller first. LTO drop off, LTO pickup and Check and verify always come after." }]),
          { name: "targetDays", label: "Target (business days)", type: "text", value: r?.targetDays ?? "", width: "sm", help: "Blank means no target. Shown as a small chip on the job; it adds no alerts." },
          ...(r?.kind === "VERIFY"
            ? [{ name: "$verify", label: "Evidence", type: "text" as const, value: "A checklist of every paper of the transaction, each ticked Received back and complete, with a verified-by line and an optional note.", readOnly: true, width: "lg" as const }]
            : [{ name: "fields", label: "Evidence fields", type: "evidence" as const, value: JSON.stringify(r?.fields ?? []) }]),
        ];
      };
      const kindText = { OWN: null, LTO_DROP: "Added when Needs LTO processing is on", LTO_PICKUP: "Added when Needs LTO processing is on", VERIFY: "Always last" } as const;
      return {
        kind: "processingStage", statusKind: "processingStage", noun: "stage", addLabel: "Add stage", filterLabel: "Find a stage or transaction",
        rows: rows.map((r) => {
          const fields = (r.fields as unknown as { label: string; required: boolean }[]) ?? [];
          return {
            id: r.id,
            title: `${r.type.name} · ${r.name}`,
            sub: r.kind === "VERIFY" ? "Every paper: received back and complete" : fields.length ? fields.map((x) => `${x.label}${x.required ? "" : " (optional)"}`).join(", ") : "No evidence fields",
            tags: [
              ...(kindText[r.kind] ? [{ text: kindText[r.kind]!, tone: "mute" as const }] : []),
              ...(r.kind !== "OWN" && r.kind !== "VERIFY" && !r.type.needsLto ? [{ text: "Not used: the type does not need LTO", tone: "mute" as const }] : []),
              ...(r.targetDays !== null ? [{ text: `Target ${r.targetDays} day${r.targetDays === 1 ? "" : "s"}`, tone: "act" as const }] : []),
            ],
            inactive: !r.active,
            href: editHref(key, r.id),
          };
        }),
        fieldsFor: (id) => (id === null ? f() : rows.find((r) => r.id === id) ? f(rows.find((r) => r.id === id)) : null),
      };
    }
    case "holidays": {
      const rows = await prisma.holidayCalendar.findMany({ orderBy: { date: "asc" } });
      const f = (r?: (typeof rows)[number]): FieldDef[] => [
        { name: "date", label: "Date", type: "date", value: r?.date },
        { name: "name", label: "Name", type: "text", value: r?.name, width: "lg" },
      ];
      return {
        kind: "holiday", statusKind: "holiday", noun: "holiday", addLabel: "Add holiday", filterLabel: "Find a holiday",
        rows: rows.map((r) => ({ id: r.id, title: r.name, sub: r.date, inactive: !r.active, href: editHref(key, r.id) })),
        fieldsFor: (id) => (id === null ? f() : rows.find((r) => r.id === id) ? f(rows.find((r) => r.id === id)) : null),
      };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Roles and access: the list (first step) and the role step (second step, with Back).
// ---------------------------------------------------------------------------

async function RolesArea({ edit, common }: { edit?: string; common: { id: string; title: string; help: string; closeHref: string; returnFocusId: string } }) {
  const listHref = listHref_("roles");
  const editBase = `${BASE}?open=roles&edit=`;
  const roles = await prisma.role.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { users: true } } } });
  if (!edit) {
    const [last, noMover, gaps] = await Promise.all([lastRoleChanges(roles.map((r) => r.id)), branchesWithoutHoldMover(), fundsGaps()]);
    return (
      <SettingsModal {...common} footer={{ kind: "done" }}>
        {gaps.length > 0 && <p role="status" className="mb-4 rounded-xl border border-act-line bg-act-bg px-4 py-2.5 text-sm font-semibold text-ink" data-funds-health>{gaps.join(" ")}</p>}
        {noMover.length > 0 && (
          // Who handles hold transfers, at a glance (read only; the Roles area needs "Manage roles").
          <div role="status" className="mb-4 rounded-xl border border-act-line bg-act-bg px-4 py-2.5 text-sm text-ink" data-hold-mover-health={noMover.length}>
            <p className="font-semibold">{holdMoverHealthText(noMover.length)}</p>
            <details className="mt-1">
              <summary className="link cursor-pointer text-sm">Show branches</summary>
              <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-ink-2" data-hold-mover-branches>
                {noMover.map((b) => <li key={b.id}>{b.name}{b.code ? ` (${b.code})` : ""}</li>)}
              </ul>
            </details>
          </div>
        )}
        <RolesList
          addHref={`${editBase}new`} editHrefBase={editBase}
          rows={roles.map((r) => ({
            id: r.id, name: r.name, builtIn: r.builtIn, active: r.active, people: r._count.users,
            on: effectivePermissions(r).size, total: ALL_PERMISSIONS.length, editHref: `${editBase}${r.id}`, lastChange: last.get(r.id) ?? null,
          }))}
        />
      </SettingsModal>
    );
  }
  const isNew = edit === "new";
  const role = isNew ? null : roles.find((r) => r.id === edit);
  if (!isNew && !role) return null;
  const people = role ? await prisma.user.findMany({ where: { roleId: role.id }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true, active: true } }) : [];
  return (
    <SettingsModal
      {...common}
      title={isNew ? "Roles and access: Add role" : `Roles and access: ${role!.name}`}
      help={isNew ? "Name the role, pick its branch access and tick what it may see and do." : role!.builtIn ? "Built-in role: the name is fixed; the ticks can change." : "Custom role."}
      backHref={listHref}
      footer={{ kind: "save", formId: "settings-form", cancelHref: listHref }}
    >
      <RoleEditor
        key={edit}
        formId="settings-form" listHref={listHref} editHrefBase={editBase}
        role={role
          ? { id: role.id, name: role.name, description: role.description, branchAccess: role.branchAccess, permissions: [...effectivePermissions(role)], builtIn: role.builtIn, active: role.active }
          : { id: null, name: "", description: "", branchAccess: "ASSIGNED", permissions: [PERMISSIONS.LOANS_VIEW], builtIn: false, active: true }}
        copyFrom={roles.filter((r) => r.id !== role?.id).map((r) => ({ id: r.id, name: r.name, permissions: [...effectivePermissions(r)], branchAccess: r.branchAccess }))}
        people={people}
        usedBy={role && role.active ? people.filter((p) => p.active).length : 0}
        peopleHref={role ? `/admin/users?role=${role.id}&status=all` : "/admin/users"}
      />
    </SettingsModal>
  );
}
const listHref_ = (key: string) => `${BASE}?open=${key}`;

const ENV_LABEL = { local: "Local", staging: "Staging", production: "Production" } as const;

/** Settings, System: the switches need settings:system; the PN format needs settings:pn_format (else read only). */
async function SystemArea({ user }: { user: CurrentUser }) {
  const switches = can(user, PERMISSIONS.SETTINGS_SYSTEM);
  const [unavailable, sim, overrides, pnFormat] = await Promise.all([
    getSetting("myloans.simulateUnavailable"),
    getSetting("simulator.enabled"),
    getSetting("myloans.mockOverrides"),
    getPnFormat(),
  ]);
  const mode = (process.env.MYLOANS_MODE ?? "mock").toLowerCase();
  const env = appEnv();
  const testMode = isTestMode();
  return (
    <div className="space-y-3">
      {/* Read only. Never shows a variable's value. */}
      <dl className="grid gap-2 rounded-xl bg-fill px-3 py-2 text-sm sm:grid-cols-2" data-env-line>
        <div className="flex min-h-9 items-center gap-2"><dt className="text-ink-2">Environment:</dt><dd className="font-semibold text-navy" data-env>{ENV_LABEL[env]}</dd></div>
        <div className="flex min-h-9 items-center gap-2"><dt className="text-ink-2">Test mode:</dt><dd className="font-semibold text-navy" data-test-mode>{testMode ? "On" : "Off"}</dd></div>
      </dl>
      {env !== "production" && testMode && (
        <p className="rounded-xl bg-act-bg px-3 py-2 text-[13px] font-semibold text-act-fg" data-test-mode-note>Test mode: sample loans and Reset test data are on, and every email goes to the test address, not to the real person.</p>
      )}
      <p className="flex min-h-11 items-center gap-2 rounded-xl bg-fill px-3 py-2 text-sm" data-timezone-line>
        <ClockIcon size={18} /> Times are shown in Philippine time (PHT)
      </p>
      <PnFormatForm value={pnFormat} readOnly={!can(user, PERMISSIONS.SETTINGS_PN_FORMAT)} />
      <p className="text-sm">MyLoans adapter: <span className="chip c-mute">{mode === "live" ? "Live (HTTP)" : "Mock"}</span> <span className="text-xs text-ink-2">Set with MYLOANS_MODE on the server.</span></p>
      {env !== "production" && switches && (
        <>
          <ToggleForm settingKey="myloans.simulateUnavailable" label="Simulate MyLoans unavailable" on={unavailable}
            description="The mock adapter answers every call as unavailable. New PNs cannot be opened; existing Loan Files show the stored copy as Not current." />
          <ToggleForm settingKey="simulator.enabled" label="Test-mode simulator" on={sim}
            description="Shows the simulator on each Loan File's Journey tab so Admin can push transactions through Phases 4 to 6. Every event is labelled Simulated." />
          {mode !== "live" && <MockOverrideForm current={Object.entries(overrides)} />}
        </>
      )}
    </div>
  );
}

/** Settings > System > Email notifications: the switch, the sender, test email, events, recent emails. */
async function EmailArea({ user, testMode, filter }: { user: CurrentUser; testMode: boolean; filter: OutboxFilter }) {
  const [active, events, templates, rows] = await Promise.all([getSetting("email.active"), getSetting("email.events"), getSetting("email.templates"), listOutbox(filter)]);
  const sender = senderLine();
  const canCsv = can(user, PERMISSIONS.SETTINGS_IMPORT);
  // Seeing (email:view) is not changing (email:manage): without it, no switches, edits, test email or Resend.
  const manage = can(user, PERMISSIONS.EMAIL_MANAGE);
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => !!v) as [string, string][]).toString();
  return (
    <div className="flex flex-col gap-5" data-email-area>
      <EmailMasterSwitch active={active} readOnly={!manage} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm" data-sender-line>{sender === "Not set up" ? <><span className="chip c-bad h-6 text-xs">Not set up</span> <span className="text-ink-2">The Microsoft settings are missing on the server.</span></> : sender}</p>
        {manage && <TestEmailButton defaultTo={user.email} testMode={testMode} testRecipient={!!process.env.EMAIL_TEST_RECIPIENT?.trim()} />}
      </div>
      {testMode && <p className="rounded-xl bg-act-bg px-3 py-2 text-[13px] font-semibold text-act-fg" data-test-mode-note>Test mode: every email goes to the test address, not to the real person.</p>}

      <section aria-labelledby="email-events-h">
        <h3 id="email-events-h" className="text-[15px] font-bold text-navy">Events</h3>
        <p className="text-[13px] text-ink-2">Each one is an update people already get in GDFI DMS. Only people with an email address and an active account get mail. Urgent ones always go; the rest respect each person&apos;s choice.</p>
        <ul className="mt-1">
          {EMAIL_EVENT_KEYS.map((k) => (
            <EmailEventRow key={k} e={{ key: k, label: EMAIL_EVENTS[k].label, to: EMAIL_EVENTS[k].to, urgent: EMAIL_EVENTS[k].urgent, on: events[k] !== false, edited: !!templates[k], editHref: `${BASE}?open=email&edit=${k}` }} readOnly={!manage} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="email-recent-h" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 id="email-recent-h" className="text-[15px] font-bold text-navy">Recent emails</h3>
          {canCsv && <a href={`/api/settings/emails${qs ? `?${qs}` : ""}`} className="link text-sm">Download CSV</a>}
        </div>
        <form method="get" action={BASE} className="flex flex-wrap items-end gap-2" aria-label="Filter recent emails">
          <input type="hidden" name="open" value="email" />
          <div><label htmlFor="em-status" className="label">Status</label>
            <select id="em-status" name="status" defaultValue={filter.status ?? ""} className="input h-10 w-36">
              <option value="">All</option><option value="SENT">Sent</option><option value="FAILED">Failed</option><option value="SKIPPED">Skipped</option><option value="QUEUED">Queued</option>
            </select></div>
          <div><label htmlFor="em-from" className="label">From</label><input id="em-from" name="from" type="date" defaultValue={filter.from ?? ""} className="input h-10 w-40" /></div>
          <div><label htmlFor="em-to" className="label">To</label><input id="em-to" name="to" type="date" defaultValue={filter.to ?? ""} className="input h-10 w-40" /></div>
          <button type="submit" className="btn-secondary h-10">Show</button>
        </form>
        <RecentEmails canResend={manage} rows={rows.map((r) => ({
          id: r.id, when: fmtDateTime(r.createdAt), event: r.event === "test" ? "Test email" : EMAIL_EVENTS[r.event as EmailEventKey]?.label ?? r.event,
          to: r.toName, address: r.toAddress && r.toAddress !== r.intendedAddress ? `${r.toAddress} (test address)` : r.toAddress ?? r.intendedAddress,
          status: r.status, reason: r.status === "SENT" ? (r.batchedIntoId ? "Sent together with others" : null) : r.lastError, subject: r.subject, html: r.html, text: r.text,
        }))} />
        {rows.length === 50 && (
          <a className="link self-start text-sm" href={`${BASE}?${new URLSearchParams({ ...Object.fromEntries(Object.entries(filter).filter(([k, v]) => !!v && k !== "before")), open: "email", before: rows[rows.length - 1].createdAt.toISOString() }).toString()}`}>Show older</a>
        )}
      </section>
    </div>
  );
}

async function syncStatusLine(): Promise<{ main: string; extra: string }> {
  const s = await syncStatus();
  return { main: `${s.mode === "live" ? "Live" : "Mock"} · ${s.health}`, extra: s.lastRun ? `last run ${fmtShort(s.lastRun.at)}` : "never run" };
}

/** The MyLoans sync card: health, statistics, tiers and settings (never the address or key). */
async function syncCardData(): Promise<SyncCardData> {
  const s = await syncStatus();
  const last = s.lastRun;
  const [onOpen, onFind, every, hours, max, pause, tiers, window, paused, noName] = await Promise.all([
    getSetting("myloans.refreshOnOpenMinutes"), getSetting("myloans.refreshOnFindHours"), getSetting("myloans.backgroundMinutes"), getSetting("myloans.businessHoursOnly"), getSetting("myloans.maxPerRun"), getSetting("myloans.pauseMs"),
    getSetting("myloans.tierMinutes"), getSetting("myloans.replacementWindowDays"), getSetting("myloans.paused"), getSetting("myloans.noNameLoans"),
  ]);
  const how = (t: string) => (t === "run_now" ? "Run now" : t === "cron" ? "Scheduled" : "Console");
  const feed = feedQualityLine(await accountFeedQuality());
  return {
    refreshOnOpenMinutes: onOpen, refreshOnFindHours: onFind, backgroundMinutes: every, businessHoursOnly: hours, maxPerRun: max, pauseMs: pause,
    tierA: tiers.A, tierB: tiers.B, tierC: tiers.C, hourlyCeiling: s.ceiling, replacementWindowDays: window, paused,
    mode: s.mode === "live" ? "Live" : "Mock", search: s.capabilities.search, changedSince: s.capabilities.changedSince, health: s.health, tiers: s.tiers,
    lines: [
      { label: "Mode", value: s.mode === "live" ? "Live (MyLoans API)" : "Mock (sample loans)" },
      { label: "MyLoans supports", value: [s.capabilities.search ? "search by part of a PN or name" : "the exact PN only", s.capabilities.changedSince ? "a changed-since feed (one call a run)" : "no changed-since feed (due loans are re-read)"].join("; ") },
      { label: "Last run", value: last ? `${fmtDateTime(last.at)} (${how(last.trigger)}, ${last.mode === "feed" ? "changed-since feed" : "due loans"})` : "Never" },
      { label: "Loans due / checked", value: last ? `${last.due} / ${last.checked}` : "-" },
      { label: "Calls made / saved", value: last ? `${last.calls} / ${last.saved} (shared or cached)` : "-" },
      { label: "Answer time", value: last && last.calls ? `${last.avgMs} ms average, ${last.maxMs} ms slowest` : "-" },
      { label: "Errors", value: last ? String(last.errors) : "-", bad: !!last?.errors },
      { label: "Loans updated / changes found", value: last ? `${last.updated} / ${last.changes}` : "-" },
      { label: "Run time", value: last ? `${last.ms} ms` : "-" },
      { label: "Current cap", value: `${s.cap ?? max} loans a run (at most ${max})` },
      { label: "This hour", value: `${s.hourCalls} of ${s.ceiling} calls` , bad: s.hourCalls >= s.ceiling },
      // Feed quality: the 15 MyLoans account items missing or empty across loan files (docs/myloans/field-map.md).
      { label: "Account details missing", value: feed.value, bad: feed.bad },
      // Refused at Find a loan / Open loan file: MyLoans has neither a personal name nor a company name.
      { label: "No borrower name in MyLoans (not opened)", value: noName.length ? noName.slice(0, 10).map((x) => `${x.pn}${x.branch ? ` (${x.branch})` : ""}`).join(", ") + (noName.length > 10 ? ` and ${noName.length - 10} more` : "") : "None", bad: noName.length > 0 },
      { label: "Last error", value: last?.error ?? (s.breaker.open ? "MyLoans did not answer several times; paused for a minute." : "None"), bad: !!last?.error || s.breaker.open },
    ],
    runs: s.runs.map((r) => ({
      when: fmtShort(r.at), trigger: how(r.trigger), mode: r.mode === "feed" ? "feed" : "due loans", status: r.status, due: r.due, calls: r.calls, saved: r.saved,
      avgMs: r.avgMs, maxMs: r.maxMs, errors: r.errors, ms: r.ms, updated: r.updated, changes: r.changes, cap: r.cap, hour: `${r.hourCalls} / ${r.ceiling}`,
    })),
  };
}

/** Only rendered when TEST_MODE=true. */
async function TestDataArea() {
  const showDataCheck = await getSetting("samples.showDataCheck");
  return (
    <div className="space-y-4">
      <p className="text-[15px] text-ink-2">
        {kitScreensAvailable()
          ? <>To start over, use <Link href={listHref("test-kit")} className="link">Test kit</Link>: it puts everything back to the starting state.</>
          : <>Starting over is done with the Manual Test Kit (<code>npm run kit:reset</code>), only on a local test setup with the database gdfi_dms.</>}
      </p>
      <ToggleForm settingKey="samples.showDataCheck" label="Show data-check test PNs" on={showDataCheck}
        description="Adds a second group, Data-check samples, under the sample loans on Find a loan: the PNs that test refusals (not released, missing field, other branch, and so on)." />
    </div>
  );
}

/**
 * Settings, Funds types: "Who handles it" for Cash advance and Fund transfer (read only, live from the
 * active people and the ticks on their roles), a soft amber line for what nobody can do, and a link to
 * the Funds group in Roles, where it is changed.
 */
async function WhoHandles() {
  const all = await fundsHandlers();
  return (
    <section aria-label="Who handles each type" className="mb-4 grid gap-3 lg:grid-cols-2" data-who-handles>
      {all.map((h) => (
        <div key={h.type} className="rounded-xl border border-line p-3" data-who-handles-type={h.type}>
          <h3 className="text-[15px] font-bold text-navy">{TYPE_TITLE[h.type]}: who handles it</h3>
          {h.gaps.length > 0 && <p role="status" className="mt-2 rounded-lg border border-act-line bg-act-bg px-3 py-1.5 text-sm text-ink" data-funds-gap>{h.gaps.join(" ")}</p>}
          <table className="mt-2 w-full text-sm">
            <thead className="sr-only"><tr><th scope="col">Step</th><th scope="col">Who can do it</th></tr></thead>
            <tbody>
              {h.steps.map((s) => (
                <tr key={s.step} className="border-t border-line first:border-t-0" data-handler-step={s.step}>
                  <th scope="row" className="w-28 py-1.5 pr-2 text-left align-top font-semibold text-ink">{STEP_TITLE[s.step]}</th>
                  <td className="py-1.5 align-top" data-handler-names>
                    {s.people.length === 0 ? <span className="text-ink-2">Nobody</span> : (
                      <>
                        {s.people.slice(0, 5).map((p, i) => (
                          <span key={`${p.name}-${i}`}>{i > 0 && ", "}{p.name} <span className="text-ink-2">({p.role})</span></span>
                        ))}
                        {s.people.length > 5 && <span className="text-ink-2"> +{s.people.length - 5} more</span>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-ink-2">If nobody can handle a step, requests of this type wait at that step and the Admin is notified.</p>
          <Link href={`${BASE}?open=roles`} className="link mt-1 inline-flex min-h-11 items-center text-sm" data-change-in-roles>Change in Roles</Link>
        </div>
      ))}
    </section>
  );
}

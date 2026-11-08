import { SearchIcon } from "./icons";
import { LiveFindInput } from "./live-find-input";

/**
 * "Find a loan" box, shown only on the Loans page (and its search results).
 * Loan Associate: submits to /search (PN; also CIN, CIF and Document ID).
 * Admin: submits to /loans and filters the list (pass action and hidden fields).
 * The input has id="find-loan" so the "/" shortcut can focus it.
 */
export function FindLoan({
  defaultValue = "", autoFocus = false, strong = false, action = "/search", hidden = {}, buttonLabel = "Find loan", required = true,
  placeholder = "PN number, e.g. PN-0001001", suggest,
}: {
  /** Live MyLoans suggestions (Find loan for the Loan Associate). */
  suggest?: { exactOnly: boolean };
  defaultValue?: string;
  autoFocus?: boolean;
  strong?: boolean;
  action?: string;
  hidden?: Record<string, string | undefined>;
  buttonLabel?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <form action={action} method="get" role="search" className="card flex flex-col gap-2 p-3 sm:p-5">
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <label htmlFor="find-loan" className="sr-only">Find a loan</label>
        <div className={`flex h-[54px] w-full min-w-0 shrink-0 items-center gap-3 rounded-xl bg-white px-5 focus-within:border-2 focus-within:border-navy focus-within:px-[19px] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-navy sm:flex-1 ${strong ? "border-2 border-navy px-[19px]" : "border border-line-input"}`}>
          <span className="text-navy"><SearchIcon size={20} /></span>
          {suggest ? (
            <LiveFindInput defaultValue={defaultValue} autoFocus={autoFocus} required={required} exactOnly={suggest.exactOnly}
              placeholder={suggest.exactOnly ? "Whole PN, e.g. PN-0001001" : "PN or borrower name, e.g. PN-0001001"}
              className="h-[50px] w-full min-w-0 bg-transparent text-base text-ink outline-none placeholder:text-ink-2 focus-visible:outline-none sm:text-[17px]" />
          ) : (
            <input
              id="find-loan"
              name="q"
              defaultValue={defaultValue}
              autoFocus={autoFocus}
              required={required}
              autoComplete="off"
              aria-describedby="find-loan-help"
              placeholder={placeholder}
              className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-2 focus-visible:outline-none sm:text-[17px]"
            />
          )}
        </div>
        <button type="submit" className="btn-gold h-[54px] min-h-[54px] w-full shrink-0 text-base sm:w-auto sm:px-8">{buttonLabel}</button>
      </div>
      <p id="find-loan-help" className="px-1 text-sm text-ink-2">Type a PN, CIN or CIF number.</p>
    </form>
  );
}

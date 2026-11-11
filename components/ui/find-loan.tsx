import { SearchIcon } from "./icons";
import { LiveFindInput } from "./live-find-input";

/**
 * The "Find a loan" search row (the Find a loan page): one input and the gold Find loan button, the
 * same height, no outer card. On a phone the button goes full width under the input.
 * The suggestions dropdown lines up with the search box on the left and the whole row on the right
 * (the box only, on a phone, where the button sits under it).
 * Submits to /search (PN; also CIN, CIF and Document ID). The input has id="find-loan" so the "/"
 * shortcut and the sample loans can reach it.
 */
export function FindLoan({
  defaultValue = "", autoFocus = false, action = "/search", hidden = {}, buttonLabel = "Find loan", required = true,
  placeholder = "PN, CIN or CIF", suggest,
}: {
  /** Live MyLoans suggestions (Find loan for the Loan Associate). */
  suggest?: { exactOnly: boolean };
  defaultValue?: string;
  autoFocus?: boolean;
  action?: string;
  hidden?: Record<string, string | undefined>;
  buttonLabel?: string;
  required?: boolean;
  placeholder?: string;
}) {
  const inputCls = "h-12 w-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-2 focus-visible:outline-none";
  return (
    <form action={action} method="get" role="search" className="flex flex-col gap-2 sm:relative sm:flex-row sm:items-center sm:gap-3" data-find-row>
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label htmlFor="find-loan" className="sr-only">Find a loan</label>
      <div className="relative flex h-12 w-full min-w-0 items-center gap-2.5 rounded-xl border border-line-input bg-white pl-4 pr-3 focus-within:border-navy focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-navy sm:static sm:flex-1" data-find-box>
        <span className="text-navy"><SearchIcon size={18} /></span>
        {suggest ? (
          <LiveFindInput defaultValue={defaultValue} autoFocus={autoFocus} required={required} exactOnly={suggest.exactOnly} placeholder={placeholder} className={inputCls} panelAlign="row" />
        ) : (
          <input id="find-loan" name="q" defaultValue={defaultValue} autoFocus={autoFocus} required={required} autoComplete="off" placeholder={placeholder} className={inputCls} />
        )}
      </div>
      <button type="submit" className="btn-gold h-12 min-h-12 w-full shrink-0 px-6 text-base sm:w-auto">{buttonLabel}</button>
    </form>
  );
}

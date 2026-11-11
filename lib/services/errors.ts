/** An error whose message is safe and useful to show the user. Optionally names the field. */
export class UserError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "UserError";
  }
}

/** Raised when a record is outside the user's scope: callers show 404, never "forbidden". */
export class NotInScopeError extends Error {
  constructor() {
    super("Not found");
    this.name = "NotInScopeError";
  }
}

/**
 * Refused because papers are not answered: "Still needed: A, B." (neither Present nor Missing) and/or
 * "Add remarks for: C, D." (marked Missing without saved remarks). `missing` and `needsRemarks` hold
 * the plain names so the screen can show the same lists.
 */
export class MissingPapersError extends UserError {
  constructor(public readonly missing: string[], public readonly needsRemarks: string[] = []) {
    super([missing.length ? `Still needed: ${missing.join(", ")}.` : "", needsRemarks.length ? `Add remarks for: ${needsRemarks.join(", ")}.` : ""].filter(Boolean).join(" "), "missing");
    this.name = "MissingPapersError";
  }
}

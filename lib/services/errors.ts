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
 * Refused because required papers are not ticked. The message is "Still needed: A, B." and
 * `missing` holds the plain names so the screen can show the same list.
 */
export class MissingPapersError extends UserError {
  constructor(public readonly missing: string[]) {
    super(`Still needed: ${missing.join(", ")}.`, "missing");
    this.name = "MissingPapersError";
  }
}

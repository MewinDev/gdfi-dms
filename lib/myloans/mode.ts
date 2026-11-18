/** MYLOANS_MODE: mock (the default; local and staging only) or live. */
export const myLoansMode = (): "mock" | "live" => ((process.env.MYLOANS_MODE ?? "mock").toLowerCase() === "live" ? "live" : "mock");

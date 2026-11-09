/** Writes the generated part of docs/workflow/12-permissions.md from lib/auth/permissions.ts. */
import { readFileSync, writeFileSync } from "node:fs";
import { DOC_FILE, withGenerated } from "../lib/docs/permissions-doc";

const before = readFileSync(DOC_FILE, "utf8");
const after = withGenerated(before);
if (after === before) console.log(`${DOC_FILE} is up to date.`);
else { writeFileSync(DOC_FILE, after); console.log(`Updated ${DOC_FILE}.`); }

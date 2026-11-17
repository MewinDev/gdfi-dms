import { handleMockRequest } from "@/lib/myloans/v1/mock-handler";

/**
 * The myloans MOCK (piece 6, D-047, D-048). Answers only while MYLOANS_MODE=mock outside production; elsewhere 404.
 * Machine-to-machine like the real myloans API: no session, a Bearer key instead (checked in the handler).
 */
export async function GET(req: Request) {
  return handleMockRequest(req);
}

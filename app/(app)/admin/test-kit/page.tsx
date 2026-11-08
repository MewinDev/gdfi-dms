import { redirect } from "next/navigation";
import { requirePageAny } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { kitPageOrNotFound } from "@/lib/kit/access";

/** /admin/test-kit opens Settings > Test kit. Not found unless the kit is available here (local test setup, gdfi_dms). */
export default async function TestKitPage() {
  kitPageOrNotFound();
  await requirePageAny([PERMISSIONS.TESTDATA_RESET]);
  redirect("/admin/settings?open=test-kit");
}

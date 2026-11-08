"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { testProvider } from "@/lib/auth/providers";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/auth/current-user";

function safeNext(next: FormDataEntryValue | null): string {
  const v = typeof next === "string" ? next : "";
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/login") ? v : "/dashboard";
}

export async function testSignIn(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const user = await testProvider.resolveUser(email);
  if (!user) redirect("/login?error=test-user");
  const token = await signSession({ sub: user.id, provider: "test" });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions);
  await prisma.auditLog.create({
    data: { actorId: user.id, actorLabel: user.name, mode: "MANUAL", action: "signed_in", entityType: "User", entityId: user.id, summary: `Signed in with test sign-in as ${user.role.name}` },
  });
  redirect(safeNext(formData.get("next")));
}

export async function signOut() {
  const user = await getCurrentUser();
  if (user) {
    await prisma.auditLog.create({
      data: { actorId: user.id, actorLabel: user.name, mode: "MANUAL", action: "signed_out", entityType: "User", entityId: user.id, summary: "Signed out" },
    });
  }
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

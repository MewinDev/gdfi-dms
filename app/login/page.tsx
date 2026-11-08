import type { Metadata } from "next";
import Image from "next/image";
import { prisma } from "@/lib/db";
import { authMode } from "@/lib/auth/providers";
import { maySignIn } from "@/lib/auth/access";
import { isTestMode } from "@/lib/test-mode";
import { testSignIn } from "./actions";
import { KIT_EMAIL_DOMAIN } from "@/lib/kit/catalog";

export const metadata: Metadata = { title: "Sign in" };

function MicrosoftMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="0" y="0" width="10" height="10" fill="var(--ms-red)" />
      <rect x="11" y="0" width="10" height="10" fill="var(--ms-green)" />
      <rect x="0" y="11" width="10" height="10" fill="var(--ms-blue)" />
      <rect x="11" y="11" width="10" height="10" fill="var(--ms-yellow)" />
    </svg>
  );
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const testMode = authMode() === "test";
  const testUsers = testMode
    ? await prisma.user.findMany({
        where: { isTestUser: true, active: true },
        include: { role: true, branches: { include: { branch: true } } },
        orderBy: { name: "asc" },
      }).then((us) => us.filter((u) => maySignIn(u, u.role, isTestMode()))) // includes custom-role test users in test mode
    : [];
  // The Manual Test Kit's sample accounts (@example.test): one button each, with the role and branches.
  const kitAccounts = testUsers.filter((u) => u.email.endsWith(KIT_EMAIL_DOMAIN));
  const FIXED = [["test.admin@gdfi.ph", "Continue as Admin", "login-btn-secondary"], ["test.la@gdfi.ph", "Continue as Loan Associate", "login-btn-primary"]] as const;
  const fixed = FIXED.filter(([email]) => testUsers.some((u) => u.email === email));
  const otherTestUsers = testUsers.filter((u) => !kitAccounts.includes(u) && !FIXED.some(([email]) => email === u.email));
  // Test Document Processor and Test Finance get their own buttons, only when TEST_MODE is on.
  const QUICK = [["test.dp@gdfi.ph", "Continue as Test Document Processor"], ["test.finance@gdfi.ph", "Continue as Test Finance"]] as const;
  const quick = isTestMode() ? QUICK.filter(([email]) => otherTestUsers.some((u) => u.email === email)) : [];
  const dropdownUsers = otherTestUsers.filter((u) => !quick.some(([email]) => email === u.email));

  return (
    <main
      className="flex min-h-screen items-center justify-center px-4 py-10"
      style={{
        background:
          "radial-gradient(1200px 600px at 85% 15%, var(--navy-light) 0%, transparent 60%), radial-gradient(900px 500px at 10% 90%, var(--navy-mid) 0%, transparent 60%), linear-gradient(135deg, var(--navy-deep) 0%, var(--navy-mid) 55%, var(--navy-deep) 100%)",
      }}
    >
      <div className="w-full max-w-[532px] rounded-[20px] bg-white px-8 py-12 text-center shadow-[var(--shadow-card)] sm:px-12">
        <div className="mx-auto flex h-[112px] w-[112px] items-center justify-center rounded-2xl bg-white shadow-[var(--shadow-tile)]">
          <Image src="/logo.jpg" alt="GDFI logo" width={84} height={84} priority />
        </div>
        <h1 className="mt-7 text-[22px] font-bold text-navy">Global Dominion Financing, Inc.</h1>
        <p className="mt-1 text-base text-ink-2">Loan Document Management System</p>
        <div className="mx-auto mt-4 h-[3px] w-[76px] rounded-full bg-gold" aria-hidden="true" />

        <button
          type="button"
          disabled
          aria-describedby="ms-help"
          title="Microsoft sign-in is not connected yet"
          className="mt-9 flex h-14 w-full items-center justify-center gap-3 rounded-xl bg-navy text-[17px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          <MicrosoftMark />
          Sign in with Microsoft
        </button>
        <p id="ms-help" className="mt-4 text-sm text-ink-2">
          Use your <span className="font-semibold text-ink">@gdfi.ph</span> corporate email
        </p>

        {testMode && (
          <section aria-labelledby="test-signin-title" className="mt-7 rounded-xl border border-dashed border-line bg-cream p-4 text-left">
            <div className="flex items-center justify-between gap-2">
              <h2 id="test-signin-title" className="text-sm font-bold text-navy">
                Test sign-in
              </h2>
              <span className="login-chip bg-warn-bg text-warn-fg">Test mode</span>
            </div>
            <p className="mt-1 text-xs text-ink-2">For testing only. Microsoft sign-in replaces this in production.</p>
            {error === "test-user" && (
              <p role="alert" className="mt-2 rounded-md bg-err-bg px-3 py-2 text-xs text-err-fg">
                That test user is not available. It may be inactive.
              </p>
            )}
            {kitAccounts.length > 0 && (
              <ul aria-label="Sample accounts" className="mt-3 grid gap-2 sm:grid-cols-2" data-kit-accounts>
                {kitAccounts.map((u) => (
                  <li key={u.id}>
                    <form action={testSignIn}>
                      <input type="hidden" name="email" value={u.email} />
                      <input type="hidden" name="next" value={next ?? ""} />
                      <button type="submit" className="login-btn-secondary flex h-auto min-h-14 w-full flex-col items-start gap-0.5 py-2 text-left">
                        <span className="font-semibold">Continue as {u.name}</span>
                        <span className="text-xs font-normal text-ink-2">{u.role.name} · {u.branches.map((b) => b.branch.name).sort().join(", ") || "No branch"}</span>
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {fixed.map(([email, label, cls]) => (
                <form key={email} action={testSignIn}>
                  <input type="hidden" name="email" value={email} />
                  <input type="hidden" name="next" value={next ?? ""} />
                  <button type="submit" className={`${cls} w-full`}>
                    {label}
                  </button>
                </form>
              ))}
              {quick.map(([email, label]) => (
                <form key={email} action={testSignIn}>
                  <input type="hidden" name="email" value={email} />
                  <input type="hidden" name="next" value={next ?? ""} />
                  <button type="submit" className="login-btn-secondary w-full">
                    {label}
                  </button>
                </form>
              ))}
            </div>
            {dropdownUsers.length > 0 && (
              <form action={testSignIn} className="mt-3 flex gap-2">
                <input type="hidden" name="next" value={next ?? ""} />
                <label htmlFor="other-user" className="sr-only">
                  Other test user
                </label>
                <select id="other-user" name="email" className="login-input">
                  {dropdownUsers.map((u) => (
                    <option key={u.id} value={u.email}>
                      {u.name} ({u.role.name})
                    </option>
                  ))}
                </select>
                <button type="submit" className="login-btn-secondary shrink-0">
                  Continue
                </button>
              </form>
            )}
          </section>
        )}

        <hr className="mt-9 border-line/60" />
        <p className="mt-6 text-sm text-ink-2">© 2026 Global Dominion Financing, Inc. All rights reserved.</p>
      </div>
    </main>
  );
}

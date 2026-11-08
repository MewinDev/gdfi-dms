import { SignJWT, jwtVerify } from "jose";

/**
 * Signed, httpOnly session cookie. Works in the proxy and in server code.
 * The session holds only the user id and the identity provider that signed the user in;
 * roles and branches are re-read from the database on every request.
 */

export const SESSION_COOKIE = "gdfi_dms_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 10; // 10 hours (one working day)

export interface SessionPayload {
  sub: string; // user id
  provider: "test" | "entra";
}

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters (see .env.example).");
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ provider: payload.provider })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setIssuer("gdfi-dms")
    .setExpirationTime(`${SESSION_MAX_AGE_S}s`)
    .sign(secretKey());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: "gdfi-dms", algorithms: ["HS256"] });
    if (!payload.sub) return null;
    return { sub: payload.sub, provider: payload.provider === "entra" ? "entra" : "test" };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE_S,
};

import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4 for an S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi, Supabase
 * Storage's S3 endpoint). Pure: no network. Path-style URLs (endpoint/bucket/key), the payload hashed.
 */
const hex = (b: Buffer | string) => (typeof b === "string" ? b : b.toString("hex"));
export const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
/** RFC 3986 encoding as S3 expects (slashes kept in the path). */
export const encodeKey = (s: string, keepSlash = true) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(keepSlash ? /%2F/g : /$^/, "/");

export interface SignInput {
  method: string; url: URL; region: string; accessKeyId: string; secretAccessKey: string;
  payloadHash: string; now?: Date; headers?: Record<string, string>; service?: string;
}

/** Returns the headers to send (Authorization, x-amz-date, x-amz-content-sha256, host and the extras). */
export function signV4(i: SignInput): Record<string, string> {
  const now = i.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const service = i.service ?? "s3";
  const headers: Record<string, string> = { host: i.url.host, "x-amz-content-sha256": i.payloadHash, "x-amz-date": amzDate, ...Object.fromEntries(Object.entries(i.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])) };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n].trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const query = [...i.url.searchParams.entries()].map(([k, v]) => [encodeKey(k, false), encodeKey(v, false)]).sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
  const canonicalRequest = [i.method, i.url.pathname, query, canonicalHeaders, signedHeaders, i.payloadHash].join("\n");
  const scope = `${day}/${i.region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${i.secretAccessKey}`, day), i.region), service), "aws4_request");
  const signature = hex(hmac(kSigning, toSign));
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

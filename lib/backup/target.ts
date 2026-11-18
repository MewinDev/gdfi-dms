import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { encodeKey, sha256, signV4 } from "./sigv4";

/**
 * Where backups go (D-055): a folder (a local disk, a mounted NAS or network share) or an S3-compatible bucket (keys
 * from the environment, never in the repository). A backup is a "set": a name (gdfi-dms-YYYYMMDD-HHMMSS) and the files
 * under it. Both targets offer the same five operations, so backup and restore never care which one it is.
 */
export interface BackupTarget {
  label: string;
  /** Upload one local file as <set>/<rel>. */
  put(set: string, rel: string, localFile: string): Promise<void>;
  /** Download <set>/<rel> to a local file. */
  get(set: string, rel: string, localFile: string): Promise<void>;
  /** Every file of a set, relative to it. */
  list(set: string): Promise<string[]>;
  /** Every set name. */
  sets(): Promise<string[]>;
  remove(set: string): Promise<void>;
}

export class FolderTarget implements BackupTarget {
  readonly label: string;
  constructor(private readonly root: string) { this.label = `folder ${root}`; }
  private at(set: string, rel = "") {
    const full = path.resolve(this.root, set, rel);
    if (!full.startsWith(path.resolve(this.root))) throw new Error("A backup path must stay inside the backup folder.");
    return full;
  }
  async put(set: string, rel: string, localFile: string) {
    const to = this.at(set, rel);
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(localFile, to);
  }
  async get(set: string, rel: string, localFile: string) {
    await mkdir(path.dirname(localFile), { recursive: true });
    await copyFile(this.at(set, rel), localFile);
  }
  async list(set: string) { return walk(this.at(set)); }
  async sets() {
    try { return (await readdir(this.root, { withFileTypes: true })).filter((d) => d.isDirectory() && d.name.startsWith("gdfi-dms-")).map((d) => d.name).sort(); } catch { return []; }
  }
  async remove(set: string) { await rm(this.at(set), { recursive: true, force: true }); }
}

/** Every file under a folder, relative to it, with forward slashes. */
export async function walk(dir: string, base = dir): Promise<string[]> {
  let out: string[] = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(await walk(full, base));
    else if (e.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort();
}

export interface S3Config { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string; prefix: string }

/** An S3-compatible bucket, path-style. Turn on versioning on the bucket itself (the runbook says how). */
export class S3Target implements BackupTarget {
  readonly label: string;
  constructor(private readonly c: S3Config, private readonly fetchImpl: typeof fetch = fetch) { this.label = `bucket ${c.bucket}${c.prefix ? `/${c.prefix}` : ""}`; }
  private url(key: string, query: Record<string, string> = {}) {
    const u = new URL(`${this.c.endpoint.replace(/\/+$/, "")}/${encodeKey(this.c.bucket)}${key ? `/${encodeKey(key)}` : ""}`);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    return u;
  }
  private key(set: string, rel = "") { return [this.c.prefix.replace(/^\/+|\/+$/g, ""), set, rel].filter(Boolean).join("/"); }
  private async send(method: string, url: URL, body?: Buffer) {
    const payloadHash = sha256(body ?? "");
    const headers = signV4({ method, url, region: this.c.region, accessKeyId: this.c.accessKeyId, secretAccessKey: this.c.secretAccessKey, payloadHash });
    delete headers.host;
    const res = await this.fetchImpl(url, { method, headers, body: body ? new Uint8Array(body) : undefined });
    // Never echo the response body: a misconfigured endpoint could reflect headers.
    if (!res.ok && !(method === "DELETE" && res.status === 404)) throw new Error(`The backup bucket answered ${res.status} to ${method}. Check the endpoint, bucket and keys.`);
    return res;
  }
  async put(set: string, rel: string, localFile: string) { await this.send("PUT", this.url(this.key(set, rel)), await readFile(localFile)); }
  async get(set: string, rel: string, localFile: string) {
    const res = await this.send("GET", this.url(this.key(set, rel)));
    await mkdir(path.dirname(localFile), { recursive: true });
    await writeFile(localFile, Buffer.from(await res.arrayBuffer()));
  }
  private async keys(prefix: string): Promise<string[]> {
    const out: string[] = [];
    let token: string | null = null;
    do {
      const res = await this.send("GET", this.url("", { "list-type": "2", prefix, ...(token ? { "continuation-token": token } : {}) }));
      const xml = await res.text();
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) out.push(m[1].replace(/&amp;/g, "&"));
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? null) : null;
    } while (token);
    return out;
  }
  async list(set: string) { const p = `${this.key(set)}/`; return (await this.keys(p)).map((k) => k.slice(p.length)).sort(); }
  async sets() {
    const p = this.c.prefix ? `${this.c.prefix.replace(/^\/+|\/+$/g, "")}/` : "";
    return [...new Set((await this.keys(`${p}gdfi-dms-`)).map((k) => k.slice(p.length).split("/")[0]))].sort();
  }
  async remove(set: string) { for (const rel of await this.list(set)) await this.send("DELETE", this.url(this.key(set, rel))); }
}

/** The target from the environment (D-055). BACKUP_TARGET=folder (BACKUP_DIR) or s3 (BACKUP_S3_*). */
export function targetFromEnv(env: Record<string, string | undefined> = process.env): BackupTarget {
  const kind = (env.BACKUP_TARGET ?? "folder").toLowerCase();
  if (kind === "s3") {
    const need = ["BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"].filter((k) => !env[k]?.trim());
    if (need.length) throw new Error(`BACKUP_TARGET=s3 needs ${need.join(", ")} (set them in the environment, never in the repository).`);
    return new S3Target({ endpoint: env.BACKUP_S3_ENDPOINT!.trim(), bucket: env.BACKUP_S3_BUCKET!.trim(), region: env.BACKUP_S3_REGION?.trim() || "us-east-1", accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID!.trim(), secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY!.trim(), prefix: env.BACKUP_S3_PREFIX?.trim() ?? "" });
  }
  if (kind !== "folder") throw new Error("BACKUP_TARGET must be folder or s3.");
  return new FolderTarget(path.resolve(env.BACKUP_DIR?.trim() || "./backups/sets"));
}

export async function sizeOf(file: string) { return (await stat(file)).size; }

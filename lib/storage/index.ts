import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Attachment storage (the Attachment entity stores the returned key).
 * STORAGE_DRIVER=local (now) writes under STORAGE_LOCAL_DIR.
 * TODO(Supabase Storage): implement SupabaseStorage with the Storage REST API
 * (bucket from SUPABASE_STORAGE_BUCKET, service key from SUPABASE_SERVICE_ROLE_KEY) on the server only.
 * Access control stays in the DMS server code, never in bucket policies.
 */
export interface StorageDriver {
  put(data: Buffer, opts: { fileName: string; contentType: string; prefix?: string }): Promise<{ key: string; sizeBytes: number }>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

class LocalDiskStorage implements StorageDriver {
  constructor(private readonly root = path.resolve(process.env.STORAGE_LOCAL_DIR ?? "./storage")) {}

  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(data: Buffer, opts: { fileName: string; contentType: string; prefix?: string }) {
    const safe = opts.fileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
    const key = [opts.prefix?.replace(/[^A-Za-z0-9_-]/g, "_"), `${randomUUID()}-${safe}`].filter(Boolean).join("/");
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
    return { key, sizeBytes: data.length };
  }

  async get(key: string) {
    return readFile(this.resolve(key));
  }

  async remove(key: string) {
    await unlink(this.resolve(key)).catch(() => undefined);
  }
}

export function getStorage(): StorageDriver {
  const driver = (process.env.STORAGE_DRIVER ?? "local").toLowerCase();
  if (driver === "supabase") throw new Error("TODO: Supabase Storage driver is not implemented yet. Use STORAGE_DRIVER=local.");
  return new LocalDiskStorage();
}

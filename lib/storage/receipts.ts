import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Receipt storage adapter. Today: a local folder (RECEIPTS_DIR, default ./storage/receipts),
 * random file names, never the uploaded name on disk. Swap `localStore` for a cloud store later.
 */
export interface ReceiptStore {
  put(bytes: Uint8Array, ext: string): Promise<string>;
  get(key: string): Promise<Uint8Array>;
}

const ROOT = path.resolve(process.env.RECEIPTS_DIR ?? path.join(process.cwd(), "storage", "receipts"));
const KEY = /^[0-9a-f-]{36}\.(png|jpg|pdf|webp)$/;

export const localStore: ReceiptStore = {
  async put(bytes, ext) {
    await mkdir(ROOT, { recursive: true });
    const key = `${randomUUID()}.${ext}`;
    await writeFile(path.join(ROOT, key), bytes);
    return key;
  },
  async get(key) {
    if (!KEY.test(key)) throw new Error("Bad receipt key");
    return new Uint8Array(await readFile(path.join(ROOT, key)));
  },
};

export const receiptStore: ReceiptStore = localStore;

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

/** Content check from the first bytes (not the browser's claimed type). Null when not allowed. */
export function sniffReceipt(b: Uint8Array): { mime: string; ext: "png" | "jpg" | "pdf" | "webp" } | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, j) => b[i + j] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { mime: "image/png", ext: "png" };
  if (at(0, 0xff, 0xd8, 0xff)) return { mime: "image/jpeg", ext: "jpg" };
  if (at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return { mime: "application/pdf", ext: "pdf" };
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return { mime: "image/webp", ext: "webp" };
  return null;
}

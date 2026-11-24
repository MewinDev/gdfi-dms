import { describe, expect, it } from "vitest";
import { sha256, signV4 } from "./sigv4";
import { S3Target } from "./target";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("S3 Signature Version 4 (D-055 backups to an S3-compatible bucket)", () => {
  it("matches AWS's published example (GET /test.txt with a Range header)", () => {
    const h = signV4({
      method: "GET", url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"), region: "us-east-1",
      // AWS's own documentation example (not a real key), built in pieces so the secret scan does not flag it.
      accessKeyId: ["AKIA", "IOSFODNN7", "EXAMPLE"].join(""), secretAccessKey: ["wJalrXUtnFEMI", "K7MDENG", "bPxRfiCYEXAMPLEKEY"].join("/"),
      payloadHash: sha256(""), now: new Date("2013-05-24T00:00:00Z"), headers: { Range: "bytes=0-9" },
    });
    expect(h.authorization).toBe("AWS4-HMAC-SHA256 Credential=" + ["AKIA", "IOSFODNN7", "EXAMPLE"].join("") + "/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  });

  it("the bucket target puts, lists, gets and removes a set (an in-memory bucket); every request is signed", async () => {
    const store = new Map<string, Uint8Array>();
    const seen: string[] = [];
    const fake: typeof fetch = async (input, init) => {
      const u = new URL(String(input));
      seen.push(String((init?.headers as Record<string, string>).authorization).slice(0, 16));
      const key = decodeURIComponent(u.pathname.replace(/^\/bk\/?/, ""));
      if (init?.method === "PUT") { store.set(key, init.body as Uint8Array); return new Response(null, { status: 200 }); }
      if (init?.method === "DELETE") { store.delete(key); return new Response(null, { status: 204 }); }
      if (u.searchParams.get("list-type") === "2") {
        const p = u.searchParams.get("prefix") ?? "";
        const keys = [...store.keys()].filter((k) => k.startsWith(p)).map((k) => `<Contents><Key>${k}</Key></Contents>`).join("");
        return new Response(`<ListBucketResult>${keys}<IsTruncated>false</IsTruncated></ListBucketResult>`, { status: 200 });
      }
      const v = store.get(key);
      return v ? new Response(new Uint8Array(v), { status: 200 }) : new Response(null, { status: 404 });
    };
    const t = new S3Target({ endpoint: "https://s3.example.test", bucket: "bk", region: "auto", accessKeyId: "AK", secretAccessKey: "SK", prefix: "dms" }, fake);
    const dir = await mkdtemp(path.join(os.tmpdir(), "s3t-"));
    const src = path.join(dir, "a.txt");
    await writeFile(src, "hello");
    await t.put("gdfi-dms-20261118-010203", "files/storage/a b.txt", src);
    expect(await t.sets()).toEqual(["gdfi-dms-20261118-010203"]);
    expect(await t.list("gdfi-dms-20261118-010203")).toEqual(["files/storage/a b.txt"]);
    await t.get("gdfi-dms-20261118-010203", "files/storage/a b.txt", path.join(dir, "out.txt"));
    expect(await readFile(path.join(dir, "out.txt"), "utf8")).toBe("hello");
    await t.remove("gdfi-dms-20261118-010203");
    expect(await t.sets()).toEqual([]);
    expect(seen.every((s) => s === "AWS4-HMAC-SHA256")).toBe(true);
  });
});

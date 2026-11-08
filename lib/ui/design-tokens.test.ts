import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The soft status palette is the rule (app/globals.css): every status has a very light background, a
 * dark text colour and a thin border, and the text meets WCAG AA (4.5:1) on its background. No pill
 * is a filled navy (or filled gold) block.
 */
const css = readFileSync(path.resolve("app/globals.css"), "utf8");
const root = css.slice(css.indexOf(":root {"), css.indexOf("\n}", css.indexOf(":root {")));
const token = (name: string): string => {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(root);
  if (!m) throw new Error(`--${name} is not defined in :root`);
  const v = m[1].trim();
  const ref = /^var\(--([\w-]+)\)$/.exec(v);
  return ref ? token(ref[1]) : v;
};

type RGBA = [number, number, number, number];
function parse(c: string): RGBA {
  const hex = /^#([0-9a-f]{6})$/i.exec(c);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as RGBA;
  const rgb = /^rgb\((\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+))?\)$/.exec(c);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
  throw new Error(`cannot read colour ${c}`);
}
/** A colour with transparency, laid over a solid background. */
const over = (fg: RGBA, bg: RGBA): RGBA => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1) as RGBA;
const lum = (c: RGBA) => {
  const [r, g, b] = c.slice(0, 3).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function contrast(fgCss: string, bgCss: string): number {
  const bg = over(parse(bgCss), [255, 255, 255, 1]);
  const fg = over(parse(fgCss), bg);
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const STATUSES = ["hold", "missing", "problem", "sent", "done", "neutral"] as const;

describe("Soft status palette", () => {
  it.each(STATUSES)("%s: a very light background, a dark text colour and a thin border", (s) => {
    const bg = parse(token(`${s}-bg`));
    expect(lum(bg), `${s} background is very light`).toBeGreaterThan(0.8);
    expect(lum(parse(token(`${s}-fg`))), `${s} text is dark`).toBeLessThan(0.15);
    expect(() => token(`${s}-line`)).not.toThrow();
  });

  it.each(STATUSES)("%s: text meets WCAG AA (4.5:1) on its background, and so does secondary text", (s) => {
    expect(contrast(token(`${s}-fg`), token(`${s}-bg`))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("ink"), token(`${s}-bg`))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("ink-2"), token(`${s}-bg`))).toBeGreaterThanOrEqual(4.5);
  });

  it("the component names map onto the soft palette (act = amber, wait = blue-grey, ok = green, bad = red, mute = grey)", () => {
    expect(token("act-bg")).toBe(token("missing-bg"));
    expect(token("wait-bg")).toBe(token("sent-bg"));
    expect(token("ok-bg")).toBe(token("done-bg"));
    expect(token("bad-bg")).toBe(token("problem-bg"));
    expect(token("mute-bg")).toBe(token("neutral-bg"));
    // Text on white (the calm hold card) stays readable.
    for (const s of STATUSES) expect(contrast(token(`${s}-fg`), "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("chip classes are soft: no filled navy, each with a thin border", () => {
    for (const cls of ["c-act", "c-hold", "c-wait", "c-ok", "c-bad", "c-navy", "c-mute"]) {
      const rule = new RegExp(`\\.${cls} \\{\\s*@apply ([^;]+);`).exec(css);
      expect(rule, `.${cls}`).not.toBeNull();
      expect(rule![1], `.${cls}`).not.toMatch(/\bbg-navy\b|\btext-white\b/);
      expect(rule![1], `.${cls}`).toMatch(/\bborder-[\w-]+-line\b/);
    }
  });

  it("no pill in the screens is a filled navy or gold block", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = path.join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".tsx")) files.push(p);
      }
    };
    walk(path.resolve("components"));
    walk(path.resolve("app"));
    const bad: string[] = [];
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(/className=\{?[`"]([^`"]*\bchip\b[^`"]*)[`"]/g)) {
        if (/(?<![:\w-])bg-(navy|gold)(?![\w/-])/.test(m[1])) bad.push(`${path.relative(process.cwd(), f)}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

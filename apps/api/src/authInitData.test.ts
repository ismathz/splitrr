import { describe, expect, it } from "bun:test";
import {
  collectInitDataCandidates,
  expandInitDataVariants
} from "./authInitData";

describe("expandInitDataVariants", () => {
  it("restores plus signs turned into spaces", () => {
    const variants = expandInitDataVariants("foo bar+baz");
    expect(variants).toContain("foo bar+baz");
    expect(variants).toContain("foo+bar+baz");
  });
});

describe("collectInitDataCandidates", () => {
  it("collects authorization, header, query, and form sources", () => {
    const initData =
      "user=%7B%22id%22%3A1%7D&auth_date=1700000000&hash=abcdef";
    const c = {
      req: {
        header: (name: string) => {
          const n = name.toLowerCase();
          if (n === "authorization") return `tma ${initData}-auth`;
          if (n === "x-telegram-init-data") return `${initData}-hdr`;
          return undefined;
        },
        query: (name: string) =>
          name === "tgWebAppData" ? `${initData}-query` : undefined
      }
    } as any;

    const candidates = collectInitDataCandidates(c, {
      initData: `${initData}-form`,
      file: new File(["x"], "x.jpg")
    });
    expect(candidates.map((x) => x.source)).toEqual([
      "form.initData",
      "authorization",
      "x-telegram-init-data",
      "query.tgWebAppData"
    ]);
  });
});

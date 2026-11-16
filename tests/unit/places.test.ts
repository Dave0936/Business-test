import { describe, expect, it } from "vitest";
import { listCountries, searchTowns, townById } from "@/lib/places";

describe("GeoNames places", () => {
  it("lists countries with town counts and languages", async () => {
    const c = await listCountries();
    expect(c.length).toBeGreaterThan(200);
    const gb = c.find((x) => x.code === "GB")!;
    expect(gb.name).toBe("United Kingdom");
    expect(gb.towns).toBeGreaterThan(500);
    expect(c.find((x) => x.code === "FR")!.languages[0]).toBe("fr");
  });

  it("finds towns by prefix, accent-insensitive, biggest first", async () => {
    const ed = await searchTowns("GB", "edinb");
    expect(ed[0]).toMatchObject({ name: "Edinburgh", regionName: "Scotland" });
    const z = await searchTowns("CH", "zurich");
    expect(z[0].name).toBe("Zürich");
    const gla = await searchTowns("GB", "glas");
    expect(gla[0].name).toBe("Glasgow");
  });

  it("is safe with odd input", async () => {
    expect(await searchTowns("../../etc", "x")).toEqual([]);
    expect(await searchTowns("ZZ", "x")).toEqual([]);
    expect((await searchTowns("GB", "")).length).toBeGreaterThan(0);
    const london = (await searchTowns("GB", "London"))[0];
    expect(await townById("GB", london.id)).toMatchObject({ name: "London" });
  });
});

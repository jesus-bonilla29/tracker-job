import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db" };

describe("loadConfig", () => {
  it("aplica valores por defecto", () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({
      SOURCES: ["remotive", "arbeitnow", "hn"],
      REMOTIVE_CATEGORY: "software-dev",
      ARBEITNOW_MAX_PAGES: 5,
      HN_THREADS: 1,
      ETL_INTERVAL_HOURS: 6,
      RUN_ONCE: false,
      FORCE_RUN: false,
      LOG_LEVEL: "info",
    });
  });

  it("rechaza intervalos que superarían el límite de Remotive", () => {
    expect(() => loadConfig({ ...base, ETL_INTERVAL_HOURS: "1" })).toThrow(/ETL_INTERVAL_HOURS/);
  });

  it("exige DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("interpreta booleanos desde texto", () => {
    expect(loadConfig({ ...base, RUN_ONCE: "true" }).RUN_ONCE).toBe(true);
  });

  it("interpreta SOURCES como lista, ignorando espacios y mayúsculas", () => {
    expect(loadConfig({ ...base, SOURCES: " Arbeitnow " }).SOURCES).toEqual(["arbeitnow"]);
    expect(loadConfig({ ...base, SOURCES: "remotive, arbeitnow" }).SOURCES).toEqual(["remotive", "arbeitnow"]);
  });

  it("rechaza fuentes desconocidas o una lista vacía", () => {
    expect(() => loadConfig({ ...base, SOURCES: "remotive,linkedin" })).toThrow(/SOURCES/);
    expect(() => loadConfig({ ...base, SOURCES: " , " })).toThrow(/SOURCES/);
  });

  it("admite la fuente hn y limita HN_THREADS entre 1 y 12", () => {
    expect(loadConfig({ ...base, SOURCES: "hn" }).SOURCES).toEqual(["hn"]);
    expect(() => loadConfig({ ...base, HN_THREADS: "0" })).toThrow(/HN_THREADS/);
    expect(() => loadConfig({ ...base, HN_THREADS: "13" })).toThrow(/HN_THREADS/);
    expect(loadConfig({ ...base, HN_THREADS: "6" }).HN_THREADS).toBe(6);
  });

  it("limita ARBEITNOW_MAX_PAGES entre 1 y 20", () => {
    expect(() => loadConfig({ ...base, ARBEITNOW_MAX_PAGES: "0" })).toThrow(/ARBEITNOW_MAX_PAGES/);
    expect(() => loadConfig({ ...base, ARBEITNOW_MAX_PAGES: "21" })).toThrow(/ARBEITNOW_MAX_PAGES/);
    expect(loadConfig({ ...base, ARBEITNOW_MAX_PAGES: "10" }).ARBEITNOW_MAX_PAGES).toBe(10);
  });
});

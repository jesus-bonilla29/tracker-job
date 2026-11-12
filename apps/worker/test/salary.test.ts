import { describe, expect, it } from "vitest";
import { parseSalary } from "../src/extract/salary.js";

describe("parseSalary", () => {
  it("interpreta un rango en dólares con separador de miles", () => {
    expect(parseSalary("$90,000 - $120,000")).toEqual({ min: 90_000, max: 120_000, currency: "USD" });
  });

  it("interpreta la notación con k y euros", () => {
    expect(parseSalary("€60k - €80k")).toEqual({ min: 60_000, max: 80_000, currency: "EUR" });
  });

  it("interpreta 60-80k donde solo el segundo número lleva k", () => {
    expect(parseSalary("£60 - 80k")).toEqual({ min: 60_000, max: 80_000, currency: "GBP" });
  });

  it("interpreta un monto único con código de moneda", () => {
    expect(parseSalary("USD 95000")).toEqual({ min: 95_000, max: 95_000, currency: "USD" });
  });

  it("devuelve vacío para tarifas por hora", () => {
    expect(parseSalary("$45/hour")).toEqual({ min: null, max: null, currency: null });
  });

  it("devuelve vacío para textos sin números o vacíos", () => {
    expect(parseSalary("Competitive")).toEqual({ min: null, max: null, currency: null });
    expect(parseSalary("")).toEqual({ min: null, max: null, currency: null });
    expect(parseSalary(null)).toEqual({ min: null, max: null, currency: null });
  });
});

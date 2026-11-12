import { describe, expect, it } from "vitest";
import { htmlToText } from "../src/lib/html.js";

describe("htmlToText", () => {
  it("quita etiquetas y decodifica entidades", () => {
    expect(htmlToText("<p>Node.js &amp; <strong>TypeScript</strong></p>")).toBe("Node.js & TypeScript");
  });

  it("convierte listas y saltos de línea", () => {
    const text = htmlToText("<ul><li>React</li><li>PostgreSQL</li></ul>");
    expect(text).toBe("• React\n• PostgreSQL");
    expect(htmlToText("Línea 1<br>Línea 2")).toBe("Línea 1\nLínea 2");
  });

  it("elimina scripts y estilos", () => {
    expect(htmlToText("<style>p{color:red}</style><p>Hola</p><script>alert(1)</script>")).toBe("Hola");
  });

  it("devuelve null para entradas vacías", () => {
    expect(htmlToText("")).toBeNull();
    expect(htmlToText(null)).toBeNull();
    expect(htmlToText("<p> </p>")).toBeNull();
  });
});

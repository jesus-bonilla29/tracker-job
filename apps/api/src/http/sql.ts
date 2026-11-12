/**
 * Constructor de consultas SQL PARAMETRIZADAS.
 *
 * Regla de oro: los valores del usuario NUNCA se concatenan en el texto SQL. Cada `?` de una plantilla se
 * sustituye por un marcador `$n` y el valor viaja aparte, así que una entrada como `'; DROP TABLE jobs;--`
 * es solo un texto más. Las plantillas son constantes escritas en el código, nunca construidas con datos del cliente.
 * (Por eso aquí no se usa el operador `?` de JSONB.)
 */
export class Sql {
  readonly values: unknown[] = [];
  private readonly clauses: string[] = [];

  /** Registra un valor y devuelve su marcador (`$1`, `$2`...). */
  bind(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }

  /** Añade una condición al WHERE; cada `?` se enlaza, en orden, con uno de los `values`. */
  where(template: string, ...values: unknown[]): this {
    let i = 0;
    const sql = template.replace(/\?/g, () => {
      if (i >= values.length) throw new Error(`Faltan valores para la plantilla: ${template}`);
      return this.bind(values[i++]);
    });
    if (i !== values.length) throw new Error(`Sobran valores para la plantilla: ${template}`);
    this.clauses.push(sql);
    return this;
  }

  get whereSql(): string {
    return this.clauses.length > 0 ? `WHERE ${this.clauses.join(" AND ")}` : "";
  }
}

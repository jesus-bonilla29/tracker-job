import type { ReactNode } from "react";
import { ApiError } from "../api/client";

export interface Option<T extends string> {
  value: T;
  label: string;
  /** Color de la entidad (p. ej. la fuente), si la tiene. */
  color?: string;
}

/** Grupo de opciones excluyentes. Usa radios reales: accesible con teclado y lector de pantalla sin código extra. */
export function Segmented<T extends string>(props: {
  label: string;
  name: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="control-group">
      <legend>{props.label}</legend>
      <div className="segmented">
        {props.options.map((o) => (
          <label key={o.value}>
            <input
              type="radio"
              name={props.name}
              value={o.value}
              checked={props.value === o.value}
              onChange={() => props.onChange(o.value)}
            />
            <span>
              {o.color && <i className="dot" style={{ ["--dot" as string]: o.color }} aria-hidden="true" />}
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof ApiError ? error.message : "Algo salió mal al cargar los datos.";
  return (
    <div className="state error" role="alert">
      <h2>No se pudieron cargar los datos</h2>
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          Reintentar
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}

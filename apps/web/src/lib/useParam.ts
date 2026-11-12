import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * `setSearchParams` de React Router NO encola las actualizaciones: si se llama varias veces en el mismo evento
 * (p. ej. "Buscar" fija texto, tecnologías y página), cada llamada parte de los parámetros viejos y la última pisa a
 * las anteriores. Para que se acumulen, las escrituras del mismo ciclo parten del resultado de la anterior.
 */
let pending: URLSearchParams | null = null;

/** Estado en la URL: los filtros se pueden compartir y sobreviven a recargar. Un valor vacío borra el parámetro. */
export function useParam(key: string, fallback = ""): [string, (value: string | undefined) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? fallback;
  const set = useCallback(
    (next: string | undefined) => {
      setParams(
        (prev) => {
          const copy = new URLSearchParams(pending ?? prev);
          if (next === undefined || next === "" || next === fallback) copy.delete(key);
          else copy.set(key, next);
          pending = copy;
          // Fuera de este ciclo de eventos, la fuente de verdad vuelve a ser la URL.
          queueMicrotask(() => {
            if (pending === copy) pending = null;
          });
          return copy;
        },
        { replace: true },
      );
    },
    [key, fallback, setParams],
  );
  return [value, set];
}

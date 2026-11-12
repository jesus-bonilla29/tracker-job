import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { getJson, seg, type Params } from "./client";
import type { Health, JobList, MatchResult, Overview, SkillTrend, SourceComparison, TopSkills } from "./types";

// Los datos cambian como mucho cada pocas horas: no hace falta refrescar a cada momento.
const STALE = 60_000;

export const useHealth = () =>
  useQuery({ queryKey: ["health"], queryFn: ({ signal }) => getJson<Health>("/health", undefined, signal), staleTime: STALE });

export const useOverview = () =>
  useQuery({ queryKey: ["overview"], queryFn: ({ signal }) => getJson<Overview>("/stats/overview", undefined, signal), staleTime: STALE });

/** Pedimos hasta 100 y filtramos por categoría en el cliente: el % sigue siendo sobre TODAS las ofertas del filtro. */
export const useTopSkills = (source?: string) =>
  useQuery({
    queryKey: ["top", source ?? "all"],
    queryFn: ({ signal }) => getJson<TopSkills>("/skills/top", { source, limit: 100 }, signal),
    staleTime: STALE,
    placeholderData: keepPreviousData,
  });

export const useSkillTrend = (name: string, interval: "week" | "month", source?: string) =>
  useQuery({
    queryKey: ["trend", name, interval, source ?? "all"],
    queryFn: ({ signal }) => getJson<SkillTrend>(`/skills/${seg(name)}/trend`, { interval, source }, signal),
    staleTime: STALE,
    enabled: name !== "",
    placeholderData: keepPreviousData,
  });

export const useCompare = (a: string, b: string) =>
  useQuery({
    queryKey: ["compare", a, b],
    queryFn: ({ signal }) => getJson<SourceComparison>("/sources/compare", { a, b, limit: 12, minMentions: 3 }, signal),
    staleTime: STALE,
    enabled: a !== "" && b !== "" && a !== b,
    placeholderData: keepPreviousData,
  });

export const useJobs = (params: Params) =>
  useQuery({
    queryKey: ["jobs", params],
    queryFn: ({ signal }) => getJson<JobList>("/jobs", params, signal),
    staleTime: STALE,
    placeholderData: keepPreviousData,
  });

/** Una consulta de tendencia por tecnología seleccionada (como mucho 3), en paralelo. */
export function useSkillTrends(names: string[], interval: "week" | "month", source?: string) {
  const results = useQueries({
    queries: names.map((name) => ({
      queryKey: ["trend", name, interval, source ?? "all"],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getJson<SkillTrend>(`/skills/${seg(name)}/trend`, { interval, source }, signal),
      staleTime: STALE,
      placeholderData: keepPreviousData,
    })),
  });
  const error = results.find((r) => r.isError)?.error ?? null;
  const data = results.every((r) => r.data) ? results.map((r) => r.data as SkillTrend) : undefined;
  return {
    data,
    error,
    isPending: names.length > 0 && !data && !error,
    refetch: () => results.forEach((r) => void r.refetch()),
  };
}

/** Ofertas que encajan con las tecnologías del usuario. Sin tecnologías no se consulta. */
export const useMatch = (skills: string[], source?: string) =>
  useQuery({
    queryKey: ["match", skills, source ?? "all"],
    queryFn: ({ signal }) => getJson<MatchResult>("/match", { skills: skills.join(","), source, limit: 20 }, signal),
    staleTime: STALE,
    enabled: skills.length > 0,
    placeholderData: keepPreviousData,
  });

import { useEffect, useMemo, useState } from "react";

import { useApp } from "../lib/store";
import type { CreatorDetail } from "./detail";

type Answer =
  | { readonly key: string; readonly status: "ready"; readonly item: CreatorDetail }
  | { readonly key: string; readonly status: "missing" | "failed" };

/**
 * One channel as `find:item` answers it, with the page's own stage laid over it (D2). Unlike the
 * catalog hook it keeps "the channel isn't there" apart from "the question failed", so the record
 * can offer Try again for the second. Asks again on `find:catalog` and on `retry()`.
 */
export function useCreatorItem(id: string): {
  readonly status: "loading" | "ready" | "missing" | "failed";
  readonly item: CreatorDetail | null;
  readonly retry: () => void;
} {
  const [tick, setTick] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  useEffect(
    () =>
      window.gratovo.on("find:catalog", () => {
        setTick((n) => n + 1);
      }),
    [],
  );
  useEffect(() => {
    let stopped = false;
    const done = (next: Answer): void => {
      if (!stopped) setAnswer(next);
    };
    window.gratovo.invoke("find:item", { id }).then(
      (result) => {
        if (!result.ok) done({ key: id, status: "failed" });
        else if (result.value.item === null) done({ key: id, status: "missing" });
        else done({ key: id, status: "ready", item: result.value.item });
      },
      () => {
        done({ key: id, status: "failed" });
      },
    );
    return () => {
      stopped = true;
    };
  }, [id, tick]);
  const creator = useApp((s) => s.data.creators.find((c) => c.id === id));
  const item = useMemo(() => {
    if (answer?.key !== id || answer.status !== "ready") return null;
    const base = answer.item;
    return creator === undefined ||
      (creator.stage === base.stage && creator.rejectReason === base.rejectReason)
      ? base
      : { ...base, stage: creator.stage, rejectReason: creator.rejectReason };
  }, [answer, id, creator]);
  return {
    status: answer?.key !== id ? "loading" : answer.status,
    item,
    retry: () => {
      setAnswer(null);
      setTick((n) => n + 1);
    },
  };
}

import type { ThreadMessage } from "@gratovo/core/data";
import { isOpenDraft, nextStep } from "@gratovo/core/reach";
import { Btn, Icon } from "@gratovo/ui";
import { useEffect, useMemo, useState } from "react";

import {
  draftNow,
  loadThread,
  openParkMenu,
  resumeSequence,
  stopSequence,
  wakeCreator,
} from "../lib/reach-actions";
import { useApp } from "../lib/store";
import { useNow } from "../lib/use-now";
import { nextWords, seqState } from "../reach/reach-view";
import { strings } from "../strings";
import { DraftCard } from "./draft-card";
import { Thread } from "./thread";

const text = strings.reach.emails;
const seqText = strings.reach.sequences;

type Loaded =
  | { readonly id: string; readonly messages: readonly ThreadMessage[] }
  | { readonly id: string; readonly messages: null };

/** The next step under the thread (D22): its words, with Stop and Park, or Resume or Wake now. */
export function SequenceLine({ creatorId }: { readonly creatorId: string }) {
  const sequence = useApp((s) => s.data.reach.sequences.find((q) => q.creator === creatorId));
  const stage = useApp((s) => s.data.creators.find((c) => c.id === creatorId)?.stage);
  const now = useNow();
  if (sequence === undefined) {
    return null;
  }
  const state = seqState(sequence, now, stage);
  const words = nextWords({ sequence, state, next: nextStep(sequence) }, now);
  const byYou = sequence.stopped === "you";
  const open = state === "running" || state === "done";
  return (
    <div
      className="row wrap"
      data-ui="record.sequence"
      role="group"
      aria-label={seqText.record.label}
    >
      <Icon name={words.icon} size={14} />
      <span className={words.due ? "grow due" : "grow"}>{words.text}</span>
      {state === "parked" ? (
        <Btn
          size="sm"
          icon="alarm"
          onClick={() => {
            void wakeCreator(creatorId);
          }}
        >
          {seqText.wake}
        </Btn>
      ) : byYou ? (
        <Btn
          size="sm"
          icon="play"
          onClick={() => {
            void resumeSequence(creatorId);
          }}
        >
          {seqText.resumeShort}
        </Btn>
      ) : null}
      {open ? (
        <Btn
          size="sm"
          icon="pause"
          onClick={() => {
            void stopSequence(creatorId);
          }}
        >
          {seqText.stopShort}
        </Btn>
      ) : null}
      {open ? (
        <Btn
          size="sm"
          icon="alarm"
          onClick={(event) => {
            openParkMenu(event.currentTarget.getBoundingClientRect(), creatorId);
          }}
        >
          {seqText.park}
        </Btn>
      ) : null}
    </div>
  );
}
/**
 * The record's Emails tab (D15): the thread, then the creator's open drafts, then, for a creator
 * at Contact with no draft, a button that asks for the first email now. Loads the thread again
 * when the frame's thread summary for this creator changes.
 */
export function CreatorEmails({ creatorId }: { readonly creatorId: string }) {
  const creator = useApp((s) => s.data.creators.find((c) => c.id === creatorId));
  const summary = useApp((s) => s.data.reach.threads.find((t) => t.creator === creatorId));
  const all = useApp((s) => s.data.reach.drafts);
  const drafts = useMemo(
    () => all.filter((d) => d.creator === creatorId && isOpenDraft(d)),
    [all, creatorId],
  );
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tick, setTick] = useState(0);
  // The summary changes with each new message, so it is the cue to read the thread again.
  const cue = `${String(summary?.count ?? 0)}:${String(summary?.lastOutAt ?? 0)}:${summary?.lastIn?.id ?? ""}`;
  useEffect(() => {
    let stopped = false;
    void loadThread(creatorId).then((messages) => {
      if (!stopped) {
        setLoaded({ id: creatorId, messages });
      }
    });
    return () => {
      stopped = true;
    };
  }, [creatorId, cue, tick]);
  const mine = loaded?.id === creatorId ? loaded : null;
  const canDraft = creator?.stage === "contact" && drafts.length === 0;
  return (
    <div className="col" style={{ gap: "14px" }} data-ui="record.emails">
      {mine === null ? (
        <p className="hint" role="status">
          {strings.creatorRecord.loading}
        </p>
      ) : mine.messages === null ? (
        <div className="col tight">
          <p className="hint">{text.loadFailed}</p>
          <div className="row">
            <Btn
              size="sm"
              onClick={() => {
                setTick((n) => n + 1);
              }}
            >
              {text.retry}
            </Btn>
          </div>
        </div>
      ) : (
        <Thread
          messages={mine.messages}
          theirName={creator?.contactName ?? creator?.name ?? ""}
          creatorId={creatorId}
          onPasted={() => {
            setTick((n) => n + 1);
          }}
        />
      )}
      <SequenceLine creatorId={creatorId} />
      {drafts.map((draft) => (
        <DraftCard key={draft.id} draftId={draft.id} />
      ))}
      {canDraft ? (
        <div className="row">
          <Btn
            kind="pri"
            icon="sparkle"
            onClick={() => {
              void draftNow(creatorId);
            }}
          >
            {text.draftFirst}
          </Btn>
        </div>
      ) : null}
    </div>
  );
}

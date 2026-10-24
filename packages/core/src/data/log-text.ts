// Plain-English text for an activity-log row (D11, D14). Rows written by the
// old app carry an action word; rows written by this app carry `detail.text`.
// Meanings come from legacy/lib/data/models/activity_log_entry.dart.

export interface LogTextRow {
  readonly action: string;
  readonly entityType: string;
  readonly entityLabel: string | null;
  readonly field: string | null;
  readonly oldValue: string | null;
  readonly newValue: string | null;
  readonly detail: unknown;
}

export const logTextMax = 500;

/** One phrase per known legacy action; `{label}` is the entity label. */
export const logPhrases: Readonly<Record<string, string>> = {
  created: "Added {label}",
  updated: "Updated {label}",
  deleted: "Removed {label}",
  tagsChanged: "Changed the tags of {label}",
  stageChanged: "Changed the stage of {label}",
  vettingChanged: "Changed the vetting of {label}",
  notesChanged: "Changed the notes of {label}",
  contactsChanged: "Changed the contacts of {label}",
  contactAttempt: "Tried to reach {label}",
  emailSent: "Sent an email to {label}",
  replyReceived: "Got a reply from {label}",
  searchStarted: "Started a search for {label}",
  videosPulled: "Pulled videos for {label}",
  // This app's creator lines (`LogAction`) carry their text in `detail.text`; these words are for
  // one that comes without it.
  "creator.shortlist": "Shortlisted {label}",
  "creator.reject": "Rejected {label}",
  "creator.restore": "Brought back {label}",
  "creator.never": "Marked {label} as never contact",
  "creator.allow": "Allowed {label} again",
};

function clean(value: string | null): string {
  return (value ?? "").trim();
}

function cut(text: string): string {
  return text.length > logTextMax ? text.slice(0, logTextMax) : text;
}

function detailText(detail: unknown): string | null {
  if (typeof detail !== "object" || detail === null || Array.isArray(detail)) return null;
  const text = (detail as Record<string, unknown>)["text"];
  return typeof text === "string" && text.trim() !== "" ? text.trim() : null;
}

export function logText(row: LogTextRow): string {
  const fromDetail = detailText(row.detail);
  if (fromDetail !== null) return cut(fromDetail);
  if (row.entityType === "app" && (row.detail === null || row.detail === undefined)) {
    return cut(row.action);
  }
  const label = clean(row.entityLabel);
  const phrase = logPhrases[row.action];
  let text: string;
  if (phrase === undefined) {
    text = label === "" ? "Changed something" : `Changed ${label}`;
  } else {
    text =
      label === ""
        ? phrase.replace(" {label}", "").replace("{label}", "")
        : phrase.replace("{label}", label);
    text = text.trim();
  }
  const before = clean(row.oldValue);
  const after = clean(row.newValue);
  if (before !== "" && after !== "") text += `: ${before} → ${after}`;
  return cut(text);
}

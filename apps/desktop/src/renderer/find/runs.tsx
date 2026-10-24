import { Btn, Tag } from "@gratovo/ui";

import { clock } from "../lib/format";
import { useRuns } from "../lib/find-catalog";
import { strings } from "../strings";
import { reviewResults, shortDate } from "./triage";

const text = strings.findRuns;

/** The status tag the pipeline's run states show as; a finished run has none. */
function StatusTag({ status }: { readonly status: string }) {
  switch (status) {
    case "running":
      return <Tag tone="info">{text.status.running}</Tag>;
    case "paused":
      return <Tag>{text.status.paused}</Tag>;
    case "interrupted":
    case "failed":
    case "stopped":
      return (
        <Tag tone="crit" icon="alert">
          {text.status.stopped}
        </Tag>
      );
    case "pending":
    case "ready":
      return <Tag>{text.status.notStarted}</Tag>;
    default:
      return null;
  }
}

function when(at: number, now: Date): string {
  const day = new Date(at);
  return day.toDateString() === now.toDateString() ? text.today(clock(at)) : shortDate(at);
}

/** The search runs, newest first, each with a way to review what it found. */
export function Runs() {
  const { status, runs } = useRuns();
  const now = new Date();
  const newest = runs.reduce<number | null>(
    (best, r) => (best === null || r.startedAt > best ? r.startedAt : best),
    null,
  );
  return (
    <section className="card" aria-labelledby="find-runs-h">
      <div className="card-h">
        <h3 id="find-runs-h">
          {text.title}{" "}
          <span className="muted num" style={{ fontWeight: 400 }}>
            {runs.length}
          </span>
        </h3>
        <span className="hint">{text.hint}</span>
      </div>
      {status === "failed" ? (
        <p className="hint" role="alert">
          {text.loadFailed}
        </p>
      ) : runs.length === 0 ? (
        status === "ready" ? (
          <p className="hint">{text.empty}</p>
        ) : null
      ) : (
        <div className="tw">
          <table className="tbl" aria-label={text.listLabel}>
            <thead>
              <tr>
                <th>{text.when}</th>
                <th className="n">{text.keywords}</th>
                <th className="n">{text.found}</th>
                <th className="n">{text.kept}</th>
                <th className="n">{text.gold}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const latest = r.startedAt === newest;
                return (
                  <tr key={r.id}>
                    <td>
                      <span className="row wrap" style={{ gap: "6px" }}>
                        <span>{when(r.startedAt, now)}</span>
                        <StatusTag status={r.status} />
                      </span>
                    </td>
                    <td className="n">{r.keywords}</td>
                    <td className="n">{r.found}</td>
                    <td className="n">{r.kept}</td>
                    <td className="n">{r.gold}</td>
                    <td style={{ textAlign: "end" }}>
                      <Btn
                        size="sm"
                        {...(latest ? { kind: "pri" } : {})}
                        icon="eye"
                        onClick={() => {
                          reviewResults(latest ? null : r.id);
                        }}
                      >
                        {text.review}
                      </Btn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

import type { Bridge, ImportCandidates, ImportReport, importWarnings } from "@gratovo/ipc";
import { Btn, Icon, IconBtn } from "@gratovo/ui";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { useKeys } from "../../lib/keys";
import { setImportState } from "../../lib/store";
import { toast } from "../../lib/toast";
import { ModalLayer } from "../../overlays/modal-layer";
import { strings } from "../../strings";
import { whenText, sizeText } from "./format";
import { hasOldRules } from "./has-old-rules";
import { ReportView } from "./report-view";
import { UnsentWarning } from "./unsent-warning";
import { ask, loadConnections } from "./use-connections";

/** A step after the copy that didn't finish; the data itself was brought in. */
type ImportWarning = (typeof importWarnings)[number];

const text = strings.settings.importDialog;

type Candidate = ImportCandidates["candidates"][number];
type Step = "pick" | "report" | "running" | "result";
type Reason = keyof typeof text.reasons;

interface Progress {
  readonly table: string;
  readonly done: number;
  readonly total: number;
}

/** The dialog that brings in the old app's data: pick the file, check what moves, bring it in. */
export function ImportDialog({ onClose }: { readonly onClose: () => void }) {
  const [step, setStep] = useState<Step>("pick");
  const [candidates, setCandidates] = useState<readonly Candidate[] | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [problem, setProblem] = useState<Reason | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [warnings, setWarnings] = useState<readonly ImportWarning[]>([]);
  const [useRules, setUseRules] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const running = step === "running";
  const close = (): void => {
    if (!running) {
      onClose();
    }
  };
  useKeys({ escape: close }, { barrier: true });

  useEffect(() => {
    void ask("import:candidates", {}).then((found) => {
      if (!alive.current) {
        return;
      }
      const list = found?.candidates ?? [];
      setCandidates(list);
      setPath((was) => was ?? list[0]?.path ?? null);
    });
  }, []);

  // Listens from the start, so no line is missed between pressing the button and the first table.
  useEffect(() => {
    const on = (globalThis as { gratovo?: Partial<Bridge> }).gratovo?.on;
    return on?.("import:progress", (next) => {
      setProgress(next);
    });
  }, []);

  const choose = (): void => {
    void ask("import:pick", {}).then((picked) => {
      if (!alive.current) {
        return;
      }
      if (picked === null) {
        setProblem("failed");
      } else if (picked.path !== null) {
        setProblem(null);
        setPath(picked.path);
        setCandidates((list) =>
          (list ?? []).some((c) => c.path === picked.path)
            ? list
            : [
                { path: picked.path ?? "", modifiedAt: new Date().toISOString(), size: 0 },
                ...(list ?? []),
              ],
        );
      }
    });
  };

  const check = (): void => {
    if (path === null) {
      return;
    }
    setBusy(true);
    setProblem(null);
    void ask("import:dry-run", { path }).then((answer) => {
      if (!alive.current) {
        return;
      }
      setBusy(false);
      if (answer === null) {
        setProblem("failed");
      } else if (!answer.ok) {
        setProblem(answer.reason);
      } else {
        setReport(answer.report);
        setUseRules(hasOldRules(answer.report));
        setStep("report");
      }
    });
  };

  const run = (): void => {
    if (path === null || report === null) {
      return;
    }
    setBusy(true);
    setProblem(null);
    setProgress(null);
    setStep("running");
    void ask("import:run", { path, useOldRules: hasOldRules(report) && useRules }).then(
      (answer) => {
        // The import finished on main's side even if the dialog was closed meanwhile.
        if (answer?.ok === true) {
          setImportState("imported");
          void loadConnections();
          toast({ msg: text.doneToast, sub: text.doneToastSub, icon: "check", tone: "good" });
        }
        if (!alive.current) {
          return;
        }
        setBusy(false);
        if (answer === null) {
          setProblem("failed");
          setStep("report");
        } else if (!answer.ok) {
          setProblem(answer.reason);
          setStep("report");
        } else {
          setReport(answer.report);
          setWarnings(answer.warnings ?? []);
          setStep("result");
        }
      },
    );
  };

  const added = report?.tables.reduce((sum, t) => sum + t.toAdd, 0) ?? 0;
  const already = report?.tables.reduce((sum, t) => sum + t.already, 0) ?? 0;

  return (
    <ModalLayer label={text.title} onClose={close}>
      <div className="scrim" role="presentation" onClick={close}></div>
      <div
        className="modal"
        style={{ "--mw": "640px" } as CSSProperties}
        data-ui="settings.connections.import"
      >
        <div className="row">
          <h2 className="grow">{text.title}</h2>
          <IconBtn icon="x" label={text.close} onClick={close} />
        </div>
        {step === "pick" ? (
          <div className="col" style={{ gap: "12px" }}>
            <h4>{text.step1}</h4>
            <p className="hint">{text.step1Hint}</p>
            {candidates !== null && candidates.length === 0 ? (
              <p className="small ink2">{text.none}</p>
            ) : null}
            {candidates === null || candidates.length === 0 ? null : (
              <div className="col tight" role="radiogroup" aria-label={text.candidates}>
                {candidates.map((c) => (
                  <label
                    key={c.path}
                    className="row top"
                    style={{ gap: "10px", padding: "6px 0", cursor: "pointer" }}
                  >
                    <input
                      type="radio"
                      name="old-file"
                      checked={path === c.path}
                      onChange={() => {
                        setPath(c.path);
                      }}
                    />
                    <span className="col tight" style={{ minWidth: 0 }}>
                      <span style={{ overflowWrap: "anywhere" }}>{c.path}</span>
                      {c.size === 0 ? null : (
                        <span className="tiny muted">
                          {text.modified(whenText(c.modifiedAt), sizeText(c.size))}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <div className="row wrap">
              <Btn icon="file" onClick={choose}>
                {text.chooseOther}
              </Btn>
            </div>
          </div>
        ) : null}
        {step === "report" && report !== null ? (
          <div className="col" style={{ gap: "14px" }}>
            <ReportView report={report} />
            {hasOldRules(report) ? (
              <div className="col tight">
                <label className="row" style={{ gap: "10px" }}>
                  <input
                    type="checkbox"
                    checked={useRules}
                    onChange={(event) => {
                      setUseRules(event.currentTarget.checked);
                    }}
                  />
                  {text.useRules}
                </label>
                <span className="tiny muted">{text.useRulesHint}</span>
              </div>
            ) : null}
          </div>
        ) : null}
        {running ? (
          <div className="col" style={{ gap: "10px" }} role="status">
            <b>{text.running}</b>
            {progress === null ? null : (
              <>
                <span className="small ink2">{text.progress(progress.table)}</span>
                <div
                  className="meter"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                  aria-valuenow={progress.done}
                  aria-label={text.progressCount(progress.done, progress.total)}
                >
                  <i
                    style={{
                      width: `${String(progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100))}%`,
                    }}
                  />
                </div>
                <span className="tiny muted">
                  {text.progressCount(progress.done, progress.total)}
                </span>
              </>
            )}
          </div>
        ) : null}
        {step === "result" && report !== null ? (
          <div className="col" style={{ gap: "12px" }} data-ui="settings.connections.import.result">
            <div className="callout good" role="status">
              <Icon name="check" />
              <div className="grow col tight">
                <b>{text.resultTitle}</b>
                <span className="small">{text.resultAdded(added)}</span>
                <span className="small">{text.resultAlready(already)}</span>
              </div>
            </div>
            {warnings.length > 0 ? (
              <div className="callout warn" role="status">
                <Icon name="alert" />
                <div className="grow col tight">
                  <b>{text.warningsTitle}</b>
                  {warnings.map((w) => (
                    <span key={w} className="small">
                      {text.warnings[w]}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            <UnsentWarning report={report} />
            <p className="small ink2">
              {report.backup === null ? text.noBackup : text.backup(report.backup)}
            </p>
            <p className="small ink2">{text.untouched}</p>
          </div>
        ) : null}
        {problem === null ? null : (
          <div className="callout crit" role="alert">
            <Icon name="alert" />
            <div className="grow">{text.reasons[problem]}</div>
          </div>
        )}
        <div className="row wrap" style={{ justifyContent: "flex-end" }}>
          {step === "pick" ? (
            <>
              <Btn kind="ghost" onClick={close}>
                {strings.settings.connections.cancel}
              </Btn>
              <Btn kind="pri" disabled={path === null || busy} onClick={check}>
                {busy ? text.checking : text.check}
              </Btn>
            </>
          ) : null}
          {step === "report" ? (
            <>
              <Btn kind="ghost" onClick={close}>
                {strings.settings.connections.cancel}
              </Btn>
              <Btn kind="pri" icon="check" disabled={busy} onClick={run}>
                {text.run}
              </Btn>
            </>
          ) : null}
          {step === "result" ? (
            <Btn kind="pri" onClick={close}>
              {text.done}
            </Btn>
          ) : null}
        </div>
      </div>
    </ModalLayer>
  );
}

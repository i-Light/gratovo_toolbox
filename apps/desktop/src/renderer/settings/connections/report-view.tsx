import type { ImportReport } from "@gratovo/ipc";

import { strings } from "../../strings";
import { StateTag } from "./state-tag";
import { UnsentWarning } from "./unsent-warning";

const text = strings.settings.importDialog;
const whys = ["synced", "bookkeeping", "not-ported"] as const;

/** What a dry run found: tables to copy, tables left behind (grouped by why) and the settings files. */
export function ReportView({ report }: { readonly report: ImportReport }) {
  return (
    <div className="col" style={{ gap: "14px" }} data-ui="settings.connections.import.report">
      <UnsentWarning report={report} />
      <div className="col tight">
        <h4>{text.reportTitle}</h4>
        {report.tables.map((table) => (
          <div
            key={table.name}
            className="row small"
            style={{ justifyContent: "space-between", gap: "12px", padding: "3px 0" }}
          >
            <span>{table.name}</span>
            <span className="ink2">{text.toAdd(table.toAdd, table.already)}</span>
          </div>
        ))}
      </div>
      {report.skipped.length === 0 ? null : (
        <div className="col tight">
          <h4>{text.skippedTitle}</h4>
          {whys.map((why) => {
            const group = report.skipped.filter((s) => s.why === why);
            if (group.length === 0) {
              return null;
            }
            const rowCount = group.reduce((sum, s) => sum + s.rows, 0);
            return (
              <div key={why} className="col tight" style={{ padding: "3px 0" }}>
                <div className="row small" style={{ justifyContent: "space-between", gap: "12px" }}>
                  <b style={{ fontWeight: 600 }}>{text.skipWhy[why]}</b>
                  <span className="ink2">{text.skippedLine(group.length, rowCount)}</span>
                </div>
                <span className="tiny muted">{group.map((s) => s.name).join(", ")}</span>
              </div>
            );
          })}
        </div>
      )}
      {report.settingsFiles.length === 0 ? null : (
        <div className="col tight">
          <h4>{text.settingsFound}</h4>
          {report.settingsFiles.map((file) => (
            <div
              key={file.name}
              className="row small"
              style={{ justifyContent: "space-between", gap: "12px" }}
            >
              <span>{file.name}</span>
              <StateTag tone={file.found ? "good" : undefined}>
                {file.found ? text.found : text.notFound}
              </StateTag>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

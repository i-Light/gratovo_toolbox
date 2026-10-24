import { Problem } from "./problem";

/** One number field, with its inline problem. */
export function NumberField(props: {
  readonly label: string;
  readonly value: string;
  readonly error: string | undefined;
  readonly errorId: string;
  readonly hint?: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="col tight" style={{ minWidth: 0 }}>
      <input
        className="inp num set-num"
        inputMode="numeric"
        value={props.value}
        aria-label={props.label}
        aria-invalid={props.error !== undefined}
        aria-describedby={props.error === undefined ? undefined : props.errorId}
        onChange={(event) => {
          props.onChange(event.currentTarget.value);
        }}
      />
      <Problem id={props.errorId} message={props.error} />
      {props.hint !== undefined && props.error === undefined ? (
        <span className="hint">{props.hint}</span>
      ) : null}
    </div>
  );
}

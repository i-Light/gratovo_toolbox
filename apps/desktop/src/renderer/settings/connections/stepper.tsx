import { Btn } from "@gratovo/ui";

/** The up and down buttons around a number. */
export function Stepper(props: {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly label: string;
  readonly upLabel: string;
  readonly downLabel: string;
  readonly disabled?: boolean;
  readonly onChange: (next: number) => void;
}) {
  const { value, min, max } = props;
  const off = props.disabled === true;
  return (
    <div className="row" style={{ gap: "6px" }} role="group" aria-label={props.label}>
      <Btn
        size="sm"
        icon="minus"
        label={props.downLabel}
        disabled={off || value <= min}
        onClick={() => {
          props.onChange(Math.max(min, value - 1));
        }}
      />
      <span className="num">{value}</span>
      <Btn
        size="sm"
        icon="plus"
        label={props.upLabel}
        disabled={off || value >= max}
        onClick={() => {
          props.onChange(Math.min(max, value + 1));
        }}
      />
    </div>
  );
}

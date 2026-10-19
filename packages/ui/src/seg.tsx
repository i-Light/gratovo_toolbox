import { Icon } from "./icon";
import type { IconName } from "./icons";

/** One choice in a `Seg`. */
export interface SegOption {
  readonly value: string;
  readonly label: string;
  readonly icon?: IconName;
}

/** What `Seg` takes. Every word comes in as a prop. */
export interface SegProps {
  /** The group's accessible name. */
  readonly label: string;
  /** The value of the chosen option. */
  readonly value: string;
  readonly options: readonly SegOption[];
  readonly onPick: (value: string) => void;
}

/** A row of buttons where one is chosen (a segmented control). */
export function Seg({ label, value, options, onPick }: SegProps) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => {
            onPick(option.value);
          }}
        >
          {option.icon === undefined ? null : <Icon name={option.icon} size={14} />}
          {option.label}
        </button>
      ))}
    </div>
  );
}

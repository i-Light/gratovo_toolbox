/** What `Switch` takes. */
export interface SwitchProps {
  readonly on: boolean;
  /** The accessible name. */
  readonly label: string;
  /** Called with the new state. */
  readonly onChange: (next: boolean) => void;
  readonly disabled?: boolean;
}

/** An on/off switch. */
export function Switch({ on, label, onChange, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        onChange(!on);
      }}
    >
      <i />
    </button>
  );
}

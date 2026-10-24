export function Problem({
  id,
  message,
}: {
  readonly id: string;
  readonly message: string | undefined;
}) {
  return message === undefined ? null : (
    <span id={id} className="hint set-err" role="alert">
      {message}
    </span>
  );
}

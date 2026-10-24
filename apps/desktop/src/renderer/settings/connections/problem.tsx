import type { ReactNode } from "react";

/** A plain-words problem under a control. */
export function Problem({ children }: { readonly children: ReactNode }) {
  return (
    <span className="hint set-err" role="alert">
      {children}
    </span>
  );
}

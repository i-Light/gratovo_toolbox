import type { ReactNode } from "react";

/** A keyboard key drawn as a small cap, such as `Ctrl K`. */
export function Kbd({ children }: { readonly children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

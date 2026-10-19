import { useLayoutEffect, useRef, type ReactNode } from "react";

import { hostFloating } from "./floating";

/** What {@link ModalLayer} needs. */
export interface ModalLayerProps {
  /** The accessible name of the dialog, read out when it opens. */
  label: string;
  /** Called when the transparent area of the dialog itself is clicked. */
  onClose: () => void;
  /** The `.scrim` and the `.pal` or `.modal` panel. */
  children: ReactNode;
  className?: string;
  /**
   * Focus the dialog itself rather than its first control. For a dialog you read rather than fill
   * in (the shortcut sheet): its name is read out, Tab reaches the controls, and no focus ring shows
   * on a button the user did not choose.
   */
  focusSelf?: boolean;
}

/**
 * A full-screen, invisible native `<dialog>` opened with `showModal()` (E1). The browser then
 * makes the page behind inert and keeps focus inside, so we do not need our own focus trap.
 * Its own Esc (`cancel`) is blocked: the key stack closes the layer, so Esc has one owner.
 * It pushes no key layer itself; the caller does. While open it holds the floating container, so
 * toasts, menus and the tooltip still show above it. On close, focus goes back to the element
 * that had it before (E8).
 */
export function ModalLayer({
  label,
  onClose,
  children,
  className,
  focusSelf = false,
}: ModalLayerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  // Where focus goes is decided once, when the dialog opens.
  const focusSelfOnOpen = useRef(focusSelf);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog === null) {
      return undefined;
    }
    const opener = document.activeElement;
    if (!dialog.open) {
      // happy-dom may lack showModal(); the open attribute is the fallback.
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
    }
    if (focusSelfOnOpen.current) {
      dialog.focus();
    }
    const releaseFloating = hostFloating(dialog);
    // Native listener: the dialog is not a control, and Esc and keys are handled by the key stack.
    const onClick = (event: MouseEvent) => {
      if (event.target === dialog) {
        onCloseRef.current();
      }
    };
    dialog.addEventListener("click", onClick);
    return () => {
      dialog.removeEventListener("click", onClick);
      releaseFloating();
      if (dialog.open) {
        if (typeof dialog.close === "function") {
          dialog.close();
        } else {
          dialog.removeAttribute("open");
        }
      }
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={className === undefined ? "layer" : `layer ${className}`}
      aria-label={label}
      tabIndex={focusSelf ? -1 : undefined}
      onCancel={(event) => {
        event.preventDefault();
      }}
    >
      {children}
    </dialog>
  );
}

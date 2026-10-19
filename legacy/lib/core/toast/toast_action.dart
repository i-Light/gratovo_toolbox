/// An optional button on a toast — e.g. "Resume" jumping back to the screen
/// something is still running on. Rare: most toasts are read-only, so most
/// [AppToast.show] calls pass none.
class ToastAction {
  const ToastAction({required this.label, required this.onPressed});

  final String label;
  final void Function() onPressed;
}

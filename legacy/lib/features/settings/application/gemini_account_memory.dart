import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge.dart';

/// The Google account last seen signed in to Gemini, as the settings hold it —
/// or null when none has been seen yet.
GeminiAccount? lastSeenAccount(GeminiBridgeSettings settings) {
  final name = settings.lastAccountName.trim();
  final email = settings.lastAccountEmail.trim();
  if (name.isEmpty && email.isEmpty) return null;
  return GeminiAccount(
    name: name.isEmpty ? null : name,
    email: email.isEmpty ? null : email,
    index: settings.lastAccountIndex,
  );
}

/// [settings] with [seen] remembered as the last account — the very same
/// instance when there is nothing to change, so a caller can skip the write.
///
/// A name or email that arrives alone updates just that half when it can only
/// be the same person; it never leaves the OLD account's other half behind. An
/// email that differs from the remembered one is a different account, so the
/// remembered name goes with it — "Ana (ana@x.com)" must not become "Ana
/// (bob@y.com)" because the page reported only an email this time.
GeminiBridgeSettings withAccountSeen(
  GeminiBridgeSettings settings,
  GeminiAccount seen,
) {
  final seenName = seen.name?.trim() ?? '';
  final seenEmail = seen.email?.trim() ?? '';
  if (seenName.isEmpty && seenEmail.isEmpty) return settings;

  var name = settings.lastAccountName.trim();
  var email = settings.lastAccountEmail.trim();
  final sameEmail = seenEmail.isNotEmpty &&
      email.isNotEmpty &&
      seenEmail.toLowerCase() == email.toLowerCase();
  final sameName = seenName.isNotEmpty &&
      name.isNotEmpty &&
      seenName.toLowerCase() == name.toLowerCase();

  if (seenEmail.isNotEmpty) {
    if (!sameEmail) {
      name = '';
      email = seenEmail;
    }
    if (seenName.isNotEmpty && !sameName) name = seenName;
  } else {
    // Name only. The remembered email stays when it is the same person; a
    // different name means somebody else signed in, and an email that is not
    // theirs would be a false statement.
    if (!sameName && name.isNotEmpty) email = '';
    if (!sameName) name = seenName;
  }

  final index =
      seen.index ?? (sameEmail || sameName ? settings.lastAccountIndex : null);
  final unchanged = name == settings.lastAccountName &&
      email == settings.lastAccountEmail &&
      index == settings.lastAccountIndex;
  if (unchanged) return settings;
  return settings.copyWith(
    lastAccountName: name,
    lastAccountEmail: email,
    lastAccountIndex: index,
    clearLastAccountIndex: index == null,
  );
}

/// Remembers the signed-in account whenever the bridge reports one, so the
/// Settings card can still say who Gemini belongs to when the browser is
/// closed — the account the person signed in with is a fact the connection
/// tells us, not something they typed, and it used to vanish with the
/// connection.
///
/// Fed from every place the account is reported: the connected state (each
/// `status` event and `bridge.status` carry it), the extension's `hello`, and
/// [rememberGeminiAccount] for a result a caller already holds
/// (`bridge.ensure_window`). Writes go through the settings notifier's `edit`,
/// which waits for the saved values to load first — so a boot-time write can
/// no longer land on top of them, which is what made the account "disappear".
final geminiAccountMemoryProvider = Provider<void>((ref) {
  final bridge = ref.watch(geminiBridgeProvider);

  ref.listen<GeminiBridgeState>(
    geminiBridgeStateProvider,
    (_, next) => rememberGeminiAccount(ref, next.account),
    fireImmediately: true,
  );

  final subscription = bridge.events.listen((event) {
    if (event.event == 'hello') {
      rememberGeminiAccount(ref, GeminiAccount.fromJson(event.data['account']));
    }
  });
  ref.onDispose(subscription.cancel);
});

/// Persists [account] as the last one seen, when there is one and it is news.
Future<void> rememberGeminiAccount(Ref ref, GeminiAccount? account) async {
  if (account == null || account.isEmpty) return;
  final notifier = ref.read(geminiBridgeSettingsProvider.notifier);
  // Wait for the load, then look: comparing against the defaults a notifier
  // holds before then would call every account "news" and rewrite it.
  await notifier.ready;
  if (identical(
    withAccountSeen(ref.read(geminiBridgeSettingsProvider), account),
    ref.read(geminiBridgeSettingsProvider),
  )) {
    return;
  }
  await notifier.edit((current) => withAccountSeen(current, account));
}

/// The same for callers holding a `WidgetRef` — a card that just got a window
/// result back.
Future<void> rememberGeminiAccountFrom(
  WidgetRef ref,
  GeminiAccount? account,
) async {
  if (account == null || account.isEmpty) return;
  final notifier = ref.read(geminiBridgeSettingsProvider.notifier);
  await notifier.ready;
  final current = ref.read(geminiBridgeSettingsProvider);
  if (identical(withAccountSeen(current, account), current)) return;
  await notifier.edit((current) => withAccountSeen(current, account));
}

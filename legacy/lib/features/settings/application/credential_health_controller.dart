import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _credentialHealthPrefsKey = 'gratovo.credentials.health';

/// The Accounts-card credentials that keep no live status of their own.
///
/// Gmail and Supabase are deliberately absent: both can be asked how they're
/// doing at any moment (`gmailStatusProvider` re-runs `--status`, and the
/// Supabase session carries its own expiry), so recording a remembered verdict
/// for them would only add a second answer that can disagree with the first.
/// These two can't be asked — an API key is either accepted or refused by a
/// call somebody made, and between calls there is nothing to look at.
enum CredentialArea {
  /// The AI provider API key behind `AiProvidersCard`.
  aiProvider,

  /// The gateway credentials behind `AwsAccountsCard`.
  awsGateway,
}

enum CredentialOutcome {
  /// The last authenticated call using this credential was accepted.
  ok,

  /// The last call was refused for a reason that is about the credential
  /// itself — 401/403, a revoked key, a changed password. Not a timeout and
  /// not a 500: a server having a bad day says nothing about the key.
  rejected,
}

/// What happened the last time a credential was used, and when.
@immutable
class CredentialStatus {
  const CredentialStatus({required this.outcome, required this.at});

  final CredentialOutcome outcome;
  final DateTime at;

  bool get isRejected => outcome == CredentialOutcome.rejected;

  Map<String, dynamic> toJson() => {
        'outcome': outcome.name,
        'at': at.toIso8601String(),
      };

  static CredentialStatus? fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    final outcome = CredentialOutcome.values
        .where((o) => o.name == raw['outcome'])
        .firstOrNull;
    final at = DateTime.tryParse(raw['at'] as String? ?? '');
    if (outcome == null || at == null) return null;
    return CredentialStatus(outcome: outcome, at: at);
  }
}

/// Remembers whether each credential in [CredentialArea] was accepted or
/// refused the last time something actually used it.
///
/// Persisted, because the question it answers outlives the session: a key
/// revoked on Tuesday is still revoked on Wednesday, and a badge that forgot
/// every restart would only ever light up for people who happened to trigger
/// the failing call again. Restored state is a memory of the last call, not a
/// claim about right now — nothing here re-verifies anything, and a rejection
/// clears the moment a later call succeeds.
class CredentialHealthNotifier
    extends Notifier<Map<CredentialArea, CredentialStatus>> {
  @override
  Map<CredentialArea, CredentialStatus> build() {
    unawaited(_loadPersisted());
    return const {};
  }

  Future<void> _loadPersisted() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_credentialHealthPrefsKey);
      if (raw == null) return;
      final decoded = jsonDecode(raw) as Map<String, dynamic>;
      final restored = <CredentialArea, CredentialStatus>{};
      for (final area in CredentialArea.values) {
        final status = CredentialStatus.fromJson(decoded[area.name]);
        if (status != null) restored[area] = status;
      }
      // Merged rather than assigned: a call can land and report before this
      // read comes back, and a fresh verdict must not be overwritten by an
      // older stored one.
      state = {...restored, ...state};
    } catch (error, stackTrace) {
      developer.log(
        'Failed to load credential health; starting with none recorded.',
        name: 'gratovo.credentials',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  /// Records the outcome of a call that used [area]'s credential.
  ///
  /// Call this only where the result genuinely says something about the
  /// credential. A network timeout, a 500, or a user cancelling is not a
  /// rejection, and reporting one as such would badge Settings for something
  /// no one can fix there.
  Future<void> report(CredentialArea area, CredentialOutcome outcome) async {
    final existing = state[area];
    if (existing?.outcome == outcome) return;
    state = {
      ...state,
      area: CredentialStatus(outcome: outcome, at: DateTime.now()),
    };
    await _persist();
  }

  /// Forgets a recorded verdict — for when the credential is replaced, where
  /// the old key's rejection says nothing about the new one.
  Future<void> clear(CredentialArea area) async {
    if (!state.containsKey(area)) return;
    state = {...state}..remove(area);
    await _persist();
  }

  Future<void> _persist() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _credentialHealthPrefsKey,
        jsonEncode({
          for (final entry in state.entries)
            entry.key.name: entry.value.toJson(),
        }),
      );
    } catch (error, stackTrace) {
      developer.log(
        'Failed to persist credential health.',
        name: 'gratovo.credentials',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }
}

final credentialHealthProvider = NotifierProvider<CredentialHealthNotifier,
    Map<CredentialArea, CredentialStatus>>(CredentialHealthNotifier.new);

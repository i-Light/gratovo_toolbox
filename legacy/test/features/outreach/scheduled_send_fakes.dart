import 'dart:async';

import 'package:gratovo_toolbox/core/native/gmail_protocol.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';

/// A mailbox that behaves like `email_send.py` about send keys: a key it has
/// already sent is answered with the original send and delivers nothing.
class FakeKeyedMailbox implements GmailGateway {
  final delivered = <GmailSendRequest>[];
  final keysSent = <String>{};
  int calls = 0;
  GmailError? failWith;
  Completer<void>? hold;

  @override
  Future<GmailOutcome<GmailSendReceipt>> send(GmailSendRequest request) async {
    calls += 1;
    if (hold != null) await hold!.future;
    if (failWith != null) return GmailOutcome.failure(failWith);
    final key = request.sendKey;
    final duplicate = key != null && keysSent.contains(key);
    if (!duplicate) {
      if (key != null) keysSent.add(key);
      delivered.add(request);
    }
    return GmailOutcome.success(
      GmailSendReceipt(
        account: 'outreach@gratovo.test',
        conversationKey: request.conversationKey,
        messageId: 'm${delivered.length}',
        sentAt: DateTime.utc(2026, 10, 1, 9),
        duplicate: duplicate,
      ),
    );
  }

  @override
  Future<GmailOutcome<GmailStatus>> status() async =>
      const GmailOutcome.success(GmailStatus.unconfigured);

  @override
  Future<GmailOutcome<String>> connect() async =>
      const GmailOutcome.success('');

  @override
  Future<GmailOutcome<bool>> disconnect({String? account}) async =>
      const GmailOutcome.success(true);

  @override
  Future<GmailOutcome<GmailSweep>> runDue({
    bool checkOnly = false,
    String? conversationKey,
    int? limit,
    String? account,
  }) async =>
      const GmailOutcome.success(GmailSweep.empty);

  @override
  Future<GmailOutcome<int>> acknowledge(List<String> messageIds) async =>
      const GmailOutcome.success(0);

  @override
  Future<GmailOutcome<int>> cancelFollowUps(String conversationKey) async =>
      const GmailOutcome.success(0);

  @override
  Future<GmailOutcome<String>> sendTest({String? to, String? account}) async =>
      const GmailOutcome.success('');
}

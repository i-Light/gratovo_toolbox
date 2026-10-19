import 'package:gratovo_toolbox/data/models/remote_search_request.dart';

/// Sending a keyword list to another team member's machine, and reading back
/// what's been sent to yours.
///
/// [incomingPending] is what [RemoteSearchIntakeController] (see
/// `remote_search_intake_controller.dart`) watches to know when to merge
/// keywords into this machine's own box and start/resume a run. [send] is
/// what the Search screen's upload dialog calls.
abstract interface class RemoteSearchRepository {
  /// Every request addressed to the current user, in either direction —
  /// what the upload dialog's "sent" history and the intake controller both
  /// read from.
  Future<List<RemoteSearchRequest>> fetchAll();

  /// Requests addressed to the current user that haven't been applied or
  /// dismissed yet.
  Future<List<RemoteSearchRequest>> incomingPending();

  /// Hands [keywords] (newline-separated) to [toUserId].
  Future<void> send({required String toUserId, required String keywords});

  /// Marks a request as picked up by the recipient's machine.
  Future<void> markApplied(String id);

  /// Marks a request as deliberately not acted on.
  Future<void> markDismissed(String id);
}

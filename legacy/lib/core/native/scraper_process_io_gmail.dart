part of 'scraper_process_io.dart';

/// The outreach mailbox: `tools/email_send.py`.
///
/// Every method here runs the same script, always with `--json`, and always
/// returns its raw output for `gmail_gateway.dart` to parse. The split is
/// deliberate: this library may not import anything that does not exist on
/// web, and the protocol types have to be unit-testable without an
/// interpreter -- see gmail_protocol.dart.
class GmailBridge {
  const GmailBridge._();

  /// Runs `tools/email_send.py` with [arguments] and returns what it printed.
  ///
  /// Shared by every mailbox command rather than copied six times, because the
  /// details that matter are identical for all of them and easy to get subtly
  /// wrong one at a time: `--json` on every invocation, the lenient UTF-8
  /// decoders that must match [_utf8PythonEnvironment], and `GRATOVO_DATA_DIR`
  /// so the tool opens the same `mailbox.db` the app is looking at.
  static Future<ProcessResultLite> _runMailboxTool({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    required List<String> arguments,
  }) async {
    _requirePipelineDir(paths);
    await PipelineDataDir.ensureDataDir(paths);
    final result = await Process.run(
      ScraperProcess.resolveInterpreter(pythonExecutable),
      ['tools/email_send.py', ...arguments, '--json'],
      workingDirectory: paths.pipelineDir,
      environment: _environmentFor(paths),
      stdoutEncoding: _lenientUtf8,
      stderrEncoding: _lenientUtf8,
    );
    final output = [
      if ((result.stdout as String).isNotEmpty) result.stdout,
      if ((result.stderr as String).isNotEmpty) result.stderr,
    ].join('\n');
    return ProcessResultLite(exitCode: result.exitCode, output: output);
  }

  /// `tools/email_send.py --status` — which mailbox this machine sends as.
  ///
  /// Touches Gmail (one profile lookup) but never sends anything, and exits 0
  /// even when nothing is connected: "no mailbox here" is the answer the app
  /// is asking for, not a failure to get one.
  static Future<ProcessResultLite> gmailStatus({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
  }) {
    return _runMailboxTool(
      pythonExecutable: pythonExecutable,
      paths: paths,
      arguments: const ['--status'],
    );
  }

  /// `tools/email_send.py --authorize --save` — connects a mailbox here.
  ///
  /// Opens the system browser and runs a localhost redirect listener inside the
  /// tool, then blocks until the person finishes signing in (or abandons the
  /// tab) — so this call can sit unresolved for a minute or more, and the UI
  /// that starts it must say so. On success the refresh token is written to
  /// `data/.env.local` and the next `--status` reports the mailbox connected.
  static Future<ProcessResultLite> gmailAuthorize({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
  }) {
    return _runMailboxTool(
      pythonExecutable: pythonExecutable,
      paths: paths,
      arguments: const ['--authorize', '--save'],
    );
  }

  /// `tools/email_send.py --sign-out` — forgets one of this machine's
  /// mailboxes.
  ///
  /// Clears that mailbox's saved refresh token and nothing else: the grant
  /// itself stays live at Google until it is revoked from the account's
  /// permissions page. [account] picks which mailbox; it may be left out
  /// only when at most one is connected. Safe to run when nothing is
  /// connected.
  static Future<ProcessResultLite> gmailSignOut({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    String? account,
  }) {
    return _runMailboxTool(
      pythonExecutable: pythonExecutable,
      paths: paths,
      arguments: [
        '--sign-out',
        if (account != null && account.isNotEmpty) ...['--account', account],
      ],
    );
  }

  /// `tools/email_send.py --send` — sends one outreach email.
  ///
  /// The request goes through a temporary JSON file rather than command-line
  /// arguments, and that is not tidiness. A message body has newlines, quotes
  /// and non-ASCII in it; a Windows command line has an escaping model for
  /// none of the three. Passing a body as an argument is one quoting bug away
  /// from sending a mangled email to a stranger, and there is no taking that
  /// back. The file is deleted whether the send worked or not.
  static Future<ProcessResultLite> gmailSend({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    required GmailSendRequest request,
  }) async {
    final payload = await File(
      _join(
        Directory.systemTemp.path,
        'gratovo-send-${DateTime.now().microsecondsSinceEpoch}.json',
      ),
    ).create();
    try {
      await payload.writeAsString(jsonEncode(request.toJson()));
      return await _runMailboxTool(
        pythonExecutable: pythonExecutable,
        paths: paths,
        arguments: ['--send', '--payload', payload.path],
      );
    } finally {
      try {
        if (payload.existsSync()) await payload.delete();
      } on FileSystemException {
        // A leftover file in the temp folder is not worth failing a send that
        // already happened.
      }
    }
  }

  /// `tools/email_send.py --run-due` — the whole automatic half, one sweep.
  ///
  /// Looks for replies on every conversation still awaiting one, then sends
  /// any follow-up whose time has come *and* whose conversation has not since
  /// replied. That ordering is the interrupt: see the tool's module docstring.
  ///
  /// [checkOnly] passes `--check-replies` instead, which sweeps and sends
  /// nothing — what the Outreach page's manual "check for replies" uses, where
  /// quietly firing a batch of queued follow-ups would be a surprise.
  ///
  /// Safe to call often and safe to call concurrently with a scheduled run of
  /// the same command: every send is gated on a row transition in SQLite.
  static Future<ProcessResultLite> gmailRunDue({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    bool checkOnly = false,
    String? conversationKey,
    int? limit,
    String? account,
  }) {
    return _runMailboxTool(
      pythonExecutable: pythonExecutable,
      paths: paths,
      arguments: [
        if (checkOnly) '--check-replies' else '--run-due',
        if (conversationKey != null) ...['--conversation', conversationKey],
        if (limit != null) ...['--limit', '$limit'],
        if (account != null && account.isNotEmpty) ...['--account', account],
      ],
    );
  }

  /// `tools/email_send.py --ack` — confirms replies are recorded in the CRM.
  ///
  /// Deliberately a second round trip. The tool keeps handing a reply over
  /// until it is told the app wrote it down, so an app that dies halfway
  /// through applying one sees it again on the next sweep instead of losing
  /// it. Calling this before the write would trade that for silent data loss.
  static Future<ProcessResultLite> gmailAcknowledgeReplies({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    required List<String> messageIds,
  }) {
    return _runMailboxTool(
      pythonExecutable: pythonExecutable,
      paths: paths,
      arguments: ['--ack', '--messages', messageIds.join(',')],
    );
  }

  /// `tools/email_send.py --cancel` — drops the queued follow-ups for a thread.
  ///
  /// The manual half of the interrupt. A reply stops the sequence on its own;
  /// this is for the conversation that moved to a phone call, or the one
  /// somebody has decided not to chase.
  static Future<ProcessResultLite> gmailCancelFollowUps({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    required String conversationKey,
  }) {
    return _runMailboxTool(
      pythonExecutable: pythonExecutable,
      paths: paths,
      arguments: ['--cancel', '--conversation', conversationKey],
    );
  }

  /// `tools/email_send.py --test-send` — proves the mailbox works.
  ///
  /// Records nothing: a test is not a conversation, and it must not turn up in
  /// the reply sweep or acquire follow-ups.
  static Future<ProcessResultLite> gmailTestSend({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    String? to,
    String? account,
  }) {
    return _runMailboxTool(
      pythonExecutable: pythonExecutable,
      paths: paths,
      arguments: [
        '--test-send',
        if (to != null && to.isNotEmpty) ...['--to', to],
        if (account != null && account.isNotEmpty) ...['--account', account],
      ],
    );
  }
}

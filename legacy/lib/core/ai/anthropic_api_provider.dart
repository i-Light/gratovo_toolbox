import 'dart:convert';

import 'package:gratovo_toolbox/core/ai/ai_provider.dart';
import 'package:gratovo_toolbox/data/models/ai_provider_config.dart';
import 'package:http/http.dart' as http;

/// Thrown when a real API call fails — a missing/invalid key, a network
/// error, an unexpected response shape. The UI (thread_detail_panel.dart's
/// `_generateDraft`) catches this and shows the message in a snackbar
/// rather than letting it propagate as an unhandled exception, since —
/// unlike `TemplateFillAiProvider`, which never fails — a real network
/// call genuinely can.
class AiProviderException implements Exception {
  AiProviderException(this.message, {this.statusCode});

  final String message;

  /// The HTTP status behind the failure, when there was one. Null for the
  /// failures that never reached the network (no key configured) or that the
  /// transport raised.
  final int? statusCode;

  /// Whether the provider refused the credential itself, as opposed to
  /// failing for any of the other reasons an API call fails.
  ///
  /// Only 401 and 402/403 count. A 429 is a rate limit on a key that plainly
  /// works, and a 5xx is the provider's problem — treating either as "your
  /// key is bad" would badge Settings over something nobody can fix there.
  /// 402 is included because a provider that has stopped honouring a key over
  /// billing is, from the user's side, exactly a credential that needs
  /// attention.
  bool get isAuthFailure =>
      statusCode == 401 || statusCode == 402 || statusCode == 403;

  @override
  String toString() => message;
}

/// The first real, network-calling [AiProvider] — calls Anthropic's
/// Messages API directly with a team member's own API key (see
/// `data/models/ai_provider_config.dart`). This is the provider the
/// original build plan meant by "ships with a Claude API implementation" —
/// deliberately not built until the key-management UI (Settings → AI
/// Providers) existed: shipping a fake version of this before a key could be
/// entered would have lied about what was happening, so the deterministic
/// fallback shipped alone first.
///
/// Unlike `TemplateFillAiProvider`, this provider DOES read
/// [AiDraftContext.writingRules] — an actual model can follow free-text
/// instructions, which is exactly what literal token substitution cannot
/// do.
///
/// Takes an [http.Client] so tests can inject `package:http/testing.dart`'s
/// `MockClient` instead of hitting the real network.
class AnthropicApiProvider implements AiProvider {
  AnthropicApiProvider({required this.config, http.Client? client})
      : _client = client ?? http.Client();

  final AiProviderConfig config;
  final http.Client _client;

  static const _endpoint = 'https://api.anthropic.com/v1/messages';
  static const _anthropicVersion = '2023-06-01';

  @override
  String get id => 'anthropic:${config.id}';

  @override
  String get displayName => config.displayName;

  @override
  Future<AiDraftResult> draftEmail(AiDraftContext context) async {
    if (config.apiKey.trim().isEmpty) {
      throw AiProviderException('This provider has no API key configured.');
    }

    final response = await _client.post(
      Uri.parse(_endpoint),
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': _anthropicVersion,
      },
      body: jsonEncode({
        'model': config.model,
        'max_tokens': 1024,
        'system': _systemPrompt(context),
        'messages': [
          {
            'role': 'user',
            'content': 'Write the outreach email now, as JSON only.',
          },
        ],
      }),
    );

    if (response.statusCode != 200) {
      throw AiProviderException(
        'Anthropic API returned ${response.statusCode}: '
        '${_shorten(response.body)}',
        statusCode: response.statusCode,
      );
    }

    final Map<String, dynamic> decoded;
    try {
      decoded = jsonDecode(response.body) as Map<String, dynamic>;
    } catch (_) {
      throw AiProviderException(
          'Anthropic API returned an unreadable response.');
    }

    final content = decoded['content'];
    if (content is! List || content.isEmpty) {
      throw AiProviderException('Anthropic API response had no content.');
    }
    final text = (content.first as Map<String, dynamic>)['text'] as String?;
    if (text == null) {
      throw AiProviderException('Anthropic API response had no text.');
    }

    return _parseDraft(text);
  }

  String _systemPrompt(AiDraftContext context) {
    final buffer = StringBuffer()
      ..writeln(
        'You draft short, friendly outreach emails for an influencer-'
        'marketing agency reaching out to a YouTube creator about a paid '
        'collaboration. Reply with ONLY a JSON object of the exact shape '
        '{"subject": "...", "body": "..."} and nothing else — no markdown '
        'fences, no commentary.',
      )
      ..writeln('Creator handle: ${context.influencerHandle}');

    if (context.recentVideoTitles.isNotEmpty) {
      buffer.writeln(
        'Recent video titles: ${context.recentVideoTitles.join(', ')}',
      );
    }
    if (context.relevanceCriteria.isNotEmpty) {
      buffer.writeln(
        'What we care about in their content: '
        '${context.relevanceCriteria.join(', ')}',
      );
    }
    if (context.templateSubject != null && context.templateBody != null) {
      buffer
        ..writeln('Base the draft on this template (adapt it, don\'t just')
        ..writeln('repeat it verbatim):')
        ..writeln('Subject: ${context.templateSubject}')
        ..writeln('Body: ${context.templateBody}');
    }
    if (context.writingRules.isNotEmpty) {
      buffer.writeln(
        'Always follow these writing rules: ${context.writingRules.join('; ')}',
      );
    }
    return buffer.toString();
  }

  AiDraftResult _parseDraft(String text) {
    try {
      final decoded = jsonDecode(text.trim()) as Map<String, dynamic>;
      final subject = decoded['subject'] as String?;
      final body = decoded['body'] as String?;
      if (subject == null || body == null) {
        throw const FormatException('missing subject/body');
      }
      return AiDraftResult(subject: subject, body: body);
    } catch (_) {
      // The model didn't follow the JSON-only instruction. Fall back to
      // showing the raw text as the body rather than losing the draft
      // entirely — the team member can still use/edit it by hand.
      return AiDraftResult(subject: '', body: text.trim());
    }
  }

  String _shorten(String text) =>
      text.length > 200 ? '${text.substring(0, 200)}…' : text;
}

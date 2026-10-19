/// Whether a template is written for email (has a subject line) or for a
/// direct message on a social channel (body only). The composer shows the
/// email set when the selected contact method is `email` and the DM set for
/// everything else.
enum TemplateKind {
  email,
  dm;

  /// The value stored in `email_templates.kind`. Spelled out as its own
  /// getter — same reasoning as [ContactMethod.wire].
  String get wire => name;

  static TemplateKind fromWire(String? value) {
    for (final kind in TemplateKind.values) {
      if (kind.name == value) return kind;
    }
    return TemplateKind.email;
  }
}

/// A reusable outreach template — the "template library" from the owner's
/// outreach requirements. `body` (and `subject`, for email templates) may
/// contain `{{token}}` placeholders (e.g. `{{handle}}`, `{{lastVideoTitle}}`)
/// that the AI draft flow (see `lib/core/ai/`) fills in with real influencer
/// data; a template can also just be used as-is with the tokens left for the
/// sender to fill in by hand.
class EmailTemplate {
  const EmailTemplate({
    required this.id,
    required this.name,
    required this.subject,
    required this.body,
    this.kind = TemplateKind.email,
  });

  final String id;
  final String name;
  final String subject;
  final String body;
  final TemplateKind kind;

  EmailTemplate copyWith({
    String? name,
    String? subject,
    String? body,
    TemplateKind? kind,
  }) {
    return EmailTemplate(
      id: id,
      name: name ?? this.name,
      subject: subject ?? this.subject,
      body: body ?? this.body,
      kind: kind ?? this.kind,
    );
  }
}

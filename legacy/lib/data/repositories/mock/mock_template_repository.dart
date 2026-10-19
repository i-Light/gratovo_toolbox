import 'package:gratovo_toolbox/data/models/email_template.dart';
import 'package:gratovo_toolbox/data/repositories/template_repository.dart';

/// In-memory [TemplateRepository], seeded with starter templates covering
/// the moments outreach actually needs one: first contact, a no-reply
/// nudge, a negotiation-stage note, and one short DM variant for the
/// social-channel composer. `{{token}}` placeholders are filled in by
/// `TemplateFillAiProvider` (see `lib/core/ai/`).
class MockTemplateRepository implements TemplateRepository {
  final List<EmailTemplate> _templates = [
    const EmailTemplate(
      id: 'tmpl_001',
      name: 'Initial Outreach',
      subject: 'Quick collab idea for {{handle}}',
      body: 'Hi {{handle}} team,\n\n'
          "I'm reaching out from Gratovo — we work with a few brands whose "
          'audience overlaps a lot with yours. Your video "'
          '{{recentVideoTitle}}" is exactly the kind of content our '
          'partners look for.\n\n'
          'Would you be open to a quick chat about a paid collab? Happy to '
          'share more details on rates and what it would involve.\n\n'
          'Best,\nGratovo',
    ),
    const EmailTemplate(
      id: 'tmpl_002',
      name: 'Follow-up (no reply)',
      subject: 'Following up — {{handle}} x Gratovo',
      body: 'Hi again,\n\n'
          'Just floating this back to the top of your inbox in case it got '
          'buried — still interested in exploring a collab with '
          '{{handle}} if the timing works on your end.\n\n'
          'No worries at all if not — just let me know either way.\n\n'
          'Best,\nGratovo',
    ),
    const EmailTemplate(
      id: 'tmpl_003',
      name: 'Negotiation nudge',
      subject: "Let's find a number that works",
      body: 'Hi {{handle}} team,\n\n'
          "Thanks for the details so far. We'd like to find a number that "
          'works well for both sides — happy to hop on a quick call if '
          "that's easier than going back and forth over email.\n\n"
          'Best,\nGratovo',
    ),
    const EmailTemplate(
      id: 'tmpl_004',
      name: 'Short DM',
      subject: '',
      body: "Hey {{handle}}! Loved \"{{lastVideoTitle}}\". We're at Gratovo "
          'and work with brands that fit your audience — open to a quick '
          'chat about a paid collab?',
      kind: TemplateKind.dm,
    ),
  ];

  @override
  Future<List<EmailTemplate>> getAll() async => List.unmodifiable(_templates);

  @override
  Future<void> upsert(EmailTemplate template) async {
    final index = _templates.indexWhere((t) => t.id == template.id);
    if (index == -1) {
      _templates.add(template);
    } else {
      _templates[index] = template;
    }
  }

  @override
  Future<void> delete(String id) async {
    _templates.removeWhere((t) => t.id == id);
  }
}

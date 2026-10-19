import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';

/// One contact this app noticed while reading a channel's own scraped text,
/// worth putting in front of a person as a suggestion.
///
/// This is a *suggestion*, not a write. [findContactCandidates] never touches
/// `Influencer.contacts` — the only way one of these becomes a saved contact
/// is a person choosing to add it, through the same compare-and-set path
/// every other contact edit already goes through
/// (`influencer_mutation_guard.dart`).
class ContactCandidate {
  const ContactCandidate({
    required this.method,
    required this.value,
    this.isBusinessInquiry = false,
  });

  final ContactMethod method;

  /// Exactly as found in the text — not reformatted, matching the same
  /// "never normalise on the way in" rule [InfluencerContact.value] follows.
  final String value;

  /// Whether this address was found near a phrase like "for business
  /// inquiries" or "collab" — worth leading with, since it is the address the
  /// channel itself is pointing outreach at.
  final bool isBusinessInquiry;

  @override
  bool operator ==(Object other) =>
      other is ContactCandidate &&
      other.method == method &&
      other.value == value &&
      other.isBusinessInquiry == isBusinessInquiry;

  @override
  int get hashCode => Object.hash(method, value, isBusinessInquiry);

  @override
  String toString() =>
      'ContactCandidate($method, $value, business: $isBusinessInquiry)';
}

/// A plain, in-the-open email address.
///
/// Deliberately simple — see the file doc for why an aggressive obfuscation
/// parser is not attempted here.
final RegExp _emailPattern = RegExp(
  r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}',
);

/// The one obfuscation shape common enough to be worth a dedicated pattern:
/// "name [at] domain [dot] com", with or without the brackets/parens, and
/// with any amount of surrounding whitespace. Variants this deliberately does
/// NOT attempt — "name AT domain DOT com" with no separators from surrounding
/// words, unicode homoglyphs, "name At domain dawt com" — are the trade-off
/// noted in the report: catching every obfuscation style invites false
/// positives (an "at" that is just the word "at" in a sentence near an "@").
final RegExp _obscuredEmailPattern = RegExp(
  r'([A-Za-z0-9._%+\-]+)\s*[\[(]?\s*at\s*[\])]?\s*'
  r'([A-Za-z0-9.\-]+)\s*[\[(]?\s*dot\s*[\])]?\s*([A-Za-z]{2,})',
  caseSensitive: false,
);

/// A handle body: starts and ends on a letter/digit/underscore, dots allowed
/// only in the middle. Without that, a handle sitting at the end of a
/// sentence — "...also on Instagram @creatorname." — would swallow the
/// full stop as if it were part of the username, since `.` is otherwise a
/// legal handle character.
const String _handleBody = '[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?';

final RegExp _instagramUrlPattern = RegExp(
  'instagram\\.com/($_handleBody)',
  caseSensitive: false,
);

/// A bare `@handle` mention. The negative lookbehind is what keeps this from
/// also matching the domain half of a plain email address — `hello@site.com`
/// has a word character directly before its `@`, which no genuine "handle
/// mention" ever does (it is always preceded by whitespace, punctuation, or
/// the start of the text).
final RegExp _bareHandlePattern = RegExp('(?<![\\w.])@($_handleBody)');

/// Whether the text mentions Instagram at all — the gate for treating a bare
/// `@handle` as an Instagram candidate rather than, say, a shout-out to
/// another creator or an X/Twitter mention.
final RegExp _instagramMentionPattern =
    RegExp(r'instagram|\big\b', caseSensitive: false);

final RegExp _businessInquiryPattern = RegExp(
  r'(business\s+inquir|for\s+business|collab(?:oration)?s?\b|'
  r'brand\s+deals?|sponsorships?)',
  caseSensitive: false,
);

/// How close (in characters) a business-inquiry phrase has to sit to a found
/// email for that email to be flagged [ContactCandidate.isBusinessInquiry].
const int _businessInquiryProximityChars = 120;

/// Scans [influencer]'s already-scraped text for likely contact info and
/// returns candidates a person can accept or dismiss.
///
/// Pure and read-only: it never touches the database, the network, or
/// `influencer.contacts` — see the widget that calls this
/// (`influencer_contacts_card.dart`) for the accept/dismiss UI and the write
/// path an accepted candidate actually goes through.
///
/// Reads [Influencer.description] (the About text), then adds
/// [Influencer.foundEmails] — what the pipeline found in the About text AND
/// the stored video descriptions, spelled-out forms included (fix #11), so an
/// address published only under a video still reaches this list. Already-saved
/// contacts are never suggested again: an email or handle already on
/// [Influencer.contacts] is dropped before it ever reaches the caller.
List<ContactCandidate> findContactCandidates(Influencer influencer) {
  final text = influencer.description ?? '';

  final existingEmails = <String>{
    for (final c in influencer.contacts)
      if (c.method == ContactMethod.email) c.value.trim().toLowerCase(),
  };
  final existingInstagramHandles = <String>{
    for (final c in influencer.contacts)
      if (c.method == ContactMethod.instagram) _instagramHandleOf(c.value),
  };

  final businessInquiryStarts = [
    for (final m in _businessInquiryPattern.allMatches(text)) m.start,
  ];
  bool nearBusinessInquiry(int index) => businessInquiryStarts.any(
        (start) => (index - start).abs() <= _businessInquiryProximityChars,
      );

  final results = <ContactCandidate>[];
  final seenEmails = <String>{};
  final seenInstagramHandles = <String>{};

  void addEmail(String value, int matchStart) {
    final normalized = value.trim().toLowerCase();
    if (normalized.isEmpty || existingEmails.contains(normalized)) return;
    final isBusiness = nearBusinessInquiry(matchStart);
    if (!seenEmails.add(normalized)) {
      // Seen already in this same scan — only worth touching again to
      // upgrade it to "business inquiry" if a second, nearer mention says so.
      if (isBusiness) {
        final index = results.indexWhere(
          (c) =>
              c.method == ContactMethod.email &&
              c.value.trim().toLowerCase() == normalized,
        );
        if (index != -1 && !results[index].isBusinessInquiry) {
          results[index] = ContactCandidate(
            method: ContactMethod.email,
            value: results[index].value,
            isBusinessInquiry: true,
          );
        }
      }
      return;
    }
    results.add(ContactCandidate(
      method: ContactMethod.email,
      value: value,
      isBusinessInquiry: isBusiness,
    ));
  }

  void addInstagram(String handleWithAt) {
    final normalized = _instagramHandleOf(handleWithAt);
    if (normalized.isEmpty) return;
    if (existingInstagramHandles.contains(normalized)) return;
    if (!seenInstagramHandles.add(normalized)) return;
    results.add(ContactCandidate(
      method: ContactMethod.instagram,
      value: handleWithAt,
    ));
  }

  for (final match in _emailPattern.allMatches(text)) {
    addEmail(match.group(0)!, match.start);
  }

  for (final match in _obscuredEmailPattern.allMatches(text)) {
    final value = '${match.group(1)}@${match.group(2)}.${match.group(3)}';
    // Skip anything the plain-email pattern already caught (a normal address
    // is never also matched by the "at"/"dot" pattern, since that requires
    // the literal words — this guard is only against the same obfuscated
    // address appearing twice in the text under slightly different spacing).
    addEmail(value, match.start);
  }

  for (final match in _instagramUrlPattern.allMatches(text)) {
    addInstagram('@${match.group(1)}');
  }

  if (_instagramMentionPattern.hasMatch(text)) {
    for (final match in _bareHandlePattern.allMatches(text)) {
      addInstagram('@${match.group(1)}');
    }
  }

  // No position in the About text, so never flagged as a business inquiry.
  for (final email in influencer.foundEmails) {
    addEmail(email, -_businessInquiryProximityChars * 10);
  }

  return results;
}

/// The bare handle, lower-cased, for comparing two ways of writing the same
/// Instagram contact ("@name", "instagram.com/name") as equal.
String _instagramHandleOf(String value) {
  final trimmed = value.trim();
  final urlMatch = _instagramUrlPattern.firstMatch(trimmed);
  if (urlMatch != null) return urlMatch.group(1)!.toLowerCase();
  final bare = trimmed.startsWith('@') ? trimmed.substring(1) : trimmed;
  return bare.toLowerCase();
}

import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Localized label and icon for each [ContactMethod], plus a best-effort
/// deep link for the ones that have a well-known URL shape.
///
/// Lives in `core/status/` — beside the other status/enum presentation
/// helpers — so both the influencer Contacts card and the Outreach composer
/// can import it without one `features/` folder reaching into another.

String contactMethodLabel(ContactMethod method, AppLocalizations l10n) =>
    switch (method) {
      ContactMethod.email => l10n.contactMethodEmail,
      ContactMethod.whatsapp => l10n.contactMethodWhatsapp,
      ContactMethod.phone => l10n.contactMethodPhone,
      ContactMethod.instagram => l10n.contactMethodInstagram,
      ContactMethod.telegram => l10n.contactMethodTelegram,
      ContactMethod.twitter => l10n.contactMethodTwitter,
      ContactMethod.discord => l10n.contactMethodDiscord,
      ContactMethod.other => l10n.contactMethodOther,
    };

IconData contactMethodIcon(ContactMethod method) => switch (method) {
      ContactMethod.email => Icons.alternate_email,
      ContactMethod.whatsapp => Icons.chat_bubble_outline,
      ContactMethod.phone => Icons.phone_outlined,
      ContactMethod.instagram => Icons.camera_alt_outlined,
      ContactMethod.telegram => Icons.send_outlined,
      ContactMethod.twitter => Icons.tag,
      ContactMethod.discord => Icons.forum_outlined,
      ContactMethod.other => Icons.contact_page_outlined,
    };

/// A URL that opens a conversation with this contact, or null when there
/// isn't a reliable one.
///
/// Only the shapes that are genuinely unambiguous are built:
///
///  - a value that is already an `http(s)` link opens as-is (covers a
///    pasted `instagram.com/...` or `t.me/...`);
///  - WhatsApp → `https://wa.me/<digits>` with an optional prefilled `text`;
///  - Instagram / Telegram / Twitter → the profile page for a bare handle.
///
/// Email and phone deliberately return null here — email goes through the
/// `mailto:` compose path, and a `tel:` link is rarely what someone wants
/// from a desktop outreach tool. `other` has no known shape.
Uri? contactUrl(ContactMethod method, String value, {String? messageText}) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) return null;

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return Uri.tryParse(trimmed);
  }

  final handle = trimmed.startsWith('@') ? trimmed.substring(1) : trimmed;

  switch (method) {
    case ContactMethod.whatsapp:
      final digits = trimmed.replaceAll(RegExp('[^0-9]'), '');
      if (digits.isEmpty) return null;
      return Uri.parse(
        'https://wa.me/$digits'
        '${messageText != null && messageText.trim().isNotEmpty ? '?text=${Uri.encodeComponent(messageText)}' : ''}',
      );
    case ContactMethod.instagram:
      return Uri.parse('https://instagram.com/$handle');
    case ContactMethod.telegram:
      return Uri.parse('https://t.me/$handle');
    case ContactMethod.twitter:
      return Uri.parse('https://x.com/$handle');
    case ContactMethod.email:
    case ContactMethod.phone:
    case ContactMethod.discord:
    case ContactMethod.other:
      return null;
  }
}

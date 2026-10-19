import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/features/influencers/application/contact_discovery.dart';

Influencer _influencer({
  String? description,
  List<InfluencerContact> contacts = const [],
  List<String> foundEmails = const [],
}) =>
    Influencer(
      id: 'inf_test',
      handle: '@test',
      channelUrl: 'https://youtube.com/@test',
      platform: InfluencerPlatform.youtube,
      subscriberCount: 1000,
      sourceKeywords: const [],
      vettingStatus: VettingStatus.newlyFound,
      discoveredAt: DateTime(2026, 1, 1),
      description: description,
      contacts: contacts,
      foundEmails: foundEmails,
    );

void main() {
  group('findContactCandidates', () {
    test('found emails from the pipeline are offered too, once each', () {
      // Fix #11: the pipeline also reads the video descriptions and the
      // spelled-out forms, so an address may be found there and not here.
      final candidates = findContactCandidates(_influencer(
        description: 'Business: biz@studio.ai',
        foundEmails: const ['biz@studio.ai', 'team@studio.ai', 'old@studio.ai'],
        contacts: const [
          InfluencerContact(
              method: ContactMethod.email, value: 'old@studio.ai'),
        ],
      ));

      expect([for (final c in candidates) c.value],
          ['biz@studio.ai', 'team@studio.ai']);
    });

    test('found emails are offered even with no About text', () {
      final candidates = findContactCandidates(
          _influencer(foundEmails: const ['team@studio.ai']));
      expect(candidates.single.value, 'team@studio.ai');
      expect(candidates.single.method, ContactMethod.email);
    });

    test('finds a plain email in the open', () {
      final candidates = findContactCandidates(
        _influencer(description: 'Reach out at hello@creator.com any time.'),
      );

      expect(candidates, hasLength(1));
      expect(candidates.single.method, ContactMethod.email);
      expect(candidates.single.value, 'hello@creator.com');
    });

    test('flags an email found near a business-inquiry phrase', () {
      final candidates = findContactCandidates(
        _influencer(
          description: 'For business inquiries and collabs, email '
              'hello@creator.com — thanks for watching!',
        ),
      );

      expect(candidates, hasLength(1));
      expect(candidates.single.value, 'hello@creator.com');
      expect(candidates.single.isBusinessInquiry, isTrue);
    });

    test('finds an email obscured as "name [at] domain [dot] com"', () {
      final candidates = findContactCandidates(
        _influencer(
          description: 'You can reach me at hello [at] creator [dot] com.',
        ),
      );

      expect(candidates, hasLength(1));
      expect(candidates.single.method, ContactMethod.email);
      expect(candidates.single.value, 'hello@creator.com');
    });

    test('finds an Instagram handle', () {
      final candidates = findContactCandidates(
        _influencer(description: 'Find me on Instagram @creatorname'),
      );

      expect(candidates, hasLength(1));
      expect(candidates.single.method, ContactMethod.instagram);
      expect(candidates.single.value, '@creatorname');
    });

    test('finds an Instagram handle from an instagram.com URL', () {
      final candidates = findContactCandidates(
        _influencer(
          description: 'More on instagram.com/creatorname and other places.',
        ),
      );

      expect(candidates, hasLength(1));
      expect(candidates.single.method, ContactMethod.instagram);
      expect(candidates.single.value, '@creatorname');
    });

    test(
        'a bare @handle is not mistaken for an Instagram handle when '
        'Instagram is never mentioned', () {
      // Guards against treating every shout-out ("thanks @someoneelse for the
      // idea!") as a contact suggestion.
      final candidates = findContactCandidates(
        _influencer(description: 'Big thanks to @someoneelse for the idea!'),
      );

      expect(candidates, isEmpty);
    });

    test('a business-inquiry phrase with no email nearby suggests nothing', () {
      final candidates = findContactCandidates(
        _influencer(
          description: 'For business inquiries please use the link below.',
        ),
      );

      expect(candidates, isEmpty);
    });

    test('text with nothing to find returns an empty list', () {
      final candidates = findContactCandidates(
        _influencer(
          description: 'Just a lifestyle vlogger from LA. Thanks for '
              'watching, see you next week!',
        ),
      );

      expect(candidates, isEmpty);
    });

    test('a channel with no description returns an empty list', () {
      final candidates = findContactCandidates(_influencer());
      expect(candidates, isEmpty);
    });

    test(
        'every candidate already saved on Influencer.contacts is dropped, '
        'leaving an empty result', () {
      final candidates = findContactCandidates(
        _influencer(
          description: 'Email hello@creator.com or find me on Instagram '
              '@creatorname.',
          contacts: const [
            InfluencerContact(
              method: ContactMethod.email,
              value: 'hello@creator.com',
            ),
            InfluencerContact(
              method: ContactMethod.instagram,
              value: '@creatorname',
            ),
          ],
        ),
      );

      expect(candidates, isEmpty);
    });

    test('a saved contact only suppresses its own method, not every method',
        () {
      final candidates = findContactCandidates(
        _influencer(
          description: 'Email hello@creator.com or find me on Instagram '
              '@creatorname.',
          contacts: const [
            InfluencerContact(
              method: ContactMethod.email,
              value: 'hello@creator.com',
            ),
          ],
        ),
      );

      expect(candidates, hasLength(1));
      expect(candidates.single.method, ContactMethod.instagram);
      expect(candidates.single.value, '@creatorname');
    });

    test('the same email is not suggested twice when it appears twice', () {
      final candidates = findContactCandidates(
        _influencer(
          description: 'Email hello@creator.com for anything, or '
              'hello@creator.com for business inquiries specifically.',
        ),
      );

      expect(candidates, hasLength(1));
      expect(candidates.single.isBusinessInquiry, isTrue);
    });
  });
}

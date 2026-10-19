import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/toast/toast_overlay.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_influencer_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/influencer_contacts_card.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// A channel whose description carries a scannable email and Instagram
/// handle, plus one contact already on file — so the "already saved"
/// candidate is provably excluded from what the scan shows.
Influencer _channelWithScannableText() => Influencer(
      id: 'inf_scan',
      handle: '@ScanMe',
      channelUrl: 'https://youtube.com/@ScanMe',
      platform: InfluencerPlatform.youtube,
      subscriberCount: 50000,
      sourceKeywords: const [],
      vettingStatus: VettingStatus.newlyFound,
      discoveredAt: DateTime(2026, 1, 1),
      name: 'Scan Me',
      description: 'For business inquiries email hello@scanme.com. Also on '
          'Instagram @scanmeofficial.',
      contacts: const [
        InfluencerContact(
          method: ContactMethod.whatsapp,
          value: '+1 555 000 1111',
          isPrimary: true,
        ),
      ],
    );

/// A repository seeded with exactly [_channelWithScannableText] — via the
/// mock's own `replaceAllForTesting`, so a saved "add" can be verified
/// against the same instance the test asserts on, the same way the class's
/// own doc comment describes it being used from a test.
MockInfluencerRepository _repositoryWithScannableChannel() {
  final repository = MockInfluencerRepository();
  repository.replaceAllForTesting([_channelWithScannableText()]);
  return repository;
}

/// Pumps [InfluencerContactsCard] on its own — not the whole profile
/// screen. The card's write path (`influencer_mutation_guard.dart`) is what
/// this feature is required to go through, and that only needs
/// [influencerRepositoryProvider]; nothing here needs the rest of the
/// profile page's cards, several of which independently keep a `pumpAndSettle`
/// spinning forever on a channel with no cached avatar or video thumbnails
/// (`core/images/remote_image.dart`'s placeholder pulses for as long as the
/// image never resolves a frame) — a pre-existing behavior unrelated to this
/// feature, sidestepped here by not rendering that part of the tree at all.
Widget _harness(MockInfluencerRepository repository, Influencer influencer) {
  return ProviderScope(
    overrides: [
      supabaseBootProvider.overrideWithValue(
        const SupabaseBoot(
          config: SupabaseConfig(url: '', anonKey: ''),
          error: 'no server configured in this test',
        ),
      ),
      influencerRepositoryProvider.overrideWithValue(repository),
    ],
    child: MaterialApp(
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      // Mounted the same way app.dart mounts it, so the save-result toast
      // this test asserts on actually renders.
      builder: (context, child) => ToastOverlay(child: child!),
      home: Scaffold(
        body: Builder(
          builder: (context) => InfluencerContactsCard(
            influencer: influencer,
            l10n: AppLocalizations.of(context),
          ),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets(
      'scanning shows candidates from the description, excluding what is '
      'already saved', (tester) async {
    await tester.pumpWidget(
      _harness(_repositoryWithScannableChannel(), _channelWithScannableText()),
    );
    await tester.pumpAndSettle();

    // Nothing shown before the button is pressed.
    expect(find.text('hello@scanme.com'), findsNothing);

    await tester.tap(find.text('Scan for contacts'));
    await tester.pumpAndSettle();

    // The email and the Instagram handle from the description both surface.
    expect(find.text('hello@scanme.com'), findsOneWidget);
    expect(find.text('@scanmeofficial'), findsOneWidget);
    // Flagged, since it sits right after "For business inquiries".
    expect(find.text('Business inquiry'), findsOneWidget);
    // The already-saved WhatsApp number is not re-suggested as a candidate —
    // it still appears exactly once, in the existing-contacts list above,
    // not duplicated into the suggestions.
    expect(find.text('+1 555 000 1111'), findsOneWidget);
  });

  testWidgets('a channel with nothing to find says so rather than nothing',
      (tester) async {
    final noTextInfluencer = Influencer(
      id: 'inf_no_text',
      handle: '@NoTextHere',
      channelUrl: 'https://youtube.com/@NoTextHere',
      platform: InfluencerPlatform.youtube,
      subscriberCount: 1000,
      sourceKeywords: const [],
      vettingStatus: VettingStatus.newlyFound,
      discoveredAt: DateTime(2026, 1, 1),
      description: 'Just a lifestyle vlogger from LA, thanks for watching!',
    );
    final repository = MockInfluencerRepository()
      ..replaceAllForTesting([noTextInfluencer]);

    await tester.pumpWidget(_harness(repository, noTextInfluencer));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Scan for contacts'));
    await tester.pumpAndSettle();

    expect(
      find.text('No likely contacts found in the description.'),
      findsOneWidget,
    );
  });

  testWidgets('adding a suggestion saves it through the normal contact path',
      (tester) async {
    final repository = _repositoryWithScannableChannel();
    await tester.pumpWidget(_harness(repository, _channelWithScannableText()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Scan for contacts'));
    await tester.pumpAndSettle();

    final addSuggestion = find.byTooltip('Add this contact');
    expect(addSuggestion, findsNWidgets(2));
    await tester.tap(addSuggestion.first);
    await tester.pumpAndSettle();

    // Confirms the write actually landed through `updateContacts`, the same
    // compare-and-set path the manual "Add a contact" button uses — not a
    // side channel that bypasses it.
    final saved = await repository.getById('inf_scan');
    expect(
      saved!.contacts.any((c) => c.method == ContactMethod.email),
      isTrue,
    );
    expect(find.text('Contacts saved'), findsOneWidget);
    // The accepted suggestion is no longer offered a second time.
    expect(find.byTooltip('Add this contact'), findsOneWidget);
  });

  testWidgets('emails the pipeline found are on show without a scan',
      (tester) async {
    final channel = Influencer(
      id: 'inf_found',
      handle: '@Found',
      channelUrl: 'https://youtube.com/@Found',
      platform: InfluencerPlatform.youtube,
      subscriberCount: 50000,
      sourceKeywords: const [],
      vettingStatus: VettingStatus.newlyFound,
      discoveredAt: DateTime(2026, 1, 1),
      foundEmails: const ['team@found.ai'],
    );
    final repository = MockInfluencerRepository()
      ..replaceAllForTesting([channel]);
    await tester.pumpWidget(_harness(repository, channel));
    await tester.pumpAndSettle();

    expect(find.text('team@found.ai'), findsOneWidget);
    await tester.tap(find.byTooltip('Add this contact'));
    await tester.pumpAndSettle();

    final saved = await repository.getById('inf_found');
    expect(saved!.contacts.single.value, 'team@found.ai');
  });
}

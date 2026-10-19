import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/images/remote_image.dart';

/// [isUsableImageUrl] is the gate every picture in the app passes through, and
/// it is doing real work rather than a null check: this project's data contains
/// two kinds of value that look like a URL to a null check and are not.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('isUsableImageUrl', () {
    test('accepts real http and https URLs', () {
      expect(isUsableImageUrl('https://yt3.ggpht.com/abc=s176'), isTrue);
      expect(isUsableImageUrl('http://example.com/a.jpg'), isTrue);
      // Leading/trailing whitespace is a storage artefact, not a different URL.
      expect(isUsableImageUrl('  https://example.com/a.jpg  '), isTrue);
    });

    test('rejects the pipeline\'s "No Banner" sentinel', () {
      // The pipeline stores this literal string when YouTube has no banner. It
      // is a real value that is not a URL, so a null check passes it straight
      // through to a guaranteed failed request.
      expect(isUsableImageUrl('No Banner'), isFalse);
    });

    test('rejects nothing-at-all', () {
      expect(isUsableImageUrl(null), isFalse);
      expect(isUsableImageUrl(''), isFalse);
      expect(isUsableImageUrl('   '), isFalse);
    });

    test('rejects stored text that is not a link', () {
      // A handful of imported rows carry status text where a link should be.
      expect(isUsableImageUrl('fetch failed'), isFalse);
      expect(isUsableImageUrl('unknown'), isFalse);
    });

    test('rejects schemes that are not http(s)', () {
      // A data: or file: URL in this column would mean something has gone
      // wrong upstream; loading it is not the right response either way.
      expect(isUsableImageUrl('file:///C:/pictures/a.jpg'), isFalse);
      expect(isUsableImageUrl('data:image/png;base64,AAAA'), isFalse);
      expect(isUsableImageUrl('ftp://example.com/a.jpg'), isFalse);
    });
  });

  group('sizedImageUrl', () {
    const avatarUrl = 'https://yt3.ggpht.com/abc=s800-c-k-c0x00ffffff-no-rj';

    test('rewrites an avatar\'s size directive to the requested pixel size',
        () {
      expect(
        sizedImageUrl(avatarUrl, 88),
        'https://yt3.ggpht.com/abc=s88-c',
      );
    });

    test('leaves the avatar directive alone with no target size', () {
      // The full-screen image viewer passes null: it wants the original for
      // zooming, not a copy sized for some list row.
      expect(sizedImageUrl(avatarUrl, null), avatarUrl);
    });

    test('downgrades every oversized YouTube thumbnail tier to mqdefault', () {
      for (final tier in [
        'maxresdefault',
        'sddefault',
        'hqdefault',
        'hq720',
      ]) {
        expect(
          sizedImageUrl('https://i.ytimg.com/vi/abc123/$tier.jpg', null),
          'https://i.ytimg.com/vi/abc123/mqdefault.jpg',
        );
      }
    });

    test('applies the thumbnail rewrite even with a target size given', () {
      expect(
        sizedImageUrl('https://i.ytimg.com/vi/abc123/maxresdefault.jpg', 96),
        'https://i.ytimg.com/vi/abc123/mqdefault.jpg',
      );
    });

    test('leaves a URL matching neither pattern unchanged', () {
      const bannerUrl =
          'https://yt3.googleusercontent.com/abc=w1060-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj';
      expect(sizedImageUrl(bannerUrl, 320), bannerUrl);
    });
  });

  /// The cap is the fix for "images on the Influencers page never finish
  /// loading": before it covered the network fetch, a page of fifty rows fired
  /// every request at once and the ones the CDN refused or stalled had nothing
  /// to try them again. All of that only works if the cap is really a cap.
  group('ImageLoadPool', () {
    /// Runs [count] overlapping tasks and reports the most that were ever
    /// inside [ImageLoadPool.run] at the same moment.
    Future<int> peakConcurrency(int limit, int count) async {
      final pool = ImageLoadPool(limit);
      var running = 0;
      var peak = 0;
      await Future.wait([
        for (var i = 0; i < count; i++)
          pool.run(() async {
            running++;
            if (running > peak) peak = running;
            // A few turns of the microtask queue, so tasks that are allowed to
            // overlap actually do.
            for (var turn = 0; turn < 3; turn++) {
              await Future<void>.delayed(Duration.zero);
            }
            running--;
          }),
      ]);
      return peak;
    }

    test('never runs more than the limit at once', () async {
      expect(await peakConcurrency(3, 40), 3);
    });

    test('runs everything that was queued', () async {
      final pool = ImageLoadPool(2);
      final done = <int>[];
      await Future.wait([
        for (var i = 0; i < 20; i++)
          pool.run(() async {
            await Future<void>.delayed(Duration.zero);
            done.add(i);
          }),
      ]);
      expect(done.length, 20);
    });

    test('frees the slot when a task throws', () async {
      final pool = ImageLoadPool(1);
      await expectLater(
        pool.run(() async => throw StateError('boom')),
        throwsStateError,
      );
      // A leaked slot on the failure path would mean a single refused fetch
      // shrinking the pool for the rest of the session, one image at a time,
      // until nothing loads at all.
      expect(await pool.run(() async => 'ok'), 'ok');
    });

    test('serves the newest waiter first', () async {
      // Which is what keeps a long scroll from spending its whole budget on
      // rows the reader has already gone past: the last request queued belongs
      // to a row that is on screen now.
      final pool = ImageLoadPool(1);
      final order = <int>[];
      final blocker = Completer<void>();
      final held = pool.run(() => blocker.future);
      // Queued while the pool is full, so all three end up waiting.
      final queued = [
        for (var i = 0; i < 3; i++) pool.run(() async => order.add(i)),
      ];
      blocker.complete();
      await held;
      await Future.wait(queued);
      expect(order, [2, 1, 0]);
    });
  });

  group('RemoteImageResolver.resolve', () {
    // The bug this guards against did not fail loudly: the picture was
    // fetched and remembered, and only the future handed back to the widget
    // never completed, so every affected row simply sat on its placeholder
    // for good. `whenComplete(() => _inFlight.remove(url))` is one character
    // of arrow away and makes the future wait on itself — see the comment on
    // that line. Any test that awaits a first resolution catches it, because
    // the awaited future is exactly the one that never completes.
    //
    // TestWidgetsFlutterBinding answers every HTTP request with a 400 and no
    // network, so these resolve to null. That the resolution *finishes* is the
    // whole assertion.
    test('completes the first time a URL is asked for', () async {
      final provider = await RemoteImageResolver.resolve(
        'https://yt3.ggpht.com/first-ask.jpg',
        autoDownload: false,
      ).timeout(const Duration(seconds: 20));
      expect(provider, isNull);
    });

    test('completes for every one of a page of rows asking at once', () async {
      final providers = await Future.wait([
        for (var i = 0; i < 30; i++)
          RemoteImageResolver.resolve(
            'https://yt3.ggpht.com/row-$i.jpg',
            autoDownload: false,
          ),
      ]).timeout(const Duration(seconds: 40));
      expect(providers, hasLength(30));
    });

    test('completes for rows that share one URL', () async {
      // The in-flight map is what makes ten rows showing the same avatar read
      // it once, and it is also what the arrow-body trap lives in.
      const url = 'https://yt3.ggpht.com/shared-avatar.jpg';
      final providers = await Future.wait([
        for (var i = 0; i < 5; i++)
          RemoteImageResolver.resolve(url, autoDownload: false),
      ]).timeout(const Duration(seconds: 20));
      expect(providers, hasLength(5));
    });
  });
}

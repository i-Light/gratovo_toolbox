import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/features/search/application/search_progress_parser.dart';

/// These are the *contract* between `search.py`/`pipeline.py` and the progress
/// panel. A change on either side that breaks the shape breaks a panel that
/// then simply never moves, with no error anywhere — which is precisely the
/// failure this whole feature exists to stop, so it is worth pinning down.
void main() {
  group('keyword lines', () {
    test('parses a started line', () {
      final event =
          parseSearchProgressLine('[keyword 3/12] started: budget travel');
      expect(event, isA<KeywordStarted>());
      final started = event as KeywordStarted;
      expect(started.index, 3);
      expect(started.total, 12);
      expect(started.keyword, 'budget travel');
    });

    test('parses a done line', () {
      final event =
          parseSearchProgressLine('[keyword 12/12] done: budget travel');
      expect(event, isA<KeywordFinished>());
      expect((event as KeywordFinished).keyword, 'budget travel');
    });

    test('keeps colons inside the keyword itself', () {
      final event = parseSearchProgressLine(
          '[keyword 1/2] started: 2026: the year of AI agents');
      expect((event as KeywordStarted).keyword, '2026: the year of AI agents');
    });

    test('tolerates the trailing newline the line splitter may leave', () {
      final event = parseSearchProgressLine('  [keyword 1/2] started: a  ');
      expect((event as KeywordStarted).keyword, 'a');
    });

    test('an empty keyword is not progress', () {
      expect(
        parseSearchProgressLine('[keyword 1/2] started:   '),
        same(SearchProgressEvent.none),
      );
    });
  });

  group('step lines', () {
    test('parses the step text', () {
      final event =
          parseSearchProgressLine('[step] Fetching channel details 50/100...');
      expect(event, isA<StepReported>());
      expect(
          (event as StepReported).step, 'Fetching channel details 50/100...');
    });

    test('an empty step is not progress', () {
      expect(
        parseSearchProgressLine('[step]    '),
        same(SearchProgressEvent.none),
      );
    });
  });

  group('[backoff] lines', () {
    test('parses total, remaining and reason', () {
      final event = parseSearchProgressLine(
          '[backoff] total=900 remaining=847 reason=HTTP 429 from https://example.com');
      expect(event, isA<BackoffWaiting>());
      final backoff = event as BackoffWaiting;
      expect(backoff.totalSeconds, 900);
      expect(backoff.remainingSeconds, 847);
      expect(backoff.reason, 'HTTP 429 from https://example.com');
    });

    test('a malformed one is just a log line', () {
      expect(parseSearchProgressLine('[backoff] total=lots remaining=847'),
          same(SearchProgressEvent.none));
    });
  });

  group('[sync-io] lines', () {
    test('a move of objects reads as a step', () {
      expect(
        (parseSearchProgressLine('[sync-io] shared=25 of=5672') as StepReported)
            .step,
        "Uploading this machine's channels (25 of 5672)...",
      );
      expect(
        (parseSearchProgressLine('[sync-io] pulled=0 of=3000') as StepReported)
            .step,
        "Downloading the team's channels (0 of 3000)...",
      );
      expect(
        (parseSearchProgressLine('[sync-io] catalog=16 of=16') as StepReported)
            .step,
        "Applying the team's catalog (16 of 16)...",
      );
    });

    test('a malformed one is just a log line', () {
      expect(parseSearchProgressLine('[sync-io] shared=lots'),
          same(SearchProgressEvent.none));
    });
  });

  group('route lines', () {
    test('the pool line says what the run has and how it will use it', () {
      final event = parseSearchProgressLine(
        '[route] pool gateways=3 proxies=1 direct=1 gap=6 workers=3 '
        'parallel=1 pacing=normal',
      ) as RoutePoolReported;
      expect(event.gateways, 3);
      expect(event.proxies, 1);
      expect(event.includesDirect, isTrue);
      expect(event.gapSeconds, 6);
      expect(event.workers, 3);
      expect(event.parallel, isTrue);
      expect(event.pacing, 'normal');
    });

    test('a fractional gap and no direct connection', () {
      final event = parseSearchProgressLine(
        '[route] pool gateways=2 proxies=0 direct=0 gap=0.5 workers=1 '
        'parallel=0 pacing=fast',
      ) as RoutePoolReported;
      expect(event.gapSeconds, 0.5);
      expect(event.includesDirect, isFalse);
      expect(event.parallel, isFalse);
    });

    test('the use line carries counts and the free-text label', () {
      final event = parseSearchProgressLine(
        '[route] use aws=12 proxy=0 direct=3 last=aws '
        'label=AWS Gateway 2 (eu-west-1)',
      ) as RouteUsed;
      expect(event.awsRequests, 12);
      expect(event.proxyRequests, 0);
      expect(event.directRequests, 3);
      expect(event.lastKind, 'aws');
      expect(event.lastLabel, 'AWS Gateway 2 (eu-west-1)');
    });

    test('the exact line proxy_pool.format_route_use prints', () {
      // Kept identical to the Python test's expectation, so the two sides
      // cannot drift apart unnoticed.
      expect(
        parseSearchProgressLine(
          '[route] use aws=0 proxy=0 direct=1 last=direct label=This machine',
        ),
        isA<RouteUsed>(),
      );
    });

    test('a malformed route line is just a log line', () {
      expect(parseSearchProgressLine('[route] use aws=many'),
          same(SearchProgressEvent.none));
      expect(parseSearchProgressLine('[route] pool gateways=3'),
          same(SearchProgressEvent.none));
    });
  });

  group('KeywordsInFlight', () {
    test('one at a time: finishing clears the current keyword', () {
      final flight = KeywordsInFlight()..started('alpha', 1);
      expect(flight.current, 'alpha');
      expect(flight.currentIndex, 1);
      flight.finished('alpha');
      expect(flight.current, isNull);
      expect(flight.isEmpty, isTrue);
    });

    test('parallel: a keyword finishing hands over to one still going', () {
      final flight = KeywordsInFlight()
        ..started('alpha', 1)
        ..started('beta', 2)
        ..started('gamma', 3);
      expect(flight.current, 'gamma');
      expect(flight.keywords, ['alpha', 'beta', 'gamma']);

      flight.finished('gamma');
      expect(flight.current, 'beta');
      expect(flight.currentIndex, 2);

      flight.finished('alpha');
      expect(flight.keywords, ['beta']);
      expect(flight.current, 'beta');
    });

    test('a keyword started again moves to the front', () {
      final flight = KeywordsInFlight()
        ..started('alpha', 1)
        ..started('beta', 2)
        ..started('alpha', 1);
      expect(flight.keywords, ['beta', 'alpha']);
      expect(flight.current, 'alpha');
    });
  });

  group('everything else', () {
    test('ordinary log output reports nothing', () {
      for (final line in const [
        '',
        'Discovered 40 channel(s).',
        '[sync] push failed (timeout); results are safe locally',
        '[cooldown] pausing 12.4s...',
        'Keyword: budget travel',
      ]) {
        expect(
          parseSearchProgressLine(line),
          same(SearchProgressEvent.none),
          reason: 'line: "$line"',
        );
      }
    });
  });
}

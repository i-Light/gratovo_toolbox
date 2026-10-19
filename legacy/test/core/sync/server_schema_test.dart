// Until the owner pastes the newest backend/schema.sql into Supabase, the app
// asks for columns, tables and editable fields the server does not have yet.
// Nothing may be lost meanwhile, and the sync card must say what fixes it.
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/sync/mirror_puller.dart';
import 'package:gratovo_toolbox/core/sync/mirror_uploader.dart';
import 'package:gratovo_toolbox/core/sync/server_schema.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show PostgrestException;

const _missingColumn = PostgrestException(
  message: 'column channel_state.media_kit does not exist',
  code: '42703',
);
const _notInCache = PostgrestException(
  message:
      "Could not find the 'contacts' column of 'brands' in the schema cache",
  code: 'PGRST204',
);
const _noTable = PostgrestException(
  message:
      "Could not find the table 'public.comms_proposals' in the schema cache",
  code: 'PGRST205',
);
const _fieldNotEditable = PostgrestException(
  message: 'field media_kit is not editable through apply_channel_edit',
  code: '22023',
);

void main() {
  group('isServerSchemaBehind', () {
    test('a column, table or editable field the server lacks', () {
      expect(isServerSchemaBehind(_missingColumn), isTrue);
      expect(isServerSchemaBehind(_notInCache), isTrue);
      expect(isServerSchemaBehind(_noTable), isTrue);
      expect(isServerSchemaBehind(_fieldNotEditable), isTrue);
    });

    test('an ordinary refusal or failure is something else', () {
      expect(
        isServerSchemaBehind(const PostgrestException(
            message: 'unknown resolution x', code: '22023')),
        isFalse,
      );
      expect(
        isServerSchemaBehind(
            const PostgrestException(message: 'denied', code: '42501')),
        isFalse,
      );
      expect(isServerSchemaBehind(StateError('boom')), isFalse);
    });
  });

  group('isFinalUploadRefusal', () {
    test('an edit the old server will not accept yet is retried, not dropped',
        () {
      // Dropping it would turn a schema.sql not yet pasted into lost work.
      expect(isFinalUploadRefusal(_fieldNotEditable), isFalse);
      expect(isFinalUploadRefusal(_notInCache), isFalse);
    });

    test('a refusal the newest server would repeat is still final', () {
      expect(
        isFinalUploadRefusal(const PostgrestException(
            message: 'unknown resolution x', code: '22023')),
        isTrue,
      );
      expect(
        isFinalUploadRefusal(
            const PostgrestException(message: 'duplicate', code: '23505')),
        isTrue,
      );
    });
  });

  group('the sentence the sync card shows', () {
    test('a stuck queue behind an old server names the fix', () {
      final stuck = OutboxStuckException(
          kind: 'row.upsert', passes: 4, cause: _notInCache);
      expect('$stuck', contains('backend/schema.sql'));
    });

    test('a stuck queue for another reason does not', () {
      final stuck = OutboxStuckException(
          kind: 'row.upsert', passes: 4, cause: StateError('offline'));
      expect('$stuck', isNot(contains('backend/schema.sql')));
    });

    test('a download that stopped on an old server names the fix', () {
      const failed = MirrorPullException(
          [MirrorPullFailure('channel_state', _missingColumn)]);
      expect('$failed', contains('backend/schema.sql'));
    });
  });
}

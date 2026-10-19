import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/email_template.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_template_repository.dart';

void main() {
  group('MockTemplateRepository', () {
    test('is seeded with both email and dm templates', () async {
      final repo = MockTemplateRepository();
      final all = await repo.getAll();

      expect(all.where((t) => t.kind == TemplateKind.email), isNotEmpty);
      expect(all.where((t) => t.kind == TemplateKind.dm), isNotEmpty);
    });

    test('upsert round-trips the kind', () async {
      final repo = MockTemplateRepository();
      await repo.upsert(
        const EmailTemplate(
          id: 'tmpl_dm_x',
          name: 'Telegram ping',
          subject: '',
          body: 'hi {{handle}}',
          kind: TemplateKind.dm,
        ),
      );

      final saved =
          (await repo.getAll()).firstWhere((t) => t.id == 'tmpl_dm_x');
      expect(saved.kind, TemplateKind.dm);
    });

    test('upsert updates an existing template in place', () async {
      final repo = MockTemplateRepository();
      final first = (await repo.getAll()).first;
      await repo.upsert(first.copyWith(name: 'Renamed'));

      final all = await repo.getAll();
      expect(all.where((t) => t.id == first.id), hasLength(1));
      expect(all.firstWhere((t) => t.id == first.id).name, 'Renamed');
    });
  });
}

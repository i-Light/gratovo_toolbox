import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/features/skills/presentation/widgets/markdown_preview.dart';

void main() {
  testWidgets('renders a pipe table as a Table without the separator row',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: MarkdownPreview(
          source:
              'Intro\n\n| Name | Role |\n|---|:--:|\n| Ann | **QA** |\n| Bo | Dev |\n\nAfter',
        ),
      ),
    ));
    expect(find.byType(Table), findsOneWidget);
    final table = tester.widget<Table>(find.byType(Table));
    expect(table.children.length, 3);
    expect(find.text('Intro'), findsOneWidget);
    expect(find.text('After'), findsOneWidget);
  });
}

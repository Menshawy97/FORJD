import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path_drawing/path_drawing.dart';

import 'package:forjd/core/widgets/forjd_icon.dart';
import 'package:forjd/core/widgets/forjd_icons.dart';

void main() {
  test('every icon in the set parses as valid path data', () {
    for (final entry in kForjdIconPaths.entries) {
      for (final data in entry.value) {
        expect(
          () => parseSvgPathData(data),
          returnsNormally,
          reason: 'icon "${entry.key}" has unparseable path data: $data',
        );
      }
    }
  });

  test('the icon set is not accidentally empty', () {
    expect(kForjdIconPaths, isNotEmpty);
    expect(
      kForjdIconPaths.keys,
      containsAll(<String>['home', 'chevron', 'chevronLeft']),
    );
  });

  testWidgets('renders at the requested size', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: ForjdIcon('home', size: 30))),
    );

    expect(tester.getSize(find.byType(ForjdIcon)), const Size(30, 30));
  });
}

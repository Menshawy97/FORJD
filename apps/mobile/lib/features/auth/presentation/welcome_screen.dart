import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'package:forjd/core/theme/app_colors.dart';
import 'package:forjd/core/theme/app_typography.dart';
import 'package:forjd/core/widgets/widgets.dart';

/// The signed-out landing screen: what FORJD is, then the two ways in.
class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  static const _features = [
    ('bolt', 'Strength · Running · Cross Training · Mobility'),
    ('heart', 'Sleep · HRV · Recovery · Body Composition'),
    ('chart', 'AI Insights · City Leaderboards · Analytics'),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        // The pitch scrolls; the two calls to action stay pinned. Letting the whole screen
        // scroll as one column pushed the buttons off a short viewport, and stretching it to
        // fill with a flexible spacer overflowed instead of scrolling.
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(32, 0, 32, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SizedBox(height: 70),
                    const ForjdWordmark(),
                    const SizedBox(height: 34),
                    const Text(
                      'Training.\nRecovery.\nProgress.',
                      style: AppText.h1Welcome,
                    ),
                    const SizedBox(height: 16),
                    const SizedBox(
                      width: 290,
                      child: Text(
                        'One place for everything your body is doing.',
                        style: AppText.body,
                      ),
                    ),
                    const SizedBox(height: 34),
                    for (final (icon, label) in _features)
                      Container(
                        padding: const EdgeInsets.symmetric(vertical: 15),
                        decoration: const BoxDecoration(
                          border: Border(
                            top: BorderSide(color: AppColors.border),
                          ),
                        ),
                        child: Row(
                          children: [
                            ForjdIcon(icon, color: AppColors.accent, size: 19),
                            const SizedBox(width: 13),
                            Expanded(
                              child: Text(label, style: AppText.welcomeFeature),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(32, 0, 32, 40),
              child: Column(
                children: [
                  ForjdButton(
                    label: 'Create Account',
                    onPressed: () => context.go('/register'),
                  ),
                  const SizedBox(height: 12),
                  ForjdButton(
                    label: 'Log In',
                    kind: ForjdButtonKind.ghost,
                    onPressed: () => context.go('/login'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

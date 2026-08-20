import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:forjd/app/app.dart';
import 'package:forjd/core/network/session_ports.dart';
import 'package:forjd/features/auth/application/auth_controller.dart';
import 'package:forjd/features/auth/data/auth_repository.dart';
import 'package:forjd/features/auth/data/secure_token_store.dart';

/// The composition root, and the only place allowed to know both `core` and `features`.
///
/// `core/network` declares what it needs as ports and never imports a feature, which is
/// what lets the interceptor be tested without the auth stack. Those ports are bound here.
void main() {
  runApp(
    ProviderScope(
      overrides: [
        tokenStoreProvider.overrideWith(
          (ref) => ref.watch(secureTokenStoreProvider),
        ),
        tokenRefresherProvider.overrideWith(
          (ref) => ref.watch(sessionRefresherProvider),
        ),
        sessionLostProvider.overrideWith(
          (ref) =>
              () => ref.read(authControllerProvider.notifier).onSessionLost(),
        ),
      ],
      child: const ForjdApp(),
    ),
  );
}

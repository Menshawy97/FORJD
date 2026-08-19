import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Routes exist now so navigation and deep links can be exercised before the screens do.
/// Slice 11 replaces each placeholder with the real screen.
final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/splash',
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const _Placeholder('Splash')),
      GoRoute(path: '/login', builder: (_, _) => const _Placeholder('Login')),
      GoRoute(
        path: '/register',
        builder: (_, _) => const _Placeholder('Register'),
      ),
      GoRoute(path: '/home', builder: (_, _) => const _Placeholder('Home')),
      GoRoute(
        path: '/profile',
        builder: (_, _) => const _Placeholder('Profile'),
      ),
    ],
  );
});

class _Placeholder extends StatelessWidget {
  const _Placeholder(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(label)),
      body: Center(child: Text(label)),
    );
  }
}

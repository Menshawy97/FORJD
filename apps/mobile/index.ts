// The app's entry. `expo-router/entry` alone would leave background tasks undefined when Android wakes
// the app without showing a screen (Phase 12C), so they are defined first. Everything else is unchanged.
import './src/background-task';
import 'expo-router/entry';

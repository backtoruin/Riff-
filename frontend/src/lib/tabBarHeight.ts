// Platform-neutral helper for computing the bottom tab bar height.
// Expo Router SDK 57 ships its own tabs and the react-navigation hook is unavailable,
// so we approximate using a fixed native bar + bottom safe-area inset.
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function useBottomTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  if (Platform.OS === "web") return 64;
  // Classic JS tab bar is ~49pt + bottom inset (home indicator etc.)
  return 49 + insets.bottom;
}

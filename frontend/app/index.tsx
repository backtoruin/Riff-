import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/src/auth/AuthContext";
import { useTheme } from "@/src/theme";

export default function Index() {
  const { state } = useAuth();
  const { colors } = useTheme();

  if (state.status === "loading") {
    return (
      <View
        testID="auth-loading"
        style={{
          flex: 1,
          backgroundColor: colors.surface,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }

  if (state.status === "unauthenticated") return <Redirect href="/login" />;
  return <Redirect href="/(tabs)" />;
}

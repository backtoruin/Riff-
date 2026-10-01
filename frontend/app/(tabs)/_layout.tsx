import { Tabs } from "expo-router";
import { Platform, StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
import { Home, Mic, BookOpen, User } from "lucide-react-native";

import { useTheme } from "@/src/theme";

export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarShowLabel: true,
        tabBarLabelStyle: { fontSize: 10, fontWeight: "700", letterSpacing: 1 },
        tabBarItemStyle: { alignSelf: "center" },
        tabBarBackground: () => (
          <View style={StyleSheet.absoluteFill}>
            <BlurView
              intensity={60}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.surface + "CC" },
              ]}
            />
          </View>
        ),
        tabBarStyle: {
          backgroundColor: "transparent",
          borderTopColor: colors.border,
          position: "absolute",
          ...(Platform.OS === "web" ? { height: 64 } : {}),
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "HOME",
          tabBarIcon: ({ color }) => <Home size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="studio"
        options={{
          title: "STUDIO",
          tabBarIcon: ({ color }) => <Mic size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="lessons"
        options={{
          title: "LESSONS",
          tabBarIcon: ({ color }) => <BookOpen size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "PROFILE",
          tabBarIcon: ({ color }) => <User size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}

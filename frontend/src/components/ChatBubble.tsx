import React from "react";
import { View, Text } from "react-native";
import { makeStyles, spacing, radius } from "@/src/theme";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
};

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: "row", marginBottom: spacing.md, paddingHorizontal: spacing.lg },
  rowUser: { justifyContent: "flex-end" },
  rowRiff: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "82%",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
  },
  bubbleUser: {
    backgroundColor: colors.brandPrimary,
    borderBottomRightRadius: spacing.xs,
  },
  bubbleRiff: {
    backgroundColor: colors.surfaceSecondary,
    borderBottomLeftRadius: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  textUser: { color: colors.onBrandPrimary, fontSize: 15, lineHeight: 21 },
  textRiff: { color: colors.onSurfaceSecondary, fontSize: 15, lineHeight: 21 },
  caret: { color: colors.brand, fontWeight: "700" },
  nameTag: {
    color: colors.brand,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.2,
    marginBottom: 4,
  },
}));

export function ChatBubble({ msg }: { msg: ChatMessage }) {
  const styles = useStyles();
  const isUser = msg.role === "user";
  return (
    <View
      testID={`chat-${msg.role}-${msg.id}`}
      style={[styles.row, isUser ? styles.rowUser : styles.rowRiff]}
    >
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleRiff]}>
        {!isUser && <Text style={styles.nameTag}>RIFF</Text>}
        <Text style={isUser ? styles.textUser : styles.textRiff}>
          {msg.text}
          {msg.streaming && <Text style={styles.caret}>▍</Text>}
        </Text>
      </View>
    </View>
  );
}

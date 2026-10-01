import React from "react";
import { View, Text, Platform, Pressable } from "react-native";
import { Play, FileAudio, FileVideo } from "lucide-react-native";
import { makeStyles, useTheme, spacing, radius } from "@/src/theme";

export type ChatAttachment = {
  url: string;
  mime: string;
  kind: "audio" | "video";
  name: string;
  bytes: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  attachment?: ChatAttachment;
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
  bubbleWide: { maxWidth: "92%" },
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

  attachmentWrap: {
    marginTop: spacing.sm,
    gap: 6,
  },
  playerHtml: {
    width: "100%",
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: "#00000033",
  },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    backgroundColor: "#00000033",
    borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  fileRowTxt: {
    color: colors.onBrandPrimary,
    fontSize: 11,
    fontWeight: "600",
  },
  nativePlay: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: "#00000040",
    borderRadius: radius.md,
    alignSelf: "flex-start",
  },
  nativePlayTxt: { color: colors.onBrandPrimary, fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
}));

function MediaPlayer({ attachment, onNativePlay }: {
  attachment: ChatAttachment;
  onNativePlay: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();

  if (Platform.OS === "web") {
    // Render a real HTML audio/video element with native controls.
    return React.createElement(
      attachment.kind === "video" ? "video" : "audio",
      {
        controls: true,
        src: attachment.url,
        style: {
          width: "100%",
          maxWidth: 320,
          borderRadius: 8,
          backgroundColor: "#000",
          display: "block",
        },
      },
    );
  }

  // Native: tap-to-play button (full inline player would need expo-video / expo-audio imperative setup).
  const Icon = attachment.kind === "video" ? FileVideo : FileAudio;
  return (
    <Pressable
      testID={`chat-attachment-play-${attachment.kind}`}
      onPress={onNativePlay}
      style={styles.nativePlay}
    >
      <Play size={14} color={colors.onBrandPrimary} fill={colors.onBrandPrimary} />
      <Icon size={14} color={colors.onBrandPrimary} />
      <Text style={styles.nativePlayTxt}>TAP TO PLAY</Text>
    </Pressable>
  );
}

export function ChatBubble({
  msg,
  onPlayAttachment,
}: {
  msg: ChatMessage;
  onPlayAttachment?: (attachment: ChatAttachment) => void;
}) {
  const styles = useStyles();
  const isUser = msg.role === "user";
  const hasAttachment = !!msg.attachment;
  return (
    <View
      testID={`chat-${msg.role}-${msg.id}`}
      style={[styles.row, isUser ? styles.rowUser : styles.rowRiff]}
    >
      <View
        style={[
          styles.bubble,
          hasAttachment && styles.bubbleWide,
          isUser ? styles.bubbleUser : styles.bubbleRiff,
        ]}
      >
        {!isUser && <Text style={styles.nameTag}>RIFF</Text>}
        <Text style={isUser ? styles.textUser : styles.textRiff}>
          {msg.text}
          {msg.streaming && <Text style={styles.caret}>▍</Text>}
        </Text>
        {msg.attachment && (
          <View style={styles.attachmentWrap} testID={`chat-attachment-${msg.id}`}>
            <View style={styles.fileRow}>
              {msg.attachment.kind === "video" ? (
                <FileVideo size={12} color="#FFF" />
              ) : (
                <FileAudio size={12} color="#FFF" />
              )}
              <Text style={styles.fileRowTxt}>
                {msg.attachment.name} · {Math.round(msg.attachment.bytes / 1024)} KB
              </Text>
            </View>
            <MediaPlayer
              attachment={msg.attachment}
              onNativePlay={() => onPlayAttachment?.(msg.attachment!)}
            />
          </View>
        )}
      </View>
    </View>
  );
}

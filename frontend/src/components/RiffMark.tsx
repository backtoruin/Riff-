import React from "react";
import Svg, { Circle, Path, Defs, LinearGradient, Stop } from "react-native-svg";

/**
 * RiffMark — the AI teacher's avatar: an orange guitar pick with a sound-wave bolt inside.
 */
export function RiffMark({ size = 64, glow = true }: { size?: number; glow?: boolean }) {
  const s = size;
  return (
    <Svg width={s} height={s} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="pickGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FF8C33" />
          <Stop offset="1" stopColor="#CC5500" />
        </LinearGradient>
      </Defs>
      {glow && <Circle cx={50} cy={52} r={46} fill="#FF6B0022" />}
      {/* Guitar pick */}
      <Path
        d="M50 10 C70 10 86 24 86 44 C86 62 68 86 50 92 C32 86 14 62 14 44 C14 24 30 10 50 10 Z"
        fill="url(#pickGrad)"
      />
      {/* Lightning / sound bolt */}
      <Path
        d="M54 28 L36 54 L47 54 L43 72 L62 44 L51 44 L55 28 Z"
        fill="#121212"
      />
    </Svg>
  );
}

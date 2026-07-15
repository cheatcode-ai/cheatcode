import { ImageResponse } from "next/og";
import type { CSSProperties } from "react";

export const alt = "Cheatcode";
export const contentType = "image/png";
export const size = {
  height: 630,
  width: 1200,
};

const CANVAS_STYLE = {
  alignItems: "center",
  background: "#050505",
  color: "white",
  display: "flex",
  fontFamily: "Arial, sans-serif",
  height: "100%",
  justifyContent: "center",
  padding: 72,
  width: "100%",
} satisfies CSSProperties;

const FRAME_STYLE = {
  alignItems: "flex-start",
  border: "1px solid #27272a",
  display: "flex",
  flexDirection: "column",
  gap: 28,
  height: "100%",
  justifyContent: "space-between",
  padding: 56,
  width: "100%",
} satisfies CSSProperties;

const MARK_STYLE = {
  alignItems: "center",
  background: "#ffffff",
  color: "#050505",
  display: "flex",
  fontSize: 34,
  fontWeight: 700,
  height: 56,
  justifyContent: "center",
  width: 56,
} satisfies CSSProperties;

const BRAND_STYLE = { alignItems: "center", display: "flex", gap: 18 } satisfies CSSProperties;
const COPY_STYLE = {
  display: "flex",
  flexDirection: "column",
  gap: 22,
} satisfies CSSProperties;
const HEADLINE_STYLE = {
  fontSize: 82,
  fontWeight: 500,
  letterSpacing: 0,
  lineHeight: 1.02,
} satisfies CSSProperties;
const TAGLINE_STYLE = {
  color: "#a1a1aa",
  fontSize: 28,
  letterSpacing: 0,
} satisfies CSSProperties;

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={CANVAS_STYLE}>
      <div style={FRAME_STYLE}>
        <div style={BRAND_STYLE}>
          <div style={MARK_STYLE}>*</div>
          <div style={{ fontSize: 36, fontWeight: 600, letterSpacing: 0 }}>cheatcode</div>
        </div>
        <div style={COPY_STYLE}>
          <div style={HEADLINE_STYLE}>AI agents that build, research, and ship</div>
          <div style={TAGLINE_STYLE}>Your keys. Your models. Your sandbox.</div>
        </div>
      </div>
    </div>,
    size,
  );
}

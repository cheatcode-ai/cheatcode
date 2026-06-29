import { ImageResponse } from "next/og";

export const alt = "Cheatcode";
export const contentType = "image/png";
export const size = {
  height: 630,
  width: 1200,
};

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "#050505",
        color: "white",
        display: "flex",
        fontFamily: "Arial, sans-serif",
        height: "100%",
        justifyContent: "center",
        padding: 72,
        width: "100%",
      }}
    >
      <div
        style={{
          alignItems: "flex-start",
          border: "1px solid #27272a",
          display: "flex",
          flexDirection: "column",
          gap: 28,
          height: "100%",
          justifyContent: "space-between",
          padding: 56,
          width: "100%",
        }}
      >
        <div style={{ alignItems: "center", display: "flex", gap: 18 }}>
          <div
            style={{
              alignItems: "center",
              background: "#ffffff",
              color: "#050505",
              display: "flex",
              fontSize: 34,
              fontWeight: 700,
              height: 56,
              justifyContent: "center",
              width: 56,
            }}
          >
            *
          </div>
          <div style={{ fontSize: 36, fontWeight: 600, letterSpacing: 0 }}>cheatcode</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ fontSize: 82, fontWeight: 500, letterSpacing: 0, lineHeight: 1.02 }}>
            AI agents that build, research, and ship
          </div>
          <div style={{ color: "#a1a1aa", fontSize: 28, letterSpacing: 0 }}>
            Your keys. Your models. Your sandbox.
          </div>
        </div>
      </div>
    </div>,
    size,
  );
}

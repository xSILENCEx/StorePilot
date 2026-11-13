import type { ScreenshotSettings } from "../lib/screenshot-model";
export function ScreenshotTemplate({
  settings,
  width,
  height,
  screenshot,
  background,
}: {
  settings: ScreenshotSettings;
  width: number;
  height: number;
  screenshot?: string | null;
  background?: string | null;
}) {
  const split = settings.template === "split";
  const unit = Math.min(width, height);
  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        overflow: "hidden",
        background: settings.background,
        color: settings.foreground,
        fontFamily: 'Arial,"PingFang SC","Noto Sans CJK SC",sans-serif',
      }}
    >
      {background && (
        <img
          src={background}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: background
            ? "linear-gradient(180deg,rgba(255,255,255,.9),rgba(255,255,255,.25) 50%,transparent)"
            : "linear-gradient(145deg,rgba(255,255,255,.8),transparent 80%)",
        }}
      />
      <div
        data-template-copy="true"
        style={{
          position: "absolute",
          top: split ? "15%" : "6%",
          left: split ? "6%" : "7%",
          width: split ? "39%" : "86%",
          height: split ? "70%" : "23%",
          textAlign: split ? "left" : "center",
          display: "flex",
          flexDirection: "column",
          justifyContent: split ? "center" : "flex-start",
          gap: unit * 0.025,
          overflow: "hidden",
        }}
      >
        <h1
          style={{
            fontSize: unit * (split ? 0.063 : 0.078),
            lineHeight: 1.15,
            fontWeight: 800,
            letterSpacing: "-.035em",
            margin: 0,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {settings.headline}
        </h1>
        <p
          style={{
            color: settings.foreground,
            fontSize: unit * 0.034,
            lineHeight: 1.5,
            margin: 0,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            opacity: 0.8,
          }}
        >
          {settings.subtitle}
        </p>
      </div>
      {screenshot && (
        <div
          style={{
            position: "absolute",
            left: split ? "50%" : "11%",
            top: split ? "10%" : "32%",
            width: split ? "44%" : "78%",
            height: split ? "80%" : "64%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <img
            src={screenshot}
            alt="真实 App 截图"
            style={{
              display: "block",
              height: "100%",
              width: "auto",
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              borderRadius: unit * 0.035,
              boxShadow: `0 ${unit * 0.025}px ${unit * 0.065}px #001a243d`,
            }}
          />
        </div>
      )}
    </div>
  );
}

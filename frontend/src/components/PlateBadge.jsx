import React from "react";

/**
 * Dutch-style yellow license plate.  Compact, screen-friendly, no external font needed —
 * we just use a bold mono-caps typography on a canary-yellow pill with black text.
 * The little blue "NL" flag strip on the left mirrors the real plate hardware.
 */
export default function PlateBadge({ plate, size = "sm", className = "" }) {
  if (!plate) return <span className="text-muted-foreground">—</span>;
  const sizes = {
    xxs: "text-[9px] px-1.5 py-[1px]",
    xs: "text-xs px-2 py-[3px]",
    sm: "text-sm px-3 py-1",
    md: "text-base px-4 py-1.5",
    lg: "text-2xl px-5 py-2",
  };
  return (
    <span
      className={`inline-block bg-[#FFCB05] text-black border-2 border-black rounded-[6px] font-black text-center align-middle shadow-inner ${sizes[size]} ${className}`}
      data-testid="plate-badge"
      style={{
        letterSpacing: "0.15em",
        fontFamily: "'Arial Black', Impact, 'Helvetica Neue', sans-serif",
        lineHeight: 1.1,
      }}
    >
      {String(plate).toUpperCase()}
    </span>
  );
}

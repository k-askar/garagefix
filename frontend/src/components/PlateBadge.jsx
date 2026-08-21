import React from "react";

/**
 * Dutch-style yellow license plate.  Compact, screen-friendly, no external font needed —
 * we just use a bold mono-caps typography on a canary-yellow pill with black text.
 * The little blue "NL" flag strip on the left mirrors the real plate hardware.
 */
export default function PlateBadge({ plate, size = "sm", className = "" }) {
  if (!plate) return <span className="text-muted-foreground">—</span>;
  const sizes = {
    xs: "text-[10px] px-1.5 py-[1px] gap-1 rounded",
    sm: "text-xs px-2 py-0.5 gap-1.5 rounded-[4px]",
    md: "text-sm px-2.5 py-1 gap-2 rounded-md",
    lg: "text-lg px-4 py-1.5 gap-2.5 rounded-md",
  };
  const flag = {
    xs: "text-[6px] px-[3px] py-[1px]",
    sm: "text-[7px] px-1 py-[1px]",
    md: "text-[8px] px-1 py-[1px]",
    lg: "text-[10px] px-1.5 py-0.5",
  };
  return (
    <span
      className={`inline-flex items-center font-mono font-bold tracking-widest uppercase bg-[#FFC900] text-black border border-black/40 shadow-sm ${sizes[size]} ${className}`}
      data-testid="plate-badge"
      style={{ letterSpacing: "0.08em" }}
    >
      <span className={`bg-[#003399] text-white font-bold leading-none rounded-[2px] ${flag[size]}`}>NL</span>
      <span className="leading-none">{String(plate).toUpperCase()}</span>
    </span>
  );
}

import React from "react";

/**
 * License plate badge — Dutch-style yellow plate for NL, white-with-black-border for other countries.
 *
 * Props:
 *   plate    string (the plate number itself)
 *   country  ISO code (default "NL")
 *   size     "xxs" | "xs" | "sm" | "md" | "lg"
 */
const NL_YELLOW = "#FFCB05";
const NL_BLUE = "#003399";
const COUNTRY_STRIP = {
  NL: { bg: NL_BLUE, label: "NL", stars: true },
  DE: { bg: NL_BLUE, label: "D" },
  FR: { bg: NL_BLUE, label: "F" },
  BE: { bg: NL_BLUE, label: "B" },
  IT: { bg: NL_BLUE, label: "I" },
  ES: { bg: NL_BLUE, label: "E" },
  PL: { bg: NL_BLUE, label: "PL" },
  TR: { bg: "#e30a17", label: "TR" },
  MA: { bg: "#c1272d", label: "MA" },
  DZ: { bg: "#006233", label: "DZ" },
  SA: { bg: "#006c35", label: "KSA" },
  AE: { bg: "#00732f", label: "UAE" },
  EG: { bg: "#ce1126", label: "ET" },
  SY: { bg: "#000000", label: "SYR" },
  LB: { bg: "#ed1c24", label: "RL" },
  JO: { bg: "#000000", label: "JOR" },
  IQ: { bg: "#ce1126", label: "IRQ" },
  GB: { bg: "#012169", label: "GB" },
  US: { bg: "#3c3b6e", label: "US" },
  OTHER: { bg: "#111", label: "?" },
};

export default function PlateBadge({ plate, country = "NL", size = "sm", className = "" }) {
  if (!plate) return <span className="text-muted-foreground">—</span>;
  const code = String(country || "NL").toUpperCase();
  const strip = COUNTRY_STRIP[code] || { bg: "#111", label: code.slice(0, 3) };
  const isNL = code === "NL";

  const dims = {
    xxs: { text: "9px", stripSize: "7px", padY: "1px", padX: "4px", padPill: "0 6px 0 22px", stripW: "16px", radius: "3px" },
    xs:  { text: "11px", stripSize: "8px", padY: "2px", padX: "6px", padPill: "2px 8px 2px 26px", stripW: "20px", radius: "4px" },
    sm:  { text: "13px", stripSize: "9px", padY: "3px", padX: "8px", padPill: "3px 10px 3px 30px", stripW: "24px", radius: "4px" },
    md:  { text: "16px", stripSize: "11px", padY: "5px", padX: "12px", padPill: "5px 14px 5px 38px", stripW: "30px", radius: "5px" },
    lg:  { text: "24px", stripSize: "14px", padY: "8px", padX: "16px", padPill: "8px 18px 8px 52px", stripW: "42px", radius: "6px" },
  }[size] || {};

  return (
    <span
      className={`inline-block relative align-middle ${className}`}
      data-testid="plate-badge"
      data-country={code}
      style={{
        background: isNL ? NL_YELLOW : "#ffffff",
        color: "#000",
        border: `2px solid ${isNL ? "#000" : "#000"}`,
        borderRadius: dims.radius,
        padding: dims.padPill,
        fontFamily: "'Arial Black', Impact, 'Helvetica Neue', sans-serif",
        fontWeight: 900,
        fontSize: dims.text,
        letterSpacing: "0.14em",
        lineHeight: 1.15,
        textAlign: "center",
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: dims.stripW,
          background: strip.bg,
          color: "#fff",
          fontSize: dims.stripSize,
          letterSpacing: "0.06em",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 900,
          borderTopLeftRadius: `calc(${dims.radius} - 2px)`,
          borderBottomLeftRadius: `calc(${dims.radius} - 2px)`,
          borderRight: "1px solid rgba(0,0,0,.15)",
          WebkitPrintColorAdjust: "exact",
          printColorAdjust: "exact",
        }}
      >
        {strip.label}
      </span>
      {String(plate).toUpperCase()}
    </span>
  );
}

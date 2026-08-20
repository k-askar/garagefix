import React from "react";
import { Button } from "@/components/ui/button";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useLang } from "@/i18n";

const ICONS = { light: Sun, dark: Moon, system: Monitor };
const LABELS_KEY = { light: "themeLight", dark: "themeDark", system: "themeSystem" };

export default function ThemeToggle() {
  const { theme, cycle } = useTheme();
  const { t } = useLang();
  const Icon = ICONS[theme] || Monitor;
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycle}
      title={t(LABELS_KEY[theme])}
      aria-label={t(LABELS_KEY[theme])}
      data-testid="theme-toggle"
      className="rounded-full"
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}

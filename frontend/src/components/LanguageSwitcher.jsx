import React from "react";
import { useLang } from "@/i18n";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Globe, Check } from "lucide-react";

export default function LanguageSwitcher({ variant = "ghost", showLabel = true }) {
  const { lang, setLang, langs, t } = useLang();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size="sm" className="rounded-full gap-2" data-testid="lang-switcher">
          <Globe className="h-4 w-4" />
          {showLabel && <span className="text-xs font-mono uppercase tracking-widest">{lang}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel className="text-[10px] font-mono uppercase tracking-widest">{t("language")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {Object.entries(langs).map(([code, meta]) => (
          <DropdownMenuItem
            key={code}
            onClick={() => setLang(code)}
            className="flex items-center justify-between cursor-pointer"
            data-testid={`lang-${code}`}
          >
            <span>{meta.label}</span>
            {lang === code && <Check className="h-3.5 w-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

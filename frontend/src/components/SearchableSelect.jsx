import React, { useState, useMemo, useRef, useEffect } from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";

/**
 * Type-to-filter dropdown.  Drop-in replacement for shadcn <Select> when
 * the option list is long (customers, suppliers, parts, etc.).
 *
 * <SearchableSelect
 *    value={id}
 *    onChange={setId}
 *    options={[{ value, label, secondary, disabled }]}
 *    placeholder="Pick customer"
 *    emptyLabel="— walk-in —"        // shown as first row + trigger when empty
 *    searchPlaceholder="Search…"
 *    testId="foo-select"
 *    disabled={false}
 * />
 */
export default function SearchableSelect({
  value,
  onChange,
  options = [],
  placeholder = "Pick…",
  emptyLabel,          // when set, adds a "clear / walk-in" row + labels the trigger when unselected
  searchPlaceholder = "Search…",
  disabled = false,
  testId,
  className = "",
  align = "start",
  clearable = true,
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef(null);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30); }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;
    return options.filter(o =>
      (o.label || "").toLowerCase().includes(s) ||
      (o.secondary || "").toLowerCase().includes(s)
    );
  }, [q, options]);

  const selected = options.find(o => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          data-testid={testId}
          className={cn("w-full justify-between font-normal", !selected && "text-muted-foreground", className)}
        >
          <span className="truncate flex items-center gap-2">
            {selected ? (
              <>
                <span>{selected.label}</span>
                {selected.secondary && <span className="text-xs text-muted-foreground">· {selected.secondary}</span>}
              </>
            ) : (emptyLabel || placeholder)}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)] max-h-80 overflow-hidden" align={align}>
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 border-0 focus-visible:ring-0 shadow-none px-0 text-sm"
            data-testid={testId ? `${testId}-search` : undefined}
          />
          {q && (
            <button type="button" onClick={() => setQ("")} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="overflow-y-auto max-h-64 py-1">
          {emptyLabel !== undefined && clearable && (
            <button
              type="button"
              onClick={() => { onChange(""); setOpen(false); setQ(""); }}
              className={cn("w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center justify-between",
                !value && "bg-accent/60")}
              data-testid={testId ? `${testId}-clear` : undefined}
            >
              <span className="text-muted-foreground italic">{emptyLabel}</span>
              {!value && <Check className="h-3.5 w-3.5 text-primary" />}
            </button>
          )}
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">No results</div>
          ) : (
            filtered.map(o => (
              <button
                key={o.value}
                type="button"
                disabled={o.disabled}
                onClick={() => { if (!o.disabled) { onChange(o.value); setOpen(false); setQ(""); } }}
                data-testid={testId ? `${testId}-option-${o.value}` : undefined}
                className={cn(
                  "w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center justify-between gap-2",
                  o.value === value && "bg-accent/60",
                  o.disabled && "opacity-50 cursor-not-allowed hover:bg-transparent",
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  <span>{o.label}</span>
                  {o.secondary && <span className="text-xs text-muted-foreground"> · {o.secondary}</span>}
                </span>
                {o.value === value && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

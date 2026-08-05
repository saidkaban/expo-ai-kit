"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "./ThemeProvider";
import { SunIcon, MoonIcon, AutoThemeIcon } from "./icons";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const options = [
    { value: "system" as const, label: "Auto", icon: AutoThemeIcon },
    { value: "light" as const, label: "Light", icon: SunIcon },
    { value: "dark" as const, label: "Dark", icon: MoonIcon },
  ];

  const currentOption = options.find((opt) => opt.value === theme) || options[0];
  const CurrentIcon = currentOption.icon;

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 hover:bg-sidebar-bg rounded-lg transition-colors"
        aria-label="Toggle theme"
      >
        <CurrentIcon className="text-foreground" width={20} height={20} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 py-2 bg-background border border-border rounded-xl shadow-lg min-w-[140px] z-50">
          <div className="px-3 py-1.5 text-xs text-muted font-medium">Theme</div>
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                setTheme(option.value);
                setIsOpen(false);
              }}
              className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-sidebar-bg transition-colors ${
                theme === option.value ? "text-foreground" : "text-muted"
              }`}
            >
              <div className="flex items-center gap-2">
                <option.icon
                  className={theme === option.value ? "text-foreground" : "text-muted"}
                  width={16}
                  height={16}
                />
                {option.label}
              </div>
              {theme === option.value && (
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

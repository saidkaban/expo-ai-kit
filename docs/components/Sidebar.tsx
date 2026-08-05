"use client";

import { useSyncExternalStore, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navigation } from "@/lib/navigation";
import { ChevronRightIcon } from "./icons";

// Track manual hash for immediate feedback before hashchange fires
let manualHashOverride: string | null = null;
const listeners = new Set<() => void>();

function useHash() {
  const subscribe = useCallback((callback: () => void) => {
    listeners.add(callback);
    window.addEventListener("hashchange", callback);
    return () => {
      listeners.delete(callback);
      window.removeEventListener("hashchange", callback);
    };
  }, []);

  const getSnapshot = useCallback(() => {
    return manualHashOverride ?? window.location.hash;
  }, []);

  const getServerSnapshot = useCallback(() => "", []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function setManualHash(hash: string) {
  manualHashOverride = hash;
  listeners.forEach((cb) => cb());
  // Clear override after a tick so hashchange can take over
  setTimeout(() => {
    manualHashOverride = null;
  }, 0);
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const hash = useHash();

  const isActive = (href: string) => {
    if (href.includes("#")) {
      const [basePath, hrefHash] = href.split("#");
      return pathname === basePath && hash === `#${hrefHash}`;
    }
    return pathname === href;
  };

  const handleLinkClick = (href: string) => {
    if (href.includes("#")) {
      const hrefHash = href.split("#")[1];
      setManualHash(`#${hrefHash}`);
    } else {
      setManualHash("");
    }
    onClose();
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-16 left-0 z-30 h-[calc(100vh-4rem)] w-64 overflow-y-auto border-r border-border bg-sidebar-bg transition-transform lg:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <nav className="p-4 pb-20">
          {navigation.map((section) => (
            <div key={section.title} className="mb-6">
              <h4 className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                {section.title}
              </h4>
              <ul className="space-y-1">
                {section.items.map((item) => (
                  <li key={item.title}>
                    {item.href ? (
                      <Link
                        href={item.href}
                        onClick={() => handleLinkClick(item.href!)}
                        className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors ${
                          isActive(item.href)
                            ? "bg-accent-muted text-accent font-medium"
                            : "text-foreground/80 hover:bg-border-muted hover:text-foreground"
                        }`}
                      >
                        {item.title}
                      </Link>
                    ) : (
                      <div className="px-3 py-2 text-sm text-muted">
                        {item.title}
                      </div>
                    )}

                    {item.items && (
                      <ul className="ml-4 mt-1 space-y-1 border-l border-border pl-3">
                        {item.items.map((subItem) => (
                          <li key={subItem.title}>
                            {subItem.href && (
                              <Link
                                href={subItem.href}
                                onClick={() => handleLinkClick(subItem.href!)}
                                className={`flex items-center gap-1 py-1.5 text-sm transition-colors ${
                                  isActive(subItem.href)
                                    ? "text-accent font-medium"
                                    : "text-muted hover:text-foreground"
                                }`}
                              >
                                <ChevronRightIcon className="w-3 h-3" />
                                {subItem.title}
                              </Link>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}

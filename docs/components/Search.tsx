"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { SearchIcon, CloseIcon, DocIcon } from "./icons";
import { searchIndex, SearchItem } from "@/lib/navigation";

export function Search() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleQueryChange = (q: string) => {
    setQuery(q);
    if (!q.trim()) {
      setResults([]);
      return;
    }

    const lowerQuery = q.toLowerCase();
    const filtered = searchIndex.filter(
      (item) =>
        item.title.toLowerCase().includes(lowerQuery) ||
        item.description?.toLowerCase().includes(lowerQuery) ||
        item.section.toLowerCase().includes(lowerQuery)
    );
    setResults(filtered);
    setSelectedIndex(0);
  };

  // Group results by section
  const itemsToShow = query ? results : searchIndex;
  const groupedResults = itemsToShow.reduce((acc, item) => {
    if (!acc[item.section]) {
      acc[item.section] = [];
    }
    acc[item.section].push(item);
    return acc;
  }, {} as Record<string, SearchItem[]>);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen(true);
      }
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const items = query ? results : searchIndex;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (items[selectedIndex]) {
        e.preventDefault();
        router.push(items[selectedIndex].href);
        setIsOpen(false);
        setQuery("");
      }
    }
  };

  const handleSelect = (href: string) => {
    router.push(href);
    setIsOpen(false);
    setQuery("");
  };

  // Get flat index for a result item
  const getFlatIndex = (section: string, indexInSection: number): number => {
    let flatIndex = 0;
    for (const [sec, items] of Object.entries(groupedResults)) {
      if (sec === section) {
        return flatIndex + indexInSection;
      }
      flatIndex += items.length;
    }
    return flatIndex;
  };

  // Highlight matching text
  const highlightMatch = (text: string, searchQuery: string) => {
    if (!searchQuery.trim()) return text;

    const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escapedQuery})`, "gi");
    const parts = text.split(regex);

    return parts.map((part, index) =>
      part.toLowerCase() === searchQuery.toLowerCase() ? (
        <span key={index} className="text-accent">
          {part}
        </span>
      ) : (
        part
      )
    );
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 p-2 text-sm text-muted border border-border rounded-lg hover:border-muted-foreground transition-colors bg-sidebar-bg sm:px-3 sm:py-1.5"
        aria-label="Search documentation"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <SearchIcon className="w-4 h-4" />
        <span className="hidden sm:inline">Search docs...</span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs bg-background border border-border rounded">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      {isOpen &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-100 bg-black/10"
              onClick={() => setIsOpen(false)}
            />
            <div className="fixed top-[10vh] left-1/2 -translate-x-1/2 z-100 w-full max-w-2xl px-4">
              <div
                className="bg-background rounded-xl shadow-2xl overflow-hidden border border-border"
                role="dialog"
                aria-modal="true"
                aria-label="Search documentation"
              >
                {/* Header with search input */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <SearchIcon className="w-5 h-5 text-muted" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => handleQueryChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Search..."
                    aria-label="Search documentation"
                    className="flex-1 bg-transparent text-foreground placeholder:text-muted outline-none border-none focus:ring-0 focus:outline-none focus-visible:outline-none text-base"
                  />
                  <button
                    onClick={() => setIsOpen(false)}
                    className="p-1 hover:bg-sidebar-bg rounded transition-colors"
                    aria-label="Close search"
                  >
                    <CloseIcon className="w-5 h-5 text-muted" />
                  </button>
                </div>

                {/* Divider */}
                <div className="border-b border-border" />

                {/* Results */}
                <div className="max-h-[60vh] overflow-y-auto">
                  {query && results.length === 0 ? (
                    <div className="px-4 py-8 text-center text-muted">
                      No results found for &quot;{query}&quot;
                    </div>
                  ) : (
                    <div className="py-2">
                      {Object.entries(groupedResults).map(
                        ([section, items]) => (
                          <div key={section}>
                            <div className="px-4 py-2 text-xs font-medium text-muted tracking-wide">
                              {section}
                            </div>
                            {items.map((result, indexInSection) => {
                              const flatIndex = getFlatIndex(
                                section,
                                indexInSection
                              );
                              return (
                                <div key={result.href} className="px-2">
                                  <button
                                    onClick={() => handleSelect(result.href)}
                                    className={`w-full px-3 py-2.5 text-left flex items-start gap-3 rounded-lg transition-colors ${
                                      flatIndex === selectedIndex
                                        ? "bg-sidebar-bg"
                                        : "hover:bg-sidebar-bg"
                                    }`}
                                  >
                                    <DocIcon className="w-5 h-5 text-muted mt-0.5 shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <p className="font-medium text-foreground">
                                        {highlightMatch(result.title, query)}
                                      </p>
                                      {result.description && (
                                        <p className="text-sm text-muted truncate">
                                          {highlightMatch(
                                            result.description,
                                            query
                                          )}
                                        </p>
                                      )}
                                    </div>
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>

                {/* Footer with keyboard shortcuts */}
                <div className="border-t border-border px-4 py-2.5 flex items-center gap-4 text-xs text-muted bg-sidebar-bg">
                  <div className="flex items-center gap-1.5">
                    <kbd className="px-1.5 py-0.5 bg-background border border-border rounded text-[10px]">
                      ↵
                    </kbd>
                    <span>to select</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <kbd className="px-1.5 py-0.5 bg-background border border-border rounded text-[10px]">
                      ↑
                    </kbd>
                    <kbd className="px-1.5 py-0.5 bg-background border border-border rounded text-[10px]">
                      ↓
                    </kbd>
                    <span>to navigate</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <kbd className="px-1.5 py-0.5 bg-background border border-border rounded text-[10px]">
                      esc
                    </kbd>
                    <span>to close</span>
                  </div>
                </div>
              </div>
            </div>
          </>,
          document.body
        )}
    </>
  );
}

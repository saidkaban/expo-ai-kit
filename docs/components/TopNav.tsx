"use client";

import Link from "next/link";
import Image from "next/image";
import { Search } from "./Search";
import { GitHubIcon, NpmIcon, MenuIcon, CloseIcon } from "./icons";
import { ThemeToggle } from "./ThemeToggle";

interface TopNavProps {
  onMenuClick: () => void;
  isSidebarOpen: boolean;
}

export function TopNav({ onMenuClick, isSidebarOpen }: TopNavProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-40 h-16 border-b border-border bg-header-bg backdrop-blur-md">
      <div className="flex items-center justify-between h-full px-4 lg:px-6">
        <div className="flex items-center gap-4">
          <button
            onClick={onMenuClick}
            className="lg:hidden p-2 -ml-2 hover:bg-sidebar-bg rounded-lg transition-colors"
            aria-label={isSidebarOpen ? "Close menu" : "Open menu"}
          >
            {isSidebarOpen ? (
              <CloseIcon className="text-foreground" />
            ) : (
              <MenuIcon className="text-foreground" />
            )}
          </button>

          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/logo.svg"
              alt="expo-ai-kit logo"
              width={32}
              height={32}
            />
            <span className="font-semibold text-foreground">expo-ai-kit</span>
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <Search />

          <a
            href="https://www.npmjs.com/package/expo-ai-kit"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 hover:bg-sidebar-bg rounded-lg transition-colors"
            aria-label="npm package"
          >
            <NpmIcon className="text-foreground" />
          </a>

          <a
            href="https://github.com/saidkaban/expo-ai-kit"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 hover:bg-sidebar-bg rounded-lg transition-colors"
            aria-label="GitHub repository"
          >
            <GitHubIcon className="text-foreground" />
          </a>

          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

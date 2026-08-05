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
      <div className="flex items-center justify-between h-full px-3 sm:px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <button
            onClick={onMenuClick}
            className="-ml-2 cursor-pointer rounded-lg p-2 transition-colors hover:bg-sidebar-bg lg:hidden"
            aria-label={isSidebarOpen ? "Close menu" : "Open menu"}
          >
            {isSidebarOpen ? (
              <CloseIcon className="text-foreground" />
            ) : (
              <MenuIcon className="text-foreground" />
            )}
          </button>

          <Link href="/" className="flex min-w-0 items-center gap-2" aria-label="expo-ai-kit documentation home">
            <Image
              src="/logo.svg"
              alt="expo-ai-kit logo"
              width={30}
              height={30}
              className="shrink-0"
            />
            <span className="whitespace-nowrap text-sm font-semibold text-foreground sm:text-base">
              expo-ai-kit
            </span>
          </Link>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-2">
          <Search />

          <a
            href="https://www.npmjs.com/package/expo-ai-kit"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden cursor-pointer rounded-lg p-2 transition-colors hover:bg-sidebar-bg sm:inline-flex"
            aria-label="npm package"
          >
            <NpmIcon className="text-foreground" />
          </a>

          <a
            href="https://github.com/saidkaban/expo-ai-kit"
            target="_blank"
            rel="noopener noreferrer"
            className="cursor-pointer rounded-lg p-2 transition-colors hover:bg-sidebar-bg"
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

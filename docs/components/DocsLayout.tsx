"use client";

import { useState, ReactNode } from "react";
import { TopNav } from "./TopNav";
import { Sidebar } from "./Sidebar";
import { TableOfContents } from "./TableOfContents";

interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface DocsLayoutProps {
  children: ReactNode;
  headings?: TocItem[];
}

export function DocsLayout({ children, headings = [] }: DocsLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <TopNav
        onMenuClick={() => setSidebarOpen(!sidebarOpen)}
        isSidebarOpen={sidebarOpen}
      />
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="pt-16 lg:pl-64">
        <div className="flex">
          <article className="flex-1 min-w-0 px-4 py-8 lg:px-8 xl:px-12">
            <div className="prose max-w-3xl mx-auto xl:mx-0">{children}</div>
          </article>

          <TableOfContents headings={headings} />
        </div>
      </main>
    </div>
  );
}

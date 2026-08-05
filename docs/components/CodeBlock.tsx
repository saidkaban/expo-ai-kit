"use client";

import { useState } from "react";
import { CopyIcon, CheckIcon } from "./icons";

interface CodeBlockProps {
  children: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
}

export function CodeBlock({
  children,
  language = "typescript",
  filename,
  showLineNumbers = false,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = children.trim().split("\n");

  return (
    <div className="group relative my-4 rounded-lg border border-border bg-code-bg overflow-hidden">
      {filename && (
        <div className="flex items-center justify-between border-b border-border px-4 py-2 bg-sidebar-bg">
          <span className="text-xs font-medium text-muted">{filename}</span>
          <span className="text-xs text-muted-foreground">{language}</span>
        </div>
      )}
      <div className="relative">
        <button
          onClick={handleCopy}
          className="absolute right-2 top-2 p-2 rounded-md bg-background/80 border border-border opacity-0 group-hover:opacity-100 transition-opacity hover:bg-sidebar-bg focus:opacity-100"
          aria-label={copied ? "Copied!" : "Copy code"}
        >
          {copied ? (
            <CheckIcon className="text-success" />
          ) : (
            <CopyIcon className="text-muted" />
          )}
        </button>
        <pre className="overflow-x-auto p-4 text-sm leading-relaxed">
          <code className={`language-${language}`}>
            {showLineNumbers ? (
              <table className="border-collapse">
                <tbody>
                  {lines.map((line, i) => (
                    <tr key={i}>
                      <td className="pr-4 text-right text-muted-foreground select-none w-8">
                        {i + 1}
                      </td>
                      <td className="whitespace-pre">{line}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              children.trim()
            )}
          </code>
        </pre>
      </div>
    </div>
  );
}

interface InlineCodeProps {
  children: React.ReactNode;
}

export function InlineCode({ children }: InlineCodeProps) {
  return (
    <code className="px-1.5 py-0.5 rounded bg-code-bg border border-border text-sm font-mono">
      {children}
    </code>
  );
}

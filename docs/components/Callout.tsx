import { ReactNode } from "react";
import { InfoIcon, WarningIcon, SuccessIcon } from "./icons";

type CalloutType = "info" | "warning" | "success";

interface CalloutProps {
  type?: CalloutType;
  title?: string;
  children: ReactNode;
}

const styles: Record<
  CalloutType,
  { bg: string; border: string; icon: typeof InfoIcon; iconColor: string }
> = {
  info: {
    bg: "bg-info-bg",
    border: "border-info/30",
    icon: InfoIcon,
    iconColor: "text-info",
  },
  warning: {
    bg: "bg-warning-bg",
    border: "border-warning/30",
    icon: WarningIcon,
    iconColor: "text-warning",
  },
  success: {
    bg: "bg-success-bg",
    border: "border-success/30",
    icon: SuccessIcon,
    iconColor: "text-success",
  },
};

export function Callout({ type = "info", title, children }: CalloutProps) {
  const style = styles[type];
  const Icon = style.icon;

  return (
    <div
      className={`my-6 rounded-lg border ${style.border} ${style.bg} p-4`}
      role="note"
    >
      <div className="flex gap-3">
        <Icon className={`${style.iconColor} flex-shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          {title && (
            <p className="font-semibold text-foreground mb-1">{title}</p>
          )}
          <div className="text-sm text-foreground/90 [&>p]:mb-2 [&>p:last-child]:mb-0">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

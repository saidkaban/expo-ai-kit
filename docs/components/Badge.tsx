import { AppleIcon, AndroidIcon } from "./icons";

type Platform = "ios" | "android" | "web" | "beta" | "new" | "deprecated";

interface BadgeProps {
  platform: Platform;
}

const badgeStyles: Record<
  Platform,
  {
    bg: string;
    text: string;
    border: string;
    label: string;
    icon?: typeof AppleIcon;
  }
> = {
  ios: {
    bg: "bg-slate-100 dark:bg-slate-800",
    text: "text-slate-700 dark:text-slate-300",
    border: "border-slate-200 dark:border-slate-700",
    label: "iOS",
    icon: AppleIcon,
  },
  android: {
    bg: "bg-green-50 dark:bg-green-950",
    text: "text-green-700 dark:text-green-400",
    border: "border-green-200 dark:border-green-800",
    label: "Android",
    icon: AndroidIcon,
  },
  web: {
    bg: "bg-blue-50 dark:bg-blue-950",
    text: "text-blue-700 dark:text-blue-400",
    border: "border-blue-200 dark:border-blue-800",
    label: "Web",
  },
  beta: {
    bg: "bg-purple-50 dark:bg-purple-950",
    text: "text-purple-700 dark:text-purple-400",
    border: "border-purple-200 dark:border-purple-800",
    label: "Beta",
  },
  new: {
    bg: "bg-emerald-50 dark:bg-emerald-950",
    text: "text-emerald-700 dark:text-emerald-400",
    border: "border-emerald-200 dark:border-emerald-800",
    label: "New",
  },
  deprecated: {
    bg: "bg-amber-50 dark:bg-amber-950",
    text: "text-amber-700 dark:text-amber-400",
    border: "border-amber-200 dark:border-amber-800",
    label: "Deprecated",
  },
};

export function Badge({ platform }: BadgeProps) {
  const style = badgeStyles[platform];
  const Icon = style.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${style.bg} ${style.text} ${style.border}`}
    >
      {Icon && <Icon />}
      {style.label}
    </span>
  );
}

interface BadgeGroupProps {
  platforms: Platform[];
}

export function BadgeGroup({ platforms }: BadgeGroupProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {platforms.map((platform) => (
        <Badge key={platform} platform={platform} />
      ))}
    </div>
  );
}

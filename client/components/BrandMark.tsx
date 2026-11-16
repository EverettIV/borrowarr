import clsx from "clsx";

const sizeClasses = {
  nav: "h-8 w-8",
  footer: "h-9 w-9",
} as const;

const pixelSize = {
  nav: 32,
  footer: 36,
} as const;

type BrandMarkProps = {
  variant?: keyof typeof sizeClasses;
  className?: string;
};

export function BrandMark({ variant = "nav", className }: BrandMarkProps) {
  const dim = pixelSize[variant];

  return (
    <img
      alt=""
      aria-hidden
      className={clsx(
        sizeClasses[variant],
        "shrink-0 origin-center transition-transform duration-200 ease-out",
        "group-hover:-rotate-12 group-active:-rotate-[22deg]",
        className,
      )}
      height={dim}
      src="/borrowarr-icon-no-bg.png"
      width={dim}
    />
  );
}
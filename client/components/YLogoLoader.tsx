import clsx from "clsx";

const sizeClasses = {
  sm: "h-5 w-5",
  md: "h-8 w-8",
  lg: "h-12 w-12",
} as const;

const pixelSize = {
  sm: 20,
  md: 32,
  lg: 48,
} as const;

type YLogoLoaderProps = {
  size?: keyof typeof sizeClasses;
  className?: string;
  /** @deprecated ignored — kept for drop-in replacement of HeroUI Spinner */
  color?: string;
};

export function YLogoLoader({
  size = "md",
  className,
}: YLogoLoaderProps) {
  const dim = pixelSize[size];

  return (
    <img
      alt=""
      role="status"
      aria-label="Loading"
      className={clsx(
        sizeClasses[size],
        "shrink-0 origin-center animate-y-logo-loader",
        className,
      )}
      height={dim}
      src="/borrowarr-icon-no-bg.png"
      width={dim}
    />
  );
}
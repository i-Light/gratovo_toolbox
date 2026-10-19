import { icons, type IconName } from "./icons";
import { cx } from "./cx";

/** What `Icon` takes. */
export interface IconProps {
  readonly name: IconName;
  /** Width and height in pixels. Default 16. */
  readonly size?: number;
  readonly className?: string | undefined;
  /** When set, the icon is announced as an image with this label. Otherwise it is hidden from screen readers. */
  readonly title?: string;
}

/** One authored SVG icon on a 24 by 24 grid. Circles are `"c:x,y,r"`, rects `"r:x,y,w,h,rx"`, the rest paths. */
export function Icon({ name, size = 16, className, title }: IconProps) {
  const parts: readonly string[] = icons[name];
  return (
    <svg
      className={cx("ic", className)}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      {...(title === undefined ? { "aria-hidden": "true" } : { role: "img" })}
    >
      {title === undefined ? null : <title>{title}</title>}
      {parts.map((part, i) => {
        if (part.startsWith("c:")) {
          const [cx0, cy, r] = part.slice(2).split(",");
          return <circle key={i} cx={cx0} cy={cy} r={r} />;
        }
        if (part.startsWith("r:")) {
          const [x, y, width, height, rx] = part.slice(2).split(",");
          return <rect key={i} x={x} y={y} width={width} height={height} rx={rx ?? 0} />;
        }
        return <path key={i} d={part} />;
      })}
    </svg>
  );
}

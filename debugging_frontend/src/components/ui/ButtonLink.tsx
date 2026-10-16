import Link, { type LinkProps } from "next/link";
import { buttonClasses, type ButtonStyleOptions } from "./Button";

export type ButtonLinkProps = LinkProps &
  ButtonStyleOptions & {
    children: React.ReactNode;
  };

/**
 * A link that looks like a button.
 *
 * Navigation stays an anchor — middle-click, open-in-new-tab, and the status
 * bar all keep working — while sharing `Button`'s styles exactly.
 */
export function ButtonLink({
  variant,
  size,
  fullWidth,
  className,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <Link className={buttonClasses({ variant, size, fullWidth, className })} {...props}>
      {children}
    </Link>
  );
}

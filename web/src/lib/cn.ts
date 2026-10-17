/**
 * Conditional class names.
 *
 * Deliberately not `clsx` plus `tailwind-merge`: those matter when a component
 * library must let callers override arbitrary utilities. These components own
 * their classes, so a join is enough and avoids two dependencies. If shadcn
 * components are added later they bring their own `cn` and this can be replaced.
 */
export type ClassValue = string | false | null | undefined;

export function cn(...values: readonly ClassValue[]): string {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0).join(" ");
}

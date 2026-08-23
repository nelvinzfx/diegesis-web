/** Tiny className joiner (avoids pulling clsx/tailwind-merge into web). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

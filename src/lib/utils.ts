import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const slugify = (text: string, context: string = ''): string => {
  const S = '-'; // separator
  const NC_RE = /[^\w\s-]/g; // non-alphanumeric, non-whitespace, non-hyphen
  const WS_RE = /\s+/g;      // whitespace
  const MULTI_S_RE = new RegExp(`${S}${S}+`, 'g'); // multiple separators

  let slug = text.toString().toLowerCase().trim();
  slug = slug.replace(NC_RE, '');      // Remove special characters
  slug = slug.replace(WS_RE, S);       // Replace whitespace with separator
  slug = slug.replace(MULTI_S_RE, S);  // Replace multiple separators with single

  if (context) {
    const contextSlug = context.toString().toLowerCase().trim()
      .replace(NC_RE, '')
      .replace(WS_RE, S)
      .replace(MULTI_S_RE, S);
    return `${slug}_${contextSlug}`; // Use underscore to differentiate parts if needed
  }
  return slug;
};

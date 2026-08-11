/**
 * Code-level outbound sanitizer for iMessage.
 * Backstop for prompt-only formatting rules: plain text, no markdown, no em dashes.
 */

const EMDASH_RE = /[\u2014\u2013\u2015]/g; // em, en, horizontal bar
const MD_CODE_FENCE_RE = /```[\s\S]*?```/g;
const MD_INLINE_CODE_RE = /`([^`]+)`/g;
const MD_BOLD_ITALIC_RE = /\*\*\*(.+?)\*\*\*/g;
const MD_BOLD_RE = /\*\*(.+?)\*\*/g;
const MD_ITALIC_RE = /(?<!\w)\*(.+?)\*(?!\w)/g;
const MD_ITALIC_US_RE = /(?<!\w)_(.+?)_(?!\w)/g;
const MD_STRIKE_RE = /~~(.+?)~~/g;
const MD_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const MD_HEADING_RE = /^#{1,6}\s+/gm;
const MD_HR_RE = /^[-*_]{3,}\s*$/gm;
const MD_UL_RE = /^(\s*)[-*+]\s+/gm;
const MD_OL_RE = /^(\s*)\d+\.\s+/gm;
const MD_TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/gm;
const MD_TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/gm;

/** Strip markdown artifacts and replace em/en dashes with ASCII hyphens. */
export function sanitizeImessageText(text: string): string {
  if (!text) return "";

  const urlPlaceholders: string[] = [];
  let result = text
    .replace(/https?:\/\/[^\s)>\]]+/g, (url) => {
      urlPlaceholders.push(url);
      return `%%URLPH${urlPlaceholders.length - 1}%%`;
    })
    .replace(EMDASH_RE, "-")
    .replace(MD_CODE_FENCE_RE, (m) =>
      m.replace(/```(\w*\n?)?/g, "").trim(),
    )
    .replace(MD_INLINE_CODE_RE, "$1")
    .replace(MD_BOLD_ITALIC_RE, "$1")
    .replace(MD_BOLD_RE, "$1")
    .replace(MD_ITALIC_RE, "$1")
    .replace(MD_ITALIC_US_RE, "$1")
    .replace(MD_STRIKE_RE, "$1")
    .replace(MD_LINK_RE, "$1 ($2)")
    .replace(MD_HEADING_RE, "")
    .replace(MD_HR_RE, "")
    .replace(MD_TABLE_SEP_RE, "")
    .replace(MD_TABLE_ROW_RE, (_, cells: string) =>
      cells
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean)
        .join(" - "),
    )
    .replace(MD_UL_RE, "$1")
    .replace(MD_OL_RE, "$1")
    .replace(/\r\n/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ \n/g, "\n")
    .replace(/\n /g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  result = result.replace(
    /%%URLPH(\d+)%%/g,
    (_, idx) => urlPlaceholders[Number(idx)] ?? "",
  );

  return result;
}

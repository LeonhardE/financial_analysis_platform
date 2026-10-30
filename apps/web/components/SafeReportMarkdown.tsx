import type { ReactNode } from "react";

/** Navigation only; never fetch, embed, decode HTML or accept credentials. */
export function reportLink(value: string): string | null {
  if (!/^https:\/\//.test(value) || /[\s\u0000-\u001f\\]/u.test(value) || value.length > 2048)
    return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443")
      ? value
      : null;
  } catch {
    return null;
  }
}

function inline(text: string): ReactNode[] {
  const pattern =
    /\[([^\]\n]{1,500})\]\((https:\/\/[^\s()]{1,2048})\)|\*\*([^*\n]{1,1000})\*\*|`([^`\n]{1,1000})`/g;
  const result: ReactNode[] = [];
  let offset = 0,
    match: RegExpExecArray | null,
    count = 0;
  while ((match = pattern.exec(text)) && count++ < 200) {
    result.push(text.slice(offset, match.index));
    if (match[1] && !text.slice(0, match.index).endsWith("!")) {
      const href = reportLink(match[2]);
      result.push(
        href ? (
          <a
            key={match.index}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
          >
            {match[1]}
          </a>
        ) : (
          match[0]
        ),
      );
    } else if (match[3]) result.push(<strong key={match.index}>{match[3]}</strong>);
    else if (match[4]) result.push(<code key={match.index}>{match[4]}</code>);
    else result.push(match[0]);
    offset = pattern.lastIndex;
  }
  result.push(text.slice(offset));
  return result;
}

/** A deliberately small Markdown subset. Every leaf is React text; no HTML parser. */
export function SafeReportMarkdown({ markdown }: { markdown: string }) {
  const lines = markdown.split(/\r?\n/);
  // Valid long input remains readable without creating an unbounded DOM tree.
  if (lines.length > 400) return <p style={{ whiteSpace: "pre-wrap" }}>{markdown}</p>;
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [],
    list: string[] = [],
    code: string[] | null = null;
  const flush = () => {
    if (paragraph.length)
      blocks.push(<p key={`p${blocks.length}`}>{inline(paragraph.join("\n"))}</p>);
    if (list.length)
      blocks.push(
        <ul key={`l${blocks.length}`}>
          {list.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ul>,
      );
    paragraph = [];
    list = [];
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      flush();
      if (code) {
        blocks.push(
          <pre key={`c${blocks.length}`}>
            <code>{code.join("\n")}</code>
          </pre>,
        );
        code = null;
      } else code = [];
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    const bullet = /^\s*(?:[-*]|\d+\.)\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      blocks.push(<h3 key={`h${blocks.length}`}>{inline(heading[1])}</h3>);
    } else if (bullet) {
      if (paragraph.length) flush();
      list.push(bullet[1]);
    } else {
      if (list.length) flush();
      paragraph.push(line);
    }
  }
  flush();
  if (code)
    blocks.push(
      <pre key="last-code">
        <code>{code.join("\n")}</code>
      </pre>,
    );
  return <>{blocks}</>;
}

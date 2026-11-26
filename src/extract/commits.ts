import type { NormalizedBlock } from "../types";
import { setCommitPosition } from "../core/duckwerks-meta";

export interface CommitInfo {
  hash?: string;
  message: string;
  /** Duckwerks: set on receipt-backed commits; built-in ones keep theirs in duckwerks-meta. */
  blockIndex?: number;
  sourceIndex?: number;
}

const COMMIT_MSG_RE = /git\s+commit[^\n]*?\s-[A-Za-z]*m\s+(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|\$?'((?:[^'\\]|\\.)*)')/;
// `-F -` / `--file=-` reads the message from stdin; the heredoc feeding it sits on the same command.
// A file path after -F cannot be read from the transcript, so it is not matched.
const STDIN_HEREDOC_COMMIT_RE =
  /git\s+commit[^\n]*?(?:\s-[A-Za-z]*F|\s--file)(?:\s+|=)-(?=\s)[^\n]*?<<-?\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_]\w*))[^\n]*(?:\r?\n|\\n)/;
// Match short hash from git output: "[branch hash]" or "main hash" or 7-12 hex
const HASH_RE = /\b([0-9a-f]{7,12})\b/;

const cleanMessage = (msg: string): string =>
  msg.replace(/\\"/g, '"').replace(/\\'/g, "'").trim();

const linesOf = (text: string): string[] => text.split(/\\n|\n/);

const firstLineOf = (text: string): string => {
  const line = linesOf(text)[0] ?? "";
  return line.trim();
};

// COMMIT_MSG_RE only yields the `$(cat <<...` opener (truncated at the inner quote for <<"DELIM"), so heredoc -m is re-read from the raw command.
const HEREDOC_COMMIT_CMD_RE =
  /^git\s+commit[^\n"'&;|]*?\s-[A-Za-z]*m\s+"\$\(cat\s+<<-?\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_]\w*))(?:\r?\n|\\n)/;

const firstHeredocBodyLine = (rest: string, delim: string): string => {
  for (const line of linesOf(rest)) {
    const trimmed = line.replace(/^\t+/, "").trim();
    if (trimmed === delim) break;
    if (trimmed) return trimmed;
  }
  return "";
};

const subjectFromHeredocCmd = (cmd: string): string | null => {
  const m = cmd.match(HEREDOC_COMMIT_CMD_RE);
  if (!m) return null;
  const delim = m[1] ?? m[2] ?? m[3] ?? "";
  return cleanMessage(firstHeredocBodyLine(cmd.slice(m.index! + m[0].length), delim));
};

const subjectFromStdinHeredoc = (cmd: string): string | null => {
  const m = cmd.match(STDIN_HEREDOC_COMMIT_RE);
  if (!m) return null;
  const delim = m[1] ?? m[2] ?? m[3] ?? "";
  return cleanMessage(firstHeredocBodyLine(cmd.slice(m.index! + m[0].length), delim));
};

// A later `git commit` starts a new commit only at a command boundary, so prose in a message that says "git commit" does not split it.
const COMMIT_START_RE = /\bgit\s+commit\b/g;
const commitSegments = (cmd: string): string[] => {
  const starts: number[] = [];
  for (const m of cmd.matchAll(COMMIT_START_RE)) {
    if (starts.length === 0 || /(?:^|[;&|(\n])\s*$/.test(cmd.slice(0, m.index))) starts.push(m.index!);
  }
  return starts.map((at, k) => cmd.slice(at, starts[k + 1]));
};

/** Subject of the one `git commit ...` in `seg`, or "" when it cannot be read. */
const subjectOf = (seg: string): string => {
  const m = seg.match(COMMIT_MSG_RE);
  if (!m) return subjectFromStdinHeredoc(seg) ?? "";
  // First -m is `"$(cat <<DELIM ...`: COMMIT_MSG_RE only sees `$(cat <<...`, so read the heredoc body.
  const heredoc = m[1] !== undefined && /^\$\(cat\s+<</.test(m[1])
    ? subjectFromHeredocCmd(seg.slice(m.index!))
    : null;
  const message = heredoc ?? firstLineOf(cleanMessage(m[1] ?? m[2] ?? m[3] ?? ""));
  return heredoc === null && /^\$\(cat\s+<</.test(message) ? "" : message;
};

/** Hash of a lone commit, from the next tool results; the first hash-looking text wins. */
const hashFromResults = (results: string[]): string | undefined => {
  for (const text of results) {
    // Common git commit output: `[branch <hash>] message` or `<branch> <hash>..<hash>`
    const bracket = text.match(/\[\S+\s+([0-9a-f]{7,12})\]/);
    if (bracket) return bracket[1];
    const range = text.match(/\b([0-9a-f]{7,12})\.\.([0-9a-f]{7,12})\b/);
    if (range) return range[2];
    const plain = text.match(HASH_RE);
    if (plain) return plain[1];
  }
  return undefined;
};

// `[branch <hash>] <subject>` (git commit) or `<hash> [(refs)] <subject>` (git log --oneline).
const HASH_SUBJECT_LINE_RE = /(?:\[\S+\s+([0-9a-f]{7,12})\]|^\s*([0-9a-f]{7,12})(?:\s+\([^)]*\))?)\s+(.*)/;

/** Hash of one of several commits in a command: only an output line that names that commit's subject counts. */
const hashForSubject = (results: string[], message: string): string | undefined => {
  for (const text of results) {
    for (const line of text.split("\n")) {
      const m = line.match(HASH_SUBJECT_LINE_RE);
      if (m && m[3].trim() === message) return m[1] ?? m[2];
    }
  }
  return undefined;
};

/**
 * Extract git commits from bash tool calls (`git commit -m "..."`) and pair
 * with hash from the immediately following tool_result.
 */
export const extractCommits = (blocks: NormalizedBlock[]): CommitInfo[] => {
  const commits: CommitInfo[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind !== "tool_call" || b.name !== "bash") continue;
    const cmd = typeof b.args.command === "string" ? b.args.command : "";
    const segments = commitSegments(cmd);
    if (segments.length === 0) continue;

    const results: string[] = [];
    for (let j = i + 1; j < Math.min(blocks.length, i + 3); j++) {
      const r = blocks[j];
      if (r.kind === "tool_result") results.push(r.text);
    }

    for (const seg of segments) {
      const message = subjectOf(seg);
      if (!message) continue;
      // With several commits one output cannot be split reliably, so a hash is taken only when its line names this subject.
      const hash = segments.length === 1 ? hashFromResults(results) : hashForSubject(results, message);

      // One entry per commit: the same message seen hashless (`-q` prints no hash) and hashed is one commit, keep the hashed.
      const dup = commits.find((c) => c.message === message && (!c.hash || !hash || c.hash === hash));
      if (!dup) commits.push(setCommitPosition({ hash, message }, i));
      else if (hash && !dup.hash) dup.hash = hash;
    }
  }

  return commits;
};

export const formatCommits = (commits: CommitInfo[], limit = 8): string[] => {
  const lines: string[] = [];
  const items = commits.slice(-limit); // keep most recent
  for (const c of items) {
    const prefix = c.hash ? `${c.hash}: ` : "";
    lines.push(`${prefix}${c.message}`);
  }
  return lines;
};

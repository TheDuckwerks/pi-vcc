import type { FileOps, NormalizedBlock } from "../types";
import type { SectionData } from "../sections";
import { extractFiles } from "../extract/files";
import { extractUserMessages, keepNewestUserMessages } from "../extract/user-messages";
import { type CommitInfo, extractCommits, formatCommits } from "../extract/commits";
import { extractProfileCommits } from "../extract/profile-commits";
import { commitPositionOf } from "./duckwerks-meta";
import type { RecognitionProfile } from "./recognition-profile";
import { extractTrackedCommands, formatTrackedCommands } from "../extract/tracked-commands";
import { buildBriefSections, stringifyBrief } from "./brief";
import { FILES_PER_CATEGORY, capItems } from "./format";

export interface BuildSectionsInput {
  blocks: NormalizedBlock[];
  briefBlocks?: NormalizedBlock[];
  /** Hook-provided file activity; authoritative for files touched before this compaction. */
  fileOps?: FileOps;
  /** Command names to record in a [Tracked Commands] section (see
   * PiVccSettings.trackCommands). Empty/omitted = section stays empty. */
  trackCommands?: readonly string[];
  /** Duckwerks: extra commit commands (e.g. quack commit) proven by a Git receipt. */
  recognitionProfile?: RecognitionProfile;
}

const formatFileActivity = (blocks: NormalizedBlock[], fileOps?: FileOps): string[] => {
  const act = extractFiles(blocks, fileOps);
  // Dedup: if already Modified, drop from Created (file existed before)
  for (const p of act.modified) act.created.delete(p);
  const lines: string[] = [];
  const cap = (set: Set<string>) => capItems([...set], FILES_PER_CATEGORY, ", ");
  if (act.modified.size > 0) lines.push(`Modified: ${cap(act.modified)}`);
  if (act.created.size > 0) lines.push(`Created: ${cap(act.created)}`);
  if (act.read.size > 0) lines.push(`Read: ${cap(act.read)}`);
  return lines;
};

// Duckwerks: one chronological list; a commit seen by both extractors is listed once.
const withProfileCommits = (commits: CommitInfo[], profileCommits: CommitInfo[]): CommitInfo[] => {
  if (!profileCommits.length) return commits;
  const seen = new Set<string>();
  return [...commits, ...profileCommits]
    .sort((a, b) => commitPositionOf(a) - commitPositionOf(b))
    .filter((commit) => {
      const key = commit.hash ? `${commit.hash.slice(0, 7)}::${commit.message}` : `::${commit.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export const buildSections = (input: BuildSectionsInput): SectionData => {
  const { blocks } = input;
  const briefSections = buildBriefSections(input.briefBlocks ?? blocks);
  return {
    filesAndChanges: formatFileActivity(blocks, input.fileOps),
    commits: formatCommits(withProfileCommits(extractCommits(blocks), extractProfileCommits(blocks, input.recognitionProfile))),
    userMessages: keepNewestUserMessages(extractUserMessages(blocks)),
    trackedCommands: formatTrackedCommands(extractTrackedCommands(blocks, input.trackCommands ?? [])),
    briefTranscript: stringifyBrief(briefSections),
  };
};

import type { FileOps, NormalizedBlock } from "../types";
import type { SectionData } from "../sections";
import { extractCommits, formatCommits } from "../extract/commits";
import { extractProfileCommits } from "../extract/profile-commits";
import type { RecognitionProfile } from "./recognition-profile";
import { buildBriefSections, stringifyBrief } from "./brief";
import { extractPath } from "./tool-args";

export interface BuildSectionsInput {
  blocks: NormalizedBlock[];
  briefBlocks?: NormalizedBlock[];
  fileOps?: FileOps;
  recognitionProfile?: RecognitionProfile;
}

const formatObservedFileCalls = (blocks: NormalizedBlock[]): string[] => {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.kind !== "tool_call") continue;
    const path = extractPath(block.args);
    if (!path) continue;
    const line = `${block.name}(${path})${block.sourceIndex == null ? "" : ` (#${block.sourceIndex})`}`;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines;
};

export const buildSections = (input: BuildSectionsInput): SectionData => {
  const blocks = input.blocks;
  const briefSections = buildBriefSections(input.briefBlocks ?? blocks);
  const seenCommits = new Set<string>();
  const commits = [...extractCommits(blocks), ...extractProfileCommits(blocks, input.recognitionProfile)]
    .sort((a, b) => (a.blockIndex ?? 0) - (b.blockIndex ?? 0))
    .filter((commit) => {
      const key = `${commit.hash ?? ""}::${commit.message}`;
      if (seenCommits.has(key)) return false;
      seenCommits.add(key);
      return true;
    });
  return {
    sessionGoal: [],
    outstandingContext: [],
    filesAndChanges: formatObservedFileCalls(blocks),
    commits: formatCommits(commits),
    userPreferences: [],
    briefTranscript: stringifyBrief(briefSections),
  };
};

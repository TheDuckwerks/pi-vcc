import type { Message } from "@earendil-works/pi-ai";

export type CompactionReason = "manual" | "threshold" | "overflow";

export interface FileOps {
  readFiles?: string[];
  modifiedFiles?: string[];
  createdFiles?: string[];
}

export type NormalizedBlock =
  | { kind: "user"; text: string; sourceIndex?: number }
  | { kind: "assistant"; text: string; sourceIndex?: number }
  | { kind: "tool_call"; name: string; args: Record<string, unknown>; toolCallId?: string; sourceIndex?: number }
  | { kind: "tool_result"; name: string; text: string; toolCallId?: string; isError?: boolean; execution?: { exitCode?: number; truncated?: boolean }; sourceIndex?: number }
  | { kind: "bash"; command: string; output: string; exitCode: number | undefined; sourceIndex?: number };

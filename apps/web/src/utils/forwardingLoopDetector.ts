import { normalizeAddress } from "./stellarAddress.js";

/** Mirrors the contract's default MaxForwardDepth (see lib.rs). */
export const DEFAULT_MAX_FORWARD_DEPTH = 5;

/** Client-side view of a PaymentForwardConfig entry. */
export interface ForwardEdge {
  merchant: string;
  forward_to: string;
  forward_bps?: number;
  active?: boolean;
}

export interface ForwardGraphInput {
  edges: readonly ForwardEdge[];
  /** Maximum number of forward hops allowed before the chain is rejected. */
  maxDepth?: number;
}

export type ForwardIssueKind = "cycle" | "ttl-breach";

export interface ForwardIssue {
  kind: ForwardIssueKind;
  /** Ordered addresses. A cycle repeats its first address at the end. */
  path: string[];
  message: string;
}

export interface ForwardAnalysis {
  issues: ForwardIssue[];
  cycles: string[][];
  ttlBreaches: string[][];
  hasCycle: boolean;
  hasTtlBreach: boolean;
  /** Union of every address participating in an issue (for graph highlighting). */
  highlightedAddresses: string[];
  /** Every traced hop chain, originating from each configured merchant. */
  hopChains: string[][];
  /** True when no cycle and no hop-TTL breach was found. */
  isValid: boolean;
}

interface WalkResult {
  path: string[];
  cycle: string[] | null;
  ttlBreach: string[] | null;
}

function canonicalCycleKey(cycle: string[]): string {
  const nodes = cycle.length > 1 && cycle[0] === cycle[cycle.length - 1]
    ? cycle.slice(0, -1)
    : [...cycle];
  if (nodes.length === 0) return "";
  let smallest = 0;
  for (let i = 1; i < nodes.length; i += 1) {
    if ((nodes[i] ?? "") < (nodes[smallest] ?? "")) smallest = i;
  }
  const rotated = [...nodes.slice(smallest), ...nodes.slice(0, smallest)];
  return rotated.join("\u0000");
}

function addUniqueKey(key: string, visited: Set<string>): boolean {
  if (visited.has(key)) return false;
  visited.add(key);
  return true;
}

/**
 * Walks a single proposed/observed forward config using the same shape of
 * traversal as PaymentContract::set_payment_forward:
 *
 *   current = forward_to
 *   repeat up to maxDepth times: follow current's own forward config
 *   if a config still exists after maxDepth hops => hop-TTL breach
 *
 * A cycle is reported whenever the walk revisits any address (including the
 * originating merchant), which also covers self-loops (A → A).
 */
function walkChain(
  origin: string,
  forwardTo: string,
  graph: Map<string, ForwardEdge>,
  maxDepth: number
): WalkResult {
  const path: string[] = [origin];
  const seen = new Map<string, number>([[origin, 0]]);
  let current = forwardTo;
  let cycle: string[] | null = null;
  let ttlBreach: string[] | null = null;

  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (current.length === 0) break;

    const firstSeen = seen.get(current);
    if (firstSeen !== undefined) {
      cycle = [...path.slice(firstSeen), current];
      break;
    }

    seen.set(current, path.length);
    path.push(current);

    const nextEdge = graph.get(current);
    if (!nextEdge) break;
    current = normalizeAddress(nextEdge.forward_to);

    if (depth === maxDepth - 1 && graph.has(current)) {
      ttlBreach = [...path, current];
      break;
    }
  }

  return { path, cycle, ttlBreach };
}

/**
 * Analyses every forwarding edge for circular loops and hop-TTL breaches.
 *
 * Inactive edges (`active === false`) are ignored because they have no
 * on-chain effect. The last edge for a given merchant wins, matching the
 * contract's single PaymentForwardConfig slot per address.
 */
export function analyzeForwardGraph({
  edges,
  maxDepth = DEFAULT_MAX_FORWARD_DEPTH,
}: ForwardGraphInput): ForwardAnalysis {
  const effectiveDepth = Number.isInteger(maxDepth) && maxDepth > 0
    ? maxDepth
    : DEFAULT_MAX_FORWARD_DEPTH;

  const graph = new Map<string, ForwardEdge>();
  for (const edge of edges) {
    if (edge.active === false) continue;
    const merchant = normalizeAddress(edge.merchant);
    const forwardTo = normalizeAddress(edge.forward_to);
    if (!merchant || !forwardTo) continue;
    graph.set(merchant, { ...edge, merchant, forward_to: forwardTo });
  }

  const issues: ForwardIssue[] = [];
  const cycles: string[][] = [];
  const ttlBreaches: string[][] = [];
  const hopChains: string[][] = [];
  const cycleKeys = new Set<string>();
  const ttlKeys = new Set<string>();
  const highlighted = new Set<string>();

  const merchants = [...graph.keys()].sort();
  for (const merchant of merchants) {
    const edge = graph.get(merchant);
    if (!edge) continue;

    const { path, cycle, ttlBreach } = walkChain(
      merchant,
      edge.forward_to,
      graph,
      effectiveDepth
    );
    if (path.length > 1) hopChains.push(path);

    if (cycle) {
      const key = canonicalCycleKey(cycle);
      if (addUniqueKey(key, cycleKeys)) {
        cycles.push(cycle);
        issues.push({
          kind: "cycle",
          path: cycle,
          message: `Forwarding loop detected: ${cycle.join(" → ")}`,
        });
        for (const address of cycle) highlighted.add(address);
      }
    }

    if (ttlBreach && addUniqueKey(ttlBreach.join("\u0000"), ttlKeys)) {
      ttlBreaches.push(ttlBreach);
      issues.push({
        kind: "ttl-breach",
        path: ttlBreach,
        message: `Forwarding chain exceeds the ${effectiveDepth}-hop limit: ${ttlBreach.join(" → ")}`,
      });
      for (const address of ttlBreach) highlighted.add(address);
    }
  }

  return {
    issues,
    cycles,
    ttlBreaches,
    hasCycle: cycles.length > 0,
    hasTtlBreach: ttlBreaches.length > 0,
    highlightedAddresses: [...highlighted].sort(),
    hopChains,
    isValid: issues.length === 0,
  };
}

/**
 * Convenience wrapper used by the allocation editor to obtain just the
 * address set that must be highlighted/blocked.
 */
export function detectForwardingLoop(
  edges: readonly ForwardEdge[],
  maxDepth?: number
): string[] | null {
  const analysis = analyzeForwardGraph({ edges, maxDepth });
  return analysis.highlightedAddresses.length > 0
    ? analysis.highlightedAddresses
    : null;
}

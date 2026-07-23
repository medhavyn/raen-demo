const STORAGE_KEY = "vq-expected-texts";

export interface ExpectedTextMatch {
  expectedText: string;
  status: "matched" | "missing" | "pending";
  detectedText?: string | null;
  confidence?: number; // Added confidence score
}

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function parseExpectedTexts(input: string): string[] {
  // Split by newlines, commas, or semicolons and trim
  const values = input
    .split(/[\n,;]+/g)
    .map((value) => value.trim())
    .filter(Boolean);

  // Return all values including duplicates - each occurrence is treated as separate
  return values;
}

export function loadExpectedTexts(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function saveExpectedTexts(values: string[]): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
}

export function clearExpectedTexts(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(STORAGE_KEY);
}

/**
 * Calculate similarity between two normalized strings (0 to 1)
 * Based on character-level matching
 */
function calculateSimilarity(str1: string, str2: string): number {
  // Exact match
  if (str1 === str2) {
    return 1.0;
  }

  // If lengths are very different, similarity is low
  const lenDiff = Math.abs(str1.length - str2.length);
  const maxLen = Math.max(str1.length, str2.length);
  
  if (maxLen === 0) {
    return 1.0;
  }

  // Simple character overlap calculation
  let matches = 0;
  const minLen = Math.min(str1.length, str2.length);
  
  for (let i = 0; i < minLen; i++) {
    if (str1[i] === str2[i]) {
      matches++;
    }
  }

  // Calculate similarity: matches / max length
  const similarity = matches / maxLen;
  
  return similarity;
}

interface DetectedCandidate {
  raw: string;
  normalized: string;
}

function buildNormalizedDetected(detectedTexts: string[]): DetectedCandidate[] {
  return detectedTexts
    .flatMap((text) => {
      const words = text.split(/\s+/).filter(Boolean);
      // OCR sometimes merges adjacent labels into one string (e.g. "L/N 26").
      // Treat each whitespace-separated word as its own candidate too, so
      // individual expected values can still match inside a merged blob.
      const entries = words.length > 1 ? [text, ...words] : [text];
      return entries.map((raw) => ({ raw, normalized: normalizeText(raw) }));
    })
    .filter((item) => item.normalized.length > 0);
}

function getConfidence(
  matchMode: "strict" | "moderate" | "lenient",
  normalizedExpected: string,
  normalizedDetected: string,
): number {
  if (matchMode === "strict") {
    // STRICT MODE: Only exact matches (RECOMMENDED)
    return normalizedDetected === normalizedExpected ? 1.0 : 0;
  }

  if (matchMode === "moderate") {
    // MODERATE MODE: Allow 90%+ similarity
    const similarity = calculateSimilarity(normalizedExpected, normalizedDetected);
    return similarity >= 0.9 ? similarity : 0;
  }

  // LENIENT MODE: Substring matching (NOT RECOMMENDED - causes false positives)
  if (
    normalizedDetected === normalizedExpected ||
    normalizedDetected.includes(normalizedExpected) ||
    normalizedExpected.includes(normalizedDetected)
  ) {
    return 0.8;
  }

  return 0;
}

interface CandidatePair {
  expectedIndex: number;
  detectedIndex: number;
  confidence: number;
}

/**
 * Assign each expected value to at most one detected candidate, and each
 * detected candidate to at most one expected value (one-to-one). Without
 * this, duplicate expected values (e.g. two "L/N" entries) could both
 * independently claim the same single detected occurrence and both report
 * as "matched" even though only one was actually detected.
 */
function greedyOneToOneMatch(
  expectedTexts: string[],
  normalizedDetected: DetectedCandidate[],
  matchMode: "strict" | "moderate" | "lenient",
): (CandidatePair | null)[] {
  const normalizedExpectedList = expectedTexts.map(normalizeText);

  const candidates: CandidatePair[] = [];
  normalizedExpectedList.forEach((normalizedExpected, expectedIndex) => {
    normalizedDetected.forEach((detected, detectedIndex) => {
      const confidence = getConfidence(matchMode, normalizedExpected, detected.normalized);
      if (confidence > 0) {
        candidates.push({ expectedIndex, detectedIndex, confidence });
      }
    });
  });

  // Highest confidence first; ties broken by detected index for stable results
  candidates.sort(
    (a, b) => b.confidence - a.confidence || a.detectedIndex - b.detectedIndex
  );

  const usedExpected = new Set<number>();
  const usedDetected = new Set<number>();
  const assignments: (CandidatePair | null)[] = expectedTexts.map(() => null);

  for (const candidate of candidates) {
    if (usedExpected.has(candidate.expectedIndex) || usedDetected.has(candidate.detectedIndex)) {
      continue;
    }
    usedExpected.add(candidate.expectedIndex);
    usedDetected.add(candidate.detectedIndex);
    assignments[candidate.expectedIndex] = candidate;
  }

  return assignments;
}

/**
 * Match with three modes:
 * - "strict": Exact match only (recommended)
 * - "moderate": Allows minor variations (90% match)
 * - "lenient": Allows substring matches (not recommended - causes false positives)
 */
export function matchExpectedTexts(
  expectedTexts: string[],
  detectedTexts: string[],
  active: boolean,
  matchMode: "strict" | "moderate" | "lenient" = "strict",
): ExpectedTextMatch[] {
  if (!expectedTexts.length) {
    return [];
  }

  if (!active) {
    return expectedTexts.map((expectedText) => ({
      expectedText,
      status: "pending" as const,
      detectedText: null,
      confidence: 0,
    }));
  }

  const normalizedDetected = buildNormalizedDetected(detectedTexts);
  const assignments = greedyOneToOneMatch(expectedTexts, normalizedDetected, matchMode);

  return expectedTexts.map((expectedText, index) => {
    const assignment = assignments[index];
    const detected = assignment ? normalizedDetected[assignment.detectedIndex] : null;

    return {
      expectedText,
      status: assignment ? "matched" : "missing",
      detectedText: detected?.raw ?? null,
      confidence: assignment?.confidence ?? 0,
    };
  });
}

/**
 * Alternative matching function with better logging for debugging
 */
export function matchExpectedTextsWithDebug(
  expectedTexts: string[],
  detectedTexts: string[],
  active: boolean,
  matchMode: "strict" | "moderate" | "lenient" = "strict",
): ExpectedTextMatch[] {
  if (!expectedTexts.length) {
    return [];
  }

  if (!active) {
    return expectedTexts.map((expectedText) => ({
      expectedText,
      status: "pending" as const,
      detectedText: null,
      confidence: 0,
    }));
  }

  const normalizedDetected = buildNormalizedDetected(detectedTexts);

  console.log(`[Debug] Matching Mode: ${matchMode}`);
  console.log(`[Debug] Expected texts: ${expectedTexts.length}`);
  console.log(`[Debug] Detected texts: ${detectedTexts.length} (${normalizedDetected.length} candidates after splitting)`);

  const assignments = greedyOneToOneMatch(expectedTexts, normalizedDetected, matchMode);

  return expectedTexts.map((expectedText, index) => {
    const normalizedExpected = normalizeText(expectedText);
    const assignment = assignments[index];
    const detected = assignment ? normalizedDetected[assignment.detectedIndex] : null;

    console.log(`\n[Debug] Matching expected: "${expectedText}" (normalized: "${normalizedExpected}")`);
    if (assignment && detected) {
      console.log(
        `  ✓ MATCHED: "${detected.raw}" (confidence: ${assignment.confidence.toFixed(2)})`
      );
    } else {
      console.log(`  ✗ NOT MATCHED`);
    }

    return {
      expectedText,
      status: assignment ? "matched" : "missing",
      detectedText: detected?.raw ?? null,
      confidence: assignment?.confidence ?? 0,
    };
  });
}
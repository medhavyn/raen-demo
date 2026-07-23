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

  const normalizedDetected = detectedTexts
    .map((text) => ({
      raw: text,
      normalized: normalizeText(text),
    }))
    .filter((item) => item.normalized.length > 0);

  return expectedTexts.map((expectedText) => {
    const normalizedExpected = normalizeText(expectedText);
    
    // Find all potential matches with confidence scores
    const matchResults = normalizedDetected
      .map((detected) => {
        let confidence = 0;

        if (matchMode === "strict") {
          // STRICT MODE: Only exact matches (RECOMMENDED)
          if (detected.normalized === normalizedExpected) {
            confidence = 1.0;
          }
        } else if (matchMode === "moderate") {
          // MODERATE MODE: Allow 90%+ similarity
          confidence = calculateSimilarity(normalizedExpected, detected.normalized);
          // Only consider it a match if similarity is >= 0.9 (90%)
          if (confidence < 0.9) {
            confidence = 0;
          }
        } else if (matchMode === "lenient") {
          // LENIENT MODE: Substring matching (NOT RECOMMENDED - causes false positives)
          if (
            detected.normalized === normalizedExpected ||
            detected.normalized.includes(normalizedExpected) ||
            normalizedExpected.includes(detected.normalized)
          ) {
            confidence = 0.8;
          }
        }

        return {
          detected,
          confidence,
        };
      })
      .filter((result) => result.confidence > 0);

    // Sort by confidence and take best match
    const bestMatch = matchResults.sort(
      (a, b) => b.confidence - a.confidence
    )[0];

    return {
      expectedText,
      status: bestMatch ? "matched" : "missing",
      detectedText: bestMatch?.detected.raw ?? null,
      confidence: bestMatch?.confidence ?? 0,
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

  const normalizedDetected = detectedTexts
    .map((text) => ({
      raw: text,
      normalized: normalizeText(text),
    }))
    .filter((item) => item.normalized.length > 0);

  console.log(`[Debug] Matching Mode: ${matchMode}`);
  console.log(`[Debug] Expected texts: ${expectedTexts.length}`);
  console.log(`[Debug] Detected texts: ${detectedTexts.length}`);

  return expectedTexts.map((expectedText) => {
    const normalizedExpected = normalizeText(expectedText);
    console.log(`\n[Debug] Matching expected: "${expectedText}" (normalized: "${normalizedExpected}")`);

    // Find all potential matches with confidence scores
    const matchResults = normalizedDetected
      .map((detected) => {
        let confidence = 0;

        if (matchMode === "strict") {
          if (detected.normalized === normalizedExpected) {
            confidence = 1.0;
          }
        } else if (matchMode === "moderate") {
          confidence = calculateSimilarity(normalizedExpected, detected.normalized);
          console.log(
            `  - Against "${detected.raw}" (normalized: "${detected.normalized}"): similarity = ${confidence.toFixed(2)}`
          );
          if (confidence < 0.9) {
            confidence = 0;
          }
        } else if (matchMode === "lenient") {
          if (
            detected.normalized === normalizedExpected ||
            detected.normalized.includes(normalizedExpected) ||
            normalizedExpected.includes(detected.normalized)
          ) {
            confidence = 0.8;
          }
        }

        return {
          detected,
          confidence,
        };
      })
      .filter((result) => result.confidence > 0);

    const bestMatch = matchResults.sort(
      (a, b) => b.confidence - a.confidence
    )[0];

    const result: ExpectedTextMatch = {
      expectedText,
      status: bestMatch ? "matched" : "missing",
      detectedText: bestMatch?.detected.raw ?? null,
      confidence: bestMatch?.confidence ?? 0,
    };

    if (bestMatch) {
      console.log(
        `  ✓ MATCHED: "${bestMatch.detected.raw}" (confidence: ${bestMatch.confidence.toFixed(2)})`
      );
    } else {
      console.log(`  ✗ NOT MATCHED`);
    }

    return result;
  });
}
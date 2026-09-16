/*
 * PTLife Dynamic Data Discovery — Diagnostic v1
 *
 * Purpose:
 *   Investigate JavaScript-driven pages whose useful content is not
 *   present in the initially fetched HTML.
 *
 * Example:
 *   /api/discover?url=https://www.imax.com/theatre/cinema-nos-colombo-imax
 *
 * IMPORTANT:
 *   This is a diagnostic tool. It does not alter the Version 3 extractor.
 */

const KEYWORDS = [
  "showtime",
  "showtimes",
  "screening",
  "screenings",
  "session",
  "sessions",
  "schedule",
  "movie",
  "movies",
  "film",
  "films",
  "cinema",
  "theatre",
  "theater",
  "graphql",
  "/api/",
  "fetch(",
  "axios",
];

const MAX_SCRIPTS = 40;
const MAX_SCRIPT_BYTES = 2_000_000;
const MAX_SNIPPETS_PER_SCRIPT = 20;
const MAX_TOTAL_SNIPPETS = 150;
const SNIPPET_RADIUS = 180;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function extractScriptSources(html, baseUrl) {
  const results = [];
  const seen = new Set();

  const regex =
    /<script\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi;

  let match;

  while ((match = regex.exec(html)) !== null) {
    const raw = decodeHtml(match[1] || match[2] || match[3] || "");

    if (!raw) continue;

    try {
      const absolute = new URL(raw, baseUrl).href;

      if (!seen.has(absolute)) {
        seen.add(absolute);
        results.push(absolute);
      }
    } catch {
      // Ignore malformed script URLs.
    }
  }

  return results;
}

function extractAbsoluteUrls(text) {
  const urls = new Set();

  /*
   * We deliberately collect candidates rather than claiming these
   * are API endpoints. JS bundles contain many unrelated URLs.
   */
  const regex = /https?:\\?\/\\?\/[^\s"'`<>\\)\\]]+/gi;

  let match;

  while ((match = regex.exec(text)) !== null) {
    let candidate = match[0]
      .replace(/\\\//g, "/")
      .replace(/[;,}]+$/, "");

    try {
      const url = new URL(candidate);
      urls.add(url.href);
    } catch {
      // Ignore strings that only resemble URLs.
    }
  }

  return [...urls];
}

function extractApiLikePaths(text) {
  const paths = new Set();

  const patterns = [
    /["'`](\/api\/[^"'`\s\\]{1,300})["'`]/gi,
    /["'`](\/graphql[^"'`\s\\]{0,300})["'`]/gi,
    /["'`]([^"'`\s\\]{0,100}showtimes?[^"'`\s\\]{0,200})["'`]/gi,
    /["'`]([^"'`\s\\]{0,100}sessions?[^"'`\s\\]{0,200})["'`]/gi,
  ];

  for (const regex of patterns) {
    let match;

    while ((match = regex.exec(text)) !== null) {
      const value = normalizeWhitespace(match[1]);

      if (value && value.length <= 350) {
        paths.add(value);
      }
    }
  }

  return [...paths];
}

function findKeywordSnippets(text, scriptUrl) {
  const lower = text.toLowerCase();
  const snippets = [];
  const seen = new Set();

  for (const keyword of KEYWORDS) {
    const needle = keyword.toLowerCase();
    let position = 0;

    while (position < lower.length) {
      const index = lower.indexOf(needle, position);

      if (index === -1) break;

      const start = Math.max(0, index - SNIPPET_RADIUS);
      const end = Math.min(
        text.length,
        index + needle.length + SNIPPET_RADIUS
      );

      const snippet = normalizeWhitespace(text.slice(start, end));

      /*
       * Minified bundles frequently repeat the same fragment.
       */
      const signature = `${keyword}:${snippet}`;

      if (!seen.has(signature)) {
        seen.add(signature);

        snippets.push({
          keyword,
          script_url: scriptUrl,
          snippet,
        });
      }

      if (snippets.length >= MAX_SNIPPETS_PER_SCRIPT) {
        return snippets;
      }

      position = index + needle.length;
    }
  }

  return snippets;
}

function scoreCandidate(value) {
  const lower = String(value || "").toLowerCase();

  let score = 0;

  if (lower.includes("showtime")) score += 10;
  if (lower.includes("screening")) score += 8;
  if (lower.includes("session")) score += 7;
  if (lower.includes("schedule")) score += 6;
  if (lower.includes("movie")) score += 5;
  if (lower.includes("film")) score += 4;
  if (lower.includes("theatre")) score += 4;
  if (lower.includes("theater")) score += 4;
  if (lower.includes("cinema")) score += 4;
  if (lower.includes("graphql")) score += 10;
  if (lower.includes("/api/")) score += 10;

  return score;
}

function uniqueRanked(values, limit = 100) {
  const map = new Map();

  for (const value of values) {
    const clean = normalizeWhitespace(value);

    if (!clean) continue;

    if (!map.has(clean)) {
      map.set(clean, {
        value: clean,
        score: scoreCandidate(clean),
      });
    }
  }

  return [...map.values()]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.value.localeCompare(b.value);
    })
    .slice(0, limit);
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; PTLifeBot/0.1; +https://ptlife.pt)",
      accept:
        options.accept ||
        "text/html,application/xhtml+xml,application/javascript,text/javascript,*/*;q=0.8",
    },
  });

  const contentType = response.headers.get("content-type") || "";
  const contentLength =
    Number(response.headers.get("content-length")) || null;

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      final_url: response.url || url,
      content_type: contentType,
      content_length: contentLength,
      text: "",
      truncated: false,
    };
  }

  const text = await response.text();

  let resultText = text;
  let truncated = false;

  if (resultText.length > MAX_SCRIPT_BYTES) {
    resultText = resultText.slice(0, MAX_SCRIPT_BYTES);
    truncated = true;
  }

  return {
    ok: true,
    status: response.status,
    final_url: response.url || url,
    content_type: contentType,
    content_length: contentLength,
    text: resultText,
    truncated,
  };
}

export async function onRequestGet(context) {
  const requestUrl = new URL(context.request.url);
  const target = requestUrl.searchParams.get("url");

  if (!target) {
    return jsonResponse(
      {
        ok: false,
        error: "Missing ?url=",
        example:
          "/api/discover?url=https://www.imax.com/theatre/cinema-nos-colombo-imax",
      },
      400
    );
  }

  let targetUrl;

  try {
    targetUrl = new URL(target);
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Invalid URL",
      },
      400
    );
  }

  if (!["http:", "https:"].includes(targetUrl.protocol)) {
    return jsonResponse(
      {
        ok: false,
        error: "Only HTTP and HTTPS URLs are supported.",
      },
      400
    );
  }

  /*
   * STEP 1 — Fetch the ordinary page.
   */
  let page;

  try {
    page = await fetchText(targetUrl.href, {
      accept: "text/html,application/xhtml+xml,*/*;q=0.8",
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        source_url: targetUrl.href,
        stage: "page_fetch",
        error: String(error?.message || error),
      },
      502
    );
  }

  if (!page.ok) {
    return jsonResponse(
      {
        ok: false,
        source_url: targetUrl.href,
        stage: "page_fetch",
        http_status: page.status,
        final_url: page.final_url,
        content_type: page.content_type,
      },
      page.status
    );
  }

  /*
   * STEP 2 — Find external JavaScript files.
   */
  const scriptUrls = extractScriptSources(page.text, page.final_url);
  const scriptsToInspect = scriptUrls.slice(0, MAX_SCRIPTS);

  const scriptResults = [];
  const allAbsoluteUrls = [];
  const allApiPaths = [];
  const allSnippets = [];

  /*
   * STEP 3 — Fetch each bundle and inspect its raw text.
   *
   * Sequential fetching is intentional for this first diagnostic version.
   * It is gentler on both Cloudflare and the target site and makes failures
   * easier to understand.
   */
  for (const scriptUrl of scriptsToInspect) {
    let script;

    try {
      script = await fetchText(scriptUrl, {
        accept:
          "application/javascript,text/javascript,*/*;q=0.8",
      });
    } catch (error) {
      scriptResults.push({
        url: scriptUrl,
        ok: false,
        error: String(error?.message || error),
      });

      continue;
    }

    if (!script.ok) {
      scriptResults.push({
        url: scriptUrl,
        ok: false,
        http_status: script.status,
        content_type: script.content_type,
      });

      continue;
    }

    const urls = extractAbsoluteUrls(script.text);
    const apiPaths = extractApiLikePaths(script.text);
    const snippets = findKeywordSnippets(script.text, scriptUrl);

    allAbsoluteUrls.push(...urls);
    allApiPaths.push(...apiPaths);

    for (const snippet of snippets) {
      if (allSnippets.length < MAX_TOTAL_SNIPPETS) {
        allSnippets.push(snippet);
      }
    }

    scriptResults.push({
      url: scriptUrl,
      ok: true,
      http_status: script.status,
      content_type: script.content_type,
      bytes_inspected: script.text.length,
      truncated: script.truncated,
      absolute_urls_found: urls.length,
      api_like_paths_found: apiPaths.length,
      keyword_snippets_found: snippets.length,
    });
  }

  /*
   * STEP 4 — Rank candidate strings.
   *
   * These are clues, NOT yet confirmed endpoints.
   */
  const rankedUrls = uniqueRanked(allAbsoluteUrls, 100);
  const rankedPaths = uniqueRanked(allApiPaths, 100);

  const rankedSnippets = allSnippets
    .map((item) => ({
      ...item,
      score: scoreCandidate(
        `${item.keyword} ${item.snippet}`
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_TOTAL_SNIPPETS);

  return jsonResponse({
    ok: true,
    fetched_at: new Date().toISOString(),

    source_url: targetUrl.href,
    final_url: page.final_url,

    page: {
      http_status: page.status,
      content_type: page.content_type,
      bytes_received: page.text.length,
    },

    discovery: {
      scripts_found: scriptUrls.length,
      scripts_inspected: scriptsToInspect.length,
      scripts_skipped_due_to_limit: Math.max(
        0,
        scriptUrls.length - scriptsToInspect.length
      ),

      script_urls: scriptUrls,

      scripts: scriptResults,

      candidate_absolute_urls: rankedUrls,
      candidate_api_paths: rankedPaths,

      keyword_snippets: rankedSnippets,
    },

    notes: [
      "Candidate URLs and paths are diagnostic clues, not confirmed APIs.",
      "A JavaScript bundle may contain unrelated URLs from analytics, advertising, fonts, images, or other application features.",
      "The next step is to inspect promising high-scoring candidates before adding automatic API fetching.",
      "The Version 3 extractor has not been modified.",
    ],
  });
}

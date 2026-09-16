/*
 * PTLife Dynamic Data Discovery — Diagnostic v2
 *
 * Purpose:
 *   Investigate JavaScript-driven pages whose useful content is not
 *   present in the initially fetched HTML.
 *
 * Normal example:
 *   /api/discover?url=https://www.imax.com/theatre/cinema-nos-colombo-imax
 *
 * Focused example:
 *   /api/discover?url=https://www.imax.com/theatre/cinema-nos-colombo-imax&focus=api25.imax.com
 *
 * IMPORTANT:
 *   This is a diagnostic tool.
 *   It does NOT alter the Version 3 extractor.
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

/*
 * Focus mode gives us a much larger piece of JavaScript around
 * a particular search term.
 */
const FOCUS_RADIUS = 2000;
const MAX_FOCUSED_SNIPPETS_PER_SCRIPT = 20;
const MAX_TOTAL_FOCUSED_SNIPPETS = 100;

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

/*
 * Extract every external <script src="..."> from the HTML.
 */
function extractScriptSources(html, baseUrl) {
  const results = [];
  const seen = new Set();

  const regex =
    /<script\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi;

  let match;

  while ((match = regex.exec(html)) !== null) {
    const raw = decodeHtml(
      match[1] || match[2] || match[3] || ""
    );

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

/*
 * Extract strings that look like absolute HTTP/HTTPS URLs.
 *
 * These are only candidates. A JavaScript bundle can contain
 * analytics, fonts, images, advertising URLs, etc.
 */
function extractAbsoluteUrls(text) {
  const urls = new Set();

  const regex =
    /https?:\\?\/\\?\/[^\s"'`<>\\)\\]]+/gi;

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

/*
 * Look for strings that resemble API paths or showtime-related
 * application paths.
 */
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

/*
 * General diagnostic snippets.
 *
 * These are deliberately short because normal discovery can produce
 * many matches.
 */
function findKeywordSnippets(text, scriptUrl) {
  const lower = text.toLowerCase();
  const snippets = [];
  const seen = new Set();

  for (const keyword of KEYWORDS) {
    const needle = keyword.toLowerCase();
    let position = 0;

    while (position < lower.length) {
      const index = lower.indexOf(
        needle,
        position
      );

      if (index === -1) break;

      const start = Math.max(
        0,
        index - SNIPPET_RADIUS
      );

      const end = Math.min(
        text.length,
        index + needle.length + SNIPPET_RADIUS
      );

      const snippet = normalizeWhitespace(
        text.slice(start, end)
      );

      /*
       * Minified bundles frequently repeat identical fragments.
       */
      const signature =
        `${keyword}:${snippet}`;

      if (!seen.has(signature)) {
        seen.add(signature);

        snippets.push({
          keyword,
          script_url: scriptUrl,
          snippet,
        });
      }

      if (
        snippets.length >=
        MAX_SNIPPETS_PER_SCRIPT
      ) {
        return snippets;
      }

      position = index + needle.length;
    }
  }

  return snippets;
}

/*
 * FOCUSED DISCOVERY
 *
 * This is the important addition in Diagnostic v2.
 *
 * If the request contains:
 *
 *   &focus=api25.imax.com
 *
 * we return a much larger raw piece of JavaScript around every
 * occurrence of that exact string.
 *
 * We deliberately DO NOT normalize whitespace here because keeping
 * the original JavaScript intact makes it easier to understand
 * minified expressions, function calls, URL construction, etc.
 */
function findFocusedSnippets(
  text,
  searchTerm,
  scriptUrl,
  radius = FOCUS_RADIUS
) {
  if (!searchTerm) return [];

  const lower = text.toLowerCase();
  const needle = searchTerm.toLowerCase();

  const results = [];
  let position = 0;

  while (
    position < lower.length &&
    results.length <
      MAX_FOCUSED_SNIPPETS_PER_SCRIPT
  ) {
    const index = lower.indexOf(
      needle,
      position
    );

    if (index === -1) break;

    const start = Math.max(
      0,
      index - radius
    );

    const end = Math.min(
      text.length,
      index + needle.length + radius
    );

    results.push({
      search_term: searchTerm,
      script_url: scriptUrl,
      position: index,
      snippet_start: start,
      snippet_end: end,
      snippet: text.slice(start, end),
    });

    position = index + needle.length;
  }

  return results;
}

/*
 * Give likely API/showtime candidates a crude score.
 *
 * This is diagnostic ranking only.
 * A high score does NOT mean that a candidate is a confirmed API.
 */
function scoreCandidate(value) {
  const lower =
    String(value || "").toLowerCase();

  let score = 0;

  if (lower.includes("showtime")) {
    score += 10;
  }

  if (lower.includes("screening")) {
    score += 8;
  }

  if (lower.includes("session")) {
    score += 7;
  }

  if (lower.includes("schedule")) {
    score += 6;
  }

  if (lower.includes("movie")) {
    score += 5;
  }

  if (lower.includes("film")) {
    score += 4;
  }

  if (lower.includes("theatre")) {
    score += 4;
  }

  if (lower.includes("theater")) {
    score += 4;
  }

  if (lower.includes("cinema")) {
    score += 4;
  }

  if (lower.includes("graphql")) {
    score += 10;
  }

  if (lower.includes("/api/")) {
    score += 10;
  }

  return score;
}

function uniqueRanked(values, limit = 100) {
  const map = new Map();

  for (const value of values) {
    const clean =
      normalizeWhitespace(value);

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
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.value.localeCompare(
        b.value
      );
    })
    .slice(0, limit);
}

/*
 * Fetch either the original HTML or one JavaScript bundle.
 */
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

  const contentType =
    response.headers.get("content-type") || "";

  const contentLength =
    Number(
      response.headers.get(
        "content-length"
      )
    ) || null;

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

  if (
    resultText.length >
    MAX_SCRIPT_BYTES
  ) {
    resultText = resultText.slice(
      0,
      MAX_SCRIPT_BYTES
    );

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
  const requestUrl =
    new URL(context.request.url);

  const target =
    requestUrl.searchParams.get("url");

  /*
   * NEW IN V2:
   *
   * Optional focused search term.
   *
   * Example:
   *   &focus=api25.imax.com
   */
  const focus =
    requestUrl.searchParams.get("focus");

  if (!target) {
    return jsonResponse(
      {
        ok: false,
        error: "Missing ?url=",

        examples: {
          normal:
            "/api/discover?url=https://www.imax.com/theatre/cinema-nos-colombo-imax",

          focused:
            "/api/discover?url=https://www.imax.com/theatre/cinema-nos-colombo-imax&focus=api25.imax.com",
        },
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

  if (
    !["http:", "https:"].includes(
      targetUrl.protocol
    )
  ) {
    return jsonResponse(
      {
        ok: false,
        error:
          "Only HTTP and HTTPS URLs are supported.",
      },
      400
    );
  }

  /*
   * STEP 1
   *
   * Fetch the ordinary page.
   */
  let page;

  try {
    page = await fetchText(
      targetUrl.href,
      {
        accept:
          "text/html,application/xhtml+xml,*/*;q=0.8",
      }
    );
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        source_url: targetUrl.href,
        stage: "page_fetch",
        error: String(
          error?.message || error
        ),
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
        content_type:
          page.content_type,
      },
      page.status
    );
  }

  /*
   * STEP 2
   *
   * Find external JavaScript files.
   */
  const scriptUrls =
    extractScriptSources(
      page.text,
      page.final_url
    );

  const scriptsToInspect =
    scriptUrls.slice(0, MAX_SCRIPTS);

  const scriptResults = [];

  const allAbsoluteUrls = [];
  const allApiPaths = [];
  const allSnippets = [];

  /*
   * NEW:
   * Larger source windows around the requested
   * focus term.
   */
  const focusedSnippets = [];

  /*
   * STEP 3
   *
   * Fetch each JavaScript bundle and inspect
   * its raw source.
   *
   * Sequential fetching is intentional for this
   * diagnostic version. It is easier to understand
   * and gentler on the target website.
   */
  for (const scriptUrl of scriptsToInspect) {
    let script;

    try {
      script = await fetchText(
        scriptUrl,
        {
          accept:
            "application/javascript,text/javascript,*/*;q=0.8",
        }
      );
    } catch (error) {
      scriptResults.push({
        url: scriptUrl,
        ok: false,
        error: String(
          error?.message || error
        ),
      });

      continue;
    }

    if (!script.ok) {
      scriptResults.push({
        url: scriptUrl,
        ok: false,
        http_status: script.status,
        content_type:
          script.content_type,
      });

      continue;
    }

    const urls =
      extractAbsoluteUrls(script.text);

    const apiPaths =
      extractApiLikePaths(script.text);

    const snippets =
      findKeywordSnippets(
        script.text,
        scriptUrl
      );

    /*
     * NEW:
     * Perform the large-window focused search.
     */
    let thisScriptFocused = [];

    if (focus) {
      thisScriptFocused =
        findFocusedSnippets(
          script.text,
          focus,
          scriptUrl,
          FOCUS_RADIUS
        );

      for (
        const item of thisScriptFocused
      ) {
        if (
          focusedSnippets.length <
          MAX_TOTAL_FOCUSED_SNIPPETS
        ) {
          focusedSnippets.push(item);
        }
      }
    }

    allAbsoluteUrls.push(...urls);
    allApiPaths.push(...apiPaths);

    for (const snippet of snippets) {
      if (
        allSnippets.length <
        MAX_TOTAL_SNIPPETS
      ) {
        allSnippets.push(snippet);
      }
    }

    scriptResults.push({
      url: scriptUrl,
      ok: true,
      http_status: script.status,
      content_type:
        script.content_type,
      bytes_inspected:
        script.text.length,
      truncated:
        script.truncated,
      absolute_urls_found:
        urls.length,
      api_like_paths_found:
        apiPaths.length,
      keyword_snippets_found:
        snippets.length,

      /*
       * NEW:
       * Lets us immediately see which bundle
       * contained our focused search term.
       */
      focused_matches_found:
        thisScriptFocused.length,
    });
  }

  /*
   * STEP 4
   *
   * Rank candidate strings.
   *
   * These remain clues, NOT confirmed endpoints.
   */
  const rankedUrls =
    uniqueRanked(
      allAbsoluteUrls,
      100
    );

  const rankedPaths =
    uniqueRanked(
      allApiPaths,
      100
    );

  const rankedSnippets =
    allSnippets
      .map((item) => ({
        ...item,

        score: scoreCandidate(
          `${item.keyword} ${item.snippet}`
        ),
      }))
      .sort(
        (a, b) =>
          b.score - a.score
      )
      .slice(
        0,
        MAX_TOTAL_SNIPPETS
      );

  /*
   * STEP 5
   *
   * Return diagnostic information.
   */
  return jsonResponse({
    ok: true,

    fetched_at:
      new Date().toISOString(),

    source_url:
      targetUrl.href,

    final_url:
      page.final_url,

    page: {
      http_status:
        page.status,

      content_type:
        page.content_type,

      bytes_received:
        page.text.length,
    },

    discovery: {
      /*
       * NEW:
       * Echo the requested focus term.
       */
      focus:
        focus || null,

      focus_radius:
        focus
          ? FOCUS_RADIUS
          : null,

      focused_matches_found:
        focusedSnippets.length,

      /*
       * Most important output for our next
       * IMAX experiment.
       */
      focused_snippets:
        focusedSnippets,

      scripts_found:
        scriptUrls.length,

      scripts_inspected:
        scriptsToInspect.length,

      scripts_skipped_due_to_limit:
        Math.max(
          0,
          scriptUrls.length -
            scriptsToInspect.length
        ),

      script_urls:
        scriptUrls,

      scripts:
        scriptResults,

      candidate_absolute_urls:
        rankedUrls,

      candidate_api_paths:
        rankedPaths,

      keyword_snippets:
        rankedSnippets,
    },

    notes: [
      "Candidate URLs and paths are diagnostic clues, not confirmed APIs.",

      "A JavaScript bundle may contain unrelated URLs from analytics, advertising, fonts, images, or other application features.",

      "If focus= is supplied, focused_snippets contains approximately 2,000 characters before and after each matching string.",

      "Focused snippets preserve the original JavaScript rather than normalizing whitespace.",

      "The Version 3 extractor has not been modified.",

      "The next step is to inspect the focused IMAX source before attempting to call any discovered endpoint.",
    ],
  });
}

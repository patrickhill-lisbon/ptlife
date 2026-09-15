function decodeHtml(text) {
  if (!text) return text;

  return text
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&")
    .replace(/&#8217;/g, "’")
    .replace(/&#8216;/g, "‘")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export async function onRequestGet() {
  const sourceUrl = "https://www.ccb.pt/eventos/list/";

  try {
    const response = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "WorthAGo/1.0"
      }
    });

    if (!response.ok) {
      return Response.json({
        ok: false,
        http_status: response.status,
        source_url: sourceUrl,
        links_found: 0,
        links: []
      });
    }

    const html = await response.text();

    /*
     * Find CCB event URLs.
     *
     * Examples:
     * /evento/woyzeck/2026-09-25/
     * /en/evento/woyzeck/2026-09-25/
     */
    const regex =
      /href=["']([^"']*\/(?:en\/)?evento\/[^"'?#]+)["']/gi;

    const found = new Map();

    let match;

    while ((match = regex.exec(html)) !== null) {
      try {
        const url = new URL(
          decodeHtml(match[1]),
          sourceUrl
        );

        // Remove query strings and fragments.
        url.search = "";
        url.hash = "";

        // Normalize trailing slash.
        let normalized = url.toString();

        if (!normalized.endsWith("/")) {
          normalized += "/";
        }

        if (!found.has(normalized)) {
          /*
           * Extract some useful information from the URL
           * without assuming it is authoritative.
           */
          const parts = url.pathname
            .split("/")
            .filter(Boolean);

          const eventoIndex = parts.indexOf("evento");

          const slug =
            eventoIndex >= 0
              ? parts[eventoIndex + 1] ?? null
              : null;

          const possibleDate =
            eventoIndex >= 0
              ? parts[eventoIndex + 2] ?? null
              : null;

          const occurrenceDate =
            /^\d{4}-\d{2}-\d{2}$/.test(possibleDate)
              ? possibleDate
              : null;

          found.set(normalized, {
            url: normalized,
            slug,
            occurrence_date: occurrenceDate
          });
        }
      } catch {
        // Ignore malformed links.
      }
    }

    const links = Array.from(found.values());

    return Response.json({
      ok: true,
      http_status: response.status,
      fetched_at: new Date().toISOString(),
      source_url: sourceUrl,
      bytes_received: html.length,
      links_found: links.length,
      links
    });

  } catch (error) {
    return Response.json(
      {
        ok: false,
        source_url: sourceUrl,
        error: error.message
      },
      { status: 500 }
    );
  }
}

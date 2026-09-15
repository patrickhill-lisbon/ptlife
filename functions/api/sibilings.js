export async function onRequestGet(context) {
  const requestUrl = new URL(context.request.url);
  const sourceUrl = requestUrl.searchParams.get("url");

  if (!sourceUrl) {
    return Response.json(
      {
        ok: false,
        error: "Missing url parameter"
      },
      { status: 400 }
    );
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(sourceUrl);

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("Unsupported protocol");
    }
  } catch {
    return Response.json(
      {
        ok: false,
        error: "Invalid URL"
      },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(parsedUrl.toString(), {
      headers: {
        "User-Agent": "WorthAGo/1.0"
      }
    });

    if (!response.ok) {
      return Response.json({
        ok: false,
        http_status: response.status,
        source_url: parsedUrl.toString(),
        sibling_urls_found: 0,
        sibling_urls: []
      });
    }

    const html = await response.text();

    /*
     * Determine the event slug from URLs such as:
     *
     * /evento/woyzeck/2026-09-24/
     * /en/evento/woyzeck/2026-09-24/
     */

    const pathParts = parsedUrl.pathname
      .split("/")
      .filter(Boolean);

    const eventoIndex = pathParts.indexOf("evento");

    if (eventoIndex < 0 || !pathParts[eventoIndex + 1]) {
      return Response.json({
        ok: false,
        http_status: response.status,
        source_url: parsedUrl.toString(),
        error: "Could not determine event slug"
      });
    }

    const slug = pathParts[eventoIndex + 1];

    /*
     * Look through every href in the page.
     */
    const hrefRegex = /href=["']([^"']+)["']/gi;

    const found = new Map();

    let match;

    while ((match = hrefRegex.exec(html)) !== null) {
      try {
        const candidate = new URL(
          match[1].replace(/&amp;/g, "&"),
          parsedUrl
        );

        /*
         * We only care about links on CCB's domain.
         */
        if (candidate.hostname !== parsedUrl.hostname) {
          continue;
        }

        const candidateParts = candidate.pathname
          .split("/")
          .filter(Boolean);

        const candidateEventoIndex =
          candidateParts.indexOf("evento");

        if (candidateEventoIndex < 0) {
          continue;
        }

        const candidateSlug =
          candidateParts[candidateEventoIndex + 1];

        if (candidateSlug !== slug) {
          continue;
        }

        const possibleDate =
          candidateParts[candidateEventoIndex + 2] ?? null;

        const occurrenceDate =
          /^\d{4}-\d{2}-\d{2}$/.test(possibleDate)
            ? possibleDate
            : null;

        candidate.search = "";
        candidate.hash = "";

        let normalized = candidate.toString();

        if (!normalized.endsWith("/")) {
          normalized += "/";
        }

        if (!found.has(normalized)) {
          found.set(normalized, {
            url: normalized,
            occurrence_date: occurrenceDate
          });
        }

      } catch {
        // Ignore malformed URLs.
      }
    }

    /*
     * Make the output easier to inspect.
     */
    const siblingUrls = Array
      .from(found.values())
      .sort((a, b) => {
        const dateA = a.occurrence_date ?? "";
        const dateB = b.occurrence_date ?? "";

        return dateA.localeCompare(dateB);
      });

    return Response.json({
      ok: true,
      http_status: response.status,
      fetched_at: new Date().toISOString(),
      source_url: parsedUrl.toString(),
      slug,
      bytes_received: html.length,
      sibling_urls_found: siblingUrls.length,
      sibling_urls: siblingUrls
    });

  } catch (error) {
    return Response.json(
      {
        ok: false,
        source_url: parsedUrl?.toString() ?? sourceUrl,
        error: error.message
      },
      { status: 500 }
    );
  }
}

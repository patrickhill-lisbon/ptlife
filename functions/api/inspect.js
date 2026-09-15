export async function onRequestGet(context) {
  const requestUrl = new URL(context.request.url);
  const sourceUrl = requestUrl.searchParams.get("url");

  if (!sourceUrl) {
    return Response.json(
      { ok: false, error: "Missing url parameter" },
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
      { ok: false, error: "Invalid URL" },
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
        source_url: parsedUrl.toString()
      });
    }

    const html = await response.text();

    const searches = [
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
      "24 September",
      "25 September",
      "26 September",
      "27 September",
      "24 setembro",
      "25 setembro",
      "26 setembro",
      "27 setembro"
    ];

    const results = {};

    for (const search of searches) {
      const lowerHtml = html.toLowerCase();
      const lowerSearch = search.toLowerCase();

      const positions = [];
      let start = 0;

      while (true) {
        const index = lowerHtml.indexOf(lowerSearch, start);

        if (index === -1) break;

        positions.push(index);
        start = index + lowerSearch.length;

        if (positions.length >= 20) break;
      }

      results[search] = {
        found: positions.length > 0,
        occurrences: positions.length,
        samples: positions.slice(0, 5).map(index => {
          const before = Math.max(0, index - 250);
          const after = Math.min(
            html.length,
            index + search.length + 250
          );

          return html
            .slice(before, after)
            .replace(/\s+/g, " ")
            .trim();
        })
      };
    }

    return Response.json({
      ok: true,
      http_status: response.status,
      fetched_at: new Date().toISOString(),
      source_url: parsedUrl.toString(),
      bytes_received: html.length,
      results
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

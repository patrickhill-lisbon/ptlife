function findEvents(value, found = []) {
  if (!value || typeof value !== "object") return found;

  if (Array.isArray(value)) {
    for (const item of value) findEvents(item, found);
    return found;
  }

  const type = value["@type"];

  if (
    type === "Event" ||
    (Array.isArray(type) && type.includes("Event"))
  ) {
    found.push(value);
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      findEvents(child, found);
    }
  }

  return found;
}

export async function onRequestGet(context) {
  const requestUrl = new URL(context.request.url);
  const sourceUrl = requestUrl.searchParams.get("url");

  if (!sourceUrl) {
    return Response.json(
      {
        ok: false,
        error: "Missing url parameter",
        example: "/api/verify?url=https://example.com/event"
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

    const html = await response.text();

    const regex =
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

    const jsonLd = [];
    let match;

    while ((match = regex.exec(html)) !== null) {
      try {
        jsonLd.push(JSON.parse(match[1].trim()));
      } catch {
        // Ignore malformed JSON-LD.
      }
    }

    const events = [];

    for (const block of jsonLd) {
      findEvents(block, events);
    }

    const normalized = events.map(event => ({
      name: event.name ?? null,
      description: event.description ?? null,

      start_at: event.startDate ?? null,
      end_at: event.endDate ?? null,

      event_status: event.eventStatus ?? null,

      venue: event.location?.name ?? null,

      address: {
        street: event.location?.address?.streetAddress ?? null,
        locality: event.location?.address?.addressLocality ?? null,
        region: event.location?.address?.addressRegion ?? null,
        postal_code: event.location?.address?.postalCode ?? null,
        country: event.location?.address?.addressCountry ?? null
      },

      event_url: event.url ?? null
    }));

    return Response.json({
      ok: response.ok,
      http_status: response.status,
      fetched_at: new Date().toISOString(),
      source_url: parsedUrl.toString(),
      extraction_method: "schema_org_json_ld",
      json_ld_blocks_found: jsonLd.length,
      events_found: normalized.length,
      events: normalized
    });

  } catch (error) {
    return Response.json(
      {
        ok: false,
        source_url: parsedUrl.toString(),
        error: error.message
      },
      { status: 500 }
    );
  }
}

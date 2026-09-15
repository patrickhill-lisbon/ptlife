function findEvents(value, found = []) {
  if (!value || typeof value !== "object") return found;

  if (Array.isArray(value)) {
    for (const item of value) {
      findEvents(item, found);
    }
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

export async function onRequestGet() {
  const url =
    "https://www.ccb.pt/en/evento/the-dog-days-are-over-2-0/2026-09-20/";

  try {
    const response = await fetch(url, {
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
        // Ignore malformed JSON-LD blocks.
      }
    }

    const events = [];

    for (const block of jsonLd) {
      findEvents(block, events);
    }

    const normalized = events.map(event => ({
      name: event.name ?? null,
      start_at: event.startDate ?? null,
      end_at: event.endDate ?? null,

      venue: event.location?.name ?? null,

      address: {
        street: event.location?.address?.streetAddress ?? null,
        locality: event.location?.address?.addressLocality ?? null,
        region: event.location?.address?.addressRegion ?? null,
        postal_code: event.location?.address?.postalCode ?? null,
        country: event.location?.address?.addressCountry ?? null
      },

      source_url: event.url ?? url
    }));

    return Response.json({
      ok: response.ok,
      http_status: response.status,
      fetched_at: new Date().toISOString(),
      source_url: url,
      extraction_method: "schema_org_json_ld",
      events_found: normalized.length,
      events: normalized
    });

  } catch (error) {
    return Response.json(
      {
        ok: false,
        source_url: url,
        error: error.message
      },
      { status: 500 }
    );
  }
}

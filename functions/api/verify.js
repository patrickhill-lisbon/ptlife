const EVENT_TYPES = new Set([
  "Event",
  "BusinessEvent",
  "ChildrensEvent",
  "ComedyEvent",
  "CourseInstance",
  "DanceEvent",
  "DeliveryEvent",
  "EducationEvent",
  "EventSeries",
  "ExhibitionEvent",
  "Festival",
  "FoodEvent",
  "Hackathon",
  "LiteraryEvent",
  "MusicEvent",
  "PublicationEvent",
  "SaleEvent",
  "ScreeningEvent",
  "SocialEvent",
  "SportsEvent",
  "TheaterEvent",
  "VisualArtsEvent"
]);

function isEventType(type) {
  if (typeof type === "string") {
    return EVENT_TYPES.has(type);
  }

  if (Array.isArray(type)) {
    return type.some(t => EVENT_TYPES.has(t));
  }

  return false;
}

function findEvents(value, found = []) {
  if (!value || typeof value !== "object") return found;

  if (Array.isArray(value)) {
    for (const item of value) {
      findEvents(item, found);
    }
    return found;
  }

  if (isEventType(value["@type"])) {
    found.push(value);
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      findEvents(child, found);
    }
  }

  return found;
}

function getType(event) {
  const type = event["@type"];

  if (Array.isArray(type)) {
    return type.join(", ");
  }

  return type ?? null;
}

function getVenue(location) {
  if (!location) return null;

  if (Array.isArray(location)) {
    return location[0]?.name ?? null;
  }

  return location.name ?? null;
}

function getAddress(location) {
  if (!location) return null;

  const loc = Array.isArray(location) ? location[0] : location;
  const address = loc?.address;

  if (!address || typeof address !== "object") {
    return null;
  }

  return {
    street: address.streetAddress ?? null,
    locality: address.addressLocality ?? null,
    region: address.addressRegion ?? null,
    postal_code: address.postalCode ?? null,
    country: address.addressCountry ?? null
  };
}

function names(value) {
  if (!value) return [];

  const values = Array.isArray(value) ? value : [value];

  return values
    .map(item => {
      if (typeof item === "string") return item;
      return item?.name ?? null;
    })
    .filter(Boolean);
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

    if (!response.ok) {
      return Response.json({
        ok: false,
        http_status: response.status,
        fetched_at: new Date().toISOString(),
        source_url: parsedUrl.toString(),
        fetch_status:
          response.status === 403 ? "blocked" : "http_error",
        extraction_method: null,
        events_found: 0,
        events: []
      });
    }

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
      schema_type: getType(event),

      name: event.name ?? null,
      description: event.description ?? null,

      start_at: event.startDate ?? null,
      end_at: event.endDate ?? null,

      event_status: event.eventStatus ?? null,

      venue: getVenue(event.location),
      address: getAddress(event.location),

      organizer: names(event.organizer),
      performers: names(event.performer),
      sponsors: names(event.sponsor),
      composers: names(event.composer),

      age_range: event.typicalAgeRange ?? null,
      keywords: event.keywords ?? null,

      event_url: event.url ?? parsedUrl.toString()
    }));

    return Response.json({
      ok: true,
      http_status: response.status,
      fetched_at: new Date().toISOString(),
      source_url: parsedUrl.toString(),
      extraction_method:
        normalized.length > 0 ? "schema_org_json_ld" : null,
      json_ld_blocks_found: jsonLd.length,
      events_found: normalized.length,
      events: normalized
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

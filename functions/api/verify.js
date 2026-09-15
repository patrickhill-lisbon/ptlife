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

function getType(event) {
  const type = event?.["@type"];

  if (Array.isArray(type)) {
    return type.find(t => EVENT_TYPES.has(t)) ?? type[0] ?? null;
  }

  return type ?? null;
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

function firstLocation(location) {
  if (!location) return null;
  return Array.isArray(location) ? location[0] ?? null : location;
}

function normalizeAddress(location) {
  const loc = firstLocation(location);
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

function normalizeOccurrence(event, fallbackLocation = null) {
  const location = event?.location ?? fallbackLocation;
  const loc = firstLocation(location);

  return {
    start_at: event?.startDate ?? null,
    end_at: event?.endDate ?? null,
    event_status: event?.eventStatus ?? null,
    venue: loc?.name ?? null,
    address: normalizeAddress(location)
  };
}

function occurrenceKey(o) {
  return [
    o.start_at ?? "",
    o.end_at ?? "",
    o.venue ?? ""
  ].join("|");
}

function findTopLevelEvents(value, found = [], insideEvent = false) {
  if (!value || typeof value !== "object") return found;

  if (Array.isArray(value)) {
    for (const item of value) {
      findTopLevelEvents(item, found, insideEvent);
    }
    return found;
  }

  const thisIsEvent = isEventType(value["@type"]);

  if (thisIsEvent && !insideEvent) {
    found.push(value);
    return found;
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      findTopLevelEvents(
        child,
        found,
        insideEvent || thisIsEvent
      );
    }
  }

  return found;
}

function normalizeProgram(event, sourceUrl) {
  const occurrences = [];

  // Parent event may itself represent an occurrence.
  if (event.startDate || event.endDate) {
    occurrences.push(
      normalizeOccurrence(event, event.location)
    );
  }

  // subEvent may contain one or more individual performances.
  const subEvents = event.subEvent
    ? Array.isArray(event.subEvent)
      ? event.subEvent
      : [event.subEvent]
    : [];

  for (const subEvent of subEvents) {
    if (!isEventType(subEvent?.["@type"])) continue;

    occurrences.push(
      normalizeOccurrence(
        subEvent,
        event.location
      )
    );
  }

  // Remove exact duplicate occurrences.
  const uniqueOccurrences = [];
  const seen = new Set();

  for (const occurrence of occurrences) {
    const key = occurrenceKey(occurrence);

    if (!seen.has(key)) {
      seen.add(key);
      uniqueOccurrences.push(occurrence);
    }
  }

  return {
    schema_type: getType(event),

    title: event.name ?? null,
    description: event.description ?? null,

    organizer: names(event.organizer),
    performers: names(event.performer),
    sponsors: names(event.sponsor),
    composers: names(event.composer),

    age_range: event.typicalAgeRange ?? null,
    keywords: event.keywords ?? null,

    event_url: event.url ?? sourceUrl,

    occurrences: uniqueOccurrences
  };
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
        programs_found: 0,
        programs: []
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

    const topLevelEvents = [];

    for (const block of jsonLd) {
      findTopLevelEvents(block, topLevelEvents);
    }

    const programs = topLevelEvents.map(event =>
      normalizeProgram(event, parsedUrl.toString())
    );

    return Response.json({
      ok: true,
      http_status: response.status,
      fetched_at: new Date().toISOString(),
      source_url: parsedUrl.toString(),

      extraction_method:
        programs.length > 0
          ? "schema_org_json_ld"
          : null,

      json_ld_blocks_found: jsonLd.length,
      programs_found: programs.length,
      programs
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

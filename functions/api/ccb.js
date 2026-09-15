const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12
};

function decodeHtml(text) {
  if (!text) return text;

  return text
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&#8216;/gi, "‘")
    .replace(/&#8217;/gi, "’")
    .replace(/&#8220;/gi, "“")
    .replace(/&#8221;/gi, "”")
    .replace(/&#8230;/gi, "…")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCodePoint(Number(n))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16))
    );
}

function stripHtml(text) {
  if (!text) return null;

  return decodeHtml(text)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isEventType(type) {
  if (!type) return false;

  const types = Array.isArray(type) ? type : [type];

  return types.some(t =>
    typeof t === "string" &&
    (
      t === "Event" ||
      t.endsWith("Event") ||
      t === "Festival" ||
      t === "CourseInstance"
    )
  );
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

function firstLocation(location) {
  if (!location) return null;
  return Array.isArray(location)
    ? location[0] ?? null
    : location;
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

function names(value) {
  if (!value) return [];

  const values = Array.isArray(value) ? value : [value];

  return values
    .map(item => {
      if (typeof item === "string") {
        // Ignore generic Schema.org placeholders.
        if (
          item === "Organization" ||
          item === "Person"
        ) {
          return null;
        }

        return decodeHtml(item);
      }

      return item?.name
        ? decodeHtml(item.name)
        : null;
    })
    .filter(Boolean);
}

function pad(number) {
  return String(number).padStart(2, "0");
}

function toLocalDateTime(year, month, day, hour, minute) {
  return (
    `${year}-${pad(month)}-${pad(day)}` +
    `T${pad(hour)}:${pad(minute)}:00`
  );
}

function parseTime(text) {
  const match = text.match(
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i
  );

  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const ampm = match[3].toLowerCase();

  if (ampm === "pm" && hour !== 12) {
    hour += 12;
  }

  if (ampm === "am" && hour === 12) {
    hour = 0;
  }

  return { hour, minute };
}

function parseScheduleLine(dateText, timeText) {
  const cleanDate = stripHtml(dateText);
  const cleanTime = stripHtml(timeText);

  const time = parseTime(cleanTime);

  if (!cleanDate || !time) return [];

  /*
   * Examples:
   *
   * Thursday and Friday, 24 and 25 September 2026
   * Saturday, 26 September 2026
   * Sunday, 27 September 2026
   */

  const monthMatch = cleanDate.match(
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i
  );

  if (!monthMatch) return [];

  const month =
    MONTHS[monthMatch[1].toLowerCase()];

  const year = Number(monthMatch[2]);

  /*
   * Only examine the part before the month name,
   * then collect numeric day values.
   */
  const beforeMonth = cleanDate.slice(
    0,
    monthMatch.index
  );

  const dayMatches =
    [...beforeMonth.matchAll(/\b(\d{1,2})\b/g)];

  const days = dayMatches
    .map(m => Number(m[1]))
    .filter(day => day >= 1 && day <= 31);

  return days.map(day => ({
    start_at: toLocalDateTime(
      year,
      month,
      day,
      time.hour,
      time.minute
    ),
    timezone: "Europe/Lisbon"
  }));
}

function extractCcbSchedule(html) {
  const occurrences = [];

  /*
   * CCB currently renders schedule information roughly as:
   *
   * <strong class="spotlight">
   *   Thursday and Friday, 24 and 25 September 2026
   * </strong>
   * 8:00pm
   *
   * We deliberately restrict ourselves to info__data blocks
   * containing spotlight elements.
   */

  const blockRegex =
    /<p[^>]*class=["'][^"']*info__data[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi;

  let match;

  while ((match = blockRegex.exec(html)) !== null) {
    const block = match[1];

    const strongMatch = block.match(
      /<strong[^>]*class=["'][^"']*spotlight[^"']*["'][^>]*>([\s\S]*?)<\/strong>/i
    );

    if (!strongMatch) continue;

    const dateText = strongMatch[1];

    /*
     * Remove the <strong> portion.
     * What remains should contain the time.
     */
    const remaining = block.replace(
      strongMatch[0],
      " "
    );

    const parsed = parseScheduleLine(
      dateText,
      remaining
    );

    occurrences.push(...parsed);
  }

  return occurrences;
}

function occurrenceKey(o) {
  return `${o.start_at}|${o.timezone}`;
}

function dedupeOccurrences(occurrences) {
  const seen = new Set();
  const result = [];

  for (const occurrence of occurrences) {
    if (!occurrence.start_at) continue;

    const key = occurrenceKey(occurrence);

    if (seen.has(key)) continue;

    seen.add(key);
    result.push(occurrence);
  }

  return result.sort((a, b) =>
    a.start_at.localeCompare(b.start_at)
  );
}

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

    if (
      !["www.ccb.pt", "ccb.pt"].includes(
        parsedUrl.hostname
      )
    ) {
      throw new Error("This extractor is only for ccb.pt");
    }
  } catch {
    return Response.json(
      {
        ok: false,
        error: "Invalid CCB URL"
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
        source_url: parsedUrl.toString()
      });
    }

    const html = await response.text();

    /*
     * STEP 1:
     * Extract JSON-LD.
     */

    const jsonLd = [];

    const jsonRegex =
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

    let match;

    while ((match = jsonRegex.exec(html)) !== null) {
      try {
        jsonLd.push(JSON.parse(match[1].trim()));
      } catch {
        // Ignore malformed JSON-LD.
      }
    }

    const events = [];

    for (const block of jsonLd) {
      findTopLevelEvents(block, events);
    }

    const event = events[0] ?? null;

    if (!event) {
      return Response.json({
        ok: true,
        http_status: response.status,
        source_url: parsedUrl.toString(),
        extraction_method: null,
        error: "No Schema.org event found"
      });
    }

    /*
     * STEP 2:
     * Extract CCB's complete visible schedule.
     */

    let occurrences =
      extractCcbSchedule(html);

    /*
     * Fallback:
     * If the CCB schedule parser finds nothing,
     * preserve the JSON-LD occurrence.
     */

    if (
      occurrences.length === 0 &&
      event.startDate
    ) {
      /*
       * CCB JSON-LD already includes an explicit
       * Lisbon UTC offset. We keep the original value.
       */

      occurrences.push({
        start_at: event.startDate,
        end_at: event.endDate ?? null,
        timezone: "Europe/Lisbon",
        event_status: event.eventStatus ?? null
      });
    }

    occurrences =
      dedupeOccurrences(occurrences);

    const location =
      firstLocation(event.location);

    const program = {
      schema_type:
        Array.isArray(event["@type"])
          ? event["@type"][0] ?? null
          : event["@type"] ?? null,

      title: decodeHtml(event.name ?? null),

      description:
        stripHtml(event.description),

      organizer: names(event.organizer),
      performers: names(event.performer),
      sponsors: names(event.sponsor),

      venue: location?.name
        ? decodeHtml(location.name)
        : null,

      address:
        normalizeAddress(event.location),

      source_url:
        event.url ?? parsedUrl.toString(),

      occurrences
    };

    return Response.json({
      ok: true,
      http_status: response.status,
      fetched_at: new Date().toISOString(),

      requested_url: parsedUrl.toString(),

      extraction_method:
        "schema_org_json_ld+ccb_schedule",

      programs_found: 1,
      program
    });

  } catch (error) {
    return Response.json(
      {
        ok: false,
        source_url:
          parsedUrl?.toString() ?? sourceUrl,
        error: error.message
      },
      { status: 500 }
    );
  }
}

/*
 * Worth A Go — Generic Extractor
 * Version 1
 *
 * PURPOSE
 * -------
 * Extract useful activity/program information from arbitrary
 * public webpages without requiring a scraper for every website.
 *
 * IMPORTANT PRINCIPLES
 * --------------------
 * 1. Generic extraction is the default.
 * 2. Site-specific filters fix anomalies; they do not replace
 *    the generic extractor.
 * 3. Prefer authoritative structured data when available.
 * 4. Visible page content can supplement structured data.
 * 5. Never invent missing information.
 * 6. If the source does not mention an attribute, omit it.
 * 7. This endpoint is READ ONLY. It does not write to D1.
 */

function hostnameFor(url) {
  try {
    return new URL(url).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return null;
  }
}


/*
 * ------------------------------------------------------------
 * SITE PROFILES / ANOMALY FILTERS
 * ------------------------------------------------------------
 *
 * Most websites should NOT appear here.
 *
 * A site is added only when we discover a genuine anomaly
 * that cannot reasonably be handled by the generic parser.
 *
 * For now this is intentionally empty.
 */

const SITE_PROFILES = {
};


/*
 * Find a profile for the current website.
 *
 * Later this can support:
 *
 * "ccb.pt": {
 *   preExtract: normalizeCcb
 * }
 *
 * But only if we actually need it.
 */

function getSiteProfile(url) {
  const hostname = hostnameFor(url);

  if (!hostname) return null;

  return SITE_PROFILES[hostname] ?? null;
}


/*
 * ------------------------------------------------------------
 * HTML UTILITIES
 * ------------------------------------------------------------
 */

function decodeHtml(text) {
  if (!text) return text;

  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    hellip: "…",
    ndash: "–",
    mdash: "—",
    laquo: "«",
    raquo: "»",
    copy: "©",
    reg: "®"
  };

  return text
    .replace(
      /&([a-zA-Z]+);/g,
      (match, name) =>
        Object.prototype.hasOwnProperty.call(
          named,
          name.toLowerCase()
        )
          ? named[name.toLowerCase()]
          : match
    )
    .replace(
      /&#(\d+);/g,
      (_, number) =>
        String.fromCodePoint(Number(number))
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, number) =>
        String.fromCodePoint(
          parseInt(number, 16)
        )
    );
}


function stripTags(text) {
  if (!text) return "";

  return decodeHtml(
    text
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<\/h[1-6]>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


/*
 * Remove content that normally creates noise for event extraction.
 *
 * We deliberately do NOT attempt to produce perfect readable text
 * yet. This is just our first generic cleaning stage.
 */

function cleanHtml(html) {
  return html
    .replace(
      /<script\b[^>]*>[\s\S]*?<\/script>/gi,
      " "
    )
    .replace(
      /<style\b[^>]*>[\s\S]*?<\/style>/gi,
      " "
    )
    .replace(
      /<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,
      " "
    )
    .replace(
      /<!--[\s\S]*?-->/g,
      " "
    );
}


/*
 * ------------------------------------------------------------
 * JSON-LD
 * ------------------------------------------------------------
 */

function extractJsonLd(html) {
  const blocks = [];

  const regex =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match;

  while ((match = regex.exec(html)) !== null) {
    const raw = match[1].trim();

    if (!raw) continue;

    try {
      blocks.push(JSON.parse(raw));
    } catch {
      /*
       * Malformed JSON-LD should never make the
       * entire extraction fail.
       */
    }
  }

  return blocks;
}


/*
 * Schema.org event-like objects.
 *
 * This deliberately accepts Event subtypes such as:
 *
 * Event
 * MusicEvent
 * TheaterEvent
 * DanceEvent
 * ScreeningEvent
 * Festival
 * CourseInstance
 */

function isEventType(type) {
  if (!type) return false;

  const values =
    Array.isArray(type) ? type : [type];

  return values.some(value => {
    if (typeof value !== "string") {
      return false;
    }

    return (
      value === "Event" ||
      value.endsWith("Event") ||
      value === "Festival" ||
      value === "CourseInstance"
    );
  });
}


function findSchemaEvents(
  value,
  found = [],
  insideEvent = false
) {
  if (!value || typeof value !== "object") {
    return found;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      findSchemaEvents(
        item,
        found,
        insideEvent
      );
    }

    return found;
  }

  const thisIsEvent =
    isEventType(value["@type"]);

  if (thisIsEvent && !insideEvent) {
    found.push(value);

    /*
     * Do not automatically add nested subEvents as
     * separate programs. Later reconciliation decides
     * whether they are occurrences.
     */
    return found;
  }

  for (const child of Object.values(value)) {
    if (
      child &&
      typeof child === "object"
    ) {
      findSchemaEvents(
        child,
        found,
        insideEvent || thisIsEvent
      );
    }
  }

  return found;
}


/*
 * ------------------------------------------------------------
 * GENERIC PAGE TITLE
 * ------------------------------------------------------------
 */

function extractH1(html) {
  const match = html.match(
    /<h1\b[^>]*>([\s\S]*?)<\/h1>/i
  );

  if (!match) return null;

  const value = stripTags(match[1]);

  return value || null;
}


function extractTitleTag(html) {
  const match = html.match(
    /<title\b[^>]*>([\s\S]*?)<\/title>/i
  );

  if (!match) return null;

  const value = stripTags(match[1]);

  return value || null;
}


/*
 * ------------------------------------------------------------
 * GENERIC PAGE REPRESENTATION
 * ------------------------------------------------------------
 *
 * This gives later parsers something simpler than 150 KB of
 * raw HTML.
 */

function buildPageText(html) {
  const cleaned = cleanHtml(html);

  return stripTags(cleaned);
}


/*
 * ------------------------------------------------------------
 * STRUCTURED EVENT SUMMARY
 * ------------------------------------------------------------
 *
 * For this first version we extract only enough structured
 * information to inspect what arbitrary sites provide.
 *
 * We will add the generic date/time/price/etc. recognizers
 * after testing this foundation.
 */

function schemaName(value) {
  if (!value) return undefined;

  if (typeof value === "string") {
    return decodeHtml(value);
  }

  if (
    typeof value === "object" &&
    value.name
  ) {
    return decodeHtml(value.name);
  }

  return undefined;
}


function schemaNames(value) {
  if (!value) return undefined;

  const values =
    Array.isArray(value) ? value : [value];

  const result = values
    .map(schemaName)
    .filter(Boolean);

  return result.length
    ? result
    : undefined;
}


function firstLocation(value) {
  if (!value) return undefined;

  return Array.isArray(value)
    ? value[0]
    : value;
}


function summarizeSchemaEvent(event) {
  const result = {};

  if (event["@type"]) {
    result.schema_type =
      event["@type"];
  }

  if (event.name) {
    result.title =
      decodeHtml(event.name);
  }

  if (event.description) {
    result.description =
      stripTags(event.description);
  }

  if (event.startDate) {
    result.start_at =
      event.startDate;
  }

  if (event.endDate) {
    result.end_at =
      event.endDate;
  }

  if (event.duration) {
    result.duration =
      event.duration;
  }

  if (event.eventStatus) {
    result.status =
      event.eventStatus;
  }

  if (event.url) {
    result.event_url =
      event.url;
  }

  const organizer =
    schemaNames(event.organizer);

  if (organizer) {
    result.organizer =
      organizer;
  }

  const performers =
    schemaNames(
      event.performer ??
      event.performers
    );

  if (performers) {
    result.performers =
      performers;
  }

  const location =
    firstLocation(event.location);

  if (location) {
    const place = {};

    const name =
      schemaName(location);

    if (name) {
      place.name = name;
    }

    const address =
      location.address;

    if (
      address &&
      typeof address === "object"
    ) {
      if (address.streetAddress) {
        place.street =
          address.streetAddress;
      }

      if (address.addressLocality) {
        place.locality =
          address.addressLocality;
      }

      if (address.addressRegion) {
        place.region =
          address.addressRegion;
      }

      if (address.postalCode) {
        place.postal_code =
          address.postalCode;
      }

      if (address.addressCountry) {
        place.country =
          address.addressCountry;
      }
    }

    if (Object.keys(place).length) {
      result.place = place;
    }
  }

  return result;
}


/*
 * ------------------------------------------------------------
 * API
 * ------------------------------------------------------------
 */

export async function onRequestGet(context) {
  const requestUrl =
    new URL(context.request.url);

  const sourceUrl =
    requestUrl.searchParams.get("url");

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
      !["http:", "https:"].includes(
        parsedUrl.protocol
      )
    ) {
      throw new Error(
        "Unsupported protocol"
      );
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
    const profile =
      getSiteProfile(
        parsedUrl.toString()
      );

    const response =
      await fetch(
        parsedUrl.toString(),
        {
          headers: {
            "User-Agent":
              "WorthAGo/1.0"
          }
        }
      );

    if (!response.ok) {
      return Response.json({
        ok: false,
        http_status:
          response.status,
        source_url:
          parsedUrl.toString()
      });
    }

    const html =
      await response.text();

    /*
     * Future site profiles can normalize HTML here.
     * Currently no site-specific behavior exists.
     */

    let normalizedHtml = html;

    if (
      profile?.preExtract &&
      typeof profile.preExtract ===
        "function"
    ) {
      normalizedHtml =
        profile.preExtract(html);
    }

    const jsonLd =
      extractJsonLd(
        normalizedHtml
      );

    const schemaEvents = [];

    for (const block of jsonLd) {
      findSchemaEvents(
        block,
        schemaEvents
      );
    }

    const structuredEvents =
      schemaEvents.map(
        summarizeSchemaEvent
      );

    const pageText =
      buildPageText(
        normalizedHtml
      );

    const h1 =
      extractH1(
        normalizedHtml
      );

    const titleTag =
      extractTitleTag(
        normalizedHtml
      );

    return Response.json({
      ok: true,

      http_status:
        response.status,

      fetched_at:
        new Date().toISOString(),

      source_url:
        parsedUrl.toString(),

      hostname:
        hostnameFor(
          parsedUrl.toString()
        ),

      site_profile_applied:
        profile ? true : false,

      bytes_received:
        html.length,

      json_ld_blocks_found:
        jsonLd.length,

      schema_events_found:
        structuredEvents.length,

      page: {
        ...(h1
          ? { h1 }
          : {}),

        ...(titleTag
          ? { title_tag: titleTag }
          : {}),

        text_length:
          pageText.length,

        /*
         * Diagnostic only.
         * Don't return an enormous webpage.
         */
        text_preview:
          pageText.slice(0, 5000)
      },

      structured_events:
        structuredEvents
    });

  } catch (error) {
    return Response.json(
      {
        ok: false,

        source_url:
          parsedUrl?.toString() ??
          sourceUrl,

        error:
          error.message
      },
      { status: 500 }
    );
  }
}

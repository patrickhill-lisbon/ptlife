/*
 * Worth A Go — Generic Extractor
 * Version 2
 *
 * READ ONLY — does not write to D1.
 *
 * PRINCIPLES
 * ----------
 * 1. Generic extraction is the default.
 * 2. Site-specific filters only normalize genuine anomalies.
 * 3. Prefer authoritative structured data when available.
 * 4. Visible content supplements structured data.
 * 5. Preserve semantic context before applying regex parsers.
 * 6. Never invent missing information.
 * 7. If the source does not mention something, omit it.
 */


/*
 * ============================================================
 * URL / SITE PROFILE
 * ============================================================
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
 * Most websites should NOT appear here.
 *
 * Later, genuine anomalies can be handled with something like:
 *
 * const SITE_PROFILES = {
 *   "example.com": {
 *     preExtract: normalizeExample
 *   }
 * };
 *
 * For now this remains deliberately empty.
 */

const SITE_PROFILES = {};


function getSiteProfile(url) {
  const hostname = hostnameFor(url);

  if (!hostname) return null;

  return SITE_PROFILES[hostname] ?? null;
}


/*
 * ============================================================
 * HTML UTILITIES
 * ============================================================
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
      (match, name) => {
        const key = name.toLowerCase();

        return Object.prototype.hasOwnProperty.call(
          named,
          key
        )
          ? named[key]
          : match;
      }
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


function normalizeWhitespace(text) {
  if (!text) return "";

  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\r\n]+/g, " ")
    .trim();
}


function stripTags(text) {
  if (!text) return "";

  return normalizeWhitespace(
    decodeHtml(
      text
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<[^>]+>/g, " ")
    )
  );
}


/*
 * Remove elements that generally contain no useful event data.
 *
 * IMPORTANT:
 * We are deliberately conservative here.
 *
 * We do NOT yet remove <header>, <nav>, <footer>, etc.
 * because some badly structured sites may place useful content
 * inside them.
 */

function removeNonContentHtml(html) {
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
      /<svg\b[^>]*>[\s\S]*?<\/svg>/gi,
      " "
    )
    .replace(
      /<!--[\s\S]*?-->/g,
      " "
    );
}


/*
 * ============================================================
 * JSON-LD
 * ============================================================
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
       * Malformed JSON-LD must not cause the page
       * extraction to fail.
       */
    }
  }

  return blocks;
}


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
     * Nested subEvents are not automatically separate
     * programs. Reconciliation will eventually decide
     * whether they represent occurrences.
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
 * ============================================================
 * STRUCTURED DATA NORMALIZATION
 * ============================================================
 */

function schemaName(value) {
  if (!value) return undefined;

  if (typeof value === "string") {
    /*
     * Some Schema.org implementations incorrectly put
     * a type name in performer rather than an actual name.
     *
     * Example:
     * "performer": "Organization"
     *
     * That is not useful program information.
     */
    if (
      value === "Organization" ||
      value === "Person"
    ) {
      return undefined;
    }

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
      stripTags(event.name);
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
          stripTags(address.streetAddress);
      }

      if (address.addressLocality) {
        place.locality =
          stripTags(address.addressLocality);
      }

      if (address.addressRegion) {
        place.region =
          stripTags(address.addressRegion);
      }

      if (address.postalCode) {
        place.postal_code =
          stripTags(address.postalCode);
      }

      if (address.addressCountry) {
        place.country =
          stripTags(address.addressCountry);
      }
    }

    if (Object.keys(place).length) {
      result.place = place;
    }
  }

  return result;
}


/*
 * ============================================================
 * PAGE TITLE
 * ============================================================
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
 * ============================================================
 * SEMANTIC BLOCK EXTRACTION
 * ============================================================
 *
 * Instead of flattening the entire page into one giant string,
 * preserve meaningful blocks.
 *
 * Later parsers will use nearby blocks as context.
 *
 * Example:
 *
 *   heading: Dates / Schedules
 *   text:    Saturday, 26 September 2026
 *   text:    7:00pm
 *
 * is much more useful than simply finding "7:00pm"
 * somewhere in the webpage.
 */


function classifyElement(tag) {
  const lower = tag.toLowerCase();

  if (/^h[1-6]$/.test(lower)) {
    return "heading";
  }

  if (lower === "li") {
    return "list_item";
  }

  if (lower === "dt") {
    return "label";
  }

  if (lower === "dd") {
    return "value";
  }

  if (lower === "time") {
    return "time";
  }

  if (lower === "address") {
    return "location";
  }

  return "text";
}

/*
 * Some labels frequently occur as short standalone blocks even
 * when the publisher didn't use semantic HTML such as <dt>.
 *
 * This is NOT event extraction yet.
 *
 * We're simply identifying text that is likely functioning as
 * a label so later parsers can use it as context.
 */

const GENERIC_LABELS = new Set([
  "date",
  "dates",
  "date / time",
  "date / times",
  "dates / schedules",
  "schedule",
  "schedules",
  "when",

  "data",
  "datas",
  "data / horário",
  "datas / horários",
  "horário",
  "horários",

  "time",
  "times",
  "duration",
  "duração",

  "price",
  "prices",
  "pricing",
  "preço",
  "preços",

  "ticket",
  "tickets",
  "bilhete",
  "bilhetes",

  "age",
  "ages",
  "idade",
  "idades",

  "language",
  "languages",
  "idioma",
  "idiomas",

  "accessibility",
  "acessibilidade",

  "capacity",
  "lotação",
  "participants",
  "participantes",

  "location",
  "venue",
  "place",
  "local",
  "meeting point",
  "ponto de encontro",
  "departure",
  "departure point",
  "partida",
  "ponto de partida",

  "booking",
  "reservation",
  "reservations",
  "reserva",
  "reservas",

  "registration",
  "inscrição",
  "inscrições",

  "opening hours",
  "opening times",
  "horário de funcionamento",

  "information",
  "informações",
  "details",
  "detalhes"
]);


function looksLikeKnownLabel(text) {
  if (!text) return false;

  const normalized =
    text
      .toLowerCase()
      .replace(/[:：]\s*$/, "")
      .replace(/\s+/g, " ")
      .trim();

  return GENERIC_LABELS.has(normalized);
}


/*
 * Prevent exact adjacent duplicates.
 *
 * Websites frequently contain the same content in both desktop
 * and mobile navigation/layout structures.
 *
 * We remain conservative: only immediately repeated identical
 * blocks are removed here.
 */

function dedupeAdjacentBlocks(blocks) {
  const result = [];

  for (const block of blocks) {
    const previous =
      result[result.length - 1];

    if (
      previous &&
      previous.type === block.type &&
      previous.text === block.text
    ) {
      continue;
    }

    result.push(block);
  }

  return result;
}


function extractSemanticBlocks(html) {
  const cleaned = removeNonContentHtml(html);
  const blocks = [];

  /*
   * Elements that usually contain meaningful standalone content.
   *
   * We now include div/span/strong/etc., but only keep them when
   * they are LEAF-LIKE: they must not contain another meaningful
   * block element.
   */
  const elementRegex =
    /<(h[1-6]|p|li|dt|dd|figcaption|caption|div|span|strong|b|small|time|address)\b[^>]*>([\s\S]*?)<\/\1>/gi;

  /*
   * If one of these occurs inside a candidate element, the
   * candidate is probably a wrapper rather than a leaf.
   */
  const childContentRegex =
    /<(h[1-6]|p|li|dt|dd|figcaption|caption|div|section|article|ul|ol|table|tr|td|th)\b/i;

  let match;

  while ((match = elementRegex.exec(cleaned)) !== null) {
    const tag = match[1].toLowerCase();
    const innerHtml = match[2];

    /*
     * For container-like elements, reject wrappers containing
     * meaningful child structures.
     *
     * Ordinary semantic elements such as <p> and <h2> are kept.
     */
    if (
      ["div", "span", "strong", "b", "small", "address"].includes(tag) &&
      childContentRegex.test(innerHtml)
    ) {
      continue;
    }

    const text = stripTags(innerHtml);

    if (!text) continue;

    /*
     * Ignore tiny punctuation-only fragments.
     */
    if (!/[\p{L}\p{N}€$£¥]/u.test(text)) {
      continue;
    }

    /*
     * Extremely long leaf blocks usually indicate unusual markup
     * rather than a useful label/value.
     */
    if (
      ["div", "span", "strong", "b", "small"].includes(tag) &&
      text.length > 500
    ) {
      continue;
    }

    let type = classifyElement(tag);

    /*
     * <time> has particularly useful semantics.
     */
    if (tag === "time") {
      type = "time";
    }

    /*
     * <address> is useful location context.
     */
    if (tag === "address") {
      type = "location";
    }

    /*
     * A short known phrase can function as a label regardless
     * of whether the publisher used semantic HTML.
     */
    if (looksLikeKnownLabel(text)) {
      type = "label";
    }

    blocks.push({
      type,
      tag,
      text
    });
  }

  /*
   * Sort by actual document position.
   *
   * Because our regex scans different nested element types,
   * document position matters more than element type.
   *
   * The temporary position value is removed afterward.
   */
  return dedupeAdjacentBlocks(blocks);
}

/*
 * ============================================================
 * LINKS
 * ============================================================
 *
 * Links will eventually be important for:
 *
 * Buy tickets
 * Book now
 * Register
 * Check availability
 *
 * For now we merely preserve them.
 */

function extractLinks(html, baseUrl) {
  const links = [];

  const regex =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = regex.exec(html)) !== null) {
    const href =
      decodeHtml(match[1]).trim();

    const text =
      stripTags(match[2]);

    if (!href || !text) continue;

    if (
      href.startsWith("#") ||
      href.toLowerCase().startsWith("javascript:")
    ) {
      continue;
    }

    let absoluteUrl;

    try {
      absoluteUrl =
        new URL(
          href,
          baseUrl
        ).toString();
    } catch {
      continue;
    }

    links.push({
      text,
      url: absoluteUrl
    });
  }

  return links;
}


/*
 * ============================================================
 * FLAT PAGE TEXT
 * ============================================================
 *
 * Keep this diagnostic for now.
 *
 * Later, most extraction should operate on semantic blocks
 * rather than this flattened representation.
 */

function buildPageText(html) {
  const cleaned =
    removeNonContentHtml(html);

  return decodeHtml(
    cleaned
      .replace(
        /<\/(h[1-6]|p|li|dt|dd|div|section|article)>/gi,
        "\n"
      )
      .replace(
        /<br\s*\/?>/gi,
        "\n"
      )
      .replace(
        /<[^>]+>/g,
        " "
      )
  )
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


/*
 * ============================================================
 * DIAGNOSTIC BLOCK SELECTION
 * ============================================================
 *
 * At this stage we want to inspect the representation without
 * returning thousands of navigation blocks.
 *
 * We return:
 *
 * - blocks near the H1
 * - blocks containing known labels
 * - blocks near those labels
 *
 * This is diagnostic only. The complete block array remains
 * available internally to future parsers.
 */

function selectDiagnosticBlocks(
  blocks,
  h1,
  maxBlocks = 120
) {
  const interestingIndexes =
    new Set();

  /*
   * Find H1/title area.
   */

  if (h1) {
    const normalizedH1 =
      normalizeWhitespace(h1)
        .toLowerCase();

    for (
      let i = 0;
      i < blocks.length;
      i++
    ) {
      if (
        blocks[i].text
          .toLowerCase() ===
        normalizedH1
      ) {
        /*
         * Include a generous window after the program title.
         */
        for (
          let j = Math.max(0, i - 3);
          j <= Math.min(
            blocks.length - 1,
            i + 40
          );
          j++
        ) {
          interestingIndexes.add(j);
        }

        break;
      }
    }
  }

  /*
   * Include context around known labels anywhere on the page.
   */

  for (
    let i = 0;
    i < blocks.length;
    i++
  ) {
    if (
      blocks[i].type === "label" ||
      looksLikeKnownLabel(
        blocks[i].text
      )
    ) {
      for (
        let j = Math.max(0, i - 2);
        j <= Math.min(
          blocks.length - 1,
          i + 8
        );
        j++
      ) {
        interestingIndexes.add(j);
      }
    }
  }

  const selected =
    [...interestingIndexes]
      .sort((a, b) => a - b)
      .map(index => ({
        index,
        ...blocks[index]
      }));

  /*
   * If semantic selection found nothing useful, return the first
   * blocks so we can diagnose the unfamiliar page.
   */

  if (!selected.length) {
    return blocks
      .slice(0, maxBlocks)
      .map((block, index) => ({
        index,
        ...block
      }));
  }

  return selected.slice(
    0,
    maxBlocks
  );
}


/*
 * ============================================================
 * API
 * ============================================================
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
    parsedUrl =
      new URL(sourceUrl);

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
     * Optional anomaly normalization.
     *
     * No profiles currently exist, so ordinary pages pass through
     * unchanged.
     */

    let normalizedHtml =
      html;

    if (
      profile?.preExtract &&
      typeof profile.preExtract ===
        "function"
    ) {
      normalizedHtml =
        profile.preExtract(html);
    }


    /*
     * ------------------------------
     * Structured data
     * ------------------------------
     */

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


    /*
     * ------------------------------
     * Visible semantic content
     * ------------------------------
     */

    const h1 =
      extractH1(
        normalizedHtml
      );

    const titleTag =
      extractTitleTag(
        normalizedHtml
      );

    const semanticBlocks =
      extractSemanticBlocks(
        normalizedHtml
      );

    const diagnosticBlocks =
      selectDiagnosticBlocks(
        semanticBlocks,
        h1
      );

    const links =
      extractLinks(
        normalizedHtml,
        parsedUrl.toString()
      );

    const pageText =
      buildPageText(
        normalizedHtml
      );


    /*
     * ------------------------------
     * Response
     * ------------------------------
     */

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
        Boolean(profile),

      bytes_received:
        html.length,

      json_ld_blocks_found:
        jsonLd.length,

      schema_events_found:
        structuredEvents.length,

      semantic_blocks_found:
        semanticBlocks.length,

      links_found:
        links.length,

      page: {
        ...(h1
          ? { h1 }
          : {}),

        ...(titleTag
          ? {
              title_tag:
                titleTag
            }
          : {}),

        text_length:
          pageText.length,

        /*
         * Smaller than Version 1 because semantic_blocks are now
         * the more useful diagnostic.
         */
        text_preview:
          pageText.slice(
            0,
            1500
          )
      },

      semantic_blocks:
        diagnosticBlocks,

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

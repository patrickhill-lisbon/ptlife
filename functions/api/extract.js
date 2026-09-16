/*
 * Worth A Go — Generic Extractor
 * Version 3
 *
 * READ ONLY — does not write to D1.
 *
 * PIPELINE
 * --------
 * URL
 *   ↓
 * optional site anomaly normalization
 *   ↓
 * JSON-LD structured extraction
 *   ↓
 * semantic block extraction
 *   ↓
 * visible text token extraction
 *   ↓
 * [future] recognition grammar
 *   ↓
 * [future] reconciliation
 *
 * PRINCIPLES
 * ----------
 * 1. Generic extraction is the default.
 * 2. Site-specific filters only normalize genuine anomalies.
 * 3. Prefer authoritative structured data when available.
 * 4. Visible content supplements structured data.
 * 5. Preserve document order and nearby context.
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
       * Malformed JSON-LD should not cause extraction failure.
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
     * Do not automatically promote nested subEvents to programs.
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
     * Schema type placeholders are not performer names.
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

  const result =
    values
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
 * GENERIC LABELS
 * ============================================================
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
  "adult price",
  "child price",
  "baby price",
  "infant price",
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
  "languages available",
  "idioma",
  "idiomas",

  "accessibility",
  "acessibilidade",

  "capacity",
  "max capacity",
  "max. capacity",
  "maximum capacity",
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
  "departures",
  "departure point",
  "partida",
  "partidas",
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


function normalizeLabel(text) {
  return text
    .toLowerCase()
    .replace(/[:：]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}


function looksLikeKnownLabel(text) {
  if (!text) return false;

  return GENERIC_LABELS.has(
    normalizeLabel(text)
  );
}


/*
 * ============================================================
 * SEMANTIC BLOCKS
 * ============================================================
 */

function classifyElement(tag) {
  const lower =
    tag.toLowerCase();

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


function extractSemanticBlocks(html) {
  const cleaned =
    removeNonContentHtml(html);

  const candidates = [];


  function addCandidate(
    position,
    tag,
    text
  ) {
    text = stripTags(text);

    if (!text) return;

    if (
      !/[\p{L}\p{N}€$£¥]/u.test(text)
    ) {
      return;
    }

    let type =
      classifyElement(tag);

    if (
      looksLikeKnownLabel(text)
    ) {
      type = "label";
    }

    candidates.push({
      position,
      type,
      tag:
        tag.toLowerCase(),
      text
    });
  }


  /*
   * PASS 1:
   * structurally reliable elements.
   */

  const semanticRegex =
    /<(h[1-6]|p|li|dt|dd|figcaption|caption|time|address)\b[^>]*>([\s\S]*?)<\/\1>/gi;

  let match;

  while (
    (match =
      semanticRegex.exec(cleaned)) !== null
  ) {
    addCandidate(
      match.index,
      match[1],
      match[2]
    );
  }


  /*
   * PASS 2:
   * concise leaf containers.
   */

  const leafRegex =
    /<(div|span|strong|b|small)\b[^>]*>([\s\S]*?)<\/\1>/gi;

  const containsStructuralChild =
    /<(h[1-6]|p|li|dt|dd|div|section|article|ul|ol|table|tr|td|th)\b/i;

  while (
    (match =
      leafRegex.exec(cleaned)) !== null
  ) {
    const innerHtml =
      match[2];

    if (
      containsStructuralChild.test(
        innerHtml
      )
    ) {
      continue;
    }

    const text =
      stripTags(innerHtml);

    if (!text) continue;

    if (text.length > 300) {
      continue;
    }

    addCandidate(
      match.index,
      match[1],
      text
    );
  }


  candidates.sort(
    (a, b) =>
      a.position - b.position
  );


  const result = [];

  for (
    const candidate of candidates
  ) {
    const previous =
      result[
        result.length - 1
      ];

    if (
      previous &&
      previous.text ===
        candidate.text &&
      Math.abs(
        previous.position -
        candidate.position
      ) < 200
    ) {
      if (
        candidate.type ===
          "label" &&
        previous.type !==
          "label"
      ) {
        result[
          result.length - 1
        ] = candidate;
      }

      continue;
    }

    result.push(candidate);
  }


  return result.map(
    ({ position, ...block }) =>
      block
  );
}


/*
 * ============================================================
 * VISIBLE TEXT TOKENS — NEW IN VERSION 3
 * ============================================================
 *
 * Semantic blocks are valuable because they preserve labels,
 * headings, paragraphs, etc.
 *
 * But some sites place important values in unusual elements.
 *
 * Example:
 *
 *     Duration
 *     3h00
 *
 * We therefore also create a low-level ordered text stream.
 *
 * The goal is NOT to understand the values here.
 * Recognition comes later.
 */


/*
 * Tags that normally create a visible separation between pieces
 * of text.
 *
 * We replace these with a special marker before stripping HTML.
 */

function buildVisibleTextStream(html) {
  let cleaned =
    removeNonContentHtml(html);

  /*
   * Remove document metadata and form machinery that cannot
   * normally represent the visible activity description.
   */

  cleaned = cleaned
    .replace(
      /<head\b[^>]*>[\s\S]*?<\/head>/gi,
      " "
    )
    .replace(
      /<template\b[^>]*>[\s\S]*?<\/template>/gi,
      " "
    );


  /*
   * Insert boundaries around common structural and inline
   * elements.
   *
   * The boundary is intentionally unusual so ordinary webpage
   * content is unlikely to contain it.
   */

  const BOUNDARY =
    "\n__WAG_BOUNDARY__\n";

  cleaned = cleaned
    .replace(
      /<br\s*\/?>/gi,
      BOUNDARY
    )
    .replace(
      /<\/?(?:h[1-6]|p|li|dt|dd|div|section|article|aside|header|footer|nav|main|figure|figcaption|table|thead|tbody|tfoot|tr|td|th|ul|ol|address|time|button|label|option)\b[^>]*>/gi,
      BOUNDARY
    );


  /*
   * Remaining tags are treated as inline formatting and removed.
   */

  cleaned =
    cleaned.replace(
      /<[^>]+>/g,
      " "
    );


  cleaned =
    decodeHtml(cleaned);


  return cleaned;
}


/*
 * Break the visible stream into concise ordered tokens.
 */

function extractVisibleTextTokens(
  html
) {
  const stream =
    buildVisibleTextStream(html);

  const rawPieces =
    stream.split(
      /__WAG_BOUNDARY__|\r?\n/
    );

  const tokens = [];


  for (
    const rawPiece of rawPieces
  ) {
    const text =
      normalizeWhitespace(
        rawPiece
      );

    if (!text) continue;

    /*
     * Ignore punctuation-only fragments.
     */

    if (
      !/[\p{L}\p{N}€$£¥]/u.test(
        text
      )
    ) {
      continue;
    }


    /*
     * Huge text fragments are unlikely to be useful label/value
     * tokens. They remain available through page text and semantic
     * paragraphs, so skipping them here loses no essential source
     * material.
     */

    if (text.length > 500) {
      continue;
    }


    /*
     * Avoid immediate duplicates caused by nested layout.
     */

    const previous =
      tokens[
        tokens.length - 1
      ];

    if (
      previous &&
      previous.text === text
    ) {
      continue;
    }


    tokens.push({
      index:
        tokens.length,

      text,

      ...(looksLikeKnownLabel(text)
        ? {
            kind: "label"
          }
        : {})
    });
  }


  return tokens;
}


/*
 * ============================================================
 * LINKS
 * ============================================================
 */

function extractLinks(
  html,
  baseUrl
) {
  const links = [];

  const regex =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while (
    (match = regex.exec(html)) !== null
  ) {
    const href =
      decodeHtml(
        match[1]
      ).trim();

    const text =
      stripTags(
        match[2]
      );

    if (
      !href ||
      !text
    ) {
      continue;
    }

    if (
      href.startsWith("#") ||
      href
        .toLowerCase()
        .startsWith(
          "javascript:"
        )
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
    .replace(
      /\u00a0/g,
      " "
    )
    .replace(
      /[ \t]+/g,
      " "
    )
    .replace(
      /\n[ \t]+/g,
      "\n"
    )
    .replace(
      /\n{3,}/g,
      "\n\n"
    )
    .trim();
}


/*
 * ============================================================
 * DIAGNOSTIC SELECTION
 * ============================================================
 */

function selectDiagnosticBlocks(
  blocks,
  h1,
  maxBlocks = 140
) {
  const interestingIndexes =
    new Set();


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
        for (
          let j =
            Math.max(
              0,
              i - 4
            );
          j <=
          Math.min(
            blocks.length - 1,
            i + 70
          );
          j++
        ) {
          interestingIndexes.add(
            j
          );
        }

        break;
      }
    }
  }


  for (
    let i = 0;
    i < blocks.length;
    i++
  ) {
    if (
      blocks[i].type ===
        "label" ||
      looksLikeKnownLabel(
        blocks[i].text
      )
    ) {
      for (
        let j =
          Math.max(
            0,
            i - 2
          );
        j <=
        Math.min(
          blocks.length - 1,
          i + 8
        );
        j++
      ) {
        interestingIndexes.add(
          j
        );
      }
    }
  }


  const selected =
    [...interestingIndexes]
      .sort(
        (a, b) =>
          a - b
      )
      .map(
        index => ({
          index,
          ...blocks[index]
        })
      );


  if (!selected.length) {
    return blocks
      .slice(
        0,
        maxBlocks
      )
      .map(
        (block, index) => ({
          index,
          ...block
        })
      );
  }


  return selected.slice(
    0,
    maxBlocks
  );
}


/*
 * Select visible tokens near labels.
 *
 * This is ONLY for debugging Version 3.
 *
 * The future parser will use the complete token array.
 */

function selectDiagnosticTokens(
  tokens,
  maxTokens = 180
) {
  const interesting =
    new Set();


  for (
    let i = 0;
    i < tokens.length;
    i++
  ) {
    if (
      tokens[i].kind ===
      "label"
    ) {
      /*
       * Show some context before the label and substantially more
       * after it so we can inspect label/value relationships.
       */

      for (
        let j =
          Math.max(
            0,
            i - 2
          );
        j <=
        Math.min(
          tokens.length - 1,
          i + 10
        );
        j++
      ) {
        interesting.add(j);
      }
    }
  }


  /*
   * If no known labels exist, return the first part of the stream.
   */

  if (!interesting.size) {
    return tokens.slice(
      0,
      maxTokens
    );
  }


  return [...interesting]
    .sort(
      (a, b) =>
        a - b
    )
    .slice(
      0,
      maxTokens
    )
    .map(
      index =>
        tokens[index]
    );
}


/*
 * ============================================================
 * API
 * ============================================================
 */

export async function onRequestGet(
  context
) {
  const requestUrl =
    new URL(
      context.request.url
    );

  const sourceUrl =
    requestUrl.searchParams.get(
      "url"
    );


  if (!sourceUrl) {
    return Response.json(
      {
        ok: false,
        error:
          "Missing url parameter"
      },
      {
        status: 400
      }
    );
  }


  let parsedUrl;


  try {
    parsedUrl =
      new URL(sourceUrl);

    if (
      ![
        "http:",
        "https:"
      ].includes(
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
        error:
          "Invalid URL"
      },
      {
        status: 400
      }
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
     */

    let normalizedHtml =
      html;


    if (
      profile?.preExtract &&
      typeof profile.preExtract ===
        "function"
    ) {
      normalizedHtml =
        profile.preExtract(
          html
        );
    }


    /*
     * --------------------------------------------------------
     * Structured data
     * --------------------------------------------------------
     */

    const jsonLd =
      extractJsonLd(
        normalizedHtml
      );


    const schemaEvents = [];


    for (
      const block of jsonLd
    ) {
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
     * --------------------------------------------------------
     * Visible content
     * --------------------------------------------------------
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


    const visibleTokens =
      extractVisibleTextTokens(
        normalizedHtml
      );


    const diagnosticBlocks =
      selectDiagnosticBlocks(
        semanticBlocks,
        h1
      );


    const diagnosticTokens =
      selectDiagnosticTokens(
        visibleTokens
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
     * --------------------------------------------------------
     * Response
     * --------------------------------------------------------
     */

    return Response.json({
      ok: true,

      http_status:
        response.status,

      fetched_at:
        new Date()
          .toISOString(),

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

      visible_tokens_found:
        visibleTokens.length,

      links_found:
        links.length,


      page: {
        ...(h1
          ? {
              h1
            }
          : {}),

        ...(titleTag
          ? {
              title_tag:
                titleTag
            }
          : {}),

        text_length:
          pageText.length,

        text_preview:
          pageText.slice(
            0,
            1200
          )
      },


      /*
       * Diagnostic subsets only.
       *
       * Internally we have all semantic blocks and all visible
       * tokens. We don't need to send enormous arrays to the
       * browser while developing.
       */

      semantic_blocks:
        diagnosticBlocks,

      visible_text_tokens:
        diagnosticTokens,

      structured_events:
        structuredEvents
    });


  } catch (error) {
    return Response.json(
      {
        ok: false,

        source_url:
          parsedUrl
            ?.toString() ??
          sourceUrl,

        error:
          error.message
      },
      {
        status: 500
      }
    );
  }
}

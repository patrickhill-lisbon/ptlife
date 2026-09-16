/*
 * PTLife — IMAX / Algolia Test v1
 *
 * Diagnostic only.
 *
 * Purpose:
 *   Test whether we can retrieve structured theatre/showtime data
 *   directly from the Algolia index used by the IMAX website.
 *
 * Initial test:
 *   Cinema NOS Colombo IMAX, Lisbon
 *
 * This does NOT modify the PTLife generic extractor.
 */

const ALGOLIA_APP_ID = "10MXKGB0UH";
const ALGOLIA_SEARCH_KEY = "7c9c8e2eadbdc26fb3b97b5db64a28dd";
const ALGOLIA_INDEX = "dev_web23_showtimes";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function queryAlgolia(params) {
  const url =
    `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/` +
    `${encodeURIComponent(ALGOLIA_INDEX)}/query`;

  const response = await fetch(url, {
    method: "POST",

    headers: {
      "content-type": "application/json",

      "x-algolia-application-id":
        ALGOLIA_APP_ID,

      "x-algolia-api-key":
        ALGOLIA_SEARCH_KEY,
    },

    body: JSON.stringify({
      params: new URLSearchParams(params).toString(),
    }),
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = {
      raw_response: text,
    };
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

export async function onRequestGet(context) {
  const requestUrl =
    new URL(context.request.url);

  /*
   * Allow us to change the search from the browser later.
   *
   * Examples:
   *
   * /api/imax-test
   *
   * /api/imax-test?q=Colombo
   *
   * /api/imax-test?q=Porto
   *
   * /api/imax-test?q=Algarve
   */

  const q =
    requestUrl.searchParams.get("q") ||
    "Cinema NOS Colombo IMAX";

  let result;

  try {
    result = await queryAlgolia({
      query: q,
      hitsPerPage: "20",
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        stage: "algolia_fetch",
        error: String(
          error?.message || error
        ),
      },
      502
    );
  }

  if (!result.ok) {
    return jsonResponse(
      {
        ok: false,

        test: {
          query: q,
          index: ALGOLIA_INDEX,
          application_id:
            ALGOLIA_APP_ID,
        },

        algolia_http_status:
          result.status,

        algolia_response:
          result.data,
      },
      result.status
    );
  }

  const rawHits =
    Array.isArray(result.data?.hits)
      ? result.data.hits
      : [];

  /*
   * For this first test we intentionally return BOTH:
   *
   *   1. a compact summary
   *   2. the complete raw hits
   *
   * We don't yet know exactly which fields IMAX stores in each
   * theatre/showtime object, and we do not want to throw useful
   * information away before examining it.
   */

  const summary = rawHits.map(
    (hit, index) => ({
      result_number: index + 1,

      objectID:
        hit?.objectID ?? null,

      name:
        hit?.name ??
        hit?.title ??
        null,

      slug:
        hit?.slug ?? null,

      type:
        hit?.type ??
        hit?.contentType ??
        null,

      city:
        hit?.city ?? null,

      state:
        hit?.stateName ??
        hit?.state ??
        null,

      country:
        hit?.countryName ??
        hit?.country ??
        null,

      latitude:
        hit?._geoloc?.lat ??
        hit?.latitude ??
        null,

      longitude:
        hit?._geoloc?.lng ??
        hit?.longitude ??
        null,

      events_count:
        Array.isArray(hit?.events)
          ? hit.events.length
          : null,

      showtimes_count:
        Array.isArray(hit?.showtimes)
          ? hit.showtimes.length
          : null,

      top_level_fields:
        Object.keys(hit || {}),
    })
  );

  return jsonResponse({
    ok: true,

    fetched_at:
      new Date().toISOString(),

    test: {
      purpose:
        "Determine whether PTLife can retrieve IMAX theatre/showtime data directly from Algolia.",

      query: q,

      application_id:
        ALGOLIA_APP_ID,

      index:
        ALGOLIA_INDEX,
    },

    algolia: {
      http_status:
        result.status,

      nb_hits:
        result.data?.nbHits ??
        rawHits.length,

      page:
        result.data?.page ??
        null,

      nb_pages:
        result.data?.nbPages ??
        null,

      processing_time_ms:
        result.data
          ?.processingTimeMS ??
        null,
    },

    summary,

    /*
     * Deliberately retained for our first
     * reverse-engineering test.
     */
    raw_hits: rawHits,

    next_step:
      "Inspect the Colombo result structure before writing any production adapter.",
  });
}

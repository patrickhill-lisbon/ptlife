/*
 * PTLife — IMAX / Algolia Test v2
 *
 * Diagnostic only.
 *
 * Purpose:
 *   Test the IMAX Algolia showtimes index across Portugal.
 *
 * Default:
 *   Return all Portuguese theatres in the index.
 *
 * Optional:
 *   ?q=Colombo
 *   ?q=Porto
 *   ?q=Albufeira
 *
 * This does NOT modify the PTLife generic extractor.
 */

const ALGOLIA_APP_ID = "10MXKGB0UH";
const ALGOLIA_SEARCH_KEY =
  "7c9c8e2eadbdc26fb3b97b5db64a28dd";

const ALGOLIA_INDEX =
  "dev_web23_showtimes";

function jsonResponse(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=utf-8",

        "cache-control":
          "no-store",
      },
    }
  );
}

async function queryAlgolia(params) {
  const url =
    `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/` +
    `${encodeURIComponent(ALGOLIA_INDEX)}/query`;

  const response = await fetch(url, {
    method: "POST",

    headers: {
      "content-type":
        "application/json",

      "x-algolia-application-id":
        ALGOLIA_APP_ID,

      "x-algolia-api-key":
        ALGOLIA_SEARCH_KEY,
    },

    body: JSON.stringify({
      params:
        new URLSearchParams(
          params
        ).toString(),
    }),
  });

  const text =
    await response.text();

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

function makeSummary(hit, index) {
  return {
    result_number:
      index + 1,

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

    country_code:
      hit?.country ?? null,

    country_name:
      hit?.countryName ?? null,

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
  };
}

export async function onRequestGet(context) {
  const requestUrl =
    new URL(context.request.url);

  /*
   * DEFAULT MODE
   *
   * No ?q= parameter:
   *
   *     /api/imax-test
   *
   * Search the entire IMAX showtimes
   * index and restrict results to Portugal.
   *
   *
   * OPTIONAL SEARCH MODE
   *
   *     /api/imax-test?q=Colombo
   *     /api/imax-test?q=Porto
   *     /api/imax-test?q=Albufeira
   *
   * This performs a text search but still
   * restricts results to Portugal.
   */

  const q =
    requestUrl.searchParams.get("q");

  const searchQuery =
    q ? q : "";

  /*
   * The records we inspected use:
   *
   *     country: "PT"
   *
   * We therefore ask Algolia to return
   * only Portuguese records.
   */

  const params = {
    query: searchQuery,

    hitsPerPage: "100",

    filters:
      'country:"PT"',
  };

  let result;

  try {
    result =
      await queryAlgolia(params);
  } catch (error) {
    return jsonResponse(
      {
        ok: false,

        stage:
          "algolia_fetch",

        error:
          String(
            error?.message ||
            error
          ),
      },
      502
    );
  }

  /*
   * If Algolia rejects the filter,
   * return its actual response.
   *
   * We do NOT silently fall back because
   * this test is intended to tell us
   * whether country filtering works.
   */

  if (!result.ok) {
    return jsonResponse(
      {
        ok: false,

        test: {
          mode:
            q
              ? "portugal_text_search"
              : "all_portugal",

          query:
            searchQuery,

          filter:
            'country:"PT"',

          index:
            ALGOLIA_INDEX,

          application_id:
            ALGOLIA_APP_ID,
        },

        algolia_http_status:
          result.status,

        algolia_response:
          result.data,

        interpretation:
          "Algolia rejected the request. Do not assume the country field is filterable until we inspect this response.",
      },
      result.status
    );
  }

  const rawHits =
    Array.isArray(
      result.data?.hits
    )
      ? result.data.hits
      : [];

  const summary =
    rawHits.map(
      (hit, index) =>
        makeSummary(
          hit,
          index
        )
    );

  /*
   * Make a second compact list that is
   * particularly useful for our Portugal
   * coverage test.
   */

  const theatreInventory =
    summary.map(
      (item) => ({
        name:
          item.name,

        slug:
          item.slug,

        city:
          item.city,

        state:
          item.state,

        country_code:
          item.country_code,

        events_count:
          item.events_count,

        latitude:
          item.latitude,

        longitude:
          item.longitude,
      })
    );

  /*
   * Also identify anything whose location
   * text suggests Algarve.
   *
   * This is NOT used for extraction.
   * It is merely a convenient diagnostic
   * in the returned JSON.
   */

  const algarveCandidates =
    summary.filter(
      (item) => {
        const location =
          [
            item.name,
            item.city,
            item.state,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

        return (
          location.includes(
            "algarve"
          ) ||
          location.includes(
            "faro"
          ) ||
          location.includes(
            "albufeira"
          ) ||
          location.includes(
            "portimão"
          ) ||
          location.includes(
            "portimao"
          ) ||
          location.includes(
            "loulé"
          ) ||
          location.includes(
            "loule"
          ) ||
          location.includes(
            "lagos"
          )
        );
      }
    );

  return jsonResponse({
    ok: true,

    fetched_at:
      new Date().toISOString(),

    test: {
      purpose:
        "Determine the Portuguese theatre coverage of the IMAX Algolia showtimes index.",

      mode:
        q
          ? "portugal_text_search"
          : "all_portugal",

      query:
        searchQuery,

      filter:
        'country:"PT"',

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

      returned_hits:
        rawHits.length,

      page:
        result.data?.page ??
        null,

      nb_pages:
        result.data?.nbPages ??
        null,

      hits_per_page:
        result.data
          ?.hitsPerPage ??
        100,

      processing_time_ms:
        result.data
          ?.processingTimeMS ??
        null,
    },

    /*
     * THIS IS THE MAIN RESULT WE WANT
     * TO LOOK AT.
     */

    portugal_theatre_inventory:
      theatreInventory,

    portugal_theatre_count:
      theatreInventory.length,

    /*
     * Convenience check for our Algarve
     * question.
     */

    algarve_candidates:
      algarveCandidates,

    /*
     * Keep the previous summary format.
     */

    summary,

    /*
     * Keep raw records for now because
     * we're still reverse-engineering
     * the source.
     */

    raw_hits:
      rawHits,

    next_step:
      "Determine how much of Portugal this IMAX source covers. If Algarve NOS cinemas are absent, test NOS's own underlying data source rather than writing cinema-specific crawlers.",
  });
}

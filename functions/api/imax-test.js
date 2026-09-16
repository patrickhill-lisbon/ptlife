/*
 * PTLife — IMAX / Algolia Test v3
 *
 * Diagnostic only.
 *
 * Purpose:
 *   Inspect the IMAX Algolia showtimes index broadly,
 *   without assuming how country filtering works.
 *
 * Default:
 *   Request up to 1000 records from the showtimes index.
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
        new URLSearchParams(params).toString(),
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

/*
 * Create a compact version of each record.
 *
 * We intentionally expose several possible
 * location/country fields because we're trying
 * to learn the actual schema.
 */
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

    country:
      hit?.country ?? null,

    country_name:
      hit?.countryName ?? null,

    address:
      hit?.address ?? null,

    postal_code:
      hit?.postalCode ??
      hit?.zip ??
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
  };
}

/*
 * Diagnostic Portugal detector.
 *
 * IMPORTANT:
 * This is NOT intended as our final production
 * location classifier.
 *
 * We're using several signals simply to discover
 * how the IMAX records identify Portuguese theatres.
 */
function looksPortuguese(item) {
  const country =
    String(item?.country || "")
      .trim()
      .toLowerCase();

  const countryName =
    String(item?.country_name || "")
      .trim()
      .toLowerCase();

  if (
    country === "pt" ||
    country === "prt" ||
    country === "portugal"
  ) {
    return true;
  }

  if (
    countryName === "pt" ||
    countryName === "prt" ||
    countryName === "portugal"
  ) {
    return true;
  }

  /*
   * Known Portuguese city/location clues.
   *
   * These are diagnostic fallbacks only.
   */
  const text = [
    item?.name,
    item?.city,
    item?.state,
    item?.address,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const clues = [
    "lisboa",
    "lisbon",
    "porto",
    "matosinhos",
    "gaia",
    "alcabideche",
    "cascais",
    "sintra",
    "amadora",
    "oeiras",
    "almada",
    "faro",
    "albufeira",
    "portimão",
    "portimao",
    "loulé",
    "loule",
    "lagos",
    "almancil",
    "tavira",
    "olhão",
    "olhao",
  ];

  return clues.some(
    (clue) =>
      text.includes(clue)
  );
}

function looksAlgarve(item) {
  const text = [
    item?.name,
    item?.city,
    item?.state,
    item?.address,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const clues = [
    "algarve",
    "faro",
    "albufeira",
    "portimão",
    "portimao",
    "loulé",
    "loule",
    "lagos",
    "almancil",
    "tavira",
    "olhão",
    "olhao",
    "quarteira",
    "vilamoura",
  ];

  return clues.some(
    (clue) =>
      text.includes(clue)
  );
}

export async function onRequestGet(context) {
  const requestUrl =
    new URL(context.request.url);

  /*
   * No q:
   *
   *     /api/imax-test
   *
   * requests a broad sample from the entire
   * showtimes index.
   *
   * q supplied:
   *
   *     /api/imax-test?q=Porto
   *
   * performs the old text-search behavior.
   */

  const q =
    requestUrl.searchParams.get("q");

  const searchQuery =
    q || "";

  /*
   * Deliberately NO country filter.
   *
   * We want to inspect what Algolia actually
   * returns before deciding how location
   * filtering should work.
   */
  const params = {
    query:
      searchQuery,

    hitsPerPage:
      "1000",
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

  if (!result.ok) {
    return jsonResponse(
      {
        ok: false,

        test: {
          mode:
            q
              ? "text_search"
              : "broad_index_sample",

          query:
            searchQuery,

          index:
            ALGOLIA_INDEX,

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
   * Count the actual values found in the
   * country fields.
   *
   * This is particularly useful because our
   * previous country:"PT" assumption produced
   * zero results.
   */
  const countryValues = {};

  for (const item of summary) {
    const key =
      JSON.stringify({
        country:
          item.country,

        country_name:
          item.country_name,
      });

    countryValues[key] =
      (countryValues[key] || 0) + 1;
  }

  /*
   * Diagnostic Portugal subset.
   */
  const portugal =
    summary.filter(
      looksPortuguese
    );

  /*
   * Algarve subset of the records we consider
   * potentially Portuguese.
   */
  const algarve =
    portugal.filter(
      looksAlgarve
    );

  /*
   * Keep the Portugal inventory compact.
   */
  const portugalInventory =
    portugal.map(
      (item) => ({
        name:
          item.name,

        slug:
          item.slug,

        city:
          item.city,

        state:
          item.state,

        country:
          item.country,

        country_name:
          item.country_name,

        address:
          item.address,

        events_count:
          item.events_count,

        latitude:
          item.latitude,

        longitude:
          item.longitude,
      })
    );

  const algarveInventory =
    algarve.map(
      (item) => ({
        name:
          item.name,

        slug:
          item.slug,

        city:
          item.city,

        state:
          item.state,

        country:
          item.country,

        country_name:
          item.country_name,

        events_count:
          item.events_count,

        latitude:
          item.latitude,

        longitude:
          item.longitude,
      })
    );

  return jsonResponse({
    ok: true,

    fetched_at:
      new Date().toISOString(),

    test: {
      purpose:
        "Inspect the IMAX Algolia showtimes index without assuming how country filtering is configured.",

      mode:
        q
          ? "text_search"
          : "broad_index_sample",

      query:
        searchQuery,

      algolia_filter:
        null,

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
        null,

      processing_time_ms:
        result.data
          ?.processingTimeMS ??
        null,
    },

    /*
     * VERY IMPORTANT DIAGNOSTIC:
     *
     * Show us what country fields actually
     * contain.
     */
    observed_country_values:
      countryValues,

    /*
     * Portugal records identified from the
     * returned data.
     */
    portugal_theatre_count:
      portugalInventory.length,

    portugal_theatre_inventory:
      portugalInventory,

    /*
     * Algarve question.
     */
    algarve_theatre_count:
      algarveInventory.length,

    algarve_theatre_inventory:
      algarveInventory,

    /*
     * Keep the complete compact summary so
     * we can inspect unexpected records.
     */
    all_results_summary:
      summary,

    /*
     * We intentionally do NOT return all raw
     * events in this version.
     *
     * With up to 1000 theatres, raw_hits could
     * make the diagnostic response enormous.
     *
     * We already proved individual theatre
     * records contain the movie/showtime data.
     */
    raw_hits_returned:
      false,

    next_step:
      "Use the observed schema to determine Portugal coverage. If Algarve NOS cinemas are absent from IMAX, investigate NOS's own data source as a separate provider.",
  });
}

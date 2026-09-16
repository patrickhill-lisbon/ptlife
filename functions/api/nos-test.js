/*
 * PTLife — NOS Movie Identity Diagnostic
 *
 * READ ONLY.
 * No D1 writes.
 *
 * Purpose:
 * Determine relationship between:
 *   uuid
 *   aggregateformatnumber
 *   aggregatetitle
 *   title
 *   format
 *   version
 */

const MOVIES_URL =
  "https://www.cinemas.nos.pt/graphql/execute.json/cinemas/getMoviesInTheaters";


function respond(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=utf-8",
        "cache-control":
          "no-store"
      }
    }
  );
}


function findMovies(data) {
  const candidates = [
    data?.data?.movieList?.items,
    data?.data?.moviesList?.items,
    data?.data?.movies?.items,
    data?.movieList?.items,
    data?.movies?.items
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return null;
}


export async function onRequestGet() {

  const started =
    Date.now();

  try {

    const response =
      await fetch(
        MOVIES_URL,
        {
          headers: {
            accept:
              "application/json"
          }
        }
      );


    const text =
      await response.text();


    if (!response.ok) {
      return respond({
        ok: false,
        stage: "catalogue_http",
        http_status: response.status,
        preview: text.slice(0, 1000)
      });
    }


    let data;

    try {
      data =
        JSON.parse(text);
    } catch {
      return respond({
        ok: false,
        stage: "catalogue_json",
        preview: text.slice(0, 1000)
      });
    }


    const movies =
      findMovies(data);


    if (!movies) {
      return respond({
        ok: false,
        stage: "movie_array_not_found",
        top_fields:
          Object.keys(data || {}),
        data_fields:
          Object.keys(
            data?.data || {}
          )
      });
    }


    /*
     * Produce compact records.
     */

    const records =
      movies.map(
        (movie, index) => ({
          index,

          uuid:
            movie?.uuid ?? null,

          aggregateformatnumber:
            movie?.aggregateformatnumber ??
            null,

          aggregatetitle:
            movie?.aggregatetitle ??
            null,

          title:
            movie?.title ?? null,

          originaltitle:
            movie?.originaltitle ??
            null,

          format:
            movie?.format ?? null,

          version:
            movie?.version ?? null,

          duration:
            movie?.duration ?? null,

          classification:
            movie?.classification ??
            null,

          detailurl:
            movie?.detailurl ?? null
        })
      );


    /*
     * Group by aggregateformatnumber.
     *
     * If several catalogue rows share the same
     * aggregateformatnumber, we want to see them
     * together.
     */

    const aggregateGroups =
      new Map();


    for (const movie of records) {

      const key =
        movie.aggregateformatnumber ||
        "(null)";


      if (!aggregateGroups.has(key)) {
        aggregateGroups.set(
          key,
          []
        );
      }


      aggregateGroups
        .get(key)
        .push(movie);
    }


    const repeatedAggregateGroups =
      [];


    for (
      const [aggregateId, items]
      of aggregateGroups.entries()
    ) {

      if (items.length > 1) {
        repeatedAggregateGroups.push({
          aggregateformatnumber:
            aggregateId,

          count:
            items.length,

          items
        });
      }
    }


    /*
     * Also group by aggregate title.
     *
     * This helps reveal cases where the same
     * underlying film has separate aggregate IDs
     * for IMAX / standard / dubbed / etc.
     */

    const titleGroups =
      new Map();


    for (const movie of records) {

      const key =
        (
          movie.aggregatetitle ||
          movie.originaltitle ||
          movie.title ||
          "(untitled)"
        )
        .trim()
        .toLowerCase();


      if (!titleGroups.has(key)) {
        titleGroups.set(
          key,
          []
        );
      }


      titleGroups
        .get(key)
        .push(movie);
    }


    const repeatedTitleGroups =
      [];


    for (
      const [key, items]
      of titleGroups.entries()
    ) {

      if (items.length > 1) {

        repeatedTitleGroups.push({
          normalized_title:
            key,

          count:
            items.length,

          aggregate_ids:
            [
              ...new Set(
                items.map(
                  item =>
                    item.aggregateformatnumber
                )
              )
            ],

          items
        });
      }
    }


    return respond({
      ok: true,

      diagnostic:
        "NOS movie identity",

      writes_to_d1:
        false,

      fetched_at:
        new Date().toISOString(),

      duration_ms:
        Date.now() - started,

      movie_rows:
        records.length,

      unique_movie_uuids:
        new Set(
          records.map(
            movie =>
              movie.uuid
          )
        ).size,

      unique_aggregate_ids:
        new Set(
          records.map(
            movie =>
              movie.aggregateformatnumber
          )
        ).size,

      repeated_aggregate_group_count:
        repeatedAggregateGroups.length,

      repeated_title_group_count:
        repeatedTitleGroups.length,

      /*
       * First 30 is currently the complete
       * catalogue we observed, but keeping the
       * slice makes the diagnostic manageable
       * if NOS expands it.
       */

      movies:
        records.slice(0, 30),

      repeated_aggregate_groups:
        repeatedAggregateGroups,

      repeated_title_groups:
        repeatedTitleGroups,

      question:
        "Does aggregateformatnumber represent the underlying film, a particular format/version, or another NOS grouping?"
    });


  } catch (error) {

    return respond({
      ok: false,

      graceful_failure:
        true,

      stage:
        "diagnostic_exception",

      message:
        error?.message ||
        String(error),

      stack:
        error?.stack || null,

      writes_to_d1:
        false,

      duration_ms:
        Date.now() - started
    });
  }
}

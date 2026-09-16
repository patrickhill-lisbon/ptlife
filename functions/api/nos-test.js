/*
 * PTLife — Cinemas NOS Deduplicated Diagnostic
 *
 * Purpose:
 * 1. Fetch NOS movie catalogue
 * 2. Deduplicate movies by aggregateformatnumber
 * 3. Fetch each unique movie's sessions only once
 * 4. Extract Colombo sessions
 * 5. Deduplicate sessions
 * 6. Measure performance
 *
 * NO D1 WRITES.
 */

const NOS_ORIGIN = "https://www.cinemas.nos.pt";

const MOVIES_URL =
  NOS_ORIGIN +
  "/graphql/execute.json/cinemas/getMoviesInTheaters";

const SESSIONS_BASE =
  NOS_ORIGIN +
  "/bin/cinemas/render/" +
  "getMovieSessions.getMovieSessionsAggregator.json";

const COLOMBO_ID =
  "e0ea3044-4a1b-46b1-bca2-69fd8eae16d7";

const BATCH_SIZE = 5;


function respond(data, status = 200) {
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


async function getJson(url) {
  const started = Date.now();

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
    },
  });

  const text = await response.text();

  let data = null;

  try {
    data = JSON.parse(text);
  } catch {
    // caller handles invalid JSON
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    preview: text.slice(0, 1000),
    duration_ms: Date.now() - started,
  };
}


function findMovies(data) {
  const candidates = [
    data?.data?.movieList?.items,
    data?.data?.moviesList?.items,
    data?.data?.movies?.items,
    data?.movieList?.items,
    data?.movies?.items,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return null;
}


function valueByName(obj, wanted) {
  if (!obj || typeof obj !== "object") {
    return null;
  }

  const target = wanted.toLowerCase();

  for (const [key, value] of Object.entries(obj)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }

  return null;
}


function getAggregateId(movie) {
  return (
    valueByName(movie, "aggregateformatnumber") ||
    valueByName(movie, "aggregateMovieId") ||
    valueByName(movie, "aggregateMovieID") ||
    null
  );
}


function getTitle(movie) {
  return (
    valueByName(movie, "aggregatetitle") ||
    valueByName(movie, "title") ||
    valueByName(movie, "name") ||
    valueByName(movie, "originalTitle") ||
    null
  );
}


/*
 * Run promises in controlled batches.
 */
async function runBatches(items, batchSize, worker) {
  const results = [];

  for (
    let i = 0;
    i < items.length;
    i += batchSize
  ) {
    const batch =
      items.slice(i, i + batchSize);

    const batchResults =
      await Promise.all(
        batch.map(worker)
      );

    results.push(...batchResults);
  }

  return results;
}


export async function onRequestGet(context) {
  const totalStarted = Date.now();

  /*
   * -----------------------------------------
   * STEP 1 — FETCH CATALOGUE
   * -----------------------------------------
   */

  let catalogue;

  try {
    catalogue = await getJson(MOVIES_URL);
  } catch (error) {
    return respond({
      ok: false,
      graceful_failure: true,
      stage: "catalogue_fetch_exception",
      error: String(error),
    });
  }


  if (!catalogue.ok || !catalogue.data) {
    return respond({
      ok: false,
      graceful_failure: true,
      stage: "catalogue_failure",
      http_status: catalogue.status,
      preview: catalogue.preview,
    });
  }


  const movies =
    findMovies(catalogue.data);


  if (!movies) {
    return respond({
      ok: false,
      graceful_failure: true,
      stage: "movie_array_not_found",
      preview:
        JSON.stringify(
          catalogue.data
        ).slice(0, 3000),
    });
  }


  /*
   * -----------------------------------------
   * STEP 2 — GROUP BY AGGREGATE MOVIE ID
   * -----------------------------------------
   *
   * NOS may expose several catalogue records
   * for the same underlying movie:
   *
   * normal
   * IMAX
   * ATMOS
   * 3D
   * XL Vision
   * etc.
   *
   * We only need ONE sessions request for
   * each aggregate movie ID.
   */

  const aggregateMap = new Map();

  let moviesWithoutAggregateId = 0;


  for (const movie of movies) {
    const aggregateId =
      getAggregateId(movie);

    if (!aggregateId) {
      moviesWithoutAggregateId++;
      continue;
    }


    if (!aggregateMap.has(aggregateId)) {
      aggregateMap.set(
        aggregateId,
        {
          aggregate_id:
            aggregateId,

          title:
            getTitle(movie),

          catalogue_variants: [],
        }
      );
    }


    aggregateMap
      .get(aggregateId)
      .catalogue_variants
      .push({
        uuid:
          valueByName(movie, "uuid"),

        title:
          valueByName(movie, "title"),

        format:
          valueByName(movie, "format"),

        version:
          valueByName(movie, "version"),
      });
  }


  const uniqueMovies =
    Array.from(
      aggregateMap.values()
    );


  /*
   * -----------------------------------------
   * STEP 3 — FETCH EACH UNIQUE MOVIE ONCE
   * -----------------------------------------
   */

  const fetchResults =
    await runBatches(
      uniqueMovies,
      BATCH_SIZE,

      async movie => {
        const url =
          SESSIONS_BASE +
          "?aggregateMovieId=" +
          encodeURIComponent(
            movie.aggregate_id
          );

        try {
          const result =
            await getJson(url);

          return {
            movie,
            url,
            ...result,
          };
        } catch (error) {
          return {
            movie,
            url,
            ok: false,
            status: null,
            data: null,
            duration_ms: null,
            error: String(error),
          };
        }
      }
    );


  /*
   * -----------------------------------------
   * STEP 4 — EXTRACT COLOMBO SESSIONS
   * -----------------------------------------
   */

  const rawSessions = [];

  const failures = [];


  for (const result of fetchResults) {

    if (!result.ok || !result.data) {
      failures.push({
        aggregate_movie_id:
          result.movie.aggregate_id,

        title:
          result.movie.title,

        status:
          result.status,

        error:
          result.error || null,

        preview:
          result.preview || null,
      });

      continue;
    }


    const days =
      Array.isArray(result.data?.days)
        ? result.data.days
        : [];


    for (const day of days) {

      const theaters =
        Array.isArray(day?.theaters)
          ? day.theaters
          : [];


      for (const theater of theaters) {

        const theaterId =
          theater?.theaterId ||
          theater?.theaterID ||
          null;


        if (theaterId !== COLOMBO_ID) {
          continue;
        }


        const sessions =
          Array.isArray(theater?.sessions)
            ? theater.sessions
            : [];


        for (const session of sessions) {

          rawSessions.push({
            aggregate_movie_id:
              result.movie.aggregate_id,

            movie:
              result.movie.title,

            catalogue_variants:
              result.movie
                .catalogue_variants
                .length,

            day_name:
              day?.name || null,

            theater:
              theater?.name || null,

            theater_id:
              theaterId,

            session_uuid:
              session?.uuid || null,

            time:
              session?.time || null,

            operational_date:
              session?.operationalDate ||
              null,

            room:
              session?.room || null,

            description:
              session?.description ||
              null,

            type:
              session?.type || null,

            format:
              session?.format || null,

            version:
              session?.version || null,
          });
        }
      }
    }
  }


  /*
   * -----------------------------------------
   * STEP 5 — DEDUPLICATE SESSIONS
   * -----------------------------------------
   *
   * Primary key:
   * session UUID.
   *
   * Fallback key is included in case NOS ever
   * returns a session without a UUID.
   */

  const sessionMap =
    new Map();


  for (const session of rawSessions) {

    const key =
      session.session_uuid ||
      [
        session.aggregate_movie_id,
        session.operational_date,
        session.time,
        session.theater_id,
        session.description,
      ].join("|");


    if (!sessionMap.has(key)) {
      sessionMap.set(
        key,
        session
      );
    }
  }


  const uniqueSessions =
    Array.from(
      sessionMap.values()
    );


  /*
   * -----------------------------------------
   * STEP 6 — SORT
   * -----------------------------------------
   */

  uniqueSessions.sort(
    (a, b) => {

      const dateA =
        `${a.operational_date || ""} ${a.time || ""}`;

      const dateB =
        `${b.operational_date || ""} ${b.time || ""}`;

      return dateA.localeCompare(dateB);
    }
  );


  /*
   * -----------------------------------------
   * STEP 7 — TIMING STATISTICS
   * -----------------------------------------
   */

  const requestDurations =
    fetchResults
      .map(r => r.duration_ms)
      .filter(
        n => Number.isFinite(n)
      );


  const slowestRequests =
    fetchResults
      .filter(
        r =>
          Number.isFinite(
            r.duration_ms
          )
      )
      .sort(
        (a, b) =>
          b.duration_ms -
          a.duration_ms
      )
      .slice(0, 10)
      .map(r => ({
        title:
          r.movie.title,

        aggregate_movie_id:
          r.movie.aggregate_id,

        duration_ms:
          r.duration_ms,

        status:
          r.status,
      }));


  /*
   * -----------------------------------------
   * SUCCESS
   * -----------------------------------------
   */

  return respond({
    ok: failures.length === 0,

    diagnostic_test: true,

    writes_to_d1: false,

    test:
      "NOS deduplicated Colombo schedule",

    duration_ms:
      Date.now() - totalStarted,

    configuration: {
      batch_size:
        BATCH_SIZE,

      target_theater_id:
        COLOMBO_ID,
    },

    catalogue: {
      http_status:
        catalogue.status,

      fetch_duration_ms:
        catalogue.duration_ms,

      catalogue_records:
        movies.length,

      records_without_aggregate_id:
        moviesWithoutAggregateId,

      unique_aggregate_movies:
        uniqueMovies.length,

      duplicate_catalogue_records_eliminated:
        movies.length -
        uniqueMovies.length -
        moviesWithoutAggregateId,
    },

    requests: {
      old_expected_requests:
        movies.length,

      actual_requests:
        uniqueMovies.length,

      successful:
        fetchResults.filter(
          r => r.ok
        ).length,

      failed:
        failures.length,

      failures,

      average_duration_ms:
        requestDurations.length
          ? Math.round(
              requestDurations.reduce(
                (a, b) => a + b,
                0
              ) /
              requestDurations.length
            )
          : null,

      slowest_requests:
        slowestRequests,
    },

    colombo: {
      raw_sessions:
        rawSessions.length,

      unique_sessions:
        uniqueSessions.length,

      duplicate_sessions_eliminated:
        rawSessions.length -
        uniqueSessions.length,

      schedule:
        uniqueSessions,
    },

    success:
      (
        uniqueMovies.length > 0 &&
        failures.length === 0 &&
        uniqueSessions.length > 0
      ),

    next_step:
      "Compare duration, unique aggregate movie count, raw sessions, and unique sessions with the previous diagnostic.",
  });
}

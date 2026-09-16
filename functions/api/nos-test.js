/*
 * PTLife — Cinemas NOS End-to-End Test v2
 *
 * Diagnostic only.
 * No D1 writes.
 */

const NOS_ORIGIN = "https://www.cinemas.nos.pt";

const MOVIES_URL =
  NOS_ORIGIN +
  "/graphql/execute.json/cinemas/getMoviesInTheaters";

const SESSIONS_BASE =
  NOS_ORIGIN +
  "/bin/cinemas/render/" +
  "getMovieSessions.getMovieSessionsAggregator.json";


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
    // handled by caller
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    preview: text.slice(0, 1000),
  };
}


function findMovies(data) {
  /*
   * We know NOS returns:
   *
   * data
   *   -> movieList
   *      -> items
   *
   * But keep a few harmless fallbacks while
   * we confirm the exact property name.
   */

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
    valueByName(movie, "title") ||
    valueByName(movie, "name") ||
    valueByName(movie, "originalTitle") ||
    null
  );
}


export async function onRequestGet(context) {
  /*
   * -----------------------------------------
   * STEP 1 — GET MOVIE CATALOGUE
   * -----------------------------------------
   */

  let catalogue;

  try {
    catalogue = await getJson(MOVIES_URL);
  } catch (error) {
    return respond({
      ok: false,
      stage: "catalogue_fetch_exception",
      error: String(error),
    }, 500);
  }


  if (!catalogue.ok) {
    return respond({
      ok: false,
      stage: "catalogue_http",
      status: catalogue.status,
      preview: catalogue.preview,
    }, 500);
  }


  if (!catalogue.data) {
    return respond({
      ok: false,
      stage: "catalogue_json",
      preview: catalogue.preview,
    }, 500);
  }


  /*
   * -----------------------------------------
   * STEP 2 — LOCATE MOVIES
   * -----------------------------------------
   */

  const movies = findMovies(catalogue.data);


  if (!movies) {
    return respond({
      ok: false,

      stage: "movie_array_not_found",

      data_fields:
        Object.keys(catalogue.data || {}),

      inner_data_fields:
        Object.keys(
          catalogue.data?.data || {}
        ),

      preview:
        JSON.stringify(
          catalogue.data
        ).slice(0, 3000),
    }, 500);
  }


  /*
   * -----------------------------------------
   * STEP 3 — FIND FIRST USABLE MOVIE
   * -----------------------------------------
   */

  let selected = null;
  let aggregateId = null;


  for (const movie of movies) {
    const id = getAggregateId(movie);

    if (id) {
      selected = movie;
      aggregateId = id;
      break;
    }
  }


  if (!selected) {
    return respond({
      ok: false,

      stage: "aggregate_id_not_found",

      movie_count: movies.length,

      first_movie_fields:
        Object.keys(
          movies[0] || {}
        ),

      first_movie:
        movies[0] || null,
    }, 500);
  }


  /*
   * -----------------------------------------
   * STEP 4 — FETCH SESSIONS
   * -----------------------------------------
   */

  const sessionsUrl =
    SESSIONS_BASE +
    "?aggregateMovieId=" +
    encodeURIComponent(aggregateId);


  let sessionResult;


  try {
    sessionResult =
      await getJson(sessionsUrl);
  } catch (error) {
    return respond({
      ok: false,

      stage: "sessions_fetch_exception",

      movie: getTitle(selected),

      aggregate_movie_id:
        aggregateId,

      error: String(error),
    }, 500);
  }


  if (!sessionResult.ok) {
    return respond({
      ok: false,

      stage: "sessions_http",

      movie: getTitle(selected),

      aggregate_movie_id:
        aggregateId,

      status:
        sessionResult.status,

      preview:
        sessionResult.preview,
    }, 500);
  }


  if (!sessionResult.data) {
    return respond({
      ok: false,

      stage: "sessions_json",

      movie: getTitle(selected),

      aggregate_movie_id:
        aggregateId,

      preview:
        sessionResult.preview,
    }, 500);
  }


  /*
   * -----------------------------------------
   * STEP 5 — READ KNOWN NOS SESSION STRUCTURE
   * -----------------------------------------
   */

  const days =
    Array.isArray(sessionResult.data?.days)
      ? sessionResult.data.days
      : [];


  let theaterAppearances = 0;
  let sessionCount = 0;

  const theaters = new Map();

  const samples = [];


  for (const day of days) {

    const dayTheaters =
      Array.isArray(day?.theaters)
        ? day.theaters
        : [];


    theaterAppearances +=
      dayTheaters.length;


    for (const theater of dayTheaters) {

      const theaterId =
        theater?.theaterId ||
        theater?.theaterID ||
        theater?.name;


      if (!theaters.has(theaterId)) {
        theaters.set(theaterId, {
          name:
            theater?.name || null,

          theater_id:
            theater?.theaterId ||
            theater?.theaterID ||
            null,

          region_id:
            theater?.regionId ||
            theater?.regionID ||
            null,

          location:
            theater?.location ||
            null,
        });
      }


      const sessions =
        Array.isArray(theater?.sessions)
          ? theater.sessions
          : [];


      sessionCount += sessions.length;


      for (const session of sessions) {

        if (samples.length >= 20) {
          continue;
        }

        samples.push({
          day:
            day?.name || null,

          theater:
            theater?.name || null,

          theater_id:
            theater?.theaterId ||
            theater?.theaterID ||
            null,

          session_uuid:
            session?.uuid || null,

          time:
            session?.time || null,

          operational_date:
            session?.operationalDate ||
            null,

          type:
            session?.type || null,

          description:
            session?.description ||
            null,

          format:
            session?.format || null,

          version:
            session?.version || null,
        });
      }
    }
  }


  /*
   * -----------------------------------------
   * SUCCESS
   * -----------------------------------------
   */

  return respond({
    ok: true,

    fetched_at:
      new Date().toISOString(),

    test:
      "NOS automatic catalogue-to-sessions pipeline",

    writes_to_d1:
      false,

    catalogue: {
      status:
        catalogue.status,

      movie_count:
        movies.length,
    },

    selected_movie: {
      title:
        getTitle(selected),

      uuid:
        valueByName(
          selected,
          "uuid"
        ),

      aggregate_movie_id:
        aggregateId,

      fields:
        Object.keys(selected),
    },

    sessions_request: {
      status:
        sessionResult.status,

      url:
        sessionsUrl,
    },

    result: {
      days:
        days.length,

      unique_theaters:
        theaters.size,

      theater_appearances:
        theaterAppearances,

      sessions:
        sessionCount,
    },

    theaters:
      Array.from(
        theaters.values()
      ),

    session_sample:
      samples,

    raw_session_fields:
      Object.keys(
        sessionResult.data || {}
      ),

    success:
      (
        movies.length > 0 &&
        Boolean(aggregateId) &&
        days.length > 0 &&
        sessionCount > 0
      ),

    next_step:
      "If success is true, back-test Colombo and Algarve before building the NOS production adapter.",
  });
}

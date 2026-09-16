/*
 * WorthAGo — Bounded Concurrency Utilities
 *
 * Copyright © 2026 Patrick J. Hill
 * All rights reserved.
 *
 * Generic infrastructure for running asynchronous work
 * while limiting the number of operations simultaneously
 * in flight.
 *
 * This module contains no provider-specific knowledge.
 */


/*
 * mapWithConcurrency(items, concurrency, worker)
 *
 * Similar conceptually to:
 *
 *   Promise.all(items.map(worker))
 *
 * except only `concurrency` workers may execute at once.
 *
 * Important properties:
 *
 *   - preserves input ordering in returned results
 *   - stops assigning new work after a worker failure
 *   - rejects if any worker throws
 *   - does not silently swallow errors
 *   - never creates more workers than necessary
 *
 * Example:
 *
 *   const results =
 *     await mapWithConcurrency(
 *       movies,
 *       3,
 *       movie => fetchMovie(movie)
 *     );
 */

export async function mapWithConcurrency(
  items,
  concurrency,
  worker
) {
  if (!Array.isArray(items)) {
    throw new TypeError(
      "mapWithConcurrency requires an array"
    );
  }


  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1
  ) {
    throw new TypeError(
      "mapWithConcurrency requires concurrency >= 1"
    );
  }


  if (typeof worker !== "function") {
    throw new TypeError(
      "mapWithConcurrency requires a worker function"
    );
  }


  if (items.length === 0) {
    return [];
  }


  const results =
    new Array(items.length);


  /*
   * JavaScript execution within a Worker is single-threaded,
   * so incrementing this counter before awaiting the worker
   * gives each runner a unique item index.
   */

  let nextIndex = 0;

  let failure = null;


  async function runner() {
    while (true) {

      /*
       * Once one worker has failed, don't begin additional
       * provider operations.
       *
       * Operations already in flight cannot necessarily be
       * cancelled here and are allowed to finish.
       */

      if (failure) {
        return;
      }


      const index =
        nextIndex;


      if (index >= items.length) {
        return;
      }


      nextIndex += 1;


      try {
        results[index] =
          await worker(
            items[index],
            index,
            items
          );
      } catch (error) {

        /*
         * Preserve the first failure.
         */

        if (!failure) {
          failure = error;
        }

        return;
      }
    }
  }


  const workerCount =
    Math.min(
      concurrency,
      items.length
    );


  const runners =
    Array.from(
      {
        length:
          workerCount
      },
      () => runner()
    );


  /*
   * runner() catches provider/worker failures so that every
   * already-running runner has a chance to settle cleanly.
   */

  await Promise.all(
    runners
  );


  if (failure) {
    throw failure;
  }


  return results;
}

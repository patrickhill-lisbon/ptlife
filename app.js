// PTLife v2
// Filtering + accessible text-size preferences

document.addEventListener("DOMContentLoaded", () => {

  const root = document.documentElement;

  // -------------------------
  // TEXT SIZE
  // -------------------------

  const savedScale = localStorage.getItem("ptlife-text-scale");

  if (savedScale) {
    root.style.setProperty("--text-scale", savedScale);
  }

  function setTextScale(scale) {
    root.style.setProperty("--text-scale", scale);
    localStorage.setItem("ptlife-text-scale", scale);
  }

  document
    .getElementById("text-smaller")
    ?.addEventListener("click", () => setTextScale("0.9"));

  document
    .getElementById("text-normal")
    ?.addEventListener("click", () => setTextScale("1"));

  document
    .getElementById("text-larger")
    ?.addEventListener("click", () => setTextScale("1.25"));


  // -------------------------
  // TIME FILTERS
  // -------------------------

  const timeButtons =
    document.querySelectorAll(".filter-button");

  const regularEvents =
    document.querySelectorAll("#event-list .event-card");

  const planSection =
    document.getElementById("plan-ahead");

  const eventHeading =
    document.getElementById("event-heading");


  function showTime(time) {

    timeButtons.forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.filter === time
      );
    });


    // PLAN AHEAD
    if (time === "plan") {

      planSection.hidden = false;

      regularEvents.forEach(event => {
        event.hidden = true;
      });

      eventHeading.textContent = "Plan Ahead";

      planSection.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });

      return;
    }


    // ALL EVENTS
    if (time === "all") {

      planSection.hidden = false;

      regularEvents.forEach(event => {
        event.hidden = false;
      });

      eventHeading.textContent = "All Lisbon Events";

      return;
    }


    // NORMAL TIME FILTER
    planSection.hidden = true;

    regularEvents.forEach(event => {

      const eventTime =
        event.dataset.time;

      if (time === "week") {

        event.hidden = ![
          "today",
          "tomorrow",
          "weekend"
        ].includes(eventTime);

      } else {

        event.hidden =
          eventTime !== time;

      }

    });


    const headings = {
      today: "Today in Lisbon",
      tomorrow: "Tomorrow in Lisbon",
      weekend: "This Weekend in Lisbon",
      week: "This Week in Lisbon"
    };

    eventHeading.textContent =
      headings[time] || "Lisbon Events";
  }


  timeButtons.forEach(button => {

    button.addEventListener("click", () => {
      showTime(button.dataset.filter);
    });

  });


  // -------------------------
  // CATEGORY FILTERS
  // -------------------------

  const categoryButtons =
    document.querySelectorAll(
      "[data-category-filter]"
    );

  const allCards =
    document.querySelectorAll(".event-card");


  categoryButtons.forEach(button => {

    button.addEventListener("click", () => {

      const category =
        button.dataset.categoryFilter;

      // Show all relevant sections
      planSection.hidden = false;

      allCards.forEach(card => {

        if (category === "all") {
          card.hidden = false;
        } else {
          card.hidden =
            card.dataset.category !== category;
        }

      });

      timeButtons.forEach(button => {
        button.classList.remove("active");
      });

      eventHeading.textContent =
        category === "all"
          ? "All Lisbon Events"
          : "Events by Interest";

      window.scrollTo({
        top: planSection.offsetTop - 20,
        behavior: "smooth"
      });

    });

  });


  // Start with Today selected
  showTime("today");

});

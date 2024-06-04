document.addEventListener("DOMContentLoaded", function () {
  // Create the magnifying glass emoji button
  const magnifyingGlass = document.createElement("div");
  magnifyingGlass.innerHTML = "🔍";
  magnifyingGlass.className =
    "fixed bottom-2 right-2 cursor-pointer text-2xl z-50";
  document.body.appendChild(magnifyingGlass);

  let highlighted = false;

  // Function to highlight elements
  function highlightElements() {
    const modal = document.createElement("div");
    modal.id = "inspector-modal";
    document.body.appendChild(modal);

    const elements = document.querySelectorAll("[data-bliss-route]");
    elements.forEach((el) => {
      if (!el.classList.contains("highlighted")) {
        el.classList.add(
          "border-2",
          "border-yellow-500",
          "relative",
          "highlighted",
          "p-2"
        );
        let controls = document.createElement("div");
        controls.className =
          "flex absolute gap-1 -bottom-3 right-0 inspector-controls";

        // Create the edit icon
        const editIcon = document.createElement("a");
        editIcon.href = el.getAttribute("data-bliss-route");
        editIcon.innerHTML = "✏️";
        editIcon.className =
          "text-lg bg-white rounded-full p-1 shadow edit-icon";
        controls.appendChild(editIcon);

        // Create the copy icon
        if (el.getAttribute("data-bliss-copy")) {
          const copyIcon = document.createElement("button");
          copyIcon.innerHTML = "📋";
          copyIcon.className =
            "text-lg bg-white rounded-full p-1 shadow copy-icon";
          controls.appendChild(copyIcon);
          copyIcon.addEventListener("click", () => {
            navigator.clipboard
              .writeText(el.getAttribute("data-bliss-copy"))
              .then(() => {
                copyIcon.innerHTML = "✅";
              })
              .catch((err) => {
                copyIcon.innerHTML = "❌";
              });
          });
        }

        // Create the clone icon
        const cloneIcon = document.createElement("div");
        cloneIcon.innerHTML = "👯‍♀️";
        cloneIcon.className =
          "text-lg bg-white rounded-full cursor-pointer p-1 shadow clone-icon";
        cloneIcon.setAttribute("hx-get", el.getAttribute("data-bliss-clone"));
        cloneIcon.setAttribute("hx-target", "#inspector-modal");

        controls.setAttribute(
          "_",
          `on mouseover set my.style.zIndex to 10000
                                     on mouseout set my.style.zIndex to "initial"
                                     `
        );
        controls.appendChild(cloneIcon);

        el.appendChild(controls);
        htmx.process(controls);
        _hyperscript.processNode(controls);
      }
    });
  }

  // Function to remove highlights
  function removeHighlights() {
    const elements = document.querySelectorAll(
      "[data-bliss-route].highlighted"
    );
    elements.forEach((el) => {
      el.classList.remove(
        "border-2",
        "border-yellow-500",
        "relative",
        "highlighted",
        "p-2"
      );
      el.querySelectorAll(".inspector-controls").forEach((el) => el.remove());
    });
  }

  magnifyingGlass.addEventListener("click", function () {
    if (!highlighted) {
      highlightElements();
      magnifyingGlass.innerHTML = "❌";
    } else {
      removeHighlights();
      magnifyingGlass.innerHTML = "🔍";
    }
    highlighted = !highlighted;
  });

  // Observe the document for changes
  //   const observer = new MutationObserver(function (mutations) {
  //     if (highlighted) {
  //       highlightElements();
  //     }
  //   });

  //   // Configure the observer
  //   observer.observe(document.body, {
  //     childList: true,
  //     subtree: true,
  //   });
});

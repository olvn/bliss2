document.addEventListener("DOMContentLoaded", function() {
    console.log("supp", document.location)
  // Create the magnifying glass emoji button
  const magnifyingGlass = document.createElement('div');
  magnifyingGlass.innerHTML = '🔍';
  magnifyingGlass.className = 'fixed top-2 right-2 cursor-pointer text-2xl z-50';
  document.body.appendChild(magnifyingGlass);

  let highlighted = false;

  // Function to highlight elements
  function highlightElements() {
    const elements = document.querySelectorAll('[data-bliss-route]');
    elements.forEach(el => {
      if (!el.classList.contains('highlighted')) {
        el.classList.add('border-2', 'border-yellow-500', 'relative', 'highlighted');

        // Create the edit icon
        const editIcon = document.createElement('a');
        editIcon.href = el.getAttribute('data-bliss-route');
        editIcon.innerHTML = '✏️';
        editIcon.className = 'absolute text-lg bg-white rounded-full p-1 shadow -bottom-3 -right-3';
        el.appendChild(editIcon);
      }
    });
  }

  // Function to remove highlights
  function removeHighlights() {
    const elements = document.querySelectorAll('[data-bliss-route].highlighted');
    elements.forEach(el => {
      el.classList.remove('border-2', 'border-yellow-500', 'relative', 'highlighted');
      const editIcon = el.querySelector('a');
      if (editIcon) {
        el.removeChild(editIcon);
      }
    });
  }

  magnifyingGlass.addEventListener('click', function() {
    if (!highlighted) {
      highlightElements();
      magnifyingGlass.innerHTML = '❌';
    } else {
      removeHighlights();
      magnifyingGlass.innerHTML = '🔍';
    }
    highlighted = !highlighted;
  });

  // Observe the document for changes
  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      if (highlighted) {
        highlightElements();
      }
    });
  });

  // Configure the observer
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
});
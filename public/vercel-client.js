/* Small uploads and presence polling for stateless hosting. */
(function () {
  'use strict';
  function show(message) { window.alert(message); }
  document.addEventListener('change', function (event) {
    if (!event.target.matches('input[type=file]')) return;
    var total = Array.from(event.target.files || []).reduce(function (n, f) { return n + f.size; }, 0);
    if (total > 3.8 * 1024 * 1024) { event.target.value = ''; show('Total file maksimal 3,8 MB di Vercel. Gunakan URL cloud untuk file lebih besar.'); }
  }, true);
  document.addEventListener('submit', function (event) {
    var total = 0;
    event.target.querySelectorAll('input[type=file]').forEach(function (input) {
      Array.from(input.files || []).forEach(function (file) { total += file.size; });
    });
    if (total > 3.8 * 1024 * 1024) { event.preventDefault(); event.stopImmediatePropagation(); show('Total file dalam satu formulir maksimal 3,8 MB di Vercel.'); }
  }, true);
})();

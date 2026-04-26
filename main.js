  // =============================================================================
  // STATE
  // =============================================================================

  let studentEntries = [];
  let creditPool     = 0;
  let changes        = [];
  let remaining      = [];

  // =============================================================================
  // RENDER
  // =============================================================================

  /**
   * Renders the credit pool value and rebuilds the students table rows from state.
   * Called once on load and after every credit adjustment.
   */
  function render() {
    document.getElementById('credit-pool-value').textContent = creditPool;

    const tbody = document.getElementById('students-tbody');
    tbody.innerHTML = '';

    studentEntries.forEach((student, i) => {
      const totalCredits     = student.private_classes_allowed;
      const usedCredits      = totalCredits - student.private_classes_remaining;
      const currentRemaining = remaining[i];
      const currentChange    = changes[i];
      const canDecrease      = currentRemaining > 0;
      const canIncrease      = creditPool > 0;

      const changeText  = currentChange > 0 ? `+${currentChange}` : `${currentChange}`;
      const changeClass = currentChange > 0 ? 'change-positive' : (currentChange < 0 ? 'change-negative' : 'change-zero');

      const row = document.createElement('tr');
      row.innerHTML = `
        <td class="name-cell">${student.name}</td>
        <td>${totalCredits}</td>
        <td>${usedCredits}</td>
        <td>${currentRemaining}</td>
        <td><button class="btn-adjust minus" data-index="${i}" data-delta="-1" ${canDecrease ? '' : 'disabled'}>&#9660;</button></td>
        <td><button class="btn-adjust plus"  data-index="${i}" data-delta="1"  ${canIncrease ? '' : 'disabled'}>&#9650;</button></td>
        <td class="${changeClass}">${changeText}</td>
      `;
      tbody.appendChild(row);
    });
  }

  // =============================================================================
  // EVENT HANDLERS
  // =============================================================================

  // Delegated click handler for all ▼ / ▲ adjust buttons in the students table.
  // Credit pool and student remaining move inversely — pool cannot go below 0,
  // student remaining cannot go below 0.
  document.getElementById('students-tbody').addEventListener('click', function(e) {
    const button = e.target.closest('.btn-adjust');
    if (!button || button.disabled) return;

    const index = parseInt(button.dataset.index, 10);
    const delta = parseInt(button.dataset.delta, 10);
    const newRemaining = remaining[index] + delta;
    const newPool      = creditPool - delta;

    if (newRemaining < 0) return;
    if (newPool < 0) return;

    remaining[index] = newRemaining;
    creditPool       = newPool;
    changes[index]  += delta;
    render();
  });

  document.getElementById('btn-clear-log').addEventListener('click', function() {
    document.getElementById('log-output').value = '';
  });

  document.getElementById('btn-copy-log').addEventListener('click', function() {
    const logTextarea = document.getElementById('log-output');
    navigator.clipboard.writeText(logTextarea.value).catch(function() {
      logTextarea.select();
      document.execCommand('copy');
    });
  });

  document.getElementById('btn-confirm').addEventListener('click', function() {
    // TODO: wire up confirm changes — call Django API to persist credit adjustments
  });

  // =============================================================================
  // INIT
  // =============================================================================

  // TODO: pass company slug from the select dropdown once that is wired up.
  //       Server will then proxy to Django: GET /rest-api/v3/users/?company_slug={slug}
  fetch('/api/company-data')
    .then(function(res) { return res.json(); })
    .then(function(data) {
      creditPool     = data.credit_pool;
      studentEntries = data.students;
      changes        = studentEntries.map(function() { return 0; });
      remaining      = studentEntries.map(function(s) { return s.private_classes_remaining; });
      render();
    })
    .catch(function(err) {
      document.getElementById('log-output').value = 'Error loading data: ' + err.message;
    });
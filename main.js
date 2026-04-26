  // =============================================================================
  // STATE
  // =============================================================================

  let studentEntries     = [];
  let creditPool         = 0;
  let originalCreditPool = 0;
  let changes            = [];
  let remaining          = [];

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
        <td>
          <div class="btn-group">
            <button class="btn-adjust minus" data-index="${i}" data-delta="-1" ${canDecrease ? '' : 'disabled'}>−</button>
            <button class="btn-adjust plus"  data-index="${i}" data-delta="1"  ${canIncrease ? '' : 'disabled'}>+</button>
          </div>
        </td>
        <td class="${changeClass}">${changeText}</td>
      `;
      tbody.appendChild(row);
    });
  }

  // =============================================================================
  // HOLD-TO-BULK-ADJUST
  // =============================================================================

  let holdTimer = null;
  let holdFired = false;

  const HOLD_DURATION_MS = 2000;

  /**
   * Applies a bulk credit adjustment when a button is held for HOLD_DURATION_MS.
   * Minus hold: drains all of the student's remaining credits back to the pool.
   * Plus hold: empties the entire pool into that student's remaining credits.
   * @param {HTMLElement} button - The .btn-adjust element that was held.
   */
  function applyBulkAdjust(button) {
    const index   = parseInt(button.dataset.index, 10);
    const isMinus = button.classList.contains('minus');

    if (isMinus) {
      const creditsToReturn = remaining[index];
      creditPool      += creditsToReturn;
      changes[index]  -= creditsToReturn;
      remaining[index] = 0;
    } else {
      const creditsToAdd  = creditPool;
      remaining[index]   += creditsToAdd;
      changes[index]     += creditsToAdd;
      creditPool          = 0;
    }

    render();
  }

  /**
   * Starts the long-press hold timer for a given button.
   * @param {HTMLElement} button - The .btn-adjust element being held.
   */
  function startHold(button) {
    holdFired = false;
    holdTimer = setTimeout(function() {
      holdFired = true;
      holdTimer = null;
      applyBulkAdjust(button);
    }, HOLD_DURATION_MS);
  }

  /** Cancels the active hold timer if one is running. */
  function cancelHold() {
    if (holdTimer !== null) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  }

  // =============================================================================
  // EVENT HANDLERS
  // =============================================================================

  const tbody = document.getElementById('students-tbody');

  // Single-step adjust — delegated click handler.
  // Credit pool and student remaining move inversely; neither can go below 0.
  // Skipped if a long-press just fired, to prevent a double adjustment.
  tbody.addEventListener('click', function(e) {
    const button = e.target.closest('.btn-adjust');
    if (!button || button.disabled) return;
    if (holdFired) { holdFired = false; return; }

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

  // Long-press handlers — start hold on mousedown, cancel on release or leave.
  tbody.addEventListener('mousedown', function(e) {
    const button = e.target.closest('.btn-adjust');
    if (!button || button.disabled) return;
    startHold(button);
  });

  tbody.addEventListener('mouseup',    cancelHold);
  tbody.addEventListener('mouseleave', cancelHold);

  document.getElementById('btn-reset').addEventListener('click', function() {
    creditPool = originalCreditPool;
    changes    = studentEntries.map(function() { return 0; });
    remaining  = studentEntries.map(function(s) { return s.private_classes_remaining; });
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
    // TODO: wire up confirm changes — call LearnCube API to persist credit adjustments
  });

  // =============================================================================
  // COMPANY SELECTION
  // =============================================================================

  /**
   * Shows or hides the credit pool section.
   * @param {boolean} isVisible
   */
  function setPoolVisible(isVisible) {
    document.getElementById('pool-section').hidden = !isVisible;
  }

  /**
   * Shows or hides the students table and confirm button together.
   * @param {boolean} isVisible
   */
  function setTableVisible(isVisible) {
    document.getElementById('students-section').hidden = !isVisible;
    document.getElementById('confirm-section').hidden  = !isVisible;
  }

  /**
   * Displays a status message in place of the hidden sections.
   * @param {string} message
   */
  function showCompanyStatus(message) {
    const statusEl = document.getElementById('company-status');
    statusEl.textContent = message;
    statusEl.hidden = false;
  }

  /** Clears and hides the company status message. */
  function hideCompanyStatus() {
    const statusEl = document.getElementById('company-status');
    statusEl.textContent = '';
    statusEl.hidden = true;
  }

  /**
   * Fetches company data for the selected slug and updates the UI accordingly.
   * Three possible states:
   *   - No placeholder found: hide pool and table, show error message.
   *   - Placeholder found, no students: show pool as 0, hide table, show message.
   *   - Placeholder found, students found: show pool and populated table.
   * @param {string} slug - The selected company_slug value.
   */
  function loadCompanyData(slug) {
    fetch('/api/company-data/' + encodeURIComponent(slug))
      .then(function(res) { return res.json(); })
      .then(function(data) {
        hideCompanyStatus();

        if (!data.placeholder_found) {
          setPoolVisible(false);
          setTableVisible(false);
          showCompanyStatus('No Placeholder Student Detected');
          return;
        }

        setPoolVisible(true);

        if (data.students.length === 0) {
          creditPool     = 0;
          studentEntries = [];
          changes        = [];
          remaining      = [];
          render();
          setTableVisible(false);
          showCompanyStatus('No Students Found');
          return;
        }

        setTableVisible(true);
        creditPool         = data.credit_pool;
        originalCreditPool = data.credit_pool;
        studentEntries     = data.students;
        changes            = studentEntries.map(function() { return 0; });
        remaining          = studentEntries.map(function(s) { return s.private_classes_remaining; });
        render();
      })
      .catch(function(err) {
        document.getElementById('log-output').value = 'Error loading company data: ' + err.message;
      });
  }

  document.getElementById('company-select').addEventListener('change', function() {
    if (!this.value) return;
    loadCompanyData(this.value);
  });

  // =============================================================================
  // INIT
  // =============================================================================

  // Populate the company select dropdown from the LearnCube Users API.
  fetch('/api/company-slugs')
    .then(function(res) { return res.json(); })
    .then(function(data) {
      const select = document.getElementById('company-select');
      data.slugs.forEach(function(slug) {
        const option = document.createElement('option');
        option.value       = slug;
        option.textContent = slug;
        select.appendChild(option);
      });
    })
    .catch(function(err) {
      document.getElementById('log-output').value = 'Error loading company list: ' + err.message;
    });
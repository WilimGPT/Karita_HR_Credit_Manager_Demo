/**
 * File: server.js
 * Purpose: Development server for the Karita HR Credit Manager prototype.
 *          Serves the static frontend and provides API routes for company credit data.
 * Notes:   Data is currently read from a local JSON file.
 *          TODO: Replace getCompanyData() with calls to the Django API before production.
 *          TODO: PORT should come from an environment variable in production.
 * Dependencies: express, fs, path
 */

const express = require('express');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 8080;

// =============================================================================
// CONSTANTS
// =============================================================================

const PLACEHOLDER_PREFIX = 'placeholder_student_';
const DATA_FILE = path.join(__dirname, 'backend', 'data', 'placeholder_student_data.json');

// =============================================================================
// STATIC FILES
// =============================================================================

app.use(express.static(__dirname));

// =============================================================================
// DATA HELPERS
// =============================================================================

/**
 * Reads and parses the placeholder student data file.
 * @returns {Object} Parsed JSON content of the data file.
 * @throws {Error} If the file cannot be read or its contents are not valid JSON.
 */
function readDataFile() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read data file: ${error.message}`);
  }
}

/**
 * Returns the credit pool and student list for a given company slug.
 * The company/pool entry is identified by the placeholder_student_{slug} username convention.
 * All other non-teacher entries in the file are treated as students.
 * @param {Object} rawData - Parsed contents of the data file.
 * @param {string} companySlug - Company identifier (e.g. 'company_name').
 * @returns {Object|null} Shaped company data, or null if the slug is not found.
 * TODO: Replace with Django API call: GET /rest-api/v3/users/?company_slug={slug}
 */
function getCompanyData(rawData, companySlug) {
  const companyEntry = rawData.results.find(
    u => u.username === `${PLACEHOLDER_PREFIX}${companySlug}`
  );

  if (!companyEntry) return null;

  const students = rawData.results.filter(
    u => !u.username.startsWith(PLACEHOLDER_PREFIX) && !u.teacher
  );

  return {
    company_name: companySlug,
    credit_pool:  companyEntry.profile.private_classes_allowed,
    students: students.map(student => ({
      username:                  student.username,
      name:                      `${student.first_name} ${student.last_name}`,
      private_classes_allowed:   student.profile.private_classes_allowed,
      private_classes_remaining: student.profile.private_classes_remaining,
    })),
  };
}

// =============================================================================
// API ROUTES
// =============================================================================

app.get('/api/company-data/:companySlug', (req, res) => {
  try {
    const rawData = readDataFile();
    const data = getCompanyData(rawData, req.params.companySlug);
    if (!data) return res.status(404).json({ error: `No data found for: ${req.params.companySlug}` });
    res.json(data);
  } catch (error) {
    console.error(`GET /api/company-data/${req.params.companySlug} failed:`, error.message);
    res.status(500).json({ error: 'Could not retrieve company data' });
  }
});

// Default route — detects the company slug from the placeholder entry in the data file.
// Used during prototyping before the company select dropdown is wired up.
app.get('/api/company-data', (req, res) => {
  try {
    const rawData = readDataFile();
    const companyEntry = rawData.results.find(u => u.username.startsWith(PLACEHOLDER_PREFIX));
    if (!companyEntry) return res.status(404).json({ error: 'No placeholder company entry found' });

    const slug = companyEntry.username.slice(PLACEHOLDER_PREFIX.length);
    const data = getCompanyData(rawData, slug);
    res.json(data);
  } catch (error) {
    console.error('GET /api/company-data failed:', error.message);
    res.status(500).json({ error: 'Could not retrieve company data' });
  }
});

// =============================================================================
// START
// =============================================================================

app.listen(PORT, () => {
  console.log(`Karita HR Credit Manager running at http://localhost:${PORT}`);
});

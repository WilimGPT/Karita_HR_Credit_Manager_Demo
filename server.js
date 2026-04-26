/**
 * File: server.js
 * Purpose: Development server for the Karita HR Credit Manager prototype.
 *          Serves the static frontend and provides API routes for company credit data.
 *          Proxies calls to the LearnCube Online School API using credentials from .env.
 * Notes:   TODO: PORT should come from an environment variable in production.
 *          TODO: /api/company-data still reads from local placeholder JSON — replace
 *                with a real LearnCube API call once the company select is wired up.
 * Dependencies: express, node-fetch, dotenv, fs, path
 */

require('dotenv').config({ path: require('path').join(__dirname, 'backend', '.env') });

const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 8080;

// =============================================================================
// CONSTANTS
// =============================================================================

const PLACEHOLDER_PREFIX  = 'placeholder_student_';
const DATA_FILE           = path.join(__dirname, 'backend', 'data', 'placeholder_student_data.json');
const LEARNCUBE_TOKEN_URL = 'https://app.learncube.com/api/virtual-classroom/get-api-token/';

// LearnCube tokens expire after 5 minutes — cache just under that to avoid using a stale token.
const CACHE_TTL_MS = 4 * 60 * 1000;

// In-memory cache shared across all requests for the duration of the server process.
const cache = {
  token:          null,
  tokenFetchedAt: null,
  users:          null,
  usersFetchedAt: null,
};

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
// LEARNCUBE API HELPERS
// =============================================================================

/**
 * Requests a short-lived API token from LearnCube using credentials from .env.
 * Tokens expire after 5 minutes — request a fresh one per server-side operation.
 * @returns {Promise<string>} Bearer token string.
 * @throws {Error} If the token request fails or credentials are missing.
 */
async function fetchApiToken() {
  const response = await fetch(LEARNCUBE_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      api_public_key:  process.env.PUBLIC_KEY,
      api_private_key: process.env.PRIVATE_KEY,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token request failed with status ${response.status}`);
  }

  const data = await response.json();
  return data.token;
}

/**
 * Fetches all users from the LearnCube Users API, following pagination until exhausted.
 * @param {string} token - Bearer token from fetchApiToken().
 * @returns {Promise<Array>} Flat array of all user objects across all pages.
 * @throws {Error} If any page request fails.
 */
async function fetchAllUsers(token) {
  const allUsers = [];
  let nextUrl = `${process.env.SCHOOL_DOMAIN}/rest-api/v3/users/`;

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Users API responded with status ${response.status} for ${nextUrl}`);
    }

    const data = await response.json();
    allUsers.push(...data.results);
    nextUrl = data.next;
  }

  return allUsers;
}

/**
 * Returns a valid API token, using the in-memory cache if still within CACHE_TTL_MS.
 * @returns {Promise<string>} Bearer token string.
 */
async function getCachedToken() {
  const isValid = cache.tokenFetchedAt !== null && (Date.now() - cache.tokenFetchedAt) < CACHE_TTL_MS;
  if (isValid) return cache.token;

  cache.token          = await fetchApiToken();
  cache.tokenFetchedAt = Date.now();
  return cache.token;
}

/**
 * Returns all LearnCube users, using the in-memory cache if still within CACHE_TTL_MS.
 * Both the token and the user list share the same TTL so they expire together.
 * @returns {Promise<Array>} Flat array of all user objects.
 */
async function getCachedUsers() {
  const isValid = cache.usersFetchedAt !== null && (Date.now() - cache.usersFetchedAt) < CACHE_TTL_MS;
  if (isValid) return cache.users;

  const token          = await getCachedToken();
  cache.users          = await fetchAllUsers(token);
  cache.usersFetchedAt = Date.now();
  return cache.users;
}

// =============================================================================
// API ROUTES
// =============================================================================

// Returns all unique non-null company_slug values from the LearnCube Users API.
// Used to populate the company select dropdown.
// Returns all unique non-null company_slug values from the LearnCube Users API.
// Used to populate the company select dropdown.
app.get('/api/company-slugs', async (req, res) => {
  try {
    const users = await getCachedUsers();

    const slugs = [...new Set(
      users
        .map(u => u.profile.company_slug)
        .filter(slug => slug !== null && slug !== '')
    )];

    res.json({ slugs });
  } catch (error) {
    console.error('GET /api/company-slugs failed:', error.message);
    res.status(500).json({ error: 'Could not retrieve company list' });
  }
});

// Returns the credit pool and student list for a given company slug using live API data.
// Placeholder student (username starts with PLACEHOLDER_PREFIX) provides the credit pool.
// Teachers and the placeholder itself are excluded from the students list.
app.get('/api/company-data/:companySlug', async (req, res) => {
  try {
    const { companySlug } = req.params;
    const users = await getCachedUsers();

    // Placeholder is identified by username convention, not profile.company_slug,
    // as the placeholder's company_slug field may be null or unset in LearnCube.
    const placeholder = users.find(u => u.username === `${PLACEHOLDER_PREFIX}${companySlug}`);

    if (!placeholder) {
      return res.json({ placeholder_found: false, credit_pool: 0, students: [] });
    }

    // Students are identified by profile.company_slug matching the selected company.
    const students = users.filter(
      u => u.profile.company_slug === companySlug && !u.teacher && !u.username.startsWith(PLACEHOLDER_PREFIX)
    );

    res.json({
      placeholder_found: true,
      credit_pool: placeholder.profile.private_classes_allowed,
      students: students.map(s => ({
        username:                  s.username,
        name:                      `${s.first_name} ${s.last_name}`,
        private_classes_allowed:   s.profile.private_classes_allowed,
        private_classes_remaining: s.profile.private_classes_remaining,
      })),
    });
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

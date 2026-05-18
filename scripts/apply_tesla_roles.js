#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT_DIR = path.resolve(__dirname, '..');
const PROFILE_PATHS = [
  path.join(ROOT_DIR, 'profile.local.json'),
  path.join(ROOT_DIR, 'profile.json')
];

function loadProfile() {
  const profilePath = PROFILE_PATHS.find((candidate) => fs.existsSync(candidate));
  if (!profilePath) {
    throw new Error('Missing profile.json. Copy profile.json into profile.local.json or edit profile.json before running.');
  }

  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  const requiredFields = [
    'firstName',
    'lastName',
    'legalName',
    'phone',
    'email',
    'country',
    'resumePath',
    'durationLabel',
    'considerOtherRoles',
    'sponsorship',
    'formerEmployee',
    'formerInternOrContractor',
    'universityStudent',
    'textConsent',
    'thesis',
    'gender',
    'veteran',
    'race',
    'disability'
  ];

  for (const field of requiredFields) {
    if (!profile[field]) {
      throw new Error(`Profile field "${field}" is required in ${path.basename(profilePath)}`);
    }
  }

  if (!profile.graduationDate?.month || !profile.graduationDate?.day) {
    throw new Error(`Profile field "graduationDate.month" and "graduationDate.day" are required in ${path.basename(profilePath)}`);
  }

  if (!fs.existsSync(profile.resumePath)) {
    throw new Error(`Resume file not found at ${profile.resumePath}`);
  }

  return profile;
}

const PROFILE = loadProfile();

const INCLUDE = /software|fullstack|front\s*end|frontend|back\s*end|backend|site reliability|sre|machine learning|\bml\b|data engineer|data engineering|data science|analytics|technical program manager|qa|validation|inference|platform|systems?|firmware|ai tooling|build infrastructure|automation software/i;
const EXCLUDE = /technician|mechanical|hardware|cad|design engineer|electrical design|industrial engineer|manufacturing|thermal|process engineer|equipment|vehicle manufacturing|construction|facilities|supply|finance|procurement|recruiting|cell engineering(?!.*data engineer)/i;

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function argSet(name) {
  return new Set(argValue(name).split(',').map((id) => id.trim()).filter(Boolean));
}

function slowMs() {
  return Number(argValue('--slow-ms', '0'));
}

async function pause(page, multiplier = 1) {
  await page.waitForTimeout(Math.max(0, slowMs() * multiplier));
}

function slug(title) {
  return title.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function startDateFor(title) {
  return /fall 2026/i.test(title) ? { month: 'September 2026', day: '7' } : { month: 'May 2026', day: '4' };
}

async function getPage() {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0] || await browser.newContext();
  const page = context.pages()[0] || await context.newPage();
  return { browser, context, page };
}

async function installSubmitPayloadSanitizer(context) {
  await context.route('**/cua-api/submit-form/careers', async (route) => {
    const request = route.request();
    const postData = request.postData();
    if (!postData) return route.continue();
    try {
      const payload = JSON.parse(postData);
      if (payload?.formData?.fields) {
        for (const field of payload.formData.fields) {
          if (field.name === 'eeoCopyUrl' && String(field.value) === 'undefined') {
            field.value = 'https://www.dol.gov/agencies/ofccp/self-id-forms';
            console.log('Replaced invalid eeoCopyUrl field in submit payload');
          }
        }
      }
      const headers = { ...request.headers(), 'content-type': 'application/json' };
      delete headers['content-length'];
      return route.continue({
        postData: JSON.stringify(payload),
        headers
      });
    } catch {
      return route.continue();
    }
  });
}

async function eligibleJobs(page) {
  await page.goto('https://www.tesla.com/careers/search/?department=engineering-information-technology&type=intern&site=US', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2500);
  return page.evaluate(({ includeSource, excludeSource }) => {
    const include = new RegExp(includeSource, 'i');
    const exclude = new RegExp(excludeSource, 'i');
    const dataPromise = fetch('/cua-api/apps/careers/state').then((r) => r.json());
    return dataPromise.then((data) => {
      const us = new Set();
      const northAmerica = data.geo.find((region) => region.id === '5');
      const usSite = northAmerica.sites.find((site) => site.id === 'US');
      for (const state of usSite.states) {
        for (const ids of Object.values(state.cities)) {
          for (const id of ids) us.add(String(id));
        }
      }
      return data.listings
        .filter((job) => job.y === 3 && us.has(String(job.l)) && /\b(Summer|Fall) 2026\b/i.test(job.t))
        .filter((job) => include.test(job.t) && !exclude.test(job.t))
        .map((job) => ({
          id: job.id,
          title: job.t.trim().replace(/\s+/g, ' '),
          dept: data.lookup.departments[job.dp],
          location: data.lookup.locations[job.l],
          url: `https://www.tesla.com/careers/search/job/${job.t.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${job.id}`
        }))
        .sort((a, b) => a.title.localeCompare(b.title));
    });
  }, { includeSource: INCLUDE.source, excludeSource: EXCLUDE.source });
}

async function selectByLabel(page, selector, label) {
  await page.locator(selector).selectOption({ label });
}

async function checkRadio(page, name, value) {
  const ok = await page.evaluate(({ name, value }) => {
    const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (!input) return false;
    input.click();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.checked;
  }, { name, value });
  if (!ok) throw new Error(`Could not select radio ${name}=${value}`);
}

async function clickButtonByNameDom(page, name) {
  await page.evaluate((buttonName) => document.querySelector(`button[name="${buttonName}"]`)?.click(), name);
}

async function checkNamedCheckbox(page, name) {
  await page.waitForFunction((inputName) => {
    const input = document.querySelector(`input[name="${inputName}"]`);
    return Boolean(input && input.isConnected);
  }, name, { timeout: 15000 });
  await page.evaluate((inputName) => {
    const input = document.querySelector(`input[name="${inputName}"]`);
    if (!input) return false;
    input.scrollIntoView({ block: 'center' });
    input.click();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.checked;
  }, name);
}

async function selectNamedDate(page, inputName, date) {
  await page.evaluate((name) => document.querySelector(`input[name="${name}"]`)?.click(), inputName);
  await page.waitForTimeout(500);
  for (let i = 0; i < 24; i += 1) {
    const action = await page.evaluate((month) => {
      const body = document.body.innerText;
      if (body.includes(month)) return 'on-target';
      const monthButtons = [...document.querySelectorAll('button[aria-label]')].filter((button) => {
        return button.getAttribute('aria-label')?.match(/\d{4}$/) &&
          !String(button.className || '').includes('tds-day') &&
          button.offsetParent !== null;
      });
      const exact = monthButtons.find((button) => button.getAttribute('aria-label') === month);
      if (exact) {
        exact.click();
        return 'clicked-target';
      }
      monthButtons[monthButtons.length - 1]?.click();
      return 'advanced';
    }, date.month);
    await page.waitForTimeout(action === 'clicked-target' ? 1000 : 700);
    if (action === 'on-target' || action === 'clicked-target') break;
  }
  const onTargetMonth = await page.evaluate((month) => document.body.innerText.includes(month), date.month);
  if (!onTargetMonth) throw new Error(`Date picker did not navigate to ${date.month}`);
  await page.evaluate((day) => {
    const button = [...document.querySelectorAll('button.tds-day')].find((candidate) => candidate.textContent.trim() === day && !candidate.className.includes('not-this-month') && candidate.offsetParent !== null);
    button?.click();
  }, date.day);
  await page.waitForTimeout(700);
  const value = await page.locator(`input[name="${inputName}"]`).inputValue();
  if (!value || !value.includes(date.month.replace(' 2026', '')) || !value.includes(` ${date.day}, 2026`)) {
    const expectedYear = date.month.match(/\d{4}/)?.[0] || '2026';
    const expectedMonth = date.month.replace(` ${expectedYear}`, '');
    if (!value.includes(expectedMonth) || !value.includes(` ${date.day}, ${expectedYear}`)) {
      throw new Error(`Date picker selected "${value}" instead of ${date.month} ${date.day}`);
    }
  }
}

async function selectDate(page, date) {
  await selectNamedDate(page, 'job.jobAvailabilityToStartInternship', date);
}

async function fillStep1(page) {
  await page.locator('input[name="personal.firstName"]').fill(PROFILE.firstName);
  await pause(page);
  await page.locator('input[name="personal.lastName"]').fill(PROFILE.lastName);
  await pause(page);
  await page.locator('input[name="personal.phone"]').fill(PROFILE.phone);
  await pause(page);
  await selectByLabel(page, 'select[name="personal.phoneType"]', 'Mobile');
  await pause(page);
  await page.locator('input[name="personal.email"]').fill(PROFILE.email);
  await pause(page);
  await selectByLabel(page, 'select[name="personal.country"]', PROFILE.country);
  await pause(page);
  await page.locator('input[type="file"][name="personal.resume"]').setInputFiles(PROFILE.resumePath);
  await pause(page, 4);
  await clickButtonByNameDom(page, 'next');
}

async function fillStep2(page, title) {
  await selectDate(page, startDateFor(title));
  await pause(page);
  await selectByLabel(page, 'select[name="job.jobInternshipDuration"]', PROFILE.durationLabel);
  await pause(page);
  await selectByLabel(page, 'select[name="job.jobInternshipType"]', 'Yes');
  await pause(page);
  await checkRadio(page, 'job.jobInternshipThesis', PROFILE.thesis);
  await pause(page);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
  await clickButtonByNameDom(page, 'next');
}

async function fillStep3(page) {
  await selectByLabel(page, 'select[name="legal.legalNoticePeriod"]', 'Immediately');
  await pause(page);
  await checkRadio(page, 'legal.legalConsiderOtherPositions', PROFILE.considerOtherRoles);
  await pause(page);
  await checkRadio(page, 'legal.legalImmigrationSponsorship', PROFILE.sponsorship);
  await pause(page);
  await checkRadio(page, 'legal.legalFormerTeslaEmployee', PROFILE.formerEmployee);
  await pause(page);
  await checkRadio(page, 'legal.legalFormerTeslaInternOrContractor', PROFILE.formerInternOrContractor);
  await pause(page);
  await checkRadio(page, 'legal.legalUniversityStudent', PROFILE.universityStudent);
  await pause(page, 2);
  const graduationInput = page.locator('input[name="legal.legalUniversityAnticipatedGraduationDate"]');
  if (await graduationInput.count()) {
    await selectNamedDate(page, 'legal.legalUniversityAnticipatedGraduationDate', PROFILE.graduationDate);
    await pause(page);
  }
  await checkRadio(page, 'legal.legalReceiveNotifications', PROFILE.textConsent);
  await pause(page);
  await checkNamedCheckbox(page, 'legal.legalAcknowledgment');
  await pause(page);
  await page.locator('input[name="legal.legalAcknowledgmentName"]').fill(PROFILE.legalName);
  await pause(page, 2);
  await clickButtonByNameDom(page, 'next');
}

async function fillStep4(page, shouldSubmit) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const disclosure = [...document.querySelectorAll('body *')].find((el) => el.scrollHeight > el.clientHeight + 200 && /Equal Employee Opportunities|Pre-Offer Invitation/i.test(el.innerText || ''));
    if (disclosure) disclosure.scrollTop = disclosure.scrollHeight;
  });
  await page.waitForTimeout(700);
  await selectByLabel(page, 'select[name="eeo.eeoGender"]', PROFILE.gender);
  await pause(page);
  await selectByLabel(page, 'select[name="eeo.eeoVeteranStatus"]', PROFILE.veteran);
  await pause(page);
  await selectByLabel(page, 'select[name="eeo.eeoRaceEthnicity"]', PROFILE.race);
  await pause(page);
  await selectByLabel(page, 'select[name="eeo.eeoDisabilityStatus"]', PROFILE.disability);
  await pause(page);
  await page.locator('input[name="eeo.eeoDisabilityStatusName"]').fill(PROFILE.legalName);
  await pause(page, 2);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  await checkNamedCheckbox(page, 'eeo.eeoAcknowledgment');
  await pause(page, 4);
  if (shouldSubmit) {
    await page.getByRole('button', { name: /^submit$/i }).click({ timeout: 15000 });
    await page.waitForTimeout(9000);
  }
}

async function applyJob(page, job, shouldSubmit) {
  console.log(`Starting ${job.id}: ${job.title}`);
  await page.goto(`https://www.tesla.com/careers/search/job/apply/${job.id}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);
  let body = await page.locator('body').innerText();
  if (/already applied|application submitted|thank you/i.test(body)) return { id: job.id, title: job.title, status: 'already-submitted-or-confirmed', text: body.slice(0, 1000) };
  if (/Step 1 of 4/i.test(body)) {
    console.log(`Step 1 ${job.id}`);
    await fillStep1(page);
    await page.waitForTimeout(2500);
    body = await page.locator('body').innerText();
  }
  if (/Step 2 of 4/i.test(body)) {
    console.log(`Step 2 ${job.id}`);
    await fillStep2(page, job.title);
    await page.waitForTimeout(2500);
    body = await page.locator('body').innerText();
  }
  if (/Step 3 of 4/i.test(body)) {
    console.log(`Step 3 ${job.id}`);
    await fillStep3(page);
    await page.waitForTimeout(2500);
    body = await page.locator('body').innerText();
  }
  if (!/Step 4 of 4/i.test(body)) return { id: job.id, title: job.title, status: 'unexpected-page', text: body.slice(0, 1600) };
  console.log(`Step 4 ${job.id}`);
  await fillStep4(page, shouldSubmit);
  const finalText = await page.locator('body').innerText();
  if (/An error has occurred|unexpected error|try again later/i.test(finalText)) {
    return { id: job.id, title: job.title, status: 'submit-error-page', text: finalText.slice(0, 1600) };
  }
  const stillOnFinalStep = /Step 4 of 4/i.test(finalText);
  const confirmed = /application submitted|thank you|successfully submitted|we have received/i.test(finalText);
  const status = shouldSubmit ? (confirmed || !stillOnFinalStep ? 'submitted-confirmation-reached' : 'submit-attempt-still-on-step4') : 'filled-not-submitted';
  return { id: job.id, title: job.title, status, text: finalText.slice(0, 1600) };
}

(async () => {
  const mode = argValue('--mode', 'list');
  const ids = argSet('--ids');
  const skip = argSet('--skip');
  const limit = Number(argValue('--limit', '0'));
  const { browser, context, page } = await getPage();
  await installSubmitPayloadSanitizer(context);
  const jobs = (await eligibleJobs(page)).filter((job) => (!ids.size || ids.has(job.id)) && !skip.has(job.id));
  const selected = limit > 0 ? jobs.slice(0, limit) : jobs;
  if (mode === 'list') {
    console.log(JSON.stringify(selected, null, 2));
    await browser.close();
    return;
  }
  const shouldSubmit = mode === 'submit';
  const results = [];
  for (const job of selected) {
    try {
      results.push(await applyJob(page, job, shouldSubmit));
      console.log(JSON.stringify(results[results.length - 1], null, 2));
    } catch (error) {
      const failure = { id: job.id, title: job.title, status: 'error', error: error.message };
      results.push(failure);
      console.log(JSON.stringify(failure, null, 2));
    }
  }
  console.log(JSON.stringify({ mode, count: results.length, results }, null, 2));
  await browser.close();
})();

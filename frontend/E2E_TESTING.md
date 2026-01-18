# End-to-End Testing Guide

## Overview

This project uses Playwright for end-to-end testing. The test suite covers the complete user journey from landing page to trip creation and itinerary generation.

## Installation

Install Playwright and browsers:

```bash
cd frontend
npm install
npx playwright install
```

## Running Tests

### Run All Tests

```bash
npm run test:e2e
```

### Run Tests in UI Mode (Interactive)

```bash
npm run test:e2e:ui
```

### Run Tests in Headed Mode (See Browser)

```bash
npm run test:e2e:headed
```

### Debug Tests

```bash
npm run test:e2e:debug
```

### Run Specific Test File

```bash
npx playwright test e2e/tripy-e2e.spec.ts
```

### Run Tests on Specific Browser

```bash
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit
```

## Test Coverage

The E2E test suite (`e2e/tripy-e2e.spec.ts`) covers:

### ✅ Complete User Journey Test

1. **Landing Page**
   - Opens homepage
   - Verifies key elements are visible
   - Checks "Get Early Access" button responsiveness

2. **User Signup**
   - Navigates to registration page
   - Fills out signup form
   - Submits and handles confirmation flow
   - Logs in with new account

3. **Trip Creation**
   - Navigates to group trip setup
   - Fills in trip details (dates)
   - Adds destinations (cities)

4. **Verification**
   - Verifies trip was created
   - Checks for console errors
   - Ensures no navigation errors

### ✅ Button Responsiveness Test

- Verifies all buttons on landing page are clickable
- Checks button states (enabled/disabled)
- Validates button interactions

### ✅ Navigation Test

- Tests navigation to common pages
- Verifies pages load correctly
- Checks for 404 errors

## What Tests Check For

The tests will **FAIL** if:

- ❌ Any button doesn't respond to clicks
- ❌ Pages don't load correctly (404, 500 errors)
- ❌ Navigation fails or hangs
- ❌ Console errors occur (JavaScript errors)
- ❌ Form submissions fail
- ❌ API calls fail
- ❌ Timeouts occur (elements don't appear)
- ❌ Buttons are disabled when they shouldn't be

## Test Configuration

Tests run on multiple browsers:
- **Chromium** (Chrome/Edge)
- **Firefox**
- **WebKit** (Safari)
- **Mobile Chrome** (Pixel 5)
- **Mobile Safari** (iPhone 12)

## Environment Variables

Set these environment variables for testing:

```bash
# Frontend URL (default: http://localhost:3000)
E2E_BASE_URL=http://localhost:3000

# Backend URL (default: http://localhost:8000)
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
```

## Pre-requisites

Before running tests, ensure:

1. ✅ **Backend is running**:
   ```bash
   cd backend
   ./start_server.sh
   ```

2. ✅ **Frontend is running** (or Playwright will start it automatically):
   ```bash
   cd frontend
   npm run dev
   ```

3. ✅ **Backend is accessible** at `http://localhost:8000` (or configured URL)

4. ✅ **Database/Cognito is configured** with test credentials

## Test Data

Tests automatically generate unique test users:
- Email: `test-user-{timestamp}-{random}@example.com`
- Password: `TestPassword123!`
- Name: `Test User`

Each test run uses unique credentials to avoid conflicts.

## Test Reports

After running tests, view the HTML report:

```bash
npx playwright show-report
```

This opens an interactive report showing:
- Test results
- Screenshots on failure
- Video recordings (if enabled)
- Console logs
- Network activity

## Debugging Failed Tests

### 1. View Test Trace

```bash
npx playwright show-trace trace.zip
```

### 2. Run in Debug Mode

```bash
npm run test:e2e:debug
```

This opens Playwright Inspector where you can:
- Step through test execution
- See page state at each step
- Inspect elements
- View console logs

### 3. Run in Headed Mode

```bash
npm run test:e2e:headed
```

Watch the browser execute the test in real-time.

### 4. Check Test Results

View screenshots and videos in:
- `test-results/` - Screenshots and videos
- `playwright-report/` - HTML report

## Common Issues

### Tests Fail: "Cannot connect to backend"

**Solution**: Ensure backend is running:
```bash
cd backend && ./start_server.sh
```

### Tests Fail: "Page timeout"

**Solution**: Increase timeout in test file or check if page is loading correctly.

### Tests Fail: "Button not found"

**Solution**: Check if the button selector matches the current UI. Update selectors if needed.

### Tests Fail: "Console errors found"

**Solution**: Check browser console for errors. Fix JavaScript errors in your code.

## Continuous Integration

Tests can be run in CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Install dependencies
  run: cd frontend && npm install

- name: Install Playwright
  run: cd frontend && npx playwright install --with-deps

- name: Run E2E tests
  run: cd frontend && npm run test:e2e
  env:
    E2E_BASE_URL: ${{ secrets.E2E_BASE_URL }}
    NEXT_PUBLIC_BACKEND_URL: ${{ secrets.BACKEND_URL }}
```

## Best Practices

1. **Isolate Tests**: Each test uses unique credentials to avoid conflicts

2. **Clean State**: Tests clear localStorage/sessionStorage before running

3. **Wait for Elements**: Tests wait for elements to be visible before interacting

4. **Error Handling**: Tests check for console errors and page errors

5. **Button Validation**: All buttons are checked for responsiveness

6. **Retry Logic**: Failed tests retry automatically (configured in `playwright.config.ts`)

## Adding New Tests

To add new test scenarios:

1. Open `e2e/tripy-e2e.spec.ts`

2. Add a new `test()` block:

```typescript
test('My new test scenario', async ({ page }) => {
  await page.goto(BASE_URL);
  // Your test code here
});
```

3. Run the test:
```bash
npx playwright test e2e/tripy-e2e.spec.ts -g "My new test scenario"
```

## Troubleshooting

### Tests are slow

- Reduce `waitForTimeout` values
- Use more specific selectors
- Enable parallel execution (already enabled by default)

### Flaky tests

- Add explicit waits for dynamic content
- Use `waitForLoadState('networkidle')` for API-heavy pages
- Check for race conditions in async operations

### Browser not launching

- Run `npx playwright install` to install browsers
- Check system dependencies: `npx playwright install-deps`

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Playwright API Reference](https://playwright.dev/docs/api/class-test)

// SPDX-License-Identifier: AGPL-3.0-or-later

import { runAllTests } from './src/api-scanner/apiScanner.test';

console.log('Running API Discovery & Mapping Scanner Test Suite...');
const results = runAllTests();

console.log(`\nTests Completed:`);
console.log(`Passed: ${results.passed}`);
console.log(`Failed: ${results.failed}`);

if (results.errors.length > 0) {
  console.error('\nFailures:');
  for (const err of results.errors) {
    console.error(`- ${err}`);
  }
  process.exit(1);
} else {
  console.log('\nAll API Discovery and Mapping Scanner tests passed successfully!');
  process.exit(0);
}

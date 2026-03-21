import {
  createSummaryHandler,
  getCommonTestTags,
  runReportMode,
  runSearch
} from './common.js';

const TARGET_OPERATION = `${__ENV.TARGET_OPERATION || 'fast'}`.toLowerCase();
const OPERATION_THRESHOLDS = {
  fast: 100,
  search: 150,
  dependency: 300
};

if (!Object.prototype.hasOwnProperty.call(OPERATION_THRESHOLDS, TARGET_OPERATION)) {
  throw new Error(`TARGET_OPERATION must be one of: ${Object.keys(OPERATION_THRESHOLDS).join(', ')}.`);
}

const metadata = {
  scenario: 'isolation',
  testType: 'isolation',
  variant: 'nominal',
  runProfile: 'student',
  workloadProfile: 'single-path',
  workloadMix: `100% ${TARGET_OPERATION}`,
  evaluationMode: 'threshold',
  thresholdSummary: [
    'http_req_failed rate < 0.01',
    `http_req_duration p(95) < ${OPERATION_THRESHOLDS[TARGET_OPERATION]}ms`
  ],
  notes: 'Single-path measurement to isolate one operation from the mixed workload.'
};

export const options = {
  vus: 10,
  duration: '2m',
  tags: getCommonTestTags(metadata),
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: [`p(95)<${OPERATION_THRESHOLDS[TARGET_OPERATION]}`]
  }
};

export const handleSummary = createSummaryHandler(metadata);

export default function () {
  if (TARGET_OPERATION === 'search') {
    runSearch('isolation', metadata);
    return;
  }

  runReportMode(TARGET_OPERATION, metadata);
}

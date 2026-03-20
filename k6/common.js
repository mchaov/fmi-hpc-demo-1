import http from 'k6/http';
import { check, sleep } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export function randomItemId() {
  return Math.floor(Math.random() * 400) + 1;
}

export function weightedReportMode(weightMap) {
  const value = Math.random();
  let cumulative = 0;

  for (const [mode, weight] of weightMap) {
    cumulative += weight;
    if (value <= cumulative) {
      return mode;
    }
  }

  return weightMap[weightMap.length - 1][0];
}

export function runRequest(path, tags = {}) {
  const response = http.get(`${BASE_URL}${path}`, { tags });

  check(response, {
    'status is below 500': (res) => res.status < 500
  });

  sleep(0.1);
  return response;
}

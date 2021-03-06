import debug = require('debug');
import fetch from 'node-fetch';

/**
 * Logs a metric to a remote logging server, defined by the environment vars:
 * - `BUGBOT_LOG_METRICS_URL`
 * - `BUGBOT_LOG_METRICS_AUTH`
 *
 * This code assumes that it is sending logs to an instance of Grafana Loki,
 * with the data format defined by:
 * https://grafana.com/docs/loki/latest/api/#post-lokiapiv1push
 *
 * `data` is the metric data that you would expect to change in each log message
 * or even across different types of log messages; `labels` are common among a
 * large group of different kinds of log messages (e.g. which module made it).
 */
export function logMetric(
  data: Record<string, unknown>,
  labels: Record<string, string> = {},
): void {
  const d = debug('log-metric');

  const envUrl = process.env.BUGBOT_LOG_METRICS_URL; // required
  const envAuth = process.env.BUGBOT_LOG_METRICS_AUTH;

  // Ensure that the URL to send logs to is present
  if (envUrl === undefined) {
    d('missing URL; no-op');
    return;
  }

  // Craft the payload
  const payload = {
    streams: [
      {
        stream: {
          ...(labels || {}),
          app: 'bugbot',
        },
        values: [
          [Math.round(Date.now() * 1_000_000).toString(), JSON.stringify(data)],
        ],
      },
    ],
  };

  // Start the request
  const req = fetch(envUrl, {
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
      ...(envAuth !== undefined
        ? {
            Authorization: `Basic ${Buffer.from(envAuth).toString('base64')}`,
          }
        : {}),
    },
    method: 'POST',
  });

  // Watch the response, but in general ignore failures
  req
    .then((res) => {
      if (res.status === 204) {
        // Status 204 = No Content & success; do nothing
        d('successfully logged metric');
        return;
      }

      // Something must have gone wrong, log a debug error
      return res.text().then((data) => d('unexpected response:', res, data));
    })
    .catch((err) => {
      d('error', err);
    });
}

import { Task } from './task';

// https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string
const ElectronRegex =
  /Electron ((0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?)/;
const UrlRegex =
  /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)/;
const TimestampRegex = /^(\[.*\])\s+(.*)/;

// A handful of text colors that play nice in dark mode.
// We cycle through them if we ever have to swap runners.
const RunnerColors = ['#80EE40', '#FF8000', '#00C0C0', '#4080FF', '#FFC0FF'];
const RunnerStyles = RunnerColors.map(
  (color, idx) => `.style${idx} { color: ${color}; }`,
);
const NumStyles = RunnerStyles.length;

const electronUrl = (version: string) =>
  `https://github.com/electron/electron/releases/v${version}`;
const electronAnchor = (version: string) =>
  `<a href="${electronUrl(version)}">Electron ${version}</a>`;

export function buildLog(task: Readonly<Task>): string {
  const blocks = task.log.map((block, idx) => {
    const lines = block.lines
      // make urls clickable
      .map((line) => {
        const m = UrlRegex.exec(line);
        return m ? line.replace(m[0], `<a href="${m[0]}">${m[0]}</a>`) : line;
      })
      // make electron releases clickable
      .map((line) => {
        const m = ElectronRegex.exec(line);
        return m ? line.replace(m[0], electronAnchor(m[1])) : line;
      })
      // cycle through colors in the timestamp when we change runners
      .map((line) => {
        const m = TimestampRegex.exec(line);
        return m
          ? `<span class="style${idx % NumStyles}">${m[1]}</span> ${m[2]}`
          : line;
      })
      .join('<br/>\n');
    return `<div>\n${lines}\n</div>`;
  });

  return `
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta http-equiv="refresh" content="${task.job.current ? 5 : 30}">
  <style>
    body {
      background: #282828;
      color: #E0E0E0;
      font-family: monospace;
    }
    a {
      color: #80C0FF;
    }
${RunnerStyles.map((rs) => `    ${rs}`).join('\n')}
  </style>
</head>
<body>
${blocks.join('\n')}
</body>
</html>
`;
}

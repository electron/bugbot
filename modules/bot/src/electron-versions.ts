import fetch from 'node-fetch';
import * as semver from 'semver';

interface Release {
  // the format of the fetched lite.json data
  deps: Record<string, string>;
  name: string;
  node_id: string;
  npm_dist_tags: string[];
  npm_package_name: string;
  prerelease: boolean;
  published_at: string;
  tag_name: string;
  total_downloads: number;
  version: string;

  // added by ElectronVersions for sorting / filtering
  sem: semver.SemVer;
}

const isStable = (rel: Release) => rel.sem.prerelease.length === 0;
const hasStable = (releases: Release[]) => releases.some(isStable);

// from https://github.com/electron/fiddle/blob/master/src/utils/sort-versions.ts
function electronSemVerCompare(a: semver.SemVer, b: semver.SemVer) {
  const l = a.compareMain(b);
  if (l) return l;
  // Electron's approach is nightly -> beta -> stable.
  // Account for 'beta' coming before 'nightly' lexicographically
  if (a.prerelease[0] === 'nightly' && b.prerelease[0] === 'beta') return -1;
  if (a.prerelease[0] === 'beta' && b.prerelease[0] === 'nightly') return 1;
  return a.comparePre(b);
}

function releaseCompare(a: Release, b: Release) {
  return electronSemVerCompare(a.sem, b.sem);
}

export class ElectronVersions {
  private readonly releases = new Set<Release>();
  private releasesTime = 0; // epoch

  private async fetchReleases() {
    const url = 'https://unpkg.com/electron-releases/lite.json';
    const response = await fetch(url);
    const releases = (await response.json()) as Release[];

    this.releasesTime = Date.now();
    this.releases.clear();
    for (const release of releases) {
      release.sem = semver.parse(release.version);
      this.releases.add(release);
    }
  }

  private isCacheTooOld(): boolean {
    // if it's been >12 hours, refresh the cache
    const CACHE_PERIOD_MSEC = 12 * 60 * 60 * 1000;
    return this.releasesTime + CACHE_PERIOD_MSEC < Date.now();
  }

  private async ensureReleases() {
    if (!this.releases.size || this.isCacheTooOld()) await this.fetchReleases();
  }

  private groupReleasesByMajor(releases: Release[]): Map<number, Release[]> {
    const majors = [...new Set<number>(releases.map((rel) => rel.sem.major))];
    const byMajor = new Map<number, Release[]>(majors.map((maj) => [maj, []]));
    for (const rel of releases) byMajor.get(rel.sem.major).push(rel);
    for (const range of byMajor.values()) range.sort(releaseCompare);
    return byMajor;
  }

  public async getVersionsToTest(): Promise<string[]> {
    await this.ensureReleases();

    const byMajor = this.groupReleasesByMajor([...this.releases]);
    const majors = [...byMajor.keys()].sort((a, b) => a - b);

    const versions: Release[] = [];

    // Get the oldest and newest version of each branch we're testing.
    // If a branch has gone stable, skip its prereleases.
    const SUPPORTED_MAJORS = 3; // https://www.electronjs.org/docs/tutorial/support
    const UNSUPPORTED_MAJORS_TO_TEST = 2;
    const NUM_STABLE_TO_TEST = SUPPORTED_MAJORS + UNSUPPORTED_MAJORS_TO_TEST;
    let stable_left = NUM_STABLE_TO_TEST;
    while (stable_left > 0) {
      const major = majors.pop();
      let range = byMajor.get(major);
      if (hasStable(range)) {
        range = range.filter(isStable); // skip its prereleases
        --stable_left;
      }
      versions.push(range.shift()); // oldest version
      if (range.length >= 1) versions.push(range.pop()); // newest version
    }

    return versions.sort(releaseCompare).map((ret) => ret.version);
  }
}

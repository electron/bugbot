import fetch from 'node-fetch';
import * as semver from 'semver';

import { VersionRange } from './interfaces';

type Release = semver.SemVer;

const isStable = (rel: Release) => rel.prerelease.length === 0;
const hasStable = (releases: Release[]) => releases.some(isStable);

// from https://github.com/electron/fiddle/blob/master/src/utils/sort-versions.ts
export function releaseCompare(a: Release, b: Release) {
  const l = a.compareMain(b);
  if (l) return l;
  // Electron's approach is nightly -> beta -> stable.
  // Account for 'beta' coming before 'nightly' lexicographically
  if (a.prerelease[0] === 'nightly' && b.prerelease[0] === 'beta') return -1;
  if (a.prerelease[0] === 'beta' && b.prerelease[0] === 'nightly') return 1;
  return a.comparePre(b);
}

export class ElectronVersions {
  private readonly releases = new Map<string, Release>();
  private releasesTime = 0; // epoch

  private async fetchReleases() {
    const url = 'https://electronjs.org/headers/index.json';
    const response = await fetch(url);
    const raw = (await response.json()) as { version: string }[];

    this.releasesTime = Date.now();
    this.releases.clear();
    for (const { version } of raw) {
      this.releases.set(version, semver.parse(version));
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
    const majors = [...new Set<number>(releases.map((rel) => rel.major))];
    const byMajor = new Map<number, Release[]>(majors.map((maj) => [maj, []]));
    for (const rel of releases) byMajor.get(rel.major).push(rel);
    for (const range of byMajor.values()) range.sort(releaseCompare);
    return byMajor;
  }

  public async getVersionsToTest(): Promise<string[]> {
    await this.ensureReleases();

    const byMajor = this.groupReleasesByMajor([...this.releases.values()]);
    const majors = [...byMajor.keys()].sort((a, b) => a - b);

    const versions: Release[] = [];

    // Get the oldest and newest version of each branch we're testing.
    // If a branch has gone stable, skip its prereleases.

    // const SUPPORTED_MAJORS = 3; // https://www.electronjs.org/docs/tutorial/support
    const SUPPORTED_MAJORS = 4; // for rest of 2021. https://github.com/electron/electronjs.org/pull/5463
    const UNSUPPORTED_MAJORS_TO_TEST = 2;
    const NUM_STABLE_TO_TEST = SUPPORTED_MAJORS + UNSUPPORTED_MAJORS_TO_TEST;
    let stableLeft = NUM_STABLE_TO_TEST;
    while (majors.length > 0 && stableLeft > 0) {
      const major = majors.pop();
      let range = byMajor.get(major);
      if (hasStable(range)) {
        range = range.filter(isStable); // skip its prereleases
        --stableLeft;
      }
      versions.push(range.shift()); // oldest version
      if (range.length >= 1) versions.push(range.pop()); // newest version
    }

    return versions.sort(releaseCompare).map((ret) => ret.version);
  }

  public async getDefaultBisectStart(): Promise<string> {
    return (await this.getVersionsToTest()).shift();
  }

  public async isVersion(version: string): Promise<boolean> {
    await this.ensureReleases();
    return this.releases.has(version);
  }

  public async getLatestVersion(): Promise<string> {
    await this.ensureReleases();
    return [...this.releases.values()].sort(releaseCompare).pop().version;
  }

  public async getVersionsInRange(range: VersionRange): Promise<string[]> {
    let [sema, semb] = range.map((version) => semver.parse(version));
    if (releaseCompare(sema, semb) > 0) [sema, semb] = [semb, sema];

    await this.ensureReleases();
    return [...this.releases.values()]
      .filter((ver) => releaseCompare(ver, sema) >= 0)
      .filter((ver) => releaseCompare(ver, semb) <= 0)
      .sort((a, b) => releaseCompare(a, b))
      .map((ver) => ver.version);
  }
}

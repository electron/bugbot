import { ElectronVersions } from '../src/electron-versions';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('node-fetch');
import fetch from 'node-fetch';
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const { Response } = jest.requireActual('node-fetch');

describe('electron-versions', () => {
  const fixtureDir = path.resolve(__dirname, 'fixtures/versions');

  function mockFetch(basename: string) {
    const filename = path.join(fixtureDir, basename);
    const content = fs.readFileSync(filename, 'utf8');
    // eslint-disable-next-line
    (fetch as any)
      .mockReset()
      .mockReturnValue(Promise.resolve(new Response(content)));
  }

  it.each([
    ['sorted', 'gets-the-supported-versions.json'],
    ['unsorted', 'gets-the-supported-versions-unsorted.json'],
  ])('gets the supported versions when lite.json is %s', async (name, filename) => {
    mockFetch(filename);
    const electronVersions = new ElectronVersions();
    const versions = await electronVersions.getVersionsToTest();
    expect(versions).toStrictEqual([
      // two unsupported old versions
      '9.0.0',
      '9.4.4',
      '10.0.0',
      '10.4.7',

      // all currently-supported versions
      '11.0.0',
      '11.4.9',
      '12.0.0',
      '12.0.13',
      '13.0.0',
      '13.1.5',

      // all pre-stable development branches
      '14.0.0-nightly.20210304',
      '14.0.0-beta.11',
      '15.0.0-nightly.20210527',
      '15.0.0-nightly.20210702',
    ]);
  });

  it('handles only one stable release on branch', async () => {
    mockFetch('handles-only-one-stable-release-on-branch.json');
    const electronVersions = new ElectronVersions();
    const versions = await electronVersions.getVersionsToTest();
    expect(versions).toStrictEqual([
      // two unsupported old versions
      '9.0.0',
      '9.4.4',
      '10.0.0',
      '10.4.7',

      // all currently-supported versions
      '11.0.0',
      '11.4.9',
      '12.0.0',
      '12.0.13',
      '13.0.0', // fixture only has one stable release in 13.0.0
    ]);

    expect(await electronVersions.isVersion('fnord')).toBe(false);
    expect(await electronVersions.getLatestVersion()).toBe('13.0.0');
    for (const version of versions) {
      expect(await electronVersions.isVersion(version)).toBe(true);
    }
  });

  describe('cache', () => {
    const anyFixture = 'gets-the-supported-versions.json';
    let electronVersions: ElectronVersions | undefined = undefined;

    beforeEach(async () => {
      electronVersions = new ElectronVersions();
      mockFetch(anyFixture);
      await electronVersions.getVersionsToTest();
      mockFetch(anyFixture);
    });

    it('keeps versions cached', async () => {
      await electronVersions.getVersionsToTest();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('refreshes if the cache is too old', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 24 * 60 * 60 * 1000);
      await electronVersions.getVersionsToTest();
      expect(fetch).toHaveBeenCalled();
    });
  });
});

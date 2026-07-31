// The .json a user saves and reopens.
//
// A project file carries the whole working state, not just the model: the home,
// the scene (sun, background, toggles), the site photo with its alignment, the
// export settings, and the camera — which view preset was active and exactly
// where the camera was pointing. Reopening a project should show what was on
// screen when it was saved.
//
// This module is DOM-free and does no three.js work, so the format can be
// unit-tested. `view.camera` is an opaque blob produced by Stage.cameraState()
// and handed back to Stage.applyCameraState().

import { defaultScene, defaultExport, migrate } from './defaults.js';

export const PROJECT_FORMAT = 'sitemassing3d';
export const PROJECT_VERSION = 2;

/**
 * Wrap the live state into a project file.
 * `savedAt` is passed in rather than read from the clock so this stays pure.
 */
export function buildProject({ home, scene, exportOpts, view, savedAt }) {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: savedAt || null,
    home,
    scene,
    export: exportOpts,
    view: view || null,
  };
}

/**
 * Read a project file. Accepts three shapes:
 *   - a v2 project (everything below)
 *   - a v1 file, which was the bare home object (the library's homes/*.json and
 *     anything saved before views were stored)
 *   - a v1 file nested under `home`, with no view block
 *
 * Always returns a full set of options, so callers never have to branch. The
 * `restoredView` flag says whether the file actually carried a camera, which is
 * what tells the app to skip its default framing.
 */
export function readProject(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('not a project file');

  const isWrapped = !!raw.home && typeof raw.home === 'object';
  const homeRaw = isWrapped ? raw.home : raw;
  if (!homeRaw.dimensions && !homeRaw.openings) {
    throw new Error('no home in that file');
  }

  const view = raw.view && typeof raw.view === 'object' ? raw.view : null;
  const camera = view && view.camera && typeof view.camera === 'object' ? view.camera : null;

  return {
    home: migrate(homeRaw),
    scene: { ...defaultScene(), ...(isWrapped && raw.scene ? raw.scene : {}) },
    exportOpts: { ...defaultExport(), ...(isWrapped && raw.export ? raw.export : {}) },
    view: {
      preset: view?.preset ?? null,
      label: view?.label ?? null,
      camera,
    },
    restoredView: !!camera,
    version: Number(raw.version) || 1,
  };
}

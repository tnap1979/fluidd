import { GetterTree } from 'vuex'
import { Files, FilesState } from './types'
import { RootState } from '../types'

export const getters: GetterTree<FilesState, RootState> = {
  /**
   * Returns a directory of files and sub-directories.
   */
  getDirectory: (state) => (r: string, path: string) => {
    const root = r as 'gcodes' | 'config' | 'config_examples'
    if (state && state[root]) {
      const dir = state[root].find(o => o.path === path)
      if (dir) {
        return dir
      }
    }
  },

  /**
   * Indicates if a root is available.
   */
  isRootAvailable: (state, getters, rootState) => (r: string) => {
    return rootState.server?.info.registered_directories.includes(r)
  },

  /**
   * Returns the properties of a root.
   */
  getRootProperties: () => (r: string) => {
    const root = r as 'gcodes' | 'config' | 'config_examples' | 'docs'

    if (root === 'gcodes') {
      return {
        readonly: false,
        accepts: ['.gcode', '.g', '.gc', '.gco', '.ufp', '.nc'],
        canEdit: false,
        canView: false,
        canPrint: true
      }
    }

    if (root === 'config') {
      return {
        readonly: false,
        accepts: ['.conf', '.cfg', '.md'],
        canEdit: true,
        canView: false,
        canPrint: false
      }
    }

    if (root === 'config_examples') {
      return {
        readonly: true,
        accepts: [],
        canEdit: false,
        canView: true,
        canPrint: false
      }
    }

    return {
      readonly: true,
      accepts: [],
      canEdit: false,
      canView: true,
      canPrint: false
    }
  },

  /**
   * Returns a specific file.
   */
  getFile: (state, getters) => (r: string, path: string, filename: string) => {
    const dir: Files = getters.getDirectory(r, path)
    console.log('found a dir', r, path, filename, dir)
    if (
      dir &&
      dir.items
    ) {
      return dir.items.find(f => f.type === 'file' && f.filename === filename)
    }
  },

  /**
   * Gets the currently stored path for any given root.
   */
  getCurrentPathByRoot: (state) => (r: string) => {
    return state.currentPaths[r] || ''
  },

  /**
   * Returns a boolean indicating if we're low on disk space.
   */
  getLowOnSpace: (state) => {
    // 1073741824 = 1gb
    return state.disk_usage.free < 1073741824
  }
}

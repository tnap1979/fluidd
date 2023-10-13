import type { AppFile, FilesUpload, AppFileThumbnail, KlipperFileMeta } from '@/store/files/types'
import Vue from 'vue'
import { Component } from 'vue-property-decorator'
import type { AxiosRequestConfig, AxiosProgressEvent } from 'axios'
import { httpClientActions } from '@/api/httpClientActions'
import type { FileWithPath } from '@/util/file-system-entry'

@Component
export default class FilesMixin extends Vue {
  get apiUrl () {
    return this.$store.state.config.apiUrl
  }

  get isTrustedUser () {
    const forceLogins = this.$store.getters['server/getConfig'].authorization.force_logins

    return forceLogins === false || this.$store.getters['auth/getCurrentUser']?.username === '_TRUSTED_USER_'
  }

  getThumbUrl (meta: KlipperFileMeta, root: string, path: string, large: boolean, date?: number) {
    const thumb = this.getThumb(meta, root, path, large, date)

    return thumb?.url ?? ''
  }

  getThumb (meta: KlipperFileMeta, root: string, path: string, large = true, date?: number): AppFileThumbnail | undefined {
    if (meta.thumbnails?.length) {
      const thumb = meta.thumbnails.reduce((a, b) => (a.size > b.size) === large ? a : b)

      if (thumb.relative_path) {
        const filepath = path ? `${root}/${path}` : root

        return {
          ...thumb,
          url: this.createFileUrl(thumb.relative_path, filepath, date)
        }
      }
    }
  }

  /**
   * Loads a gcode file and parses for the gcode-viewer.
   */
  async getGcode (file: AppFile) {
    const sizeInMB = file.size / 1024 / 1024
    let res: boolean | undefined = true

    if (sizeInMB >= 100) {
      res = await this.$confirm(
        this.$t('app.gcode.msg.confirm', {
          filename: file.filename,
          size: this.$filters.getReadableFileSizeString(file.size)
        }).toString(), {
          title: this.$tc('app.general.title.gcode_preview'),
          color: 'card-heading',
          icon: '$error'
        })
    }

    if (res) {
      const path = file.path ? `gcodes/${file.path}` : 'gcodes'
      return await this.getFile<string>(file.filename, path, file.size, {
        responseType: 'text',
        transformResponse: [v => v]
      })
    }
  }

  /**
   * Will retrieve a file blob for independent processing.
   * @param filename The filename to retrieve
   * @param path The path to the file
   */
  async getFile<T = any> (filename: string, path: string, size = 0, options?: AxiosRequestConfig) {
    // Sort out the filepath
    const filepath = path ? `${path}/${filename}` : filename

    const abortController = new AbortController()

    // Add an entry to vuex indicating we're downloading a file.
    this.$store.dispatch('files/updateFileDownload', {
      filepath,
      size,
      loaded: 0,
      percent: 0,
      speed: 0,
      abortController
    })

    // Append any additional options.
    const o = {
      ...options,
      signal: abortController.signal,
      onDownloadProgress: (progressEvent: AxiosProgressEvent) => {
        const payload: any = {
          filepath,
          loaded: progressEvent.loaded,
          percent: progressEvent.progress ? Math.round(progressEvent.progress * 100) : 0,
          speed: progressEvent.rate ?? 0
        }

        if (progressEvent.total) {
          size = payload.size = progressEvent.total
        }

        this.$store.dispatch('files/updateFileDownload', payload)
      }
    }

    return await httpClientActions.serverFilesGet<T>(filepath, o)
  }

  /**
   * Will download a file by filepath via a standard browser link.
   * @param filename The filename to retrieve.
   * @param path The path to the file.
   */
  async downloadFile (filename: string, path: string) {
    // Grab a oneshot.
    try {
      const url = await this.createFileUrlWithToken(filename, path)

      // Create a link, handle its click - and finally remove it again.
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', filename)
      link.setAttribute('target', '_blank')
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch {
      // Likely a 401.
    }
  }

  /**
   * Creates a url for a file by filepath.
   * Implements a oneshot.
   * @param filename The filename.
   * @param path The path to the file.
   * @returns The url for the requested file
   */
  createFileUrl (filename: string, path: string, date?: number) {
    const filepath = (path) ? `${path}/${filename}` : `${filename}`

    return `${this.apiUrl}/server/files/${encodeURI(filepath)}?date=${date || Date.now()}`
  }

  async createFileUrlWithToken (filename: string, path: string, date?: number) {
    const url = this.createFileUrl(filename, path, date)

    return this.isTrustedUser
      ? url
      : `${url}&token=${(await httpClientActions.accessOneshotTokenGet()).data.result}`
  }

  /**
   * Uploads a single file via moonraker.
   * @param file The file object. Contains the filename.
   * @param path The path we're uploading to.
   * @param root The root we're downloading from.
   * @param andPrint If we should attempt to print this file or not.
   * @param options Axios request options
   */
  async uploadFile (file: File, path: string, root: string, andPrint: boolean, options?: AxiosRequestConfig) {
    // let filename = file.name.replace(' ', '_')
    let filepath = `${path}${file.name}`
    filepath = (filepath.startsWith('/'))
      ? filepath
      : '/' + filepath

    const abortController = new AbortController()

    this.$store.dispatch('files/updateFileUpload', {
      filepath,
      size: file.size,
      loaded: 0,
      percent: 0,
      speed: 0,
      cancelled: false,
      abortController
    })

    return httpClientActions.serverFilesUploadPost(file, path, root, andPrint, {
      ...options,
      signal: abortController.signal,
      onUploadProgress: (progressEvent: AxiosProgressEvent) => {
        this.$store.dispatch('files/updateFileUpload', {
          filepath,
          loaded: progressEvent.loaded,
          percent: progressEvent.progress ? Math.round(progressEvent.progress * 100) : 0,
          speed: progressEvent.rate ?? 0
        })
      }
    })
      .then((response) => {
        return response
      })
      .catch(e => {
        return e
      })
      .finally(() => {
        this.$store.dispatch('files/removeFileUpload', filepath)
      })
  }

  getFullPathAndFile (rootPath: string, file: File | FileWithPath): [string, File] {
    if ('path' in file) {
      return [
        `${rootPath}/${file.path}`,
        file.file
      ]
    } else {
      return [
        rootPath,
        file
      ]
    }
  }

  // Upload some files.
  async uploadFiles (files: FileList | File[] | FileWithPath[], path: string, root: string, andPrint: boolean) {
    // For each file, adds the associated state.
    for (const file of files) {
      const [fullPath, fileObject] = this.getFullPathAndFile(path, file)

      let filepath = `${fullPath}${fileObject.name}`
      filepath = (filepath.startsWith('/'))
        ? filepath
        : '/' + filepath
      this.$store.dispatch('files/updateFileUpload', {
        filepath,
        size: fileObject.size,
        loaded: 0,
        percent: 0,
        speed: 0,
        unit: 'kB',
        cancelled: false
      })
    }

    // Async uploads cause issues in moonraker / klipper.
    // So instead, upload sequentially waiting for moonraker to finish
    // processing of each file.
    if (files.length > 1) andPrint = false
    for (const file of files) {
      const [fullPath, fileObject] = this.getFullPathAndFile(path, file)

      let filepath = `${fullPath}${fileObject.name}`
      filepath = (filepath.startsWith('/'))
        ? filepath
        : '/' + filepath
      const fileState = this.$store.state.files.uploads.find((u: FilesUpload) => u.filepath === filepath)

      if (fileState && !fileState?.cancelled) {
        try {
          await this.uploadFile(fileObject, fullPath, root, andPrint)
        } catch (e) {
          return e
        }
      } else {
        this.$store.dispatch('files/removeFileUpload', filepath)
      }
    }
  }
}

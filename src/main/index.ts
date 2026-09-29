import { app, BrowserWindow, Menu, session } from 'electron'
import { join, resolve } from 'node:path'
import { AppController } from './AppController'
import { registerIpc } from './ipc/registerIpc'
import { createLogger } from './logger'
import { buildApplicationMenu } from './menu'
import { ChatGptSession } from './session/chatgptSession'

const log = createLogger('main')

// Optional separate profile directory (useful for automated tests or a second profile).
// Must be applied before the app is ready.
const customUserData = process.env.CHATGPT_TABS_USER_DATA_DIR
if (customUserData) {
  app.setPath('userData', resolve(customUserData))
} else if (!app.isPackaged) {
  // Development runs keep their own profile so they never touch the (encrypted) cookies of the
  // installed app.
  app.setPath('userData', join(app.getPath('appData'), `${app.getName()} Dev`))
}

if (!app.requestSingleInstanceLock()) {
  // Another instance owns the persistent session; hand over to it.
  app.quit()
} else {
  start()
}

function start(): void {
  const chatgpt = new ChatGptSession()
  const controller = new AppController(chatgpt)
  let sessionFlushed = false

  app.on('second-instance', () => controller.focusOrCreateWindow())

  // Global hardening for every web contents the app ever creates.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })

  app.whenReady().then(() => {
    chatgpt.configure()

    // The default session only hosts the local shell UI; it never needs any permission.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    session.defaultSession.setPermissionCheckHandler(() => false)

    app.setAboutPanelOptions({
      applicationName: 'ChatGPT Tabs',
      applicationVersion: app.getVersion(),
      credits: 'A tabbed desktop client for the ChatGPT web app. Not affiliated with OpenAI.'
    })

    Menu.setApplicationMenu(buildApplicationMenu(controller))
    registerIpc(controller)
    controller.createWindow()
    log.info(`ready (electron ${process.versions.electron}, userData isolated: ${!!customUserData})`)

    app.on('activate', () => {
      // macOS: clicking the dock icon with no windows open re-creates the window with a fresh tab.
      if (BrowserWindow.getAllWindows().length === 0) controller.createWindow()
      else controller.focusOrCreateWindow()
    })
  }).catch((error: unknown) => {
    log.error('startup failed', error)
    app.quit()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', (event) => {
    if (sessionFlushed) return
    // Make sure cookie writes reach disk so the login survives the restart.
    event.preventDefault()
    chatgpt.flush().finally(() => {
      sessionFlushed = true
      app.quit()
    })
  })

  app.on('will-quit', () => controller.dispose())
}

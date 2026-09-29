/**
 * Fixed persistent partition shared by every ChatGPT tab and the login window.
 * Never change or randomise this value: it is the key under which Electron stores
 * the ChatGPT cookies/storage on disk, so changing it logs the user out.
 */
export const CHATGPT_PARTITION = 'persist:chatgpt'

/** Clean "new chat" entry point used for every new tab. */
export const CHATGPT_HOME_URL = 'https://chatgpt.com/'

/** Entry point of the ChatGPT login flow. */
export const CHATGPT_LOGIN_URL = 'https://chatgpt.com/auth/login'

/** Height (DIP) of the app tab bar. The active ChatGPT view is placed below it. */
export const TOP_BAR_HEIGHT = 40

export const DEFAULT_TAB_TITLE = 'New Chat'

/** Upper bound on simultaneously open tabs; protects memory from runaway window.open loops. */
export const MAX_TABS = 50

/** Longest custom tab name accepted. */
export const MAX_TAB_NAME_LENGTH = 80

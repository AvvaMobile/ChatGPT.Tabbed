import { describe, expect, it } from 'vitest'
import {
  decideNavigation,
  decideWindowOpen,
  isAuthUrl,
  isChatGptUrl,
  isSafeExternalUrl,
  redactUrl
} from '../../src/main/security/navigationPolicy'

describe('host classification', () => {
  it('recognises ChatGPT hosts over https only', () => {
    expect(isChatGptUrl('https://chatgpt.com/')).toBe(true)
    expect(isChatGptUrl('https://chatgpt.com/c/123')).toBe(true)
    expect(isChatGptUrl('https://cdn.chatgpt.com/x.js')).toBe(true)
    expect(isChatGptUrl('https://chat.openai.com/')).toBe(true)
    expect(isChatGptUrl('http://chatgpt.com/')).toBe(false)
    expect(isChatGptUrl('https://chatgpt.com.evil.com/')).toBe(false)
    expect(isChatGptUrl('https://evilchatgpt.com/')).toBe(false)
    expect(isChatGptUrl('not a url')).toBe(false)
  })

  it('recognises sign-in providers', () => {
    expect(isAuthUrl('https://auth.openai.com/log-in')).toBe(true)
    expect(isAuthUrl('https://accounts.google.com/o/oauth2')).toBe(true)
    expect(isAuthUrl('https://login.microsoftonline.com/common')).toBe(true)
    expect(isAuthUrl('https://appleid.apple.com/auth')).toBe(true)
    expect(isAuthUrl('https://openai.com/policies')).toBe(false)
    expect(isAuthUrl('https://help.openai.com/')).toBe(false)
  })

  it('only allows http(s)/mailto for the OS browser', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(true)
    expect(isSafeExternalUrl('http://example.com')).toBe(true)
    expect(isSafeExternalUrl('mailto:a@b.c')).toBe(true)
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('smb://host/share')).toBe(false)
    expect(isSafeExternalUrl('')).toBe(false)
  })
})

describe('decideNavigation', () => {
  const tab = (targetUrl: string, currentUrl = 'https://chatgpt.com/') =>
    decideNavigation({ targetUrl, currentUrl, context: 'tab' })

  it('keeps ChatGPT and auth navigation in the app', () => {
    expect(tab('https://chatgpt.com/c/abc')).toBe('allow')
    expect(tab('https://auth.openai.com/authorize')).toBe('allow')
    expect(tab('https://accounts.google.com/signin')).toBe('allow')
  })

  it('sends external sites to the system browser', () => {
    expect(tab('https://example.com/article')).toBe('external')
    expect(tab('http://example.com/')).toBe('external')
    expect(tab('https://help.openai.com/en/')).toBe('external')
  })

  it('allows enterprise SSO once a sign-in page is showing', () => {
    expect(tab('https://sso.company.example/saml', 'https://auth.openai.com/log-in')).toBe('allow')
    expect(decideNavigation({ targetUrl: 'https://idp.example/', currentUrl: '', context: 'login' })).toBe('allow')
  })

  it('denies dangerous schemes', () => {
    expect(tab('file:///Users/me/secret')).toBe('deny')
    expect(tab('javascript:alert(1)')).toBe('deny')
    expect(tab('chrome://settings')).toBe('deny')
    expect(tab('garbage')).toBe('deny')
  })
})

describe('decideWindowOpen', () => {
  it('opens ChatGPT links from tabs as new app tabs', () => {
    expect(decideWindowOpen({ url: 'https://chatgpt.com/c/1', context: 'tab' })).toBe('new-tab')
    expect(decideWindowOpen({ url: 'https://chatgpt.com/c/1', context: 'login' })).toBe('popup')
  })

  it('uses popups for OAuth flows', () => {
    expect(decideWindowOpen({ url: 'about:blank', context: 'tab' })).toBe('popup')
    expect(decideWindowOpen({ url: '', context: 'tab' })).toBe('popup')
    expect(decideWindowOpen({ url: 'https://accounts.google.com/gsi', context: 'tab' })).toBe('popup')
  })

  it('opens other links externally and blocks the rest', () => {
    expect(decideWindowOpen({ url: 'https://example.com', context: 'tab' })).toBe('external')
    expect(decideWindowOpen({ url: 'file:///tmp/x', context: 'tab' })).toBe('deny')
    expect(decideWindowOpen({ url: 'blob:https://chatgpt.com/uuid', context: 'tab' })).toBe('popup')
    expect(decideWindowOpen({ url: 'blob:https://evil.example/uuid', context: 'tab' })).toBe('deny')
  })
})

describe('redactUrl', () => {
  it('strips query, hash and credentials', () => {
    expect(redactUrl('https://user:pw@auth.openai.com/cb?code=SECRET#frag')).toBe('https://auth.openai.com/cb')
    expect(redactUrl('mailto:a@b.c')).toBe('mailto:')
    expect(redactUrl('nope')).toBe('')
  })
})
